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

/**
 * DESCONTO POR ITEM APARECE NA TELA DE VENDA?
 *
 * Decisao de produto (2026-08-31). Nem toda loja quer o operador negociando
 * item a item: em muita delas o desconto e' um so, no fim da venda, e o campo
 * por item e' porta aberta pra erro -- desconto lancado no produto errado, ou
 * dado duas vezes (no item e no total) sem ninguem perceber.
 *
 * Desligado, o campo some da linha de lancamento. O desconto GERAL da venda
 * continua igual: e' ele que a maioria usa, e e ele que o limite de
 * Configuracoes sempre olhou.
 *
 * Nao mexe em venda ja gravada: item que tem desconto continua com ele, e o
 * total do pedido antigo nao muda. A opcao decide o que a tela OFERECE daqui
 * pra frente, nao reescreve historico.
 */
export const DEFAULT_PERMITIR_DESCONTO_POR_ITEM = true;

/** So `false` explicito esconde. Empresa que nunca abriu a configuracao nao
 *  tem o campo gravado, e sumir com um campo que ela ja usa seria pior. */
export const parsePermitirDescontoPorItem = (raw: unknown): boolean => raw !== false;

/**
 * QUAL TIPO DE DESCONTO APARECE PRIMEIRO NA TELA.
 *
 * Decisao de produto (2026-09-01). O seletor de desconto (R$ / %) sempre
 * abria em R$, fixo no codigo. Mas isso e habito de loja, nao regra: ha quem
 * negocie sempre "10% pra voce" e ha quem negocie "tiro 5 reais". Quem
 * trabalha em percentual trocava o seletor em TODA venda -- um clique a toa
 * que se repete o dia inteiro.
 *
 * Vale pros dois campos, o do item e o da venda inteira: quem pensa em
 * percentual pensa em percentual nos dois.
 *
 * NAO muda desconto ja lancado nem o que ja foi gravado -- decide so' como o
 * campo VAZIO abre. Trocar o tipo na hora continua sendo um clique.
 */
export const DEFAULT_TIPO_DESCONTO_PADRAO: DescontoTipo = 'valor';

export const parseTipoDescontoPadrao = (raw: unknown): DescontoTipo => (
  raw === 'percentual' ? 'percentual' : DEFAULT_TIPO_DESCONTO_PADRAO
);

/** Estado inicial (e o de "limpar") do campo de desconto. Uma funcao so pras
 *  quatro telas nao repetirem `{ tipo, valor: '' }` cada uma do seu jeito. */
export const descontoInicial = (tipoPadrao: DescontoTipo) => ({ tipo: tipoPadrao, valor: '' });

/**
 * DESCONTO PADRAO DO CLIENTE (2026-09-21).
 *
 * Pedido do dono: "na tela do cliente tem desconto padrao. Esse cliente 10%
 * no cadastro dele, entao a prioridade e dele."
 *
 * A HIERARQUIA, com a decisao do dono de 21/09:
 *
 *   1. CLIENTE  -- o percentual do cadastro. Vem preenchido na venda e passa
 *                  DIRETO, sem avisar nem pedir senha: o dono ja autorizou
 *                  aquilo quando cadastrou. Pedir confirmacao em toda venda
 *                  seria atrapalhar o vendedor por uma decisao ja tomada.
 *   2. PRODUTO  -- `descontoMaximoPercentual` continua sendo TETO do item, e
 *                  o desconto do cliente NAO passa por cima dele: quem
 *                  confere o item e' excedeLimiteItem, que nem enxerga o
 *                  cliente. Atencao ao que 0 significa neste campo: hoje 0 e'
 *                  "campo em branco / sem teto proprio" (resolveLimiteItem
 *                  devolve null), NAO "produto que nao aceita desconto" --
 *                  esse segundo caso nao existe no sistema.
 *   3. SISTEMA  -- o limite da tela (Configuracoes). Vale para o que passar
 *                  do percentual do cliente, com o modo de sempre
 *                  (avisar/bloquear/senha).
 *
 * NAO existe nivel de VENDEDOR: o dono decidiu nao criar agora (21/09). A
 * hierarquia de 3 niveis com vendedor no meio e' a da COMISSAO
 * (resolveComissaoPercentual), nao a do desconto.
 *
 * ATENCAO, registrado de proposito: tudo isto e' conferido NA TELA. O
 * servidor nao valida desconto. Se algum dia esse limite precisar ser
 * inviolavel (regra "nada se altera pelo DevTools"), a checagem tem de subir
 * pro servidor -- e' mudanca maior, decisao a parte.
 */

