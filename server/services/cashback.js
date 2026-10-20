/*
 * CASHBACK (20/10/2026) -- regra em src/utils/cashbackDomain.ts (compilada em
 * domain/cashbackDomain.js).
 *
 * So' o servidor mexe no saldo (as firestore.rules deixam a tela apenas ler
 * `cashback_movimentos` e o resumo `clientes/{id}.cashback`):
 *  - gerarSeDevido(pedidoId): chamado depois que uma venda e' gravada ou
 *    recebe uma baixa. Le a venda do banco; se ela esta' paga por inteiro,
 *    o cliente e' de verdade e o cashback esta' ligado, cria o lote
 *    `gerado_{pedidoId}` -- idempotente: lote que ja' existe nao gera de novo.
 *  - estornarVenda(pedidoId): venda cancelada (ou baixa estornada): o lote e'
 *    marcado como estornado; o que o cliente ja' gastou dele vira divida, que
 *    o proximo cashback abate.
 *  - estornarDevolucao(devolucaoId): devolucao parcial tira do lote a parte
 *    proporcional ao valor devolvido.
 *  - prepararUso/gravarUso (fase 2): a venda PELO SERVIDOR paga com a forma
 *    "Cashback" -- confere o saldo e baixa os lotes (vence antes, sai antes)
 *    dentro da transacao da venda (vendaFechamento.js), gravando o movimento
 *    `usado_{pedidoId}`; devolverUso(pedidoId) devolve tudo quando essa venda
 *    e' cancelada (estornarVenda chama os dois caminhos).
 *
 * Cada operacao e' uma transacao propria (leituras antes das escritas), por
 * isso roda DEPOIS da transacao da venda/baixa, como registrarLog -- nao e'
 * atomica com ela, mas e' idempotente: pode ser chamada de novo a qualquer
 * hora (inclusive pelo endpoint /api/cashback/gerar, que a tela chama quando
 * grava a venda ou a baixa por conta propria).
 */
const { admin, db } = require('../config/firebase');
const cb = require('../domain/cashbackDomain');
const fin = require('../domain/financeDomain');
const { getDateInputInTimeZone } = require('../domain/dateTime');
const { registrarLog } = require('./auditoria');

class ErroCashback extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const agora = () => admin.firestore.FieldValue.serverTimestamp();
const FORMA_CASHBACK = 'Cashback';

const texto = (v) => (typeof v === 'string' ? v.trim() : '');
const inteiro = (v) => Math.round(Number(v) || 0);

const lerConfig = async (tx, tenantId) => {
  const snap = await tx.get(db.collection('configuracoes').doc(tenantId));
  return cb.parseConfigCashback(snap.exists ? snap.data().cashback : undefined);
};

/** Venda finalizada com tudo recebido (a prazo: depois da ultima baixa). */
const vendaEstaPaga = (venda) => {
  if (!venda || venda.status !== 'Finalizada') return false;
  const pagamentos = Array.isArray(venda.pagamentos) ? venda.pagamentos : [];
  if (pagamentos.length === 0) return false;
  const r = fin.summarizePayments(pagamentos);
  return r.pendingCents === 0 && r.receivedCents > 0;
};

/** O que foi pago com o proprio cashback nao gera cashback de novo. */
const pagoComCashbackCentavos = (venda) => (Array.isArray(venda.pagamentos) ? venda.pagamentos : [])
  .filter((p) => p && p.formaPagamento === FORMA_CASHBACK)
  .reduce((s, p) => s + inteiro(p.valorCentavos), 0);

const totalDaVendaCentavos = (venda) => inteiro(venda.valorTotalCentavos ?? fin.toCents(Number(venda.valorTotal || 0)));

