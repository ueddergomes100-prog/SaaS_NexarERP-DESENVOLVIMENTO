/**
 * NOTA FISCAL "NA MAO" COM SELECAO DE ITENS (24/11/2026, pedido do dono).
 *
 * Fiscal > Notas Fiscais > Emitir, sem importar Pedido de Venda nem OS: a
 * nota NAO baixa estoque nem gera financeiro (so' transmite). Antes saia com
 * uma linha so' digitada (descricao + valor); agora os itens sao escolhidos do
 * estoque, um a um, e o total da nota vai sendo somado na hora.
 *
 * Decisoes do dono (24/11):
 *  - Ao escolher o produto entra o PRECO DE VENDA do cadastro, editavel na linha.
 *  - So' produtos cadastrados (sem linha digitada): o fiscal de cada item (NCM,
 *    CFOP, CST/CSOSN, aliquotas) vem do cadastro, como ao importar um pedido.
 *
 * Unidade ausente no cadastro: entra como UN (unidadeMedidaDomain, regra 4 do
 * CLAUDE.md) e a tela avisa. Quantidade fracionada so' se a unidade permitir.
 */
import { valorDaLinhaDaNota } from './notaFiscalItemDomain';
import { isValidSaleQuantity } from './saleQuantity';
import { resolveUnidadeMedidaProduto, temUnidadeMedidaCadastrada } from './unidadeMedidaDomain';

export interface ItemDaNotaManual {
  id: string;
  nome: string;
  quantidade: number;
  precoUnitario: number;
  desconto: number;
  valorTotal: number;
  unidadeMedidaSigla?: string;
  unidadeMedidaFracionado?: boolean;
  unidadeMedidaCasasDecimais?: number;
}

export interface ProdutoParaNotaManual {
  id: string;
  nome?: string | null;
  precoVenda?: unknown;
  unidadeMedidaSigla?: unknown;
  unidadeMedidaFracionado?: unknown;
  unidadeMedidaCasasDecimais?: unknown;
}

const centavos = (v: number): number => Math.round((Number(v) || 0) * 100) / 100;
const milesimos = (q: number): number => Math.round((Number(q) || 0) * 1000) / 1000;

/** Numero digitado na tela: "1.234,56", "12,5" ou "12.5". Vazio ou invalido = 0. */
export const lerNumeroDigitado = (texto: unknown): number => {
  let s = String(texto ?? '').trim();
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

/** Valor da linha que vai na nota: quantidade x preco (arredondado como a nota) menos o desconto. */
export const totalDaLinhaManual = (item: Pick<ItemDaNotaManual, 'quantidade' | 'precoUnitario' | 'desconto'>): number => (
  centavos(Math.max(0, valorDaLinhaDaNota(item.quantidade, item.precoUnitario) - (Number(item.desconto) || 0)))
);

export const totalDaNotaManual = (itens: ReadonlyArray<Pick<ItemDaNotaManual, 'quantidade' | 'precoUnitario' | 'desconto'>>): number => (
  centavos(itens.reduce((soma, item) => soma + totalDaLinhaManual(item), 0))
);

/** Recalcula o valorTotal da linha (o campo que a montagem da nota tambem le). */
export const comTotalAtualizado = <T extends ItemDaNotaManual>(item: T): T => ({ ...item, valorTotal: totalDaLinhaManual(item) });

/**
 * Item novo a partir do produto do estoque. Produto que ja' esta' na nota soma
 * 1 na quantidade em vez de abrir outra linha. `semUnidade` diz a tela para
 * mostrar o aviso de unidade ausente.
 */
export const adicionarProdutoNaNotaManual = <T extends ItemDaNotaManual>(
  itens: T[],
  produto: ProdutoParaNotaManual,
  montarItem: (base: ItemDaNotaManual) => T,
): { itens: T[]; semUnidade: boolean; somouNaLinha: boolean } => {
  const existente = itens.findIndex((it) => it.id === produto.id);
  if (existente >= 0) {
    const atualizados = itens.map((it, i) => (i === existente ? comTotalAtualizado({ ...it, quantidade: milesimos(it.quantidade + 1) }) : it));
    return { itens: atualizados, semUnidade: false, somouNaLinha: true };
  }
  const unidade = resolveUnidadeMedidaProduto({
    unidadeMedidaSigla: produto.unidadeMedidaSigla as string | undefined,
    unidadeMedidaFracionado: produto.unidadeMedidaFracionado as boolean | undefined,
    unidadeMedidaCasasDecimais: produto.unidadeMedidaCasasDecimais as number | undefined,
  });
  const preco = centavos(Math.max(0, Number(produto.precoVenda) || 0));
  const base = comTotalAtualizado<ItemDaNotaManual>({
    id: produto.id,
    nome: String(produto.nome || '').trim() || 'Produto sem nome',
    quantidade: 1,
    precoUnitario: preco,
    desconto: 0,
    valorTotal: preco,
    unidadeMedidaSigla: unidade.unidadeMedidaSigla,
    unidadeMedidaFracionado: unidade.unidadeMedidaFracionado,
    unidadeMedidaCasasDecimais: unidade.unidadeMedidaCasasDecimais,
  });
  return {
    itens: [...itens, montarItem(base)],
    semUnidade: !temUnidadeMedidaCadastrada({ unidadeMedidaSigla: produto.unidadeMedidaSigla as string | undefined }),
    somouNaLinha: false,
  };
};

/** Confere os itens antes de montar a nota. Mensagem em portugues dizendo o que fazer, ou null. */
export const validarItensDaNotaManual = (itens: ReadonlyArray<ItemDaNotaManual>): string | null => {
  if (!itens.length) {
    return 'Escolha pelo menos um produto na aba "2. Detalhamento dos Produtos" (busque pelo nome, código ou "#").';
  }
  for (const item of itens) {
    const fracionado = item.unidadeMedidaFracionado === true;
    if (!isValidSaleQuantity(Number(item.quantidade), fracionado, item.unidadeMedidaCasasDecimais)) {
      return fracionado
        ? `A quantidade de "${item.nome}" está inválida: use um número maior que zero com no máximo ${item.unidadeMedidaCasasDecimais ?? 0} casa(s) decimal(is).`
        : `A quantidade de "${item.nome}" precisa ser inteira e maior que zero (a unidade ${item.unidadeMedidaSigla || 'UN'} não aceita fração).`;
    }
    if (!(Number(item.precoUnitario) > 0)) {
      return `Informe o preço de "${item.nome}" (está zerado). A nota não sai com item de valor zero.`;
    }
    const bruto = valorDaLinhaDaNota(item.quantidade, item.precoUnitario);
    const desconto = Number(item.desconto) || 0;
    if (desconto < 0 || desconto >= bruto) {
      return `O desconto de "${item.nome}" precisa ser menor que o valor da linha (R$ ${bruto.toFixed(2).replace('.', ',')}).`;
    }
  }
  return null;
};

/** Descricao da nota (aparece na lista de notas): quantidade e nome dos itens, curta. */
export const descricaoDaNotaManual = (itens: ReadonlyArray<Pick<ItemDaNotaManual, 'nome' | 'quantidade'>>): string => {
  if (!itens.length) return '';
  const texto = itens.map((it) => `${String(it.quantidade).replace('.', ',')}x ${it.nome}`).join(', ');
  return texto.length > 300 ? `${texto.slice(0, 297)}...` : texto;
};