/** Percentual do cadastro do cliente, ou 0 quando nao tem. Sempre entre 0 e 100. */
export const descontoPadraoDoCliente = (cliente: { descontoPadraoPercentual?: unknown } | null | undefined): number => {
  const valor = toFiniteNumber(cliente?.descontoPadraoPercentual);
  if (!Number.isFinite(valor) || valor <= 0) return 0;
  return Math.min(100, valor);
};

/** Le o campo digitado no cadastro. Em branco vira 0 (== sem desconto). */
export const parseDescontoPadraoCliente = (valor: string): number => {
  const limpo = String(valor ?? '').trim().replace(',', '.');
  if (!limpo) return 0;
  const numero = Number(limpo);
  if (!Number.isFinite(numero) || numero <= 0) return 0;
  return Math.min(100, numero);
};

/** Erro em portugues do campo, ou null. */
export const erroDoDescontoPadraoCliente = (valor: string): string | null => {
  const limpo = String(valor ?? '').trim().replace(',', '.');
  if (!limpo) return null;
  const numero = Number(limpo);
  if (!Number.isFinite(numero)) return 'Informe o desconto padrão em porcentagem (ex.: 10).';
  if (numero < 0) return 'O desconto padrão não pode ser negativo.';
  if (numero > 100) return 'O desconto padrão não pode passar de 100%.';
  return null;
};

export interface ChecagemDescontoComCliente extends ChecagemLimiteTotalResult {
  /** Percentual que o cadastro do cliente ja autoriza. */
  percentualDoCliente: number;
  /** Dentro do que o cliente ja tem direito: passa sem avisar nem pedir senha. */
  dentroDoDescontoDoCliente: boolean;
}

/**
 * Confere o desconto TOTAL considerando o desconto do cliente.
 *
 * Ate o percentual do cliente, `excedeu` e' sempre false -- e' o que faz o
 * desconto dele passar direto. Acima disso, vale a regra da tela de sempre.
 *
 * Uma tolerancia de 1 centavo (a mesma de checarLimiteTotal) evita que
 * arredondamento de centavo dispare pedido de senha numa venda que esta
 * exatamente no limite.
 */
export const checarLimiteComCliente = (
  limite: LimiteDescontoConfig | null | undefined,
  baseCents: number,
  descontoCents: number,
  percentualDoCliente: number,
): ChecagemDescontoComCliente => {
  const base = checarLimiteTotal(limite, baseCents, descontoCents);
  const percentualCliente = Math.max(0, Math.min(100, Number(percentualDoCliente) || 0));

  if (percentualCliente <= 0 || baseCents <= 0) {
    return { ...base, percentualDoCliente: percentualCliente, dentroDoDescontoDoCliente: false };
  }

  const tetoDoClienteCents = Math.round(baseCents * (percentualCliente / 100));
  const dentro = descontoCents <= tetoDoClienteCents + 1;

  return {
    percentualAplicado: base.percentualAplicado,
    excedeu: dentro ? false : base.excedeu,
    percentualDoCliente: percentualCliente,
    dentroDoDescontoDoCliente: dentro,
  };
};

/** Desconto em centavos que o cliente ja tem direito sobre uma base. */
export const descontoDoClienteEmCents = (baseCents: number, percentualDoCliente: number): number => {
  const percentual = Math.max(0, Math.min(100, Number(percentualDoCliente) || 0));
  if (percentual <= 0 || baseCents <= 0) return 0;
  return Math.round(baseCents * (percentual / 100));
};
