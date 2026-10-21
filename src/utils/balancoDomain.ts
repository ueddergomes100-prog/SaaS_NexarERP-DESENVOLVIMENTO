/*
 * BALANCO (INVENTARIO) -- pedido do dono, 21/10/2026.
 *
 * Decisoes do dono (caixinhas):
 *  - o que contar: todos os produtos, grupos (categorias), materia-prima ou
 *    produtos acabados E revenda (tudo que se vende: produzido ou comprado para
 *    revender; fica de fora o item de uso interno);
 *  - varias pessoas contando: o sistema DIVIDE sozinho em blocos, mantendo o
 *    mesmo grupo junto; cada um so' ve e so' conta a sua lista;
 *  - contagem CEGA: quem conta nao ve o saldo do sistema;
 *  - na abertura, opcao de TRAVAR: nada de finalizar venda/PDV nem fechar OS
 *    ate' o balanco acabar (pre-venda continua, porque so' reserva). Sem a
 *    trava, o ajuste e' pela diferenca do MOMENTO da contagem: venda depois da
 *    contagem continua descontando;
 *  - estoque negativo: no fechamento, para o balanco todo, "fica o que
 *    contou" (contou 100 -> 100) ou "desconta o negativo" (sistema -10,
 *    contou 100 -> 90: as 10 vendidas ainda estavam na prateleira);
 *  - item que ninguem contou ZERA no fechamento;
 *  - produto com lote e' contado lote por lote (da' para incluir lote novo);
 *  - sem recontagem.
 *
 * A reserva (pre-venda, OS, condicional) NUNCA e' mexida: o balanco ajusta so'
 * o estoque fisico (`quantidade`); a reserva sai dele quando o documento fecha.
 *
 * Regra pura (tela e servidor): sem Firestore, sem rede.
 */

export type TipoEscopoBalanco = 'todos' | 'grupos' | 'materias_primas' | 'acabados';
export type RegraNegativo = 'contado' | 'descontar';

export const ROTULO_ESCOPO: Record<TipoEscopoBalanco, string> = {
  todos: 'Todos os produtos',
  grupos: 'Grupos escolhidos',
  materias_primas: 'Matéria-prima',
  // 21/10/2026 (dono): o que a loja VENDE -- produzido por ela ou comprado para revender.
  acabados: 'Produtos acabados e revenda',
};

export const ROTULO_REGRA_NEGATIVO: Record<RegraNegativo, string> = {
  contado: 'Fica o que contou',
  descontar: 'Desconta o negativo',
};

/** 'fechando': o fechamento comecou (ajustes em andamento); ninguem conta mais e fechar de novo continua. */
export const STATUS_BALANCO = { contando: 'contando', fechando: 'fechando', fechado: 'fechado', cancelado: 'cancelado' } as const;
export type StatusBalanco = typeof STATUS_BALANCO[keyof typeof STATUS_BALANCO];

export const SEM_GRUPO = 'SEM GRUPO';
export const MAXIMO_DE_CONTADORES = 20;
export const PERMISSAO_BALANCO_GERENCIAR = 'estoque.balanco_gerenciar';
export const PERMISSAO_BALANCO_CONTAR = 'estoque.balanco_contar';

