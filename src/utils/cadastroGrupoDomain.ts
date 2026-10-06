/**
 * CADASTRO COMPARTILHADO DO GRUPO (Filiais, fase 1 -- 2026-10-06).
 *
 * Decisao do dono: clientes e o cadastro de produtos sao do GRUPO; preco,
 * custo e estoque sao de cada filial. Cada filial e' uma empresa (tenant)
 * propria, entao cada uma guarda uma COPIA de cada cliente e de cada
 * produto, e o servidor mantem as copias iguais (server/services/
 * espelhoCadastros.js). Assim nenhuma tela de venda ou de estoque muda: cada
 * uma continua lendo e baixando o produto da filial em que esta.
 *
 * Como as copias se reconhecem:
 *  - `grupoChave`: a mesma em todas as copias (o id do documento original);
 *  - `filialOrigem`: a filial em que o cadastro nasceu (o filtro "Itens desta
 *    filial" usa isto);
 *  - `cadastroHash`: assinatura dos campos do grupo. Documento cujo conteudo
 *    nao bate com a propria assinatura foi alterado por alguem -> o servidor
 *    espalha a mudanca. Bateu -> e' eco de uma copia que o proprio servidor
 *    gravou, nada a fazer.
 *
 * Este arquivo e' puro (sem Firestore): a tela usa para o filtro e para a
 * trava de edicao; o servidor usa para planejar as gravacoes.
 */

export type ColecaoEspelhada = 'unidades_medida' | 'categorias' | 'marcas' | 'clientes' | 'estoque';

/** Na ordem em que o servidor liga o espelho: catalogos antes dos produtos (unidade). */
export const COLECOES_ESPELHADAS: ColecaoEspelhada[] = ['unidades_medida', 'categorias', 'marcas', 'clientes', 'estoque'];

/** Campos de controle de cada copia: nunca sao comparados nem copiados. */
const CAMPOS_DE_CONTROLE = new Set([
  'id', 'tenantId', 'grupoChave', 'filialOrigem', 'cadastroHash',
  'createdAt', 'updatedAt', 'criadoEm', 'criadoPor', 'alteradoEm', 'alteradoPor', 'ultimaAlteracao',
  'createdBy', 'updatedBy', 'createdByName', 'updatedByName',
]);

/**
 * Campos do PRODUTO que sao do grupo. Lista fechada de proposito: campo novo
 * no produto nasce "da filial" ate alguem decidir que e' do grupo -- o erro
 * seguro e' nao espalhar.
 */
export const CAMPOS_DO_PRODUTO_NO_GRUPO = [
  'codigo', 'codigoAutomatico', 'nome', 'categoria', 'marca', 'referencia', 'codigoBarras',
  'descricaoCurta', 'descricaoCompleta', 'observacoesInternas', 'imagemProduto', 'tags',
  'unidadeMedidaSigla', 'unidadeMedidaNome', 'unidadeMedidaFracionado', 'unidadeMedidaCasasDecimais', 'produtoFracionado',
  'peso', 'altura', 'largura', 'comprimento', 'pesoLiquidoUnitarioKg', 'pesoEnvio',
  'ncm', 'cest', 'origem', 'codigoAnp',
  'skuSistema', 'slugUrl', 'seoTitulo', 'seoDescricao', 'descricaoMarketplace', 'imagensMarketplace',
  'produzidoInternamente', 'produtoServico', 'produtoRevenda', 'controlarEstoque',
  'exigirSerialLote', 'controlarLote', 'permiteCondicional', 'permitirCashback', 'produtoDestaque',
  'ativo', 'statusAtivo',
];

/**
 * Campos do produto que NAO vao para a copia de uma filial nova (o estoque
 * dela comeca zerado). Todo o resto (precos, custo, tributacao, embalagens)
 * comeca igual ao da matriz e cada filial ajusta o seu.
 */
const CAMPOS_ZERADOS_NA_COPIA_DO_PRODUTO: Record<string, unknown> = {
  quantidade: 0,
  quantidadeReservada: 0,
  estoqueMinimo: 0,
  estoqueMaximo: 0,
  localizacaoEstoque: '',
  fornecedor: '',
  fornecedorId: '',
  codigoProdutoFornecedor: '',
  dataUltimaCompra: '',
  lote: '',
  validade: '',
};

