// Funcoes puras da tela de Etiquetas. Sem Firestore -- a leitura/escrita
// fica em Etiquetas.tsx/EtiquetasPrint.tsx, mesmo padrao de
// precificacaoDomain.ts/unidadeMedidaDomain.ts.

/** Os cinco campos que podem ser posicionados livremente na etiqueta. */
export type CampoEtiquetaId = 'nome' | 'unidade' | 'codigoBarras' | 'precoAVista' | 'precoAPrazo';

const CAMPOS_ETIQUETA_ID: CampoEtiquetaId[] = ['nome', 'unidade', 'codigoBarras', 'precoAVista', 'precoAPrazo'];

/** Posicao de UM campo dentro da etiqueta, em mm a partir do canto
 * superior-esquerdo -- mesma unidade da etiqueta inteira, funciona igual
 * em qualquer densidade de tela (ver EtiquetaLabel.tsx). `fontePt` fica de
 * fora do codigoBarras: o tamanho dele vem do proprio JsBarcode. */
export interface PosicaoCampoEtiqueta {
  xMm: number;
  yMm: number;
  visivel: boolean;
  fontePt?: number;
}

/** Modelo de impressao salvo por tenant (configuracoes/{tenantId}.etiquetaModelo). */
export interface ModeloEtiqueta {
  larguraMm: number;
  alturaMm: number;
  campos: Record<CampoEtiquetaId, PosicaoCampoEtiqueta>;
}

/** Etiqueta 60x40mm e' o tamanho mais comum de rolo termico vendido no
 * Brasil pras impressoras de balcao (Elgin/Argox) -- serve de padrao ate
 * o tenant configurar o rolo que realmente usa. As posicoes reproduzem o
 * layout fixo que a tela tinha antes do editor visual: nome no topo,
 * unidade e codigo de barras no meio, preco no canto inferior direito. */
export const MODELO_ETIQUETA_PADRAO: ModeloEtiqueta = {
  larguraMm: 60,
  alturaMm: 40,
  campos: {
    nome: { xMm: 2, yMm: 2, visivel: true, fontePt: 10 },
    unidade: { xMm: 2, yMm: 12, visivel: true, fontePt: 8 },
    codigoBarras: { xMm: 6, yMm: 18, visivel: true },
    precoAVista: { xMm: 28, yMm: 29, visivel: true, fontePt: 16 },
    precoAPrazo: { xMm: 28, yMm: 35, visivel: false, fontePt: 9 },
  },
};

const clamp = (valor: number, min: number, max: number): number => Math.min(max, Math.max(min, valor));

const sanearPosicaoCampo = (
  campo: CampoEtiquetaId,
  posicao: Partial<PosicaoCampoEtiqueta> | null | undefined,
  larguraMm: number,
  alturaMm: number,
): PosicaoCampoEtiqueta => {
  const padrao = MODELO_ETIQUETA_PADRAO.campos[campo];
  return {
    xMm: clamp(Number(posicao?.xMm) || padrao.xMm, 0, larguraMm),
    yMm: clamp(Number(posicao?.yMm) || padrao.yMm, 0, alturaMm),
    visivel: posicao?.visivel ?? padrao.visivel,
    ...(padrao.fontePt !== undefined
      ? { fontePt: clamp(Number(posicao?.fontePt) || padrao.fontePt, 6, 40) }
      : {}),
  };
};

/**
 * Le um modelo possivelmente incompleto ou no formato antigo (Firestore, ou
 * rascunho digitado na tela) e devolve sempre os cinco campos com posicao
 * concreta dentro dos limites da etiqueta -- nunca undefined, nunca fora do
 * papel. Campo ausente (documento salvo antes do editor visual, ou so
 * parcialmente preenchido) cai na posicao padrao daquele campo especifico,
 * um a um -- nao existe "formato antigo inteiro" pra detectar, so campos
 * que faltam.
 */
