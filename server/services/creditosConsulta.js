/*
 * VER OS CREDITOS E DE ONDE VEM CADA UM (26/11/2026, pedido do dono).
 *
 * Contas a Receber: o saldo de credito de cada cliente e a lista dos creditos
 * dele, com a ORIGEM pelo numero que o usuario conhece (devolucao do pedido
 * #N, devolucao sem pedido, venda #N cancelada), quanto ja' foi usado e quanto
 * sobra; e onde o credito foi usado (vendas e parcelas pagas com "Credito de
 * Devolucao").
 *
 * Contas a Pagar: o sistema nao tem "credito com fornecedor" como saldo; o que
 * existe e' CONTA A RECEBER DO FORNECEDOR (devolucao ao fornecedor que passou
 * do que estava em aberto na nota, ou lancada a mao). E' isso que aparece, com
 * a origem -- nada inventado.
 *
 * So' leitura, pelo Admin SDK, empresa do token; permissao
 * "financeiro.creditos_ver" (conferida na rota, pelas efetivas).
 */
const { db } = require('../config/firebase');
const { creditoEhDoCliente } = require('../domain/creditoDomain');

const STATUS_EM_ABERTO = ['disponivel', 'usado_parcial'];
const FORMA_CREDITO = 'Crédito de Devolução';
/** De onde nasce conta a receber de fornecedor: devolucao ao fornecedor e lancamento a mao (lancamentoReceberDomain). */
const ORIGENS_DE_CONTA_DE_FORNECEDOR = ['devolucao_compra', 'manual'];
const LIMITE = 300;
const LEITURA_POR_VEZ = 100;

const texto = (v) => String(v ?? '').trim();
const centavos = (dados, campoCentavos, campoReais) => {
  const n = Number(dados[campoCentavos] ?? Math.round(Number(dados[campoReais] || 0) * 100));
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
};
const dataIso = (v) => {
  if (!v) return '';
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  const s = v.seconds ?? v._seconds;
  return typeof s === 'number' ? new Date(s * 1000).toISOString() : '';
};

const ROTULO_STATUS = { disponivel: 'Disponível', usado_parcial: 'Usado em parte', esgotado: 'Usado', cancelado: 'Cancelado (devolução estornada)' };

/**
 * Origem do credito, pelo numero que o usuario conhece. Puro.
 * `devolucao` = documento da devolucao (quando o credito e' de devolucao).
 */
const origemDoCredito = (id, credito, devolucao) => {
  const numero = texto(credito.numeroPedidoOriginal) || texto(devolucao && devolucao.numeroPedidoOriginal);
  const pedidoId = texto(credito.pedidoOrigemId) || texto(devolucao && devolucao.pedidoVendaId);
  if (String(id).startsWith('cancelamento_') || credito.origem === 'cancelamento_venda') {
    return { tipo: 'cancelamento', rotulo: 'Venda cancelada', documento: numero ? `Venda #${numero} cancelada (o crédito usado nela voltou)` : 'Venda cancelada', pedidoId, devolucaoId: '' };
  }
  if (String(id).startsWith('devolucao_') || credito.devolucaoId) {
    const devolucaoId = texto(credito.devolucaoId) || String(id).replace(/^devolucao_/, '');
    if ((devolucao && devolucao.semPedido === true) || !pedidoId) {
      return { tipo: 'devolucao_sem_pedido', rotulo: 'Devolução sem pedido', documento: 'Devolução sem pedido (compra de antes do sistema)', pedidoId: '', devolucaoId };
    }
    return { tipo: 'devolucao', rotulo: 'Devolução', documento: numero ? `Devolução do pedido #${numero}` : 'Devolução de venda', pedidoId, devolucaoId };
  }
  return { tipo: 'outro', rotulo: 'Crédito', documento: texto(credito.motivo) || 'Crédito do cliente', pedidoId, devolucaoId: '' };
};

