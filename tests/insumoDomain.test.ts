import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  abaixoDoMinimo,
  erroDoInsumo,
  insumosDoRelatorio,
  montarDocumentoInsumos,
  numeroDoInsumo,
  valorEmEstoqueCentavos,
  type FormularioDoInsumo,
  type InsumoDoCadastro,
} from '../src/utils/insumoDomain';

const form = (extra: Partial<FormularioDoInsumo> = {}): FormularioDoInsumo => ({
  codigo: '', nome: 'Caixa de papelão 30x20', unidade: 'UN', estoqueMinimo: '', precoCusto: '', quantidade: '', fornecedor: '', observacao: '', ...extra,
});

const existentes: InsumoDoCadastro[] = [
  { id: 'i1', codigo: 'CX1', nome: 'Fita adesiva', unidade: 'ROLO', quantidade: 4, estoqueMinimo: 10, custoMedio: 5.5 },
  { id: 'i2', codigo: 'CX2', nome: 'Etiqueta', unidade: 'UN', quantidade: 100, estoqueMinimo: 20, precoCusto: 0.1 },
  { id: 'i3', nome: 'Luva antiga', unidade: 'PAR', quantidade: 3, ativo: false, custoMedio: 2 },
];

test('numero digitado aceita virgula, ponto de milhar e vazio', () => {
  assert.equal(numeroDoInsumo('1.234,56'), 1234.56);
  assert.equal(numeroDoInsumo('12.5'), 12.5);
  assert.equal(numeroDoInsumo(''), 0);
  assert.ok(Number.isNaN(numeroDoInsumo('abc')));
});

test('cadastro completo passa; falta nome ou unidade, bloqueia em português', () => {
  assert.equal(erroDoInsumo(form(), existentes, null), null);
  assert.match(String(erroDoInsumo(form({ nome: ' ' }), existentes, null)), /nome do insumo/);
  assert.match(String(erroDoInsumo(form({ unidade: '' }), existentes, null)), /unidade/);
});

test('nome repetido (sem acento/caixa) e código repetido bloqueiam; editar o próprio não', () => {
  assert.match(String(erroDoInsumo(form({ nome: 'FITA ADESIVA' }), existentes, null)), /Já existe um insumo/);
  assert.equal(erroDoInsumo(form({ nome: 'FITA ADESIVA' }), existentes, 'i1'), null);
  assert.match(String(erroDoInsumo(form({ codigo: 'cx2' }), existentes, null)), /já é do insumo "Etiqueta"/);
});

test('números negativos ou inválidos bloqueiam com o campo certo', () => {
  assert.match(String(erroDoInsumo(form({ estoqueMinimo: '-1' }), existentes, null)), /estoque mínimo/);
  assert.match(String(erroDoInsumo(form({ precoCusto: 'x' }), existentes, null)), /custo/);
});

test('valor em estoque usa o custo médio (ou o último custo) e nunca é negativo', () => {
  assert.equal(valorEmEstoqueCentavos(existentes[0]), 2200);
  assert.equal(valorEmEstoqueCentavos(existentes[1]), 1000);
  assert.equal(valorEmEstoqueCentavos({ id: 'x', nome: 'X', quantidade: -3, custoMedio: 9 }), 0);
});

test('abaixo do mínimo só conta quando há mínimo definido', () => {
  assert.equal(abaixoDoMinimo(existentes[0]), true);
  assert.equal(abaixoDoMinimo(existentes[1]), false);
  assert.equal(abaixoDoMinimo({ id: 'x', nome: 'X', quantidade: 0 }), false);
});

test('relatório: ativos por padrão, inativos só em "todos", e o filtro de mínimo', () => {
  assert.deepEqual(insumosDoRelatorio(existentes, { situacao: 'ativos' }).map((i) => i.id), ['i2', 'i1']);
  assert.equal(insumosDoRelatorio(existentes, { situacao: 'todos' }).length, 3);
  assert.deepEqual(insumosDoRelatorio(existentes, { situacao: 'abaixo_minimo' }).map((i) => i.id), ['i1']);
  const doc = montarDocumentoInsumos(existentes, { situacao: 'ativos' }, '2026-09-25');
  assert.equal(doc.titulo, 'Estoque de Insumos');
  assert.equal(doc.periodo, 'Posição em 25/09/2026');
  assert.equal(doc.indicadores[0].valor, '2');
  assert.equal(doc.indicadores[2].valor, '1');
});
