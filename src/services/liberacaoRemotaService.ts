import { chamarServidor } from './apiServidor';
import type { CredencialDoGerente, ItemDoPedidoRemoto, StatusLiberacaoRemota, TelaDoPedidoRemoto } from '../utils/liberacaoRemotaDomain';

/**
 * LIBERACAO DE DESCONTO PELO CELULAR (21/10/2026) -- cliente HTTP de
 * server/services/liberacaoRemota.js. Regra em src/utils/liberacaoRemotaDomain.ts.
 */

export interface PedidoAoGerente {
  tela: TelaDoPedidoRemoto;
  baseCentavos: number;
  descontoCentavos: number;
  motivo: string;
  documento: string;
  /** Itens da venda, para o gerente ver no app (22/10/2026). */
  itens?: ItemDoPedidoRemoto[];
  /** Estacao compartilhada: o vendedor escolhido na lista como quem pede. */
  vendedor?: { id: string; nome: string } | null;
}

export interface LiberacaoRemota {
  id: string;
  status: StatusLiberacaoRemota;
  tela: TelaDoPedidoRemoto;
  baseCentavos: number;
  descontoCentavos: number;
  percentual: number;
  motivo: string;
  documento: string;
  solicitanteId: string;
  solicitanteNome: string;
  /** Estacao (usuario logado) quando quem pede e' um vendedor escolhido na lista. */
  estacaoNome: string | null;
  itens: ItemDoPedidoRemoto[];
  criadoEmIso: string;
  expiraEmMs: number;
  texto: string;
  aprovadorId?: string;
  aprovadorNome?: string;
  motivoRecusa?: string;
  /** So' a estacao que pediu recebe o comprovante (vale 30 minutos no Finalizar). */
  comprovanteId?: string;
  validoAteMs?: number;
}

export const pedirLiberacaoAoGerente = (pedido: PedidoAoGerente) => chamarServidor<{
  ok: true; id: string; expiraEmMs: number; aprovadores: number; aparelhosAvisados: number; avisosDesligados: boolean;
}>('POST', 'descontos/pedir-liberacao', { ...pedido }, { falhou: 'Não foi possível pedir a liberação ao gerente. Tente de novo.' });

export const consultarLiberacao = (id: string) => chamarServidor<LiberacaoRemota>('GET', `descontos/liberacoes/${encodeURIComponent(id)}`);

export const cancelarLiberacao = (id: string) => chamarServidor<LiberacaoRemota>('POST', `descontos/liberacoes/${encodeURIComponent(id)}/cancelar`, {});

export const listarLiberacoesPendentes = async (): Promise<LiberacaoRemota[]> => (
  (await chamarServidor<{ liberacoes: LiberacaoRemota[] }>('GET', 'descontos/liberacoes/pendentes')).liberacoes
);

export const responderLiberacao = (id: string, resposta: { decisao: 'aprovar' | 'recusar'; motivoRecusa?: string; credencial: CredencialDoGerente }) => (
  chamarServidor<{ ok: true; id: string; decisao: 'aprovar' | 'recusar'; aprovadorNome: string; texto: string }>(
    'POST', `descontos/liberacoes/${encodeURIComponent(id)}/responder`, { ...resposta }, { falhou: 'Não foi possível responder agora. Tente de novo.' },
  )
);
