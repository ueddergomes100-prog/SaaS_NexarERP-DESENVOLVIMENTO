/**
 * LISTA DE ESTOQUE: AS UNIDADES DE VENDA DE CADA PRODUTO, COM OS VALORES
 * (21/11/2026, pedido do dono: "nao aparece as embalagens, valores, ai teria
 * que ficar entrando em item por item pra ver os valores das embalagens").
 *
 * Regras puras da lista "Estoque e Produtos": a unidade do estoque (metro,
 * quilo) e cada embalagem ATIVA (tubo, rolo, saco) viram uma linha com custo,
 * preco de venda, preco a vista e margem. Nada aqui inventa regra de preco:
 *   - preco de venda e a vista da embalagem: tabelaDoProduto (precoVendaDomain.ts),
 *     a mesma conta do Pedido de Venda;
 *   - custo da embalagem: custoDaEmbalagem (embalagemDomain.ts);
 *   - margem: margemSobreCusto, a mesma conta do cadastro do produto.
 * "Calculado" marca o valor que nao foi digitado na embalagem (veio do produto
 * x fator), para o usuario saber o que e' dele e o que o sistema deduziu.
 */
import { custoDaEmbalagem, margemSobreCusto, normalizeEmbalagens } from './embalagemDomain';
import { tabelaDoProduto } from './precoVendaDomain';

/** O que a lista precisa enxergar do produto do estoque. */
export interface ProdutoDaListaDeEstoque {
  precoVenda?: unknown;
  precoAVista?: unknown;
  precoCusto?: unknown;
  /** Cadastro antigo: precos agrupados. */
  precos?: { venda?: unknown; aVista?: unknown; custo?: unknown } | null;
  unidadeMedidaSigla?: unknown;
  unidadeMedidaCasasDecimais?: unknown;
  codigoBarras?: unknown;
  embalagens?: unknown;
}

export interface UnidadeDeVendaDaLista {
  /** Vazio = a unidade do estoque (base). */
  embalagemId: string;
  base: boolean;
  sigla: string;
  /** Nome que o usuario deu a embalagem ("TUBO 6 METROS"); vazio na base. */
  descricao: string;
  fatorConversao: number;
  casasDecimais: number;
  fracionado: boolean;
  custo: number;
  /** Custo veio do produto x fator (a embalagem nao tem custo proprio). */
  custoCalculado: boolean;
  venda: number;
  vendaCalculada: boolean;
  /** 0 = sem preco a vista (vale o de venda). */
  vista: number;
  vistaCalculada: boolean;
  /** null = sem custo cadastrado. */
  margem: number | null;
  codigoBarras: string;
}

