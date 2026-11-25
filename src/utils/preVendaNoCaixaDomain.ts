/*
 * PRE-VENDA FATURADA NA FRENTE DE CAIXA (23/11/2026).
 *
 * Quem trabalha com pre-venda grava o pedido no balcao (ou no app Vendas) e o
 * CAIXA so' recebe. Antes, para faturar, o caixa tinha de sair da Frente de
 * Caixa e abrir a pre-venda no sistema (Comercial > Pre-vendas em Aberto).
 * Agora ele lista as pre-vendas em aberto ali mesmo, puxa uma para o cupom,
 * recebe e fatura SOBRE A PROPRIA PRE-VENDA -- pelo servidor
 * (server/services/vendaFechamento.js, `pedidoId` + `pdvSessionId`).
 *
 * O que NAO muda no caixa, de proposito:
 *  - o VENDEDOR: e' o que gravou a pre-venda (a comissao e' dele). O caixa nao
 *    tem onde trocar, e o servidor usa o da pre-venda gravada de qualquer jeito;
 *  - itens, quantidades, descontos, frete e cliente: sao os da pre-venda. Para
 *    mexer, edita-se a pre-venda no sistema (com a permissao de editar);
 *  - o preco so' acompanha a forma de pagamento (a vista / a prazo), pela mesma
 *    regra do Pedido de Venda (precoVendaDomain.reprecificarItens), e nunca em
 *    silencio: a tela pergunta antes.
 *
 * Fica so' no sistema: pedido do agente (Em Analise), pedido de bonificacao e
 * pre-venda de entrega futura.
 *
 * Regra pura: sem tela, sem Firestore.
 */
import { fromCents, toCents } from './financeDomain';
import { hasModuleAccess } from './roles';
import { STATUS_PRE_VENDA } from './preVendaDomain';
import { ehPedidoDeBonificacao, temItemBonificado } from './bonificacaoDomain';
import { brutoDaLinhaCentavos, totaisDoFechamento } from './vendaFechamentoDomain';
import { reprecificarItens, type CondicaoPagamento, type OrigemPreco, type TabelaDePrecoDoItem } from './precoVendaDomain';
import { conferirPrecos, type ProdutoParaPreco, type VendidoPorPromocao } from './conferenciaPrecoDomain';
import type { PromocaoComId } from './promocaoDomain';
import { dataDoPedido } from './relatorioPreVendasDomain';
import { normalizeSearchText } from './textSearch';

/** A mesma permissao que finaliza a pre-venda no Pedido de Venda (e que o servidor confere). */
export const PERMISSAO_FATURAR_PRE_VENDA = 'vendas.pre_venda_finalizar';

export const ONDE_FATURAR_NO_SISTEMA = 'Comercial › Pré-vendas em Aberto';

/** A opcao so' aparece para a empresa que trabalha com pre-venda e para quem pode transforma-la em venda. */
export const podeFaturarPreVendaNoCaixa = (args: {
  trabalhaComPreVenda: boolean;
  role: unknown;
  isOwner: boolean;
  permissoes: string[] | null | undefined;
}): boolean => args.trabalhaComPreVenda && hasModuleAccess({
  role: args.role,
  isOwner: args.isOwner,
  permissions: args.permissoes,
  requiredPermission: PERMISSAO_FATURAR_PRE_VENDA,
});

// ---------------------------------------------------------------------------
// O pedido gravado
// ---------------------------------------------------------------------------

/** Linha da pre-venda como esta' gravada em `pedidos_venda` (os demais campos vao e voltam intactos). */
export interface ItemDaPreVenda {
  id: string;
  nome: string;
  precoUnitario: number;
  quantidade: number;
  desconto: number;
  subtotal: number;
  tabelaPreco?: TabelaDePrecoDoItem;
  origemPreco?: OrigemPreco;
  promocaoId?: string;
  promocaoNome?: string;
  [campo: string]: unknown;
}

type PedidoGravado = Record<string, unknown>;

