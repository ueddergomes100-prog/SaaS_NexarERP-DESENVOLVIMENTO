const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

/*
 * Logins de funcionario saem do dominio de terceiro (`nexar.app`) para o do dono
 * (`login.nexarcompany.com.br`) -- auditoria de seguranca, item 1.3 (25/11/2026).
 * Tarefa da Manutencao (services/dominioDosLogins.js): conta do Auth, indice
 * `usernames` e ficha `usuarios`, idempotente, retomavel e em lotes.
 */

const ANTIGO = 'nexar.app';
const NOVO = 'login.nexarcompany.com.br';
const CNPJ = '12345678000190';
const CNPJ2 = '98765432000110';
const em = (chave, dominio) => `${chave}@${dominio}`;

const BASE = () => ({
  'configuracoes/loja': { nomeOficina: 'LOJA DO TESTE', cnpj: CNPJ },
  'configuracoes/oficina': { nomeOficina: 'OFICINA DO TESTE', cnpj: CNPJ2 },
  'usuarios/loja': { tenantId: 'loja', role: 'Master', email: 'dono@loja.test', nome: 'DONO' },
  'usuarios/ana': { tenantId: 'loja', role: 'Funcionario', nome: 'ANA', username: `${CNPJ}-ana`, email: em(`${CNPJ}-ana`, ANTIGO) },
  'usuarios/bia': { tenantId: 'loja', role: 'Funcionario', nome: 'BIA', username: `${CNPJ}-bia`, email: em(`${CNPJ}-bia`, ANTIGO) },
  'usuarios/caio': { tenantId: 'oficina', role: 'Funcionario', nome: 'CAIO', username: `${CNPJ2}-caio`, email: em(`${CNPJ2}-caio`, ANTIGO) },
  'usuarios/novato': { tenantId: 'oficina', role: 'Funcionario', nome: 'NOVATO', username: `${CNPJ2}-novato`, email: em(`${CNPJ2}-novato`, NOVO) },
  [`usernames/${CNPJ}-ana`]: { tenantId: 'loja', email: em(`${CNPJ}-ana`, ANTIGO) },
  [`usernames/${CNPJ}-bia`]: { tenantId: 'loja', email: em(`${CNPJ}-bia`, ANTIGO) },
  [`usernames/${CNPJ2}-caio`]: { tenantId: 'oficina', email: em(`${CNPJ2}-caio`, ANTIGO) },
  [`usernames/${CNPJ2}-novato`]: { tenantId: 'oficina', email: em(`${CNPJ2}-novato`, NOVO) },
});

const CONTAS = () => [
  ['loja', { email: 'dono@loja.test', customClaims: { role: 'Master', tenantId: 'loja' } }],
  ['ana', { email: em(`${CNPJ}-ana`, ANTIGO), displayName: 'ANA' }],
  ['bia', { email: em(`${CNPJ}-bia`, ANTIGO), displayName: 'BIA' }],
  ['caio', { email: em(`${CNPJ2}-caio`, ANTIGO), displayName: 'CAIO' }],
  ['novato', { email: em(`${CNPJ2}-novato`, NOVO), displayName: 'NOVATO' }],
];

const carregar = (docs = BASE(), contas = CONTAS()) => {
  const fake = criarBancoFalso(docs, { consultas: true });
  fake.db.__contasDoAuth = new Map(contas.map(([uid, c]) => [uid, { ...c }]));
  const [servico] = carregarComBancoFalso(fake.db, 'services/dominioDosLogins').slice(-1);
  const rodar = (opcoes) => servico.migrarDominioDosLogins({ pausaMs: 0, ...opcoes });
  return { fake, rodar, contas: fake.db.__contasDoAuth };
};

/** O login do sistema/caixa/app: le o indice e entra com o e-mail que estiver la'. */
const entrar = ({ fake, contas }, cnpj, usuario) => {
  const indice = fake.ler(`usernames/${cnpj}-${usuario}`);
  if (!indice) return null;
  const achada = [...contas.entries()].find(([, c]) => c.email === indice.email);
  return achada ? achada[0] : null;
};

const empresa = (resultado, tenantId) => resultado.empresas.find((e) => e.tenantId === tenantId);

