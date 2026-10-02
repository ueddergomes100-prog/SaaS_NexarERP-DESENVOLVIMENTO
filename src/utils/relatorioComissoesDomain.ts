/*
 * COMISSOES A PAGAR -- UMA CONTA SO' PARA A TELA E PARA O PAPEL.
 *
 * A tela Financeiro > Comissoes monta uma linha por origem (venda ou OS
 * finalizada/cancelada) a partir do snapshot de comissao gravado na origem.
 * Registro antigo, sem snapshot (`regraVersion`), entra como ESTIMATIVA pela
 * regra atual do cadastro do vendedor -- e aparece separado, nunca somado como
 * comissao confirmada.
 *
 * Padronizacao dos relatorios (dono, 2026-10-02): o relatorio abre no
 * RelatorioPreview (PDF, colunas por caixa de marcar). A conta que a tela fazia
 * mudou para ca' sem alteracao, e a tela usa estas mesmas funcoes -- o numero
 * impresso e' sempre o numero da tela.
 *
 * Arquivo puro: sem firebase e sem React.
 */
import { dateInputToUtcEnd, dateInputToUtcStart } from './dateTime';
import { toCents } from './financeDomain';
import type { ColunaRelatorio, IndicadorRelatorio, SecaoRelatorio } from './relatorioPdfDomain';

export interface EntradaComissao {
  id: string;
  originType: 'venda' | 'os';
  originId: string;
  originNumber: string;
  sellerId: string;
  sellerName: string;
  baseCents: number;
  percentage: number;
  valueCents: number;
  /** gerada | nao_aplicavel | cancelada (snapshot) ou estimativa_legada. */
  status: string;
  generatedAt: Date | null;
  paidAt: Date | null;
  historical: boolean;
}

/** Documento lido do Firestore, ja' com o id ao lado dos dados. */
export interface DocumentoOrigemComissao {
  id: string;
  dados: Record<string, any>;
}

/** Aceita Timestamp do Firestore (toDate/seconds), AAAA-MM-DD, ISO ou Date. */
export const dataDoCampoComissao = (value: any): Date | null => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value.seconds) return new Date(value.seconds * 1000);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return dateInputToUtcStart(value);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const entradaComissaoDaVenda = (
  id: string,
  sale: Record<string, any>,
  userMap: Record<string, any>,
): EntradaComissao => {
  const sellerIdValue = sale.vendedorId || sale.usuarioResponsavelId || '';
  const seller = userMap[sellerIdValue];
  const snapshot = sale.comissao;
  const baseCents = Number(snapshot?.baseAtualCentavos ?? toCents((sale.itens || []).reduce((sum: number, item: any) => sum + Number(item.subtotal || 0), 0)));
  const legacyPercentage = seller?.recebeComissaoPecas === true ? Number(seller.comissaoPercentualPecas || 0) : 0;
  const historical = Boolean(snapshot?.regraVersion);
  const cancelledSale = sale.status === 'Cancelada';
  return {
    id: `venda-${id}`,
    originType: 'venda',
    originId: id,
    originNumber: sale.numeroPedido || id.slice(0, 6),
    sellerId: sellerIdValue,
    sellerName: snapshot?.vendedorNome || sale.vendedorNome || seller?.nome || seller?.nomeResponsavel || 'Não identificado',
    baseCents,
    percentage: historical ? Number(snapshot.percentual || 0) : legacyPercentage,
    valueCents: cancelledSale
      ? 0
      : historical
        ? Number(snapshot.valorAtualCentavos ?? toCents(snapshot.valorAtual))
        : Math.round(baseCents * (legacyPercentage / 100)),
    status: cancelledSale ? 'cancelada' : historical ? snapshot.status : 'estimativa_legada',
    generatedAt: dataDoCampoComissao(snapshot?.geradaEm || sale.createdAt),
    paidAt: dataDoCampoComissao(snapshot?.pagaEm),
    historical,
  };
};

