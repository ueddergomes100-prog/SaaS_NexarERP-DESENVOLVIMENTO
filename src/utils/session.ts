const SESSION_STORAGE_KEY = 'nexus_session_id';

/**
 * Identificador do APARELHO -- nao da sessao.
 *
 * A sessao morre quando a janela fecha (fica em sessionStorage, e o Firebase
 * Auth usa browserSessionPersistence). Este id NAO: vive no localStorage e
 * sobrevive a fechar o PWA, reiniciar o Windows ou faltar luz.
 *
 * Pra que serve: quando alguem fecha o PWA no X e abre de novo, a sessao
 * anterior pode ter ficado pendurada no servidor (o aviso de fechamento nem
 * sempre chega -- ver `endSessionOnBackend`). Sabendo que a sessao pendurada
 * e' DESTE MESMO aparelho, o login assume ela sem perguntar nada. O alerta de
 * "conta ativa em outro aparelho" continua inteiro pro caso que ele existe
 * pra cobrir: a conta aberta em OUTRA maquina.
 */
const DEVICE_STORAGE_KEY = 'nexus_device_id';

export const createSessionId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const randomValues = new Uint32Array(4);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(randomValues);
  }

  const randomPart = Array.from(randomValues)
    .map(value => value.toString(36).padStart(7, '0'))
    .join('');

  return `${Date.now().toString(36)}-${randomPart || Math.random().toString(36).slice(2)}`;
};

export const getStoredSessionId = () => {
  const sessionValue = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (sessionValue) {
    return sessionValue;
  }

  return localStorage.getItem(SESSION_STORAGE_KEY);
};

export const setStoredSessionId = (sessionId: string) => {
  sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId);
  localStorage.removeItem(SESSION_STORAGE_KEY);
};

export const clearStoredSessionId = () => {
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
  localStorage.removeItem(SESSION_STORAGE_KEY);
};

/**
 * Id do aparelho, criado na primeira vez e guardado pra sempre. Nunca e'
 * apagado no logout: ele identifica a MAQUINA, nao quem esta usando ela.
 *
 * Navegador com armazenamento bloqueado (aba anonima restrita, politica de
 * empresa) devolve '' -- e ai tudo se comporta como antes, com o alerta de
 * sessao ativa aparecendo. Preferivel a quebrar o login.
 */
export const getDeviceId = (): string => {
  try {
    const salvo = localStorage.getItem(DEVICE_STORAGE_KEY);
    if (salvo) return salvo;

    const novo = createSessionId();
    localStorage.setItem(DEVICE_STORAGE_KEY, novo);
    return novo;
  } catch {
    return '';
  }
};
