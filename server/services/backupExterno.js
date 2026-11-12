/**
 * COPIA EXTERNA DO BACKUP (12/11/2026).
 *
 * O backup morava num lugar so': o bucket do MESMO projeto Firebase do banco.
 * Se o projeto fosse comprometido ou apagado, ou se alguem invadisse a
 * hospedagem (que guarda a credencial de administrador do Firebase), banco e
 * backups iam embora juntos. Decisao do dono: toda copia vai tambem para um
 * segundo lugar, em outra conta e outro provedor.
 *
 * Como funciona: depois de gerar o arquivo (ja' compactado e cifrado), o
 * servidor manda o MESMO arquivo para um armazenamento compativel com S3
 * (Backblaze B2, Cloudflare R2, Amazon S3, Wasabi...). O servidor so' GRAVA:
 * nunca lista, le nem apaga la'. A chave cadastrada deve ser "so' gravacao"
 * no provedor -- assim, quem invadir a hospedagem nao consegue apagar as
 * copias externas. A limpeza das copias antigas e' regra do proprio provedor
 * (ciclo de vida do bucket), nao deste codigo.
 *
 * Sem dependencia nova: a assinatura (AWS Signature Version 4) e' feita aqui,
 * com o `crypto` do Node, e conferida nos testes contra o exemplo oficial da
 * documentacao da AWS.
 *
 * Variaveis (todas necessarias para ligar; valores nunca aparecem em log):
 *   BACKUP_EXTERNO_ENDPOINT       ex.: https://s3.us-west-004.backblazeb2.com
 *   BACKUP_EXTERNO_REGIAO         ex.: us-west-004   (R2: auto)
 *   BACKUP_EXTERNO_BUCKET         nome do bucket
 *   BACKUP_EXTERNO_CHAVE_ID       id da chave de acesso
 *   BACKUP_EXTERNO_CHAVE_SECRETA  segredo da chave de acesso
 *   BACKUP_EXTERNO_PREFIXO        opcional: pasta dentro do bucket
 */
const crypto = require('crypto');
const { fetchComTimeout } = require('../utils/fetchComTimeout');

/** Arquivo da empresa inteira: espera mais que uma chamada comum. */
const CONTROLE_DO_ENVIO = { timeoutMs: 180000, servico: 'O armazenamento externo de backup' };

const texto = (v) => String(v || '').trim();

