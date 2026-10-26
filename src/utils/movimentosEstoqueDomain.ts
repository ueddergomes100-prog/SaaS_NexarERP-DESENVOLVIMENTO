/**
 * MOVIMENTACAO DE PRODUTOS (26/10/2026, pedido do dono).
 *
 * "Uma tela onde consigo ver todas as movimentacoes de entrada e saida do
 * estoque, com filtros de materia-prima e item acabado." Decisoes (caixinhas):
 * - montada a partir dos documentos JA' gravados (mostra o passado tambem),
 *   sem um extrato novo -- cada origem abaixo vira linhas de movimento;
 * - "acabado" = produto que a fabrica produz (tem receita ou ja' saiu de uma
 *   ordem de producao); revenda, semiacabado, materia-prima e insumo a parte;
 * - filtros: periodo, produto, tipo do item, entrada/saida, origem, categoria;
 * - lista geral + extrato do produto com saldo antes/depois de cada movimento.
 *
 * Regra pura: o servidor (server/services/movimentosEstoque.js) le os documentos,
 * troca as datas do Firestore por milissegundos e chama os montadores daqui.
 *
 * Origens e de onde vem cada uma (levantamento de 26/10):
 * - venda / PDV: pedidos_venda finalizado (sem entrega futura), saida em dataVenda;
 *   cancelado depois de finalizado (tem canceladaEm): entrada em canceladaEm.
 * - devolucao de venda: devolucoes_venda (entrada em createdAt; estornada: saida em estornadaEm).
 * - OS: ordens_de_servico com estoqueBaixado, saida em finalizadaEm (ou dataSaida).
 *   Reabrir/cancelar devolvendo apaga o que saiu: so' a ultima baixa que vale aparece.
 * - entrega futura: entregas_futuras (saida em createdAt, quantidadeBase).
 * - compra (NF-e de entrada): notas_fiscais_entrada (entrada em createdAt; excluida:
 *   saida na ultima alteracao). Nota de transferencia fica de fora (ja' esta nos ajustes).
 * - nota avulsa: notas_avulsas (entrada em createdAt; cancelada: saida em canceladoEm).
 * - devolucao de compra: devolucoes_compra (saida em createdAt).
 * - producao: ordens_producao finalizada (consumo = saida dos componentes, producao =
 *   entrada do produto, em dataFim); estornada: o contrario em dataEstorno.
 * - ajustes_estoque: ajuste manual, balanco, transferencias, trocas e inativacao.
 * Reserva (pre-venda, condicional, OS aberta) nao mexe no estoque fisico: fica fora.
 */

export const PERMISSAO_MOVIMENTACAO = 'estoque.movimentacao';

/** Colecao do item. */
export type ColecaoDoItem = 'estoque' | 'materias_primas' | 'insumos';

export type TipoMovimento = 'entrada' | 'saida';

export type OrigemMovimento =
  | 'venda' | 'pdv' | 'venda_cancelada'
  | 'devolucao_venda' | 'devolucao_venda_estornada'
  | 'os' | 'entrega_futura'
  | 'compra' | 'compra_excluida'
  | 'nota_avulsa' | 'nota_avulsa_cancelada'
  | 'devolucao_compra'
  | 'producao_consumo' | 'producao_entrada' | 'producao_estorno'
  | 'ajuste' | 'balanco' | 'transferencia' | 'troca';

/** Grupos do filtro "Origem do movimento". */
export type GrupoOrigem =
  | 'venda' | 'pdv' | 'os' | 'entrega_futura' | 'compra' | 'nota_avulsa'
  | 'devolucao_venda' | 'devolucao_compra' | 'producao' | 'ajuste' | 'balanco' | 'transferencia' | 'troca';

export const GRUPO_DA_ORIGEM: Record<OrigemMovimento, GrupoOrigem> = {
  venda: 'venda', venda_cancelada: 'venda', pdv: 'pdv',
  devolucao_venda: 'devolucao_venda', devolucao_venda_estornada: 'devolucao_venda',
  os: 'os', entrega_futura: 'entrega_futura',
  compra: 'compra', compra_excluida: 'compra',
  nota_avulsa: 'nota_avulsa', nota_avulsa_cancelada: 'nota_avulsa',
  devolucao_compra: 'devolucao_compra',
  producao_consumo: 'producao', producao_entrada: 'producao', producao_estorno: 'producao',
  ajuste: 'ajuste', balanco: 'balanco', transferencia: 'transferencia', troca: 'troca',
};

