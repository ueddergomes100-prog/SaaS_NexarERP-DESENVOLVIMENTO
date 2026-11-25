/*
 * DEVOLUCAO DE VENDA PELO ESCRITORIO, NO SERVIDOR (25/11/2026, Embala Minas).
 *
 * Antes a devolucao feita no sistema e o "Confirmar" da que veio do app
 * gravavam pelo navegador. Agora as duas passam por aqui (Admin SDK, empresa
 * e permissoes do token), com:
 *
 *  - item 1: devolucao escolhendo CLIENTE e PRODUTOS. Itens de pedidos
 *    diferentes numa devolucao so': grava UMA devolucao por pedido (cada pedido
 *    fica com a sua, com os itens dele -- o estorno pela tela do pedido continua
 *    igual). Item SEM PEDIDO (comprou antes do sistema): uma devolucao marcada
 *    `semPedido`, preco do cadastro (so' dono e quem tem a permissao propria
 *    alteram), e o valor so' vira credito (decisao do dono).
 *  - item 2: ao confirmar, o destino do valor: credito, dinheiro (caixa),
 *    Pix/transferencia (banco escolhido) ou ABATER das parcelas em aberto do
 *    cliente. Abater = o credito nasce e e' usado na hora, com as mesmas
 *    gravacoes do "abater com credito" do Contas a Receber e os ganchos da
 *    renegociacao (renegociacaoOrigem.js); o que sobrar fica de credito.
 *
 * O que muda em pedido, estoque, lote, comissao e dinheiro vem de
 * src/utils/devolucaoVendaDomain.ts (compilada em server/domain), a mesma
 * regra do app. Transacao: todas as leituras antes de qualquer escrita.
 */
const { admin, db } = require('../config/firebase');
const dv = require('../domain/devolucaoVendaDomain');
const { parseParametrosVenda, checarPrazoDevolucao } = require('../domain/parametrosVendaDomain');
const { getDateInputInTimeZone } = require('../domain/dateTime');
const { buildDocumentMetadata, buildDocumentUpdateMetadata } = require('../domain/documentMetadata');
const { applyPaymentReceipt, legacyPaymentForTransaction, fromCents, toCents } = require('../domain/financeDomain');
const { centavosParaAOrigem } = require('../domain/alteracaoValorTituloDomain');
const { STATUS_RENEGOCIADA } = require('../domain/renegociacaoDomain');
const { temPermissao, camposDoResumoDePagamentos } = require('./baixaFinanceiraRegras');
const { lerRenegociacaoDoTitulo, quitarOrigensSeRenegociacaoPaga } = require('./renegociacaoOrigem');
const { registrarLogNaTransacao } = require('./auditoria');
const cashback = require('./cashback');
const { ErroDevolucaoVenda } = require('./devolucaoVenda');

const agora = () => admin.firestore.FieldValue.serverTimestamp();
const incremento = (n) => admin.firestore.FieldValue.increment(n);
const reais = (valor) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(valor) || 0);
const centavosDoTitulo = (dados) => Number(dados.valorCentavos ?? toCents(Number(dados.valor) || 0));
const FORMA_CREDITO = 'Crédito de Devolução';
const MAXIMO_PARCELAS_NA_LISTA = 60;

const exigir = (user, permissao, mensagem) => {
  if (!temPermissao(user, permissao)) throw new ErroDevolucaoVenda(403, mensagem);
};

const lerConfiguracao = async (tenantId) => {
  const snap = await db.collection('configuracoes').doc(tenantId).get();
  return snap.exists ? snap.data() : {};
};

const devolucoesDoPedido = async (tenantId, pedidoId) => {
  const snap = await db.collection('devolucoes_venda').where('tenantId', '==', tenantId).where('pedidoVendaId', '==', pedidoId).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

const textoDoCliente = (cliente) => String(cliente.nome || '').trim();

// ---------------------------------------------------------------------------
// Janela do destino: parcelas em aberto do cliente e bancos
// ---------------------------------------------------------------------------

/** Parcelas em aberto do cliente (pelo codigo e pelo nome), mais antigas primeiro. */
const parcelasEmAbertoDoCliente = async (tenantId, cliente) => {
  const consultas = [];
  const base = db.collection('transacoes').where('tenantId', '==', tenantId).where('tipo', '==', 'entrada').where('status', '==', 'Pendente');
  if (cliente.id) consultas.push(base.where('clienteId', '==', cliente.id).get());
  if (textoDoCliente(cliente)) consultas.push(base.where('clienteNome', '==', textoDoCliente(cliente)).get());
  const vistos = new Map();
  (await Promise.all(consultas)).forEach((snap) => snap.docs.forEach((d) => vistos.set(d.id, d)));
  return [...vistos.values()]
    .filter((d) => !dv.erroDaParcelaParaAbater(d.data(), cliente))
    .map((d) => {
      const t = d.data();
      return {
        id: d.id,
        descricao: String(t.descricao || ''),
        vencimento: String(t.dataVencimento || t.data || ''),
        centavos: centavosDoTitulo(t),
        formaPagamento: String(t.formaPagamento || ''),
        numeroPedido: String(t.numeroPedido || ''),
      };
    })
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.descricao.localeCompare(b.descricao))
    .slice(0, MAXIMO_PARCELAS_NA_LISTA);
};

/** GET opcoes da janela: o que esta' em aberto do cliente e os bancos ativos. */
const opcoesDoValor = async ({ user, tenantId, clienteId, clienteNome }) => {
  exigir(user, dv.PERMISSAO_DEVOLUCAO, 'Você não tem permissão para fazer devolução de venda. Peça ao administrador para liberar em Usuários.');
  const cliente = { id: String(clienteId || '').trim(), nome: String(clienteNome || '').trim() };
  const [parcelas, bancosSnap] = await Promise.all([
    cliente.id || cliente.nome ? parcelasEmAbertoDoCliente(tenantId, cliente) : Promise.resolve([]),
    db.collection('bancos').where('tenantId', '==', tenantId).where('ativo', '==', true).get(),
  ]);
  return {
    parcelas,
    bancos: bancosSnap.docs.map((d) => ({ id: d.id, nome: String(d.data().nome || '') })),
    podeAbater: temPermissao(user, dv.PERMISSAO_DEVOLUCAO_ABATER),
  };
};

