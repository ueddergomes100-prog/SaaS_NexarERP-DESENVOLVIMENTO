import { isRevenueReversal, transactionNetCents } from './financeDomain';
import { getDateInputInTimeZone } from './dateTime';
import type { ColunaRelatorio, IndicadorRelatorio, SecaoRelatorio } from './relatorioPdfDomain';

/*
 * RELATORIOS DIVERSOS > FINANCEIRO (a receber, recebidos, a pagar, pagos).
 *
 * Mesma conta da pagina antiga de impressao, agora no padrao de relatorio do
 * sistema (PDF na tela, colunas por caixa de marcar):
 *   - Pendente: periodo pela `data` (vencimento);
 *   - Paga: periodo pela dataPagamento -> data -> createdAt;
 *   - Recebidos (entrada + Paga): os estornos (saida paga de cancelamento /
 *     devolucao, isRevenueReversal) no periodo abatem o total. O estorno com
 *     id `estorno_cancelamento_{idOriginal}` marca a linha original como
 *     ESTORNADO (continua visivel, fora do total); o que nao casa com uma
 *     linha listada (devolucao, recebimento fora do periodo) entra so' como
 *     abatimento no total.
 *
 * Regra pura: recebe as transacoes ja lidas e devolve o documento.
 */

export type TipoRelatorioFinanceiro = 'entrada' | 'saida';
export type StatusRelatorioFinanceiro = 'Pendente' | 'Paga';

export interface TransacaoRelatorioFinanceiro {
  id: string;
  tipo?: string;
  status?: string;
  data?: string;
  dataPagamento?: string;
  createdAt?: { seconds?: number } | null;
  descricao?: string;
  categoria?: string;
  sourceType?: string;
  clienteNome?: string;
  formaPagamento?: string;
  valor?: number;
  [campo: string]: unknown;
}

export interface FiltroRelatorioFinanceiro {
  tipo: TipoRelatorioFinanceiro;
  status: StatusRelatorioFinanceiro;
  inicio: string;
  fim: string;
}

/**
 * Ao cancelar uma OS/venda o sistema grava a saida compensatoria com id
 * `estorno_cancelamento_{idDaTransacaoOriginal}` (ver OSForm.tsx e
 * PedidoVendaForm.tsx). Isso da ligacao EXATA de volta ao recebimento que
 * foi estornado, sem depender de casar por valor/data.
 */
export const ESTORNO_ID_PREFIX = 'estorno_cancelamento_';
export const transacaoOriginalDoEstorno = (estornoId: string): string | null => (
  estornoId.startsWith(ESTORNO_ID_PREFIX) ? estornoId.slice(ESTORNO_ID_PREFIX.length) : null
);

/** Data (AAAA-MM-DD) que decide se a transacao entra no periodo. */
export const dataReferenciaFinanceiro = (t: TransacaoRelatorioFinanceiro, status: StatusRelatorioFinanceiro): string => {
  if (status === 'Pendente') return t.data || '';
  if (t.dataPagamento) return t.dataPagamento;
  if (t.data) return t.data;
  if (t.createdAt && typeof t.createdAt.seconds === 'number') {
    return getDateInputInTimeZone(new Date(t.createdAt.seconds * 1000));
  }
  return '';
};

export const tituloRelatorioFinanceiro = (tipo: TipoRelatorioFinanceiro, status: StatusRelatorioFinanceiro): string => (
  tipo === 'entrada'
    ? (status === 'Pendente' ? 'Relatório de Débitos de Clientes (A Receber)' : 'Relatório de Recebimentos (Pagos)')
    : (status === 'Pendente' ? 'Relatório de Contas a Pagar (Pendentes)' : 'Relatório de Pagamentos (Despesas Pagas)')
);

/** Uma chave por combinacao: cada uma tem colunas diferentes. */
export const idRelatorioFinanceiro = (tipo: TipoRelatorioFinanceiro, status: StatusRelatorioFinanceiro): string => (
  tipo === 'entrada'
    ? (status === 'Pendente' ? 'financeiro-a-receber' : 'financeiro-recebidos')
    : (status === 'Pendente' ? 'financeiro-a-pagar' : 'financeiro-pagos')
);

export interface LinhaRelatorioFinanceiro {
  id: string;
  data: string;
  descricao: string;
  categoria: string;
  clienteNome: string;
  formaPagamento: string;
  valorCentavos: number;
  estornado: boolean;
}

export interface ResultadoRelatorioFinanceiro {
  linhas: LinhaRelatorioFinanceiro[];
  /** Soma de todas as linhas listadas (inclusive as estornadas). */
  subtotalCentavos: number;
  /** Linhas listadas marcadas como estornadas. */
  estornadoListadoCentavos: number;
  /** Estornos do periodo que nao casam com uma linha listada. */
  outrosEstornosCentavos: number;
  totalEstornosCentavos: number;
  /** subtotal - estornos: o "TOTAL PAGO/RECEBIDO" ou "TOTAL EM ABERTO". */
  totalCentavos: number;
}

