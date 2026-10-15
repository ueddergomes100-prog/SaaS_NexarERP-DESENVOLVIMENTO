/*
 * RENEGOCIACAO DE PARCELAS A RECEBER (pedido do dono, 15/10/2026).
 *
 * Caso real: o cliente deve 3 parcelas de R$ 1.000 e, para quitar, fecha um
 * acordo de R$ 2.600 -- em um documento so' ou em algumas parcelas novas.
 *
 * Decisoes do dono (caixa de perguntas, 15/10/2026):
 *  - o documento novo pode ter 1 ou mais parcelas (total, vencimentos e forma
 *    escolhidos na hora);
 *  - as vendas/OS de onde vieram as parcelas antigas SO' ficam quitadas quando
 *    a renegociacao for paga (a ultima parcela nova recebida quita todas);
 *  - "Desfazer renegociacao" volta as parcelas antigas para em aberto e devolve
 *    o que as parcelas novas ja' tinham posto no caixa/banco;
 *  - permissao propria: "Financeiro: Renegociar Documentos".
 *
 * Como fica gravado (tudo pelo servidor):
 *  - parcelas antigas: status "Renegociada" (nem em aberto nem recebida -- nao
 *    entram em total nenhum), `renegociacaoId`;
 *  - parcelas novas: titulos de entrada comuns (sem venda/OS), com o mapa
 *    `renegociacao` (ids das antigas e das novas, motivo, quem, totais).
 * Nao existe colecao nova: tudo mora em `transacoes` (sem rules novas).
 */
import {
  applyPaymentReceipt,
  isCardPayment,
  pagamentoDoTitulo,
  reversePaymentReceipt,
  toCents,
  type PaymentMethod,
  type PaymentRecord,
} from './financeDomain';

export const PERMISSAO_RENEGOCIAR = 'financeiro.renegociar';
export const STATUS_RENEGOCIADA = 'Renegociada';
export const LIMITE_TITULOS_RENEGOCIACAO = 50;
export const LIMITE_PARCELAS_RENEGOCIACAO = 48;
export const MOTIVO_RENEGOCIACAO_MINIMO = 5;
export const MOTIVO_RENEGOCIACAO_MAXIMO = 255;

/** Formas que a parcela nova pode ter (todas ficam em aberto ate' a baixa). */
export const FORMAS_RENEGOCIACAO: PaymentMethod[] = ['Boleto', 'Pagamento a Prazo', 'Pix', 'Transferência', 'Dinheiro'];

/** Parcela antiga, como fica guardada nas parcelas novas (para desfazer e quitar a venda). */
export interface TituloOrigemDaRenegociacao {
  id: string;
  descricao: string;
  valorCentavos: number;
  pedidoId?: string;
  osId?: string;
  paymentIndex?: number;
}

/** Mapa `renegociacao` gravado em cada parcela NOVA. */
export interface RegistroRenegociacao {
  id: string;
  parcela: number;
  totalParcelas: number;
  titulosOrigem: TituloOrigemDaRenegociacao[];
  titulosNovos: string[];
  totalOrigemCentavos: number;
  totalNovoCentavos: number;
  motivo: string;
  porUid: string;
  porEmail?: string;
}

export interface TituloParaRenegociar {
  id?: string;
  tipo?: string;
  status?: string;
  descricao?: string;
  valor?: number;
  valorCentavos?: number;
  formaPagamento?: string;
  cartao?: unknown;
  cheque?: unknown;
  boleto?: { status?: string; nossoNumero?: string; numeroRemessa?: number } | null;
  clienteId?: string | null;
  clienteNome?: string | null;
  pedidoId?: string | null;
  osId?: string | null;
  paymentIndex?: number;
  renegociacao?: Partial<RegistroRenegociacao> | null;
  acrescimoDaTransacaoId?: string | null;
}

export interface ParcelaNova {
  valorCentavos: number;
  /** AAAA-MM-DD */
  vencimento: string;
}

const reais = (centavos: number) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

export const centavosDoTituloRenegociado = (titulo: TituloParaRenegociar): number => (
  Number(titulo.valorCentavos ?? toCents(titulo.valor))
);