// ---------------------------------------------------------------------------
// Leituras e escritas do dinheiro (credito, caixa, banco, abatimento)
// ---------------------------------------------------------------------------

/** LEITURAS do destino: banco, ou parcelas (com venda/OS de origem e renegociacao). */
const lerDestino = async (tx, { user, tenantId, destino, cliente }) => {
  if (destino.tipo === 'banco') {
    const ref = db.collection('bancos').doc(destino.bancoId);
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().tenantId !== tenantId || snap.data().ativo === false) {
      throw new ErroDevolucaoVenda(400, 'O banco escolhido não foi encontrado (ou está inativo). Escolha outro banco.');
    }
    return { banco: { ref, nome: String(snap.data().nome || ''), saldoCentavos: Number(snap.data().saldoCentavos || 0) }, parcelas: [] };
  }
  if (destino.tipo !== 'abater') return { banco: null, parcelas: [] };
  exigir(user, dv.PERMISSAO_DEVOLUCAO_ABATER, 'Você não tem permissão para abater a devolução das parcelas do cliente. Escolha crédito ou peça ao administrador para liberar em Usuários.');
  const parcelas = [];
  const origens = new Map();
  for (const id of destino.parcelas) {
    const ref = db.collection('transacoes').doc(id);
    const snap = await tx.get(ref);
    const dados = snap.exists && snap.data().tenantId === tenantId ? snap.data() : null;
    if (dados && dados.status === STATUS_RENEGOCIADA) {
      throw new ErroDevolucaoVenda(409, `A parcela "${dados.descricao || ''}" foi renegociada. Abata nas parcelas da renegociação.`);
    }
    const erro = dv.erroDaParcelaParaAbater(dados, cliente);
    if (erro) throw new ErroDevolucaoVenda(409, erro);
    const caminhoOrigem = dados.pedidoId ? `pedidos_venda/${dados.pedidoId}` : (dados.osId ? `ordens_de_servico/${dados.osId}` : '');
    if (caminhoOrigem && !origens.has(caminhoOrigem)) {
      const [colecaoOrigem, idOrigem] = caminhoOrigem.split('/');
      const origemRef = db.collection(colecaoOrigem).doc(String(idOrigem));
      const origemSnap = await tx.get(origemRef);
      const origemDados = origemSnap.exists && origemSnap.data().tenantId === tenantId ? origemSnap.data() : null;
      if (origemDados && origemDados.status === 'Cancelada') {
        throw new ErroDevolucaoVenda(409, `A venda/OS da parcela "${dados.descricao || ''}" está cancelada: não dá para abater nela.`);
      }
      origens.set(caminhoOrigem, origemDados ? { ref: origemRef, dados: { ...origemDados } } : null);
    }
    const renegociacao = await lerRenegociacaoDoTitulo(tx, tenantId, id, dados);
    parcelas.push({ id, ref, dados, caminhoOrigem, renegociacao });
  }
  return { banco: null, parcelas, origens };
};

/**
 * ESCRITAS do abatimento: cada parcela recebe o credito como no Contas a
 * Receber (quita ou fica com o resto em aberto), a venda/OS de origem
 * registra o recebimento, e a renegociacao quitada fecha as vendas antigas.
 * Devolve as vendas que podem ter ficado pagas (cashback, depois).
 */
