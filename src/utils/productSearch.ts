import { normalizeSearchText } from './textSearch';

export type ProductSearchMode = 'exata' | 'completa';

export interface SearchableProduct {
  nome?: string | null;
  codigo?: string | null;
  codigoBarras?: string | null;
  referencia?: string | null;
  skuSistema?: string | null;
  marca?: string | null;
  categoria?: string | null;
  fornecedor?: string | null;
}

export interface ProductSearchOptions {
  mode?: ProductSearchMode;
  limit?: number;
}

export interface ProductSearchResult<T> {
  items: T[];
  total: number;
  truncated: boolean;
}

export const DEFAULT_PRODUCT_SEARCH_MODE: ProductSearchMode = 'completa';

const DEFAULT_MODE: ProductSearchMode = DEFAULT_PRODUCT_SEARCH_MODE;
const DEFAULT_LIMIT = 6;

const CODE_FIELDS: Array<keyof SearchableProduct> = ['codigo', 'codigoBarras', 'referencia', 'skuSistema'];
const TEXT_FIELDS: Array<keyof SearchableProduct> = ['nome', 'marca', 'categoria', 'fornecedor'];

const normalize = normalizeSearchText;

const matchesByMode = (haystack: string, term: string, mode: ProductSearchMode): boolean => {
  if (!haystack) return false;
  return mode === 'exata' ? haystack.startsWith(term) : haystack.includes(term);
};

export const productMatchesExactCode = <T extends SearchableProduct>(product: T, term: string): boolean => {
  const normalizedTerm = normalize(term);
  if (!normalizedTerm) return false;
  return CODE_FIELDS.some((field) => normalize(product[field]) === normalizedTerm);
};

const productMatchesCodePrefix = <T extends SearchableProduct>(product: T, normalizedTerm: string): boolean => (
  CODE_FIELDS.some((field) => {
    const value = normalize(product[field]);
    return value !== '' && value.startsWith(normalizedTerm);
  })
);

export const productMatchesSearch = <T extends SearchableProduct>(
  product: T,
  term: string,
  mode: ProductSearchMode = DEFAULT_MODE,
): boolean => {
  const normalizedTerm = normalize(term);
  if (!normalizedTerm) return false;

  if (productMatchesCodePrefix(product, normalizedTerm)) return true;

  return TEXT_FIELDS.some((field) => matchesByMode(normalize(product[field]), normalizedTerm, mode));
};

/**
 * Busca unificada de produtos usada por PDV, Pedido de Venda e OS.
 * Se algum produto bate exatamente com um campo de codigo, so os matches
 * exatos sao retornados (prioridade de leitor de codigo de barras).
 * Caso contrario, cai para prefixo de codigo + campos de texto conforme o modo.
 */
export const searchProducts = <T extends SearchableProduct>(
  products: T[],
  term: string,
  options: ProductSearchOptions = {},
): ProductSearchResult<T> => {
  const mode = options.mode ?? DEFAULT_MODE;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const normalizedTerm = normalize(term);

  if (!normalizedTerm) {
    return { items: [], total: 0, truncated: false };
  }

  const exactMatches = products.filter((product) => productMatchesExactCode(product, term));
  const matches = exactMatches.length > 0
    ? exactMatches
    : products.filter((product) => productMatchesSearch(product, term, mode));

  return {
    items: matches.slice(0, limit),
    total: matches.length,
    truncated: matches.length > limit,
  };
};
