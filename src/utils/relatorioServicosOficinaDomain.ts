import { toCents } from './financeDomain';
import { getServiceTotal } from './osServicePricing';
import type { ColunaRelatorio, IndicadorRelatorio, SecaoRelatorio } from './relatorioPdfDomain';

/*
 * RELATORIO DE SERVICOS DA OFICINA (padronizado em 2026-10-02): o painel de
 * /relatorios-mecanica continua na tela com os graficos, e o "Gerar relatorio"
 * abre o PDF padrao (RelatorioPreview) com os indicadores e as tabelas.
 *
 * Regra pura: recebe as OS ja' lidas (com a data de criacao como Date) e
 * devolve o resumo e o documento. A tela usa o MESMO resumo para os cartoes,
 * graficos e a tabela de tecnicos -- assim tela e papel nunca divergem.
 *
 * Contas mantidas do painel antigo:
 *   - valor da OS = servicos (preco x horas/quantidade) + pecas (preco x qtd,
 *     qtd vazia/zero conta 1);
 *   - so' OS "Finalizada" entra no faturamento e no ranking de tecnicos;
 *   - "Cancelada" nao entra em lugar nenhum alem do volume; o resto e' "em aberto";
 *   - liquido = bruto - taxa de cartao, nunca negativo;
 *   - "Total gerado" do tecnico e' o LIQUIDO (servicos e pecas sao brutos).
 */

export interface ServicoDaOsRelatorio {
  preco?: number;
  quantidade?: number;
  tempoHoras?: number | string | null;
}

export interface PecaDaOsRelatorio {
  preco?: number;
  quantidade?: number;
}

export interface OsDoRelatorio {
  id: string;
  status?: string;
  /** Data de criacao da OS (createdAt); sem data a OS nao entra em periodo nenhum. */
  criadoEm: Date | null;
  servicos?: ServicoDaOsRelatorio[];
  pecas?: PecaDaOsRelatorio[];
  totalTaxasPagamentoCentavos?: number | null;
  totalTaxasPagamento?: number | null;
  mecanicoId?: string;
  mecanicoNome?: string;
}

export interface PeriodoDoRelatorio {
  inicio: Date;
  fim: Date;
}

export interface ResumoDoTecnico {
  id: string;
  nome: string;
  qtd: number;
  servicosCentavos: number;
  pecasCentavos: number;
  taxasCentavos: number;
  /** Liquido (bruto - taxas), como no painel antigo. */
  totalCentavos: number;
}

export interface OsPorDia {
  /** AAAA-MM-DD (ordenacao). */
  dia: string;
  /** dd/mm, para o eixo do grafico. */
  rotulo: string;
  qtd: number;
  valorCentavos: number;
}

export interface OsPorStatus {
  status: string;
  qtd: number;
}

export interface ResumoServicosOficina {
  brutoCentavos: number;
  taxasCentavos: number;
  liquidoCentavos: number;
  servicosCentavos: number;
  pecasCentavos: number;
  qtdTotal: number;
  qtdConcluidas: number;
  qtdAbertas: number;
  qtdCanceladas: number;
  /** Bruto / OS finalizadas. */
  mediaPorOsCentavos: number;
  /** 0..100 */
  participacaoServicos: number;
  participacaoPecas: number;
  eficienciaConclusao: number;
  porTecnico: ResumoDoTecnico[];
  porStatus: OsPorStatus[];
  porDia: OsPorDia[];
}

const doisDigitos = (n: number): string => String(n).padStart(2, '0');

const dataValida = (data: Date | null | undefined): data is Date => data instanceof Date && !Number.isNaN(data.getTime());

/** dd/mm/aaaa no horario local (o mesmo do filtro da tela). */
export const dataCurtaBr = (data: Date | null | undefined): string => (
  dataValida(data) ? `${doisDigitos(data.getDate())}/${doisDigitos(data.getMonth() + 1)}/${data.getFullYear()}` : '—'
);

