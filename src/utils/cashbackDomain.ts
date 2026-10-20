/*
 * CASHBACK (pedido do dono, 20/10/2026).
 *
 * A empresa escolhe o modelo nas Configuracoes da filial:
 *  - 'reais':  a venda PAGA gera saldo em R$ para o cliente, que entra como
 *              forma de pagamento na proxima venda (mesmo caminho do credito
 *              do cliente);
 *  - 'pontos': a venda PAGA gera pontos; nas proximas vendas o cliente troca
 *              os pontos por desconto, pelas faixas (X pontos = Y% de desconto).
 *
 * "Paga" e' a regra: a vista gera ao faturar; a prazo gera na baixa da ULTIMA
 * parcela (venda toda quitada). Cancelamento ou devolucao estorna o que a
 * venda gerou -- se o cliente ja' gastou, o saldo fica negativo e e' abatido
 * do proximo cashback.
 *
 * Quanto cada item gera: o produto precisa ter "Permitir cashback" marcado;
 * no modelo em R$ o produto pode ter percentual ou valor proprio, senao vale
 * o padrao da empresa; no modelo em pontos vale "pontos por real" da empresa.
 *
 * Este arquivo e' puro (sem Firestore): a tela calcula o que a venda vai
 * gerar para mostrar; o servidor calcula de novo na hora de gerar.
 */

export type ModeloCashback = 'reais' | 'pontos';
export type TipoCashback = 'percentual' | 'valor';

export interface FaixaDePontos {
  /** Pontos que a faixa consome. */
  pontos: number;
  /** Desconto (%) sobre a venda ao usar a faixa. */
  descontoPercentual: number;
}

export interface ConfigCashback {
  ativo: boolean;
  modelo: ModeloCashback;
  /** Padrao do modelo em R$: percentual do item ou valor por unidade. */
  tipoPadrao: TipoCashback;
  valorPadrao: number;
  /** Dias de validade do que foi gerado; null = nao vence. */
  validadeDias: number | null;
  /** Modelo em pontos: pontos por R$ 1,00 do item. */
  pontosPorReal: number;
  faixas: FaixaDePontos[];
}

export const DEFAULT_CONFIG_CASHBACK: ConfigCashback = {
  ativo: false,
  modelo: 'reais',
  tipoPadrao: 'percentual',
  valorPadrao: 0,
  validadeDias: null,
  pontosPorReal: 1,
  faixas: [],
};

export const LIMITE_DE_FAIXAS = 10;
export const ROTULO_MODELO_CASHBACK: Record<ModeloCashback, string> = {
  reais: 'Cashback em R$ (vira saldo para a próxima compra)',
  pontos: 'Pontos (troca por desconto pelas faixas)',
};

const numero = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const inteiroPositivo = (v: unknown): number => Math.max(0, Math.round(numero(v)));
const r2 = (v: number): number => Math.round(v * 100) / 100;

/** Le a configuracao gravada em configuracoes/{filial}.cashback (ausente = desligado). */
export const parseConfigCashback = (valor: unknown): ConfigCashback => {
  if (!valor || typeof valor !== 'object') return DEFAULT_CONFIG_CASHBACK;
  const c = valor as Record<string, unknown>;
  const validade = c.validadeDias === null || c.validadeDias === undefined || c.validadeDias === '' ? null : inteiroPositivo(c.validadeDias);
  return {
    ativo: c.ativo === true,
    modelo: c.modelo === 'pontos' ? 'pontos' : 'reais',
    tipoPadrao: c.tipoPadrao === 'valor' ? 'valor' : 'percentual',
    valorPadrao: Math.max(0, numero(c.valorPadrao)),
    validadeDias: validade && validade > 0 ? validade : null,
    pontosPorReal: Math.max(0, numero(c.pontosPorReal)) || DEFAULT_CONFIG_CASHBACK.pontosPorReal,
    faixas: lerFaixas(c.faixas).faixas,
  };
};