const itensDaVenda = (venda, produtosPorId) => (Array.isArray(venda.itens) ? venda.itens : [])
  .filter((i) => i && i.id && i.id !== 'avulso')
  .map((i) => {
    const quantidade = Number(i.quantidade) || 0;
    const subtotal = i.subtotal !== undefined && i.subtotal !== null
      ? Number(i.subtotal)
      : Number(i.precoUnitario || 0) * quantidade - Number(i.desconto || 0);
    return { produtoId: String(i.id), nome: String(i.nome || 'item'), quantidade, totalCentavos: Math.max(0, fin.toCents(subtotal)), produto: produtosPorId[String(i.id)] || null };
  });

/** Desconto geral e pagamento com cashback reduzem a base, proporcionalmente aos itens. */
const fatorDaBase = (venda, itens) => {
  const somaItens = itens.reduce((s, i) => s + i.totalCentavos, 0);
  if (somaItens <= 0) return 0;
  const descontoGeral = inteiro(venda.descontoGeral && venda.descontoGeral.valorAplicadoCentavos);
  const base = Math.max(0, somaItens - descontoGeral - pagoComCashbackCentavos(venda));
  return Math.min(1, base / somaItens);
};

const refLote = (pedidoId) => db.collection('cashback_movimentos').doc(`gerado_${pedidoId}`);
const refUso = (pedidoId) => db.collection('cashback_movimentos').doc(`usado_${pedidoId}`);

const lotesDoCliente = async (tx, tenantId, clienteId) => {
  const snap = await tx.get(db.collection('cashback_movimentos')
    .where('tenantId', '==', tenantId)
    .where('clienteId', '==', clienteId)
    .where('tipo', '==', 'gerado'));
  return snap.docs.map((d) => ({ ref: d.ref, id: d.id, dados: d.data() }));
};

const dividaDoCliente = (cliente) => ({
  centavos: inteiro(cliente && cliente.cashback && cliente.cashback.dividaCentavos),
  pontos: inteiro(cliente && cliente.cashback && cliente.cashback.dividaPontos),
});

/** Regrava o resumo do cliente a partir dos lotes (ja' com as mudancas desta transacao). */
const gravarResumo = (tx, clienteRef, modelo, lotes, divida, hoje, maisCampos = {}) => {
  const resumo = cb.resumoDosLotes(lotes, hoje, divida);
  tx.set(clienteRef, {
    ...maisCampos,
    cashback: { modelo, ...resumo, atualizadoEm: agora() },
    updatedAt: agora(),
  }, { merge: true });
  return resumo;
};

/** Lotes como o dominio le (ordem de criacao para o desempate do "vence antes, sai antes"). */
const lotesParaUso = (lotes) => lotes.map((l, posicao) => ({
  id: l.id,
  centavos: inteiro(l.dados.centavos),
  pontos: inteiro(l.dados.pontos),
  restanteCentavos: inteiro(l.dados.restanteCentavos),
  restantePontos: inteiro(l.dados.restantePontos),
  validade: l.dados.validade || null,
  estornado: l.dados.estornado === true,
  ordem: l.dados.createdAt && typeof l.dados.createdAt.toMillis === 'function' ? l.dados.createdAt.toMillis() : posicao,
}));

// ---------------------------------------------------------------------------
// Gerar
// ---------------------------------------------------------------------------

