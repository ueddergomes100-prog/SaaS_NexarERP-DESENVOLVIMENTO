const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  TAMANHO_CHAVE,
  digitoVerificador,
  mensagemDeFalha,
  mensagemNaoEncontrada,
  resumoDaNota,
  situacaoDaNota,
  somenteDigitos,
  validarChaveAcesso,
} = require('../services/notaRecebida');

const BASE43 = '3526090512345678000199570010000012341000012';
const chaveValida = () => {
  const base = (BASE43 + '3').slice(0, 43);
  return base + String(digitoVerificador(base));
};

test('chave valida passa', () => {
  const r = validarChaveAcesso(chaveValida());
  assert.equal(r.ok, true);
  assert.equal(r.chave.length, TAMANHO_CHAVE);
  assert.equal(r.erro, null);
});

test('chave vazia pede a chave', () => {
  assert.match(validarChaveAcesso('').erro, /44 números/);
  assert.match(validarChaveAcesso(null).erro, /44 números/);
});

test('chave curta diz quantos numeros vieram', () => {
  const r = validarChaveAcesso('123456');
  assert.equal(r.ok, false);
  assert.match(r.erro, /6/);
});

test('chave com digito trocado e recusada', () => {
  const chave = chaveValida();
  const ruim = chave.slice(0, 10) + (chave[10] === '7' ? '6' : '7') + chave.slice(11);
  assert.equal(validarChaveAcesso(ruim).ok, false);
  assert.match(validarChaveAcesso(ruim).erro, /não confere/);
});

test('chave colada com espacos e pontos e aceita', () => {
  const chave = chaveValida();
  assert.equal(validarChaveAcesso(chave.replace(/(\d{4})/g, '$1 ')).ok, true);
  assert.equal(somenteDigitos('35.26 09/05'), '35260905');
});

test('nota com XML completo esta pronta pra importar', () => {
  assert.deepEqual(situacaoDaNota({ isComplete: true, status: 'Authorized' }), { situacao: 'pronta', motivo: null });
});

test('nota sem XML completo exige manifestacao, e o motivo explica por que', () => {
  const r = situacaoDaNota({ isComplete: false, status: 'Authorized' });
  assert.equal(r.situacao, 'manifestar');
  assert.match(r.motivo, /Ciência da Operação/i);
});

test('nota cancelada ou denegada nao entra', () => {
  assert.equal(situacaoDaNota({ status: 'Canceled' }).situacao, 'cancelada');
  assert.match(situacaoDaNota({ status: 'Canceled' }).motivo, /CANCELADA/);
  assert.equal(situacaoDaNota({ status: 'Denied' }).situacao, 'cancelada');
  assert.match(situacaoDaNota({ status: 'Denied' }).motivo, /DENEGADA/);
});

test('cancelada ganha da falta de XML: nao adianta manifestar nota cancelada', () => {
  assert.equal(situacaoDaNota({ status: 'Canceled', isComplete: false }).situacao, 'cancelada');
});

test('sem nota nenhuma, a situacao e nao encontrada', () => {
  assert.equal(situacaoDaNota(null).situacao, 'nao_encontrada');
  assert.equal(situacaoDaNota(undefined).situacao, 'nao_encontrada');
});

test('resumo pega os campos que a tela mostra, sem quebrar com campo ausente', () => {
  const r = resumoDaNota({
    id: 'abc', number: 13199, series: '1',
    issuer: { name: 'ZEZO LTDA', federalTaxNumber: '11.222.333/0001-81' },
    issuedAt: '2026-09-20T10:00:00Z', totalAmount: 1873.71, accessKey: chaveValida(),
  });
  assert.equal(r.numero, '13199');
  assert.equal(r.emitenteNome, 'ZEZO LTDA');
  assert.equal(r.emitenteCnpj, '11222333000181');
  assert.equal(r.valorTotal, 1873.71);
  assert.equal(r.chave.length, 44);

  const vazio = resumoDaNota({});
  assert.equal(vazio.numero, '');
  assert.equal(vazio.valorTotal, 0);
});

test('a mensagem de "nao achei" explica os 90 dias e o CNPJ', () => {
  const m = mensagemNaoEncontrada();
  assert.match(m, /90 dias/);
  assert.match(m, /CNPJ/);
  assert.match(m, /XML/);
});

test('falha por plano sem o recurso diz onde ativar', () => {
  assert.match(mensagemDeFalha(402, {}), /Notas recebidas/);
  assert.match(mensagemDeFalha(400, { message: 'feature not enabled' }), /Notas recebidas/);
});

test('falha de credencial aponta a tela de configuracao', () => {
  assert.match(mensagemDeFalha(401, {}), /chave de API/i);
  assert.match(mensagemDeFalha(403, {}), /chave de API/i);
});

test('limite de requisicoes pede pra esperar', () => {
  assert.match(mensagemDeFalha(429, {}), /alguns minutos/);
});

test('erro desconhecido nao vaza texto tecnico vazio', () => {
  assert.match(mensagemDeFalha(500, {}), /Tente novamente/);
});
