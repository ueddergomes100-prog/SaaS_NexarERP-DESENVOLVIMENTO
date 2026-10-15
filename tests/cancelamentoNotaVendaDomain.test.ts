import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classificarNotasDaVenda,
  descricaoDaNota,
  ehErroDePrazo,
  listaDeNotas,
  tipoSpedyDaNota,
  validarJustificativaCancelamento,
} from '../src/utils/cancelamentoNotaVendaDomain';

test('so notas da venda (NF-e/NFC-e, sem devolucao) impedem cancelar so a venda', () => {
  const r = classificarNotasDaVenda([
    { id: 'a', tipo: 'NF-e', status: 'authorized', number: 93 },
    { id: 'b', tipo: 'NFC-e', status: 'processing' },
    { id: 'c', tipo: 'NF-e', status: 'authorized', finalidade: 'devolucao' },
    { id: 'd', tipo: 'NF-e', status: 'canceled' },
    { id: 'e', tipo: 'NF-e', status: 'rejected' },
    { id: 'f', tipo: 'NFS-e', status: 'authorized' },
  ]);
  assert.deepEqual(r.autorizadas.map((n) => n.id), ['a']);
  assert.deepEqual(r.emTransmissao.map((n) => n.id), ['b']);
});

test('nome da nota como o cliente le, sem zeros', () => {
  assert.equal(descricaoDaNota({ tipo: 'NF-e', number: '000093' }), 'NF-e nº 93');
  assert.equal(descricaoDaNota({ tipo: 'NFC-e' }), 'NFC-e');
  assert.equal(listaDeNotas([{ tipo: 'NF-e', number: 93 }]), 'NF-e nº 93');
  assert.equal(listaDeNotas([{ tipo: 'NFC-e', number: 12 }, { tipo: 'NF-e', number: 93 }]), 'NFC-e nº 12 e NF-e nº 93');
});

test('tipo da Spedy: cupom e consumer, o resto product', () => {
  assert.equal(tipoSpedyDaNota('NFC-e'), 'consumer');
  assert.equal(tipoSpedyDaNota('NF-e'), 'product');
});

test('motivo do cancelamento: de 15 a 255 letras, contadas sem espacos nas pontas', () => {
  assert.match(validarJustificativaCancelamento('curto') || '', /15 letras/);
  assert.match(validarJustificativaCancelamento('   quatorze letr   ') || '', /15 letras/);
  assert.equal(validarJustificativaCancelamento('Venda não aconteceu, cliente desistiu'), null);
  assert.match(validarJustificativaCancelamento('x'.repeat(256)) || '', /255/);
});

test('erro de prazo da SEFAZ e reconhecido', () => {
  assert.equal(ehErroDePrazo('Prazo de cancelamento superior ao previsto na legislação'), true);
  assert.equal(ehErroDePrazo('Rejeicao 501'), true);
  assert.equal(ehErroDePrazo('Erro de conexão'), false);
});
