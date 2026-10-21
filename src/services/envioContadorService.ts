import { auth } from './firebase';
import { fetchComTimeout, mensagemDeFalhaDeRede, TEMPO_LIMITE } from '../utils/fetchComTimeout';

/**
 * Envio do relatorio ao contador (20/10/2026): o PDF e o .zip dos XMLs vao em
 * base64 para o servidor, que manda o e-mail pelo SMTP da empresa
 * (server/services/envioContador.js).
 */

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

export interface AnexoParaContador {
  tipo: 'pdf' | 'zip';
  nome: string;
  base64: string;
}

/** Bytes -> base64 em pedacos (String.fromCharCode com tudo de uma vez estoura a pilha). */
export const bytesParaBase64 = (bytes: Uint8Array): string => {
  let binario = '';
  const pedaco = 0x8000;
  for (let i = 0; i < bytes.length; i += pedaco) {
    binario += String.fromCharCode(...bytes.subarray(i, i + pedaco));
  }
  return btoa(binario);
};

export const enviarAoContador = async (dados: { para: string; periodo: string; anexos: AnexoParaContador[] }): Promise<{ para: string; anexos: string[] }> => {
  if (!API_URL) throw new Error('O servidor da empresa não está configurado neste ambiente. Avise o suporte.');
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Sua sessão expirou. Entre novamente para continuar.');
  let resposta: Response;
  try {
    resposta = await fetchComTimeout(`${API_URL}/api/relatorio-contador/enviar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(dados),
    }, TEMPO_LIMITE.emissaoNota);
  } catch (erro) {
    throw new Error(mensagemDeFalhaDeRede(erro), { cause: erro });
  }
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.error || 'Não foi possível enviar ao contador. Tente de novo em instantes.');
  return corpo as { para: string; anexos: string[] };
};