test('Simular: conta o que trocar por empresa e nao grava nada', async () => {
  const ctx = carregar();
  const antes = { ana: ctx.fake.ler('usuarios/ana'), indice: ctx.fake.ler(`usernames/${CNPJ}-ana`) };
  const r = await ctx.rodar({ aplicar: false });
  assert.equal(r.dominioNovo, NOVO);
  assert.equal(r.contasNoDominioAntigo, 3);
  assert.deepEqual(r.totais, { trocados: 3, soCadastro: 0, semConta: 0, jaNoDominioNovo: 1, pendentes: 0, falhas: 0, indicesSoltos: 0 });
  assert.equal(empresa(r, 'loja').nome, 'LOJA DO TESTE');
  assert.equal(empresa(r, 'loja').trocados, 2);
  assert.equal(empresa(r, 'oficina').trocados, 1);
  assert.equal(empresa(r, 'oficina').jaNoDominioNovo, 1);
  assert.deepEqual(ctx.fake.ler('usuarios/ana'), antes.ana);
  assert.deepEqual(ctx.fake.ler(`usernames/${CNPJ}-ana`), antes.indice);
  assert.equal(ctx.contas.get('ana').email, em(`${CNPJ}-ana`, ANTIGO));
  assert.equal(ctx.fake.db.__trocasNoAuth, undefined, 'nenhuma conta alterada');
});

test('Aplicar: conta, indice e ficha no dominio novo; o funcionario entra com o mesmo CNPJ e usuario', async () => {
  const ctx = carregar();
  assert.equal(entrar(ctx, CNPJ, 'ana'), 'ana', 'antes: entra');
  const r = await ctx.rodar({ aplicar: true });
  assert.equal(r.totais.trocados, 3);
  assert.equal(r.totais.falhas, 0);
  for (const [uid, chave] of [['ana', `${CNPJ}-ana`], ['bia', `${CNPJ}-bia`], ['caio', `${CNPJ2}-caio`]]) {
    assert.equal(ctx.contas.get(uid).email, em(chave, NOVO), `conta ${uid}`);
    assert.equal(ctx.fake.ler(`usernames/${chave}`).email, em(chave, NOVO), `indice ${uid}`);
    assert.equal(ctx.fake.ler(`usuarios/${uid}`).email, em(chave, NOVO), `ficha ${uid}`);
  }
  assert.equal(ctx.fake.ler(`usernames/${CNPJ}-ana`).tenantId, 'loja', 'o indice continua da empresa');
  assert.equal(entrar(ctx, CNPJ, 'ana'), 'ana', 'depois: entra na MESMA conta');
  assert.equal(entrar(ctx, CNPJ2, 'caio'), 'caio');
  // Dono (e-mail real) e quem ja' estava no novo: intocados.
  assert.equal(ctx.contas.get('loja').email, 'dono@loja.test');
  assert.equal(ctx.fake.ler('usuarios/loja').email, 'dono@loja.test');
  assert.deepEqual(ctx.fake.db.__trocasNoAuth.map(([uid]) => uid).sort(), ['ana', 'bia', 'caio']);
  // Nada mais no dominio antigo, em lugar nenhum.
  const tudo = JSON.stringify([...ctx.contas.values(), ...ctx.fake.listar('usuarios/'), ...ctx.fake.listar('usernames/')]);
  assert.ok(!tudo.includes(`@${ANTIGO}`), tudo);
});

test('rodar de novo nao estraga nem altera nada (idempotente)', async () => {
  const ctx = carregar();
  await ctx.rodar({ aplicar: true });
  const trocas = ctx.fake.db.__trocasNoAuth.length;
  const r = await ctx.rodar({ aplicar: true });
  assert.equal(r.contasNoDominioAntigo, 0);
  assert.deepEqual(r.totais, { trocados: 0, soCadastro: 0, semConta: 0, jaNoDominioNovo: 4, pendentes: 0, falhas: 0, indicesSoltos: 0 });
  assert.equal(ctx.fake.db.__trocasNoAuth.length, trocas, 'nenhuma conta alterada de novo');
});

