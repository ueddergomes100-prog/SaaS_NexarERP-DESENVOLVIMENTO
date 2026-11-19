const { db } = require('../config/firebase');
const { fetchComTimeout, PERFIS } = require('../utils/fetchComTimeout');
const { BASE_URLS } = require('./spedyAcesso');

/**
 * Busca de cidades na Spedy (campo "Cidade da Empresa" de Configuracoes e o
 * preenchimento pelo CNPJ). A lista de cidades e' dado de referencia, nao e'
 * dado fiscal da empresa -- por isso pode ser lida com a chave mestra da
 * plataforma quando a chave da empresa nao serve.
 *
 * Ordem das chaves: a da empresa (se houver), depois a mestra do sandbox e a
 * mestra de producao. Antes (ate' 19/11/2026) a chave da empresa era a unica
 * tentada quando existia: uma empresa nova com um valor qualquer gravado no
 * campo "Spedy API Key" (o navegador preenchia o campo com a senha salva do
 * login) ficava sem conseguir escolher a cidade -- "Erro ao comunicar com a
 * Spedy" -- e sem a cidade nao da' para cadastra'-la na Spedy.
 */
const chavesParaBuscarCidade = async (tenantId) => {
  if (!tenantId) {
    const error = new Error('Não foi possível identificar a empresa desta consulta. Saia do sistema, entre de novo e repita a busca.');
    error.status = 400;
    throw error;
  }

  const [publicSnap, privateSnap, masterSnap] = await Promise.all([
    db.collection('configuracoes').doc(tenantId).get(),
    db.collection('configuracoes_privadas').doc(tenantId).get(),
    db.collection('plataforma').doc('spedy').get(),
  ]);
  const publicConfig = publicSnap.exists ? publicSnap.data() : {};
  const privateConfig = privateSnap.exists ? privateSnap.data() : {};
  const masterData = masterSnap.exists ? masterSnap.data() : {};

  const chaves = [];
  const tenantApiKey = String(privateConfig.spedyApiKey || publicConfig.spedyApiKey || '').trim();
  if (tenantApiKey) {
    const env = publicConfig.spedyEnvironment === 'production' ? 'production' : 'sandbox';
    chaves.push({ apiKey: tenantApiKey, baseUrl: BASE_URLS[env], origem: 'empresa' });
  }
  if (masterData.masterApiKeySandbox) {
    chaves.push({ apiKey: masterData.masterApiKeySandbox, baseUrl: BASE_URLS.sandbox, origem: 'plataforma' });
  }
  if (masterData.masterApiKeyProducao) {
    chaves.push({ apiKey: masterData.masterApiKeyProducao, baseUrl: BASE_URLS.production, origem: 'plataforma' });
  }
  return chaves;
};

const chaveRecusada = (response) => response.status === 401 || response.status === 403;

/**
 * Consulta as cidades e devolve a resposta da Spedy. Chave recusada (401/403)
 * passa para a proxima; qualquer outra resposta -- inclusive erro de dado --
 * volta como veio. Lanca erro em portugues, com `status`, quando nao ha' chave
 * nenhuma ou quando todas foram recusadas.
 */
const buscarCidadesNaSpedy = async ({ tenantId, typePath, filterText, state }) => {
  const chaves = await chavesParaBuscarCidade(tenantId);
  if (chaves.length === 0) {
    const error = new Error('Esta empresa ainda não tem a chave da Spedy configurada, e a chave mestra da plataforma também não foi cadastrada. Peça a um administrador da plataforma para configurar a chave mestra em Administração → Chave mestra da Spedy.');
    error.status = 400;
    throw error;
  }

  const params = new URLSearchParams();
  if (filterText) params.set('filterText', String(filterText));
  if (state) params.set('state', String(state));

  let recusouADaEmpresa = false;
  for (const chave of chaves) {
    const response = await fetchComTimeout(`${chave.baseUrl}/${typePath}/cities?${params.toString()}`, {
      method: 'GET',
      headers: { 'X-Api-Key': chave.apiKey },
    }, PERFIS.spedyLeitura);
    if (!chaveRecusada(response)) return response;
    if (chave.origem === 'empresa') recusouADaEmpresa = true;
  }

  const error = new Error(recusouADaEmpresa && chaves.length === 1
    ? 'A Spedy recusou a chave gravada nesta empresa. Se a empresa ainda não foi cadastrada na Spedy, apague o campo "Spedy API Key" em Configurações → Configuração de Nota Fiscal (Spedy), salve e peça ao suporte para cadastrar a empresa.'
    : 'A Spedy recusou a chave mestra da plataforma. Peça a um administrador da plataforma para conferir a chave em Administração → Chave mestra da Spedy.');
  error.status = 502;
  throw error;
};

module.exports = { chavesParaBuscarCidade, buscarCidadesNaSpedy };
