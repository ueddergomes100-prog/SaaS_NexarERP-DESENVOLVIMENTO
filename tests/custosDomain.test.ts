import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONFIG_CUSTOS_PADRAO,
  depreciacaoNoMesCentavos,
  lerConfigCustos,
  lucroReal,
  margemDoProduto,
  mesesFechados,
  periodoDosMeses,
  precoSebrae,
  resumirCustos,
  simularProduto,
  situacaoDoBem,
  type ConfigCustos,
} from '../src/utils/custosDomain';

/*
 * Custos e formacao de preco (23/10/2026): meses fechados, depreciacao linear,
 * despesa fixa media + rateio % do faturamento, formula do Sebrae e lucro real.
 */

const erroDe = (r: { erro: string } | object): string => ('erro' in r ? r.erro : '');
const cfg = (extra: Partial<ConfigCustos> = {}): ConfigCustos => ({ ...CONFIG_CUSTOS_PADRAO, ...extra });

test('meses fechados e periodo', () => {
  assert.deepEqual(mesesFechados('2026-10-23'), ['2026-07', '2026-08', '2026-09']);
  assert.deepEqual(mesesFechados('2026-02-10'), ['2025-11', '2025-12', '2026-01']);
  assert.deepEqual(periodoDosMeses(['2026-07', '2026-08', '2026-09']), { de: '2026-07-01', ate: '2026-09-30' });
  assert.deepEqual(periodoDosMeses(['2025-12', '2026-01', '2026-02']), { de: '2025-12-01', ate: '2026-02-28' });
});

test('depreciacao linear: comeca no mes seguinte a compra e para no fim da vida util', () => {
  // R$ 60.000, residual R$ 12.000, 5 anos -> (60000-12000)/60 = R$ 800/mes.
  const bem = { id: 'b1', nome: 'CAMINHÃO', valorCentavos: 6_000_000, residualCentavos: 1_200_000, dataCompra: '2026-01-15', vidaUtilAnos: 5, ativo: true };
  assert.equal(depreciacaoNoMesCentavos(bem, '2026-01'), 0, 'mes da compra nao deprecia');
  assert.equal(depreciacaoNoMesCentavos(bem, '2026-02'), 80_000);
  assert.equal(depreciacaoNoMesCentavos(bem, '2031-01'), 80_000, 'ultimo mes (60o)');
  assert.equal(depreciacaoNoMesCentavos(bem, '2031-02'), 0, 'depois da vida util');
  assert.equal(depreciacaoNoMesCentavos({ ...bem, ativo: false }, '2026-05'), 0);
  assert.deepEqual(situacaoDoBem(bem, '2026-10'), { depreciadoCentavos: 720_000, valorAtualCentavos: 5_280_000, mesesRestantes: 51 });
});

test('ler configuracao: limpa, limita e explica o erro', () => {
  const ok = lerConfigCustos({
    categoriasFixas: [' Aluguel ', 'Aluguel', 'Salários'], impostoPercentual: '6,5', comissaoPercentual: 150, margemPadrao: '25',
    ajustes: [{ descricao: 'Pró-labore', valorCentavos: 300000 }, { descricao: '', valorCentavos: 0 }],
    bens: [{ nome: 'Balcão', valorCentavos: 500000, dataCompra: '2025-01-10', vidaUtilAnos: '10', residualCentavos: 0 }],
    margensPorGrupo: { RAÇÃO: 18 }, margensPorProduto: { p1: '30', 'id inválido': 10 }, faturamentoManualCentavos: '',
  });
  assert.ok('config' in ok);
  assert.deepEqual(ok.config.categoriasFixas, ['Aluguel', 'Salários']);
  assert.equal(ok.config.impostoPercentual, 6.5);
  assert.equal(ok.config.comissaoPercentual, 100, 'limitado a 100');
  assert.equal(ok.config.margemPadrao, 25);
  assert.equal(ok.config.ajustes.length, 1);
  assert.equal(ok.config.bens[0].id, 'bem-1');
  assert.deepEqual(ok.config.margensPorProduto, { p1: 30 });
  assert.equal(ok.config.faturamentoManualCentavos, null);
  assert.match(erroDe(lerConfigCustos({ bens: [{ nome: 'X', valorCentavos: 100, dataCompra: '2026-01-01', vidaUtilAnos: 0 }] })), /vida útil/);
  assert.match(erroDe(lerConfigCustos({ bens: [{ nome: 'X', valorCentavos: 100, dataCompra: '2026-01-01', vidaUtilAnos: 5, residualCentavos: 100 }] })), /residual/);
  assert.match(erroDe(lerConfigCustos({ ajustes: [{ descricao: '', valorCentavos: 100 }] })), /Dê um nome/);
});

