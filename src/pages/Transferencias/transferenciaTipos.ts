import type { ItemDaTransferencia, StatusTransferencia } from '../../utils/transferenciaDomain';
import type { NotaDaTransferencia } from '../../services/transferenciaService';

export interface TransferenciaDoc {
  id: string;
  tenantOrigem: string;
  tenantDestino: string;
  origemCodigo: string;
  origemNome: string;
  destinoCodigo: string;
  destinoNome: string;
  numeroTransferencia: string;
  status: StatusTransferencia;
  comNota: boolean;
  itens: ItemDaTransferencia[];
  valorCentavos: number;
  observacao?: string;
  divergente?: boolean;
  motivo?: string;
  enviadoPorNome?: string;
  enviadoEm?: { toDate?: () => Date } | null;
  recebidoPorNome?: string;
  historico?: Array<{ acao: string; em: string; por: string; motivo?: string }>;
  /** Fase 4: espelho da NF-e de transferencia. */
  notaFiscal?: NotaDaTransferencia;
  /** Nota de entrada lancada no destino ao receber (notas_fiscais_entrada). */
  entradaNotaId?: string;
}

export const ESTILO_STATUS_TRANSFERENCIA: Record<StatusTransferencia, { fundo: string; cor: string }> = {
  em_transito: { fundo: 'rgba(245, 158, 11, 0.15)', cor: '#f59e0b' },
  recebida: { fundo: 'rgba(16, 185, 129, 0.15)', cor: '#10b981' },
  recusada: { fundo: 'rgba(239, 68, 68, 0.12)', cor: '#ef4444' },
  cancelada: { fundo: 'var(--bg-tertiary)', cor: 'var(--text-muted)' },
};

export const moeda = (centavos: number) => (Number(centavos || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const dataHora = (valor: TransferenciaDoc['enviadoEm']): string => {
  const d = valor && typeof valor.toDate === 'function' ? valor.toDate() : null;
  return d ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
};

export const quantidade = (n: number) => (Number.isInteger(n) ? String(n) : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 }));