const gravarAbatimento = (tx, { user, tenantId, leitura, plano, hoje, clienteNome, rotulo }) => {
  const vendasPagas = new Set();
  const quitadas = new Set(plano.usos.filter((u) => u.quita).map((u) => u.id));
  const renegociacoesFechadas = new Set();
  const resumo = [];
  plano.usos.forEach((uso) => {
    const parcela = leitura.parcelas.find((p) => p.id === uso.id);
    const dados = parcela.dados;
    const abertoCentavos = centavosDoTitulo(dados);
    const restaCentavos = abertoCentavos - uso.centavos;
    const reciboRef = uso.quita ? parcela.ref : db.collection('transacoes').doc();
    if (uso.quita) {
      tx.update(parcela.ref, {
        status: 'Paga',
        formaPagamentoOriginal: dados.formaPagamentoOriginal || dados.formaPagamento || null,
        formaPagamento: FORMA_CREDITO,
        naturezaFinanceira: 'credito_cliente',
        movimentaCaixaFisico: false,
        dataPagamento: hoje,
        recebidoEm: agora(),
        observacao: `Pagamento realizado utilizando ${fromCents(uso.centavos).toFixed(2)} em crédito do cliente (${rotulo}).`,
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), `Quitada com crédito de devolução (${rotulo})`),
      });
    } else {
      tx.update(parcela.ref, {
        valorCentavos: restaCentavos,
        valor: fromCents(restaCentavos),
        observacao: `Abatimento de R$ ${fromCents(uso.centavos).toFixed(2)} em crédito (${rotulo}); saldo pendente de R$ ${fromCents(restaCentavos).toFixed(2)}.`,
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), `Abatida parcialmente com crédito de devolução (${rotulo})`),
      });
      tx.set(reciboRef, {
        descricao: `${dados.descricao || 'Parcela'} - Crédito de devolução`,
        categoria: dados.categoria || null,
        valorCentavos: uso.centavos,
        valor: fromCents(uso.centavos),
        tipo: 'entrada',
        status: 'Paga',
        formaPagamento: FORMA_CREDITO,
        naturezaFinanceira: 'credito_cliente',
        movimentaCaixaFisico: false,
        data: hoje,
        dataPagamento: hoje,
        recebidoEm: agora(),
        clienteNome: dados.clienteNome || clienteNome || null,
        ...(dados.clienteId ? { clienteId: dados.clienteId } : {}),
        pedidoId: dados.pedidoId || null,
        osId: dados.osId || null,
        sourcePaymentTransactionId: parcela.id,
        idempotencyKey: `credito:${reciboRef.id}`,
        tenantId,
        createdAt: agora(),
        ...buildDocumentMetadata(user.uid, agora()),
      });
    }
    const origem = parcela.caminhoOrigem ? leitura.origens.get(parcela.caminhoOrigem) : null;
    if (origem) {
      const pagamentos = Array.isArray(origem.dados.pagamentos) && origem.dados.pagamentos.length > 0
        ? origem.dados.pagamentos
        : [legacyPaymentForTransaction(parcela.id, dados)];
      const atualizados = applyPaymentReceipt(pagamentos, {
        transactionId: parcela.id,
        paymentIndex: dados.paymentIndex,
        amountCents: centavosParaAOrigem(pagamentos, {
          transactionId: parcela.id,
          paymentIndex: dados.paymentIndex,
          titulo: dados,
          recebidoCentavos: uso.centavos,
          tituloQuitado: uso.quita,
        }),
        method: FORMA_CREDITO,
        receiptId: reciboRef.id,
        receivedAt: hoje,
      });
      // Duas parcelas da mesma venda: a segunda parte do que a primeira deixou.
      origem.dados.pagamentos = atualizados;
      tx.update(origem.ref, {
        ...camposDoResumoDePagamentos(atualizados),
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), 'Baixa com crédito de devolução'),
      });
      if (uso.quita && origem.ref.parent.id === 'pedidos_venda') vendasPagas.add(origem.ref.id);
    }
    // Parcela de renegociacao quitada: as outras marcadas e quitadas agora contam como pagas.
    const reneg = parcela.renegociacao;
    const idReneg = dados.renegociacao && dados.renegociacao.id;
    if (uso.quita && reneg && idReneg && !renegociacoesFechadas.has(idReneg)) {
      const leituraAjustada = { ...reneg, outras: reneg.outras.map((o) => (quitadas.has(o.id) ? { ...o, status: 'Paga' } : o)) };
      if (quitarOrigensSeRenegociacaoPaga(tx, user, leituraAjustada, hoje)) {
        renegociacoesFechadas.add(idReneg);
        reneg.origens.forEach((o) => { if (o.ref.parent.id === 'pedidos_venda') vendasPagas.add(o.ref.id); });
      }
    }
    resumo.push({ id: parcela.id, descricao: String(dados.descricao || ''), centavos: uso.centavos, quita: uso.quita, restaCentavos: uso.quita ? 0 : restaCentavos });
  });
  return { vendasPagas, resumo };
};

/**
 * ESCRITAS do dinheiro de UMA devolucao: lancamento (caixa/banco) ou credito.
 * `consumidoCentavos` = quanto deste credito o abatimento usou na hora.
 */
const gravarDinheiro = (tx, { user, dinheiro, consumidoCentavos = 0, abatimentos = [] }) => {
  const id = dv.idDoDinheiroDaDevolucao(dinheiro.devolucaoId);
  const lancamento = dv.lancamentoDaDevolucao(dinheiro);
  if (lancamento) {
    tx.set(db.collection('transacoes').doc(id), { ...lancamento, createdAt: agora(), ...buildDocumentMetadata(user.uid, agora()) });
  }
  const credito = dv.creditoDaDevolucao(dinheiro);
  if (credito) {
    const valorCentavos = toCents(dinheiro.valor);
    const saldoCentavos = Math.max(0, valorCentavos - consumidoCentavos);
    tx.set(db.collection('creditos_cliente').doc(id), {
      ...credito,
      saldoDisponivel: fromCents(saldoCentavos),
      saldoDisponivelCentavos: saldoCentavos,
      status: consumidoCentavos <= 0 ? 'disponivel' : (saldoCentavos <= 0 ? 'esgotado' : 'usado_parcial'),
      ...(abatimentos.length > 0 ? { abatimentos } : {}),
      createdAt: agora(),
      updatedAt: agora(),
      ...buildDocumentMetadata(user.uid, agora()),
    });
  }
};

// ---------------------------------------------------------------------------
// Fazer a devolucao no sistema (um ou varios pedidos, e/ou sem pedido)
// ---------------------------------------------------------------------------

const idDoGrupo = (idDocumento, indice) => `${idDocumento}-p${indice + 1}`;
const idSemPedido = (idDocumento) => `${idDocumento}-sp`;

