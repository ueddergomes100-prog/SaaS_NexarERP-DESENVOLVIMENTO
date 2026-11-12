const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const {
  assinarV4,
  caminhoExterno,
  codificarCaminho,
  configuracaoDoExterno,
  copiarParaOExterno,
  enviarParaOExterno,
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
  // O host e' assinado, mas quem o envia e' o fetch (pela URL): nao vai na lista de cabecalhos.
  assert.equal('host' in envio.headers, false);
  assert.equal(envio.headers['x-amz-date'], '20261112T050000Z');
  assert.equal(envio.headers['x-amz-content-sha256'], sha256Hex(corpo));
  assert.equal(envio.headers['content-md5'], crypto.createHash('md5').update(corpo).digest('base64'));
  assert.match(envio.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=id\/20261112\/us-west-004\/s3\/aws4_request,SignedHeaders=content-md5;host;x-amz-content-sha256;x-amz-date,Signature=[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(envio).includes('segredo'), false);
});

/**
 * Armazenamento de mentira, na propria maquina: recebe o PUT de verdade e
 * confere a assinatura como um provedor S3 confere -- refazendo a conta com o
 * que CHEGOU (cabecalhos e arquivo). Prova que o que o servidor envia bate com
 * o que ele assinou.
 */
const armazenamentoFalso = (segredo) => new Promise((resolve) => {
  const recebidos = [];
  const servidor = http.createServer((req, res) => {
    const pedacos = [];
    req.on('data', (p) => pedacos.push(p));
    req.on('end', () => {
      const corpo = Buffer.concat(pedacos);
      const m = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request,SignedHeaders=([^,]+),Signature=([0-9a-f]{64})$/.exec(req.headers.authorization || '');
      const assinados = m ? Object.fromEntries(m[4].split(';').map((n) => [n, req.headers[n]])) : {};
      const refeita = m && assinarV4({
        metodo: req.method, caminhoCodificado: req.url, cabecalhos: assinados, hashDoCorpo: sha256Hex(corpo),
        regiao: m[3], chaveId: m[1], chaveSecreta: segredo, quando: req.headers['x-amz-date'],
      }).assinatura;
      const confere = Boolean(m) && refeita === m[5]
        && req.headers['x-amz-content-sha256'] === sha256Hex(corpo)
        && req.headers['content-md5'] === crypto.createHash('md5').update(corpo).digest('base64');
      recebidos.push({ metodo: req.method, caminho: req.url, corpo, confere });
      res.statusCode = confere ? 200 : 403;
      res.end(confere ? '' : '<Error><Code>SignatureDoesNotMatch</Code></Error>');
    });
  });
  servidor.listen(0, '127.0.0.1', () => resolve({ servidor, recebidos, endpoint: `http://127.0.0.1:${servidor.address().port}` }));
});

test('envio de verdade: o armazenamento refaz a assinatura com o que chegou e aceita; com o segredo errado, recusa em portugues', async () => {
  const { servidor, recebidos, endpoint } = await armazenamentoFalso('segredo');
  try {
    const config = { endpoint, regiao: 'us-west-004', bucket: 'hennder-backups', chaveId: 'id', chaveSecreta: 'segredo', prefixo: 'producao' };
    const arquivo = crypto.randomBytes(64 * 1024);
    const caminho = await enviarParaOExterno(config, 'backups/empresa_x_loja/backup_2026-11-12_02-00.json.gz', arquivo);
    assert.equal(caminho, 'producao/backups/empresa_x_loja/backup_2026-11-12_02-00.json.gz');
    assert.equal(recebidos.length, 1);
    assert.equal(recebidos[0].metodo, 'PUT');
    assert.equal(recebidos[0].caminho, '/hennder-backups/producao/backups/empresa_x_loja/backup_2026-11-12_02-00.json.gz');
    assert.equal(recebidos[0].confere, true, 'assinatura refeita pelo armazenamento bate');
    assert.equal(recebidos[0].corpo.equals(arquivo), true, 'o arquivo chegou inteiro');

    await assert.rejects(
      () => enviarParaOExterno({ ...config, chaveSecreta: 'outro' }, 'backups/x/arq.gz', arquivo),
      /recusou o arquivo \(HTTP 403, SignatureDoesNotMatch\).*BACKUP_EXTERNO_/,
    );
  } finally {
    servidor.close();
  }
});

test('copia externa: sem configuracao nao tenta nada e nao e erro', async () => {
  assert.deepEqual(await copiarParaOExterno('backups/x/arq.gz', Buffer.from('a'), {}), { status: 'nao_configurado' });
});