export const ROTULO_GRUPO_ORIGEM: Record<GrupoOrigem, string> = {
  venda: 'Venda (Pedido de Venda)',
  pdv: 'PDV / Frente de Caixa',
  os: 'Ordem de Serviço',
  entrega_futura: 'Entrega futura',
  compra: 'Compra (NF-e de entrada)',
  nota_avulsa: 'Nota avulsa',
  devolucao_venda: 'Devolução de venda',
  devolucao_compra: 'Devolução de compra',
  producao: 'Produção',
  ajuste: 'Ajuste manual',
  balanco: 'Balanço',
  transferencia: 'Transferência entre filiais',
  troca: 'Troca',
};

export const ROTULO_ORIGEM: Record<OrigemMovimento, string> = {
  venda: 'Venda',
  pdv: 'Venda no PDV',
  venda_cancelada: 'Venda cancelada (volta ao estoque)',
  devolucao_venda: 'Devolução de venda',
  devolucao_venda_estornada: 'Devolução estornada',
  os: 'Peça na OS',
  entrega_futura: 'Entrega futura',
  compra: 'Compra (NF-e)',
  compra_excluida: 'NF-e de entrada excluída',
  nota_avulsa: 'Nota avulsa',
  nota_avulsa_cancelada: 'Nota avulsa cancelada',
  devolucao_compra: 'Devolução ao fornecedor',
  producao_consumo: 'Consumo na produção',
  producao_entrada: 'Produção (entrada do produto)',
  producao_estorno: 'Estorno da produção',
  ajuste: 'Ajuste manual',
  balanco: 'Balanço',
  transferencia: 'Transferência',
  troca: 'Troca entregue',
};

/** Tipo do item (filtro): o produto do estoque e' classificado pelo cadastro. */
export type TipoDoItem = 'acabado' | 'semiacabado' | 'revenda' | 'materia_prima' | 'insumo';

export const ROTULO_TIPO_ITEM: Record<TipoDoItem, string> = {
  acabado: 'Produto acabado',
  semiacabado: 'Semiacabado / uso interno',
  revenda: 'Revenda',
  materia_prima: 'Matéria-prima',
  insumo: 'Insumo',
};

export interface MovimentoEstoque {
  /** Unico: origem + documento + item + evento. */
  id: string;
  dataMillis: number;
  tipo: TipoMovimento;
  /** Sempre positiva, na unidade do estoque (o sinal vem de `tipo`). */
  quantidade: number;
  origem: OrigemMovimento;
  colecao: ColecaoDoItem;
  itemId: string;
  itemNome: string;
  /** "Pedido #0104", "NF-e 512", "OP 0003"... */
  documento: string;
  /** Rota para abrir o documento na tela (quando existe). */
  rota?: string;
  /** Cliente, fornecedor ou observacao curta. */
  pessoa?: string;
  /** Motivo do ajuste (codigo de ajusteEstoqueDomain) ou detalhe. */
  motivo?: string;
  usuario?: string;
  lote?: string;
}

/** Dados do item que a tela usa (codigo, unidade, categoria e tipo). */
export interface ItemDaMovimentacao {
  chave: string;
  colecao: ColecaoDoItem;
  id: string;
  nome: string;
  codigo: string;
  unidade: string;
  categoria: string;
  tipo: TipoDoItem;
  casasDecimais: number;
  /** Saldo atual do cadastro. */
  saldoAtual: number;
}

export const chaveDoItem = (colecao: ColecaoDoItem, id: string) => `${colecao}:${id}`;

