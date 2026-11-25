/*
 * DEVOLUCAO DE VENDA PELO APP VENDAS (24/11/2026).
 *
 * O vendedor externo pede, pelo app, a devolucao de itens de um pedido QUE ELE
 * MESMO fez no app e que a loja ja' faturou. O app nunca grava em
 * `devolucoes_venda`, estoque ou dinheiro: tudo passa por aqui, com o Admin SDK,
 * e o tenant sai do token de quem chamou ("nada altera via DevTools").
 *
 *  - Padrao: a devolucao nasce "Aguardando confirmacao" e nada mexe; o
 *    escritorio confirma (mesmo codigo da devolucao feita no sistema --
 *    src/services/devolucaoVendaService.ts) ou recusa, na tela de Devolucoes.
 *  - Filial com "Devolucao do aplicativo ja' entra confirmada": a devolucao
 *    vale na hora, com o MESMO efeito, montado pela mesma regra
 *    (src/utils/devolucaoVendaDomain.ts, compilada em server/domain).
 *
 * Transacao: todas as leituras antes de qualquer escrita.
 */
const { admin, db } = require('../config/firebase');
const dv = require('../domain/devolucaoVendaDomain');
const { parseParametrosVenda, checarPrazoDevolucao } = require('../domain/parametrosVendaDomain');
const { getDateInputInTimeZone } = require('../domain/dateTime');
const { buildDocumentMetadata, buildDocumentUpdateMetadata } = require('../domain/documentMetadata');
const { registrarLogNaTransacao } = require('./auditoria');
const cashback = require('./cashback');

class ErroDevolucaoVenda extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const agora = () => admin.firestore.FieldValue.serverTimestamp();
const incremento = (n) => admin.firestore.FieldValue.increment(n);
const reais = (valor) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(valor) || 0);

const MENSAGEM_DESLIGADA = 'A devolução pelo aplicativo está desligada nesta empresa. Peça ao escritório para ligar em Configurações ou para fazer a devolução pelo sistema.';

const lerConfiguracao = async (tenantId) => {
  const snap = await db.collection('configuracoes').doc(tenantId).get();
  return snap.exists ? snap.data() : {};
};