const texto = (valor: unknown): string => String(valor ?? '').trim();
const numero = (valor: unknown): number => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Por que esta pre-venda nao pode ser faturada no caixa, dizendo onde resolver.
 * null = pode. O servidor confere as mesmas coisas (com o pedido lido do banco).
 */
export const motivoParaNaoFaturarNoCaixa = (pedido: PedidoGravado | null | undefined): string | null => {
  if (!pedido) return 'Esta pré-venda não existe mais. Atualize a lista de pré-vendas.';
  const numeroPedido = texto(pedido.numeroPedido);
  if (texto(pedido.status) !== STATUS_PRE_VENDA) {
    return `O pedido #${numeroPedido} não está mais em aberto como pré-venda (já foi faturado, cancelado ou veio do agente). Atualize a lista de pré-vendas.`;
  }
  if (ehPedidoDeBonificacao(pedido)) {
    return `O pedido #${numeroPedido} é de bonificação (mercadoria sem cobrança). Fature a bonificação em ${ONDE_FATURAR_NO_SISTEMA}.`;
  }
  if (pedido.entregaFutura === true) {
    return `A pré-venda #${numeroPedido} é para entrega futura. Fature esta pré-venda em ${ONDE_FATURAR_NO_SISTEMA}.`;
  }
  const itens = Array.isArray(pedido.itens) ? pedido.itens as Array<{ bonificado?: unknown }> : [];
  if (itens.length === 0) {
    return `A pré-venda #${numeroPedido} está sem itens. Abra a pré-venda em ${ONDE_FATURAR_NO_SISTEMA} e lance os itens.`;
  }
  if (temItemBonificado(itens)) {
    return `A pré-venda #${numeroPedido} tem item bonificado junto com os cobrados. Abra a pré-venda em ${ONDE_FATURAR_NO_SISTEMA} e grave de novo, para o sistema separar os brindes.`;
  }
  if (!texto(pedido.vendedorId) && !texto(pedido.usuarioResponsavelId)) {
    return `A pré-venda #${numeroPedido} está sem vendedor. Abra a pré-venda em ${ONDE_FATURAR_NO_SISTEMA}, escolha o vendedor e grave de novo.`;
  }
  return null;
};

// ---------------------------------------------------------------------------
// A lista do caixa
// ---------------------------------------------------------------------------

export interface PreVendaDoCaixa {
  id: string;
  numeroPedido: string;
  clienteNome: string;
  vendedorNome: string;
  data: Date | null;
  totalCents: number;
  itensCount: number;
  /** Nao da' para faturar no caixa: o motivo, com o que fazer (a linha aparece, mas nao e' puxada). */
  soNoSistema: string | null;
}

