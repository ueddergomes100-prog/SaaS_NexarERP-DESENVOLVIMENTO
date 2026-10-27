/*
 * FECHAMENTO DA VENDA NO SERVIDOR (item 8 da auditoria, fatia 3 -- 2026-10-13).
 *
 * Antes, o "Finalizar" do Pedido de Venda gravava tudo pelo navegador:
 * pedido, estoque, lotes, comissao, `transacoes` e o SALDO DO BANCO. Por
 * isso as firestore.rules ainda deixam vendedor mexer em `bancos`
 * (canMoveBankBalance) -- e qualquer um com DevTools podia gravar o saldo que
 * quisesse. Com a chave "Venda pelo servidor" ligada para a empresa
 * (SuperAdmin), a tela manda so' o que a pessoa escolheu e esta funcao:
 *
 *  - refaz totais, pagamentos (status, taxas, vencimentos) e comissao com as
 *    mesmas regras da tela (server/domain/*, compilado de src/utils);
 *  - confere limite de credito, atraso, estoque (com reserva), lotes, banco
 *    e credito de devolucao com os dados do banco, nao os da tela;
 *  - grava tudo numa transacao so', com todas as leituras antes das escritas.
 *
 * O que continua na tela, ANTES de chamar aqui: data da venda, aprovacao de
 * desconto por senha, cadastro rapido do cliente e a escolha do lote. O que
 * vem DEPOIS (recibo, NFC-e/NF-e, boleto, minuta) tambem continua la, com o
 * id e o numero devolvidos.
 *
 * PDV (fatia 3c, 19/10/2026): com `pdvSessionId` a venda e' do caixa do PDV --
 * o caixa tem de estar aberto e ser do operador; a venda e os lancamentos levam
 * `sourceOrigin: 'pdv'` e o `pdvSessionId` (o fechamento do caixa soma por ele)
 * e nao entram na fila de conferencia (no balcao a mercadoria sai na hora).
 *
 * Desconto, liberacao e vendedor (19/10/2026): o servidor confere o limite do
 * produto e o da tela (Configuracoes), no modo da empresa; no modo "senha" a
 * venda gasta o comprovante de liberacao (services/liberacaoDesconto.js) e,
 * com a identificacao do vendedor exigida, o comprovante do PIN do vendedor.
 * Quem liberou vem do comprovante, nunca da tela. Regra em
 * src/utils/conferenciaDescontoDomain.ts.
 *
 * Preco de cada item (21/10/2026): o servidor le o cadastro, as promocoes e as
 * quotas e confere o preco cobrado contra o do sistema; abaixo dele, a
 * diferenca conta como DESCONTO e passa pelos mesmos limites (decisao do dono).
 * Acima e' livre. Regra em src/utils/conferenciaPrecoDomain.ts.
 */
const { admin, db } = require('../config/firebase');
const fin = require('../domain/financeDomain');
const venda = require('../domain/vendaFechamentoDomain');
const credito = require('../domain/creditoDomain');
const reserva = require('../domain/estoqueReservaDomain');
const { toStockAdjustmentItems, toBaseQuantity } = require('../domain/embalagemDomain');
const { parseParametrosVenda, bloqueioPorAtraso, maiorAtrasoEmDias } = require('../domain/parametrosVendaDomain');
const { STATUS_PRE_VENDA, isPedidoAberto, resolveOrigemPedido } = require('../domain/preVendaDomain');
const rotaPreVenda = require('./rotaPreVenda');
const { buildDocumentMetadata, buildDocumentUpdateMetadata } = require('../domain/documentMetadata');
const { getDateInputInTimeZone } = require('../domain/dateTime');
const cd = require('../domain/conferenciaDescontoDomain');
const cp = require('../domain/conferenciaPrecoDomain');
const { condicaoDoPagamento, parseFormasAVista } = require('../domain/precoVendaDomain');
const { lerPromocao, promocaoValeNoDia } = require('../domain/promocaoDomain');
const { descontoPadraoDoCliente } = require('../domain/descontoDomain');
const { bloqueioPorBalanco } = require('../domain/balancoDomain');
const grade = require('../domain/gradeProdutosDomain');
const ef = require('../domain/entregaFuturaDomain');
const comprovantes = require('./comprovantes');
const cashback = require('./cashback');
const cb = require('../domain/cashbackDomain');

class ErroVenda extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const agora = () => admin.firestore.FieldValue.serverTimestamp();

const temPermissao = (user, permissao) => Boolean(
  user.isPlatformAdmin
  || user.isTenantManager
  || (Array.isArray(user.permissoes) && user.permissoes.includes(permissao)),
);

