const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

/*
 * Liberacao de desconto pelo celular (21/10/2026): o vendedor pede, o gerente
 * ve a lista no app e responde confirmando a senha/PIN; aprovado, nasce o
 * comprovante para a estacao; vence em 10 minutos; so' um responde.
 */

const carregar = (db) => {
  const [, , , remota] = carregarComBancoFalso(db, 'services/liberacaoRemota');
  return remota;
};

const VENDEDOR = { uid: 'ana', tenantId: 'loja', email: 'ana@loja', permissoes: ['vendas.pedidos'] };
const GERENTE = { uid: 'marcos', tenantId: 'loja', email: 'marcos@loja', permissoes: ['vendas.liberar_desconto'] };
const OUTRO = { uid: 'bia', tenantId: 'loja', email: 'bia@loja', permissoes: [] };

const agoraS = () => Math.floor(Date.now() / 1000);
// O dominio exige token com mais de 20 letras (sanidade); o falso ignora o que vem depois da hora.
const tokenDe = (uid, idadeS = 0) => `falso:${uid}:${agoraS() - idadeS}:sessao-de-teste`;

const base = () => ({
  'usuarios/ana': { tenantId: 'loja', nome: 'ANA', status: 'Ativo', permissoes: ['vendas.pedidos'] },
  'usuarios/marcos': { tenantId: 'loja', nome: 'MARCOS', status: 'Ativo', permissoes: ['vendas.liberar_desconto'] },
  'usuarios/bia': { tenantId: 'loja', nome: 'BIA', status: 'Ativo', permissoes: [] },
  'usuarios/fora': { tenantId: 'outra', nome: 'FORA', permissoes: ['vendas.liberar_desconto'] },
});

const PEDIDO = { tela: 'pedido', baseCentavos: 24000, descontoCentavos: 3000, motivo: 'Desconto de 12,5% neste pedido', documento: 'Pedido #0231 — JOÃO' };

test('pedir: grava o pedido pendente por 10 minutos; sem ninguem para liberar, recusa', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  const r = await s.pedir({ user: VENDEDOR, tenantId: 'loja', corpo: PEDIDO });
  assert.equal(r.aprovadores, 1);
  const d = fake.ler(`liberacoes_desconto/${r.id}`);
  assert.equal(d.status, 'pendente');
  assert.equal(d.solicitanteNome, 'ANA');
  assert.equal(d.estacaoUid, 'ana');
  assert.equal(d.estacaoNome, null);
  assert.equal(d.expiraEmMs - Date.parse(d.criadoEmIso), 10 * 60 * 1000);

  // Estacao compartilhada (22/10): "balcao" pede em nome de um vendedor da lista; itens vao junto.
  const r2 = await s.pedir({ user: VENDEDOR, tenantId: 'loja', corpo: { ...PEDIDO, vendedor: { id: 'bia', nome: 'qualquer' }, itens: [{ nome: 'RAÇÃO', quantidade: 2, totalCentavos: 24000 }] } });
  const d2 = fake.ler(`liberacoes_desconto/${r2.id}`);
  assert.equal(d2.solicitanteNome, 'BIA', 'o nome vem do cadastro, nao do que a tela mandou');
  assert.equal(d2.solicitanteId, 'bia');
  assert.equal(d2.estacaoNome, 'ANA');
  assert.equal(d2.estacaoUid, 'ana');
  assert.deepEqual(d2.itens, [{ nome: 'RAÇÃO', quantidade: 2, totalCentavos: 24000 }]);
  assert.equal(d2.vendedor, undefined, 'o campo cru nao e gravado');
  const lista = await s.pendentes({ user: { uid: 'marcos', tenantId: 'loja', email: 'm@loja', permissoes: ['vendas.liberar_desconto'] }, tenantId: 'loja' });
  const naLista = lista.find((l) => l.id === r2.id);
  assert.equal(naLista.estacaoNome, 'ANA');
  assert.equal(naLista.itens.length, 1);
  assert.match(naLista.texto, /^BIA pede/);
  await assert.rejects(() => s.pedir({ user: VENDEDOR, tenantId: 'loja', corpo: { ...PEDIDO, vendedor: { id: 'fora', nome: 'FORA' } } }), (e) => e.status === 400 && /não é desta empresa/.test(e.message));

  const semGerente = criarBancoFalso({ 'usuarios/ana': base()['usuarios/ana'] }, { consultas: true });
  await assert.rejects(() => carregar(semGerente.db).pedir({ user: VENDEDOR, tenantId: 'loja', corpo: PEDIDO }), (e) => e.status === 409 && /Ninguém/.test(e.message));
  await assert.rejects(() => s.pedir({ user: VENDEDOR, tenantId: 'loja', corpo: { ...PEDIDO, descontoCentavos: 99999 } }), (e) => e.status === 400);
});

test('pendentes: so quem pode liberar ve; a estacao consulta o proprio pedido', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  const { id } = await s.pedir({ user: VENDEDOR, tenantId: 'loja', corpo: PEDIDO });
  const lista = await s.pendentes({ user: GERENTE, tenantId: 'loja' });
  assert.equal(lista.length, 1);
  assert.equal(lista[0].texto, 'ANA pede 12,5% de desconto (R$ 30,00 em R$ 240,00) — Pedido de Venda, Pedido #0231 — JOÃO');
  assert.equal('comprovanteId' in lista[0], false);
  await assert.rejects(() => s.pendentes({ user: OUTRO, tenantId: 'loja' }), (e) => e.status === 403);
  await assert.rejects(() => s.consultar({ user: OUTRO, tenantId: 'loja', id }), (e) => e.status === 403);
  assert.equal((await s.consultar({ user: VENDEDOR, tenantId: 'loja', id })).status, 'pendente');
});

