const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assinarV4,
  caminhoExterno,
  codificarCaminho,
  configuracaoDoExterno,
  copiarParaOExterno,
  montarEnvio,
  sha256Hex,
} = require('../services/backupExterno');

/*
 * Copia externa do backup (12/11/2026). A assinatura e' conferida contra o
 * exemplo oficial da AWS ("Signature Calculations for the Authorization
 * Header", PUT Object): se a nossa conta bate com a deles, qualquer
 * armazenamento compativel com S3 aceita o envio.
 */

const AWS = {
  chaveId: 'AKIAIOSFODNN7EXAMPLE',
  chaveSecreta: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  regiao: 'us-east-1',
  quando: '20130524T000000Z',
};

test('assinatura V4: PUT do exemplo oficial da AWS', () => {
  const hashDoCorpo = sha256Hex('Welcome to Amazon S3.');
  assert.equal(hashDoCorpo, '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072');
  const { assinatura, authorization } = assinarV4({
    metodo: 'PUT',
    caminhoCodificado: `/${codificarCaminho('test$file.text')}`,
    cabecalhos: {
      Date: 'Fri, 24 May 2013 00:00:00 GMT',
      Host: 'examplebucket.s3.amazonaws.com',
      'x-amz-content-sha256': hashDoCorpo,
      'x-amz-date': AWS.quando,
      'x-amz-storage-class': 'REDUCED_REDUNDANCY',
    },
    hashDoCorpo,
    ...AWS,
  });
  assert.equal(assinatura, '98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
  assert.equal(
    authorization,
    'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class,Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd',
  );
});

test('assinatura V4: GET do exemplo oficial da AWS (corpo vazio, cabecalho range)', () => {
  const hashDoCorpo = sha256Hex('');
  assert.equal(hashDoCorpo, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  const { assinatura } = assinarV4({
    metodo: 'GET',
    caminhoCodificado: '/test.txt',
    cabecalhos: {
      Host: 'examplebucket.s3.amazonaws.com',
      Range: 'bytes=0-9',
      'x-amz-content-sha256': hashDoCorpo,
      'x-amz-date': AWS.quando,
    },
    hashDoCorpo,
    ...AWS,
  });
  assert.equal(assinatura, 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
});

test('caminho: codifica como a AWS exige e preserva as barras', () => {
  assert.equal(codificarCaminho('test$file.text'), 'test%24file.text');
  assert.equal(codificarCaminho("pasta/arq (1)*'!.gz"), 'pasta/arq%20%281%29%2A%27%21.gz');
  assert.equal(codificarCaminho('backups/empresa_abc_loja_demo/backup_2026-11-12_02-00.json.gz'), 'backups/empresa_abc_loja_demo/backup_2026-11-12_02-00.json.gz');
});

const ENV = {
  BACKUP_EXTERNO_ENDPOINT: 'https://s3.us-west-004.backblazeb2.com/',
  BACKUP_EXTERNO_REGIAO: 'us-west-004',
  BACKUP_EXTERNO_BUCKET: 'hennder-backups',
  BACKUP_EXTERNO_CHAVE_ID: 'id',
  BACKUP_EXTERNO_CHAVE_SECRETA: 'segredo',
};

test('configuracao: so liga com tudo preenchido e endereco https; prefixo e opcional', () => {
  assert.equal(configuracaoDoExterno({}), null);
  assert.equal(configuracaoDoExterno({ ...ENV, BACKUP_EXTERNO_CHAVE_SECRETA: ' ' }), null);
  assert.equal(configuracaoDoExterno({ ...ENV, BACKUP_EXTERNO_ENDPOINT: 'http://inseguro.exemplo' }), null);
  const c = configuracaoDoExterno({ ...ENV, BACKUP_EXTERNO_PREFIXO: '/producao/' });
  assert.equal(c.endpoint, 'https://s3.us-west-004.backblazeb2.com');
  assert.equal(c.prefixo, 'producao');
  assert.equal(caminhoExterno(c, 'backups/x/arq.gz'), 'producao/backups/x/arq.gz');
  assert.equal(caminhoExterno(configuracaoDoExterno(ENV), 'backups/x/arq.gz'), 'backups/x/arq.gz');
});

test('envio: PUT no estilo endpoint/bucket/caminho, com o hash do arquivo e a assinatura; o segredo nao viaja', () => {
  const corpo = Buffer.from('arquivo cifrado');
  const envio = montarEnvio(configuracaoDoExterno(ENV), 'backups/empresa_x/backup.json.gz', corpo, new Date('2026-11-12T05:00:00.000Z'));
  assert.equal(envio.url, 'https://s3.us-west-004.backblazeb2.com/hennder-backups/backups/empresa_x/backup.json.gz');
  assert.equal(envio.headers.host, 's3.us-west-004.backblazeb2.com');
  assert.equal(envio.headers['x-amz-date'], '20261112T050000Z');
  assert.equal(envio.headers['x-amz-content-sha256'], sha256Hex(corpo));
  assert.match(envio.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=id\/20261112\/us-west-004\/s3\/aws4_request,SignedHeaders=host;x-amz-content-sha256;x-amz-date,Signature=[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(envio).includes('segredo'), false);
});

test('copia externa: sem configuracao nao tenta nada e nao e erro', async () => {
  assert.deepEqual(await copiarParaOExterno('backups/x/arq.gz', Buffer.from('a'), {}), { status: 'nao_configurado' });
});
