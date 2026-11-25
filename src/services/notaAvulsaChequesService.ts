import { auth } from './firebase';
import { fetchComTimeout, mensagemDeFalhaDeRede } from '../utils/fetchComTimeout';

/**
 * Nota Avulsa paga com CHEQUE DE CLIENTE (25/11/2026, Embala Minas). O
 * repasse (cheque pago, venda de origem, titulo da nota) e' feito no servidor:
 * server/services/repasseCheques.js.
 */

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

const chamar = async <T>(caminho: string, metodo: 'GET' | 'POST' = 'GET'): Promise<T> => {
  if (!API_URL) throw new Error('Pagar com cheque de cliente precisa do servidor da empresa, que não está configurado neste ambiente. Avise o suporte.');
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Sua sessão expirou. Entre novamente para continuar.');
  let resposta: Response;
  try {
    resposta = await fetchComTimeout(`${API_URL}/api/nota-avulsa${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, ...(metodo === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      ...(metodo === 'POST' ? { body: '{}' } : {}),
    });
  } catch (erro) {
    throw new Error(mensagemDeFalhaDeRede(erro), { cause: erro });
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados.error || 'Não foi possível concluir. Tente novamente.');
  return dados as T;
};

export interface ChequeDaCarteira {
  id: string;
  numeroCheque: string;
  bancoEmissor: string;
  clienteNome: string;
  descricao: string;
  /** AAAA-MM-DD */
  bomPara: string;
  centavos: number;
}

export const notaAvulsaChequesService = {
  naCarteira: () => chamar<{ cheques: ChequeDaCarteira[] }>('/cheques-na-carteira'),
  repassar: (notaId: string) => chamar<{ ok: boolean; jaRepassado: boolean; totalCentavos: number; quantidade: number }>(`/${encodeURIComponent(notaId)}/repassar-cheques`, 'POST'),
  desfazer: (notaId: string) => chamar<{ ok: boolean; desfeito: boolean }>(`/${encodeURIComponent(notaId)}/desfazer-repasse`, 'POST'),
};
