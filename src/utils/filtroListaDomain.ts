import { getDateInputInTimeZone } from './dateTime';

/**
 * FILTROS DAS LISTAS (2026-09-19) -- regras puras, sem tela.
 *
 * Toda lista do sistema tem filtro que funciona: situacao (ativo/inativo,
 * aberto/pago/vencido...) e periodo. Estas funcoes sao o miolo comum, pra
 * "vencido" e "dentro do periodo" significarem a mesma coisa em qualquer tela.
 */

const ISO_DIA = /^(\d{4})-(\d{2})-(\d{2})/;
const BR_DIA = /^(\d{2})\/(\d{2})\/(\d{4})/;

/**
 * Converte o que o documento guarda como data em `AAAA-MM-DD` (o mesmo
 * formato do input type="date"). Aceita texto ISO (`2026-09-19` ou com hora),
 * `dd/mm/aaaa`, Date e Timestamp do Firestore (`toDate()` ou `seconds`).
 * Devolve '' quando nao reconhece -- registro sem data nunca passa por um
 * filtro de periodo, em vez de aparecer no lugar errado.
 */
export const dataISODoRegistro = (valor: unknown): string => {
  if (valor === null || valor === undefined || valor === '') return '';

  if (typeof valor === 'string') {
    const texto = valor.trim();
    const iso = ISO_DIA.exec(texto);
    if (iso) {
      // Texto com hora e fuso (ex.: 2026-09-19T02:00:00Z) tem que virar o dia
      // de Sao Paulo, senao uma venda das 23h cai no dia seguinte.
      if (texto.length > 10 && /[zZ]|[+-]\d{2}:?\d{2}$/.test(texto)) {
        const data = new Date(texto);
        return Number.isNaN(data.getTime()) ? `${iso[1]}-${iso[2]}-${iso[3]}` : getDateInputInTimeZone(data);
      }
      return `${iso[1]}-${iso[2]}-${iso[3]}`;
    }
    const br = BR_DIA.exec(texto);
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
    return '';
  }

  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? '' : getDateInputInTimeZone(valor);
  }

  if (typeof valor === 'object') {
    const candidato = valor as { toDate?: () => Date; seconds?: number };
    if (typeof candidato.toDate === 'function') {
      const data = candidato.toDate();
      return data instanceof Date && !Number.isNaN(data.getTime()) ? getDateInputInTimeZone(data) : '';
    }
    if (typeof candidato.seconds === 'number') {
      return getDateInputInTimeZone(new Date(candidato.seconds * 1000));
    }
  }

  return '';
};

/**
 * Esta data esta entre `de` e `ate` (inclusive)? Limite vazio = sem limite;
 * os dois vazios = sem filtro (tudo passa, ate' registro sem data).
 */
export const dentroDoPeriodo = (valor: unknown, de: string, ate: string): boolean => {
  if (!de && !ate) return true;
  const dia = dataISODoRegistro(valor);
  if (!dia) return false;
  if (de && dia < de) return false;
  if (ate && dia > ate) return false;
  return true;
};

// ---------------------------------------------------------------------------
// Situacao de titulo (Contas a Pagar / Contas a Receber)
// ---------------------------------------------------------------------------

/**
 * `abertas`: tudo que ainda nao foi pago (inclui as vencidas -- vencida e'
 * uma aberta atrasada, nao outra coisa). `vencidas`: aberta com vencimento
 * antes de hoje. `pagas`: baixadas. `todas`: abertas + pagas (cancelada nao
 * entra: ela nao e' divida nem recebimento).
 */
export type SituacaoTitulo = 'abertas' | 'vencidas' | 'pagas' | 'todas';

export const SITUACAO_TITULO_PADRAO: SituacaoTitulo = 'abertas';

export const ROTULO_SITUACAO_TITULO: Record<SituacaoTitulo, string> = {
  abertas: 'Em aberto',
  vencidas: 'Vencidas',
  pagas: 'Pagas',
  todas: 'Todas',
};

export interface TituloFiltravel {
  status?: string;
  /** Vencimento, `AAAA-MM-DD`. */
  data?: string;
  dataPagamento?: string;
}

export const tituloVencido = (titulo: TituloFiltravel, hoje: string): boolean => {
  const vencimento = dataISODoRegistro(titulo.data);
  return titulo.status === 'Pendente' && vencimento !== '' && vencimento < hoje;
};

export const passaNaSituacaoTitulo = (
  titulo: TituloFiltravel,
  hoje: string,
  situacao: SituacaoTitulo,
): boolean => {
  const pendente = titulo.status === 'Pendente';
  const paga = titulo.status === 'Paga';
  switch (situacao) {
    case 'abertas': return pendente;
    case 'vencidas': return tituloVencido(titulo, hoje);
    case 'pagas': return paga;
    case 'todas': return pendente || paga;
    default: return false;
  }
};

/**
 * O periodo vale pro vencimento; nas PAGAS, pra data em que foi paga (quem
 * olha "o que paguei em agosto" quer a data do pagamento, nao a do
 * vencimento). Paga sem data de pagamento cai no vencimento.
 */
export const passaNoPeriodoDoTitulo = (
  titulo: TituloFiltravel,
  situacao: SituacaoTitulo,
  de: string,
  ate: string,
): boolean => {
  const referencia = situacao === 'pagas'
    ? (titulo.dataPagamento || titulo.data)
    : titulo.data;
  return dentroDoPeriodo(referencia, de, ate);
};
