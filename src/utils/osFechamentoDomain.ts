import { getServiceHours, getServiceTotal } from './osServicePricing';
import { calcularDescontoCents, type DescontoTipo } from './descontoDomain';
import {
  buildServiceOrderCommissionSnapshot,
  cancelCommissionSnapshot,
  computeBankCreditsMap,
  fromCents,
  reopenCommissionSnapshot,
  resolveComissaoPercentual,
  summarizePayments,
  toCents,
  type CommissionSnapshot,
  type PaymentRecord,
} from './financeDomain';
import { bloqueioParaAlterarPagamento, erroDoMotivoDoCancelamento, estornoDosTitulos, type EscritasDoEstorno, type TituloDaVenda } from './cancelamentoVendaDomain';
import { bloqueioParaRefazerParcelas } from './alteracaoValorTituloDomain';
import { bloqueioPorParcelaRenegociada } from './renegociacaoDomain';
import { STATUS_NOTA_EM_TRANSMISSAO, listaDeNotas, type NotaDaVenda } from './cancelamentoNotaVendaDomain';
import { computeReservationCommit, computeReservationRelease, computeReservationReturn, type StockFieldDelta, type StockLineItem } from './estoqueReservaDomain';
import { somarLotesUsados, type LoteUsado } from './loteRetornoDomain';
import { lerLotes } from './vendaFechamentoDomain';
import {
  CORES_STATUS_OS_CAMPO,
  STATUS_OS_AGUARDANDO_CONFERENCIA,
  STATUS_OS_CANCELADA,
  STATUS_OS_EM_ATENDIMENTO,
  STATUS_OS_FINALIZADA,
} from './osCampoDomain';

/*
 * FINALIZAR, REABRIR E CANCELAR A OS (item 8 da auditoria, fatia 3d -- 19/10/2026).
 *
 * Regra pura usada pela tela (chave "Venda pelo servidor" desligada) e pelo
 * servidor (server/services/osServidor.js, chave ligada): as duas so' executam
 * o plano que sai daqui, cada uma com o seu SDK. O sistema tem um comportamento so'.
 *
 * Decisoes do dono (19/10/2026, caixa de perguntas), valendo nos dois caminhos:
 *  - cancelar a OS pede MOTIVO e fica bloqueado enquanto houver NF-e, NFC-e ou
 *    NFS-e da OS autorizada ou aguardando resposta;
 *  - devolver as pecas ao estoque no cancelamento continua opcional ("Retornar
 *    estoque?"), mas devolve o que SAIU do estoque (gravado na OS), nunca o que
 *    esta' na tela;
 *  - reabrir (ou mudar o que ja' foi cobrado numa OS finalizada) fica bloqueado
 *    quando alguma parcela ja' foi recebida, tem recebimento parcial, cheque
 *    compensado ou boleto emitido;
 *  - a comissao fica "reaberta" (sem valor) enquanto a OS estiver reaberta e e'
 *    refeita ao finalizar de novo.
 *
 * Reabrir desfaz a finalizacao inteira (lancamentos cancelados, banco
 * estornado, pecas de volta ao mesmo lote) e finalizar de novo refaz tudo com o
 * que estiver na OS. Mudar servicos, pecas, desconto, cliente, tecnico, data de
 * saida ou pagamento de uma OS finalizada e' isso: reabrir + finalizar.
 *
 * Sem tela e sem Firestore: os campos devolvidos aqui nao tem data do servidor
 * nem metadados -- quem grava acrescenta.
 */

export { STATUS_OS_CANCELADA, STATUS_OS_FINALIZADA };

/** Situacao em que a OS fica quando e' reaberta so' para refazer a cobranca. */
export const STATUS_OS_REABERTA_PADRAO = 'Em Manutenção';

/** Situacoes de OS em aberto (as do select da tela). */
export const STATUS_OS_EM_ABERTO = [
  'Orçamento Pendente',
  'Aguardando Peça',
  'Em Manutenção',
  STATUS_OS_EM_ATENDIMENTO,
  STATUS_OS_AGUARDANDO_CONFERENCIA,
];

/** Cor gravada em `statusColor` (lista de OS). */
export const corDoStatusDaOs = (status: unknown): string => {
  switch (status) {
    case STATUS_OS_FINALIZADA: return '#10b981';
    case 'Orçamento Pendente': return '#3b82f6';
    case 'Aguardando Peça': return '#f59e0b';
    case 'Em Manutenção': return '#8b5cf6';
    case STATUS_OS_CANCELADA: return '#ef4444';
    default: return CORES_STATUS_OS_CAMPO[String(status)] || '#6b7280';
  }
};

