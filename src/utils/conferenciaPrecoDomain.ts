/*
 * PRECO DE CADA ITEM CONFERIDO (21/10/2026, auditoria "so' a tela protege").
 *
 * Ate' aqui o servidor refazia a conta da venda, mas o PRECO de cada item vinha
 * da tela: pelo DevTools dava para mandar o item mais barato sem passar pelo
 * limite de desconto. Decisoes do dono (21/10/2026, caixinhas):
 *
 *  - preco ABAIXO do preco do sistema (preco de venda, a vista ou a promocao
 *    que vale hoje, na unidade vendida) conta como DESCONTO: a diferenca soma
 *    no desconto do item e passa pelos mesmos limites (do produto, da tela,
 *    total e liberacao por senha). Preco acima do sistema e' livre;
 *  - pre-venda ou orcamento feito antes de o preco do cadastro subir mantem o
 *    preco combinado, e a diferenca conta como desconto (a mesma regra);
 *  - servico da OS (mao de obra) e item avulso: valor livre.
 *
 * O Pedido de Venda ja' fazia isso ao digitar (preco abaixo da tabela vira
 * desconto do item). Agora a tela e o servidor fazem a MESMA conta, aqui; o
 * servidor com o cadastro, as promocoes e as quotas lidos do banco.
 *
 * A promocao so' vale dentro da quota e do limite por venda (promocaoDomain):
 * a linha que passa do que a promocao ainda libera e' conferida pelo preco
 * normal.
 *
 * Regra pura: sem tela, sem Firestore.
 */
import { toCents } from './financeDomain';
import { buildOpcoesUnidadeVenda, findOpcaoUnidadeVenda, toBaseQuantity, type ProdutoComEmbalagens } from './embalagemDomain';
import { precoAutomatico, tabelaDoProduto, type CondicaoPagamento, type TabelaDePrecoDoItem } from './precoVendaDomain';
import { promocaoDoProduto, quantidadeLiberadaNaPromocao, type PromocaoComId } from './promocaoDomain';

export interface ProdutoParaPreco extends ProdutoComEmbalagens {
  precoAVista?: unknown;
}

export interface ItemParaPreco {
  id: string;
  nome: string;
  precoUnitario: number;
  quantidade: number;
  /** Desconto do item em R$ (0 quando a tela nao tem desconto por item). */
  desconto?: number;
  embalagemId?: unknown;
  fatorConversao?: unknown;
  /** Bonificacao (30/10/2026): item de brinde, a preco zero de proposito -- nao confere. */
  bonificado?: unknown;
}

export interface PrecoConferido {
  /** Preco do sistema na unidade vendida; 0 = item sem cadastro ou sem preco (nao confere). */
  precoSistema: number;
  /** Valor cheio da linha: o cobrado, ou o do sistema quando o cobrado e' menor. */
  brutoCentavos: number;
  /** Desconto do item + a diferenca para o preco do sistema. */
  descontoCentavos: number;
  /** Quanto o preco cobrado ficou abaixo do sistema, na linha inteira. */
  diferencaCentavos: number;
}

export interface ResultadoDaConferencia {
  itens: PrecoConferido[];
  diferencaTotalCentavos: number;
}

/** Vendido de cada promocao em OUTRAS vendas: promocaoId -> produtoId -> quantidade (unidade base). */
export type VendidoPorPromocao = Record<string, Record<string, number>>;

const positivo = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Valor da linha em centavos, arredondado por linha (como brutoDaLinhaCentavos). */
const brutoDaLinha = (preco: number, quantidade: number): number => (
  Math.max(0, Math.round(toCents(preco) * quantidade))
);

/** Unidade vendida, com os precos proprios da embalagem. Embalagem que sumiu do cadastro: preco base x fator do item. */
const unidadeDoItem = (produto: ProdutoParaPreco, item: ItemParaPreco) => {
  const embalagemId = typeof item.embalagemId === 'string' ? item.embalagemId.trim() : '';
  const opcao = findOpcaoUnidadeVenda(buildOpcoesUnidadeVenda(produto), embalagemId);
  if (embalagemId && opcao.embalagemId !== embalagemId) {
    return { fatorConversao: positivo(item.fatorConversao) || 1, precoProprio: 0, precoAVistaProprio: 0 };
  }
  return { fatorConversao: opcao.fatorConversao, precoProprio: opcao.precoVendaProprio, precoAVistaProprio: opcao.precoAVistaProprio };
};

