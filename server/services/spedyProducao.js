/**
 * PASSAR A EMPRESA DO SANDBOX PARA A PRODUCAO DA SPEDY (07/11/2026, pedido do
 * dono: "passar uma conta para ambiente producao na spedy").
 *
 * Sandbox e producao sao sistemas separados na Spedy (enderecos diferentes):
 * a empresa criada no sandbox nao existe na producao. Antes a janela do
 * painel da plataforma travava o ambiente ("pra trocar de ambiente, e' um
 * cadastro novo") sem ter como fazer esse cadastro novo.
 *
 * Passar = cadastrar a empresa na producao com a chave mestra de producao e
 * os dados atuais de Configuracoes (mesmo payload do cadastro inicial) e
 * trocar, num lote so', a chave, o id e o ambiente desta empresa no sistema.
 * Certificado digital e numeracao sao da empresa na Spedy: na producao comecam
 * vazios, entao o que o sistema guardava do sandbox (validade do certificado,
 * serie/proximo numero) sai, para a tela nao mostrar dado de teste como se
 * fosse o da producao. A Spedy recusou ou nao devolveu a chave: nada muda aqui.
 */
const { db, admin } = require('../config/firebase');
const { buildCompanyPayload } = require('./spedyEmpresa');
const { fetchComTimeout, PERFIS } = require('../utils/fetchComTimeout');

const URL_PRODUCAO = 'https://api.spedy.com.br/v1';

const erro = (status, mensagem) => {
  const e = new Error(mensagem);
  e.status = status;
  return e;
};

/** O que falta em Configuracoes para a Spedy aceitar o cadastro da empresa (null = nada). */
const problemaParaCadastrarNaSpedy = (config) => {
  if (!config.cnpj || String(config.cnpj).replace(/\D/g, '').length !== 14) {
    return 'Esta empresa não tem um CNPJ válido cadastrado em Configurações. Cadastre o CNPJ antes de continuar.';
  }
  // A Spedy exige cidade (codigo IBGE) no endereco, mesmo a doc dizendo que e' opcional.
  if (!config.nfseCidadeCodigo) {
    return 'Esta empresa não tem cidade cadastrada para a Spedy. Vá em Configurações → Nota Fiscal (Spedy), busque e selecione a cidade antes de cadastrar a empresa.';
  }
  return null;
};

const passarParaProducao = async ({ tenantId, uid }) => {
  if (!tenantId) throw erro(400, 'Informe a empresa.');
  const configRef = db.collection('configuracoes').doc(tenantId);
  const [configSnap, masterSnap] = await Promise.all([
    configRef.get(),
    db.collection('plataforma').doc('spedy').get(),
  ]);
  if (!configSnap.exists) throw erro(404, 'Configurações desta empresa não foram encontradas.');
  const config = configSnap.data();
  if (config.spedyEnvironment === 'production') {
    throw erro(400, 'Esta empresa já está no ambiente de produção da Spedy.');
  }
  if (!config.spedyCompanyId) {
    throw erro(400, 'Esta empresa ainda não foi cadastrada na Spedy. Escolha o ambiente Produção e use "Cadastrar empresa na Spedy".');
  }
  const problema = problemaParaCadastrarNaSpedy(config);
  if (problema) throw erro(400, problema);
  const master = masterSnap.exists ? masterSnap.data() : {};
  if (!master.masterApiKeyProducao) {
    throw erro(400, 'A chave mestra da Spedy de produção ainda não foi configurada. Cadastre a chave no painel da plataforma, em Chave mestra da Spedy, e tente de novo.');
  }

  const resposta = await fetchComTimeout(`${URL_PRODUCAO}/companies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': master.masterApiKeyProducao },
    body: JSON.stringify(buildCompanyPayload(config)),
  }, PERFIS.spedyCadastro);
  if (!resposta.ok) {
    const corpo = await resposta.json().catch(() => ({}));
    const motivo = String(corpo.errors?.[0]?.message || corpo.error || corpo.title || '').trim();
    const comPonto = motivo && !/[.!?]$/.test(motivo) ? `${motivo}.` : motivo;
    throw erro(resposta.status, `A Spedy recusou o cadastro em produção${comPonto ? `: ${comPonto}` : '.'} Nada foi alterado nesta empresa.`);
  }
  const corpo = await resposta.json().catch(() => ({}));
  const empresa = corpo.result || corpo;
  const apiKey = empresa.apiCredentials?.apiKey;
  if (!apiKey || !empresa.id) {
    throw erro(502, 'A Spedy não devolveu a chave da empresa em produção. Confira no painel da Spedy, em Empresas: se a empresa aparecer lá, cole a chave de produção em Configurações → Nota Fiscal (Spedy) e escolha o ambiente Produção. Nada foi alterado nesta empresa.');
  }

  const agora = new Date().toISOString();
  const apagar = () => admin.firestore.FieldValue.delete();
  const lote = db.batch();
  lote.set(db.collection('configuracoes_privadas').doc(tenantId), {
    tenantId,
    spedyApiKey: apiKey,
    atualizadoPor: uid,
    atualizadoEm: agora,
  }, { merge: true });
  lote.set(configRef, {
    spedyEnabled: true,
    spedyEnvironment: 'production',
    spedyApiKeyConfigured: true,
    spedyCompanyId: empresa.id,
    // Eram do sandbox: na producao a empresa comeca sem certificado e sem numeracao.
    spedyCertificadoValidade: apagar(),
    spedyCertificadoStatus: apagar(),
    spedyNumeracao: apagar(),
    atualizadoPor: uid,
    atualizadoEm: agora,
  }, { merge: true });
  await lote.commit();
  return { companyId: empresa.id, environment: 'production' };
};

module.exports = { passarParaProducao, problemaParaCadastrarNaSpedy };
