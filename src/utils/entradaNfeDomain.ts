// Fundacao do historico de Entrada de NF-e (2026-08-14, Fatia 0/N). So
// monta o formato do registro -- a leitura/listagem (Fatia 1), a
// classificacao Revenda/Materia-Prima (Fatia 2) e a exclusao com reversao
// (Fatia 3) vem depois. Nesta fatia todo item gravado e 'revenda', porque
// a importacao ainda so escreve em `estoque` (ver EntradaNFE.tsx).

export type NotaFiscalEntradaItemTipo = 'revenda' | 'materia_prima';
export type NotaFiscalEntradaStatus = 'ativa' | 'excluida';

export interface ImpostosDoItemRecord {
  icms: { origem: string; situacao: string; base: number; aliquota: number; valor: number; baseSt: number; valorSt: number };
  ipi: { situacao: string; aliquota: number; valor: number };
  pis: { situacao: string; aliquota: number; valor: number };
  cofins: { situacao: string; aliquota: number; valor: number };
}

export interface NotaFiscalEntradaItemRecord {
  itemId: string;
  tipo: NotaFiscalEntradaItemTipo;
  codigoXml: string;
  descricaoXml: string;
  quantidade: number;
  valorUnitario: number;
  novo: boolean;
  // Detalhes gravados a partir de 2026-09-24 (notas antigas nao os tem).
  ncm?: string;
  cest?: string;
  ean?: string;
  cfop?: string;
  unidadeNota?: string;
  /** Unidades de estoque por unidade da nota. */
  fator?: number;
  quantidadeEstoque?: number;
  /** Custo total pago por este item (com frete, IPI, ST, desconto...). */
  custoTotal?: number;
  custoUnitarioEstoque?: number;
  impostos?: ImpostosDoItemRecord;
  lote?: string;
  validade?: string;
}

/** Firestore recusa `undefined` (CLAUDE.md): tira a chave de vez, em qualquer profundidade. */
export const semUndefined = <T>(valor: T): T => {
  if (Array.isArray(valor)) return valor.map((item) => semUndefined(item)) as unknown as T;
  if (valor && typeof valor === 'object' && Object.getPrototypeOf(valor) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(valor as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, semUndefined(v)]),
    ) as T;
  }
  return valor;
};

export interface NotaFiscalEntradaRecordInput {
  numeroNF: string;
  dataEmissao: string;
  valorTotal: number;
  fornecedorId: string;
  fornecedorNome: string;
  fornecedorCnpj: string;
  itens: NotaFiscalEntradaItemRecord[];
  titulosPagarIds: string[];
  /** Chave de acesso (44 digitos). Base do bloqueio de nota duplicada. */
  chaveAcesso?: string;
  serie?: string;
  modelo?: string;
  naturezaOperacao?: string;
  /** AAAA-MM-DD: dia em que a mercadoria entrou (pode ser diferente da emissao). */
  dataEntrada?: string;
  observacao?: string;
  /** Totais da nota como vieram no XML. */
  totais?: Record<string, number>;
  /** Como o custo foi calculado (creditos aproveitados, frete lancado). */
  custo?: { creditarIcms: boolean; creditarPisCofins: boolean; frete: number };
  pagamento?: Record<string, unknown>;
  transporte?: Record<string, unknown>;
  /** XML original, gzip + base64 (ver xmlCompactoDomain). Ausente se passou do limite. */
  xmlGzipBase64?: string;
}

export interface NotaFiscalEntradaRecord extends NotaFiscalEntradaRecordInput {
  status: NotaFiscalEntradaStatus;
}

// Pura -- o timestamp/tenantId/metadados de responsabilidade sao
// acrescentados pelo chamador (mesmo padrao de buildDocumentMetadata),
// pra este helper nao depender do Firestore.
export const buildNotaFiscalEntradaRecord = (input: NotaFiscalEntradaRecordInput): NotaFiscalEntradaRecord => semUndefined({
  ...input,
  status: 'ativa' as const,
});

/** Nota ja lancada que barra a mesma nota de entrar de novo. */
export interface NotaJaLancada {
  numeroNF: string;
  dataEmissao: string;
  fornecedorNome: string;
  status?: string;
}

/**
 * Mensagem para a nota que ja foi lancada. Nota EXCLUIDA nao conta: a pessoa
 * excluiu justamente para poder lancar de novo.
 */
export const mensagemDeNotaDuplicada = (existente: NotaJaLancada): string => {
  const emissao = existente.dataEmissao ? existente.dataEmissao.split('-').reverse().join('/') : '';
  return `Esta nota já foi lançada: NF ${existente.numeroNF}${emissao ? ` de ${emissao}` : ''}, ${existente.fornecedorNome}. `
    + 'Lançar de novo somaria o estoque e as contas a pagar em dobro. Se o lançamento anterior estava errado, exclua-o no Histórico de Entradas e lance esta nota outra vez.';
};

/** Entre as notas encontradas, a primeira que ainda vale (nao excluida). */
export const primeiraNotaAtiva = <T extends { status?: string }>(notas: T[]): T | null => (
  notas.find((nota) => (nota.status ?? 'ativa') !== 'excluida') ?? null
);

