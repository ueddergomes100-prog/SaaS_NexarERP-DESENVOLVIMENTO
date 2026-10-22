/**
 * COMPRAS: COTACAO E PEDIDO DE COMPRA (pedido do dono, 21/10/2026; decisoes
 * pelas caixinhas em 22/10):
 *  - a cotacao lista itens do ESTOQUE (so' produtos) com quantidade e vai a
 *    varios fornecedores; cada um recebe um LINK PUBLICO com codigo de
 *    acesso e preenche preco por item, prazo de entrega e condicao de
 *    pagamento. O link vale ate' "responder ate'" (padrao 7 dias);
 *  - o comparativo mostra, item a item, o melhor preco e o total por
 *    fornecedor; a loja escolhe o vencedor por item e o sistema gera um
 *    PEDIDO DE COMPRA por fornecedor;
 *  - o pedido de compra tambem nasce a mao (fornecedor, itens, precos) e sai
 *    em PDF; fecha a mao: Aberto -> Enviado -> Recebido (ou Cancelado). A
 *    entrada de NF-e ligada ao pedido fica para a fase 2.
 *
 * Regra pura: sem tela, sem Firestore. Compilada para o servidor.
 */

export const DIAS_PADRAO_PARA_RESPONDER = 7;
export const ITENS_MAXIMO = 200;
export const FORNECEDORES_MAXIMO = 20;
export const TEXTO_CURTO_MAX = 120;
export const OBSERVACAO_MAX = 500;
export const CODIGO_ACESSO_TAMANHO = 6;

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;

const numero = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

const texto = (v: unknown, maximo: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, maximo);

export const formatarReais = (centavos: number): string => `R$ ${(Number(centavos || 0) / 100).toFixed(2).replace('.', ',')}`;

const quantidadeValida = (v: unknown): number | null => {
  const n = numero(v);
  return n > 0 ? Math.round(n * 1000) / 1000 : null;
};

// ---------------------------------------------------------------------------
// COTACAO
// ---------------------------------------------------------------------------

export type StatusCotacao = 'aberta' | 'fechada' | 'cancelada';

export const ROTULO_STATUS_COTACAO: Record<StatusCotacao, string> = {
  aberta: 'Aberta — aguardando propostas',
  fechada: 'Fechada',
  cancelada: 'Cancelada',
};

export interface ItemDaCotacao {
  produtoId: string;
  codigo: string;
  nome: string;
  unidade: string;
  quantidade: number;
  observacao: string;
}

export type StatusDoFornecedor = 'aguardando' | 'respondida';

export interface FornecedorDaCotacao {
  fornecedorId: string;
  nome: string;
  email: string;
  celular: string;
  /** Vai no link publico; gerado pelo servidor. */
  token: string;
  /** Codigo de acesso de 6 digitos que a loja passa ao fornecedor. */
  codigoAcesso: string;
  status: StatusDoFornecedor;
  respondidoEmIso: string;
  /** Preco unitario por produtoId, em centavos. Item sem preco = fornecedor nao cotou. */
  precos: Record<string, number>;
  prazoEntregaDias: number | null;
  condicaoPagamento: string;
  observacao: string;
}

export interface Cotacao {
  id: string;
  numero: number;
  titulo: string;
  status: StatusCotacao;
  itens: ItemDaCotacao[];
  fornecedores: FornecedorDaCotacao[];
  /** AAAA-MM-DD: o link responde ate' o fim deste dia. */
  responderAte: string;
  observacao: string;
  criadoEmIso: string;
  /** produtoId -> fornecedorId escolhido ao gerar os pedidos. */
  escolhas: Record<string, string>;
  pedidosGerados: Array<{ pedidoId: string; fornecedorId: string; numero: number }>;
}

export interface PedidoDeCotacao {
  titulo: string;
  itens: ItemDaCotacao[];
  fornecedores: Array<{ fornecedorId: string; nome: string; email: string; celular: string }>;
  responderAte: string;
  observacao: string;
}