const devolucoesDoPedido = async (tenantId, pedidoId) => {
  const snap = await db.collection('devolucoes_venda').where('tenantId', '==', tenantId).where('pedidoVendaId', '==', pedidoId).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

const millis = (v) => {
  if (!v) return null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  const s = v.seconds ?? v._seconds;
  return typeof s === 'number' ? s * 1000 : null;
};

const statusDoErroDoPedido = (pedido) => (pedido ? 409 : 404);

// ---------------------------------------------------------------------------
// Tela do app: o que da' para devolver
// ---------------------------------------------------------------------------

const dadosParaDevolver = async ({ user, tenantId, pedidoId, hoje = getDateInputInTimeZone() }) => {
  const id = String(pedidoId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new ErroDevolucaoVenda(400, 'Pedido não informado. Abra o pedido de novo.');
  const configBruta = await lerConfiguracao(tenantId);
  if (!dv.parseConfigDevolucaoApp(configBruta).permitida) throw new ErroDevolucaoVenda(403, MENSAGEM_DESLIGADA);

  const pedidoSnap = await db.collection('pedidos_venda').doc(id).get();
  const pedido = pedidoSnap.exists && pedidoSnap.data().tenantId === tenantId ? pedidoSnap.data() : null;
  const erro = dv.erroParaDevolverPeloApp(id, pedido, user.uid);
  if (erro) throw new ErroDevolucaoVenda(statusDoErroDoPedido(pedido), erro);

  const emAguardo = dv.quantidadesEmAguardo(await devolucoesDoPedido(tenantId, id));
  const itens = (Array.isArray(pedido.itens) ? pedido.itens : []).map((item, indice) => ({
    indice,
    id: String(item.id || ''),
    nome: String(item.nome || ''),
    quantidade: Number(item.quantidade || 0),
    quantidadeJaDevolvida: Number(item.quantidadeJaDevolvida || 0),
    emAguardo: emAguardo.get(indice) || 0,
    disponivel: dv.disponivelParaDevolver(item, emAguardo.get(indice) || 0),
    precoUnitario: Number(item.precoUnitario || 0),
    desconto: Number(item.desconto || 0),
    unidadeMedidaSigla: String(item.unidadeMedidaSigla || 'UN'),
    fracionado: item.unidadeMedidaFracionado === true,
  }));
  const bancosSnap = await db.collection('bancos').where('tenantId', '==', tenantId).where('ativo', '==', true).get();
  const prazo = checarPrazoDevolucao(parseParametrosVenda(configBruta.parametrosVenda), pedido.dataVenda, hoje);
  return {
    pedido: { id, numeroPedido: String(pedido.numeroPedido || ''), clienteNome: String(pedido.clienteNome || ''), dataVenda: String(pedido.dataVenda || '') },
    itens,
    bancos: bancosSnap.docs.map((d) => ({ id: d.id, nome: String(d.data().nome || '') })),
    motivos: [...dv.MOTIVOS_DEVOLUCAO],
    formasBancarias: [...dv.FORMAS_BANCARIAS_DEVOLUCAO],
    jaConfirmada: dv.parseConfigDevolucaoApp(configBruta).jaConfirmada,
    prazo: { foraDoPrazo: prazo.foraDoPrazo, acao: prazo.acao, mensagem: prazo.mensagem },
  };
};

// ---------------------------------------------------------------------------
// Efeito da devolucao (filial com "ja' entra confirmada")
// ---------------------------------------------------------------------------

/** LEITURAS do efeito: produtos e lotes que existem nesta empresa. */
const lerParaEfeito = async (tx, tenantId, pedido, itensDevolvidos) => {
  const montagem = dv.planoDaDevolucao(pedido.itens, itensDevolvidos);
  if (!montagem.ok) throw new ErroDevolucaoVenda(409, montagem.erro);
  const { plano } = montagem;
  const produtoRefs = plano.estoqueQueVolta.map((p) => db.collection('estoque').doc(p.id));
  const produtosExistentes = new Set((produtoRefs.length ? await tx.getAll(...produtoRefs) : [])
    .filter((s) => s.exists && s.data().tenantId === tenantId).map((s) => s.id));
  const loteRefs = plano.lotesQueVoltam.map((l) => db.collection('estoque_lotes').doc(l.loteId));
  const lotesExistentes = new Set((loteRefs.length ? await tx.getAll(...loteRefs) : [])
    .filter((s) => s.exists && s.data().tenantId === tenantId).map((s) => s.id));
  return { plano, produtosExistentes, lotesQueVoltam: plano.lotesQueVoltam.filter((l) => lotesExistentes.has(l.loteId)) };
};

/** ESCRITAS do efeito: as mesmas da devolucao feita no sistema. */
const gravarEfeito = (tx, { user, tenantId, pedidoRef, pedido, efeito, dinheiro, banco }) => {
  efeito.plano.estoqueQueVolta.forEach((p) => {
    if (!efeito.produtosExistentes.has(p.id) || !(p.quantidade > 0)) return;
    tx.update(db.collection('estoque').doc(p.id), { quantidade: incremento(p.quantidade), updatedAt: agora() });
  });
  efeito.lotesQueVoltam.forEach((l) => {
    if (!(l.quantidade > 0)) return;
    tx.update(db.collection('estoque_lotes').doc(l.loteId), { quantidade: incremento(l.quantidade), updatedAt: agora() });
  });
  const comissao = dv.comissaoAposDevolucao(pedido.comissao, dinheiro.itensDevolvidos);
  tx.update(pedidoRef, {
    itens: efeito.plano.itensAtualizados,
    ...(comissao ? { comissao } : {}),
    updatedAt: agora(),
    ...buildDocumentUpdateMetadata(user.uid, agora(), 'Devolução registrada'),
  });
  const lancamento = dv.lancamentoDaDevolucao(dinheiro);
  const credito = dv.creditoDaDevolucao(dinheiro);
  const idDinheiro = dv.idDoDinheiroDaDevolucao(dinheiro.devolucaoId);
  if (lancamento) {
    tx.set(db.collection('transacoes').doc(idDinheiro), { ...lancamento, createdAt: agora(), ...buildDocumentMetadata(user.uid, agora()) });
  }
  if (banco) {
    tx.update(banco.ref, {
      saldoCentavos: dv.saldoDoBancoAposDevolucao(banco.saldoCentavos, dinheiro.valor),
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), `Devolução do pedido #${dinheiro.numeroPedido}`),
    });
  }
  if (credito) {
    tx.set(db.collection('creditos_cliente').doc(idDinheiro), {
      ...credito, createdAt: agora(), updatedAt: agora(), ...buildDocumentMetadata(user.uid, agora()),
    });
  }
};

// ---------------------------------------------------------------------------
// Vendedor: pedir a devolucao
// ---------------------------------------------------------------------------