export interface DocDoEspelho {
  id: string;
  tenantId: string;
  dados: Record<string, unknown>;
}

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const normalizar = (v: unknown): string => texto(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ');

/** Consumidor final de cada empresa nao e' espelhado: cada filial tem o seu. */
export const participaDoEspelho = (colecao: ColecaoEspelhada, dados: Record<string, unknown>): boolean => (
  !(colecao === 'clientes' && dados.isPadrao === true)
);

/** Os campos do cadastro que sao do grupo (iguais em todas as filiais). */
export const camposDoGrupo = (colecao: ColecaoEspelhada, dados: Record<string, unknown>): Record<string, unknown> => {
  const resultado: Record<string, unknown> = {};
  if (colecao === 'estoque') {
    for (const campo of CAMPOS_DO_PRODUTO_NO_GRUPO) {
      if (dados[campo] !== undefined) resultado[campo] = dados[campo];
    }
    return resultado;
  }
  for (const [campo, valor] of Object.entries(dados)) {
    if (CAMPOS_DE_CONTROLE.has(campo) || valor === undefined) continue;
    // Referencia de unidade e' id local de cada filial (remapeado pela sigla).
    if (campo === 'unidadeMedidaId') continue;
    resultado[campo] = valor;
  }
  return resultado;
};

/** JSON com chaves em ordem: a mesma informacao sempre gera o mesmo texto. */
const jsonEstavel = (valor: unknown): string => {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor ?? null);
  // Timestamp do Firestore (cliente ou Admin SDK): compara pelo instante.
  const t = valor as { seconds?: unknown; _seconds?: unknown; nanoseconds?: unknown; _nanoseconds?: unknown };
  if (typeof t.seconds === 'number' || typeof t._seconds === 'number') {
    return `"ts:${t.seconds ?? t._seconds}.${t.nanoseconds ?? t._nanoseconds ?? 0}"`;
  }
  if (Array.isArray(valor)) return `[${valor.map(jsonEstavel).join(',')}]`;
  const chaves = Object.keys(valor as Record<string, unknown>).filter((k) => (valor as Record<string, unknown>)[k] !== undefined).sort();
  return `{${chaves.map((k) => `${JSON.stringify(k)}:${jsonEstavel((valor as Record<string, unknown>)[k])}`).join(',')}}`;
};

/** Assinatura curta dos campos do grupo (djb2 em 2 sementes, base 36). */
export const hashDoCadastro = (campos: Record<string, unknown>): string => {
  const s = jsonEstavel(campos);
  let a = 5381;
  let b = 52711;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    a = ((a << 5) + a + c) | 0;
    b = ((b << 5) + b + c) | 0;
  }
  return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
};

export const chaveDoGrupo = (doc: DocDoEspelho): string => texto(doc.dados.grupoChave) || doc.id;

/** Id da copia numa filial (deterministico: reprocessar nunca duplica). */
export const idDaCopia = (chave: string, tenantDestino: string): string => `${chave}_${tenantDestino}`;

/**
 * Chave "natural" para LIGAR um cadastro que ja' existe na filial em vez de
 * criar outro igual (as unidades padrao UN, KG... nascem em toda empresa).
 */
export const chaveNatural = (colecao: ColecaoEspelhada, dados: Record<string, unknown>): string | null => {
  if (colecao === 'unidades_medida') return normalizar(dados.sigla) || null;
  if (colecao === 'categorias' || colecao === 'marcas') return normalizar(dados.nome) || null;
  if (colecao === 'clientes') {
    const documento = String(dados.documento ?? '').replace(/\D/g, '');
    return documento.length >= 11 ? documento : null;
  }
  return null;
};

// ---------------------------------------------------------------------------
// Indice em memoria (o servidor monta um por grupo e por colecao)
// ---------------------------------------------------------------------------

export interface IndiceDoEspelho {
  porChave: Map<string, Map<string, DocDoEspelho>>;
  porNatural: Map<string, Map<string, DocDoEspelho>>;
  porId: Map<string, DocDoEspelho>;
}

export const criarIndice = (): IndiceDoEspelho => ({ porChave: new Map(), porNatural: new Map(), porId: new Map() });

