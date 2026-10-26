/*
 * MOVIMENTACAO DE PRODUTOS (26/10/2026, pedido do dono).
 *
 * Monta as entradas e saidas de estoque, materia-prima e insumo a partir dos
 * documentos ja' gravados -- regra em domain/movimentosEstoqueDomain (compilado
 * de src/utils/movimentosEstoqueDomain.ts). So' leitura.
 *
 * Leituras por periodo onde ha' indice (tenantId + data); onde nao ha' (devolucoes,
 * entregas futuras, cancelamentos e producoes finalizadas) le por empresa/situacao
 * e corta pela data aqui. Extrato de um item: le ate' hoje para o saldo de cada linha.
 */
const { db } = require('../config/firebase');
const md = require('../domain/movimentosEstoqueDomain');
const { getDateInputInTimeZone } = require('../domain/dateTime');

/** Timestamp do Firestore, ISO ou Date -> ms (null quando nao ha' data). */
const ms = (v) => {
  if (!v) return null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'object' && typeof v._seconds === 'number') return v._seconds * 1000;
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
  return null;
};

const docs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
const porEmpresa = (colecao, tenantId) => db.collection(colecao).where('tenantId', '==', tenantId);

/** Le os documentos de cada origem que podem ter movimento no intervalo. */
const lerOrigens = async ({ tenantId, de, ateYmd, inicioTs, fimTs }) => {
  const [
    pedidosNoPeriodo, pedidosCancelados, devolucoesVenda, osNoPeriodo, entregasFuturas,
    notasEntrada, notasEntradaExcluidas, notasAvulsas, notasAvulsasCanceladas,
    devolucoesCompra, producoesFinalizadas, producoesEstornadas, ajustes,
  ] = await Promise.all([
    porEmpresa('pedidos_venda', tenantId).where('dataVenda', '>=', de).where('dataVenda', '<=', ateYmd).get(),
    porEmpresa('pedidos_venda', tenantId).where('status', '==', 'Cancelada').get(),
    porEmpresa('devolucoes_venda', tenantId).get(),
    porEmpresa('ordens_de_servico', tenantId).where('dataSaida', '>=', de).where('dataSaida', '<=', ateYmd).get(),
    porEmpresa('entregas_futuras', tenantId).get(),
    porEmpresa('notas_fiscais_entrada', tenantId).where('createdAt', '>=', inicioTs).where('createdAt', '<=', fimTs).get(),
    porEmpresa('notas_fiscais_entrada', tenantId).where('status', '==', 'excluida').get(),
    porEmpresa('notas_avulsas', tenantId).where('createdAt', '>=', inicioTs).where('createdAt', '<=', fimTs).get(),
    porEmpresa('notas_avulsas', tenantId).where('status', '==', 'cancelada').get(),
    porEmpresa('devolucoes_compra', tenantId).get(),
    porEmpresa('ordens_producao', tenantId).where('status', '==', 'finalizada').get(),
    porEmpresa('ordens_producao', tenantId).where('status', '==', 'estornada').get(),
    porEmpresa('ajustes_estoque', tenantId).where('createdAt', '>=', inicioTs).where('createdAt', '<=', fimTs).get(),
  ]);

  const unicos = (...snaps) => {
    const mapa = new Map();
    snaps.forEach((s) => docs(s).forEach((d) => mapa.set(d.id, d)));
    return [...mapa.values()];
  };

  const linhas = [];
  unicos(pedidosNoPeriodo, pedidosCancelados).forEach((p) => linhas.push(...md.movimentosDoPedido({ ...p, canceladaEmMillis: ms(p.canceladaEm) })));
  docs(devolucoesVenda).forEach((d) => linhas.push(...md.movimentosDaDevolucaoVenda({ ...d, createdAtMillis: ms(d.createdAt), estornadaEmMillis: ms(d.estornadaEm) })));
  docs(osNoPeriodo).forEach((o) => linhas.push(...md.movimentosDaOS({ ...o, finalizadaEmMillis: ms(o.finalizadaEm) })));
  docs(entregasFuturas).forEach((e) => linhas.push(...md.movimentosDaEntregaFutura({ ...e, createdAtMillis: ms(e.createdAt) ?? ms(e.criadoEmIso) })));
  unicos(notasEntrada, notasEntradaExcluidas).forEach((n) => linhas.push(...md.movimentosDaNotaEntrada({ ...n, createdAtMillis: ms(n.createdAt), alteradoEmMillis: ms(n.alteradoEm) ?? ms(n.updatedAt) })));
  unicos(notasAvulsas, notasAvulsasCanceladas).forEach((n) => linhas.push(...md.movimentosDaNotaAvulsa({ ...n, createdAtMillis: ms(n.createdAt), canceladoEmMillis: ms(n.canceladoEm) })));
  docs(devolucoesCompra).forEach((d) => linhas.push(...md.movimentosDaDevolucaoCompra({ ...d, createdAtMillis: ms(d.createdAt) })));
  unicos(producoesFinalizadas, producoesEstornadas).forEach((o) => linhas.push(...md.movimentosDaProducao({ ...o, dataFimMillis: ms(o.dataFim), dataEstornoMillis: ms(o.dataEstorno) })));
  docs(ajustes).forEach((a) => linhas.push(...md.movimentosDoAjuste({ ...a, createdAtMillis: ms(a.createdAt) })));
  return linhas;
};

