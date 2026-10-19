import type { ColunaRelatorio, IndicadorRelatorio, SecaoRelatorio } from './relatorioPdfDomain';
import { ROTULO_STATUS_CONDICIONAL, estaVencido, resumirCondicional, type ItemCondicional } from './condicionalDomain';
import { ROTULO_STATUS_TRANSFERENCIA } from './transferenciaDomain';
import { rotuloStatusNota } from './notaTransferenciaDomain';

/*
 * RELATORIOS DE MOVIMENTO: CONDICIONAIS, TRANSFERENCIAS E NOTAS AVULSAS
 * (19/10/2026, levantamento de 16/10 -- "Relatorios que faltam").
 *
 * "Mais opcoes › Relatorio" em cada lista: sai o que a lista mostra (aba,
 * busca, filtros e periodo ja' aplicados pela tela), no padrao PDF com colunas
 * por caixa de marcar. Regra pura: recebe os documentos ja' lidos.
 */

export interface DocumentoRelatorioDeMovimento {
  titulo: string;
  periodo: string;
  filtros: string[];
  indicadores: IndicadorRelatorio[];
  secoes: SecaoRelatorio[];
}

const dataBr = (dia: unknown): string => {
  const texto = String(dia ?? '');
  return /^\d{4}-\d{2}-\d{2}/.test(texto) ? texto.slice(0, 10).split('-').reverse().join('/') : '';
};

const reais = (centavos: number): string => `R$ ${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(centavos / 100)}`;
const centavos = (reaisValor: number): number => Math.round((Number(reaisValor) || 0) * 100);

// ---------------------------------------------------------------------------
// CONDICIONAIS
// ---------------------------------------------------------------------------

export interface CondicionalDoRelatorio {
  id: string;
  numeroCondicional: string;
  clienteNome: string;
  clienteTelefone?: string;
  itens: ItemCondicional[];
  prazoDevolucao: string;
  dataSaida: string;
  status: string;
  observacao?: string;
  criadoPorNome?: string;
  numeroPedido?: string;
}

