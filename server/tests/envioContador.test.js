const test = require('node:test');
const assert = require('node:assert/strict');

/*
 * Envio ao contador (20/10/2026): PDF + .zip pelo SMTP da empresa; e-mail do
 * contador guardado depois de enviar. Firestore falso e transporte falso.
 */
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

const carregar = (db) => {
  const servicos = carregarComBancoFalso(db, 'services/envioContador');
  return servicos[servicos.length - 1];
};

const BASE = {
  'configuracoes/loja': { tenantId: 'loja', email: 'loja@empresa.com.br', nomeOficina: 'SHOPPING RURAL' },
  'configuracoes_privadas/loja': { smtpHost: 'smtp.empresa.com.br', smtpPorta: 465, smtpUsuario: 'loja@empresa.com.br', smtpSenha: 'x' },
};
const DONO = { uid: 'dono', tenantId: 'loja', isTenantManager: true, permissoes: [] };
const b64 = (texto) => Buffer.from(texto).toString('base64');
const CORPO = {
  para: 'contador@escritorio.com.br',
  periodo: '01/09/2026 a 30/09/2026',
  anexos: [{ tipo: 'pdf', nome: 'relatorio-contador-09-2026', base64: b64('%PDF-1.4') }, { tipo: 'zip', nome: 'xmls 09/2026.zip', base64: b64('PK') }],
};

const transporteFalso = () => {
  const enviados = [];
  return { enviados, criar: () => ({ sendMail: async (m) => { enviados.push(m); } }) };
};

test('envia do e-mail da empresa para o contador com os dois anexos e guarda o e-mail', async () => {
  const fake = criarBancoFalso(BASE);
  const s = carregar(fake.db);
  const t = transporteFalso();
  const r = await s.enviarAoContador({ user: DONO, tenantId: 'loja', corpo: CORPO, criarTransporte: t.criar });
  assert.equal(r.para, 'contador@escritorio.com.br');
  assert.deepEqual(r.anexos, ['relatorio-contador-09-2026.pdf', 'xmls 092026.zip']);
  assert.equal(t.enviados.length, 1);
  const m = t.enviados[0];
  assert.equal(m.from.address, 'loja@empresa.com.br');
  assert.equal(m.to, 'contador@escritorio.com.br');
  assert.match(m.subject, /Relatório fiscal 01\/09\/2026 a 30\/09\/2026 - SHOPPING RURAL/);
  assert.equal(m.attachments[0].contentType, 'application/pdf');
  assert.equal(m.attachments[1].content.toString(), 'PK');
  assert.equal(fake.ler('configuracoes/loja').emailContador, 'contador@escritorio.com.br');
});

test('recusas: sem permissao, e-mail invalido, sem anexo, grande demais, sem SMTP', async () => {
  const fake = criarBancoFalso(BASE);
  const s = carregar(fake.db);
  const t = transporteFalso();
  const enviar = (user, corpo) => s.enviarAoContador({ user, tenantId: 'loja', corpo, criarTransporte: t.criar });
  await assert.rejects(enviar({ uid: 'x', tenantId: 'loja', permissoes: [] }, CORPO), (e) => e.status === 403);
  await assert.doesNotReject(enviar({ uid: 'y', tenantId: 'loja', permissoes: ['fiscal.relatorio_contador'] }, CORPO));
  await assert.rejects(enviar(DONO, { ...CORPO, para: 'contador' }), (e) => e.status === 400 && /e-mail válido/.test(e.message));
  await assert.rejects(enviar(DONO, { ...CORPO, anexos: [] }), (e) => e.status === 400 && /Nada para enviar/.test(e.message));
  const grande = Buffer.alloc(19 * 1024 * 1024).toString('base64');
  await assert.rejects(enviar(DONO, { ...CORPO, anexos: [{ tipo: 'zip', nome: 'x', base64: grande }] }), (e) => e.status === 413);
  const semSmtp = criarBancoFalso({ 'configuracoes/loja': BASE['configuracoes/loja'] });
  const s2 = carregar(semSmtp.db);
  await assert.rejects(s2.enviarAoContador({ user: DONO, tenantId: 'loja', corpo: CORPO, criarTransporte: t.criar }), (e) => e.status === 400 && /SMTP|servidor/.test(e.message));
});

test('erro do SMTP vira mensagem em portugues e nao guarda o e-mail', async () => {
  const fake = criarBancoFalso(BASE);
  const s = carregar(fake.db);
  const falha = () => ({ sendMail: async () => { const e = new Error('Invalid login'); e.code = 'EAUTH'; throw e; } });
  await assert.rejects(s.enviarAoContador({ user: DONO, tenantId: 'loja', corpo: CORPO, criarTransporte: falha }), (e) => e.status === 502 && !/Invalid login/.test(e.message));
  assert.equal(fake.ler('configuracoes/loja').emailContador, undefined);
});
