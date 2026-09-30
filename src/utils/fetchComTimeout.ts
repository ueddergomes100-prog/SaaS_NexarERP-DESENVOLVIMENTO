/**
 * `fetch` com tempo limite.
 *
 * Ate 2026-09-30 nenhuma chamada ao backend tinha timeout: com o servidor
 * fora do ar ou uma nota presa na Spedy, a tela ficava em "Transmitindo..."
 * pra sempre, sem dizer nada. Agora toda chamada desiste depois de um tempo
 * e o erro que sobe ja' diz, em portugues, o que aconteceu.
 *
 * Nao e' modulo de dominio puro (usa fetch/AbortController do navegador),
 * entao fica fora do harness de testes de dominio.
 */

export const TEMPO_LIMITE = {
  /** Consulta e gravacao comuns. */
  padrao: 30_000,
  /** Emitir nota: a Spedy valida o XML e pode esperar a SEFAZ antes de responder. */
  emissaoNota: 120_000,
  /** PDF/XML de nota, certificado: arquivo maior, mas ainda pequeno. */
  arquivo: 90_000,
  /** Gerar/baixar/restaurar backup: a empresa inteira. */
  backup: 300_000,
} as const;

export class TimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number, mensagem?: string) {
    const segundos = Math.max(1, Math.round(timeoutMs / 1000));
    super(mensagem ?? `O servidor demorou mais de ${segundos} segundos para responder. Confira sua conexão e tente de novo.`);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export const isTimeoutError = (erro: unknown): erro is TimeoutError => (
  erro instanceof TimeoutError || (typeof erro === 'object' && erro !== null && (erro as { name?: string }).name === 'TimeoutError')
);

/**
 * Mensagem pro usuario quando o `fetch` em si falhou (antes de qualquer
 * resposta): timeout diz que demorou; o resto e' rede/servidor fora.
 */
export const mensagemDeFalhaDeRede = (
  erro: unknown,
  padrao = 'Não foi possível falar com o servidor. Verifique a internet e tente de novo.',
): string => (isTimeoutError(erro) ? erro.message : padrao);

export const fetchComTimeout = async (
  url: string,
  init: RequestInit = {},
  timeoutMs: number = TEMPO_LIMITE.padrao,
): Promise<Response> => {
  const controlador = new AbortController();
  const timer = window.setTimeout(() => controlador.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controlador.signal });
  } catch (erro) {
    if ((erro as { name?: string } | null)?.name === 'AbortError') {
      throw new TimeoutError(timeoutMs);
    }
    throw erro;
  } finally {
    window.clearTimeout(timer);
  }
};