/** Credito -> linha da tela. Puro. */
const linhaDoCredito = (id, credito, devolucao) => {
  const valorCentavos = Math.round(Number(credito.valorOriginal || 0) * 100);
  const saldoCentavos = centavos(credito, 'saldoDisponivelCentavos', 'saldoDisponivel');
  const status = texto(credito.status) || 'disponivel';
  return {
    id,
    ...origemDoCredito(id, credito, devolucao),
    motivo: texto(credito.motivo) || texto(devolucao && devolucao.motivo),
    status,
    statusRotulo: ROTULO_STATUS[status] || status,
    valorCentavos,
    // Cancelado = nao vale mais (devolucao estornada): nada "usado".
    usadoCentavos: status === 'cancelado' ? 0 : Math.max(0, valorCentavos - saldoCentavos),
    saldoCentavos: status === 'cancelado' ? 0 : saldoCentavos,
    criadoEm: dataIso(credito.createdAt) || dataIso(devolucao && devolucao.createdAt),
    ultimaMovimentacao: texto(credito.ultimaAlteracao),
    movimentadoEm: dataIso(credito.alteradoEm) || dataIso(credito.updatedAt),
    abatimentos: (Array.isArray(credito.abatimentos) ? credito.abatimentos : []).map((a) => ({
      descricao: texto(a.descricao),
      centavos: Math.max(0, Math.round(Number(a.centavos) || 0)),
      quitou: a.quitou === true,
    })),
  };
};

const lerPorId = async (colecao, ids) => {
  const mapa = new Map();
  const unicos = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unicos.length; i += LEITURA_POR_VEZ) {
    const refs = unicos.slice(i, i + LEITURA_POR_VEZ).map((id) => db.collection(colecao).doc(id));
    const snaps = refs.length ? await db.getAll(...refs) : [];
    snaps.forEach((s) => { if (s.exists) mapa.set(s.id, s.data()); });
  }
  return mapa;
};

const consultasPeloCliente = (colecao, tenantId, cliente, extra = (q) => q) => {
  const base = extra(db.collection(colecao).where('tenantId', '==', tenantId));
  return Promise.all([
    cliente.id ? base.where('clienteId', '==', cliente.id).get() : Promise.resolve(null),
    cliente.nome ? base.where('clienteNome', '==', cliente.nome).get() : Promise.resolve(null),
  ]).then(([porId, porNome]) => {
    const docs = new Map();
    [porId, porNome].forEach((snap) => (snap ? snap.docs : []).forEach((d) => docs.set(d.id, d)));
    return [...docs.values()];
  });
};

/** Todos os creditos do cliente (abertos e ja' usados), com a origem, e onde foi usado. */
const creditosDoCliente = async ({ tenantId, clienteId, clienteNome }) => {
  const cliente = { id: texto(clienteId), nome: texto(clienteNome) };
  if (!cliente.id && !cliente.nome) return { creditos: [], usos: [], saldoCentavos: 0 };
  const docs = (await consultasPeloCliente('creditos_cliente', tenantId, cliente))
    .filter((d) => creditoEhDoCliente(d.data(), cliente));
  const idsDevolucao = docs.map((d) => texto(d.data().devolucaoId) || (d.id.startsWith('devolucao_') ? d.id.replace(/^devolucao_/, '') : '')).filter(Boolean);
  const devolucoes = await lerPorId('devolucoes_venda', idsDevolucao);
  const creditos = docs
    .map((d) => {
      const c = d.data();
      const devId = texto(c.devolucaoId) || (d.id.startsWith('devolucao_') ? d.id.replace(/^devolucao_/, '') : '');
      const dev = devolucoes.get(devId);
      return linhaDoCredito(d.id, c, dev && dev.tenantId === tenantId ? dev : null);
    })
    // Abertos primeiro; depois os mais novos.
    .sort((a, b) => Number(b.saldoCentavos > 0) - Number(a.saldoCentavos > 0) || b.criadoEm.localeCompare(a.criadoEm))
    .slice(0, LIMITE);

  // Onde o credito foi usado: o que entrou com a forma "Credito de Devolucao" (venda paga com
  // credito, parcela abatida no Contas a Receber ou na devolucao). E' do cliente, nao de um credito so'.
  const usosDocs = (await consultasPeloCliente('transacoes', tenantId, cliente, (q) => q.where('formaPagamento', '==', FORMA_CREDITO)))
    .filter((d) => d.data().tipo === 'entrada' && d.data().status !== 'Cancelada');
  const usos = usosDocs
    .map((d) => {
      const t = d.data();
      return {
        id: d.id,
        descricao: texto(t.descricao),
        data: texto(t.dataPagamento) || texto(t.data),
        centavos: centavos(t, 'valorCentavos', 'valor'),
        pedidoId: texto(t.pedidoId),
        osId: texto(t.osId),
      };
    })
    .sort((a, b) => b.data.localeCompare(a.data))
    .slice(0, LIMITE);

  return {
    creditos,
    usos,
    saldoCentavos: creditos.reduce((s, c) => s + c.saldoCentavos, 0),
  };
};

