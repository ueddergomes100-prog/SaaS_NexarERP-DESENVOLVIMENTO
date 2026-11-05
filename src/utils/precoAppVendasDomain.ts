/*
 * PRECO DO ITEM NO APP VENDAS, COM PROMOCAO (19/10/2026).
 *
 * O app (pedido, orcamento, pecas da OS e "Consultar preco") passa a usar a
 * mesma tabela do desktop (precoComPromocaoDomain): o item leva o preco da
 * promocao que vale hoje e grava `tabelaPreco` / `origemPreco` / `promocaoId`,
 * como no Pedido de Venda, PDV, Orcamento e OS.
 *
 * O app nao escolhe forma de pagamento: o pedido vira pre-venda e a loja
 * recebe no balcao. Por isso o preco do app e' o A PRAZO (preco de venda, ou
 * a promocao "todas as formas"). Quando a loja recebe a vista, o Pedido de
 * Venda troca sozinho para o preco a vista / promocao "so a vista" a partir da
 * `tabelaPreco` gravada aqui (reprecificarItens).
 *
 * Quota e limite por venda (so' o pedido consome quota; orcamento e OS nao,
 * como no desktop): quantidade acima do que sobra entra no preco normal, com
 * aviso. Promocao COM QUOTA precisa saber quanto ja' saiu, o que exige
 * internet: sem essa conferencia (app offline) o item entra no preco normal,
 * com aviso -- melhor do que vender alem da quota que a loja definiu.
 */
import { camposDePrecoDoItem, type CamposDePrecoDoItem, type ProdutoPrecificavel } from './precoComPromocaoDomain';
import { precoAutomatico, type CondicaoPagamento, type OrigemPreco, type TabelaDePrecoDoItem } from './precoVendaDomain';
import type { PromocaoDoProduto } from './promocaoDomain';

/** O app nao escolhe pagamento: vale o preco a prazo (a loja ajusta ao receber). */
export const CONDICAO_DO_APP: CondicaoPagamento = 'prazo';

/** O que o app precisa do usePromocoesVigentes. */
export interface PrecosDoApp {
  tabelaDe: (produto: ProdutoPrecificavel) => TabelaDePrecoDoItem;
  quantidadeLiberada: (produto: ProdutoPrecificavel, jaNestaVenda: number) => { promo: PromocaoDoProduto; liberada: number | null } | null;
  /** false = nao deu para saber quanto ja' saiu das promocoes com quota (sem internet). */
  quotaConferida: boolean;
}

export interface LinhaJaNaVenda {
  id: string;
  quantidade: number;
  promocaoId?: string;
}

export interface PrecoNoApp {
  preco: number;
  /** null = sem tabela de promocoes carregada (preco de venda puro). */
  campos: CamposDePrecoDoItem | null;
  /** Aviso em portugues quando o item ficou fora da promocao. */
  aviso: string | null;
}

/**
 * Preco do item no app. `consomeQuota`: pedido (true) confere quota e limite
 * por venda; orcamento e OS (false) nao. `naVenda`: as linhas que ja' estao no
 * pedido (inclusive as que acabaram de entrar no mesmo lote).
 */
export const precificarNoApp = (args: {
  precos: PrecosDoApp | null | undefined;
  produto: ProdutoPrecificavel & { nome?: string };
  quantidade: number;
  naVenda: ReadonlyArray<LinhaJaNaVenda>;
  consomeQuota: boolean;
}): PrecoNoApp => {
  const { precos, produto, quantidade, naVenda, consomeQuota } = args;
  if (!precos) {
    const preco = Number(produto.precoVenda) || 0;
    return { preco, campos: null, aviso: null };
  }
  let tabela = precos.tabelaDe(produto);
  let aviso: string | null = null;
  // So' confere quando a promocao vale no preco do app (a prazo); a "so a vista"
  // nao entra aqui -- fica na tabela para a loja aplicar se receber a vista.
  if (consomeQuota && tabela.promocao && !tabela.promocao.soAVista) {
    const promoId = tabela.promocao.id;
    const jaNestaVenda = naVenda
      .filter((l) => l.id === produto.id && l.promocaoId === promoId)
      .reduce((t, l) => t + (Number(l.quantidade) || 0), 0);
    const conferencia = precos.quantidadeLiberada(produto, jaNestaVenda);
    const nome = produto.nome || 'Produto';
    if (conferencia && conferencia.promo.quota !== null && !precos.quotaConferida) {
      tabela = { ...tabela, promocao: null };
      aviso = `${nome}: a promoção "${conferencia.promo.nome}" tem quantidade limitada e precisa de internet para conferir quanto ainda sobra. O item entrou no preço normal.`;
    } else if (conferencia && conferencia.liberada !== null && quantidade > conferencia.liberada) {
      tabela = { ...tabela, promocao: null };
      aviso = conferencia.liberada > 0
        ? `${nome}: a promoção "${conferencia.promo.nome}" só libera mais ${conferencia.liberada} unidade(s) neste pedido. O item entrou no preço normal.`
        : `${nome}: a quantidade da promoção "${conferencia.promo.nome}" acabou. O item entrou no preço normal.`;
    }
  }
  const { preco, campos } = camposDePrecoDoItem(tabela, CONDICAO_DO_APP);
  return { preco, campos, aviso };
};

