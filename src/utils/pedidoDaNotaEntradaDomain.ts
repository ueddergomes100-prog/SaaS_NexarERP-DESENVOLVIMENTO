/*
 * MONTAR O PEDIDO DE VENDA A PARTIR DE UMA NF-e DE ENTRADA (07/11/2026, pedido
 * do dono): "pegar os itens e as quantidades que vieram de uma determinada nota
 * de entrada". Decisao do dono: as quantidades vem da nota e o PRECO e' o de
 * venda do cadastro (como ao lancar o item na tela); o valor da nota fica so'
 * como referencia.
 *
 * Parte pura: quais itens da nota viram linhas de venda (so' os de revenda,
 * somados por produto, na unidade do estoque) e o que fica de fora com o motivo.
 */
import type { NotaFiscalEntradaItemRecord } from './entradaNfeDomain';

export interface LinhaDaNotaParaVenda {
  produtoId: string;
  /** Nome como veio na nota (so' para o aviso quando o produto nao esta' no catalogo). */
  descricao: string;
  /** Na unidade do estoque (2 SC x 20 = 40 KG). */
  quantidade: number;
  /** Valor unitario da nota, por unidade do estoque (referencia). */
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
    const valorUnitarioNota = arred(positivo(item.valorUnitario) / fator);
    const atual = porProduto.get(item.itemId);
    if (atual) {
      atual.quantidade = arred(atual.quantidade + quantidade);
    } else {
      porProduto.set(item.itemId, { produtoId: item.itemId, descricao, quantidade, valorUnitarioNota });
    }
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
export const observacaoDoPedidoDaNota = (n: NotaEntradaParaEscolha): string => (
  `Montado a partir da NF-e de entrada nº ${String(n.numeroNF || '?')}${n.fornecedorNome ? ` (${String(n.fornecedorNome)})` : ''}.`
);
