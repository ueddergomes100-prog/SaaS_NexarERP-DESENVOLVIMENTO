const test = require('node:test');
const assert = require('node:assert/strict');
const {
  emailValido,
  erroDaConfiguracaoSmtp,
  opcoesDoTransporte,
  traduzirErroSmtp,
  montarMensagem,
  nomeDoAnexo,
} = require('../services/emailNota');

test('e-mail: aceita endereço normal e recusa vazio, sem arroba e com espaço', () => {
  assert.equal(emailValido('cliente@empresa.com.br'), true);
  assert.equal(emailValido(' cliente@empresa.com.br '), true);
  assert.equal(emailValido(''), false);
  assert.equal(emailValido('cliente.empresa.com'), false);
  assert.equal(emailValido('cli ente@empresa.com'), false);
  assert.equal(emailValido('a@b'), false);
});

test('configuração SMTP: cada campo que falta gera uma mensagem em português dizendo onde preencher', () => {
  assert.match(erroDaConfiguracaoSmtp({}), /servidor SMTP/);
  assert.match(erroDaConfiguracaoSmtp({ smtpHost: 'smtp.x.com', smtpPorta: 'abc' }), /porta/);
  assert.match(erroDaConfiguracaoSmtp({ smtpHost: 'smtp.x.com', smtpPorta: 587 }), /usuário/);
  assert.match(erroDaConfiguracaoSmtp({ smtpHost: 'smtp.x.com', smtpPorta: 587, smtpUsuario: 'a@x.com' }), /senha/);
  assert.equal(erroDaConfiguracaoSmtp({ smtpHost: 'smtp.x.com', smtpPorta: 587, smtpUsuario: 'a@x.com', smtpSenha: 'segredo' }), null);
});

test('transporte: 465 usa SSL direto, 587 usa STARTTLS, e a escolha explícita vence', () => {
  const base = { smtpHost: ' smtp.x.com ', smtpUsuario: 'a@x.com', smtpSenha: 's' };
  assert.equal(opcoesDoTransporte({ ...base, smtpPorta: 465 }).secure, true);
  assert.equal(opcoesDoTransporte({ ...base, smtpPorta: 587 }).secure, false);
  assert.equal(opcoesDoTransporte({ ...base, smtpPorta: 587, smtpSeguro: true }).secure, true);
  assert.equal(opcoesDoTransporte({ ...base, smtpPorta: 465 }).host, 'smtp.x.com');
  assert.deepEqual(opcoesDoTransporte({ ...base, smtpPorta: 465 }).auth, { user: 'a@x.com', pass: 's' });
});

test('erro do SMTP vira mensagem clara e nunca vaza texto de biblioteca', () => {
  assert.match(traduzirErroSmtp({ code: 'EAUTH', responseCode: 535, message: 'Invalid login' }), /usuário ou a senha/);
  assert.match(traduzirErroSmtp({ code: 'ETIMEDOUT', message: 'Connection timeout' }), /conectar no servidor de e-mail/);
  assert.match(traduzirErroSmtp({ code: 'EENVELOPE', message: 'No recipients' }), /e-mail do cliente/);
  assert.match(traduzirErroSmtp({ responseCode: 552, response: '552 message size exceeds' }), /grande demais/);
  assert.match(traduzirErroSmtp({ responseCode: 421, response: '421 try later' }), /Tente de novo/);
  assert.doesNotMatch(traduzirErroSmtp(new Error('getaddrinfo weird internal')), /getaddrinfo/);
});

test('mensagem: assunto com tipo, número e empresa; corpo cita a chave e o e-mail para resposta; HTML escapa nome', () => {
  const m = montarMensagem({ empresaNome: 'SOL <LIFE> & CIA', empresaEmail: 'contato@sol.com', tipo: 'NF-e', numero: 1234, chave: '3526', clienteNome: 'JOAO' });
  assert.equal(m.assunto, 'NF-e nº 1234 — SOL <LIFE> & CIA');
  assert.match(m.texto, /Olá, JOAO!/);
  assert.match(m.texto, /Chave de acesso: 3526/);
  assert.match(m.texto, /contato@sol\.com/);
  assert.doesNotMatch(m.html, /<LIFE>/);
  assert.match(m.html, /SOL &lt;LIFE&gt; &amp; CIA/);
  assert.equal(montarMensagem({ empresaNome: 'X', empresaEmail: 'a@x.com', tipo: 'NF-e' }).assunto, 'NF-e — X');
});

test('nome do anexo: só letras, números e a ponta da chave', () => {
  assert.equal(nomeDoAnexo('NF-e', 1234, '35260912345678901234567890123456789012345678', 'pdf'), 'NFe-1234-12345678.pdf');
  assert.equal(nomeDoAnexo('NF-e', null, null, 'xml'), 'NFe.xml');
});
