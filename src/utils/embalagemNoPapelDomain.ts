/*
 * EMBALAGEM NO PAPEL DO PEDIDO (26/11/2026, pedido do dono, Embala Minas).
 *
 * O papel saia "QTD 1 · 75,60" para 1 CAIXA de um produto vendido em pacote
 * com 10 e caixa com 300: o cliente nao sabia quanto estava levando. Agora a
 * linha do item diz a quantidade NA EMBALAGEM ("1 CX") e, embaixo da
 * descricao, quanto isso da':
 *
 *   1 CX = 30 PCT de 10 UN = 300 UN
 *
 * A embalagem do meio (PCT) e' a maior embalagem ativa do produto que cabe um
 * numero inteiro de vezes na vendida; sem ela, so' "1 CX = 300 UN".
 *
 * So' para item vendido em embalagem (`embalagemId` e fator > 1). Item na
 * unidade do estoque nao ganha linha nenhuma. A unidade do estoque vem do
 * cadastro do produto; sem ela, `UN` (CLAUDE.md, regra 4).
 *
 * Regra pura: sem tela e sem Firestore.
 */
import { normalizeEmbalagens } from './embalagemDomain';
import { UNIDADE_MEDIDA_FALLBACK } from './unidadeMedidaDomain';

export interface ItemComEmbalagem {
  quantidade?: unknown;
  unidadeMedidaSigla?: unknown;
  embalagemId?: unknown;
  fatorConversao?: unknown;
}

export interface ProdutoDoPapel {
  /** Unidade do estoque do produto (a base das embalagens). */
  siglaBase?: unknown;
  /** Campo `embalagens` cru do cadastro. */
  embalagens?: unknown;
}

const numero = (valor: unknown): number => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};

const sigla = (valor: unknown): string => String(valor ?? '').trim().toUpperCase();

/** 300 -> "300"; 2,5 -> "2,5" (sem casas de sobra). */
const escrito = (n: number): string => (Math.round(n * 1000) / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

const inteiro = (n: number): boolean => Math.abs(n - Math.round(n)) < 1e-9;

/** Quantidade com a unidade em que o item foi vendido: "1 CX", "2,5 KG". */
export const quantidadeComUnidade = (item: ItemComEmbalagem, casasDecimais = 0): string => {
  const qtd = numero(item.quantidade).toLocaleString('pt-BR', { minimumFractionDigits: casasDecimais, maximumFractionDigits: casasDecimais });
  const un = sigla(item.unidadeMedidaSigla) || UNIDADE_MEDIDA_FALLBACK.unidadeMedidaSigla;
  return `${qtd} ${un}`;
};

/**
 * "1 CX = 30 PCT de 10 UN = 300 UN", ou '' quando o item nao foi vendido em
 * embalagem (ou o fator nao faz sentido).
 */
export const composicaoDaEmbalagemNoPapel = (item: ItemComEmbalagem, produto: ProdutoDoPapel | null | undefined): string => {
  const fator = numero(item.fatorConversao);
  if (!String(item.embalagemId ?? '').trim() || !(fator > 1)) return '';
  const quantidade = numero(item.quantidade);
  if (!(quantidade > 0)) return '';
  const vendida = sigla(item.unidadeMedidaSigla);
  const base = sigla(produto?.siglaBase) || UNIDADE_MEDIDA_FALLBACK.unidadeMedidaSigla;
  if (!vendida || vendida === base) return '';

  const totalBase = quantidade * fator;
  const meio = normalizeEmbalagens(produto?.embalagens)
    .filter((e) => e.ativo && e.fatorConversao > 1 && e.fatorConversao < fator && inteiro(fator / e.fatorConversao))
    .filter((e) => e.unidadeMedidaSigla && e.unidadeMedidaSigla.toUpperCase() !== vendida && e.unidadeMedidaSigla.toUpperCase() !== base)
    .sort((a, b) => b.fatorConversao - a.fatorConversao)[0];

  const inicio = `${escrito(quantidade)} ${vendida}`;
  const fim = `${escrito(totalBase)} ${base}`;
  if (!meio) return `${inicio} = ${fim}`;
  const quantosMeio = totalBase / meio.fatorConversao;
  return `${inicio} = ${escrito(quantosMeio)} ${meio.unidadeMedidaSigla.toUpperCase()} de ${escrito(meio.fatorConversao)} ${base} = ${fim}`;
};
