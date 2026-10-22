import { auth } from './firebase';
import { fetchComTimeout, mensagemDeFalhaDeRede } from '../utils/fetchComTimeout';

/**
 * Chamada simples ao NOSSO servidor (/api/...), com o token da sessao. Erro
 * ja' em portugues (o servidor responde `{ error }`); `status` 0 = sem
 * resposta (rede). Usado pelos servicos novos (21/10/2026); os antigos tem
 * cada um a sua copia.
 */

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
export const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

export class ErroDoServidor extends Error {
  status: number;

  constructor(message: string, status: number, opcoes?: { cause?: unknown }) {
    super(message, opcoes);
    this.name = 'ErroDoServidor';
    this.status = status;
  }
}

export const chamarServidor = async <T>(
  metodo: 'GET' | 'POST' | 'DELETE',
  caminho: string,
  corpo?: Record<string, unknown>,
  opcoes: { falhou?: string } = {},
): Promise<T> => {
  if (!API_URL) throw new ErroDoServidor('O servidor não está configurado neste ambiente. Avise o suporte.', 0);
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new ErroDoServidor('Sua sessão expirou. Entre novamente para continuar.', 401);
  let resposta: Response;
  try {
    resposta = await fetchComTimeout(`${API_URL}/api/${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
      ...(corpo ? { body: JSON.stringify(corpo) } : {}),
    });
  } catch (erro) {
    throw new ErroDoServidor(mensagemDeFalhaDeRede(erro), 0, { cause: erro });
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new ErroDoServidor(dados.error || opcoes.falhou || 'Não foi possível falar com o servidor. Tente de novo em instantes.', resposta.status);
  return dados as T;
};
