/*
 * INUTILIZACAO DE NUMERACAO DE NF-e / NFC-e (pendencia fiscal, 21/10/2026).
 *
 * Numero que pulou na sequencia (nota que falhou antes de ir para a SEFAZ,
 * numeracao ajustada na Spedy) tem de ser inutilizado na SEFAZ. Nao e'
 * cancelamento: so' vale para numero que NUNCA foi autorizado. A Spedy faz o
 * pedido a SEFAZ (POST /{product|consumer}-invoices/disablements) e devolve a
 * situacao: em processamento, inutilizada, rejeitada ou erro.
 *
 * Regras (Spedy + SEFAZ):
 *  - NF-e e NFC-e; NFS-e nao tem inutilizacao;
 *  - serie de 0 a 999; numero inicial <= final, a partir de 1;
 *  - motivo de 15 a 255 caracteres;
 *  - numero que e' de nota autorizada, cancelada ou denegada NAO se inutiliza
 *    (nota autorizada se cancela) -- conferido pelo servidor com as notas do
 *    sistema antes de mandar.
 *
 * Regra pura (tela e servidor): sem Firestore, sem rede.
 */

export type ModeloInutilizacao = 'nfe' | 'nfce';

export const ROTULO_DO_MODELO: Record<ModeloInutilizacao, string> = { nfe: 'NF-e', nfce: 'NFC-e' };

/** Caminho da Spedy de cada modelo (a operacao e' {caminho}/disablements). */
export const CAMINHO_NA_SPEDY: Record<ModeloInutilizacao, string> = { nfe: 'product-invoices', nfce: 'consumer-invoices' };

export const MOTIVO_MINIMO = 15;
export const MOTIVO_MAXIMO = 255;
export const SERIE_MAXIMA = 999;
/** Faixa maxima por pedido: maior que isso e' quase sempre numero digitado errado. */
export const MAXIMO_DE_NUMEROS = 1000;

export interface PedidoDeInutilizacao {
  modelo: ModeloInutilizacao;
  serie: number;
  inicial: number;
  final: number;
  motivo: string;
}

export const normalizarMotivo = (texto: unknown): string => String(texto ?? '').replace(/\s+/g, ' ').trim();

/** Numero inteiro; vazio, nulo ou com casas decimais = NaN (campo em branco nao vira 0). */
const inteiro = (v: unknown): number => {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return Number.NaN;
  const n = Number(typeof v === 'string' ? v.trim() : v);
  return Number.isInteger(n) ? n : Number.NaN;
};

/** Valida o pedido (o que a tela manda). Devolve a primeira coisa errada, em portugues. */
export const lerPedidoDeInutilizacao = (corpo: unknown): { erro: string } | { pedido: PedidoDeInutilizacao } => {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  const modelo = c.modelo === 'nfe' || c.modelo === 'nfce' ? c.modelo : null;
  if (!modelo) return { erro: 'Escolha se a numeração é de NF-e ou de NFC-e.' };
  const serie = inteiro(c.serie);
  if (!(serie >= 0 && serie <= SERIE_MAXIMA)) return { erro: `Informe a série (de 0 a ${SERIE_MAXIMA}), a mesma da Configuração de Nota Fiscal.` };
  const inicial = inteiro(c.inicial);
  const final = inteiro(c.final);
  if (!(inicial >= 1)) return { erro: 'Informe o número inicial da faixa (a partir de 1).' };
  if (!(final >= 1)) return { erro: 'Informe o número final da faixa (para um número só, repita o inicial).' };
  if (final < inicial) return { erro: `O número final (${final}) está antes do inicial (${inicial}).` };
  if (final - inicial + 1 > MAXIMO_DE_NUMEROS) {
    return { erro: `A faixa tem ${final - inicial + 1} números; o máximo é ${MAXIMO_DE_NUMEROS} por vez. Confira se os números estão certos.` };
  }
  const motivo = normalizarMotivo(c.motivo);
  if (motivo.length < MOTIVO_MINIMO) return { erro: `Escreva o motivo com pelo menos ${MOTIVO_MINIMO} caracteres (o seu tem ${motivo.length}). Ex.: "Quebra de sequência por falha antes do envio".` };
  if (motivo.length > MOTIVO_MAXIMO) return { erro: `O motivo pode ter no máximo ${MOTIVO_MAXIMO} caracteres (o seu tem ${motivo.length}). Resuma o texto.` };
  return { pedido: { modelo, serie, inicial, final, motivo } };
};

