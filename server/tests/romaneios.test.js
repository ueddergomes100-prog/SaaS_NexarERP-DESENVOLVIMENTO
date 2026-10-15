const test = require('node:test');
const assert = require('node:assert/strict');

/*
 * Romaneio ja' fechado: reabrir, fechar de novo com o Financeiro
 * acompanhando, e cancelar desfazendo tudo (15/10/2026). Firestore falso em
 * memoria.
 */
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

const carregar = (db) => carregarComBancoFalso(db, 'services/romaneios')[3];

const GESTOR = { uid: 'gestor', tenantId: 'emp', isTenantManager: true, permissoes: [] };
const LOGISTICA = { uid: 'log', tenantId: 'emp', permissoes: ['operacoes.romaneios'] };
const LOGISTICA_FIN = { uid: 'logfin', tenantId: 'emp', permissoes: ['operacoes.romaneios', 'financeiro.pagar'] };
const REABRE = { uid: 'sup', tenantId: 'emp', permissoes: ['operacoes.romaneios', 'operacoes.romaneios_reabrir'] };
const AGORA = '2026-10-15T15:00:00.000Z';

const entrega = (n, status, extra = {}) => ({
  pedidoId: `p${n}`, numeroPedido: String(n), clienteNome: `CLIENTE ${n}`, valorTotalCentavos: 10000, status,
  ...(status === 'entregue' ? { recebedorNome: 'FULANO' } : {}),
  ...(status === 'nao_entregue' ? { motivo: 'Fechado' } : {}),
  ...extra,
});

const banco = () => criarBancoFalso({
  'romaneios/R1': {
    tenantId: 'emp', numero: 4, nome: 'DANIELA', status: 'em_rota', dataSaida: '2026-10-14',
    motoristaId: 'm1', motoristaNome: 'DIRCEU', veiculoId: 'v1', veiculoDescricao: 'VW DELIVERY', veiculoPlaca: 'SPT1A23',
    kmSaida: 1000, kmChegada: null, entregas: [entrega(1, 'entregue'), entrega(2, 'nao_entregue')], acerto: [],
  },
  'romaneio_pedidos/p1': { tenantId: 'emp', romaneioId: 'R1', situacao: 'em_romaneio' },
  'romaneio_pedidos/p2': { tenantId: 'emp', romaneioId: 'R1', situacao: 'em_romaneio' },
});

const corpoDoFechamento = (acerto, extra = {}) => ({
  lancarDespesas: true,
  romaneio: { kmChegada: 1200, horarioChegada: '18:00', observacaoAcerto: '', acerto, ...extra },
});

const ACERTO = [
  { tipo: 'Combustível', natureza: 'despesa', descricao: '', valorCentavos: 20000 },
  { tipo: 'Diária', natureza: 'despesa', descricao: '', valorCentavos: 8000 },
  { tipo: 'Vale', natureza: 'adiantamento', descricao: '', valorCentavos: 30000 },
];

const transacoes = (fake) => fake.listar('transacoes/');

test('fechar: despesas viram lançamentos pagos, entregue fica preso, não entregue fica livre', async () => {
  const fake = banco();
  const s = carregar(fake.db);
  const r = await s.fecharRomaneio({ user: LOGISTICA_FIN, id: 'R1', corpo: corpoDoFechamento(ACERTO), usuarioNome: 'ANA', agoraIso: AGORA });
  assert.deepEqual(r.contagem, { novas: 2, alteradas: 0, canceladas: 0 });
  assert.equal(r.refechamento, false);

  const romaneio = fake.ler('romaneios/R1');
  assert.equal(romaneio.status, 'fechado');
  assert.equal(romaneio.kmChegada, 1200);
  assert.deepEqual(romaneio.historico.map((e) => [e.acao, e.usuarioNome]), [['fechado', 'ANA']]);
  assert.equal(fake.ler('romaneio_pedidos/p1').situacao, 'entregue');
  assert.equal(fake.ler('romaneio_pedidos/p2').situacao, 'liberado');

  const lancadas = transacoes(fake);
  assert.equal(lancadas.length, 2);
  assert.ok(lancadas.every((t) => t.status === 'Paga' && t.tipo === 'saida' && t.categoria === 'DESPESAS DE ROTA' && t.romaneioId === 'R1' && t.veiculoId === 'v1'));
  const rota = fake.ler(`rotas/${romaneio.despesasRotaId}`);
  assert.equal(rota.totalCentavos, 28000);
  assert.equal(rota.transacaoIds.length, 2);
  assert.ok(lancadas.every((t) => t.rotaId === romaneio.despesasRotaId));
  assert.ok(!JSON.stringify(romaneio).includes('undefined'));
});

