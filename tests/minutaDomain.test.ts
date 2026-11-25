import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  codigoENomeMinuta,
  parseValoresNaMinutaDoApp,
  totaisDaMinutaComValores,
  condicaoPagamentoMinuta,
  enderecoMinuta,
  formatarCepMinuta,
  formatarDataCurtaMinuta,
  formatarHoraMinuta,
  formatarDocumentoMinuta,
  formatarEmissaoMinuta,
  formatarGeradoEmMinuta,
  formatarQuantidadeMinuta,
  formatarTelefoneMinuta,
  formatarTotalPecasMinuta,
  rotuloDocumentoMinuta,
  vendedorMinuta,
} from '../src/utils/minutaDomain';

test('documento: CPF e CNPJ formatados; o resto fica como veio', () => {
  assert.equal(formatarDocumentoMinuta('06859540648'), '068.595.406-48');
  assert.equal(formatarDocumentoMinuta('12345678000199'), '12.345.678/0001-99');
  assert.equal(formatarDocumentoMinuta('123'), '123');
  assert.equal(formatarDocumentoMinuta(undefined), '');
  assert.equal(rotuloDocumentoMinuta('12345678000199'), 'CNPJ');
  assert.equal(rotuloDocumentoMinuta('06859540648'), 'CPF');
});

test('telefone e CEP formatados', () => {
  assert.equal(formatarTelefoneMinuta('3333333333'), '(33) 3333-3333');
  assert.equal(formatarTelefoneMinuta('33984145675'), '(33) 98414-5675');
  assert.equal(formatarTelefoneMinuta('4133'), '4133');
  assert.equal(formatarCepMinuta('36900000'), '36900-000');
  assert.equal(formatarCepMinuta('36900-000'), '36900-000');
});

test('quantidade com 4 casas e total de pecas com 2, como na minuta antiga', () => {
  assert.equal(formatarQuantidadeMinuta(5), '5,0000');
  assert.equal(formatarQuantidadeMinuta(0.26), '0,2600');
  assert.equal(formatarTotalPecasMinuta([{ quantidade: 5 }, { quantidade: 2 }, { quantidade: 3 }, { quantidade: 5 }]), '15,00');
  assert.equal(formatarTotalPecasMinuta([]), '0,00');
});

test('emissao e rodape usam o horario de Sao Paulo', () => {
  // 12:59Z = 09:59 em Sao Paulo
  const d = new Date('2026-09-21T12:59:31Z');
  assert.equal(formatarEmissaoMinuta(d), '21/09/2026 09:59');
  assert.equal(formatarGeradoEmMinuta(d), '21/09/2026 as 09:59:31');
  assert.equal(formatarEmissaoMinuta(null), '');
  assert.equal(formatarEmissaoMinuta(new Date('lixo')), '');
});

test('condicao de pagamento junta as formas sem repetir', () => {
  assert.equal(condicaoPagamentoMinuta([{ forma: 'Pix' }, { forma: 'Boleto' }, { forma: 'Pix' }]), 'Pix / Boleto');
  assert.equal(condicaoPagamentoMinuta([]), '');
  assert.equal(condicaoPagamentoMinuta(undefined), '');
});

test('codigo + nome, vendedor e endereco', () => {
  assert.equal(codigoENomeMinuta('2913', 'DAVI'), '2913 DAVI');
  assert.equal(codigoENomeMinuta('', 'DAVI'), 'DAVI');
  assert.equal(vendedorMinuta('1', 'DAVI JORGE'), '1 - DAVI JORGE');
  assert.equal(vendedorMinuta(undefined, 'DAVI JORGE'), 'DAVI JORGE');
  assert.equal(enderecoMinuta({ endereco: 'AV. TRINTA DE MARCO', numero: '22' }), 'AV. TRINTA DE MARCO, 22');
  assert.equal(enderecoMinuta({ endereco: 'AV. TRINTA DE MARCO' }), 'AV. TRINTA DE MARCO');
  assert.equal(enderecoMinuta(null), '');
});

test('data curta e hora da pre-venda, no fuso de Sao Paulo', () => {
  const d = new Date('2026-09-21T12:59:31Z');
  assert.equal(formatarDataCurtaMinuta(d), '21/09/26');
  assert.equal(formatarHoraMinuta(d), '09:59');
  assert.equal(formatarDataCurtaMinuta(null), '');
  assert.equal(formatarHoraMinuta(new Date('lixo')), '');
});

test('valores na minuta do app: so sempre e vendedor_escolhe ligam; o resto e nunca', () => {
  assert.equal(parseValoresNaMinutaDoApp('sempre'), 'sempre');
  assert.equal(parseValoresNaMinutaDoApp('vendedor_escolhe'), 'vendedor_escolhe');
  assert.equal(parseValoresNaMinutaDoApp(undefined), 'nunca');
  assert.equal(parseValoresNaMinutaDoApp(true), 'nunca');
});

test('totais da minuta com valores: soma em centavos; desconto = bruto - subtotal', () => {
  assert.deepEqual(totaisDaMinutaComValores([
    { precoUnitario: 0.1, quantidade: 3, subtotal: 0.3 },
    { precoUnitario: 10, quantidade: 2, subtotal: 18 },
  ]), { bruto: 20.3, desconto: 2, total: 18.3 });
  assert.deepEqual(totaisDaMinutaComValores([]), { bruto: 0, desconto: 0, total: 0 });
});

test('pre-venda em meia folha: itens continuam na proxima, totais so na ultima (25/11/2026, Jomarly)', async () => {
  const { folhasDaMeiaFolha } = await import('../src/utils/minutaDomain');
  assert.deepEqual(folhasDaMeiaFolha(0), [[0, 0]]);
  assert.deepEqual(folhasDaMeiaFolha(8), [[0, 8]]);
  assert.deepEqual(folhasDaMeiaFolha(10), [[0, 9], [9, 10]]);
  // 13 itens (o caso do video): 12 na primeira, 1 + totais na segunda
  assert.deepEqual(folhasDaMeiaFolha(13), [[0, 12], [12, 13]]);
  assert.deepEqual(folhasDaMeiaFolha(20), [[0, 13], [13, 20]]);
  assert.deepEqual(folhasDaMeiaFolha(40), [[0, 13], [13, 26], [26, 39], [39, 40]]);
  // nada se perde nem repete
  for (let n = 0; n <= 60; n += 1) {
    const folhas = folhasDaMeiaFolha(n);
    assert.equal(folhas[0][0], 0);
    assert.equal(folhas[folhas.length - 1][1], n);
    folhas.slice(1).forEach(([ini], i) => assert.equal(ini, folhas[i][1]));
    assert.ok(folhas[folhas.length - 1][1] - folhas[folhas.length - 1][0] <= 8);
  }
});