// ---------------------------------------------------------------------------
// Datas e numeros
// ---------------------------------------------------------------------------

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Dia (AAAA-MM-DD) -> meio-dia de Brasilia em ms (o documento so' tem o dia). */
export const millisDoDia = (ymd: string): number | null => {
  if (!YMD.test(String(ymd || ''))) return null;
  const [a, m, d] = ymd.split('-').map(Number);
  return Date.UTC(a, m - 1, d, 15, 0, 0);
};

/** Inicio e fim do dia de Brasilia (UTC-3) em ms. */
export const inicioDoDiaMillis = (ymd: string): number => {
  const [a, m, d] = ymd.split('-').map(Number);
  return Date.UTC(a, m - 1, d, 3, 0, 0);
};
export const fimDoDiaMillis = (ymd: string): number => inicioDoDiaMillis(ymd) + 24 * 60 * 60 * 1000 - 1;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Quantidade na unidade do estoque (mesma conta de embalagemDomain.toBaseQuantity). */
export const quantidadeBase = (quantidade: unknown, fator: unknown): number => {
  const f = num(fator) > 0 ? num(fator) : 1;
  return Math.round(num(quantidade) * f * 1e6) / 1e6;
};

const txt = (v: unknown) => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v));

const COLECAO_DO_TIPO_NOTA: Record<string, ColecaoDoItem> = { revenda: 'estoque', materia_prima: 'materias_primas', insumo: 'insumos' };

// ---------------------------------------------------------------------------
// Montadores: um documento -> linhas de movimento
// (as datas ja' vem em ms; `null` = o documento nao tem a data)
// ---------------------------------------------------------------------------

interface ItemComQtd { id?: unknown; nome?: unknown; quantidade?: unknown; fatorConversao?: unknown }

export interface PedidoParaMovimento {
  id: string;
  numeroPedido?: unknown;
  clienteNome?: unknown;
  status?: unknown;
  origem?: unknown;
  sourceOrigin?: unknown;
  entregaFutura?: unknown;
  dataVenda?: unknown;
  canceladaEmMillis?: number | null;
  vendedorNome?: unknown;
  itens?: ItemComQtd[];
}

/** Venda/PDV: saida no dia da venda; cancelada depois de finalizada: entrada no cancelamento. */
export const movimentosDoPedido = (p: PedidoParaMovimento): MovimentoEstoque[] => {
  if (p.entregaFutura === true) return []; // sai pelas entregas
  const finalizada = p.status === 'Finalizada';
  const canceladaDepoisDeVendida = p.status === 'Cancelada' && typeof p.canceladaEmMillis === 'number';
  if (!finalizada && !canceladaDepoisDeVendida) return [];
  const pdv = p.origem === 'pdv' || p.sourceOrigin === 'pdv';
  const doc = `${pdv ? 'Venda PDV' : 'Pedido'} #${txt(p.numeroPedido)}`;
  const dataVenda = millisDoDia(txt(p.dataVenda));
  const linhas: MovimentoEstoque[] = [];
  (p.itens || []).forEach((item, i) => {
    const id = txt(item.id);
    if (!id || id === 'avulso') return;
    const quantidade = quantidadeBase(item.quantidade, item.fatorConversao);
    if (quantidade <= 0) return;
    const base = { colecao: 'estoque' as const, itemId: id, itemNome: txt(item.nome), documento: doc, rota: `/pedidos-venda/visualizar/${p.id}`, pessoa: txt(p.clienteNome) || undefined, quantidade };
    if (dataVenda !== null) linhas.push({ ...base, id: `pv:${p.id}:${i}:saida`, dataMillis: dataVenda, tipo: 'saida', origem: pdv ? 'pdv' : 'venda' });
    if (canceladaDepoisDeVendida) linhas.push({ ...base, id: `pv:${p.id}:${i}:cancel`, dataMillis: p.canceladaEmMillis as number, tipo: 'entrada', origem: 'venda_cancelada' });
  });
  return linhas;
};

export interface DevolucaoVendaParaMovimento {
  id: string;
  pedidoVendaId?: unknown;
  numeroPedidoOriginal?: unknown;
  clienteNome?: unknown;
  status?: unknown;
  createdAtMillis?: number | null;
  estornadaEmMillis?: number | null;
  itensDevolvidos?: Array<{ id?: unknown; nome?: unknown; quantidadeDevolvida?: unknown; fatorConversao?: unknown }>;
}

