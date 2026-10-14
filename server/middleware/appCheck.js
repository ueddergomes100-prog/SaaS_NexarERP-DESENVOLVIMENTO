/**
 * FIREBASE APP CHECK NO SERVIDOR (2026-10-14).
 *
 * Pergunta do dono: "nao podemos sofrer com ataque de hacker ou usuarios
 * maliciosos disparando requisicoes". O limite por IP/chave ja' existe
 * (rateLimit.js); o App Check diz se a chamada veio do NOSSO sistema (o
 * navegador manda um comprovante no cabecalho X-Firebase-AppCheck) ou de um
 * script por fora.
 *
 * Comeca em MODO DE OBSERVACAO: so' marca a requisicao (req.appCheck =
 * 'valido' | 'invalido' | 'ausente', que sai na linha de log) e deixa passar.
 * O bloqueio liga com APP_CHECK_EXIGIR=true, depois de uns dias de log sem
 * 'ausente'/'invalido' vindo de usuario de verdade.
 *
 * Ficam de fora: o webhook da Spedy (servidor da Spedy, nao navegador), o
 * /health (monitor externo) e o encerramento de sessao, que sai no fechamento
 * da pagina por navigator.sendBeacon -- que nao aceita cabecalho; a rota ja'
 * confere o token de login que vai no corpo (utils/sessionInfo.ts).
 */

const ROTAS_SEM_APP_CHECK = ['/spedy-webhook', '/health', '/sessions/end'];

const MENSAGEM_BLOQUEIO = 'Este acesso não veio do sistema Hennder. Atualize a página e tente de novo; se continuar, avise o suporte.';

/**
 * @param {{ verificar: (token: string) => Promise<unknown>, exigir: () => boolean }} deps
 *   verificar: confere o token (admin.appCheck().verifyToken) e rejeita se invalido.
 */
const criarVerificadorAppCheck = ({ verificar, exigir }) => async (req, res, next) => {
  if (ROTAS_SEM_APP_CHECK.some((rota) => req.path.startsWith(rota))) return next();

  const token = String(req.get('X-Firebase-AppCheck') || '').trim();
  if (!token) {
    req.appCheck = 'ausente';
  } else {
    try {
      await verificar(token);
      req.appCheck = 'valido';
    } catch {
      req.appCheck = 'invalido';
    }
  }

  if (exigir() && req.appCheck !== 'valido') {
    return res.status(401).json({ error: MENSAGEM_BLOQUEIO });
  }
  return next();
};

const verificadorAppCheck = () => {
  // eslint-disable-next-line global-require
  const { admin } = require('../config/firebase');
  return criarVerificadorAppCheck({
    verificar: (token) => admin.appCheck().verifyToken(token),
    exigir: () => process.env.APP_CHECK_EXIGIR === 'true',
  });
};

module.exports = { criarVerificadorAppCheck, verificadorAppCheck, ROTAS_SEM_APP_CHECK, MENSAGEM_BLOQUEIO };
