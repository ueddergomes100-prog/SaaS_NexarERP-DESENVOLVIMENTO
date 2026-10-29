import { auth } from './firebase';
import { fetchComTimeout, mensagemDeFalhaDeRede } from '../utils/fetchComTimeout';

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

/** POST numa rota de /api/usuarios; devolve o JSON ou lanca o erro em portugues. */
const postar = async <T>(rota: string, corpo: Record<string, unknown>, falhou: string): Promise<T> => {
  const base = ensureApiUrl();
  let resposta: Response;
  try {
    resposta = await fetchComTimeout(`${base}/api/usuarios/${rota}`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify(corpo),
    });
  } catch (erro) {
    throw new UsuarioAcessoError(mensagemDeFalhaDeRede(erro), 0);
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new UsuarioAcessoError(dados?.error || falhou, resposta.status);
  return dados as T;
};

/**
 * Limites do plano (19/10/2026): o login novo e' criado pelo servidor, que
 * confere o limite de usuarios contratado (server/services/limitesDoPlano.js).
 */
/** `motorista`: ja' cria o motorista vinculado, a permissao de entregas e liga o app se houver vaga (26/10/2026). */
export const criarLoginNoServidor = (dados: { nome: string; usuario: string; senha: string; codigoVendedor?: string; motorista?: { telefone: string; cnh: string } }) =>
  postar<{ uid: string; limite: number; emUso: number; motorista?: boolean; appLiberado?: boolean; limiteApp?: number }>('criar', { ...dados }, 'Não foi possível criar o usuário. Tente novamente.');

/** Ficha do funcionario: nome, codigo e "e' motorista" (26/10/2026: pelo servidor, o gerente tambem edita). */
export const salvarFichaNoServidor = (dados: { usuarioId: string; nome: string; codigoVendedor?: string; motorista?: { telefone: string; cnh: string } }) =>
  postar<{ motorista?: { novo: boolean; appLiberado: boolean; limiteApp: number } }>('ficha', { ...dados }, 'Não foi possível salvar o funcionário. Tente novamente.');

/** Permissoes (e o nivel, so' dono/administrador) pelo servidor (26/10/2026). */
export const salvarPermissoesNoServidor = (usuarioId: string, permissoes: string[], nivelAcesso?: string) =>
  postar<{ ok: boolean }>('permissoes', { usuarioId, permissoes, ...(nivelAcesso ? { nivelAcesso } : {}) }, 'Não foi possível salvar as permissões. Tente novamente.');

/** Inativa ou reativa o usuario (26/10/2026: pelo servidor). */
export const alterarSituacaoNoServidor = (usuarioId: string, ativo: boolean) =>
  postar<{ ativo: boolean }>('situacao', { usuarioId, ativo }, 'Não foi possível alterar a situação do usuário. Tente novamente.');

/** Vincula um motorista ja' cadastrado (Operacoes > Motoristas) ao login deste funcionario (26/10/2026). */
export const vincularMotoristaNoServidor = (usuarioId: string, motoristaId: string) =>
  postar<{ appLiberado: boolean; limiteApp: number; motoristaNome: string; duplicadoRemovido?: boolean }>('vincular-motorista', { usuarioId, motoristaId }, 'Não foi possível vincular o motorista. Tente novamente.');

/** Liga/desliga o app Vendas de um funcionario ou vendedor; ligar confere a vaga contratada. */
export const alterarAcessoAppNoServidor = (usuarioId: string, ligar: boolean) =>
  postar<{ ligado: boolean }>('acesso-app', { usuarioId, ligar }, 'Não foi possível alterar o acesso ao aplicativo. Tente novamente.');

/** Redefine a senha de acesso (login) de um funcionario. Somente administrador. */
export const redefinirSenhaAcesso = async (usuarioId: string, novaSenha: string): Promise<void> => {
  const base = ensureApiUrl();
  let resposta: Response;

  try {
    resposta = await fetchComTimeout(`${base}/api/usuarios/redefinir-senha`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ usuarioId, novaSenha }),
    });
  } catch (erro) {
    throw new UsuarioAcessoError(mensagemDeFalhaDeRede(erro), 0);
  }

  const dados = await resposta.json().catch(() => ({}));

  if (!resposta.ok) {
    throw new UsuarioAcessoError(dados?.error || 'Não foi possível redefinir a senha. Tente novamente.', resposta.status);
  }
};
