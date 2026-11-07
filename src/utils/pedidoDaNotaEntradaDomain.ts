/*
 * MONTAR O PEDIDO DE VENDA A PARTIR DE UMA NF-e DE ENTRADA (07/11/2026, pedido
 * do dono): "pegar os itens e as quantidades que vieram de uma determinada nota
 * de entrada". As quantidades vem da nota; o PRECO a pessoa escolhe na hora:
 * o de venda do cadastro (padrao, decisao do dono) ou o valor unitario do XML
 * da nota (o custo, pedido do dono em 07/11/2026).
 *
 * Valor da nota abaixo da tabela segue a MESMA regra do preco digitado na grade
 * (01/10/2026): o item fica no preco de tabela e a diferenca vira DESCONTO do
 * item, com as travas de sempre (desconto por item ligado, maximo do produto,
 * limite do Pedido de Venda). Nunca um preco abaixo da tabela sem desconto
 * registrado. Igual ou acima da tabela vira preco digitado ('manual').
 *
 * Parte pura: quais itens da nota viram linhas de venda (so' os de revenda,
 * somados por produto, na unidade do estoque) e o que fica de fora com o motivo.
 */
import type { NotaFiscalEntradaItemRecord } from './entradaNfeDomain';
import { toCents } from './financeDomain';

/** De onde vem o preco dos itens: venda do cadastro, ou o valor da nota (custo do XML). */
export type PrecoDoPedidoDaNota = 'venda' | 'nota';

export const ROTULO_PRECO_DO_PEDIDO_DA_NOTA: Record<PrecoDoPedidoDaNota, string> = {
  venda: 'Preço de venda do cadastro',
  nota: 'Valor da nota (custo do XML)',
};

export interface LinhaDaNotaParaVenda {
  produtoId: string;
  /** Nome como veio na nota (so' para o aviso quando o produto nao esta' no catalogo). */
  descricao: string;
  /** Na unidade do estoque (2 SC x 20 = 40 KG). */
  quantidade: number;
  /**
   * Valor unitario do XML por unidade do estoque (vUnCom / fator). O mesmo
   * produto em mais de uma linha da nota fica com a media ponderada.
   */
  valorUnitarioNota: number;
}

export interface ItensDaNotaParaVenda {
  linhas: LinhaDaNotaParaVenda[];
  /** Itens que nao entram na venda, com o motivo, para o aviso. */
  deFora: string[];
}

const positivo = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const arred = (v: number): number => Math.round(v * 10000) / 10000;

export const itensDaNotaParaVenda = (itens: ReadonlyArray<NotaFiscalEntradaItemRecord>): ItensDaNotaParaVenda => {
  const porProduto = new Map<string, LinhaDaNotaParaVenda>();
  // Valor total da nota por produto (quantidade da nota x valor unitario do XML), para a media.
  const valorTotal = new Map<string, number>();
  const deFora: string[] = [];
  itens.forEach((item) => {
    const descricao = String(item.descricaoXml || '').trim() || 'Item sem descrição';
    if (item.tipo === 'materia_prima' || item.tipo === 'insumo') {
      deFora.push(`${descricao} (${item.tipo === 'insumo' ? 'insumo' : 'matéria-prima'}, não é produto de venda)`);
      return;
    }
    if (item.tipo === 'registro' || !item.itemId) {
      deFora.push(`${descricao} (só registrado na nota, sem cadastro no Estoque)`);
      return;
    }
    const fator = positivo(item.fator) || 1;
    const quantidade = positivo(item.quantidadeEstoque) || arred(positivo(item.quantidade) * fator);
    if (quantidade <= 0) {
      deFora.push(`${descricao} (sem quantidade)`);
      return;
    }
    const totalDaLinha = positivo(item.valorUnitario) * (quantidade / fator);
    valorTotal.set(item.itemId, (valorTotal.get(item.itemId) || 0) + totalDaLinha);
    const atual = porProduto.get(item.itemId);
    if (atual) {
      atual.quantidade = arred(atual.quantidade + quantidade);
    } else {
      porProduto.set(item.itemId, { produtoId: item.itemId, descricao, quantidade, valorUnitarioNota: 0 });
    }
  });
  porProduto.forEach((linha) => {
    linha.valorUnitarioNota = linha.quantidade > 0 ? arred((valorTotal.get(linha.produtoId) || 0) / linha.quantidade) : 0;
  });
  return { linhas: Array.from(porProduto.values()), deFora };
};