const gerarSeDevido = async ({ user, tenantId, pedidoId }) => {
  const id = texto(pedidoId);
  if (!id) throw new ErroCashback(400, 'Venda não informada.');
  const hoje = getDateInputInTimeZone();

  const resultado = await db.runTransaction(async (tx) => {
    // ---- leituras ----
    const vendaSnap = await tx.get(db.collection('pedidos_venda').doc(id));
    if (!vendaSnap.exists || vendaSnap.data().tenantId !== tenantId) return { gerado: false, motivo: 'venda não encontrada' };
    const venda = vendaSnap.data();
    if (!vendaEstaPaga(venda)) return { gerado: false, motivo: 'venda ainda não está paga por inteiro' };
    const clienteId = texto(venda.clienteId);
    if (!clienteId) return { gerado: false, motivo: 'venda sem cliente' };
    const config = await lerConfig(tx, tenantId);
    if (!config.ativo) return { gerado: false, motivo: 'cashback desligado' };
    const loteSnap = await tx.get(refLote(id));
    if (loteSnap.exists) return { gerado: false, jaGerado: true, motivo: 'esta venda já gerou cashback' };
    const clienteRef = db.collection('clientes').doc(clienteId);
    const clienteSnap = await tx.get(clienteRef);
    if (!clienteSnap.exists || clienteSnap.data().tenantId !== tenantId || clienteSnap.data().isPadrao === true) {
      return { gerado: false, motivo: 'consumidor final não acumula cashback' };
    }
    const cliente = clienteSnap.data();
    const ids = [...new Set((venda.itens || []).map((i) => i && i.id).filter((x) => x && x !== 'avulso'))];
    const produtos = {};
    (ids.length ? await tx.getAll(...ids.map((pid) => db.collection('estoque').doc(String(pid)))) : []).forEach((s) => {
      if (s.exists && s.data().tenantId === tenantId) produtos[s.id] = s.data();
    });
    const lotes = await lotesDoCliente(tx, tenantId, clienteId);

    // ---- calculo ----
    const itens = itensDaVenda(venda, produtos);
    const gerado = cb.cashbackDaVenda(config, itens, fatorDaBase(venda, itens));
    if (gerado.centavos <= 0 && gerado.pontos <= 0) return { gerado: false, motivo: 'nenhum item da venda gera cashback' };
    const divida = dividaDoCliente(cliente);
    const comDivida = cb.novoLoteComDivida(gerado, divida);
    const validade = cb.validadeDoCashback(config, hoje);

    // ---- escritas ----
    const lote = {
      tenantId,
      clienteId,
      clienteNome: String(venda.clienteNome || cliente.nome || ''),
      tipo: 'gerado',
      modelo: config.modelo,
      centavos: gerado.centavos,
      pontos: gerado.pontos,
      restanteCentavos: comDivida.restanteCentavos,
      restantePontos: comDivida.restantePontos,
      // O que o cliente ja' gastou deste lote (a venda que usa soma aqui): no
      // estorno total, e' isto que vira divida -- o que saiu por devolucao nao.
      usadoCentavos: 0,
      usadoPontos: 0,
      // Divida abatida por este lote (so' informacao; a divida que sobra fica no cliente).
      abatidoDaDividaCentavos: gerado.centavos - comDivida.restanteCentavos,
      abatidoDaDividaPontos: gerado.pontos - comDivida.restantePontos,
      validade,
      estornado: false,
      pedidoId: id,
      numeroPedido: String(venda.numeroPedido || ''),
      porItem: gerado.porItem,
      descricao: `Cashback da venda #${venda.numeroPedido || ''}`,
      createdAt: agora(),
      criadoPor: user ? user.uid : 'servidor',
    };
    tx.set(refLote(id), lote);
    const resumo = gravarResumo(tx, clienteRef, config.modelo, [...lotes.map((l) => l.dados), lote], comDivida.divida, hoje);
    return { gerado: true, modelo: config.modelo, centavos: gerado.centavos, pontos: gerado.pontos, validade, resumo, clienteId, numeroPedido: lote.numeroPedido, clienteNome: lote.clienteNome };
  });

  if (resultado.gerado) {
    registrarLog({ ...(user || { uid: 'servidor' }), tenantId }, {
      modulo: 'cashback',
      acao: 'criacao',
      descricao: `Cashback gerado para ${resultado.clienteNome}: ${cb.formatarCashback(resultado.modelo, resultado.centavos, resultado.pontos)} (venda #${resultado.numeroPedido})${resultado.validade ? `, válido até ${resultado.validade}` : ''}.`,
      registroId: id,
    });
  }
  return resultado;
};

// ---------------------------------------------------------------------------
// Estornar (venda cancelada / baixa estornada / devolucao)
// ---------------------------------------------------------------------------

