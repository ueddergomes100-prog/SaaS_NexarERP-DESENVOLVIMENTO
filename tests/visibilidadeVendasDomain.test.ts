import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_NIVEL_ACESSO,
  filtrarLancamentosVisiveis,
  filtrarVendasVisiveis,
  isVendaDoUsuario,
  lancamentoVeioDeVenda,
  parseNivelAcesso,
  parseRestringirVendasPorUsuario,
  somenteVendasProprias,
  vendedorDaVenda,
} from '../src/utils/visibilidadeVendasDomain';

test('parseNivelAcesso cai no default para valor invalido ou ausente', () => {
  assert.equal(parseNivelAcesso(undefined), DEFAULT_NIVEL_ACESSO);
  assert.equal(parseNivelAcesso(null), 'funcionario');
  assert.equal(parseNivelAcesso('gerente'), 'funcionario');
  assert.equal(parseNivelAcesso('administracao'), 'administracao');
  assert.equal(parseNivelAcesso('funcionario'), 'funcionario');
});

test('parseRestringirVendasPorUsuario so aceita true booleano', () => {
  assert.equal(parseRestringirVendasPorUsuario(true), true);
  assert.equal(parseRestringirVendasPorUsuario('true'), false);
  assert.equal(parseRestringirVendasPorUsuario(1), false);
  assert.equal(parseRestringirVendasPorUsuario(undefined), false);
});

test('sem a restricao ligada na empresa ninguem fica limitado', () => {
  assert.equal(
    somenteVendasProprias({ restricaoAtiva: false, nivelAcesso: 'funcionario', role: 'Funcionario', isOwner: false }),
    false,
  );
});

test('com a restricao ligada o funcionario fica limitado as proprias vendas', () => {
  assert.equal(
    somenteVendasProprias({ restricaoAtiva: true, nivelAcesso: 'funcionario', role: 'Funcionario', isOwner: false }),
    true,
  );
});

test('nivel administracao ve tudo mesmo com a restricao ligada', () => {
  assert.equal(
    somenteVendasProprias({ restricaoAtiva: true, nivelAcesso: 'administracao', role: 'Funcionario', isOwner: false }),
    false,
  );
});

test('dono e roles de acesso total nunca perdem visibilidade', () => {
  assert.equal(
    somenteVendasProprias({ restricaoAtiva: true, nivelAcesso: 'funcionario', role: 'Funcionario', isOwner: true }),
    false,
  );
  for (const role of ['Master', 'Admin', 'SuperAdmin', 'NexarAdmin']) {
    assert.equal(
      somenteVendasProprias({ restricaoAtiva: true, nivelAcesso: 'funcionario', role, isOwner: false }),
      false,
      `role ${role} nao deveria ser restringida`,
    );
  }
});

test('vendedorDaVenda respeita a ordem vendedorId > usuarioResponsavelId > criadoPor', () => {
  assert.equal(vendedorDaVenda({ vendedorId: 'a', usuarioResponsavelId: 'b', criadoPor: 'c' }), 'a');
  assert.equal(vendedorDaVenda({ usuarioResponsavelId: 'b', criadoPor: 'c' }), 'b');
  assert.equal(vendedorDaVenda({ criadoPor: 'c' }), 'c');
  assert.equal(vendedorDaVenda({}), '');
  assert.equal(vendedorDaVenda(null), '');
});

test('venda sem dono nenhum nao conta como venda do usuario', () => {
  assert.equal(isVendaDoUsuario({}, 'user-1'), false);
  assert.equal(isVendaDoUsuario({ vendedorId: '' }, 'user-1'), false);
});

test('isVendaDoUsuario exige usuario informado', () => {
  assert.equal(isVendaDoUsuario({ vendedorId: 'user-1' }, null), false);
  assert.equal(isVendaDoUsuario({ vendedorId: 'user-1' }, ''), false);
  assert.equal(isVendaDoUsuario({ vendedorId: 'user-1' }, 'user-1'), true);
});

test('filtrarVendasVisiveis sem usuario devolve a lista inteira', () => {
  const vendas = [{ vendedorId: 'a' }, { vendedorId: 'b' }];
  assert.deepEqual(filtrarVendasVisiveis(vendas, null), vendas);
});

test('filtrarVendasVisiveis mantem so as vendas do usuario, inclusive por fallback', () => {
  const vendas = [
    { vendedorId: 'user-1' },
    { vendedorId: 'user-2' },
    { usuarioResponsavelId: 'user-1' },
    { criadoPor: 'user-1' },
    { criadoPor: 'user-3' },
    {},
  ];
  assert.deepEqual(filtrarVendasVisiveis(vendas, 'user-1'), [
    { vendedorId: 'user-1' },
    { usuarioResponsavelId: 'user-1' },
    { criadoPor: 'user-1' },
  ]);
});

test('lancamentoVeioDeVenda reconhece sourceType e pedidoId', () => {
  assert.equal(lancamentoVeioDeVenda({ sourceType: 'pedido_venda' }), true);
  assert.equal(lancamentoVeioDeVenda({ pedidoId: 'venda-1' }), true);
  assert.equal(lancamentoVeioDeVenda({ sourceType: 'ordem_servico' }), false);
  assert.equal(lancamentoVeioDeVenda({}), false);
  assert.equal(lancamentoVeioDeVenda(null), false);
});

test('filtrarLancamentosVisiveis mantem o que nao veio de venda', () => {
  const lancamentos = [
    { id: 'conta-de-luz' },
    { id: 'os', sourceType: 'ordem_servico', vendedorId: 'user-2' },
    { id: 'venda-propria', sourceType: 'pedido_venda', pedidoId: 'p1', vendedorId: 'user-1' },
    { id: 'venda-alheia', sourceType: 'pedido_venda', pedidoId: 'p2', vendedorId: 'user-2' },
  ];
  assert.deepEqual(
    filtrarLancamentosVisiveis(lancamentos, 'user-1').map((l) => l.id),
    ['conta-de-luz', 'os', 'venda-propria'],
  );
});

test('filtrarLancamentosVisiveis sem usuario nao esconde nada', () => {
  const lancamentos = [{ sourceType: 'pedido_venda', vendedorId: 'user-2' }];
  assert.deepEqual(filtrarLancamentosVisiveis(lancamentos, null), lancamentos);
});