test('fechar lançando despesa pede permissão do Financeiro; sem lançar, não pede', async () => {
  const fake = banco();
  const s = carregar(fake.db);
  await assert.rejects(
    s.fecharRomaneio({ user: LOGISTICA, id: 'R1', corpo: corpoDoFechamento(ACERTO), usuarioNome: 'LUIZ', agoraIso: AGORA }),
    (erro) => erro.status === 403 && /permissão do Financeiro/.test(erro.message),
  );
  assert.equal(fake.ler('romaneios/R1').status, 'em_rota');
  await s.fecharRomaneio({ user: LOGISTICA, id: 'R1', corpo: { ...corpoDoFechamento(ACERTO), lancarDespesas: false }, usuarioNome: 'LUIZ', agoraIso: AGORA });
  assert.equal(fake.ler('romaneios/R1').status, 'fechado');
  assert.equal(transacoes(fake).length, 0);
});

test('reabrir: permissão própria e motivo; pedido que já está em outra rota fica de fora', async () => {
  const fake = banco();
  const s = carregar(fake.db);
  await s.fecharRomaneio({ user: GESTOR, id: 'R1', corpo: corpoDoFechamento(ACERTO), usuarioNome: 'DONO', agoraIso: AGORA });
  // O pedido 2 (nao entregue) foi para a Rota 05 depois do fechamento.
  await fake.db.collection('romaneio_pedidos').doc('p2').set({ romaneioId: 'R5', romaneioTitulo: 'Rota 05 CENTRO', situacao: 'em_romaneio' }, { merge: true });

  await assert.rejects(
    s.reabrirRomaneio({ user: LOGISTICA, id: 'R1', motivo: 'Esqueci as despesas do motorista', usuarioNome: 'LUIZ', agoraIso: AGORA }),
    (erro) => erro.status === 403 && /reabrir e cancelar depois de fechado/.test(erro.message),
  );
  await assert.rejects(
    s.reabrirRomaneio({ user: REABRE, id: 'R1', motivo: 'esqueci', usuarioNome: 'SUP', agoraIso: AGORA }),
    (erro) => erro.status === 400 && /pelo menos 10/.test(erro.message),
  );

  const r = await s.reabrirRomaneio({ user: REABRE, id: 'R1', motivo: 'Esqueci as despesas do motorista', usuarioNome: 'SUP', agoraIso: AGORA });
  assert.deepEqual(r.saem, [{ pedidoId: 'p2', numeroPedido: '2', outraRota: 'Rota 05 CENTRO' }]);
  const romaneio = fake.ler('romaneios/R1');
  assert.equal(romaneio.status, 'em_rota');
  assert.deepEqual(romaneio.entregas.map((e) => e.pedidoId), ['p1']);
  assert.equal(romaneio.motivoReabertura, 'Esqueci as despesas do motorista');
  assert.equal(romaneio.fechamentoAnterior.kmChegada, 1200);
  assert.deepEqual(romaneio.historico.map((e) => e.acao), ['fechado', 'reaberto']);
  assert.equal(fake.ler('romaneio_pedidos/p1').situacao, 'em_romaneio');
  // A trava da outra rota nao e' mexida.
  assert.equal(fake.ler('romaneio_pedidos/p2').romaneioId, 'R5');
  // As despesas ficam como estao ate' fechar de novo.
  assert.ok(transacoes(fake).every((t) => t.status === 'Paga'));

  await assert.rejects(
    s.reabrirRomaneio({ user: REABRE, id: 'R1', motivo: 'Esqueci as despesas do motorista', usuarioNome: 'SUP', agoraIso: AGORA }),
    (erro) => erro.status === 409,
  );
});

test('fechar de novo: o financeiro acompanha (corrige, lança, cancela) e o log diz o que mudou', async () => {
  const fake = banco();
  const s = carregar(fake.db);
  await s.fecharRomaneio({ user: GESTOR, id: 'R1', corpo: corpoDoFechamento(ACERTO), usuarioNome: 'DONO', agoraIso: AGORA });
  const rotaId = fake.ler('romaneios/R1').despesasRotaId;
  await s.reabrirRomaneio({ user: GESTOR, id: 'R1', motivo: 'Esqueci o hotel do motorista', usuarioNome: 'DONO', agoraIso: AGORA });

  const novoAcerto = [
    { tipo: 'Combustível', natureza: 'despesa', descricao: '', valorCentavos: 25000 },
    { tipo: 'Hotel', natureza: 'despesa', descricao: 'pousada', valorCentavos: 12000 },
    { tipo: 'Vale', natureza: 'adiantamento', descricao: '', valorCentavos: 30000 },
  ];
  // Caixa desmarcada: lancamento que ja' existe acompanha mesmo assim.
  const r = await s.fecharRomaneio({ user: REABRE, id: 'R1', corpo: { ...corpoDoFechamento(novoAcerto), lancarDespesas: false }, usuarioNome: 'SUP', agoraIso: AGORA });
  assert.deepEqual(r.contagem, { novas: 1, alteradas: 1, canceladas: 1 });
  assert.equal(r.refechamento, true);
  assert.deepEqual(r.alteracoes.map((a) => a.campo), ['Acerto: Combustível', 'Acerto: Diária', 'Acerto: Hotel']);

  const romaneio = fake.ler('romaneios/R1');
  assert.equal(romaneio.status, 'fechado');
  assert.equal(romaneio.fechamentoAnterior, undefined);
  assert.equal(romaneio.despesasRotaId, rotaId);
  assert.deepEqual(romaneio.historico.map((e) => e.acao), ['fechado', 'reaberto', 'fechado']);

  const porTipo = Object.fromEntries(transacoes(fake).map((t) => [`${t.tipoDespesaRota}:${t.status}`, t.valorCentavos]));
  assert.deepEqual(porTipo, { 'Combustível:Paga': 25000, 'Diária:Cancelada': 8000, 'Hotel:Paga': 12000 });
  const rota = fake.ler(`rotas/${rotaId}`);
  assert.equal(rota.totalCentavos, 37000);
  assert.deepEqual(rota.despesas.map((d) => d.tipo), ['Combustível', 'Hotel']);
  assert.equal(rota.transacaoIds.length, 2);
});