/** E' uma parcela NOVA de renegociacao? */
export const ehParcelaDeRenegociacao = (titulo: TituloParaRenegociar | null | undefined): boolean => (
  Boolean(titulo?.renegociacao && titulo.renegociacao.id)
);

/** Por que esta parcela NAO entra numa renegociacao agora ('' = entra). A frase completa
 *  a partir de "A parcela X ..." (ver validarTitulosParaRenegociar). */
export const bloqueioParaRenegociar = (titulo: TituloParaRenegociar): string => {
  if (titulo.tipo && titulo.tipo !== 'entrada') return 'não é do Contas a Receber.';
  if (titulo.acrescimoDaTransacaoId) return 'é de juros e multa e não entra em renegociação.';
  if (titulo.status === 'Paga') return 'já foi recebida.';
  if (titulo.status === 'Cancelada') return 'está cancelada.';
  if (titulo.status === STATUS_RENEGOCIADA) return 'já foi renegociada.';
  if (titulo.status !== 'Pendente') return 'não está em aberto. Atualize a tela e tente de novo.';
  if (ehParcelaDeRenegociacao(titulo)) {
    return 'já é parcela de uma renegociação. Para renegociar de novo, desfaça a renegociação anterior (botão "Desfazer renegociação").';
  }
  if (isCardPayment(String(titulo.formaPagamento || '')) || titulo.cartao) return 'é de cartão (quem paga é a operadora).';
  if (titulo.formaPagamento === 'Cheque' || titulo.cheque) return 'já tem cheque registrado.';
  if (titulo.boleto) {
    const { status, numeroRemessa } = titulo.boleto;
    if (status === 'pago') return 'tem boleto pago.';
    if (status === 'em_remessa' || numeroRemessa) {
      return 'tem boleto já enviado ao banco. Peça a baixa do boleto ao banco e desfaça a emissão em Financeiro › Boletos antes.';
    }
    return 'tem boleto emitido. Desfaça a emissão em Financeiro › Boletos antes de renegociar.';
  }
  if (!(centavosDoTituloRenegociado(titulo) > 0)) return 'está sem valor.';
  return '';
};

/**
 * Cancelar a venda/OS ou refazer as parcelas dela com parcela RENEGOCIADA
 * criaria a divida de novo (ou deixaria a renegociacao cobrando algo cancelado).
 * '' = pode seguir. `acao` completa a frase: "cancelar a venda", "refazer as parcelas".
 */
export const bloqueioPorParcelaRenegociada = (
  titulos: Array<{ status?: string; descricao?: string }>,
  acao: string,
): string => {
  const renegociada = titulos.find((t) => t.status === STATUS_RENEGOCIADA);
  if (!renegociada) return '';
  const nome = renegociada.descricao ? ` "${renegociada.descricao}"` : '';
  return `A parcela${nome} foi renegociada no Contas a Receber. Para ${acao}, desfaça a renegociação antes (Contas a Receber › parcela da renegociação › Desfazer renegociação).`;
};

/** Cliente da parcela, para conferir que a renegociacao e' de um cliente so'. */
export const chaveDoClienteDoTitulo = (titulo: TituloParaRenegociar): string => {
  if (titulo.clienteId) return `id:${titulo.clienteId}`;
  const nome = String(titulo.clienteNome || '').trim().toUpperCase().replace(/\s+/g, ' ');
  return nome ? `nome:${nome}` : '';
};

/** Confere as parcelas escolhidas ('' = podem ser renegociadas juntas). */
export const validarTitulosParaRenegociar = (titulos: TituloParaRenegociar[]): string => {
  if (titulos.length === 0) return 'Selecione as parcelas em aberto que vão ser renegociadas.';
  if (titulos.length > LIMITE_TITULOS_RENEGOCIACAO) {
    return `Renegocie no máximo ${LIMITE_TITULOS_RENEGOCIACAO} parcelas de uma vez.`;
  }
  const ids = new Set<string>();
  for (const titulo of titulos) {
    if (titulo.id) {
      if (ids.has(titulo.id)) return 'A mesma parcela apareceu duas vezes. Atualize a tela e selecione de novo.';
      ids.add(titulo.id);
    }
    const bloqueio = bloqueioParaRenegociar(titulo);
    if (bloqueio) return `A parcela "${titulo.descricao || 'sem descrição'}" ${bloqueio}`;
  }
  const clientes = new Set(titulos.map(chaveDoClienteDoTitulo));
  if (clientes.has('')) return 'Há parcela sem cliente identificado. Renegociação é sempre de um cliente só.';
  if (clientes.size > 1) return 'Renegociação é de um cliente só. Selecione apenas parcelas do mesmo cliente.';
  return '';
};

