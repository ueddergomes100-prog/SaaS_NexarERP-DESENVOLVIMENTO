const test = require('node:test');
const assert = require('node:assert/strict');

const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

/*
 * Reabrir o caixa (27/11/2026, pedido do dono): so' no mesmo dia do fechamento,
 * so' quem abriu (ou o dono), sem outro caixa aberto da pessoa, e o fechamento
 * desfeito fica guardado no caixa e no Historico de alteracoes.
 */

const PERMISSAO = 'vendas.pdv_reabrir_caixa';
const OPERADOR = { uid: 'op1', email: 'op1@teste', nome: 'ANA', tenantId: 'emp1', permissoes: [PERMISSAO] };
const ONTEM = new Date(Date.now() - 30 * 60 * 60 * 1000);

const fechado = (extra) => ({
  tenantId: 'emp1', status: 'fechado', operadorId: 'op1', operadorNome: 'ANA',
  fechadoEm: new Date(), saldoEsperadoCentavos: 15000, saldoFinalInformadoCentavos: 14000, diferencaCentavos: -1000,
  fechadoPorId: 'op1', fechadoPorNome: 'ANA', ...extra,
});

const montar = (docs) => {
  const fake = criarBancoFalso({
    'caixas_pdv/hoje': fechado({}),
    'caixas_pdv/ontem': fechado({ fechadoEm: ONTEM }),
    'caixas_pdv/comData': fechado({ fechadoComDataDe: '2026-11-26' }),
    'caixas_pdv/doOutro': fechado({ operadorId: 'op2', operadorNome: 'BRUNO' }),
    ...docs,
  }, { consultas: true });
  const [, , , servico] = carregarComBancoFalso(fake.db, 'services/reaberturaCaixaPdv');
  return { fake, s: servico };
};

test('reabrir: caixa fechado hoje volta a ficar aberto, sem o fechamento, e fica no historico', async () => {
  const { fake, s } = montar();
  await s.reabrirCaixaPdv({ user: OPERADOR, tenantId: 'emp1', sessaoId: 'hoje' });
  const cx = fake.ler('caixas_pdv/hoje');
  assert.equal(cx.status, 'aberto');
  assert.equal(cx.fechadoEm, null);
  assert.equal(cx.saldoFinalInformadoCentavos, null);
  assert.equal(cx.diferencaCentavos, null);
  assert.equal('fechadoPorId' in cx, false);
  assert.equal(cx.reaberturas.length, 1);
  assert.equal(cx.reaberturas[0].contadoCentavos, 14000);
  assert.equal(cx.reaberturas[0].reabertoPorId, 'op1');
  const logs = fake.listar('empresas/emp1/logs/');
  assert.equal(logs.length, 1);
  assert.equal(logs[0].acao, 'reabrir_caixa');
  for (const campo of Object.values(cx)) assert.notEqual(campo, undefined);
});

test('reabrir: fechado em outro dia ou com data de outro dia e\' recusado', async () => {
  const { fake, s } = montar();
  for (const id of ['ontem', 'comData']) {
    await assert.rejects(s.reabrirCaixaPdv({ user: OPERADOR, tenantId: 'emp1', sessaoId: id }), (e) => e.status === 409 && /mesmo dia/.test(e.message));
    assert.equal(fake.ler(`caixas_pdv/${id}`).status, 'fechado');
  }
});

test('reabrir: sem a permissao, caixa de outra pessoa ou de outra empresa e\' recusado', async () => {
  const { s } = montar({ 'caixas_pdv/outraEmpresa': fechado({ tenantId: 'emp2' }) });
  await assert.rejects(s.reabrirCaixaPdv({ user: { ...OPERADOR, permissoes: ['vendas.pedidos'] }, tenantId: 'emp1', sessaoId: 'hoje' }), (e) => e.status === 403 && /permissão/.test(e.message));
  await assert.rejects(s.reabrirCaixaPdv({ user: OPERADOR, tenantId: 'emp1', sessaoId: 'doOutro' }), (e) => e.status === 403);
  await assert.rejects(s.reabrirCaixaPdv({ user: OPERADOR, tenantId: 'emp1', sessaoId: 'outraEmpresa' }), (e) => e.status === 404);
  await assert.rejects(s.reabrirCaixaPdv({ user: OPERADOR, tenantId: 'emp1', sessaoId: '../x' }), (e) => e.status === 400);
});

test('reabrir: o dono reabre o caixa de outra pessoa', async () => {
  const { fake, s } = montar();
  await s.reabrirCaixaPdv({ user: { uid: 'dono1', tenantId: 'emp1', dono: true, permissoes: [] }, tenantId: 'emp1', sessaoId: 'doOutro' });
  assert.equal(fake.ler('caixas_pdv/doOutro').status, 'aberto');
});

test('reabrir: com outro caixa aberto da pessoa, ou ja\' aberto, e\' recusado', async () => {
  const { s } = montar({ 'caixas_pdv/aberto': { tenantId: 'emp1', status: 'aberto', operadorId: 'op1' } });
  await assert.rejects(s.reabrirCaixaPdv({ user: OPERADOR, tenantId: 'emp1', sessaoId: 'hoje' }), (e) => e.status === 409 && /aberto/.test(e.message));
  await assert.rejects(s.reabrirCaixaPdv({ user: OPERADOR, tenantId: 'emp1', sessaoId: 'aberto' }), (e) => e.status === 409);
});
