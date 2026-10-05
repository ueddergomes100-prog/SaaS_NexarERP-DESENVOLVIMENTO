import { auth } from './firebase';
import { fetchComTimeout, mensagemDeFalhaDeRede } from '../utils/fetchComTimeout';

/**
 * Cliente HTTP do CONDICIONAL. Toda escrita em `condicionais` e toda reserva
 * de estoque dele passam pelo servidor (server/routes/condicionais.routes.js);
 * a tela so' le a colecao e manda o que a pessoa escolheu (cliente, produto,
 * quantidade, prazo). Nome, preco e unidade vem do cadastro, no servidor.
 */

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

export class CondicionalError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'CondicionalError';
    this.status = status;
  }
}

const chamar = async <T>(caminho: string, corpo: Record<string, unknown>): Promise<T> => {
  if (!API_URL) {
    throw new CondicionalError('Esta operação precisa do servidor da empresa, que não está configurado neste ambiente. Avise o suporte.', 0);
  }
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new CondicionalError('Sua sessão expirou. Entre novamente para continuar.', 401);

  let resposta: Response;
  try {
    resposta = await fetchComTimeout(`${API_URL}/api/condicionais${caminho}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
  } catch (erro) {
    throw new CondicionalError(`${mensagemDeFalhaDeRede(erro)} Confira na lista se a operação foi registrada antes de repetir.`, 0);
  }

  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new CondicionalError(dados.error || 'Não foi possível concluir a operação. Tente novamente.', resposta.status);
  }
  return dados as T;
};

export interface ItemPedidoCondicional {
  id: string;
  quantidade: number;
}

export interface NovoCondicional {
  clienteId: string;
  itens: ItemPedidoCondicional[];
  /** yyyy-mm-dd: até quando o cliente devolve ou decide. */
  prazoDevolucao: string;
  observacao?: string;
  /** Id fixo do documento: reenviar depois de uma queda de conexão não duplica. */
  idDocumento: string;
  tenantId: string;
}

export const condicionalService = {
  /** Saída: cria o condicional e reserva o estoque. */
  criar: (pedido: NovoCondicional) => chamar<{ ok: boolean; id: string; numeroCondicional: string; jaEnviado: boolean; semUnidade: string[] }>('', { ...pedido }),
  /** Registra o que o cliente devolveu (parcial ou total). */
  devolver: (id: string, itens: ItemPedidoCondicional[], tenantId: string) => (
    chamar<{ ok: boolean; tudoDevolvido: boolean }>(`/${id}/devolucao`, { itens, tenantId })
  ),
  /** Fecha: aplica a devolução final (opcional) e o que ficou vira pré-venda. */
  fechar: (id: string, itensDevolvidos: ItemPedidoCondicional[], tenantId: string) => (
    chamar<{ ok: boolean; pedidoId: string | null; numeroPedido: string | null; pecasVendidas: number }>(`/${id}/fechar`, { itens: itensDevolvidos, tenantId })
  ),
  /** Cancela: devolve a reserva de tudo que ainda estava com o cliente. */
  cancelar: (id: string, motivo: string, tenantId: string) => chamar<{ ok: boolean }>(`/${id}/cancelar`, { motivo, tenantId }),
};

/** Id novo para o documento (o servidor aceita [A-Za-z0-9_-]). */
export const novoIdDeCondicional = (): string => (
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
);