/** Soma 'dias' a uma data AAAA-MM-DD (sem fuso). */
export const somarDias = (data: string, dias: number): string => {
  const [a, m, d] = data.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d + dias));
  return dt.toISOString().slice(0, 10);
};

/**
 * Divide o total em parcelas iguais (os centavos que sobram vao na ultima),
 * a primeira no vencimento escolhido e as outras a cada `intervaloDias`.
 */
export const dividirEmParcelas = (a: {
  totalCentavos: number;
  quantidade: number;
  primeiroVencimento: string;
  intervaloDias: number;
}): ParcelaNova[] => {
  const quantidade = Math.max(1, Math.min(LIMITE_PARCELAS_RENEGOCIACAO, Math.floor(a.quantidade) || 1));
  const total = Math.max(0, Math.round(a.totalCentavos));
  const base = Math.floor(total / quantidade);
  const intervalo = Math.max(1, Math.floor(a.intervaloDias) || 30);
  return Array.from({ length: quantidade }, (_, i) => ({
    valorCentavos: i === quantidade - 1 ? total - base * (quantidade - 1) : base,
    vencimento: DATA_ISO.test(a.primeiroVencimento) ? somarDias(a.primeiroVencimento, i * intervalo) : '',
  }));
};

const dataExiste = (data: string) => DATA_ISO.test(data) && somarDias(data, 0) === data;

/** Confere as parcelas novas ('' = validas). */
export const validarParcelasNovas = (parcelas: ParcelaNova[], totalOrigemCentavos: number, hoje: string): string => {
  if (!Array.isArray(parcelas) || parcelas.length === 0) return 'Informe ao menos uma parcela nova.';
  if (parcelas.length > LIMITE_PARCELAS_RENEGOCIACAO) return `A renegociação pode ter no máximo ${LIMITE_PARCELAS_RENEGOCIACAO} parcelas.`;
  let total = 0;
  for (let i = 0; i < parcelas.length; i += 1) {
    const { valorCentavos, vencimento } = parcelas[i] || ({} as ParcelaNova);
    const rotulo = parcelas.length === 1 ? 'Documento novo' : `Parcela ${i + 1}`;
    if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) return `${rotulo}: informe um valor maior que zero.`;
    if (!dataExiste(String(vencimento || ''))) return `${rotulo}: informe o vencimento.`;
    if (vencimento < hoje) return `${rotulo}: o vencimento não pode ser antes de hoje.`;
    total += valorCentavos;
  }
  // Muito acima do que era devido e' quase sempre erro de digitacao.
  if (total > totalOrigemCentavos * 3 + 100000) {
    return `O total renegociado (${reais(total)}) está muito acima do que era devido (${reais(totalOrigemCentavos)}). Confira os valores digitados.`;
  }
  return '';
};

/** `para`: renegociar (padrao) ou desfazer a renegociacao -- muda so' o texto. */
export const validarMotivoRenegociacao = (motivo: unknown, para: 'renegociar' | 'desfazer' = 'renegociar'): string => {
  const texto = String(motivo ?? '').trim();
  if (texto.length < MOTIVO_RENEGOCIACAO_MINIMO) {
    return para === 'desfazer'
      ? `Escreva por que a renegociação está sendo desfeita (mínimo ${MOTIVO_RENEGOCIACAO_MINIMO} letras). Ex.: "cliente não cumpriu o acordo".`
      : `Escreva o motivo da renegociação (mínimo ${MOTIVO_RENEGOCIACAO_MINIMO} letras). Ex.: "acordo para quitar as 3 parcelas".`;
  }
  if (texto.length > MOTIVO_RENEGOCIACAO_MAXIMO) return `O motivo pode ter no máximo ${MOTIVO_RENEGOCIACAO_MAXIMO} letras. Resuma o texto.`;
  return '';
};