/** So' OS Finalizada ou Cancelada gera linha; as demais devolvem null. */
export const entradaComissaoDaOS = (
  id: string,
  serviceOrder: Record<string, any>,
  userMap: Record<string, any>,
): EntradaComissao | null => {
  if (!['Finalizada', 'Cancelada'].includes(serviceOrder.status)) return null;
  const mechanicId = serviceOrder.mecanicoId || '';
  const mechanic = userMap[mechanicId];
  const snapshot = serviceOrder.comissao;
  const servicesBase = (serviceOrder.servicos || []).reduce((sum: number, item: any) => sum + Number(item.preco || 0) * Number(item.quantidade || item.tempoHoras || 1), 0);
  const partsBase = (serviceOrder.pecas || []).reduce((sum: number, item: any) => sum + Number(item.preco || item.precoVenda || 0) * Number(item.quantidade || 1), 0);
  const baseCents = Number(snapshot?.baseAtualCentavos ?? toCents(servicesBase + partsBase));
  const servicePercentage = mechanic?.recebeComissaoServicos === true ? Number(mechanic.comissaoPercentualServicos || 0) : 0;
  const partsPercentage = mechanic?.recebeComissaoPecas === true ? Number(mechanic.comissaoPercentualPecas || 0) : 0;
  const legacyValueCents = Math.round(toCents(servicesBase) * (servicePercentage / 100)) + Math.round(toCents(partsBase) * (partsPercentage / 100));
  const historical = Boolean(snapshot?.regraVersion);
  const cancelledServiceOrder = serviceOrder.status === 'Cancelada';
  return {
    id: `os-${id}`,
    originType: 'os',
    originId: id,
    originNumber: serviceOrder.numeroOS || id.slice(0, 6),
    sellerId: mechanicId,
    sellerName: snapshot?.vendedorNome || serviceOrder.mecanicoNome || mechanic?.nome || 'Não identificado',
    baseCents,
    percentage: historical ? Number(snapshot.percentual || 0) : 0,
    valueCents: cancelledServiceOrder
      ? 0
      : historical
        ? Number(snapshot.valorAtualCentavos ?? toCents(snapshot.valorAtual))
        : legacyValueCents,
    status: cancelledServiceOrder ? 'cancelada' : historical ? snapshot.status : 'estimativa_legada',
    generatedAt: dataDoCampoComissao(snapshot?.geradaEm || serviceOrder.updatedAt || serviceOrder.createdAt),
    paidAt: dataDoCampoComissao(snapshot?.pagaEm),
    historical,
  };
};

/**
 * Todas as linhas de comissao, da mais recente para a mais antiga.
 *
 * Visibilidade de vendas: quando o funcionario so pode ver as proprias
 * vendas (`vendasVisiveisDeUsuarioId`), ele tambem so ve a propria comissao --
 * a linha de comissao do colega expoe o faturamento que a tela de Vendas
 * acabou de esconder. Vale pras duas origens (venda e OS).
 */
export const montarEntradasComissao = (args: {
  usuarios: Record<string, any>;
  vendas: DocumentoOrigemComissao[];
  ordensDeServico: DocumentoOrigemComissao[];
  vendasVisiveisDeUsuarioId?: string | null;
}): EntradaComissao[] => {
  const result: EntradaComissao[] = [];
  args.vendas.forEach((venda) => result.push(entradaComissaoDaVenda(venda.id, venda.dados, args.usuarios)));
  args.ordensDeServico.forEach((ordem) => {
    const entrada = entradaComissaoDaOS(ordem.id, ordem.dados, args.usuarios);
    if (entrada) result.push(entrada);
  });
  const visiveis = args.vendasVisiveisDeUsuarioId
    ? result.filter((entry) => entry.sellerId === args.vendasVisiveisDeUsuarioId)
    : result;
  return visiveis.sort((a, b) => (b.generatedAt?.getTime() || 0) - (a.generatedAt?.getTime() || 0));
};

export interface FiltroComissoes {
  /** Data inicial da geracao, AAAA-MM-DD. */
  de: string;
  /** Data final da geracao, AAAA-MM-DD. */
  ate: string;
  vendedorId?: string;
  status?: string;
  busca?: string;
}

/** Periodo invalido (data apagada) nao mostra nada -- igual a tela sempre fez. */
export const filtrarComissoes = (entries: EntradaComissao[], filtro: FiltroComissoes): EntradaComissao[] => {
  const start = dateInputToUtcStart(filtro.de);
  const end = dateInputToUtcEnd(filtro.ate);
  const term = (filtro.busca || '').trim().toLowerCase();
  return entries.filter((entry) => {
    if (!entry.generatedAt || !start || !end || entry.generatedAt < start || entry.generatedAt > end) return false;
    if (filtro.vendedorId && entry.sellerId !== filtro.vendedorId) return false;
    if (filtro.status && entry.status !== filtro.status) return false;
    if (term && !`${entry.sellerName} ${entry.originNumber}`.toLowerCase().includes(term)) return false;
    return true;
  });
};

/** Comissao confirmada: snapshot historico com status "gerada". */
export const comissaoValidaCentavos = (entry: EntradaComissao): number => (
  entry.historical && entry.status === 'gerada' ? entry.valueCents : 0
);

