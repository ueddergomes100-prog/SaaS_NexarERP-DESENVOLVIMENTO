// Fundacao do historico de Entrada de NF-e (2026-08-14, Fatia 0/N). So
// monta o formato do registro -- a leitura/listagem (Fatia 1), a
// classificacao Revenda/Materia-Prima (Fatia 2) e a exclusao com reversao
// (Fatia 3) vem depois. Nesta fatia todo item gravado e 'revenda', porque
// a importacao ainda so escreve em `estoque` (ver EntradaNFE.tsx).

export type NotaFiscalEntradaItemTipo = 'revenda' | 'materia_prima';
export type NotaFiscalEntradaStatus = 'ativa' | 'excluida';

export interface NotaFiscalEntradaItemRecord {
  itemId: string;
  tipo: NotaFiscalEntradaItemTipo;
  codigoXml: string;
  descricaoXml: string;
  quantidade: number;
  valorUnitario: number;
  novo: boolean;
}

export interface NotaFiscalEntradaRecordInput {
  numeroNF: string;
  dataEmissao: string;
  valorTotal: number;
  fornecedorId: string;
  fornecedorNome: string;
  fornecedorCnpj: string;
  itens: NotaFiscalEntradaItemRecord[];
  titulosPagarIds: string[];
}

export interface NotaFiscalEntradaRecord extends NotaFiscalEntradaRecordInput {
  status: NotaFiscalEntradaStatus;
}

// Pura -- o timestamp/tenantId/metadados de responsabilidade sao
// acrescentados pelo chamador (mesmo padrao de buildDocumentMetadata),
// pra este helper nao depender do Firestore.
export const buildNotaFiscalEntradaRecord = (input: NotaFiscalEntradaRecordInput): NotaFiscalEntradaRecord => ({
  ...input,
  status: 'ativa',
});

// Fatia 2/N -- classificacao Materia-Prima/Revenda + precificacao na tela
// de lancamento (2026-08-14). Decisoes confirmadas com o usuario: item ja
// reconhecido (em `estoque` OU `materias_primas`, via o matching de
// fiscalDomain.ts) mantem o destino conhecido automaticamente -- so item
// novo pede escolha manual. Precificacao (preco de venda + tributacao)
// aparece pra todo item de Revenda, novo ou ja cadastrado; nunca pra
// Materia-Prima (o cadastro dela nao tem esses campos).

export type ItemEntradaClassificacao = 'estoque' | 'materia_prima' | 'novo';

export interface ItemEntradaConfig {
  classificacao: ItemEntradaClassificacao;
  matchId: string | null;
  tipo: NotaFiscalEntradaItemTipo;
  precoVenda: string;
  csosn: string;
  aliquotaIcms: string;
  reducaoBaseIcms: string;
  cstPis: string;
  aliquotaPis: string;
  cstCofins: string;
  aliquotaCofins: string;
}

// Subconjunto dos campos fiscais de um produto de `estoque` ja cadastrado,
// usado so pra pre-preencher a precificacao quando o item da nota mescla
// com um produto existente.
export interface ProdutoFiscalAtual {
  id: string;
  precoVenda?: number;
  csosn?: string;
  aliquotaIcms?: number;
  reducaoBaseIcms?: number;
  cstPis?: string;
  aliquotaPis?: number;
  cstCofins?: string;
  aliquotaCofins?: number;
}

const EMPTY_TAX_FIELDS = {
  precoVenda: '',
  csosn: '',
  aliquotaIcms: '',
  reducaoBaseIcms: '',
  cstPis: '',
  aliquotaPis: '',
  cstCofins: '',
  aliquotaCofins: '',
};

// Margem padrao (50%) aplicada quando nao ha preco de venda anterior pra
// herdar -- mesmo valor que a importacao ja usava antes desta fatia.
const precoVendaPadrao = (valorUnitarioXml: number): string => String(Number((valorUnitarioXml * 1.5).toFixed(2)));