test('resumo: media de 3 meses das categorias fixas pagas + ajustes + depreciacao; rateio sobre a receita do Dashboard', () => {
  const meses = ['2026-07', '2026-08', '2026-09'];
  const pago = (mes: string, tipo: 'entrada' | 'saida', valorCentavos: number, categoria: string, extra = {}) => ({ tipo, status: 'Paga', valorCentavos, categoria, dataPagamento: `${mes}-10`, ...extra });
  const lancamentos = [
    ...meses.map((m) => pago(m, 'saida', 300_000, 'Aluguel')),
    ...meses.map((m) => pago(m, 'saida', 600_000, 'Salários')),
    pago('2026-07', 'saida', 900_000, 'Fornecedores'),
    pago('2026-08', 'saida', 100_000, 'Aluguel', { estornada: true }),
    ...meses.map((m) => pago(m, 'entrada', 6_000_000, 'Venda')),
    pago('2026-09', 'saida', 300_000, 'Devolução de Venda'),
    pago('2026-06', 'saida', 999_999, 'Aluguel'),
  ];
  const config = cfg({
    categoriasFixas: ['aluguel', 'Salários'],
    ajustes: [{ descricao: 'Pró-labore', valorCentavos: 200_000 }],
    bens: [{ id: 'b1', nome: 'CAMINHÃO', valorCentavos: 6_000_000, residualCentavos: 1_200_000, dataCompra: '2026-01-15', vidaUtilAnos: 5, ativo: true }],
    impostoPercentual: 6, comissaoPercentual: 3, taxasPercentual: 1,
  });
  const r = resumirCustos(lancamentos, config, meses);
  assert.equal(r.mediaDespesaFixaCentavos, 900_000, 'aluguel 3000 + salarios 6000 (estornada e outro mes ficam fora)');
  assert.equal(r.depreciacaoMensalCentavos, 80_000);
  assert.equal(r.despesaFixaMensalCentavos, 1_180_000);
  assert.equal(r.faturamentoPorMes['2026-09'], 5_700_000, 'devolucao abate a receita');
  assert.equal(r.faturamentoMedioCentavos, 5_900_000);
  assert.equal(r.rateioPercentual, 20);
  assert.equal(r.pontoDeEquilibrioCentavos, Math.round(1_180_000 / 0.9));
  assert.deepEqual(r.categorias.map((c) => [c.categoria, c.fixa]).slice(0, 3), [['Salários', true], ['Aluguel', true], ['Fornecedores', false]]);
  // "ALUGUEL" digitado no lancamento soma com "Aluguel".
  const caixa = resumirCustos([...lancamentos, pago('2026-09', 'saida', 300_000, 'ALUGUEL')], config, meses);
  assert.equal(caixa.categorias.filter((c) => c.categoria.toUpperCase() === 'ALUGUEL').length, 1);
  assert.equal(caixa.mediaDespesaFixaCentavos, 1_000_000);
  const manual = resumirCustos(lancamentos, { ...config, faturamentoManualCentavos: 11_800_000 }, meses);
  assert.equal(manual.rateioPercentual, 10);
  assert.equal(resumirCustos([], config, meses).rateioPercentual, null);
});

test('formula do Sebrae, lucro real e margem do produto > grupo > padrao', () => {
  const p = { rateio: 20, imposto: 6, comissao: 3, taxas: 1 };
  // custo 50 / (1 - 0,5) = 100
  assert.deepEqual(precoSebrae(50, p, 20), { preco: 100 });
  assert.match(erroDe(precoSebrae(50, p, 70)), /somam 100,0%/);
  assert.match(erroDe(precoSebrae(0, p, 20)), /sem custo/);
  assert.deepEqual(lucroReal(100, 50, p), { lucro: 20, margemReal: 20 });
  assert.deepEqual(lucroReal(80, 50, p), { lucro: 6, margemReal: 7.5 });
  const config = cfg({ margemPadrao: 20, margensPorGrupo: { 'RAÇÃO': 15 }, margensPorProduto: { p9: 40 }, impostoPercentual: 6, comissaoPercentual: 3, taxasPercentual: 1 });
  assert.deepEqual(margemDoProduto(config, 'p9', 'RAÇÃO'), { margem: 40, origem: 'produto' });
  assert.deepEqual(margemDoProduto(config, 'p1', 'ração'), { margem: 15, origem: 'grupo' });
  assert.deepEqual(margemDoProduto(config, 'p1', 'PET'), { margem: 20, origem: 'padrao' });
  const linha = simularProduto({ id: 'p1', nome: 'X', codigo: '1', grupo: 'PET', custo: 50, preco: 80 }, config, 20);
  assert.equal(linha.precoSugerido, 100);
  assert.equal(linha.diferencaPercentual, -20);
  assert.equal(linha.lucroAtual, 6);
  const comComissaoPropria = simularProduto({ id: 'p1', nome: 'X', codigo: '1', grupo: 'PET', custo: 50, preco: 80, comissaoPercentual: 0 }, config, 20);
  assert.equal(comComissaoPropria.precoSugerido, Math.round((50 / 0.53) * 100) / 100);
});
