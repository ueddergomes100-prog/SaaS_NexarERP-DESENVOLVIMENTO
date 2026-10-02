import type { ColunaRelatorio, IndicadorRelatorio, SecaoRelatorio } from './relatorioPdfDomain';

/*
 * RELATORIO DE PRODUCAO (padronizado em 2026-10-02): o painel de
 * /producao/relatorios continua na tela com os graficos, e o "Gerar relatorio"
 * abre o PDF padrao (RelatorioPreview) com os indicadores e as tabelas.
 *
 * Regra pura: recebe as ordens ja' lidas (data de criacao como Date) e devolve
 * o resumo e o documento. A tela usa o MESMO resumo nos cartoes, graficos e
 * tabelas -- tela e papel nunca divergem.
 *
 * Contas mantidas do painel antigo:
 *   - so' ordem "finalizada" conta produzido, produto, responsavel, perda e sobra;
 *   - "cancelada" e "estornada" tem contagem propria; o resto e' "em andamento";
 *   - eficiencia = produzido das finalizadas / planejado de TODAS as ordens do periodo;
 *   - perda = soma da perda extra da conferencia; sobra = soma da sobra (so' > 0).
 *
 * Quantidade pode ser fracionada (KG, metro...). O relatorio nao tem coluna
 * decimal, entao sai como texto formatado em pt-BR e sem total.
 */

export const ROTULO_STATUS_PRODUCAO: Record<string, string> = {
  criada: 'Criada',
  em_producao: 'Em Produção',
  pausada: 'Pausada',
  finalizada: 'Finalizada',
  cancelada: 'Cancelada',
  estornada: 'Estornada',
};

export interface ItemConsumidoDoRelatorio {
  materiaPrimaId: string;
  materiaPrimaNome: string;
  unidade?: string;
  perdaExtra?: number;
  sobra?: number;
}

export interface OrdemDoRelatorio {
  id: string;
  produtoNome?: string;
  quantidadePlanejada?: number | null;
  quantidadeProduzida?: number | null;
  status: string;
  responsavelNome?: string;
  itensConsumidos?: ItemConsumidoDoRelatorio[];
  /** Data de criacao (createdAt); sem data a ordem nao entra em periodo nenhum. */
  criadoEm: Date | null;
}

export interface PeriodoDaProducao {
  inicio: Date;
  fim: Date;
}

export interface ProducaoPorProduto {
  nome: string;
  ordens: number;
  produzido: number;
}

export interface ProducaoPorResponsavel {
  nome: string;
  ordens: number;
  produzido: number;
}

export interface MovimentoDeMateriaPrima {
  materiaPrimaId: string;
  nome: string;
  unidade: string;
  quantidade: number;
}

export interface OrdensPorDia {
  /** AAAA-MM-DD (ordenacao). */
  dia: string;
  /** dd/mm, eixo do grafico. */
  rotulo: string;
  qtd: number;
}

export interface OrdensPorStatus {
  status: string;
  qtd: number;
}

export interface ResumoProducao {
  qtdTotal: number;
  qtdFinalizadas: number;
  qtdEmAndamento: number;
  qtdCanceladas: number;
  qtdEstornadas: number;
  planejadoTotal: number;
  produzidoTotal: number;
  /** 0..100 */
  eficiencia: number;
  porStatus: OrdensPorStatus[];
  porDia: OrdensPorDia[];
  porProduto: ProducaoPorProduto[];
  porResponsavel: ProducaoPorResponsavel[];
  perdas: MovimentoDeMateriaPrima[];
  sobras: MovimentoDeMateriaPrima[];
}

const doisDigitos = (n: number): string => String(n).padStart(2, '0');

const dataValida = (data: Date | null | undefined): data is Date => data instanceof Date && !Number.isNaN(data.getTime());

