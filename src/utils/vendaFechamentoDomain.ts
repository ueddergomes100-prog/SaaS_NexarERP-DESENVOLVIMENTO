/*
 * FECHAMENTO DA VENDA NO SERVIDOR (item 8 da auditoria, fatia 3 -- 13/10/2026).
 *
 * Regras puras do "Finalizar" do Pedido de Venda que precisam dar o MESMO
 * resultado na tela e no servidor (server/services/vendaFechamento.js usa a
 * versao compilada em server/domain/). Com a chave "Venda pelo servidor"
 * ligada para a empresa, a tela manda o que a pessoa escolheu (itens,
 * desconto geral, frete, encargos, pagamentos) e o servidor refaz as contas
 * daqui -- nao confia em total, saldo de banco nem status de pagamento vindos
 * do navegador.
 */
import { fromCents, normalizeCreditCardFeeSchedule, parseCreditTerms, parseMaxParcelasCartao, toCents, type CreditCardFeeSchedule } from './financeDomain';
import { calcularDescontoCents } from './descontoDomain';
import { lerTransporte, transporteParaGravar } from './transporteNotaDomain';
import { addDaysToDateInput } from './dateTime';
import { erroDasFormasSemCadastro, lerClienteSemCadastro, type ClienteSemCadastro } from './clienteSemCadastroDomain';

// ---------------------------------------------------------------------------
// Configuracao financeira da empresa (prazos e taxas do cartao)
// ---------------------------------------------------------------------------

export interface ConfigFinanceiraDaVenda {
  defaultTermDays: number;
  maxCreditInstallments: number;
  creditFeePercentByInstallment: CreditCardFeeSchedule;
  debitFeePercent: number;
  creditSettlementDays: number;
  debitSettlementDays: number;
}

/** Mesma leitura que o Pedido de Venda faz de `configuracoes/{empresa}`. */
export const configFinanceiraDaEmpresa = (config: Record<string, unknown> | null | undefined): ConfigFinanceiraDaVenda => {
  const c = config || {};
  const prazos = parseCreditTerms(c.diasCrediario);
  const credito = c.prazoRecebimentoCartaoCreditoDias ?? 30;
  const debito = c.prazoRecebimentoCartaoDebitoDias ?? 1;
  return {
    defaultTermDays: prazos[0] || 30,
    maxCreditInstallments: parseMaxParcelasCartao(c.maxParcelasCartao),
    creditFeePercentByInstallment: normalizeCreditCardFeeSchedule(c.taxasCartaoCreditoPorParcela, Number(c.taxaCartaoCreditoPercentual) || 0),
    debitFeePercent: Math.max(0, Number(c.taxaCartaoDebitoPercentual || 0)),
    creditSettlementDays: credito === '' ? 30 : Math.max(0, Number(credito)),
    debitSettlementDays: debito === '' ? 1 : Math.max(0, Number(debito)),
  };
};

// ---------------------------------------------------------------------------
// Totais
// ---------------------------------------------------------------------------

export interface LinhaComValor {
  precoUnitario: number;
  quantidade: number;
  desconto: number;
}

/**
 * Valor bruto da linha em centavos, ARREDONDADO POR LINHA (preco em centavos x
 * quantidade). E' a conta do PDV (cartLineGrossCents) e da NF-e. Desde a fatia
 * 3c (19/10/2026) o Pedido de Venda e o servidor somam assim tambem -- antes
 * somavam preco x quantidade sem arredondar e, com quantidade fracionada (kg),
 * o total podia diferir 1 centavo do PDV.
 */
export const brutoDaLinhaCentavos = (linha: { precoUnitario: number; quantidade: number }): number => (
  Math.max(0, Math.round(toCents(linha.precoUnitario) * linha.quantidade))
);

/** Subtotal da linha como a grade grava: preco x quantidade - desconto, nunca negativo. */
export const subtotalDaLinha = (linha: LinhaComValor): number => (
  fromCents(Math.max(0, brutoDaLinhaCentavos(linha) - toCents(linha.desconto)))
);

export interface TotaisDoFechamento {
  valorTotalItens: number;
  valorTotalDescontosItens: number;
  descontoGeralCentavos: number;
  descontoGeral: number;
  valorTotalDescontos: number;
  valorTotal: number;
  valorTotalCentavos: number;
}