test('retomavel: conta ja\' trocada com indice e ficha antigos (parou no meio) so\' acerta o cadastro', async () => {
  const contas = CONTAS().map(([uid, c]) => (uid === 'ana' ? [uid, { ...c, email: em(`${CNPJ}-ana`, NOVO) }] : [uid, c]));
  const ctx = carregar(BASE(), contas);
  assert.equal(entrar(ctx, CNPJ, 'ana'), null, 'antes: o indice antigo nao acha a conta');
  const simulado = await ctx.rodar({ aplicar: false });
  assert.equal(empresa(simulado, 'loja').soCadastro, 1);
  const r = await ctx.rodar({ aplicar: true });
  assert.equal(empresa(r, 'loja').soCadastro, 1);
  assert.equal(empresa(r, 'loja').trocados, 1, 'so\' a bia trocou a conta');
  assert.ok(!ctx.fake.db.__trocasNoAuth.some(([uid]) => uid === 'ana'), 'a conta da ana nao foi alterada de novo');
  assert.equal(ctx.fake.ler(`usernames/${CNPJ}-ana`).email, em(`${CNPJ}-ana`, NOVO));
  assert.equal(ctx.fake.ler('usuarios/ana').email, em(`${CNPJ}-ana`, NOVO));
  assert.equal(entrar(ctx, CNPJ, 'ana'), 'ana', 'depois: entra');
});

test('em lotes: Aplicar troca no maximo o lote, diz quantos faltam, e o proximo termina', async () => {
  const ctx = carregar();
  const primeiro = await ctx.rodar({ aplicar: true, lote: 2 });
  assert.equal(primeiro.totais.trocados, 2);
  assert.equal(primeiro.totais.pendentes, 1);
  const segundo = await ctx.rodar({ aplicar: true, lote: 2 });
  assert.equal(segundo.totais.trocados, 1);
  assert.equal(segundo.totais.pendentes, 0);
  assert.equal(segundo.contasNoDominioAntigo, 1);
  assert.equal(entrar(ctx, CNPJ2, 'caio'), 'caio');
});

test('lista de contas do Auth em varias paginas: nenhuma fica de fora', async () => {
  const ctx = carregar();
  ctx.fake.db.__tamanhoDaPaginaDoAuth = 1;
  const r = await ctx.rodar({ aplicar: false });
  assert.equal(r.contasNoDominioAntigo, 3);
});

test('falhas por login, com o motivo em portugues, sem parar os outros', async () => {
  const docs = {
    ...BASE(),
    // Outra conta ja' tem o endereco novo da bia.
    'usuarios/duplicada': { tenantId: 'loja', role: 'Funcionario', nome: 'BIA 2', email: em(`${CNPJ}-bia`, NOVO) },
    // Ficha diz o dominio antigo, mas a conta usa outro e-mail.
    'usuarios/dani': { tenantId: 'loja', role: 'Funcionario', nome: 'DANI', username: `${CNPJ}-dani`, email: em(`${CNPJ}-dani`, ANTIGO) },
  };
  const contas = [
    ...CONTAS(),
    ['duplicada', { email: em(`${CNPJ}-bia`, NOVO) }],
    ['dani', { email: 'dani@pessoal.test' }],
    // Conta da equipe da plataforma no dominio antigo: nunca mexe.
    ['equipe', { email: em('suporte', ANTIGO), customClaims: { role: 'SuperAdmin' } }],
  ];
  const ctx = carregar(docs, contas);
  ctx.contas.get('caio').falharTroca = 'auth/too-many-requests';
  const r = await ctx.rodar({ aplicar: true });
  const motivos = r.empresas.flatMap((e) => e.falhas.map((f) => `${f.nome || f.usuario}: ${f.motivo}`)).join('\n');
  assert.equal(r.totais.falhas, 4, motivos);
  assert.match(motivos, /BIA: Já existe outra conta com o endereço novo/);
  assert.match(motivos, /DANI: A ficha diz .* usa outro e-mail \(dani@pessoal\.test\)/);
  assert.match(motivos, /suporte: Esta conta é da equipe da plataforma/);
  assert.match(motivos, /CAIO: O Firebase pediu para esperar/);
  // A ana (sem problema) foi trocada; quem falhou ficou como estava.
  assert.equal(ctx.contas.get('ana').email, em(`${CNPJ}-ana`, NOVO));
  assert.equal(ctx.contas.get('bia').email, em(`${CNPJ}-bia`, ANTIGO));
  assert.equal(ctx.fake.ler(`usernames/${CNPJ}-bia`).email, em(`${CNPJ}-bia`, ANTIGO), 'indice da bia segue achando a conta dela');
  assert.equal(entrar(ctx, CNPJ, 'bia'), 'bia');
  assert.equal(ctx.contas.get('equipe').email, em('suporte', ANTIGO));
  assert.equal(ctx.contas.get('dani').email, 'dani@pessoal.test');
  assert.equal(ctx.fake.ler('usuarios/dani').email, em(`${CNPJ}-dani`, ANTIGO));
});