/**
 * Confere o preco de cada linha contra o do sistema. As linhas sao lidas na
 * ordem: a quota da promocao vai sendo gasta pelas linhas que pagaram o preco
 * promocional, e a que passa do que sobra e' conferida pelo preco normal.
 */
export const conferirPrecos = (args: {
  itens: ReadonlyArray<ItemParaPreco>;
  /** Cadastro de cada produto pelo id; ausente = item avulso/apagado (valor livre). */
  produtos: Readonly<Record<string, ProdutoParaPreco | null | undefined>>;
  promocoes: ReadonlyArray<PromocaoComId>;
  hoje: string;
  condicao: CondicaoPagamento;
  vendidoPorPromocao?: VendidoPorPromocao;
}): ResultadoDaConferencia => {
  const restanteDaPromocao = new Map<string, number | null>();
  let diferencaTotalCentavos = 0;

  const itens = args.itens.map((item): PrecoConferido => {
    const cobrado = brutoDaLinha(item.precoUnitario, item.quantidade);
    const descontoDoItem = toCents(positivo(item.desconto));
    const produto = item.id && item.id !== 'avulso' && item.bonificado !== true ? args.produtos[item.id] : null;
    if (!produto) return { precoSistema: 0, brutoCentavos: cobrado, descontoCentavos: descontoDoItem, diferencaCentavos: 0 };

    const unidade = unidadeDoItem(produto, item);
    const tabela: TabelaDePrecoDoItem = tabelaDoProduto(produto, unidade);
    const semPromocao = precoAutomatico(tabela, args.condicao).preco;

    // Embalagem com preco proprio nao entra em promocao (precoComPromocaoDomain).
    let comPromocao = tabela;
    let chaveDaQuota = '';
    const quantidadeBase = toBaseQuantity(item.quantidade, unidade.fatorConversao);
    if (!(unidade.precoProprio > 0) && !(unidade.precoAVistaProprio > 0)) {
      const promo = promocaoDoProduto(
        args.promocoes as PromocaoComId[],
        item.id,
        { venda: positivo(produto.precoVenda), vista: positivo(produto.precoAVista) },
        args.hoje,
      );
      if (promo) {
        chaveDaQuota = `${promo.promocaoId}|${item.id}`;
        if (!restanteDaPromocao.has(chaveDaQuota)) {
          const vendido = args.vendidoPorPromocao?.[promo.promocaoId]?.[item.id] || 0;
          restanteDaPromocao.set(chaveDaQuota, quantidadeLiberadaNaPromocao(promo, vendido, 0));
        }
        const restante = restanteDaPromocao.get(chaveDaQuota);
        if (restante === null || restante === undefined || quantidadeBase <= restante + 1e-9) {
          const fator = unidade.fatorConversao || 1;
          comPromocao = { ...tabela, promocao: { id: promo.promocaoId, nome: promo.nome, preco: Math.round(promo.preco * fator * 100) / 100, soAVista: promo.soAVista } };
        }
      }
    }
    const automatico = precoAutomatico(comPromocao, args.condicao);
    // Gasta a quota so' a linha que pagou menos que o preco normal.
    if (automatico.origem === 'promocao' && toCents(item.precoUnitario) < toCents(semPromocao)) {
      const restante = restanteDaPromocao.get(chaveDaQuota);
      if (typeof restante === 'number') restanteDaPromocao.set(chaveDaQuota, Math.max(0, restante - quantidadeBase));
    }

    const precoSistema = automatico.preco;
    const diferenca = precoSistema > 0 && toCents(item.precoUnitario) < toCents(precoSistema)
      ? Math.max(0, brutoDaLinha(precoSistema, item.quantidade) - cobrado)
      : 0;
    diferencaTotalCentavos += diferenca;
    return { precoSistema, brutoCentavos: cobrado + diferenca, descontoCentavos: descontoDoItem + diferenca, diferencaCentavos: diferenca };
  });

  return { itens, diferencaTotalCentavos };
};

const reais = (centavos: number) => `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`;

/** Explica, antes do problema do desconto, que o preco abaixo do sistema virou desconto. */
export const explicacaoDaDiferenca = (item: Pick<ItemParaPreco, 'nome' | 'precoUnitario'>, conferido: PrecoConferido): string => (
  conferido.diferencaCentavos > 0
    ? `${item.nome} está a ${reais(toCents(item.precoUnitario))}, abaixo do preço do sistema (${reais(toCents(conferido.precoSistema))}): a diferença conta como desconto. `
    : ''
);
