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
