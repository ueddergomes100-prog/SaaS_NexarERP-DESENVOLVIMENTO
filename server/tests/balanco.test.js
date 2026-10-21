const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

/*
 * Balanco / inventario (21/10/2026): abrir e dividir, contagem cega, contar so'
 * o proprio item, fechar pelas regras do dono e trava de vendas.
 */

const carregar = (db) => {
  const [, , , balanco, venda] = carregarComBancoFalso(db, 'services/balanco', 'services/vendaFechamento');
  return { balanco, venda };
};

const GESTOR = { uid: 'ger', tenantId: 'loja', email: 'g@loja', nome: 'GERENTE', permissoes: ['estoque.balanco_gerenciar', 'estoque.balanco_contar', 'vendas.pedidos'] };
const ANA = { uid: 'ana', tenantId: 'loja', email: 'a@loja', nome: 'ANA', permissoes: ['estoque.balanco_contar'] };
const BIA = { uid: 'bia', tenantId: 'loja', email: 'b@loja', nome: 'BIA', permissoes: ['estoque.balanco_contar'] };

const base = (extra = {}) => ({
  'configuracoes/loja': { tenantId: 'loja', venderSemEstoque: true },
  'usuarios/ana': { tenantId: 'loja', nome: 'ANA', status: 'Ativo' },
  'usuarios/bia': { tenantId: 'loja', nome: 'BIA', status: 'Ativo' },
  'usuarios/ger': { tenantId: 'loja', nome: 'GERENTE', status: 'Ativo' },
  'usuarios/fora': { tenantId: 'outra', nome: 'FORA' },
  // Exemplo do dono: sistema -10 (vendeu sem estoque), 10 reservados em pre-venda.
  'estoque/p1': { tenantId: 'loja', nome: 'RAÇÃO 15KG', categoria: 'RAÇÃO', quantidade: -10, quantidadeReservada: 10, unidadeMedidaSigla: 'SC' },
  'estoque/p2': { tenantId: 'loja', nome: 'RAÇÃO 1KG', categoria: 'RAÇÃO', quantidade: 20, unidadeMedidaSigla: 'UN' },
  'estoque/p3': { tenantId: 'loja', nome: 'VERMIFUGO', categoria: 'MEDICAMENTO', quantidade: 7, controlarLote: true, unidadeMedidaSigla: 'UN' },
  'estoque/p4': { tenantId: 'loja', nome: 'COLEIRA', categoria: 'PET', quantidade: 5 },
  'estoque/grade': { tenantId: 'loja', nome: 'CAMISETA', categoria: 'PET', temGrade: true, quantidade: 0 },
  'estoque/inativo': { tenantId: 'loja', nome: 'VELHO', categoria: 'PET', quantidade: 3, statusAtivo: false },
  'estoque_lotes/l1': { tenantId: 'loja', produtoId: 'p3', lote: 'A1', validade: '2027-01-01', quantidade: 4 },
  'estoque_lotes/l2': { tenantId: 'loja', produtoId: 'p3', lote: 'B2', validade: '2027-06-01', quantidade: 3 },
  ...extra,
});

const abrir = (s, extra = {}) => s.balanco.abrir({ user: GESTOR, tenantId: 'loja', corpo: { nome: 'Balanço outubro', escopo: { tipo: 'todos' }, contadores: ['ana', 'bia'], ...extra } });
const contar = (s, user, balancoId, corpo) => s.balanco.contar({ user, tenantId: 'loja', balancoId, corpo });
const donoDe = (fake, id, chave) => fake.ler(`balancos/${id}/itens/${chave}`).contadorUid;

test('abrir: divide entre quem conta, deixa grade e inativo de fora, guarda os lotes e marca a trava', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  const r = await abrir(s, { travaVendas: true });
  assert.equal(r.totalItens, 4);
  assert.equal(r.blocos.reduce((t, b) => t + b.itens, 0), 4);
  assert.equal(donoDe(fake, r.id, 'estoque__p1'), donoDe(fake, r.id, 'estoque__p2'), 'mesmo grupo com a mesma pessoa');
  assert.deepEqual(fake.ler(`balancos/${r.id}/itens/estoque__p3`).lotes.map((l) => l.lote), ['A1', 'B2']);
  assert.equal(fake.ler('configuracoes/loja').balancoEmAndamento.travaVendas, true);
  await assert.rejects(() => abrir(s), (e) => e.status === 409 && /Já existe um balanço aberto/.test(e.message));
  await assert.rejects(() => carregar(criarBancoFalso(base(), { consultas: true }).db).balanco.abrir({ user: GESTOR, tenantId: 'loja', corpo: { nome: 'X1', escopo: { tipo: 'todos' }, contadores: ['fora'] } }), (e) => e.status === 400);
});