/** Faixas limpas e em ordem crescente de pontos; erro em portugues quando algo nao serve. */
export const lerFaixas = (valor: unknown): { faixas: FaixaDePontos[]; erro: string | null } => {
  const lista = Array.isArray(valor) ? valor : [];
  const faixas: FaixaDePontos[] = [];
  for (const item of lista) {
    const f = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const pontos = inteiroPositivo(f.pontos);
    const desconto = r2(numero(f.descontoPercentual));
    if (pontos <= 0 && desconto <= 0) continue;
    if (pontos <= 0) return { faixas: [], erro: 'Cada faixa precisa de uma quantidade de pontos maior que zero.' };
    if (desconto <= 0 || desconto > 100) return { faixas: [], erro: `A faixa de ${pontos} pontos precisa de um desconto entre 0,01% e 100%.` };
    faixas.push({ pontos, descontoPercentual: desconto });
  }
  faixas.sort((a, b) => a.pontos - b.pontos);
  for (let i = 1; i < faixas.length; i += 1) {
    if (faixas[i].pontos === faixas[i - 1].pontos) return { faixas: [], erro: `Há duas faixas com ${faixas[i].pontos} pontos. Cada faixa precisa de uma quantidade diferente.` };
    if (faixas[i].descontoPercentual <= faixas[i - 1].descontoPercentual) {
      return { faixas: [], erro: `A faixa de ${faixas[i].pontos} pontos dá ${faixas[i].descontoPercentual}% — menos que a de ${faixas[i - 1].pontos} pontos. Mais pontos, mais desconto.` };
    }
  }
  if (faixas.length > LIMITE_DE_FAIXAS) return { faixas: [], erro: `O programa aceita até ${LIMITE_DE_FAIXAS} faixas.` };
  return { faixas, erro: null };
};

/** Confere o que a tela de Configuracoes mandou salvar. */
export const lerConfigCashback = (corpo: unknown): { ok: true; config: ConfigCashback } | { ok: false; erro: string } => {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  const config = parseConfigCashback(c);
  if (!config.ativo) return { ok: true, config: { ...config, ativo: false } };
  if (config.modelo === 'reais') {
    if (config.valorPadrao <= 0) return { ok: false, erro: 'Informe o cashback padrão (percentual ou valor por unidade) maior que zero.' };
    if (config.tipoPadrao === 'percentual' && config.valorPadrao > 100) return { ok: false, erro: 'O cashback padrão em percentual não pode passar de 100%.' };
  } else {
    if (config.pontosPorReal <= 0) return { ok: false, erro: 'Informe quantos pontos o cliente ganha por R$ 1,00.' };
    const faixas = lerFaixas(c.faixas);
    if (faixas.erro) return { ok: false, erro: faixas.erro };
    if (faixas.faixas.length === 0) return { ok: false, erro: 'Cadastre pelo menos uma faixa (por exemplo, 100 pontos = 5% de desconto).' };
    config.faixas = faixas.faixas;
  }
  return { ok: true, config };
};

// ---------------------------------------------------------------------------
// O que cada produto gera
// ---------------------------------------------------------------------------

/** Campos do cadastro do produto (aba Avancado). */
export interface CashbackDoProduto {
  permitirCashback?: unknown;
  /** Modelo em R$: percentual ou valor proprio; ausente = padrao da empresa. */
  cashbackTipo?: unknown;
  cashbackValor?: unknown;
}

export interface ItemParaCashback {
  produtoId: string;
  nome: string;
  quantidade: number;
  /** Total do item ja' com o desconto do item, em centavos. */
  totalCentavos: number;
  produto: CashbackDoProduto | null | undefined;
}

export interface CashbackGerado {
  modelo: ModeloCashback;
  /** Modelo em R$. */
  centavos: number;
  /** Modelo em pontos. */
  pontos: number;
  porItem: Array<{ produtoId: string; nome: string; centavos: number; pontos: number }>;
}

