import { toCents } from './financeDomain';
import { dateInputToUtcStart, formatDateInputPtBr } from './dateTime';
import { formatarDataRelatorio, type ColunaRelatorio, type IndicadorRelatorio, type SecaoRelatorio } from './relatorioPdfDomain';
import { resolveOrigemPedido, STATUS_PRE_VENDA, type OrigemPedido } from './preVendaDomain';
import { rotuloNotaFiscalPedido } from './pedidoVendedorDomain';

/*
 * RELATORIO DE PRE-VENDAS EM ABERTO (padrao de relatorio, 2026-10-02).
 *
 * A tela /pre-vendas continua com a lista e os filtros; o antigo "Exportar
 * CSV" virou "Gerar relatorio", que abre no RelatorioPreview (PDF paginado,
 * colunas por caixa de marcar, Excel dentro da visualizacao) com exatamente o
 * que esta filtrado na tela.
 *
 * Regras que vieram da tela e continuam valendo aqui:
 *   - pre-venda NAO e' faturamento: o aviso vai em `filtros`, que sai sempre
 *     no cabecalho do papel (indicador a pessoa pode desligar, o aviso nao);
 *   - o quadro de totais (quantidade, valor comprometido, reserva, mais
 *     antiga) e' so' de quem tem acesso total ao tenant (dono/gestor). Sem
 *     esse acesso o papel sai sem indicadores, sem a secao "Por vendedor" e
 *     sem soma de valor na linha de total.
 *
 * Regra pura: sem tela, sem Firestore.
 */

export interface PreVendaDoRelatorio {
  id: string;
  numeroPedido: string;
  clienteNome: string;
  vendedorNome: string;
  origem: OrigemPedido;
  status: string;
  data: Date | null;
  diasEmAberto: number;
  totalCents: number;
  itensCount: number;
  reservaEstoque: boolean;
  /** Marca do vendedor externo (COM/SEM nota fiscal); null = nao informado. */
  comNotaFiscal: boolean | null;
}

const UM_DIA_MS = 86400000;

