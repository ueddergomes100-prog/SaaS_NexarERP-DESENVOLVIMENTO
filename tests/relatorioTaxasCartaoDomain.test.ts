import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatarTaxaMedia,
  montarDocumentoTaxasCartao,
  totaisPorBandeira,
  transacoesCartaoNoPeriodo,
  type TransacaoCartao,
} from '../src/utils/relatorioTaxasCartaoDomain';
import { linhaTotalSecao } from '../src/utils/relatorioPdfDomain';

const cartao = (id: string, data: string | undefined, bandeira: string | undefined, bruto: number, taxa: number): TransacaoCartao => ({
  id, data, cartao: { bandeira, valorBrutoCentavos: bruto, valorTaxaCentavos: taxa, valorLiquidoCentavos: bruto - taxa },
});

const base: TransacaoCartao[] = [
  cartao('1', '2026-09-02', 'Visa', 10000, 250),
  cartao('2', '2026-09-03', ' Visa ', 20000, 500),
  cartao('3', '2026-09-04', 'Master', 50000, 1000),
  cartao('4', '2026-09-05', undefined, 1000, 0),
  cartao('5', '2026-10-01', 'Visa', 99999, 9999),
  cartao('6', undefined, 'Visa', 99999, 9999),
  { id: '7', data: '2026-09-05', cartao: null },
];

test('só transações com cartão e data no período; agrupa por bandeira (sem espaço) e ordena pela taxa', () => {
  const lista = transacoesCartaoNoPeriodo(base, '2026-09-01', '2026-09-30');
  assert.deepEqual(lista.map((t) => t.id), ['1', '2', '3', '4']);
  const porBandeira = totaisPorBandeira(lista);
  assert.deepEqual(porBandeira.map((b) => [b.bandeira, b.transacoes, b.brutoCentavos, b.taxaCentavos, b.liquidoCentavos]), [
    ['Master', 1, 50000, 1000, 49000],
    ['Visa', 2, 30000, 750, 29250],
    ['Sem bandeira', 1, 1000, 0, 1000],
  ]);
});

test('taxa média ponderada pelo bruto, em pt-BR', () => {
  assert.equal(formatarTaxaMedia(750, 30000), '2,50%');
  assert.equal(formatarTaxaMedia(1750, 81000), '2,16%');
  assert.equal(formatarTaxaMedia(0, 0), '-');
});

test('documento: colunas, total por coluna e média geral nos indicadores', () => {
  const doc = montarDocumentoTaxasCartao(base, '2026-09-01', '2026-09-30');
  assert.equal(doc.titulo, 'Taxas Pagas às Administradoras');
  const secao = doc.secoes[0];
  assert.deepEqual(secao.colunas.map((c) => c.titulo), ['Bandeira', 'Transações', 'Valor Bruto', 'Taxa Média', 'Taxa Paga', 'Valor Líquido']);
  assert.equal(secao.colunas[3].valor(secao.linhas[1]), '2,50%');
  const total = linhaTotalSecao(secao.colunas, secao.linhas, 'Total').map((t) => t.replace(/\s/g, ' '));
  assert.equal(total[0], 'TOTAL');
  assert.equal(total[1], '4');
  assert.match(total[2], /810,00/);
  assert.equal(total[3], '');
  assert.match(total[4], /17,50/);
  assert.match(total[5], /792,50/);
  const indicador = (rotulo: string) => doc.indicadores.find((i) => i.rotulo === rotulo)?.valor;
  assert.equal(indicador('Total de pagamentos em cartão'), '4');
  assert.equal(indicador('Taxa média geral'), '2,16%');
});

test('sem pagamentos em cartão: vazio não quebra', () => {
  const doc = montarDocumentoTaxasCartao([], '2026-09-01', '2026-09-30');
  assert.equal(doc.secoes[0].linhas.length, 0);
  assert.equal(doc.indicadores.find((i) => i.rotulo === 'Taxa média geral')?.valor, '-');
});