// --- Numeracao (mesma regra de getNextTenantSequenceValue e de condicionais.js) ---
const parseSequencia = (valor) => {
  const n = Number.parseInt(String(valor ?? '').replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
};
const refSequencia = (tenantId) => db.collection('contadores').doc(tenantId).collection('sequencias').doc('pedidos_venda');
const refSequenciaLegada = (tenantId) => db.collection('contadores').doc(tenantId);
const maiorNumeroGravado = async (tenantId) => {
  try {
    const snap = await db.collection('pedidos_venda').where('tenantId', '==', tenantId).orderBy('numeroPedido', 'desc').limit(1).get();
    return snap.empty ? 0 : parseSequencia(snap.docs[0].data().numeroPedido);
  } catch {
    return 0;
  }
};
const formatarNumero = (n) => String(n).padStart(4, '0');

// --- Leituras fora da transacao (consultas) ---

const FORMAS_FORA_DO_SALDO = ['Cartão de Crédito', 'Cartão de Débito'];

/** Saldo em aberto e maior atraso do cliente (mesma conta de contasReceberQuery.ts). */
const situacaoDoCliente = async ({ user, tenantId, clienteId, noGrupo }) => {
  if (noGrupo) {
    // Carregado so' aqui: filiais.js nao entra no caminho de quem nao tem grupo.
    const { saldoDoClienteNoGrupo } = require('./filiais');
    const r = await saldoDoClienteNoGrupo({ user: { ...user, tenantId }, clienteId });
    return { saldoCentavos: r.totalCentavos, maiorAtrasoDias: Number(r.maiorAtrasoDias) || 0 };
  }
  const snap = await db.collection('transacoes')
    .where('tenantId', '==', tenantId)
    .where('clienteId', '==', clienteId)
    .where('status', '==', 'Pendente')
    .get();
  const titulos = snap.docs.map((d) => d.data());
  const saldoCentavos = titulos.reduce((total, t) => (
    FORMAS_FORA_DO_SALDO.includes(t.formaPagamento) ? total : total + fin.transactionNetCents(t)
  ), 0);
  return { saldoCentavos, maiorAtrasoDias: maiorAtrasoEmDias(titulos, getDateInputInTimeZone()) };
};

const lerColecaoDaEmpresa = async (colecao, tenantId) => {
  const snap = await db.collection(colecao).where('tenantId', '==', tenantId).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

const mensagemDeReserva = (nome, estoque, reservada) => (
  `Estoque reservado: ${nome} tem ${estoque} em estoque e ${reservada} reservado em pré-venda, condicional, OS ou troca. `
  + `Só ${Math.max(0, estoque - reservada)} está livre. Diminua a quantidade ou libere a reserva e finalize de novo.`
);

/** Soma os deltas do mesmo produto (a venda pode ter o mesmo produto em duas linhas). */
const somarDeltas = (deltas) => {
  const porId = new Map();
  deltas.forEach((d) => {
    const atual = porId.get(d.id) || { id: d.id, nome: d.nome, quantidadeDelta: 0, quantidadeReservadaDelta: 0 };
    atual.quantidadeDelta += d.quantidadeDelta;
    atual.quantidadeReservadaDelta += d.quantidadeReservadaDelta;
    if (!atual.nome && d.nome) atual.nome = d.nome;
    porId.set(d.id, atual);
  });
  return [...porId.values()];
};

/**
 * Finaliza a venda. `corpo` e' o que a tela manda (ver lerPedidoDeFechamento).
 * Devolve { pedidoId, numeroPedido, vendedorId, vendedorNome, totalCentavos, ... }.
 */
/** Desconto do cadastro do cliente (passa direto ate esse percentual). Sem cliente = 0. */
const percentualDoClienteDaVenda = async (clienteId, tenantId) => {
  if (!clienteId) return 0;
  const snap = await db.collection('clientes').doc(String(clienteId)).get();
  return snap.exists && snap.data().tenantId === tenantId ? descontoPadraoDoCliente(snap.data()) : 0;
};

/**
 * Quanto ja' saiu da quota de uma promocao em OUTRAS vendas (a mesma conta de
 * promocaoService.vendidoNaPromocao): pedidos nao cancelados que levaram a
 * promocao, na unidade base. promocaoId -> { produtoId: quantidade }.
 */
const vendidoNaPromocao = async (tenantId, promocaoId, ignorarPedidoId) => {
  const snap = await db.collection('pedidos_venda').where('tenantId', '==', tenantId).where('promocaoIds', 'array-contains', promocaoId).get();
  const vendido = {};
  snap.docs.forEach((d) => {
    const pedido = d.data();
    if (pedido.status === 'Cancelada' || d.id === ignorarPedidoId) return;
    (Array.isArray(pedido.itens) ? pedido.itens : []).forEach((item) => {
      if (!item || item.promocaoId !== promocaoId) return;
      const id = String(item.id || '');
      vendido[id] = (vendido[id] || 0) + (Number(item.quantidadeBase ?? item.quantidade) || 0);
    });
  });
  return vendido;
};

/**
 * Preco de cada item contra o do sistema (21/10/2026). Cadastro, promocoes e
 * quotas lidos FORA da transacao (consultas): um preco que muda no meio da
 * venda nao muda o que o vendedor combinou. `itens` no formato da conferencia
 * (precoUnitario, quantidade, desconto, embalagemId, fatorConversao).
 */
const conferirPrecosNoServidor = async ({ tenantId, config, itens, pagamentos, ignorarPedidoId }) => {
  const ids = [...new Set(itens.map((i) => i.id).filter((id) => id && id !== 'avulso'))];
  const produtos = {};
  if (ids.length) {
    (await db.getAll(...ids.map((id) => db.collection('estoque').doc(id)))).forEach((s) => {
      if (s.exists && s.data().tenantId === tenantId) produtos[s.id] = s.data();
    });
  }
  const hoje = getDateInputInTimeZone();
  const promocoes = ids.length
    ? (await lerColecaoDaEmpresa('promocoes', tenantId)).map((p) => ({ ...lerPromocao(p), id: p.id })).filter((p) => !p.inativa)
    : [];
  const vendidoPorPromocao = {};
  const comQuota = promocoes.filter((p) => promocaoValeNoDia(p, hoje) && p.itens.some((i) => i.quota !== null && ids.includes(i.produtoId)));
  for (const p of comQuota) vendidoPorPromocao[p.id] = await vendidoNaPromocao(tenantId, p.id, ignorarPedidoId);
  const condicao = condicaoDoPagamento(
    (Array.isArray(pagamentos) ? pagamentos : []).map((p) => ({ forma: String((p && p.forma) || ''), parcelas: p && p.parcelas, parcelasAPrazo: p && p.parcelasAPrazo })),
    parseFormasAVista(config.formasPrecoAVista),
  );
  return cp.conferirPrecos({ itens, produtos, promocoes, hoje, condicao, vendidoPorPromocao });
};

const finalizarVenda = async ({ user, tenantId, corpo }) => {
  const lido = venda.lerPedidoDeFechamento(corpo);
  if ('erro' in lido) throw new ErroVenda(400, lido.erro);
  const pedido = lido.pedido;

  const configSnap = await db.collection('configuracoes').doc(tenantId).get();
  const config = configSnap.exists ? configSnap.data() : {};
  const permitirSemEstoque = config.venderSemEstoque === true;
  // Venda com entrega futura (23/10/2026): so' com a chave da filial ligada; o
  // estoque fica RESERVADO (nao baixa) e, pela regra da filial, pode faturar
  // sem estoque (padrao) ou exigir estoque para reservar.
  const entregaFutura = pedido.entregaFutura === true;
  if (entregaFutura && !ef.parseTrabalhaComEntregaFutura(config[ef.CHAVE_TRABALHA_COM_ENTREGA_FUTURA])) {
    throw new ErroVenda(409, 'Esta filial não trabalha com venda para entrega futura. Ligue a opção em Configurações › Vendas ou desmarque "Entrega futura" no pedido.');
  }
  if (entregaFutura && pedido.pdvSessionId) throw new ErroVenda(409, 'Venda para entrega futura só pelo Pedido de Venda, não pelo PDV.');
  const entregaFuturaExigeEstoque = ef.parseEntregaFuturaExigeEstoque(config[ef.CHAVE_ENTREGA_FUTURA_EXIGE_ESTOQUE]);
  // Balanco aberto com as vendas travadas (21/10/2026): nada finaliza ate' ele fechar.
  const travaDoBalanco = bloqueioPorBalanco(config.balancoEmAndamento, pedido.pdvSessionId ? 'finalizar a venda no PDV' : 'finalizar a venda');
  if (travaDoBalanco) throw new ErroVenda(409, travaDoBalanco);

  // Pagamentos: a mesma conta da tela, com a configuracao lida daqui.
  const totais = venda.totaisDoFechamento({
    itens: pedido.itens,
    descontoGeralTipo: pedido.descontoGeral.tipo,
    descontoGeralValor: pedido.descontoGeral.valorInformado,
    frete: pedido.frete,
    encargos: pedido.encargos,
  });
  const financeiro = venda.configFinanceiraDaEmpresa(config);
  const [bandeiras, bancosDaEmpresa] = await Promise.all([
    lerColecaoDaEmpresa('bandeiras_cartao', tenantId),
    lerColecaoDaEmpresa('bancos', tenantId),
  ]);
  let pagamentos;
  try {
    pagamentos = fin.normalizePayments(totais.valorTotalCentavos, pedido.pagamentos, {
      saleDate: pedido.dataVenda,
      maxCreditInstallments: financeiro.maxCreditInstallments || undefined,
      creditFeePercentByInstallment: financeiro.creditFeePercentByInstallment,
      debitFeePercent: financeiro.debitFeePercent,
      creditSettlementDays: financeiro.creditSettlementDays,
      debitSettlementDays: financeiro.debitSettlementDays,
      cardFeeSchedulesByBrand: fin.buildCardFeeSchedulesByBrand(bandeiras),
      pagamentoCartaoSimplificadoAtivo: fin.parsePagamentoCartaoSimplificadoAtivo(config.pagamentoCartaoSimplificadoAtivo),
      bancoPadraoSimplificado: fin.resolveBancoPadraoSimplificado(bancosDaEmpresa.map((b) => ({ id: b.id, nome: String(b.nome || ''), ativo: b.ativo }))),
    });
  } catch (erro) {
    throw new ErroVenda(400, erro instanceof Error && erro.message ? erro.message : 'Revise os dados do pagamento.');
  }
  pagamentos = fin.explodeInstallmentPaymentRecords(pagamentos);
  const resumo = fin.summarizePayments(pagamentos);
  const aPrazo = resumo.paymentCondition === 'aprazo';

  // Preco de cada item contra o do sistema (21/10/2026): abaixo dele, a
  // diferenca entra no desconto -- do item e do total.
  const precos = await conferirPrecosNoServidor({
    tenantId, config, itens: pedido.itens, pagamentos: pedido.pagamentos, ignorarPedidoId: pedido.pedidoId || pedido.idDocumento,
  });

  // Desconto total contra o limite da tela, no modo da empresa (19/10/2026).
  const tela = pedido.pdvSessionId ? 'pdv' : 'pedido';
  const configDesconto = cd.configDoDesconto(config, tela);
  const baseDoDescontoCentavos = fin.toCents(totais.valorTotalItens) + precos.diferencaTotalCentavos;
  const descontoTotalCentavos = fin.toCents(totais.valorTotalDescontos) + precos.diferencaTotalCentavos;
  const situacaoDesconto = cd.situacaoDoDescontoTotal({
    tela,
    config: configDesconto,
    baseCentavos: baseDoDescontoCentavos,
    descontoCentavos: descontoTotalCentavos,
    percentualDoCliente: await percentualDoClienteDaVenda(pedido.clienteId, tenantId),
  });
  // Preco abaixo do sistema: a mensagem diz de onde veio o desconto a mais.
  const indiceComDiferenca = precos.itens.findIndex((p) => p.diferencaCentavos > 0);
  const explicacaoDoPreco = indiceComDiferenca >= 0 ? cp.explicacaoDaDiferenca(pedido.itens[indiceComDiferenca], precos.itens[indiceComDiferenca]) : '';
  if (situacaoDesconto.erro) throw new ErroVenda(409, `${explicacaoDoPreco}${situacaoDesconto.erro}`);
  // Identificacao do vendedor: so' o Pedido de Venda pede (o PDV nao).
  const exigeIdentificacao = tela === 'pedido' && cd.exigeIdentificacaoDoVendedor(config);

  // Atraso e limite de credito (venda a prazo). Saldo lido FORA da transacao
  // (consulta); a versao do credito do cliente e' reconferida la dentro.
  const parametros = parseParametrosVenda(config.parametrosVenda);
  const trabalhaComLimite = credito.parseTrabalhaComLimiteCredito(config.trabalhaComLimiteCredito);
  const vendaEhAprazoComLimite = trabalhaComLimite && aPrazo;
  let creditoVersaoNaChecagem = 0;
  if (aPrazo && pedido.clienteId && (parametros.bloqueioAtraso.ativo || vendaEhAprazoComLimite)) {
    const situacao = await situacaoDoCliente({ user, tenantId, clienteId: pedido.clienteId, noGrupo: Boolean(config.grupoId) });
    if (parametros.bloqueioAtraso.ativo) {
      const bloqueio = bloqueioPorAtraso(parametros, situacao.maiorAtrasoDias, pedido.clienteNome);
      if (bloqueio) throw new ErroVenda(409, bloqueio);
    }
    if (vendaEhAprazoComLimite) {
      const clienteSnap = await db.collection('clientes').doc(pedido.clienteId).get();
      const cliente = clienteSnap.exists && clienteSnap.data().tenantId === tenantId ? clienteSnap.data() : null;
      const limite = cliente && cliente.limiteDeCredito != null ? Math.round(Number(cliente.limiteDeCredito) * 100) : null;
      creditoVersaoNaChecagem = credito.parseCreditoVersao(cliente ? cliente[credito.CAMPO_CREDITO_VERSAO] : 0);
      const checagem = credito.excedeLimiteCredito(limite, situacao.saldoCentavos, totais.valorTotalCentavos);
      if (checagem.bloqueado) {
        throw new ErroVenda(409, checagem.motivo === 'sem_limite'
          ? `O cliente "${pedido.clienteNome}" não tem limite de crédito cadastrado. Não é possível vender a prazo.`
          : 'Esta venda ultrapassaria o limite de crédito do cliente (saldo em aberto + valor desta venda).');
      }
    }
  } else if (vendaEhAprazoComLimite) {
    throw new ErroVenda(409, `O cliente "${pedido.clienteNome}" não tem limite de crédito cadastrado. Não é possível vender a prazo.`);
  }

  // Credito de devolucao usado: quais creditos o cliente tem (consulta).
  const creditoUsadoCentavos = pagamentos
    .filter((p) => p.formaPagamento === 'Crédito de Devolução')
    .reduce((soma, p) => soma + p.valorCentavos, 0);
  let idsDosCreditos = [];
  if (creditoUsadoCentavos > 0) {
    // O credito e' gravado pelo NOME do cliente (DevolucaoVendaModal nao grava
    // clienteId), e e' por ele que o Pedido de Venda e o Contas a Receber o
    // procuram. Procurar por clienteId nunca achava nada: venda com credito era
    // recusada. O nome vem do CADASTRO do cliente da venda, nao do que a tela
    // mandou -- senao daria para gastar o credito de outro cliente trocando o nome.
    const semCliente = 'Crédito de devolução só pode ser usado com o cliente cadastrado escolhido.';
    if (!pedido.clienteId) throw new ErroVenda(400, semCliente);
    const clienteSnap = await db.collection('clientes').doc(pedido.clienteId).get();
    const nomeDoCadastro = clienteSnap.exists && clienteSnap.data().tenantId === tenantId
      ? String(clienteSnap.data().nome || '').trim().toUpperCase()
      : '';
    if (!nomeDoCadastro) throw new ErroVenda(400, semCliente);
    const snap = await db.collection('creditos_cliente')
      .where('tenantId', '==', tenantId)
      .where('clienteNome', '==', nomeDoCadastro)
      .where('status', 'in', ['disponivel', 'usado_parcial'])
      .get();
    idsDosCreditos = snap.docs.map((d) => d.id);
  }

  // Cashback como pagamento (fase 2, 20/10/2026): o saldo e' conferido e
  // consumido DENTRO da transacao (services/cashback.js); aqui so' o que nao
  // depende do banco. Nunca pela tela: ela nao escreve no saldo.
  const cashbackUsadoCentavos = cb.cashbackUsadoNaVenda(pagamentos);
  const configCashback = cb.parseConfigCashback(config.cashback);
  if (cashbackUsadoCentavos > 0) {
    if (!pedido.clienteId) throw new ErroVenda(400, 'Cashback só pode ser usado com o cliente cadastrado escolhido.');
    if (!configCashback.ativo) throw new ErroVenda(409, 'O cashback está desligado nas Configurações. Troque a forma de pagamento.');
  }
  const hojeDaVenda = getDateInputInTimeZone();

  const pisoDaNumeracao = pedido.pedidoId ? 0 : await maiorNumeroGravado(tenantId);

  const resultado = await db.runTransaction(async (tx) => {
    // ---------------- LEITURAS (todas antes de qualquer escrita) ----------------
    const pedidoRef = db.collection('pedidos_venda').doc(pedido.pedidoId || pedido.idDocumento);
    const pedidoSnap = await tx.get(pedidoRef);
    let aberto = null;
    if (pedido.pedidoId) {
      if (!pedidoSnap.exists || pedidoSnap.data().tenantId !== tenantId) throw new ErroVenda(404, 'Este pedido não existe mais. Atualize a lista de pedidos.');
      aberto = pedidoSnap.data();
      if (!isPedidoAberto(aberto.status)) {
        throw new ErroVenda(409, `O pedido #${aberto.numeroPedido || ''} já foi finalizado ou cancelado (talvez por outra pessoa). Atualize a tela.`);
      }
      const permissao = aberto.status === STATUS_PRE_VENDA ? 'vendas.pre_venda_finalizar' : 'vendas.pedidos';
      if (!temPermissao(user, permissao)) {
        throw new ErroVenda(403, permissao === 'vendas.pre_venda_finalizar'
          ? 'Você não tem permissão para finalizar pré-venda. Peça a um responsável liberar "Finalizar pré-venda" no seu usuário.'
          : 'Você não tem permissão para finalizar pedidos. Peça a um responsável liberar "Vendas: Pedidos" no seu usuário.');
      }
    } else if (pedidoSnap.exists) {
      // Mesmo envio repetido (a conexao caiu depois de gravar): nao duplica.
      const ja = pedidoSnap.data();
      if (ja.tenantId === tenantId && ja.status === 'Finalizada') {
        return { jaEnviado: true, pedidoId: pedidoRef.id, numeroPedido: String(ja.numeroPedido || ''), vendedorId: ja.vendedorId || '', vendedorNome: ja.vendedorNome || '' };
      }
      throw new ErroVenda(409, 'Esta venda já foi gravada de outro jeito. Atualize a tela e confira em Pedidos de Venda.');
    }

    // Venda do PDV: o caixa tem de estar aberto e ser de quem esta' vendendo.
    const pdv = Boolean(pedido.pdvSessionId);
    if (pdv) {
      const caixaSnap = await tx.get(db.collection('caixas_pdv').doc(pedido.pdvSessionId));
      const caixa = caixaSnap.exists ? caixaSnap.data() : null;
      if (!caixa || caixa.tenantId !== tenantId) {
        throw new ErroVenda(404, 'O caixa do PDV não foi encontrado. Feche o PDV, abra o caixa de novo e finalize a venda.');
      }
      if (caixa.status !== 'aberto') {
        throw new ErroVenda(409, 'Este caixa do PDV já foi fechado. Abra o caixa de novo para continuar vendendo; a venda não foi gravada.');
      }
      if (caixa.operadorId && caixa.operadorId !== user.uid) {
        throw new ErroVenda(403, 'Este caixa do PDV é de outro operador. Abra o seu caixa para vender.');
      }
    }

    const [seqSnap, seqLegadaSnap] = pedido.pedidoId ? [null, null] : await Promise.all([tx.get(refSequencia(tenantId)), tx.get(refSequenciaLegada(tenantId))]);

    const vendedorId = pedido.vendedorId || user.uid;
    const vendedorSnap = await tx.get(db.collection('usuarios').doc(vendedorId));
    const vendedor = vendedorSnap.exists ? vendedorSnap.data() : {};
    if (!vendedorSnap.exists || vendedor.tenantId !== tenantId) throw new ErroVenda(400, 'O vendedor selecionado não pertence à empresa ativa.');
    const vendedorNome = vendedor.nome || vendedor.nomeResponsavel || user.nome || user.email || 'Vendedor';

    // Comprovantes do servidor (19/10/2026): liberacao do desconto e PIN do vendedor.
    const agoraMs = Date.now();
    let liberacao = null;
    if (situacaoDesconto.precisaLiberacao) {
      const idLiberacao = pedido.descontoGeral.aprovacao && pedido.descontoGeral.aprovacao.comprovanteId;
      if (!idLiberacao) throw new ErroVenda(cd.STATUS_PEDIR_DE_NOVO, `${explicacaoDoPreco}${cd.MENSAGEM_FALTA_LIBERACAO}`);
      liberacao = await comprovantes.lerNaTransacao(tx, String(idLiberacao));
      const problema = cd.problemaDaLiberacao(liberacao.dados, {
        tenantId, emitidoPara: user.uid, tela, baseCentavos: baseDoDescontoCentavos, descontoCentavos: descontoTotalCentavos, agoraMs,
      });
      if (problema) throw new ErroVenda(cd.STATUS_PEDIR_DE_NOVO, `${explicacaoDoPreco}${problema}`);
    }
    let identificacao = null;
    if (exigeIdentificacao) {
      if (!pedido.comprovanteVendedorId) throw new ErroVenda(cd.STATUS_PEDIR_DE_NOVO, cd.MENSAGEM_FALTA_IDENTIFICACAO);
      identificacao = await comprovantes.lerNaTransacao(tx, pedido.comprovanteVendedorId);
      const problema = cd.problemaDaIdentificacao(identificacao.dados, { tenantId, emitidoPara: user.uid, vendedorId, agoraMs });
      if (problema) throw new ErroVenda(cd.STATUS_PEDIR_DE_NOVO, problema);
    }

    // Produtos: os da venda e os da reserva gravada (que pode ter item que saiu da venda).
    const reservaGravada = aberto && aberto.estoqueReservado === true ? toStockAdjustmentItems(aberto.itens || []) : [];
    const idsProdutos = [...new Set([...pedido.itens.map((i) => i.id), ...reservaGravada.map((r) => r.id)].filter((id) => id && id !== 'avulso'))];
    const produtoRefs = idsProdutos.map((id) => db.collection('estoque').doc(id));
    const produtoSnaps = produtoRefs.length ? await tx.getAll(...produtoRefs) : [];
    const produtos = {};
    produtoSnaps.forEach((s) => {
      if (!s.exists) return;
      if (s.data().tenantId !== tenantId) throw new ErroVenda(400, 'Um dos produtos da venda não é desta empresa. Remova o item e lance de novo.');
      // Principal de grade nao tem saldo: a venda e' da variacao (domain/gradeProdutosDomain).
      if (grade.ehProdutoComGrade(s.data())) throw new ErroVenda(400, grade.mensagemPrincipalDeGrade(s.data().nome));
      produtos[s.id] = s.data();
    });

    // Desconto de cada item: limite do produto (e o da tela, no Pedido com
    // "bloquear"), com a diferenca do preco abaixo do sistema somada.
    pedido.itens.forEach((item, indice) => {
      const conferido = precos.itens[indice];
      const problema = cd.problemaNoDescontoDoItem({
        nome: item.nome,
        brutoCentavos: conferido.brutoCentavos,
        descontoCentavos: conferido.descontoCentavos,
        produto: produtos[item.id] || null,
      }, tela, configDesconto);
      if (problema) throw new ErroVenda(409, `${cp.explicacaoDaDiferenca(item, conferido)}${problema}`);
    });

    // Lotes: so' produto que controla lote; a soma tem de bater com a quantidade da linha.
    // Entrega futura: nada sai agora, o lote e' escolhido na entrega.
    const usoPorLote = new Map();
    pedido.itens.forEach((item) => {
      const produto = produtos[item.id];
      if (!produto || produto.controlarLote !== true || entregaFutura) { delete item.lotes; return; }
      const base = toBaseQuantity(item.quantidade, item.fatorConversao);
      const soma = (item.lotes || []).reduce((t, l) => t + l.quantidade, 0);
      if (Math.abs(soma - base) > 1e-6) throw new ErroVenda(400, `${item.nome}: escolha de novo de qual lote sai (a quantidade dos lotes não bate com a da venda).`);
      (item.lotes || []).forEach((l) => {
        const atual = usoPorLote.get(l.loteId) || { quantidade: 0, produtoId: item.id, nome: item.nome, lote: l.lote };
        if (atual.produtoId !== item.id) throw new ErroVenda(400, `${item.nome}: lote de outro produto. Escolha o lote de novo.`);
        atual.quantidade += l.quantidade;
        usoPorLote.set(l.loteId, atual);
      });
    });
    const loteRefs = [...usoPorLote.keys()].map((id) => db.collection('estoque_lotes').doc(id));
    const loteSnaps = loteRefs.length ? await tx.getAll(...loteRefs) : [];
    const lotesAtuais = {};
    loteSnaps.forEach((s) => {
      const uso = usoPorLote.get(s.id);
      if (!s.exists || s.data().tenantId !== tenantId || s.data().produtoId !== uso.produtoId) {
        throw new ErroVenda(400, `${uso.nome}: o lote ${uso.lote || ''} não existe mais. Escolha o lote de novo.`);
      }
      lotesAtuais[s.id] = Number(s.data().quantidade || 0);
    });

    // Bancos creditados pelos pagamentos confirmados.
    const creditoPorBanco = new Map();
    pagamentos.forEach((p) => {
      if (p.status === 'confirmado' && p.bancoId) creditoPorBanco.set(p.bancoId, (creditoPorBanco.get(p.bancoId) || 0) + p.valorCentavos);
    });
    const saldoDosBancos = new Map();
    for (const bancoId of creditoPorBanco.keys()) {
      const bancoSnap = await tx.get(db.collection('bancos').doc(bancoId));
      if (!bancoSnap.exists || bancoSnap.data().tenantId !== tenantId) throw new ErroVenda(400, 'O banco de destino selecionado não foi encontrado.');
      saldoDosBancos.set(bancoId, Number(bancoSnap.data().saldoCentavos || 0));
    }

    // Guarda do limite de credito: outra venda a prazo do mesmo cliente entrou no meio?
    const clienteCreditoRef = vendaEhAprazoComLimite && pedido.clienteId ? db.collection('clientes').doc(pedido.clienteId) : null;
    let creditoVersaoAtual = 0;
    if (clienteCreditoRef) {
      const s = await tx.get(clienteCreditoRef);
      creditoVersaoAtual = credito.parseCreditoVersao(s.exists ? s.data()[credito.CAMPO_CREDITO_VERSAO] : 0);
      if (credito.creditoFoiAlteradoDurante(creditoVersaoNaChecagem, creditoVersaoAtual)) throw new ErroVenda(409, credito.MENSAGEM_CREDITO_CONCORRENTE);
    }

    // Credito de devolucao: saldos relidos aqui dentro.
    let consumos = [];
    if (creditoUsadoCentavos > 0) {
      const saldos = [];
      for (const creditoId of idsDosCreditos) {
        const s = await tx.get(db.collection('creditos_cliente').doc(creditoId));
        if (!s.exists) continue;
        const c = s.data();
        if (c.tenantId !== tenantId || !['disponivel', 'usado_parcial'].includes(c.status)) continue;
        saldos.push({ id: creditoId, saldoDisponivelCentavos: Number(c.saldoDisponivelCentavos ?? fin.toCents(c.saldoDisponivel || 0)) });
      }
      try {
        consumos = credito.distribuirConsumoCredito(saldos, creditoUsadoCentavos);
      } catch {
        throw new ErroVenda(409, 'O crédito deste cliente mudou desde que a venda foi montada. Refaça o pagamento com crédito.');
      }
    }

    // Cashback: saldo relido aqui dentro; R$ nao passa do saldo, pontos = uma
    // faixa alcancada; os lotes saem na ordem "vence antes, sai antes".
    let usoCashback = null;
    if (cashbackUsadoCentavos > 0) {
      try {
        usoCashback = await cashback.prepararUso({
          tx, tenantId, clienteId: pedido.clienteId, config: configCashback, totalCentavos: totais.valorTotalCentavos, valorCentavos: cashbackUsadoCentavos, hoje: hojeDaVenda,
        });
      } catch (erro) {
        if (erro instanceof cashback.ErroCashback) throw new ErroVenda(erro.status, erro.message);
        throw erro;
      }
    }

    // ---------------- CONTAS ----------------
    const proximoNumero = pedido.pedidoId
      ? 0
      : Math.max(
        seqSnap && seqSnap.exists ? parseSequencia(seqSnap.data().valor) : 0,
        seqLegadaSnap && seqLegadaSnap.exists ? parseSequencia(seqLegadaSnap.data().pedidos_venda) : 0,
        pisoDaNumeracao,
      ) + 1;
    const numeroPedido = pedido.pedidoId ? String(aberto.numeroPedido || '') : formatarNumero(proximoNumero);

    const itensBase = toStockAdjustmentItems(pedido.itens);
    // Entrega futura: a venda nao baixa nada; a reserva passa a ser a dos
    // itens faturados (pre-venda que ja' reservava so' ajusta a diferenca).
    const deltas = somarDeltas(entregaFutura
      ? reserva.computeReservationDelta(reservaGravada, itensBase)
      : reservaGravada.length > 0
        ? reserva.computeReservationCommit(reservaGravada, itensBase)
        : itensBase.map((i) => ({ id: i.id, nome: i.nome, quantidadeDelta: -i.quantidade, quantidadeReservadaDelta: 0 })));
    const escritasDeEstoque = [];
    deltas.forEach((d) => {
      const produto = produtos[d.id];
      if (!produto) return; // produto apagado: a tela tambem pulava
      const estoqueAtual = Number(produto.quantidade || 0);
      const reservadaAtual = Number(produto.quantidadeReservada || 0);
      const proximo = estoqueAtual + d.quantidadeDelta;
      const reservadaDepois = Math.max(0, reservadaAtual + d.quantidadeReservadaDelta);
      const nome = d.nome || produto.nome || 'item';
      // "Bloquear venda sem estoque" do produto vence a chave da filial.
      const permitirSemEstoqueDoProduto = reserva.podeVenderSemEstoque(permitirSemEstoque, produto);
      if (entregaFutura && d.quantidadeReservadaDelta > 0 && entregaFuturaExigeEstoque && estoqueAtual - reservadaDepois < -1e-9) {
        throw new ErroVenda(409, `${nome}: a filial exige estoque para faturar entrega futura. Em estoque ${estoqueAtual}, já reservado ${reservadaAtual}: só dá para reservar ${Math.max(0, estoqueAtual - reservadaAtual)}. Diminua a quantidade, dê entrada na mercadoria ou mude a regra em Configurações › Vendas.`);
      }
      if (d.quantidadeDelta < 0 && !permitirSemEstoqueDoProduto) {
        if (proximo < -1e-9) throw new ErroVenda(409, `Estoque insuficiente para ${nome}. Disponível: ${estoqueAtual}.`);
        if (proximo < reservadaDepois - 1e-9) throw new ErroVenda(409, mensagemDeReserva(nome, estoqueAtual, reservadaDepois));
      }
      escritasDeEstoque.push([d.id, {
        quantidade: permitirSemEstoqueDoProduto ? proximo : Math.max(0, proximo),
        quantidadeReservada: reservadaDepois,
        updatedAt: agora(),
      }]);
    });

    const escritasDeLote = [];
    usoPorLote.forEach((uso, loteId) => {
      const disponivel = lotesAtuais[loteId];
      if (!permitirSemEstoque && uso.quantidade > disponivel + 1e-9) {
        throw new ErroVenda(409, `${uso.nome}: o lote ${uso.lote || ''} tem só ${disponivel}. Escolha outro lote ou diminua a quantidade.`);
      }
      escritasDeLote.push([loteId, { quantidade: disponivel - uso.quantidade, updatedAt: agora() }]);
    });

    const pagamentosGravados = pagamentos.map((p, indice) => ({
      ...p,
      transactionId: indice === 0 ? pedidoRef.id : `${pedidoRef.id}_pag_${indice + 1}`,
    }));

    const comissaoPadrao = typeof config.comissaoPadraoPecas === 'number' ? config.comissaoPadraoPecas : undefined;
    const comissao = fin.buildCommissionSnapshotFromItems({
      sellerId: vendedorId,
      sellerName: vendedorNome,
      itens: pedido.itens.map((item) => ({
        id: item.id,
        nome: item.nome,
        baseCents: fin.toCents(item.subtotal),
        percentual: fin.resolveComissaoPercentual({
          itemPercentual: produtos[item.id] ? produtos[item.id].comissaoPercentual : undefined,
          recebeComissao: vendedor.recebeComissaoPecas,
          percentualVendedor: vendedor.comissaoPercentualPecas,
          percentualPadraoSistema: comissaoPadrao,
        }),
      })),
    });

    const promocaoIds = [...new Set(pedido.itens.map((i) => i.promocaoId).filter((p) => typeof p === 'string' && p))];
    const origemDoAberto = aberto ? resolveOrigemPedido(aberto) : 'balcao';
    const conferenciaAtiva = config.conferenciaMercadoria === true;
    const pedidoData = {
      numeroPedido,
      clienteId: pedido.clienteId,
      clienteNome: pedido.clienteNome,
      observacao: pedido.observacao,
      itens: pedido.itens,
      promocaoIds,
      ...(pedido.orcamentoId ? { orcamentoId: pedido.orcamentoId } : {}),
      valorTotalItens: totais.valorTotalItens,
      valorTotalItensCentavos: fin.toCents(totais.valorTotalItens),
      valorTotalDescontos: totais.valorTotalDescontos,
      valorTotalDescontosCentavos: fin.toCents(totais.valorTotalDescontos),
      // Itens abaixo do preco do sistema: quanto isso deu de desconto (21/10/2026).
      ...(precos.diferencaTotalCentavos > 0 ? { descontoPorPrecoCentavos: precos.diferencaTotalCentavos } : {}),
      descontoGeral: {
        tipo: pedido.descontoGeral.tipo,
        valorInformado: pedido.descontoGeral.valorInformado,
        valorAplicadoCentavos: totais.descontoGeralCentavos,
        excedeuLimite: situacaoDesconto.excedeu,
        ...(liberacao ? { aprovacao: cd.aprovacaoDoComprovante(liberacao.dados, liberacao.ref.id) } : {}),
      },
      frete: pedido.frete,
      encargos: pedido.encargos,
      // Transporte para a nota (27/10/2026): modalidade, transportadora, placa, volumes.
      ...(pedido.transporte ? { transporte: pedido.transporte } : {}),
      valorTotal: totais.valorTotal,
      valorTotalCentavos: totais.valorTotalCentavos,
      formaPagamento: resumo.paymentMethodLabel,
      condicaoPagamento: resumo.paymentCondition,
      pagamentos: pagamentosGravados,
      totalRecebido: resumo.received,
      totalRecebidoCentavos: resumo.receivedCents,
      totalPendente: resumo.pending,
      totalPendenteCentavos: resumo.pendingCents,
      totalTaxasPagamento: resumo.cardFee,
      totalTaxasPagamentoCentavos: resumo.cardFeeCents,
      totalLiquidoFinanceiro: resumo.financialNet,
      totalLiquidoFinanceiroCentavos: resumo.financialNetCents,
      dataVenda: pedido.dataVenda,
      status: 'Finalizada',
      // PDV: mercadoria sai no balcao, nao entra na fila de conferencia.
      ...(conferenciaAtiva && !pdv ? { statusConferencia: (aberto && aberto.statusConferencia) || 'aguardando' } : {}),
      ...(aberto && aberto.conferidoPor ? { conferidoPor: aberto.conferidoPor } : {}),
      ...(aberto && aberto.conferidoPorNome ? { conferidoPorNome: aberto.conferidoPorNome } : {}),
      ...(aberto && aberto.conferidoEm ? { conferidoEm: aberto.conferidoEm } : {}),
      tenantId,
      usuarioResponsavelId: user.uid,
      vendedorId,
      vendedorNome,
      comissao,
      origem: pdv ? 'pdv' : origemDoAberto,
      ...(pdv ? { sourceOrigin: 'pdv', pdvSessionId: pedido.pdvSessionId } : {}),
      // Entrega futura: a reserva FICA (a entrega baixa depois); venda comum nao reserva mais nada.
      estoqueReservado: entregaFutura,
      entregaFutura,
      ...(entregaFutura ? {
        previsaoEntrega: pedido.previsaoEntrega,
        entregaFuturaSituacao: 'pendente',
        entregaFuturaEntregue: pedido.itens.map(() => 0),
      } : {}),
      // "Com nota / Sem nota" (23/10/2026): o que veio da tela; senao, o do pedido aberto (app).
      ...(typeof pedido.comNotaFiscal === 'boolean'
        ? { comNotaFiscal: pedido.comNotaFiscal }
        : (aberto && typeof aberto.comNotaFiscal === 'boolean' ? { comNotaFiscal: aberto.comNotaFiscal } : {})),
      fechadoPeloServidor: true,
      ...(aberto
        ? {
          createdAt: aberto.createdAt ?? agora(),
          criadoPor: aberto.criadoPor ?? user.uid,
          criadoEm: aberto.criadoEm ?? agora(),
          ...buildDocumentUpdateMetadata(user.uid, agora(), origemDoAberto === 'agente' ? 'Pedido pendente do agente finalizado' : 'Pré-venda finalizada'),
        }
        : { createdAt: agora(), ...buildDocumentMetadata(user.uid, agora()) }),
    };

    // ---------------- ESCRITAS ----------------
    tx.set(pedidoRef, pedidoData);
    // Cada comprovante vale para uma venda so'.
    if (liberacao) tx.delete(liberacao.ref);
    if (identificacao) tx.delete(identificacao.ref);
    if (!pedido.pedidoId) {
      tx.set(refSequencia(tenantId), { tenantId, chave: 'pedidos_venda', valor: proximoNumero, updatedAt: agora() }, { merge: true });
    }
    escritasDeEstoque.forEach(([id, campos]) => tx.update(db.collection('estoque').doc(id), campos));
    escritasDeLote.forEach(([id, campos]) => tx.update(db.collection('estoque_lotes').doc(id), campos));
    // Versao do credito do cliente: uma escrita so' no documento dele -- com
    // cashback usado, vai junto com o resumo do saldo (gravarUso).
    const camposDeCreditoDoCliente = clienteCreditoRef ? { [credito.CAMPO_CREDITO_VERSAO]: creditoVersaoAtual + 1 } : {};
    if (clienteCreditoRef && !usoCashback) {
      tx.update(clienteCreditoRef, { ...camposDeCreditoDoCliente, updatedAt: agora() });
    }
    creditoPorBanco.forEach((delta, bancoId) => {
      tx.update(db.collection('bancos').doc(bancoId), {
        saldoCentavos: (saldoDosBancos.get(bancoId) || 0) + delta,
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), `Crédito da venda ${pdv ? 'PDV ' : ''}#${numeroPedido}`),
      });
    });
    consumos.forEach((c) => {
      tx.update(db.collection('creditos_cliente').doc(c.id), {
        saldoDisponivelCentavos: c.saldoRestanteCentavos,
        saldoDisponivel: fin.fromCents(c.saldoRestanteCentavos),
        status: c.saldoRestanteCentavos <= 0 ? 'esgotado' : 'usado_parcial',
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), `Crédito usado na venda #${numeroPedido}`),
      });
    });
    if (usoCashback) {
      cashback.gravarUso({
        tx, user, tenantId, pedidoId: pedidoRef.id, numeroPedido, clienteNome: pedido.clienteNome, preparado: usoCashback, hoje: hojeDaVenda, maisCamposDoCliente: camposDeCreditoDoCliente,
      });
    }
    pagamentosGravados.forEach((p) => {
      const parcela = p.cartao && p.cartao.numero ? ` (Parcela ${p.cartao.numero}/${p.cartao.totalParcelas})` : '';
      tx.set(db.collection('transacoes').doc(p.transactionId), {
        descricao: `${pdv ? 'PDV' : 'Venda Direta'} #${numeroPedido} - ${p.formaPagamento}${parcela}`,
        categoria: 'Venda de Peças',
        valor: p.valor,
        valorCentavos: p.valorCentavos,
        valorBruto: p.valor,
        valorBrutoCentavos: p.valorCentavos,
        valorTaxa: (p.cartao && p.cartao.valorTaxa) || 0,
        valorTaxaCentavos: (p.cartao && p.cartao.valorTaxaCentavos) || 0,
        valorLiquido: p.cartao && p.cartao.valorLiquido != null ? p.cartao.valorLiquido : p.valor,
        valorLiquidoCentavos: p.cartao && p.cartao.valorLiquidoCentavos != null ? p.cartao.valorLiquidoCentavos : p.valorCentavos,
        tipo: 'entrada',
        formaPagamento: p.formaPagamento,
        condicaoPagamento: p.condicaoPagamento,
        status: p.status === 'confirmado' ? 'Paga' : 'Pendente',
        naturezaFinanceira: p.naturezaFinanceira,
        movimentaCaixaFisico: p.movimentaCaixaFisico,
        bancoId: p.bancoId || null,
        bancoNome: p.bancoNome || null,
        prazoDias: p.prazoDias || null,
        data: p.dataVencimento || pedido.dataVenda,
        dataVencimento: p.dataVencimento || null,
        dataPrevistaRecebimento: p.dataPrevistaRecebimento || null,
        cartao: p.cartao || null,
        pedidoId: pedidoRef.id,
        sourceType: 'pedido_venda',
        sourceId: pedidoRef.id,
        ...(pdv ? { sourceOrigin: 'pdv', pdvSessionId: pedido.pdvSessionId } : {}),
        paymentIndex: p.indice,
        idempotencyKey: `${pdv ? 'pdv' : 'pedido'}:${pedidoRef.id}:pagamento:${p.indice}`,
        clienteId: pedido.clienteId,
        clienteNome: pedido.clienteNome,
        usuarioResponsavelId: user.uid,
        vendedorId,
        tenantId,
        createdAt: agora(),
        ...buildDocumentMetadata(user.uid, agora()),
      });
    });

    return { jaEnviado: false, pedidoId: pedidoRef.id, numeroPedido, vendedorId, vendedorNome, pdv, dePreVenda: Boolean(aberto && aberto.status === STATUS_PRE_VENDA) };
  });

  // Cashback (20/10/2026): venda a vista ja' nasce paga -- gera agora, em
  // transacao propria (idempotente). A prazo, gera na baixa da ultima parcela.
  if (!resultado.jaEnviado) await cashback.gerarSeDevidoSemFalhar({ user, tenantId, pedidoId: resultado.pedidoId });

  // Rota na pre-venda (21/10/2026): a pre-venda faturada entra na rota
  // anotada (modo "ao faturar") ou tem o retrato atualizado na rota em que
  // ja' esta'. So' pre-venda: venda direta de balcao nao vai pra rota sozinha.
  // Entrega futura: quem vai para a rota e' cada ENTREGA (Expedicao > Entregas futuras), nunca o pedido.
  const rota = !resultado.jaEnviado && resultado.dePreVenda && !entregaFutura
    ? await rotaPreVenda.colocarAoFaturarSemFalhar({ user, tenantId, pedidoId: resultado.pedidoId })
    : null;

  return {
    ...resultado,
    ...(rota && rota.acao !== 'desligado' ? { rota } : {}),
    totalCentavos: totais.valorTotalCentavos,
    formaPagamento: resumo.paymentMethodLabel,
    condicaoPagamento: resumo.paymentCondition,
  };
};

module.exports = { ErroVenda, finalizarVenda, temPermissao, situacaoDoCliente, lerColecaoDaEmpresa, percentualDoClienteDaVenda, conferirPrecosNoServidor };
