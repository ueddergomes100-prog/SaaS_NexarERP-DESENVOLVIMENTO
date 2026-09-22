import { auth } from './firebase';

/**
 * Busca da nota de entrada pela CHAVE DE ACESSO (2026-09-21).
 *
 * A tela manda so' os 44 numeros; quem fala com a Spedy/SEFAZ e' o servidor
 * (server/routes/notaRecebida.routes.js) -- a chave de API da empresa nunca
 * chega ao navegador.
 *
 * O XML completo so' existe depois da MANIFESTACAO na SEFAZ, que e' ato
 * fiscal em nome da empresa. Por isso `buscar` pode devolver
 * `situacao: 'manifestar'`: a tela mostra a nota encontrada e PERGUNTA antes
 * de registrar a ciencia. Nunca manifestar sozinho.
 */

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

export interface NotaRecebidaResumo {
  id: string;
  numero: string;
  serie: string;
  emitenteNome: string;
  emitenteCnpj: string;
  emitidaEm: string;
  valorTotal: number;
  chave: string;
}

export interface RespostaBuscaNota {
  situacao: 'pronta' | 'manifestar' | 'aguardando';
  motivo?: string;
  aviso?: string;
  nota?: NotaRecebidaResumo;
  xml?: string;
}

export class NotaRecebidaError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'NotaRecebidaError';
    this.status = status;
  }
}

const chamar = async <T>(caminho: string, init?: RequestInit): Promise<T> => {
  if (!API_URL) {
    throw new NotaRecebidaError(
      'Buscar nota pela chave precisa do servidor da empresa, que não está configurado neste ambiente. '
      + 'Use o arquivo XML por enquanto.',
      0,
    );
  }
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new NotaRecebidaError('Sua sessão expirou. Entre novamente para continuar.', 401);

  let resposta: Response;
  try {
    resposta = await fetch(`${API_URL}/api/entrada-nfe/${caminho}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
  } catch {
    throw new NotaRecebidaError('Não foi possível falar com o servidor. Verifique a internet e tente de novo.', 0);
  }

  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new NotaRecebidaError(dados.error || 'Não foi possível consultar a nota. Tente novamente.', resposta.status);
  }
  return dados as T;
};

export const notaRecebidaService = {
  /** Procura a nota na SEFAZ pela chave. Pode voltar pedindo a manifestação. */
  buscar: (chave: string) => chamar<RespostaBuscaNota>(`buscar?chave=${encodeURIComponent(chave)}`),
  /** Registra a Ciência da Operação e devolve o XML. Só depois do "sim" do usuário. */
  manifestar: (id: string) => chamar<RespostaBuscaNota>('manifestar', { method: 'POST', body: JSON.stringify({ id }) }),
};