export const calcularRelatorioFinanceiro = (
  transacoes: TransacaoRelatorioFinanceiro[],
  filtro: FiltroRelatorioFinanceiro,
  saidasPagas: TransacaoRelatorioFinanceiro[] = [],
): ResultadoRelatorioFinanceiro => {
  const { tipo, status, inicio, fim } = filtro;

  const listadas = transacoes
    .filter((t) => (!t.tipo || t.tipo === tipo) && (!t.status || t.status === status))
    .map((t) => ({ t, data: dataReferenciaFinanceiro(t, status) }))
    .filter(({ data }) => Boolean(data) && data >= inicio && data <= fim)
    .sort((a, b) => a.data.localeCompare(b.data));

  const idsListados = new Set(listadas.map(({ t }) => t.id));
  const idsEstornados = new Set<string>();
  let outrosEstornosCentavos = 0;

  // Estorno e' SAIDA, entao nunca apareceria no relatorio de recebimentos --
  // sem isso o total soma dinheiro que voltou pro cliente.
  if (tipo === 'entrada' && status === 'Paga') {
    saidasPagas.forEach((estorno) => {
      if (!isRevenueReversal(estorno)) return;
      const dataEstorno = estorno.dataPagamento || estorno.data || '';
      if (!dataEstorno || dataEstorno < inicio || dataEstorno > fim) return;
      const originalId = transacaoOriginalDoEstorno(estorno.id);
      if (originalId && idsListados.has(originalId)) {
        idsEstornados.add(originalId);
      } else {
        outrosEstornosCentavos += transactionNetCents(estorno as any);
      }
    });
  }

  const linhas: LinhaRelatorioFinanceiro[] = listadas.map(({ t, data }) => ({
    id: t.id,
    data,
    descricao: t.descricao || '',
    categoria: t.categoria || '',
    clienteNome: t.clienteNome || '',
    formaPagamento: t.formaPagamento || '',
    valorCentavos: transactionNetCents(t as any),
    estornado: idsEstornados.has(t.id),
  }));

  const subtotalCentavos = linhas.reduce((soma, l) => soma + l.valorCentavos, 0);
  const estornadoListadoCentavos = linhas.filter((l) => l.estornado).reduce((soma, l) => soma + l.valorCentavos, 0);
  const totalEstornosCentavos = estornadoListadoCentavos + outrosEstornosCentavos;

  return {
    linhas,
    subtotalCentavos,
    estornadoListadoCentavos,
    outrosEstornosCentavos,
    totalEstornosCentavos,
    totalCentavos: subtotalCentavos - totalEstornosCentavos,
  };
};

export interface DocumentoRelatorioFinanceiro {
  titulo: string;
  periodo: string;
  indicadores: IndicadorRelatorio[];
  secoes: SecaoRelatorio[];
}

const moeda = (centavos: number): string => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(centavos / 100);
const dataBr = (iso: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('/') : '');

export const montarDocumentoFinanceiro = (
  transacoes: TransacaoRelatorioFinanceiro[],
  filtro: FiltroRelatorioFinanceiro,
  saidasPagas: TransacaoRelatorioFinanceiro[] = [],
): DocumentoRelatorioFinanceiro => {
  const { tipo, status, inicio, fim } = filtro;
  const resultado = calcularRelatorioFinanceiro(transacoes, filtro, saidasPagas);
  const rotuloTotal = status === 'Paga' ? 'Total pago/recebido' : 'Total em aberto';
  const recebidos = tipo === 'entrada' && status === 'Paga';

  const colunas: ColunaRelatorio<LinhaRelatorioFinanceiro>[] = [
    { id: 'data', titulo: status === 'Paga' ? 'Data Pgto' : 'Vencimento', tipo: 'texto', largura: 22, valor: (l) => dataBr(l.data) },
    { id: 'descricao', titulo: 'Descrição / Origem', tipo: 'texto', largura: 60, valor: (l) => l.descricao },
  ];
  if (recebidos) {
    colunas.push({ id: 'estorno', titulo: 'Situação', tipo: 'texto', largura: 22, valor: (l) => (l.estornado ? 'ESTORNADO' : '') });
  }
  colunas.push({ id: 'categoria', titulo: 'Categoria', tipo: 'texto', largura: 34, valor: (l) => l.categoria });
  if (tipo === 'entrada') {
    colunas.push({ id: 'cliente', titulo: 'Cliente', tipo: 'texto', largura: 40, valor: (l) => l.clienteNome });
  }
  if (status === 'Paga') {
    colunas.push({ id: 'forma', titulo: 'Forma Pgto', tipo: 'texto', largura: 26, valor: (l) => l.formaPagamento });
  }
  colunas.push({
    id: 'valor',
    titulo: tipo === 'entrada' ? 'Valor Líquido' : 'Valor',
    tipo: 'moeda',
    valor: (l) => l.valorCentavos,
    // Linha estornada continua visivel (auditoria), mas fora do total; o
    // estorno que nao casa com linha tambem abate -- igual a pagina antiga.
    totalCalculado: (linhas) => linhas.reduce((soma, l) => soma + (l.estornado ? 0 : l.valorCentavos), 0)
      - resultado.outrosEstornosCentavos,
  });

  const indicadores: IndicadorRelatorio[] = [{ rotulo: 'Total de registros', valor: String(resultado.linhas.length) }];
  if (resultado.totalEstornosCentavos > 0) {
    indicadores.push(
      { rotulo: 'Subtotal listado', valor: moeda(resultado.subtotalCentavos) },
      { rotulo: '(-) Estornado (cancelamentos e devoluções)', valor: moeda(resultado.totalEstornosCentavos) },
    );
  }
  indicadores.push({ rotulo: rotuloTotal, valor: moeda(resultado.totalCentavos) });

  return {
    titulo: tituloRelatorioFinanceiro(tipo, status),
    periodo: `Período: ${dataBr(inicio)} a ${dataBr(fim)}`,
    indicadores,
    secoes: [{
      id: 'transacoes',
      titulo: 'Lançamentos',
      colunas,
      linhas: resultado.linhas,
      rotuloTotal,
      unidade: ['registro', 'registros'],
      mensagemVazia: 'Nenhuma transação encontrada para os filtros selecionados no período.',
    } as SecaoRelatorio],
  };
};