// ---------------------------------------------------------------------------
// TOTAIS (a mesma conta da tela)
// ---------------------------------------------------------------------------

export interface LinhaServicoDaOs {
  id?: string;
  nome?: string;
  preco?: number;
  quantidade?: number;
  tempoHoras?: number | string | null;
}

export interface LinhaPecaDaOs {
  id?: string;
  nome?: string;
  preco?: number;
  quantidade?: number;
}

export interface DescontoDaOs {
  tipo?: unknown;
  valorInformado?: unknown;
}

const listaDe = <T>(valor: unknown): T[] => (Array.isArray(valor) ? valor.filter((v) => v && typeof v === 'object') as T[] : []);

export interface TotaisDaOs {
  totalServicos: number;
  totalPecas: number;
  subtotal: number;
  descontoCentavos: number;
  valorTotal: number;
  valorTotalCentavos: number;
}

/** Servicos (preco x horas) + pecas (preco x quantidade) - desconto geral. */
export const totaisDaOs = (os: { servicos?: unknown; pecas?: unknown; desconto?: DescontoDaOs | null }): TotaisDaOs => {
  const totalServicos = listaDe<LinhaServicoDaOs>(os.servicos).reduce((acc, s) => acc + getServiceTotal(s), 0);
  const totalPecas = listaDe<LinhaPecaDaOs>(os.pecas).reduce((acc, p) => acc + Number(p.preco || 0) * Number(p.quantidade || 0), 0);
  const subtotal = totalServicos + totalPecas;
  const tipo: DescontoTipo = os.desconto?.tipo === 'percentual' ? 'percentual' : 'valor';
  const descontoCentavos = calcularDescontoCents(tipo, os.desconto?.valorInformado, toCents(subtotal));
  const valorTotal = Math.max(0, subtotal - fromCents(descontoCentavos));
  return { totalServicos, totalPecas, subtotal, descontoCentavos, valorTotal, valorTotalCentavos: toCents(valorTotal) };
};

/**
 * Tudo o que ja' foi cobrado numa OS finalizada: se mudar, a OS precisa ser
 * reaberta e finalizada de novo (lancamentos, banco, estoque e comissao).
 */
export const assinaturaDaCobrancaDaOs = (os: {
  servicos?: unknown;
  pecas?: unknown;
  desconto?: DescontoDaOs | null;
  clienteNome?: unknown;
  mecanicoId?: unknown;
  dataSaida?: unknown;
}): string => {
  const totais = totaisDaOs(os);
  return JSON.stringify({
    s: listaDe<LinhaServicoDaOs>(os.servicos).map((s) => [String(s.id || ''), toCents(Number(s.preco || 0)), getServiceHours(s)]),
    p: listaDe<LinhaPecaDaOs>(os.pecas).map((p) => [String(p.id || ''), toCents(Number(p.preco || 0)), Number(p.quantidade || 0)]),
    d: totais.descontoCentavos,
    t: totais.valorTotalCentavos,
    c: String(os.clienteNome || '').trim().toUpperCase(),
    m: String(os.mecanicoId || ''),
    ds: String(os.dataSaida || ''),
  });
};

/**
 * Campos que nao mexem em dinheiro, estoque nem comissao: podem ser gravados
 * numa OS finalizada (ou cancelada) sem reabrir.
 */
export const CAMPOS_DESCRITIVOS_DA_OS = [
  'clienteTelefone', 'placa', 'modelo', 'marca', 'ano', 'cor', 'renavam', 'quilometragem', 'combustivel',
  'frota', 'serie', 'horimetro', 'tipoEquipamento', 'dataEntrada', 'horaEntrada', 'horaSaida',
  'defeitoRelatado', 'relatorioTecnico', 'materiaisCliente', 'condicoesPagamento', 'observacoes',
] as const;

export const camposDescritivosDaOs = (dados: Record<string, unknown>): Record<string, unknown> => {
  const campos: Record<string, unknown> = {};
  CAMPOS_DESCRITIVOS_DA_OS.forEach((campo) => {
    if (dados[campo] !== undefined) campos[campo] = dados[campo];
  });
  return campos;
};

// ---------------------------------------------------------------------------
// NOTAS FISCAIS DA OS
// ---------------------------------------------------------------------------

const ehNotaDaOs = (nota: NotaDaVenda) => (
  (nota.tipo === 'NF-e' || nota.tipo === 'NFC-e' || nota.tipo === 'NFS-e') && nota.finalidade !== 'devolucao'
);

