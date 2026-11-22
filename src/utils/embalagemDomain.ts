// Funcoes puras de Embalagem (vender o mesmo produto em KG, UN ou SC).
// Sem Firestore -- leitura/escrita fica nas telas (EstoqueForm, PedidoVendaForm,
// PDV). Ver o plano da feature para as decisoes de arquitetura.
//
// Principio central: o estoque do produto continua SEMPRE na unidade base
// (estoque/{id}.quantidade). Embalagem e uma forma de VENDER, nao um segundo
// saldo. Um saco de 20kg nao tem estoque proprio -- ele consome 20 do saldo em
// quilo. Por isso a conversao acontece so na hora de mexer no estoque
// (toStockAdjustmentItems), nunca no valor financeiro do item.

/** Casas decimais usadas ao converter para a unidade base. Existe so pra
 * absorver o erro de ponto flutuante de quantidade fracionada x fator (ex:
 * 0.1 * 3), nao pra limitar o que o usuario pode digitar -- esse limite e da
 * unidade de medida (casasDecimais), aplicado por isValidSaleQuantity. */
const BASE_QUANTITY_PRECISION = 6;

export const DEFAULT_VENDER_POR_EMBALAGEM = false;

export interface Embalagem {
  id: string;
  unidadeMedidaId: string;
  unidadeMedidaSigla: string;
  unidadeMedidaCasasDecimais: number;
  unidadeMedidaFracionado: boolean;
  descricao: string;
  /** Quantas unidades base cabem em 1 desta embalagem (20 = saco de 20kg). */
  fatorConversao: number;
  /** Preco proprio desta embalagem. 0/ausente = calcula por preco base x fator. */
  precoVenda: number;
  /** Preco a vista proprio. 0/ausente = regra de tabelaDoProduto (precoVendaDomain.ts). */
  precoAVista: number;
  /** Custo proprio (21/11/2026, pedido do dono): o tubo pode custar diferente de 6 x o metro. 0/ausente = custo do produto x fator. */
  precoCusto: number;
  codigoBarras: string;
  ativo: boolean;
}

/** So o que a regra de embalagem precisa enxergar de um produto do estoque. */
export interface ProdutoComEmbalagens {
  precoVenda?: number | null;
  unidadeMedidaSigla?: string | null;
  unidadeMedidaCasasDecimais?: number | null;
  unidadeMedidaFracionado?: boolean | null;
  embalagens?: unknown;
}

/** Uma opcao do seletor "Unidade" da venda. `embalagemId` vazio = unidade base
 * do produto (o comportamento que sempre existiu). */
export interface OpcaoUnidadeVenda {
  embalagemId: string;
  sigla: string;
  /** Rotulo do seletor: 'KG' para a base, 'SC(20,000)' para embalagem. */
  label: string;
  fatorConversao: number;
  casasDecimais: number;
  permiteFracionado: boolean;
  precoVenda: number;
  /** Precos cadastrados NA embalagem (0 = nao tem). A base tem os dois em 0:
   *  quem monta a tabela a vista/a prazo e' tabelaDoProduto. */
  precoVendaProprio: number;
  precoAVistaProprio: number;
  /** Embalagem FRACIONARIA lancada na unidade do estoque (opcaoNaUnidadeDoEstoque):
   *  de qual embalagem a opcao veio. Ausente nas opcoes normais. */
  origem?: EmbalagemDeOrigem;
}

/** De qual embalagem veio o item lancado na unidade do estoque (meio metro de areia -> 0,5 M3). */
export interface EmbalagemDeOrigem {
  embalagemId: string;
  sigla: string;
  fatorConversao: number;
}

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toTrimmedString = (value: unknown): string => (
  typeof value === 'string' ? value.trim() : ''
);

/** Formata o fator do jeito que aparece no seletor: 20 -> '20,000'. */
export const formatFatorConversao = (fator: number): string => (
  toFiniteNumber(fator, 1).toFixed(3).replace('.', ',')
);

/** Le o campo `embalagens` de um documento de estoque de forma defensiva.
 * O array vem do Firestore, entao pode ter sido gravado por uma versao antiga
 * do app ou por integracao externa -- qualquer entrada sem id ou com fator
 * invalido e descartada em vez de virar uma embalagem que baixa estoque errado. */
