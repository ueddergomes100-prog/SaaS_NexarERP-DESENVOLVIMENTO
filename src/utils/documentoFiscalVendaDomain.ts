/**
 * QUAL DOCUMENTO FISCAL SAI NO FIM DA VENDA (2026-09-15).
 *
 * Ate aqui, o fim da venda sempre oferecia NFC-e -- "Emitir Cupom Fiscal
 * (NFC-e)" era o botao principal de todo tenant com `controlaFiscal` ligado.
 * As chaves `emiteNFe`/`emiteNFCe`/`emiteNFSe` existiam na tela de
 * Configuracoes mas nao governavam nada ("continuam so informativos", dizia
 * o proprio texto da tela).
 *
 * Isso quebra pra quem emite NF-e e nao emite cupom: a empresa termina a
 * venda e o sistema oferece um documento que ela nao emite. O unico caminho
 * era ignorar o botao e ir no menu Fiscal na mao, redigitando o pedido.
 *
 * Agora as chaves decidem. A regra, e o porque de cada linha:
 *
 *   controlaFiscal desligado          -> 'nenhum'  (a empresa nao emite nota
 *                                        por aqui; ver fiscalDomain.ts)
 *   nenhuma chave marcada             -> 'nfce'    (LEGADO, ver abaixo)
 *   emiteNFCe marcado                 -> 'nfce'
 *   so emiteNFe                       -> 'nfe'
 *   so emiteNFSe                      -> 'nenhum'
 *
 * O CASO LEGADO E O MAIS IMPORTANTE DOS CINCO. Os dois campos nasceram com
 * `false` e nunca governaram nada, entao existe tenant emitindo cupom todo
 * dia com `emiteNFCe: false` gravado. Ler isso ao pe da letra sumiria com o
 * botao de NFC-e da operacao inteira deles, sem ninguem ter mudado
 * configuracao nenhuma. Por isso: so quando a empresa marcou ALGUMA das tres
 * e que as tres passam a valer. Quem nao marcou nada segue exatamente como
 * antes.
 *
 * NFC-e vence NF-e quando as duas estao marcadas: o cupom e' o documento do
 * balcao, emitido na hora, e a NF-e desse mesmo publico e' excecao pedida
 * caso a caso (a tela Fiscal continua la pra isso). Empresa que quer NF-e
 * como padrao do balcao desmarca NFC-e -- que e' a verdade do cadastro dela.
 *
 * NFS-e sozinha da 'nenhum' de proposito: servico nao sai por pedido de
 * venda de produto, ele tem caminho proprio na OS.
 */

export type DocumentoFiscalVenda = 'nfce' | 'nfe' | 'nenhum';

export interface DocumentosFiscaisEmitidos {
  emiteNFe?: unknown;
  emiteNFCe?: unknown;
  emiteNFSe?: unknown;
}

const marcado = (valor: unknown): boolean => valor === true;

/** A empresa chegou a dizer quais documentos emite? Enquanto a resposta for
 * nao, o sistema se comporta como antes desta regra existir. */
export const declarouDocumentosFiscais = (config: DocumentosFiscaisEmitidos | null | undefined): boolean => (
  marcado(config?.emiteNFe) || marcado(config?.emiteNFCe) || marcado(config?.emiteNFSe)
);

export const resolveDocumentoFiscalVenda = (
  controlaFiscal: boolean,
  config: DocumentosFiscaisEmitidos | null | undefined,
): DocumentoFiscalVenda => {
  if (!controlaFiscal) return 'nenhum';
  if (!declarouDocumentosFiscais(config)) return 'nfce';
  if (marcado(config?.emiteNFCe)) return 'nfce';
  if (marcado(config?.emiteNFe)) return 'nfe';
  return 'nenhum';
};

/** Texto do botao principal no fim da venda. */
export const rotuloAcaoFiscalVenda = (documento: DocumentoFiscalVenda): string => {
  if (documento === 'nfce') return 'Emitir Cupom Fiscal (NFC-e)';
  if (documento === 'nfe') return 'Emitir NF-e';
  return 'Imprimir Recibo';
};

/**
 * NF-e NAO e' transmitida daqui. O fim da venda leva pra tela de Nota
 * Fiscal com o pedido ja' escolhido, e a emissao acontece la.
 *
 * Por que nao transmitir direto, como a NFC-e faz: cupom de balcao e'
 * sempre o mesmo -- consumidor final, a vista, sem frete, sem transportadora
 * -- e por isso cabe num clique. NF-e pede natureza da operacao, CFOP,
 * destinatario completo, frete e transporte; cada um desses campos e' uma
 * decisao que muda a nota, e nota rejeitada pela SEFAZ da trabalho pra
 * arrumar. A tela Fiscal ja' tem todos eles, ja' importa o pedido e ja'
 * valida antes de transmitir.
 */
export const rotaEmissaoNFe = (pedidoId: string): string => `/fiscal/nfe?pedido=${encodeURIComponent(pedidoId)}`;
