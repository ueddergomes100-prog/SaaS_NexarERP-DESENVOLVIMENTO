const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  TAMANHO_CHAVE,
  dadosDaChave,
  digitoVerificador,
  erroDeModeloDaChave,
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

const chaveComModelo = (aamm, modelo) => {
  const base = `35${aamm}12345678000199${modelo}001000001234100001234`.slice(0, 43);
  return base + String(digitoVerificador(base));
};
const AGORA = new Date('2026-09-24T12:00:00Z');

test('a chave conta quem emitiu, quando e qual o numero', () => {
  const d = dadosDaChave(chaveComModelo('2609', '55'));
  assert.equal(d.cnpjEmitente, '12345678000199');
  assert.equal(d.ano, 2026);
  assert.equal(d.mes, 9);
  assert.equal(d.modelo, '55');
  assert.equal(d.numero, '1234');
  assert.equal(dadosDaChave('123'), null);
});

test('nao achei, nota recente: cita numero, mes e CNPJ do emitente', () => {
  const m = mensagemNaoEncontrada(chaveComModelo('2609', '55'), AGORA);
  assert.match(m, /nº 1234/);
  assert.match(m, /09\/2026/);
  assert.match(m, /12\.345\.678\/0001-99/);
  assert.match(m, /ainda não apareceu/);
});

test('nao achei, nota com mais de 90 dias: diz que e velha demais e manda para o XML', () => {
  const m = mensagemNaoEncontrada(chaveComModelo('2604', '55'), AGORA);
  assert.match(m, /há mais de 90 dias/);
  assert.match(m, /XML/);
});

test('chave de CT-e ou NFC-e e barrada com explicacao, NF-e normal nao', () => {
  assert.match(erroDeModeloDaChave(chaveComModelo('2609', '57')), /CT-e/);
  assert.match(erroDeModeloDaChave(chaveComModelo('2609', '57')), /Frete/);
  assert.match(erroDeModeloDaChave(chaveComModelo('2609', '65')), /NFC-e/);
  assert.equal(erroDeModeloDaChave(chaveComModelo('2609', '55')), null);
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

// ---------------------------------------------------------------------------
// Lista das notas recebidas + importar com um clique (27/10/2026)
// ---------------------------------------------------------------------------
const recebidas = require('../services/notaRecebida');

test('lista: tipo, periodo e cursor viram a consulta da Spedy (ou erro em portugues)', () => {
  assert.equal(recebidas.tipoRecebida('nfe'), 'nfe');
  assert.equal(recebidas.tipoRecebida('nfse'), 'nfse');
  assert.equal(recebidas.tipoRecebida('cte'), null);
  assert.equal(recebidas.tipoRecebida('constructor'), null);
  const ok = recebidas.consultaDaLista({ de: '2026-10-01', ate: '2026-10-27', cursor: 'abc123==' });
  assert.equal(ok.ok, true);
  // Data E hora (a Spedy le como date-time): o "ate'" vai ate' o fim do dia, senao a nota de hoje nao aparece.
  assert.equal(ok.query, 'limit=50&initialDate=2026-10-01T00%3A00%3A00-03%3A00&endDate=2026-10-27T23%3A59%3A59-03%3A00&cursor=abc123%3D%3D');
  assert.match(recebidas.consultaDaLista({ de: '27/10/2026' }).erro, /inicial/);
  assert.match(recebidas.consultaDaLista({ de: '2026-10-27', ate: '2026-10-01' }).erro, /depois/);
  assert.match(recebidas.consultaDaLista({ cursor: 'a b&c' }).erro, /Página/);
});

test('lista: NF-e sem XML completo pede ciencia; NFS-e sem XML fica indisponivel; cancelada nao importa', () => {
  const chave = '31261012345678000190550010000047111000000010';
  const nfe = recebidas.itemDaListaRecebida({
    id: 'u1', accessKey: chave, isComplete: false, status: 'authorized', issuedOn: '2026-10-20T10:00:00-03:00', amount: 1500.5,
    issuer: { name: 'FORN', legalName: 'FORNECEDOR LTDA', federalTaxNumber: '12.345.678/0001-90' }, manifestation: { status: 'none' },
  }, 'nfe');
  assert.deepEqual(nfe, {
    id: 'u1', tipo: 'nfe', chave, numero: '4711', serie: '1', emitenteNome: 'FORNECEDOR LTDA', emitenteCnpj: '12345678000190',
    emitidaEm: '2026-10-20', valorTotal: 1500.5, descricao: '', situacao: 'ciencia', manifestacao: 'none',
  });
  assert.equal(recebidas.itemDaListaRecebida({ isComplete: true, status: 'authorized' }, 'nfe').situacao, 'pronta');
  assert.equal(recebidas.itemDaListaRecebida({ isComplete: true, status: 'canceled' }, 'nfe').situacao, 'cancelada');
  const nfse = recebidas.itemDaListaRecebida({ id: 'u2', number: 152, isComplete: false, status: 'authorized', serviceDescription: 'Honorários' }, 'nfse');
  assert.equal(nfse.situacao, 'indisponivel');
  assert.equal(nfse.numero, '152');
  assert.equal(nfse.descricao, 'Honorários');
});

test('sincronizar cedo demais: diz quando da para pedir de novo', () => {
  assert.match(recebidas.mensagemDaSincronizacao({ retryAfterSeconds: 290 }), /5 minutos/);
  assert.match(recebidas.mensagemDaSincronizacao({ nextAllowedSyncAt: '2026-10-27T15:01:00Z' }, new Date('2026-10-27T15:00:30Z')), /1 minuto\b/);
  assert.match(recebidas.mensagemDaSincronizacao({}), /alguns minutos/);
});

test('situacao da busca automatica: diz quando foi e, se parou, o porque em portugues', () => {
  const ok = recebidas.situacaoDaSincronizacao({ lastAttemptOutcome: 'upToDate', lastSyncAt: '2026-11-25T14:05:00-03:00' });
  assert.equal(ok.problema, false);
  assert.equal(ok.texto, 'Última busca na SEFAZ: 25/11/2026 às 14:05.');
  const cert = recebidas.situacaoDaSincronizacao({ lastAttemptOutcome: 'certificateMissingOrExpired' });
  assert.equal(cert.problema, true);
  assert.match(cert.texto, /certificado/);
  const sefaz = recebidas.situacaoDaSincronizacao({ lastAttemptOutcome: 'throttledByAuthority', nextAllowedSyncAt: '2026-11-25T15:00:00' });
  assert.equal(sefaz.problema, true);
  assert.match(sefaz.texto, /25\/11\/2026 às 15:00/);
  assert.equal(recebidas.situacaoDaSincronizacao(null).problema, false);
  assert.equal(recebidas.situacaoDaSincronizacao('lixo').texto, '');
});
