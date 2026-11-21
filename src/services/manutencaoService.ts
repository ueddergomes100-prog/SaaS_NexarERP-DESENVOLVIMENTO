import { auth } from './firebase';
import { fetchComTimeout, mensagemDeFalhaDeRede, TEMPO_LIMITE } from '../utils/fetchComTimeout';

/**
 * Cliente HTTP da MANUTENCAO DO BANCO (Painel da Plataforma, 2026-10-15).
 * Quem roda e' o servidor do proprio ambiente (server/routes/manutencao.routes.js),
 * que confere se o usuario e' administrador da plataforma.
 */

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

export type ModoDatasFaltantes = 'simular' | 'aplicar' | 'desfazer';

export interface ResumoColecaoDatas {
  nome: string;
  campo: string;
  lidos: number;
  ok: number;
  alterados: number;
  totalSemData: number;
  semData: string[];
  totalPendentesSemVencimento: number;
  pendentesSemVencimento: string[];
}

export interface ResultadoDatasFaltantes {
  projeto: string | null;
  modo: ModoDatasFaltantes;
  tenantId: string | null;
  colecoes: ResumoColecaoDatas[];
}

export class ManutencaoError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ManutencaoError';
    this.status = status;
  }
}

export const rodarDatasFaltantes = async (modo: ModoDatasFaltantes): Promise<ResultadoDatasFaltantes> => {
  if (!API_URL) throw new ManutencaoError('Esta operação precisa do servidor, que não está configurado neste ambiente. Avise o suporte.', 0);
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new ManutencaoError('Sua sessão expirou. Entre novamente para continuar.', 401);
  let resposta: Response;
  try {
    resposta = await fetchComTimeout(`${API_URL}/api/manutencao/datas-faltantes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ modo }),
    }, TEMPO_LIMITE.manutencao);
  } catch (erro) {
    throw new ManutencaoError(mensagemDeFalhaDeRede(erro), 0);
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new ManutencaoError(dados.error || 'Não foi possível concluir a tarefa. Tente novamente.', resposta.status);
  return dados as ResultadoDatasFaltantes;
};

export interface ResultadoConfiguracoesGerais {
  projeto: string | null;
  modo: ModoDatasFaltantes;
  gruposLidos: number;
  filiaisAlteradas: number;
  grupos: Array<{ grupo: string; filiais: Array<{ filial: string; campos: string[] }> }>;
}

export interface ResultadoProtecaoDeSegredos {
  projeto: string | null;
  modo: 'simular' | 'aplicar';
  lidas: number;
  empresas: Array<{ tenantId: string; nome: string; chaveSpedy: boolean; csc: boolean }>;
}

/** Segredos fiscais (19/10/2026): CSC e chave antiga da Spedy saem do documento comum. */
export const rodarProtecaoDeSegredos = async (modo: 'simular' | 'aplicar'): Promise<ResultadoProtecaoDeSegredos> => {
  if (!API_URL) throw new ManutencaoError('Esta operação precisa do servidor, que não está configurado neste ambiente. Avise o suporte.', 0);
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new ManutencaoError('Sua sessão expirou. Entre novamente para continuar.', 401);
  let resposta: Response;
  try {
    resposta = await fetchComTimeout(`${API_URL}/api/manutencao/proteger-segredos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ modo }),
    }, TEMPO_LIMITE.manutencao);
  } catch (erro) {
    throw new ManutencaoError(mensagemDeFalhaDeRede(erro), 0);
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new ManutencaoError(dados.error || 'Não foi possível concluir a tarefa. Tente novamente.', resposta.status);
  return dados as ResultadoProtecaoDeSegredos;
};

/** Configuracoes Gerais (15/10/2026): iguala os campos do grupo pelo valor da matriz. */
export const rodarUnificacaoConfiguracoesGerais = async (modo: ModoDatasFaltantes): Promise<ResultadoConfiguracoesGerais> => {
  if (!API_URL) throw new ManutencaoError('Esta operação precisa do servidor, que não está configurado neste ambiente. Avise o suporte.', 0);
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new ManutencaoError('Sua sessão expirou. Entre novamente para continuar.', 401);
  let resposta: Response;
  try {
    resposta = await fetchComTimeout(`${API_URL}/api/manutencao/configuracoes-gerais`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ modo }),
    }, TEMPO_LIMITE.manutencao);
  } catch (erro) {
    throw new ManutencaoError(mensagemDeFalhaDeRede(erro), 0);
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new ManutencaoError(dados.error || 'Não foi possível concluir a tarefa. Tente novamente.', resposta.status);
  return dados as ResultadoConfiguracoesGerais;
};

export interface ResultadoZerarEstoqueMigracao {
  projeto: string | null;
  modo: 'simular' | 'aplicar';
  tenantId: string;
  empresa: string;
  cnpj: string;
  produtos: number;
  comSaldo: number;
  somaSaldo: number;
  comCustos: number;
  alterados: number;
  codigosTrocados: number;
  referenciasApagadas: number;
  barrasApagadas: number;
  pedidosDeVenda: number;
}