const lerItens = (raw: unknown): { erro: string } | { itens: ItemDaCotacao[] } => {
  const lista = Array.isArray(raw) ? raw : [];
  if (lista.length === 0) return { erro: 'Coloque pelo menos um item na cotação.' };
  if (lista.length > ITENS_MAXIMO) return { erro: `A cotação aceita até ${ITENS_MAXIMO} itens.` };
  const itens: ItemDaCotacao[] = [];
  const vistos = new Set<string>();
  for (const bruto of lista) {
    const i = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
    const produtoId = typeof i.produtoId === 'string' && ID_VALIDO.test(i.produtoId) ? i.produtoId : '';
    const nome = texto(i.nome, TEXTO_CURTO_MAX);
    if (!produtoId || !nome) return { erro: 'Um dos itens está sem produto. Escolha o produto de novo.' };
    if (vistos.has(produtoId)) return { erro: `O produto ${nome} está repetido na cotação. Junte as quantidades numa linha só.` };
    vistos.add(produtoId);
    const quantidade = quantidadeValida(i.quantidade);
    if (!quantidade) return { erro: `Informe a quantidade de ${nome}.` };
    itens.push({ produtoId, codigo: texto(i.codigo, 40), nome, unidade: texto(i.unidade, 10) || 'UN', quantidade, observacao: texto(i.observacao, TEXTO_CURTO_MAX) });
  }
  return { itens };
};

export const lerPedidoDeCotacao = (corpo: unknown): { erro: string } | { pedido: PedidoDeCotacao } => {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  const titulo = texto(c.titulo, TEXTO_CURTO_MAX);
  if (!titulo) return { erro: 'Dê um nome à cotação (ex.: "Reposição de outubro").' };
  const itensLidos = lerItens(c.itens);
  if ('erro' in itensLidos) return itensLidos;
  const brutos = Array.isArray(c.fornecedores) ? c.fornecedores : [];
  if (brutos.length === 0) return { erro: 'Escolha pelo menos um fornecedor para receber a cotação.' };
  if (brutos.length > FORNECEDORES_MAXIMO) return { erro: `A cotação vai para até ${FORNECEDORES_MAXIMO} fornecedores.` };
  const fornecedores: PedidoDeCotacao['fornecedores'] = [];
  const vistos = new Set<string>();
  for (const bruto of brutos) {
    const f = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
    const fornecedorId = typeof f.fornecedorId === 'string' && ID_VALIDO.test(f.fornecedorId) ? f.fornecedorId : '';
    const nome = texto(f.nome, TEXTO_CURTO_MAX);
    if (!fornecedorId || !nome) return { erro: 'Um dos fornecedores está sem cadastro. Escolha o fornecedor de novo.' };
    if (vistos.has(fornecedorId)) return { erro: `O fornecedor ${nome} está repetido.` };
    vistos.add(fornecedorId);
    fornecedores.push({ fornecedorId, nome, email: texto(f.email, TEXTO_CURTO_MAX), celular: texto(f.celular, 30) });
  }
  const responderAte = typeof c.responderAte === 'string' && DATA_ISO.test(c.responderAte) ? c.responderAte : '';
  if (!responderAte) return { erro: 'Informe até quando os fornecedores podem responder.' };
  return { pedido: { titulo, itens: itensLidos.itens, fornecedores, responderAte, observacao: texto(c.observacao, OBSERVACAO_MAX) } };
};

