import { chamarServidor } from './apiServidor';
import type { SaldoDoItem, SituacaoEntregaFutura } from '../utils/entregaFuturaDomain';

/**
 * VENDA COM ENTREGA FUTURA (23/10/2026) -- cliente HTTP de
 * server/services/entregaFutura.js. Regra em src/utils/entregaFuturaDomain.ts.
 * A colecao `entregas_futuras` e' so' do servidor.
 */

export interface NotaResumida {
  id?: string;
  numero?: number | string | null;
  chave?: string | null;
  status?: string | null;
  mensagem?: string | null;
}

export interface ItemAEntregar extends SaldoDoItem {
  unidade: string;
  controlaLote: boolean;
  precoUnitario: number;
}

export interface PedidoAEntregar {
  id: string;
  numeroPedido: string;
  clienteId: string;
  clienteNome: string;
  vendedorNome: string;
  dataVenda: string;
  previsaoEntrega: string;
  atrasada: boolean;
  situacao: SituacaoEntregaFutura;
  valorTotalCentavos: number;
  entregas: number;
  itens: ItemAEntregar[];
  notaFaturamento?: NotaResumida | null;
}

export interface EntregaFeita {
  id: string;
  numero: number;
  titulo: string;
  criadoEmIso: string;
  criadoPorNome: string;
  observacao: string;
  valorCentavos: number;
  itens: Array<{ indice: number; id: string; nome: string; quantidade: number; unidade: string; lotes: Array<{ lote: string; validade: string; quantidade: number }> }>;
  notaFiscal: { status?: string; number?: number | string | null; accessKey?: string | null; mensagem?: string; notaId?: string } | null;
  romaneio: { id: string; titulo: string } | null;
}

export interface DetalheDaEntregaFutura {
  pedido: PedidoAEntregar;
  notaFaturamento: NotaResumida & { situacao: 'autorizada' | 'em_transito' | 'nenhuma' };
  entregas: EntregaFeita[];
  rotas: Array<{ id: string; titulo: string; quantidadePedidos: number }>;
}

export interface ResultadoDaEntrega {
  entregaId: string;
  numero: number;
  titulo: string;
  situacao: SituacaoEntregaFutura;
  nota: { ok: boolean; mensagem?: string; nota?: { number?: number | string | null; status?: string } } | null;
  rota: { acao: string; rota: { id: string; titulo: string } } | null;
  avisos: string[];
}

export const listarEntregasPendentes = async (): Promise<PedidoAEntregar[]> => (
  (await chamarServidor<{ pedidos: PedidoAEntregar[] }>('GET', 'entregas-futuras/pendentes')).pedidos
);

export const detalheDaEntregaFutura = (pedidoId: string) => chamarServidor<DetalheDaEntregaFutura>('GET', `entregas-futuras/${encodeURIComponent(pedidoId)}`);

export const registrarEntrega = (pedidoId: string, corpo: { itens: Array<{ indice: number; quantidade: number }>; romaneioId?: string; observacao?: string }) => (
  chamarServidor<ResultadoDaEntrega>('POST', `entregas-futuras/${encodeURIComponent(pedidoId)}/entregar`, { ...corpo }, { falhou: 'Não foi possível registrar a entrega. Tente de novo.' })
);

export const emitirNotaDaEntrega = (entregaId: string) => (
  chamarServidor<{ ok: boolean; mensagem?: string }>('POST', `entregas-futuras/entregas/${encodeURIComponent(entregaId)}/emitir-nota`, {}, { falhou: 'Não foi possível emitir a nota de remessa agora. Tente de novo.' })
);

export const colocarEntregaNaRota = (entregaId: string, romaneioId: string) => (
  chamarServidor<{ acao: string; rota: { id: string; titulo: string } }>('POST', `entregas-futuras/entregas/${encodeURIComponent(entregaId)}/rota`, { romaneioId })
);
