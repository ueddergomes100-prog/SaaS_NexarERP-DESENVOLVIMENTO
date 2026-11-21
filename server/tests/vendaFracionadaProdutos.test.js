const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso, TS } = require('./helpers/firestoreFalso');

const carregar = (db) => carregarComBancoFalso(db, 'services/vendaFracionadaProdutos').pop();

const base = () => ({
  'configuracoes/loja': { tenantId: 'loja', nomeOficina: 'JOMARLY', cnpj: '12.345.678/0001-90' },
  'unidades_medida/u-m3': { tenantId: 'loja', sigla: 'M3', casasDecimais: 3, permiteFracionado: true },
  'unidades_medida/u-mt': { tenantId: 'loja', sigla: 'MT', casasDecimais: 2, permiteFracionado: true },
  'unidades_medida/u-un': { tenantId: 'loja', sigla: 'UN', casasDecimais: 0, permiteFracionado: false },
  'unidades_medida/outra': { tenantId: 'outra', sigla: 'UN', casasDecimais: 2, permiteFracionado: true },
  // Travado: unidade fracionada, copia dizendo "nao".
  'estoque/areia': {
    tenantId: 'loja', codigo: '2923', nome: 'AREIA METRO', unidadeMedidaId: 'u-m3', unidadeMedidaSigla: 'M3',
    unidadeMedidaFracionado: false, unidadeMedidaCasasDecimais: 0, estoqueConfig: { fracionado: false }, ativo: true,
  },
  // Ja vende fracionado, mas sem a marca do produto: so' a marca muda.
  'estoque/mangueira': {
    tenantId: 'loja', codigo: '1390', nome: 'MANGUEIRA NIVEL', unidadeMedidaId: 'u-mt', unidadeMedidaSigla: 'MT',
    unidadeMedidaFracionado: true, unidadeMedidaCasasDecimais: 2, estoqueConfig: { fracionado: true }, ativo: true,
  },
  // Tudo certo: nada a gravar.
  'estoque/fio': {
    tenantId: 'loja', codigo: '10', nome: 'FIO', unidadeMedidaId: 'u-mt', unidadeMedidaSigla: 'MT', produtoFracionado: true,
    unidadeMedidaFracionado: true, unidadeMedidaCasasDecimais: 2, estoqueConfig: { fracionado: true },
  },
  // Cadastro antigo sem id da unidade: acha pela sigla.
  'estoque/brita': {
    tenantId: 'loja', codigo: '2925', nome: 'BRITA', unidadeMedidaSigla: 'm3', unidadeMedidaFracionado: false,
  },
  // Unidade inteira: fora.
  'estoque/parafuso': { tenantId: 'loja', codigo: '1', nome: 'PARAFUSO', unidadeMedidaId: 'u-un', unidadeMedidaSigla: 'UN' },
  // Inativo: fora.
  'estoque/velho': { tenantId: 'loja', codigo: '2', nome: 'VELHO', unidadeMedidaId: 'u-m3', unidadeMedidaSigla: 'M3', ativo: false },
  // Outra empresa: fora.
  'estoque/alheio': { tenantId: 'outra', codigo: '3', nome: 'ALHEIO', unidadeMedidaSigla: 'UN', unidadeMedidaFracionado: false },
});


test('simular: conta quem trava e o que muda, sem gravar nada', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  const r = await s.corrigirVendaFracionada({ db: fake.db, agora: () => TS, tenantId: 'loja', aplicar: false, usuarioId: 'admin' });
  assert.equal(r.empresa, 'JOMARLY');
  assert.deepEqual(r.unidadesFracionadas, ['M3', 'MT']);
  assert.equal(r.naUnidadeFracionada, 4, 'areia, mangueira, fio e brita');
  assert.equal(r.travados, 2, 'areia e brita');
  assert.equal(r.alterados, 3, 'areia, brita e a marca da mangueira');
  assert.deepEqual(r.porSigla, [
    { sigla: 'M3', produtos: 2, travados: 2, alterados: 2 },
    { sigla: 'MT', produtos: 2, travados: 0, alterados: 1 },
  ]);
  assert.deepEqual(r.exemplos.map((e) => e.nome), ['AREIA METRO', 'BRITA']);
  assert.equal(fake.ler('estoque/areia').unidadeMedidaFracionado, false, 'simular nao grava');
});