const regraDoProduto = (config: ConfigCashback, produto: CashbackDoProduto | null | undefined): { tipo: TipoCashback; valor: number } | null => {
  if (!produto || produto.permitirCashback !== true) return null;
  const tipo = produto.cashbackTipo === 'percentual' || produto.cashbackTipo === 'valor' ? produto.cashbackTipo : null;
  const valor = Math.max(0, numero(produto.cashbackValor));
  if (tipo && valor > 0) return { tipo, valor };
  return { tipo: config.tipoPadrao, valor: config.valorPadrao };
};

/**
 * Quanto a venda gera, item a item. Desconto geral da venda (fora dos itens)
 * reduz proporcionalmente -- `fatorDoDescontoGeral` = total pago / soma dos itens.
 */
export const cashbackDaVenda = (config: ConfigCashback, itens: ReadonlyArray<ItemParaCashback>, fatorDoDescontoGeral = 1): CashbackGerado => {
  const vazio: CashbackGerado = { modelo: config.modelo, centavos: 0, pontos: 0, porItem: [] };
  if (!config.ativo) return vazio;
  const fator = Number.isFinite(fatorDoDescontoGeral) && fatorDoDescontoGeral > 0 ? Math.min(1, fatorDoDescontoGeral) : 1;
  const porItem: CashbackGerado['porItem'] = [];
  for (const item of itens) {
    const regra = regraDoProduto(config, item.produto);
    if (!regra) continue;
    const total = Math.max(0, Math.round(item.totalCentavos * fator));
    if (config.modelo === 'pontos') {
      const pontos = Math.floor((total / 100) * config.pontosPorReal);
      if (pontos > 0) porItem.push({ produtoId: item.produtoId, nome: item.nome, centavos: 0, pontos });
      continue;
    }
    const centavos = regra.tipo === 'percentual'
      ? Math.round(total * (regra.valor / 100))
      : Math.round(regra.valor * 100 * Math.max(0, item.quantidade) * fator);
    if (centavos > 0) porItem.push({ produtoId: item.produtoId, nome: item.nome, centavos, pontos: 0 });
  }
  return {
    modelo: config.modelo,
    centavos: porItem.reduce((s, i) => s + i.centavos, 0),
    pontos: porItem.reduce((s, i) => s + i.pontos, 0),
    porItem,
  };
};

/** Data de validade (AAAA-MM-DD) do que foi gerado em `dataPagamento`; null = nao vence. */
export const validadeDoCashback = (config: ConfigCashback, dataPagamento: string): string | null => {
  if (!config.validadeDias) return null;
  const [a, m, d] = dataPagamento.split('-').map(Number);
  if (!a || !m || !d) return null;
  const data = new Date(Date.UTC(a, m - 1, d + config.validadeDias));
  return data.toISOString().slice(0, 10);
};

// ---------------------------------------------------------------------------
// Pontos: a faixa que o cliente alcanca
// ---------------------------------------------------------------------------

/** A melhor faixa que cabe no saldo (mais pontos = mais desconto), ou null. */
export const faixaAlcancada = (faixas: readonly FaixaDePontos[], saldoPontos: number): FaixaDePontos | null => (
  [...faixas].filter((f) => f.pontos <= saldoPontos).sort((a, b) => b.pontos - a.pontos)[0] ?? null
);

/** Quantos pontos faltam para a proxima faixa (null = ja' esta na maior). */
export const pontosParaProximaFaixa = (faixas: readonly FaixaDePontos[], saldoPontos: number): { faixa: FaixaDePontos; faltam: number } | null => {
  const proxima = [...faixas].filter((f) => f.pontos > saldoPontos).sort((a, b) => a.pontos - b.pontos)[0];
  return proxima ? { faixa: proxima, faltam: proxima.pontos - saldoPontos } : null;
};

// ---------------------------------------------------------------------------
// Saldo e movimentos
// ---------------------------------------------------------------------------

export type TipoMovimentoCashback = 'gerado' | 'usado' | 'estornado' | 'expirado' | 'ajuste';

export interface MovimentoCashback {
  tipo: TipoMovimentoCashback;
  centavos: number;
  pontos: number;
  /** AAAA-MM-DD do que foi gerado; null = nao vence. */
  validade?: string | null;
}

