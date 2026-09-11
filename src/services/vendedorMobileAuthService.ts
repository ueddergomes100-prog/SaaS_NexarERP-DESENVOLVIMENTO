/**
 * Cliente do login do vendedor de balcao no aplicativo mobile (mesmo
 * codigo+PIN do balcao). Diferente de vendedorPinService.ts: esta chamada
 * e' PUBLICA (sem sessao ainda, sem cabecalho de autenticacao) -- e' o que
 * inicia a sessao, nao o que a usa.
 */

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

export class VendedorMobileAuthError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'VendedorMobileAuthError';
    this.status = status;
  }
}

export interface VendedorMobileLoginResultado {
  token: string;
  vendedorNome: string;
}

/** Troca CNPJ da empresa + codigo do vendedor + PIN por um token do Firebase
 *  pra logar no app com signInWithCustomToken. Ver
 *  server/routes/vendedorMobileAuth.routes.js. */
export const loginVendedorMobile = async (
  cnpj: string,
  codigo: string,
  pin: string,
): Promise<VendedorMobileLoginResultado> => {
  if (!API_URL) {
    throw new VendedorMobileAuthError(
      'O login do vendedor externo precisa do servidor da empresa, que não está configurado neste ambiente. Avise o suporte.',
      0,
    );
  }

  let resposta: Response;
  try {
    resposta = await fetch(`${API_URL}/api/vendedor/mobile-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cnpj, codigo, pin }),
    });
  } catch {
    throw new VendedorMobileAuthError(
      'Não foi possível falar com o servidor. Verifique a internet e tente de novo.',
      0,
    );
  }

  const dados = await resposta.json().catch(() => ({}));

  if (!resposta.ok) {
    throw new VendedorMobileAuthError(
      dados?.error || 'Não foi possível entrar. Confira os dados e tente de novo.',
      resposta.status,
    );
  }

  return dados as VendedorMobileLoginResultado;
};
