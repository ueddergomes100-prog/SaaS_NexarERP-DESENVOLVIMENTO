import { transactionMovesPhysicalCash } from './financeDomain';
import { FORMA_ACERTO_FORNECEDOR } from './acertoFornecedorDomain';
import { calcularRelatorioFinanceiro, type TransacaoRelatorioFinanceiro } from './relatorioFinanceiroDomain';
import type { ColunaRelatorio, IndicadorRelatorio, SecaoRelatorio } from './relatorioPdfDomain';

/*
 * RECEBIMENTOS DO PERIODO (pedido do dono, 24/11/2026, cliente Jomarly:
 * "relatorio de contas recebidas do dia"). Financeiro > Contas a Receber >
 * Mais opcoes > Recebimentos; abre em HOJE.
 *
 * Tudo que foi recebido no periodo, pela data do pagamento: forma, onde caiu
 * (caixa, qual banco, credito do cliente ou acerto com fornecedor), de onde
 * veio (conta recebida, venda a vista, OS, lancamento) e os totais por forma e
 * por destino. O relatorio de Relatorios Diversos nao mostrava banco nem
 * somava por forma.
 *
 * A conta do que entra e do que e' estorno e' a MESMA de Relatorios Diversos
 * (calcularRelatorioFinanceiro): recebimento desfeito fica na lista como
 * ESTORNADO, fora dos totais.
 *
 * Regra pura: recebe os titulos ja' lidos e devolve o documento.
 */

export type OrigemDoRecebimento = 'Conta recebida' | 'Venda à vista' | 'OS à vista' | 'Lançamento';

export interface LinhaDeRecebimento {
  id: string;
  /** yyyy-mm-dd */
  data: string;
  clienteNome: string;
  descricao: string;
  origem: OrigemDoRecebimento;
  formaPagamento: string;
  destino: string;
  valorCentavos: number;
  estornado: boolean;
}

const texto = (v: unknown): string => String(v ?? '').trim();

const moeda = (centavos: number): string => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(centavos / 100);

const dataBr = (iso: string): string => iso.split('-').reverse().join('/');

export const DESTINO_CAIXA = 'Caixa (dinheiro)';
export const DESTINO_ACERTO = 'Pago direto ao fornecedor (acerto)';
export const DESTINO_CREDITO = 'Crédito do cliente';
export const DESTINO_SEM_BANCO = 'Sem banco informado';

/** Onde o valor foi parar. Acerto com fornecedor e credito do cliente nao sao dinheiro que entrou. */
export const destinoDoRecebimento = (t: TransacaoRelatorioFinanceiro): string => {
  const forma = texto(t.formaPagamento);
  if (forma === FORMA_ACERTO_FORNECEDOR) return DESTINO_ACERTO;
  if (forma === 'Crédito de Devolução' || forma === 'Cashback') return DESTINO_CREDITO;
  if (transactionMovesPhysicalCash(t as { movimentaCaixaFisico?: boolean; formaPagamento?: string; naturezaFinanceira?: string })) return DESTINO_CAIXA;
  return texto(t.bancoNome) || DESTINO_SEM_BANCO;
};

/** Conta que estava em aberto e foi baixada, ou dinheiro que entrou na hora da venda/OS. */
export const origemDoRecebimento = (t: TransacaoRelatorioFinanceiro): OrigemDoRecebimento => {
  const forma = texto(t.formaPagamento);
  const baixada = Boolean(t.baixaManual) || Boolean(t.parcialDaTransacaoId) || forma === 'Boleto' || Boolean(t.cheque)
    || texto(t.condicaoPagamento) === 'aprazo' || Boolean(t.acrescimoDaTransacaoId);
  if (baixada) return 'Conta recebida';
  if (t.osId) return 'OS à vista';
  if (t.pedidoId) return 'Venda à vista';
  return 'Lançamento';
};

export interface FiltroDeRecebimentos {
  inicio: string;
  fim: string;
  /** So' o que era conta a receber e foi baixado (sem venda/OS recebida na hora). */
  somenteContas: boolean;
}

export interface TotalAgrupado {
  rotulo: string;
  quantidade: number;
  valorCentavos: number;
}

