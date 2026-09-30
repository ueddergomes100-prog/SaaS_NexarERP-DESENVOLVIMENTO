/**
 * Sonda do Firestore pro /health.
 *
 * O /health antigo respondia 200 com o Admin SDK sem credencial (incidente de
 * 2026-08-27): "online" nao dizia se o banco estava acessivel. Agora uma
 * leitura minima (`system_alerts`, 1 documento no maximo) prova o caminho
 * inteiro: credencial, rede e Firestore. Resultado guardado por 30 s pra um
 * monitor externo batendo a cada minuto custar ~1 leitura por minuto.
 */
const INTERVALO_CACHE_MS = 30 * 1000;
const TEMPO_LIMITE_MS = 3 * 1000;

let ultimaSonda = { em: 0, resultado: null };

const sondar = async (db, timeoutMs) => {
  if (!db) {
    return { ok: false, motivo: 'Admin SDK sem credencial (ver variáveis FIREBASE_* no painel).' };
  }
  let timer;
  const limite = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Firestore não respondeu em ${Math.round(timeoutMs / 1000)} s.`)), timeoutMs);
  });
  try {
    await Promise.race([db.collection('system_alerts').limit(1).get(), limite]);
    return { ok: true };
  } catch (erro) {
    return { ok: false, motivo: erro.message };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Estado do Firestore, com cache. `db` e' injetavel pra teste; `opcoes.agora`
 * e `opcoes.timeoutMs` idem.
 */
const estadoDoFirestore = async (db, opcoes = {}) => {
  const agora = opcoes.agora ?? Date.now();
  const timeoutMs = opcoes.timeoutMs ?? TEMPO_LIMITE_MS;
  if (ultimaSonda.resultado && agora - ultimaSonda.em < INTERVALO_CACHE_MS) {
    return ultimaSonda.resultado;
  }
  const resultado = await sondar(db, timeoutMs);
  ultimaSonda = { em: agora, resultado };
  return resultado;
};

const limparCacheDaSonda = () => {
  ultimaSonda = { em: 0, resultado: null };
};

module.exports = { estadoDoFirestore, limparCacheDaSonda, INTERVALO_CACHE_MS, TEMPO_LIMITE_MS };