/** Tira do lote da venda `parte` (ou tudo); o que ja' foi gasto vira divida. */
const abaterDaVenda = async ({ user, tenantId, pedidoId, parte, motivo, idMovimento }) => {
  const id = texto(pedidoId);
  if (!id) throw new ErroCashback(400, 'Venda não informada.');
  const hoje = getDateInputInTimeZone();

  const resultado = await db.runTransaction(async (tx) => {
    const loteSnap = await tx.get(refLote(id));
    if (!loteSnap.exists || loteSnap.data().tenantId !== tenantId) return { estornado: false, motivo: 'a venda não gerou cashback' };
    const lote = loteSnap.data();
    if (lote.estornado === true) return { estornado: false, motivo: 'o cashback desta venda já foi estornado' };
    const movimentoRef = db.collection('cashback_movimentos').doc(idMovimento);
    if ((await tx.get(movimentoRef)).exists) return { estornado: false, motivo: 'este estorno já foi feito' };
    const clienteRef = db.collection('clientes').doc(String(lote.clienteId));
    const clienteSnap = await tx.get(clienteRef);
    const cliente = clienteSnap.exists ? clienteSnap.data() : {};
    const lotes = await lotesDoCliente(tx, tenantId, String(lote.clienteId));

    // Estorno total tira o que sobra e cobra o que foi usado; parte (devolucao) tira so' a proporcao.
    const total = parte
      ? parte(lote)
      : { centavos: inteiro(lote.restanteCentavos) + inteiro(lote.usadoCentavos), pontos: inteiro(lote.restantePontos) + inteiro(lote.usadoPontos) };
    if (total.centavos <= 0 && total.pontos <= 0) return { estornado: false, motivo: 'nada a estornar' };
    const abatido = cb.abaterDoLote({
      centavos: inteiro(lote.centavos), pontos: inteiro(lote.pontos),
      restanteCentavos: inteiro(lote.restanteCentavos), restantePontos: inteiro(lote.restantePontos), validade: lote.validade || null,
    }, total.centavos, total.pontos);
    const dividaAntes = dividaDoCliente(cliente);
    const divida = { centavos: dividaAntes.centavos + abatido.dividaExtra.centavos, pontos: dividaAntes.pontos + abatido.dividaExtra.pontos };
    const tudo = !parte;

    tx.update(refLote(id), {
      restanteCentavos: abatido.restanteCentavos,
      restantePontos: abatido.restantePontos,
      ...(tudo ? { estornado: true, estornadoEm: agora(), estornoMotivo: motivo } : {}),
      updatedAt: agora(),
    });
    tx.set(movimentoRef, {
      tenantId,
      clienteId: lote.clienteId,
      clienteNome: lote.clienteNome || '',
      tipo: 'estornado',
      modelo: lote.modelo,
      centavos: total.centavos,
      pontos: total.pontos,
      viraramDividaCentavos: abatido.dividaExtra.centavos,
      viraramDividaPontos: abatido.dividaExtra.pontos,
      pedidoId: id,
      numeroPedido: lote.numeroPedido || '',
      descricao: `${motivo} (venda #${lote.numeroPedido || ''})`,
      createdAt: agora(),
      criadoPor: user ? user.uid : 'servidor',
    });
    const lotesAtualizados = lotes.map((l) => (l.id === refLote(id).id
      ? { ...l.dados, restanteCentavos: abatido.restanteCentavos, restantePontos: abatido.restantePontos, estornado: tudo || l.dados.estornado === true }
      : l.dados));
    const resumo = gravarResumo(tx, clienteRef, lote.modelo, lotesAtualizados, divida, hoje);
    return { estornado: true, modelo: lote.modelo, ...total, viraramDivida: abatido.dividaExtra, resumo, clienteNome: lote.clienteNome || '', numeroPedido: lote.numeroPedido || '' };
  });

  if (resultado.estornado) {
    registrarLog({ ...(user || { uid: 'servidor' }), tenantId }, {
      modulo: 'cashback',
      acao: 'estorno',
      descricao: `${motivo}: ${cb.formatarCashback(resultado.modelo, resultado.centavos, resultado.pontos)} de ${resultado.clienteNome} (venda #${resultado.numeroPedido})`
        + (resultado.viraramDivida.centavos > 0 || resultado.viraramDivida.pontos > 0
          ? `; ${cb.formatarCashback(resultado.modelo, resultado.viraramDivida.centavos, resultado.viraramDivida.pontos)} já tinham sido usados e ficaram como saldo negativo.`
          : '.'),
      registroId: id,
    });
  }
  return resultado;
};

