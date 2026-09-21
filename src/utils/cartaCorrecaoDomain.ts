/**
 * CARTA DE CORRECAO (CC-e) DA NF-e -- lado da tela (2026-09-21).
 *
 * As regras de verdade ficam no servidor (server/services/cartaCorrecao.js),
 * que barra o que a tela deixar passar. Este arquivo espelha as mesmas
 * regras pra tela avisar ANTES de enviar e mostrar o contador de caracteres.
 * Mantenha os dois iguais.
 */

export const CARTA_MIN_CARACTERES = 15;
export const CARTA_MAX_CARACTERES = 1000;
export const CARTA_MAX_POR_NOTA = 20;

/** Tira quebras de linha e espacos repetidos/nas pontas -- a SEFAZ nao aceita. */
export const normalizarTextoCarta = (texto: string): string => String(texto ?? '').replace(/\s+/g, ' ').trim();

/** Mensagem do que esta errado com o texto, ou null quando pode enviar. */
export const erroDoTextoCarta = (texto: string): string | null => {
  const tamanho = normalizarTextoCarta(texto).length;
  if (tamanho < CARTA_MIN_CARACTERES) {
    return `A carta precisa ter pelo menos ${CARTA_MIN_CARACTERES} caracteres (tem ${tamanho}). Explique o que está errado na nota e qual é o dado correto.`;
  }
  if (tamanho > CARTA_MAX_CARACTERES) {
    return `A carta pode ter no máximo ${CARTA_MAX_CARACTERES} caracteres (tem ${tamanho}). Resuma o texto.`;
  }
  return null;
};

export interface CartaEnviada {
  eventId: string | null;
  status: string;
  texto: string;
  /** ISO 8601 */
  enviadaEm: string;
  enviadaPorEmail?: string | null;
}

/** Nota como a tela a conhece (so' o que a regra precisa). */
export interface NotaParaCarta {
  tipo: string;
  status: string;
  cartasCorrecao?: CartaEnviada[] | null;
}

/** Por que a nota NAO pode receber carta (mensagem pro usuario), ou null quando pode. */
export const motivoQueImpedeCartaNaTela = (nota: NotaParaCarta): string | null => {
  if (nota.tipo !== 'NF-e') {
    return 'Carta de correção existe só para NF-e. NFC-e e NFS-e não têm esse recurso: se houver erro, cancele a nota (dentro do prazo) e emita outra.';
  }
  if (nota.status !== 'authorized') {
    return 'Só uma NF-e autorizada pode receber carta de correção.';
  }
  const enviadas = nota.cartasCorrecao?.length ?? 0;
  if (enviadas >= CARTA_MAX_POR_NOTA) {
    return `Esta nota já recebeu ${CARTA_MAX_POR_NOTA} cartas de correção, que é o limite da SEFAZ. Para novos ajustes, cancele a nota (se ainda estiver no prazo) ou emita uma nota de devolução.`;
  }
  return null;
};

/** O botão "Carta de correção" aparece pra essa nota? (autorizada, NF-e; o limite é avisado ao abrir) */
export const notaAceitaCartaCorrecao = (nota: NotaParaCarta): boolean => nota.tipo === 'NF-e' && nota.status === 'authorized';

/** O que a carta pode e não pode corrigir -- texto da SEFAZ/Spedy, mostrado na tela. */
export const CARTA_PODE_CORRIGIR: string[] = [
  'Informações complementares e observações da nota',
  'Dados de transporte (transportadora, placa, volumes)',
  'Erros de digitação que não mudam valor, imposto, destinatário ou data',
];

export const CARTA_NAO_PODE_CORRIGIR: string[] = [
  'Valores, preços, quantidades e totais',
  'Impostos (base de cálculo, alíquota, valor)',
  'Dados do destinatário (nome, CPF/CNPJ, endereço)',
  'Datas de emissão e de saída',
  'CFOP que muda a natureza da operação',
];

/** Ordena da mais nova pra mais antiga, pra tela mostrar o histórico. */
export const cartasMaisNovasPrimeiro = (cartas: CartaEnviada[] | null | undefined): CartaEnviada[] => (
  [...(cartas ?? [])].sort((a, b) => b.enviadaEm.localeCompare(a.enviadaEm))
);
