/*
 * MONTAR O PEDIDO DE VENDA A PARTIR DE UMA NF-e DE ENTRADA (07/11/2026, pedido
 * do dono): "pegar os itens e as quantidades que vieram de uma determinada nota
 * de entrada". As quantidades vem da nota; o PRECO a pessoa escolhe na hora:
 * o de venda do cadastro (padrao, decisao do dono) ou o valor unitario do XML
 * da nota (o custo, pedido do dono em 07/11/2026).
 *
 * Valor da nota: o PRECO do item e' o da nota, sem desconto (decisao do dono,
 * 07/11/2026, depois de ver a NF-e: "o valor deve vir 100% igual o da nota, mas
 * sem aparecer como desconto"). A primeira versao punha o item no preco de
 * tabela + desconto (regra de 01/10 do preco digitado na grade) e a NF-e saiu
 * com R$ 18 mil de desconto. O controle continua na FINALIZACAO: a conferencia
 * de preco (conferenciaPrecoDomain.ts, tela e servidor) conta o que ficou
 * abaixo do sistema no limite de desconto, com liberacao como sempre, e grava
 * em descontoPorPrecoCentavos -- so' nao vira desconto na nota. Aqui, o item
 * que ja' sabemos que vai travar (maximo do proprio produto, limite no modo
 * "bloquear") fica com o preco de venda e entra no aviso.
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
   * produto em mais de uma linha da nota fica com a media ponderada. Quando o
   * total da linha no XML (vProd) nao e' quantidade x preco arredondado -- o
   * emitente truncou --, o preco ganha as casas que reproduzem aquele total
   * (07/11/2026: 1,5 x 18,79 = 28,185 que o outro ERP gravou 28,18; o pedido
   * leva 18,7867 e a linha da' 28,18, igual a nota).
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

/** Linha calculada como o sistema calcula (Math.round em centavos: pedido e NF-e). */
const centavosDaLinha = (quantidade: number, preco: number): number => Math.round(quantidade * preco * 100);

/** Menor preco (4 a 8 casas) cuja linha, arredondada como o sistema arredonda, da' o total em centavos. */
const precoQueReproduzOTotal = (totalCentavos: number, quantidade: number): number => {
  for (let casas = 4; casas <= 8; casas += 1) {
    const escala = 10 ** casas;
    const preco = Math.round((totalCentavos / 100 / quantidade) * escala) / escala;
    if (centavosDaLinha(quantidade, preco) === totalCentavos) return preco;
  }
  return totalCentavos / 100 / quantidade;
};

/**
 * Total de cada linha (vProd) tirado do XML guardado na entrada, na ordem dos
 * itens gravados. null quando o XML nao bate item a item (codigo e quantidade):
 * ai' o valor sai so' do preco unitario, como antes.
 */
export const totaisDasLinhasDoXml = (
  itens: ReadonlyArray<Pick<NotaFiscalEntradaItemRecord, 'codigoXml' | 'quantidade'>>,
  linhasDoXml: ReadonlyArray<{ codigo: string; quantidade: number; valorProduto: number }>,
): number[] | null => {
  if (itens.length === 0 || itens.length !== linhasDoXml.length) return null;
  const bate = itens.every((item, i) => (
    String(item.codigoXml || '') === String(linhasDoXml[i].codigo || '')
    && Math.abs((Number(item.quantidade) || 0) - (Number(linhasDoXml[i].quantidade) || 0)) < 1e-9
  ));
  return bate ? linhasDoXml.map((l) => positivo(l.valorProduto)) : null;
};

export const itensDaNotaParaVenda = (
  itens: ReadonlyArray<NotaFiscalEntradaItemRecord>,
  totaisDasLinhas: ReadonlyArray<number> | null = null,
): ItensDaNotaParaVenda => {
  const porProduto = new Map<string, LinhaDaNotaParaVenda>();
  // Por produto: quantidade da nota x valor unitario do XML (para a media) e o total das linhas (vProd quando ha' XML).
  const valorPeloUnitario = new Map<string, number>();
  const valorTotal = new Map<string, number>();
  const deFora: string[] = [];
  itens.forEach((item, indice) => {
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
    const pelaConta = positivo(item.valorUnitario) * (quantidade / fator);
    const doXml = totaisDasLinhas ? positivo(totaisDasLinhas[indice]) : 0;
    valorPeloUnitario.set(item.itemId, (valorPeloUnitario.get(item.itemId) || 0) + pelaConta);
    valorTotal.set(item.itemId, (valorTotal.get(item.itemId) || 0) + (doXml || pelaConta));
    const atual = porProduto.get(item.itemId);
    if (atual) {
      atual.quantidade = arred(atual.quantidade + quantidade);
    } else {
      porProduto.set(item.itemId, { produtoId: item.itemId, descricao, quantidade, valorUnitarioNota: 0 });
    }
  });
  porProduto.forEach((linha) => {
    if (!(linha.quantidade > 0)) { linha.valorUnitarioNota = 0; return; }
    const preco = arred((valorPeloUnitario.get(linha.produtoId) || 0) / linha.quantidade);
    const totalCentavos = Math.round((valorTotal.get(linha.produtoId) || 0) * 100);
    linha.valorUnitarioNota = centavosDaLinha(linha.quantidade, preco) === totalCentavos
      ? preco
      : precoQueReproduzOTotal(totalCentavos, linha.quantidade);
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
  /** Preco unitario do item: sempre o valor da nota. */
  precoUnitario: number;
  /** Linha no preco de tabela (ou no da nota, se for maior), em centavos: base do percentual na conferencia. */
  baseCentavos: number;
  /** Quanto a linha fica abaixo da tabela, em centavos: na finalizacao conta no limite de desconto. */
  abaixoDaTabelaCentavos: number;
}

/** Valor da nota no item: o preco e' o da nota; a diferenca para a tabela so' conta no limite ao finalizar. */
export const precoDaNotaNoItem = (precoTabela: number, precoNota: number, quantidade: number): PrecoDaNotaNoItem => {
  const linhaDaNota = toCents(precoNota * quantidade);
  const abaixo = precoTabela > 0 && precoNota < precoTabela - 0.0001;
  const baseCentavos = abaixo ? toCents(precoTabela * quantidade) : linhaDaNota;
  return { precoUnitario: precoNota, baseCentavos, abaixoDaTabelaCentavos: abaixo ? Math.max(0, baseCentavos - linhaDaNota) : 0 };
};