const positivo = (valor: unknown): number => {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const texto = (valor: unknown): string => (typeof valor === 'string' ? valor.trim() : '');

/** Custo, venda e a vista do produto na unidade do estoque (cadastro novo ou antigo). */
export const precosDoProdutoDaLista = (produto: ProdutoDaListaDeEstoque): { custo: number; venda: number; vista: number; margem: number | null } => {
  const custo = positivo(produto.precoCusto ?? produto.precos?.custo);
  const venda = positivo(produto.precoVenda ?? produto.precos?.venda);
  const vista = positivo(produto.precoAVista ?? produto.precos?.aVista);
  return { custo, venda, vista, margem: margemSobreCusto(venda, custo) };
};

/** A unidade do estoque como linha da tabela de precos. */
export const unidadeBaseDaLista = (produto: ProdutoDaListaDeEstoque): UnidadeDeVendaDaLista => {
  const { custo, venda, vista, margem } = precosDoProdutoDaLista(produto);
  return {
    embalagemId: '',
    base: true,
    sigla: texto(produto.unidadeMedidaSigla).toUpperCase() || 'UN',
    descricao: '',
    fatorConversao: 1,
    casasDecimais: Math.max(0, positivo(produto.unidadeMedidaCasasDecimais)),
    fracionado: false,
    custo,
    custoCalculado: false,
    venda,
    vendaCalculada: false,
    vista,
    vistaCalculada: false,
    margem,
    codigoBarras: texto(produto.codigoBarras),
  };
};

/** As embalagens ATIVAS do produto, na ordem do cadastro (inativa nao vende, nao entra). */
export const embalagensDaLista = (produto: ProdutoDaListaDeEstoque): UnidadeDeVendaDaLista[] => {
  const base = precosDoProdutoDaLista(produto);
  return normalizeEmbalagens(produto.embalagens)
    .filter((embalagem) => embalagem.ativo)
    .map((embalagem) => {
      const tabela = tabelaDoProduto(
        { precoVenda: base.venda, precoAVista: base.vista },
        { fatorConversao: embalagem.fatorConversao, precoProprio: embalagem.precoVenda, precoAVistaProprio: embalagem.precoAVista },
      );
      const custo = custoDaEmbalagem(embalagem, base.custo);
      return {
        embalagemId: embalagem.id,
        base: false,
        sigla: embalagem.unidadeMedidaSigla,
        descricao: embalagem.descricao,
        fatorConversao: embalagem.fatorConversao,
        casasDecimais: embalagem.unidadeMedidaCasasDecimais,
        fracionado: embalagem.unidadeMedidaFracionado,
        custo,
        custoCalculado: !(embalagem.precoCusto > 0) && custo > 0,
        venda: tabela.venda,
        vendaCalculada: !(embalagem.precoVenda > 0) && tabela.venda > 0,
        vista: tabela.vista,
        vistaCalculada: !(embalagem.precoAVista > 0) && tabela.vista > 0,
        margem: margemSobreCusto(tabela.venda, custo),
        codigoBarras: embalagem.codigoBarras,
      };
    });
};

/** Unidade do estoque primeiro, depois as embalagens: as linhas da "Tabela de precos". */
export const unidadesDeVendaDaLista = (produto: ProdutoDaListaDeEstoque): UnidadeDeVendaDaLista[] => (
  [unidadeBaseDaLista(produto), ...embalagensDaLista(produto)]
);

export const temEmbalagemAtiva = (produto: ProdutoDaListaDeEstoque): boolean => (
  normalizeEmbalagens(produto.embalagens).some((embalagem) => embalagem.ativo)
);

/**
 * Quanto o saldo (na unidade do estoque) da' nesta embalagem. Embalagem
 * inteira (tubo, saco) conta so' as completas: 313 m em tubo de 6 m = 52
 * tubos, nao 52,17. Embalagem fracionada mostra com as casas dela.
 */
export const saldoNaEmbalagem = (quantidadeBase: unknown, unidade: Pick<UnidadeDeVendaDaLista, 'fatorConversao' | 'casasDecimais' | 'fracionado'>): number => {
  const saldo = Number(quantidadeBase);
  const fator = unidade.fatorConversao;
  if (!Number.isFinite(saldo) || !(fator > 0)) return 0;
  // Folga minima para 0,3 / 0,1 nao virar 2,9999999.
  const bruto = Math.round((saldo / fator) * 1e6) / 1e6;
  if (!unidade.fracionado) return Math.trunc(bruto);
  const potencia = 10 ** Math.min(6, Math.max(0, unidade.casasDecimais));
  return Math.round(bruto * potencia) / potencia;
};

/** Selo da linha do produto: "1 embalagem: TB", "3 embalagens: RL, CX, G". */
export const resumoDasEmbalagens = (embalagens: ReadonlyArray<Pick<UnidadeDeVendaDaLista, 'sigla'>>, maximoDeSiglas = 4): string => {
  if (embalagens.length === 0) return '';
  const siglas = [...new Set(embalagens.map((e) => e.sigla))];
  const visiveis = siglas.slice(0, maximoDeSiglas).join(', ');
  const resto = siglas.length > maximoDeSiglas ? ` +${siglas.length - maximoDeSiglas}` : '';
  return `${embalagens.length} ${embalagens.length === 1 ? 'embalagem' : 'embalagens'}: ${visiveis}${resto}`;
};

/** "1 TB = 6 MT" (fator sem zeros sobrando, com virgula). */
export const equivalenciaDaEmbalagem = (unidade: Pick<UnidadeDeVendaDaLista, 'sigla' | 'fatorConversao'>, siglaDaBase: string): string => (
  `1 ${unidade.sigla} = ${unidade.fatorConversao.toLocaleString('pt-BR', { maximumFractionDigits: 6 })} ${siglaDaBase || 'UN'}`
);
