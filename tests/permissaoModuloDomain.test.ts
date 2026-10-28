import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modulosDaPermissao, permissaoForaDoPlano } from '../src/utils/permissaoModuloDomain';
import { PERMISSION_CATALOG } from '../src/utils/permissionCatalog';
import { MODULE_GROUPS, MODULO_PAI, moduleLabelMap, modulosBloqueadosEfetivos } from '../src/utils/moduleCatalog';
import { resolveRouteAccess } from '../src/utils/routeAccess';

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

/* Modulos separados (28/10/2026): Promocoes, Cashback, Balanco etc. com modulo proprio. */
test('modulo filho: pai bloqueado bloqueia junto; o filho bloqueia sozinho', () => {
  assert.deepEqual(modulosBloqueadosEfetivos([]), []);
  const comPedidos = modulosBloqueadosEfetivos(['comercial.pedidos']);
  for (const filho of ['comercial.promocoes', 'comercial.cashback', 'comercial.entregas_futuras']) {
    assert.ok(comPedidos.includes(filho), `${filho} segue o Pedido de Vendas`);
  }
  assert.deepEqual(modulosBloqueadosEfetivos(['comercial.cashback']), ['comercial.cashback'], 'so o cashback, pedidos seguem liberados');
});

test('todo modulo filho e todo pai existem no catalogo', () => {
  for (const [filho, pai] of Object.entries(MODULO_PAI)) {
    assert.ok(moduleLabelMap[filho], `${filho} no catalogo`);
    assert.ok(moduleLabelMap[pai], `${pai} no catalogo`);
  }
  const ids = MODULE_GROUPS.flatMap((g) => g.items.map((i) => i.id));
  assert.equal(new Set(ids).size, ids.length, 'sem modulo repetido');
});

test('as telas separadas apontam para o modulo proprio', () => {
  const casos: Array<[string, string]> = [
    ['/vendas/promocoes', 'comercial.promocoes'],
    ['/vendas/cashback', 'comercial.cashback'],
    ['/operacoes/entregas-futuras', 'comercial.entregas_futuras'],
    ['/estoque/balanco', 'estoque.balanco'],
    ['/estoque/balanco/contar', 'estoque.balanco'],
    ['/estoque/lotes', 'operacoes.lotes'],
    ['/estoque/movimentacao', 'estoque.movimentacao'],
    ['/estoque/relatorio', 'estoque.relatorio'],
    ['/estoque/relatorio-ajustes', 'estoque.relatorioAjustes'],
    ['/operacoes/romaneios', 'operacoes.romaneios'],
    ['/operacoes/frota', 'operacoes.frota'],
    ['/operacoes/frota/custos', 'operacoes.frota'],
    ['/operacoes/rotas', 'operacoes.rotas'],
    ['/financeiro/custos', 'financeiro.custos'],
    ['/fiscal/relatorio-contador', 'fiscal.relatorio_contador'],
    ['/fiscal/tabelas', 'fiscal.nfe'],
  ];
  for (const [rota, modulo] of casos) assert.equal(resolveRouteAccess(rota).routeModule, modulo, rota);
});

test('toda rota do sistema cai num modulo do catalogo', () => {
  const rotas = ['/pedidos-venda', '/minhas-vendas', '/estoque', '/estoque/ajuste', '/financeiro/caixas', '/fiscal/entrada-nfse', '/crm/agenda', '/configuracoes/filiais'];
  for (const rota of rotas) {
    const { routeModule } = resolveRouteAccess(rota);
    assert.ok(moduleLabelMap[routeModule], `${rota} -> ${routeModule}`);
  }
});

test('permissao da tela separada some quando o modulo dela (ou o pai) esta bloqueado', () => {
  assert.equal(permissaoForaDoPlano('vendas.cashback', modulosBloqueadosEfetivos(['comercial.pedidos'])), true);
  assert.equal(permissaoForaDoPlano('vendas.cashback', ['comercial.cashback']), true);
  assert.equal(permissaoForaDoPlano('vendas.pedidos', ['comercial.cashback']), false);
  assert.equal(permissaoForaDoPlano('estoque.balanco_contar', ['estoque.balanco']), true);
  assert.equal(permissaoForaDoPlano('operacoes.romaneios', ['operacoes.romaneios']), true);
  assert.equal(permissaoForaDoPlano('fiscal.relatorio_contador', ['fiscal.relatorio_contador']), true);
});