const solicitarPeloApp = async ({ user, tenantId, corpo, hoje = getDateInputInTimeZone() }) => {
  const lido = dv.lerPedidoDeDevolucaoDoApp(corpo);
  if ('erro' in lido) throw new ErroDevolucaoVenda(400, lido.erro);
  const configBruta = await lerConfiguracao(tenantId);
  const config = dv.parseConfigDevolucaoApp(configBruta);
  if (!config.permitida) throw new ErroDevolucaoVenda(403, MENSAGEM_DESLIGADA);

  const colecao = db.collection('devolucoes_venda');
  const ref = lido.idDocumento ? colecao.doc(lido.idDocumento) : colecao.doc();
  // Consulta fora da transacao (o SDK nao faz consulta dentro dela de forma
  // portavel): o que esta' em aguardo. A confirmacao confere de novo contra o
  // pedido gravado, entao duas pedidas ao mesmo tempo nunca devolvem demais.
  const emAguardo = dv.quantidadesEmAguardo(await devolucoesDoPedido(tenantId, lido.pedidoId), ref.id);
  const nome = String(user.nome || user.email || user.uid);
  const status = config.jaConfirmada ? dv.STATUS_DEVOLUCAO.concluida : dv.STATUS_DEVOLUCAO.aguardando;
  let resultado = null;

  await db.runTransaction(async (tx) => {
    // ---------------- LEITURAS ----------------
    const existente = await tx.get(ref);
    if (existente.exists) {
      const e = existente.data();
      if (e.tenantId !== tenantId || e.solicitadoPorId !== user.uid) throw new ErroDevolucaoVenda(409, 'Este envio já foi usado. Abra a tela de devolução de novo e reenvie.');
      resultado = { id: ref.id, jaEnviada: true, status: dv.situacaoDaDevolucao(e), numeroPedido: String(e.numeroPedidoOriginal || ''), valorTotal: Number(e.valorTotalDevolvido || 0) };
      return;
    }
    const pedidoRef = db.collection('pedidos_venda').doc(lido.pedidoId);
    const pedidoSnap = await tx.get(pedidoRef);
    const pedido = pedidoSnap.exists && pedidoSnap.data().tenantId === tenantId ? pedidoSnap.data() : null;
    const erroPedido = dv.erroParaDevolverPeloApp(lido.pedidoId, pedido, user.uid);
    if (erroPedido) throw new ErroDevolucaoVenda(statusDoErroDoPedido(pedido), erroPedido);

    const prazo = checarPrazoDevolucao(parseParametrosVenda(configBruta.parametrosVenda), pedido.dataVenda, hoje);
    if (prazo.foraDoPrazo && prazo.acao === 'bloquear') throw new ErroDevolucaoVenda(409, prazo.mensagem);

    const itensDoPedido = Array.isArray(pedido.itens) ? pedido.itens : [];
    const selecao = lido.itens.map((s) => {
      const item = itensDoPedido[s.indice];
      if (!item) throw new ErroDevolucaoVenda(409, 'Um dos itens não está mais neste pedido. Abra o pedido de novo.');
      return { indice: s.indice, id: String(item.id || ''), nome: String(item.nome || ''), quantidade: s.quantidade };
    });
    const montagem = dv.montarItensDevolvidos(itensDoPedido, selecao, emAguardo);
    if (!montagem.ok) throw new ErroDevolucaoVenda(409, montagem.erro);

    let banco = null;
    if (lido.destino === 'banco') {
      const bancoRef = db.collection('bancos').doc(lido.bancoId);
      const bancoSnap = await tx.get(bancoRef);
      if (!bancoSnap.exists || bancoSnap.data().tenantId !== tenantId || bancoSnap.data().ativo === false) {
        throw new ErroDevolucaoVenda(400, 'O banco escolhido não foi encontrado (ou está inativo). Escolha outro banco.');
      }
      banco = { ref: bancoRef, nome: String(bancoSnap.data().nome || ''), saldoCentavos: Number(bancoSnap.data().saldoCentavos || 0) };
    }
    const efeito = config.jaConfirmada ? await lerParaEfeito(tx, tenantId, pedido, montagem.itensDevolvidos) : null;

    // ---------------- ESCRITAS ----------------
    const numeroPedido = String(pedido.numeroPedido || '');
    const clienteNome = String(pedido.clienteNome || '');
    tx.set(ref, {
      ...dv.camposDaDevolucao({
        pedidoId: lido.pedidoId,
        numeroPedido,
        clienteNome,
        valorTotal: montagem.valorTotal,
        destino: lido.destino,
        bancoId: lido.bancoId,
        bancoNome: banco ? banco.nome : '',
        formaBancaria: lido.formaBancaria,
        motivo: lido.motivo,
        observacao: lido.observacao,
        tenantId,
        usuarioId: user.uid,
        itensDevolvidos: montagem.itensDevolvidos,
        status,
        origem: dv.ORIGEM_DEVOLUCAO.app,
        devolucaoId: ref.id,
        vendedorId: String(pedido.vendedorId || ''),
        vendedorNome: String(pedido.vendedorNome || ''),
        solicitadoPorId: user.uid,
        solicitadoPorNome: nome,
        dataSolicitacao: hoje,
        foraDoPrazo: prazo.foraDoPrazo,
      }),
      ...(efeito ? {
        confirmadaAutomaticamente: true,
        confirmadaPorId: user.uid,
        confirmadaPorNome: nome,
        confirmadaEm: agora(),
        ...(efeito.lotesQueVoltam.length > 0 ? { lotesDevolvidos: efeito.lotesQueVoltam } : {}),
      } : {}),
      createdAt: agora(),
      ...buildDocumentMetadata(user.uid, agora()),
    });

    if (efeito) {
      gravarEfeito(tx, {
        user,
        tenantId,
        pedidoRef,
        pedido,
        efeito,
        banco,
        dinheiro: {
          devolucaoId: ref.id,
          pedidoId: lido.pedidoId,
          numeroPedido,
          clienteNome,
          clienteId: pedido.clienteId,
          valor: montagem.valorTotal,
          destino: lido.destino,
          formaBancaria: lido.formaBancaria,
          bancoId: lido.bancoId,
          bancoNome: banco ? banco.nome : '',
          motivo: lido.motivo,
          tenantId,
          hoje,
          itensDevolvidos: montagem.itensDevolvidos,
        },
      });
    }

    const destinoTexto = dv.ROTULO_DESTINO_DEVOLUCAO[lido.destino] + (banco ? ` ${banco.nome}` : '');
    const itensTexto = montagem.itensDevolvidos.map((i) => `${i.quantidadeDevolvida.toLocaleString('pt-BR')}x ${i.nome}`).join(', ');
    registrarLogNaTransacao(tx, { ...user, tenantId }, {
      modulo: 'vendas',
      acao: efeito ? 'devolucao' : 'devolucao_solicitada',
      descricao: efeito
        ? `Devolução feita pelo aplicativo Vendas para o pedido #${numeroPedido}, já confirmada (configuração da filial): ${reais(montagem.valorTotal)} (${destinoTexto}). Itens: ${itensTexto}.`
        : `Devolução pedida pelo aplicativo Vendas para o pedido #${numeroPedido}: ${reais(montagem.valorTotal)} (${destinoTexto}). Itens: ${itensTexto}. Aguardando confirmação do escritório.`,
      registroId: ref.id,
      documentosRelacionados: [lido.pedidoId],
      documentoTipo: 'devolucao',
      documentoNumero: `Devolução do Pedido ${numeroPedido}`,
      motivo: lido.motivo,
      vendedorId: String(pedido.vendedorId || ''),
      vendedorNome: String(pedido.vendedorNome || ''),
      critico: Boolean(efeito),
    });

    resultado = { id: ref.id, jaEnviada: false, status, numeroPedido, valorTotal: montagem.valorTotal };
  });

  if (resultado && !resultado.jaEnviada && resultado.status === dv.STATUS_DEVOLUCAO.concluida) {
    // Cashback (20/10/2026): a parte proporcional ao valor devolvido volta. Falhar aqui nao desfaz a devolucao.
    try {
      await cashback.estornarDevolucao({ user, tenantId, devolucaoId: resultado.id });
    } catch (erro) {
      console.error('[Devolucao app] cashback:', erro && erro.message);
    }
  }
  return resultado;
};

