/*
 * PRECO DO ITEM COM PROMOCAO -- a mesma conta do Pedido de Venda, agora
 * compartilhada com PDV, Orcamento e OS (2026-10-06; ate' aqui a promocao so'
 * valia no Pedido de Venda).
 *
 * tabelaDoProduto (precoVendaDomain) da' venda/a vista na unidade vendida;
 * promocaoDoProduto (promocaoDomain) diz a promocao que vale hoje. Aqui as
 * duas se juntam na "tabela do item", e precoAutomatico escolhe o preco pela
 * condicao de pagamento (a vista / a prazo). Regras que valem igual nas
 * quatro telas:
 *  - embalagem com preco PROPRIO (venda ou a vista) nao entra em promocao: a
 *    promocao e' do kg, o preco do saco foi negociado a parte;
 *  - preco digitado diferente do automatico vira 'manual' e nao muda mais.
 */
import { promocaoDoProduto, type PromocaoComId } from './promocaoDomain';
import {
  precoAutomatico,
  tabelaDoProduto,
  type CondicaoPagamento,
  type OrigemPreco,
  type TabelaDePrecoDoItem,
} from './precoVendaDomain';

export interface ProdutoPrecificavel {
  id: string;
  precoVenda?: unknown;
  precoAVista?: unknown;
  /** Aba "Atacado" do produto (precoVendaDomain.faixasDeAtacadoDoProduto). */
  atacado?: unknown;
}

export interface UnidadeDoItem {
  fatorConversao?: number;
  precoProprio?: number;
  precoAVistaProprio?: number;
}

const positivo = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Tabela do produto (venda, a vista) ja' com a promocao que vale hoje, na unidade escolhida. */
export const tabelaComPromocao = (
  produto: ProdutoPrecificavel,
  promocoes: ReadonlyArray<PromocaoComId>,
  hoje: string,
  unidade: UnidadeDoItem = {},
): TabelaDePrecoDoItem => {
  const tabela = tabelaDoProduto(produto, unidade);
  if (positivo(unidade.precoProprio) > 0 || positivo(unidade.precoAVistaProprio) > 0) return tabela;
  const promo = promocaoDoProduto(
    promocoes as PromocaoComId[],
    produto.id,
    { venda: positivo(produto.precoVenda), vista: positivo(produto.precoAVista) },
    hoje,
  );
  if (!promo) return tabela;
  const fator = positivo(unidade.fatorConversao) || 1;
  return {
    ...tabela,
    promocao: { id: promo.promocaoId, nome: promo.nome, preco: Math.round(promo.preco * fator * 100) / 100, soAVista: promo.soAVista },
  };
};

export interface CamposDePrecoDoItem {
  tabelaPreco: TabelaDePrecoDoItem;
  origemPreco: OrigemPreco;
  promocaoId?: string;
  promocaoNome?: string;
}

/**
 * Preco do item e os campos de rastreio gravados junto. `precoDigitado`
 * diferente do automatico = 'manual' (a pessoa quis outro preco). Sem chave
 * `undefined`: promocaoId/Nome so' entram quando o preco veio da promocao.
 */
export const camposDePrecoDoItem = (
  tabela: TabelaDePrecoDoItem,
  condicao: CondicaoPagamento,
  precoDigitado?: number,
  /** Quantidade do item na unidade vendida (atacado). */
  quantidade = 0,
): { preco: number; campos: CamposDePrecoDoItem } => {
  const auto = precoAutomatico(tabela, condicao, quantidade);
  const manual = precoDigitado !== undefined && precoDigitado > 0 && Math.abs(precoDigitado - auto.preco) > 0.0001;
  const origem: OrigemPreco = manual ? 'manual' : auto.origem;
  return {
    preco: manual ? (precoDigitado as number) : auto.preco,
    campos: {
      tabelaPreco: tabela,
      origemPreco: origem,
      ...(origem === 'promocao' && tabela.promocao ? { promocaoId: tabela.promocao.id, promocaoNome: tabela.promocao.nome } : {}),
    },
  };
};

/**
 * Quantidade do item mudou: o preco automatico acompanha (faixa de atacado,
 * 22/11/2026). null = item sem tabela ou com preco digitado -- fica como esta.
 * Quem usa troca promocaoId/promocaoNome pelos de `campos` (sem undefined).
 */
export const reprecificarPelaQuantidade = (
  item: { tabelaPreco?: TabelaDePrecoDoItem; origemPreco?: OrigemPreco; bonificado?: unknown },
  condicao: CondicaoPagamento,
  quantidade: number,
): { preco: number; campos: CamposDePrecoDoItem } | null => (
  item.tabelaPreco && item.origemPreco !== 'manual' && item.bonificado !== true
    ? camposDePrecoDoItem(item.tabelaPreco, condicao, undefined, quantidade)
    : null
);

/** Preco que o campo "Preco" sugere ao escolher o produto (sem nada digitado). */
export const precoSugeridoDoItem = (tabela: TabelaDePrecoDoItem, condicao: CondicaoPagamento, quantidade = 0): number => (
  precoAutomatico(tabela, condicao, quantidade).preco
);
