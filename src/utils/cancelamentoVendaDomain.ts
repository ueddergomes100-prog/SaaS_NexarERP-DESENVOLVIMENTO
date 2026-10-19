import { fromCents, toCents, transactionMovesPhysicalCash } from './financeDomain';

/*
 * CANCELAR VENDA E ALTERAR A FORMA DE PAGAMENTO (item 8, fatia 3b -- 19/10/2026).
 *
 * Regra pura usada pela tela (caminho de hoje, chave "Venda pelo servidor"
 * desligada) e pelo servidor (server/services/vendaCancelamento.js, chave
 * ligada): o sistema tem um comportamento so'.
 *
 * Decisoes do dono (19/10/2026, caixa de perguntas):
 *  - cancelar devolve ao cliente o credito de devolucao usado na venda (antes
 *    ele perdia o credito);
 *  - cancelar pede MOTIVO (gravado na venda e no log);
 *  - pedido numa rota de entrega em aberto so' cancela depois de sair da rota;
 *  - alterar a forma de pagamento fica bloqueado quando alguma parcela ja' foi
 *    recebida no Contas a Receber, tem recebimento parcial, cheque compensado
 *    ou boleto emitido (antes o recebimento era sobrescrito sem aviso).
 *
 * Sem tela, sem Firestore: os campos devolvidos aqui nao tem data do servidor
 * nem metadados -- quem grava acrescenta.
 */

// ---------------------------------------------------------------------------
// MOTIVO DO CANCELAMENTO
// ---------------------------------------------------------------------------

export const MOTIVO_CANCELAMENTO_MINIMO = 5;
export const MOTIVO_CANCELAMENTO_MAXIMO = 300;

/** Erro do motivo digitado (null = ok). */
export const erroDoMotivoDoCancelamento = (motivo: unknown): string | null => {
  const texto = String(motivo ?? '').trim();
  if (texto.length < MOTIVO_CANCELAMENTO_MINIMO) return `Escreva o motivo do cancelamento (mínimo ${MOTIVO_CANCELAMENTO_MINIMO} letras).`;
  if (texto.length > MOTIVO_CANCELAMENTO_MAXIMO) return `O motivo pode ter no máximo ${MOTIVO_CANCELAMENTO_MAXIMO} letras.`;
  return null;
};

// ---------------------------------------------------------------------------
// ROTA DE ENTREGA (romaneio)
// ---------------------------------------------------------------------------

/** Trava gravada em romaneio_pedidos/{pedidoId} (ver romaneioDomain.ts). */
export interface TravaDeRotaDoPedido {
  romaneioId?: string;
  romaneioTitulo?: string;
  /** 'em_romaneio' = numa rota em montagem ou em rota; 'entregue'/'liberado' = rota encerrada. */
  situacao?: string;
}

/** Pedido numa rota em aberto nao cancela: a rota continuaria levando o pedido. */
export const erroDaRotaParaCancelar = (trava: TravaDeRotaDoPedido | null | undefined, numeroPedido: string): string | null => {
  if (!trava || !trava.romaneioId || trava.situacao !== 'em_romaneio') return null;
  const rota = String(trava.romaneioTitulo || '').trim() || 'uma rota de entrega';
  return `O pedido #${numeroPedido} está na rota "${rota}", que ainda não foi fechada. Tire o pedido da rota (Romaneio de Entrega) antes de cancelar a venda.`;
};

// ---------------------------------------------------------------------------
// CREDITO DE DEVOLUCAO USADO NA VENDA
// ---------------------------------------------------------------------------

export const FORMA_CREDITO_DEVOLUCAO = 'Crédito de Devolução';

interface PagamentoGravado {
  formaPagamento?: string;
  valorCentavos?: number;
  valor?: number;
}

/** Quanto da venda foi pago com credito de devolucao (centavos). */
export const creditoUsadoNaVenda = (pagamentos: unknown): number => (
  (Array.isArray(pagamentos) ? pagamentos as PagamentoGravado[] : [])
    .filter((p) => p && p.formaPagamento === FORMA_CREDITO_DEVOLUCAO)
    .reduce((soma, p) => soma + Math.max(0, Number(p.valorCentavos ?? toCents(Number(p.valor || 0))) || 0), 0)
);