const arred = (v: number, casas = 6) => {
  const f = 10 ** casas;
  return Math.round((Number(v) + Number.EPSILON) * f) / f;
};
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const texto = (v: unknown, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// ---------------------------------------------------------------------------
// Abertura
// ---------------------------------------------------------------------------

export interface EscopoBalanco {
  tipo: TipoEscopoBalanco;
  /** Grupos (categorias) escolhidos -- so' no tipo 'grupos'. */
  categorias: string[];
}

export interface PedidoDeAbertura {
  nome: string;
  escopo: EscopoBalanco;
  contadores: string[];
  travaVendas: boolean;
}

const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;

export const lerPedidoDeAbertura = (corpo: unknown): { erro: string } | { pedido: PedidoDeAbertura } => {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  const nome = texto(c.nome, 80);
  if (nome.length < 3) return { erro: 'Dê um nome ao balanço (mínimo 3 letras), ex.: "BALANÇO OUTUBRO".' };
  const e = (c.escopo && typeof c.escopo === 'object' ? c.escopo : {}) as Record<string, unknown>;
  const tipo = (['todos', 'grupos', 'materias_primas', 'acabados'] as const).find((t) => t === e.tipo);
  if (!tipo) return { erro: 'Escolha o que vai ser contado.' };
  const categorias = Array.isArray(e.categorias)
    ? [...new Set((e.categorias as unknown[]).map((x) => texto(x, 120).toUpperCase()).filter(Boolean))]
    : [];
  if (tipo === 'grupos' && categorias.length === 0) return { erro: 'Escolha pelo menos um grupo para contar.' };
  if (!Array.isArray(c.contadores) || c.contadores.length === 0) return { erro: 'Escolha quem vai contar (pelo menos uma pessoa).' };
  const contadores = [...new Set((c.contadores as unknown[]).map((x) => String(x ?? '')))];
  if (contadores.some((u) => !ID_VALIDO.test(u))) return { erro: 'Uma das pessoas escolhidas é inválida. Atualize a tela.' };
  if (contadores.length > MAXIMO_DE_CONTADORES) return { erro: `No máximo ${MAXIMO_DE_CONTADORES} pessoas contando no mesmo balanço.` };
  return { pedido: { nome: nome.toUpperCase(), escopo: { tipo, categorias: tipo === 'grupos' ? categorias : [] }, contadores, travaVendas: c.travaVendas === true } };
};

export interface ProdutoParaEscopo {
  categoria?: unknown;
  temGrade?: unknown;
  ativo?: unknown;
  statusAtivo?: unknown;
  /** Produzido pela loja: entra em "acabados e revenda" como qualquer item de venda. */
  produzidoInternamente?: unknown;
  /** false = uso interno (embalagem, consumo, semiacabado): nao se vende. Ausente = revenda. */
  produtoRevenda?: unknown;
  avancado?: { produtoRevenda?: unknown } | null;
}

/** O item e' vendido? (produtoRevenda desmarcado no cadastro = uso interno; cadastro antigo guardava em `avancado`.) */
export const itemDeVenda = (p: ProdutoParaEscopo): boolean => (p.produtoRevenda ?? p.avancado?.produtoRevenda ?? true) !== false;

/** Grupo (categoria) do item, normalizado; sem grupo = "SEM GRUPO". */
export const grupoDoItem = (p: { categoria?: unknown }): string => texto(p.categoria, 120).toUpperCase() || SEM_GRUPO;

/** Produto do `estoque` entra no balanco? (principal de grade nao tem estoque; inativo fica de fora.) */
export const produtoEntraNoEscopo = (p: ProdutoParaEscopo, escopo: EscopoBalanco): boolean => {
  if (p.temGrade === true || p.ativo === false || p.statusAtivo === false) return false;
  if (escopo.tipo === 'grupos') return escopo.categorias.includes(grupoDoItem(p));
  // Acabados e revenda (21/10/2026): produzido ou comprado para revender -- tudo que se vende.
  if (escopo.tipo === 'acabados') return itemDeVenda(p);
  return escopo.tipo === 'todos';
};

// ---------------------------------------------------------------------------
// Divisao entre quem conta
// ---------------------------------------------------------------------------

export interface ItemParaDividir { chave: string; grupo: string; nome: string }

export interface Bloco {
  contadorUid: string;
  grupos: Array<{ nome: string; itens: number }>;
  itens: number;
}

/**
 * Divide os itens em partes quase iguais mantendo o mesmo grupo junto: grupo
 * maior que a parte de cada um e' cortado (em ordem alfabetica) em pedacos do
 * tamanho da parte; os pedacos vao, do maior para o menor, para quem esta' com
 * menos itens. Sempre o mesmo resultado para a mesma entrada.
 */
export const dividirEmBlocos = (itens: ItemParaDividir[], contadores: string[]): { porItem: Record<string, string>; blocos: Bloco[] } => {
  const porGrupo = new Map<string, ItemParaDividir[]>();
  itens.forEach((i) => porGrupo.set(i.grupo, [...(porGrupo.get(i.grupo) || []), i]));
  const parte = Math.max(1, Math.ceil(itens.length / Math.max(1, contadores.length)));
  const pedacos: Array<{ grupo: string; itens: ItemParaDividir[] }> = [];
  [...porGrupo.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([grupo, lista]) => {
    const ordenada = [...lista].sort((a, b) => a.nome.localeCompare(b.nome) || a.chave.localeCompare(b.chave));
    for (let i = 0; i < ordenada.length; i += parte) pedacos.push({ grupo, itens: ordenada.slice(i, i + parte) });
  });
  pedacos.sort((a, b) => b.itens.length - a.itens.length || a.grupo.localeCompare(b.grupo));
  const carga = new Map(contadores.map((u) => [u, 0]));
  const blocos = new Map<string, Bloco>(contadores.map((u) => [u, { contadorUid: u, grupos: [], itens: 0 }]));
  const porItem: Record<string, string> = {};
  pedacos.forEach((p) => {
    const quem = [...carga.entries()].sort((a, b) => a[1] - b[1] || contadores.indexOf(a[0]) - contadores.indexOf(b[0]))[0][0];
    carga.set(quem, (carga.get(quem) || 0) + p.itens.length);
    const bloco = blocos.get(quem)!;
    const existente = bloco.grupos.find((g) => g.nome === p.grupo);
    if (existente) existente.itens += p.itens.length; else bloco.grupos.push({ nome: p.grupo, itens: p.itens.length });
    bloco.itens += p.itens.length;
    p.itens.forEach((i) => { porItem[i.chave] = quem; });
  });
  blocos.forEach((b) => b.grupos.sort((x, y) => x.nome.localeCompare(y.nome)));
  return { porItem, blocos: contadores.map((u) => blocos.get(u)!) };
};

// ---------------------------------------------------------------------------
// Contagem
// ---------------------------------------------------------------------------

export interface UnidadeDoItem { fracionado: boolean; casas: number; sigla: string }

/** Quantidade informada vale para a unidade do item? (UN nao aceita fracao.) */
export const erroDaQuantidade = (quantidade: number, unidade: UnidadeDoItem, nome: string): string | null => {
  if (!Number.isFinite(quantidade) || quantidade < 0) return `${nome}: informe uma quantidade de zero para cima.`;
  if (!unidade.fracionado && !Number.isInteger(quantidade)) return `${nome} é contado em ${unidade.sigla}, sem fração. Informe um número inteiro.`;
  if (unidade.fracionado && unidade.casas >= 0) {
    const f = 10 ** unidade.casas;
    if (Math.abs(quantidade * f - Math.round(quantidade * f)) > 1e-6) return `${nome}: use no máximo ${unidade.casas} casa(s) decimal(is).`;
  }
  return null;
};

/** 'somar' acrescenta ao que ja' foi contado (o item em dois lugares); 'definir' troca o total. */
export const novoTotalContado = (atual: number | null | undefined, quantidade: number, modo: 'somar' | 'definir'): number => (
  modo === 'somar' ? arred(num(atual) + quantidade) : arred(quantidade)
);

// ---------------------------------------------------------------------------
// Fechamento
// ---------------------------------------------------------------------------

export interface LoteDoBalanco {
  loteId: string | null;
  lote: string;
  validade: string;
  contado: number | null;
  /** Saldo do lote no momento da contagem; null = nunca contado (zera, pelo saldo do fechamento). */
  saldoNaContagem: number | null;
}

export interface ItemDoBalanco {
  chave: string;
  colecao: string;
  produtoId: string;
  nome: string;
  controlaLote: boolean;
  contado: number | null;
  /** Saldo do produto no momento da (primeira) contagem. null = ninguem contou. */
  saldoNaContagem: number | null;
  lotes: LoteDoBalanco[];
}

export interface AjusteDoFechamento {
  chave: string;
  colecao: string;
  produtoId: string;
  nome: string;
  antes: number;
  depois: number;
  delta: number;
  naoContado: boolean;
  lotes: Array<{ loteId: string | null; lote: string; validade: string; antes: number; depois: number; delta: number }>;
}

/** O total contado do item (soma dos lotes, no produto com lote). null = ninguem contou nada. */
export const totalContado = (item: Pick<ItemDoBalanco, 'controlaLote' | 'contado' | 'lotes'>): number | null => {
  if (!item.controlaLote) return item.contado ?? null;
  const contados = item.lotes.filter((l) => l.contado !== null && l.contado !== undefined);
  return contados.length === 0 ? null : arred(contados.reduce((s, l) => s + num(l.contado), 0));
};

/**
 * Quanto o estoque vai ficar. Pela diferenca do MOMENTO da contagem:
 *   alvo = contado (ou contado + negativo, na regra "desconta o negativo");
 *   delta = alvo - saldo na contagem;  depois = saldo agora + delta.
 * Com a trava, saldo agora = saldo na contagem, entao depois = alvo. Nao contado
 * = contado 0 com o saldo de agora (zera).
 */
export const ajusteDoItem = (
  item: ItemDoBalanco,
  saldoAgora: number,
  saldoDosLotesAgora: Record<string, number>,
  regra: RegraNegativo,
): AjusteDoFechamento => {
  const contado = totalContado(item);
  const naoContado = contado === null;
  const base = naoContado || item.saldoNaContagem === null ? saldoAgora : num(item.saldoNaContagem);
  const alvo = naoContado ? 0 : (regra === 'descontar' && base < 0 ? arred(num(contado) + base) : num(contado));
  const delta = arred(alvo - base);
  const lotes = item.controlaLote ? item.lotes.map((l) => {
    const agoraLote = l.loteId ? num(saldoDosLotesAgora[l.loteId]) : 0;
    const baseLote = l.contado === null || l.saldoNaContagem === null ? agoraLote : num(l.saldoNaContagem);
    const alvoLote = l.contado === null ? 0 : num(l.contado);
    const d = arred(alvoLote - baseLote);
    return { loteId: l.loteId, lote: l.lote, validade: l.validade, antes: agoraLote, depois: arred(Math.max(0, agoraLote + d)), delta: d };
  }) : [];
  return { chave: item.chave, colecao: item.colecao, produtoId: item.produtoId, nome: item.nome, antes: saldoAgora, depois: arred(saldoAgora + delta), delta, naoContado, lotes };
};

/** Resumo da conferencia (o que o gestor ve antes de fechar). */
export const resumoDoFechamento = (ajustes: AjusteDoFechamento[]) => ({
  itens: ajustes.length,
  naoContados: ajustes.filter((a) => a.naoContado).length,
  comDiferenca: ajustes.filter((a) => Math.abs(a.delta) > 1e-9).length,
  sobras: ajustes.filter((a) => a.delta > 1e-9).length,
  faltas: ajustes.filter((a) => a.delta < -1e-9).length,
});

/** Itens com saldo negativo na contagem: a escolha "fica o que contou" x "desconta o negativo" muda o resultado deles. */
export const itensNegativos = (itens: ItemDoBalanco[]): ItemDoBalanco[] => (
  itens.filter((i) => totalContado(i) !== null && i.saldoNaContagem !== null && num(i.saldoNaContagem) < 0)
);

// ---------------------------------------------------------------------------
// Trava de vendas
// ---------------------------------------------------------------------------

export interface TravaDoBalanco { balancoId?: unknown; nome?: unknown; travaVendas?: unknown }

/** Mensagem que bloqueia venda/PDV/OS quando ha' balanco com trava aberto; null = pode. */
export const bloqueioPorBalanco = (trava: TravaDoBalanco | null | undefined, acao: string): string | null => (
  trava && trava.travaVendas === true
    ? `O balanço "${texto(trava.nome, 80) || 'em andamento'}" está aberto com as vendas travadas: não dá para ${acao} até ele ser fechado ou cancelado em Estoque › Balanço. Pré-venda continua liberada.`
    : null
);
