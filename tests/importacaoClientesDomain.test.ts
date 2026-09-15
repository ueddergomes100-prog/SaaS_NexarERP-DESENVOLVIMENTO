import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ehConsumidorFinal,
  inferirMapeamentoColunasCliente,
  interpretarDocumento,
  interpretarEndereco,
  montarClienteImportado,
  processarLinhasClientes,
  removerPrefixoCodigoAntigo,
  type ClienteParaImportar,
  type MapeamentoColunasCliente,
} from '../src/utils/importacaoClientesDomain';

test('removerPrefixoCodigoAntigo tira codigo numerico colado no INICIO do nome', () => {
  const comPrefixo = removerPrefixoCodigoAntigo('5254 CONDOMINIO IMPERIAALLEE');
  assert.equal(comPrefixo.nomeLimpo, 'CONDOMINIO IMPERIAALLEE');
  assert.equal(comPrefixo.prefixoRemovido, '5254');

  const umDigito = removerPrefixoCodigoAntigo('1 IGREJA BATISTA DO CALVARIO');
  assert.equal(umDigito.nomeLimpo, 'IGREJA BATISTA DO CALVARIO');
  assert.equal(umDigito.prefixoRemovido, '1');
});

test('removerPrefixoCodigoAntigo NAO mexe em numero que faz parte do nome de verdade', () => {
  const meio = removerPrefixoCodigoAntigo('AGROPECAS 3 IRMAOS LTDA -WILLIAN LAVIOLA');
  assert.equal(meio.nomeLimpo, 'AGROPECAS 3 IRMAOS LTDA -WILLIAN LAVIOLA');
  assert.equal(meio.prefixoRemovido, null);

  const fim = removerPrefixoCodigoAntigo('GESSE AVELINO 2214');
  assert.equal(fim.nomeLimpo, 'GESSE AVELINO 2214');
  assert.equal(fim.prefixoRemovido, null);

  const semNumero = removerPrefixoCodigoAntigo('T R SILVA');
  assert.equal(semNumero.nomeLimpo, 'T R SILVA');
  assert.equal(semNumero.prefixoRemovido, null);
});

test('interpretarDocumento aceita CPF/CNPJ com mascara e em branco', () => {
  assert.deepEqual(interpretarDocumento('064.397.856-99'), { documentoLimpo: '06439785699', status: 'OK', motivo: '' });
  assert.deepEqual(interpretarDocumento('57.191.490/0001-78'), { documentoLimpo: '57191490000178', status: 'OK', motivo: '' });
  assert.deepEqual(interpretarDocumento(''), { documentoLimpo: '', status: 'OK', motivo: '' });
});

test('interpretarDocumento sinaliza REVISAR quando a quantidade de digitos nao bate', () => {
  const invalido = interpretarDocumento('123.456');
  assert.equal(invalido.status, 'REVISAR');
  assert.equal(invalido.documentoLimpo, '123456');
});

test('interpretarEndereco separa "rua, numero, bairro - cidade" (formato real da planilha)', () => {
  const r = interpretarEndereco('CORREGO GAMELEIRA , S/N, CENTRO - LUISBURGO');
  assert.deepEqual(r, { rua: 'CORREGO GAMELEIRA', numero: 'S/N', bairro: 'CENTRO', cidade: 'LUISBURGO', status: 'OK', motivo: '' });
});

test('interpretarEndereco ignora virgula repetida solta (sobra de formatacao da fonte)', () => {
  const r = interpretarEndereco('RUA CANDIDO CERQUEIRA,,, 40, BAIXADA - MANHUAÇU');
  assert.equal(r.status, 'OK');
  assert.equal(r.rua, 'RUA CANDIDO CERQUEIRA');
  assert.equal(r.numero, '40');
  assert.equal(r.bairro, 'BAIXADA');
  assert.equal(r.cidade, 'MANHUAÇU');
});

test('interpretarEndereco fica REVISAR quando nao acha "bairro - cidade" no fim', () => {
  const r = interpretarEndereco('AVENIDA ROQUE PORCARO, 14, CENTRO');
  assert.equal(r.status, 'REVISAR');
  assert.equal(r.rua, 'AVENIDA ROQUE PORCARO');
  assert.equal(r.numero, '14');
  assert.equal(r.bairro, 'CENTRO');
  assert.equal(r.cidade, '');
});

test('interpretarEndereco fica REVISAR quando o endereco nao tem 3 partes separadas por virgula', () => {
  const semVirgula = interpretarEndereco('CENTRO - MANHUACU');
  assert.equal(semVirgula.status, 'REVISAR');
});

test('interpretarEndereco em branco e OK (sem endereco na planilha nao e' + ' erro)', () => {
  assert.deepEqual(interpretarEndereco(''), { rua: '', numero: '', bairro: '', cidade: '', status: 'OK', motivo: '' });
});

test('ehConsumidorFinal identifica o registro padrao do sistema, ignorando maiusculas/espacos nas pontas', () => {
  assert.equal(ehConsumidorFinal('CONSUMIDOR FINAL'), true);
  assert.equal(ehConsumidorFinal('  consumidor final  '), true);
  assert.equal(ehConsumidorFinal('CONSUMIDOR FINAL LTDA'), false);
});

test('inferirMapeamentoColunasCliente reconhece cabecalho em portugues', () => {
  const m = inferirMapeamentoColunasCliente(['NOME CLIENTE OU RAZAO SOCIAL', 'CPF OU CNPJ', 'Endereço', 'Telefone']);
  assert.equal(m.nome, 0);
  assert.equal(m.documento, 1);
  assert.equal(m.endereco, 2);
  assert.equal(m.telefone, 3);
});