/** Id fixo: cancelar duas vezes nunca devolve o credito em dobro. */
export const idDoCreditoDevolvido = (pedidoId: string): string => `cancelamento_${pedidoId}`;

/**
 * Credito devolvido ao cliente no cancelamento. Mesmo formato do credito que a
 * Devolucao cria (DevolucaoVendaModal) -- e' pelo NOME do cliente que o Pedido
 * de Venda e o Contas a Receber procuram o credito.
 */
export const camposDoCreditoDevolvido = (args: {
  pedidoId: string;
  numeroPedido: string;
  clienteNome: string;
  valorCentavos: number;
  tenantId: string;
}): Record<string, unknown> => ({
  clienteNome: String(args.clienteNome || '').trim().toUpperCase(),
  pedidoOrigemId: args.pedidoId,
  numeroPedidoOriginal: args.numeroPedido,
  valorOriginal: fromCents(args.valorCentavos),
  saldoDisponivel: fromCents(args.valorCentavos),
  saldoDisponivelCentavos: args.valorCentavos,
  status: 'disponivel',
  origem: 'cancelamento_venda',
  motivo: `Crédito usado na venda #${args.numeroPedido}, devolvido no cancelamento da venda.`,
  tenantId: args.tenantId,
});

// ---------------------------------------------------------------------------
// LANCAMENTOS DA VENDA NO CANCELAMENTO
// ---------------------------------------------------------------------------

export interface TituloDaVenda {
  id: string;
  dados: Record<string, unknown>;
}

export interface EscritasDoEstorno {
  /** Lancamentos existentes a atualizar (+ estornadaEm/updatedAt/metadados de quem grava). */
  atualizar: Array<{ id: string; campos: Record<string, unknown>; nota: string }>;
  /** Lancamentos novos de estorno (+ createdAt/metadados de quem grava). */
  criar: Array<{ id: string; campos: Record<string, unknown> }>;
}

const numero = (valor: unknown, padrao = 0): number => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : padrao;
};

/** O que muda entre o cancelamento da venda e o da OS (fatia 3d, 19/10/2026). */
const ROTULOS_DO_ESTORNO = {
  venda: {
    campoOrigem: 'pedidoId',
    sourceType: 'cancelamento_pedido_venda',
    categoria: 'Cancelamento de Venda',
    documento: 'da venda',
    notaEstornada: 'Estornada pelo cancelamento da venda',
    notaCancelada: 'Cancelada junto com a venda',
  },
  os: {
    campoOrigem: 'osId',
    sourceType: 'cancelamento_ordem_servico',
    categoria: 'Cancelamento de OS',
    documento: 'da OS',
    notaEstornada: 'Estornada pelo cancelamento da OS',
    notaCancelada: 'Cancelada junto com a OS',
  },
} as const;

/**
 * Pago vira "estornado" + um lancamento de saida que devolve o dinheiro (mesma
 * forma de pagamento); o que estava em aberto e' so' cancelado. Mesmos campos
 * que o cancelamento pela tela sempre gravou. Lancamento ja' cancelado fica como
 * esta'. Serve a venda e a OS (`tipo`).
 */