/**
 * Mesma conta do Pedido de Venda: o desconto GERAL incide sobre o subtotal
 * ja' com os descontos de item (nao sobre frete/encargos, que sao acrescimos).
 */
export const totaisDoFechamento = (args: {
  itens: LinhaComValor[];
  descontoGeralTipo: 'percentual' | 'valor';
  descontoGeralValor: unknown;
  frete: number;
  encargos: number;
}): TotaisDoFechamento => {
  const valorTotalItens = fromCents(args.itens.reduce((acc, i) => acc + brutoDaLinhaCentavos(i), 0));
  const valorTotalDescontosItens = args.itens.reduce((acc, i) => acc + i.desconto, 0);
  const baseCentavos = toCents(Math.max(0, valorTotalItens - valorTotalDescontosItens));
  const descontoGeralCentavos = calcularDescontoCents(args.descontoGeralTipo, args.descontoGeralValor, baseCentavos);
  const descontoGeral = fromCents(descontoGeralCentavos);
  const valorTotalDescontos = valorTotalDescontosItens + descontoGeral;
  const valorTotal = Math.max(0, valorTotalItens - valorTotalDescontos + Number(args.frete || 0) + Number(args.encargos || 0));
  return {
    valorTotalItens,
    valorTotalDescontosItens,
    descontoGeralCentavos,
    descontoGeral,
    valorTotalDescontos,
    valorTotal,
    valorTotalCentavos: toCents(valorTotal),
  };
};

// ---------------------------------------------------------------------------
// O que a tela manda (validado antes de qualquer leitura no banco)
// ---------------------------------------------------------------------------

export interface LoteDoItem {
  loteId: string;
  lote: string;
  validade: string | null;
  quantidade: number;
}

export interface ItemDoFechamento extends LinhaComValor {
  id: string;
  nome: string;
  subtotal: number;
  fatorConversao?: number;
  lotes?: LoteDoItem[];
  /** Demais campos da linha (codigo, unidade, embalagem, tabela de preco, promocao...), guardados como vieram. */
  [campo: string]: unknown;
}

export interface PedidoDeFechamento {
  /** Pre-venda ou pedido do agente ja' gravado. */
  pedidoId: string | null;
  /** Venda direta: id gerado na tela -- repetir o envio nao duplica a venda. */
  idDocumento: string | null;
  vendedorId: string;
  clienteId: string | null;
  clienteNome: string;
  /** Cliente a cadastrar (27/11/2026, clienteSemCadastroDomain): nome/cidade/telefone no Consumidor Final; so' a vista. */
  clienteSemCadastro: ClienteSemCadastro | null;
  observacao: string;
  dataVenda: string;
  itens: ItemDoFechamento[];
  descontoGeral: {
    tipo: 'percentual' | 'valor';
    valorInformado: number;
    excedeuLimite: boolean;
    aprovacao?: Record<string, unknown>;
  };
  frete: number;
  encargos: number;
  /** Transporte para a nota (27/10/2026, transporteNotaDomain): null = nada informado. */
  transporte: Record<string, unknown> | null;
  pagamentos: Array<Record<string, unknown>>;
  orcamentoId: string | null;
  /**
   * Venda do PDV (fatia 3c, 19/10/2026): sessao de caixa aberta do operador.
   * Junto com `pedidoId` (23/11/2026) = pre-venda faturada na Frente de Caixa: o
   * servidor fatura sobre a propria pre-venda e mantem o vendedor dela.
   */
  pdvSessionId: string | null;
  /** Comprovante do PIN do vendedor (identificacao exigida, 19/10/2026). */
  comprovanteVendedorId: string | null;
  /**
   * Venda com entrega futura (23/10/2026, entregaFuturaDomain.ts): fatura
   * sem baixar o estoque (fica reservado); a entrega vem depois.
   */
  entregaFutura: boolean;
  /** "aaaa-mm-dd" ou vazio. */
  previsaoEntrega: string;
  /** "Com nota / Sem nota" (23/10/2026, notaDoPedidoDomain.ts); null = nao informado (mantem o do pedido aberto). */
  comNotaFiscal: boolean | null;
  /**
   * Pedido de bonificacao (30/10/2026, bonificacaoDomain.ts): so' brindes, fatura
   * SEM pagamento. O servidor confere contra o pedido gravado.
   */
  ehBonificacao: boolean;
}

