/*
 * VENDA COM ENTREGA FUTURA -- as ENTREGAS (23/10/2026).
 *
 * A venda ja' foi faturada pelo fechamento (vendaFechamento.js): financeiro
 * lancado, NF-e de simples faturamento (5.922/6.922) emitida pela tela de
 * Notas Fiscais e o estoque RESERVADO. Aqui acontece o resto, tudo pelo
 * servidor (regra em domain/entregaFuturaDomain):
 *
 *  - listar o que falta entregar (Expedicao > Entregas futuras);
 *  - registrar uma entrega (parcial ou total): baixa o estoque e os lotes
 *    (vence antes, sai antes), grava `entregas_futuras/{id}` e atualiza o
 *    pedido (entregue por item, situacao);
 *  - emitir a NF-e de REMESSA (5.116/5.117, ou 6.xxx) referenciando a chave
 *    da nota de faturamento -- so' quando a empresa controla fiscal e a nota
 *    de faturamento esta' autorizada; sem ela a entrega sai sem nota e a
 *    tela avisa;
 *  - colocar a entrega numa rota em montagem (romaneio), como uma linha
 *    propria (`pedidoId` da linha = id da entrega).
 *
 * A colecao `entregas_futuras` e' so' do servidor (sem regra no Firestore).
 */
const { admin, db } = require('../config/firebase');
const ef = require('../domain/entregaFuturaDomain');
const reserva = require('../domain/estoqueReservaDomain');
const { toStockAdjustmentItems, toBaseQuantity } = require('../domain/embalagemDomain');
const nf = require('../domain/notaFiscalItemDomain');
const { naturezaDaOperacaoPelosCfops } = require('../domain/cfopDomain');
const { DEFAULT_REGIME_TRIBUTARIO, parseControlaFiscal, usesCsosn } = require('../domain/fiscalDomain');
const { montarEntregaDoPedido, tituloDoRomaneio } = require('../domain/romaneioDomain');
const { buildDocumentMetadata, buildDocumentUpdateMetadata } = require('../domain/documentMetadata');
const { getDateInputInTimeZone } = require('../domain/dateTime');
const { montarDestinatario } = require('./devolucaoNfe');
const { rotasAbertas } = require('./rotaPreVenda');
const { loadSpedyConfig } = require('./spedyAcesso');
const { fetchComTimeout, PERFIS } = require('../utils/fetchComTimeout');