export const movimentosDaDevolucaoVenda = (d: DevolucaoVendaParaMovimento): MovimentoEstoque[] => {
  const doc = `Devolução do pedido #${txt(d.numeroPedidoOriginal)}`;
  const linhas: MovimentoEstoque[] = [];
  (d.itensDevolvidos || []).forEach((item, i) => {
    const id = txt(item.id);
    const quantidade = quantidadeBase(item.quantidadeDevolvida, item.fatorConversao);
    if (!id || id === 'avulso' || quantidade <= 0) return;
    const base = { colecao: 'estoque' as const, itemId: id, itemNome: txt(item.nome), documento: doc, rota: d.pedidoVendaId ? `/pedidos-venda/visualizar/${txt(d.pedidoVendaId)}` : undefined, pessoa: txt(d.clienteNome) || undefined, quantidade };
    if (typeof d.createdAtMillis === 'number') linhas.push({ ...base, id: `dv:${d.id}:${i}:entrada`, dataMillis: d.createdAtMillis, tipo: 'entrada', origem: 'devolucao_venda' });
    if (d.status === 'estornada' && typeof d.estornadaEmMillis === 'number') {
      linhas.push({ ...base, id: `dv:${d.id}:${i}:estorno`, dataMillis: d.estornadaEmMillis, tipo: 'saida', origem: 'devolucao_venda_estornada' });
    }
  });
  return linhas;
};

export interface OsParaMovimento {
  id: string;
  numeroOS?: unknown;
  clienteNome?: unknown;
  estoqueBaixado?: unknown;
  dataSaida?: unknown;
  finalizadaEmMillis?: number | null;
  pecas?: ItemComQtd[];
  pecasBaixadas?: ItemComQtd[];
}

/** OS: so' a baixa que esta valendo (reabrir/cancelar devolvendo apaga a lista do que saiu). */
export const movimentosDaOS = (o: OsParaMovimento): MovimentoEstoque[] => {
  if (o.estoqueBaixado !== true) return [];
  const data = typeof o.finalizadaEmMillis === 'number' ? o.finalizadaEmMillis : millisDoDia(txt(o.dataSaida));
  if (data === null) return [];
  const pecas = Array.isArray(o.pecasBaixadas) && o.pecasBaixadas.length > 0 ? o.pecasBaixadas : (o.pecas || []);
  return pecas.flatMap((item, i) => {
    const id = txt(item.id);
    const quantidade = num(item.quantidade); // OS nao tem fator de embalagem
    if (!id || id === 'avulso' || quantidade <= 0) return [];
    return [{ id: `os:${o.id}:${i}`, dataMillis: data, tipo: 'saida' as const, quantidade, origem: 'os' as const, colecao: 'estoque' as const, itemId: id, itemNome: txt(item.nome), documento: `OS #${txt(o.numeroOS)}`, rota: `/os/editar/${o.id}`, pessoa: txt(o.clienteNome) || undefined }];
  });
};

export interface EntregaFuturaParaMovimento {
  id: string;
  pedidoId?: unknown;
  pedidoNumero?: unknown;
  numero?: unknown;
  clienteNome?: unknown;
  createdAtMillis?: number | null;
  itens?: Array<{ id?: unknown; nome?: unknown; quantidade?: unknown; quantidadeBase?: unknown; fatorConversao?: unknown }>;
}

export const movimentosDaEntregaFutura = (e: EntregaFuturaParaMovimento): MovimentoEstoque[] => {
  if (typeof e.createdAtMillis !== 'number') return [];
  const doc = `Entrega ${txt(e.numero) || ''} do pedido #${txt(e.pedidoNumero)}`.replace('  ', ' ');
  return (e.itens || []).flatMap((item, i) => {
    const id = txt(item.id);
    const quantidade = item.quantidadeBase !== undefined ? num(item.quantidadeBase) : quantidadeBase(item.quantidade, item.fatorConversao);
    if (!id || quantidade <= 0) return [];
    return [{ id: `ef:${e.id}:${i}`, dataMillis: e.createdAtMillis as number, tipo: 'saida' as const, quantidade, origem: 'entrega_futura' as const, colecao: 'estoque' as const, itemId: id, itemNome: txt(item.nome), documento: doc, rota: e.pedidoId ? `/pedidos-venda/visualizar/${txt(e.pedidoId)}` : undefined, pessoa: txt(e.clienteNome) || undefined }];
  });
};