/** dd/mm/aaaa no horario local (o mesmo do filtro da tela). */
export const dataDaProducaoBr = (data: Date | null | undefined): string => (
  dataValida(data) ? `${doisDigitos(data.getDate())}/${doisDigitos(data.getMonth() + 1)}/${data.getFullYear()}` : '—'
);

const chaveDoDia = (data: Date): string => `${data.getFullYear()}-${doisDigitos(data.getMonth() + 1)}-${doisDigitos(data.getDate())}`;

const numero = (valor: unknown): number => {
  const n = Number(valor || 0);
  return Number.isFinite(n) ? n : 0;
};

/** 1234.5 -> "1.234,5" (ate' 3 casas, sem zeros sobrando). */
export const formatarQuantidade = (valor: number): string => (
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(Number.isFinite(valor) ? valor : 0)
);

/** 37.54 -> "37,5%". */
export const formatarPercentualProducao = (valor: number): string => (
  `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number.isFinite(valor) ? valor : 0)}%`
);

const quantidadeComUnidade = (quantidade: number, unidade: string): string => `${formatarQuantidade(quantidade)}${unidade ? ` ${unidade}` : ''}`;

/** Ordens criadas dentro do periodo (inicio e fim inclusos). */
export const ordensNoPeriodo = (lista: OrdemDoRelatorio[], periodo: PeriodoDaProducao): OrdemDoRelatorio[] => {
  const inicio = periodo.inicio.getTime();
  const fim = periodo.fim.getTime();
  return lista.filter((o) => {
    if (!dataValida(o.criadoEm)) return false;
    const t = o.criadoEm.getTime();
    return t >= inicio && t <= fim;
  });
};

const acumularMateriaPrima = (mapa: Map<string, MovimentoDeMateriaPrima>, item: ItemConsumidoDoRelatorio, quantidade: number) => {
  const atual = mapa.get(item.materiaPrimaId) ?? { materiaPrimaId: item.materiaPrimaId, nome: item.materiaPrimaNome || 'Matéria-prima', unidade: item.unidade || '', quantidade: 0 };
  atual.quantidade += quantidade;
  mapa.set(item.materiaPrimaId, atual);
};