class ErroEntregaFutura extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const agora = () => admin.firestore.FieldValue.serverTimestamp();
const REGIMES = ['simples_nacional', 'lucro_presumido', 'lucro_real'];
const regimeDaConfig = (config) => (REGIMES.includes(config.regimeTributario) ? config.regimeTributario : DEFAULT_REGIME_TRIBUTARIO);
const arred2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const idValido = (id, oQue) => {
  const s = String(id || '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(s)) throw new ErroEntregaFutura(400, `${oQue} inválido. Atualize a tela e tente de novo.`);
  return s;
};
const nomeDe = (user) => String(user.nome || user.email || 'Usuário');

const lerConfig = async (tenantId) => {
  const snap = await db.collection('configuracoes').doc(tenantId).get();
  return snap.exists ? snap.data() : {};
};

const lerPedido = (snap, tenantId) => {
  if (!snap.exists || snap.data().tenantId !== tenantId) throw new ErroEntregaFutura(404, 'Este pedido não existe mais ou é de outra empresa. Atualize a tela.');
  return { id: snap.id, ...snap.data() };
};

const saldosDoPedido = (pedido) => ef.saldoAEntregar(Array.isArray(pedido.itens) ? pedido.itens : [], pedido.entregaFuturaEntregue);

/** Nota de faturamento (NF-e) do pedido: autorizada, em transito ou nenhuma. */
const notaDeFaturamento = async (tenantId, pedidoId) => {
  const snap = await db.collection('notas_fiscais').where('tenantId', '==', tenantId).where('pedidoId', '==', pedidoId).get();
  const notas = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((n) => n.tipo === 'NF-e' && n.finalidade !== 'devolucao');
  const autorizada = notas.find((n) => n.status === 'authorized');
  if (autorizada) return { situacao: 'autorizada', nota: autorizada };
  const emTransito = notas.find((n) => ['enqueued', 'processing', 'created'].includes(String(n.status)));
  if (emTransito) return { situacao: 'em_transito', nota: emTransito };
  return { situacao: 'nenhuma', nota: null };
};

const resumoDaNota = (n) => (n ? { id: n.id, numero: n.number ?? null, chave: n.accessKey || null, status: n.status || null, mensagem: n.processingMessage || null } : null);

const resumoDoPedido = (pedido, hoje) => {
  const saldos = saldosDoPedido(pedido);
  const situacao = ef.situacaoDaEntrega(saldos);
  return {
    id: pedido.id,
    numeroPedido: String(pedido.numeroPedido || ''),
    clienteId: String(pedido.clienteId || ''),
    clienteNome: String(pedido.clienteNome || ''),
    vendedorNome: String(pedido.vendedorNome || ''),
    dataVenda: String(pedido.dataVenda || ''),
    previsaoEntrega: ef.parsePrevisaoEntrega(pedido.previsaoEntrega),
    atrasada: situacao !== 'entregue' && ef.entregaAtrasada(pedido.previsaoEntrega, hoje),
    situacao,
    valorTotalCentavos: Number(pedido.valorTotalCentavos) || Math.round((Number(pedido.valorTotal) || 0) * 100),
    entregas: Number(pedido.entregaFuturaQuantidadeDeEntregas) || 0,
    itens: saldos.map((s, i) => {
      const item = pedido.itens[i] || {};
      return {
        ...s,
        unidade: String(item.unidadeMedidaSigla || ''),
        controlaLote: false,
        precoUnitario: Number(item.precoUnitario) || 0,
      };
    }),
  };
};

// ===========================================================================
// LISTAR / DETALHE
// ===========================================================================

/** Pedidos faturados com saldo a entregar; atrasados primeiro, depois pela previsao. */
const listarPendentes = async ({ tenantId }) => {
  const hoje = getDateInputInTimeZone();
  const snap = await db.collection('pedidos_venda')
    .where('tenantId', '==', tenantId)
    .where('entregaFutura', '==', true)
    .where('entregaFuturaSituacao', 'in', ['pendente', 'parcial'])
    .get();
  const pedidos = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.status === 'Finalizada');
  const notasSnap = await db.collection('notas_fiscais').where('tenantId', '==', tenantId).where('finalidade', '==', ef.FINALIDADE_NOTA_FATURAMENTO).get();
  const notaPorPedido = new Map();
  notasSnap.docs.forEach((d) => {
    const n = { id: d.id, ...d.data() };
    const atual = notaPorPedido.get(n.pedidoId);
    if (!atual || n.status === 'authorized') notaPorPedido.set(n.pedidoId, n);
  });
  return pedidos
    .map((p) => ({ ...resumoDoPedido(p, hoje), notaFaturamento: resumoDaNota(notaPorPedido.get(p.id) || null) }))
    .sort((a, b) => Number(b.atrasada) - Number(a.atrasada)
      || (a.previsaoEntrega || '9999').localeCompare(b.previsaoEntrega || '9999')
      || a.dataVenda.localeCompare(b.dataVenda));
};

/** Um pedido: saldo, entregas feitas, nota de faturamento e rotas em montagem. */
const detalhe = async ({ tenantId, pedidoId }) => {
  const id = idValido(pedidoId, 'Pedido');
  const pedido = lerPedido(await db.collection('pedidos_venda').doc(id).get(), tenantId);
  if (pedido.entregaFutura !== true) throw new ErroEntregaFutura(409, `O pedido #${pedido.numeroPedido || '?'} não é uma venda para entrega futura.`);
  const [entregasSnap, nota, rotas, produtos] = await Promise.all([
    db.collection(ef.COLECAO_ENTREGAS_FUTURAS).where('tenantId', '==', tenantId).where('pedidoId', '==', id).get(),
    notaDeFaturamento(tenantId, id),
    rotasAbertas(tenantId),
    lerProdutos(tenantId, (pedido.itens || []).map((i) => i.id)),
  ]);
  const resumo = resumoDoPedido(pedido, getDateInputInTimeZone());
  resumo.itens = resumo.itens.map((i) => ({ ...i, controlaLote: Boolean(produtos[i.id] && produtos[i.id].controlarLote === true) }));
  return {
    pedido: resumo,
    notaFaturamento: { situacao: nota.situacao, ...resumoDaNota(nota.nota) },
    entregas: entregasSnap.docs.map((d) => entregaParaTela(d.id, d.data())).sort((a, b) => a.numero - b.numero),
    rotas,
  };
};

