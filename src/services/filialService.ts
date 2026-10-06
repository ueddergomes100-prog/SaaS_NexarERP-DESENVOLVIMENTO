import { auth } from './firebase';
import { fetchComTimeout, mensagemDeFalhaDeRede } from '../utils/fetchComTimeout';
import type { DadosDaFilial, FilialDoGrupo } from '../utils/filialDomain';
import type { EstoqueDaFilial } from '../utils/cadastroGrupoDomain';
import type { ResumoDaFilial } from '../utils/resumoGrupoDomain';

/**
 * Cliente HTTP das FILIAIS (2026-10-06). Grupo, filial ativa do usuario e
 * cadastro de filial so' o servidor grava (server/routes/filiais.routes.js).
 */

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

export class FilialError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'FilialError';
    this.status = status;
  }
}

export interface ResumoDasFiliais {
  grupo: { id: string; nome: string; matrizTenantId: string } | null;
  casa: string;
  filialAtiva: string;
  filiais: FilialDoGrupo[];
  podeTrocar: boolean;
  gestor: boolean;
  todasAsFiliais: FilialDoGrupo[];
  modulosBloqueados: string[];
  proximoCodigo: string;
}

const chamar = async <T>(metodo: 'GET' | 'POST' | 'PUT', caminho: string, corpo?: Record<string, unknown>): Promise<T> => {
  if (!API_URL) {
    throw new FilialError('Esta operação precisa do servidor da empresa, que não está configurado neste ambiente. Avise o suporte.', 0);
  }
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new FilialError('Sua sessão expirou. Entre novamente para continuar.', 401);

  let resposta: Response;
  try {
    resposta = await fetchComTimeout(`${API_URL}/api/filiais${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(corpo ? { body: JSON.stringify(corpo) } : {}),
    });
  } catch (erro) {
    throw new FilialError(mensagemDeFalhaDeRede(erro), 0);
  }

  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new FilialError(dados.error || 'Não foi possível concluir a operação. Tente novamente.', resposta.status);
  }
  return dados as T;
};

export const carregarFiliais = () => chamar<ResumoDasFiliais>('GET', '');

export const entrarNaFilial = (tenantId: string) => chamar<{ ok: true; filial: FilialDoGrupo }>('POST', '/ativar', { tenantId });

export const cadastrarFilial = (dados: Record<string, unknown>) => (
  chamar<{ tenantId: string; grupoId: string; filial: FilialDoGrupo }>('POST', '', dados)
);

export const lerCadastroDaFilial = (tenantId: string) => (
  chamar<{ filial: FilialDoGrupo; dados: DadosDaFilial }>('GET', `/${encodeURIComponent(tenantId)}`)
);

export const alterarFilial = (tenantId: string, dados: Partial<DadosDaFilial> & { ativa?: boolean }) => (
  chamar<{ ok: true; filial: FilialDoGrupo }>('PUT', `/${encodeURIComponent(tenantId)}`, dados)
);

/** Fase 2: estoque de cada produto (por grupoChave) em cada filial ativa. */
export const consultarEstoqueNasFiliais = (chaves: string[]) => (
  chamar<Record<string, EstoqueDaFilial[]>>('POST', '/estoque', { chaves })
);

/** Fase 2: saldo em aberto do cliente somando todas as filiais (limite de credito do grupo). */
export const consultarSaldoDoClienteNoGrupo = (clienteId: string) => (
  chamar<{ totalCentavos: number; porFilial: Array<{ tenantId: string; codigo: string; nome: string; centavos: number }> }>(
    'GET', `/clientes/${encodeURIComponent(clienteId)}/saldo`,
  )
);

/** Fase 5: vendas do periodo, a receber e estoque de cada filial (so' dono/administrador). */
export const consultarResumoDoGrupo = (inicio: string, fim: string) => (
  chamar<{ inicio: string; fim: string; filiais: ResumoDaFilial[]; total: Omit<ResumoDaFilial, 'tenantId' | 'codigo' | 'nome'> }>(
    'GET', `/resumo?inicio=${encodeURIComponent(inicio)}&fim=${encodeURIComponent(fim)}`,
  )
);