export const sanearModeloEtiqueta = (modelo: Partial<ModeloEtiqueta> | null | undefined): ModeloEtiqueta => {
  const larguraMm = clamp(Number(modelo?.larguraMm) || MODELO_ETIQUETA_PADRAO.larguraMm, 20, 150);
  const alturaMm = clamp(Number(modelo?.alturaMm) || MODELO_ETIQUETA_PADRAO.alturaMm, 15, 150);
  const camposFonte = modelo?.campos && typeof modelo.campos === 'object' ? modelo.campos : null;
  const campos = CAMPOS_ETIQUETA_ID.reduce((acc, campo) => {
    acc[campo] = sanearPosicaoCampo(campo, camposFonte?.[campo], larguraMm, alturaMm);
    return acc;
  }, {} as Record<CampoEtiquetaId, PosicaoCampoEtiqueta>);
  return { larguraMm, alturaMm, campos };
};

export interface ProdutoParaCodigoBarras {
  codigo?: string | null;
  codigoBarras?: string | null;
}

/**
 * Codigo que vai desenhado na etiqueta: o EAN/GTIN cadastrado no produto
 * quando existe, senao o codigo interno (o mesmo que o motor de busca do
 * PDV/Vendas ja reconhece via productMatchesExactCode em productSearch.ts --
 * nao exige nenhuma mudanca na venda pra bipar essa etiqueta). `null` quando
 * o produto nao tem nenhum dos dois: a etiqueta sai sem codigo de barras em
 * vez de travar a geracao.
 */
export const resolverCodigoBarras = (produto: ProdutoParaCodigoBarras): string | null => {
  const ean = String(produto.codigoBarras ?? '').trim();
  if (ean) return ean;
  const interno = String(produto.codigo ?? '').trim();
  return interno || null;
};

export interface ItemEtiqueta {
  produtoId: string;
  quantidade: number;
}

/** Limite de copias por lote de impressao -- protege a aba do navegador de
 * travar com uma grade de milhares de codigos de barras. Mesmo espirito do
 * PEDIDO_PRINT_LOTE_SAFETY_LIMIT em pedidoPrintLoteConstants.ts. */
export const ETIQUETAS_POR_IMPRESSAO_LIMITE = 300;

export interface CopiaEtiqueta {
  produtoId: string;
  /** 1-based: qual copia do produto e' essa, so pra virar key unica no React. */
  copia: number;
}

/** Achata a lista de itens (produto + quantidade) na lista de copias que a
 * tela de impressao renderiza uma abaixo da outra, cada uma em sua propria
 * pagina fisica de etiqueta. */
export const montarCopiasEtiqueta = (itens: ItemEtiqueta[]): { copias: CopiaEtiqueta[]; truncado: boolean } => {
  const copias: CopiaEtiqueta[] = [];
  let truncado = false;
  for (const item of itens) {
    const quantidade = Math.max(0, Math.floor(item.quantidade));
    for (let i = 1; i <= quantidade; i += 1) {
      if (copias.length >= ETIQUETAS_POR_IMPRESSAO_LIMITE) { truncado = true; break; }
      copias.push({ produtoId: item.produtoId, copia: i });
    }
    if (truncado) break;
  }
  return { copias, truncado };
};

/** Codifica os itens escolhidos na query string da rota de impressao, no
 * formato `id:quantidade,id:quantidade`. */
export const serializarItensParaQuery = (itens: ItemEtiqueta[]): string =>
  itens.map((item) => `${item.produtoId}:${Math.max(1, Math.floor(item.quantidade))}`).join(',');

export const parseItensDaQuery = (valor: string | null | undefined): ItemEtiqueta[] => {
  if (!valor) return [];
  return valor
    .split(',')
    .map((parte) => parte.trim())
    .filter(Boolean)
    .map((parte) => {
      const [produtoId, quantidadeStr] = parte.split(':');
      const quantidade = Number(quantidadeStr);
      return {
        produtoId: (produtoId || '').trim(),
        quantidade: Number.isFinite(quantidade) && quantidade > 0 ? Math.floor(quantidade) : 1,
      };
    })
    .filter((item) => item.produtoId.length > 0);
};
