const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

/*
 * Rota do botao "Preencher datas faltantes" (Painel da Plataforma): quem pode
 * usar e o que cada modo faz. Firebase, autenticacao e o servico sao trocados
 * por versoes falsas -- nenhum banco e' tocado.
 */
const base = path.join(__dirname, '..');
const chamadas = [];
const substituir = (modulo, exportado) => {
  const caminho = require.resolve(path.join(base, modulo));
  require.cache[caminho] = { id: caminho, filename: caminho, loaded: true, exports: exportado };
};
// Como na producao: entrando pela conta de servico, admin.app().options.projectId
// vem vazio e o projeto so' existe no que config/firebase exporta.
substituir('config/firebase', {
  db: {},
  projectId: 'projeto-teste',
  admin: { app: () => ({ options: {} }), firestore: { FieldValue: { delete: () => 'APAGAR' } } },
});
substituir('middleware/auth', {
  // O teste diz quem e' o usuario pelo cabecalho; a rota so' le req.user.
  authenticate: (req, res, next) => {
    req.user = JSON.parse(req.headers['x-usuario-teste'] || '{}');
    next();
  },
});
substituir('services/auditoria', { registrarLog: (...args) => chamadas.push(['log', ...args]) });
substituir('services/datasFaltantes', {
  preencherDatasFaltantes: async (opcoes) => {
    chamadas.push(['servico', { tenantId: opcoes.tenantId, aplicar: opcoes.aplicar, desfazer: opcoes.desfazer }]);
    return { tenantId: opcoes.tenantId || null, aplicar: opcoes.aplicar, desfazer: opcoes.desfazer, colecoes: [{ nome: 'pedidos_venda', campo: 'dataVenda', alterados: 3 }] };
  },
});
// Logins no dominio do dono (25/11/2026): servico falso, so' registra o modo.
substituir('services/dominioDosLogins', {
  migrarDominioDosLogins: async (opcoes) => {
    chamadas.push(['dominio', { aplicar: opcoes.aplicar }]);
    return {
      dominioNovo: 'login.nexarcompany.com.br', aplicar: opcoes.aplicar, lote: 100, contasNoDominioAntigo: 2,
      totais: { trocados: 2, soCadastro: 0, semConta: 0, jaNoDominioNovo: 0, pendentes: 0, falhas: 0, indicesSoltos: 0 },
      empresas: [{ tenantId: 'T1', nome: 'LOJA', trocados: 2, totalFalhas: 0, falhas: [] }],
    };
  },
});
const rotaCaminho = require.resolve(path.join(base, 'routes/manutencao.routes'));
delete require.cache[rotaCaminho];
const rota = require(rotaCaminho);

const app = express();
app.use(express.json());
app.use('/api/manutencao', rota);

const PLATAFORMA = { uid: 'u1', email: 'dono@teste', tenantId: 'T0', isPlatformAdmin: true };
const DONO_DE_EMPRESA = { uid: 'u2', tenantId: 'T1', isPlatformAdmin: false, dono: true };

const comServidor = async (fn) => {
  const servidor = app.listen(0);
  try {
    const { port } = servidor.address();
    await fn((corpo, usuario) => fetch(`http://127.0.0.1:${port}/api/manutencao/datas-faltantes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-usuario-teste': JSON.stringify(usuario) },
      body: JSON.stringify(corpo),
    }));
  } finally {
    servidor.close();
  }
};

test('dono de empresa (e qualquer um fora da plataforma) recebe 403 e o servico nem roda', async () => {
  chamadas.length = 0;
  await comServidor(async (post) => {
    const r = await post({ modo: 'aplicar' }, DONO_DE_EMPRESA);
    assert.equal(r.status, 403);
    assert.match((await r.json()).error, /administrador da plataforma/);
  });
  assert.equal(chamadas.length, 0);
});

test('modo invalido recebe 400', async () => {
  await comServidor(async (post) => {
    const r = await post({ modo: 'apagar-tudo' }, PLATAFORMA);
    assert.equal(r.status, 400);
  });
});

test('sem modo = simular: nao grava e nao registra log', async () => {
  chamadas.length = 0;
  await comServidor(async (post) => {
    const r = await post({}, PLATAFORMA);
    assert.equal(r.status, 200);
    const corpo = await r.json();
    assert.equal(corpo.projeto, 'projeto-teste');
    assert.equal(corpo.modo, 'simular');
  });
  assert.deepEqual(chamadas, [['servico', { tenantId: '', aplicar: false, desfazer: false }]]);
});

test('aplicar e desfazer gravam e deixam registro de auditoria', async () => {
  chamadas.length = 0;
  await comServidor(async (post) => {
    assert.equal((await post({ modo: 'aplicar', tenantId: ' T9 ' }, PLATAFORMA)).status, 200);
    assert.equal((await post({ modo: 'desfazer' }, PLATAFORMA)).status, 200);
  });
  const servico = chamadas.filter(([tipo]) => tipo === 'servico').map(([, o]) => o);
  assert.deepEqual(servico, [
    { tenantId: 'T9', aplicar: true, desfazer: false },
    { tenantId: '', aplicar: true, desfazer: true },
  ]);
  const logs = chamadas.filter(([tipo]) => tipo === 'log');
  assert.equal(logs.length, 2);
  assert.equal(logs[0][2].acao, 'datas_faltantes_preenchidas');
  assert.equal(logs[1][2].acao, 'datas_faltantes_desfeitas');
});

test('logins no dominio do dono: so a plataforma, so Simular e Aplicar, e Aplicar deixa auditoria', async () => {
  chamadas.length = 0;
  const servidor = app.listen(0);
  try {
    const { port } = servidor.address();
    const post = (corpo, usuario) => fetch(`http://127.0.0.1:${port}/api/manutencao/dominio-dos-logins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-usuario-teste': JSON.stringify(usuario) },
      body: JSON.stringify(corpo),
    });
    assert.equal((await post({ modo: 'aplicar' }, DONO_DE_EMPRESA)).status, 403);
    const desfazer = await post({ modo: 'desfazer' }, PLATAFORMA);
    assert.equal(desfazer.status, 400);
    assert.match((await desfazer.json()).error, /só tem Simular e Aplicar/);
    const simulado = await post({}, PLATAFORMA);
    assert.equal(simulado.status, 200);
    const corpo = await simulado.json();
    assert.equal(corpo.modo, 'simular');
    assert.equal(corpo.projeto, 'projeto-teste');
    assert.equal(corpo.totais.trocados, 2);
    assert.equal((await post({ modo: 'aplicar' }, PLATAFORMA)).status, 200);
  } finally {
    servidor.close();
  }
  assert.deepEqual(chamadas.filter(([tipo]) => tipo === 'dominio').map(([, o]) => o), [{ aplicar: false }, { aplicar: true }]);
  const logs = chamadas.filter(([tipo]) => tipo === 'log');
  assert.equal(logs.length, 1, 'so o Aplicar registra');
  assert.equal(logs[0][2].acao, 'dominio_dos_logins');
  assert.match(logs[0][2].descricao, /@login\.nexarcompany\.com\.br: 2 conta\(s\) trocada\(s\)/);
});
