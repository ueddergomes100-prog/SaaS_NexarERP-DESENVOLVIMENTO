import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modulosDaPermissao, permissaoForaDoPlano } from '../src/utils/permissaoModuloDomain';
import { PERMISSION_CATALOG } from '../src/utils/permissionCatalog';
import { moduleLabelMap } from '../src/utils/moduleCatalog';

/* Permissao de modulo bloqueado pelo SuperAdmin fica apagada (19/10/2026). */

test('todo modulo citado existe no catalogo do SuperAdmin', () => {
  for (const item of PERMISSION_CATALOG) {
    for (const modulo of modulosDaPermissao(item.id)) {
      assert.ok(moduleLabelMap[modulo], `${item.id} aponta para o modulo inexistente ${modulo}`);
    }
  }
});

test('Servicos bloqueado apaga todas as permissoes de OS; o resto segue', () => {
  const bloqueados = ['mecanica.os', 'mecanica.relatorios'];
  for (const id of ['mecanica.os', 'mecanica.os_alterar', 'mecanica.os_app', 'mecanica.os_app_abrir', 'mecanica.os_excluir', 'mecanica.relatorios']) {
    assert.equal(permissaoForaDoPlano(id, bloqueados), true, id);
  }
  assert.equal(permissaoForaDoPlano('vendas.pedidos', bloqueados), false);
  assert.equal(permissaoForaDoPlano('filiais.utilizar', bloqueados), false, 'sem modulo nunca bloqueia');
  assert.equal(permissaoForaDoPlano('mecanica.os', []), false);
});

test('modulos em breve e permissao de varios modulos', () => {
  assert.equal(permissaoForaDoPlano('compras.pedidos', ['compras.pedidos']), true);
  assert.equal(permissaoForaDoPlano('operacoes.lotes', ['operacoes.lotes']), true);
  assert.equal(permissaoForaDoPlano('financeiro.desconto_baixa', ['financeiro.receber']), false, 'Contas a Pagar ainda usa');
  assert.equal(permissaoForaDoPlano('financeiro.desconto_baixa', ['financeiro.receber', 'financeiro.pagar']), true);
});
