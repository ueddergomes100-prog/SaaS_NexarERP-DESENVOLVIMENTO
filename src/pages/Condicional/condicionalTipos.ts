import type { ItemCondicional, StatusCondicional } from '../../utils/condicionalDomain';

/** Documento `condicionais/{id}` como a tela lê (quem grava é o servidor). */
export interface CondicionalDoc {
  id: string;
  numeroCondicional: string;
  clienteId: string;
  clienteNome: string;
  clienteTelefone?: string;
  itens: ItemCondicional[];
  prazoDevolucao: string;
  dataSaida: string;
  status: StatusCondicional;
  observacao?: string;
  valorLevado?: number;
  criadoPorNome?: string;
  pedidoId?: string;
  numeroPedido?: string;
  motivoCancelamento?: string;
  historico?: Array<{ tipo: string; em: string; porNome?: string; motivo?: string; numeroPedido?: string; itens?: Array<{ id: string; quantidade: number }>; semVenda?: boolean }>;
  createdAt?: { toMillis?: () => number; seconds?: number };
}

export const dataBr = (iso?: string) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('/') : '-');

export const moeda = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const ESTILO_STATUS: Record<StatusCondicional, { cor: string; fundo: string }> = {
  aberto: { cor: '#f59e0b', fundo: 'rgba(245, 158, 11, 0.15)' },
  finalizado: { cor: '#10b981', fundo: 'rgba(16, 185, 129, 0.15)' },
  devolvido: { cor: '#3b82f6', fundo: 'rgba(59, 130, 246, 0.15)' },
  cancelado: { cor: '#94a3b8', fundo: 'rgba(148, 163, 184, 0.15)' },
};
