/*
 * OS PELO SERVIDOR (item 8 da auditoria, fatia 3d -- 19/10/2026).
 *
 * Com a chave "Venda pelo servidor" ligada para a empresa, finalizar, reabrir e
 * cancelar a OS passam pelo servidor (server/services/osServidor.js): a tela
 * grava so' os dados da OS e o servidor grava estoque, lotes, comissao,
 * lancamentos e saldo do banco numa transacao. Com a chave desligada a tela usa
 * osFechamentoService.ts, que executa o mesmo plano.
 */
import { postarNoServidor } from './vendaServidorService';
import type { LoteUsado } from '../utils/loteRetornoDomain';

export { VendaServidorError as OsServidorError } from './vendaServidorService';

const CONFIRA_ANTES = 'Abra a OS de novo para conferir se a operação foi gravada antes de tentar outra vez.';

export interface ResultadoDaFinalizacaoDaOs {
  ok: true;
  jaEnviado: boolean;
  osId: string;
  numeroOS: string;
  totalCentavos: number;
  formaPagamento: string;
}

/** `pagamentos` = as linhas da tela (forma, valor, banco...). O total vem da OS gravada. */
export const finalizarOsNoServidor = (args: { osId: string; dataSaida: string; pagamentos: unknown[]; lotes: Record<string, LoteUsado[]> }) =>
  postarNoServidor<ResultadoDaFinalizacaoDaOs>('finalizar', { ...args },
    'Não foi possível finalizar a OS. O dinheiro e o estoque não foram mexidos. Tente novamente.',
    'Toque em Salvar de novo: se a OS já tiver sido finalizada, o sistema não finaliza duas vezes.', 'os');

export interface ResultadoDaReaberturaDaOs {
  ok: true;
  osId: string;
  numeroOS: string;
  status: string;
  pecasDevolvidas: boolean;
}

export const reabrirOsNoServidor = (osId: string, status: string) =>
  postarNoServidor<ResultadoDaReaberturaDaOs>('reabrir', { osId, status },
    'Não foi possível reabrir a OS. Nada foi gravado. Tente novamente.', CONFIRA_ANTES, 'os');

export interface ResultadoDoCancelamentoDaOs {
  ok: true;
  osId: string;
  numeroOS: string;
  devolveuEstoque: boolean;
}

export const cancelarOsNoServidor = (osId: string, motivo: string, devolverEstoque: boolean) =>
  postarNoServidor<ResultadoDoCancelamentoDaOs>('cancelar', { osId, motivo, devolverEstoque },
    'Não foi possível cancelar a OS. Nada foi gravado. Tente novamente.', CONFIRA_ANTES, 'os');
