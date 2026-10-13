import { productMatchesExactCode, type SearchableProduct } from './productSearch';

/*
 * TABELA DE ITENS DA VENDA -- lancamento por codigo e edicao na linha
 * (pedido do dono, 2026-10-13, a partir do ERP antigo dos clientes).
 *
 * No ERP antigo o operador digita a MATRICULA (codigo) do produto numa linha
 * da grade, a descricao preenche sozinha, ele digita a quantidade e o Enter
 * ja' pula para a proxima linha. Qualquer celula (quantidade, unitario,
 * desconto) e' editavel no lugar. Aqui fica a parte pura dessa tela:
 * achar o produto pelo codigo, ler o que foi digitado e decidir a proxima
 * celula. A regra de negocio do item (estoque, venda fracionada, limite de
 * desconto) continua no formulario, que e' quem conhece a configuracao.
 */

export type CampoEditavel = 'codigo' | 'quantidade' | 'precoUnitario' | 'desconto';

/** Ordem das celulas editaveis na linha: Tab anda nessa ordem. O codigo
 * vem primeiro porque trocar o produto e' a primeira coisa da linha (como no
 * ERP antigo: clica na matricula, digita outra, o item vira o outro produto). */
export const CAMPOS_EDITAVEIS: readonly CampoEditavel[] = ['codigo', 'quantidade', 'precoUnitario', 'desconto'];

export const ROTULO_CAMPO: Record<CampoEditavel, string> = {
  codigo: 'Código',
  quantidade: 'Quantidade',
  precoUnitario: 'Preço unitário',
  desconto: 'Desconto',
};

/**
 * Produto cujo codigo (matricula, barras, referencia, SKU ou EAN da embalagem)
 * bate EXATAMENTE com o digitado. Produto inativo nao entra: nao pode ser
 * vendido. Mais de um com o mesmo codigo e' erro de cadastro -- devolve o
 * primeiro, como a busca de sempre.
 */
export const localizarProdutoPorCodigo = <P extends SearchableProduct>(catalogo: ReadonlyArray<P>, codigo: string): P | null => {
  const termo = String(codigo ?? '').trim();
  if (!termo) return null;
  return catalogo.find((p) => p.ativo !== false && productMatchesExactCode(p, termo)) ?? null;
};

/** "1.234,56" / "1234.56" / "3" -> numero; vazio ou lixo -> NaN. */
export const lerNumero = (texto: string): number => {
  const limpo = String(texto ?? '').trim();
  if (!limpo) return Number.NaN;
  // Com virgula, o ponto e' milhar ("1.234,56"); sem virgula, o ponto e' decimal ("12.5").
  const normalizado = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : Number.NaN;
};

export interface Interpretado {
  valor: number;
  erro: string | null;
}

export const interpretarQuantidade = (texto: string): Interpretado => {
  const n = lerNumero(texto);
  if (!Number.isFinite(n) || n <= 0) return { valor: Number.NaN, erro: 'A quantidade deve ser maior que zero.' };
  return { valor: n, erro: null };
};

export const interpretarPreco = (texto: string): Interpretado => {
  const n = lerNumero(String(texto).replace(/R\$\s*/i, ''));
  if (!Number.isFinite(n) || n <= 0) return { valor: Number.NaN, erro: 'Informe um preço unitário maior que zero.' };
  return { valor: Math.round(n * 100) / 100, erro: null };
};

/**
 * Desconto do item em R$. Aceita "10%" (percentual do valor cheio do item)
 * ou um valor em reais; vazio = sem desconto. Nunca passa do valor cheio.
 */
export const interpretarDesconto = (texto: string, valorCheio: number): Interpretado => {
  const limpo = String(texto ?? '').trim().replace(/R\$\s*/i, '');
  if (!limpo || limpo === '-') return { valor: 0, erro: null };
  const percentual = limpo.endsWith('%');
  const n = lerNumero(percentual ? limpo.slice(0, -1) : limpo);
  if (!Number.isFinite(n) || n < 0) return { valor: Number.NaN, erro: 'Desconto inválido. Digite um valor em R$ ou um percentual, como 10%.' };
  if (percentual && n > 100) return { valor: Number.NaN, erro: 'O desconto não pode passar de 100%.' };
  const centavosCheio = Math.round(Math.max(0, valorCheio) * 100);
  const centavos = percentual ? Math.round(centavosCheio * (n / 100)) : Math.round(n * 100);
  if (centavos > centavosCheio) return { valor: Number.NaN, erro: 'O desconto ficou maior que o valor do item.' };
  return { valor: centavos / 100, erro: null };
};

/** Proxima celula editavel da linha (Tab); null depois da ultima. */
export const campoSeguinte = (campo: CampoEditavel, comDesconto: boolean): CampoEditavel | null => {
  const ordem = comDesconto ? CAMPOS_EDITAVEIS : CAMPOS_EDITAVEIS.filter((c) => c !== 'desconto');
  const i = ordem.indexOf(campo);
  return i >= 0 && i + 1 < ordem.length ? ordem[i + 1] : null;
};

/** Texto que a celula mostra quando entra em edicao (sem "R$", com virgula). */
export const textoParaEdicao = (campo: CampoEditavel, item: { codigo?: string; quantidade: number; precoUnitario: number; desconto: number; unidadeMedidaCasasDecimais?: number }): string => {
  if (campo === 'codigo') return String(item.codigo ?? '');
  if (campo === 'quantidade') return String(item.quantidade).replace('.', ',');
  if (campo === 'precoUnitario') return item.precoUnitario.toFixed(2).replace('.', ',');
  return item.desconto > 0 ? item.desconto.toFixed(2).replace('.', ',') : '';
};
