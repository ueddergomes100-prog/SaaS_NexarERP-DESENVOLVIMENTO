import { getDateInputInTimeZone } from './dateTime';
import { isVendaDoUsuario, type VendaComVendedor } from './visibilidadeVendasDomain';
import type { ColunaRelatorio, IndicadorRelatorio, SecaoRelatorio } from './relatorioPdfDomain';

/*
 * RELATORIOS DIVERSOS > DESCONTOS CONCEDIDOS.
 *
 * Mesma regra da pagina antiga de impressao, agora no padrao de relatorio do
 * sistema (PDF na tela, colunas por caixa de marcar):
 *   - pedidos_venda: descontoGeral; PDV x Pedido de Venda pelo sourceOrigin;
 *     segue a visibilidade de vendas (o desconto revela o valor da venda do
 *     colega); data = dataVenda -> createdAt;
 *   - ordens_de_servico: desconto; data = dataSaida -> dataEntrada -> createdAt;
 *   - orcamentos: desconto; data = createdAt; valorTotal em reais.
 * So' entra quem tem desconto aplicado (> 0) e data dentro do periodo.
 * Documento sem nenhuma data fica de fora (mais seguro do que assumir uma
 * data errada).
 *
 * Regra pura: recebe os documentos ja lidos e devolve o relatorio.
 */

export interface DescontoSnapshot {
  tipo?: 'valor' | 'percentual';
  valorInformado?: number;
  valorAplicadoCentavos?: number;
  excedeuLimite?: boolean;
  aprovacao?: {
    modo: 'senha';
    aprovadoPorId: string;
    aprovadoPorNome: string;
    aprovadoEm: string;
  };
}

export type OrigemDesconto = 'Pedido de Venda' | 'PDV' | 'Ordem de Serviço' | 'Orçamento';

export interface DocumentoComDesconto {
  id: string;
  origem: OrigemDesconto;
  numero: string;
  clienteNome?: string;
  data?: string;
  valorTotalCentavos: number;
  desconto: DescontoSnapshot;
}

/** Documento cru do Firestore: `{ id, ...doc.data() }`. */
export type DocumentoBruto = { id: string } & Record<string, any>;

export interface FontesRelatorioDescontos {
  pedidos: DocumentoBruto[];
  ordens: DocumentoBruto[];
  orcamentos: DocumentoBruto[];
}

export interface FiltroRelatorioDescontos {
  inicio: string;
  fim: string;
  /** Vazio/null = sem restricao (quem ve todas as vendas). */
  vendasVisiveisDeUsuarioId?: string | null;
}

/** Data AAAA-MM-DD: primeiro campo string preenchido, senao o createdAt (Timestamp). */
export const extrairDataDocumento = (data: Record<string, unknown>, ...campos: string[]): string | null => {
  for (const campo of campos) {
    const valor = data[campo];
    if (typeof valor === 'string' && valor) return valor;
  }
  const createdAt = data.createdAt as { toDate?: () => Date } | undefined;
  if (createdAt?.toDate) return getDateInputInTimeZone(createdAt.toDate());
  return null;
};

const numeroCurto = (id: string) => id.slice(0, 6).toUpperCase();

export const documentosComDesconto = (
  fontes: FontesRelatorioDescontos,
  filtro: FiltroRelatorioDescontos,
): DocumentoComDesconto[] => {
  const { inicio, fim, vendasVisiveisDeUsuarioId } = filtro;
  const noPeriodo = (data: string | null): data is string => Boolean(data) && (data as string) >= inicio && (data as string) <= fim;
  const resultados: DocumentoComDesconto[] = [];

  fontes.pedidos.forEach((doc) => {
    if (vendasVisiveisDeUsuarioId && !isVendaDoUsuario(doc as VendaComVendedor, vendasVisiveisDeUsuarioId)) return;
    const desconto: DescontoSnapshot | undefined = doc.descontoGeral;
    if (!desconto || !desconto.valorAplicadoCentavos) return;
    const data = extrairDataDocumento(doc, 'dataVenda');
    if (!noPeriodo(data)) return;
    resultados.push({
      id: doc.id,
      // PDV grava na mesma colecao pedidos_venda, distinguido por sourceOrigin (F16).
      origem: doc.sourceOrigin === 'pdv' ? 'PDV' : 'Pedido de Venda',
      numero: doc.numeroPedido || numeroCurto(doc.id),
      clienteNome: doc.clienteNome,
      data,
      valorTotalCentavos: Number(doc.valorTotalCentavos || 0),
      desconto,
    });
  });

  fontes.ordens.forEach((doc) => {
    const desconto: DescontoSnapshot | undefined = doc.desconto;
    if (!desconto || !desconto.valorAplicadoCentavos) return;
    const data = extrairDataDocumento(doc, 'dataSaida', 'dataEntrada');
    if (!noPeriodo(data)) return;
    resultados.push({
      id: doc.id,
      origem: 'Ordem de Serviço',
      numero: doc.numeroOS ? `#${doc.numeroOS}` : numeroCurto(doc.id),
      clienteNome: doc.clienteNome,
      data,
      valorTotalCentavos: Number(doc.valorTotalCentavos || 0),
      desconto,
    });
  });

  fontes.orcamentos.forEach((doc) => {
    const desconto: DescontoSnapshot | undefined = doc.desconto;
    if (!desconto || !desconto.valorAplicadoCentavos) return;
    const data = extrairDataDocumento(doc);
    if (!noPeriodo(data)) return;
    resultados.push({
      id: doc.id,
      origem: 'Orçamento',
      numero: doc.numeroOrcamento ? `#${doc.numeroOrcamento}` : numeroCurto(doc.id),
      clienteNome: doc.clienteNome,
      data,
      valorTotalCentavos: Math.round(Number(doc.valorTotal || 0) * 100),
      desconto,
    });
  });

  // Mais recente primeiro, como na pagina antiga.
  return resultados.sort((a, b) => (b.data || '').localeCompare(a.data || ''));
};