export const normalizeEmbalagens = (value: unknown): Embalagem[] => {
  if (!Array.isArray(value)) return [];

  return value.reduce<Embalagem[]>((embalagens, raw) => {
    if (!raw || typeof raw !== 'object') return embalagens;

    const entry = raw as Record<string, unknown>;
    const id = toTrimmedString(entry.id);
    const fatorConversao = toFiniteNumber(entry.fatorConversao);
    if (!id || fatorConversao <= 0) return embalagens;

    embalagens.push({
      id,
      unidadeMedidaId: toTrimmedString(entry.unidadeMedidaId),
      unidadeMedidaSigla: toTrimmedString(entry.unidadeMedidaSigla).toUpperCase() || 'UN',
      unidadeMedidaCasasDecimais: Math.max(0, toFiniteNumber(entry.unidadeMedidaCasasDecimais)),
      unidadeMedidaFracionado: entry.unidadeMedidaFracionado === true,
      descricao: toTrimmedString(entry.descricao),
      fatorConversao,
      precoVenda: Math.max(0, toFiniteNumber(entry.precoVenda)),
      precoAVista: Math.max(0, toFiniteNumber(entry.precoAVista)),
      precoCusto: Math.max(0, toFiniteNumber(entry.precoCusto)),
      codigoBarras: toTrimmedString(entry.codigoBarras),
      ativo: entry.ativo !== false,
    });
    return embalagens;
  }, []);
};

/** Monta as opcoes do seletor de unidade: a base primeiro, depois as
 * embalagens ativas. Produto sem embalagem devolve so a base -- que e
 * exatamente o comportamento de hoje, por isso a tela nao precisa saber se o
 * produto tem embalagem ou nao. */
export const buildOpcoesUnidadeVenda = (produto: ProdutoComEmbalagens | null | undefined): OpcaoUnidadeVenda[] => {
  const precoBase = Math.max(0, toFiniteNumber(produto?.precoVenda));
  const base: OpcaoUnidadeVenda = {
    embalagemId: '',
    sigla: toTrimmedString(produto?.unidadeMedidaSigla).toUpperCase() || 'UN',
    label: toTrimmedString(produto?.unidadeMedidaSigla).toUpperCase() || 'UN',
    fatorConversao: 1,
    casasDecimais: Math.max(0, toFiniteNumber(produto?.unidadeMedidaCasasDecimais)),
    permiteFracionado: produto?.unidadeMedidaFracionado === true,
    precoVenda: precoBase,
    precoVendaProprio: 0,
    precoAVistaProprio: 0,
  };

  const embalagens = normalizeEmbalagens(produto?.embalagens)
    .filter((embalagem) => embalagem.ativo)
    .map<OpcaoUnidadeVenda>((embalagem) => ({
      embalagemId: embalagem.id,
      sigla: embalagem.unidadeMedidaSigla,
      label: `${embalagem.unidadeMedidaSigla}(${formatFatorConversao(embalagem.fatorConversao)})`,
      fatorConversao: embalagem.fatorConversao,
      casasDecimais: embalagem.unidadeMedidaCasasDecimais,
      permiteFracionado: embalagem.unidadeMedidaFracionado,
      // Preco proprio quando cadastrado; senao deriva do preco base. Cadastrar
      // a embalagem sem preco nao pode zerar a venda.
      precoVenda: embalagem.precoVenda > 0
        ? embalagem.precoVenda
        : precoBase * embalagem.fatorConversao,
      precoVendaProprio: embalagem.precoVenda,
      precoAVistaProprio: embalagem.precoAVista,
    }));

  return [base, ...embalagens];
};

/** Acha a opcao escolhida; cai na base quando o id nao existe mais (embalagem
 * excluida/desativada depois que o item ja estava no carrinho). */
export const findOpcaoUnidadeVenda = (
  opcoes: OpcaoUnidadeVenda[],
  embalagemId: string | null | undefined,
): OpcaoUnidadeVenda => {
  const alvo = toTrimmedString(embalagemId);
  if (!alvo) return opcoes[0];
  return opcoes.find((opcao) => opcao.embalagemId === alvo) || opcoes[0];
};

/** Converte a quantidade digitada (na embalagem) para a unidade base do
 * estoque. Fator ausente/invalido = 1, que preserva todo item ja gravado
 * antes desta feature. */