export interface NotaEntradaParaMovimento {
  id: string;
  numeroNF?: unknown;
  fornecedorNome?: unknown;
  status?: unknown;
  transferenciaId?: unknown;
  createdAtMillis?: number | null;
  alteradoEmMillis?: number | null;
  itens?: Array<{ itemId?: unknown; descricao?: unknown; nome?: unknown; tipo?: unknown; quantidade?: unknown; quantidadeEstoque?: unknown }>;
}

/** Compra pela NF-e de entrada. A nota da transferencia fica de fora (ja' esta' nos ajustes). */
export const movimentosDaNotaEntrada = (n: NotaEntradaParaMovimento): MovimentoEstoque[] => {
  if (txt(n.transferenciaId)) return [];
  if (typeof n.createdAtMillis !== 'number') return [];
  const doc = `NF-e ${txt(n.numeroNF)}`.trim();
  const excluida = n.status === 'excluida';
  const linhas: MovimentoEstoque[] = [];
  (n.itens || []).forEach((item, i) => {
    const colecao = COLECAO_DO_TIPO_NOTA[txt(item.tipo)];
    const id = txt(item.itemId);
    if (!colecao || !id) return; // 'registro' nao mexe no estoque
    const quantidade = item.quantidadeEstoque !== undefined && item.quantidadeEstoque !== null ? num(item.quantidadeEstoque) : num(item.quantidade);
    if (quantidade <= 0) return;
    const base = { colecao, itemId: id, itemNome: txt(item.nome) || txt(item.descricao), documento: doc, rota: '/fiscal/entrada-nfe/historico', pessoa: txt(n.fornecedorNome) || undefined, quantidade };
    linhas.push({ ...base, id: `nfe:${n.id}:${i}:entrada`, dataMillis: n.createdAtMillis as number, tipo: 'entrada', origem: 'compra' });
    if (excluida && typeof n.alteradoEmMillis === 'number') {
      linhas.push({ ...base, id: `nfe:${n.id}:${i}:exclusao`, dataMillis: n.alteradoEmMillis, tipo: 'saida', origem: 'compra_excluida' });
    }
  });
  return linhas;
};

export interface NotaAvulsaParaMovimento {
  id: string;
  numero?: unknown;
  fornecedorNome?: unknown;
  status?: unknown;
  createdAtMillis?: number | null;
  canceladoEmMillis?: number | null;
  itens?: Array<{ produtoId?: unknown; nome?: unknown; produtoNome?: unknown; quantidade?: unknown; quantidadeBase?: unknown }>;
}

export const movimentosDaNotaAvulsa = (n: NotaAvulsaParaMovimento): MovimentoEstoque[] => {
  if (typeof n.createdAtMillis !== 'number') return [];
  const doc = `Nota avulsa ${txt(n.numero)}`.trim();
  const linhas: MovimentoEstoque[] = [];
  (n.itens || []).forEach((item, i) => {
    const id = txt(item.produtoId);
    const quantidade = item.quantidadeBase !== undefined && item.quantidadeBase !== null ? num(item.quantidadeBase) : num(item.quantidade);
    if (!id || quantidade <= 0) return;
    const base = { colecao: 'estoque' as const, itemId: id, itemNome: txt(item.produtoNome) || txt(item.nome), documento: doc, rota: '/estoque/notas-avulsas', pessoa: txt(n.fornecedorNome) || undefined, quantidade };
    linhas.push({ ...base, id: `na:${n.id}:${i}:entrada`, dataMillis: n.createdAtMillis as number, tipo: 'entrada', origem: 'nota_avulsa' });
    if (n.status === 'cancelada' && typeof n.canceladoEmMillis === 'number') {
      linhas.push({ ...base, id: `na:${n.id}:${i}:cancel`, dataMillis: n.canceladoEmMillis, tipo: 'saida', origem: 'nota_avulsa_cancelada' });
    }
  });
  return linhas;
};

export interface DevolucaoCompraParaMovimento {
  id: string;
  notaNumero?: unknown;
  fornecedorNome?: unknown;
  createdAtMillis?: number | null;
  itens?: Array<{ itemId?: unknown; nome?: unknown; descricao?: unknown; tipo?: unknown; quantidade?: unknown; quantidadeEstoque?: unknown }>;
}