test('aprovar com a senha agora: comprovante para a estacao; segundo gerente nao responde de novo', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  const { id } = await s.pedir({ user: VENDEDOR, tenantId: 'loja', corpo: PEDIDO });
  // Senha de outra pessoa / senha velha nao valem.
  await assert.rejects(() => s.responder({ user: GERENTE, tenantId: 'loja', id, corpo: { decisao: 'aprovar', credencial: { tipo: 'login', idToken: tokenDe('bia') } } }), (e) => e.status === 403);
  await assert.rejects(() => s.responder({ user: GERENTE, tenantId: 'loja', id, corpo: { decisao: 'aprovar', credencial: { tipo: 'login', idToken: tokenDe('marcos', 600) } } }), (e) => e.status === 401 && /agora/.test(e.message));
  await assert.rejects(() => s.responder({ user: OUTRO, tenantId: 'loja', id, corpo: { decisao: 'aprovar', credencial: { tipo: 'login', idToken: tokenDe('bia') } } }), (e) => e.status === 403);

  const r = await s.responder({ user: GERENTE, tenantId: 'loja', id, corpo: { decisao: 'aprovar', credencial: { tipo: 'login', idToken: tokenDe('marcos') } } });
  assert.equal(r.decisao, 'aprovar');
  const d = fake.ler(`liberacoes_desconto/${id}`);
  assert.equal(d.status, 'aprovada');
  assert.equal(d.aprovadorNome, 'MARCOS');
  const comprovante = fake.ler(`comprovantes_servidor/${d.comprovanteId}`);
  assert.equal(comprovante.emitidoPara, 'ana');
  assert.equal(comprovante.tipo, 'liberacao_desconto');
  assert.equal(comprovante.pessoaId, 'marcos');
  assert.equal(comprovante.descontoCentavos, 3000);
  // A estacao enxerga o comprovante; o app nao.
  const visto = await s.consultar({ user: VENDEDOR, tenantId: 'loja', id });
  assert.equal(visto.status, 'aprovada');
  assert.equal(visto.comprovanteId, d.comprovanteId);
  await assert.rejects(() => s.responder({ user: GERENTE, tenantId: 'loja', id, corpo: { decisao: 'recusar', credencial: { tipo: 'login', idToken: tokenDe('marcos') } } }), (e) => e.status === 409 && /já foi aprovado por MARCOS/.test(e.message));
});

test('recusar com motivo, cancelar pela estacao e pedido vencido', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  const { id } = await s.pedir({ user: VENDEDOR, tenantId: 'loja', corpo: PEDIDO });
  await s.responder({ user: GERENTE, tenantId: 'loja', id, corpo: { decisao: 'recusar', motivoRecusa: 'Margem baixa', credencial: { tipo: 'login', idToken: tokenDe('marcos') } } });
  assert.equal(fake.ler(`liberacoes_desconto/${id}`).status, 'recusada');
  assert.equal(fake.ler(`liberacoes_desconto/${id}`).motivoRecusa, 'Margem baixa');
  assert.equal(fake.listar('comprovantes_servidor/').length, 0, 'recusa nao emite comprovante');

  const { id: id2 } = await s.pedir({ user: VENDEDOR, tenantId: 'loja', corpo: PEDIDO });
  await assert.rejects(() => s.cancelar({ user: GERENTE, tenantId: 'loja', id: id2 }), (e) => e.status === 403);
  assert.equal((await s.cancelar({ user: VENDEDOR, tenantId: 'loja', id: id2 })).status, 'cancelada');
  await assert.rejects(() => s.responder({ user: GERENTE, tenantId: 'loja', id: id2, corpo: { decisao: 'aprovar', credencial: { tipo: 'login', idToken: tokenDe('marcos') } } }), (e) => e.status === 409 && /cancelou/.test(e.message));

  const { id: id3 } = await s.pedir({ user: VENDEDOR, tenantId: 'loja', corpo: PEDIDO });
  fake.db.collection('liberacoes_desconto').doc(id3).set({ expiraEmMs: Date.now() - 1 }, { merge: true });
  assert.equal((await s.pendentes({ user: GERENTE, tenantId: 'loja' })).length, 0);
  assert.equal((await s.consultar({ user: VENDEDOR, tenantId: 'loja', id: id3 })).status, 'vencida');
  await assert.rejects(() => s.responder({ user: GERENTE, tenantId: 'loja', id: id3, corpo: { decisao: 'aprovar', credencial: { tipo: 'login', idToken: tokenDe('marcos') } } }), (e) => e.status === 409 && /venceu/.test(e.message));
});

test('orcamento: aprova sem comprovante (nao fecha pelo servidor)', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  const { id } = await s.pedir({ user: VENDEDOR, tenantId: 'loja', corpo: { ...PEDIDO, tela: 'orcamento', documento: 'Orçamento #7' } });
  await s.responder({ user: GERENTE, tenantId: 'loja', id, corpo: { decisao: 'aprovar', credencial: { tipo: 'login', idToken: tokenDe('marcos') } } });
  assert.equal(fake.ler(`liberacoes_desconto/${id}`).status, 'aprovada');
  assert.equal(fake.listar('comprovantes_servidor/').length, 0);
});