const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;
const DATA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;
export const LIMITE_DE_ITENS_NO_FECHAMENTO = 500;

const numero = (valor: unknown): number => {
  const n = typeof valor === 'string' ? Number(valor.replace(',', '.')) : Number(valor);
  return Number.isFinite(n) ? n : Number.NaN;
};

const texto = (valor: unknown, maximo: number): string => String(valor ?? '').trim().slice(0, maximo);

/** Lotes de uma linha, como a tela manda (null = invalido). Tambem usado pela OS (osFechamentoDomain). */
export const lerLotes = (valor: unknown): LoteDoItem[] | null => {
  if (valor === undefined || valor === null) return [];
  if (!Array.isArray(valor) || valor.length > 50) return null;
  const lotes: LoteDoItem[] = [];
  for (const bruto of valor) {
    const l = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
    const quantidade = numero(l.quantidade);
    if (!ID_VALIDO.test(String(l.loteId ?? '')) || !(quantidade > 0)) return null;
    lotes.push({ loteId: String(l.loteId), lote: texto(l.lote, 60), validade: l.validade ? texto(l.validade, 10) : null, quantidade });
  }
  return lotes;
};

/** Valida e normaliza o corpo do POST. Devolve a primeira coisa errada, em portugues. */
export const lerPedidoDeFechamento = (corpo: unknown): { erro: string } | { pedido: PedidoDeFechamento } => {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  const pedidoId = c.pedidoId ? String(c.pedidoId) : null;
  const idDocumento = c.idDocumento ? String(c.idDocumento) : null;
  if (pedidoId && !ID_VALIDO.test(pedidoId)) return { erro: 'Pedido inválido. Atualize a tela e tente de novo.' };
  if (idDocumento && !ID_VALIDO.test(idDocumento)) return { erro: 'Venda inválida. Atualize a tela e tente de novo.' };
  if (!pedidoId && !idDocumento) return { erro: 'Venda sem identificação. Atualize a tela e tente de novo.' };

  const dataVenda = String(c.dataVenda ?? '');
  if (!DATA_VALIDA.test(dataVenda)) return { erro: 'Informe a data da venda.' };

  if (!Array.isArray(c.itens) || c.itens.length === 0) return { erro: 'Adicione pelo menos um item à venda.' };
  if (c.itens.length > LIMITE_DE_ITENS_NO_FECHAMENTO) return { erro: `A venda pode ter no máximo ${LIMITE_DE_ITENS_NO_FECHAMENTO} itens. Divida em duas vendas.` };

  const itens: ItemDoFechamento[] = [];
  for (const bruto of c.itens) {
    const i = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
    const nome = texto(i.nome, 200) || 'item';
    const id = String(i.id ?? '');
    if (!id || (id !== 'avulso' && !ID_VALIDO.test(id))) return { erro: `${nome}: produto inválido. Remova o item e lance de novo.` };
    // Bonificacao (30/10/2026): item de brinde vai a preco zero, sem desconto; o preco cheio
    // (precoReferencia) so' serve para a NF-e e para o limite. Ver bonificacaoDomain.ts.
    const bonificado = i.bonificado === true;
    const precoReferencia = numero(i.precoReferencia);
    if (bonificado && !(precoReferencia >= 0)) return { erro: `${nome}: valor da bonificação inválido. Volte o item para cobrado e bonifique de novo.` };
    const precoUnitario = bonificado ? 0 : numero(i.precoUnitario);
    const quantidade = numero(i.quantidade);
    const desconto = bonificado || i.desconto === undefined || i.desconto === null || i.desconto === '' ? 0 : numero(i.desconto);
    if (!(precoUnitario >= 0)) return { erro: `${nome}: preço inválido.` };
    if (!(quantidade > 0)) return { erro: `${nome}: a quantidade deve ser maior que zero.` };
    if (!(desconto >= 0)) return { erro: `${nome}: desconto inválido.` };
    if (desconto > precoUnitario * quantidade + 0.005) return { erro: `${nome}: o desconto é maior que o valor do item.` };
    const lotes = lerLotes(i.lotes);
    if (lotes === null) return { erro: `${nome}: lote inválido. Remova o item e lance de novo.` };
    const fator = i.fatorConversao === undefined || i.fatorConversao === null ? undefined : numero(i.fatorConversao);
    if (fator !== undefined && !(fator > 0)) return { erro: `${nome}: unidade de venda inválida.` };
    const item: ItemDoFechamento = { ...i, id, nome, precoUnitario, quantidade, desconto, subtotal: 0 };
    item.subtotal = subtotalDaLinha(item);
    if (bonificado) {
      item.bonificado = true;
      item.precoReferencia = precoReferencia;
    } else {
      delete item.bonificado;
      delete item.precoReferencia;
    }
    if (fator !== undefined) item.fatorConversao = fator;
    if (lotes.length > 0) item.lotes = lotes; else delete item.lotes;
    itens.push(item);
  }

  const dg = (c.descontoGeral && typeof c.descontoGeral === 'object' ? c.descontoGeral : {}) as Record<string, unknown>;
  const valorInformado = dg.valorInformado === undefined || dg.valorInformado === '' ? 0 : numero(dg.valorInformado);
  if (!(valorInformado >= 0)) return { erro: 'Desconto geral inválido.' };
  const frete = c.frete === undefined || c.frete === '' ? 0 : numero(c.frete);
  const encargos = c.encargos === undefined || c.encargos === '' ? 0 : numero(c.encargos);
  if (!(frete >= 0)) return { erro: 'Frete inválido.' };
  if (!(encargos >= 0)) return { erro: 'Encargos inválidos.' };

  // Pedido de bonificacao (30/10/2026): sempre um pedido ja' gravado e sem pagamento.
  const ehBonificacao = c.tipoPedido === 'bonificacao';
  if (ehBonificacao && !pedidoId) return { erro: 'Bonificação sem pedido gravado. Atualize a tela e tente de novo.' };
  if (ehBonificacao && Array.isArray(c.pagamentos) && c.pagamentos.length > 0) return { erro: 'Bonificação não tem pagamento: é mercadoria sem cobrança.' };
  if (!ehBonificacao && (!Array.isArray(c.pagamentos) || c.pagamentos.length === 0)) return { erro: 'Informe a forma de pagamento.' };
  const listaDePagamentos = Array.isArray(c.pagamentos) ? c.pagamentos : [];
  if (listaDePagamentos.length > 60) return { erro: 'Pagamentos demais nesta venda. Junte os pagamentos da mesma forma.' };

  const vendedorId = String(c.vendedorId ?? '');
  if (vendedorId && !ID_VALIDO.test(vendedorId)) return { erro: 'Vendedor inválido. Escolha o vendedor de novo.' };
  const clienteId = c.clienteId ? String(c.clienteId) : null;
  if (clienteId && !ID_VALIDO.test(clienteId)) return { erro: 'Cliente inválido. Escolha o cliente de novo.' };
  const orcamentoId = c.orcamentoId ? String(c.orcamentoId) : null;
  if (orcamentoId && !ID_VALIDO.test(orcamentoId)) return { erro: 'Orçamento de origem inválido.' };
  const pdvSessionId = c.pdvSessionId ? String(c.pdvSessionId) : null;
  if (pdvSessionId && !ID_VALIDO.test(pdvSessionId)) return { erro: 'Caixa do PDV inválido. Feche e abra o PDV de novo.' };
  const comprovanteVendedorId = c.comprovanteVendedorId ? String(c.comprovanteVendedorId) : null;
  if (comprovanteVendedorId && !ID_VALIDO.test(comprovanteVendedorId)) return { erro: 'Identificação do vendedor inválida. Finalize de novo e digite o código e a senha.' };
  // Cliente a cadastrar (27/11/2026): so' a vista -- Boleto e a prazo precisam do cadastro.
  const clienteSemCadastro = lerClienteSemCadastro(c.clienteSemCadastro);
  const erroSemCadastro = erroDasFormasSemCadastro(listaDePagamentos.map((p) => (p && typeof p === 'object' ? ((p as Record<string, unknown>).forma || (p as Record<string, unknown>).formaPagamento) : '')), clienteSemCadastro);
  if (erroSemCadastro) return { erro: erroSemCadastro };

  return {
    pedido: {
      pedidoId,
      idDocumento: pedidoId ? null : idDocumento,
      vendedorId,
      clienteId,
      clienteNome: texto(c.clienteNome, 200).toUpperCase() || 'CONSUMIDOR FINAL',
      clienteSemCadastro,
      observacao: texto(c.observacao, 2000),
      dataVenda,
      itens,
      descontoGeral: {
        tipo: dg.tipo === 'percentual' ? 'percentual' : 'valor',
        valorInformado,
        excedeuLimite: dg.excedeuLimite === true,
        ...(dg.aprovacao && typeof dg.aprovacao === 'object' ? { aprovacao: dg.aprovacao as Record<string, unknown> } : {}),
      },
      frete,
      encargos,
      transporte: transporteParaGravar(lerTransporte(c.transporte)),
      pagamentos: listaDePagamentos.map((p) => (p && typeof p === 'object' ? p as Record<string, unknown> : {})),
      orcamentoId,
      pdvSessionId,
      comprovanteVendedorId,
      entregaFutura: c.entregaFutura === true,
      ehBonificacao,
      previsaoEntrega: DATA_VALIDA.test(String(c.previsaoEntrega ?? '')) ? String(c.previsaoEntrega) : '',
      comNotaFiscal: typeof c.comNotaFiscal === 'boolean' ? c.comNotaFiscal : null,
    },
  };
};

