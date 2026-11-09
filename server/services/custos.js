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
const { diferencasEntre } = require('../domain/historicoAlteracoesDomain');
const { registrarLog } = require('./auditoria');

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

// ---------------------------------------------------------------------------
// HISTORICO DE ALTERACOES (09/11/2026): o que mudou na configuracao de custos.
// ---------------------------------------------------------------------------
const reais = (centavos) => ((Number(centavos) || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (v) => `${(Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const CAMPOS_DOS_CUSTOS = [
  { campo: 'impostoPercentual', rotulo: 'Impostos sobre a venda', formatar: pct },
  { campo: 'comissaoPercentual', rotulo: 'Comissão', formatar: pct },
  { campo: 'taxasPercentual', rotulo: 'Taxas e outras despesas variáveis', formatar: pct },
  { campo: 'margemPadrao', rotulo: 'Margem padrão', formatar: pct },
  { campo: 'faturamentoManualCentavos', rotulo: 'Faturamento médio informado', formatar: (v) => (v === null || v === undefined ? 'Calculado pelo sistema' : reais(v)) },
  { campo: 'categoriasFixas', rotulo: 'Categorias de despesa fixa', formatar: (v) => (Array.isArray(v) ? [...v].sort((a, b) => String(a).localeCompare(String(b), 'pt-BR')).join(', ') : '') },
  { campo: 'ajustes', rotulo: 'Despesas lançadas à mão', formatar: (v) => (Array.isArray(v) ? v.map((a) => `${a.descricao} ${reais(a.valorCentavos)}`).join('; ') : '') },
  {
    campo: 'bens',
    rotulo: 'Bens (depreciação)',
    formatar: (v) => (Array.isArray(v) ? v.map((b) => `${b.nome} ${reais(b.valorCentavos)}, ${b.vidaUtilAnos} ano(s)${b.ativo === false ? ' (fora de uso)' : ''}`).join('; ') : ''),
  },
];

/** Margens por grupo e por produto, chave a chave ("Margem do grupo RACAO: 20% -> 25%"). */
const mudancasDasMargens = (antes, depois, rotulo) => {
  const a = antes || {};
  const d = depois || {};
  return [...new Set([...Object.keys(a), ...Object.keys(d)])]
    .filter((k) => a[k] !== d[k])
    .map((k) => ({ chave: k, rotulo: rotulo(k), valorAnterior: k in a ? pct(a[k]) : null, valorNovo: k in d ? pct(d[k]) : null }));
};

const registrarAlteracaoDosCustos = async (user, tenantId, antes, depois) => {
  try {
    const alteracoes = diferencasEntre(antes, depois, CAMPOS_DOS_CUSTOS);
    mudancasDasMargens(antes.margensPorGrupo, depois.margensPorGrupo, (k) => `Margem do grupo ${k}`)
      .forEach((m) => alteracoes.push({ campo: m.rotulo, valorAnterior: m.valorAnterior, valorNovo: m.valorNovo }));
    const porProduto = mudancasDasMargens(antes.margensPorProduto, depois.margensPorProduto, (k) => k);
    if (porProduto.length) {
      // Nome do produto (a chave e' o id): ate' 30, o resto aparece pelo id.
      const nomes = new Map();
      try {
        const refs = porProduto.slice(0, 30).map((m) => db.collection('estoque').doc(m.chave));
        (await db.getAll(...refs)).forEach((s) => {
          if (s.exists && s.data().tenantId === tenantId) nomes.set(s.id, `${s.data().nome || s.id}${s.data().codigo ? ` (cód. ${s.data().codigo})` : ''}`);
        });
      } catch (erroNomes) {
        console.error('[Custos] falha ao ler os nomes dos produtos (Histórico de alterações):', erroNomes.message);
      }
      porProduto.forEach((m) => alteracoes.push({ campo: `Margem do produto ${nomes.get(m.chave) || m.chave}`, valorAnterior: m.valorAnterior, valorNovo: m.valorNovo }));
    }
    if (alteracoes.length === 0) return;
    await registrarLog({ ...user, tenantId }, {
      modulo: 'financeiro',
      acao: 'edicao',
      descricao: `Custos e formação de preço alterados: ${[...new Set(alteracoes.map((a) => (a.campo.startsWith('Margem do grupo') ? 'margens por grupo' : (a.campo.startsWith('Margem do produto') ? 'margens por produto' : a.campo))))].slice(0, 12).join(', ')}.`,
      registroId: tenantId,
      documentoTipo: 'configuracao',
      documentoNumero: 'Custos e formação de preço',
      alteracoes,
    });
  } catch (erro) {
    console.error('[Custos] falha ao montar o Histórico de alterações:', erro.message);
  }
};

const salvar = async ({ user, tenantId, corpo }) => {
  const lido = cu.lerConfigCustos(corpo);
  if ('erro' in lido) throw new ErroCustos(400, lido.erro);
  // Como estava antes (base do Historico de alteracoes). Falha nesta leitura nao impede salvar.
  const antes = await lerConfig(tenantId).catch((erro) => {
    console.error('[Custos] falha ao ler a configuração anterior (Histórico de alterações):', erro.message);
    return null;
  });
  await db.collection(COLECAO).doc(tenantId).set({
    tenantId,
    ...lido.config,
    updatedAt: agora(),
    ...buildDocumentUpdateMetadata(user.uid, agora(), 'Custos e formação de preço atualizados'),
  });
  // Nao espera: o registro nunca atrasa nem derruba o salvar.
  if (antes) registrarAlteracaoDosCustos(user, tenantId, antes, lido.config);
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