/** Venda cancelada: estorna o que ela GEROU e devolve o que ela USOU (os dois idempotentes). */
const estornarVenda = async ({ user, tenantId, pedidoId, motivo = 'Cashback estornado: venda cancelada' }) => {
  const gerado = await abaterDaVenda({ user, tenantId, pedidoId, parte: null, motivo, idMovimento: `estornado_${texto(pedidoId)}` });
  const uso = await devolverUso({ user, tenantId, pedidoId });
  return { ...gerado, uso };
};

/** Baixa estornada: se a venda deixou de estar paga, o lote inteiro volta. */
const revisarAposEstorno = async ({ user, tenantId, pedidoId }) => {
  const id = texto(pedidoId);
  if (!id) return { estornado: false, motivo: 'venda não informada' };
  const vendaSnap = await db.collection('pedidos_venda').doc(id).get();
  if (!vendaSnap.exists || vendaSnap.data().tenantId !== tenantId) return { estornado: false, motivo: 'venda não encontrada' };
  if (vendaEstaPaga(vendaSnap.data())) return { estornado: false, motivo: 'a venda continua paga' };
  return abaterDaVenda({ user, tenantId, pedidoId: id, parte: null, motivo: 'Cashback estornado: recebimento da venda estornado', idMovimento: `estornado_baixa_${id}` });
};

const estornarDevolucao = async ({ user, tenantId, devolucaoId }) => {
  const id = texto(devolucaoId);
  if (!id) throw new ErroCashback(400, 'Devolução não informada.');
  const devSnap = await db.collection('devolucoes_venda').doc(id).get();
  if (!devSnap.exists || devSnap.data().tenantId !== tenantId) throw new ErroCashback(404, 'Devolução não encontrada. Atualize a tela.');
  const dev = devSnap.data();
  const pedidoId = texto(dev.pedidoVendaId || dev.pedidoOrigemId);
  if (!pedidoId) return { estornado: false, motivo: 'devolução sem venda de origem' };
  const vendaSnap = await db.collection('pedidos_venda').doc(pedidoId).get();
  const totalVenda = vendaSnap.exists ? totalDaVendaCentavos(vendaSnap.data()) : 0;
  const devolvido = inteiro(dev.valorTotalDevolvidoCentavos ?? fin.toCents(Number(dev.valorTotalDevolvido || 0)));
  return abaterDaVenda({
    user,
    tenantId,
    pedidoId,
    parte: (lote) => cb.parteProporcional({ centavos: inteiro(lote.centavos), pontos: inteiro(lote.pontos) }, devolvido, totalVenda),
    motivo: 'Cashback estornado: devolução de mercadoria',
    idMovimento: `estornado_devolucao_${id}`,
  });
};

// ---------------------------------------------------------------------------
// Usar como forma de pagamento (fase 2, 20/10/2026) -- na transacao da venda
// ---------------------------------------------------------------------------

/**
 * Fase de LEITURAS da transacao da venda: confere o pagamento "Cashback"
 * contra o saldo do cliente (lido aqui dentro) e monta o plano de consumo.
 * Erros sobem como ErroCashback, com status e texto para a tela.
 */