/** "Responder ate'" padrao: hoje + 7 dias (AAAA-MM-DD). */
export const responderAtePadrao = (hojeIso: string, dias = DIAS_PADRAO_PARA_RESPONDER): string => {
  const d = new Date(`${hojeIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

/** O link ainda aceita resposta? (ate' o fim do dia, no fuso da loja). */
export const cotacaoVencida = (responderAte: string, hojeIso: string): boolean => Boolean(responderAte) && hojeIso > responderAte;

export const linkDaCotacao = (origem: string, token: string): string => `${origem.replace(/\/$/, '')}/cotacao/${token}`;

/** Texto do convite (WhatsApp/e-mail) com o link e o codigo. */
export const textoDoConvite = (args: { empresa: string; titulo: string; link: string; codigoAcesso: string; responderAte: string }): string => (
  `Olá! ${args.empresa} pede uma cotação: ${args.titulo}.\n`
  + `Acesse ${args.link} e informe o código ${args.codigoAcesso} para ver os itens e enviar seus preços.\n`
  + `Prazo para responder: ${args.responderAte.split('-').reverse().join('/')}.`
);

// ---------------------------------------------------------------------------
// RESPOSTA DO FORNECEDOR (link publico)
// ---------------------------------------------------------------------------

export interface RespostaDoFornecedor {
  precos: Record<string, number>;
  prazoEntregaDias: number | null;
  condicaoPagamento: string;
  observacao: string;
}

export const lerRespostaDoFornecedor = (corpo: unknown, itens: ItemDaCotacao[]): { erro: string } | { resposta: RespostaDoFornecedor } => {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  const brutos = (c.precos && typeof c.precos === 'object' ? c.precos : {}) as Record<string, unknown>;
  const precos: Record<string, number> = {};
  for (const item of itens) {
    const v = brutos[item.produtoId];
    if (v === undefined || v === null || v === '') continue;
    const n = numero(v);
    if (!Number.isInteger(n) || n < 0) return { erro: `Preço inválido em ${item.nome}.` };
    if (n > 0) precos[item.produtoId] = n;
  }
  if (Object.keys(precos).length === 0) return { erro: 'Informe o preço de pelo menos um item.' };
  let prazoEntregaDias: number | null = null;
  if (c.prazoEntregaDias !== undefined && c.prazoEntregaDias !== null && c.prazoEntregaDias !== '') {
    const p = numero(c.prazoEntregaDias);
    if (!Number.isInteger(p) || p < 0 || p > 365) return { erro: 'Prazo de entrega inválido (dias).' };
    prazoEntregaDias = p;
  }
  return { resposta: { precos, prazoEntregaDias, condicaoPagamento: texto(c.condicaoPagamento, TEXTO_CURTO_MAX), observacao: texto(c.observacao, OBSERVACAO_MAX) } };
};

/** Por que o fornecedor nao pode (mais) responder; null = pode. */
export const erroParaResponder = (cotacao: Pick<Cotacao, 'status' | 'responderAte'>, hojeIso: string): string | null => {
  if (cotacao.status === 'cancelada') return 'Esta cotação foi cancelada pela empresa.';
  if (cotacao.status === 'fechada') return 'Esta cotação já foi fechada pela empresa. Obrigado pelo interesse.';
  if (cotacaoVencida(cotacao.responderAte, hojeIso)) return `O prazo para responder terminou em ${cotacao.responderAte.split('-').reverse().join('/')}.`;
  return null;
};

export const codigoAcessoValido = (codigo: unknown): boolean => /^\d{6}$/.test(String(codigo || '').trim());

// ---------------------------------------------------------------------------
// COMPARATIVO
// ---------------------------------------------------------------------------

export interface LinhaDoComparativo {
  produtoId: string;
  nome: string;
  codigo: string;
  unidade: string;
  quantidade: number;
  /** fornecedorId -> preco unitario (so' quem cotou o item). */
  precos: Record<string, number>;
  /** Quem deu o menor preco (ou null). */
  melhorFornecedorId: string | null;
}

export interface TotalDoFornecedor {
  fornecedorId: string;
  nome: string;
  status: StatusDoFornecedor;
  itensCotados: number;
  /** Soma (preco x quantidade) dos itens que ele cotou. */
  totalCentavos: number;
  /** Cotou todos os itens? So' assim o total compara com o dos outros. */
  completo: boolean;
  prazoEntregaDias: number | null;
  condicaoPagamento: string;
}

export const montarComparativo = (cotacao: Pick<Cotacao, 'itens' | 'fornecedores'>): { linhas: LinhaDoComparativo[]; totais: TotalDoFornecedor[] } => {
  const respondidos = cotacao.fornecedores.filter((f) => f.status === 'respondida');
  const linhas = cotacao.itens.map((item) => {
    const precos: Record<string, number> = {};
    respondidos.forEach((f) => { const p = f.precos[item.produtoId]; if (p > 0) precos[f.fornecedorId] = p; });
    const melhor = Object.entries(precos).sort((a, b) => a[1] - b[1])[0];
    return { produtoId: item.produtoId, nome: item.nome, codigo: item.codigo, unidade: item.unidade, quantidade: item.quantidade, precos, melhorFornecedorId: melhor ? melhor[0] : null };
  });
  const totais = cotacao.fornecedores.map((f) => {
    const cotados = cotacao.itens.filter((i) => f.precos[i.produtoId] > 0);
    return {
      fornecedorId: f.fornecedorId,
      nome: f.nome,
      status: f.status,
      itensCotados: cotados.length,
      totalCentavos: cotados.reduce((t, i) => t + Math.round(f.precos[i.produtoId] * i.quantidade), 0),
      completo: f.status === 'respondida' && cotados.length === cotacao.itens.length,
      prazoEntregaDias: f.prazoEntregaDias,
      condicaoPagamento: f.condicaoPagamento,
    };
  });
  return { linhas, totais };
};

/** Escolha sugerida: o melhor preco de cada item. */
export const escolhasSugeridas = (linhas: LinhaDoComparativo[]): Record<string, string> => (
  Object.fromEntries(linhas.filter((l) => l.melhorFornecedorId).map((l) => [l.produtoId, l.melhorFornecedorId as string]))
);

export const lerEscolhas = (corpo: unknown, cotacao: Pick<Cotacao, 'itens' | 'fornecedores'>): { erro: string } | { escolhas: Record<string, string> } => {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  const brutas = (c.escolhas && typeof c.escolhas === 'object' ? c.escolhas : {}) as Record<string, unknown>;
  const escolhas: Record<string, string> = {};
  for (const item of cotacao.itens) {
    const fornecedorId = brutas[item.produtoId];
    if (!fornecedorId) continue;
    const f = cotacao.fornecedores.find((x) => x.fornecedorId === fornecedorId);
    if (!f || f.status !== 'respondida' || !(f.precos[item.produtoId] > 0)) return { erro: `${item.nome}: o fornecedor escolhido não cotou este item.` };
    escolhas[item.produtoId] = String(fornecedorId);
  }
  if (Object.keys(escolhas).length === 0) return { erro: 'Escolha o fornecedor de pelo menos um item.' };
  return { escolhas };
};

// ---------------------------------------------------------------------------
// PEDIDO DE COMPRA
// ---------------------------------------------------------------------------

export type StatusPedidoCompra = 'aberto' | 'enviado' | 'recebido' | 'cancelado';

export const ROTULO_STATUS_PEDIDO_COMPRA: Record<StatusPedidoCompra, string> = {
  aberto: 'Aberto',
  enviado: 'Enviado ao fornecedor',
  recebido: 'Recebido',
  cancelado: 'Cancelado',
};

export interface ItemDoPedidoCompra {
  produtoId: string;
  codigo: string;
  nome: string;
  unidade: string;
  quantidade: number;
  precoUnitarioCentavos: number;
  subtotalCentavos: number;
}

export interface PedidoCompra {
  id: string;
  numero: number;
  status: StatusPedidoCompra;
  fornecedorId: string;
  fornecedorNome: string;
  itens: ItemDoPedidoCompra[];
  totalCentavos: number;
  prazoEntregaDias: number | null;
  condicaoPagamento: string;
  observacao: string;
  cotacaoId: string;
  cotacaoNumero: number | null;
  criadoEmIso: string;
  enviadoEmIso: string;
  recebidoEmIso: string;
  canceladoEmIso: string;
}

export interface DadosDoPedidoCompra {
  fornecedorId: string;
  fornecedorNome: string;
  itens: ItemDoPedidoCompra[];
  totalCentavos: number;
  prazoEntregaDias: number | null;
  condicaoPagamento: string;
  observacao: string;
}

export const subtotalDoItem = (quantidade: number, precoUnitarioCentavos: number): number => Math.round(quantidade * precoUnitarioCentavos);

export const lerPedidoDeCompra = (corpo: unknown): { erro: string } | { pedido: DadosDoPedidoCompra } => {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  const fornecedorId = typeof c.fornecedorId === 'string' && ID_VALIDO.test(c.fornecedorId) ? c.fornecedorId : '';
  const fornecedorNome = texto(c.fornecedorNome, TEXTO_CURTO_MAX);
  if (!fornecedorId || !fornecedorNome) return { erro: 'Escolha o fornecedor do pedido.' };
  const lidos = lerItens(c.itens);
  if ('erro' in lidos) return lidos;
  const brutos = Array.isArray(c.itens) ? c.itens as Array<Record<string, unknown>> : [];
  const itens: ItemDoPedidoCompra[] = lidos.itens.map((item, i) => {
    const preco = numero(brutos[i]?.precoUnitarioCentavos);
    return { produtoId: item.produtoId, codigo: item.codigo, nome: item.nome, unidade: item.unidade, quantidade: item.quantidade, precoUnitarioCentavos: Number.isInteger(preco) && preco >= 0 ? preco : -1, subtotalCentavos: 0 };
  });
  const semPreco = itens.find((i) => i.precoUnitarioCentavos < 0);
  if (semPreco) return { erro: `Informe o preço de ${semPreco.nome}.` };
  itens.forEach((i) => { i.subtotalCentavos = subtotalDoItem(i.quantidade, i.precoUnitarioCentavos); });
  let prazoEntregaDias: number | null = null;
  if (c.prazoEntregaDias !== undefined && c.prazoEntregaDias !== null && c.prazoEntregaDias !== '') {
    const p = numero(c.prazoEntregaDias);
    if (!Number.isInteger(p) || p < 0 || p > 365) return { erro: 'Prazo de entrega inválido (dias).' };
    prazoEntregaDias = p;
  }
  return {
    pedido: {
      fornecedorId,
      fornecedorNome,
      itens,
      totalCentavos: itens.reduce((t, i) => t + i.subtotalCentavos, 0),
      prazoEntregaDias,
      condicaoPagamento: texto(c.condicaoPagamento, TEXTO_CURTO_MAX),
      observacao: texto(c.observacao, OBSERVACAO_MAX),
    },
  };
};

/** Um pedido por fornecedor vencedor, com os itens e precos da proposta dele. */
export const pedidosDasEscolhas = (cotacao: Pick<Cotacao, 'itens' | 'fornecedores'>, escolhas: Record<string, string>): DadosDoPedidoCompra[] => {
  const porFornecedor = new Map<string, DadosDoPedidoCompra>();
  for (const item of cotacao.itens) {
    const fornecedorId = escolhas[item.produtoId];
    if (!fornecedorId) continue;
    const f = cotacao.fornecedores.find((x) => x.fornecedorId === fornecedorId);
    if (!f) continue;
    const preco = f.precos[item.produtoId];
    if (!(preco > 0)) continue;
    const pedido = porFornecedor.get(fornecedorId) || {
      fornecedorId,
      fornecedorNome: f.nome,
      itens: [],
      totalCentavos: 0,
      prazoEntregaDias: f.prazoEntregaDias,
      condicaoPagamento: f.condicaoPagamento,
      observacao: '',
    };
    const subtotal = subtotalDoItem(item.quantidade, preco);
    pedido.itens.push({ produtoId: item.produtoId, codigo: item.codigo, nome: item.nome, unidade: item.unidade, quantidade: item.quantidade, precoUnitarioCentavos: preco, subtotalCentavos: subtotal });
    pedido.totalCentavos += subtotal;
    porFornecedor.set(fornecedorId, pedido);
  }
  return [...porFornecedor.values()];
};

/** Transicoes do pedido de compra: aberto -> enviado -> recebido; cancelar antes de receber. */
export const erroParaMudarStatus = (atual: StatusPedidoCompra, novo: StatusPedidoCompra): string | null => {
  if (atual === novo) return null;
  if (atual === 'recebido') return 'Este pedido já foi recebido e não muda mais.';
  if (atual === 'cancelado') return 'Este pedido está cancelado.';
  if (novo === 'aberto') return 'O pedido não volta a Aberto.';
  if (novo === 'recebido' && atual !== 'enviado') return 'Marque o pedido como enviado ao fornecedor antes de receber.';
  return null;
};

export const podeEditarPedido = (status: StatusPedidoCompra): boolean => status === 'aberto';