/** Chave da empresa: liga o fechamento pelo servidor (SuperAdmin, por empresa). */
export const parseVendaPeloServidor = (valor: unknown): boolean => valor === true;

/**
 * "Nota" (Pagamento a Prazo) na Frente de Caixa (25/11/2026, Jomarly).
 * Caixa de marcar da filial, desligada por padrao: o caixa so' tinha
 * dinheiro, Pix, cartao e cheque. Ligada, o pagamento ganha "Pagamento a
 * Prazo" com as mesmas regras do Pedido de Venda (cliente identificado,
 * limite de credito, bloqueio por atraso) e gera o titulo no Contas a Receber.
 */
export const parseAPrazoNaFrenteDeCaixa = (valor: unknown): boolean => valor === true;

export const FORMA_A_PRAZO = 'Pagamento a Prazo';

/**
 * O que impede a venda a prazo no caixa, ou null. `clienteId` vazio ou o
 * cliente padrao (consumidor final) = sem cliente identificado.
 */
export const erroDoAPrazoNoCaixa = (
  formas: unknown[],
  opcoes: { ativo: boolean; clienteId: unknown; clienteEhPadrao?: boolean },
): string | null => {
  if (!formas.some((forma) => forma === FORMA_A_PRAZO)) return null;
  if (!opcoes.ativo) {
    return 'A venda a prazo não está liberada na Frente de Caixa desta filial. Para liberar, marque "Frente de Caixa: aceitar Pagamento a Prazo (nota)" em Configurações da Filial, ou faça a venda pelo Pedido de Venda.';
  }
  if (!String(opcoes.clienteId ?? '').trim() || opcoes.clienteEhPadrao) {
    return 'Venda a prazo precisa do cliente identificado. Escolha o cliente (F2) e abra o pagamento de novo.';
  }
  return null;
};