const prepararUso = async ({ tx, tenantId, clienteId, config, totalCentavos, valorCentavos, hoje }) => {
  const id = texto(clienteId);
  const semCliente = 'Cashback só pode ser usado com o cliente cadastrado escolhido.';
  if (!id) throw new ErroCashback(400, semCliente);
  const clienteRef = db.collection('clientes').doc(id);
  const clienteSnap = await tx.get(clienteRef);
  if (!clienteSnap.exists || clienteSnap.data().tenantId !== tenantId) throw new ErroCashback(400, semCliente);
  const cliente = clienteSnap.data();
  if (cliente.isPadrao === true) throw new ErroCashback(400, 'Consumidor final não tem cashback. Escolha o cliente cadastrado ou troque a forma de pagamento.');
  const lotes = await lotesDoCliente(tx, tenantId, id);
  const divida = dividaDoCliente(cliente);
  const paraUso = lotesParaUso(lotes);
  const resumo = { modelo: config.modelo, ...cb.resumoDosLotes(paraUso, hoje, divida) };
  const conferido = cb.conferirPagamentoComCashback(config, resumo, totalCentavos, valorCentavos);
  if (!conferido.ok) throw new ErroCashback(409, conferido.erro);
  const plano = cb.planoDeUso(paraUso, divida, conferido, hoje);
  if (!plano.ok) throw new ErroCashback(409, plano.erro);
  return {
    clienteRef, clienteId: id, cliente, lotes, divida, consumos: plano.consumos, centavos: conferido.centavos, pontos: conferido.pontos, modelo: config.modelo,
  };
};

/**
 * Fase de ESCRITAS da mesma transacao: baixa os lotes, grava o movimento
 * `usado_{venda}` e o resumo do cliente. `maisCamposDoCliente` entra na mesma
 * escrita do cliente (ex.: a versao do credito), para o documento dele receber
 * uma escrita so' na transacao.
 */
const gravarUso = ({ tx, user, tenantId, pedidoId, numeroPedido, clienteNome, preparado, hoje, maisCamposDoCliente = {} }) => {
  const porLote = new Map(preparado.consumos.map((c) => [c.id, c]));
  const lotesAtualizados = preparado.lotes.map((l) => {
    const c = porLote.get(l.id);
    if (!c) return l.dados;
    const campos = {
      restanteCentavos: inteiro(l.dados.restanteCentavos) - c.centavos,
      restantePontos: inteiro(l.dados.restantePontos) - c.pontos,
      usadoCentavos: inteiro(l.dados.usadoCentavos) + c.centavos,
      usadoPontos: inteiro(l.dados.usadoPontos) + c.pontos,
    };
    tx.update(l.ref, { ...campos, updatedAt: agora() });
    return { ...l.dados, ...campos };
  });
  tx.set(refUso(pedidoId), {
    tenantId,
    clienteId: preparado.clienteId,
    clienteNome: String(clienteNome || preparado.cliente.nome || ''),
    tipo: 'usado',
    modelo: preparado.modelo,
    centavos: preparado.centavos,
    pontos: preparado.pontos,
    porLote: preparado.consumos,
    pedidoId,
    numeroPedido: String(numeroPedido || ''),
    descricao: `Cashback usado na venda #${numeroPedido || ''}`,
    createdAt: agora(),
    criadoPor: user ? user.uid : 'servidor',
  });
  return gravarResumo(tx, preparado.clienteRef, preparado.modelo, lotesAtualizados, preparado.divida, hoje, maisCamposDoCliente);
};

/**
 * A venda que usou cashback foi cancelada: o que saiu de cada lote volta
 * (lote ja' estornado: a divida diminui). Idempotente (`devolvido_{venda}`).
 */
