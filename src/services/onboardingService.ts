const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

export type OnboardingCodeType = 'email' | 'phone';

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
  maskedPhone: string;
  devCodes?: {
    email?: string;
    phone?: string;
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
    throw new Error('Backend nao configurado. Configure VITE_BACKEND_API_URL para liberar cadastros seguros.');
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
  const response = await fetch(`${baseUrl}/api/onboarding${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

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
      'Nao foi possivel validar o CNPJ.'
    );
  },

  start(input: StartOnboardingInput) {
    return postJson<StartOnboardingResponse>(
      '/start',
      input,
      'Nao foi possivel iniciar o cadastro seguro.'
    );
  },

  verifyEmail(input: VerifyCodeInput) {
    return postJson<{ ok: boolean }>(
      '/verify-email',
      input,
      'Nao foi possivel validar o codigo de e-mail.'
    );
  },

  verifyPhone(input: VerifyCodeInput) {
    return postJson<{ ok: boolean }>(
      '/verify-phone',
      input,
      'Nao foi possivel validar o codigo de telefone.'
    );
  },

  resendCode(onboardingId: string, type: OnboardingCodeType) {
    return postJson<{ ok: boolean; devCode?: string }>(
      '/resend-code',
      { onboardingId, type },
      'Nao foi possivel reenviar o codigo.'
    );
  },

  complete(input: CompleteOnboardingInput) {
    return postJson<{ ok: boolean; email: string }>(
      '/complete',
      input,
      'Nao foi possivel finalizar o cadastro.'
    );
  }
};
