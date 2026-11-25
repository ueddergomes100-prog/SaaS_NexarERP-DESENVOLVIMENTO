/*
 * DEVOLUCAO DE VENDA -- regra num lugar so' (24/11/2026).
 *
 * A devolucao e' feita por dois caminhos que tem de dar o MESMO resultado:
 *  - pela tela do sistema (DevolucaoVendaModal e "Confirmar" na tela de
 *    Devolucoes), gravando pelo navegador: services/devolucaoVendaService.ts;
 *  - pelo app Vendas com "Devolucao do aplicativo ja' entra confirmada",
 *    gravando pelo servidor: server/services/devolucaoVenda.js.
 *
 * O que a devolucao faz (itens devolvidos, quantidade ja' devolvida no pedido,
 * estoque, lote, comissao, lancamento de caixa/banco, credito do cliente)
 * e' montado AQUI; os dois lados so' leem e gravam. Compilado para o servidor
 * por scripts/build-server-domain.mjs.
 *
 * Situacao (campo `status` da devolucao, o mesmo de sempre):
 *  - 'aguardando_confirmacao': pedida pelo app, nada mexeu ainda;
 *  - 'concluida': valeu (estoque, dinheiro, comissao);
 *  - 'recusada': o escritorio recusou, nada mexeu;
 *  - 'estornada': valeu e foi desfeita depois (tela do pedido).
 * Devolucao antiga sem o campo conta como concluida.
 */
import { recalculateCommissionAfterReturn, toCents } from './financeDomain';
import { toBaseQuantity, toStockAdjustmentItems } from './embalagemDomain';
import { distribuirRetornoAosLotes, somarLotesUsados, type LoteUsado } from './loteRetornoDomain';
import { campoDoClienteDoCredito } from './creditoDomain';
import { ehPedidoDoSistemaAnterior, mensagemPedidoDoSistemaAnterior } from './importacaoPedidosAnterioresDomain';

export const STATUS_DEVOLUCAO = {
  aguardando: 'aguardando_confirmacao',
  concluida: 'concluida',
  recusada: 'recusada',
  estornada: 'estornada',
} as const;
export type StatusDevolucao = typeof STATUS_DEVOLUCAO[keyof typeof STATUS_DEVOLUCAO];

export const ROTULO_SITUACAO_DEVOLUCAO: Record<StatusDevolucao, string> = {
  aguardando_confirmacao: 'Aguardando confirmação',
  concluida: 'Confirmada',
  recusada: 'Recusada',
  estornada: 'Estornada',
};

export const ORIGEM_DEVOLUCAO = { sistema: 'sistema', app: 'app' } as const;
export type OrigemDevolucao = typeof ORIGEM_DEVOLUCAO[keyof typeof ORIGEM_DEVOLUCAO];
export const ROTULO_ORIGEM_DEVOLUCAO: Record<OrigemDevolucao, string> = { sistema: 'Sistema', app: 'Aplicativo' };

/** Lista fixa de motivos (a mesma do sistema desde sempre). */
export const MOTIVOS_DEVOLUCAO = ['Cliente desistiu', 'Produto com defeito', 'Produto errado', 'Troca', 'Erro de Venda', 'Outro'] as const;

/** Formas de devolucao que saem de conta bancaria (nao do caixa fisico). */
export const FORMAS_BANCARIAS_DEVOLUCAO = ['Pix', 'Transferência'] as const;
export type FormaBancariaDevolucao = typeof FORMAS_BANCARIAS_DEVOLUCAO[number];

export type DestinoDevolucao = 'credito' | 'caixa' | 'banco';
export const ROTULO_DESTINO_DEVOLUCAO: Record<DestinoDevolucao, string> = {
  credito: 'Crédito do cliente',
  caixa: 'Caixa (dinheiro)',
  banco: 'Banco',
};

const STATUS_VALIDOS = Object.values(STATUS_DEVOLUCAO) as string[];

export const situacaoDaDevolucao = (d: { status?: unknown } | null | undefined): StatusDevolucao => (
  typeof d?.status === 'string' && STATUS_VALIDOS.includes(d.status) ? d.status as StatusDevolucao : STATUS_DEVOLUCAO.concluida
);