/** Data do pedido: Timestamp do Firestore, {seconds}, AAAA-MM-DD ou texto de data. */
export const dataDoPedido = (value: any): Date | null => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value.seconds) return new Date(value.seconds * 1000);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return dateInputToUtcStart(value);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * Pedido de `pedidos_venda` (ja' filtrado como aberto e visivel) -> linha do
 * relatorio. `usuarios` e' o mapa id -> dados do usuario, para achar o nome do
 * vendedor quando o pedido nao o gravou.
 */
export const linhaDePreVenda = (pedido: any, usuarios: Record<string, any>, hoje: Date): PreVendaDoRelatorio => {
  const data = dataDoPedido(pedido.dataVenda) || dataDoPedido(pedido.createdAt);
  const vendedor = usuarios[pedido.vendedorId || pedido.usuarioResponsavelId || ''];
  return {
    id: pedido.id,
    numeroPedido: pedido.numeroPedido || '',
    clienteNome: pedido.clienteNome || 'Não informado',
    vendedorNome: pedido.vendedorNome || vendedor?.nome || vendedor?.nomeResponsavel || 'Não identificado',
    origem: resolveOrigemPedido(pedido),
    status: pedido.status || STATUS_PRE_VENDA,
    data,
    diasEmAberto: data ? Math.max(0, Math.floor((hoje.getTime() - data.getTime()) / UM_DIA_MS)) : 0,
    totalCents: Number(pedido.valorTotalCentavos ?? toCents(pedido.valorTotal)),
    itensCount: Array.isArray(pedido.itens) ? pedido.itens.length : 0,
    reservaEstoque: pedido.estoqueReservado === true,
    comNotaFiscal: typeof pedido.comNotaFiscal === 'boolean' ? pedido.comNotaFiscal : null,
  };
};

export interface FiltroPreVendas {
  busca: string;
  origem: '' | OrigemPedido;
  /** AAAA-MM-DD ou vazio. */
  de: string;
  ate: string;
}

/** Os filtros da tela (a ordem pelo numero continua na tela). */
export const filtrarPreVendas = (linhas: PreVendaDoRelatorio[], filtro: FiltroPreVendas): PreVendaDoRelatorio[] => {
  const termo = filtro.busca.trim().toLowerCase();
  const inicio = filtro.de ? dateInputToUtcStart(filtro.de) : null;
  const fim = filtro.ate ? dateInputToUtcStart(filtro.ate) : null;

  return linhas.filter((linha) => {
    if (filtro.origem && linha.origem !== filtro.origem) return false;
    if (inicio && (!linha.data || linha.data < inicio)) return false;
    // Comparacao inclusiva no dia final: soma 1 dia em vez de exigir hora
    // zero, senao uma pre-venda gravada as 14h do dia final ficaria fora.
    if (fim && (!linha.data || linha.data.getTime() >= fim.getTime() + UM_DIA_MS)) return false;
    if (!termo) return true;
    return linha.clienteNome.toLowerCase().includes(termo)
      || linha.numeroPedido.toLowerCase().includes(termo)
      || linha.vendedorNome.toLowerCase().includes(termo);
  });
};

export interface TotaisPreVendas {
  quantidade: number;
  valorCents: number;
  comReserva: number;
  maisAntiga: number;
}

export const totaisPreVendas = (linhas: PreVendaDoRelatorio[]): TotaisPreVendas => ({
  quantidade: linhas.length,
  valorCents: linhas.reduce((soma, linha) => soma + linha.totalCents, 0),
  comReserva: linhas.filter((linha) => linha.reservaEstoque).length,
  maisAntiga: linhas.reduce((maximo, linha) => Math.max(maximo, linha.diasEmAberto), 0),
});

export interface PreVendasDoVendedor {
  vendedorNome: string;
  quantidade: number;
  valorCents: number;
}

export const resumirPreVendasPorVendedor = (linhas: PreVendaDoRelatorio[]): PreVendasDoVendedor[] => {
  const mapa = new Map<string, PreVendasDoVendedor>();
  linhas.forEach((linha) => {
    const atual = mapa.get(linha.vendedorNome) ?? { vendedorNome: linha.vendedorNome, quantidade: 0, valorCents: 0 };
    atual.quantidade += 1;
    atual.valorCents += linha.totalCents;
    mapa.set(linha.vendedorNome, atual);
  });
  return [...mapa.values()].sort((a, b) => b.valorCents - a.valorCents || a.vendedorNome.localeCompare(b.vendedorNome, 'pt-BR'));
};

export const rotuloOrigemPreVenda = (origem: OrigemPedido): string => (origem === 'agente' ? 'Agente (WhatsApp)' : 'Balcão');

/** Sai sempre no cabecalho do papel: o total desta tela e' o mais facil de confundir com faturamento. */
export const AVISO_PRE_VENDA_NAO_E_FATURAMENTO = 'Estes valores não são faturamento: pré-venda em aberto não gerou lançamento financeiro (não entra no caixa, no Relatório de Vendas nem em comissão) e o estoque está reservado, não baixado';

export interface DocumentoPreVendas {
  titulo: string;
  periodo: string;
  filtros: string[];
  indicadores: IndicadorRelatorio[];
  secoes: SecaoRelatorio[];
}

const moeda = (valorCentavos: number): string => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valorCentavos / 100);

/**
 * Monta o documento (sem empresa/geradoPor, que a tela acrescenta) para o
 * RelatorioPreview. `linhas` = exatamente o que esta na tela (filtrado e na
 * ordem escolhida). `podeVerResumo` = hasTenantFullAccess do usuario.
 */
