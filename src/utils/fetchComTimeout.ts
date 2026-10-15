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
  /** Baixa em lote: ate' 50 contas, uma transacao por conta, em sequencia. */
  baixaEmLote: 120_000,
  /** Gerar/baixar/restaurar backup: a empresa inteira. */
  backup: 300_000,
  /** Manutencao do banco (Painel da Plataforma): le colecoes inteiras de todas as empresas. */
  manutencao: 300_000,
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

/**
 * Cabecalhos que entram sozinhos nas chamadas ao NOSSO servidor -- hoje o
 * comprovante do App Check (2026-10-14). Quem registra e' services/firebase.ts,
 * so' quando o App Check esta ligado; sem registro, nada muda. Falha ao obter
 * o cabecalho nunca derruba a chamada (o servidor esta em modo de observacao).
 */
type CabecalhosAutomaticos = (url: string) => Promise<Record<string, string>>;
let cabecalhosAutomaticos: CabecalhosAutomaticos | null = null;
export const definirCabecalhosAutomaticos = (fn: CabecalhosAutomaticos | null) => {
  cabecalhosAutomaticos = fn;
};

const comCabecalhosAutomaticos = async (url: string, init: RequestInit): Promise<RequestInit> => {
  if (!cabecalhosAutomaticos) return init;
  const extras = await cabecalhosAutomaticos(url).catch(() => ({} as Record<string, string>));
  const nomes = Object.keys(extras);
  if (nomes.length === 0) return init;
  const headers = new Headers(init.headers);
  nomes.forEach((nome) => {
    if (!headers.has(nome)) headers.set(nome, extras[nome]);
  });
  return { ...init, headers };
};

export const fetchComTimeout = async (
  url: string,
  init: RequestInit = {},
  timeoutMs: number = TEMPO_LIMITE.padrao,
): Promise<Response> => {
  const pedido = await comCabecalhosAutomaticos(url, init);
  const controlador = new AbortController();
  const timer = window.setTimeout(() => controlador.abort(), timeoutMs);
  try {
    return await fetch(url, { ...pedido, signal: controlador.signal });
  } catch (erro) {
    if ((erro as { name?: string } | null)?.name === 'AbortError') {
      throw new TimeoutError(timeoutMs);
    }
    throw erro;
  } finally {
    window.clearTimeout(timer);
  }
};
