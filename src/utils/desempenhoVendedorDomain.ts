import { contaComoFaturamento, isPedidoCancelado } from './preVendaDomain';
import { getDateInputInTimeZone } from './dateTime';

/**
 * MEU DESEMPENHO -- metricas do vendedor no App Vendas (pedido de cliente,
 * 30/10/2026).
 *
 * Cada vendedor ve so' os numeros DELE: vendido hoje/semana/mes, pedidos,
 * ticket medio, comparacao com o mesmo periodo do mes passado, a venda de
 * cada dia, os produtos e clientes que mais compraram dele, a comissao do mes
 * e a meta mensal (Cadastros > Vendedores; gravada em
 * configuracoes/{filial}.metasVendedores).
 *
 * Regras de conta (as mesmas do resto do sistema):
 * - venda = pedido que CONTA COMO FATURAMENTO (contaComoFaturamento): pre-venda
 *   aberta fica separada em "aguardando faturamento" e cancelada nao entra em
 *   nada (cancelar nunca negativa, so' some);
 * - a data da venda e' `dataVenda` (dia do faturamento) e, sem ela, `createdAt`;
 * - comissao do mes = a comissao gravada em cada venda faturada (snapshot
 *   `comissao`, status 'gerada') -- o mesmo numero de Financeiro > Comissoes.
 *
 * Arquivo puro: sem firebase e sem React.
 */

export interface ItemParaDesempenho {
  id?: string;
  nome?: string;
  quantidade?: number;
  subtotal?: number;
}

export interface VendaParaDesempenho {
  id: string;
  status?: string;
  valorTotal?: number;
  valorTotalCentavos?: number;
  dataVenda?: unknown;
  createdAt?: unknown;
  clienteId?: string;
  clienteNome?: string;
  itens?: ItemParaDesempenho[];
  comissao?: { status?: string; valorAtualCentavos?: number; valorAtual?: number } | null;
}

export interface ResumoPeriodo {
  totalCentavos: number;
  quantidade: number;
}

export interface RankingDesempenho {
  chave: string;
  nome: string;
  totalCentavos: number;
  quantidade: number;
}

export interface DesempenhoVendedor {
  hoje: ResumoPeriodo;
  semana: ResumoPeriodo;
  mes: ResumoPeriodo & { ticketMedioCentavos: number };
  /** Mes passado do dia 1 ate' o mesmo dia de hoje (comparacao justa). */
  mesPassadoMesmoPeriodo: ResumoPeriodo;
  mesPassadoInteiro: ResumoPeriodo;
  /** Variacao do mes contra o mesmo periodo do mes passado, em %. null = sem base. */
  variacaoPercentual: number | null;
  /** Um ponto por dia do mes atual, do dia 1 ate' hoje. */
  porDia: Array<{ dia: string; totalCentavos: number }>;
  topProdutos: RankingDesempenho[];
  topClientes: RankingDesempenho[];
  comissaoMesCentavos: number;
  aguardandoFaturamento: ResumoPeriodo;
  meta: { valorCentavos: number; percentual: number; faltaCentavos: number } | null;
}

const centavosDe = (valor: unknown): number => Math.round((Number(valor) || 0) * 100);

const totalDaVendaCentavos = (venda: VendaParaDesempenho): number => (
  Number.isFinite(Number(venda.valorTotalCentavos)) && venda.valorTotalCentavos != null
    ? Math.round(Number(venda.valorTotalCentavos))
    : centavosDe(venda.valorTotal)
);

/** Dia (AAAA-MM-DD, fuso da empresa) de Timestamp, {seconds}, Date, ISO ou AAAA-MM-DD. */
export const diaDoCampo = (valor: unknown): string | null => {
  if (!valor) return null;
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor;
  let data: Date | null = null;
  if (typeof valor === 'object' && valor !== null && 'toDate' in valor && typeof (valor as { toDate: unknown }).toDate === 'function') {
    data = (valor as { toDate: () => Date }).toDate();
  } else if (typeof valor === 'object' && valor !== null && 'seconds' in valor) {
    data = new Date(Number((valor as { seconds: number }).seconds) * 1000);
  } else if (valor instanceof Date) {
    data = valor;
  } else if (typeof valor === 'string') {
    const lida = new Date(valor);
    data = Number.isNaN(lida.getTime()) ? null : lida;
  }
  return data ? getDateInputInTimeZone(data) : null;
};

const diaDaVenda = (venda: VendaParaDesempenho): string | null => diaDoCampo(venda.dataVenda) ?? diaDoCampo(venda.createdAt);

/** Segunda-feira da semana do dia (AAAA-MM-DD). */
export const segundaDaSemana = (dia: string): string => {
  const [a, m, d] = dia.split('-').map(Number);
  const data = new Date(Date.UTC(a, m - 1, d));
  const semana = (data.getUTCDay() + 6) % 7; // segunda = 0
  data.setUTCDate(data.getUTCDate() - semana);
  return data.toISOString().slice(0, 10);
};

/** Mesmo dia no mes anterior (31/03 -> 28 ou 29/02). */
const mesAnterior = (dia: string): { inicio: string; mesmoDia: string; fim: string } => {
  const [a, m, d] = dia.split('-').map(Number);
  const ano = m === 1 ? a - 1 : a;
  const mes = m === 1 ? 12 : m - 1;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    inicio: `${ano}-${pad(mes)}-01`,
    mesmoDia: `${ano}-${pad(mes)}-${pad(Math.min(d, ultimo))}`,
    fim: `${ano}-${pad(mes)}-${pad(ultimo)}`,
  };
};