/**
 * Saldo a partir dos movimentos: gerado soma, usado/estornado/expirado
 * subtraem. Pode ficar negativo (venda cancelada depois de o cliente usar):
 * o proximo gerado abate.
 */
export const saldoDosMovimentos = (movimentos: ReadonlyArray<MovimentoCashback>): { centavos: number; pontos: number } => (
  movimentos.reduce((s, m) => {
    const sinal = m.tipo === 'gerado' || m.tipo === 'ajuste' ? 1 : -1;
    return { centavos: s.centavos + sinal * Math.round(m.centavos || 0), pontos: s.pontos + sinal * Math.round(m.pontos || 0) };
  }, { centavos: 0, pontos: 0 })
);

// ---------------------------------------------------------------------------
// Lotes (cada venda paga gera um lote com validade) e o resumo do cliente
// ---------------------------------------------------------------------------

export interface LoteCashback {
  centavos: number;
  pontos: number;
  restanteCentavos: number;
  restantePontos: number;
  /** AAAA-MM-DD; null = nao vence. */
  validade: string | null;
  estornado?: boolean;
}

export interface DividaCashback {
  centavos: number;
  pontos: number;
}

export interface ResumoCashback {
  saldoCentavos: number;
  saldoPontos: number;
  dividaCentavos: number;
  dividaPontos: number;
  /** Menor validade entre os lotes com saldo (AAAA-MM-DD) ou null. */
  proximoVencimento: string | null;
}

const naoNegativo = (v: number): number => Math.max(0, Math.round(v));

/** Lote que ainda vale: nao estornado, nao vencido e com algo sobrando. */
export const loteVigente = (lote: LoteCashback, hoje: string): boolean => (
  lote.estornado !== true
  && (!lote.validade || lote.validade >= hoje)
  && (lote.restanteCentavos > 0 || lote.restantePontos > 0)
);

/** O que o cliente tem hoje: soma dos lotes vigentes menos a divida (venda cancelada depois de usar). */
export const resumoDosLotes = (lotes: ReadonlyArray<LoteCashback>, hoje: string, divida: DividaCashback): ResumoCashback => {
  const vigentes = lotes.filter((l) => loteVigente(l, hoje));
  const vencimentos = vigentes.map((l) => l.validade).filter((v): v is string => Boolean(v)).sort();
  return {
    saldoCentavos: vigentes.reduce((s, l) => s + l.restanteCentavos, 0) - naoNegativo(divida.centavos),
    saldoPontos: vigentes.reduce((s, l) => s + l.restantePontos, 0) - naoNegativo(divida.pontos),
    dividaCentavos: naoNegativo(divida.centavos),
    dividaPontos: naoNegativo(divida.pontos),
    proximoVencimento: vencimentos[0] ?? null,
  };
};

/** Lote novo abate a divida primeiro: o cliente so' volta a ter saldo depois de "pagar" o que ficou negativo. */
export const novoLoteComDivida = (gerado: { centavos: number; pontos: number }, divida: DividaCashback): { restanteCentavos: number; restantePontos: number; divida: DividaCashback } => ({
  restanteCentavos: naoNegativo(gerado.centavos - naoNegativo(divida.centavos)),
  restantePontos: naoNegativo(gerado.pontos - naoNegativo(divida.pontos)),
  divida: {
    centavos: naoNegativo(naoNegativo(divida.centavos) - gerado.centavos),
    pontos: naoNegativo(naoNegativo(divida.pontos) - gerado.pontos),
  },
});

/**
 * Tira do lote `centavos`/`pontos` (estorno total ou parcial, devolucao). O que
 * o cliente ja' tinha gastado deste lote e nao da' mais para tirar vira divida.
 */
export const abaterDoLote = (lote: LoteCashback, centavos: number, pontos: number): { restanteCentavos: number; restantePontos: number; dividaExtra: DividaCashback } => {
  const c = naoNegativo(centavos);
  const p = naoNegativo(pontos);
  return {
    restanteCentavos: naoNegativo(lote.restanteCentavos - c),
    restantePontos: naoNegativo(lote.restantePontos - p),
    dividaExtra: { centavos: naoNegativo(c - lote.restanteCentavos), pontos: naoNegativo(p - lote.restantePontos) },
  };
};

