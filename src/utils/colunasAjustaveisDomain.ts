/*
 * COLUNAS AJUSTAVEIS EM TODAS AS TABELAS (pedido do dono, 21/10/2026 -- "coloca em
 * todas as colunas e torna isso padrao em todas as telas"). Regras puras; a parte
 * que mexe na tela fica em components/layout/useColunasAjustaveis.ts.
 *
 * A largura escolhida fica guardada NESTE computador (localStorage), por tela e por
 * coluna: a chave junta o titulo da tela, os nomes das colunas da tabela (para duas
 * tabelas da mesma tela nao se misturarem) e o nome da coluna.
 */

export const LARGURA_MINIMA_COLUNA = 48;
export const LARGURA_MAXIMA_COLUNA = 900;
export const PREFIXO_CHAVE_COLUNA = 'colunas:';

/** Texto do cabecalho sem setas de ordenacao, contadores e espacos sobrando. */
export const textoDoCabecalho = (texto: string | null | undefined): string => String(texto ?? '')
  .replace(/[▲▼↑↓⇅⌄⌃]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toUpperCase();

/** Hash curto e estavel (djb2) para a chave nao ficar enorme. */
const hashCurto = (texto: string): string => {
  let h = 5381;
  for (let i = 0; i < texto.length; i += 1) h = ((h << 5) + h + texto.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

/** Chave da coluna: tela + assinatura da tabela (todas as colunas) + coluna. */
export const chaveDaColuna = (tela: string, cabecalhos: readonly string[], indice: number): string => {
  const nomes = cabecalhos.map(textoDoCabecalho);
  const nome = nomes[indice] || `#${indice}`;
  return `${PREFIXO_CHAVE_COLUNA}${hashCurto(`${textoDoCabecalho(tela)}|${nomes.join('|')}`)}:${nome}`;
};

export const limitarLargura = (px: number): number => Math.min(LARGURA_MAXIMA_COLUNA, Math.max(LARGURA_MINIMA_COLUNA, Math.round(px)));

/** Largura guardada valida, ou null. */
export const lerLarguraGuardada = (valor: string | null): number | null => {
  const n = Number(valor);
  return valor !== null && Number.isFinite(n) && n >= LARGURA_MINIMA_COLUNA && n <= LARGURA_MAXIMA_COLUNA ? Math.round(n) : null;
};

/**
 * Coluna que ganha a alca: nao a ultima (normalmente "Acoes", e a borda dela e' a
 * borda da tabela), nao a de selecao (so' a caixinha), nem celula que ocupa varias colunas.
 */
export const colunaAjustavel = (c: { indice: number; total: number; colSpan: number; texto: string; soCaixinha: boolean }): boolean => (
  c.indice < c.total - 1 && c.colSpan <= 1 && !c.soCaixinha && c.total > 1
);
