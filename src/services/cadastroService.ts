import { auth } from './firebase';

/**
 * Cliente HTTP de inativar/reativar/excluir cadastro. A regra de verdade
 * (pendencias, saldo, movimentacao) mora em
 * server/services/cadastroIntegridade.js -- as firestore.rules proibem a
 * tela de mudar `ativo` ou apagar esses documentos direto, justamente pra
 * que ninguem pule as checagens pelo DevTools.
 */

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

export type ColecaoCadastro =
  | 'clientes' | 'fornecedores' | 'estoque' | 'materias_primas' | 'categorias' | 'marcas'
  | 'servicos' | 'veiculos' | 'unidades_medida' | 'bancos' | 'bandeiras_cartao';

export class CadastroError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'CadastroError';
    this.status = status;
  }
}

const chamar = async <T>(rota: string, corpo: Record<string, unknown>): Promise<T> => {
  if (!API_URL) {
    throw new CadastroError('Esta operação precisa do servidor da empresa, que não está configurado neste ambiente. Avise o suporte.', 0);
  }
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new CadastroError('Sua sessão expirou. Entre novamente para continuar.', 401);

  let resposta: Response;
  try {
    resposta = await fetch(`${API_URL}/api/cadastros/${rota}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
  } catch {
    throw new CadastroError('Não foi possível falar com o servidor. Verifique a internet e tente de novo.', 0);
  }

  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new CadastroError(dados.error || 'Não foi possível concluir a operação. Tente novamente.', resposta.status);
  }
  return dados as T;
};

/** Ativa/inativa. `saldoZerado` != 0 quando a inativacao zerou o estoque. */
export const alterarSituacaoCadastro = (colecao: ColecaoCadastro, id: string, ativo: boolean) => (
  chamar<{ ativo: boolean; saldoZerado: number }>('situacao', { colecao, id, ativo })
);

export const excluirCadastro = (colecao: ColecaoCadastro, id: string) => (
  chamar<{ excluido: boolean }>('excluir', { colecao, id })
);