test('aplicar: produto ativo em unidade fracionada passa a vender fracionado, com as casas da unidade', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  await s.corrigirVendaFracionada({ db: fake.db, agora: () => TS, tenantId: 'loja', aplicar: true, usuarioId: 'admin' });
  const areia = fake.ler('estoque/areia');
  assert.equal(areia.unidadeMedidaFracionado, true);
  assert.equal(areia.produtoFracionado, true);
  assert.equal(areia.estoqueConfig.fracionado, true);
  assert.equal(areia.unidadeMedidaCasasDecimais, 3);
  assert.equal(areia.alteradoPor, 'admin');
  const brita = fake.ler('estoque/brita');
  assert.equal(brita.unidadeMedidaFracionado, true);
  assert.equal(brita.unidadeMedidaCasasDecimais, 3);
  assert.equal(fake.ler('estoque/mangueira').produtoFracionado, true);
  assert.equal(fake.ler('estoque/fio').alteradoPor, undefined, 'o que ja estava certo nao e regravado');
  assert.equal(fake.ler('estoque/parafuso').produtoFracionado, undefined);
  assert.equal(fake.ler('estoque/velho').unidadeMedidaFracionado, undefined);
  assert.equal(fake.ler('estoque/alheio').unidadeMedidaFracionado, false);

  const deNovo = await s.corrigirVendaFracionada({ db: fake.db, agora: () => TS, tenantId: 'loja', aplicar: false, usuarioId: 'admin' });
  assert.equal(deNovo.alterados, 0, 'rodar de novo nao acha mais nada');
  assert.equal(deNovo.travados, 0);
});

test('empresa que nao existe: erro em portugues com status 404', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  await assert.rejects(
    () => s.corrigirVendaFracionada({ db: fake.db, agora: () => TS, tenantId: 'nada', aplicar: false, usuarioId: 'admin' }),
    (e) => e.status === 404 && /Empresa não encontrada/.test(e.message),
  );
});

test('embalagens: unidade G marcada como fracionada depois -- a copia da embalagem e refeita (caso PREGO, 21/11/2026)', async () => {
  const fake = criarBancoFalso({
    ...base(),
    'unidades_medida/u-g': { tenantId: 'loja', sigla: 'G', casasDecimais: 3, permiteFracionado: true },
    'unidades_medida/u-kg': { tenantId: 'loja', sigla: 'KG', casasDecimais: 3, permiteFracionado: false },
    'estoque/prego': {
      tenantId: 'loja', codigo: '50', nome: 'PREGO 10 X 10', unidadeMedidaId: 'u-kg', unidadeMedidaSigla: 'KG', produtoFracionado: false, ativo: true,
      embalagens: [{ id: 'e1', unidadeMedidaId: 'u-g', unidadeMedidaSigla: 'G', unidadeMedidaFracionado: false, unidadeMedidaCasasDecimais: 0, fatorConversao: 0.1, precoVenda: 4 }],
    },
  }, { consultas: true });
  const s = carregar(fake.db);
  const r = await s.corrigirVendaFracionada({ db: fake.db, agora: () => TS, tenantId: 'loja', aplicar: false, usuarioId: 'admin' });
  assert.equal(r.embalagensAcertadas, 1);
  assert.equal(r.embalagensTravadas, 1);
  assert.deepEqual(r.exemplosEmbalagem, [{ codigo: '50', nome: 'PREGO 10 X 10' }]);
  assert.equal(fake.ler('estoque/prego').embalagens[0].unidadeMedidaFracionado, false, 'simular nao grava');

  await s.corrigirVendaFracionada({ db: fake.db, agora: () => TS, tenantId: 'loja', aplicar: true, usuarioId: 'admin' });
  const prego = fake.ler('estoque/prego');
  assert.equal(prego.embalagens[0].unidadeMedidaFracionado, true);
  assert.equal(prego.embalagens[0].unidadeMedidaCasasDecimais, 3);
  assert.equal(prego.embalagens[0].precoVenda, 4, 'o resto da embalagem fica');
  assert.equal(prego.produtoFracionado, false, 'produto em unidade inteira nao muda');
  const deNovo = await s.corrigirVendaFracionada({ db: fake.db, agora: () => TS, tenantId: 'loja', aplicar: false, usuarioId: 'admin' });
  assert.equal(deNovo.embalagensAcertadas, 0);
});
