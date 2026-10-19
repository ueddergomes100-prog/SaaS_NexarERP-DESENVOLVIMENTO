/*
 * LIBERACAO DE DESCONTO PELO SERVIDOR (19/10/2026).
 *
 * Com a chave "Venda pelo servidor" ligada, a senha (ou o PIN) de quem libera
 * o desconto acima do limite e' conferida pelo servidor
 * (server/services/liberacaoDesconto.js), que devolve um comprovante de curta
 * duracao. O Finalizar manda o comprovante e o servidor o gasta na venda.
 */
import { postarNoServidor } from './vendaServidorService';
import type { TelaDoDesconto } from '../utils/conferenciaDescontoDomain';

export interface ResultadoDaLiberacao {
  ok: true;
  comprovanteId: string;
  validoAteMs: number;
  aprovadoPorId: string;
  aprovadoPorNome: string;
}

export type AprovadorDaLiberacao =
  | { tipo: 'login'; idToken: string }
  | { tipo: 'vendedor'; codigo: string; pin: string };

export const liberarDescontoNoServidor = (args: {
  tela: TelaDoDesconto;
  baseCentavos: number;
  descontoCentavos: number;
  aprovador: AprovadorDaLiberacao;
}) => postarNoServidor<ResultadoDaLiberacao>('liberar', { ...args },
  'Não foi possível conferir a liberação. Tente novamente.',
  'Peça a liberação de novo.', 'descontos');