/**
 * FORMA DE PAGAMENTO ESCOLHIDA PELO VENDEDOR NO APP (25/11/2026, pedido do dono
 * pela Embala Minas). O vendedor escolhe a forma no pedido do app; a pre-venda
 * ja' nasce com ela (`formaPagamentoVendedor`). Decisao do dono: so' quem tem a
 * permissao "trocar a forma escolhida pelo vendedor" fatura com outra forma.
 * Credito de devolucao e cashback sao abatimento do cliente, nao troca de forma.
 */
export const PERMISSAO_TROCAR_FORMA_DO_VENDEDOR = 'vendas.trocar_forma_do_vendedor';
export const CAMPO_FORMA_DO_VENDEDOR = 'formaPagamentoVendedor';
const FORMAS_QUE_SO_ABATEM = ['Crédito de Devolução', 'Cashback'];

/** Forma escolhida pelo vendedor gravada no pedido ('' quando nao ha'). */
export const formaDoVendedor = (pedido: { [CAMPO_FORMA_DO_VENDEDOR]?: unknown } | null | undefined): string => (
  typeof pedido?.[CAMPO_FORMA_DO_VENDEDOR] === 'string' ? String(pedido[CAMPO_FORMA_DO_VENDEDOR]).trim() : ''
);

/**
 * Parcelas do boleto escolhidas pelo vendedor no app (26/11/2026, pedido do dono:
 * "igual na tela de pedidos, pra ja' cair pre-definido na pre-venda"). So' com a
 * forma Boleto. A pre-venda abre com elas; o intervalo e' o prazo do boleto da loja.
 */