const numeroParaOrdem = (numeroPedido: string): number => {
  const n = Number.parseInt(numeroPedido.replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Pedidos em aberto da filial -> linhas da lista do caixa, da mais nova para a
 * mais antiga. So' pre-venda do balcao: pedido do agente e bonificacao nem
 * aparecem (nao sao do caixa); entrega futura aparece marcada, para o caixa
 * saber por que nao puxa. `nomes` = id do usuario -> nome, para a pre-venda
 * antiga que nao gravou o nome do vendedor.
 */
export const preVendasDoCaixa = (
  pedidos: ReadonlyArray<PedidoGravado & { id: string }>,
  nomes: Readonly<Record<string, string>> = {},
): PreVendaDoCaixa[] => pedidos
  .filter((pedido) => texto(pedido.status) === STATUS_PRE_VENDA && !ehPedidoDeBonificacao({ tipoPedido: pedido.tipoPedido }))
  .map((pedido): PreVendaDoCaixa => ({
    id: pedido.id,
    numeroPedido: texto(pedido.numeroPedido),
    clienteNome: texto(pedido.clienteNome) || 'CONSUMIDOR FINAL',
    vendedorNome: texto(pedido.vendedorNome)
      || nomes[texto(pedido.vendedorId) || texto(pedido.usuarioResponsavelId)]
      || 'Não identificado',
    data: dataDoPedido(pedido.dataVenda) || dataDoPedido(pedido.createdAt),
    totalCents: Number(pedido.valorTotalCentavos ?? toCents(numero(pedido.valorTotal))) || 0,
    itensCount: Array.isArray(pedido.itens) ? pedido.itens.length : 0,
    soNoSistema: motivoParaNaoFaturarNoCaixa(pedido),
  }))
  .sort((a, b) => numeroParaOrdem(b.numeroPedido) - numeroParaOrdem(a.numeroPedido));

/**
 * Busca do caixa: pelo numero (com ou sem "#" e sem os zeros da frente) ou
 * pelo nome do cliente, sem acento. Vazio (ou so' "#") = todas.
 */
export const filtrarPreVendasDoCaixa = (linhas: ReadonlyArray<PreVendaDoCaixa>, busca: string): PreVendaDoCaixa[] => {
  const termo = normalizeSearchText(String(busca || '').replace(/^\s*#/, ''));
  if (!termo) return [...linhas];
  const soNumero = /^\d+$/.test(termo) ? termo.replace(/^0+(?=\d)/, '') : '';
  return linhas.filter((linha) => (
    (soNumero !== '' && linha.numeroPedido.replace(/\D/g, '').replace(/^0+(?=\d)/, '').includes(soNumero))
    || normalizeSearchText(linha.numeroPedido).includes(termo)
    || normalizeSearchText(linha.clienteNome).includes(termo)
  ));
};

// ---------------------------------------------------------------------------
// A pre-venda puxada para o caixa
// ---------------------------------------------------------------------------

export interface PreVendaCarregada {
  id: string;
  numeroPedido: string;
  /** O vendedor que gravou a pre-venda. O caixa nao troca. */
  vendedorId: string;
  vendedorNome: string;
  clienteId: string | null;
  clienteNome: string;
  observacao: string;
  /** "aaaa-mm-dd" em que a pre-venda foi gravada (so' para mostrar). */
  dataDaPreVenda: string;
  itens: ItemDaPreVenda[];
  descontoGeral: { tipo: 'percentual' | 'valor'; valorInformado: number };
  frete: number;
  encargos: number;
  /** Transporte para a nota, como gravado; null = nada informado. */
  transporte: Record<string, unknown> | null;
  /** "Com nota / Sem nota"; null = nao informado. */
  comNotaFiscal: boolean | null;
  orcamentoId: string | null;
  estoqueReservado: boolean;
  /** Situacao na conferencia da mercadoria ('' = empresa sem conferencia). */
  statusConferencia: string;
  /** Forma de pagamento que o vendedor anotou na pre-venda ('' = nenhuma). So' informativo. */
  pagamentoCombinado: string;
  /** Forma escolhida pelo vendedor no app (25/11/2026): o pagamento ja' abre nela; trocar pede permissao. '' = nenhuma. */
  formaDoVendedor: string;
  /** Pedido de bonificacao ligado a esta venda (fatura a parte, no sistema). */
  pedidoBonificacaoId: string | null;
}

const lerItem = (bruto: unknown): ItemDaPreVenda => {
  const i = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
  const precoUnitario = numero(i.precoUnitario);
  const quantidade = numero(i.quantidade);
  const desconto = Math.max(0, numero(i.desconto));
  return {
    ...i,
    id: texto(i.id),
    nome: texto(i.nome) || 'item',
    precoUnitario,
    quantidade,
    desconto,
    subtotal: fromCents(Math.max(0, brutoDaLinhaCentavos({ precoUnitario, quantidade }) - toCents(desconto))),
  } as ItemDaPreVenda;
};

/**
 * Pre-venda gravada -> o que o caixa segura enquanto recebe. Devolve o motivo
 * (em portugues, com o que fazer) quando ela nao pode ser faturada no caixa.
 */
export const carregarPreVendaNoCaixa = (
  id: string,
  pedido: PedidoGravado | null | undefined,
  nomes: Readonly<Record<string, string>> = {},
): { erro: string } | { preVenda: PreVendaCarregada } => {
  const motivo = motivoParaNaoFaturarNoCaixa(pedido);
  if (motivo || !pedido) return { erro: motivo || 'Esta pré-venda não existe mais. Atualize a lista de pré-vendas.' };

  const vendedorId = texto(pedido.vendedorId) || texto(pedido.usuarioResponsavelId);
  const dg = (pedido.descontoGeral && typeof pedido.descontoGeral === 'object' ? pedido.descontoGeral : {}) as Record<string, unknown>;
  const data = dataDoPedido(pedido.dataVenda) || dataDoPedido(pedido.createdAt);
  const pagamentos = Array.isArray(pedido.pagamentos) ? pedido.pagamentos as Array<Record<string, unknown>> : [];
  const formas = [...new Set(pagamentos.map((p) => texto(p?.formaPagamento)).filter(Boolean))];

  return {
    preVenda: {
      id,
      numeroPedido: texto(pedido.numeroPedido),
      vendedorId,
      vendedorNome: texto(pedido.vendedorNome) || nomes[vendedorId] || 'Não identificado',
      clienteId: texto(pedido.clienteId) || null,
      clienteNome: texto(pedido.clienteNome).toUpperCase() || 'CONSUMIDOR FINAL',
      observacao: texto(pedido.observacao),
      dataDaPreVenda: typeof pedido.dataVenda === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(pedido.dataVenda)
        ? pedido.dataVenda
        : (data ? data.toISOString().slice(0, 10) : ''),
      itens: (pedido.itens as unknown[]).map(lerItem),
      descontoGeral: {
        tipo: dg.tipo === 'percentual' ? 'percentual' : 'valor',
        valorInformado: Math.max(0, numero(dg.valorInformado)),
      },
      frete: Math.max(0, numero(pedido.frete)),
      encargos: Math.max(0, numero(pedido.encargos)),
      transporte: pedido.transporte && typeof pedido.transporte === 'object' ? pedido.transporte as Record<string, unknown> : null,
      comNotaFiscal: typeof pedido.comNotaFiscal === 'boolean' ? pedido.comNotaFiscal : null,
      orcamentoId: texto(pedido.orcamentoId) || null,
      estoqueReservado: pedido.estoqueReservado === true,
      statusConferencia: texto(pedido.statusConferencia),
      pagamentoCombinado: formas.length > 0 ? formas.join(' + ') : (pagamentos.length === 0 ? texto(pedido.formaPagamento) : ''),
      pedidoBonificacaoId: texto(pedido.pedidoBonificacaoId) || null,
      formaDoVendedor: texto(pedido.formaPagamentoVendedor),
    },
  };
};

// ---------------------------------------------------------------------------
// Totais e cupom
// ---------------------------------------------------------------------------

/** Mesmo formato dos totais do PDV (PdvTotals), com o frete e os encargos da pre-venda. */
export interface TotaisDaPreVenda {
  subtotalCentavos: number;
  itensDescontoCentavos: number;
  vendaDescontoCentavos: number;
  descontoTotalCentavos: number;
  /** Frete + encargos da pre-venda (o PDV comum nao tem). */
  acrescimosCentavos: number;
  totalCentavos: number;
  itemCount: number;
  volumeCount: number;
}

/** A conta e' a do servidor (totaisDoFechamento): o total que o caixa mostra e' o que sera' cobrado. */
export const totaisDaPreVenda = (preVenda: Pick<PreVendaCarregada, 'itens' | 'descontoGeral' | 'frete' | 'encargos'>): TotaisDaPreVenda => {
  const t = totaisDoFechamento({
    itens: preVenda.itens,
    descontoGeralTipo: preVenda.descontoGeral.tipo,
    descontoGeralValor: preVenda.descontoGeral.valorInformado,
    frete: preVenda.frete,
    encargos: preVenda.encargos,
  });
  return {
    subtotalCentavos: toCents(t.valorTotalItens),
    itensDescontoCentavos: toCents(t.valorTotalDescontosItens),
    vendaDescontoCentavos: t.descontoGeralCentavos,
    descontoTotalCentavos: toCents(t.valorTotalDescontos),
    acrescimosCentavos: toCents(preVenda.frete) + toCents(preVenda.encargos),
    totalCentavos: t.valorTotalCentavos,
    itemCount: preVenda.itens.length,
    volumeCount: preVenda.itens.reduce((soma, item) => soma + item.quantidade, 0),
  };
};

/** O que o cupom do caixa precisa do cadastro do produto (foto, codigo, saldo). */
export interface ProdutoParaOCupom {
  codigo?: string;
  codigoBarras?: string;
  categoria?: string;
  imagemProduto?: string;
  quantidade?: number;
}

/** Linha do cupom do caixa (mesmo formato de PdvCartItem), so' para mostrar: a pre-venda nao e' editada ali. */
export interface LinhaDoCupomDaPreVenda {
  id: string;
  productId: string;
  nome: string;
  codigo: string;
  codigoBarras: string;
  categoria: string;
  imagemProduto: string;
  estoqueDisponivel: number;
  precoUnitarioCentavos: number;
  quantidade: number;
  descontoCentavos: number;
  unidadeMedidaSigla: string;
  unidadeMedidaCasasDecimais: number;
  origemPreco?: OrigemPreco;
  promocaoNome?: string;
}

export const linhasDoCupomDaPreVenda = (
  itens: ReadonlyArray<ItemDaPreVenda>,
  produtos: Readonly<Record<string, ProdutoParaOCupom | null | undefined>> = {},
): LinhaDoCupomDaPreVenda[] => itens.map((item, indice) => {
  const produto = produtos[item.id] || null;
  return {
    // Pelo indice: a pre-venda pode ter o mesmo produto em duas linhas.
    id: `pre-venda:${indice}`,
    productId: item.id,
    nome: item.nome,
    codigo: texto(item.codigo) || texto(produto?.codigo),
    codigoBarras: texto(item.codigoBarras) || texto(produto?.codigoBarras),
    categoria: texto(produto?.categoria),
    imagemProduto: texto(produto?.imagemProduto),
    estoqueDisponivel: numero(produto?.quantidade),
    precoUnitarioCentavos: toCents(item.precoUnitario),
    quantidade: item.quantidade,
    descontoCentavos: toCents(item.desconto),
    // Unidade ausente no item: a padrao documentada (unidadeMedidaDomain), so' na exibicao.
    unidadeMedidaSigla: texto(item.unidadeMedidaSigla) || 'UN',
    unidadeMedidaCasasDecimais: numero(item.unidadeMedidaCasasDecimais),
    ...(item.origemPreco ? { origemPreco: item.origemPreco } : {}),
    ...(item.promocaoNome ? { promocaoNome: item.promocaoNome } : {}),
  };
});

// ---------------------------------------------------------------------------
// Preco acompanha a forma de pagamento
// ---------------------------------------------------------------------------

/**
 * A forma de pagamento escolhida no caixa (a vista / a prazo) troca a tabela
 * dos itens com preco automatico -- a mesma regra do Pedido de Venda. Preco
 * digitado e item sem tabela ficam como estao; o desconto do item e' mantido.
 * A marca da promocao acompanha o preco (sai quando o item deixa a promocao).
 */
export const reprecificarPreVenda = (
  itens: ReadonlyArray<ItemDaPreVenda>,
  condicao: CondicaoPagamento,
): { itens: ItemDaPreVenda[]; alterados: number; diferencaCentavos: number } => {
  const resultado = reprecificarItens([...itens], condicao);
  const sincronizados = resultado.itens.map((item) => {
    const promocao = item.origemPreco === 'promocao' ? item.tabelaPreco?.promocao : null;
    if (promocao) return { ...item, promocaoId: promocao.id, promocaoNome: promocao.nome };
    if (!item.promocaoId && !item.promocaoNome) return item;
    const { promocaoId: _id, promocaoNome: _nome, ...semPromocao } = item;
    void _id; void _nome;
    return semPromocao as ItemDaPreVenda;
  });
  return { itens: sincronizados, alterados: resultado.alterados, diferencaCentavos: resultado.diferencaCentavos };
};

// ---------------------------------------------------------------------------
// Desconto contra o limite do Pedido de Venda
// ---------------------------------------------------------------------------

/**
 * Base e desconto que o servidor vai conferir contra o limite do PEDIDO DE
 * VENDA (o desconto da pre-venda foi dado la'): descontos da pre-venda mais o
 * que os itens estao abaixo do preco do sistema (conferenciaPrecoDomain). A
 * mesma conta de vendaFechamento.js, para a liberacao pedida no caixa valer.
 */
export const descontoDaPreVendaParaOLimite = (args: {
  preVenda: Pick<PreVendaCarregada, 'itens' | 'descontoGeral' | 'frete' | 'encargos'>;
  produtos: Readonly<Record<string, ProdutoParaPreco | null | undefined>>;
  promocoes: ReadonlyArray<PromocaoComId>;
  hoje: string;
  condicao: CondicaoPagamento;
  vendidoPorPromocao?: VendidoPorPromocao;
}): { baseCentavos: number; descontoCentavos: number } => {
  const t = totaisDoFechamento({
    itens: args.preVenda.itens,
    descontoGeralTipo: args.preVenda.descontoGeral.tipo,
    descontoGeralValor: args.preVenda.descontoGeral.valorInformado,
    frete: args.preVenda.frete,
    encargos: args.preVenda.encargos,
  });
  const precos = conferirPrecos({
    itens: args.preVenda.itens,
    produtos: args.produtos,
    promocoes: args.promocoes,
    hoje: args.hoje,
    condicao: args.condicao,
    vendidoPorPromocao: args.vendidoPorPromocao,
  });
  return {
    baseCentavos: toCents(t.valorTotalItens) + precos.diferencaTotalCentavos,
    descontoCentavos: toCents(t.valorTotalDescontos) + precos.diferencaTotalCentavos,
  };
};

// ---------------------------------------------------------------------------
// O que vai para o servidor
// ---------------------------------------------------------------------------

/**
 * Corpo de POST /api/vendas/finalizar para a pre-venda faturada no caixa.
 * Vai o `pedidoId` (fatura sobre a propria pre-venda, sem pedido novo) e o
 * `pdvSessionId` (o caixa que recebeu). O `vendedorId` e' SEMPRE o da
 * pre-venda -- nunca o operador do caixa; o servidor confere com o gravado.
 */
export const corpoDoFaturamentoNoCaixa = (args: {
  preVenda: PreVendaCarregada;
  pdvSessionId: string;
  /** Dia do faturamento ("aaaa-mm-dd"): a data da venda passa a ser esta. */
  dataVenda: string;
  pagamentos: ReadonlyArray<object>;
  observacao: string;
  /** Lote escolhido para a linha (pelo indice); vazio para quem nao controla lote. */
  lotesDoItem?: (indice: number) => object;
  excedeuLimite?: boolean;
  aprovacao?: object | null;
}): Record<string, unknown> => {
  const { preVenda } = args;
  return {
    pedidoId: preVenda.id,
    pdvSessionId: args.pdvSessionId,
    dataVenda: args.dataVenda,
    vendedorId: preVenda.vendedorId,
    clienteId: preVenda.clienteId,
    clienteNome: preVenda.clienteNome,
    observacao: args.observacao.trim(),
    itens: preVenda.itens.map((item, indice) => ({ ...item, ...(args.lotesDoItem ? args.lotesDoItem(indice) : {}) })),
    descontoGeral: {
      tipo: preVenda.descontoGeral.tipo,
      valorInformado: preVenda.descontoGeral.valorInformado,
      excedeuLimite: args.excedeuLimite === true,
      ...(args.excedeuLimite === true && args.aprovacao ? { aprovacao: args.aprovacao } : {}),
    },
    frete: preVenda.frete,
    encargos: preVenda.encargos,
    ...(preVenda.transporte ? { transporte: preVenda.transporte } : {}),
    pagamentos: [...args.pagamentos],
    ...(preVenda.orcamentoId ? { orcamentoId: preVenda.orcamentoId } : {}),
    ...(preVenda.comNotaFiscal !== null ? { comNotaFiscal: preVenda.comNotaFiscal } : {}),
  };
};
