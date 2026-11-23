import { fetchComTimeout, mensagemDeFalhaDeRede } from '../utils/fetchComTimeout';
import { normalizarEstadoEnvio, type EstadoEnvioCodigo } from '../utils/envioCodigoDomain';

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

export interface PublicCnpjData {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string;
  situacao: string;
  municipio: string;
  uf: string;
  provider: string;
}

export interface StartOnboardingInput {
  nomeOficina: string;
  nomeResponsavel: string;
  cnpj: string;
  email: string;
  telefone: string;
}

export interface StartOnboardingResponse {
  ok: boolean;
  onboardingId: string;
  cnpj: PublicCnpjData;
  maskedEmail: string;
  devCodes?: {
    email?: string;
  };
}

export interface VerifyCodeInput {
  onboardingId: string;
  code: string;
}

export interface CompleteOnboardingInput {
  onboardingId: string;
  password: string;
}

const ensureApiUrl = () => {
  if (!API_URL) {
    throw new Error('Backend não configurado. Configure VITE_BACKEND_API_URL para liberar cadastros seguros.');
  }
  return API_URL;
};

const getApiError = async (response: Response, fallback: string) => {
  try {
    const data = await response.json();
    return data.error || fallback;
  } catch {
    return fallback;
  }
};

const postJson = async <T>(path: string, body: object, fallbackError: string): Promise<T> => {
  const baseUrl = ensureApiUrl();
  let response: Response;
  try {
    response = await fetchComTimeout(`${baseUrl}/api/onboarding${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (erro) {
    throw new Error(mensagemDeFalhaDeRede(erro), { cause: erro });
  }

  if (!response.ok) {
    throw new Error(await getApiError(response, fallbackError));
  }

  return response.json();
};

export const onboardingService = {
  validateCnpj(cnpj: string) {
    return postJson<{ ok: boolean; cnpj: PublicCnpjData }>(
      '/validate-cnpj',
      { cnpj },
      'Não foi possível validar o CNPJ.'
    );
  },

  start(input: StartOnboardingInput) {
    return postJson<StartOnboardingResponse>(
      '/start',
      input,
      'Não foi possível iniciar o cadastro seguro.'
    );
  },

  verifyEmail(input: VerifyCodeInput) {
    return postJson<{ ok: boolean }>(
      '/verify-email',
      input,
      'Não foi possível validar o código de e-mail.'
    );
  },

  resendCode(onboardingId: string) {
    return postJson<{ ok: boolean; devCode?: string }>(
      '/resend-code',
      { onboardingId },
      'Não foi possível reenviar o código.'
    );
  },

  /**
   * O código foi entregue? O servidor devolve só o estado do último envio
   * daquele cadastro (ver utils/envioCodigoDomain.ts).
   */
  async statusEnvio(onboardingId: string): Promise<EstadoEnvioCodigo> {
    const resposta = await postJson<{ ok: boolean; estado?: unknown }>(
      '/status-envio',
      { onboardingId },
      'Não foi possível consultar o envio do código.'
    );
    return normalizarEstadoEnvio(resposta.estado);
  },

  complete(input: CompleteOnboardingInput) {
    return postJson<{ ok: boolean; email: string }>(
      '/complete',
      input,
      'Não foi possível finalizar o cadastro.'
    );
  }
};
