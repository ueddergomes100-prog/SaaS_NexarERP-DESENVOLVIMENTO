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

/**
 * Separador de termos obrigatorios na busca. Decisao de produto (2026-08-31).
 *
 * ---------------------------------------------------------------------------
 * O PROBLEMA QUE ISTO RESOLVE
 * ---------------------------------------------------------------------------
 *
 * Nome de produto no varejo e' longo e ninguem lembra a ordem exata das
 * palavras: "Racao Quatree Gourmet Caes Adultos 20KG". Quem digita
 * "racao 20kg" nao acha nada, porque essas duas palavras nunca aparecem
 * grudadas -- e o operador acaba digitando o nome inteiro, com cliente na
 * frente.
 *
 * Com o "+", cada pedaco vira um termo OBRIGATORIO, e a ordem nao importa:
 *
 *     Racao+Quatree+20KG   ->  tudo que tem as tres palavras, em qualquer ordem
 *
 * Por que "+" e nao espaco: espaco ja significa "esta frase, nesta ordem", e
 * mudar isso quebraria a busca de quem digita o comeco do nome. O "+" e' um
 * gesto explicito -- quem digita sabe o que esta pedindo.
 */
export const SEARCH_TERM_SEPARATOR = '+';

/**
 * Quebra o que foi digitado nos termos obrigatorios. Sem "+", devolve um
 * termo so -- entao quem chama nao precisa saber se tem "+" ou nao.
 *
 * Pedaco vazio e' descartado: "racao++20kg" e "racao + 20kg " valem o mesmo
 * que "racao+20kg". Quem digita rapido no balcao nao vai medir espaco.
 */
export const splitSearchTerms = (value: unknown): string[] => (
  String(value ?? '')
    .split(SEARCH_TERM_SEPARATOR)
    .map((parte) => parte.trim())
    .filter((parte) => parte !== '')
);

/**
 * Casa TODOS os termos digitados contra os campos informados: cada termo tem
 * que aparecer em pelo menos um campo, e acento/caixa nao contam.
 *
 * Um termo pode bater num campo e outro termo em outro -- procurar
 * "racao+premium" acha o produto que tem "Racao" no nome e "Premium" na
 * marca. Isso e' de proposito: pra quem busca, os dois sao "o produto".
 *
 * Termo vazio devolve `true` (nao filtra nada), que e' o comportamento
 * esperado de campo de busca em branco.
 */
export const matchesAllSearchTerms = (campos: unknown[], termo: unknown): boolean => {
  const termos = splitSearchTerms(termo);
  if (termos.length === 0) return true;

  const camposNormalizados = campos
    .map((campo) => normalizeSearchText(campo))
    .filter((campo) => campo !== '');

  return termos.every((parte) => {
    const parteNormalizada = normalizeSearchText(parte);
    return camposNormalizados.some((campo) => campo.includes(parteNormalizada));
  });
};

/**
 * Dica de uso do "+", pra colar no placeholder dos campos de busca.
 *
 * Existe porque recurso que ninguem descobre nao serve pra nada: o "+" so
 * ajuda o balcao se estiver escrito na frente de quem digita. Fica numa
 * constante unica pra dica ser a MESMA em toda tela -- o operador aprende uma
 * vez e reconhece nas outras.
 */
export const DICA_BUSCA_MULTIPLA = 'use + entre palavras (ração+20kg)';
