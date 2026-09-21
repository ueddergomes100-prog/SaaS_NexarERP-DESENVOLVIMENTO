const test = require('node:test');
const assert = require('node:assert/strict');
const {
  avaliarRequisitos,
  mensagemBloqueio,
  validarAmbienteEnviado,
  mesclarConfiguracaoAtual,
} = require('../services/requisitosFiscais');

const AGORA = new Date('2026-09-21T15:00:00Z');
const CONFIG = { cnpj: '07488550000140', inscricaoEstadual: '123456', spedyEnvironment: 'production' };
const CERT_OK = [{ id: 'c1', isActive: true, expirationAt: '2027-06-01T00:00:00Z' }];
const SETTINGS_OK = {
  productInvoice: { environmentType: 'production', series: '1', nextNumber: 10 },
  consumerInvoice: { environmentType: 'production', series: '1', nextNumber: 5, csc: 'ABC', tokenId: '000001' },
};

const avaliar = (parcial) => avaliarRequisitos({ config: CONFIG, settings: SETTINGS_OK, certificados: CERT_OK, agora: AGORA, ...parcial });
const achar = (grupo, id) => grupo.checks.find((c) => c.id === id);

test('tudo em ordem: NF-e e NFC-e prontas, sem pendencia', () => {
  const r = avaliar({});
  assert.equal(r.nfe.pronto, true);
  assert.equal(r.nfce.pronto, true);
  assert.deepEqual(r.ambientes, { nfe: 'production', nfce: 'production' });
  assert.equal(mensagemBloqueio(r.nfe), '');
});

test('o caso real: NF-e sem ambiente ("Ambiente: 0") bloqueia e diz onde resolver', () => {
  const r = avaliar({ settings: { productInvoice: { series: '1', nextNumber: 10 }, consumerInvoice: SETTINGS_OK.consumerInvoice } });
  assert.equal(r.nfe.pronto, false);
  const c = achar(r.nfe, 'nfe_ambiente');
  assert.equal(c.gravidade, 'bloqueio');
  assert.match(c.mensagem, /Ambiente: 0/);
  assert.match(c.comoResolver, /Configurações → Nota Fiscal \(Spedy\)/);
  // a NFC-e tem o proprio ambiente e nao e' afetada
  assert.equal(r.nfce.pronto, true);
  assert.match(mensagemBloqueio(r.nfe), /^• O ambiente da NF-e não está definido/);
});

test('ambiente "simulation" nao serve pra NF-e (so producao ou homologacao)', () => {
  const r = avaliar({ settings: { productInvoice: { environmentType: 'simulation', series: '1', nextNumber: 1 }, consumerInvoice: {} } });
  assert.equal(achar(r.nfe, 'nfe_ambiente').gravidade, 'bloqueio');
});

test('numeracao é automática: sem serie e sem proximo numero NAO bloqueia', () => {
  const r = avaliar({ settings: { productInvoice: { environmentType: 'production', series: '', nextNumber: 0 }, consumerInvoice: SETTINGS_OK.consumerInvoice } });
  assert.equal(achar(r.nfe, 'nfe_numeracao').gravidade, 'ok');
  assert.match(achar(r.nfe, 'nfe_numeracao').mensagem, /automática pela Spedy/);
  assert.equal(r.nfe.pronto, true);
});

test('com numeracao ja definida, mostra serie e proximo numero', () => {
  const r = avaliar({});
  assert.match(achar(r.nfe, 'nfe_numeracao').mensagem, /série 1, próximo número 10/);
});

test('NFC-e sem CSC bloqueia; NF-e nao exige CSC', () => {
  const r = avaliar({ settings: { productInvoice: SETTINGS_OK.productInvoice, consumerInvoice: { environmentType: 'production', series: '1', nextNumber: 1 } } });
  assert.equal(r.nfce.pronto, false);
  assert.equal(achar(r.nfce, 'nfce_csc').gravidade, 'bloqueio');
  assert.equal(r.nfe.pronto, true);
});

test('certificado: ausente e vencido bloqueiam; proximo do vencimento so avisa', () => {
  assert.equal(achar(avaliar({ certificados: [] }).nfe, 'certificado').gravidade, 'bloqueio');
  const vencido = avaliar({ certificados: [{ isActive: true, expirationAt: '2026-08-01T15:00:00Z' }] });
  assert.match(achar(vencido.nfe, 'certificado').mensagem, /venceu em 01\/08\/2026/);
  assert.equal(vencido.nfe.pronto, false);
  const perto = avaliar({ certificados: [{ isActive: true, expirationAt: '2026-10-05T00:00:00Z' }] });
  assert.equal(achar(perto.nfe, 'certificado').gravidade, 'aviso');
  assert.equal(perto.nfe.pronto, true);
  // inativo nao conta
  assert.equal(achar(avaliar({ certificados: [{ isActive: false, expirationAt: '2030-01-01T00:00:00Z' }] }).nfe, 'certificado').gravidade, 'bloqueio');
});

