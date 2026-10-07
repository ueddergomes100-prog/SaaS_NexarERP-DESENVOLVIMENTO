/**
 * MENSAGENS PADRAO POR DOCUMENTO (Configuracoes por filial, fase B --
 * 2026-10-07). Plano em docs/PLANO_CONFIGURACOES_POR_FILIAL.md.
 *
 * Cada filial escreve, em Configuracoes, um texto para cada documento que
 * imprime; a impressao le o texto da filial. Em branco = o documento sai como
 * hoje (o recibo mantem "Obrigado pela preferencia!"). O pedido de venda e a
 * OS continuam com os textos que ja' tinham (observacoesPadraoPedido e termo
 * de garantia), por isso nao entram aqui.
 */

export type DocumentoComMensagem = 'recibo' | 'minuta' | 'orcamento' | 'notaFiscal' | 'carne';

export interface MensagensPadrao {
  /** Recibo/comprovante do pedido de venda (rodape). */
  recibo: string;
  /** Minuta de entrega (antes das assinaturas). */
  minuta: string;
  /** Orcamento (rodape, antes da validade). */
  orcamento: string;
  /** NF-e/NFC-e: entra nas informacoes complementares, antes do texto do Simples. */
  notaFiscal: string;
  /** Carne de parcelas e promissoria (fase D). */
  carne: string;
}

/** Tamanho maximo de cada mensagem. A NF-e aceita ate 5000 nas informacoes complementares; 600 cabe em qualquer impresso. */
export const LIMITE_MENSAGEM_PADRAO = 600;

export const MENSAGENS_PADRAO_VAZIAS: MensagensPadrao = { recibo: '', minuta: '', orcamento: '', notaFiscal: '', carne: '' };

export const DOCUMENTOS_COM_MENSAGEM: Array<{ chave: DocumentoComMensagem; rotulo: string; onde: string }> = [
  { chave: 'recibo', rotulo: 'Recibo / comprovante da venda', onde: 'Rodapé do recibo do pedido de venda (todos os modelos). Em branco: "Obrigado pela preferência!".' },
  { chave: 'minuta', rotulo: 'Minuta de entrega', onde: 'Antes das assinaturas da minuta (individual e em lote).' },
  { chave: 'orcamento', rotulo: 'Orçamento', onde: 'Rodapé do orçamento, antes da frase de validade.' },
  { chave: 'notaFiscal', rotulo: 'Nota fiscal (NF-e e NFC-e)', onde: 'Informações complementares da nota, antes do texto do Simples Nacional e dos tributos aproximados.' },
  { chave: 'carne', rotulo: 'Carnê de parcelas e promissória', onde: 'Rodapé de cada folha do carnê e da promissória.' },
];

const limpar = (valor: unknown): string => (typeof valor === 'string' ? valor.replace(/\r\n/g, '\n').trim().slice(0, LIMITE_MENSAGEM_PADRAO) : '');

/** Le `configuracoes.mensagensPadrao` (qualquer coisa estranha vira vazio). */
export const parseMensagensPadrao = (raw: unknown): MensagensPadrao => {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    recibo: limpar(r.recibo),
    minuta: limpar(r.minuta),
    orcamento: limpar(r.orcamento),
    notaFiscal: limpar(r.notaFiscal),
    carne: limpar(r.carne),
  };
};

/** Mensagem de um documento direto do documento de configuracao (telas de impressao recebem `configData`). */
export const mensagemDoDocumento = (config: unknown, documento: DocumentoComMensagem): string => (
  parseMensagensPadrao((config as Record<string, unknown> | null | undefined)?.mensagensPadrao)[documento]
);

/** Informacoes complementares da nota: a mensagem da filial primeiro, depois o resto (sem duplicar espacos). */
export const informacoesComplementaresComMensagem = (mensagem: string, partes: Array<string | false | null | undefined>): string => (
  [limpar(mensagem).replace(/\s*\n\s*/g, ' '), ...partes].filter((p): p is string => Boolean(p && String(p).trim())).join(' ')
);
