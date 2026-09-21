import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ESTILO_STATUS_TROCA,
  MOTIVOS_TROCA,
  STATUS_TROCA_ORDEM,
  acoesDaLoja,
  custoEmReais,
  errosDoRascunhoDeTroca,
  rotuloDoMotivoTroca,
  totalDeItens,
  vendedorPodeCancelar,
  type ItemTrocaRascunho,
} from '../src/utils/trocaDomain';

const item = (extra: Partial<ItemTrocaRascunho> = {}): ItemTrocaRascunho => ({
  id: 'p1', nome: 'GRANOLA 1KG', quantidade: 2, unidadeMedidaSigla: 'UN', motivo: 'com_bicho', ...extra,
});

test('motivos combinados e rotulo em portugues (o desconhecido volta como veio)', () => {
  assert.deepEqual(MOTIVOS_TROCA.map((m) => m.value), ['embalagem_rasgada', 'com_bicho', 'vencido', 'produto_errado', 'outro']);
  assert.equal(rotuloDoMotivoTroca('vencido'), 'Vencido ou vencendo');
  assert.equal(rotuloDoMotivoTroca('xyz'), 'xyz');
});

test('todo estado tem estilo e explicacao', () => {
  for (const status of STATUS_TROCA_ORDEM) {
    assert.ok(ESTILO_STATUS_TROCA[status].cor.startsWith('#'), status);
    assert.ok(ESTILO_STATUS_TROCA[status].explicacao.length > 5, status);
  }
});

test('botoes da loja por estado', () => {
  assert.deepEqual(acoesDaLoja('Solicitada'), ['aprovar', 'recusar', 'cancelar']);
  assert.deepEqual(acoesDaLoja('Aprovada'), ['minuta', 'entregar', 'cancelar']);
  assert.deepEqual(acoesDaLoja('Entregue'), ['minuta']);
  assert.deepEqual(acoesDaLoja('Recusada'), []);
  assert.deepEqual(acoesDaLoja('Cancelada'), []);
});

test('vendedor so cancela a propria troca enquanto Solicitada', () => {
  assert.equal(vendedorPodeCancelar({ status: 'Solicitada', vendedorId: 'u1' }, 'u1'), true);
  assert.equal(vendedorPodeCancelar({ status: 'Solicitada', vendedorId: 'u1' }, 'u2'), false);
  assert.equal(vendedorPodeCancelar({ status: 'Aprovada', vendedorId: 'u1' }, 'u1'), false);
});

test('rascunho valido nao tem erro', () => {
  assert.deepEqual(errosDoRascunhoDeTroca({ clienteId: 'c1', itens: [item()] }), []);
});

test('rascunho: cliente e itens sao obrigatorios', () => {
  const erros = errosDoRascunhoDeTroca({ clienteId: null, itens: [] });
  assert.deepEqual(erros, ['Selecione o cliente da troca.', 'Adicione pelo menos um item na troca.']);
});

test('rascunho: motivo obrigatorio por item e "Outro" pede descricao', () => {
  const erros = errosDoRascunhoDeTroca({ clienteId: 'c1', itens: [item({ motivo: '' }), item({ motivo: 'outro' }), item({ motivo: 'outro', motivoDescricao: 'ab' }), item({ motivo: 'outro', motivoDescricao: 'cheiro estranho' })] });
  assert.equal(erros.length, 3);
  assert.match(erros[0], /Item 1 \(GRANOLA 1KG\): escolha o motivo/);
  assert.match(erros[1], /Item 2.*descreva o motivo/);
  assert.match(erros[2], /Item 3.*descreva o motivo/);
});

test('totais', () => {
  assert.equal(totalDeItens([{ quantidade: 2 }, { quantidade: 3.5 }]), 5.5);
  assert.equal(custoEmReais(3750), 37.5);
  assert.equal(custoEmReais(undefined), 0);
});
