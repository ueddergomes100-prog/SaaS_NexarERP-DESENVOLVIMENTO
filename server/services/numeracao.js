/*
 * NUMERACAO DOS DOCUMENTOS (Configuracoes por filial, fase C -- 2026-10-07).
 * Regras em src/utils/numeracaoDomain.ts (compilado em server/domain).
 *
 * Le o ultimo numero de cada sequencia da filial (documento novo da
 * sequencia, campo legado e maior numero gravado na colecao, quando a
 * consulta tem indice) e deixa o dono/administrador ADIANTAR a sequencia.
 * Nunca volta: numero de documento ja' emitido nao pode se repetir.
 */
const { db, admin } = require('../config/firebase');
const regras = require('../domain/numeracaoDomain');

class ErroNumeracao extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const agora = () => admin.firestore.FieldValue.serverTimestamp();
const refSequencia = (tenantId, chave) => db.collection('contadores').doc(tenantId).collection('sequencias').doc(chave);

const exigirGestor = (user) => {
  if (user.isPlatformAdmin || user.isTenantManager) return;
  throw new ErroNumeracao(403, 'Só o dono ou um administrador da empresa altera a numeração dos documentos.');
};

/** Maior numero gravado na colecao (0 quando a consulta nao tem indice ou falha). */
const maiorGravado = async (tenantId, sequencia) => {
  try {
    const snap = await db.collection(sequencia.colecao)
      .where('tenantId', '==', tenantId)
      .orderBy(sequencia.campo, 'desc')
      .limit(1)
      .get();
    return snap.empty ? 0 : regras.lerValorDeSequencia(snap.docs[0].data()[sequencia.campo]);
  } catch {
    return 0;
  }
};

const situacaoDe = async (tenantId, sequencia, legado) => {
  const [seqSnap, gravado] = await Promise.all([refSequencia(tenantId, sequencia.chave).get(), maiorGravado(tenantId, sequencia)]);
  const dados = seqSnap.exists ? seqSnap.data() : {};
  const ultimo = regras.ultimoNumeroUsado(dados.valor, legado[sequencia.chave], gravado);
  return {
    chave: sequencia.chave,
    rotulo: sequencia.rotulo,
    ultimo,
    proximo: ultimo + 1,
    ajustadoPor: dados.ajustadoPorNome || null,
    ajustadoEm: dados.ajustadoEm && typeof dados.ajustadoEm.toDate === 'function' ? dados.ajustadoEm.toDate().toISOString() : null,
  };
};

/** Todas as sequencias da filial em que o usuario esta. */
const listarNumeracao = async ({ user }) => {
  exigirGestor(user);
  const tenantId = user.tenantId;
  const legadoSnap = await db.collection('contadores').doc(tenantId).get();
  const legado = legadoSnap.exists ? legadoSnap.data() : {};
  const sequencias = await Promise.all(regras.SEQUENCIAS_DE_DOCUMENTOS.map((s) => situacaoDe(tenantId, s, legado)));
  return { tenantId, sequencias };
};

/** Adianta uma sequencia para que o PROXIMO documento saia com o numero pedido. */
const ajustarNumeracao = async ({ user, chave, proximo, nomeUsuario }) => {
  exigirGestor(user);
  const tenantId = user.tenantId;
  const sequencia = regras.sequenciaPelaChave(chave);
  if (!sequencia) throw new ErroNumeracao(400, 'Documento desconhecido. Atualize a tela e tente de novo.');

  const legadoSnap = await db.collection('contadores').doc(tenantId).get();
  const legado = legadoSnap.exists ? legadoSnap.data() : {};
  const antes = await situacaoDe(tenantId, sequencia, legado);
  const validacao = regras.validarNovoProximo(proximo, antes.ultimo, sequencia.rotulo);
  if (!validacao.ok) throw new ErroNumeracao(400, validacao.erro);

  // Dentro da transacao, confere de novo: alguem pode ter emitido um documento
  // entre a tela abrir e o clique.
  const ref = refSequencia(tenantId, sequencia.chave);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const atual = snap.exists ? regras.lerValorDeSequencia(snap.data().valor) : 0;
    if (validacao.valorDaSequencia < Math.max(atual, antes.ultimo)) {
      throw new ErroNumeracao(409, `Enquanto você ajustava, a numeração de ${sequencia.rotulo.toLowerCase()} avançou para ${Math.max(atual, antes.ultimo)}. Atualize a tela e informe um número maior.`);
    }
    tx.set(ref, {
      tenantId,
      chave: sequencia.chave,
      valor: validacao.valorDaSequencia,
      updatedAt: agora(),
      ajustadoPor: user.uid,
      ajustadoPorNome: nomeUsuario,
      ajustadoEm: agora(),
      ajustadoDe: antes.ultimo,
    }, { merge: true });
  });

  return { antes: antes.ultimo, agora: validacao.valorDaSequencia, proximo: validacao.valorDaSequencia + 1, rotulo: sequencia.rotulo };
};

module.exports = { ErroNumeracao, listarNumeracao, ajustarNumeracao };