const entregaParaTela = (id, e) => ({
  id,
  numero: Number(e.numero) || 0,
  titulo: ef.tituloDaEntrega(e.pedidoNumero, Number(e.numero) || 0),
  criadoEmIso: String(e.criadoEmIso || ''),
  criadoPorNome: String(e.criadoPorNome || ''),
  observacao: String(e.observacao || ''),
  valorCentavos: Number(e.valorCentavos) || 0,
  itens: Array.isArray(e.itens) ? e.itens.map((i) => ({ indice: i.indice, id: i.id, nome: i.nome, quantidade: i.quantidade, unidade: i.unidade || '', lotes: i.lotes || [] })) : [],
  notaFiscal: e.notaFiscal || null,
  romaneio: e.romaneio || null,
});

const lerProdutos = async (tenantId, ids) => {
  const unicos = [...new Set(ids.filter((id) => id && id !== 'avulso'))];
  const snaps = unicos.length ? await db.getAll(...unicos.map((id) => db.collection('estoque').doc(id))) : [];
  const produtos = {};
  snaps.forEach((s) => { if (s.exists && s.data().tenantId === tenantId) produtos[s.id] = s.data(); });
  return produtos;
};

// ===========================================================================
// ENTREGAR
// ===========================================================================

/** Lotes do produto, do que vence antes para o que vence depois (sem validade por ultimo). */
const lotesFefo = (docs) => docs
  .map((d) => ({ id: d.id, ...d.data() }))
  .filter((l) => Number(l.quantidade) > 0)
  .sort((a, b) => (String(a.validade || '9999-99-99')).localeCompare(String(b.validade || '9999-99-99')) || a.id.localeCompare(b.id));