export const CAMPO_PARCELAS_DO_BOLETO = 'parcelasBoleto';
export const MAX_PARCELAS_DO_BOLETO_NO_APP = 12;
/** 1..12 quando valido; 0 = nao informado (a loja decide ao faturar). */
export const parcelasDoBoleto = (valor: unknown): number => {
  const n = typeof valor === 'number' ? valor : Number.parseInt(String(valor ?? ''), 10);
  return Number.isInteger(n) && n >= 1 && n <= MAX_PARCELAS_DO_BOLETO_NO_APP ? n : 0;
};

/**
 * DIAS DE CADA PARCELA ESCOLHIDOS NO APP (27/11/2026, Ivan da Embala Minas:
 * "7, 14, 21, 28, 42 dias... 14/21, 21/28/35", e o dono: "o app mobile tem que
 * ter as mesmas formas e funcoes que ja' temos no sistema"). Boleto e Pagamento
 * a Prazo no app ganham parcelas + intervalo e, no boleto, os dias de cada um
 * editaveis -- como no Pedido de Venda. A pre-venda guarda os dias contados do
 * faturamento (`diasDasParcelas`, ex.: [21, 28, 35]); o sistema abre o
 * pagamento com eles (prazoDoAppNoPagamento). Sem o campo, vale o de antes:
 * o prazo padrao da loja.
 */
export const CAMPO_DIAS_DAS_PARCELAS = 'diasDasParcelas';
export const MAX_DIAS_DA_PARCELA = 999;
export const FORMAS_COM_PRAZO_NO_APP = ['Boleto', 'Pagamento a Prazo'];

/** Dias validos (1 a 999, cada parcela depois da anterior, ate' 12); [] = nao informado. */
export const diasDasParcelas = (valor: unknown): number[] => {
  if (!Array.isArray(valor) || valor.length < 1 || valor.length > MAX_PARCELAS_DO_BOLETO_NO_APP) return [];
  const dias = valor.map((v) => (typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10)));
  const validos = dias.every((d, i) => Number.isInteger(d) && d >= 1 && d <= MAX_DIAS_DA_PARCELA && (i === 0 || d > dias[i - 1]));
  return validos ? dias : [];
};

/** 3 parcelas de 21 em 21 => [21, 42, 63]. */
export const diasUniformes = (parcelas: number, intervalo: number): number[] => (
  Number.isInteger(parcelas) && parcelas >= 1 && Number.isInteger(intervalo) && intervalo >= 1
    ? Array.from({ length: parcelas }, (_, i) => intervalo * (i + 1))
    : []
);

/** Os dias seguem um intervalo so' (21/42/63)? Entao nao ha' vencimento personalizado. */
export const diasSaoUniformes = (dias: number[]): boolean => dias.every((d, i) => d === dias[0] * (i + 1));

/** O que o vendedor digitou nos dias de cada parcela: por que nao vale, ou null. */
export const erroDosDiasDasParcelas = (digitados: string[]): string | null => {
  const dias = digitados.map((d) => Number.parseInt(String(d ?? '').trim(), 10));
  const vazia = dias.findIndex((d) => !Number.isInteger(d) || d < 1 || d > MAX_DIAS_DA_PARCELA);
  if (vazia >= 0) return `Informe os dias da ${vazia + 1}ª parcela (de 1 a ${MAX_DIAS_DA_PARCELA}).`;
  const foraDeOrdem = dias.findIndex((d, i) => i > 0 && d <= dias[i - 1]);
  if (foraDeOrdem >= 0) return `A ${foraDeOrdem + 1}ª parcela precisa vencer depois da ${foraDeOrdem}ª: aumente os dias dela.`;
  return null;
};