const registrarNoSistema = async ({ user, tenantId, corpo, hoje = getDateInputInTimeZone() }) => {
  exigir(user, dv.PERMISSAO_DEVOLUCAO, 'Você não tem permissão para fazer devolução de venda. Peça ao administrador para liberar em Usuários.');
  const lido = dv.lerDevolucaoDoSistema(corpo);
  if ('erro' in lido) throw new ErroDevolucaoVenda(400, lido.erro);
  if (lido.semPedido.length > 0) {
    exigir(user, dv.PERMISSAO_DEVOLUCAO_SEM_PEDIDO, 'Você não tem permissão para devolução sem pedido. Peça ao administrador para liberar "Devolução sem pedido" em Usuários.');
  }
  const configBruta = await lerConfiguracao(tenantId);
  const parametros = parseParametrosVenda(configBruta.parametrosVenda);
  // Consulta fora da transacao (o que esta' em aguardo); a transacao confere de novo contra o pedido gravado.
  const emAguardoPorPedido = new Map();
  for (const g of lido.pedidos) emAguardoPorPedido.set(g.pedidoId, dv.quantidadesEmAguardo(await devolucoesDoPedido(tenantId, g.pedidoId)));

  const idsDosGrupos = lido.pedidos.map((_, i) => idDoGrupo(lido.idDocumento, i));
  if (lido.semPedido.length > 0) idsDosGrupos.push(idSemPedido(lido.idDocumento));
  const nomeDoUsuario = String(user.nome || user.email || user.uid);
  let resultado = null;
  const depois = { vendasPagas: new Set(), devolucoesComPedido: [] };

  await db.runTransaction(async (tx) => {
    // ---------------- LEITURAS ----------------
    const primeira = await tx.get(db.collection('devolucoes_venda').doc(idsDosGrupos[0]));
    if (primeira.exists) {
      if (primeira.data().tenantId !== tenantId) throw new ErroDevolucaoVenda(409, 'Este envio já foi usado. Abra a tela de devolução de novo.');
      resultado = { jaEnviada: true, devolucoes: idsDosGrupos.map((id) => ({ id })) };
      return;
    }

    let cliente = { id: lido.clienteId, nome: lido.clienteNome };
    if (lido.clienteId) {
      const cSnap = await tx.get(db.collection('clientes').doc(lido.clienteId));
      if (!cSnap.exists || cSnap.data().tenantId !== tenantId) throw new ErroDevolucaoVenda(404, 'O cliente escolhido não foi encontrado nesta empresa. Escolha o cliente de novo.');
      cliente = { id: lido.clienteId, nome: String(cSnap.data().nome || cSnap.data().razaoSocial || lido.clienteNome || '').trim() };
    }

    const grupos = [];
    for (let i = 0; i < lido.pedidos.length; i += 1) {
      const g = lido.pedidos[i];
      const pedidoRef = db.collection('pedidos_venda').doc(g.pedidoId);
      const snap = await tx.get(pedidoRef);
      const pedido = snap.exists && snap.data().tenantId === tenantId ? snap.data() : null;
      const erro = dv.erroDoPedidoParaDevolucao(pedido);
      if (erro || !pedido) throw new ErroDevolucaoVenda(409, erro || 'A venda original não existe mais.');
      const numero = String(pedido.numeroPedido || '');
      if (cliente.id && pedido.clienteId && String(pedido.clienteId) !== cliente.id) {
        throw new ErroDevolucaoVenda(409, `O pedido #${numero} é de outro cliente (${pedido.clienteNome || 'sem nome'}). Escolha só pedidos do cliente da devolução.`);
      }
      if (!cliente.id && !cliente.nome) cliente = { id: String(pedido.clienteId || ''), nome: String(pedido.clienteNome || '') };
      const prazo = checarPrazoDevolucao(parametros, pedido.dataVenda, hoje);
      if (prazo.foraDoPrazo && prazo.acao === 'bloquear') throw new ErroDevolucaoVenda(409, `Pedido #${numero}: ${prazo.mensagem}`);
      const itensDoPedido = Array.isArray(pedido.itens) ? pedido.itens : [];
      const selecao = g.itens.map((s) => {
        const item = itensDoPedido[s.indice];
        if (!item) throw new ErroDevolucaoVenda(409, `Um dos itens não está mais no pedido #${numero}. Abra a devolução de novo.`);
        return { indice: s.indice, id: String(item.id || ''), nome: String(item.nome || ''), quantidade: s.quantidade };
      });
      const montagem = dv.montarItensDevolvidos(itensDoPedido, selecao, emAguardoPorPedido.get(g.pedidoId));
      if (!montagem.ok) throw new ErroDevolucaoVenda(409, `Pedido #${numero}: ${montagem.erro}`);
      const plano = dv.planoDaDevolucao(itensDoPedido, montagem.itensDevolvidos);
      if (!plano.ok) throw new ErroDevolucaoVenda(409, plano.erro);
      grupos.push({ id: idsDosGrupos[i], pedidoRef, pedido, numero, itensDevolvidos: montagem.itensDevolvidos, valor: montagem.valorTotal, plano: plano.plano, foraDoPrazo: prazo.foraDoPrazo });
    }

    let semPedido = null;
    if (lido.semPedido.length > 0) {
      const podeAlterarPreco = temPermissao(user, dv.PERMISSAO_DEVOLUCAO_ALTERAR_PRECO);
      const itens = [];
      for (const s of lido.semPedido) {
        const pSnap = await tx.get(db.collection('estoque').doc(s.produtoId));
        const produto = pSnap.exists && pSnap.data().tenantId === tenantId ? pSnap.data() : null;
        if (!produto) throw new ErroDevolucaoVenda(404, 'Um dos produtos sem pedido não foi encontrado nesta empresa. Escolha de novo.');
        const nome = String(produto.nome || '').trim();
        const precoDoCadastro = Math.round((Number(produto.precoVenda) || 0) * 100) / 100;
        const preco = s.precoUnitario === null ? precoDoCadastro : s.precoUnitario;
        if (Math.abs(preco - precoDoCadastro) > 0.004 && !podeAlterarPreco) {
          throw new ErroDevolucaoVenda(403, `Só o dono e quem tem a permissão "Devolução: alterar o preço" mudam o preço de ${nome}. Use o preço do cadastro (${reais(precoDoCadastro)}) ou peça a liberação.`);
        }
        if (!(preco > 0)) throw new ErroDevolucaoVenda(409, `${nome} está sem preço de venda no cadastro. Informe o preço no Estoque (ou peça a quem pode alterar o preço na devolução).`);
        const fracionado = produto.unidadeMedidaFracionado === true;
        if (!fracionado && !Number.isInteger(s.quantidade)) throw new ErroDevolucaoVenda(400, `${nome}: a quantidade precisa ser inteira (a unidade não aceita fração).`);
        itens.push({ ...dv.itemDevolvidoSemPedido({ id: s.produtoId, nome, unidadeMedidaSigla: produto.unidadeMedidaSigla }, s.quantidade, preco), precoDoCadastro });
      }
      semPedido = {
        id: idSemPedido(lido.idDocumento),
        itensDevolvidos: itens.map(({ precoDoCadastro, ...resto }) => resto),
        precoAlterado: itens.some((i) => Math.abs(i.precoUnitario - i.precoDoCadastro) > 0.004),
        valor: Math.round(itens.reduce((soma, i) => soma + i.subtotal, 0) * 100) / 100,
      };
      if (!(semPedido.valor > 0)) throw new ErroDevolucaoVenda(409, 'O valor dos itens sem pedido ficou zerado. Confira quantidade e preço.');
    }

    // Produtos e lotes que existem (para nao gravar em documento apagado).
    const idsProdutos = new Set();
    grupos.forEach((g) => g.plano.estoqueQueVolta.forEach((p) => idsProdutos.add(p.id)));
    const produtosExistentes = new Set();
    const refsProdutos = [...idsProdutos].map((id) => db.collection('estoque').doc(id));
    (refsProdutos.length ? await tx.getAll(...refsProdutos) : []).forEach((s) => { if (s.exists && s.data().tenantId === tenantId) produtosExistentes.add(s.id); });
    if (semPedido) semPedido.itensDevolvidos.forEach((i) => produtosExistentes.add(i.id));
    const idsLotes = new Set();
    grupos.forEach((g) => g.plano.lotesQueVoltam.forEach((l) => idsLotes.add(l.loteId)));
    const lotesExistentes = new Set();
    const refsLotes = [...idsLotes].map((id) => db.collection('estoque_lotes').doc(id));
    (refsLotes.length ? await tx.getAll(...refsLotes) : []).forEach((s) => { if (s.exists && s.data().tenantId === tenantId) lotesExistentes.add(s.id); });

    const destino = await lerDestino(tx, { user, tenantId, destino: lido.destino, cliente });

    // ---------------- ESCRITAS ----------------
    const destinoGravado = dv.destinoGravadoDoValor(lido.destino);
    const todas = [...grupos, ...(semPedido ? [semPedido] : [])];
    const valorTotalCentavos = todas.reduce((soma, d) => soma + toCents(d.valor), 0);
    const rotulo = todas.length === 1
      ? (grupos[0] ? `devolução do pedido #${grupos[0].numero}` : 'devolução sem pedido')
      : `devolução de ${todas.length} partes`;

    // Abatimento: credito usado na hora, na ordem das devolucoes.
    let abatimento = { vendasPagas: new Set(), resumo: [] };
    let consumoRestante = 0;
    if (lido.destino.tipo === 'abater') {
      const plano = dv.planoDoAbatimento(valorTotalCentavos, destino.parcelas.map((p) => ({ id: p.id, centavos: centavosDoTitulo(p.dados) })));
      if (plano.usos.length === 0) throw new ErroDevolucaoVenda(409, 'As parcelas marcadas não têm valor em aberto. Abra a janela de novo.');
      abatimento = gravarAbatimento(tx, { user, tenantId, leitura: destino, plano, hoje, clienteNome: cliente.nome, rotulo });
      consumoRestante = plano.usos.reduce((soma, u) => soma + u.centavos, 0);
    }
    const resumoDoAbatimento = abatimento.resumo.map((r) => ({ transacaoId: r.id, descricao: r.descricao, centavos: r.centavos, quitou: r.quita }));

    const comuns = {
      clienteNome: cliente.nome,
      motivo: lido.motivo,
      observacao: lido.observacao,
      tenantId,
      usuarioId: user.uid,
      status: dv.STATUS_DEVOLUCAO.concluida,
      origem: dv.ORIGEM_DEVOLUCAO.sistema,
      destino: destinoGravado,
      bancoId: lido.destino.tipo === 'banco' ? lido.destino.bancoId : '',
      bancoNome: destino.banco ? destino.banco.nome : '',
      formaBancaria: lido.destino.tipo === 'banco' ? lido.destino.formaBancaria : '',
      dataSolicitacao: hoje,
    };
    const ligadas = todas.map((d) => d.id);
    const extras = (d) => ({
      ...(cliente.id ? { clienteId: cliente.id } : {}),
      ...(todas.length > 1 ? { grupoDevolucaoId: lido.idDocumento, devolucoesDoGrupo: ligadas } : {}),
      ...(lido.destino.tipo === 'abater' ? { abatidoEmParcelas: true } : {}),
      confirmadaPorId: user.uid,
      confirmadaPorNome: nomeDoUsuario,
      confirmadaEm: agora(),
      createdAt: agora(),
      ...buildDocumentMetadata(user.uid, agora()),
      ...(d.lotes && d.lotes.length > 0 ? { lotesDevolvidos: d.lotes } : {}),
    });

    let saldoDoBanco = destino.banco ? destino.banco.saldoCentavos : 0;
    const consumir = (valor) => {
      const usa = Math.min(toCents(valor), consumoRestante);
      consumoRestante -= usa;
      return usa;
    };
    let abatimentosAindaNaoGravados = resumoDoAbatimento;

    grupos.forEach((g) => {
      const lotes = g.plano.lotesQueVoltam.filter((l) => lotesExistentes.has(l.loteId));
      tx.set(db.collection('devolucoes_venda').doc(g.id), {
        ...dv.camposDaDevolucao({
          ...comuns,
          pedidoId: g.pedidoRef.id,
          numeroPedido: g.numero,
          clienteNome: cliente.nome || String(g.pedido.clienteNome || ''),
          valorTotal: g.valor,
          itensDevolvidos: g.itensDevolvidos,
          devolucaoId: g.id,
          vendedorId: String(g.pedido.vendedorId || ''),
          vendedorNome: String(g.pedido.vendedorNome || ''),
          foraDoPrazo: g.foraDoPrazo,
        }),
        ...extras({ lotes }),
      });
      g.plano.estoqueQueVolta.forEach((p) => {
        if (!produtosExistentes.has(p.id) || !(p.quantidade > 0)) return;
        tx.update(db.collection('estoque').doc(p.id), { quantidade: incremento(p.quantidade), updatedAt: agora() });
      });
      lotes.forEach((l) => {
        if (!(l.quantidade > 0)) return;
        tx.update(db.collection('estoque_lotes').doc(l.loteId), { quantidade: incremento(l.quantidade), updatedAt: agora() });
      });
      const comissao = dv.comissaoAposDevolucao(g.pedido.comissao, g.itensDevolvidos);
      tx.update(g.pedidoRef, {
        itens: g.plano.itensAtualizados,
        ...(comissao ? { comissao } : {}),
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), 'Devolução registrada'),
      });
      gravarDinheiro(tx, {
        user,
        consumidoCentavos: consumir(g.valor),
        abatimentos: abatimentosAindaNaoGravados,
        dinheiro: {
          devolucaoId: g.id,
          pedidoId: g.pedidoRef.id,
          numeroPedido: g.numero,
          clienteNome: cliente.nome || String(g.pedido.clienteNome || ''),
          clienteId: cliente.id || g.pedido.clienteId,
          valor: g.valor,
          destino: destinoGravado,
          formaBancaria: comuns.formaBancaria,
          bancoId: comuns.bancoId,
          bancoNome: comuns.bancoNome,
          motivo: lido.motivo,
          tenantId,
          hoje,
        },
      });
      abatimentosAindaNaoGravados = [];
      if (destino.banco) saldoDoBanco = dv.saldoDoBancoAposDevolucao(saldoDoBanco, g.valor);
      depois.devolucoesComPedido.push(g.id);
      registrarLogNaTransacao(tx, { ...user, tenantId }, {
        modulo: 'vendas',
        acao: 'devolucao',
        descricao: `Devolução concluída para o pedido #${g.numero}: ${reais(g.valor)} (${lido.destino.tipo === 'abater' ? dv.ROTULO_ABATIMENTO : dv.ROTULO_DESTINO_DEVOLUCAO[destinoGravado]}${destino.banco ? ` ${destino.banco.nome}` : ''}). Itens: ${g.itensDevolvidos.map((i) => `${i.quantidadeDevolvida.toLocaleString('pt-BR')}x ${i.nome}`).join(', ')}.`,
        registroId: g.id,
        documentosRelacionados: [g.pedidoRef.id],
        documentoTipo: 'devolucao',
        documentoNumero: `Devolução do Pedido ${g.numero}`,
        motivo: lido.motivo,
        vendedorId: String(g.pedido.vendedorId || ''),
        vendedorNome: String(g.pedido.vendedorNome || ''),
        critico: true,
      });
    });

    if (semPedido) {
      tx.set(db.collection('devolucoes_venda').doc(semPedido.id), {
        ...dv.camposDaDevolucao({
          ...comuns,
          pedidoId: '',
          numeroPedido: '',
          valorTotal: semPedido.valor,
          itensDevolvidos: semPedido.itensDevolvidos,
          devolucaoId: semPedido.id,
        }),
        semPedido: true,
        ...(semPedido.precoAlterado ? { precoAlteradoPorId: user.uid, precoAlteradoPorNome: nomeDoUsuario } : {}),
        ...extras({}),
      });
      semPedido.itensDevolvidos.forEach((i) => {
        if (!(i.quantidadeDevolvida > 0)) return;
        tx.update(db.collection('estoque').doc(i.id), { quantidade: incremento(i.quantidadeDevolvida), updatedAt: agora() });
      });
      gravarDinheiro(tx, {
        user,
        consumidoCentavos: consumir(semPedido.valor),
        abatimentos: abatimentosAindaNaoGravados,
        dinheiro: {
          devolucaoId: semPedido.id,
          pedidoId: '',
          numeroPedido: '',
          clienteNome: cliente.nome,
          clienteId: cliente.id,
          valor: semPedido.valor,
          destino: 'credito',
          motivo: lido.motivo,
          tenantId,
          hoje,
        },
      });
      registrarLogNaTransacao(tx, { ...user, tenantId }, {
        modulo: 'vendas',
        acao: 'devolucao',
        descricao: `Devolução SEM PEDIDO (compra de antes do sistema) do cliente ${cliente.nome}: ${reais(semPedido.valor)} em crédito, pelo preço ${semPedido.precoAlterado ? 'ALTERADO na devolução' : 'do cadastro'}. Itens: ${semPedido.itensDevolvidos.map((i) => `${i.quantidadeDevolvida.toLocaleString('pt-BR')}x ${i.nome} a ${reais(i.precoUnitario)}`).join(', ')}.`,
        registroId: semPedido.id,
        documentoTipo: 'devolucao',
        documentoNumero: `Devolução sem pedido — ${cliente.nome}`,
        motivo: lido.motivo,
        critico: true,
      });
    }

    if (destino.banco) {
      tx.update(destino.banco.ref, {
        saldoCentavos: saldoDoBanco,
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), `Devolução de venda (${rotulo})`),
      });
    }

    abatimento.vendasPagas.forEach((id) => depois.vendasPagas.add(id));
    resultado = {
      jaEnviada: false,
      clienteNome: cliente.nome,
      valorTotal: fromCents(valorTotalCentavos),
      destino: lido.destino.tipo,
      bancoNome: destino.banco ? destino.banco.nome : '',
      abatimento: abatimento.resumo,
      sobraDeCreditoCentavos: lido.destino.tipo === 'abater' ? valorTotalCentavos - abatimento.resumo.reduce((s, r) => s + r.centavos, 0) : 0,
      devolucoes: [
        ...grupos.map((g) => ({ id: g.id, pedidoId: g.pedidoRef.id, numeroPedido: g.numero, valor: g.valor })),
        ...(semPedido ? [{ id: semPedido.id, pedidoId: '', numeroPedido: '', valor: semPedido.valor, semPedido: true }] : []),
      ],
    };
  });

  if (resultado && !resultado.jaEnviada) {
    // Cashback (20/10/2026): devolvido volta proporcional; venda quitada pelo abatimento pode gerar. Falha aqui nao desfaz nada.
    for (const id of depois.devolucoesComPedido) {
      try { await cashback.estornarDevolucao({ user, tenantId, devolucaoId: id }); } catch (erro) { console.error('[Devolucao] cashback:', erro && erro.message); }
    }
    for (const pedidoId of depois.vendasPagas) await cashback.gerarSeDevidoSemFalhar({ user, tenantId, pedidoId });
  }
  return resultado;
};

