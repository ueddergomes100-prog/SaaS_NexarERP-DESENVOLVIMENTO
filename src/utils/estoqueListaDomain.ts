/**
 * LISTA DE ESTOQUE: ORDEM E FILTRO PELO SALDO (26/10/2026, pedido do dono).
 *
 * "Um botaozinho pra reorganizar com mais e menos estoque, e um filtro dos
 * negativos e zerados." Conta a coluna "Qtd." (saldo fisico). Produto com grade:
 * o principal vale a soma das variacoes (quem chama ja' passa o saldo somado).
 */

/** Ordem da coluna "Qtd.": padrao (pelo codigo), maior estoque primeiro, menor primeiro. */
export type OrdemSaldo = 'padrao' | 'maior' | 'menor';

/** Proximo clique no botao da coluna: padrao -> maior -> menor -> padrao. */
export const proximaOrdemSaldo = (atual: OrdemSaldo): OrdemSaldo => (
  atual === 'padrao' ? 'maior' : atual === 'maior' ? 'menor' : 'padrao'
);

export const ROTULO_ORDEM_SALDO: Record<OrdemSaldo, string> = {
  padrao: 'Ordenar pela quantidade (maior primeiro)',
  maior: 'Maior estoque primeiro — clique para o menor primeiro',
  menor: 'Menor estoque primeiro — clique para voltar à ordem do código',
};

/** Filtro pelo saldo. */
export type FiltroSaldo = 'todos' | 'com_estoque' | 'zerados' | 'negativos' | 'zerados_negativos';

export const ROTULO_FILTRO_SALDO: Record<FiltroSaldo, string> = {
  todos: 'Qualquer saldo',
  com_estoque: 'Com estoque',
  zerados: 'Zerados',
  negativos: 'Negativos',
  zerados_negativos: 'Zerados e negativos',
};

/** Arredondamento de quantidade fracionada (0,0000001 conta como zero). */
const EPSILON = 1e-9;

const saldo = (quantidade: unknown): number => {
  const n = Number(quantidade);
  return Number.isFinite(n) ? n : 0;
};

/** O saldo entra no filtro escolhido? */
export const saldoPassaNoFiltro = (quantidade: unknown, filtro: FiltroSaldo): boolean => {
  const q = saldo(quantidade);
  const zerado = Math.abs(q) < EPSILON;
  if (filtro === 'todos') return true;
  if (filtro === 'com_estoque') return q >= EPSILON;
  if (filtro === 'zerados') return zerado;
  if (filtro === 'negativos') return q <= -EPSILON;
  return zerado || q <= -EPSILON;
};

/**
 * Ordena as linhas pelo saldo sem perder a ordem original nos empates
 * (mesmo saldo continua na ordem do codigo). 'padrao' devolve como veio.
 */
export const ordenarPorSaldo = <T>(linhas: T[], ordem: OrdemSaldo, saldoDe: (linha: T) => unknown): T[] => {
  if (ordem === 'padrao') return linhas;
  const sinal = ordem === 'maior' ? -1 : 1;
  return linhas
    .map((linha, indice) => ({ linha, indice, q: saldo(saldoDe(linha)) }))
    .sort((a, b) => (a.q === b.q ? a.indice - b.indice : (a.q - b.q) * sinal))
    .map((x) => x.linha);
};
