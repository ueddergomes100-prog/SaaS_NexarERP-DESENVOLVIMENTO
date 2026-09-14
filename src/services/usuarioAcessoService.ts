import { auth } from './firebase';

/**
 * Cliente da rota de senha de ACESSO (login no sistema) de um funcionario --
 * diferente da senha do VENDEDOR (PIN de identificacao na venda, ver
 * vendedorPinService.ts). So o Admin SDK troca a senha de OUTRO usuario no
 * Firebase Auth, por isso a troca de verdade vive no backend (ver
 * server/services/usuarioSenha.js); aqui e' so' o cliente HTTP.
 */

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

export class UsuarioAcessoError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'UsuarioAcessoError';
    this.status = status;
  }
}

const ensureApiUrl = () => {
  if (!API_URL) {
    throw new UsuarioAcessoError(
      'Esta operação precisa do servidor da empresa, que não está configurado neste ambiente. Avise o suporte.',
      0,
    );
  }
  return API_URL;
};

const getAuthHeaders = async () => {
  const token = await auth.currentUser?.getIdToken();
  if (!token) {
    throw new UsuarioAcessoError('Sua sessão expirou. Entre novamente para continuar.', 401);
  }
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
};

/** Redefine a senha de acesso (login) de um funcionario. Somente administrador. */
export const redefinirSenhaAcesso = async (usuarioId: string, novaSenha: string): Promise<void> => {
  const base = ensureApiUrl();
  let resposta: Response;

  try {
    resposta = await fetch(`${base}/api/usuarios/redefinir-senha`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ usuarioId, novaSenha }),
    });
  } catch {
    throw new UsuarioAcessoError(
      'Não foi possível falar com o servidor. Verifique a internet e tente de novo.',
      0,
    );
  }

  const dados = await resposta.json().catch(() => ({}));

  if (!resposta.ok) {
    throw new UsuarioAcessoError(dados?.error || 'Não foi possível redefinir a senha. Tente novamente.', resposta.status);
  }
};