// ---------------------------------------------------------------------------
// Confirmar a devolucao que o app pediu, escolhendo o destino do valor
// ---------------------------------------------------------------------------

const confirmarDoApp = async ({ user, tenantId, devolucaoId, corpo, hoje = getDateInputInTimeZone() }) => {
  exigir(user, dv.PERMISSAO_DEVOLUCAO, 'Você não tem permissão para confirmar devolução de venda. Peça ao administrador para liberar em Usuários.');
  const id = String(devolucaoId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new ErroDevolucaoVenda(400, 'Devolução inválida. Atualize a lista.');
  const destinoLido = dv.lerDestinoDoValor(corpo && corpo.destino);
  if ('erro' in destinoLido) throw new ErroDevolucaoVenda(400, destinoLido.erro);
  const ref = db.collection('devolucoes_venda').doc(id);
  const nomeDoUsuario = String(user.nome || user.email || user.uid);
  let resultado = null;
  const depois = { vendasPagas: new Set() };

  await db.runTransaction(async (tx) => {
    // ---------------- LEITURAS ----------------
    const snap = await tx.get(ref);
    const pendente = snap.exists && snap.data().tenantId === tenantId ? snap.data() : null;
    const erro = dv.erroParaDecidirDevolucao(pendente, 'confirmar');
    if (erro || !pendente) throw new ErroDevolucaoVenda(409, erro || 'Esta devolução não existe mais. Atualize a lista.');
    const pedidoRef = db.collection('pedidos_venda').doc(String(pendente.pedidoVendaId || ''));
    const pSnap = await tx.get(pedidoRef);
    const pedido = pSnap.exists && pSnap.data().tenantId === tenantId ? pSnap.data() : null;
    const erroPedido = dv.erroDoPedidoParaDevolucao(pedido);
    if (erroPedido || !pedido) throw new ErroDevolucaoVenda(409, erroPedido || 'A venda original não existe mais.');
    const itensDevolvidos = Array.isArray(pendente.itensDevolvidos) ? pendente.itensDevolvidos : [];
    const plano = dv.planoDaDevolucao(pedido.itens, itensDevolvidos);
    if (!plano.ok) throw new ErroDevolucaoVenda(409, plano.erro);
    const refsProdutos = plano.plano.estoqueQueVolta.map((p) => db.collection('estoque').doc(p.id));
    const produtosExistentes = new Set((refsProdutos.length ? await tx.getAll(...refsProdutos) : []).filter((s) => s.exists && s.data().tenantId === tenantId).map((s) => s.id));
    const refsLotes = plano.plano.lotesQueVoltam.map((l) => db.collection('estoque_lotes').doc(l.loteId));
    const lotesExistentes = new Set((refsLotes.length ? await tx.getAll(...refsLotes) : []).filter((s) => s.exists && s.data().tenantId === tenantId).map((s) => s.id));
    const cliente = { id: String(pedido.clienteId || ''), nome: String(pendente.clienteNome || pedido.clienteNome || '') };
    const destino = await lerDestino(tx, { user, tenantId, destino: destinoLido, cliente });

    // ---------------- ESCRITAS ----------------
    const valor = Number(pendente.valorTotalDevolvido || 0);
    const numero = String(pendente.numeroPedidoOriginal || pedido.numeroPedido || '');
    const destinoGravado = dv.destinoGravadoDoValor(destinoLido);
    const rotulo = `devolução do pedido #${numero}`;
    let abatimento = { vendasPagas: new Set(), resumo: [] };
    let consumido = 0;
    if (destinoLido.tipo === 'abater') {
      const planoAb = dv.planoDoAbatimento(toCents(valor), destino.parcelas.map((p) => ({ id: p.id, centavos: centavosDoTitulo(p.dados) })));
      if (planoAb.usos.length === 0) throw new ErroDevolucaoVenda(409, 'As parcelas marcadas não têm valor em aberto. Abra a janela de novo.');
      abatimento = gravarAbatimento(tx, { user, tenantId, leitura: destino, plano: planoAb, hoje, clienteNome: cliente.nome, rotulo });
      consumido = planoAb.usos.reduce((s, u) => s + u.centavos, 0);
    }
    const lotes = plano.plano.lotesQueVoltam.filter((l) => lotesExistentes.has(l.loteId));
    plano.plano.estoqueQueVolta.forEach((p) => {
      if (!produtosExistentes.has(p.id) || !(p.quantidade > 0)) return;
      tx.update(db.collection('estoque').doc(p.id), { quantidade: incremento(p.quantidade), updatedAt: agora() });
    });
    lotes.forEach((l) => {
      if (!(l.quantidade > 0)) return;
      tx.update(db.collection('estoque_lotes').doc(l.loteId), { quantidade: incremento(l.quantidade), updatedAt: agora() });
    });
    const comissao = dv.comissaoAposDevolucao(pedido.comissao, itensDevolvidos);
    tx.update(pedidoRef, {
      itens: plano.plano.itensAtualizados,
      ...(comissao ? { comissao } : {}),
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), 'Devolução registrada'),
    });
    const bancoNome = destino.banco ? destino.banco.nome : '';
    const sugerido = dv.destinoDaDevolucao(pendente.destinoValor);
    tx.update(ref, {
      status: dv.STATUS_DEVOLUCAO.concluida,
      destinoValor: destinoGravado,
      ...(destinoGravado !== sugerido || pendente.destinoDoVendedor === false ? { destinoPedidoPeloApp: sugerido } : {}),
      ...(destinoLido.tipo === 'banco'
        ? { bancoId: destinoLido.bancoId, bancoNome, formaDevolucao: destinoLido.formaBancaria }
        : { bancoId: admin.firestore.FieldValue.delete(), bancoNome: admin.firestore.FieldValue.delete(), formaDevolucao: admin.firestore.FieldValue.delete() }),
      ...(destinoLido.tipo === 'abater' ? { abatidoEmParcelas: true } : {}),
      confirmadaPorId: user.uid,
      confirmadaPorNome: nomeDoUsuario,
      confirmadaEm: agora(),
      ...(lotes.length > 0 ? { lotesDevolvidos: lotes } : {}),
      ...buildDocumentUpdateMetadata(user.uid, agora(), 'Devolução confirmada'),
    });
    gravarDinheiro(tx, {
      user,
      consumidoCentavos: consumido,
      abatimentos: abatimento.resumo.map((r) => ({ transacaoId: r.id, descricao: r.descricao, centavos: r.centavos, quitou: r.quita })),
      dinheiro: {
        devolucaoId: id,
        pedidoId: pedidoRef.id,
        numeroPedido: numero,
        clienteNome: cliente.nome,
        clienteId: pedido.clienteId,
        valor,
        destino: destinoGravado,
        formaBancaria: destinoLido.tipo === 'banco' ? destinoLido.formaBancaria : '',
        bancoId: destinoLido.tipo === 'banco' ? destinoLido.bancoId : '',
        bancoNome,
        motivo: String(pendente.motivo || ''),
        tenantId,
        hoje,
      },
    });
    if (destino.banco) {
      tx.update(destino.banco.ref, {
        saldoCentavos: dv.saldoDoBancoAposDevolucao(destino.banco.saldoCentavos, valor),
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), `Devolução do pedido #${numero}`),
      });
    }
    registrarLogNaTransacao(tx, { ...user, tenantId }, {
      modulo: 'vendas',
      acao: 'devolucao_confirmada',
      descricao: `Devolução pedida pelo aplicativo CONFIRMADA para o pedido #${numero}: ${reais(valor)} (${destinoLido.tipo === 'abater' ? dv.ROTULO_ABATIMENTO : dv.ROTULO_DESTINO_DEVOLUCAO[destinoGravado]}${bancoNome ? ` ${bancoNome}` : ''}).`,
      registroId: id,
      documentosRelacionados: [pedidoRef.id],
      documentoTipo: 'devolucao',
      documentoNumero: `Devolução do Pedido ${numero}`,
      motivo: String(pendente.motivo || ''),
      vendedorId: String(pendente.vendedorId || ''),
      vendedorNome: String(pendente.vendedorNome || ''),
      alteracoes: [{ campo: 'Situação', valorAnterior: 'Aguardando confirmação', valorNovo: 'Confirmada' }],
      critico: true,
    });
    abatimento.vendasPagas.forEach((v) => depois.vendasPagas.add(v));
    resultado = {
      devolucaoId: id,
      pedidoId: pedidoRef.id,
      numeroPedido: numero,
      valorTotal: valor,
      destino: destinoLido.tipo,
      bancoNome,
      abatimento: abatimento.resumo,
      sobraDeCreditoCentavos: destinoLido.tipo === 'abater' ? toCents(valor) - consumido : 0,
    };
  });

  try { await cashback.estornarDevolucao({ user, tenantId, devolucaoId: id }); } catch (erro) { console.error('[Devolucao] cashback:', erro && erro.message); }
  for (const pedidoId of depois.vendasPagas) await cashback.gerarSeDevidoSemFalhar({ user, tenantId, pedidoId });
  return resultado;
};

