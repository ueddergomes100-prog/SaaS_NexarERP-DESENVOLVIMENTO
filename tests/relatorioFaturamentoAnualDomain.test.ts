import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calcularFaturamentoAnual,
  linhasDre,
  montarDocumentoFaturamentoAnual,
  type TransacaoFaturamento,
} from '../src/utils/relatorioFaturamentoAnualDomain';
import { linhaTotalSecao } from '../src/utils/relatorioPdfDomain';

let seq = 0;
const t = (extra: Partial<TransacaoFaturamento>): TransacaoFaturamento => ({
  id: `t${(seq += 1)}`, data: '2025-03-10', categoria: 'Venda de Peças', tipo: 'entrada', status: 'Paga', formaPagamento: 'Pix', valor: 100, ...extra,
});

const lancamentos: TransacaoFaturamento[] = [
  t({ valor: 1000 }),
  // Cartao: bruto 500, taxa 15, liquido 485.
  t({ valor: 500, formaPagamento: 'Cartão de Crédito', valorBruto: 500, valorTaxa: 15, valorLiquido: 485, data: '2025-04-02' }),
  t({ valor: 300, categoria: 'Serviços', formaPagamento: 'Dinheiro', data: '2025-04-15' }),
  t({ valor: 200.1, categoria: 'Outros', formaPagamento: undefined, data: '2025-05-01' }),
  // Despesa real.
  t({ valor: 400, tipo: 'saida', categoria: 'Aluguel', data: '2025-04-05' }),
  // Venda cancelada (19/10/2026): a entrada fica marcada como estornada e o
  // estorno do cancelamento nao conta -- os dois somem da receita.
  t({ valor: 700, data: '2025-03-20', estornada: true, statusOperacional: 'Cancelada' }),
  t({ valor: 700, tipo: 'saida', categoria: 'Cancelamento de Venda', data: '2025-04-20' }),
  // Devolucao de venda: abate receita no mes dela, nao e' despesa.
  t({ valor: 100, tipo: 'saida', categoria: 'Devolução de Venda', data: '2025-04-20' }),
  // Credito de devolucao nao e' receita.
  t({ valor: 999, formaPagamento: 'Crédito de Devolução', data: '2025-04-21' }),
  // Pendente e de outro ano ficam fora.
  t({ valor: 777, status: 'Pendente' }),
  t({ valor: 888, data: '2024-12-31' }),
  // Sem data: vale o ano/mes da criacao.
  t({ valor: 50, data: undefined, createdAt: { seconds: Date.UTC(2025, 5, 15, 15) / 1000 } }),
];

const hoje2026 = new Date(2026, 9, 2, 10);

test('DRE: receita por categoria, taxas, estornos, despesas, lucro e margem (em centavos)', () => {
  const r = calcularFaturamentoAnual(lancamentos, 2025, hoje2026);
  assert.equal(r.receitaPecasCentavos, 100000 + 50000 + 5000);
  assert.equal(r.receitaServicosCentavos, 30000);
  assert.equal(r.receitaOutrosCentavos, 20010);
  assert.equal(r.receitaBrutaCentavos, 205010);
  assert.equal(r.taxasCartaoCentavos, 1500);
  assert.equal(r.estornosCentavos, 10000);
  assert.equal(r.receitaLiquidaCentavos, 205010 - 1500 - 10000);
  assert.equal(r.despesasCentavos, 40000);
  assert.equal(r.lucroLiquidoCentavos, 193510 - 40000);
  assert.ok(Math.abs(r.margemLucro - (153510 / 205010) * 100) < 1e-9);
});

test('formas de pagamento: receita líquida, da maior para a menor, "Não informada" quando falta', () => {
  const r = calcularFaturamentoAnual(lancamentos, 2025, hoje2026);
  assert.deepEqual(r.formasPagamento.map((f) => [f.forma, f.valorCentavos]), [
    ['Pix', 105000],
    ['Cartão de Crédito', 48500],
    ['Dinheiro', 30000],
    ['Não informada', 20010],
  ]);
});