export const toBaseQuantity = (quantidade: unknown, fatorConversao?: unknown): number => {
  const qtd = toFiniteNumber(quantidade);
  const fator = toFiniteNumber(fatorConversao, 1);
  const fatorValido = fator > 0 ? fator : 1;
  const base = qtd * fatorValido;
  return Number(base.toFixed(BASE_QUANTITY_PRECISION));
};

export interface ItemVendaParaEstoque {
  id: string;
  nome?: string;
  quantidade: number;
  fatorConversao?: number;
}

export interface AjusteEstoque {
  id: string;
  nome?: string;
  quantidade: number;
}

/** Mapeia itens de venda para o formato de applyStockAdjustments, convertendo
 * para a unidade base. Substitui os `.map(item => ({ id, nome, quantidade }))`
 * espalhados por PDV/Pedido/Devolucao -- sem ela, vender 1 saco baixaria 1 kg. */
export const toStockAdjustmentItems = (itens: ItemVendaParaEstoque[]): AjusteEstoque[] => (
  itens.map((item) => ({
    id: item.id,
    nome: item.nome,
    quantidade: toBaseQuantity(item.quantidade, item.fatorConversao),
  }))
);

/**
 * As opcoes de unidade que a tela oferece: com "Vender por embalagem"
 * desligado nas Configuracoes, so' a unidade base (21/11/2026: mesma regra
 * do Pedido de Venda agora tambem no Orcamento, na OS e no app Vendas).
 */
export const opcoesDeUnidadeDaTela = (
  produto: ProdutoComEmbalagens | null | undefined,
  venderPorEmbalagem: boolean,
): OpcaoUnidadeVenda[] => {
  const opcoes = buildOpcoesUnidadeVenda(produto);
  return venderPorEmbalagem ? opcoes : opcoes.slice(0, 1);
};

/**
 * Campos de unidade do item lancado (venda, orcamento, OS, app). Na unidade
 * base o item nao ganha campo de embalagem nenhum -- fica igual ao que o
 * sistema sempre gravou. Na embalagem: a sigla e as casas dela, o id, o
 * fator e a quantidade ja' convertida para o estoque.
 */
export const camposDeUnidadeDoItem = (
  opcao: OpcaoUnidadeVenda,
  quantidade: number,
): {
  unidadeMedidaSigla: string;
  unidadeMedidaCasasDecimais: number;
  unidadeMedidaFracionado: boolean;
  embalagemId?: string;
  fatorConversao?: number;
  quantidadeBase?: number;
  embalagemDeOrigem?: EmbalagemDeOrigem;
} => ({
  unidadeMedidaSigla: opcao.sigla,
  unidadeMedidaCasasDecimais: opcao.casasDecimais,
  unidadeMedidaFracionado: opcao.permiteFracionado,
  ...(opcao.embalagemId
    ? { embalagemId: opcao.embalagemId, fatorConversao: opcao.fatorConversao, quantidadeBase: toBaseQuantity(quantidade, opcao.fatorConversao) }
    : {}),
  ...(opcao.origem ? { embalagemDeOrigem: { ...opcao.origem } } : {}),
});

// ---------------------------------------------------------------------------
// EMBALAGEM FRACIONARIA ENTRA NA UNIDADE DO ESTOQUE (21/11/2026, pedido do
// dono: "a areia tem meio metro cadastrado; ao adicionar fica como se fosse
// 1 metro inteiro"). Embalagem MENOR que a unidade do estoque (fator < 1:
// meio metro = 0,5 M3, lata = 0,02 M3) nao e' um volume que existe sozinho
// -- e' um atalho de quantidade. O item entra na unidade do estoque: 1 meio
// metro a R$ 110 vira 0,5 M3 a R$ 220/M3 (total R$ 110), e a nota sai em M3.
// O preco da embalagem continua valendo: os precos proprios dela sao divididos
// pelo fator e viram a tabela do item (a conferencia de preco do servidor faz
// a mesma conta pelo `embalagemDeOrigem`). Embalagem de fator >= 1 (tubo, rolo,
// saco) segue como sempre: o item fica na embalagem.
// ---------------------------------------------------------------------------

/** Embalagem que e' uma fracao da unidade do estoque (fator entre 0 e 1). */
export const embalagemFracionaria = (opcao: { embalagemId?: unknown; fatorConversao?: unknown } | null | undefined): boolean => {
  const fator = toFiniteNumber(opcao?.fatorConversao, 1);
  return Boolean(toTrimmedString(opcao?.embalagemId)) && fator > 0 && fator < 1;
};