/** Le documentos pelo id, de 100 em 100. */
const lerPorIds = async (colecao, ids) => {
  const mapa = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const lote = ids.slice(i, i + 100);
    const snaps = typeof db.getAll === 'function'
      ? await db.getAll(...lote.map((id) => db.collection(colecao).doc(id)))
      : await Promise.all(lote.map((id) => db.collection(colecao).doc(id).get()));
    snaps.forEach((s) => { if (s.exists) mapa.set(s.id, s.data()); });
  }
  return mapa;
};

const TIPO_DA_COLECAO = { materias_primas: 'materia_prima', insumos: 'insumo' };

/** Codigo, nome, unidade, categoria, tipo e saldo atual de cada item que aparece. */
const montarItens = async (tenantId, movimentos) => {
  const idsPorColecao = { estoque: new Set(), materias_primas: new Set(), insumos: new Set() };
  movimentos.forEach((m) => idsPorColecao[m.colecao].add(m.itemId));
  const idsEstoque = [...idsPorColecao.estoque];
  const [estoque, materias, insumos, receitas] = await Promise.all([
    lerPorIds('estoque', idsEstoque),
    lerPorIds('materias_primas', [...idsPorColecao.materias_primas]),
    lerPorIds('insumos', [...idsPorColecao.insumos]),
    lerPorIds('produtos_composicao', idsEstoque),
  ]);
  const cadastro = { estoque, materias_primas: materias, insumos };
  // Saiu de ordem de producao no periodo = produto que a fabrica produz, mesmo sem receita hoje.
  const produzidos = new Set(movimentos.filter((m) => m.origem === 'producao_entrada').map((m) => m.itemId));
  const nomeNoMovimento = new Map(movimentos.map((m) => [md.chaveDoItem(m.colecao, m.itemId), m.itemNome]));
  const itens = {};
  Object.entries(idsPorColecao).forEach(([colecao, ids]) => {
    ids.forEach((id) => {
      const chave = md.chaveDoItem(colecao, id);
      const doc = cadastro[colecao].get(id);
      // Cadastro de outra empresa nunca entra (id igual por acaso).
      const valido = doc && (!doc.tenantId || doc.tenantId === tenantId) ? doc : null;
      const receita = colecao === 'estoque' ? receitas.get(id) : null;
      const temReceita = Boolean(receita && Array.isArray(receita.itens) && receita.itens.length > 0);
      const tipo = colecao === 'estoque' ? md.tipoDoProdutoDoEstoque(valido || {}, temReceita, produzidos.has(id)) : TIPO_DA_COLECAO[colecao];
      const unidade = colecao === 'estoque' ? (valido?.unidadeMedidaSigla || 'UN') : (valido?.unidade || 'UN');
      const casas = Number.isInteger(valido?.unidadeMedidaCasasDecimais) ? valido.unidadeMedidaCasasDecimais : (colecao === 'estoque' ? 0 : 3);
      itens[chave] = {
        chave, colecao, id,
        nome: String(valido?.nome || nomeNoMovimento.get(chave) || '(cadastro apagado)'),
        codigo: valido?.codigo !== undefined && valido?.codigo !== null ? String(valido.codigo) : '',
        unidade,
        categoria: String(valido?.categoria || ''),
        tipo,
        casasDecimais: casas,
        saldoAtual: Number(valido?.quantidade || 0),
      };
    });
  });
  return itens;
};

/**
 * Movimentos do periodo (mais novos primeiro) + os itens. Com `itemId`: so' o item
 * e o extrato dele com saldo antes/depois.
 */
const consultar = async ({ tenantId, de, ate, itemId, colecao }) => {
  const hoje = getDateInputInTimeZone();
  const fimDaLeitura = itemId && ate < hoje ? hoje : ate;
  const inicioMs = md.inicioDoDiaMillis(de);
  const fimMs = md.fimDoDiaMillis(fimDaLeitura);
  // Date serve nas comparacoes com Timestamp (o Admin SDK converte).
  const todas = await lerOrigens({
    tenantId, de, ateYmd: fimDaLeitura,
    inicioTs: new Date(inicioMs), fimTs: new Date(fimMs),
  });
  const vistos = new Set();
  let movimentos = todas.filter((m) => {
    if (m.dataMillis < inicioMs || m.dataMillis > fimMs || vistos.has(m.id)) return false;
    vistos.add(m.id);
    return !itemId || (m.colecao === colecao && m.itemId === itemId);
  });

  if (itemId) {
    const itens = await montarItens(tenantId, movimentos.length > 0 ? movimentos : [{ colecao, itemId, itemNome: '' }]);
    const item = itens[md.chaveDoItem(colecao, itemId)];
    const extrato = md.extratoDoItem(movimentos, item ? item.saldoAtual : 0, md.fimDoDiaMillis(ate));
    return { itens, extrato: { ...extrato, linhas: md.ordenarMovimentos(extrato.linhas) }, movimentos: [] };
  }

  movimentos = md.ordenarMovimentos(movimentos);
  const itens = await montarItens(tenantId, movimentos);
  return { movimentos, itens };
};

module.exports = { consultar };