const ranking = (mapa: Map<string, RankingDesempenho>, limite: number): RankingDesempenho[] => (
  [...mapa.values()].sort((x, y) => y.totalCentavos - x.totalCentavos || x.nome.localeCompare(y.nome)).slice(0, limite)
);

export const calcularDesempenho = (
  vendas: ReadonlyArray<VendaParaDesempenho>,
  hoje: string,
  metaMensalReais: number | null = null,
  limiteRanking = 5,
): DesempenhoVendedor => {
  const inicioMes = `${hoje.slice(0, 7)}-01`;
  const inicioSemana = segundaDaSemana(hoje);
  const anterior = mesAnterior(hoje);
  const vazio = (): ResumoPeriodo => ({ totalCentavos: 0, quantidade: 0 });
  const somar = (resumo: ResumoPeriodo, centavos: number) => { resumo.totalCentavos += centavos; resumo.quantidade += 1; };

  const hojeR = vazio();
  const semana = vazio();
  const mes = vazio();
  const mesPassadoMesmoPeriodo = vazio();
  const mesPassadoInteiro = vazio();
  const aguardandoFaturamento = vazio();
  const porDiaMapa = new Map<string, number>();
  const produtos = new Map<string, RankingDesempenho>();
  const clientes = new Map<string, RankingDesempenho>();
  let comissaoMesCentavos = 0;

  for (const venda of vendas) {
    if (isPedidoCancelado(venda.status)) continue;
    const total = totalDaVendaCentavos(venda);
    if (!contaComoFaturamento(venda.status)) {
      somar(aguardandoFaturamento, total);
      continue;
    }
    const dia = diaDaVenda(venda);
    if (!dia || dia > hoje) continue;

    if (dia >= anterior.inicio && dia <= anterior.fim) {
      somar(mesPassadoInteiro, total);
      if (dia <= anterior.mesmoDia) somar(mesPassadoMesmoPeriodo, total);
    }
    if (dia < inicioMes) {
      // Semana que comecou no mes passado ainda conta na semana.
      if (dia >= inicioSemana) somar(semana, total);
      continue;
    }

    somar(mes, total);
    if (dia >= inicioSemana) somar(semana, total);
    if (dia === hoje) somar(hojeR, total);
    porDiaMapa.set(dia, (porDiaMapa.get(dia) || 0) + total);

    const comissao = venda.comissao;
    if (comissao && comissao.status === 'gerada') {
      comissaoMesCentavos += Number.isFinite(Number(comissao.valorAtualCentavos)) && comissao.valorAtualCentavos != null
        ? Math.round(Number(comissao.valorAtualCentavos))
        : centavosDe(comissao.valorAtual);
    }

    const chaveCliente = venda.clienteId || venda.clienteNome || '';
    if (chaveCliente) {
      const atual = clientes.get(chaveCliente) || { chave: chaveCliente, nome: venda.clienteNome || 'Cliente', totalCentavos: 0, quantidade: 0 };
      atual.totalCentavos += total;
      atual.quantidade += 1;
      clientes.set(chaveCliente, atual);
    }
    for (const item of venda.itens || []) {
      const chave = item.id || item.nome || '';
      if (!chave) continue;
      const atual = produtos.get(chave) || { chave, nome: item.nome || 'Produto', totalCentavos: 0, quantidade: 0 };
      atual.totalCentavos += centavosDe(item.subtotal);
      atual.quantidade += Number(item.quantidade) || 0;
      produtos.set(chave, atual);
    }
  }

  const porDia: DesempenhoVendedor['porDia'] = [];
  const diaHoje = Number(hoje.slice(8, 10));
  for (let d = 1; d <= diaHoje; d += 1) {
    const dia = `${hoje.slice(0, 7)}-${String(d).padStart(2, '0')}`;
    porDia.push({ dia, totalCentavos: porDiaMapa.get(dia) || 0 });
  }

  const metaCentavos = metaMensalReais && metaMensalReais > 0 ? Math.round(metaMensalReais * 100) : 0;

  return {
    hoje: hojeR,
    semana,
    mes: { ...mes, ticketMedioCentavos: mes.quantidade > 0 ? Math.round(mes.totalCentavos / mes.quantidade) : 0 },
    mesPassadoMesmoPeriodo,
    mesPassadoInteiro,
    variacaoPercentual: mesPassadoMesmoPeriodo.totalCentavos > 0
      ? Math.round(((mes.totalCentavos - mesPassadoMesmoPeriodo.totalCentavos) / mesPassadoMesmoPeriodo.totalCentavos) * 1000) / 10
      : null,
    porDia,
    topProdutos: ranking(produtos, limiteRanking),
    topClientes: ranking(clientes, limiteRanking),
    comissaoMesCentavos,
    aguardandoFaturamento,
    meta: metaCentavos > 0
      ? {
        valorCentavos: metaCentavos,
        percentual: Math.round((mes.totalCentavos / metaCentavos) * 1000) / 10,
        faltaCentavos: Math.max(0, metaCentavos - mes.totalCentavos),
      }
      : null,
  };
};

/** Primeiro dia do mes anterior (AAAA-MM-DD): de onde a tela busca as vendas. */
export const inicioDaBuscaDoDesempenho = (hoje: string): string => mesAnterior(hoje).inicio;

/** Meta mensal do vendedor guardada nas configuracoes da filial (reais). 0/ausente = sem meta. */
export const metaDoVendedor = (metasVendedores: unknown, vendedorId: string): number | null => {
  if (!metasVendedores || typeof metasVendedores !== 'object') return null;
  const valor = Number((metasVendedores as Record<string, unknown>)[vendedorId]);
  return Number.isFinite(valor) && valor > 0 ? valor : null;
};