/** Resumo de um conjunto de ordens (ja' filtrado pelo periodo). */
export const resumirProducao = (lista: OrdemDoRelatorio[]): ResumoProducao => {
  let qtdFinalizadas = 0;
  let qtdCanceladas = 0;
  let qtdEstornadas = 0;
  let qtdEmAndamento = 0;
  let planejadoTotal = 0;
  let produzidoTotal = 0;
  const porStatus = new Map<string, OrdensPorStatus>();
  const porDia = new Map<string, OrdensPorDia>();
  const porProduto = new Map<string, ProducaoPorProduto>();
  const porResponsavel = new Map<string, ProducaoPorResponsavel>();
  const perdas = new Map<string, MovimentoDeMateriaPrima>();
  const sobras = new Map<string, MovimentoDeMateriaPrima>();

  lista.forEach((o) => {
    const rotuloStatus = ROTULO_STATUS_PRODUCAO[o.status] || o.status || 'Sem situação';
    const contagem = porStatus.get(rotuloStatus) ?? { status: rotuloStatus, qtd: 0 };
    contagem.qtd += 1;
    porStatus.set(rotuloStatus, contagem);

    if (dataValida(o.criadoEm)) {
      const dia = chaveDoDia(o.criadoEm);
      const atual = porDia.get(dia) ?? { dia, rotulo: `${dia.slice(8, 10)}/${dia.slice(5, 7)}`, qtd: 0 };
      atual.qtd += 1;
      porDia.set(dia, atual);
    }

    planejadoTotal += numero(o.quantidadePlanejada);

    if (o.status === 'finalizada') {
      qtdFinalizadas += 1;
      const produzido = numero(o.quantidadeProduzida);
      produzidoTotal += produzido;

      const nomeProduto = o.produtoNome || 'Produto';
      const produto = porProduto.get(nomeProduto) ?? { nome: nomeProduto, ordens: 0, produzido: 0 };
      produto.ordens += 1;
      produto.produzido += produzido;
      porProduto.set(nomeProduto, produto);

      const nomeResponsavel = o.responsavelNome || 'Sem responsável';
      const responsavel = porResponsavel.get(nomeResponsavel) ?? { nome: nomeResponsavel, ordens: 0, produzido: 0 };
      responsavel.ordens += 1;
      responsavel.produzido += produzido;
      porResponsavel.set(nomeResponsavel, responsavel);

      (o.itensConsumidos || []).forEach((item) => {
        const perda = numero(item.perdaExtra);
        if (perda > 0) acumularMateriaPrima(perdas, item, perda);
        const sobra = numero(item.sobra);
        if (sobra > 0) acumularMateriaPrima(sobras, item, sobra);
      });
    } else if (o.status === 'cancelada') {
      qtdCanceladas += 1;
    } else if (o.status === 'estornada') {
      qtdEstornadas += 1;
    } else {
      qtdEmAndamento += 1;
    }
  });

  const porQuantidade = (a: { quantidade: number }, b: { quantidade: number }) => b.quantidade - a.quantidade;
  return {
    qtdTotal: lista.length,
    qtdFinalizadas,
    qtdEmAndamento,
    qtdCanceladas,
    qtdEstornadas,
    planejadoTotal,
    produzidoTotal,
    eficiencia: planejadoTotal > 0 ? (produzidoTotal / planejadoTotal) * 100 : 0,
    porStatus: [...porStatus.values()],
    porDia: [...porDia.values()].sort((a, b) => a.dia.localeCompare(b.dia)),
    porProduto: [...porProduto.values()].sort((a, b) => b.produzido - a.produzido),
    porResponsavel: [...porResponsavel.values()].sort((a, b) => b.produzido - a.produzido),
    perdas: [...perdas.values()].sort(porQuantidade),
    sobras: [...sobras.values()].sort(porQuantidade),
  };
};

export interface DocumentoProducao {
  titulo: string;
  periodo: string;
  filtros: string[];
  indicadores: IndicadorRelatorio[];
  secoes: SecaoRelatorio[];
}

