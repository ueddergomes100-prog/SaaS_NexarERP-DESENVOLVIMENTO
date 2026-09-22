import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_PERMITIR_DIVIDIR_PAGAMENTO,
  erroDasParcelasAPrazo,
  formasVisiveis,
  ordenarFormasPagamento,
  parseFormasOcultas,
  parseOrdemFormasPagamento,
  parsePermitirDividirPagamento,
  resumoDasParcelas,
} from '../src/utils/formasPagamentoDomain';
import { MAX_PARCELAS_A_PRAZO, gerarParcelasAPrazo, type PaymentMethod } from '../src/utils/financeDomain';

const PADRAO: PaymentMethod[] = ['Dinheiro', 'Pix', 'Cartão de Crédito', 'Cartão de Débito', 'Transferência', 'Cheque', 'Pagamento a Prazo'];

// --- ordem das formas ------------------------------------------------------

test('sem configuracao, a ordem original nao muda', () => {
  assert.deepEqual(ordenarFormasPagamento(PADRAO, null), PADRAO);
  assert.deepEqual(ordenarFormasPagamento(PADRAO, []), PADRAO);
});

test('a loja que fecha a prazo poe "Pagamento a Prazo" em primeiro', () => {
  const ordenadas = ordenarFormasPagamento(PADRAO, ['Pagamento a Prazo', 'Pix']);
  assert.equal(ordenadas[0], 'Pagamento a Prazo');
  assert.equal(ordenadas[1], 'Pix');
});

test('forma NOVA no sistema vai pro fim, nunca some', () => {
  // A empresa configurou a ordem antes de "Cheque" existir.
  const ordenadas = ordenarFormasPagamento(PADRAO, ['Dinheiro', 'Pix', 'Cartão de Crédito', 'Cartão de Débito', 'Transferência', 'Pagamento a Prazo']);
  assert.ok(ordenadas.includes('Cheque'));
  assert.equal(ordenadas[ordenadas.length - 1], 'Cheque');
  assert.equal(ordenadas.length, PADRAO.length);
});

test('duas formas novas mantem entre si a ordem de origem', () => {
  const ordenadas = ordenarFormasPagamento(PADRAO, ['Pagamento a Prazo']);
  const semPrazo = ordenadas.slice(1);
  assert.deepEqual(semPrazo, PADRAO.filter((f) => f !== 'Pagamento a Prazo'));
});

test('nome guardado que nao existe mais e ignorado sem quebrar', () => {
  const ordenadas = ordenarFormasPagamento(PADRAO, ['Boleto Antigo', 'Pix']);
  assert.equal(ordenadas[0], 'Pix');
  assert.equal(ordenadas.length, PADRAO.length);
});

test('ordenar nunca perde nem duplica forma', () => {
  const ordenadas = ordenarFormasPagamento(PADRAO, ['Cheque', 'Cheque', 'Dinheiro']);
  assert.equal(ordenadas.length, PADRAO.length);
  assert.equal(new Set(ordenadas).size, PADRAO.length);
});

// --- esconder formas -------------------------------------------------------

test('forma escondida sai da lista', () => {
  const visiveis = formasVisiveis(PADRAO, ['Cheque', 'Transferência']);
  assert.ok(!visiveis.includes('Cheque'));
  assert.ok(!visiveis.includes('Transferência'));
  assert.equal(visiveis.length, PADRAO.length - 2);
});

test('esconder TODAS e ignorado: venda sem forma de pagamento nao fecha', () => {
  assert.deepEqual(formasVisiveis(PADRAO, [...PADRAO]), PADRAO);
});

test('lista de escondidas invalida nao esconde nada', () => {
  assert.deepEqual(formasVisiveis(PADRAO, null), PADRAO);
  assert.deepEqual(formasVisiveis(PADRAO, undefined), PADRAO);
});

// --- leitura defensiva da configuracao ------------------------------------

test('configuracao gravada e lida sem lixo e sem repeticao', () => {
  assert.deepEqual(parseOrdemFormasPagamento(['Pix', '', '  ', 'Pix', ' Dinheiro ']), ['Pix', 'Dinheiro']);
  assert.deepEqual(parseOrdemFormasPagamento('Pix'), []);
  assert.deepEqual(parseOrdemFormasPagamento(null), []);
  assert.deepEqual(parseFormasOcultas([42, 'Cheque']), ['Cheque']);
});

test('dividir pagamento vem LIGADO por padrao; so false desliga', () => {
  assert.equal(DEFAULT_PERMITIR_DIVIDIR_PAGAMENTO, true);
  assert.equal(parsePermitirDividirPagamento(undefined), true);
  assert.equal(parsePermitirDividirPagamento(null), true);
  assert.equal(parsePermitirDividirPagamento(true), true);
  assert.equal(parsePermitirDividirPagamento(false), false);
});