export const indexar = (colecao: ColecaoEspelhada, indice: IndiceDoEspelho, doc: DocDoEspelho): void => {
  const anterior = indice.porId.get(doc.id);
  if (anterior) {
    indice.porChave.get(chaveDoGrupo(anterior))?.delete(anterior.tenantId);
    const naturalAnterior = chaveNatural(colecao, anterior.dados);
    if (naturalAnterior && indice.porNatural.get(anterior.tenantId)?.get(naturalAnterior)?.id === anterior.id) {
      indice.porNatural.get(anterior.tenantId)!.delete(naturalAnterior);
    }
  }
  indice.porId.set(doc.id, doc);
  const chave = chaveDoGrupo(doc);
  if (!indice.porChave.has(chave)) indice.porChave.set(chave, new Map());
  indice.porChave.get(chave)!.set(doc.tenantId, doc);
  const natural = chaveNatural(colecao, doc.dados);
  if (natural) {
    if (!indice.porNatural.has(doc.tenantId)) indice.porNatural.set(doc.tenantId, new Map());
    if (!indice.porNatural.get(doc.tenantId)!.has(natural)) indice.porNatural.get(doc.tenantId)!.set(natural, doc);
  }
};

// ---------------------------------------------------------------------------
// Planejamento das gravacoes
// ---------------------------------------------------------------------------

export interface GravacaoDoEspelho {
  tipo: 'criar' | 'atualizar';
  tenantId: string;
  id: string;
  campos: Record<string, unknown>;
}

export interface ContextoDoEspelho {
  colecao: ColecaoEspelhada;
  /** Todas as filiais do grupo (inclusive inativas: o cadastro continua igual). */
  filiais: string[];
  matrizTenantId: string;
  indice: IndiceDoEspelho;
  /** Id da unidade com esta sigla na filial (para remapear o produto), ou null. */
  unidadeNaFilial?: (tenantId: string, sigla: string) => string | null;
}

const igualNoGrupo = (a: unknown, b: unknown) => jsonEstavel(a) === jsonEstavel(b);

/** O que a copia de uma filial precisa receber para ficar igual ao cadastro do grupo. */
const diferencasDoGrupo = (compartilhados: Record<string, unknown>, destino: Record<string, unknown>): Record<string, unknown> => {
  const mudancas: Record<string, unknown> = {};
  for (const [campo, valor] of Object.entries(compartilhados)) {
    if (!igualNoGrupo(valor, destino[campo])) mudancas[campo] = valor;
  }
  return mudancas;
};

const unidadeRemapeada = (ctx: ContextoDoEspelho, tenantId: string, dados: Record<string, unknown>): Record<string, unknown> => {
  if (ctx.colecao !== 'estoque' || !ctx.unidadeNaFilial) return {};
  const sigla = texto(dados.unidadeMedidaSigla);
  if (!sigla) return {};
  return { unidadeMedidaId: ctx.unidadeNaFilial(tenantId, sigla) ?? '' };
};

/** Documento novo de uma filial, a partir do cadastro (preco e tributacao da matriz quando houver). */
const copiaInicial = (ctx: ContextoDoEspelho, chave: string, base: DocDoEspelho, compartilhados: Record<string, unknown>, origem: string, hash: string, tenantDestino: string) => {
  const daMatriz = ctx.indice.porChave.get(chave)?.get(ctx.matrizTenantId);
  const modelo = (daMatriz ?? base).dados;
  const copia: Record<string, unknown> = {};
  for (const [campo, valor] of Object.entries(modelo)) {
    if (CAMPOS_DE_CONTROLE.has(campo) || valor === undefined) continue;
    copia[campo] = valor;
  }
  return {
    ...copia,
    ...(ctx.colecao === 'estoque' ? CAMPOS_ZERADOS_NA_COPIA_DO_PRODUTO : {}),
    ...compartilhados,
    ...unidadeRemapeada(ctx, tenantDestino, compartilhados),
    tenantId: tenantDestino,
    grupoChave: chave,
    filialOrigem: origem,
    cadastroHash: hash,
  };
};

/**
 * Dado um documento que mudou (ou apareceu) numa filial, devolve as
 * gravacoes que deixam o grupo igual:
 *  - o proprio documento ganha grupoChave/filialOrigem/cadastroHash;
 *  - filial sem a copia: cria (ou LIGA um cadastro igual que ja' exista,
 *    pela chave natural);
 *  - copia diferente: so' quando a mudanca e' de alguem (assinatura nao
 *    bate), atualiza os campos do grupo -- eco do proprio servidor nunca
 *    sobrescreve uma edicao que ainda esta para ser processada.
 */