export interface TotalPorOrigem {
  origem: string;
  quantidade: number;
  descontoCentavos: number;
}

/** Na ordem em que cada origem aparece na lista (igual a pagina antiga). */
export const totaisPorOrigem = (documentos: DocumentoComDesconto[]): TotalPorOrigem[] => {
  const mapa = new Map<string, TotalPorOrigem>();
  documentos.forEach((d) => {
    const atual = mapa.get(d.origem) ?? { origem: d.origem, quantidade: 0, descontoCentavos: 0 };
    atual.quantidade += 1;
    atual.descontoCentavos += d.desconto.valorAplicadoCentavos || 0;
    mapa.set(d.origem, atual);
  });
  return [...mapa.values()];
};

export const aprovacaoDoDesconto = (d: DocumentoComDesconto): string => {
  if (d.desconto.aprovacao?.modo === 'senha') return `Senha: ${d.desconto.aprovacao.aprovadoPorNome}`;
  return d.desconto.excedeuLimite ? 'Acima do limite' : '';
};

export interface DocumentoRelatorioDescontos {
  titulo: string;
  periodo: string;
  filtros: string[];
  indicadores: IndicadorRelatorio[];
  secoes: SecaoRelatorio[];
}

const moeda = (centavos: number): string => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(centavos / 100);
const dataBr = (iso: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('/') : '');

export const montarDocumentoDescontos = (
  fontes: FontesRelatorioDescontos,
  filtro: FiltroRelatorioDescontos,
): DocumentoRelatorioDescontos => {
  const documentos = documentosComDesconto(fontes, filtro);
  const porOrigem = totaisPorOrigem(documentos);
  const totalDesconto = documentos.reduce((soma, d) => soma + (d.desconto.valorAplicadoCentavos || 0), 0);
  const totalVendido = documentos.reduce((soma, d) => soma + d.valorTotalCentavos, 0);
  const aprovadosPorSenha = documentos.filter((d) => d.desconto.aprovacao?.modo === 'senha').length;

  const colunasOrigem: ColunaRelatorio<TotalPorOrigem>[] = [
    { id: 'origem', titulo: 'Origem', tipo: 'texto', largura: 50, valor: (o) => o.origem },
    { id: 'quantidade', titulo: 'Qtd.', tipo: 'inteiro', valor: (o) => o.quantidade },
    { id: 'desconto', titulo: 'Desconto Total', tipo: 'moeda', valor: (o) => o.descontoCentavos },
  ];

  const colunasDetalhe: ColunaRelatorio<DocumentoComDesconto>[] = [
    { id: 'data', titulo: 'Data', tipo: 'texto', largura: 22, valor: (d) => dataBr(d.data || '') },
    { id: 'origem', titulo: 'Origem', tipo: 'texto', largura: 32, valor: (d) => d.origem },
    { id: 'numero', titulo: 'Nº', tipo: 'texto', largura: 18, valor: (d) => d.numero },
    { id: 'cliente', titulo: 'Cliente', tipo: 'texto', largura: 50, valor: (d) => d.clienteNome || '' },
    { id: 'valorTotal', titulo: 'Valor Total', tipo: 'moeda', valor: (d) => d.valorTotalCentavos },
    { id: 'desconto', titulo: 'Desconto', tipo: 'moeda', valor: (d) => d.desconto.valorAplicadoCentavos || 0 },
    { id: 'aprovacao', titulo: 'Aprovação', tipo: 'texto', largura: 34, valor: aprovacaoDoDesconto },
  ];

  return {
    titulo: 'Descontos Concedidos',
    periodo: `Período: ${dataBr(filtro.inicio)} a ${dataBr(filtro.fim)}`,
    // O rodape antigo explicava o criterio; o documento padrao nao tem
    // observacao, entao vai na linha de filtros (que sai no papel).
    filtros: ['Considera o desconto total de cada venda/OS/orçamento (descontos por item + desconto geral), não cada abatimento separado'],
    indicadores: [
      { rotulo: 'Vendas/OS/Orçamentos com desconto', valor: String(documentos.length) },
      { rotulo: 'Aprovados por senha', valor: String(aprovadosPorSenha) },
      { rotulo: 'Valor total', valor: moeda(totalVendido) },
      { rotulo: 'Desconto total', valor: moeda(totalDesconto) },
    ],
    secoes: [
      {
        id: 'origens',
        titulo: 'Por origem',
        colunas: colunasOrigem,
        linhas: porOrigem,
        unidade: ['origem', 'origens'],
        mensagemVazia: 'Nenhum desconto concedido no período selecionado.',
      } as SecaoRelatorio,
      {
        id: 'detalhe',
        titulo: 'Descontos concedidos',
        colunas: colunasDetalhe,
        linhas: documentos,
        rotuloTotal: 'Total',
        unidade: ['documento', 'documentos'],
        mensagemVazia: 'Nenhum desconto concedido no período selecionado.',
      } as SecaoRelatorio,
    ],
  };
};
