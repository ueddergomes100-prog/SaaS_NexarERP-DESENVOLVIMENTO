/*
 * CUSTO EXTRA NA ENTRADA DE XML (25/11/2026, Embala Minas, decisao do dono).
 *
 * "Lancar um custo extra, na nota XML, sem somar no XML: esse custo vai ratear
 * somente em cima do custo dos produtos, ter o botao de aplicar em todos e
 * poder colocar em um por um."
 *
 *  - NAO muda o total da nota, as parcelas nem o financeiro: so' o CUSTO dos
 *    produtos que entram no estoque (custo medio, preco sugerido).
 *  - Cada item tem o seu custo extra: em % (sobre o custo do item) ou em R$
 *    (valor da linha inteira, nao por unidade).
 *  - "Aplicar em todos": % vale o mesmo percentual em cada item; R$ e'
 *    RATEADO pelo custo de cada item (quem custou mais leva mais), fechando
 *    centavo a centavo no valor digitado. Depois da pra mexer item a item.
 *
 * Regra pura: sem tela, sem Firestore.
 */
import { ratearValorPorPesos } from './notaAvulsaDomain';
import { arredondarCusto } from './custoProducaoDomain';
import type { CustoDoItemDeEntrada } from './custoEntradaDomain';

export type TipoCustoExtra = 'percentual' | 'valor';

export interface CustoExtraDoItem {
  tipo: TipoCustoExtra;
  /** % (tipo percentual) ou R$ da linha inteira (tipo valor). */
  valor: number;
}

export const CUSTO_EXTRA_VAZIO: CustoExtraDoItem = { tipo: 'valor', valor: 0 };

/** Acima disto o % quase sempre e' digitacao errada (1000 no lugar de 10,00). */
export const PERCENTUAL_MAXIMO_CUSTO_EXTRA = 500;

const centavos = (valor: number): number => Math.round((valor + Number.EPSILON) * 100) / 100;
const numero = (valor: unknown): number => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};

/** Quanto, em reais, o custo extra soma no custo da linha. */
export const valorDoCustoExtra = (custoDoItem: number, extra: CustoExtraDoItem | null | undefined): number => {
  if (!extra) return 0;
  const valor = Math.max(0, numero(extra.valor));
  if (valor <= 0) return 0;
  if (extra.tipo === 'percentual') return centavos(Math.max(0, numero(custoDoItem)) * valor / 100);
  return centavos(valor);
};

/**
 * "Aplicar em todos". `custos` = custo de cada item SEM o extra (o que pesa
 * no rateio do R$). Devolve o custo extra de cada item, para a tela guardar
 * (e a pessoa poder mudar um por um depois).
 */
export const aplicarCustoExtraEmTodos = (custos: number[], tipo: TipoCustoExtra, valor: number): CustoExtraDoItem[] => {
  const total = Math.max(0, numero(valor));
  if (tipo === 'percentual') return custos.map(() => ({ tipo: 'percentual', valor: total }));
  const partes = ratearValorPorPesos(total, custos.map((c) => Math.max(0, numero(c))));
  return partes.map((parte) => ({ tipo: 'valor', valor: parte }));
};

/** Confere o que foi digitado (um item ou o "aplicar em todos"). Mensagem em portugues, ou null. */
export const erroDoCustoExtra = (tipo: TipoCustoExtra, valor: number, nomeDoItem = ''): string | null => {
  const v = numero(valor);
  const onde = nomeDoItem ? ` de "${nomeDoItem}"` : '';
  if (v < 0) return `O custo extra${onde} não pode ser negativo. Para tirar, deixe em zero.`;
  if (tipo === 'percentual' && v > PERCENTUAL_MAXIMO_CUSTO_EXTRA) {
    return `O custo extra${onde} ficou em ${v.toLocaleString('pt-BR')}%. Confira o número: acima de ${PERCENTUAL_MAXIMO_CUSTO_EXTRA}% quase sempre é digitação errada.`;
  }
  return null;
};

/**
 * Custos da entrada com o extra somado. `custoExtra` fica no item para a tela
 * mostrar "+ custo extra" na formacao do custo e para a gravacao guardar.
 */
export const comCustoExtra = <T extends Pick<CustoDoItemDeEntrada, 'custoTotal' | 'custoUnitarioNota'>>(
  custos: T[],
  extras: ReadonlyArray<CustoExtraDoItem | null | undefined>,
  quantidades: number[],
): Array<T & { custoExtra: number }> => custos.map((custo, indice) => {
  const extra = valorDoCustoExtra(custo.custoTotal, extras[indice]);
  if (extra <= 0) return { ...custo, custoExtra: 0 };
  const custoTotal = centavos(custo.custoTotal + extra);
  const quantidade = numero(quantidades[indice]);
  return {
    ...custo,
    custoExtra: extra,
    custoTotal,
    custoUnitarioNota: quantidade > 0 ? arredondarCusto(custoTotal / quantidade) : custo.custoUnitarioNota,
  };
});

/** Soma do custo extra de todos os itens (aviso na tela). */
export const totalDoCustoExtra = (custos: ReadonlyArray<{ custoExtra?: number }>): number => (
  centavos(custos.reduce((soma, c) => soma + Math.max(0, numero(c.custoExtra)), 0))
);
