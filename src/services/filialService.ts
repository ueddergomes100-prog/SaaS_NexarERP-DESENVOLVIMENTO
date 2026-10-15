import { auth } from './firebase';
import { fetchComTimeout, mensagemDeFalhaDeRede } from '../utils/fetchComTimeout';
import type { DadosDaFilial, FilialDoGrupo } from '../utils/filialDomain';
import type { EstoqueDaFilial } from '../utils/cadastroGrupoDomain';
import type { ResumoDaFilial } from '../utils/resumoGrupoDomain';
import type { ConfiguracoesGerais } from '../utils/configuracoesGeraisDomain';

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
  /** Plano (07/10): filiais liberadas alem da matriz e quantas estao em uso. */
  limiteFiliais: number;
  filiaisEmUso: number;
  /** Empresa sem filiais (15/10/2026): ela mesma, como Matriz (10). */
  matrizSemFiliais?: FilialDoGrupo | null;
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
  chamar<{ totalCentavos: number; maiorAtrasoDias: number; porFilial: Array<{ tenantId: string; codigo: string; nome: string; centavos: number }> }>(
    'GET', `/clientes/${encodeURIComponent(clienteId)}/saldo`,
  )
);

/**
 * Configuracoes Gerais (15/10/2026): o servidor grava o mesmo valor em todas
 * as filiais do grupo (ou so' na empresa, sem filiais). `tenantId` so' vale
 * para o administrador da plataforma (empresa escolhida na tela dele).
 */
export const salvarConfiguracoesGerais = (valores: ConfiguracoesGerais & { tenantId?: string }) => (
  chamar<{ filiais: number; grupo: string | null; valores: ConfiguracoesGerais }>('POST', '/configuracoes-gerais', { ...valores })
);

/** Filial padrao (15/10/2026): no login, o servidor abre a filial padrao do usuario. */
export const entrarNaFilialPadrao = () => chamar<{ mudou: boolean; filial: FilialDoGrupo | null }>('POST', '/entrar-na-padrao');

/** Filial padrao de um usuario do grupo (so' dono/administrador). */
export const definirFilialPadrao = (usuarioId: string, tenantId: string) => (
  chamar<{ ok: true; filial: FilialDoGrupo }>('PUT', `/usuarios/${encodeURIComponent(usuarioId)}/filial-padrao`, { tenantId })
);

/** Fase 5: vendas do periodo, a receber e estoque de cada filial (so' dono/administrador). */
export const consultarResumoDoGrupo = (inicio: string, fim: string) => (
  chamar<{ inicio: string; fim: string; filiais: ResumoDaFilial[]; total: Omit<ResumoDaFilial, 'tenantId' | 'codigo' | 'nome'> }>(
    'GET', `/resumo?inicio=${encodeURIComponent(inicio)}&fim=${encodeURIComponent(fim)}`,
  )
);