export const classificarNotasDaOs = (notas: NotaDaVenda[]) => {
  const daOs = notas.filter(ehNotaDaOs);
  return {
    autorizadas: daOs.filter((nota) => nota.status === 'authorized'),
    emTransmissao: daOs.filter((nota) => STATUS_NOTA_EM_TRANSMISSAO.includes(String(nota.status))),
  };
};

/** Nota da OS autorizada ou sem resposta impede cancelar a OS (decisao do dono, 19/10/2026). */
export const erroDasNotasParaCancelarOs = (notas: NotaDaVenda[], numeroOS: string): string | null => {
  const { autorizadas, emTransmissao } = classificarNotasDaOs(notas);
  if (emTransmissao.length > 0) {
    return `A ${listaDeNotas(emTransmissao)} da OS #${numeroOS} ainda está aguardando resposta. Espere a resposta (Notas Fiscais → Sincronizar Notas) antes de cancelar a OS.`;
  }
  if (autorizadas.length > 0) {
    return `A ${listaDeNotas(autorizadas)} da OS #${numeroOS} está autorizada. Cancele a nota em Notas Fiscais antes de cancelar a OS.`;
  }
  return null;
};

// ---------------------------------------------------------------------------
// BLOQUEIOS
// ---------------------------------------------------------------------------

/** OS cancelada nao volta a ser aberta: os lancamentos de estorno ja' existem. */
export const mensagemOsCanceladaNaoReabre = (numeroOS: string): string => (
  `A OS #${numeroOS} está cancelada. OS cancelada não volta a ser aberta: crie uma OS nova para este atendimento.`
);

/** Reabrir (ou refazer a cobranca) de OS finalizada: nada recebido, renegociado nem com valor alterado. */
export const bloqueioParaReabrirOs = (titulos: Array<Record<string, unknown>>): string | null => (
  bloqueioPorParcelaRenegociada(titulos, 'reabrir a OS')
  || bloqueioParaRefazerParcelas(titulos, 'OS')
  || bloqueioParaAlterarPagamento(titulos, { documento: 'OS', acao: 'reabrir a OS' })
  || null
);

// ---------------------------------------------------------------------------
// ESTOQUE
// ---------------------------------------------------------------------------

export interface OsGravada {
  status?: unknown;
  numeroOS?: unknown;
  pecas?: unknown;
  pecasBaixadas?: unknown;
  lotesBaixados?: unknown;
  estoqueBaixado?: unknown;
  estoqueReservado?: unknown;
  pagamentos?: unknown;
  comissao?: unknown;
}

const linhasDeEstoque = (pecas: unknown): StockLineItem[] => (
  listaDe<LinhaPecaDaOs>(pecas)
    .map((p) => ({ id: String(p.id || ''), nome: String(p.nome || ''), quantidade: Number(p.quantidade || 0) }))
    .filter((p) => p.id && p.id !== 'avulso' && p.quantidade > 0)
);

/** O que saiu do estoque na finalizacao. OS antiga (antes de 19/10/2026) nao guardava: vale a lista de pecas. */
export const pecasQueSairamDoEstoque = (os: OsGravada): StockLineItem[] => (
  linhasDeEstoque(Array.isArray(os.pecasBaixadas) ? os.pecasBaixadas : os.pecas)
);

const lotesDaOs = (os: OsGravada): LoteUsado[] => listaDe<LoteUsado>(os.lotesBaixados).filter((l) => l.loteId && Number(l.quantidade) > 0);

/** Soma os deltas do mesmo produto (uma escrita por produto na transacao). */
export const somarDeltasDeEstoque = (deltas: StockFieldDelta[]): StockFieldDelta[] => {
  const porId = new Map<string, StockFieldDelta>();
  deltas.forEach((d) => {
    const atual = porId.get(d.id) || { id: d.id, nome: d.nome, quantidadeDelta: 0, quantidadeReservadaDelta: 0 };
    atual.quantidadeDelta += d.quantidadeDelta;
    atual.quantidadeReservadaDelta += d.quantidadeReservadaDelta;
    if (!atual.nome && d.nome) atual.nome = d.nome;
    porId.set(d.id, atual);
  });
  return [...porId.values()].filter((d) => d.quantidadeDelta !== 0 || d.quantidadeReservadaDelta !== 0);
};

/**
 * Novo saldo de um produto com a conferencia de estoque e de reserva (mesma
 * regra da venda). null = produto nao existe mais (pula, como a tela sempre fez).
 */
