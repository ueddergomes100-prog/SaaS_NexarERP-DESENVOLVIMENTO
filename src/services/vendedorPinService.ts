import { auth } from './firebase';
import type { VendedorIdentificado } from '../utils/vendedorPinDomain';

/**
 * Cliente das rotas de PIN do vendedor (identificacao na hora da venda).
 *
 * A validacao de verdade acontece SEMPRE no backend -- ver
 * `server/services/vendedorPin.js`. Aqui nao ha nem hash nem comparacao:
 * com 4 digitos, qualquer verificacao no navegador seria quebrada em
 * milissegundos. As funcoes puras de `vendedorPinDomain.ts` servem so pra
 * avisar o usuario cedo sobre formato, nao pra decidir acesso.
 *
 * O `tenantId` nunca e' enviado: o backend usa o do token de quem chamou.
 */

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

/** Erro com o status HTTP preservado -- a tela precisa distinguir senha
 *  errada (401) de vendedor bloqueado (429) e de cadastro faltando (409). */
export class VendedorPinError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'VendedorPinError';
    this.status = status;
  }
}

const ensureApiUrl = () => {
  if (!API_URL) {
    throw new VendedorPinError(
      'A identificação do vendedor precisa do servidor da empresa, que não está configurado neste ambiente. Avise o suporte.',
      0,
    );
  }
  return API_URL;
};

const getAuthHeaders = async () => {
  const token = await auth.currentUser?.getIdToken();
  if (!token) {
    throw new VendedorPinError('Sua sessão expirou. Entre novamente para continuar.', 401);
  }
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
};

const post = async <T>(caminho: string, corpo: Record<string, unknown>): Promise<T> => {
  const base = ensureApiUrl();
  let resposta: Response;

  try {
    resposta = await fetch(`${base}/api/vendedor-pin${caminho}`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify(corpo),
    });
  } catch {
    // Falha de rede: a mensagem tem que dizer o que fazer, nao "Failed to
    // fetch". No balcao, quem le isso e' o vendedor, com o cliente esperando.
    throw new VendedorPinError(
      'Não foi possível falar com o servidor. Verifique a internet e tente de novo.',
      0,
    );
  }

  const dados = await resposta.json().catch(() => ({}));

  if (!resposta.ok) {
    throw new VendedorPinError(
      dados?.error || 'Não foi possível validar o vendedor. Tente novamente.',
      resposta.status,
    );
  }

  return dados as T;
};

/** Valida codigo + PIN e devolve quem e' o vendedor. */
export const validarVendedor = (codigo: string, pin: string): Promise<VendedorIdentificado> =>
  post<VendedorIdentificado>('/validar', { codigo, pin });

/** Define ou reseta o PIN de um funcionario (somente administrador). */
export const definirPinVendedor = (usuarioId: string, pin: string): Promise<{ ok: boolean; codigo: string }> =>
  post<{ ok: boolean; codigo: string }>('/definir', { usuarioId, pin });

/** Remove o PIN de um funcionario (somente administrador). */
export const removerPinVendedor = (usuarioId: string): Promise<{ ok: boolean; removido: boolean }> =>
  post<{ ok: boolean; removido: boolean }>('/remover', { usuarioId });
