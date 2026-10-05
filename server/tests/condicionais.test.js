const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

const HOJE = '2026-10-05';
const USER = { uid: 'u1', email: 'loja@teste', tenantId: 'emp1', permissoes: ['vendas.condicional'] };
const carregar = (db) => carregarComBancoFalso(db)[2];

const produto = (extra = {}) => ({
  tenantId: 'emp1', nome: 'VESTIDO AZUL M', codigo: '1001', precoVenda: 120, ativo: true,
  permiteCondicional: true, quantidade: 5, quantidadeReservada: 0,
  unidadeMedidaSigla: 'UN', unidadeMedidaFracionado: false, unidadeMedidaCasasDecimais: 0, ...extra,
});

const base = (extra = {}) => ({
  'configuracoes/emp1': { trabalhaComCondicional: true },
  'clientes/c1': { tenantId: 'emp1', nome: 'MARIA SILVA', telefone: '27999990000' },
  'estoque/p1': produto(),
  'estoque/p2': produto({ nome: 'BLUSA BRANCA P', codigo: '1002', precoVenda: 80, quantidade: 2 }),
  ...extra,
});

const pedidoCriar = (extra = {}) => ({
  clienteId: 'c1', prazoDevolucao: '2026-10-08', itens: [{ id: 'p1', quantidade: 2 }, { id: 'p2', quantidade: 1 }], ...extra,
});

test('criar: reserva o estoque, numera e grava os dados do cadastro', async () => {
  const fake = criarBancoFalso(base());
  const s = carregar(fake.db);
  const r = await s.criarCondicional({ user: USER, tenantId: 'emp1', corpo: pedidoCriar(), hoje: HOJE });
  assert.equal(r.numeroCondicional, '0001');
  assert.equal(fake.ler('estoque/p1').quantidadeReservada, 2);
  assert.equal(fake.ler('estoque/p1').quantidade, 5, 'saida nao baixa a quantidade, so\' reserva');
  assert.equal(fake.ler('estoque/p2').quantidadeReservada, 1);
  const c = fake.ler(`condicionais/${r.id}`);
  assert.equal(c.status, 'aberto');
  assert.equal(c.clienteNome, 'MARIA SILVA');
  assert.equal(c.valorLevado, 320);
  assert.equal(c.itens[0].precoUnitario, 120);
  assert.equal(fake.ler('contadores/emp1/sequencias/condicionais').valor, 1);
});

test('criar: bloqueia com a empresa sem "Trabalha com condicional" e produto sem "Permite condicional"', async () => {
  const desligado = criarBancoFalso(base({ 'configuracoes/emp1': {} }));
  await assert.rejects(
    () => carregar(desligado.db).criarCondicional({ user: USER, tenantId: 'emp1', corpo: pedidoCriar(), hoje: HOJE }),
    /Trabalha com condicional/,
  );
  const semLiberar = criarBancoFalso(base({ 'estoque/p2': produto({ nome: 'BLUSA BRANCA P', permiteCondicional: false }) }));
  await assert.rejects(
    () => carregar(semLiberar.db).criarCondicional({ user: USER, tenantId: 'emp1', corpo: pedidoCriar(), hoje: HOJE }),
    /BLUSA BRANCA P.*Permite condicional/,
  );
  assert.equal(semLiberar.ler('estoque/p1').quantidadeReservada, 0, 'nada reservado se algum item for recusado');
});

test('criar: falta de estoque, cliente de outra empresa e prazo no passado sao recusados', async () => {
  const fake = criarBancoFalso(base({ 'clientes/c2': { tenantId: 'emp2', nome: 'OUTRA' } }));
  const s = carregar(fake.db);
  await assert.rejects(() => s.criarCondicional({ user: USER, tenantId: 'emp1', corpo: pedidoCriar({ itens: [{ id: 'p2', quantidade: 3 }] }), hoje: HOJE }), /Estoque insuficiente/);
  await assert.rejects(() => s.criarCondicional({ user: USER, tenantId: 'emp1', corpo: pedidoCriar({ clienteId: 'c2' }), hoje: HOJE }), /cliente não foi encontrado/);
  await assert.rejects(() => s.criarCondicional({ user: USER, tenantId: 'emp1', corpo: pedidoCriar({ prazoDevolucao: '2026-10-01' }), hoje: HOJE }), /passado/);
});

test('criar: reenviar o mesmo rascunho nao duplica nem reserva de novo', async () => {
  const fake = criarBancoFalso(base());
  const s = carregar(fake.db);
  const corpo = pedidoCriar({ idDocumento: 'rascunho1' });
  const a = await s.criarCondicional({ user: USER, tenantId: 'emp1', corpo, hoje: HOJE });
  const b = await s.criarCondicional({ user: USER, tenantId: 'emp1', corpo, hoje: HOJE });
  assert.equal(b.jaEnviado, true);
  assert.equal(a.numeroCondicional, b.numeroCondicional);
  assert.equal(fake.ler('estoque/p1').quantidadeReservada, 2);
});

