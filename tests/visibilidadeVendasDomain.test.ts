import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_NIVEL_ACESSO,
  NIVEIS_ACESSO,
  podeVerVendasDeTodos,
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
  assert.equal(parseNivelAcesso('diretor'), 'funcionario');
  assert.equal(parseNivelAcesso('funcionario'), 'funcionario');
  // Cargos validos desde 2026-09-01; 'gerente' era invalido antes disso.
  assert.equal(parseNivelAcesso('supervisor'), 'supervisor');
  assert.equal(parseNivelAcesso('gerente'), 'gerente');
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

test('cargo acima de funcionario ve tudo mesmo com a restricao ligada', () => {
  assert.equal(
    somenteVendasProprias({ restricaoAtiva: true, nivelAcesso: 'gerente', role: 'Funcionario', isOwner: false }),
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

// --- Balcao compartilhado: quem esta logado e a estacao, nao a pessoa ------

test('identificacao do vendedor ligada desliga o filtro por uid', () => {
  // A venda fica no nome de quem digitou o PIN, que nunca e o uid da estacao
  // (balcao01). Filtrar por uid ali nao esconde nada de ninguem -- esconde
  // TUDO da estacao, inclusive a venda que ela acabou de fazer. Era o bug de
  // "venda de outro vendedor" ao imprimir logo depois de finalizar.
  assert.equal(somenteVendasProprias({
    restricaoAtiva: true,
    nivelAcesso: 'funcionario',
    role: 'Funcionario',
    isOwner: false,
    identificacaoVendedorAtiva: true,
  }), false);
});

test('sem identificacao de vendedor a restricao por uid continua valendo', () => {
  assert.equal(somenteVendasProprias({
    restricaoAtiva: true,
    nivelAcesso: 'funcionario',
    role: 'Funcionario',
    isOwner: false,
    identificacaoVendedorAtiva: false,
  }), true);

  // Campo ausente (empresa que nunca abriu a config) se comporta igual.
  assert.equal(somenteVendasProprias({
    restricaoAtiva: true,
    nivelAcesso: 'funcionario',
    role: 'Funcionario',
    isOwner: false,
  }), true);
});

// --- Cargos: funcionario, supervisor e gerente ----------------------------

test('os tres cargos existem, e o padrao e o mais restrito', () => {
  assert.deepEqual(NIVEIS_ACESSO, ['funcionario', 'supervisor', 'gerente']);
  assert.equal(parseNivelAcesso(undefined), 'funcionario');
  assert.equal(parseNivelAcesso('qualquer coisa'), 'funcionario');
});

test('o nome antigo "administracao" vira gerente, nao vira funcionario', () => {
  // Quem ja estava marcado assim NAO pode perder acesso por causa da troca de
  // nome -- cairia em 'funcionario' e passaria a nao ver as vendas da equipe.
  assert.equal(parseNivelAcesso('administracao'), 'gerente');
});

test('supervisor e gerente veem as vendas de todos; funcionario nao', () => {
  const base = { role: 'Funcionario', isOwner: false };
  assert.equal(podeVerVendasDeTodos({ ...base, nivelAcesso: 'funcionario' }), false);
  assert.equal(podeVerVendasDeTodos({ ...base, nivelAcesso: 'supervisor' }), true);
  assert.equal(podeVerVendasDeTodos({ ...base, nivelAcesso: 'gerente' }), true);
});

test('dono e papel de gestor veem tudo, seja qual for o cargo', () => {
  assert.equal(podeVerVendasDeTodos({ nivelAcesso: 'funcionario', role: 'Funcionario', isOwner: true }), true);
  for (const role of ['Master', 'Admin', 'SuperAdmin', 'NexarAdmin']) {
    assert.equal(podeVerVendasDeTodos({ nivelAcesso: 'funcionario', role, isOwner: false }), true, role);
  }
});

test('supervisor e gerente escapam da restricao de "so as proprias vendas"', () => {
  // Sem identificacao por PIN: e' a trava classica, por uid.
  const base = { restricaoAtiva: true, role: 'Funcionario', isOwner: false, identificacaoVendedorAtiva: false };
  assert.equal(somenteVendasProprias({ ...base, nivelAcesso: 'funcionario' }), true);
  assert.equal(somenteVendasProprias({ ...base, nivelAcesso: 'supervisor' }), false);
  assert.equal(somenteVendasProprias({ ...base, nivelAcesso: 'gerente' }), false);
});
