/*
 * NOTA AVULSA A PARTIR DO XML DE OUTRO CNPJ (25/11/2026, Embala Minas, item 11b).
 *
 * A compra veio numa NF-e emitida para OUTRO CNPJ (outra empresa do dono, o
 * CPF dele...): nao e' entrada fiscal desta empresa, mas a mercadoria entrou
 * aqui. A Nota Avulsa le o XML e puxa SO' o que interessa para o estoque e o
 * financeiro: produtos (com o mesmo vinculo de itens da Entrada de XML --
 * o codigo que ESSE fornecedor usa, guardado em `codigosFornecedor`, ou o
 * codigo de barras), quantidades, valores e as duplicatas (boleto). Nada de
 * imposto, CFOP ou livro fiscal.
 *
 * Regra pura: sem tela, sem Firestore.
 */
import type { NotaParseada, ItemDaNota, DuplicataDaNota } from './nfeXmlDomain';
import type { NotaAvulsaItem } from './notaAvulsaDomain';
import type { ParcelaComCheque } from './chequeEmitidoDomain';

const digitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '');
const centavos = (v: number): number => Math.round((Number(v) || 0) * 100) / 100;

export interface ProdutoParaVinculoAvulso {
  id: string;
  nome: string;
  codigoBarras?: string;
  codigosFornecedor?: Record<string, string>;
  fatoresFornecedor?: Record<string, number>;
}

export type OrigemDoVinculoAvulso = 'codigo_fornecedor' | 'codigo_barras' | 'manual';

export const ROTULO_VINCULO_AVULSO: Record<OrigemDoVinculoAvulso, string> = {
  codigo_fornecedor: 'pelo código deste fornecedor',
  codigo_barras: 'pelo código de barras',
  manual: 'escolhido por você',
};

/**
 * Vinculo automatico, como a Entrada de XML reconhece: o codigo que este
 * fornecedor usa (aprendido nas notas anteriores) ou o codigo de barras.
 * Sem nenhum dos dois, a pessoa escolhe o produto.
 */
export const vinculoAutomatico = (
  item: Pick<ItemDaNota, 'codigo' | 'ean'>,
  produtos: ProdutoParaVinculoAvulso[],
  fornecedorId: string,
): { produto: ProdutoParaVinculoAvulso; origem: OrigemDoVinculoAvulso } | null => {
  const codigo = String(item.codigo || '').trim().toLowerCase();
  if (fornecedorId && codigo) {
    const peloCodigo = produtos.find((p) => String(p.codigosFornecedor?.[fornecedorId] || '').trim().toLowerCase() === codigo);
    if (peloCodigo) return { produto: peloCodigo, origem: 'codigo_fornecedor' };
  }
  const ean = digitos(item.ean);
  if (ean.length >= 8 && !/^0+$/.test(ean)) {
    const peloEan = produtos.find((p) => digitos(p.codigoBarras) === ean);
    if (peloEan) return { produto: peloEan, origem: 'codigo_barras' };
  }
  return null;
};

/** Fator aprendido com este fornecedor (1 CX = 12 UN), ou 1. */
export const fatorDoFornecedor = (produto: ProdutoParaVinculoAvulso | null | undefined, fornecedorId: string): number => {
  const f = Number(produto?.fatoresFornecedor?.[fornecedorId]);
  return Number.isFinite(f) && f > 0 ? f : 1;
};

/**
 * Item da Nota Avulsa a partir do item do XML. Com fator (1 CX = 12 UN), a
 * quantidade vai convertida para a unidade do estoque e o custo por unidade
 * dividido -- o total da linha nao muda.
 */
export const itemAvulsoDoXml = (
  item: Pick<ItemDaNota, 'quantidade' | 'valorProduto' | 'valorUnitario' | 'codigo'>,
  produto: { id: string; nome: string; precoVenda?: number },
  fator = 1,
): NotaAvulsaItem & { codigoFornecedor?: string } => {
  const f = Number(fator) > 0 ? Number(fator) : 1;
  const quantidade = Math.round((Number(item.quantidade) || 0) * f * 1000) / 1000;
  const total = Number(item.valorProduto) || (Number(item.valorUnitario) || 0) * (Number(item.quantidade) || 0);
  const precoCusto = quantidade > 0 ? Math.round((total / quantidade) * 10000) / 10000 : 0;
  return {
    produtoId: produto.id,
    produtoNome: produto.nome,
    quantidade,
    precoCusto,
    precoVenda: Number(produto.precoVenda) || 0,
    ...(String(item.codigo || '').trim() ? { codigoFornecedor: String(item.codigo).trim() } : {}),
  };
};

/** Duplicatas do XML (boleto) -> parcelas da Nota Avulsa, forma Boleto. Sem duplicata: nenhuma. */
export const parcelasDasDuplicatas = (duplicatas: DuplicataDaNota[] | null | undefined, hoje: string): ParcelaComCheque[] => (
  (Array.isArray(duplicatas) ? duplicatas : [])
    .filter((d) => Number(d.valor) > 0)
    .map((d, i) => ({
      numero: String(i + 1),
      vencimento: /^\d{4}-\d{2}-\d{2}$/.test(String(d.vencimento || '')) ? String(d.vencimento) : hoje,
      valor: centavos(Number(d.valor)),
      forma: 'Boleto',
    }))
);

/**
 * O XML e' DESTA empresa? Entao o lugar certo e' a Entrada de XML (entrada
 * fiscal). Devolve o aviso, ou null quando o XML e' de outro CNPJ.
 */
export const avisoDoDestinatario = (cnpjDaEmpresa: string, nota: Pick<NotaParseada, 'destinatario'>): string | null => {
  const empresa = digitos(cnpjDaEmpresa);
  const destinatario = digitos(nota.destinatario?.documento);
  if (empresa.length === 14 && destinatario === empresa) {
    return 'Este XML foi emitido para o CNPJ desta empresa: o lançamento certo é em Fiscal > Entrada de XML (entrada fiscal). Use a Nota Avulsa só para nota de outro CNPJ.';
  }
  return null;
};

/** O fornecedor do XML no cadastro, pelo CNPJ/CPF do emitente. */
export const fornecedorDoXml = <T extends { id: string; documento?: string }>(fornecedores: T[], nota: Pick<NotaParseada, 'emitente'>): T | null => {
  const doc = digitos(nota.emitente?.documento);
  if (!doc) return null;
  return fornecedores.find((f) => digitos(f.documento) === doc) || null;
};