const entregar = async ({ user, tenantId, pedidoId, corpo }) => {
  const id = idValido(pedidoId, 'Pedido');
  const config = await lerConfig(tenantId);
  const controlaFiscal = parseControlaFiscal(config.controlaFiscal);
  const permitirSemEstoque = config.venderSemEstoque === true;
  const nota = await notaDeFaturamento(tenantId, id);
  if (controlaFiscal && nota.situacao === 'em_transito') {
    throw new ErroEntregaFutura(409, `A NF-e de faturamento do pedido ainda não tem resposta da SEFAZ. Espere a resposta (Notas Fiscais → Sincronizar) antes de entregar: a remessa precisa referenciar a chave dela.`);
  }
  const avisos = [];
  if (controlaFiscal && nota.situacao === 'nenhuma') {
    avisos.push('Esta entrega saiu SEM nota de remessa: o pedido não tem NF-e de faturamento autorizada. Se a venda leva nota, emita a NF-e do pedido em Notas Fiscais e registre as próximas entregas depois.');
  }
  const emiteRemessa = controlaFiscal && nota.situacao === 'autorizada';
  const hoje = getDateInputInTimeZone();

  const pedidoRef = db.collection('pedidos_venda').doc(id);
  const entregaRef = db.collection(ef.COLECAO_ENTREGAS_FUTURAS).doc();

  const gravada = await db.runTransaction(async (tx) => {
    // ---------------- LEITURAS ----------------
    const pedido = lerPedido(await tx.get(pedidoRef), tenantId);
    const saldos = saldosDoPedido(pedido);
    const bloqueio = ef.erroParaEntregar(pedido, saldos);
    if (bloqueio) throw new ErroEntregaFutura(409, bloqueio);
    const lido = ef.lerPedidoDeEntrega(corpo, saldos);
    if ('erro' in lido) throw new ErroEntregaFutura(400, lido.erro);
    const { entrega } = lido;

    const linhas = entrega.itens.map((l) => ({ ...l, item: pedido.itens[l.indice] }));
    const idsProdutos = [...new Set(linhas.map((l) => String(l.item.id || '')).filter((pid) => pid && pid !== 'avulso'))];
    const produtoSnaps = idsProdutos.length ? await tx.getAll(...idsProdutos.map((pid) => db.collection('estoque').doc(pid))) : [];
    const produtos = {};
    produtoSnaps.forEach((s) => { if (s.exists && s.data().tenantId === tenantId) produtos[s.id] = s.data(); });

    // Quantidade na unidade BASE do estoque (embalagem vendida x fator).
    const baixas = toStockAdjustmentItems(linhas.map((l) => ({ id: String(l.item.id || ''), nome: String(l.item.nome || ''), quantidade: l.quantidade, fatorConversao: l.item.fatorConversao })));
    const porProduto = new Map();
    baixas.forEach((b) => {
      if (!b.id || b.id === 'avulso') return;
      porProduto.set(b.id, { nome: b.nome, quantidade: (porProduto.get(b.id)?.quantidade || 0) + b.quantidade });
    });

    // Lotes: produto que controla lote sai do lote que vence antes.
    const lotesPorProduto = new Map();
    for (const [pid] of porProduto) {
      const produto = produtos[pid];
      if (!produto || produto.controlarLote !== true) continue;
      // eslint-disable-next-line no-await-in-loop
      const snap = await tx.get(db.collection('estoque_lotes').where('tenantId', '==', tenantId).where('produtoId', '==', pid));
      lotesPorProduto.set(pid, lotesFefo(snap.docs));
    }

    // ---------------- CONTAS ----------------
    const escritasDeEstoque = [];
    const escritasDeLote = [];
    const lotesUsados = new Map();
    porProduto.forEach((uso, pid) => {
      const produto = produtos[pid];
      if (!produto) return; // produto apagado: entrega segue sem mexer no estoque
      const estoqueAtual = Number(produto.quantidade || 0);
      const reservadaAtual = Number(produto.quantidadeReservada || 0);
      const permitir = reserva.podeVenderSemEstoque(permitirSemEstoque, produto);
      if (!permitir && estoqueAtual - uso.quantidade < -1e-9) {
        throw new ErroEntregaFutura(409, `Estoque insuficiente para entregar ${uso.nome}: tem ${estoqueAtual} e a entrega é de ${uso.quantidade}. Dê entrada na mercadoria ou entregue uma quantidade menor.`);
      }
      escritasDeEstoque.push([pid, {
        quantidade: permitir ? estoqueAtual - uso.quantidade : Math.max(0, estoqueAtual - uso.quantidade),
        quantidadeReservada: Math.max(0, reservadaAtual - uso.quantidade),
        updatedAt: agora(),
      }]);
      const lotes = lotesPorProduto.get(pid);
      if (!lotes) return;
      let falta = uso.quantidade;
      const usados = [];
      for (const l of lotes) {
        if (falta <= 1e-9) break;
        const sai = Math.min(falta, Number(l.quantidade));
        usados.push({ loteId: l.id, lote: String(l.lote || ''), validade: String(l.validade || ''), quantidade: sai });
        escritasDeLote.push([l.id, { quantidade: Number(l.quantidade) - sai, updatedAt: agora() }]);
        falta -= sai;
      }
      if (falta > 1e-9 && !permitir) {
        throw new ErroEntregaFutura(409, `${uso.nome}: os lotes em estoque somam ${uso.quantidade - falta}, menos que a entrega (${uso.quantidade}). Dê entrada no lote ou entregue menos.`);
      }
      lotesUsados.set(pid, usados);
    });

    const numeroEntrega = (Number(pedido.entregaFuturaQuantidadeDeEntregas) || 0) + 1;
    const entregueDepois = ef.entregueDepois(pedido.entregaFuturaEntregue, pedido.itens.length, entrega);
    const situacao = ef.situacaoDaEntrega(ef.saldoAEntregar(pedido.itens, entregueDepois));
    const itensDaEntrega = linhas.map((l) => {
      const vendida = Number(l.item.quantidade) || 0;
      const proporcao = vendida > 0 ? l.quantidade / vendida : 0;
      const descontoProporcional = arred2((Number(l.item.desconto) || 0) * proporcao);
      const total = arred2((Number(l.item.precoUnitario) || 0) * l.quantidade - descontoProporcional);
      return {
        indice: l.indice,
        id: String(l.item.id || ''),
        nome: String(l.item.nome || ''),
        codigo: String(l.item.codigo || ''),
        quantidade: l.quantidade,
        quantidadeBase: toBaseQuantity(l.quantidade, l.item.fatorConversao),
        unidade: String(l.item.unidadeMedidaSigla || ''),
        ...(l.item.embalagemId ? { embalagemId: String(l.item.embalagemId) } : {}),
        precoUnitario: Number(l.item.precoUnitario) || 0,
        desconto: descontoProporcional,
        totalCentavos: Math.round(total * 100),
        lotes: lotesUsados.get(String(l.item.id || '')) || [],
      };
    });
    const valorCentavos = itensDaEntrega.reduce((t, i) => t + i.totalCentavos, 0);
    const docEntrega = {
      tenantId,
      pedidoId: id,
      pedidoNumero: String(pedido.numeroPedido || ''),
      numero: numeroEntrega,
      clienteId: String(pedido.clienteId || ''),
      clienteNome: String(pedido.clienteNome || ''),
      itens: itensDaEntrega,
      valorCentavos,
      observacao: entrega.observacao,
      situacaoDoPedidoDepois: situacao,
      notaFiscal: emiteRemessa ? { status: 'pendente', notaFaturamentoId: nota.nota.id, notaFaturamentoChave: nota.nota.accessKey || null } : null,
      romaneio: null,
      criadoEmIso: new Date().toISOString(),
      criadoPorNome: nomeDe(user),
      createdAt: agora(),
      ...buildDocumentMetadata(user.uid, agora()),
    };

    // ---------------- ESCRITAS ----------------
    tx.set(entregaRef, docEntrega);
    tx.update(pedidoRef, {
      entregaFuturaEntregue: entregueDepois,
      entregaFuturaSituacao: situacao,
      entregaFuturaQuantidadeDeEntregas: numeroEntrega,
      // Tudo entregue: a reserva acabou (o cancelamento sabe que ja' saiu).
      estoqueReservado: situacao !== 'entregue',
      ...(situacao === 'entregue' ? { entregaFuturaConcluidaEm: agora() } : {}),
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), `Entrega ${numeroEntrega} registrada (entrega futura)`),
    });
    escritasDeEstoque.forEach(([pid, campos]) => tx.update(db.collection('estoque').doc(pid), campos));
    escritasDeLote.forEach(([lid, campos]) => tx.update(db.collection('estoque_lotes').doc(lid), campos));
    return { pedido, numeroEntrega, situacao, docEntrega };
  });

  // Daqui em diante a entrega EXISTE: nota e rota nunca desfazem o que foi gravado.
  let notaRemessa = null;
  if (emiteRemessa) {
    notaRemessa = await emitirRemessa({ user, tenantId, entregaId: entregaRef.id }).catch((erro) => {
      console.error('[Entrega futura] remessa nao emitida:', erro);
      return { ok: false, motivo: 'nao_emitida', mensagem: erro.message || 'A nota de remessa não foi emitida.' };
    });
    if (notaRemessa && !notaRemessa.ok) avisos.push(`A entrega foi registrada, mas a nota de remessa não saiu: ${notaRemessa.mensagem} Corrija e use "Emitir a nota de novo" na entrega.`);
  }
  let rota = null;
  if (corpo && corpo.romaneioId) {
    rota = await colocarEntregaNaRota({ user, tenantId, entregaId: entregaRef.id, romaneioId: String(corpo.romaneioId) }).catch((erro) => {
      console.error('[Entrega futura] rota:', erro);
      avisos.push(`A entrega foi registrada, mas não entrou na rota: ${erro.message || ''} Coloque pelo Romaneio.`);
      return null;
    });
  }
  return {
    entregaId: entregaRef.id,
    numero: gravada.numeroEntrega,
    titulo: ef.tituloDaEntrega(gravada.pedido.numeroPedido, gravada.numeroEntrega),
    situacao: gravada.situacao,
    nota: notaRemessa,
    rota,
    avisos,
  };
};