/** Parte de um lote que corresponde ao valor devolvido de uma venda (proporcional ao total da venda). */
export const parteProporcional = (lote: { centavos: number; pontos: number }, valorDevolvidoCentavos: number, valorTotalCentavos: number): { centavos: number; pontos: number } => {
  if (!(valorTotalCentavos > 0) || !(valorDevolvidoCentavos > 0)) return { centavos: 0, pontos: 0 };
  const fator = Math.min(1, valorDevolvidoCentavos / valorTotalCentavos);
  return { centavos: Math.round(lote.centavos * fator), pontos: Math.round(lote.pontos * fator) };
};

export const formatarCashback = (modelo: ModeloCashback, centavos: number, pontos: number): string => (
  modelo === 'pontos'
    ? `${pontos.toLocaleString('pt-BR')} ponto(s)`
    : (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
);

// ---------------------------------------------------------------------------
// Uso como forma de pagamento (fase 2, 20/10/2026)
// ---------------------------------------------------------------------------

/**
 * Forma de pagamento que gasta o saldo. So' a venda PELO SERVIDOR consome os
 * lotes (server/services/vendaFechamento.js): a tela nunca mexe no saldo, por
 * isso a forma so' aparece com a chave "Venda pelo servidor" ligada.
 */
export const FORMA_PAGAMENTO_CASHBACK = 'Cashback';

/** Resumo gravado pelo servidor em clientes/{id}.cashback. */
export interface ResumoCashbackDoCliente extends ResumoCashback {
  modelo: ModeloCashback;
}

export const lerResumoCashback = (valor: unknown): ResumoCashbackDoCliente | null => {
  if (!valor || typeof valor !== 'object') return null;
  const r = valor as Record<string, unknown>;
  return {
    modelo: r.modelo === 'pontos' ? 'pontos' : 'reais',
    saldoCentavos: Math.round(numero(r.saldoCentavos)),
    saldoPontos: Math.round(numero(r.saldoPontos)),
    dividaCentavos: naoNegativo(numero(r.dividaCentavos)),
    dividaPontos: naoNegativo(numero(r.dividaPontos)),
    proximoVencimento: typeof r.proximoVencimento === 'string' && r.proximoVencimento ? r.proximoVencimento : null,
  };
};

interface PagamentoLido {
  formaPagamento?: unknown;
  valorCentavos?: unknown;
  valor?: unknown;
}

const pagamentosLidos = (pagamentos: unknown): PagamentoLido[] => (
  (Array.isArray(pagamentos) ? pagamentos : []).filter((p): p is PagamentoLido => Boolean(p) && typeof p === 'object')
);

/** Quanto da venda foi pago com cashback (centavos), pelos pagamentos gravados ou normalizados. */
export const cashbackUsadoNaVenda = (pagamentos: unknown): number => (
  pagamentosLidos(pagamentos)
    .filter((p) => p.formaPagamento === FORMA_PAGAMENTO_CASHBACK)
    .reduce((soma, p) => soma + naoNegativo(p.valorCentavos !== undefined && p.valorCentavos !== null ? numero(p.valorCentavos) : numero(p.valor) * 100), 0)
);

/** Modelo em pontos: usar a faixa abate Y% do total da venda. */
export const valorDaFaixa = (faixa: FaixaDePontos, totalCentavos: number): number => (
  Math.round(Math.max(0, totalCentavos) * (faixa.descontoPercentual / 100))
);

export interface FaixaDisponivel {
  faixa: FaixaDePontos;
  /** Quanto a faixa abate desta venda. */
  valorCentavos: number;
}

/** Faixas que cabem no saldo do cliente, da menor para a maior, com o valor que cada uma abate. */
export const faixasDisponiveis = (faixas: readonly FaixaDePontos[], saldoPontos: number, totalCentavos: number): FaixaDisponivel[] => (
  [...faixas]
    .filter((f) => f.pontos <= saldoPontos)
    .sort((a, b) => a.pontos - b.pontos)
    .map((faixa) => ({ faixa, valorCentavos: valorDaFaixa(faixa, totalCentavos) }))
    .filter((f) => f.valorCentavos > 0)
);

/** O que a tela oferece na forma "Cashback": saldo em R$ ou as faixas que o cliente alcanca. */
export interface CashbackDisponivel {
  modelo: ModeloCashback;
  saldoCentavos: number;
  saldoPontos: number;
  faixas: FaixaDePontos[];
  proximoVencimento: string | null;
}

/** null = nada a oferecer (cashback desligado, cliente sem saldo, saldo de outro modelo). */
export const cashbackDisponivelParaVenda = (config: ConfigCashback, resumo: ResumoCashbackDoCliente | null): CashbackDisponivel | null => {
  if (!config.ativo || !resumo || resumo.modelo !== config.modelo) return null;
  if (config.modelo === 'reais' ? resumo.saldoCentavos <= 0 : resumo.saldoPontos <= 0) return null;
  return {
    modelo: config.modelo,
    saldoCentavos: Math.max(0, resumo.saldoCentavos),
    saldoPontos: Math.max(0, resumo.saldoPontos),
    faixas: config.faixas,
    proximoVencimento: resumo.proximoVencimento,
  };
};

/** Valor que a linha "Cashback" sugere ao ser escolhida: o saldo (ate' o que falta pagar) ou a maior faixa. */
export const valorSugeridoDoCashback = (disponivel: CashbackDisponivel, totalCentavos: number, faltaPagarCentavos: number): number => {
  if (disponivel.modelo === 'reais') return Math.max(0, Math.min(disponivel.saldoCentavos, faltaPagarCentavos));
  const faixas = faixasDisponiveis(disponivel.faixas, disponivel.saldoPontos, totalCentavos);
  return faixas.length ? faixas[faixas.length - 1].valorCentavos : 0;
};

/**
 * Confere o pagamento "Cashback" contra o saldo: em R$ nao passa do saldo nem
 * do total; em pontos o valor tem de ser exatamente o de uma faixa que o
 * cliente alcanca. Devolve o que consumir (centavos ou pontos) ou o erro.
 */
export const conferirPagamentoComCashback = (
  config: ConfigCashback,
  resumo: ResumoCashbackDoCliente | null,
  totalCentavos: number,
  valorCentavos: number,
): { ok: true; centavos: number; pontos: number } | { ok: false; erro: string } => {
  if (!(valorCentavos > 0)) return { ok: false, erro: 'O valor pago com cashback precisa ser maior que zero.' };
  if (!config.ativo) return { ok: false, erro: 'O cashback está desligado nas Configurações. Troque a forma de pagamento.' };
  if (!resumo || resumo.modelo !== config.modelo) return { ok: false, erro: 'Este cliente não tem saldo de cashback para usar. Troque a forma de pagamento.' };
  if (valorCentavos > totalCentavos) return { ok: false, erro: 'O cashback não pode passar do total da venda. Diminua o valor.' };
  if (config.modelo === 'reais') {
    if (valorCentavos > resumo.saldoCentavos) {
      return { ok: false, erro: `O cliente tem ${formatarCashback('reais', Math.max(0, resumo.saldoCentavos), 0)} de cashback, menos que o informado. Ajuste o valor.` };
    }
    return { ok: true, centavos: valorCentavos, pontos: 0 };
  }
  const faixa = faixasDisponiveis(config.faixas, resumo.saldoPontos, totalCentavos).find((f) => f.valorCentavos === valorCentavos);
  if (!faixa) return { ok: false, erro: 'O valor do cashback não corresponde a nenhuma faixa de pontos que o cliente alcança. Escolha a faixa de novo.' };
  return { ok: true, centavos: 0, pontos: faixa.faixa.pontos };
};

/** Lote gravado, com a ordem de criacao para o desempate. */
export interface LoteParaUso extends LoteCashback {
  id: string;
  ordem: number;
}

/** Vence antes, sai antes; sem validade sai por ultimo; empate pela ordem de criacao. */
export const ordenarLotesParaUso = (lotes: readonly LoteParaUso[], hoje: string): LoteParaUso[] => (
  lotes.filter((l) => loteVigente(l, hoje)).sort((a, b) => {
    if (a.validade && b.validade && a.validade !== b.validade) return a.validade < b.validade ? -1 : 1;
    if (Boolean(a.validade) !== Boolean(b.validade)) return a.validade ? -1 : 1;
    return a.ordem - b.ordem;
  })
);

export interface ConsumoDeLote {
  id: string;
  centavos: number;
  pontos: number;
}

const MENSAGEM_SALDO_MUDOU = 'O saldo de cashback deste cliente mudou desde que a venda foi montada. Refaça o pagamento com cashback.';

/**
 * Distribui o uso pelos lotes vigentes (vence antes, sai antes). A divida do
 * cliente ja' esta' descontada do saldo: nao se gasta o que ela cobre.
 */
export const planoDeUso = (
  lotes: readonly LoteParaUso[],
  divida: DividaCashback,
  uso: { centavos: number; pontos: number },
  hoje: string,
): { ok: true; consumos: ConsumoDeLote[] } | { ok: false; erro: string } => {
  const ordenados = ordenarLotesParaUso(lotes, hoje);
  const saldo = resumoDosLotes(ordenados, hoje, divida);
  let faltaCentavos = naoNegativo(uso.centavos);
  let faltaPontos = naoNegativo(uso.pontos);
  if (faltaCentavos > saldo.saldoCentavos || faltaPontos > saldo.saldoPontos) return { ok: false, erro: MENSAGEM_SALDO_MUDOU };
  const consumos: ConsumoDeLote[] = [];
  for (const lote of ordenados) {
    if (faltaCentavos <= 0 && faltaPontos <= 0) break;
    const centavos = Math.min(faltaCentavos, lote.restanteCentavos);
    const pontos = Math.min(faltaPontos, lote.restantePontos);
    if (centavos <= 0 && pontos <= 0) continue;
    consumos.push({ id: lote.id, centavos, pontos });
    faltaCentavos -= centavos;
    faltaPontos -= pontos;
  }
  if (faltaCentavos > 0 || faltaPontos > 0) return { ok: false, erro: MENSAGEM_SALDO_MUDOU };
  return { ok: true, consumos };
};

/**
 * A venda que usou cashback foi cancelada: o que saiu de cada lote volta.
 * Lote ja' estornado (a venda que o gerou foi cancelada antes) nao recebe de
 * volta -- o uso dele tinha virado divida, e e' a divida que diminui. Lote
 * vencido recebe de volta, mas nao conta mais no saldo.
 */
export const devolucaoDoUso = (
  lote: { restanteCentavos: number; restantePontos: number; usadoCentavos: number; usadoPontos: number; estornado?: boolean },
  consumo: ConsumoDeLote,
  divida: DividaCashback,
): { lote: { restanteCentavos: number; restantePontos: number; usadoCentavos: number; usadoPontos: number }; divida: DividaCashback } => {
  const centavos = naoNegativo(consumo.centavos);
  const pontos = naoNegativo(consumo.pontos);
  const usado = { usadoCentavos: naoNegativo(lote.usadoCentavos - centavos), usadoPontos: naoNegativo(lote.usadoPontos - pontos) };
  if (lote.estornado === true) {
    return {
      lote: { restanteCentavos: naoNegativo(lote.restanteCentavos), restantePontos: naoNegativo(lote.restantePontos), ...usado },
      divida: { centavos: naoNegativo(naoNegativo(divida.centavos) - centavos), pontos: naoNegativo(naoNegativo(divida.pontos) - pontos) },
    };
  }
  return {
    lote: { restanteCentavos: naoNegativo(lote.restanteCentavos) + centavos, restantePontos: naoNegativo(lote.restantePontos) + pontos, ...usado },
    divida: { centavos: naoNegativo(divida.centavos), pontos: naoNegativo(divida.pontos) },
  };
};