test('cancelar rota fechada: desfaz tudo (pedidos livres, despesas canceladas); sem permissão, não', async () => {
  const fake = banco();
  const s = carregar(fake.db);
  await s.fecharRomaneio({ user: GESTOR, id: 'R1', corpo: corpoDoFechamento(ACERTO), usuarioNome: 'DONO', agoraIso: AGORA });
  await fake.db.collection('romaneio_pedidos').doc('p2').set({ romaneioId: 'R5', situacao: 'em_romaneio' }, { merge: true });

  await assert.rejects(
    s.cancelarRomaneio({ user: LOGISTICA, id: 'R1', motivo: 'Rota lançada em duplicidade', usuarioNome: 'LUIZ', agoraIso: AGORA }),
    (erro) => erro.status === 403 && /já foi fechado/.test(erro.message),
  );
  await assert.rejects(
    s.cancelarRomaneio({ user: REABRE, id: 'R1', motivo: '', usuarioNome: 'SUP', agoraIso: AGORA }),
    (erro) => erro.status === 400,
  );

  const r = await s.cancelarRomaneio({ user: REABRE, id: 'R1', motivo: 'Rota lançada em duplicidade', usuarioNome: 'SUP', agoraIso: AGORA });
  assert.deepEqual({ desfez: r.desfez, liberados: r.liberados, despesasCanceladas: r.despesasCanceladas }, { desfez: true, liberados: 1, despesasCanceladas: 2 });
  const romaneio = fake.ler('romaneios/R1');
  assert.equal(romaneio.status, 'cancelado');
  assert.equal(romaneio.motivoCancelamento, 'Rota lançada em duplicidade');
  assert.equal(fake.ler('romaneio_pedidos/p1').situacao, 'liberado');
  assert.equal(fake.ler('romaneio_pedidos/p2').situacao, 'em_romaneio');
  assert.ok(transacoes(fake).every((t) => t.status === 'Cancelada'));
  assert.equal(fake.ler(`rotas/${romaneio.despesasRotaId}`).cancelada, true);
});

test('cancelar antes de qualquer entrega continua simples: sem motivo e sem permissão própria', async () => {
  const fake = criarBancoFalso({
    'romaneios/R2': { tenantId: 'emp', numero: 5, nome: 'CENTRO', status: 'montagem', entregas: [entrega(3, 'pendente')] },
    'romaneio_pedidos/p3': { tenantId: 'emp', romaneioId: 'R2', situacao: 'em_romaneio' },
  });
  const s = carregar(fake.db);
  const r = await s.cancelarRomaneio({ user: LOGISTICA, id: 'R2', motivo: '', usuarioNome: 'LUIZ', agoraIso: AGORA });
  assert.equal(r.desfez, false);
  assert.equal(fake.ler('romaneios/R2').status, 'cancelado');
  assert.equal(fake.ler('romaneio_pedidos/p3').situacao, 'liberado');
  await assert.rejects(
    s.cancelarRomaneio({ user: LOGISTICA, id: 'R2', motivo: '', usuarioNome: 'LUIZ', agoraIso: AGORA }),
    (erro) => erro.status === 409,
  );
});

test('romaneio de outra empresa não existe para quem chama', async () => {
  const fake = banco();
  const s = carregar(fake.db);
  await assert.rejects(
    s.fecharRomaneio({ user: { ...GESTOR, tenantId: 'outra' }, id: 'R1', corpo: corpoDoFechamento([]), usuarioNome: 'X', agoraIso: AGORA }),
    (erro) => erro.status === 404,
  );
});