/** Registro legado (sem snapshot): estimativa pela regra atual do cadastro. */
export const estimativaLegadaCentavos = (entry: EntradaComissao): number => (
  !entry.historical ? entry.valueCents : 0
);

/**
 * O que entra no "a pagar": comissao valida + estimativa legada. Cancelada e
 * nao aplicavel ficam de fora (a tela sempre separou assim nos indicadores).
 */
export const comissaoAPagarCentavos = (entry: EntradaComissao): number => (
  comissaoValidaCentavos(entry) + estimativaLegadaCentavos(entry)
);

/** Base de calculo que conta no total: origem cancelada nao tem mais base. */
export const baseConsideradaCentavos = (entry: EntradaComissao): number => (
  entry.status === 'cancelada' ? 0 : entry.baseCents
);

export interface TotaisComissoes {
  validaCentavos: number;
  estimativaLegadaCentavos: number;
  origens: number;
}

export const totalizarComissoes = (entries: EntradaComissao[]): TotaisComissoes => ({
  validaCentavos: entries.reduce((sum, entry) => sum + comissaoValidaCentavos(entry), 0),
  estimativaLegadaCentavos: entries.reduce((sum, entry) => sum + estimativaLegadaCentavos(entry), 0),
  origens: entries.length,
});

export interface ResumoComissaoVendedor {
  vendedorId: string;
  vendedor: string;
  origens: number;
  canceladas: number;
  baseCentavos: number;
  validaCentavos: number;
  estimativaLegadaCentavos: number;
  aPagarCentavos: number;
}

/** Resumo para pagar: uma linha por vendedor, do maior valor a pagar para o menor. */
export const resumirComissoesPorVendedor = (entries: EntradaComissao[]): ResumoComissaoVendedor[] => {
  const mapa = new Map<string, ResumoComissaoVendedor>();
  entries.forEach((entry) => {
    const chave = entry.sellerId || `nome:${entry.sellerName}`;
    const atual = mapa.get(chave) ?? {
      vendedorId: entry.sellerId,
      vendedor: entry.sellerName,
      origens: 0,
      canceladas: 0,
      baseCentavos: 0,
      validaCentavos: 0,
      estimativaLegadaCentavos: 0,
      aPagarCentavos: 0,
    };
    atual.origens += 1;
    if (entry.status === 'cancelada') atual.canceladas += 1;
    atual.baseCentavos += baseConsideradaCentavos(entry);
    atual.validaCentavos += comissaoValidaCentavos(entry);
    atual.estimativaLegadaCentavos += estimativaLegadaCentavos(entry);
    atual.aPagarCentavos += comissaoAPagarCentavos(entry);
    mapa.set(chave, atual);
  });
  return [...mapa.values()].sort((a, b) => b.aPagarCentavos - a.aPagarCentavos || a.vendedor.localeCompare(b.vendedor, 'pt-BR'));
};

const ROTULO_STATUS: Record<string, string> = {
  gerada: 'Gerada',
  nao_aplicavel: 'Não aplicável',
  cancelada: 'Cancelada',
  estimativa_legada: 'Estimativa legada',
};

export const rotuloStatusComissao = (status: string): string => ROTULO_STATUS[status] || String(status || '').replaceAll('_', ' ');

const percentualBr = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Registro legado nao tem percentual gravado: vale a regra atual do cadastro. */
export const rotuloPercentualComissao = (entry: EntradaComissao): string => (
  entry.historical ? `${percentualBr.format(entry.percentage)}%` : 'Regra atual (legado)'
);

export const rotuloOrigemComissao = (entry: EntradaComissao): string => (
  `${entry.originType === 'venda' ? 'Venda' : 'OS'} #${entry.originNumber}`
);

export interface DocumentoComissoes {
  titulo: string;
  periodo: string;
  filtros: string[];
  indicadores: IndicadorRelatorio[];
  secoes: SecaoRelatorio[];
}

const moeda = (valorCentavos: number): string => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valorCentavos / 100);
const dataBr = (iso: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('/') : '');

/**
 * Documento (sem empresa/geradoPor, que o RelatorioPreview acrescenta) com
 * exatamente o que esta filtrado na tela. `entries` sao as linhas ja'
 * carregadas (com a regra de visibilidade aplicada); o filtro e' aplicado aqui.
 */
