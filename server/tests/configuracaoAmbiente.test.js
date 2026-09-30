const test = require('node:test');
const assert = require('node:assert/strict');
const { diagnosticoConfiguracao, pendenciasDeProducao, trustProxyHops, emProducao } = require('../services/configuracaoAmbiente');

test('diagnostico so diz presenca, nunca o valor', () => {
  const env = {
    NODE_ENV: 'production',
    FIREBASE_SERVICE_ACCOUNT_BASE64: 'eyJ...',
    BACKUP_ENCRYPTION_KEY: 'segredo-longo',
    ONBOARDING_CODE_SECRET: 'x',
    RESEND_API_KEY: 're_123',
    EMAIL_FROM: 'Hennder <cadastro@exemplo.com>',
    SPEDY_WEBHOOK_SECRET: 'w',
    CORS_ORIGINS: 'https://accounts.nexarcompany.com.br',
    TRUST_PROXY_HOPS: '1',
  };
  const diag = diagnosticoConfiguracao(env);
  assert.deepEqual(diag, {
    ambiente: 'production',
    credencialFirebase: true,
    backupCriptografado: true,
    onboardingSecret: true,
    emailOnboarding: true,
    webhookSpedy: true,
    corsRestrito: true,
    proxyHops: 1,
  });
  assert.ok(!JSON.stringify(diag).includes('segredo-longo'));
  assert.deepEqual(pendenciasDeProducao(diag), []);
});

test('variavel em branco conta como ausente; pendencias saem em portugues, backup primeiro depois da credencial', () => {
  const diag = diagnosticoConfiguracao({ NODE_ENV: 'production', BACKUP_ENCRYPTION_KEY: '   ', FIREBASE_CLIENT_EMAIL: 'a@b', FIREBASE_PRIVATE_KEY: 'k' });
  assert.equal(diag.credencialFirebase, true);
  assert.equal(diag.backupCriptografado, false);
  const pendencias = pendenciasDeProducao(diag);
  assert.match(pendencias[0], /BACKUP_ENCRYPTION_KEY/);
  assert.ok(pendencias.some((p) => p.includes('ONBOARDING_CODE_SECRET')));
  assert.ok(pendencias.some((p) => p.includes('E-mail do cadastro')));
  assert.ok(pendencias.some((p) => p.includes('SPEDY_WEBHOOK_SECRET')));
  assert.ok(pendencias.some((p) => p.includes('CORS_ORIGINS')));
});

test('e-mail so conta como configurado com a chave E o remetente', () => {
  assert.equal(diagnosticoConfiguracao({ RESEND_API_KEY: 'x' }).emailOnboarding, false);
  assert.equal(diagnosticoConfiguracao({ SENDGRID_API_KEY: 'x', EMAIL_FROM: 'a@b.c' }).emailOnboarding, true);
});

test('trust proxy: padrao 1, aceita 0, ignora lixo', () => {
  assert.equal(trustProxyHops({}), 1);
  assert.equal(trustProxyHops({ TRUST_PROXY_HOPS: '0' }), 0);
  assert.equal(trustProxyHops({ TRUST_PROXY_HOPS: '2' }), 2);
  assert.equal(trustProxyHops({ TRUST_PROXY_HOPS: 'abc' }), 1);
  assert.equal(trustProxyHops({ TRUST_PROXY_HOPS: '-1' }), 1);
  assert.equal(emProducao({ NODE_ENV: 'production' }), true);
  assert.equal(emProducao({}), false);
});