export const planejarEspelho = (ctx: ContextoDoEspelho, doc: DocDoEspelho): GravacaoDoEspelho[] => {
  if (!participaDoEspelho(ctx.colecao, doc.dados)) return [];
  const compartilhados = camposDoGrupo(ctx.colecao, doc.dados);
  const hash = hashDoCadastro(compartilhados);
  const chave = chaveDoGrupo(doc);
  const origem = texto(doc.dados.filialOrigem) || doc.tenantId;
  const alteradoPorAlguem = texto(doc.dados.cadastroHash) !== hash;
  const gravacoes: GravacaoDoEspelho[] = [];

  if (texto(doc.dados.grupoChave) !== chave || texto(doc.dados.filialOrigem) !== origem || alteradoPorAlguem) {
    gravacoes.push({ tipo: 'atualizar', tenantId: doc.tenantId, id: doc.id, campos: { grupoChave: chave, filialOrigem: origem, cadastroHash: hash } });
  }

  for (const tenantDestino of ctx.filiais) {
    if (tenantDestino === doc.tenantId) continue;
    const irmao = ctx.indice.porChave.get(chave)?.get(tenantDestino);
    if (irmao) {
      if (!alteradoPorAlguem || texto(irmao.dados.cadastroHash) === hash) continue;
      const mudancas = diferencasDoGrupo(compartilhados, irmao.dados);
      gravacoes.push({
        tipo: 'atualizar',
        tenantId: tenantDestino,
        id: irmao.id,
        campos: { ...mudancas, ...unidadeRemapeada(ctx, tenantDestino, compartilhados), cadastroHash: hash },
      });
      continue;
    }
    // Sem copia na filial: liga um cadastro igual (mesma chave natural, ainda solto) ou cria.
    const natural = chaveNatural(ctx.colecao, doc.dados);
    const candidato = natural ? ctx.indice.porNatural.get(tenantDestino)?.get(natural) : undefined;
    const candidatoSolto = candidato && (!texto(candidato.dados.grupoChave) || texto(candidato.dados.grupoChave) === candidato.id)
      && (ctx.indice.porChave.get(chaveDoGrupo(candidato))?.size ?? 0) <= 1;
    if (candidato && candidatoSolto) {
      gravacoes.push({
        tipo: 'atualizar',
        tenantId: tenantDestino,
        id: candidato.id,
        campos: { ...diferencasDoGrupo(compartilhados, candidato.dados), grupoChave: chave, filialOrigem: origem, cadastroHash: hash },
      });
      continue;
    }
    gravacoes.push({
      tipo: 'criar',
      tenantId: tenantDestino,
      id: idDaCopia(chave, tenantDestino),
      campos: copiaInicial(ctx, chave, doc, compartilhados, origem, hash, tenantDestino),
    });
  }
  return gravacoes;
};

/** Aplica as gravacoes planejadas no indice, para o proximo planejamento ja' enxergar. */
export const aplicarNoIndice = (colecao: ColecaoEspelhada, indice: IndiceDoEspelho, gravacoes: GravacaoDoEspelho[]): void => {
  for (const g of gravacoes) {
    const atual = indice.porId.get(g.id);
    const dados = g.tipo === 'criar' ? { ...g.campos } : { ...(atual?.dados ?? {}), ...g.campos };
    indexar(colecao, indice, { id: g.id, tenantId: g.tenantId, dados });
  }
};

// ---------------------------------------------------------------------------
// Na tela: filtro "Itens desta filial" e trava de edicao
// ---------------------------------------------------------------------------

/**
 * O item "e' desta filial": cadastrado nela, ou com estoque nela (recebido
 * por transferencia ou nota -- decisao do dono, 06/10). Item sem
 * filialOrigem (empresa sem filiais, ou antes do espelho) conta como desta.
 */
export const itemDaFilial = (produto: { filialOrigem?: unknown; quantidade?: unknown }, tenantId: string | null | undefined): boolean => {
  const origem = texto(produto.filialOrigem);
  if (!origem || !tenantId || origem === tenantId) return true;
  return Number(produto.quantidade) > 0;
};

/** O cadastro (parte do grupo) mudou entre o que foi aberto e o que vai ser salvo? */
export const mudouCadastroDoGrupo = (colecao: ColecaoEspelhada, antes: Record<string, unknown>, depois: Record<string, unknown>): boolean => (
  hashDoCadastro(camposDoGrupo(colecao, antes)) !== hashDoCadastro(camposDoGrupo(colecao, depois))
);