export const montarDocumentoComissoes = (
  entries: EntradaComissao[],
  filtro: FiltroComissoes,
  rotuloDoVendedor?: string,
): DocumentoComissoes => {
  const lista = filtrarComissoes(entries, filtro);
  const totais = totalizarComissoes(lista);
  const resumo = resumirComissoesPorVendedor(lista);

  const colunasResumo: ColunaRelatorio<ResumoComissaoVendedor>[] = [
    { id: 'vendedor', titulo: 'Vendedor', tipo: 'texto', largura: 56, valor: (r) => r.vendedor },
    { id: 'origens', titulo: 'Origens', tipo: 'inteiro', valor: (r) => r.origens },
    { id: 'canceladas', titulo: 'Canceladas', tipo: 'inteiro', padrao: false, valor: (r) => r.canceladas },
    { id: 'base', titulo: 'Base de cálculo', tipo: 'moeda', valor: (r) => r.baseCentavos },
    { id: 'valida', titulo: 'Comissão válida', tipo: 'moeda', padrao: false, valor: (r) => r.validaCentavos },
    { id: 'estimativa', titulo: 'Estimativa legada', tipo: 'moeda', padrao: false, valor: (r) => r.estimativaLegadaCentavos },
    { id: 'comissao', titulo: 'Comissão a pagar', tipo: 'moeda', valor: (r) => r.aPagarCentavos },
  ];

  const colunasDetalhe: ColunaRelatorio<EntradaComissao>[] = [
    { id: 'origem', titulo: 'Origem', tipo: 'texto', largura: 26, valor: rotuloOrigemComissao },
    { id: 'tipo', titulo: 'Tipo', tipo: 'texto', largura: 14, padrao: false, valor: (e) => (e.originType === 'venda' ? 'Venda' : 'OS') },
    { id: 'numero', titulo: 'Número', tipo: 'texto', largura: 18, padrao: false, valor: (e) => e.originNumber },
    { id: 'vendedor', titulo: 'Vendedor', tipo: 'texto', largura: 40, valor: (e) => e.sellerName },
    {
      id: 'base', titulo: 'Base de cálculo', tipo: 'moeda', valor: (e) => e.baseCents,
      totalCalculado: (linhas) => linhas.reduce((sum, e) => sum + baseConsideradaCentavos(e), 0),
    },
    { id: 'percentual', titulo: 'Percentual', tipo: 'texto', largura: 22, total: 'nenhum', valor: rotuloPercentualComissao },
    {
      id: 'comissao', titulo: 'Comissão', tipo: 'moeda', valor: (e) => e.valueCents,
      // Total = o que se paga: valida + estimativa legada (nunca cancelada).
      totalCalculado: (linhas) => linhas.reduce((sum, e) => sum + comissaoAPagarCentavos(e), 0),
    },
    { id: 'status', titulo: 'Status', tipo: 'texto', largura: 24, valor: (e) => rotuloStatusComissao(e.status) },
    { id: 'geracao', titulo: 'Geração', tipo: 'dataHora', valor: (e) => e.generatedAt },
    { id: 'pagamento', titulo: 'Pagamento', tipo: 'dataHora', padrao: false, valor: (e) => e.paidAt },
  ];

  const filtros: string[] = [];
  if (rotuloDoVendedor) filtros.push(`Vendedor: ${rotuloDoVendedor}`);
  if (filtro.status) filtros.push(`Status: ${rotuloStatusComissao(filtro.status)}`);
  if (filtro.busca?.trim()) filtros.push(`Busca: "${filtro.busca.trim()}"`);

  return {
    titulo: 'Comissões a Pagar',
    periodo: `Geração de ${dataBr(filtro.de) || '—'} a ${dataBr(filtro.ate) || '—'}`,
    filtros,
    indicadores: [
      { rotulo: 'Comissão histórica válida', valor: moeda(totais.validaCentavos) },
      { rotulo: 'Estimativa de registros legados', valor: moeda(totais.estimativaLegadaCentavos) },
      { rotulo: 'Origens no filtro', valor: String(totais.origens) },
    ],
    secoes: [
      {
        id: 'resumo-vendedor', titulo: 'Resumo por vendedor', colunas: colunasResumo, linhas: resumo, opcional: true, padrao: true,
        unidade: ['vendedor', 'vendedores'], mensagemVazia: 'Nenhuma comissão neste período.',
      } as SecaoRelatorio,
      {
        id: 'origens', titulo: 'Comissões por venda e OS', colunas: colunasDetalhe, linhas: lista,
        rotuloTotal: 'Total a pagar', unidade: ['origem', 'origens'], mensagemVazia: 'Nenhuma comissão encontrada.',
      } as SecaoRelatorio,
    ],
  };
};