export const validarFormaRenegociacao = (forma: unknown): string => (
  FORMAS_RENEGOCIACAO.includes(String(forma) as PaymentMethod)
    ? ''
    : 'Escolha como as parcelas novas vão ser cobradas (boleto, a prazo, Pix, transferência ou dinheiro).'
);

/** "Renegociação — parcela 1/2" (ou "Renegociação" quando e' um documento so'). */
export const descricaoDaParcelaNova = (parcela: number, totalParcelas: number): string => (
  totalParcelas > 1 ? `Renegociação — parcela ${parcela}/${totalParcelas}` : 'Renegociação — documento único'
);

/** Parcela antiga como fica guardada nas novas (sem chave undefined). */
export const origemDoTitulo = (id: string, titulo: TituloParaRenegociar): TituloOrigemDaRenegociacao => ({
  id,
  descricao: String(titulo.descricao || ''),
  valorCentavos: centavosDoTituloRenegociado(titulo),
  ...(titulo.pedidoId ? { pedidoId: String(titulo.pedidoId) } : {}),
  ...(!titulo.pedidoId && titulo.osId ? { osId: String(titulo.osId) } : {}),
  ...(Number.isInteger(titulo.paymentIndex) ? { paymentIndex: Number(titulo.paymentIndex) } : {}),
});

/**
 * A renegociacao fica quitada com este recebimento? So' quando TODAS as
 * outras parcelas novas ja' estao recebidas.
 */
export const renegociacaoQuitadaComEsteRecebimento = (outras: Array<{ status?: string }>): boolean => (
  outras.every((t) => t.status === 'Paga')
);

/**
 * Quita na venda/OS os pagamentos das parcelas antigas dela (renegociacao paga).
 * Cada pagamento sai confirmado por INTEIRO -- o que foi recebido de verdade
 * esta' nas parcelas novas; a diferenca e' desconto/acrescimo do acordo.
 */
export const quitarPagamentosRenegociados = (
  pagamentos: PaymentRecord[],
  titulos: TituloOrigemDaRenegociacao[],
  recebidoEm: string,
): PaymentRecord[] => titulos.reduce((atual, titulo) => {
  const alvo = pagamentoDoTitulo(atual, { transactionId: titulo.id, paymentIndex: titulo.paymentIndex });
  if (!alvo || alvo.status === 'confirmado' || !(alvo.valorCentavos > 0)) return atual;
  return applyPaymentReceipt(atual, {
    transactionId: titulo.id,
    paymentIndex: titulo.paymentIndex,
    amountCents: alvo.valorCentavos,
    method: 'Outros',
    receiptId: titulo.id,
    receivedAt: recebidoEm,
  });
}, pagamentos);

/** Desfaz quitarPagamentosRenegociados (estorno de parcela nova ou desfazer a renegociacao). */
export const reabrirPagamentosRenegociados = (
  pagamentos: PaymentRecord[],
  titulos: TituloOrigemDaRenegociacao[],
): PaymentRecord[] => titulos.reduce((atual, titulo) => {
  const confirmado = atual.some((p) => p.status === 'confirmado' && (
    p.transactionId === titulo.id || (p.transactionId === undefined && titulo.paymentIndex !== undefined && p.indice === titulo.paymentIndex)
  ));
  if (!confirmado) return atual;
  return reversePaymentReceipt(atual, { transactionId: titulo.id, paymentIndex: titulo.paymentIndex });
}, pagamentos);

/** Parcelas antigas agrupadas pela venda/OS de origem (as sem origem ficam de fora). */
export const origensDaRenegociacao = (titulos: TituloOrigemDaRenegociacao[]) => {
  const mapa = new Map<string, { colecao: 'pedidos_venda' | 'ordens_de_servico'; id: string; titulos: TituloOrigemDaRenegociacao[] }>();
  titulos.forEach((t) => {
    const colecao = t.pedidoId ? 'pedidos_venda' : t.osId ? 'ordens_de_servico' : null;
    const id = t.pedidoId || t.osId;
    if (!colecao || !id) return;
    const chave = `${colecao}/${id}`;
    const atual = mapa.get(chave) ?? { colecao, id, titulos: [] };
    atual.titulos.push(t);
    mapa.set(chave, atual);
  });
  return Array.from(mapa.values());
};