// --- parcelas automaticas --------------------------------------------------

test('3 parcelas de 30 dias viram 30/60/90 a partir da venda', () => {
  const parcelas = gerarParcelasAPrazo(30000, 3, 30, '2026-09-21');
  assert.deepEqual(parcelas.map((p) => p.dataVencimento), ['2026-10-21', '2026-11-20', '2026-12-20']);
  assert.deepEqual(parcelas.map((p) => p.valorCentavos), [10000, 10000, 10000]);
});

test('3 parcelas de 15 dias viram 15/30/45', () => {
  const parcelas = gerarParcelasAPrazo(30000, 3, 15, '2026-09-21');
  assert.deepEqual(parcelas.map((p) => p.dataVencimento), ['2026-10-06', '2026-10-21', '2026-11-05']);
});

test('a soma das parcelas e SEMPRE o total, sem centavo perdido', () => {
  for (const total of [10000, 10001, 33333, 1, 99999]) {
    for (const partes of [1, 2, 3, 7, 12]) {
      const parcelas = gerarParcelasAPrazo(total, partes, 30, '2026-09-21');
      const soma = parcelas.reduce((acc, p) => acc + p.valorCentavos, 0);
      assert.equal(soma, total, `total ${total} em ${partes}x`);
    }
  }
});

test('a sobra de centavo vai nas PRIMEIRAS parcelas', () => {
  const parcelas = gerarParcelasAPrazo(10000, 3, 30, '2026-09-21');
  assert.deepEqual(parcelas.map((p) => p.valorCentavos), [3334, 3333, 3333]);
});

test('uma parcela so ainda respeita o intervalo (nao vence na data da venda)', () => {
  const parcelas = gerarParcelasAPrazo(5000, 1, 30, '2026-09-21');
  assert.equal(parcelas.length, 1);
  assert.equal(parcelas[0].dataVencimento, '2026-10-21');
  assert.equal(parcelas[0].valorCentavos, 5000);
});

test('parcelas atravessam a virada de ano', () => {
  const parcelas = gerarParcelasAPrazo(30000, 3, 30, '2026-12-15');
  assert.deepEqual(parcelas.map((p) => p.dataVencimento), ['2027-01-14', '2027-02-13', '2027-03-15']);
});

test('entrada invalida devolve lista vazia em vez de parcela errada', () => {
  assert.deepEqual(gerarParcelasAPrazo(0, 3, 30, '2026-09-21'), []);
  assert.deepEqual(gerarParcelasAPrazo(-100, 3, 30, '2026-09-21'), []);
  assert.deepEqual(gerarParcelasAPrazo(10000, 0, 30, '2026-09-21'), []);
  assert.deepEqual(gerarParcelasAPrazo(10000, 3, 0, '2026-09-21'), []);
  assert.deepEqual(gerarParcelasAPrazo(10000, 3, 30, ''), []);
  assert.deepEqual(gerarParcelasAPrazo(10000, MAX_PARCELAS_A_PRAZO + 1, 30, '2026-09-21'), []);
});

test('erro das parcelas fala portugues e diz o que fazer', () => {
  assert.equal(erroDasParcelasAPrazo(3, 30), null);
  assert.equal(erroDasParcelasAPrazo(1, 1), null);
  assert.match(String(erroDasParcelasAPrazo(0, 30)), /quantas parcelas/i);
  assert.match(String(erroDasParcelasAPrazo(3, 0)), /quantos em quantos dias/i);
  assert.match(String(erroDasParcelasAPrazo(99, 30)), new RegExp(String(MAX_PARCELAS_A_PRAZO)));
});

test('resumo das parcelas escreve o combinado do balcao', () => {
  assert.equal(resumoDasParcelas(gerarParcelasAPrazo(30000, 3, 30, '2026-09-21'), 30), '3x de 30 em 30 dias (30/60/90)');
  assert.equal(resumoDasParcelas(gerarParcelasAPrazo(30000, 3, 15, '2026-09-21'), 15), '3x de 15 em 15 dias (15/30/45)');
  assert.equal(resumoDasParcelas(gerarParcelasAPrazo(30000, 1, 30, '2026-09-21'), 30), '1x em 30 dias');
  assert.equal(resumoDasParcelas([], 30), '');
  // Muitas parcelas: abrevia pra caber na linha.
  assert.equal(resumoDasParcelas(gerarParcelasAPrazo(120000, 12, 30, '2026-09-21'), 30), '12x de 30 em 30 dias (30/60/90...360)');
});
