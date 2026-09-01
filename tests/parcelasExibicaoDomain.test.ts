import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dividirValorEmParcelas, parcelasParaImpressao } from '../src/utils/parcelasExibicaoDomain';

const somaEmCentavos = (valores: number[]) => valores.reduce((total, v) => total + Math.round(v * 100), 0);

test('R$ 100 em 3x fecha exatamente 100, com a sobra na primeira', () => {
  // A maquininha de cartao poe a sobra na primeira parcela -- e' o valor que
  // o cliente vai ver na fatura.
  assert.deepEqual(dividirValorEmParcelas(100, 3), [33.34, 33.33, 33.33]);
  assert.equal(somaEmCentavos(dividirValorEmParcelas(100, 3)), 10000);
});

test('divisao exata nao inventa sobra', () => {
  assert.deepEqual(dividirValorEmParcelas(90, 3), [30, 30, 30]);
  assert.deepEqual(dividirValorEmParcelas(50, 2), [25, 25]);
});

test('nenhum centavo se perde, em qualquer combinacao', () => {
  for (const valor of [10, 33.33, 99.99, 1234.56, 0.07]) {
    for (const partes of [2, 3, 4, 5, 6, 7, 10, 12]) {
      const parcelas = dividirValorEmParcelas(valor, partes);
      assert.equal(parcelas.length, partes, `${valor} em ${partes}x`);
      assert.equal(somaEmCentavos(parcelas), Math.round(valor * 100), `${valor} em ${partes}x`);
    }
  }
});

test('uma parcela ou menos devolve o valor inteiro', () => {
  assert.deepEqual(dividirValorEmParcelas(100, 1), [100]);
  assert.deepEqual(dividirValorEmParcelas(100, 0), [100]);
});

test('valor invalido nao vira parcela nenhuma', () => {
  assert.deepEqual(dividirValorEmParcelas(0, 3), []);
  assert.deepEqual(dividirValorEmParcelas(-10, 3), []);
  assert.deepEqual(dividirValorEmParcelas(Number.NaN, 3), []);
});

// --- O que vai pro papel ---------------------------------------------------

const financeiraUnica = [{ numero: 1, dataVencimento: '', valor: 100 }];

test('financeiro com varias parcelas manda -- nao ha o que inventar', () => {
  // Cartao no modo completo e crediario ja geram transacao por parcela, com
  // vencimento de verdade.
  const reais = [
    { numero: 1, dataVencimento: '2026-10-01', valor: 50 },
    { numero: 2, dataVencimento: '2026-11-01', valor: 50 },
  ];
  const resultado = parcelasParaImpressao(reais, [{ valor: 100, parcelasExibicao: 5 }]);
  assert.deepEqual(resultado, reais);
});

test('cartao simplificado com 3x divide so pra mostrar', () => {
  const resultado = parcelasParaImpressao(financeiraUnica, [{ valorCentavos: 10000, parcelasExibicao: 3 }]);

  assert.equal(resultado.length, 3);
  assert.deepEqual(resultado.map((p) => p.valor), [33.34, 33.33, 33.33]);
  assert.deepEqual(resultado.map((p) => p.numero), [1, 2, 3]);
});

test('vencimento fica vazio: o sistema nao controla essas parcelas', () => {
  // Imprimir uma data calculada seria inventar compromisso que ninguem
  // acompanha.
  const resultado = parcelasParaImpressao(financeiraUnica, [{ valor: 100, parcelasExibicao: 3 }]);
  assert.deepEqual(resultado.map((p) => p.dataVencimento), ['', '', '']);
});

test('sem parcelamento de exibicao, o papel sai como sempre saiu', () => {
  assert.deepEqual(parcelasParaImpressao(financeiraUnica, [{ valor: 100 }]), financeiraUnica);
  assert.deepEqual(parcelasParaImpressao(financeiraUnica, [{ valor: 100, parcelasExibicao: 1 }]), financeiraUnica);
  assert.deepEqual(parcelasParaImpressao(financeiraUnica, []), financeiraUnica);
  assert.deepEqual(parcelasParaImpressao(financeiraUnica, null), financeiraUnica);
});

test('centavos vencem reais no valor do pagamento', () => {
  const resultado = parcelasParaImpressao(financeiraUnica, [
    { valorCentavos: 9999, valor: 12345, parcelasExibicao: 3 },
  ]);
  assert.equal(somaEmCentavos(resultado.map((p) => p.valor)), 9999);
});