const chaveDoDia = (data: Date): string => `${data.getFullYear()}-${doisDigitos(data.getMonth() + 1)}-${doisDigitos(data.getDate())}`;

const moeda = (valorCentavos: number): string => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valorCentavos / 100);

/** 37.54 -> "37,5%" (casas = 1) | "38%" (casas = 0). */
export const formatarPercentual = (valor: number, casas = 1): string => (
  `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(Number.isFinite(valor) ? valor : 0)}%`
);

/** OS criadas dentro do periodo (inicio e fim inclusos). */
export const osNoPeriodo = (lista: OsDoRelatorio[], periodo: PeriodoDoRelatorio): OsDoRelatorio[] => {
  const inicio = periodo.inicio.getTime();
  const fim = periodo.fim.getTime();
  return lista.filter((o) => {
    if (!dataValida(o.criadoEm)) return false;
    const t = o.criadoEm.getTime();
    return t >= inicio && t <= fim;
  });
};

export const valoresDaOs = (o: OsDoRelatorio): { servicosCentavos: number; pecasCentavos: number; brutoCentavos: number; taxaCentavos: number; liquidoCentavos: number } => {
  const servicos = (o.servicos || []).reduce((soma, s) => soma + getServiceTotal(s), 0);
  const pecas = (o.pecas || []).reduce((soma, p) => soma + (Number(p.preco || 0) * Number(p.quantidade || 1)), 0);
  const servicosCentavos = toCents(servicos);
  const pecasCentavos = toCents(pecas);
  const brutoCentavos = servicosCentavos + pecasCentavos;
  const taxaCentavos = o.totalTaxasPagamentoCentavos !== undefined && o.totalTaxasPagamentoCentavos !== null
    ? Math.round(Number(o.totalTaxasPagamentoCentavos) || 0)
    : toCents(o.totalTaxasPagamento);
  return { servicosCentavos, pecasCentavos, brutoCentavos, taxaCentavos, liquidoCentavos: Math.max(0, brutoCentavos - taxaCentavos) };
};