/*
 * TROCAR O PRECO DO ITEM NO APP (05/11/2026, pedido de cliente; permissao
 * "App: Alterar o preco do item", permissoesAppDomain.ts).
 *
 * Mesma regra do Pedido de Venda: preco digitado diferente do automatico vira
 * 'manual' e nao muda mais sozinho ao receber a vista; quem digita o preco da
 * tabela de novo volta ao automatico (com a promocao, se era o caso). Item
 * 'manual' nao leva promocaoId: nao consome a quota da promocao.
 *
 * O dinheiro continua protegido no faturamento (conferenciaPrecoDomain.ts,
 * decisao do dono de 21/10/2026): preco abaixo do sistema conta como desconto
 * e passa pelos limites e pela liberacao. Acima e' livre.
 */
export interface ItemComPrecoDoApp {
  precoUnitario: number;
  quantidade: number;
  subtotal: number;
  tabelaPreco?: TabelaDePrecoDoItem;
  origemPreco?: OrigemPreco;
  promocaoId?: string;
  promocaoNome?: string;
}

/**
 * Le o que a pessoa digitou, em reais: "129,90", "1.250,50", "129.90", "1.250".
 * null = nao e' um preco (texto, vazio, zero ou negativo). Ponto seguido de
 * 3 digitos e' milhar; os outros sao decimal -- teclado de celular pode dar ponto
 * no lugar da virgula, e ler "129.90" como 12.990 seria um erro caro.
 */
export const lerPrecoDigitado = (texto: string): number | null => {
  const limpo = String(texto ?? '').trim().replace(/^r\$\s*/i, '').replace(/\s/g, '');
  let normal: string;
  if (/^\d+(\.\d{3})*,\d{1,2}$/.test(limpo)) normal = limpo.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(limpo)) normal = limpo.replace(/\./g, '');
  else if (/^\d+(\.\d{1,2})?$/.test(limpo)) normal = limpo;
  else return null;
  const valor = Math.round(Number(normal) * 100) / 100;
  return Number.isFinite(valor) && valor > 0 ? valor : null;
};

export const trocarPrecoDoItem = <T extends ItemComPrecoDoApp>(item: T, precoNovo: number): T => {
  const digitado = Math.round(precoNovo * 100) / 100;
  // Sem chave undefined no Firestore: as da promocao saem, e voltam so' se valerem.
  const resto: T = { ...item };
  delete resto.promocaoId;
  delete resto.promocaoNome;
  const subtotal = (preco: number) => Math.round(preco * (Number(item.quantidade) || 0) * 100) / 100;
  if (!item.tabelaPreco) return { ...resto, precoUnitario: digitado, origemPreco: 'manual', subtotal: subtotal(digitado) };
  const { preco, campos } = camposDePrecoDoItem(item.tabelaPreco, CONDICAO_DO_APP, digitado);
  return { ...resto, ...campos, precoUnitario: preco, subtotal: subtotal(preco) };
};

/** Preco que o sistema poria no item, para mostrar ao lado do alterado. 0 = sem tabela. */
export const precoDaTabelaDoItem = (item: Pick<ItemComPrecoDoApp, 'tabelaPreco'>): number => (
  item.tabelaPreco ? precoAutomatico(item.tabelaPreco, CONDICAO_DO_APP).preco : 0
);

/** O que mostrar na busca: preco da promocao de hoje (e se e' so' a vista). null = sem promocao. */
export const promocaoParaMostrar = (precos: PrecosDoApp | null | undefined, produto: ProdutoPrecificavel): { preco: number; soAVista: boolean; nome: string } | null => {
  const promo = precos ? precos.tabelaDe(produto).promocao : null;
  return promo ? { preco: promo.preco, soAVista: promo.soAVista, nome: promo.nome } : null;
};

/** Ids das promocoes do pedido (gravado em `promocaoIds`, e' por ele que a quota e' contada). */
export const idsDasPromocoes = (itens: ReadonlyArray<{ promocaoId?: unknown }>): string[] => (
  [...new Set(itens.map((i) => i.promocaoId).filter((p): p is string => typeof p === 'string' && p.length > 0))]
);