export const movimentosDaDevolucaoCompra = (d: DevolucaoCompraParaMovimento): MovimentoEstoque[] => {
  if (typeof d.createdAtMillis !== 'number') return [];
  const doc = `Devolução da NF-e ${txt(d.notaNumero)}`.trim();
  return (d.itens || []).flatMap((item, i) => {
    const colecao = COLECAO_DO_TIPO_NOTA[txt(item.tipo)];
    const id = txt(item.itemId);
    const quantidade = item.quantidadeEstoque !== undefined && item.quantidadeEstoque !== null ? num(item.quantidadeEstoque) : num(item.quantidade);
    if (!colecao || !id || quantidade <= 0) return [];
    return [{ id: `dc:${d.id}:${i}`, dataMillis: d.createdAtMillis as number, tipo: 'saida' as const, quantidade, origem: 'devolucao_compra' as const, colecao, itemId: id, itemNome: txt(item.nome) || txt(item.descricao), documento: doc, pessoa: txt(d.fornecedorNome) || undefined }];
  });
};

export interface ProducaoParaMovimento {
  id: string;
  numero?: unknown;
  produtoId?: unknown;
  produtoNome?: unknown;
  status?: unknown;
  quantidadeProduzida?: unknown;
  dataFimMillis?: number | null;
  dataEstornoMillis?: number | null;
  itensConsumidos?: Array<{ componenteId?: unknown; componenteNome?: unknown; origem?: unknown; quantidadeConsumida?: unknown }>;
}

/** Producao finalizada: componentes saem e o produto entra (dataFim). Estornada: o contrario (dataEstorno). */
export const movimentosDaProducao = (o: ProducaoParaMovimento): MovimentoEstoque[] => {
  const finalizou = o.status === 'finalizada' || o.status === 'estornada';
  if (!finalizou || typeof o.dataFimMillis !== 'number') return [];
  const doc = `Ordem de produção ${txt(o.numero)}`.trim();
  const rota = `/producao/ordens/editar/${o.id}`;
  const eventos: Array<{ quando: number; sufixo: string; estorno: boolean }> = [{ quando: o.dataFimMillis, sufixo: 'fim', estorno: false }];
  if (o.status === 'estornada' && typeof o.dataEstornoMillis === 'number') eventos.push({ quando: o.dataEstornoMillis, sufixo: 'estorno', estorno: true });
  const linhas: MovimentoEstoque[] = [];
  eventos.forEach(({ quando, sufixo, estorno }) => {
    (o.itensConsumidos || []).forEach((c, i) => {
      const id = txt(c.componenteId);
      const quantidade = num(c.quantidadeConsumida);
      if (!id || quantidade <= 0) return;
      const colecao: ColecaoDoItem = c.origem === 'estoque' ? 'estoque' : 'materias_primas';
      linhas.push({ id: `op:${o.id}:c${i}:${sufixo}`, dataMillis: quando, tipo: estorno ? 'entrada' : 'saida', quantidade, origem: estorno ? 'producao_estorno' : 'producao_consumo', colecao, itemId: id, itemNome: txt(c.componenteNome), documento: doc, rota });
    });
    const produtoId = txt(o.produtoId);
    const produzida = num(o.quantidadeProduzida);
    if (produtoId && produzida > 0) {
      linhas.push({ id: `op:${o.id}:p:${sufixo}`, dataMillis: quando, tipo: estorno ? 'saida' : 'entrada', quantidade: produzida, origem: estorno ? 'producao_estorno' : 'producao_entrada', colecao: 'estoque', itemId: produtoId, itemNome: txt(o.produtoNome), documento: doc, rota });
    }
  });
  return linhas;
};

export interface AjusteParaMovimento {
  id: string;
  produtoId?: unknown;
  produtoNome?: unknown;
  origem?: unknown;
  tipo?: unknown;
  quantidade?: unknown;
  motivo?: unknown;
  observacao?: unknown;
  usuarioNome?: unknown;
  lote?: unknown;
  numeroTroca?: unknown;
  createdAtMillis?: number | null;
}