export const estornoDosTitulos = (
  titulos: TituloDaVenda[],
  args: { documentoId: string; numero: string; clienteNome: string; usuarioId: string; tenantId: string; hoje: string },
  tipo: keyof typeof ROTULOS_DO_ESTORNO,
): EscritasDoEstorno => {
  const rotulos = ROTULOS_DO_ESTORNO[tipo];
  const escritas: EscritasDoEstorno = { atualizar: [], criar: [] };
  titulos.forEach(({ id, dados }) => {
    if (dados.status === 'Cancelada') return;
    if (dados.status === 'Paga') {
      const cartao = (dados.cartao || null) as { valorTaxa?: number; valorTaxaCentavos?: number; valorLiquido?: number; valorLiquidoCentavos?: number } | null;
      const valorCentavos = numero(dados.valorCentavos ?? toCents(numero(dados.valor)));
      const movimentaCaixa = transactionMovesPhysicalCash(dados as Parameters<typeof transactionMovesPhysicalCash>[0]);
      escritas.atualizar.push({ id, campos: { estornada: true, statusOperacional: 'Cancelada' }, nota: rotulos.notaEstornada });
      escritas.criar.push({
        id: `estorno_cancelamento_${id}`,
        campos: {
          descricao: `Estorno do cancelamento ${rotulos.documento} #${args.numero}`,
          categoria: rotulos.categoria,
          valor: numero(dados.valor),
          valorCentavos,
          valorBruto: numero(dados.valorBruto ?? dados.valor),
          valorBrutoCentavos: numero(dados.valorBrutoCentavos ?? dados.valorCentavos ?? toCents(numero(dados.valor))),
          valorTaxa: numero(dados.valorTaxa ?? cartao?.valorTaxa),
          valorTaxaCentavos: numero(dados.valorTaxaCentavos ?? cartao?.valorTaxaCentavos),
          valorLiquido: numero(dados.valorLiquido ?? cartao?.valorLiquido ?? dados.valor),
          valorLiquidoCentavos: numero(dados.valorLiquidoCentavos ?? cartao?.valorLiquidoCentavos ?? dados.valorCentavos ?? toCents(numero(dados.valor))),
          cartao: cartao || null,
          tipo: 'saida',
          formaPagamento: String(dados.formaPagamento || 'Outros'),
          naturezaFinanceira: movimentaCaixa ? 'caixa_fisico' : String(dados.naturezaFinanceira || 'bancario_digital'),
          movimentaCaixaFisico: movimentaCaixa,
          status: 'Paga',
          data: args.hoje,
          [rotulos.campoOrigem]: args.documentoId,
          sourceType: rotulos.sourceType,
          sourceId: args.documentoId,
          sourcePaymentTransactionId: id,
          idempotencyKey: `cancelamento:${args.documentoId}:transacao:${id}`,
          clienteNome: args.clienteNome,
          usuarioResponsavelId: args.usuarioId,
          tenantId: args.tenantId,
        },
      });
      return;
    }
    escritas.atualizar.push({ id, campos: { status: 'Cancelada', movimentaCaixaFisico: false }, nota: rotulos.notaCancelada });
  });
  return escritas;
};

export const estornoDosTitulosDaVenda = (
  titulos: TituloDaVenda[],
  args: { pedidoId: string; numeroPedido: string; clienteNome: string; usuarioId: string; tenantId: string; hoje: string },
): EscritasDoEstorno => estornoDosTitulos(titulos, {
  documentoId: args.pedidoId,
  numero: args.numeroPedido,
  clienteNome: args.clienteNome,
  usuarioId: args.usuarioId,
  tenantId: args.tenantId,
  hoje: args.hoje,
}, 'venda');

// ---------------------------------------------------------------------------
// ALTERAR A FORMA DE PAGAMENTO
// ---------------------------------------------------------------------------

const dataBr = (dia: unknown): string => {
  const texto = String(dia ?? '');
  return /^\d{4}-\d{2}-\d{2}/.test(texto) ? texto.slice(0, 10).split('-').reverse().join('/') : '';
};

const reais = (centavos: number): string => `R$ ${fromCents(centavos).toFixed(2).replace('.', ',')}`;

/**
 * Parcela que ja' teve dinheiro recebido depois da venda (Dar Baixa, recebimento
 * parcial, cheque compensado) ou que tem boleto emitido: refazer as parcelas
 * apagaria isso sem ninguem perceber. Pagamento que JA' NASCEU pago (dinheiro,
 * Pix na hora) nao conta -- e' justamente o que a alteracao corrige.
 * `contexto` (fatia 3d): a OS usa a mesma regra para reabrir.
 */
