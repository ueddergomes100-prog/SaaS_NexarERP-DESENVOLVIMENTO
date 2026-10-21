/*
 * INUTILIZACAO DE NUMERACAO (NF-e / NFC-e) PELO SERVIDOR (21/10/2026).
 *
 * A tela pede (modelo, serie, faixa, motivo); aqui:
 *  - a regra de src/utils/inutilizacaoDomain.ts confere o pedido;
 *  - numero que ja' e' de nota autorizada/cancelada/denegada do sistema e'
 *    recusado antes de ir para a Spedy (nao se inutiliza numero usado);
 *  - faixa ja' inutilizada (ou em processamento) nao vai de novo;
 *  - a Spedy faz o pedido a SEFAZ e o resultado fica em `inutilizacoes`,
 *    colecao so' do servidor (as rules negam tudo; a tela le por aqui).
 */
const { admin, db } = require('../config/firebase');
const { loadSpedyConfig, idSpedyValido } = require('./spedyAcesso');
const { fetchComTimeout, PERFIS } = require('../utils/fetchComTimeout');
const inu = require('../domain/inutilizacaoDomain');

class ErroInutilizacao extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const COLECAO = 'inutilizacoes';
const agora = () => admin.firestore.FieldValue.serverTimestamp();

/** Mensagem de erro da Spedy (vem em `errors[0].message`), ou a padrao. */
const erroDaSpedy = (dados, padrao) => (dados && Array.isArray(dados.errors) && dados.errors[0] && dados.errors[0].message) || (dados && dados.error) || padrao;

/** O que fica gravado do resultado da Spedy. */
const camposDoResultado = (r) => ({
  spedyId: String(r.id || ''),
  status: inu.lerStatusInutilizacao(r.status),
  protocolo: r.protocolNumber ? String(r.protocolNumber) : null,
  codigoSefaz: r.messageCode ? String(r.messageCode) : null,
  mensagemSefaz: r.messageText ? String(r.messageText) : null,
  ambiente: r.environment ? String(r.environment) : null,
});

const lerRegistradas = async (tenantId) => {
  const snap = await db.collection(COLECAO).where('tenantId', '==', tenantId).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

const solicitar = async ({ user, tenantId, corpo }) => {
  const lido = inu.lerPedidoDeInutilizacao(corpo);
  if ('erro' in lido) throw new ErroInutilizacao(400, lido.erro);
  const pedido = lido.pedido;
  const { apiKey, baseUrl } = await loadSpedyConfig(tenantId);

  // Numero ja' usado por nota do sistema: nao vai para a SEFAZ.
  const notasSnap = await db.collection('notas_fiscais')
    .where('tenantId', '==', tenantId)
    .where('tipo', '==', inu.ROTULO_DO_MODELO[pedido.modelo])
    .get();
  const usadas = inu.notasQueUsamAFaixa(notasSnap.docs.map((d) => d.data()), pedido);
  if (usadas.length > 0) throw new ErroInutilizacao(409, inu.mensagemDeNumeroUsado(usadas, pedido.modelo));

  const jaCobre = inu.faixaQueJaCobre(await lerRegistradas(tenantId), pedido);
  if (jaCobre) {
    throw new ErroInutilizacao(409, `A ${inu.ROTULO_DO_MODELO[pedido.modelo]} série ${pedido.serie} ${inu.textoDaFaixa(Number(jaCobre.inicial), Number(jaCobre.final))} já foi inutilizada (ou está em processamento). Confira a lista de inutilizações.`);
  }

  const resposta = await fetchComTimeout(`${baseUrl}/${inu.CAMINHO_NA_SPEDY[pedido.modelo]}/disablements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
    body: JSON.stringify({ series: pedido.serie, initialNumber: pedido.inicial, finalNumber: pedido.final, reason: pedido.motivo }),
  }, PERFIS.spedyEmissao);
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new ErroInutilizacao(resposta.status === 429 ? 429 : 400, erroDaSpedy(dados, 'A Spedy recusou o pedido de inutilização. Confira a série e a faixa e tente de novo.'));
  }

  const ref = db.collection(COLECAO).doc();
  const registro = {
    tenantId,
    modelo: pedido.modelo,
    serie: pedido.serie,
    inicial: pedido.inicial,
    final: pedido.final,
    motivo: pedido.motivo,
    ...camposDoResultado(dados),
    solicitadoPor: user.uid,
    solicitadoPorNome: user.nome || user.email || '',
    createdAt: agora(),
    updatedAt: agora(),
  };
  await ref.set(registro);
  return { id: ref.id, ...registro, createdAt: null, updatedAt: null };
};

/** Busca na Spedy a situacao atual (para a que ficou "em processamento"). */
const consultar = async ({ tenantId, id }) => {
  const ref = db.collection(COLECAO).doc(String(id || ''));
  const snap = await ref.get();
  if (!snap.exists || snap.data().tenantId !== tenantId) throw new ErroInutilizacao(404, 'Inutilização não encontrada. Atualize a lista.');
  const atual = snap.data();
  if (!idSpedyValido(atual.spedyId)) throw new ErroInutilizacao(400, 'Esta inutilização não tem o código da Spedy para consultar.');
  const { apiKey, baseUrl } = await loadSpedyConfig(tenantId);
  const modelo = atual.modelo === 'nfce' ? 'nfce' : 'nfe';
  const resposta = await fetchComTimeout(`${baseUrl}/${inu.CAMINHO_NA_SPEDY[modelo]}/disablements/${atual.spedyId}`, {
    method: 'GET',
    headers: { 'X-Api-Key': apiKey },
  }, PERFIS.spedyLeitura);
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new ErroInutilizacao(resposta.status === 429 ? 429 : 502, erroDaSpedy(dados, 'Não foi possível consultar a inutilização na Spedy agora. Tente de novo em instantes.'));
  const campos = { ...camposDoResultado({ ...dados, id: dados.id || atual.spedyId }), updatedAt: agora() };
  await ref.update(campos);
  return { id: ref.id, ...atual, ...campos, createdAt: null, updatedAt: null };
};

/** Inutilizacoes da empresa, mais novas primeiro. */
const listar = async ({ tenantId }) => {
  const lista = await lerRegistradas(tenantId);
  const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : 0);
  return lista
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt))
    .slice(0, 100)
    .map((r) => ({ ...r, criadoEmMs: ms(r.createdAt), createdAt: null, updatedAt: null }));
};

module.exports = { ErroInutilizacao, solicitar, consultar, listar };