const devolverUso = async ({ user, tenantId, pedidoId }) => {
  const id = texto(pedidoId);
  if (!id) throw new ErroCashback(400, 'Venda não informada.');
  const hoje = getDateInputInTimeZone();

  const resultado = await db.runTransaction(async (tx) => {
    const usoSnap = await tx.get(refUso(id));
    if (!usoSnap.exists || usoSnap.data().tenantId !== tenantId) return { devolvido: false, motivo: 'a venda não usou cashback' };
    const uso = usoSnap.data();
    const devolvidoRef = db.collection('cashback_movimentos').doc(`devolvido_${id}`);
    if ((await tx.get(devolvidoRef)).exists) return { devolvido: false, motivo: 'o cashback desta venda já foi devolvido' };
    const clienteId = String(uso.clienteId || '');
    const clienteRef = db.collection('clientes').doc(clienteId);
    const clienteSnap = await tx.get(clienteRef);
    const cliente = clienteSnap.exists ? clienteSnap.data() : {};
    const lotes = await lotesDoCliente(tx, tenantId, clienteId);
    const modelo = uso.modelo === 'pontos' ? 'pontos' : 'reais';

    const porLote = new Map((Array.isArray(uso.porLote) ? uso.porLote : []).map((c) => [String(c.id), c]));
    let divida = dividaDoCliente(cliente);
    const lotesAtualizados = lotes.map((l) => {
      const c = porLote.get(l.id);
      if (!c) return l.dados;
      const r = cb.devolucaoDoUso({
        restanteCentavos: inteiro(l.dados.restanteCentavos),
        restantePontos: inteiro(l.dados.restantePontos),
        usadoCentavos: inteiro(l.dados.usadoCentavos),
        usadoPontos: inteiro(l.dados.usadoPontos),
        estornado: l.dados.estornado === true,
      }, { id: l.id, centavos: inteiro(c.centavos), pontos: inteiro(c.pontos) }, divida);
      divida = r.divida;
      tx.update(l.ref, { ...r.lote, updatedAt: agora() });
      return { ...l.dados, ...r.lote };
    });
    tx.set(devolvidoRef, {
      tenantId,
      clienteId,
      clienteNome: uso.clienteNome || '',
      tipo: 'ajuste',
      modelo,
      centavos: inteiro(uso.centavos),
      pontos: inteiro(uso.pontos),
      pedidoId: id,
      numeroPedido: uso.numeroPedido || '',
      descricao: `Cashback devolvido: venda #${uso.numeroPedido || ''} cancelada`,
      createdAt: agora(),
      criadoPor: user ? user.uid : 'servidor',
    });
    const resumo = gravarResumo(tx, clienteRef, modelo, lotesAtualizados, divida, hoje);
    return { devolvido: true, modelo, centavos: inteiro(uso.centavos), pontos: inteiro(uso.pontos), resumo, clienteNome: uso.clienteNome || '', numeroPedido: uso.numeroPedido || '' };
  });

  if (resultado.devolvido) {
    registrarLog({ ...(user || { uid: 'servidor' }), tenantId }, {
      modulo: 'cashback',
      acao: 'estorno',
      descricao: `Cashback devolvido para ${resultado.clienteNome}: ${cb.formatarCashback(resultado.modelo, resultado.centavos, resultado.pontos)} (venda #${resultado.numeroPedido} cancelada).`,
      registroId: id,
    });
  }
  return resultado;
};

// ---------------------------------------------------------------------------
// Versoes "sem falhar": chamadas depois da transacao da venda/baixa
// ---------------------------------------------------------------------------

const semFalhar = (nome, fn) => (args) => fn(args).catch((erro) => {
  console.error(`[Cashback] ${nome} (${args && args.pedidoId ? `venda ${args.pedidoId}` : ''}):`, erro && erro.message);
  return { erro: erro && erro.message };
});

module.exports = {
  ErroCashback,
  FORMA_CASHBACK,
  gerarSeDevido,
  estornarVenda,
  revisarAposEstorno,
  estornarDevolucao,
  prepararUso,
  gravarUso,
  devolverUso,
  gerarSeDevidoSemFalhar: semFalhar('gerar', gerarSeDevido),
  estornarVendaSemFalhar: semFalhar('estornar venda', estornarVenda),
  revisarAposEstornoSemFalhar: semFalhar('revisar após estorno', revisarAposEstorno),
  // expostos pros testes
  vendaEstaPaga,
  fatorDaBase,
  itensDaVenda,
};
