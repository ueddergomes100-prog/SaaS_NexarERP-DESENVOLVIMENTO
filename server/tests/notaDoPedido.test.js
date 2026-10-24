const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

/*
 * Nota fiscal do pedido (23/10/2026): uma nota por pedido, "Sem nota" nunca emite,
 * trava de duas telas emitindo juntas, e a troca "Com nota / Sem nota".
 */

const carregar = (db) => carregarComBancoFalso(db, 'services/notaDoPedido')[3];

const pedido = (extra = {}) => ({ tenantId: 'loja', numeroPedido: '0107', status: 'Finalizada', vendedorNome: 'ANA', ...extra });

test('emissao: pedido livre trava; segunda tela com outro id e recusada; mesma nota passa', async () => {
  const fake = criarBancoFalso({ 'pedidos_venda/p1': pedido({ comNotaFiscal: true }) }, { consultas: true });
  const s = carregar(fake.db);
  await s.travarEmissao({ tenantId: 'loja', pedidoId: 'p1', tipo: 'NF-e', integrationId: 'a', uid: 'u1' });
  assert.equal(fake.ler('pedidos_venda/p1').notaEmissaoEmAndamento.integrationId, 'a');
  await assert.rejects(
    () => s.travarEmissao({ tenantId: 'loja', pedidoId: 'p1', tipo: 'NF-e', integrationId: 'b', uid: 'u2' }),
    (e) => e.status === 409 && /sendo emitida agora/.test(e.message),
  );
  await s.travarEmissao({ tenantId: 'loja', pedidoId: 'p1', tipo: 'NF-e', integrationId: 'a', uid: 'u1' });
});

test('emissao: nota valendo, pedido sem nota e outra empresa sao recusados', async () => {
  const fake = criarBancoFalso({
    'pedidos_venda/p1': pedido(),
    'pedidos_venda/p2': pedido({ numeroPedido: '0108', comNotaFiscal: false }),
    'notas_fiscais/n1': { tenantId: 'loja', pedidoId: 'p1', tipo: 'NF-e', status: 'authorized', number: 512, integrationId: 'velho' },
  }, { consultas: true });
  const s = carregar(fake.db);
  await assert.rejects(
    () => s.travarEmissao({ tenantId: 'loja', pedidoId: 'p1', tipo: 'NF-e', integrationId: 'novo' }),
    (e) => e.status === 409 && /NF-e nº 512 autorizada/.test(e.message),
  );
  await assert.rejects(
    () => s.travarEmissao({ tenantId: 'loja', pedidoId: 'p2', tipo: 'NFC-e', integrationId: 'x' }),
    (e) => e.status === 409 && /SEM nota fiscal/.test(e.message),
  );
  await assert.rejects(
    () => s.travarEmissao({ tenantId: 'outra', pedidoId: 'p1', tipo: 'NF-e', integrationId: 'x' }),
    (e) => e.status === 404,
  );
  assert.equal(fake.ler('pedidos_venda/p2').notaEmissaoEmAndamento, undefined, 'recusado nao trava');
});

test('trocar com/sem nota: permissao, registro e pedido com nota nao vira sem nota', async () => {
  const fake = criarBancoFalso({
    'pedidos_venda/p1': pedido({ comNotaFiscal: true }),
    'pedidos_venda/p2': pedido({ numeroPedido: '0108' }),
    'pedidos_venda/p3': pedido({ numeroPedido: '0109', comNotaFiscal: true }),
    'notas_fiscais/n1': { tenantId: 'loja', pedidoId: 'p3', tipo: 'NFC-e', status: 'authorized', number: 4 },
  }, { consultas: true });
  const s = carregar(fake.db);
  const gerente = { uid: 'g', permissoes: ['vendas.alterar'] };
  const fiscal = { uid: 'f', permissoes: ['fiscal.emitir'] };

  const r = await s.definirComNotaFiscal({ user: gerente, tenantId: 'loja', pedidoId: 'p1', comNotaFiscal: false });
  assert.equal(r.mudou, true);
  assert.equal(r.antes, 'com');
  assert.equal(fake.ler('pedidos_venda/p1').comNotaFiscal, false);
  assert.equal(fake.ler('pedidos_venda/p1').comNotaFiscalAlteradoPor, 'g');

  // quem so' emite nota tira da lista o pedido antigo (sem marcacao), e so' ele
  await s.definirComNotaFiscal({ user: fiscal, tenantId: 'loja', pedidoId: 'p2', comNotaFiscal: false });
  assert.equal(fake.ler('pedidos_venda/p2').comNotaFiscal, false);
  await assert.rejects(
    () => s.definirComNotaFiscal({ user: fiscal, tenantId: 'loja', pedidoId: 'p2', comNotaFiscal: true }),
    (e) => e.status === 403,
  );

  await assert.rejects(
    () => s.definirComNotaFiscal({ user: gerente, tenantId: 'loja', pedidoId: 'p3', comNotaFiscal: false }),
    (e) => e.status === 409 && /cupom fiscal \(NFC-e\) nº 4/.test(e.message),
  );
  const igual = await s.definirComNotaFiscal({ user: gerente, tenantId: 'loja', pedidoId: 'p3', comNotaFiscal: true });
  assert.equal(igual.mudou, false);
});
