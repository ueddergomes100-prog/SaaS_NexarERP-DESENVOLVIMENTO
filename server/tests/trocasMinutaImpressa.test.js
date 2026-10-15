const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

/*
 * POST /api/trocas/minuta-impressa (coluna Imp. da lista de Trocas, 15/10/2026).
 * Firebase e autenticacao trocados por versoes falsas: nenhum banco e' tocado.
 */
const base = path.join(__dirname, '..');
const TS = { __timestamp: true };
const dados = new Map();
let commits = 0;

const substituir = (modulo, exportado) => {
  const caminho = require.resolve(path.join(base, modulo));
  require.cache[caminho] = { id: caminho, filename: caminho, loaded: true, exports: exportado };
};
const ref = (id) => ({ id, chave: `trocas/${id}` });
substituir('config/firebase', {
  db: {
    collection: () => ({ doc: (id) => ref(id) }),
    getAll: async (...refs) => refs.map((r) => ({ exists: dados.has(r.chave), ref: r, data: () => structuredClone(dados.get(r.chave)) })),
    batch: () => {
      const escritas = [];
      return {
        update: (r, campos) => escritas.push([r.chave, campos]),
        commit: async () => {
          commits += 1;
          for (const [chave, campos] of escritas) dados.set(chave, { ...dados.get(chave), ...campos });
        },
      };
    },
  },
  admin: { firestore: { FieldValue: { serverTimestamp: () => TS } } },
});
substituir('middleware/auth', {
  authenticate: (req, res, next) => { req.user = JSON.parse(req.headers['x-usuario-teste'] || '{}'); next(); },
});
substituir('services/auditoria', { registrarLog: () => {} });
const rotaCaminho = require.resolve(path.join(base, 'routes/trocas.routes'));
delete require.cache[rotaCaminho];
const app = express();
app.use(express.json());
app.use('/api/trocas', require(rotaCaminho));

const GERENTE = { uid: 'g1', tenantId: 'A', permissoes: ['vendas.troca_gerenciar'] };
const EXPEDICAO = { uid: 'e1', tenantId: 'A', permissoes: ['operacoes.expedicao'] };
const VENDEDOR = { uid: 'v1', tenantId: 'A', permissoes: ['vendas.troca_solicitar'] };

const comServidor = async (fn) => {
  const servidor = app.listen(0);
  try {
    const { port } = servidor.address();
    await fn((corpo, usuario) => fetch(`http://127.0.0.1:${port}/api/trocas/minuta-impressa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-usuario-teste': JSON.stringify(usuario) },
      body: JSON.stringify(corpo),
    }));
  } finally {
    servidor.close();
  }
};

const reiniciar = () => {
  dados.clear();
  commits = 0;
  dados.set('trocas/t1', { tenantId: 'A', numeroTroca: 1 });
  dados.set('trocas/t2', { tenantId: 'A', numeroTroca: 2, minutaImpressa: true, minutaImpressaEm: 'primeira' });
  dados.set('trocas/t3', { tenantId: 'B', numeroTroca: 3 });
};

test('marca so a primeira impressao, so da propria empresa', async () => {
  reiniciar();
  await comServidor(async (post) => {
    const r = await post({ ids: ['t1', 't2', 't3', 'nao-existe', 't1'] }, GERENTE);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).marcadas, 1);
  });
  assert.equal(dados.get('trocas/t1').minutaImpressa, true);
  assert.equal(dados.get('trocas/t1').minutaImpressaEm, TS);
  assert.equal(dados.get('trocas/t2').minutaImpressaEm, 'primeira', 'reimpressao nao troca a data da primeira');
  assert.equal(dados.get('trocas/t3').minutaImpressa, undefined, 'troca de outra empresa nunca e tocada');
});

test('expedicao tambem marca; nada a marcar nao grava', async () => {
  reiniciar();
  await comServidor(async (post) => {
    assert.equal((await post({ ids: ['t2'] }, EXPEDICAO)).status, 200);
  });
  assert.equal(commits, 0);
});

test('sem permissao recebe 403; sem ids recebe 400', async () => {
  reiniciar();
  await comServidor(async (post) => {
    const semPermissao = await post({ ids: ['t1'] }, VENDEDOR);
    assert.equal(semPermissao.status, 403);
    assert.match((await semPermissao.json()).error, /permissão/);
    assert.equal((await post({ ids: [] }, GERENTE)).status, 400);
    assert.equal((await post({}, GERENTE)).status, 400);
  });
  assert.equal(dados.get('trocas/t1').minutaImpressa, undefined);
});
