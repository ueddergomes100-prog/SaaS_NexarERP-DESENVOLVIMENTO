const DIACRITICS_PATTERN = new RegExp(
  '[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']',
  'g',
);

/**
 * Normaliza texto para comparacao de busca: remove acentos, espacos nas
 * pontas e caixa. Compartilhado por productSearch.ts e clientSearch.ts
 * para as duas buscas tratarem acento/caixa do mesmo jeito.
 */
export const normalizeSearchText = (value: unknown): string => (
  String(value ?? '')
    .normalize('NFD')
    .replace(DIACRITICS_PATTERN, '')
    .trim()
    .toLowerCase()
);