const agrupar = (linhas: LinhaDeRecebimento[], chave: (l: LinhaDeRecebimento) => string): TotalAgrupado[] => {
  const mapa = new Map<string, TotalAgrupado>();
  linhas.filter((l) => !l.estornado).forEach((l) => {
    const rotulo = chave(l) || 'Sem informação';
    const atual = mapa.get(rotulo) || { rotulo, quantidade: 0, valorCentavos: 0 };
    mapa.set(rotulo, { rotulo, quantidade: atual.quantidade + 1, valorCentavos: atual.valorCentavos + l.valorCentavos });
  });
  return [...mapa.values()].sort((a, b) => b.valorCentavos - a.valorCentavos || a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
};

export interface ResultadoDeRecebimentos {
  linhas: LinhaDeRecebimento[];
  porForma: TotalAgrupado[];
  porDestino: TotalAgrupado[];
  /** Tudo que foi baixado/recebido, sem os estornados. */
  totalCentavos: number;
  /** Dinheiro de verdade: caixa + bancos (sem acerto com fornecedor e sem credito do cliente). */
  entrouCentavos: number;
  caixaCentavos: number;
  bancosCentavos: number;
  /** Baixado sem entrar dinheiro: acerto com fornecedor e credito do cliente. */
  semDinheiroCentavos: number;
  estornadoCentavos: number;
}

export const calcularRecebimentos = (
  entradasPagas: TransacaoRelatorioFinanceiro[],
  filtro: FiltroDeRecebimentos,
  saidasPagas: TransacaoRelatorioFinanceiro[] = [],
): ResultadoDeRecebimentos => {
  const base = calcularRelatorioFinanceiro(entradasPagas, { tipo: 'entrada', status: 'Paga', inicio: filtro.inicio, fim: filtro.fim }, saidasPagas);
  const porId = new Map(entradasPagas.map((t) => [t.id, t]));
  const linhas: LinhaDeRecebimento[] = base.linhas
    .map((l) => {
      const t = porId.get(l.id) || ({ id: l.id } as TransacaoRelatorioFinanceiro);
      return {
        id: l.id,
        data: l.data,
        clienteNome: l.clienteNome || texto(t.fornecedorNome),
        descricao: l.descricao,
        origem: origemDoRecebimento(t),
        formaPagamento: l.formaPagamento || 'Sem forma',
        destino: destinoDoRecebimento(t),
        valorCentavos: l.valorCentavos,
        estornado: l.estornado,
      };
    })
    .filter((l) => !filtro.somenteContas || l.origem === 'Conta recebida');
  const validas = linhas.filter((l) => !l.estornado);
  const soma = (lista: LinhaDeRecebimento[]) => lista.reduce((total, l) => total + l.valorCentavos, 0);
  const semDinheiro = validas.filter((l) => l.destino === DESTINO_ACERTO || l.destino === DESTINO_CREDITO);
  const caixa = validas.filter((l) => l.destino === DESTINO_CAIXA);
  const totalCentavos = soma(validas);
  return {
    linhas,
    porForma: agrupar(linhas, (l) => l.formaPagamento),
    porDestino: agrupar(linhas, (l) => l.destino),
    totalCentavos,
    entrouCentavos: totalCentavos - soma(semDinheiro),
    caixaCentavos: soma(caixa),
    bancosCentavos: totalCentavos - soma(semDinheiro) - soma(caixa),
    semDinheiroCentavos: soma(semDinheiro),
    estornadoCentavos: soma(linhas.filter((l) => l.estornado)),
  };
};

export interface DocumentoDeRecebimentos {
  titulo: string;
  periodo: string;
  filtros: string[];
  indicadores: IndicadorRelatorio[];
  secoes: SecaoRelatorio[];
}

export const montarDocumentoDeRecebimentos = (
  entradasPagas: TransacaoRelatorioFinanceiro[],
  filtro: FiltroDeRecebimentos,
  saidasPagas: TransacaoRelatorioFinanceiro[] = [],
): DocumentoDeRecebimentos => {
  const r = calcularRecebimentos(entradasPagas, filtro, saidasPagas);
  const umDia = filtro.inicio === filtro.fim;

  const colunas: ColunaRelatorio<LinhaDeRecebimento>[] = [
    { id: 'data', titulo: 'Data', tipo: 'texto', largura: 20, padrao: !umDia, valor: (l) => dataBr(l.data) },
    { id: 'cliente', titulo: 'Cliente', tipo: 'texto', largura: 46, valor: (l) => l.clienteNome },
    { id: 'descricao', titulo: 'Descrição', tipo: 'texto', largura: 56, valor: (l) => l.descricao },
    { id: 'origem', titulo: 'Origem', tipo: 'texto', largura: 26, valor: (l) => l.origem },
    { id: 'forma', titulo: 'Forma', tipo: 'texto', largura: 30, valor: (l) => l.formaPagamento },
    { id: 'destino', titulo: 'Onde caiu', tipo: 'texto', largura: 36, valor: (l) => l.destino },
    { id: 'situacao', titulo: 'Situação', tipo: 'texto', largura: 20, padrao: r.estornadoCentavos > 0, valor: (l) => (l.estornado ? 'ESTORNADO' : '') },
    {
      id: 'valor', titulo: 'Valor', tipo: 'moeda', valor: (l) => l.valorCentavos,
      // Linha estornada continua visivel, fora do total.
      totalCalculado: (linhas) => linhas.reduce((soma, l) => soma + (l.estornado ? 0 : l.valorCentavos), 0),
    },
  ];
  const colunasDoGrupo = (titulo: string): ColunaRelatorio<TotalAgrupado>[] => [
    { id: 'rotulo', titulo, tipo: 'texto', largura: 70, valor: (g) => g.rotulo },
    { id: 'quantidade', titulo: 'Lançamentos', tipo: 'inteiro', valor: (g) => g.quantidade },
    { id: 'valor', titulo: 'Valor', tipo: 'moeda', valor: (g) => g.valorCentavos },
  ];

  const indicadores: IndicadorRelatorio[] = [
    { rotulo: umDia ? 'Recebido no dia' : 'Recebido no período', valor: moeda(r.totalCentavos) },
    { rotulo: 'Lançamentos', valor: String(r.linhas.filter((l) => !l.estornado).length) },
    { rotulo: 'Em dinheiro (caixa)', valor: moeda(r.caixaCentavos) },
    { rotulo: 'Em banco', valor: moeda(r.bancosCentavos) },
  ];
  if (r.semDinheiroCentavos > 0) {
    indicadores.push({ rotulo: 'Baixado sem entrar dinheiro (acerto/crédito)', valor: moeda(r.semDinheiroCentavos) });
  }
  if (r.estornadoCentavos > 0) indicadores.push({ rotulo: 'Estornado (fora do total)', valor: moeda(r.estornadoCentavos) });

  return {
    titulo: filtro.somenteContas ? 'Contas Recebidas' : 'Recebimentos',
    periodo: umDia ? `Dia ${dataBr(filtro.inicio)}` : `Período: ${dataBr(filtro.inicio)} a ${dataBr(filtro.fim)}`,
    filtros: [filtro.somenteContas ? 'Só contas a receber baixadas (sem venda e OS recebidas na hora)' : 'Tudo que foi recebido: contas baixadas, vendas e OS à vista e lançamentos'],
    indicadores,
    secoes: [
      {
        id: 'porForma', titulo: 'Total por forma de pagamento', colunas: colunasDoGrupo('Forma de pagamento'), linhas: r.porForma, opcional: true, padrao: true,
        unidade: ['forma', 'formas'], mensagemVazia: 'Nenhum recebimento no período.',
      } as SecaoRelatorio,
      {
        id: 'porDestino', titulo: 'Total por caixa e banco', colunas: colunasDoGrupo('Onde caiu'), linhas: r.porDestino, opcional: true, padrao: true,
        unidade: ['destino', 'destinos'], mensagemVazia: 'Nenhum recebimento no período.',
      } as SecaoRelatorio,
      {
        id: 'recebimentos', titulo: 'Recebimentos', colunas, linhas: r.linhas, opcional: true, padrao: true,
        unidade: ['recebimento', 'recebimentos'], mensagemVazia: 'Nenhum recebimento no período.',
      } as SecaoRelatorio,
    ],
  };
};
