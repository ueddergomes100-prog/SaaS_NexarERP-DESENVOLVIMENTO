const { admin, db } = require('../config/firebase');

/*
 * ENCERRAR A SESSAO DE ALGUEM (seguranca, bloco B, 25/11/2026).
 *
 * Antes nada derrubava quem ja' tinha entrado: trocar a senha ou o PIN,
 * inativar o usuario ou desativar o computador do caixa so' valia para a
 * PROXIMA entrada. Agora, nesses casos:
 *
 *  1. `auth.revokeRefreshTokens(uid)`: o Firebase deixa de renovar o login.
 *     O que ja' foi emitido (dura ate' 1 hora) ainda abre o banco ate' vencer;
 *  2. `usuarios/{uid}.sessaoValidaApos`: o servidor (middleware/auth.js) recusa
 *     NA HORA todo login feito antes desse instante -- a pessoa entra de novo.
 *
 * Nunca derruba a operacao que chamou: falha aqui so' vai para o log.
 */

const lerUids = (uids) => [...new Set((Array.isArray(uids) ? uids : [uids])
  .map((u) => String(u || '').trim())
  .filter((u) => u && !u.includes('/')))];

/** Encerra as sessoes de cada uid. Devolve quantas foram encerradas. */
async function encerrarSessoes(uids, motivo = '') {
  const lista = lerUids(uids);
  let encerradas = 0;
  for (const uid of lista) {
    // A marca usa o horario do PROPRIO Firebase (tokensValidAfterTime, o mesmo
    // relogio do auth_time do login), nao o do servidor: relogio do servidor
    // adiantado recusaria quem acabou de entrar de novo (revisao de 25/11).
    let marcaMs = Date.now();
    try {
      await admin.auth().revokeRefreshTokens(uid);
      const conta = await admin.auth().getUser(uid).catch(() => null);
      const doFirebase = conta && conta.tokensValidAfterTime ? Date.parse(conta.tokensValidAfterTime) : NaN;
      if (Number.isFinite(doFirebase)) marcaMs = doFirebase;
    } catch (erro) {
      // Cadastro sem conta no login (vendedor de balcao que nunca entrou): nada a encerrar no Auth.
      if (!erro || erro.code !== 'auth/user-not-found') {
        console.warn(`[Sessoes] nao foi possivel encerrar o login de ${uid} (${motivo}):`, erro && erro.message);
        continue;
      }
    }
    try {
      await db.collection('usuarios').doc(uid).update({ sessaoValidaApos: admin.firestore.Timestamp.fromMillis(marcaMs) });
      encerradas += 1;
    } catch (erro) {
      console.warn(`[Sessoes] nao foi possivel marcar o fim da sessao de ${uid} (${motivo}):`, erro && erro.message);
    }
  }
  return encerradas;
}

/** O login (instante da entrada, em segundos) foi feito antes de a sessao ser encerrada? */
const sessaoEncerrada = (perfil, authTimeSegundos) => {
  const marca = perfil && perfil.sessaoValidaApos;
  const marcaMs = marca && typeof marca.toMillis === 'function' ? marca.toMillis() : (marca instanceof Date ? marca.getTime() : 0);
  if (!marcaMs) return false;
  return Number(authTimeSegundos || 0) * 1000 < marcaMs;
};

module.exports = { encerrarSessoes, sessaoEncerrada };