test('inferirMapeamentoColunasCliente corrige a coluna de Nome quando o cabecalho aponta pra uma coluna sistematicamente vazia (celula mesclada na planilha original -- caso real Shopping Rural)', () => {
  const cabecalho = ['NOME CLIENTE OU RAZAO SOCIAL ', '', 'CPF OU CNPJ', 'Endereço', '', 'Telefone', ''];
  const linhasAmostra = [
    ['', 'ADEMAR LAITANO', '', '', '', '', ''],
    ['', 'ADRIANO MEDRADO DE JESUS - REVENDA', '064.397.856-99', 'CORREGO GAMELEIRA , S/N, CENTRO - LUISBURGO', '', '0339993456', ''],
    ['', 'AGROCON', '', '', '', '', ''],
  ];
  const m = inferirMapeamentoColunasCliente(cabecalho, linhasAmostra);
  assert.equal(m.nome, 1);
  assert.equal(m.documento, 2);
  assert.equal(m.endereco, 3);
  assert.equal(m.telefone, 5);
});

test('inferirMapeamentoColunasCliente NAO corrige quando a coluna de Nome do cabecalho ja vem preenchida na maioria das linhas', () => {
  const cabecalho = ['Nome', 'CPF', 'Endereço', 'Telefone'];
  const linhasAmostra = [
    ['JOAO DA SILVA', '', '', ''],
    ['MARIA SOUZA', '', '', ''],
    ['', '', '', ''],
  ];
  const m = inferirMapeamentoColunasCliente(cabecalho, linhasAmostra);
  assert.equal(m.nome, 0);
});

// Os dois tipos abaixo cresceram muito (planilha da Sol Natus trouxe DDD
// separado, endereco de cobranca e de entrega). Estas bases existem pra que
// cada teste continue declarando SO o campo que ele esta exercitando.
const MAPEAMENTO_VAZIO: MapeamentoColunasCliente = {
  nome: 0, documento: null, fantasia: null, identidade: null,
  telefoneDdd: null, telefone: null, celularDdd: null, celular: null,
  email: null, emailNfe: null,
  endereco: null, numero: null, bairro: null, cidade: null, estado: null, cep: null, referencia: null,
  enderecoCobranca: null, numeroCobranca: null, bairroCobranca: null,
  cidadeCobranca: null, estadoCobranca: null, cepCobranca: null,
  enderecoEntrega: null, numeroEntrega: null, bairroEntrega: null,
  cidadeEntrega: null, estadoEntrega: null, cepEntrega: null, referenciaEntrega: null,
  dtUltimaCompra: null,
};

const CLIENTE_VAZIO: ClienteParaImportar = {
  codigo: '', nome: '', documento: '', fantasia: '', identidade: '',
  telefone: '', celular: '', email: '', emailNfe: '',
  endereco: '', numero: '', bairro: '', cidade: '', estado: '', cep: '', referencia: '',
  enderecoCobranca: '', numeroCobranca: '', bairroCobranca: '',
  cidadeCobranca: '', estadoCobranca: '', cepCobranca: '',
  enderecoEntrega: '', numeroEntrega: '', bairroEntrega: '',
  cidadeEntrega: '', estadoEntrega: '', cepEntrega: '', referenciaEntrega: '',
  dtUltimaCompra: '', codigoIbge: '',
};

test('processarLinhasClientes ignora linha em branco e a linha "CONSUMIDOR FINAL" (ja existe por padrao no sistema)', () => {
  const mapeamento = { ...MAPEAMENTO_VAZIO, nome: 1, documento: 2, endereco: 3, telefone: 5 };
  const linhas = [
    ['', '', '', '', '', '', ''],
    ['', '5254 CONDOMINIO IMPERIAALLEE', '', '', '', '', ''],
    ['', 'CONSUMIDOR FINAL', '', '', '', '', ''],
    ['', 'ADRIANO MEDRADO DE JESUS - REVENDA', '064.397.856-99', 'CORREGO GAMELEIRA , S/N, CENTRO - LUISBURGO', '', '0339993456', ''],
  ];
  const resultado = processarLinhasClientes(linhas, mapeamento);
  assert.equal(resultado.length, 2);
  assert.equal(resultado[0].nome, 'CONDOMINIO IMPERIAALLEE');
  assert.equal(resultado[0].prefixoCodigoRemovido, '5254');
  assert.equal(resultado[1].nome, 'ADRIANO MEDRADO DE JESUS - REVENDA');
  assert.equal(resultado[1].documento, '06439785699');
  assert.equal(resultado[1].endereco, 'CORREGO GAMELEIRA');
  assert.equal(resultado[1].bairro, 'CENTRO');
  assert.equal(resultado[1].cidade, 'LUISBURGO');
  assert.equal(resultado[1].telefone, '0339993456');
  assert.equal(resultado[1].status, 'OK');
});

test('montarClienteImportado grava sem chave undefined e sem inventar dado', () => {
  const doc = montarClienteImportado(
    { ...CLIENTE_VAZIO, codigo: '12', nome: 'joao da silva' },
    'tenant-1',
    'user-1',
    'TS',
  );
  assert.equal(doc.codigo, '12');
  assert.equal(doc.nome, 'JOAO DA SILVA');
  assert.equal(doc.documento, '');
  assert.equal(doc.limiteDeCredito, null);
  assert.equal(doc.tenantId, 'tenant-1');
  assert.ok(!Object.values(doc).includes(undefined));
});
