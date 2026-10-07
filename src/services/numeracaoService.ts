import { auth } from './firebase';
import { fetchComTimeout, mensagemDeFalhaDeRede } from '../utils/fetchComTimeout';
import type { SituacaoDaSequencia } from '../utils/numeracaoDomain';

/**
 * Cliente HTTP da NUMERACAO DOS DOCUMENTOS (Configuracoes por filial, fase C).
 * Leitura e ajuste sao do servidor (server/routes/numeracao.routes.js), que
 * confere dono/administrador e nunca deixa a numeracao voltar.
 */

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

export class NumeracaoError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'NumeracaoError';
    this.status = status;
  }
}

const chamar = async <T>(metodo: 'GET' | 'PUT', caminho: string, corpo?: Record<string, unknown>): Promise<T> => {
  if (!API_URL) throw new NumeracaoError('Esta operação precisa do servidor da empresa, que não está configurado neste ambiente. Avise o suporte.', 0);
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new NumeracaoError('Sua sessão expirou. Entre novamente para continuar.', 401);
  let resposta: Response;
  try {
    resposta = await fetchComTimeout(`${API_URL}/api/numeracao${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
      ...(corpo ? { body: JSON.stringify(corpo) } : {}),
    });
  } catch (erro) {
    throw new NumeracaoError(mensagemDeFalhaDeRede(erro), 0);
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new NumeracaoError(dados.error || 'Não foi possível concluir a operação. Tente novamente.', resposta.status);
  return dados as T;
};

export const listarNumeracao = () => chamar<{ tenantId: string; sequencias: SituacaoDaSequencia[] }>('GET', '');

export const ajustarNumeracao = (chave: string, proximo: string) => (
  chamar<{ antes: number; agora: number; proximo: number; rotulo: string }>('PUT', `/${encodeURIComponent(chave)}`, { proximo })
);