export const novoSaldoDoProduto = (
  d: StockFieldDelta,
  produto: { quantidade?: unknown; quantidadeReservada?: unknown; nome?: unknown } | null | undefined,
  permitirSemEstoque: boolean,
): { erro: string } | { quantidade: number; quantidadeReservada: number } | null => {
  if (!produto) return null;
  const estoqueAtual = Number(produto.quantidade || 0);
  const reservadaAtual = Number(produto.quantidadeReservada || 0);
  const proximo = estoqueAtual + d.quantidadeDelta;
  const reservadaDepois = Math.max(0, reservadaAtual + d.quantidadeReservadaDelta);
  const nome = d.nome || String(produto.nome || '') || 'peça';
  if (d.quantidadeDelta < 0 && !permitirSemEstoque) {
    if (proximo < -1e-9) return { erro: `Estoque insuficiente para ${nome}. Disponível: ${estoqueAtual}.` };
    if (proximo < reservadaDepois - 1e-9) {
      return {
        erro: `Estoque reservado: ${nome} tem ${estoqueAtual} em estoque e ${reservadaDepois} reservado em pré-venda, condicional, OS ou troca. `
          + `Só ${Math.max(0, estoqueAtual - reservadaDepois)} está livre. Diminua a quantidade ou libere a reserva e finalize de novo.`,
      };
    }
  }
  return {
    quantidade: permitirSemEstoque || d.quantidadeDelta >= 0 ? proximo : Math.max(0, proximo),
    quantidadeReservada: reservadaDepois,
  };
};

/** Devolve as pecas que sairam (e solta reserva que tenha sobrado). */
const devolucaoDoEstoque = (os: OsGravada): StockFieldDelta[] => somarDeltasDeEstoque(
  computeReservationReturn(os.estoqueReservado === true ? linhasDeEstoque(os.pecas) : [], pecasQueSairamDoEstoque(os)),
);

// ---------------------------------------------------------------------------
// O QUE A TELA MANDA AO SERVIDOR (POST /api/os/...)
// ---------------------------------------------------------------------------

const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;
const DATA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;