// ---------------------------------------------------------------------------
// Devolucao escolhendo cliente e produtos: os pedidos do cliente que tem cada produto
// ---------------------------------------------------------------------------

const LIMITE_PEDIDOS_DO_CLIENTE = 300;

/**
 * Pedidos faturados do cliente que tem os produtos escolhidos, com o que ainda
 * da' para devolver de cada linha. Mais novos primeiro.
 */
const pedidosDoClienteComProdutos = async ({ user, tenantId, clienteId, produtoIds }) => {
  exigir(user, dv.PERMISSAO_DEVOLUCAO, 'Você não tem permissão para fazer devolução de venda. Peça ao administrador para liberar em Usuários.');
  const id = String(clienteId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new ErroDevolucaoVenda(400, 'Escolha o cliente da devolução.');
  const produtos = [...new Set((Array.isArray(produtoIds) ? produtoIds : []).map((p) => String(p || '').trim()).filter((p) => /^[A-Za-z0-9_-]{1,64}$/.test(p)))].slice(0, 50);
  if (produtos.length === 0) throw new ErroDevolucaoVenda(400, 'Escolha pelo menos um produto.');
  const snap = await db.collection('pedidos_venda').where('tenantId', '==', tenantId).where('clienteId', '==', id).get();
  const candidatos = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((p) => !dv.erroDoPedidoParaDevolucao(p) && p.status === 'Finalizada')
    .filter((p) => (Array.isArray(p.itens) ? p.itens : []).some((i) => produtos.includes(String(i.id || ''))))
    .sort((a, b) => String(b.dataVenda || '').localeCompare(String(a.dataVenda || '')) || String(b.numeroPedido || '').localeCompare(String(a.numeroPedido || '')))
    .slice(0, LIMITE_PEDIDOS_DO_CLIENTE);
  const pedidos = [];
  for (const p of candidatos) {
    const emAguardo = dv.quantidadesEmAguardo(await devolucoesDoPedido(tenantId, p.id));
    const linhas = (Array.isArray(p.itens) ? p.itens : [])
      .map((item, indice) => ({ item, indice }))
      .filter(({ item }) => produtos.includes(String(item.id || '')))
      .map(({ item, indice }) => ({
        indice,
        produtoId: String(item.id || ''),
        nome: String(item.nome || ''),
        quantidade: Number(item.quantidade || 0),
        disponivel: dv.disponivelParaDevolver(item, emAguardo.get(indice) || 0),
        precoUnitario: Number(item.precoUnitario || 0),
        desconto: Number(item.desconto || 0),
        unidadeMedidaSigla: String(item.unidadeMedidaSigla || 'UN'),
        fracionado: item.unidadeMedidaFracionado === true,
      }))
      .filter((l) => l.disponivel > 0);
    if (linhas.length === 0) continue;
    pedidos.push({ id: p.id, numeroPedido: String(p.numeroPedido || ''), dataVenda: String(p.dataVenda || ''), linhas });
  }
  return { pedidos };
};

module.exports = {
  opcoesDoValor,
  registrarNoSistema,
  confirmarDoApp,
  pedidosDoClienteComProdutos,
  // testes
  _parcelasEmAbertoDoCliente: parcelasEmAbertoDoCliente,
};