test('balancete: devolução abate a receita do mês; ano anterior mostra os 12 meses e divide por 12', () => {
  const r = calcularFaturamentoAnual(lancamentos, 2025, hoje2026);
  assert.equal(r.mesesExibidos.length, 12);
  assert.equal(r.mesesTranscorridos, 12);
  const abril = r.meses[3];
  assert.equal(abril.nomeMes, 'Abril');
  assert.equal(abril.receitaBrutaCentavos, 50000 + 30000 - 10000);
  assert.equal(abril.taxasCentavos, 1500);
  assert.equal(abril.receitaLiquidaCentavos, 48500 + 30000 - 10000);
  assert.equal(abril.despesasCentavos, 40000);
  assert.equal(abril.resultadoCentavos, 68500 - 40000);
  assert.equal(r.meses[5].receitaBrutaCentavos, 5000, 'lançamento sem data cai no mês da criação');
  assert.equal(r.mediaMensalReceitaCentavos, Math.round(193510 / 12));
  assert.equal(r.mediaMensalDespesasCentavos, Math.round(40000 / 12));
});

test('ano corrente: só meses até o atual e média pelos meses transcorridos', () => {
  const r = calcularFaturamentoAnual([t({ data: '2026-02-10', valor: 1000 }), t({ data: '2026-11-10', valor: 500 })], 2026, hoje2026);
  assert.equal(r.mesesExibidos.length, 10);
  assert.equal(r.mesesTranscorridos, 10);
  assert.equal(r.receitaBrutaCentavos, 150000, 'o DRE soma o ano todo, como a tela');
  assert.equal(r.mediaMensalReceitaCentavos, 15000);
});

test('sem lançamentos: tudo zero e margem 0', () => {
  const r = calcularFaturamentoAnual([], 2025, hoje2026);
  assert.equal(r.receitaBrutaCentavos, 0);
  assert.equal(r.margemLucro, 0);
  assert.equal(r.formasPagamento.length, 0);
});

test('documento: DRE em linhas sem total, formas opcional, balancete com total do ano', () => {
  const doc = montarDocumentoFaturamentoAnual(lancamentos, 2025, hoje2026);
  assert.equal(doc.titulo, 'Faturamento e DRE');
  assert.equal(doc.periodo, 'Ano de 2025');
  assert.deepEqual(doc.indicadores.map((i) => i.rotulo), [
    'Receita bruta', 'Receita líquida', 'Despesas', 'Lucro líquido', 'Margem de lucro', 'Média mensal de receita', 'Média mensal de despesas',
  ]);
  assert.match(doc.indicadores[0].valor, /2\.050,10/);
  assert.equal(doc.indicadores[4].valor, '74,88%');
  assert.deepEqual(doc.secoes.map((s) => s.id), ['dre', 'formas', 'balancete']);

  const dre = doc.secoes[0];
  assert.deepEqual(linhaTotalSecao(dre.colunas, dre.linhas, 'DRE'), ['DRE', ''], 'linhas do DRE não se somam');
  const lucro = dre.linhas.find((l: any) => l.linha.includes('Lucro líquido'));
  assert.equal(dre.colunas[1].valor(lucro), 153510);
  assert.match(dre.linhas[dre.linhas.length - 1].linha, /Margem de lucro: 74,88%/);

  assert.equal(doc.secoes[1].opcional, true);
  const balancete = doc.secoes[2];
  assert.equal(balancete.linhas.length, 12);
  const totalBalancete = linhaTotalSecao(balancete.colunas, balancete.linhas, 'Total');
  assert.match(totalBalancete[1], /1\.950,10/, 'receita bruta do balancete já vem sem os estornos');
});

