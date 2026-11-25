import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  avisoDoDestinatario,
  fatorDoFornecedor,
  fornecedorDoXml,
  itemAvulsoDoXml,
  parcelasDasDuplicatas,
  vinculoAutomatico,
} from '../src/utils/notaAvulsaXmlDomain';

const produtos = [
  { id: 'p1', nome: 'CAIXA 30X20', codigoBarras: '7891000100103', codigosFornecedor: { f1: 'CX30' }, fatoresFornecedor: { f1: 12 } },
  { id: 'p2', nome: 'FITA ADESIVA', codigoBarras: '' },
];

test('vinculo: pelo codigo deste fornecedor, depois pelo codigo de barras; senao a pessoa escolhe', () => {
  assert.equal(vinculoAutomatico({ codigo: 'cx30', ean: '' }, produtos, 'f1')?.origem, 'codigo_fornecedor');
  assert.equal(vinculoAutomatico({ codigo: 'CX30', ean: '' }, produtos, 'f2'), null, 'codigo de outro fornecedor nao vale');
  assert.equal(vinculoAutomatico({ codigo: 'X', ean: '7891000100103' }, produtos, 'f2')?.produto.id, 'p1');
  assert.equal(vinculoAutomatico({ codigo: 'X', ean: '00000000' }, produtos, 'f2'), null);
  assert.equal(fatorDoFornecedor(produtos[0], 'f1'), 12);
  assert.equal(fatorDoFornecedor(produtos[0], 'f2'), 1);
});

test('item do XML: caixa com 12 vira 12 unidades e o custo por unidade divide; o total nao muda', () => {
  const item = itemAvulsoDoXml({ quantidade: 2, valorProduto: 120, valorUnitario: 60, codigo: 'CX30' }, { id: 'p1', nome: 'CAIXA 30X20', precoVenda: 9 }, 12);
  assert.equal(item.quantidade, 24);
  assert.equal(item.precoCusto, 5);
  assert.equal(item.codigoFornecedor, 'CX30');
  assert.equal(itemAvulsoDoXml({ quantidade: 3, valorProduto: 0, valorUnitario: 2, codigo: '' }, { id: 'p2', nome: 'FITA' }).codigoFornecedor, undefined);
});

test('boletos do XML viram parcelas; XML desta empresa vai para a Entrada de XML; fornecedor pelo CNPJ', () => {
  const parcelas = parcelasDasDuplicatas([{ numero: '001', vencimento: '2026-12-10', valor: 60 }, { numero: '002', vencimento: '', valor: 60.005 }], '2026-11-25');
  assert.deepEqual(parcelas.map((p) => [p.numero, p.vencimento, p.valor, p.forma]), [['1', '2026-12-10', 60, 'Boleto'], ['2', '2026-11-25', 60.01, 'Boleto']]);
  assert.match(avisoDoDestinatario('12.345.678/0001-90', { destinatario: { documento: '12345678000190', nome: '', fantasia: '', inscricaoEstadual: '', regime: '', endereco: {} as never } }) || '', /Entrada de XML/);
  assert.equal(avisoDoDestinatario('12345678000190', { destinatario: { documento: '11122233344', nome: '', fantasia: '', inscricaoEstadual: '', regime: '', endereco: {} as never } }), null);
  assert.equal(fornecedorDoXml([{ id: 'f1', documento: '11.222.333/0001-44' }], { emitente: { documento: '11222333000144', nome: '', fantasia: '', inscricaoEstadual: '', regime: '', endereco: {} as never } })?.id, 'f1');
});