// ---------------------------------------------------------------------------
// Vendedor: as devolucoes que ele pediu
// ---------------------------------------------------------------------------

const LIMITE_LISTA_APP = 60;

const listarDoVendedor = async ({ user, tenantId }) => {
  const snap = await db.collection('devolucoes_venda').where('tenantId', '==', tenantId).where('solicitadoPorId', '==', user.uid).get();
  return snap.docs
    .map((d) => {
      const x = d.data();
      return {
        id: d.id,
        pedidoId: String(x.pedidoVendaId || ''),
        numeroPedido: String(x.numeroPedidoOriginal || ''),
        clienteNome: String(x.clienteNome || ''),
        valorTotal: Number(x.valorTotalDevolvido || 0),
        destino: dv.destinoDaDevolucao(x.destinoValor),
        bancoNome: String(x.bancoNome || ''),
        status: dv.situacaoDaDevolucao(x),
        motivo: String(x.motivo || ''),
        observacao: String(x.observacao || ''),
        motivoRecusa: String(x.motivoRecusa || ''),
        itens: (Array.isArray(x.itensDevolvidos) ? x.itensDevolvidos : []).map((i) => ({
          nome: String(i.nome || ''),
          quantidade: Number(i.quantidadeDevolvida || 0),
          unidadeMedidaSigla: String(i.unidadeMedidaSigla || 'UN'),
        })),
        criadaEmMillis: millis(x.createdAt),
        decididaEmMillis: millis(x.confirmadaEm) ?? millis(x.recusadaEm) ?? millis(x.estornadaEm),
      };
    })
    .sort((a, b) => (b.criadaEmMillis || 0) - (a.criadaEmMillis || 0))
    .slice(0, LIMITE_LISTA_APP);
};

module.exports = { ErroDevolucaoVenda, dadosParaDevolver, solicitarPeloApp, listarDoVendedor };
