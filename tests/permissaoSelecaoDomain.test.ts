import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PERMISSION_CATALOG,
  PERMISSION_GROUPS,
  desmarcarPermissoes,
  estadoDaSelecao,
  marcarPermissoes,
} from '../src/utils/permissionCatalog';

test('marcar acrescenta sem duplicar e mantem a ordem do que ja existia', () => {
  const resultado = marcarPermissoes(['a', 'b'], ['b', 'c']);
  assert.deepEqual(resultado, ['a', 'b', 'c']);
});

test('marcar sobre lista vazia devolve exatamente os visiveis', () => {
  assert.deepEqual(marcarPermissoes([], ['x', 'y']), ['x', 'y']);
});

test('desmarcar tira so os visiveis e PRESERVA o que a busca escondeu', () => {
  // A pessoa buscou "estoque" e desmarcou todas: 'vendas.criar', que nem
  // estava na tela, tem que continuar marcada.
  const atuais = ['estoque.ver', 'estoque.editar', 'vendas.criar'];
  const visiveis = ['estoque.ver', 'estoque.editar'];
  assert.deepEqual(desmarcarPermissoes(atuais, visiveis), ['vendas.criar']);
});

test('marcar tambem nao mexe no que esta fora da tela', () => {
  const resultado = marcarPermissoes(['vendas.criar'], ['estoque.ver']);
  assert.deepEqual(resultado, ['vendas.criar', 'estoque.ver']);
});

test('desmarcar id que nao estava marcado nao quebra nem muda nada', () => {
  assert.deepEqual(desmarcarPermissoes(['a'], ['b', 'c']), ['a']);
});

test('estado da selecao: todas, nenhuma e parcial', () => {
  assert.equal(estadoDaSelecao(['a', 'b'], ['a', 'b']), 'todas');
  assert.equal(estadoDaSelecao(['a'], ['a', 'b']), 'parcial');
  assert.equal(estadoDaSelecao([], ['a', 'b']), 'nenhuma');
  assert.equal(estadoDaSelecao(['c'], ['a', 'b']), 'nenhuma');
});

test('lista visivel vazia (busca sem resultado) nunca conta como "todas"', () => {
  assert.equal(estadoDaSelecao(['a', 'b'], []), 'nenhuma');
});

test('permissao marcada que saiu do catalogo sobrevive ao marcar todas', () => {
  // Permissao antiga, removida do catalogo numa versao nova: nao esta entre
  // os visiveis, entao ninguem a apaga sem querer ao clicar "marcar todas".
  const idsDoCatalogo = PERMISSION_CATALOG.map((p) => p.id);
  const resultado = marcarPermissoes(['modulo.que_nao_existe_mais'], idsDoCatalogo);
  assert.ok(resultado.includes('modulo.que_nao_existe_mais'));
  assert.equal(resultado.length, idsDoCatalogo.length + 1);
});

test('marcar todas do catalogo inteiro liga todas as permissoes de todos os grupos', () => {
  const todos = PERMISSION_CATALOG.map((p) => p.id);
  const resultado = marcarPermissoes([], todos);
  assert.equal(estadoDaSelecao(resultado, todos), 'todas');
  for (const grupo of PERMISSION_GROUPS) {
    const idsDoGrupo = grupo.itens.map((i) => i.id);
    assert.equal(estadoDaSelecao(resultado, idsDoGrupo), 'todas', grupo.grupo);
  }
});

test('desmarcar um grupo so deixa os outros grupos intactos', () => {
  const todos = PERMISSION_CATALOG.map((p) => p.id);
  const marcadas = marcarPermissoes([], todos);
  const primeiro = PERMISSION_GROUPS[0];
  const restante = desmarcarPermissoes(marcadas, primeiro.itens.map((i) => i.id));

  assert.equal(estadoDaSelecao(restante, primeiro.itens.map((i) => i.id)), 'nenhuma');
  for (const grupo of PERMISSION_GROUPS.slice(1)) {
    assert.equal(estadoDaSelecao(restante, grupo.itens.map((i) => i.id)), 'todas', grupo.grupo);
  }
});

test('nenhum id do catalogo se repete (senao o contador "X de Y" mente)', () => {
  const ids = PERMISSION_CATALOG.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});