test('conta sem ficha, ficha sem conta e indice solto: todos saem do dominio antigo', async () => {
  const docs = {
    ...BASE(),
    // Funcionario excluido da ficha mas com a conta ainda viva (porta aberta).
    [`usernames/${CNPJ}-orfao`]: { tenantId: 'loja', email: em(`${CNPJ}-orfao`, ANTIGO) },
    // Ficha antiga cuja conta nao existe mais no Auth.
    'usuarios/fantasma': { tenantId: 'loja', role: 'Funcionario', nome: 'FANTASMA', username: `${CNPJ}-fantasma`, email: em(`${CNPJ}-fantasma`, ANTIGO) },
    [`usernames/${CNPJ}-fantasma`]: { tenantId: 'loja', email: em(`${CNPJ}-fantasma`, ANTIGO) },
    // Indice sem conta e sem ficha.
    [`usernames/${CNPJ}-solto`]: { tenantId: 'loja', email: em(`${CNPJ}-solto`, ANTIGO) },
  };
  const ctx = carregar(docs, [...CONTAS(), ['orfao', { email: em(`${CNPJ}-orfao`, ANTIGO) }]]);
  const r = await ctx.rodar({ aplicar: true });
  assert.equal(r.totais.falhas, 0);
  assert.equal(ctx.contas.get('orfao').email, em(`${CNPJ}-orfao`, NOVO));
  assert.equal(ctx.fake.ler(`usernames/${CNPJ}-orfao`).email, em(`${CNPJ}-orfao`, NOVO));
  assert.equal(ctx.fake.ler('usuarios/fantasma').email, em(`${CNPJ}-fantasma`, NOVO));
  assert.equal(ctx.fake.ler(`usernames/${CNPJ}-fantasma`).email, em(`${CNPJ}-fantasma`, NOVO));
  assert.equal(ctx.fake.ler(`usernames/${CNPJ}-solto`).email, em(`${CNPJ}-solto`, NOVO));
  assert.equal(r.totais.semConta, 1);
  assert.equal(r.totais.indicesSoltos, 1);
  assert.equal(ctx.fake.ler('usuarios/orfao'), undefined, 'nao inventa ficha');
});

test('o dominio antigo so\' aparece onde a migracao precisa dele', () => {
  // Nada mais cria nem aceita login no dominio de terceiro. Se este teste falhar,
  // alguem escreveu o dominio antigo no codigo: use DOMINIO_DO_LOGIN.
  const raiz = path.join(__dirname, '..', '..');
  const permitidos = new Set([
    path.join('src', 'utils', 'loginIdentidadeDomain.ts'),
    path.join('server', 'domain', 'loginIdentidadeDomain.js'),
  ]);
  const ignorar = new Set(['node_modules', 'tests', 'dist', '.vite']);
  const achados = [];
  const varrer = (pasta) => {
    for (const item of fs.readdirSync(path.join(raiz, pasta), { withFileTypes: true })) {
      const relativo = path.join(pasta, item.name);
      if (item.isDirectory()) {
        if (!ignorar.has(item.name)) varrer(relativo);
      } else if (/\.(ts|tsx|js|mjs|cjs|json|rules|html)$/.test(item.name) && !permitidos.has(relativo)) {
        if (fs.readFileSync(path.join(raiz, relativo), 'utf8').includes(ANTIGO)) achados.push(relativo);
      }
    }
  };
  ['src', 'server', 'public'].filter((p) => fs.existsSync(path.join(raiz, p))).forEach(varrer);
  for (const arquivo of ['firestore.rules', 'storage.rules', 'index.html']) {
    if (fs.existsSync(path.join(raiz, arquivo)) && fs.readFileSync(path.join(raiz, arquivo), 'utf8').includes(ANTIGO)) achados.push(arquivo);
  }
  assert.deepEqual(achados, []);
});
