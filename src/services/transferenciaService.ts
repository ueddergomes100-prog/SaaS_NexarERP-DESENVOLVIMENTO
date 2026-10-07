import { auth } from './firebase';
import { fetchComTimeout, mensagemDeFalhaDeRede } from '../utils/fetchComTimeout';

/**
 * Cliente HTTP das TRANSFERENCIAS entre filiais (fase 3). Toda gravacao
 * (estoque das duas filiais, lotes, a propria transferencia) e' do servidor
 * (server/routes/transferencias.routes.js); a tela so' manda o que a pessoa
 * escolheu.
 */

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

export class TransferenciaError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'TransferenciaError';
    this.status = status;
  }
}

const chamar = async <T>(caminho: string, corpo: Record<string, unknown> | null): Promise<T> => {
  if (!API_URL) {
    throw new TransferenciaError('Esta operação precisa do servidor da empresa, que não está configurado neste ambiente. Avise o suporte.', 0);
  }
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new TransferenciaError('Sua sessão expirou. Entre novamente para continuar.', 401);

  let resposta: Response;
  try {
    resposta = await fetchComTimeout(`${API_URL}/api/transferencias${caminho}`, corpo === null
      ? { method: 'GET', headers: { Authorization: `Bearer ${token}` } }
      : {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      });
  } catch (erro) {
    throw new TransferenciaError(`${mensagemDeFalhaDeRede(erro)} Confira na lista de transferências se a operação foi registrada antes de repetir.`, 0);
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new TransferenciaError(dados.error || 'Não foi possível concluir a operação. Tente novamente.', resposta.status);
  return dados as T;
};

export const enviarTransferencia = (dados: {
  destino: string;
  itens: Array<{ produtoId: string; quantidade: number }>;
  observacao?: string;
  comNota: boolean;
  idDocumento: string;
}) => chamar<{ id: string; numeroTransferencia: string; jaEnviada: boolean; nota?: NotaDaTransferencia; avisos?: string[] }>('', dados);

export const receberTransferencia = (id: string, recebidas: Record<number, number>) => (
  chamar<{ ok: true; divergente: boolean }>(`/${encodeURIComponent(id)}/receber`, { recebidas })
);

export const recusarTransferencia = (id: string, motivo: string) => chamar<{ ok: true }>(`/${encodeURIComponent(id)}/recusar`, { motivo });

export const cancelarTransferencia = (id: string, motivo: string) => chamar<{ ok: true }>(`/${encodeURIComponent(id)}/cancelar`, { motivo });

/** Espelho da nota fiscal na transferencia (fase 4 -- server/services/notaTransferencia.js). */
export interface NotaDaTransferencia {
  status: string;
  notaId?: string;
  number?: number | string | null;
  accessKey?: string | null;
  mensagem?: string;
  tentativa?: number;
  cfops?: string[];
  cfopsEntrada?: string[];
  tributacao?: string;
  reservadoEmMs?: number | null;
}

/** Origem emite a nota de novo (a anterior foi rejeitada, nao saiu ou ficou sem confirmacao). */
export const reemitirNotaDaTransferencia = (id: string) => (
  chamar<{ ok: true; nota: NotaDaTransferencia; avisos: string[] }>(`/${encodeURIComponent(id)}/nota`, {})
);

/** Consulta a Spedy e devolve a situacao atual da nota. */
export const consultarNotaDaTransferencia = (id: string) => (
  chamar<{ nota: NotaDaTransferencia | null }>(`/${encodeURIComponent(id)}/nota`, null)
);
