import { auth } from './firebase';
import { fetchComTimeout, mensagemDeFalhaDeRede } from '../utils/fetchComTimeout';

/**
 * Painel da Plataforma (28/10/2026): modulos do plano de uma empresa, gravados
 * pelo servidor no dono, na configuracao e no grupo das filiais de uma vez
 * (server/routes/plataforma.routes.js).
 */

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

export interface ResultadoModulosBloqueados {
  tenantId: string;
  modulosBloqueados: string[];
  filiais: number;
}

export const salvarModulosBloqueados = async (tenantId: string, modulos: string[]): Promise<ResultadoModulosBloqueados> => {
  if (!API_URL) throw new Error('Esta operação precisa do servidor, que não está configurado neste ambiente. Avise o suporte.');
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Sua sessão expirou. Entre novamente para continuar.');
  let resposta: Response;
  try {
    resposta = await fetchComTimeout(`${API_URL}/api/plataforma/modulos-bloqueados`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, modulos }),
    });
  } catch (erro) {
    throw new Error(mensagemDeFalhaDeRede(erro), { cause: erro });
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados.error || 'Não foi possível salvar os módulos. Tente novamente.');
  return dados as ResultadoModulosBloqueados;
};