export interface OpcoesAjusteMigracao {
  /** Saldo 0 e custos apagados (preco de venda fica). */
  zerar: boolean;
  /** Codigos 1, 2, 3... pela ordem alfabetica do nome. */
  renumerar: boolean;
  /** Apaga a Referencia (codigo do sistema antigo) e o codigo de barras feito dela com zeros. */
  apagarCodigoAntigo: boolean;
}

/** Migracao de cliente (17/11/2026): zera saldo e custos de UMA empresa, mantendo o preco de venda. */
export const rodarZerarEstoqueMigracao = async (modo: 'simular' | 'aplicar', tenantId: string, opcoes: OpcoesAjusteMigracao): Promise<ResultadoZerarEstoqueMigracao> => {
  if (!API_URL) throw new ManutencaoError('Esta operação precisa do servidor, que não está configurado neste ambiente. Avise o suporte.', 0);
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new ManutencaoError('Sua sessão expirou. Entre novamente para continuar.', 401);
  let resposta: Response;
  try {
    resposta = await fetchComTimeout(`${API_URL}/api/manutencao/zerar-estoque-migracao`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ modo, tenantId, ...opcoes }),
    }, TEMPO_LIMITE.manutencao);
  } catch (erro) {
    throw new ManutencaoError(mensagemDeFalhaDeRede(erro), 0);
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new ManutencaoError(dados.error || 'Não foi possível concluir a tarefa. Tente novamente.', resposta.status);
  return dados as ResultadoZerarEstoqueMigracao;
};

export interface ResultadoVendaFracionada {
  projeto: string | null;
  modo: 'simular' | 'aplicar';
  tenantId: string;
  empresa: string;
  cnpj: string;
  produtos: number;
  unidadesFracionadas: string[];
  naUnidadeFracionada: number;
  /** Hoje recusam quantidade quebrada na venda. */
  travados: number;
  alterados: number;
  porSigla: Array<{ sigla: string; produtos: number; travados: number; alterados: number }>;
  exemplos: Array<{ codigo: string; nome: string; sigla: string }>;
}

/** Venda fracionada (21/11/2026): produto ativo em unidade fracionada passa a vender fracionado. */
export const rodarVendaFracionada = async (modo: 'simular' | 'aplicar', tenantId: string): Promise<ResultadoVendaFracionada> => {
  if (!API_URL) throw new ManutencaoError('Esta operação precisa do servidor, que não está configurado neste ambiente. Avise o suporte.', 0);
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new ManutencaoError('Sua sessão expirou. Entre novamente para continuar.', 401);
  let resposta: Response;
  try {
    resposta = await fetchComTimeout(`${API_URL}/api/manutencao/venda-fracionada`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ modo, tenantId }),
    }, TEMPO_LIMITE.manutencao);
  } catch (erro) {
    throw new ManutencaoError(mensagemDeFalhaDeRede(erro), 0);
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new ManutencaoError(dados.error || 'Não foi possível concluir a tarefa. Tente novamente.', resposta.status);
  return dados as ResultadoVendaFracionada;
};

export interface ResultadoCreditosDoCliente {
  projeto: string | null;
  modo: 'simular' | 'aplicar';
  tenantId: string;
  empresa: string;
  cnpj: string;
  creditos: number;
  semCodigo: number;
  ligados: number;
  /** Em aberto e com o nome antigo do cliente: hoje nao aparecem na venda. */
  escondidos: number;
  escondidosCentavos: number;
  exemplos: Array<{ numeroPedido: string; nomeNoCredito: string; nomeNoCadastro: string; saldoCentavos: number; escondido: boolean }>;
  semComoLigar: Array<{ numeroPedido: string; nomeNoCredito: string; saldoCentavos: number; motivo: string }>;
}

/** Creditos de devolucao (21/11/2026): grava o codigo do cliente nos creditos antigos, pelo pedido de origem. */
export const rodarCreditosDoCliente = async (modo: 'simular' | 'aplicar', tenantId: string): Promise<ResultadoCreditosDoCliente> => {
  if (!API_URL) throw new ManutencaoError('Esta operação precisa do servidor, que não está configurado neste ambiente. Avise o suporte.', 0);
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new ManutencaoError('Sua sessão expirou. Entre novamente para continuar.', 401);
  let resposta: Response;
  try {
    resposta = await fetchComTimeout(`${API_URL}/api/manutencao/creditos-do-cliente`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ modo, tenantId }),
    }, TEMPO_LIMITE.manutencao);
  } catch (erro) {
    throw new ManutencaoError(mensagemDeFalhaDeRede(erro), 0);
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new ManutencaoError(dados.error || 'Não foi possível concluir a tarefa. Tente novamente.', resposta.status);
  return dados as ResultadoCreditosDoCliente;
};