/** Casas decimais de um numero (0,5 -> 1; 0,02 -> 2; 0,125 -> 3), ate' 6. */
const casasDoNumero = (valor: number): number => {
  const texto = Number(valor.toFixed(BASE_QUANTITY_PRECISION)).toString();
  const ponto = texto.indexOf('.');
  return ponto < 0 ? 0 : Math.min(BASE_QUANTITY_PRECISION, texto.length - ponto - 1);
};

const precoPorUnidadeDoEstoque = (preco: number, fator: number): number => (
  preco > 0 ? Number((preco / fator).toFixed(BASE_QUANTITY_PRECISION)) : 0
);

/**
 * A opcao que a tela usa para LANCAR o item. Embalagem fracionaria vira a
 * unidade do estoque: sigla e casas do estoque (no minimo as do fator, para
 * caber 0,5), fracionado, fator 1, precos da embalagem divididos pelo fator e
 * `origem` dizendo de qual embalagem veio. Qualquer outra opcao volta igual.
 */
export const opcaoNaUnidadeDoEstoque = (opcao: OpcaoUnidadeVenda, base: OpcaoUnidadeVenda): OpcaoUnidadeVenda => {
  if (!embalagemFracionaria(opcao)) return opcao;
  const fator = opcao.fatorConversao;
  return {
    embalagemId: '',
    sigla: base.sigla,
    label: base.label,
    fatorConversao: 1,
    casasDecimais: Math.max(base.casasDecimais, casasDoNumero(fator)),
    permiteFracionado: true,
    precoVenda: precoPorUnidadeDoEstoque(opcao.precoVenda, fator),
    precoVendaProprio: precoPorUnidadeDoEstoque(opcao.precoVendaProprio, fator),
    precoAVistaProprio: precoPorUnidadeDoEstoque(opcao.precoAVistaProprio, fator),
    origem: { embalagemId: opcao.embalagemId, sigla: opcao.sigla, fatorConversao: fator },
  };
};

/**
 * A opcao de LANCAMENTO de um item ja' gravado que veio de embalagem
 * fracionaria (orcamento virando pedido, quantidade editada na grade). A
 * embalagem que sumiu do cadastro cai na unidade do estoque com o preco do
 * produto -- a quantidade do item ja' esta' na unidade do estoque.
 */
export const opcaoDoItemDeOrigem = (
  produto: ProdutoComEmbalagens | null | undefined,
  origem: unknown,
): OpcaoUnidadeVenda | null => {
  if (!origem || typeof origem !== 'object') return null;
  const embalagemId = toTrimmedString((origem as Record<string, unknown>).embalagemId);
  if (!embalagemId) return null;
  const opcoes = buildOpcoesUnidadeVenda(produto);
  const daEmbalagem = opcoes.find((opcao) => opcao.embalagemId === embalagemId);
  return daEmbalagem && embalagemFracionaria(daEmbalagem)
    ? opcaoNaUnidadeDoEstoque(daEmbalagem, opcoes[0])
    : { ...opcoes[0], permiteFracionado: true, casasDecimais: Math.max(opcoes[0].casasDecimais, 3) };
};

/**
 * A opcao de um item ja' gravado (orcamento virando pedido, item reaberto).
 * Diferente de findOpcaoUnidadeVenda, NAO cai na base quando a embalagem
 * sumiu: a quantidade estava em embalagem e viraria unidade base sem aviso
 * (1 rolo viraria 1 metro). Devolve null e quem chama avisa.
 */
export const opcaoDoItemGravado = (
  produto: ProdutoComEmbalagens | null | undefined,
  embalagemId: unknown,
): OpcaoUnidadeVenda | null => {
  const opcoes = buildOpcoesUnidadeVenda(produto);
  const alvo = toTrimmedString(embalagemId);
  if (!alvo) return opcoes[0];
  return opcoes.find((opcao) => opcao.embalagemId === alvo) || null;
};

