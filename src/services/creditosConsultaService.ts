import { auth } from './firebase';
import { fetchComTimeout, mensagemDeFalhaDeRede } from '../utils/fetchComTimeout';

/**
 * Ver os creditos e de onde vem cada um (26/11/2026). So' leitura, pelo
 * servidor (server/services/creditosConsulta.js), com a permissao
 * "financeiro.creditos_ver".
 */

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

const ler = async <T>(caminho: string, parametros: Record<string, string> = {}): Promise<T> => {
  if (!API_URL) throw new Error('Ver os créditos precisa do servidor da empresa, que não está configurado neste ambiente. Avise o suporte.');
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Sua sessão expirou. Entre novamente para continuar.');
  const query = new URLSearchParams(parametros).toString();
  let resposta: Response;
  try {
    resposta = await fetchComTimeout(`${API_URL}/api/financeiro/creditos/${caminho}${query ? `?${query}` : ''}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (erro) {
    throw new Error(mensagemDeFalhaDeRede(erro), { cause: erro });
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados.error || 'Não foi possível ver os créditos agora. Tente de novo.');
  return dados as T;
};

export interface CreditoDoCliente {
  id: string;
  tipo: 'devolucao' | 'devolucao_sem_pedido' | 'cancelamento' | 'outro';
  rotulo: string;
  documento: string;
  pedidoId: string;
  devolucaoId: string;
  motivo: string;
  status: string;
  statusRotulo: string;
  valorCentavos: number;
  usadoCentavos: number;
  saldoCentavos: number;
  /** ISO */
  criadoEm: string;
  ultimaMovimentacao: string;
  movimentadoEm: string;
  abatimentos: Array<{ descricao: string; centavos: number; quitou: boolean }>;
}

export interface UsoDeCredito {
  id: string;
  descricao: string;
  /** AAAA-MM-DD */
  data: string;
  centavos: number;
  pedidoId: string;
  osId: string;
}

export interface ContaDoFornecedor {
  id: string;
  tipo: 'devolucao_compra' | 'lancamento';
  rotulo: string;
  documento: string;
  notaEntradaId: string;
  status: 'aberto' | 'recebido';
  statusRotulo: string;
  valorCentavos: number;
  saldoCentavos: number;
  criadoEm: string;
  recebidoEm: string;
  formaRecebimento: string;
}

export interface SaldoDoCliente { clienteId: string; clienteNome: string; saldoCentavos: number; quantidade: number }
export interface SaldoDoFornecedor { fornecedorId: string; fornecedorNome: string; saldoCentavos: number; quantidade: number }

export const creditosConsultaService = {
  saldosDosClientes: () => ler<{ clientes: SaldoDoCliente[] }>('clientes'),
  doCliente: (cliente: { id?: string | null; nome?: string }) => ler<{ creditos: CreditoDoCliente[]; usos: UsoDeCredito[]; saldoCentavos: number }>(
    'cliente', { clienteId: cliente.id || '', clienteNome: cliente.nome || '' },
  ),
  saldosDosFornecedores: () => ler<{ fornecedores: SaldoDoFornecedor[] }>('fornecedores'),
  doFornecedor: (fornecedorId: string) => ler<{ contas: ContaDoFornecedor[]; saldoCentavos: number }>('fornecedor', { fornecedorId }),
};