export const bloqueioParaAlterarPagamento = (
  titulos: Array<Record<string, unknown>>,
  contexto: { documento?: 'venda' | 'OS'; acao?: string } = {},
): string | null => {
  const documento = contexto.documento || 'venda';
  const fazer = contexto.acao || 'alterar a forma de pagamento';
  for (const t of titulos) {
    if (!t || t.status === 'Cancelada' || t.estornada === true) continue;
    const descricao = String(t.descricao || `da ${documento}`);
    const acao = `Estorne o recebimento em Contas a Receber antes de ${fazer}.`;
    if (t.parcialDaTransacaoId) {
      return `Esta ${documento} tem um recebimento parcial de ${reais(numero(t.valorCentavos))}${dataBr(t.dataPagamento) ? ` em ${dataBr(t.dataPagamento)}` : ''}. ${acao}`;
    }
    if (numero(t.pagoParcialCentavos) > 0) {
      return `A parcela "${descricao}" já tem ${reais(numero(t.pagoParcialCentavos))} recebidos por partes. ${acao}`;
    }
    const boleto = t.boleto as { status?: string } | null | undefined;
    if (boleto && boleto.status !== 'cancelado') {
      return `A parcela "${descricao}" tem boleto emitido. Desfaça a emissão em Financeiro › Boletos antes de ${fazer}.`;
    }
    if (t.status === 'Paga' && (t.formaPagamento === 'Cheque' || t.cheque)) {
      return contexto.acao
        ? `O cheque da parcela "${descricao}" já foi compensado. Não é possível ${fazer} depois do cheque compensado.`
        : `O cheque da parcela "${descricao}" já foi compensado. A forma de pagamento não pode mais ser alterada por aqui.`;
    }
    if (t.status === 'Paga' && t.baixaManual) {
      return `A parcela "${descricao}" já foi recebida${dataBr(t.dataPagamento) ? ` em ${dataBr(t.dataPagamento)}` : ''} no Contas a Receber. ${acao}`;
    }
  }
  return null;
};

/** Crédito de devolução não se troca por aqui: o credito ja' foi consumido (ou nao) na venda. */
export const bloqueioDoCreditoNaAlteracao = (pagamentosAntigos: unknown, pagamentosNovos: unknown): string | null => (
  creditoUsadoNaVenda(pagamentosAntigos) !== creditoUsadoNaVenda(pagamentosNovos)
    ? 'Venda paga com crédito de devolução não muda a parte do crédito por aqui. Para trocar, cancele a venda (o crédito volta para o cliente) e faça a venda de novo.'
    : null
);

// ---------------------------------------------------------------------------
// O QUE A TELA MANDA AO SERVIDOR (POST /api/vendas/...)
// ---------------------------------------------------------------------------

const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;

const lerPedidoId = (c: Record<string, unknown>): string | null => {
  const id = String(c.pedidoId ?? '');
  return ID_VALIDO.test(id) ? id : null;
};

/** POST /api/vendas/cancelar: { pedidoId, motivo }. */
export const lerPedidoDeCancelamento = (corpo: unknown): { erro: string } | { pedidoId: string; motivo: string } => {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  const pedidoId = lerPedidoId(c);
  if (!pedidoId) return { erro: 'Venda inválida. Atualize a tela e tente de novo.' };
  const erro = erroDoMotivoDoCancelamento(c.motivo);
  if (erro) return { erro };
  return { pedidoId, motivo: String(c.motivo).trim() };
};

/** POST /api/vendas/cancelar-pre-venda: { pedidoId, nota? }. */
export const lerPedidoDeCancelamentoDaPreVenda = (corpo: unknown): { erro: string } | { pedidoId: string; nota: string } => {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  const pedidoId = lerPedidoId(c);
  if (!pedidoId) return { erro: 'Pré-venda inválida. Atualize a tela e tente de novo.' };
  return { pedidoId, nota: String(c.nota ?? '').trim().slice(0, 200) || 'Pré-venda cancelada' };
};

/** POST /api/vendas/alterar-pagamento: { pedidoId, pagamentos } (rascunhos, como no Finalizar). */
export const lerPedidoDeAlteracaoDePagamento = (corpo: unknown): { erro: string } | { pedidoId: string; pagamentos: Array<Record<string, unknown>> } => {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  const pedidoId = lerPedidoId(c);
  if (!pedidoId) return { erro: 'Venda inválida. Atualize a tela e tente de novo.' };
  if (!Array.isArray(c.pagamentos) || c.pagamentos.length === 0) return { erro: 'Informe a forma de pagamento.' };
  if (c.pagamentos.length > 60) return { erro: 'Pagamentos demais nesta venda. Junte os pagamentos da mesma forma.' };
  return { pedidoId, pagamentos: c.pagamentos.map((p) => (p && typeof p === 'object' ? p as Record<string, unknown> : {})) };
};