// ===========================================================================
// NOTA DE REMESSA (5.116/5.117)
// ===========================================================================

const lerEntrega = async (tenantId, entregaId) => {
  const ref = db.collection(ef.COLECAO_ENTREGAS_FUTURAS).doc(idValido(entregaId, 'Entrega'));
  const snap = await ref.get();
  if (!snap.exists || snap.data().tenantId !== tenantId) throw new ErroEntregaFutura(404, 'Esta entrega não existe mais ou é de outra empresa.');
  return { ref, entrega: { id: snap.id, ...snap.data() } };
};

/** Monta a remessa (sem enviar): itens pelo cadastro, destinatario pelo cliente. */
const prepararRemessa = async ({ tenantId, entrega, pedido, config, notaFat }) => {
  const erros = [];
  const avisos = [];
  const cliente = pedido.clienteId ? (await db.collection('clientes').doc(String(pedido.clienteId)).get()) : null;
  const dadosCliente = cliente && cliente.exists && cliente.data().tenantId === tenantId ? cliente.data() : null;
  const destinatario = montarDestinatario(dadosCliente);
  erros.push(...destinatario.erros);
  const companyState = String(config.nfseCidadeEstado || '').trim().toUpperCase() || 'SP';
  const clientState = String(dadosCliente && dadosCliente.estado ? dadosCliente.estado : '').trim().toUpperCase() || companyState;
  const interestadual = clientState !== companyState;
  const regime = regimeDaConfig(config);
  const produtos = await lerProdutos(tenantId, entrega.itens.map((i) => i.id));
  const itens = [];
  const tributos = [];
  for (const item of entrega.itens) {
    const produto = produtos[item.id];
    if (!produto) { erros.push(`O produto "${item.nome}" não está mais no cadastro: a remessa não pode ser montada.`); continue; }
    const produzido = produto.produzidoInternamente === true || (produto.avancado && produto.avancado.produzidoInternamente === true);
    const cfop = ef.cfopDaRemessa(produzido, interestadual);
    const montado = nf.montarItemNotaFiscal({
      produto: nf.produtoFiscalDoCadastro(produto, { embalagemId: item.embalagemId }),
      venda: { quantidade: item.quantidade, precoUnitario: item.precoUnitario, desconto: item.desconto, unidadeSigla: item.unidade },
      contexto: { regime, interestadual, cfopDaOperacao: cfop, entregaFutura: 'remessa' },
      codigoItem: String(produto.codigo || item.id),
    });
    if (!montado.ok) { erros.push(montado.erro); continue; }
    avisos.push(...montado.avisos);
    itens.push(montado.item);
    tributos.push(montado.tributos);
  }
  if (erros.length > 0) return { ok: false, erros, avisos };
  const totais = nf.totaisImpostosDosItens(itens);
  const bruto = arred2(itens.reduce((s, i) => s + Number(i.totalAmount || 0), 0));
  const desconto = arred2(itens.reduce((s, i) => s + Number(i.discountAmount || 0), 0));
  const total = arred2(bruto - desconto);
  const info = [
    ef.infoComplementarDaRemessa({
      numeroPedido: pedido.numeroPedido, numeroEntrega: entrega.numero, notaNumero: notaFat.number,
      notaChave: notaFat.accessKey, notaData: notaFat.data ? new Date(notaFat.data).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '',
    }),
    usesCsosn(regime) ? nf.TEXTO_OPTANTE_SIMPLES_NACIONAL : '',
  ].filter(Boolean).join(' ');
  return {
    ok: true,
    erros: [],
    avisos: [...new Set(avisos)],
    receiver: destinatario.receiver,
    itens,
    valorTotal: total,
    payload: {
      isFinalCustomer: nf.destinatarioEConsumidorFinal({ documento: destinatario.receiver.federalTaxNumber, inscricaoEstadual: destinatario.receiver.stateTaxNumber }),
      operationType: 'outgoing',
      purposeType: 'normal',
      destination: interestadual ? 'interstate' : 'internal',
      presenceType: 'none',
      operationNature: naturezaDaOperacaoPelosCfops(itens.map((i) => i.cfop)),
      additionalInformation: info,
      sendEmailToCustomer: Boolean(destinatario.receiver.email),
      receiver: destinatario.receiver,
      items: itens,
      payments: [{ method: 'noPayment', amount: 0 }],
      referencedDocuments: [{ accessKey: notaFat.accessKey }],
      total: {
        invoiceAmount: total,
        productAmount: bruto,
        ...(desconto > 0 ? { discountAmount: desconto } : {}),
        ...(totais.icmsBaseTax > 0 ? { icmsBaseTax: totais.icmsBaseTax, icmsAmount: totais.icmsAmount } : {}),
      },
    },
  };
};