// Pura, sem Firestore -- o chamador ja fez o matching (camadas de
// fiscalDomain.ts) e so passa o resultado aqui.
export const buildInitialItemEntradaConfig = (
  valorUnitarioXml: number,
  produtoExistente: ProdutoFiscalAtual | null,
  materiaPrimaExistenteId: string | null,
  usaCsosn: boolean,
): ItemEntradaConfig => {
  if (produtoExistente) {
    return {
      classificacao: 'estoque',
      matchId: produtoExistente.id,
      tipo: 'revenda',
      precoVenda: produtoExistente.precoVenda !== undefined ? String(produtoExistente.precoVenda) : precoVendaPadrao(valorUnitarioXml),
      csosn: produtoExistente.csosn || (usaCsosn ? '102' : ''),
      aliquotaIcms: produtoExistente.aliquotaIcms !== undefined ? String(produtoExistente.aliquotaIcms) : '',
      reducaoBaseIcms: produtoExistente.reducaoBaseIcms !== undefined ? String(produtoExistente.reducaoBaseIcms) : '',
      cstPis: produtoExistente.cstPis || '',
      aliquotaPis: produtoExistente.aliquotaPis !== undefined ? String(produtoExistente.aliquotaPis) : '',
      cstCofins: produtoExistente.cstCofins || '',
      aliquotaCofins: produtoExistente.aliquotaCofins !== undefined ? String(produtoExistente.aliquotaCofins) : '',
    };
  }

  if (materiaPrimaExistenteId) {
    return {
      classificacao: 'materia_prima',
      matchId: materiaPrimaExistenteId,
      tipo: 'materia_prima',
      ...EMPTY_TAX_FIELDS,
    };
  }

  return {
    classificacao: 'novo',
    matchId: null,
    tipo: 'revenda',
    precoVenda: precoVendaPadrao(valorUnitarioXml),
    csosn: usaCsosn ? '102' : '',
    aliquotaIcms: '',
    reducaoBaseIcms: '',
    cstPis: '',
    aliquotaPis: '',
    cstCofins: '',
    aliquotaCofins: '',
  };
};

// Fatia 3/N -- excluir uma nota ja confirmada, revertendo a quantidade
// somada ao estoque/materia-prima e removendo os titulos de Contas a
// Pagar gerados por ela (mantendo o cadastro do produto/materia-prima).
// Decisoes confirmadas com o usuario: bloqueia se algum titulo ja estiver
// pago; e (mesmo principio ja usado no estorno de Producao) bloqueia se
// parte do que entrou por essa nota ja tiver sido vendida/consumida, pra
// nao deixar o estoque negativo silenciosamente.

export interface TituloParaExclusao {
  id: string;
  status: string;
  descricao: string;
}

// Retorna o primeiro titulo que impede a exclusao (qualquer status
// diferente de 'Pendente'), ou null se todos podem ser removidos.
export const findTituloBloqueandoExclusao = (titulos: TituloParaExclusao[]): TituloParaExclusao | null =>
  titulos.find((t) => t.status !== 'Pendente') || null;

export interface ItemParaReverterEstoque {
  itemId: string;
  descricaoXml: string;
  quantidade: number;
}

// Descobre, entre os itens de um tipo (revenda OU materia-prima, chamador
// separa antes), o primeiro cujo estoque atual nao comporta reverter a
// quantidade inteira que essa nota somou -- ja foi vendido/consumido parte
// dela por outro caminho. `estoqueAtualPorId` mapeia itemId -> quantidade
// atual (0 quando o documento nao existe mais).
export const findItemSemEstoqueParaReverter = (
  itens: ItemParaReverterEstoque[],
  estoqueAtualPorId: Map<string, number>,
): ItemParaReverterEstoque | null => {
  for (const item of itens) {
    const atual = estoqueAtualPorId.get(item.itemId) ?? 0;
    if (atual < item.quantidade) return item;
  }
  return null;
};