/** A devolucao mexeu (ou mexeu e foi estornada) em estoque e dinheiro? Aguardando e recusada: nao. */
export const devolucaoTeveEfeito = (d: { status?: unknown } | null | undefined): boolean => {
  const s = situacaoDaDevolucao(d);
  return s === STATUS_DEVOLUCAO.concluida || s === STATUS_DEVOLUCAO.estornada;
};

export const origemDaDevolucao = (d: { origem?: unknown } | null | undefined): OrigemDevolucao => (
  d?.origem === ORIGEM_DEVOLUCAO.app ? ORIGEM_DEVOLUCAO.app : ORIGEM_DEVOLUCAO.sistema
);

export const destinoDaDevolucao = (valor: unknown): DestinoDevolucao => (
  valor === 'caixa' || valor === 'banco' ? valor : 'credito'
);

// ---------------------------------------------------------------------------
// Itens: o que da' para devolver e quanto vale
// ---------------------------------------------------------------------------

export interface ItemDoPedidoParaDevolucao {
  id: string;
  nome: string;
  precoUnitario: number;
  quantidade: number;
  desconto?: number;
  quantidadeJaDevolvida?: number;
  fatorConversao?: number;
  unidadeMedidaSigla?: string;
  lotes?: LoteUsado[];
}

/** Uma linha escolhida para devolver. `indice` = posicao da linha no pedido. */
export interface SelecaoDeDevolucao {
  indice: number;
  id: string;
  nome: string;
  quantidade: number;
}

