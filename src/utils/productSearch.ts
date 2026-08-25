import { normalizeSearchText } from './textSearch';
import { normalizeEmbalagens } from './embalagemDomain';

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
  /** Array cru de embalagens do documento de estoque. Cada embalagem pode ter
   * codigo de barras proprio (o EAN do saco, diferente do EAN da unidade). */
  embalagens?: unknown;
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

/**
 * Curinga "listar tudo": digitar so `#` devolve o catalogo inteiro em vez de
 * filtrar. Serve pra quem nao sabe o nome do produto e quer olhar a lista --
 * principalmente no popup "Ver mais", que sem termo nenhum nao mostrava nada.
 *
 * Escolhido `#` porque nao aparece em codigo de barras (EAN e' so digito) nem
 * em nome/codigo de produto na pratica, entao nao existe busca legitima que
 * ele atrapalhe. Vale so quando e' o termo INTEIRO: "#" lista tudo, mas
 * "cafe#" continua sendo uma busca comum por texto que nao acha nada.
 */
export const LISTAR_TUDO_TERM = '#';

export const isListarTudoTerm = (term: unknown): boolean =>
  String(term ?? '').trim() === LISTAR_TUDO_TERM;

const DEFAULT_MODE: ProductSearchMode = DEFAULT_PRODUCT_SEARCH_MODE;
const DEFAULT_LIMIT = 6;

const CODE_FIELDS: Array<keyof SearchableProduct> = ['codigo', 'codigoBarras', 'referencia', 'skuSistema'];
const TEXT_FIELDS: Array<keyof SearchableProduct> = ['nome', 'marca', 'categoria', 'fornecedor'];

const normalize = normalizeSearchText;

const matchesByMode = (haystack: string, term: string, mode: ProductSearchMode): boolean => {
  if (!haystack) return false;
  return mode === 'exata' ? haystack.startsWith(term) : haystack.includes(term);
};

/**
 * Devolve o id da embalagem cujo codigo de barras bate EXATAMENTE com o
 * termo, ou null. So exato: leitor de codigo de barras sempre manda o EAN
 * inteiro, e casar por prefixo aqui faria o saco competir com a unidade
 * enquanto o operador ainda esta digitando.
 *
 * Usado pelo PDV para lancar direto na unidade bipada -- bipar o saco tem
 * que lancar 1 SC (e baixar 20 kg), nao 1 kg.
 */
export const findEmbalagemIdByExactCode = <T extends SearchableProduct>(
  product: T,
  term: string,
): string | null => {
  const normalizedTerm = normalize(term);
  if (!normalizedTerm) return null;

  const match = normalizeEmbalagens(product.embalagens)
    .filter((embalagem) => embalagem.ativo)
    .find((embalagem) => normalize(embalagem.codigoBarras) === normalizedTerm);

  return match ? match.id : null;
};

export const productMatchesExactCode = <T extends SearchableProduct>(product: T, term: string): boolean => {
  const normalizedTerm = normalize(term);
  if (!normalizedTerm) return false;
  if (CODE_FIELDS.some((field) => normalize(product[field]) === normalizedTerm)) return true;
  // O EAN da embalagem tambem identifica o produto -- sem isso, bipar o saco
  // nao encontraria nada. Produto sem embalagem nao muda em nada.
  return findEmbalagemIdByExactCode(product, term) !== null;
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
  // Curinga antes de qualquer filtro: `#` nao e' termo de busca, e' "me
  // mostra tudo". `total` traz o catalogo inteiro, entao o "Ver mais" do
  // autocomplete continua aparecendo e leva pra lista completa no popup.
  if (isListarTudoTerm(term)) {
    return {
      items: products.slice(0, limit),
      total: products.length,
      truncated: products.length > limit,
    };
  }

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