const emitirRemessa = async ({ user, tenantId, entregaId }) => {
  const { ref, entrega } = await lerEntrega(tenantId, entregaId);
  const anterior = entrega.notaFiscal || {};
  if (['authorized', 'enqueued', 'processing', 'created'].includes(String(anterior.status))) {
    throw new ErroEntregaFutura(409, 'A nota de remessa desta entrega já foi enviada à SEFAZ. Acompanhe em Notas Fiscais.');
  }
  const pedido = lerPedido(await db.collection('pedidos_venda').doc(String(entrega.pedidoId)).get(), tenantId);
  const config = await lerConfig(tenantId);
  const fat = await notaDeFaturamento(tenantId, pedido.id);
  if (fat.situacao !== 'autorizada') throw new ErroEntregaFutura(409, 'A NF-e de faturamento do pedido não está autorizada: a remessa precisa referenciar a chave dela.');
  const tentativa = (Number(anterior.tentativa) || 0) + 1;
  const integrationId = tentativa === 1 ? `ef-${entrega.id}` : `ef-${entrega.id}-t${tentativa}`;
  const marcar = (status, mensagem) => ref.update({
    notaFiscal: { ...anterior, status, mensagem: String(mensagem || '').slice(0, 500), tentativa, integrationId, notaFaturamentoId: fat.nota.id, notaFaturamentoChave: fat.nota.accessKey || null },
    updatedAt: agora(),
  });

  const preparo = await prepararRemessa({ tenantId, entrega, pedido, config, notaFat: fat.nota });
  if (!preparo.ok) {
    const mensagem = preparo.erros.join(' ');
    await marcar('nao_emitida', mensagem);
    return { ok: false, motivo: 'nao_emitida', mensagem };
  }
  let apiKey;
  let baseUrl;
  try {
    ({ apiKey, baseUrl } = await loadSpedyConfig(tenantId));
  } catch {
    const mensagem = 'A emissão de nota pela Spedy não está configurada nesta filial (Configurações › Nota Fiscal).';
    await marcar('nao_emitida', mensagem);
    return { ok: false, motivo: 'nao_emitida', mensagem };
  }
  let resposta;
  let corpo;
  try {
    resposta = await fetchComTimeout(`${baseUrl}/product-invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify({ integrationId, ...preparo.payload }),
    }, PERFIS.spedyEmissao);
    corpo = await resposta.json().catch(() => ({}));
  } catch (erroRede) {
    const mensagem = erroRede.message || 'A Spedy não respondeu.';
    await marcar('falha_envio', mensagem);
    return { ok: false, motivo: 'falha_envio', mensagem };
  }
  if (!resposta.ok) {
    const mensagem = (corpo.errors && corpo.errors[0] && corpo.errors[0].message) || corpo.error || corpo.message || 'A Spedy recusou a nota de remessa.';
    await marcar('nao_emitida', mensagem);
    return { ok: false, motivo: 'nao_emitida', mensagem };
  }
  // A nota EXISTE na Spedy a partir daqui.
  try {
    const nova = db.collection('notas_fiscais').doc();
    const status = corpo.status || 'enqueued';
    await nova.set({
      spedyId: corpo.id,
      number: corpo.number ?? null,
      accessKey: corpo.accessKey || null,
      tipo: 'NF-e',
      finalidade: ef.FINALIDADE_NOTA_REMESSA,
      // NUNCA `pedidoId`: as telas de venda leem esse campo como "a nota do pedido".
      pedidoOrigemId: pedido.id,
      pedidoOrigemNumero: String(pedido.numeroPedido || ''),
      entregaFuturaId: entrega.id,
      entregaFuturaNumero: entrega.numero,
      notaOriginalId: fat.nota.id,
      notaOriginalChave: fat.nota.accessKey || null,
      notaOriginalNumero: fat.nota.number ?? null,
      clienteNome: String(preparo.receiver.name || ''),
      clienteId: pedido.clienteId || null,
      valor: preparo.valorTotal,
      itensFiscais: preparo.itens,
      status,
      processingMessage: (corpo.processingDetail && corpo.processingDetail.message) || null,
      processingCode: (corpo.processingDetail && corpo.processingDetail.code) || null,
      emailDestinatario: preparo.receiver.email || null,
      integrationId,
      tentativaEmissao: tentativa,
      tenantId,
      createdAt: agora(),
      data: new Date().toISOString(),
      ...buildDocumentMetadata(user.uid, agora()),
    });
    const notaFiscal = {
      status, notaId: nova.id, spedyId: corpo.id, number: corpo.number ?? null, accessKey: corpo.accessKey || null,
      mensagem: (corpo.processingDetail && corpo.processingDetail.message) || '', tentativa, integrationId,
      notaFaturamentoId: fat.nota.id, notaFaturamentoChave: fat.nota.accessKey || null,
    };
    await ref.update({ notaFiscal, updatedAt: agora() });
    return { ok: true, nota: notaFiscal, avisos: preparo.avisos };
  } catch (erroGravacao) {
    console.error('[Entrega futura] remessa enviada, mas falhou ao gravar:', erroGravacao);
    throw new ErroEntregaFutura(500, 'A Spedy recebeu a nota de remessa, mas o sistema não conseguiu guardá-la. Não emita de novo: avise o suporte para conferirmos a nota no painel da Spedy.');
  }
};

/** Webhook/consulta da Spedy: copia a situacao da nota para a entrega. */
const espelharNaEntrega = async (entregaId, dadosNota) => {
  const ref = db.collection(ef.COLECAO_ENTREGAS_FUTURAS).doc(String(entregaId));
  const snap = await ref.get();
  if (!snap.exists) return;
  const atual = snap.data().notaFiscal || {};
  await ref.update({
    notaFiscal: { ...atual, status: dadosNota.status, number: dadosNota.number ?? atual.number ?? null, accessKey: dadosNota.accessKey || atual.accessKey || null, mensagem: String(dadosNota.processingMessage || '').slice(0, 500) },
    updatedAt: agora(),
  });
};

// ===========================================================================
// ROTA (romaneio em montagem)
// ===========================================================================

const colocarEntregaNaRota = async ({ user, tenantId, entregaId, romaneioId }) => {
  const idRota = idValido(romaneioId, 'Rota');
  const { ref: entregaRef, entrega } = await lerEntrega(tenantId, entregaId);
  const romaneioRef = db.collection('romaneios').doc(idRota);
  const travaRef = db.collection('romaneio_pedidos').doc(entrega.id);
  const pedidoRef = db.collection('pedidos_venda').doc(String(entrega.pedidoId));
  return db.runTransaction(async (tx) => {
    const [romaneioSnap, travaSnap, pedidoSnap] = await tx.getAll(romaneioRef, travaRef, pedidoRef);
    if (!romaneioSnap.exists || romaneioSnap.data().tenantId !== tenantId) throw new ErroEntregaFutura(404, 'Esta rota não existe mais. Escolha outra.');
    const dados = romaneioSnap.data();
    if (dados.status !== 'montagem') throw new ErroEntregaFutura(409, 'Esta rota já saiu para entrega. Escolha uma rota em montagem.');
    if (travaSnap.exists && travaSnap.data().situacao !== 'liberado') {
      return { acao: 'ja_estava', rota: { id: String(travaSnap.data().romaneioId || ''), titulo: String(travaSnap.data().romaneioTitulo || '') } };
    }
    const pedido = pedidoSnap.exists ? pedidoSnap.data() : {};
    const clienteSnap = entrega.clienteId ? await tx.get(db.collection('clientes').doc(String(entrega.clienteId))) : null;
    const cliente = clienteSnap && clienteSnap.exists ? clienteSnap.data() : null;
    const notaRemessa = entrega.notaFiscal && entrega.notaFiscal.number ? { numero: entrega.notaFiscal.number, tipo: 'NF-e' } : null;
    const linha = montarEntregaDoPedido({
      id: entrega.id,
      numeroPedido: ef.numeroDaEntrega(entrega.pedidoNumero, entrega.numero),
      dataVenda: getDateInputInTimeZone(),
      clienteId: entrega.clienteId,
      clienteNome: entrega.clienteNome,
      vendedorNome: pedido.vendedorNome,
      formaPagamento: 'Já faturado (entrega futura)',
      valorTotalCentavos: entrega.valorCentavos,
      valorTotalDescontosCentavos: 0,
    }, cliente, notaRemessa);
    const titulo = tituloDoRomaneio(Number(dados.numero), String(dados.nome || ''));
    const entregasAtuais = Array.isArray(dados.entregas) ? dados.entregas : [];
    const pedidoIds = Array.isArray(dados.pedidoIds) ? dados.pedidoIds : entregasAtuais.map((e) => e.pedidoId);
    if (!pedidoIds.includes(entrega.id)) {
      tx.update(romaneioRef, {
        entregas: [...entregasAtuais, linha],
        pedidoIds: [...pedidoIds, entrega.id],
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), `${ef.tituloDaEntrega(entrega.pedidoNumero, entrega.numero)} colocada na rota`),
      });
    }
    tx.set(travaRef, {
      tenantId,
      romaneioId: idRota,
      romaneioTitulo: titulo,
      pedidoNumero: linha.numeroPedido,
      situacao: 'em_romaneio',
      entregaFuturaId: entrega.id,
      pedidoOrigemId: String(entrega.pedidoId),
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), `Entrega colocada na ${titulo}`),
    });
    tx.update(entregaRef, { romaneio: { id: idRota, titulo }, updatedAt: agora() });
    return { acao: 'colocado', rota: { id: idRota, titulo } };
  });
};

module.exports = { ErroEntregaFutura, listarPendentes, detalhe, entregar, emitirRemessa, espelharNaEntrega, colocarEntregaNaRota, notaDeFaturamento };