const objeto = (corpo: unknown): Record<string, unknown> => (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;

const lerOsId = (c: Record<string, unknown>): string | null => {
  const id = String(c.osId ?? '');
  return ID_VALIDO.test(id) ? id : null;
};

export interface PedidoDeFinalizacaoDaOs {
  osId: string;
  dataSaida: string;
  pagamentos: Array<Record<string, unknown>>;
  /** Lotes escolhidos por linha de peca (chave = indice da peca na OS gravada). */
  lotes: Record<string, LoteUsado[]>;
}

/** POST /api/os/finalizar: { osId, dataSaida, pagamentos (rascunhos), lotes? }. */
export const lerPedidoDeFinalizacaoDaOs = (corpo: unknown): { erro: string } | { pedido: PedidoDeFinalizacaoDaOs } => {
  const c = objeto(corpo);
  const osId = lerOsId(c);
  if (!osId) return { erro: 'OS inválida. Atualize a tela e tente de novo.' };
  const dataSaida = String(c.dataSaida ?? '');
  if (!DATA_VALIDA.test(dataSaida)) return { erro: 'Informe a data de saída da OS.' };
  if (!Array.isArray(c.pagamentos) || c.pagamentos.length === 0) return { erro: 'Informe a forma de pagamento.' };
  if (c.pagamentos.length > 60) return { erro: 'Pagamentos demais nesta OS. Junte os pagamentos da mesma forma.' };
  const lotes: Record<string, LoteUsado[]> = {};
  const brutos = objeto(c.lotes);
  for (const [chave, valor] of Object.entries(brutos)) {
    if (!/^\d{1,3}$/.test(chave)) return { erro: 'Lote inválido. Escolha o lote de novo.' };
    const lidos = lerLotes(valor);
    if (lidos === null) return { erro: 'Lote inválido. Escolha o lote de novo.' };
    if (lidos.length > 0) lotes[chave] = lidos;
  }
  return {
    pedido: {
      osId,
      dataSaida,
      pagamentos: c.pagamentos.map((p) => (p && typeof p === 'object' ? p as Record<string, unknown> : {})),
      lotes,
    },
  };
};

/** POST /api/os/cancelar: { osId, motivo, devolverEstoque }. */
export const lerPedidoDeCancelamentoDaOs = (corpo: unknown): { erro: string } | { osId: string; motivo: string; devolverEstoque: boolean } => {
  const c = objeto(corpo);
  const osId = lerOsId(c);
  if (!osId) return { erro: 'OS inválida. Atualize a tela e tente de novo.' };
  const erro = erroDoMotivoDoCancelamento(c.motivo);
  if (erro) return { erro };
  return { osId, motivo: String(c.motivo).trim(), devolverEstoque: c.devolverEstoque === true };
};

/** POST /api/os/reabrir: { osId, status } -- status = uma das situacoes em aberto. */
export const lerPedidoDeReaberturaDaOs = (corpo: unknown): { erro: string } | { osId: string; status: string } => {
  const c = objeto(corpo);
  const osId = lerOsId(c);
  if (!osId) return { erro: 'OS inválida. Atualize a tela e tente de novo.' };
  const status = String(c.status ?? STATUS_OS_REABERTA_PADRAO);
  if (!STATUS_OS_EM_ABERTO.includes(status)) return { erro: 'Escolha a situação em que a OS vai ficar ao ser reaberta.' };
  return { osId, status };
};

// ---------------------------------------------------------------------------
// LANCAMENTOS DA OS
// ---------------------------------------------------------------------------

export interface DadosDoTituloDaOs {
  osId: string;
  numeroOS: string;
  dataSaida: string;
  clienteId: string | null;
  clienteNome: string;
  mecanicoId: string;
  usuarioId: string;
  tenantId: string;
}

/** Mesmo lancamento que a tela sempre gravou para cada pagamento da OS (sem metadados). */
export const camposDoTituloDaOs = (p: PaymentRecord, args: DadosDoTituloDaOs): Record<string, unknown> => {
  const parcela = p.cartao?.numero ? ` (Parcela ${p.cartao.numero}/${p.cartao.totalParcelas})` : '';
  return {
    descricao: `Recebimento OS #${args.numeroOS || args.osId.substring(0, 6).toUpperCase()} - ${p.formaPagamento}${parcela}`,
    categoria: 'Serviços',
    valor: p.valor,
    valorCentavos: p.valorCentavos,
    valorBruto: p.valor,
    valorBrutoCentavos: p.valorCentavos,
    valorTaxa: p.cartao?.valorTaxa || 0,
    valorTaxaCentavos: p.cartao?.valorTaxaCentavos || 0,
    valorLiquido: p.cartao?.valorLiquido ?? p.valor,
    valorLiquidoCentavos: p.cartao?.valorLiquidoCentavos ?? p.valorCentavos,
    tipo: 'entrada',
    formaPagamento: p.formaPagamento,
    condicaoPagamento: p.condicaoPagamento,
    status: p.status === 'confirmado' ? 'Paga' : 'Pendente',
    naturezaFinanceira: p.naturezaFinanceira,
    movimentaCaixaFisico: p.movimentaCaixaFisico,
    bancoId: p.bancoId || null,
    bancoNome: p.bancoNome || null,
    prazoDias: p.prazoDias || null,
    data: p.dataVencimento || args.dataSaida,
    dataVencimento: p.dataVencimento || null,
    dataPrevistaRecebimento: p.dataPrevistaRecebimento || null,
    cartao: p.cartao || null,
    ...(p.cheque ? { cheque: p.cheque } : {}),
    osId: args.osId,
    sourceType: 'ordem_servico',
    sourceId: args.osId,
    paymentIndex: p.indice,
    idempotencyKey: `os:${args.osId}:pagamento:${p.indice}`,
    clienteId: args.clienteId,
    clienteNome: args.clienteNome,
    usuarioResponsavelId: args.usuarioId,
    mecanicoId: args.mecanicoId,
    tenantId: args.tenantId,
  };
};

/** Ids dos lancamentos: o 1o pagamento tem o id da OS, os seguintes `<os>_pag_<n>`. */
export const idDoTituloDaOs = (osId: string, indice: number): string => (indice === 0 ? osId : `${osId}_pag_${indice + 1}`);

/** Ids que os pagamentos gravados na OS ja' usaram (para achar os lancamentos antigos). */
export const idsDosTitulosGravados = (osId: string, pagamentos: unknown): string[] => {
  const lista = Array.isArray(pagamentos) ? pagamentos as Array<{ transactionId?: string }> : [];
  if (lista.length === 0) return [osId];
  return lista.map((p, indice) => (p && typeof p.transactionId === 'string' && p.transactionId ? p.transactionId : idDoTituloDaOs(osId, indice)));
};

/** Cancelar a OS: pago vira estorno (lancamento de saida); em aberto e' so' cancelado. */
export const estornoDosTitulosDaOs = (
  titulos: TituloDaVenda[],
  args: { osId: string; numeroOS: string; clienteNome: string; usuarioId: string; tenantId: string; hoje: string },
): EscritasDoEstorno => estornoDosTitulos(titulos, {
  documentoId: args.osId,
  numero: args.numeroOS,
  clienteNome: args.clienteNome,
  usuarioId: args.usuarioId,
  tenantId: args.tenantId,
  hoje: args.hoje,
}, 'os');

// ---------------------------------------------------------------------------
// FINALIZAR
// ---------------------------------------------------------------------------

export interface PerfilDoMecanico {
  nome?: string;
  recebeComissaoServicos?: boolean;
  comissaoPercentualServicos?: number;
  recebeComissaoPecas?: boolean;
  comissaoPercentualPecas?: number;
}

export interface EntradaDaFinalizacao {
  osId: string;
  tenantId: string;
  usuarioId: string;
  /** OS como esta' gravada (servicos, pecas, desconto, cliente, tecnico...). */
  os: OsGravada & {
    servicos?: unknown;
    desconto?: DescontoDaOs | null;
    clienteId?: unknown;
    clienteNome?: unknown;
    mecanicoId?: unknown;
    mecanicoNome?: unknown;
  };
  dataSaida: string;
  /** Pagamentos ja' normalizados e explodidos (normalizePayments + explodeInstallmentPaymentRecords). */
  pagamentos: PaymentRecord[];
  /** Lotes por linha de peca (chave = indice da peca), ja' conferidos por quem grava. */
  lotesPorLinha: Record<string, LoteUsado[]>;
  mecanico: PerfilDoMecanico | null;
  percentualDoServico: (id: string) => number | undefined;
  percentualDaPeca: (id: string) => number | undefined;
  comissaoPadraoServicos?: number;
  comissaoPadraoPecas?: number;
  agoraIso: string;
}

export interface PlanoDaFinalizacao {
  totais: TotaisDaOs;
  pagamentos: Array<PaymentRecord & { transactionId: string }>;
  /** Credito em cada banco (centavos), pelos pagamentos confirmados. */
  creditoPorBanco: Map<string, number>;
  /** Movimento de estoque (ja' somado por produto). Vazio se a OS ja' tinha baixado. */
  estoque: StockFieldDelta[];
  /** Saida de cada lote (ja' somada por lote). */
  lotes: LoteUsado[];
  comissao: CommissionSnapshot | ReturnType<typeof buildServiceOrderCommissionSnapshot>;
  /** Campos da OS (sem metadados nem data do servidor). */
  camposDaOs: Record<string, unknown>;
  /** Lancamentos a gravar (set completo). */
  titulos: Array<{ id: string; campos: Record<string, unknown> }>;
  formaPagamento: string;
}

/**
 * Plano da finalizacao: a OS gravada vira receita. Comissao SEMPRE refeita
 * (decisao do dono: reabriu, finaliza de novo com o que estiver na OS).
 */
export const planoDaFinalizacaoDaOs = (e: EntradaDaFinalizacao): { erro: string } | { plano: PlanoDaFinalizacao } => {
  const numeroOS = String(e.os.numeroOS || '');
  if (e.os.status === STATUS_OS_FINALIZADA) return { erro: `A OS #${numeroOS} já está finalizada. Atualize a tela.` };
  if (e.os.status === STATUS_OS_CANCELADA) return { erro: mensagemOsCanceladaNaoReabre(numeroOS) };
  if (e.pagamentos.some((p) => p.formaPagamento === 'Crédito de Devolução')) {
    return { erro: 'Crédito de devolução não pode ser usado em OS. Escolha outra forma de pagamento.' };
  }

  const totais = totaisDaOs(e.os);
  const somaPagamentos = e.pagamentos.reduce((soma, p) => soma + p.valorCentavos, 0);
  if (somaPagamentos !== totais.valorTotalCentavos) {
    const reais = (centavos: number) => `R$ ${fromCents(centavos).toFixed(2).replace('.', ',')}`;
    return { erro: `Os pagamentos somam ${reais(somaPagamentos)}, mas a OS é de ${reais(totais.valorTotalCentavos)}. Atualize a tela e confira o pagamento.` };
  }

  const pagamentos = e.pagamentos.map((p, indice) => ({ ...p, transactionId: idDoTituloDaOs(e.osId, indice) }));
  const resumo = summarizePayments(pagamentos);

  // Estoque: so' quem ainda nao baixou (OS reaberta antes de 19/10/2026 pode ter ficado baixada).
  const pecas = linhasDeEstoque(e.os.pecas);
  const jaBaixado = e.os.estoqueBaixado === true;
  const estoque = jaBaixado ? [] : somarDeltasDeEstoque(computeReservationCommit(e.os.estoqueReservado === true ? pecas : [], pecas));
  const lotes = jaBaixado ? [] : somarLotesUsados(Object.values(e.lotesPorLinha));

  const servicos = listaDe<LinhaServicoDaOs>(e.os.servicos);
  const pecasDaOs = listaDe<LinhaPecaDaOs>(e.os.pecas);
  const mecanicoId = String(e.os.mecanicoId || '');
  const perfil = e.mecanico || {};
  const comissao = buildServiceOrderCommissionSnapshot({
    sellerId: mecanicoId,
    sellerName: String(e.os.mecanicoNome || perfil.nome || 'Não identificado'),
    itensServicos: servicos.map((s) => ({
      id: String(s.id || ''),
      nome: String(s.nome || ''),
      baseCents: toCents(getServiceTotal(s)),
      percentual: resolveComissaoPercentual({
        itemPercentual: e.percentualDoServico(String(s.id || '')),
        recebeComissao: perfil.recebeComissaoServicos,
        percentualVendedor: perfil.comissaoPercentualServicos,
        percentualPadraoSistema: e.comissaoPadraoServicos,
      }),
    })),
    itensPecas: pecasDaOs.map((p) => ({
      id: String(p.id || ''),
      nome: String(p.nome || ''),
      baseCents: toCents(Number(p.preco || 0) * Number(p.quantidade || 0)),
      percentual: resolveComissaoPercentual({
        itemPercentual: e.percentualDaPeca(String(p.id || '')),
        recebeComissao: perfil.recebeComissaoPecas,
        percentualVendedor: perfil.comissaoPercentualPecas,
        percentualPadraoSistema: e.comissaoPadraoPecas,
      }),
    })),
    generatedAt: e.agoraIso,
  });

  const statusPagamento = resumo.pendingCents === 0 ? 'Paga' : resumo.receivedCents > 0 ? 'Parcial' : 'Pendente';
  const clienteNome = String(e.os.clienteNome || '').trim().toUpperCase();
  const clienteId = e.os.clienteId ? String(e.os.clienteId) : null;
  const camposDaOs: Record<string, unknown> = {
    status: STATUS_OS_FINALIZADA,
    statusColor: corDoStatusDaOs(STATUS_OS_FINALIZADA),
    valorTotal: totais.valorTotal,
    valorTotalCentavos: totais.valorTotalCentavos,
    formaPagamento: resumo.paymentMethodLabel,
    statusPagamento,
    dataSaida: e.dataSaida,
    dataPagamento: e.dataSaida,
    condicaoPagamento: resumo.paymentCondition,
    pagamentos,
    totalRecebido: resumo.received,
    totalRecebidoCentavos: resumo.receivedCents,
    totalPendente: resumo.pending,
    totalPendenteCentavos: resumo.pendingCents,
    totalTaxasPagamento: resumo.cardFee,
    totalTaxasPagamentoCentavos: resumo.cardFeeCents,
    totalLiquidoFinanceiro: resumo.financialNet,
    totalLiquidoFinanceiroCentavos: resumo.financialNetCents,
    estoqueBaixado: true,
    estoqueReservado: false,
    ...(jaBaixado ? {} : { lotesBaixados: lotes, pecasBaixadas: pecas }),
    comissao,
  };

  const dadosDoTitulo: DadosDoTituloDaOs = {
    osId: e.osId,
    numeroOS,
    dataSaida: e.dataSaida,
    clienteId,
    clienteNome,
    mecanicoId,
    usuarioId: e.usuarioId,
    tenantId: e.tenantId,
  };
  return {
    plano: {
      totais,
      pagamentos,
      creditoPorBanco: computeBankCreditsMap(pagamentos),
      estoque,
      lotes,
      comissao,
      camposDaOs,
      titulos: pagamentos.map((p) => ({ id: p.transactionId, campos: camposDoTituloDaOs(p, dadosDoTitulo) })),
      formaPagamento: resumo.paymentMethodLabel,
    },
  };
};

/** Lancamentos antigos da OS que nao fazem mais parte dos pagamentos (viram Cancelada). */
export const titulosQueSaemNaFinalizacao = (existentes: TituloDaVenda[], idsNovos: string[]): string[] => (
  existentes.filter((t) => !idsNovos.includes(t.id) && t.dados.status !== 'Cancelada').map((t) => t.id)
);

// ---------------------------------------------------------------------------
// REABRIR
// ---------------------------------------------------------------------------

export interface PlanoDaReabertura {
  /** Debito em cada banco (centavos): o que a finalizacao creditou. */
  debitoPorBanco: Map<string, number>;
  estoque: StockFieldDelta[];
  /** O que volta para cada lote. */
  lotes: LoteUsado[];
  /** Lancamentos que viram Cancelada. */
  titulosCancelados: string[];
  camposDaOs: Record<string, unknown>;
}

/** Desfaz a finalizacao inteira; finalizar de novo refaz com o que estiver na OS. */
export const planoDaReaberturaDaOs = (args: {
  os: OsGravada;
  titulos: TituloDaVenda[];
  status: string;
  agoraIso: string;
}): { erro: string } | { plano: PlanoDaReabertura } => {
  const numeroOS = String(args.os.numeroOS || '');
  if (args.os.status === STATUS_OS_CANCELADA) return { erro: mensagemOsCanceladaNaoReabre(numeroOS) };
  if (args.os.status !== STATUS_OS_FINALIZADA) return { erro: `A OS #${numeroOS} não está finalizada. Atualize a tela.` };
  const bloqueio = bloqueioParaReabrirOs(args.titulos.map((t) => t.dados));
  if (bloqueio) return { erro: bloqueio };

  const baixado = args.os.estoqueBaixado === true;
  const comissao = args.os.comissao as CommissionSnapshot | null | undefined;
  return {
    plano: {
      debitoPorBanco: computeBankCreditsMap(listaDe<PaymentRecord>(args.os.pagamentos)),
      estoque: baixado ? devolucaoDoEstoque(args.os) : [],
      lotes: baixado ? lotesDaOs(args.os) : [],
      titulosCancelados: args.titulos.filter((t) => t.dados.status !== 'Cancelada').map((t) => t.id),
      camposDaOs: {
        status: args.status,
        statusColor: corDoStatusDaOs(args.status),
        statusPagamento: 'Pendente',
        estoqueBaixado: false,
        estoqueReservado: false,
        lotesBaixados: [],
        pecasBaixadas: [],
        ...(comissao && comissao.regraVersion ? { comissao: reopenCommissionSnapshot(comissao, args.agoraIso) } : {}),
      },
    },
  };
};

// ---------------------------------------------------------------------------
// CANCELAR
// ---------------------------------------------------------------------------

export interface PlanoDoCancelamento {
  debitoPorBanco: Map<string, number>;
  estoque: StockFieldDelta[];
  lotes: LoteUsado[];
  titulos: EscritasDoEstorno;
  camposDaOs: Record<string, unknown>;
  devolveuEstoque: boolean;
}

export const planoDoCancelamentoDaOs = (args: {
  osId: string;
  os: OsGravada & { clienteNome?: unknown };
  titulos: TituloDaVenda[];
  motivo: string;
  devolverEstoque: boolean;
  usuarioId: string;
  usuarioNome: string;
  tenantId: string;
  hoje: string;
  agoraIso: string;
}): { erro: string } | { plano: PlanoDoCancelamento } => {
  const numeroOS = String(args.os.numeroOS || '');
  if (args.os.status === STATUS_OS_CANCELADA) return { erro: `A OS #${numeroOS} já foi cancelada.` };
  const bloqueio = bloqueioPorParcelaRenegociada(args.titulos.map((t) => t.dados), 'cancelar a OS');
  if (bloqueio) return { erro: bloqueio };

  const eraFinalizada = args.os.status === STATUS_OS_FINALIZADA;
  const baixado = args.os.estoqueBaixado === true;
  const devolve = baixado && args.devolverEstoque;
  let estoque: StockFieldDelta[] = [];
  if (devolve) estoque = devolucaoDoEstoque(args.os);
  else if (args.os.estoqueReservado === true) estoque = somarDeltasDeEstoque(computeReservationRelease(linhasDeEstoque(args.os.pecas)));

  const comissao = args.os.comissao as CommissionSnapshot | null | undefined;
  return {
    plano: {
      debitoPorBanco: eraFinalizada ? computeBankCreditsMap(listaDe<PaymentRecord>(args.os.pagamentos)) : new Map(),
      estoque,
      lotes: devolve ? lotesDaOs(args.os) : [],
      titulos: estornoDosTitulosDaOs(args.titulos, {
        osId: args.osId,
        numeroOS,
        clienteNome: String(args.os.clienteNome || '').trim().toUpperCase(),
        usuarioId: args.usuarioId,
        tenantId: args.tenantId,
        hoje: args.hoje,
      }),
      camposDaOs: {
        status: STATUS_OS_CANCELADA,
        statusColor: corDoStatusDaOs(STATUS_OS_CANCELADA),
        statusPagamento: 'Cancelada',
        motivoCancelamento: args.motivo,
        canceladaPor: args.usuarioId,
        canceladaPorNome: args.usuarioNome,
        estoqueReservado: false,
        ...(devolve ? { estoqueBaixado: false, lotesBaixados: [], pecasBaixadas: [] } : {}),
        ...(comissao && comissao.regraVersion ? { comissao: cancelCommissionSnapshot(comissao, args.agoraIso) } : {}),
      },
      devolveuEstoque: devolve,
    },
  };
};
