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