/** A unidade para a tabela de preco (tabelaDoProduto / tabelaComPromocao): fator e os precos proprios da embalagem. */
export const unidadeDePrecoDaOpcao = (opcao: OpcaoUnidadeVenda): { fatorConversao: number; precoProprio: number; precoAVistaProprio: number } => ({
  fatorConversao: opcao.fatorConversao,
  // Embalagem fracionaria na unidade do estoque (origem): os precos proprios ja' vem divididos pelo fator.
  precoProprio: opcao.embalagemId || opcao.origem ? Number(opcao.precoVendaProprio) || 0 : 0,
  precoAVistaProprio: opcao.embalagemId || opcao.origem ? Number(opcao.precoAVistaProprio) || 0 : 0,
});

/**
 * Custo da embalagem (21/11/2026): o proprio, quando cadastrado; senao o custo
 * do produto (unidade base) x fator. Ex.: metro a R$ 4, tubo de 6 m sem custo
 * proprio = R$ 24; com custo proprio de R$ 20, vale R$ 20.
 */
export const custoDaEmbalagem = (embalagem: { precoCusto?: unknown; fatorConversao?: unknown }, custoDaBase: unknown): number => {
  const proprio = Math.max(0, toFiniteNumber(embalagem.precoCusto));
  if (proprio > 0) return proprio;
  const fator = toFiniteNumber(embalagem.fatorConversao, 1);
  return Math.round(Math.max(0, toFiniteNumber(custoDaBase)) * (fator > 0 ? fator : 1) * 100) / 100;
};

/** Margem sobre o custo, a mesma conta do cadastro do produto: (venda - custo) / custo. Sem custo = null. */
export const margemSobreCusto = (preco: unknown, custo: unknown): number | null => {
  const c = toFiniteNumber(custo);
  if (!(c > 0)) return null;
  return ((toFiniteNumber(preco) - c) / c) * 100;
};

/** O que a embalagem copia da unidade de medida dela. */
export interface UnidadeDaEmbalagem {
  sigla?: unknown;
  permiteFracionado?: unknown;
  casasDecimais?: unknown;
}

/**
 * Refaz a copia da unidade nas embalagens (21/11/2026). Caso real (Jomarly,
 * PREGO 10 X 10 vendido em G de 0,100 KG): a unidade G foi marcada como
 * "Fracionada" depois e a venda continuou recusando 0,5 G, porque a
 * embalagem guarda uma COPIA de "Fracionada" e das casas decimais feita ao
 * salvar o produto. `acharUnidade` diz a unidade atual de cada embalagem
 * (null = deixa como esta'). Os outros campos da embalagem ficam intactos.
 */
export const embalagensComUnidadesAtuais = (
  embalagens: unknown,
  acharUnidade: (embalagem: { unidadeMedidaId: string; unidadeMedidaSigla: string }) => UnidadeDaEmbalagem | null,
): { embalagens: unknown[]; alteradas: number; travadas: number } => {
  if (!Array.isArray(embalagens)) return { embalagens: [], alteradas: 0, travadas: 0 };
  let alteradas = 0;
  let travadas = 0;
  const novas = embalagens.map((raw) => {
    if (!raw || typeof raw !== 'object') return raw;
    const entry = raw as Record<string, unknown>;
    const unidade = acharUnidade({
      unidadeMedidaId: toTrimmedString(entry.unidadeMedidaId),
      unidadeMedidaSigla: toTrimmedString(entry.unidadeMedidaSigla).toUpperCase(),
    });
    if (!unidade) return raw;
    const fracionado = unidade.permiteFracionado === true;
    const casas = Math.max(0, Math.trunc(toFiniteNumber(unidade.casasDecimais)));
    const sigla = toTrimmedString(unidade.sigla).toUpperCase() || toTrimmedString(entry.unidadeMedidaSigla).toUpperCase() || 'UN';
    const mudou = (entry.unidadeMedidaFracionado === true) !== fracionado
      || toFiniteNumber(entry.unidadeMedidaCasasDecimais) !== casas
      || toTrimmedString(entry.unidadeMedidaSigla).toUpperCase() !== sigla;
    if (!mudou) return raw;
    alteradas += 1;
    // "Travada" = a unidade aceita fracao e a copia recusava (o caso da venda barrada).
    if (fracionado && entry.unidadeMedidaFracionado !== true) travadas += 1;
    return { ...entry, unidadeMedidaFracionado: fracionado, unidadeMedidaCasasDecimais: casas, unidadeMedidaSigla: sigla };
  });
  return { embalagens: novas, alteradas, travadas };
};
