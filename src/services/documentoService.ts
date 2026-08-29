import { auth } from './firebase';

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

export interface ConsultaCnpjResultado {
  cnpj: string;
  encontrado: boolean;
  razaoSocial?: string;
  nomeFantasia?: string;
  situacao?: string;
  ativo?: boolean;
  municipio?: string;
  uf?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  telefone?: string;
  email?: string;
}

/** CPF nao tem consulta publica gratuita no Brasil (protegido por
 * privacidade) -- via provedor pago (apicpf.com), so devolve nome/genero/
 * data de nascimento, sem endereco nem situacao cadastral. */
export interface ConsultaCpfResultado {
  cpf: string;
  encontrado: boolean;
  nome?: string;
  genero?: string;
  dataNascimento?: string;
}

const getAuthHeaders = async () => {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Usuário não autenticado.');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
};

const postJson = async <T>(path: string, body: Record<string, string>, fallbackError: string): Promise<T> => {
  if (!API_URL) {
    throw new Error('Backend não configurado. Configure VITE_BACKEND_API_URL para usar esta consulta.');
  }

  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || fallbackError);
  }
  return data as T;
};

export const documentoService = {
  /** Consulta o CNPJ na Receita Federal (via backend, provedor configurado
   * em CNPJ_PROVIDER). So chama pra CNPJ com digito verificador ja valido
   * -- o chamador confere isso antes (src/utils/documentoValidacao.ts),
   * pra nao gastar a consulta com numero visivelmente errado. */
  consultarCnpj(cnpj: string) {
    return postJson<ConsultaCnpjResultado>('/api/documentos/consultar-cnpj', { cnpj }, 'Não foi possível consultar este CNPJ agora.');
  },

  /** Consulta nome/genero/data de nascimento do CPF via apicpf.com
   * (provedor pago, contratado 2026-08-29). Mesma regra: so chama com
   * digito verificador ja valido. */
  consultarCpf(cpf: string) {
    return postJson<ConsultaCpfResultado>('/api/documentos/consultar-cpf', { cpf }, 'Não foi possível consultar este CPF agora.');
  },
};