/**
 * Campos do pagamento (PaymentDraft) que o sistema abre a partir dos dias do
 * app, contados de `hoje` (o faturamento). null = sem dias: vale o padrao.
 * Pagamento a Prazo no sistema so' tem intervalo fixo: usa o 1o dia como prazo.
 */
export const prazoDoAppNoPagamento = (forma: string, dias: number[], hoje: string): Record<string, unknown> | null => {
  if (dias.length === 0 || !FORMAS_COM_PRAZO_NO_APP.includes(forma)) return null;
  const primeiro = dias[0];
  if (forma === 'Pagamento a Prazo') {
    return { parcelasAPrazo: String(dias.length), prazoDias: String(primeiro), dataVencimento: addDaysToDateInput(hoje, primeiro) };
  }
  const personalizadas = dias.length > 1 && !diasSaoUniformes(dias)
    ? dias.map((d) => ({ dias: String(d), vencimento: addDaysToDateInput(hoje, d) }))
    : [];
  return {
    parcelasAPrazo: String(dias.length),
    prazoDias: String(primeiro),
    dataPrevistaRecebimento: addDaysToDateInput(hoje, primeiro),
    parcelasPersonalizadas: personalizadas,
  };
};

/** Por que a venda nao pode sair com estas formas, ou null. */
export const erroDaFormaDoVendedor = (args: {
  formaDoVendedor: string;
  formasDaVenda: unknown[];
  podeTrocar: boolean;
  numeroPedido?: string;
}): string | null => {
  const escolhida = String(args.formaDoVendedor || '').trim();
  if (!escolhida || args.podeTrocar) return null;
  const trocadas = args.formasDaVenda
    .map((f) => String(f ?? '').trim())
    .filter((f) => f && f !== escolhida && !FORMAS_QUE_SO_ABATEM.includes(f));
  if (trocadas.length === 0) return null;
  const numero = args.numeroPedido ? ` #${args.numeroPedido}` : '';
  return `O vendedor escolheu "${escolhida}" na pré-venda${numero}. Para receber em outra forma é preciso a permissão `
    + '"Vendas: Pré-venda — Trocar a forma de pagamento escolhida pelo vendedor" (Usuários). '
    + `Receba em ${escolhida} ou peça a um responsável.`;
};

/**
 * PRE-VENDA DO APP NAO PEDE A SENHA DO VENDEDOR AO FINALIZAR (26/11/2026, pedido
 * do dono): "as vendas do mobile que vem ja' com o vendedor que fez, na hora de
 * finalizar a pre-venda vai pedir senha nao, ne'?".
 *
 * Com "Exigir identificacao do vendedor" ligada, o Finalizar pedia o codigo e a
 * senha do vendedor -- mas quem fatura e' o escritorio, e o vendedor do app
 * esta' na rua. Ele ja' se identificou ao gravar: entrou no app com o codigo e a
 * senha dele (o login do app e' o proprio vendedor). Regra: pre-venda gravada
 * pelo login do proprio vendedor dispensa a identificacao no Finalizar, desde
 * que o vendedor da venda continue o mesmo. Pre-venda gravada no balcao (login da
 * estacao) continua pedindo, como sempre.
 *
 * Devolve o id do vendedor que gravou a pre-venda pelo proprio login, ou ''.
 */
export const vendedorQueGravouAPreVenda = (
  pedido: { status?: unknown; vendedorId?: unknown; criadoPor?: unknown } | null | undefined,
): string => {
  if (!pedido || pedido.status !== 'Pré-venda') return '';
  const vendedor = typeof pedido.vendedorId === 'string' ? pedido.vendedorId.trim() : '';
  const autor = typeof pedido.criadoPor === 'string' ? pedido.criadoPor.trim() : '';
  return vendedor && vendedor === autor ? vendedor : '';
};