/** Situacoes de nota que USARAM o numero: esse numero nao se inutiliza. */
export const STATUS_QUE_USAM_O_NUMERO = ['authorized', 'canceled', 'denied'];

export interface NotaParaConferir {
  tipo?: unknown;
  number?: unknown;
  status?: unknown;
  clienteNome?: unknown;
}

/** Notas do sistema (do mesmo modelo) que ja' usaram algum numero da faixa. */
export const notasQueUsamAFaixa = <T extends NotaParaConferir>(notas: T[], pedido: Pick<PedidoDeInutilizacao, 'modelo' | 'inicial' | 'final'>): T[] => (
  notas.filter((n) => {
    const numero = Number(n.number);
    return n.tipo === ROTULO_DO_MODELO[pedido.modelo]
      && Number.isInteger(numero) && numero >= pedido.inicial && numero <= pedido.final
      && STATUS_QUE_USAM_O_NUMERO.includes(String(n.status));
  })
);

const ROTULO_STATUS_DA_NOTA: Record<string, string> = { authorized: 'autorizada', canceled: 'cancelada', denied: 'denegada' };

export const mensagemDeNumeroUsado = (notas: NotaParaConferir[], modelo: ModeloInutilizacao): string => {
  const lista = notas.slice(0, 5).map((n) => `nº ${String(n.number)} (${ROTULO_STATUS_DA_NOTA[String(n.status)] || String(n.status)}${n.clienteNome ? `, ${String(n.clienteNome)}` : ''})`).join('; ');
  const mais = notas.length > 5 ? ` e mais ${notas.length - 5}` : '';
  return `A faixa inclui número já usado por ${ROTULO_DO_MODELO[modelo]} do sistema: ${lista}${mais}. Número usado não se inutiliza — nota autorizada se cancela. Ajuste a faixa para os números que ficaram de fora.`;
};

export type StatusInutilizacao = 'inProcessing' | 'registered' | 'rejected' | 'error';

export const ROTULO_STATUS_INUTILIZACAO: Record<StatusInutilizacao, string> = {
  inProcessing: 'Em processamento',
  registered: 'Inutilizada',
  rejected: 'Rejeitada pela SEFAZ',
  error: 'Erro',
};

export const lerStatusInutilizacao = (valor: unknown): StatusInutilizacao => (
  valor === 'registered' || valor === 'rejected' || valor === 'error' ? valor : 'inProcessing'
);

export interface FaixaRegistrada { modelo: unknown; serie: unknown; inicial: unknown; final: unknown; status: unknown }

/** Faixa ja' inutilizada (ou em processamento) que cruza com o pedido. */
export const faixaQueJaCobre = <T extends FaixaRegistrada>(registradas: T[], pedido: Pick<PedidoDeInutilizacao, 'modelo' | 'serie' | 'inicial' | 'final'>): T | null => (
  registradas.find((r) => r.modelo === pedido.modelo
    && Number(r.serie) === pedido.serie
    && (r.status === 'registered' || r.status === 'inProcessing')
    && Number(r.inicial) <= pedido.final && Number(r.final) >= pedido.inicial) || null
);

/** Texto curto da faixa: "nº 15" ou "nº 10 a 15". */
export const textoDaFaixa = (inicial: number, final: number): string => (inicial === final ? `nº ${inicial}` : `nº ${inicial} a ${final}`);