/** Configuracao lida do ambiente; null = copia externa desligada (falta alguma variavel). */
const configuracaoDoExterno = (env = process.env) => {
  const endpoint = texto(env.BACKUP_EXTERNO_ENDPOINT).replace(/\/+$/, '');
  const config = {
    endpoint,
    regiao: texto(env.BACKUP_EXTERNO_REGIAO),
    bucket: texto(env.BACKUP_EXTERNO_BUCKET),
    chaveId: texto(env.BACKUP_EXTERNO_CHAVE_ID),
    chaveSecreta: texto(env.BACKUP_EXTERNO_CHAVE_SECRETA),
    prefixo: texto(env.BACKUP_EXTERNO_PREFIXO).replace(/^\/+|\/+$/g, ''),
  };
  if (!config.endpoint || !config.regiao || !config.bucket || !config.chaveId || !config.chaveSecreta) return null;
  if (!/^https:\/\//i.test(config.endpoint)) return null;
  return config;
};

const externoConfigurado = (env = process.env) => configuracaoDoExterno(env) !== null;

// --- AWS Signature Version 4 ------------------------------------------------

const sha256Hex = (dado) => crypto.createHash('sha256').update(dado).digest('hex');
const hmac = (chave, dado) => crypto.createHmac('sha256', chave).update(dado, 'utf8').digest();

/** Codifica um trecho do caminho como a AWS exige: tudo menos A-Z a-z 0-9 - _ . ~ */
const codificarTrecho = (trecho) => encodeURIComponent(trecho).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const codificarCaminho = (caminho) => caminho.split('/').map(codificarTrecho).join('/');

/** "20130524T000000Z" */
const dataAmz = (data) => data.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

/**
 * Assina uma requisicao. `cabecalhos` sao TODOS os que entram na assinatura
 * (host, x-amz-date, x-amz-content-sha256...). Devolve a assinatura e o valor
 * pronto do cabecalho Authorization.
 */
const assinarV4 = ({ metodo, caminhoCodificado, consulta = '', cabecalhos, hashDoCorpo, regiao, servico = 's3', chaveId, chaveSecreta, quando }) => {
  const nomes = Object.keys(cabecalhos).map((n) => n.toLowerCase()).sort();
  const porNome = Object.fromEntries(Object.entries(cabecalhos).map(([n, v]) => [n.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')]));
  const canonicos = nomes.map((n) => `${n}:${porNome[n]}\n`).join('');
  const assinados = nomes.join(';');
  const requisicaoCanonica = [metodo, caminhoCodificado, consulta, canonicos, assinados, hashDoCorpo].join('\n');
  const dia = quando.slice(0, 8);
  const escopo = `${dia}/${regiao}/${servico}/aws4_request`;
  const textoParaAssinar = ['AWS4-HMAC-SHA256', quando, escopo, sha256Hex(requisicaoCanonica)].join('\n');
  const chaveDeAssinatura = hmac(hmac(hmac(hmac(`AWS4${chaveSecreta}`, dia), regiao), servico), 'aws4_request');
  const assinatura = crypto.createHmac('sha256', chaveDeAssinatura).update(textoParaAssinar, 'utf8').digest('hex');
  return {
    assinatura,
    authorization: `AWS4-HMAC-SHA256 Credential=${chaveId}/${escopo},SignedHeaders=${assinados},Signature=${assinatura}`,
  };
};

/** Monta o PUT assinado de um arquivo (endereco no estilo "endpoint/bucket/caminho"). */
const montarEnvio = (config, caminhoNoBucket, corpo, agora = new Date()) => {
  const url = new URL(config.endpoint);
  const caminho = `/${codificarCaminho(`${config.bucket}/${caminhoNoBucket}`)}`;
  const hashDoCorpo = sha256Hex(corpo);
  const quando = dataAmz(agora);
  const cabecalhos = {
    host: url.host,
    'x-amz-content-sha256': hashDoCorpo,
    'x-amz-date': quando,
  };
  const { authorization } = assinarV4({
    metodo: 'PUT', caminhoCodificado: caminho, cabecalhos, hashDoCorpo,
    regiao: config.regiao, chaveId: config.chaveId, chaveSecreta: config.chaveSecreta, quando,
  });
  return {
    url: `${url.origin}${caminho}`,
    headers: { ...cabecalhos, Authorization: authorization, 'Content-Type': 'application/octet-stream' },
  };
};

/** Caminho do arquivo dentro do bucket externo (mesma arvore do bucket principal). */
const caminhoExterno = (config, caminhoPrincipal) => (config.prefixo ? `${config.prefixo}/${caminhoPrincipal}` : caminhoPrincipal);

/**
 * Manda o arquivo (ja' cifrado) para o armazenamento externo. Devolve o
 * caminho gravado. Lanca erro em portugues se o provedor recusar.
 */
const enviarParaOExterno = async (config, caminhoPrincipal, corpo) => {
  const caminho = caminhoExterno(config, caminhoPrincipal);
  const { url, headers } = montarEnvio(config, caminho, corpo);
  const resposta = await fetchComTimeout(url, { method: 'PUT', headers, body: corpo }, CONTROLE_DO_ENVIO);
  if (!resposta.ok) {
    const detalhe = (await resposta.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
    const codigo = (/<Code>([^<]+)<\/Code>/.exec(detalhe) || [])[1] || '';
    throw new Error(`O armazenamento externo recusou o arquivo (HTTP ${resposta.status}${codigo ? `, ${codigo}` : ''}). Confira o bucket, a região e a chave de acesso (BACKUP_EXTERNO_*).`);
  }
  return caminho;
};

/**
 * Copia externa de um backup: nunca lanca. Devolve o que vai gravado no
 * historico (`externo`): { status: 'nao_configurado' | 'enviado' | 'erro', ... }.
 */
const copiarParaOExterno = async (caminhoPrincipal, corpo, env = process.env) => {
  const config = configuracaoDoExterno(env);
  if (!config) return { status: 'nao_configurado' };
  try {
    const caminho = await enviarParaOExterno(config, caminhoPrincipal, corpo);
    return { status: 'enviado', caminho, enviadoEm: new Date().toISOString() };
  } catch (erro) {
    console.error('[Backup externo] Falha ao enviar a cópia externa:', erro.message);
    return { status: 'erro', erro: String(erro.message || erro).slice(0, 400), tentativaEm: new Date().toISOString() };
  }
};

module.exports = {
  configuracaoDoExterno,
  externoConfigurado,
  assinarV4,
  montarEnvio,
  caminhoExterno,
  enviarParaOExterno,
  copiarParaOExterno,
  codificarCaminho,
  sha256Hex,
};