/** Resumo de um conjunto de OS (ja' filtrado pelo periodo). */
export const resumirServicosOficina = (
  lista: OsDoRelatorio[],
  usuarios: Record<string, { nome?: string } | undefined> = {},
): ResumoServicosOficina => {
  let brutoCentavos = 0;
  let taxasCentavos = 0;
  let liquidoCentavos = 0;
  let servicosCentavos = 0;
  let pecasCentavos = 0;
  let qtdConcluidas = 0;
  let qtdAbertas = 0;
  let qtdCanceladas = 0;
  const porTecnico = new Map<string, ResumoDoTecnico>();
  const porStatus = new Map<string, OsPorStatus>();
  const porDia = new Map<string, OsPorDia>();

  lista.forEach((o) => {
    const valores = valoresDaOs(o);
    const status = o.status || 'Pendente';

    if (dataValida(o.criadoEm)) {
      const dia = chaveDoDia(o.criadoEm);
      const atual = porDia.get(dia) ?? { dia, rotulo: `${dia.slice(8, 10)}/${dia.slice(5, 7)}`, qtd: 0, valorCentavos: 0 };
      atual.qtd += 1;
      atual.valorCentavos += valores.brutoCentavos;
      porDia.set(dia, atual);
    }

    const contagem = porStatus.get(status) ?? { status, qtd: 0 };
    contagem.qtd += 1;
    porStatus.set(status, contagem);

    if (status === 'Finalizada') {
      qtdConcluidas += 1;
      brutoCentavos += valores.brutoCentavos;
      taxasCentavos += valores.taxaCentavos;
      liquidoCentavos += valores.liquidoCentavos;
      servicosCentavos += valores.servicosCentavos;
      pecasCentavos += valores.pecasCentavos;

      const id = o.mecanicoId || 'admin';
      const tecnico = porTecnico.get(id) ?? {
        id,
        nome: o.mecanicoNome || usuarios[id]?.nome || 'ADMINISTRADOR',
        qtd: 0,
        servicosCentavos: 0,
        pecasCentavos: 0,
        taxasCentavos: 0,
        totalCentavos: 0,
      };
      tecnico.qtd += 1;
      tecnico.servicosCentavos += valores.servicosCentavos;
      tecnico.pecasCentavos += valores.pecasCentavos;
      tecnico.taxasCentavos += valores.taxaCentavos;
      tecnico.totalCentavos += valores.liquidoCentavos;
      porTecnico.set(id, tecnico);
    } else if (status === 'Cancelada') {
      qtdCanceladas += 1;
    } else {
      qtdAbertas += 1;
    }
  });

  const qtdTotal = lista.length;
  return {
    brutoCentavos,
    taxasCentavos,
    liquidoCentavos,
    servicosCentavos,
    pecasCentavos,
    qtdTotal,
    qtdConcluidas,
    qtdAbertas,
    qtdCanceladas,
    mediaPorOsCentavos: qtdConcluidas > 0 ? Math.round(brutoCentavos / qtdConcluidas) : 0,
    participacaoServicos: brutoCentavos > 0 ? (servicosCentavos / brutoCentavos) * 100 : 0,
    participacaoPecas: brutoCentavos > 0 ? (pecasCentavos / brutoCentavos) * 100 : 0,
    eficienciaConclusao: qtdTotal > 0 ? (qtdConcluidas / qtdTotal) * 100 : 0,
    porTecnico: [...porTecnico.values()].sort((a, b) => b.totalCentavos - a.totalCentavos),
    porStatus: [...porStatus.values()].sort((a, b) => b.qtd - a.qtd || a.status.localeCompare(b.status, 'pt-BR')),
    porDia: [...porDia.values()].sort((a, b) => a.dia.localeCompare(b.dia)),
  };
};

export interface DocumentoServicosOficina {
  titulo: string;
  periodo: string;
  filtros: string[];
  indicadores: IndicadorRelatorio[];
  secoes: SecaoRelatorio[];
}

interface ParteDoFaturamento {
  tipo: string;
  valorCentavos: number;
  participacao: number;
}

