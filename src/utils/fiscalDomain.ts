export type RegimeTributario = 'simples_nacional' | 'lucro_presumido' | 'lucro_real';

export const REGIME_TRIBUTARIO_OPTIONS: Array<{ value: RegimeTributario; label: string }> = [
  { value: 'simples_nacional', label: 'Simples Nacional' },
  { value: 'lucro_presumido', label: 'Lucro Presumido' },
  { value: 'lucro_real', label: 'Lucro Real' },
];

export const DEFAULT_REGIME_TRIBUTARIO: RegimeTributario = 'simples_nacional';

/** Simples Nacional tributa por CSOSN; Lucro Presumido/Real usam CST real
 * + aliquotas efetivas de ICMS/PIS/COFINS. Consumido pelas fatias
 * seguintes do modulo fiscal (cadastro de produto e emissao de NF-e). */
export const usesCsosn = (regime: RegimeTributario): boolean => regime === 'simples_nacional';

/** CST de ICMS (tabela real, usada por Lucro Presumido/Real) -- distinta
 * do CSOSN (exclusivo do Simples Nacional). Mesmo formato de
 * csosnOptions/cstOptions em EstoqueForm.tsx. */
export const ICMS_CST_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '00', label: '00 - Tributada integralmente' },
  { value: '10', label: '10 - Tributada com cobrança de ICMS por ST' },
  { value: '20', label: '20 - Com redução de base de cálculo' },
  { value: '30', label: '30 - Isenta ou não tributada, com cobrança de ICMS por ST' },
  { value: '40', label: '40 - Isenta' },
  { value: '41', label: '41 - Não tributada' },
  { value: '50', label: '50 - Suspensão' },
  { value: '51', label: '51 - Diferimento' },
  { value: '60', label: '60 - ICMS cobrado anteriormente por ST' },
  { value: '70', label: '70 - Com redução de base de cálculo e cobrança de ICMS por ST' },
  { value: '90', label: '90 - Outras' },
];

/** Item lido do XML de uma NF-e de entrada, o suficiente pra tentar casar
 * com um produto ja cadastrado. */
export interface XmlItemForMatch {
  codigo: string;
  descricao: string;
  ncm: string;
  ean?: string;
}

/** Produto do estoque, campos usados pelo matching. */
export interface EstoqueItemForMatch {
  id: string;
  codigo: string;
  nome: string;
  codigoBarras?: string;
  ncm?: string;
  /** Mapa fornecedorId -> cProd que esse fornecedor usa pra este produto,
   * aprendido a cada importacao de XML confirmada (ver EntradaNFE.tsx). */
  codigosFornecedor?: Record<string, string>;
}

export type ProdutoMatchLayer = 'ean' | 'codigo_fornecedor' | 'ncm_nome';

export interface ProdutoMatchResult<T extends EstoqueItemForMatch> {
  produto: T | null;
  layer: ProdutoMatchLayer | null;
}

/** Reconhecimento de produto na importacao de XML, em camadas: EAN
 * (mais confiavel) -> codigo que o fornecedor usa pra esse item, salvo de
 * uma importacao anterior dele -> NCM+nome (exige os dois, nao so um,
 * como ultimo recurso). Pura e testavel sem Firestore. Generico em T pra
 * o chamador poder passar um tipo de estoque com campos extras (ex:
 * quantidade) sem perder esses campos no resultado. */
export const matchProdutoFromXmlItem = <T extends EstoqueItemForMatch>(
  item: XmlItemForMatch,
  estoqueAtual: T[],
  fornecedorId: string,
): ProdutoMatchResult<T> => {
  const ean = (item.ean || '').trim();
  if (ean) {
    const porEan = estoqueAtual.find((p) => (p.codigoBarras || '').trim() === ean);
    if (porEan) return { produto: porEan, layer: 'ean' };
  }

  const codigo = (item.codigo || '').trim().toLowerCase();
  if (codigo && fornecedorId) {
    const porCodigoFornecedor = estoqueAtual.find(
      (p) => (p.codigosFornecedor?.[fornecedorId] || '').trim().toLowerCase() === codigo,
    );
    if (porCodigoFornecedor) return { produto: porCodigoFornecedor, layer: 'codigo_fornecedor' };
  }

  const ncm = (item.ncm || '').trim();
  const nome = (item.descricao || '').trim().toLowerCase();
  if (ncm && nome) {
    const porNcmNome = estoqueAtual.find(
      (p) => (p.ncm || '').trim() === ncm && p.nome.trim().toLowerCase() === nome,
    );
    if (porNcmNome) return { produto: porNcmNome, layer: 'ncm_nome' };
  }

  return { produto: null, layer: null };
};