export interface ItemDevolvido {
  id: string;
  nome: string;
  precoUnitario: number;
  quantidadeDevolvida: number;
  descontoProporcional: number;
  subtotal: number;
  /** Linha do pedido (devolucoes desde 24/11/2026; as antigas casam por id + nome). */
  indice?: number;
  fatorConversao?: number;
  unidadeMedidaSigla?: string;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const arred4 = (n: number) => Math.round(n * 10000) / 10000;

/** Quanto de cada linha esta' em devolucoes "Aguardando confirmacao" (por indice da linha). */
export const quantidadesEmAguardo = (
  devolucoes: Array<{ id?: string; status?: unknown; itensDevolvidos?: unknown }>,
  ignorarId = '',
): Map<number, number> => {
  const mapa = new Map<number, number>();
  devolucoes.forEach((d) => {
    if (ignorarId && d.id === ignorarId) return;
    if (situacaoDaDevolucao(d) !== STATUS_DEVOLUCAO.aguardando) return;
    (Array.isArray(d.itensDevolvidos) ? d.itensDevolvidos : []).forEach((item: { indice?: unknown; quantidadeDevolvida?: unknown }) => {
      const indice = Number(item?.indice);
      if (!Number.isInteger(indice) || indice < 0) return;
      mapa.set(indice, arred4((mapa.get(indice) || 0) + num(item?.quantidadeDevolvida)));
    });
  });
  return mapa;
};

/** Quanto ainda da' para devolver da linha: vendido - ja' devolvido - em aguardo. */
export const disponivelParaDevolver = (item: Pick<ItemDoPedidoParaDevolucao, 'quantidade' | 'quantidadeJaDevolvida'>, emAguardo = 0): number => (
  Math.max(0, arred4(num(item.quantidade) - num(item.quantidadeJaDevolvida) - num(emAguardo)))
);

/** Acha a linha do pedido: pelo indice (conferindo o produto) ou, nas antigas, pelo id + nome. */
const indiceDaLinha = (itens: ItemDoPedidoParaDevolucao[], ref: { indice?: number; id: string; nome: string }): number => {
  const i = Number(ref.indice);
  if (Number.isInteger(i) && i >= 0 && i < itens.length && itens[i]?.id === ref.id && itens[i]?.nome === ref.nome) return i;
  return itens.findIndex((item) => item.id === ref.id && item.nome === ref.nome);
};

/**
 * Confere a escolha contra o pedido e monta os itens devolvidos com o valor
 * (desconto do item abatido na proporcao, a mesma conta de sempre).
 */
export const montarItensDevolvidos = (
  itensDoPedido: ItemDoPedidoParaDevolucao[],
  selecao: SelecaoDeDevolucao[],
  emAguardo: Map<number, number> = new Map(),
): { ok: true; itensDevolvidos: ItemDevolvido[]; valorTotal: number } | { ok: false; erro: string } => {
  const escolhidos = selecao.filter((s) => num(s.quantidade) > 0);
  if (escolhidos.length === 0) return { ok: false, erro: 'Escolha pelo menos um item e a quantidade a devolver.' };
  const usados = new Set<number>();
  const itensDevolvidos: ItemDevolvido[] = [];
  for (const s of escolhidos) {
    const indice = indiceDaLinha(itensDoPedido, s);
    const item = indice >= 0 ? itensDoPedido[indice] : null;
    if (!item) return { ok: false, erro: `${s.nome ? `O item ${s.nome}` : 'Um dos itens'} não está mais neste pedido. Abra o pedido de novo.` };
    if (usados.has(indice)) return { ok: false, erro: `O item ${item.nome} apareceu duas vezes na devolução. Escolha de novo.` };
    usados.add(indice);
    const quantidade = arred4(num(s.quantidade));
    const disponivel = disponivelParaDevolver(item, emAguardo.get(indice) || 0);
    if (quantidade > disponivel) {
      const aguardo = emAguardo.get(indice) || 0;
      return {
        ok: false,
        erro: disponivel <= 0
          ? `${item.nome} não tem mais nada a devolver${aguardo > 0 ? ' (o restante já está numa devolução aguardando confirmação)' : ''}.`
          : `${item.nome}: dá para devolver no máximo ${disponivel.toLocaleString('pt-BR')}${aguardo > 0 ? ` (${aguardo.toLocaleString('pt-BR')} já estão numa devolução aguardando confirmação)` : ''}.`,
      };
    }
    const vendido = num(item.quantidade);
    const descontoProporcional = vendido > 0 ? num(item.desconto) * (quantidade / vendido) : 0;
    const subtotal = (quantidade * num(item.precoUnitario)) - descontoProporcional;
    itensDevolvidos.push({
      id: item.id,
      nome: item.nome,
      precoUnitario: num(item.precoUnitario),
      quantidadeDevolvida: quantidade,
      descontoProporcional,
      subtotal,
      indice,
      // Preservado para o estorno saber reverter na mesma unidade (embalagem).
      ...(item.fatorConversao ? { fatorConversao: item.fatorConversao } : {}),
      ...(item.unidadeMedidaSigla ? { unidadeMedidaSigla: item.unidadeMedidaSigla } : {}),
    });
  }
  const valorTotal = itensDevolvidos.reduce((soma, i) => soma + i.subtotal, 0);
  if (!(valorTotal > 0)) return { ok: false, erro: 'O valor da devolução ficou zerado. Confira os itens escolhidos.' };
  return { ok: true, itensDevolvidos, valorTotal };
};

// ---------------------------------------------------------------------------
// Efeito: o que muda no pedido, no estoque e nos lotes
// ---------------------------------------------------------------------------

export interface PlanoDaDevolucao {
  /** Itens do pedido com a quantidade ja' devolvida somada. */
  itensAtualizados: Array<Record<string, unknown>>;
  /** Estoque que volta, por produto, na unidade base (somado). */
  estoqueQueVolta: Array<{ id: string; nome?: string; quantidade: number }>;
  /** O que volta para cada lote (uma entrada por lote). */
  lotesQueVoltam: LoteUsado[];
}

/**
 * Lido o pedido GRAVADO (dentro da transacao), monta o que a devolucao muda.
 * A conta da quantidade disponivel e' refeita aqui: se outra devolucao entrou
 * no meio, recusa.
 */
export const planoDaDevolucao = (
  itensGravados: unknown,
  itensDevolvidos: Array<Pick<ItemDevolvido, 'id' | 'nome' | 'quantidadeDevolvida' | 'indice' | 'fatorConversao'>>,
): { ok: true; plano: PlanoDaDevolucao } | { ok: false; erro: string } => {
  const itens = (Array.isArray(itensGravados) ? itensGravados : []) as Array<ItemDoPedidoParaDevolucao & Record<string, unknown>>;
  const atualizados = itens.map((i) => ({ ...i }));
  const retornos: Array<{ lotes: LoteUsado[]; jaDevolvido: number; quantidade: number }> = [];
  for (const dev of itensDevolvidos) {
    const indice = indiceDaLinha(itens, dev);
    if (indice < 0) return { ok: false, erro: `O item ${dev.nome} não está mais no pedido. A devolução não pode ser feita.` };
    const linha = atualizados[indice];
    const jaDevolvido = num(linha.quantidadeJaDevolvida);
    const quantidade = num(dev.quantidadeDevolvida);
    if (quantidade <= 0 || quantidade > arred4(num(linha.quantidade) - jaDevolvido)) {
      return { ok: false, erro: `A quantidade disponível para devolução de ${linha.nome} foi alterada.` };
    }
    // Lote e Validade: o que a venda tirou de lote volta ao MESMO lote.
    if (Array.isArray(linha.lotes) && linha.lotes.length > 0) {
      retornos.push({
        lotes: linha.lotes,
        jaDevolvido: toBaseQuantity(jaDevolvido, linha.fatorConversao),
        quantidade: toBaseQuantity(quantidade, linha.fatorConversao),
      });
    }
    atualizados[indice] = { ...linha, quantidadeJaDevolvida: arred4(jaDevolvido + quantidade) };
  }
  const porProduto = new Map<string, { id: string; nome?: string; quantidade: number }>();
  toStockAdjustmentItems(itensDevolvidos.map((i) => ({ id: i.id, nome: i.nome, quantidade: i.quantidadeDevolvida, fatorConversao: i.fatorConversao })))
    .forEach((a) => {
      if (!a.id || a.id === 'avulso' || !(a.quantidade > 0)) return;
      const atual = porProduto.get(a.id);
      porProduto.set(a.id, { id: a.id, nome: atual?.nome || a.nome, quantidade: arred4((atual?.quantidade || 0) + a.quantidade) });
    });
  return {
    ok: true,
    plano: {
      itensAtualizados: atualizados,
      estoqueQueVolta: [...porProduto.values()],
      lotesQueVoltam: somarLotesUsados(retornos.map((r) => distribuirRetornoAosLotes(r.lotes, r.jaDevolvido, r.quantidade))),
    },
  };
};

/** Comissao da venda refeita sem o que voltou (so' venda com a regra nova de comissao). */
export const comissaoAposDevolucao = <T extends { regraVersion?: unknown }>(
  comissao: T | null | undefined,
  itensDevolvidos: Array<Pick<ItemDevolvido, 'id' | 'nome' | 'subtotal'>>,
): ReturnType<typeof recalculateCommissionAfterReturn> | null => {
  if (!comissao || !(comissao as { regraVersion?: unknown }).regraVersion) return null;
  return recalculateCommissionAfterReturn(
    comissao as unknown as Parameters<typeof recalculateCommissionAfterReturn>[0],
    itensDevolvidos.map((item) => ({ id: item.id, nome: item.nome, baseCents: toCents(item.subtotal) })),
  );
};

// ---------------------------------------------------------------------------
// Dinheiro: lancamento de saida (caixa/banco) ou credito do cliente
// ---------------------------------------------------------------------------

export interface DadosDoDinheiroDaDevolucao {
  devolucaoId: string;
  pedidoId: string;
  numeroPedido: string;
  clienteNome: string;
  clienteId?: unknown;
  valor: number;
  destino: DestinoDevolucao;
  formaBancaria?: string;
  bancoId?: string;
  bancoNome?: string;
  motivo: string;
  tenantId: string;
  /** 'AAAA-MM-DD' do dia em que o dinheiro sai. */
  hoje: string;
}

/** Id fixo do lancamento e do credito: o estorno acha pelo id da devolucao. */
export const idDoDinheiroDaDevolucao = (devolucaoId: string) => `devolucao_${devolucaoId}`;

/**
 * Saida de caixa ou banco (sem createdAt/metadados: quem grava poe). Plano de
 * contas: categoria "Devolucao de Venda", a mesma de sempre.
 */
export const lancamentoDaDevolucao = (d: DadosDoDinheiroDaDevolucao): Record<string, unknown> | null => {
  if (d.destino === 'caixa') {
    return {
      descricao: `Devolução Pedido #${d.numeroPedido} - Caixa`,
      categoria: 'Devolução de Venda',
      valor: d.valor,
      valorCentavos: toCents(d.valor),
      tipo: 'saida',
      formaPagamento: 'Dinheiro',
      naturezaFinanceira: 'caixa_fisico',
      movimentaCaixaFisico: true,
      status: 'Paga',
      data: d.hoje,
      clienteNome: d.clienteNome,
      pedidoOrigemId: d.pedidoId,
      devolucaoId: d.devolucaoId,
      idempotencyKey: `devolucao:${d.devolucaoId}:caixa`,
      tenantId: d.tenantId,
    };
  }
  if (d.destino === 'banco') {
    const forma = d.formaBancaria || 'Pix';
    const bancoNome = d.bancoNome || '';
    return {
      descricao: `Devolução Pedido #${d.numeroPedido} - ${forma}${bancoNome ? ` (${bancoNome})` : ''}`,
      categoria: 'Devolução de Venda',
      valor: d.valor,
      valorCentavos: toCents(d.valor),
      tipo: 'saida',
      formaPagamento: forma,
      naturezaFinanceira: 'bancario_digital',
      movimentaCaixaFisico: false,
      bancoId: d.bancoId || '',
      bancoNome,
      status: 'Paga',
      data: d.hoje,
      clienteNome: d.clienteNome,
      pedidoOrigemId: d.pedidoId,
      devolucaoId: d.devolucaoId,
      idempotencyKey: `devolucao:${d.devolucaoId}:banco`,
      tenantId: d.tenantId,
    };
  }
  return null;
};

/** Credito do cliente (sem createdAt/updatedAt/metadados: quem grava poe). */
export const creditoDaDevolucao = (d: DadosDoDinheiroDaDevolucao): Record<string, unknown> | null => {
  if (d.destino !== 'credito') return null;
  return {
    clienteNome: d.clienteNome,
    // Codigo do cliente da venda: o credito nao some se o cadastro for renomeado.
    ...campoDoClienteDoCredito(d.clienteId),
    pedidoOrigemId: d.pedidoId,
    devolucaoId: d.devolucaoId,
    numeroPedidoOriginal: d.numeroPedido,
    valorOriginal: d.valor,
    saldoDisponivel: d.valor,
    status: 'disponivel',
    motivo: d.motivo,
    tenantId: d.tenantId,
  };
};

/** Saldo do banco depois da saida (centavos). */
export const saldoDoBancoAposDevolucao = (saldoCentavos: unknown, valor: number): number => num(saldoCentavos) - toCents(valor);

// ---------------------------------------------------------------------------
// Documento da devolucao
// ---------------------------------------------------------------------------

export interface DadosDaDevolucao {
  pedidoId: string;
  numeroPedido: string;
  clienteNome: string;
  valorTotal: number;
  destino: DestinoDevolucao;
  bancoId?: string;
  bancoNome?: string;
  formaBancaria?: string;
  motivo: string;
  observacao: string;
  tenantId: string;
  usuarioId: string;
  itensDevolvidos: ItemDevolvido[];
  status: StatusDevolucao;
  origem: OrigemDevolucao;
  devolucaoId: string;
  /** Vendedor da venda (para a lista e o historico). */
  vendedorId?: string;
  vendedorNome?: string;
  /** Quem pediu (app): o vendedor. */
  solicitadoPorId?: string;
  solicitadoPorNome?: string;
  /** 'AAAA-MM-DD' de quando foi pedida (prazo de devolucao conta daqui). */
  dataSolicitacao?: string;
  /** Pedida fora do prazo da filial (acao "avisar"): o escritorio ve. */
  foraDoPrazo?: boolean;
}

/** Campos do documento novo (sem createdAt e metadados: quem grava poe). Nunca undefined. */
export const camposDaDevolucao = (d: DadosDaDevolucao): Record<string, unknown> => ({
  pedidoVendaId: d.pedidoId,
  numeroPedidoOriginal: d.numeroPedido,
  clienteNome: d.clienteNome,
  valorTotalDevolvido: d.valorTotal,
  valorTotalDevolvidoCentavos: toCents(d.valorTotal),
  destinoValor: d.destino,
  // Guardados pro estorno saber devolver o dinheiro pro mesmo banco.
  ...(d.destino === 'banco' ? {
    bancoId: d.bancoId || '',
    bancoNome: d.bancoNome || '',
    formaDevolucao: d.formaBancaria || 'Pix',
  } : {}),
  motivo: d.motivo,
  observacao: d.observacao || '',
  tenantId: d.tenantId,
  usuarioResponsavelId: d.usuarioId,
  status: d.status,
  origem: d.origem,
  idempotencyKey: `devolucao:${d.devolucaoId}`,
  itensDevolvidos: d.itensDevolvidos,
  ...(d.vendedorId ? { vendedorId: d.vendedorId } : {}),
  ...(d.vendedorNome ? { vendedorNome: d.vendedorNome } : {}),
  ...(d.solicitadoPorId ? { solicitadoPorId: d.solicitadoPorId } : {}),
  ...(d.solicitadoPorNome ? { solicitadoPorNome: d.solicitadoPorNome } : {}),
  ...(d.dataSolicitacao ? { dataSolicitacao: d.dataSolicitacao } : {}),
  ...(d.foraDoPrazo ? { foraDoPrazo: true } : {}),
});

/** So' devolucao "Aguardando confirmacao" pode ser confirmada ou recusada. */
export const erroParaDecidirDevolucao = (d: { status?: unknown } | null | undefined, acao: 'confirmar' | 'recusar'): string | null => {
  if (!d) return 'Esta devolução não existe mais. Atualize a lista.';
  const s = situacaoDaDevolucao(d);
  if (s === STATUS_DEVOLUCAO.aguardando) return null;
  return `Esta devolução já está "${ROTULO_SITUACAO_DEVOLUCAO[s]}" e não pode mais ser ${acao === 'confirmar' ? 'confirmada' : 'recusada'}. Atualize a lista.`;
};

/** Pedido que pode receber devolucao (sistema ou app). */
export const erroDoPedidoParaDevolucao = (pedido: Record<string, unknown> | null | undefined): string | null => {
  if (!pedido) return 'A venda original não existe mais.';
  if (ehPedidoDoSistemaAnterior(pedido)) return mensagemPedidoDoSistemaAnterior('devolvida');
  if (pedido.status === 'Cancelada') return 'Venda cancelada não pode receber nova devolução.';
  return null;
};

// ---------------------------------------------------------------------------
// App Vendas
// ---------------------------------------------------------------------------

/**
 * Pedido feito no app Vendas: o id do documento e' o id do rascunho do
 * aparelho (crypto.randomUUID sem tracos: 32 hexadecimais; a bonificacao
 * ligada leva um "b" no fim). Pedido do sistema tem o id automatico do
 * Firestore (20 letras e numeros). O id nunca muda ao faturar, entao a marca
 * sobrevive a finalizacao (que regrava o documento inteiro).
 */
export const ehPedidoDoAppVendas = (pedidoId: unknown): boolean => /^[0-9a-f]{32}b?$/.test(String(pedidoId || ''));

/** O vendedor pode devolver este pedido pelo app? Devolve o motivo do "nao", em portugues. */
export const erroParaDevolverPeloApp = (
  pedidoId: string,
  pedido: Record<string, unknown> | null | undefined,
  usuarioId: string,
): string | null => {
  if (!pedido) return 'Pedido não encontrado. Atualize a lista de pedidos.';
  if (ehPedidoDoSistemaAnterior(pedido)) return mensagemPedidoDoSistemaAnterior('devolvida');
  if (!ehPedidoDoAppVendas(pedidoId)) return 'Pelo aplicativo só dá para devolver pedido feito no aplicativo. Para este pedido, peça a devolução à loja.';
  if (pedido.criadoPor !== usuarioId || pedido.vendedorId !== usuarioId) return 'Este pedido é de outro vendedor. Pelo aplicativo você só devolve os pedidos que você mesmo fez.';
  if (pedido.status === 'Cancelada') return 'Pedido cancelado não recebe devolução.';
  if (pedido.status !== 'Finalizada') return 'Este pedido ainda não foi faturado pela loja. A devolução pelo aplicativo vale só para pedido já faturado.';
  return null;
};

export interface ConfigDevolucaoApp {
  /** "Permitir devolucao pelo aplicativo". */
  permitida: boolean;
  /** "Devolucao do aplicativo ja' entra confirmada". */
  jaConfirmada: boolean;
}

export const CONFIG_DEVOLUCAO_APP_PADRAO: ConfigDevolucaoApp = { permitida: false, jaConfirmada: false };

/** Le as duas chaves da filial (configuracoes/{filial}); nascem desligadas. */
export const parseConfigDevolucaoApp = (config: { appDevolucaoPermitida?: unknown; appDevolucaoJaConfirmada?: unknown } | null | undefined): ConfigDevolucaoApp => {
  const permitida = config?.appDevolucaoPermitida === true;
  return { permitida, jaConfirmada: permitida && config?.appDevolucaoJaConfirmada === true };
};

export const LIMITE_OBSERVACAO_DEVOLUCAO = 300;
export const LIMITE_MOTIVO_RECUSA = 300;

export interface PedidoDeDevolucaoDoApp {
  pedidoId: string;
  itens: Array<{ indice: number; quantidade: number }>;
  motivo: string;
  observacao: string;
  destino: DestinoDevolucao;
  bancoId: string;
  formaBancaria: string;
  /** Id fixo (gerado no aparelho): reenviar depois de uma queda nao duplica. */
  idDocumento: string;
}

/** Le e confere o corpo que o app manda ao servidor. */
export const lerPedidoDeDevolucaoDoApp = (corpo: unknown): PedidoDeDevolucaoDoApp | { erro: string } => {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  const pedidoId = String(c.pedidoId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(pedidoId)) return { erro: 'Pedido não informado. Abra o pedido de novo.' };
  const brutos = Array.isArray(c.itens) ? c.itens : [];
  const itens: Array<{ indice: number; quantidade: number }> = [];
  for (const bruto of brutos) {
    const b = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
    const indice = Number(b.indice);
    const quantidade = Number(b.quantidade);
    if (!Number.isInteger(indice) || indice < 0 || indice > 999) return { erro: 'Item inválido na devolução. Abra o pedido de novo.' };
    if (!Number.isFinite(quantidade) || quantidade < 0) return { erro: 'Quantidade inválida na devolução. Confira os números.' };
    if (quantidade > 0) itens.push({ indice, quantidade: arred4(quantidade) });
  }
  if (itens.length === 0) return { erro: 'Escolha pelo menos um item e a quantidade a devolver.' };
  if (new Set(itens.map((i) => i.indice)).size !== itens.length) return { erro: 'Um item apareceu duas vezes na devolução. Escolha de novo.' };
  const motivo = String(c.motivo || '');
  if (!(MOTIVOS_DEVOLUCAO as readonly string[]).includes(motivo)) return { erro: 'Escolha o motivo da devolução.' };
  const destinoBruto = String(c.destino || '');
  if (!['credito', 'caixa', 'banco'].includes(destinoBruto)) return { erro: 'Escolha para onde vai o valor: crédito do cliente, caixa ou banco.' };
  const destino = destinoBruto as DestinoDevolucao;
  const bancoId = destino === 'banco' ? String(c.bancoId || '').trim() : '';
  const formaBancaria = destino === 'banco' ? String(c.formaBancaria || 'Pix') : '';
  if (destino === 'banco') {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(bancoId)) return { erro: 'Escolha de qual banco o dinheiro sai.' };
    if (!(FORMAS_BANCARIAS_DEVOLUCAO as readonly string[]).includes(formaBancaria)) return { erro: 'Escolha a forma: Pix ou Transferência.' };
  }
  const observacao = String(c.observacao || '').trim().slice(0, LIMITE_OBSERVACAO_DEVOLUCAO);
  const idDocumento = String(c.idDocumento || '').trim();
  if (idDocumento && !/^[A-Za-z0-9_-]{8,64}$/.test(idDocumento)) return { erro: 'Identificador da devolução inválido. Abra a tela de novo e reenvie.' };
  return { pedidoId, itens, motivo, observacao, destino, bancoId, formaBancaria, idDocumento };
};

/** Motivo da recusa: obrigatorio, curto. */
export const lerMotivoDaRecusa = (bruto: unknown): { ok: true; motivo: string } | { ok: false; erro: string } => {
  const motivo = String(bruto || '').trim().slice(0, LIMITE_MOTIVO_RECUSA);
  if (motivo.length < 3) return { ok: false, erro: 'Escreva o motivo da recusa: o vendedor vê no aplicativo.' };
  return { ok: true, motivo };
};
