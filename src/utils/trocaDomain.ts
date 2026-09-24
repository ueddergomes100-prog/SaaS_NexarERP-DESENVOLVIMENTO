/**
 * TROCA DE MERCADORIA -- lado da tela (2026-09-21).
 *
 * A regra de verdade mora no servidor (server/services/trocas.js e
 * routes/trocas.routes.js: o app nunca escreve em `trocas` nem em `estoque`).
 * Aqui ficam so' os rotulos, as cores, quais botoes cada estado mostra e a
 * conferencia rapida do rascunho no aparelho. Plano: docs/PLANO_TROCAS_VENDEDOR.md.
 */

export const PERMISSAO_TROCA_SOLICITAR = 'vendas.troca_solicitar';
export const PERMISSAO_TROCA_GERENCIAR = 'vendas.troca_gerenciar';

export type StatusTroca = 'Solicitada' | 'Aprovada' | 'Recusada' | 'Entregue' | 'Cancelada';

export const MOTIVOS_TROCA: { value: string; label: string }[] = [
  { value: 'embalagem_rasgada', label: 'Embalagem rasgada' },
  { value: 'com_bicho', label: 'Com bicho' },
  { value: 'vencido', label: 'Vencido ou vencendo' },
  { value: 'produto_errado', label: 'Produto errado' },
  { value: 'outro', label: 'Outro' },
];

export const rotuloDoMotivoTroca = (motivo: string): string => (
  MOTIVOS_TROCA.find((m) => m.value === motivo)?.label || motivo
);

export const DESCRICAO_MOTIVO_MAX = 120;

export interface ItemTrocaRascunho {
  id: string;
  nome: string;
  codigo?: string;
  quantidade: number;
  unidadeMedidaSigla: string;
  motivo: string;
  motivoDescricao?: string;
}

/** Item como o servidor grava e a retaguarda mostra. */
export interface ItemTroca extends ItemTrocaRascunho {
  unidadeMedidaFracionado?: boolean;
  unidadeMedidaCasasDecimais?: number;
  custoUnitarioCentavos?: number;
  loteId?: string;
  lote?: string;
}

export interface AvisoTroca {
  produtoId: string;
  produtoNome: string;
  mensagem: string;
}

export interface HistoricoTroca {
  status: StatusTroca;
  /** ISO 8601 */
  em: string;
  por: string;
  porNome: string;
  motivo?: string;
}

export interface Troca {
  id: string;
  numeroTroca: string;
  clienteId: string;
  clienteNome: string;
  clienteTelefone?: string;
  itens: ItemTroca[];
  observacao: string;
  status: StatusTroca;
  avisos: AvisoTroca[];
  estoqueReservado: boolean;
  historico: HistoricoTroca[];
  vendedorId: string;
  vendedorNome: string;
  motivoRecusa?: string;
  motivoCancelamento?: string;
  custoTotalCentavos?: number;
  /** Fila de conferencia da expedicao (so' quando a empresa liga a conferencia). */
  statusConferencia?: 'aguardando' | 'em_conferencia' | 'conferido' | 'divergente';
  conferidoPorNome?: string;
  createdAtMillis: number;
  tenantId: string;
}

export const STATUS_TROCA_ORDEM: StatusTroca[] = ['Solicitada', 'Aprovada', 'Entregue', 'Recusada', 'Cancelada'];

export interface EstiloStatusTroca {
  cor: string;
  fundo: string;
  /** Frase curta pro vendedor entender em que pé está. */
  explicacao: string;
}

export const ESTILO_STATUS_TROCA: Record<StatusTroca, EstiloStatusTroca> = {
  Solicitada: { cor: '#f59e0b', fundo: 'rgba(245,158,11,0.18)', explicacao: 'Aguardando a loja aprovar' },
  Aprovada: { cor: '#3b82f6', fundo: 'rgba(59,130,246,0.18)', explicacao: 'Aprovada: a loja vai separar a reposição' },
  Entregue: { cor: '#10b981', fundo: 'rgba(16,185,129,0.18)', explicacao: 'Reposição entregue' },
  Recusada: { cor: '#ef4444', fundo: 'rgba(239,68,68,0.18)', explicacao: 'A loja recusou esta troca' },
  Cancelada: { cor: '#94a3b8', fundo: 'rgba(148,163,184,0.18)', explicacao: 'Troca cancelada' },
};

export type AcaoTroca = 'aprovar' | 'recusar' | 'entregar' | 'cancelar' | 'minuta' | 'conferir';

/** Quais botoes a retaguarda mostra em cada estado (o servidor confere de novo). */
export const acoesDaLoja = (status: StatusTroca): AcaoTroca[] => {
  if (status === 'Solicitada') return ['aprovar', 'recusar', 'cancelar'];
  if (status === 'Aprovada') return ['minuta', 'entregar', 'cancelar'];
  if (status === 'Entregue') return ['minuta'];
  return [];
};

/** Podem cancelar: a loja (Solicitada/Aprovada) ou o vendedor, so' na propria e ainda Solicitada. */
export const vendedorPodeCancelar = (troca: Pick<Troca, 'status' | 'vendedorId'>, usuarioId: string): boolean => (
  troca.status === 'Solicitada' && troca.vendedorId === usuarioId
);

export const totalDeItens = (itens: { quantidade: number }[]): number => itens.reduce((soma, i) => soma + Number(i.quantidade || 0), 0);

/**
 * Confere o rascunho no aparelho ANTES de salvar (o servidor confere de novo).
 * Devolve as mensagens em portugues; lista vazia = pode salvar.
 */
export const errosDoRascunhoDeTroca = (rascunho: { clienteId?: string | null; itens: ItemTrocaRascunho[] }): string[] => {
  const erros: string[] = [];
  if (!rascunho.clienteId) erros.push('Selecione o cliente da troca.');
  if (rascunho.itens.length === 0) erros.push('Adicione pelo menos um item na troca.');
  rascunho.itens.forEach((item, indice) => {
    if (!MOTIVOS_TROCA.some((m) => m.value === item.motivo)) erros.push(`Item ${indice + 1} (${item.nome}): escolha o motivo.`);
    if (item.motivo === 'outro' && (item.motivoDescricao || '').trim().length < 3) erros.push(`Item ${indice + 1} (${item.nome}): descreva o motivo.`);
  });
  return erros;
};

/** Custo em reais, pra mostrar. */
export const custoEmReais = (centavos: number | undefined): number => (centavos ? centavos / 100 : 0);