test('devolucao parcial libera so\' o que voltou; devolver tudo fecha como "devolvido"', async () => {
  const fake = criarBancoFalso(base());
  const s = carregar(fake.db);
  const { id } = await s.criarCondicional({ user: USER, tenantId: 'emp1', corpo: pedidoCriar(), hoje: HOJE });

  const parcial = await s.devolverItens({ user: USER, tenantId: 'emp1', id, corpo: { itens: [{ id: 'p1', quantidade: 1 }] } });
  assert.equal(parcial.tudoDevolvido, false);
  assert.equal(fake.ler('estoque/p1').quantidadeReservada, 1);
  assert.equal(fake.ler(`condicionais/${id}`).itens[0].quantidadeDevolvida, 1);

  await assert.rejects(() => s.devolverItens({ user: USER, tenantId: 'emp1', id, corpo: { itens: [{ id: 'p1', quantidade: 5 }] } }), /só 1 está com o cliente/);

  const resto = await s.devolverItens({ user: USER, tenantId: 'emp1', id, corpo: { itens: [{ id: 'p1', quantidade: 1 }, { id: 'p2', quantidade: 1 }] } });
  assert.equal(resto.tudoDevolvido, true);
  assert.equal(fake.ler(`condicionais/${id}`).status, 'devolvido');
  assert.equal(fake.ler('estoque/p1').quantidadeReservada, 0);
  assert.equal(fake.ler('estoque/p2').quantidadeReservada, 0);
  await assert.rejects(() => s.devolverItens({ user: USER, tenantId: 'emp1', id, corpo: { itens: [{ id: 'p1', quantidade: 1 }] } }), (e) => e.status === 409);
});

test('fechar: devolucao final + o que ficou vira pre-venda com a reserva transferida (sem baixar duas vezes)', async () => {
  const fake = criarBancoFalso(base({ 'configuracoes/emp1': { trabalhaComCondicional: true, conferenciaMercadoria: true } }));
  const s = carregar(fake.db);
  const { id } = await s.criarCondicional({ user: USER, tenantId: 'emp1', corpo: pedidoCriar(), hoje: HOJE });

  const r = await s.fecharCondicional({ user: USER, tenantId: 'emp1', id, corpo: { itens: [{ id: 'p2', quantidade: 1 }] }, hoje: HOJE });
  assert.equal(r.numeroPedido, '0001');
  assert.equal(r.pecasVendidas, 2);

  // O vestido (2) continua reservado -- agora pela pre-venda; a blusa voltou.
  assert.equal(fake.ler('estoque/p1').quantidadeReservada, 2);
  assert.equal(fake.ler('estoque/p1').quantidade, 5);
  assert.equal(fake.ler('estoque/p2').quantidadeReservada, 0);

  const pedido = fake.ler(`pedidos_venda/${r.pedidoId}`);
  assert.equal(pedido.status, 'Pré-venda');
  assert.equal(pedido.estoqueReservado, true);
  assert.equal(pedido.statusConferencia, 'aguardando');
  assert.equal(pedido.condicionalId, id);
  assert.equal(pedido.valorTotal, 240);
  assert.deepEqual(pedido.itens.map((i) => [i.id, i.quantidade]), [['p1', 2]]);
  assert.ok(Object.values(pedido).every((v) => v !== undefined), 'nada de undefined no pedido');

  const c = fake.ler(`condicionais/${id}`);
  assert.equal(c.status, 'finalizado');
  assert.equal(c.numeroPedido, '0001');
  assert.deepEqual(c.historico.map((h) => h.tipo), ['saida', 'devolucao', 'fechamento']);
});

test('fechar sem nada com o cliente nao cria pre-venda; cancelar libera a reserva', async () => {
  const fake = criarBancoFalso(base());
  const s = carregar(fake.db);
  const a = await s.criarCondicional({ user: USER, tenantId: 'emp1', corpo: pedidoCriar({ itens: [{ id: 'p1', quantidade: 1 }] }), hoje: HOJE });
  const r = await s.fecharCondicional({ user: USER, tenantId: 'emp1', id: a.id, corpo: { itens: [{ id: 'p1', quantidade: 1 }] }, hoje: HOJE });
  assert.equal(r.pedidoId, null);
  assert.equal(fake.ler(`condicionais/${a.id}`).status, 'devolvido');
  assert.equal(fake.listar('pedidos_venda/').length, 0);

  const b = await s.criarCondicional({ user: USER, tenantId: 'emp1', corpo: pedidoCriar(), hoje: HOJE });
  await assert.rejects(() => s.cancelarCondicional({ user: USER, tenantId: 'emp1', id: b.id, corpo: { motivo: 'x' } }), /motivo/);
  await s.cancelarCondicional({ user: USER, tenantId: 'emp1', id: b.id, corpo: { motivo: 'cliente desistiu' } });
  assert.equal(fake.ler(`condicionais/${b.id}`).status, 'cancelado');
  assert.equal(fake.ler('estoque/p1').quantidadeReservada, 0);
  assert.equal(fake.ler('estoque/p2').quantidadeReservada, 0);
});

test('condicional de outra empresa nao e\' encontrado', async () => {
  const fake = criarBancoFalso(base());
  const s = carregar(fake.db);
  const { id } = await s.criarCondicional({ user: USER, tenantId: 'emp1', corpo: pedidoCriar(), hoje: HOJE });
  await assert.rejects(() => s.cancelarCondicional({ user: USER, tenantId: 'emp2', id, corpo: { motivo: 'tentativa de fora' } }), (e) => e.status === 404);
  assert.equal(fake.ler(`condicionais/${id}`).status, 'aberto');
});