// Fatia 2/N -- classificacao Materia-Prima/Revenda + precificacao na tela
// de lancamento (2026-08-14). Decisoes confirmadas com o usuario: item ja
// reconhecido (em `estoque` OU `materias_primas`, via o matching de
// fiscalDomain.ts) mantem o destino conhecido automaticamente -- so item
// novo pede escolha manual. Precificacao (preco de venda + tributacao)
// aparece pra todo item de Revenda, novo ou ja cadastrado; nunca pra
// Materia-Prima (o cadastro dela nao tem esses campos).

export type ItemEntradaClassificacao = 'estoque' | 'materia_prima' | 'novo';

/** Como o item foi ligado a um cadastro existente (a tela mostra de onde veio). */
export type OrigemDoVinculoItem = 'ean' | 'codigo_fornecedor' | 'nome' | 'automatico' | 'manual';

export interface ItemEntradaConfig {
  classificacao: ItemEntradaClassificacao;
  matchId: string | null;
  /** So faz sentido quando classificacao != 'novo'. Vazio = nao informado. */
  origemVinculo?: OrigemDoVinculoItem;
  tipo: NotaFiscalEntradaItemTipo;
  precoVenda: string;
  csosn: string;
  aliquotaIcms: string;
  reducaoBaseIcms: string;
  cstPis: string;
  aliquotaPis: string;
  cstCofins: string;
  aliquotaCofins: string;
  /**
   * Quantas unidades de ESTOQUE cabem em 1 unidade da NOTA (1 PCT = 1 KG -> '1';
   * 1 CX = 12 UN -> '12'). Sem isso, nota em caixa com estoque em unidade
   * gravava quantidade e custo por caixa.
   */
  fator: string;
  /** O preco de venda foi mexido pela pessoa? Se nao, item novo acompanha o custo real. */
  precoEditado: boolean;
  /** Desconto maximo (%) do produto. Vazio = nao mexe no que o cadastro tem. */
  descontoMaximo: string;
  atacadoAtivo: boolean;
  atacadoQtdMinima: string;
  atacadoPreco: string;
  /** Produto ja tem mais de uma faixa de atacado: a entrada nao mexe (edita no cadastro). */
  atacadoBloqueado: boolean;
  lote: string;
  validade: string;
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
  descontoMaximoPercentual?: number;
  atacado?: { ativo?: boolean; quantidadeMinima?: number; faixas?: Array<{ preco?: number; quantidadeInicial?: number }> };
}

/** Campos da entrada que nao dependem de o item ser novo ou existente. */
const EXTRAS_PADRAO = {
  fator: '1',
  precoEditado: false,
  descontoMaximo: '',
  atacadoAtivo: false,
  atacadoQtdMinima: '',
  atacadoPreco: '',
  atacadoBloqueado: false,
  lote: '',
  validade: '',
};

/** Atacado ja cadastrado -> campos da tela. Mais de uma faixa = so leitura. */
const extrasDoProduto = (produto: ProdutoFiscalAtual) => {
  const faixas = produto.atacado?.faixas ?? [];
  const ativo = Boolean(produto.atacado?.ativo) && faixas.length > 0;
  return {
    ...EXTRAS_PADRAO,
    descontoMaximo: produto.descontoMaximoPercentual ? String(produto.descontoMaximoPercentual) : '',
    atacadoAtivo: ativo,
    atacadoQtdMinima: ativo ? String(faixas[0].quantidadeInicial ?? produto.atacado?.quantidadeMinima ?? '') : '',
    atacadoPreco: ativo && faixas[0].preco ? String(faixas[0].preco) : '',
    atacadoBloqueado: faixas.length > 1,
  };
};

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
      ...extrasDoProduto(produtoExistente),
      // Produto que JA tem preco: a entrada nunca o reajusta sozinha.
      precoEditado: produtoExistente.precoVenda !== undefined,
    };
  }

  if (materiaPrimaExistenteId) {
    return {
      classificacao: 'materia_prima',
      matchId: materiaPrimaExistenteId,
      tipo: 'materia_prima',
      ...EMPTY_TAX_FIELDS,
      ...EXTRAS_PADRAO,
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
    ...EXTRAS_PADRAO,
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

/**
 * CFOP de SAIDA sugerido para produto novo, a partir do CFOP que o fornecedor
 * usou na venda para nos (5102 -> 5102; 6102 interestadual -> 5102 dentro do
 * estado; 6403/5405 de substituicao tributaria -> 5405). A nota de entrada
 * trazia o CFOP do fornecedor direto para o campo "CFOP padrao de saida" do
 * produto, o que estava errado para nota interestadual (6xxx) ou de compra
 * para industrializacao. Fora dos grupos 5 e 6, nao chuta.
 */
export const cfopDeSaidaSugerido = (cfopDoFornecedor: string): string => {
  const cfop = String(cfopDoFornecedor || '').replace(/\D/g, '');
  if (cfop.length !== 4) return '';
  if (cfop[0] === '6') return `5${cfop.slice(1)}`;
  if (cfop[0] === '5') return cfop;
  return '';
};