export const montarDocumentoCondicionais = (
  condicionais: CondicionalDoRelatorio[],
  opcoes: { hoje: string; periodo: string; filtrosAplicados: string[] },
): DocumentoRelatorioDeMovimento => {
  const resumo = (c: CondicionalDoRelatorio) => resumirCondicional(c.itens || []);
  const vencido = (c: CondicionalDoRelatorio) => estaVencido(c as Parameters<typeof estaVencido>[0], opcoes.hoje);
  const comCliente = condicionais.reduce((s, c) => s + centavos(resumo(c).valorComCliente), 0);
  const pecasComCliente = condicionais.reduce((s, c) => s + resumo(c).pecasComCliente, 0);

  const colunas: ColunaRelatorio<CondicionalDoRelatorio>[] = [
    { id: 'numero', titulo: 'Nº', tipo: 'texto', largura: 14, valor: (c) => `#${c.numeroCondicional}` },
    { id: 'saida', titulo: 'Saída', tipo: 'texto', largura: 18, valor: (c) => dataBr(c.dataSaida) },
    { id: 'prazo', titulo: 'Devolver até', tipo: 'texto', largura: 26, valor: (c) => `${dataBr(c.prazoDevolucao)}${vencido(c) ? ' (vencido)' : ''}` },
    { id: 'cliente', titulo: 'Cliente', tipo: 'texto', largura: 50, valor: (c) => c.clienteNome || '' },
    { id: 'telefone', titulo: 'Telefone', tipo: 'texto', largura: 26, padrao: false, valor: (c) => c.clienteTelefone || '' },
    { id: 'levadas', titulo: 'Peças levadas', tipo: 'inteiro', largura: 18, padrao: false, valor: (c) => resumo(c).pecasLevadas },
    { id: 'devolvidas', titulo: 'Peças devolvidas', tipo: 'inteiro', largura: 18, padrao: false, valor: (c) => resumo(c).pecasDevolvidas },
    { id: 'comCliente', titulo: 'Peças com o cliente', tipo: 'inteiro', largura: 20, valor: (c) => resumo(c).pecasComCliente },
    { id: 'valorLevado', titulo: 'Valor levado', tipo: 'moeda', largura: 22, padrao: false, valor: (c) => centavos(resumo(c).valorLevado) },
    { id: 'valorComCliente', titulo: 'Valor com o cliente', tipo: 'moeda', largura: 22, valor: (c) => centavos(resumo(c).valorComCliente) },
    {
      id: 'situacao', titulo: 'Situação', tipo: 'texto', largura: 34,
      valor: (c) => `${ROTULO_STATUS_CONDICIONAL[c.status as keyof typeof ROTULO_STATUS_CONDICIONAL] || c.status}${c.status === 'finalizado' && c.numeroPedido ? ` (pré-venda #${c.numeroPedido})` : ''}`,
    },
    { id: 'criadoPor', titulo: 'Lançado por', tipo: 'texto', largura: 30, padrao: false, valor: (c) => c.criadoPorNome || '' },
    { id: 'observacao', titulo: 'Observação', tipo: 'texto', largura: 50, padrao: false, valor: (c) => c.observacao || '' },
  ];

  return {
    titulo: 'Condicionais',
    periodo: opcoes.periodo,
    filtros: opcoes.filtrosAplicados,
    indicadores: [
      { rotulo: 'Condicionais', valor: String(condicionais.length) },
      { rotulo: 'Vencidos', valor: String(condicionais.filter(vencido).length) },
      { rotulo: 'Peças com clientes', valor: new Intl.NumberFormat('pt-BR').format(pecasComCliente) },
      { rotulo: 'Valor com clientes', valor: reais(comCliente) },
    ],
    secoes: [{
      id: 'condicionais',
      titulo: 'Condicionais',
      colunas,
      linhas: condicionais,
      unidade: ['condicional', 'condicionais'],
      mensagemVazia: 'Nenhum condicional nesta lista.',
    } as SecaoRelatorio],
  };
};

// ---------------------------------------------------------------------------
// TRANSFERENCIAS ENTRE FILIAIS
// ---------------------------------------------------------------------------

export interface TransferenciaDoRelatorio {
  id: string;
  numeroTransferencia: string;
  origemCodigo?: string;
  origemNome?: string;
  destinoCodigo?: string;
  destinoNome?: string;
  status: string;
  divergente?: boolean;
  comNota?: boolean;
  notaFiscal?: { number?: number | string | null; status?: string | null } | null;
  itens?: unknown[];
  valorCentavos?: number;
  enviadoEm?: { toDate?: () => Date } | null;
  enviadoPorNome?: string;
  recebidoPorNome?: string;
  observacao?: string;
}

export const montarDocumentoTransferencias = (
  transferencias: TransferenciaDoRelatorio[],
  opcoes: { periodo: string; filtrosAplicados: string[] },
): DocumentoRelatorioDeMovimento => {
  const valorTotal = transferencias.reduce((s, t) => s + (Number(t.valorCentavos) || 0), 0);
  const emTransito = transferencias.filter((t) => t.status === 'em_transito').length;

  const colunas: ColunaRelatorio<TransferenciaDoRelatorio>[] = [
    { id: 'numero', titulo: 'Nº', tipo: 'texto', largura: 14, valor: (t) => `#${t.numeroTransferencia}` },
    { id: 'envio', titulo: 'Envio', tipo: 'dataHora', largura: 30, valor: (t) => (t.enviadoEm && typeof t.enviadoEm.toDate === 'function' ? t.enviadoEm.toDate() : null) },
    { id: 'origem', titulo: 'De', tipo: 'texto', largura: 40, valor: (t) => `${t.origemCodigo || ''} ${t.origemNome || ''}`.trim() },
    { id: 'destino', titulo: 'Para', tipo: 'texto', largura: 40, valor: (t) => `${t.destinoCodigo || ''} ${t.destinoNome || ''}`.trim() },
    { id: 'itens', titulo: 'Itens', tipo: 'inteiro', largura: 12, valor: (t) => (Array.isArray(t.itens) ? t.itens.length : 0) },
    { id: 'valor', titulo: 'Valor (custo)', tipo: 'moeda', largura: 22, valor: (t) => Number(t.valorCentavos) || 0 },
    {
      id: 'situacao', titulo: 'Situação', tipo: 'texto', largura: 30,
      valor: (t) => `${ROTULO_STATUS_TRANSFERENCIA[t.status as keyof typeof ROTULO_STATUS_TRANSFERENCIA] || t.status}${t.divergente ? ' (com falta)' : ''}`,
    },
    {
      id: 'nota', titulo: 'Nota', tipo: 'texto', largura: 36,
      valor: (t) => (t.comNota ? `NF-e${t.notaFiscal?.number ? ` nº ${t.notaFiscal.number}` : ''} · ${rotuloStatusNota(t.notaFiscal?.status)}` : 'Sem nota'),
    },
    { id: 'enviadoPor', titulo: 'Enviado por', tipo: 'texto', largura: 30, padrao: false, valor: (t) => t.enviadoPorNome || '' },
    { id: 'recebidoPor', titulo: 'Recebido por', tipo: 'texto', largura: 30, padrao: false, valor: (t) => t.recebidoPorNome || '' },
    { id: 'observacao', titulo: 'Observação', tipo: 'texto', largura: 50, padrao: false, valor: (t) => t.observacao || '' },
  ];

  return {
    titulo: 'Transferências',
    periodo: opcoes.periodo,
    filtros: opcoes.filtrosAplicados,
    indicadores: [
      { rotulo: 'Transferências', valor: String(transferencias.length) },
      { rotulo: 'Em trânsito', valor: String(emTransito) },
      { rotulo: 'Valor (custo)', valor: reais(valorTotal) },
    ],
    secoes: [{
      id: 'transferencias',
      titulo: 'Transferências entre filiais',
      colunas,
      linhas: transferencias,
      unidade: ['transferência', 'transferências'],
      mensagemVazia: 'Nenhuma transferência nesta lista.',
    } as SecaoRelatorio],
  };
};

// ---------------------------------------------------------------------------
// NOTAS AVULSAS (compra sem XML)
// ---------------------------------------------------------------------------

export interface NotaAvulsaDoRelatorio {
  id: string;
  numero: string;
  fornecedorNome: string;
  itens?: unknown[];
  valorTotal: number;
  formaPagamento?: string;
  destinoPagamento?: string;
  bancoNome?: string;
  status: string;
  createdAt?: { seconds?: number };
}

export const montarDocumentoNotasAvulsas = (
  notas: NotaAvulsaDoRelatorio[],
  opcoes: { periodo: string; filtrosAplicados: string[]; statusCancelada: string },
): DocumentoRelatorioDeMovimento => {
  const ativas = notas.filter((n) => n.status !== opcoes.statusCancelada);
  const totalAtivas = ativas.reduce((s, n) => s + centavos(n.valorTotal), 0);

  const colunas: ColunaRelatorio<NotaAvulsaDoRelatorio>[] = [
    { id: 'numero', titulo: 'Nº', tipo: 'texto', largura: 14, valor: (n) => `#${n.numero}` },
    { id: 'data', titulo: 'Data', tipo: 'data', largura: 20, valor: (n) => (n.createdAt?.seconds ? new Date(n.createdAt.seconds * 1000) : null) },
    { id: 'fornecedor', titulo: 'Fornecedor', tipo: 'texto', largura: 56, valor: (n) => n.fornecedorNome || '' },
    { id: 'itens', titulo: 'Itens', tipo: 'inteiro', largura: 12, valor: (n) => (Array.isArray(n.itens) ? n.itens.length : 0) },
    { id: 'pagamento', titulo: 'Pagamento', tipo: 'texto', largura: 20, valor: (n) => (n.formaPagamento === 'a_vista' ? 'À vista' : 'Pendente') },
    {
      id: 'saiuDe', titulo: 'Saiu de', tipo: 'texto', largura: 26, padrao: false,
      valor: (n) => (n.formaPagamento !== 'a_vista' ? '' : n.destinoPagamento === 'banco' ? (n.bancoNome || 'Banco') : 'Caixa'),
    },
    { id: 'situacao', titulo: 'Situação', tipo: 'texto', largura: 18, valor: (n) => (n.status === opcoes.statusCancelada ? 'Cancelada' : 'Ativa') },
    // Nota cancelada nao entra no total (mesma regra da receita: cancelar so' remove).
    { id: 'total', titulo: 'Total', tipo: 'moeda', largura: 22, valor: (n) => (n.status === opcoes.statusCancelada ? 0 : centavos(n.valorTotal)) },
  ];

  return {
    titulo: 'Notas Avulsas',
    periodo: opcoes.periodo,
    filtros: opcoes.filtrosAplicados,
    indicadores: [
      { rotulo: 'Notas', valor: String(notas.length) },
      { rotulo: 'Canceladas', valor: String(notas.length - ativas.length) },
      { rotulo: 'Total das ativas', valor: reais(totalAtivas) },
    ],
    secoes: [{
      id: 'notasAvulsas',
      titulo: 'Compras sem XML',
      colunas,
      linhas: notas,
      rotuloTotal: 'Total (sem as canceladas)',
      unidade: ['nota', 'notas'],
      mensagemVazia: 'Nenhuma nota avulsa nesta lista.',
    } as SecaoRelatorio],
  };
};

// ---------------------------------------------------------------------------
// DEVOLUCOES DE VENDA (Relatorio de Vendas › Mais opcoes)
// ---------------------------------------------------------------------------

export interface ItemDevolvidoDoRelatorio {
  id?: string;
  nome?: string;
  quantidadeDevolvida?: number;
  subtotal?: number;
}

export interface DevolucaoDoRelatorio {
  id: string;
  numeroPedidoOriginal?: string;
  clienteNome?: string;
  valorTotalDevolvido?: number;
  valorTotalDevolvidoCentavos?: number;
  destinoValor?: string;
  bancoNome?: string;
  formaDevolucao?: string;
  motivo?: string;
  observacao?: string;
  status?: string;
  itensDevolvidos?: ItemDevolvidoDoRelatorio[];
  createdAt?: { toDate?: () => Date; seconds?: number } | null;
}

/** Linha da secao opcional "Itens devolvidos": um item de uma devolucao. */
export interface LinhaItemDevolvido {
  devolucao: DevolucaoDoRelatorio;
  item: ItemDevolvidoDoRelatorio;
}

export const dataDaDevolucao = (d: DevolucaoDoRelatorio): Date | null => {
  const c = d.createdAt;
  if (c && typeof c.toDate === 'function') return c.toDate();
  if (c && typeof c.seconds === 'number') return new Date(c.seconds * 1000);
  return null;
};

const ehEstornada = (d: DevolucaoDoRelatorio): boolean => d.status === 'estornada';

/** Para onde foi o valor devolvido, como a tela da devolucao oferece. */
export const destinoDaDevolucao = (d: DevolucaoDoRelatorio): string => {
  if (d.destinoValor === 'credito') return 'Crédito do cliente';
  if (d.destinoValor === 'caixa') return 'Dinheiro (caixa)';
  if (d.destinoValor === 'banco') return `${d.formaDevolucao || 'Banco'}${d.bancoNome ? ` — ${d.bancoNome}` : ''}`;
  return '';
};

const valorDaDevolucao = (d: DevolucaoDoRelatorio): number => (
  Number(d.valorTotalDevolvidoCentavos ?? centavos(Number(d.valorTotalDevolvido || 0))) || 0
);

export const montarDocumentoDevolucoes = (
  devolucoes: DevolucaoDoRelatorio[],
  opcoes: { periodo: string; filtrosAplicados: string[] },
): DocumentoRelatorioDeMovimento => {
  const validas = devolucoes.filter((d) => !ehEstornada(d));
  const total = validas.reduce((s, d) => s + valorDaDevolucao(d), 0);
  const porDestino = (destino: string) => validas.filter((d) => d.destinoValor === destino).reduce((s, d) => s + valorDaDevolucao(d), 0);

  const colunas: ColunaRelatorio<DevolucaoDoRelatorio>[] = [
    { id: 'data', titulo: 'Data', tipo: 'dataHora', largura: 30, valor: dataDaDevolucao },
    { id: 'venda', titulo: 'Venda', tipo: 'texto', largura: 16, valor: (d) => (d.numeroPedidoOriginal ? `#${d.numeroPedidoOriginal}` : '') },
    { id: 'cliente', titulo: 'Cliente', tipo: 'texto', largura: 50, valor: (d) => d.clienteNome || '' },
    {
      id: 'itens', titulo: 'Itens', tipo: 'texto', largura: 60, padrao: false,
      valor: (d) => (d.itensDevolvidos || []).map((i) => `${new Intl.NumberFormat('pt-BR').format(Number(i.quantidadeDevolvida || 0))} ${i.nome || ''}`.trim()).join('; '),
    },
    { id: 'motivo', titulo: 'Motivo', tipo: 'texto', largura: 44, valor: (d) => d.motivo || '' },
    { id: 'destino', titulo: 'Valor devolvido em', tipo: 'texto', largura: 34, valor: destinoDaDevolucao },
    { id: 'situacao', titulo: 'Situação', tipo: 'texto', largura: 18, valor: (d) => (ehEstornada(d) ? 'Estornada' : 'Concluída') },
    // Devolucao estornada nao conta (foi desfeita).
    { id: 'valor', titulo: 'Valor', tipo: 'moeda', largura: 22, valor: (d) => (ehEstornada(d) ? 0 : valorDaDevolucao(d)) },
    { id: 'observacao', titulo: 'Observação', tipo: 'texto', largura: 50, padrao: false, valor: (d) => d.observacao || '' },
  ];

  const linhasDeItens: LinhaItemDevolvido[] = validas.flatMap((d) => (d.itensDevolvidos || []).map((item) => ({ devolucao: d, item })));
  const colunasDeItens: ColunaRelatorio<LinhaItemDevolvido>[] = [
    { id: 'data', titulo: 'Data', tipo: 'data', largura: 20, valor: (l) => dataDaDevolucao(l.devolucao) },
    { id: 'venda', titulo: 'Venda', tipo: 'texto', largura: 16, valor: (l) => (l.devolucao.numeroPedidoOriginal ? `#${l.devolucao.numeroPedidoOriginal}` : '') },
    { id: 'produto', titulo: 'Produto', tipo: 'texto', largura: 70, valor: (l) => l.item.nome || '' },
    { id: 'quantidade', titulo: 'Quantidade', tipo: 'inteiro', largura: 18, valor: (l) => Number(l.item.quantidadeDevolvida || 0) },
    { id: 'valor', titulo: 'Valor', tipo: 'moeda', largura: 22, valor: (l) => centavos(Number(l.item.subtotal || 0)) },
  ];

  return {
    titulo: 'Devoluções de Venda',
    periodo: opcoes.periodo,
    filtros: opcoes.filtrosAplicados,
    indicadores: [
      { rotulo: 'Devoluções', valor: String(validas.length) },
      { rotulo: 'Valor devolvido', valor: reais(total) },
      { rotulo: 'Em crédito do cliente', valor: reais(porDestino('credito')) },
      { rotulo: 'Em dinheiro / banco', valor: reais(porDestino('caixa') + porDestino('banco')) },
      ...(devolucoes.length > validas.length ? [{ rotulo: 'Estornadas (não contam)', valor: String(devolucoes.length - validas.length) }] : []),
    ],
    secoes: [
      {
        id: 'devolucoes',
        titulo: 'Devoluções',
        colunas,
        linhas: devolucoes,
        rotuloTotal: 'Total devolvido (sem as estornadas)',
        unidade: ['devolução', 'devoluções'],
        mensagemVazia: 'Nenhuma devolução no período.',
      } as SecaoRelatorio,
      {
        id: 'itensDevolvidos',
        titulo: 'Itens devolvidos',
        colunas: colunasDeItens,
        linhas: linhasDeItens,
        opcional: true,
        padrao: false,
        rotuloTotal: 'Total dos itens',
        unidade: ['item', 'itens'],
        mensagemVazia: 'Nenhum item devolvido no período.',
      } as SecaoRelatorio,
    ],
  };
};