/** Saldo de credito em aberto de cada cliente (para mostrar na lista). */
const saldosDosClientes = async ({ tenantId }) => {
  const snap = await db.collection('creditos_cliente').where('tenantId', '==', tenantId).where('status', 'in', STATUS_EM_ABERTO).get();
  const porCliente = new Map();
  snap.docs.forEach((d) => {
    const c = d.data();
    const saldo = centavos(c, 'saldoDisponivelCentavos', 'saldoDisponivel');
    if (saldo <= 0) return;
    const id = texto(c.clienteId);
    const nome = texto(c.clienteNome).toUpperCase();
    const chave = id ? `id:${id}` : `nome:${nome}`;
    const atual = porCliente.get(chave) || { clienteId: id, clienteNome: texto(c.clienteNome), saldoCentavos: 0, quantidade: 0 };
    atual.saldoCentavos += saldo;
    atual.quantidade += 1;
    porCliente.set(chave, atual);
  });
  return { clientes: [...porCliente.values()].sort((a, b) => b.saldoCentavos - a.saldoCentavos) };
};

// ---------------------------------------------------------------------------
// Fornecedor: o que ele deve a empresa (conta a receber do fornecedor)
// ---------------------------------------------------------------------------

/** Conta a receber do fornecedor -> linha da tela, com a origem. Puro. */
const linhaDaContaDoFornecedor = (id, t) => {
  const devolucao = String(id).startsWith('devolucao_compra_') || t.origemLancamento === 'devolucao_compra' || Boolean(t.devolucaoCompraId);
  const valorCentavos = centavos(t, 'valorCentavos', 'valor');
  const aberto = t.status === 'Pendente';
  return {
    id,
    tipo: devolucao ? 'devolucao_compra' : 'lancamento',
    rotulo: devolucao ? 'Devolução ao fornecedor' : 'Lançada à mão',
    documento: texto(t.descricao) || (devolucao ? 'Devolução de compra' : 'Conta a receber do fornecedor'),
    notaEntradaId: texto(t.notaEntradaId),
    status: aberto ? 'aberto' : 'recebido',
    statusRotulo: aberto ? 'A receber' : 'Recebido',
    valorCentavos,
    saldoCentavos: aberto ? valorCentavos : 0,
    criadoEm: dataIso(t.createdAt) || texto(t.data),
    recebidoEm: texto(t.dataPagamento),
    formaRecebimento: aberto ? '' : texto(t.formaPagamento),
  };
};

const contasDoFornecedor = async ({ tenantId, fornecedorId }) => {
  const id = texto(fornecedorId);
  if (!id) return { contas: [], saldoCentavos: 0 };
  const snap = await db.collection('transacoes').where('tenantId', '==', tenantId).where('fornecedorId', '==', id).where('tipo', '==', 'entrada').get();
  const contas = snap.docs
    .filter((d) => d.data().status !== 'Cancelada')
    .map((d) => linhaDaContaDoFornecedor(d.id, d.data()))
    .sort((a, b) => Number(b.saldoCentavos > 0) - Number(a.saldoCentavos > 0) || b.criadoEm.localeCompare(a.criadoEm))
    .slice(0, LIMITE);
  return { contas, saldoCentavos: contas.reduce((s, c) => s + c.saldoCentavos, 0) };
};

/** O que cada fornecedor deve a empresa, em aberto (para mostrar na lista do Pagar). */
const saldosDosFornecedores = async ({ tenantId }) => {
  // So' as contas a receber que podem ser de fornecedor (devolucao ao fornecedor e lancada a mao):
  // ler todas as contas em aberto da empresa custava milhares de leituras a cada abertura da tela.
  const snap = await db.collection('transacoes').where('tenantId', '==', tenantId).where('tipo', '==', 'entrada').where('status', '==', 'Pendente')
    .where('origemLancamento', 'in', ORIGENS_DE_CONTA_DE_FORNECEDOR).get();
  const porFornecedor = new Map();
  snap.docs.forEach((d) => {
    const t = d.data();
    const id = texto(t.fornecedorId);
    if (!id) return;
    const atual = porFornecedor.get(id) || { fornecedorId: id, fornecedorNome: texto(t.fornecedorNome), saldoCentavos: 0, quantidade: 0 };
    atual.saldoCentavos += centavos(t, 'valorCentavos', 'valor');
    atual.quantidade += 1;
    porFornecedor.set(id, atual);
  });
  return { fornecedores: [...porFornecedor.values()].sort((a, b) => b.saldoCentavos - a.saldoCentavos) };
};

module.exports = {
  creditosDoCliente,
  saldosDosClientes,
  contasDoFornecedor,
  saldosDosFornecedores,
  // puros, para os testes
  origemDoCredito,
  linhaDoCredito,
  linhaDaContaDoFornecedor,
};