/** ajustes_estoque: ajuste manual, balanco, transferencias, trocas e inativacao. */
export const movimentosDoAjuste = (a: AjusteParaMovimento): MovimentoEstoque[] => {
  const id = txt(a.produtoId);
  const quantidade = Math.abs(num(a.quantidade));
  if (!id || quantidade <= 0 || typeof a.createdAtMillis !== 'number') return [];
  const tipo: TipoMovimento = a.tipo === 'saida' ? 'saida' : 'entrada';
  const motivo = txt(a.motivo);
  const origem: OrigemMovimento = motivo === 'balanco' ? 'balanco'
    : motivo.startsWith('transferencia') ? 'transferencia'
      : motivo === 'troca_cliente' ? 'troca'
        : 'ajuste';
  const colecao: ColecaoDoItem = a.origem === 'materia_prima' ? 'materias_primas' : a.origem === 'insumo' ? 'insumos' : 'estoque';
  const documento = origem === 'balanco' ? 'Balanço'
    : origem === 'troca' ? `Troca ${txt(a.numeroTroca)}`.trim()
      : origem === 'transferencia' ? (txt(a.observacao).match(/Transfer[eê]ncia n[ºo°]\s*\S+/i)?.[0] || 'Transferência')
        : 'Ajuste manual';
  return [{
    id: `aj:${a.id}`, dataMillis: a.createdAtMillis, tipo, quantidade, origem, colecao, itemId: id, itemNome: txt(a.produtoNome), documento,
    motivo: motivo || undefined, usuario: txt(a.usuarioNome) || undefined, lote: txt(a.lote) || undefined,
    pessoa: txt(a.observacao) || undefined,
  }];
};

// ---------------------------------------------------------------------------
// Tipo do item
// ---------------------------------------------------------------------------

/**
 * Produto do estoque: uso interno/semiacabado (produtoRevenda = false), acabado
 * (tem receita ou ja' foi produzido) ou revenda. Os campos podem estar dentro de
 * `avancado` (Configuracoes Avancadas do produto).
 */
export const tipoDoProdutoDoEstoque = (produto: Record<string, unknown>, temReceita: boolean, saiuDeProducao = false): TipoDoItem => {
  const avancado = (produto.avancado && typeof produto.avancado === 'object' ? produto.avancado : {}) as Record<string, unknown>;
  const revenda = produto.produtoRevenda ?? avancado.produtoRevenda;
  if (revenda === false) return 'semiacabado';
  const produzido = temReceita || saiuDeProducao || Boolean(txt(produto.ultimaProducaoData)) || (produto.produzidoInternamente ?? avancado.produzidoInternamente) === true;
  return produzido ? 'acabado' : 'revenda';
};

// ---------------------------------------------------------------------------
// Consulta, filtros, totais e extrato
// ---------------------------------------------------------------------------

export const PERIODO_MAXIMO_DIAS = 366;

export interface FiltroDaConsulta {
  de: string;
  ate: string;
  /** Extrato de um item: le ate' hoje para calcular o saldo de cada linha. */
  itemId?: string;
  colecao?: ColecaoDoItem;
}

export const lerFiltroDaConsulta = (corpo: unknown): { filtro: FiltroDaConsulta } | { erro: string } => {
  const c = (corpo || {}) as Record<string, unknown>;
  const de = txt(c.de);
  const ate = txt(c.ate);
  if (!YMD.test(de) || !YMD.test(ate)) return { erro: 'Informe o período (data inicial e final).' };
  if (de > ate) return { erro: 'A data inicial é depois da data final.' };
  const dias = (inicioDoDiaMillis(ate) - inicioDoDiaMillis(de)) / (24 * 60 * 60 * 1000);
  if (dias > PERIODO_MAXIMO_DIAS) return { erro: 'O período pode ter no máximo um ano. Diminua o intervalo das datas.' };
  const itemId = txt(c.itemId);
  const colecao = txt(c.colecao) as ColecaoDoItem;
  if (itemId) {
    if (itemId.length > 128 || itemId.includes('/')) return { erro: 'Produto inválido.' };
    if (!['estoque', 'materias_primas', 'insumos'].includes(colecao)) return { erro: 'Informe de qual cadastro é o produto.' };
    return { filtro: { de, ate, itemId, colecao } };
  }
  return { filtro: { de, ate } };
};

export interface FiltrosDaTela {
  tipoMovimento: 'todos' | TipoMovimento;
  tiposDoItem: TipoDoItem[];
  grupos: GrupoOrigem[];
  categoria: string;
  busca: string;
}