/** Monta o documento (sem empresa/geradoPor, que o RelatorioPreview acrescenta). */
export const montarDocumentoServicosOficina = (
  lista: OsDoRelatorio[],
  usuarios: Record<string, { nome?: string } | undefined>,
  periodo: PeriodoDoRelatorio,
): DocumentoServicosOficina => {
  const resumo = resumirServicosOficina(osNoPeriodo(lista, periodo), usuarios);

  const colunasTecnicos: ColunaRelatorio<ResumoDoTecnico>[] = [
    { id: 'tecnico', titulo: 'Técnico', tipo: 'texto', largura: 56, valor: (t) => t.nome },
    { id: 'qtd', titulo: 'Qtd OS', tipo: 'inteiro', valor: (t) => t.qtd },
    { id: 'servicos', titulo: 'Serviços (Mão de Obra)', tipo: 'moeda', largura: 30, valor: (t) => t.servicosCentavos },
    { id: 'pecas', titulo: 'Peças Vendidas', tipo: 'moeda', largura: 28, valor: (t) => t.pecasCentavos },
    { id: 'taxas', titulo: 'Taxas de Cartão', tipo: 'moeda', largura: 26, padrao: false, valor: (t) => t.taxasCentavos },
    { id: 'total', titulo: 'Total Gerado', tipo: 'moeda', largura: 28, valor: (t) => t.totalCentavos },
  ];

  const colunasDia: ColunaRelatorio<OsPorDia>[] = [
    { id: 'dia', titulo: 'Dia', tipo: 'texto', largura: 24, valor: (d) => d.dia.split('-').reverse().join('/') },
    { id: 'qtd', titulo: 'Qtd OS', tipo: 'inteiro', valor: (d) => d.qtd },
    { id: 'valor', titulo: 'Valor das OS', tipo: 'moeda', largura: 28, valor: (d) => d.valorCentavos },
  ];

  const colunasStatus: ColunaRelatorio<OsPorStatus>[] = [
    { id: 'status', titulo: 'Situação', tipo: 'texto', largura: 50, valor: (s) => s.status },
    { id: 'qtd', titulo: 'Qtd OS', tipo: 'inteiro', valor: (s) => s.qtd },
  ];

  const partes: ParteDoFaturamento[] = [
    { tipo: 'Serviços', valorCentavos: resumo.servicosCentavos, participacao: resumo.participacaoServicos },
    { tipo: 'Peças', valorCentavos: resumo.pecasCentavos, participacao: resumo.participacaoPecas },
  ];
  const colunasPartes: ColunaRelatorio<ParteDoFaturamento>[] = [
    { id: 'tipo', titulo: 'Tipo', tipo: 'texto', largura: 40, valor: (p) => p.tipo },
    { id: 'valor', titulo: 'Valor', tipo: 'moeda', largura: 28, valor: (p) => p.valorCentavos },
    { id: 'participacao', titulo: 'Participação', tipo: 'texto', largura: 22, total: 'nenhum', valor: (p) => formatarPercentual(p.participacao) },
  ];

  return {
    titulo: 'Relatório de Serviços',
    periodo: `Período: ${dataCurtaBr(periodo.inicio)} a ${dataCurtaBr(periodo.fim)}`,
    filtros: [],
    indicadores: [
      { rotulo: 'Faturamento Bruto', valor: moeda(resumo.brutoCentavos) },
      { rotulo: 'Taxas de Cartão', valor: moeda(resumo.taxasCentavos) },
      { rotulo: 'Receita Líquida', valor: moeda(resumo.liquidoCentavos) },
      { rotulo: 'Faturamento só Serviços', valor: moeda(resumo.servicosCentavos) },
      { rotulo: 'OS Finalizadas', valor: String(resumo.qtdConcluidas) },
      { rotulo: 'OS em Aberto', valor: String(resumo.qtdAbertas) },
      { rotulo: 'Volume Total', valor: String(resumo.qtdTotal) },
      { rotulo: 'Média de Valor por OS', valor: moeda(resumo.mediaPorOsCentavos) },
      { rotulo: 'Participação de Serviços', valor: formatarPercentual(resumo.participacaoServicos) },
      { rotulo: 'Participação de Peças', valor: formatarPercentual(resumo.participacaoPecas) },
      { rotulo: 'Eficiência de Conclusão', valor: formatarPercentual(resumo.eficienciaConclusao, 0) },
    ],
    secoes: [
      {
        id: 'tecnicos', titulo: 'Produtividade de Técnicos / Mecânicos', colunas: colunasTecnicos, linhas: resumo.porTecnico,
        unidade: ['técnico', 'técnicos'], mensagemVazia: 'Nenhuma OS finalizada no período para gerar ranking.',
      } as SecaoRelatorio,
      {
        id: 'servicos-pecas', titulo: 'Serviços vs Peças (OS finalizadas)', colunas: colunasPartes, linhas: partes,
        opcional: true, padrao: false, unidade: ['tipo', 'tipos'],
      } as SecaoRelatorio,
      {
        id: 'por-dia', titulo: 'Volume de OS por Dia', colunas: colunasDia, linhas: resumo.porDia,
        opcional: true, padrao: false, unidade: ['dia', 'dias'], mensagemVazia: 'Nenhuma OS aberta no período.',
      } as SecaoRelatorio,
      {
        id: 'por-status', titulo: 'OS por Situação', colunas: colunasStatus, linhas: resumo.porStatus,
        opcional: true, padrao: false, unidade: ['situação', 'situações'], mensagemVazia: 'Nenhuma OS no período.',
      } as SecaoRelatorio,
    ],
  };
};
