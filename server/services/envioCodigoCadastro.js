/**
 * Estado do e-mail com o codigo de verificacao do cadastro.
 *
 * Por que existe (incidente de 2026-11-23, producao): o Gmail devolveu o
 * primeiro envio de um cliente ("Recipient not found"), o Resend pos o
 * endereco na lista de bloqueio (Suppressions) e, dali em diante, o
 * `POST /emails` continuou respondendo 200 para cada novo envio -- que o
 * Resend marcava como "Suppressed" sem mandar nada. A tela seguia dizendo
 * "Enviamos o codigo" e o cliente ficou esperando um e-mail que nunca ia
 * chegar. O 200 do envio so' quer dizer "pedido aceito", nao "entregue".
 *
 * O que fazemos: guardamos o `id` que o `POST /emails` devolve e, alguns
 * segundos depois, a tela pergunta o estado (rota /status-envio). Aqui a
 * pergunta vira `GET https://api.resend.com/emails/{id}` e o `last_event`
 * do Resend vira um dos nossos cinco estados.
 *
 * Documentacao conferida em 2026-11-23:
 *  - resend.com/docs/api-reference/emails/retrieve-email (campo `last_event`)
 *  - resend.com/docs/dashboard/emails/manage-emails (lista dos eventos)
 *  - resend.com/docs/api-reference/errors (401 `restricted_api_key`)
 *
 * ATENCAO -- permissao da chave: chave do Resend criada como "Sending
 * access" SO' envia; o GET responde 401 `restricted_api_key`. Nesse caso o
 * estado fica 'desconhecido' (a tela se comporta como antes) e o servidor
 * avisa no log. Para a verificacao funcionar, RESEND_API_KEY precisa ser
 * "Full access".
 *
 * Nada aqui lanca erro: a consulta e' um aviso a mais para o usuario, nunca
 * um motivo para o cadastro parar.
 */
const { fetchComTimeout, PERFIS } = require('../utils/fetchComTimeout');

const ESTADO_ENVIO = Object.freeze({
  ENTREGUE: 'entregue',
  A_CAMINHO: 'a_caminho',
  DEVOLVIDO: 'devolvido',
  BLOQUEADO: 'bloqueado',
  DESCONHECIDO: 'desconhecido',
});

// `last_event` do Resend -> nosso estado.
//  - complained: chegou (o destinatario marcou como spam depois) -- entregue.
//  - delivery_delayed: falha temporaria, o Resend insiste por ate' 14 h e so'
//    entao marca bounced -- para nos ainda esta a caminho.
//  - failed: o Resend nao conseguiu enviar. Para o usuario o caminho e' o
//    mesmo do devolvido (conferir o endereco / usar outro / suporte).
//  - canceled/scheduled nao acontecem aqui (nao agendamos envio); se
//    aparecerem, caem em 'desconhecido' / 'a_caminho' sem alarmar ninguem.
const ESTADO_POR_EVENTO = Object.freeze({
  delivered: ESTADO_ENVIO.ENTREGUE,
  opened: ESTADO_ENVIO.ENTREGUE,
  clicked: ESTADO_ENVIO.ENTREGUE,
  complained: ESTADO_ENVIO.ENTREGUE,
  sent: ESTADO_ENVIO.A_CAMINHO,
  queued: ESTADO_ENVIO.A_CAMINHO,
  scheduled: ESTADO_ENVIO.A_CAMINHO,
  delivery_delayed: ESTADO_ENVIO.A_CAMINHO,
  bounced: ESTADO_ENVIO.DEVOLVIDO,
  failed: ESTADO_ENVIO.DEVOLVIDO,
  suppressed: ESTADO_ENVIO.BLOQUEADO,
});

const estadoDoEventoResend = (evento) => {
  const chave = String(evento || '').trim().toLowerCase();
  return ESTADO_POR_EVENTO[chave] || ESTADO_ENVIO.DESCONHECIDO;
};

/** Estado que nao muda mais para aquele envio: pode ser guardado no cadastro
 *  pendente para a proxima pergunta nem ir ao Resend. */
const estadoDeEnvioEhFinal = (estado) => (
  estado === ESTADO_ENVIO.ENTREGUE
  || estado === ESTADO_ENVIO.DEVOLVIDO
  || estado === ESTADO_ENVIO.BLOQUEADO
);

/** So' o que a tela pode saber: o estado. Nunca endereco, assunto ou corpo. */
const respostaPublicaDoEnvio = (estado) => ({
  ok: true,
  estado: Object.values(ESTADO_ENVIO).includes(estado) ? estado : ESTADO_ENVIO.DESCONHECIDO,
});

const MOTIVO = Object.freeze({
  SEM_ID: 'sem_id',
  SEM_CHAVE: 'sem_chave',
  CHAVE_SEM_PERMISSAO: 'chave_sem_permissao',
  NAO_ENCONTRADO: 'nao_encontrado',
  LIMITE: 'limite_do_provedor',
  FALHA: 'falha_na_consulta',
});

const desconhecido = (motivo) => ({ estado: ESTADO_ENVIO.DESCONHECIDO, motivo });

/**
 * Pergunta ao Resend o estado de um envio.
 *
 * @param {string} envioId id devolvido pelo `POST /emails`
 * @param {{ apiKey?: string, buscar?: Function }} [opcoes] `buscar` existe para o teste
 * @returns {Promise<{ estado: string, motivo?: string }>} nunca rejeita
 */
const consultarEnvioNoResend = async (envioId, { apiKey = process.env.RESEND_API_KEY, buscar = fetchComTimeout } = {}) => {
  const id = String(envioId || '').trim();
  if (!id) return desconhecido(MOTIVO.SEM_ID);
  if (!apiKey) return desconhecido(MOTIVO.SEM_CHAVE);

  try {
    const response = await buscar(`https://api.resend.com/emails/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    }, PERFIS.email);

    if (response.status === 401 || response.status === 403) return desconhecido(MOTIVO.CHAVE_SEM_PERMISSAO);
    if (response.status === 404) return desconhecido(MOTIVO.NAO_ENCONTRADO);
    if (response.status === 429) return desconhecido(MOTIVO.LIMITE);
    if (!response.ok) return desconhecido(MOTIVO.FALHA);

    const data = await response.json().catch(() => ({}));
    return { estado: estadoDoEventoResend(data && data.last_event) };
  } catch {
    return desconhecido(MOTIVO.FALHA);
  }
};

module.exports = {
  ESTADO_ENVIO,
  MOTIVO_ESTADO_DESCONHECIDO: MOTIVO,
  estadoDoEventoResend,
  estadoDeEnvioEhFinal,
  respostaPublicaDoEnvio,
  consultarEnvioNoResend,
};