export const FILTROS_DA_TELA_VAZIOS: FiltrosDaTela = { tipoMovimento: 'todos', tiposDoItem: [], grupos: [], categoria: '', busca: '' };

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const filtrarMovimentos = (
  movimentos: MovimentoEstoque[],
  itens: Record<string, ItemDaMovimentacao>,
  f: FiltrosDaTela,
): MovimentoEstoque[] => {
  const termo = semAcento(f.busca.trim());
  return movimentos.filter((m) => {
    if (f.tipoMovimento !== 'todos' && m.tipo !== f.tipoMovimento) return false;
    if (f.grupos.length > 0 && !f.grupos.includes(GRUPO_DA_ORIGEM[m.origem])) return false;
    const item = itens[chaveDoItem(m.colecao, m.itemId)];
    if (f.tiposDoItem.length > 0 && !(item && f.tiposDoItem.includes(item.tipo))) return false;
    if (f.categoria && (item?.categoria || '') !== f.categoria) return false;
    if (termo) {
      const alvo = semAcento([item?.nome || m.itemNome, item?.codigo || '', m.documento, m.pessoa || ''].join(' '));
      if (!termo.split('+').every((parte) => alvo.includes(parte.trim()))) return false;
    }
    return true;
  });
};

export interface ResumoMovimentos {
  total: number;
  entradas: number;
  saidas: number;
  /** Itens diferentes movimentados. */
  itens: number;
}

export const resumirMovimentos = (movimentos: MovimentoEstoque[]): ResumoMovimentos => ({
  total: movimentos.length,
  entradas: movimentos.filter((m) => m.tipo === 'entrada').length,
  saidas: movimentos.filter((m) => m.tipo === 'saida').length,
  itens: new Set(movimentos.map((m) => chaveDoItem(m.colecao, m.itemId))).size,
});

/** Mais novos primeiro; no mesmo instante, a ordem de montagem. */
export const ordenarMovimentos = (movimentos: MovimentoEstoque[]): MovimentoEstoque[] => (
  movimentos.map((m, i) => ({ m, i })).sort((a, b) => b.m.dataMillis - a.m.dataMillis || a.i - b.i).map((x) => x.m)
);

export interface LinhaDoExtrato extends MovimentoEstoque {
  saldoAntes: number;
  saldoDepois: number;
}

export interface ExtratoDoItem {
  linhas: LinhaDoExtrato[];
  saldoInicial: number;
  saldoFinal: number;
  totalEntradas: number;
  totalSaidas: number;
}

const arred = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Extrato de um item com saldo antes/depois, calculado de tras para frente a
 * partir do saldo ATUAL do cadastro: `movimentos` precisa trazer tudo do inicio
 * do periodo ate' hoje (o que passou de `ateMillis` so' entra na conta do saldo).
 * Mudanca de saldo sem documento (saldo inicial digitado no cadastro, importacao)
 * nao aparece como linha: o saldo inicial do periodo ja' a inclui.
 */
export const extratoDoItem = (movimentos: MovimentoEstoque[], saldoAtual: number, ateMillis: number): ExtratoDoItem => {
  const cronologica = movimentos.map((m, i) => ({ m, i })).sort((a, b) => a.m.dataMillis - b.m.dataMillis || a.i - b.i).map((x) => x.m);
  const efeito = (m: MovimentoEstoque) => (m.tipo === 'entrada' ? m.quantidade : -m.quantidade);
  const somaTudo = cronologica.reduce((s, m) => s + efeito(m), 0);
  let saldo = arred(saldoAtual - somaTudo); // saldo no inicio do periodo
  const saldoInicial = saldo;
  const linhas: LinhaDoExtrato[] = [];
  let totalEntradas = 0;
  let totalSaidas = 0;
  cronologica.forEach((m) => {
    const antes = saldo;
    saldo = arred(saldo + efeito(m));
    if (m.dataMillis > ateMillis) return;
    if (m.tipo === 'entrada') totalEntradas = arred(totalEntradas + m.quantidade);
    else totalSaidas = arred(totalSaidas + m.quantidade);
    linhas.push({ ...m, saldoAntes: antes, saldoDepois: saldo });
  });
  const saldoFinal = linhas.length > 0 ? linhas[linhas.length - 1].saldoDepois : saldoInicial;
  return { linhas, saldoInicial, saldoFinal, totalEntradas, totalSaidas };
};
