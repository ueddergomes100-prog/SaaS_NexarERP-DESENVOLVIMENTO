import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UNIDADES_MEDIDA_PADRAO,
  findUnidadeEmUso,
  isSiglaPadrao,
  resolverUnidadeDoCadastro,
} from '../src/utils/unidadeMedidaDomain';
import { pickMissingDefaults } from '../src/utils/catalogDefaults';

test('sao 10 unidades padrao, sem sigla repetida', () => {
  assert.equal(UNIDADES_MEDIDA_PADRAO.length, 10);
  const siglas = new Set(UNIDADES_MEDIDA_PADRAO.map((u) => u.sigla));
  assert.equal(siglas.size, 10);
});

test('mantem as siglas que o botao antigo de padroes ja criava', () => {
  // Trocar qualquer uma destas criaria uma unidade equivalente ao lado da
  // antiga em todo tenant que ja tinha as originais.
  ['UN', 'KG', 'LTS', 'MT'].forEach((sigla) => {
    assert.ok(UNIDADES_MEDIDA_PADRAO.some((u) => u.sigla === sigla), `faltou ${sigla}`);
  });
});

test('so unidade fracionavel tem casas decimais', () => {
  UNIDADES_MEDIDA_PADRAO.forEach((u) => {
    if (!u.permiteFracionado) assert.equal(u.casasDecimais, 0, `${u.sigla} nao fracionada com casas`);
    else assert.ok(u.casasDecimais > 0, `${u.sigla} fracionada sem casas`);
  });
});

test('isSiglaPadrao ignora caixa e espacos', () => {
  assert.equal(isSiglaPadrao('kg'), true);
  assert.equal(isSiglaPadrao(' SC '), true);
  assert.equal(isSiglaPadrao('XYZ'), false);
  assert.equal(isSiglaPadrao(''), false);
  assert.equal(isSiglaPadrao(undefined), false);
});

test('pickMissingDefaults nao recria a unidade que o tenant ja tem', () => {
  const existentes = [{ sigla: 'UN' }, { sigla: 'kg' }, { sigla: 'MT' }];

  const faltando = pickMissingDefaults(UNIDADES_MEDIDA_PADRAO, existentes, 'sigla');

  assert.equal(faltando.length, 7);
  assert.equal(faltando.some((u) => u.sigla === 'KG'), false);
  assert.equal(faltando.some((u) => u.sigla === 'SC'), true);
});

test('acha produto que usa a unidade como unidade base', () => {
  const uso = findUnidadeEmUso('u-kg', [
    { id: 'p1', nome: 'ARROZ', unidadeMedidaId: 'u-kg' },
  ]);

  assert.deepEqual(uso, { produtoNome: 'ARROZ', origem: 'base' });
});

test('acha produto que usa a unidade dentro de uma embalagem', () => {
  const uso = findUnidadeEmUso('u-sc', [
    {
      id: 'p1',
      nome: 'RACAO',
      unidadeMedidaId: 'u-kg',
      embalagens: [{ id: 'e1', unidadeMedidaId: 'u-sc', fatorConversao: 20 }],
    },
  ]);

  assert.deepEqual(uso, { produtoNome: 'RACAO', origem: 'embalagem' });
});

test('embalagem inativa ainda conta como uso', () => {
  // Desativada nao e' o mesmo que apagada: reativar depois com a unidade ja
  // excluida deixaria a embalagem apontando pro vazio.
  const uso = findUnidadeEmUso('u-sc', [
    {
      id: 'p1',
      nome: 'RACAO',
      embalagens: [{ id: 'e1', unidadeMedidaId: 'u-sc', fatorConversao: 20, ativo: false }],
    },
  ]);

  assert.equal(uso?.origem, 'embalagem');
});

test('unidade sem nenhum produto vinculado devolve null', () => {
  const uso = findUnidadeEmUso('u-livre', [
    { id: 'p1', nome: 'ARROZ', unidadeMedidaId: 'u-kg' },
    { id: 'p2', nome: 'RACAO', unidadeMedidaId: 'u-kg', embalagens: [{ id: 'e1', unidadeMedidaId: 'u-sc', fatorConversao: 20 }] },
  ]);

  assert.equal(uso, null);
});

test('id vazio nunca acusa uso', () => {
  assert.equal(findUnidadeEmUso('', [{ id: 'p1', nome: 'X', unidadeMedidaId: '' }]), null);
});

test('cadastro do produto: o seletor so marca unidade que existe na lista', () => {
  const unidades = [
    { id: 'id-kg', sigla: 'KG' },
    { id: 'id-un', sigla: 'UN' },
  ];
  // Produto novo comecava com o id fixo 'un' (da lista de reserva): a tela
  // mostrava KG e o save gravava UN. Agora resolve pela sigla padrao.
  assert.equal(resolverUnidadeDoCadastro(unidades, 'un', 'UN'), 'id-un');
  // Id gravado e existente vence.
  assert.equal(resolverUnidadeDoCadastro(unidades, 'id-kg', 'UN'), 'id-kg');
  // Unidade recriada com outro id: acha pela sigla gravada.
  assert.equal(resolverUnidadeDoCadastro(unidades, 'id-apagado', 'kg'), 'id-kg');
  // Sem id e sem sigla que bata: nenhuma marcada ("Selecione...").
  assert.equal(resolverUnidadeDoCadastro(unidades, '', ''), '');
  assert.equal(resolverUnidadeDoCadastro(unidades, undefined, 'CX'), '');
  // Empresa sem UN cadastrada: produto novo fica sem unidade marcada.
  assert.equal(resolverUnidadeDoCadastro([{ id: 'id-kg', sigla: 'KG' }], 'un', 'UN'), '');
});