test('documento do ano corrente indica até qual mês vai', () => {
  const doc = montarDocumentoFaturamentoAnual([], 2026, hoje2026);
  assert.equal(doc.periodo, 'Ano de 2026 (até outubro)');
  assert.equal(doc.secoes[2].linhas.length, 10);
});

test('linhasDre segue a ordem da tela', () => {
  const linhas = linhasDre(calcularFaturamentoAnual(lancamentos, 2025, hoje2026)).map((l) => l.linha);
  assert.equal(linhas[0], '1. Receita bruta total');
  assert.equal(linhas[4], '2. (-) Taxas de cartão');
  assert.equal(linhas[6], '4. (=) Receita líquida financeira');
  assert.equal(linhas[8], '(=) Lucro líquido do exercício');
});

test('venda cancelada em outro mês/ano some da receita e nunca deixa nada negativo (19/10/2026)', () => {
  const lista = [
    // Vendida em dezembro, cancelada em janeiro do ano seguinte.
    t({ valor: 500, data: '2025-12-20', estornada: true, statusOperacional: 'Cancelada' }),
    t({ valor: 500, tipo: 'saida', categoria: 'Cancelamento de Venda', sourceType: 'cancelamento_pedido_venda', data: '2026-01-05' }),
    // Parte paga com credito de devolucao, cancelada no mesmo dia (o caso do -R$ 5,00).
    t({ valor: 5, formaPagamento: 'Crédito de Devolução', data: '2026-01-10', estornada: true, statusOperacional: 'Cancelada' }),
    t({ valor: 5, tipo: 'saida', formaPagamento: 'Crédito de Devolução', categoria: 'Cancelamento de Venda', data: '2026-01-10' }),
  ];
  const ano2025 = calcularFaturamentoAnual(lista, 2025, hoje2026);
  assert.equal(ano2025.receitaBrutaCentavos, 0);
  assert.equal(ano2025.meses[11].receitaLiquidaCentavos, 0);
  const ano2026 = calcularFaturamentoAnual(lista, 2026, hoje2026);
  assert.equal(ano2026.estornosCentavos, 0, 'estorno de cancelamento não abate');
  assert.equal(ano2026.receitaLiquidaCentavos, 0);
  assert.equal(ano2026.meses[0].receitaBrutaCentavos, 0);
  assert.equal(ano2026.meses[0].receitaLiquidaCentavos, 0);
  ano2026.meses.forEach((m) => {
    assert.ok(m.receitaBrutaCentavos >= 0 && m.taxasCentavos >= 0 && m.receitaLiquidaCentavos >= 0, m.nomeMes);
  });
});

test('devolução maior que as vendas do mês: a receita do mês zera, não fica negativa', () => {
  const lista = [
    t({ valor: 100, data: '2026-03-05' }),
    t({ valor: 300, tipo: 'saida', categoria: 'Devolução de Venda', data: '2026-03-06' }),
  ];
  const r = calcularFaturamentoAnual(lista, 2026, hoje2026);
  assert.equal(r.meses[2].receitaBrutaCentavos, 0);
  assert.equal(r.meses[2].receitaLiquidaCentavos, 0);
  assert.equal(r.receitaLiquidaCentavos, 0);
});

test('devolução estornada sai das duas pontas', () => {
  const lista = [
    t({ valor: 400, data: '2026-03-05' }),
    t({ valor: 150, tipo: 'saida', categoria: 'Devolução de Venda', data: '2026-03-06', estornada: true, statusOperacional: 'Estornada' }),
    // Estorno da devolucao: entrada com a mesma categoria -- nao e' receita nova.
    t({ valor: 150, tipo: 'entrada', categoria: 'Devolução de Venda', data: '2026-03-07' }),
  ];
  const r = calcularFaturamentoAnual(lista, 2026, hoje2026);
  assert.equal(r.receitaBrutaCentavos, 40000);
  assert.equal(r.estornosCentavos, 0);
  assert.equal(r.receitaLiquidaCentavos, 40000);
});
