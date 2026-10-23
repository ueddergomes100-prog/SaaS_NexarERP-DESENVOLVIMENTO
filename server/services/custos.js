/*
 * CUSTOS E FORMACAO DE PRECO (item 6 do dono, 23/10/2026).
 *
 * Regra em domain/custosDomain (compilado de src/utils/custosDomain.ts).
 * Aqui so': ler/gravar a configuracao (colecao `custos_empresa/{empresa}`,
 * so' do servidor), ler os lancamentos PAGOS dos 3 ultimos meses fechados
 * (indice tenantId+status+dataPagamento, o mesmo do Dashboard) e simular os
 * produtos do estoque. Nunca grava preco em produto.
 */
const { admin, db } = require('../config/firebase');
const cu = require('../domain/custosDomain');
const { ehProdutoComGrade } = require('../domain/gradeProdutosDomain');
const { getDateInputInTimeZone } = require('../domain/dateTime');
const { buildDocumentUpdateMetadata } = require('../domain/documentMetadata');

class ErroCustos extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const COLECAO = 'custos_empresa';
const agora = () => admin.firestore.FieldValue.serverTimestamp();

const lerConfig = async (tenantId) => {
  const snap = await db.collection(COLECAO).doc(tenantId).get();
  const lido = cu.lerConfigCustos(snap.exists ? snap.data() : {});
  return 'config' in lido ? lido.config : cu.CONFIG_CUSTOS_PADRAO;
};

const categoriasDoPlano = async (tenantId) => {
  const snap = await db.collection('configuracoes').doc(tenantId).get();
  const plano = snap.exists ? snap.data().planoContasDespesas : null;
  const lista = Array.isArray(plano) ? plano : String(plano || '').split('\n');
  return lista.map((c) => String(c || '').trim()).filter(Boolean);
};

/** Lancamentos pagos dos meses (entradas e saidas), so' os campos que a conta usa. */
const lancamentosPagos = async (tenantId, meses) => {
  const { de, ate } = cu.periodoDosMeses(meses);
  const snap = await db.collection('transacoes')
    .where('tenantId', '==', tenantId)
    .where('status', '==', 'Paga')
    .where('dataPagamento', '>=', de)
    .where('dataPagamento', '<=', ate)
    .get();
  return snap.docs.map((d) => {
    const t = d.data();
    return {
      tipo: t.tipo, status: t.status, categoria: t.categoria, sourceType: t.sourceType, formaPagamento: t.formaPagamento,
      estornada: t.estornada, statusOperacional: t.statusOperacional, dataPagamento: t.dataPagamento, data: t.data,
      valor: t.valor, valorCentavos: t.valorCentavos, valorLiquidoCentavos: t.valorLiquidoCentavos, valorOriginalCentavos: t.valorOriginalCentavos,
      cartao: t.cartao,
    };
  });
};

/** Tudo da tela: configuracao, resumo dos 3 meses e as categorias do plano de contas. */
const carregar = async ({ tenantId }) => {
  const meses = cu.mesesFechados(getDateInputInTimeZone());
  const [config, lancamentos, plano] = await Promise.all([lerConfig(tenantId), lancamentosPagos(tenantId, meses), categoriasDoPlano(tenantId)]);
  const resumo = cu.resumirCustos(lancamentos, config, meses);
  // Categorias para marcar: as do plano + as que apareceram nos pagamentos.
  // Sem repetir por maiuscula/minuscula: vale o nome do plano de contas.
  const vistas = new Set();
  const categorias = [...plano, ...resumo.categorias.map((c) => c.categoria)].filter((c) => {
    const chave = c.toUpperCase();
    if (vistas.has(chave)) return false;
    vistas.add(chave);
    return true;
  });
  return { config, resumo, categorias };
};

const salvar = async ({ user, tenantId, corpo }) => {
  const lido = cu.lerConfigCustos(corpo);
  if ('erro' in lido) throw new ErroCustos(400, lido.erro);
  await db.collection(COLECAO).doc(tenantId).set({
    tenantId,
    ...lido.config,
    updatedAt: agora(),
    ...buildDocumentUpdateMetadata(user.uid, agora(), 'Custos e formação de preço atualizados'),
  });
  return carregar({ tenantId });
};

const num = (v) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Simulacao de todos os produtos ativos (variacao de grade conta; o principal nao). */
const simular = async ({ tenantId }) => {
  const meses = cu.mesesFechados(getDateInputInTimeZone());
  const [config, lancamentos, produtosSnap] = await Promise.all([
    lerConfig(tenantId),
    lancamentosPagos(tenantId, meses),
    db.collection('estoque').where('tenantId', '==', tenantId).get(),
  ]);
  const resumo = cu.resumirCustos(lancamentos, config, meses);
  const rateio = resumo.rateioPercentual ?? 0;
  const linhas = produtosSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((p) => p.statusAtivo !== false && !ehProdutoComGrade(p) && p.produtoRevenda !== false)
    .map((p) => cu.simularProduto({
      id: p.id,
      nome: String(p.nome || ''),
      codigo: String(p.codigo || ''),
      grupo: String(p.categoria || '').trim().toUpperCase(),
      custo: num(p.precoCusto) || 0,
      preco: num(p.precoVenda) || 0,
      comissaoPercentual: num(p.comissaoPercentual ?? (p.precos && p.precos.comissaoPercentual)),
    }, config, rateio))
    .sort((a, b) => a.nome.localeCompare(b.nome));
  return { rateioPercentual: resumo.rateioPercentual, linhas };
};

module.exports = { ErroCustos, carregar, salvar, simular, COLECAO };