/** Monta o documento (sem empresa/geradoPor, que o RelatorioPreview acrescenta). */
export const montarDocumentoProducao = (lista: OrdemDoRelatorio[], periodo: PeriodoDaProducao): DocumentoProducao => {
  const resumo = resumirProducao(ordensNoPeriodo(lista, periodo));

  const colunasProduto: ColunaRelatorio<ProducaoPorProduto>[] = [
    { id: 'produto', titulo: 'Produto', tipo: 'texto', largura: 80, valor: (p) => p.nome },
    { id: 'ordens', titulo: 'Ordens', tipo: 'inteiro', valor: (p) => p.ordens },
    { id: 'produzido', titulo: 'Quantidade Produzida', tipo: 'texto', largura: 34, total: 'nenhum', valor: (p) => formatarQuantidade(p.produzido) },
  ];

  const colunasResponsavel: ColunaRelatorio<ProducaoPorResponsavel>[] = [
    { id: 'responsavel', titulo: 'Responsável', tipo: 'texto', largura: 70, valor: (r) => r.nome },
    { id: 'ordens', titulo: 'Ordens Finalizadas', tipo: 'inteiro', largura: 28, valor: (r) => r.ordens },
    { id: 'produzido', titulo: 'Produção Total', tipo: 'texto', largura: 30, total: 'nenhum', valor: (r) => formatarQuantidade(r.produzido) },
  ];

  const colunasMateriaPrima = (tituloQuantidade: string): ColunaRelatorio<MovimentoDeMateriaPrima>[] => [
    { id: 'materia-prima', titulo: 'Matéria-Prima', tipo: 'texto', largura: 80, valor: (m) => m.nome },
    { id: 'quantidade', titulo: tituloQuantidade, tipo: 'texto', largura: 32, total: 'nenhum', valor: (m) => quantidadeComUnidade(m.quantidade, m.unidade) },
  ];

  const colunasDia: ColunaRelatorio<OrdensPorDia>[] = [
    { id: 'dia', titulo: 'Dia', tipo: 'texto', largura: 24, valor: (d) => d.dia.split('-').reverse().join('/') },
    { id: 'qtd', titulo: 'Ordens', tipo: 'inteiro', valor: (d) => d.qtd },
  ];

  const colunasStatus: ColunaRelatorio<OrdensPorStatus>[] = [
    { id: 'status', titulo: 'Situação', tipo: 'texto', largura: 50, valor: (s) => s.status },
    { id: 'qtd', titulo: 'Ordens', tipo: 'inteiro', valor: (s) => s.qtd },
  ];

  return {
    titulo: 'Relatório de Produção',
    periodo: `Período: ${dataDaProducaoBr(periodo.inicio)} a ${dataDaProducaoBr(periodo.fim)}`,
    filtros: [],
    indicadores: [
      { rotulo: 'Total de Ordens', valor: String(resumo.qtdTotal) },
      { rotulo: 'Finalizadas', valor: String(resumo.qtdFinalizadas) },
      { rotulo: 'Em Andamento', valor: String(resumo.qtdEmAndamento) },
      { rotulo: 'Canceladas', valor: String(resumo.qtdCanceladas) },
      { rotulo: 'Estornadas', valor: String(resumo.qtdEstornadas) },
      { rotulo: 'Eficiência de Produção', valor: formatarPercentualProducao(resumo.eficiencia) },
      { rotulo: 'Quantidade Produzida', valor: formatarQuantidade(resumo.produzidoTotal) },
      { rotulo: 'Quantidade Planejada', valor: formatarQuantidade(resumo.planejadoTotal) },
    ],
    secoes: [
      {
        id: 'por-produto', titulo: 'Produção por Produto', colunas: colunasProduto, linhas: resumo.porProduto,
        unidade: ['produto', 'produtos'], mensagemVazia: 'Nenhuma ordem finalizada no período.',
      } as SecaoRelatorio,
      {
        id: 'por-responsavel', titulo: 'Produção por Responsável', colunas: colunasResponsavel, linhas: resumo.porResponsavel,
        opcional: true, padrao: true, unidade: ['responsável', 'responsáveis'], mensagemVazia: 'Nenhuma ordem finalizada no período.',
      } as SecaoRelatorio,
      {
        id: 'perdas', titulo: 'Perda de Matéria-Prima no Período', colunas: colunasMateriaPrima('Perda no período'), linhas: resumo.perdas,
        opcional: true, padrao: true, unidade: ['matéria-prima', 'matérias-primas'], mensagemVazia: 'Nenhuma perda extra registrada no período.',
      } as SecaoRelatorio,
      {
        id: 'sobras', titulo: 'Sobra de Matéria-Prima no Período', colunas: colunasMateriaPrima('Sobra no período'), linhas: resumo.sobras,
        opcional: true, padrao: true, unidade: ['matéria-prima', 'matérias-primas'], mensagemVazia: 'Nenhuma sobra registrada no período.',
      } as SecaoRelatorio,
      {
        id: 'por-dia', titulo: 'Ordens de Produção por Dia', colunas: colunasDia, linhas: resumo.porDia,
        opcional: true, padrao: false, unidade: ['dia', 'dias'], mensagemVazia: 'Nenhuma ordem no período.',
      } as SecaoRelatorio,
      {
        id: 'por-status', titulo: 'Ordens por Situação', colunas: colunasStatus, linhas: resumo.porStatus,
        opcional: true, padrao: false, unidade: ['situação', 'situações'], mensagemVazia: 'Nenhuma ordem no período.',
      } as SecaoRelatorio,
    ],
  };
};
