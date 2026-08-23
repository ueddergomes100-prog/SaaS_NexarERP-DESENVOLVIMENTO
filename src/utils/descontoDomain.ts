// Funcoes puras de Desconto Maximo (OS, Pedido de Venda, Orcamento, PDV).
// Sem Firestore -- leitura/escrita fica nas telas que consomem isto.
//
// Dois niveis de checagem, deliberadamente distintos:
// 1) NIVEL PRODUTO (resolveLimiteItem): o campo descontoMaximoPercentual do
//    cadastro do produto -- existe desde sempre, nunca foi lido em lugar
//    nenhum ate esta feature. Quando presente, e' o piso que a loja definiu
//    produto a produto e SEMPRE bloqueia, nao segue o modo configurado --
//    e' a regra "mais importante" pedida pelo usuario.
// 2) NIVEL SISTEMA (checarLimiteTotal): o desconto TOTAL da venda/OS/
//    orcamento contra o limite configurado em Configuracoes pra aquela
//    tela, reagindo conforme o modo escolhido (bloquear/avisar/senha).
//
// Limite ausente/zero em qualquer nivel = sem checagem nenhuma -- preserva
// o comportamento de hoje (nenhum limite existe) em todo tenant que nao
// configurar nada.

export type DescontoTipo = 'valor' | 'percentual';

export type ModoLimiteDesconto = 'bloquear' | 'avisar' | 'senha';

export const DEFAULT_MODO_LIMITE_DESCONTO: ModoLimiteDesconto = 'avisar';

export interface LimiteDescontoConfig {
  tipo: DescontoTipo;
  /** Valor do limite: percentual (0-100) ou reais, conforme `tipo`. */
  valor: number;
}

export interface DescontoAplicado {
  tipo: DescontoTipo;
  /** O que foi digitado pelo operador -- percentual ou reais, conforme tipo. */
  valorInformado: number;
  valorAplicadoCentavos: number;
  excedeuLimite: boolean;
  aprovacao?: {
    modo: 'senha';
    aprovadoPorId: string;
    aprovadoPorNome: string;
    aprovadoEm: string;
  };
}

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Converte o valor informado (percentual ou reais) em centavos de desconto,
 * contra uma base em centavos (subtotal/total antes do desconto). Mesma
 * logica que ja existia isolada em PDV/DiscountModal.tsx, generalizada pra
 * ser reusada em todas as telas.
 */
export const calcularDescontoCents = (
  tipo: DescontoTipo,
  valorInformado: unknown,
  baseCents: number,
): number => {
  const valor = toFiniteNumber(valorInformado);
  if (valor <= 0 || baseCents <= 0) return 0;

  const bruto = tipo === 'percentual'
    ? Math.round(baseCents * (valor / 100))
    : Math.round(valor * 100);

  return Math.min(Math.max(0, bruto), baseCents);
};

/** So o que a regra de nivel 1 precisa enxergar do produto. */
export interface ProdutoComLimiteDesconto {
  descontoMaximoPercentual?: number | null;
}

/** Limite do PRODUTO em percentual, ou null se o produto nao define um.
 * Sempre percentual -- e' assim que o campo sempre existiu no cadastro. */
export const resolveLimiteItem = (produto: ProdutoComLimiteDesconto | null | undefined): number | null => {
  const limite = toFiniteNumber(produto?.descontoMaximoPercentual);
  return limite > 0 ? limite : null;
};

/** Confere um desconto de ITEM contra o limite do proprio produto (nivel 1).
 * `precoCheioCents` e' o preco do item ANTES do desconto (preco x quantidade). */
export const excedeLimiteItem = (
  produto: ProdutoComLimiteDesconto | null | undefined,
  descontoCents: number,
  precoCheioCents: number,
): boolean => {
  const limite = resolveLimiteItem(produto);
  if (limite === null || precoCheioCents <= 0) return false;
  const percentualAplicado = (descontoCents / precoCheioCents) * 100;
  return percentualAplicado > limite + 1e-6;
};

export interface ChecagemLimiteTotalResult {
  percentualAplicado: number;
  excedeu: boolean;
}

/** Confere o desconto TOTAL contra o limite da TELA, configurado em
 * Configuracoes (nivel 2). `limite` null/undefined/valor<=0 = sem limite
 * configurado, nunca excede -- e' o estado de todo tenant que nao mexeu
 * nesta configuracao. */
export const checarLimiteTotal = (
  limite: LimiteDescontoConfig | null | undefined,
  baseCents: number,
  descontoCents: number,
): ChecagemLimiteTotalResult => {
  const percentualAplicado = baseCents > 0 ? (descontoCents / baseCents) * 100 : 0;

  if (!limite || limite.valor <= 0 || baseCents <= 0) {
    return { percentualAplicado, excedeu: false };
  }

  const limiteCents = limite.tipo === 'percentual'
    ? Math.round(baseCents * (limite.valor / 100))
    : Math.round(limite.valor * 100);

  return { percentualAplicado, excedeu: descontoCents > limiteCents + 1 };
};

/** Le um bloco de configuracao de limite salvo em `configuracoes/{tenantId}`.
 * Formato defensivo (Firestore): tipo invalido cai em 'percentual', valor
 * ausente/negativo vira 0 (== sem limite, via checarLimiteTotal). */
export const parseLimiteDescontoConfig = (raw: unknown): LimiteDescontoConfig => {
  const data = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const tipo: DescontoTipo = data.tipo === 'valor' ? 'valor' : 'percentual';
  return { tipo, valor: Math.max(0, toFiniteNumber(data.valor)) };
};

export const parseModoLimiteDesconto = (raw: unknown): ModoLimiteDesconto => (
  raw === 'bloquear' || raw === 'senha' ? raw : DEFAULT_MODO_LIMITE_DESCONTO
);