test('contagem cega e so o proprio item; fechar: regra do negativo, nao contado zera, lote por lote, reserva intacta', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  const r = await abrir(s);
  const quem = { p1: donoDe(fake, r.id, 'estoque__p1'), p3: donoDe(fake, r.id, 'estoque__p3') };
  const usuario = (uid) => (uid === 'ana' ? ANA : BIA);
  const outro = (uid) => (uid === 'ana' ? BIA : ANA);

  const lista = await s.balanco.minhaLista({ user: usuario(quem.p1), tenantId: 'loja', balancoId: r.id });
  const linha = lista.itens.find((i) => i.chave === 'estoque__p1');
  assert.ok(linha);
  assert.equal('saldoNaContagem' in linha || 'quantidade' in linha, false, 'contagem cega: sem saldo do sistema');

  await assert.rejects(() => contar(s, outro(quem.p1), r.id, { chave: 'estoque__p1', quantidade: 1 }), (e) => e.status === 403 && /lista de outra pessoa/.test(e.message));
  await contar(s, usuario(quem.p1), r.id, { chave: 'estoque__p1', quantidade: 60 });
  await contar(s, usuario(quem.p1), r.id, { chave: 'estoque__p1', quantidade: 40, modo: 'somar' });
  assert.equal(fake.ler(`balancos/${r.id}/itens/estoque__p1`).contado, 100);
  assert.equal(fake.ler(`balancos/${r.id}/itens/estoque__p1`).saldoNaContagem, -10);
  await assert.rejects(() => contar(s, usuario(quem.p1), r.id, { chave: 'estoque__p2', quantidade: 1.5 }), (e) => e.status === 400 && /sem fração/.test(e.message));

  // Lote: A1 contou 2, lote novo C3 com 5; B2 ninguem contou (zera).
  await contar(s, usuario(quem.p3), r.id, { chave: 'estoque__p3', quantidade: 2, loteIndice: 0 });
  await contar(s, usuario(quem.p3), r.id, { chave: 'estoque__p3', quantidade: 5, loteNovo: { lote: 'c3', validade: '2028-01-01' } });

  const conf = await s.balanco.conferencia({ tenantId: 'loja', balancoId: r.id });
  const c1 = conf.linhas.find((l) => l.chave === 'estoque__p1');
  assert.equal(c1.depoisContado, 100);
  assert.equal(c1.depoisDescontar, 90);

  const f = await s.balanco.fechar({ user: GESTOR, tenantId: 'loja', balancoId: r.id, corpo: { regraNegativo: 'descontar' } });
  assert.equal(fake.ler('estoque/p1').quantidade, 90, 'desconta o negativo');
  assert.equal(fake.ler('estoque/p1').quantidadeReservada, 10, 'reserva intacta');
  assert.equal(fake.ler('estoque/p2').quantidade, 0, 'ninguem contou: zera');
  assert.equal(fake.ler('estoque/p4').quantidade, 0);
  assert.equal(fake.ler('estoque/p3').quantidade, 7, 'soma dos lotes contados (2 + 5)');
  assert.equal(fake.ler('estoque_lotes/l1').quantidade, 2);
  assert.equal(fake.ler('estoque_lotes/l2').quantidade, 0);
  const novo = fake.listar('estoque_lotes/').find((l) => l.lote === 'C3');
  assert.equal(novo.quantidade, 5);
  const ajustes = fake.listar('ajustes_estoque/');
  assert.ok(ajustes.every((a) => a.motivo === 'balanco' && a.balancoId === r.id));
  assert.equal(ajustes.find((a) => a.produtoId === 'p1').quantidadeDepois, 90);
  assert.equal(f.resumo.naoContados, 2);
  assert.equal(fake.ler(`balancos/${r.id}`).status, 'fechado');
  assert.equal(fake.ler('configuracoes/loja').balancoEmAndamento, undefined, 'trava retirada');
  await assert.rejects(() => contar(s, usuario(quem.p1), r.id, { chave: 'estoque__p1', quantidade: 1 }), (e) => e.status === 409);
});

test('sem trava: venda depois da contagem continua valendo; "fica o que contou"', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  const r = await abrir(s, { contadores: ['ana'] });
  await contar(s, ANA, r.id, { chave: 'estoque__p2', quantidade: 25 });
  // Vendeu 3 depois da contagem.
  await fake.db.collection('estoque').doc('p2').update({ quantidade: 17 });
  await s.balanco.fechar({ user: GESTOR, tenantId: 'loja', balancoId: r.id, corpo: { regraNegativo: 'contado' } });
  assert.equal(fake.ler('estoque/p2').quantidade, 22);
});

test('trava: finalizar venda e recusado ate o balanco fechar ou ser cancelado', async () => {
  const fake = criarBancoFalso(base({ 'configuracoes/loja': { tenantId: 'loja', balancoEmAndamento: { balancoId: 'b1', nome: 'BALANÇO OUTUBRO', travaVendas: true } } }), { consultas: true });
  const s = carregar(fake.db);
  const corpo = { idDocumento: 'v1', dataVenda: '2026-10-21', vendedorId: 'ger', clienteNome: 'CONSUMIDOR', itens: [{ id: 'p4', nome: 'COLEIRA', precoUnitario: 10, quantidade: 1, desconto: 0, subtotal: 10 }], pagamentos: [{ forma: 'Dinheiro', valor: '10' }] };
  await assert.rejects(() => s.venda.finalizarVenda({ user: GESTOR, tenantId: 'loja', corpo }), (e) => e.status === 409 && /BALANÇO OUTUBRO/.test(e.message) && /Pré-venda continua/.test(e.message));
});

test('cancelar tira a trava e nao mexe no estoque; trocar quem conta', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  const r = await abrir(s, { travaVendas: true });
  const deAna = fake.listar(`balancos/${r.id}/itens/`).filter((i) => i.contadorUid === 'ana').length;
  const t = await s.balanco.trocarContador({ tenantId: 'loja', balancoId: r.id, corpo: { de: 'ana', para: 'ger' } });
  assert.equal(t.movidos, deAna);
  assert.ok(fake.ler(`balancos/${r.id}`).contadores.some((c) => c.uid === 'ger'));
  await assert.rejects(() => s.balanco.cancelar({ user: GESTOR, tenantId: 'loja', balancoId: r.id, corpo: { motivo: 'x' } }), (e) => e.status === 400);
  await s.balanco.cancelar({ user: GESTOR, tenantId: 'loja', balancoId: r.id, corpo: { motivo: 'Contagem errada' } });
  assert.equal(fake.ler('estoque/p1').quantidade, -10);
  assert.equal(fake.ler('configuracoes/loja').balancoEmAndamento, undefined);
});
