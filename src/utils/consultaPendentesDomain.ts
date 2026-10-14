/**
 * De quanto em quanto tempo a tela de NF-e consulta a Spedy sozinha enquanto
 * houver nota pendente (enqueued/processing/created). Regra pura, sem Firestore.
 *
 * Antes era a cada 15 s, sem fim: nota travada em processamento era consultada
 * para sempre, em cada aba aberta -- leituras no servidor a cada chamada e
 * risco de passar do limite da Spedy (60 por minuto por empresa). Agora
 * desacelera conforme a nota pendente MAIS RECENTE envelhece (2026-10-14).
 * O botão "Sincronizar" continua consultando na hora.
 */

export const CONSULTA_PENDENTES_RAPIDA_MS = 15_000;
export const CONSULTA_PENDENTES_MEDIA_MS = 60_000;
export const CONSULTA_PENDENTES_LENTA_MS = 5 * 60_000;

const DOIS_MINUTOS_MS = 2 * 60_000;
const TRINTA_MINUTOS_MS = 30 * 60_000;

/**
 * @param transmitidasEm data da última transmissão de cada nota pendente (ISO
 *   ou vazio). Sem data legível conta como recém-enviada (consulta rápido).
 * @returns intervalo em ms, ou null se não há nota pendente.
 */
export const intervaloConsultaPendentes = (transmitidasEm: Array<string | null | undefined>, agoraMs: number): number | null => {
  if (transmitidasEm.length === 0) return null;
  const idades = transmitidasEm.map((valor) => {
    const ms = valor ? Date.parse(valor) : Number.NaN;
    return Number.isFinite(ms) ? Math.max(0, agoraMs - ms) : 0;
  });
  const maisRecente = Math.min(...idades);
  if (maisRecente < DOIS_MINUTOS_MS) return CONSULTA_PENDENTES_RAPIDA_MS;
  if (maisRecente < TRINTA_MINUTOS_MS) return CONSULTA_PENDENTES_MEDIA_MS;
  return CONSULTA_PENDENTES_LENTA_MS;
};