test('empresa em Producao com NF-e em Homologacao avisa (nota sem validade), sem bloquear', () => {
  const r = avaliar({ settings: { productInvoice: { environmentType: 'development', series: '1', nextNumber: 1 }, consumerInvoice: SETTINGS_OK.consumerInvoice } });
  assert.equal(achar(r.nfe, 'nfe_ambiente').gravidade, 'aviso');
  assert.match(achar(r.nfe, 'nfe_ambiente').mensagem, /SEM validade fiscal/);
  assert.equal(r.nfe.pronto, true);
});

test('Spedy sandbox com NF-e em Producao avisa da incoerencia', () => {
  const r = avaliarRequisitos({ config: { ...CONFIG, spedyEnvironment: 'sandbox' }, settings: SETTINGS_OK, certificados: CERT_OK, agora: AGORA });
  assert.equal(achar(r.nfe, 'nfe_ambiente').gravidade, 'aviso');
  assert.match(achar(r.nfe, 'nfe_ambiente').mensagem, /sandbox/);
});

test('Spedy ilegivel: itens dependentes ficam "desconhecido" e NUNCA bloqueiam', () => {
  const r = avaliar({ settings: null, certificados: null });
  assert.equal(r.nfe.pronto, true);
  for (const id of ['certificado', 'nfe_ambiente', 'nfe_numeracao']) {
    assert.equal(achar(r.nfe, id).situacao, 'desconhecido', id);
  }
});

test('cadastro da empresa: sem CNPJ bloqueia; sem IE so avisa', () => {
  const semCnpj = avaliar({ config: { ...CONFIG, cnpj: '123' } });
  assert.equal(achar(semCnpj.nfe, 'empresa_cnpj').gravidade, 'bloqueio');
  const semIe = avaliar({ config: { ...CONFIG, inscricaoEstadual: '' } });
  assert.equal(achar(semIe.nfe, 'empresa_ie').gravidade, 'aviso');
  assert.equal(semIe.nfe.pronto, true);
});

test('so producao e desenvolvimento passam na validacao do ambiente enviado', () => {
  assert.equal(validarAmbienteEnviado(undefined), true);
  assert.equal(validarAmbienteEnviado('production'), true);
  assert.equal(validarAmbienteEnviado('development'), true);
  assert.equal(validarAmbienteEnviado('simulation'), false);
  assert.equal(validarAmbienteEnviado('homologacao'), false);
  assert.equal(validarAmbienteEnviado(''), false);
});

test('Spedy sem proximo numero e ultima nota autorizada por aqui: avisa e sugere ultimo + 1', () => {
  const r = avaliar({
    settings: { productInvoice: { environmentType: 'production' }, consumerInvoice: SETTINGS_OK.consumerInvoice },
    ultimoNumeroAutorizado: { nfe: 41 },
  });
  const c = achar(r.nfe, 'nfe_numeracao');
  assert.equal(c.gravidade, 'aviso');
  assert.match(c.mensagem, /sem próximo número definido.*nº 41/);
  assert.match(c.comoResolver, /próximo número 42/);
  assert.equal(r.sugestaoProximoNumero.nfe, 42);
  // aviso nao bloqueia
  assert.equal(r.nfe.pronto, true);
});

test('Spedy ja adiante da ultima nota: sem aviso e sem sugestao (numeracao automatica)', () => {
  const r = avaliar({ ultimoNumeroAutorizado: { nfe: 9 } });
  assert.equal(achar(r.nfe, 'nfe_numeracao').gravidade, 'ok');
  assert.equal(r.sugestaoProximoNumero.nfe, null);
});

test('Spedy ATRAS da ultima nota autorizada avisa', () => {
  const r = avaliar({ ultimoNumeroAutorizado: { nfe: 10 } });
  assert.equal(achar(r.nfe, 'nfe_numeracao').gravidade, 'aviso');
  assert.equal(r.sugestaoProximoNumero.nfe, 11);
});

test('salvar so o ambiente NAO apaga serie e numero: o bloco parte da configuracao atual', () => {
  const atual = { productInvoice: { series: '5', nextNumber: 5, environmentType: 'development', danfePrintLayout: 'default' } };
  const r = mesclarConfiguracaoAtual(atual, { productInvoice: { environmentType: 'production' } });
  assert.deepEqual(r.productInvoice, { series: '5', nextNumber: 5, environmentType: 'production', danfePrintLayout: 'default' });
});

test('o que a tela mandou sobrepoe o atual; bloco nao enviado nao entra; NFS-e nunca e reenviada', () => {
  const atual = {
    productInvoice: { series: '5', nextNumber: 5 },
    consumerInvoice: { series: '1', nextNumber: 9, environmentType: 'production' },
    serviceInvoice: { userName: 'x', password: '***' },
  };
  const r = mesclarConfiguracaoAtual(atual, { productInvoice: { nextNumber: 42 } });
  assert.deepEqual(r, { productInvoice: { series: '5', nextNumber: 42 } });
  const s = mesclarConfiguracaoAtual(atual, { serviceInvoice: { series: '2', nextNumber: 3 } });
  assert.deepEqual(s, { serviceInvoice: { series: '2', nextNumber: 3 } });
});

test('sem configuracao atual, manda o que veio', () => {
  assert.deepEqual(mesclarConfiguracaoAtual(null, { productInvoice: { environmentType: 'production' } }), { productInvoice: { environmentType: 'production' } });
});