export interface NotaEntradaParaEscolha {
  id: string;
  numeroNF?: unknown;
  fornecedorNome?: unknown;
  dataEmissao?: unknown;
  dataEntrada?: unknown;
  valorTotal?: unknown;
  status?: unknown;
  tipoDocumento?: unknown;
  itens?: unknown;
}

const dataBr = (iso: unknown): string => {
  const s = String(iso || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split('-').reverse().join('/') : '';
};

/** So' NF-e ativa com itens; a mais recente primeiro; busca por numero ou fornecedor. */
export const notasDeEntradaParaEscolha = <T extends NotaEntradaParaEscolha>(notas: ReadonlyArray<T>, termo = ''): T[] => {
  const t = termo.trim().toLowerCase();
  return notas
    .filter((n) => n.status !== 'excluida' && n.tipoDocumento !== 'nfse' && Array.isArray(n.itens) && n.itens.length > 0)
    .filter((n) => !t || String(n.numeroNF || '').toLowerCase().includes(t) || String(n.fornecedorNome || '').toLowerCase().includes(t))
    .sort((a, b) => String(b.dataEntrada || b.dataEmissao || '').localeCompare(String(a.dataEntrada || a.dataEmissao || '')));
};

export const rotuloDaNotaDeEntrada = (n: NotaEntradaParaEscolha): { titulo: string; detalhe: string } => ({
  titulo: `NF ${String(n.numeroNF || '?')} · ${String(n.fornecedorNome || 'Fornecedor não informado')}`,
  detalhe: [
    dataBr(n.dataEntrada || n.dataEmissao) ? `Entrada ${dataBr(n.dataEntrada || n.dataEmissao)}` : '',
    Array.isArray(n.itens) ? `${n.itens.length} item(ns)` : '',
    positivo(n.valorTotal) > 0 ? positivo(n.valorTotal).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '',
  ].filter(Boolean).join(' · '),
});

/** Observacao do pedido quando a pessoa nao escreveu nada. */
export const observacaoDoPedidoDaNota = (n: NotaEntradaParaEscolha, preco: PrecoDoPedidoDaNota = 'venda'): string => (
  `Montado a partir da NF-e de entrada nº ${String(n.numeroNF || '?')}${n.fornecedorNome ? ` (${String(n.fornecedorNome)})` : ''}${preco === 'nota' ? ', com o valor da nota' : ''}.`
);

/** Preco de cada linha conforme a escolha. null = usar o de venda (sem valor na nota, ou escolha "venda"). */
export const precoDaLinha = (linha: Pick<LinhaDaNotaParaVenda, 'valorUnitarioNota'>, preco: PrecoDoPedidoDaNota): number | null => (
  preco === 'nota' && linha.valorUnitarioNota > 0 ? linha.valorUnitarioNota : null
);

export interface PrecoDaNotaNoItem {
  /** Preco unitario do item: o de tabela quando a nota e' mais barata; o da nota quando e' igual ou mais cara. */
  precoUnitario: number;
  /** Preco unitario x quantidade, em centavos (base do percentual de desconto). */
  precoCheioCentavos: number;
  /** Diferenca para a tabela em centavos, lancada como desconto do item (0 quando a nota nao e' mais barata). */
  descontoCentavos: number;
}

/** Como o valor da nota entra no item: abaixo da tabela, preco de tabela + desconto (regra de 01/10/2026). */
export const precoDaNotaNoItem = (precoTabela: number, precoNota: number, quantidade: number): PrecoDaNotaNoItem => {
  const abaixo = precoNota < precoTabela - 0.0001;
  const precoUnitario = abaixo ? precoTabela : precoNota;
  const precoCheioCentavos = toCents(precoUnitario * quantidade);
  const descontoCentavos = abaixo ? Math.min(precoCheioCentavos, toCents((precoTabela - precoNota) * quantidade)) : 0;
  return { precoUnitario, precoCheioCentavos, descontoCentavos };
};