export const montarDocumentoPreVendas = (
  linhas: PreVendaDoRelatorio[],
  filtro: FiltroPreVendas,
  podeVerResumo: boolean,
  agora: Date = new Date(),
): DocumentoPreVendas => {
  const totais = totaisPreVendas(linhas);
  // Sem acesso total, nenhuma coluna soma: a linha de total do papel seria um
  // "resumo" com valor, que a tela nao mostra a esse usuario.
  const semTotal = podeVerResumo ? {} : { total: 'nenhum' as const };

  const colunas: ColunaRelatorio<PreVendaDoRelatorio>[] = [
    { id: 'numero', titulo: 'Número', tipo: 'texto', largura: 16, valor: (l) => l.numeroPedido },
    { id: 'data', titulo: 'Data', tipo: 'data', valor: (l) => l.data },
    // Somar dias nao significa nada: a "mais antiga" esta nos indicadores.
    { id: 'dias', titulo: 'Em aberto (dias)', tipo: 'inteiro', total: 'nenhum', largura: 16, valor: (l) => l.diasEmAberto },
    { id: 'cliente', titulo: 'Cliente', tipo: 'texto', largura: 50, valor: (l) => l.clienteNome },
    { id: 'vendedor', titulo: 'Vendedor', tipo: 'texto', largura: 32, valor: (l) => l.vendedorNome },
    { id: 'origem', titulo: 'Origem', tipo: 'texto', largura: 26, valor: (l) => rotuloOrigemPreVenda(l.origem) },
    { id: 'estoque', titulo: 'Estoque', tipo: 'texto', largura: 20, valor: (l) => (l.reservaEstoque ? 'Reservado' : 'Sem reserva') },
    { id: 'nota', titulo: 'Nota fiscal', tipo: 'texto', largura: 26, valor: (l) => rotuloNotaFiscalPedido(l.comNotaFiscal)?.texto || '' },
    { id: 'status', titulo: 'Status', tipo: 'texto', largura: 20, padrao: false, valor: (l) => l.status },
    { id: 'itens', titulo: 'Itens', tipo: 'inteiro', padrao: false, ...semTotal, valor: (l) => l.itensCount },
    { id: 'valor', titulo: 'Valor', tipo: 'moeda', ...semTotal, valor: (l) => l.totalCents },
  ];

  const colunasVendedor: ColunaRelatorio<PreVendasDoVendedor>[] = [
    { id: 'vendedor', titulo: 'Vendedor', tipo: 'texto', largura: 60, valor: (v) => v.vendedorNome },
    { id: 'quantidade', titulo: 'Pré-vendas', tipo: 'inteiro', valor: (v) => v.quantidade },
    { id: 'valor', titulo: 'Valor', tipo: 'moeda', valor: (v) => v.valorCents },
  ];

  const filtros: string[] = [AVISO_PRE_VENDA_NAO_E_FATURAMENTO];
  if (filtro.origem) filtros.push(`Origem: ${filtro.origem === 'agente' ? 'Agente (WhatsApp)' : 'Balcão (pré-venda)'}`);
  if (filtro.busca.trim()) filtros.push(`Busca: "${filtro.busca.trim()}"`);

  const periodo = filtro.de || filtro.ate
    ? `Data de ${filtro.de ? formatDateInputPtBr(filtro.de) : '—'} a ${filtro.ate ? formatDateInputPtBr(filtro.ate) : '—'}`
    : `Em aberto em ${formatarDataRelatorio(agora)}`;

  const secoes: SecaoRelatorio[] = [
    {
      id: 'pre-vendas', titulo: 'Pré-vendas em aberto', colunas, linhas, unidade: ['pré-venda', 'pré-vendas'],
      mensagemVazia: 'Nenhuma pré-venda em aberto com os filtros aplicados.',
    } as SecaoRelatorio,
  ];
  if (podeVerResumo) {
    secoes.push({
      id: 'vendedores', titulo: 'Por vendedor', colunas: colunasVendedor, linhas: resumirPreVendasPorVendedor(linhas),
      opcional: true, padrao: false, unidade: ['vendedor', 'vendedores'],
    } as SecaoRelatorio);
  }

  return {
    titulo: 'Pré-vendas em Aberto',
    periodo,
    filtros,
    indicadores: podeVerResumo
      ? [
        { rotulo: 'Pré-vendas em aberto', valor: String(totais.quantidade) },
        { rotulo: 'Valor comprometido (não é receita)', valor: moeda(totais.valorCents) },
        { rotulo: 'Com estoque reservado', valor: String(totais.comReserva) },
        { rotulo: 'Mais antiga em aberto', valor: `${totais.maisAntiga} dia(s)` },
      ]
      : [],
    secoes,
  };
};
