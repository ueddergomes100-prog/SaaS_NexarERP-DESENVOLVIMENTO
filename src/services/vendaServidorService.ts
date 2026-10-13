/*
 * FECHAMENTO DA VENDA PELO SERVIDOR (item 8 da auditoria, fatia 3 -- 13/10/2026).
 *
 * Com a chave "Venda pelo servidor" ligada para a empresa (SuperAdmin), o
 * "Finalizar" do Pedido de Venda manda para cá o que a pessoa escolheu e o
 * servidor (server/services/vendaFechamento.js) grava pedido, estoque, lotes,
 * comissão, títulos e saldo do banco numa transação só. Repetir o envio da
 * mesma venda direta não duplica: o id da venda é gerado na tela e vai junto.
 */
import { auth } from './firebase';
import { fetchComTimeout, mensagemDeFalhaDeRede } from '../utils/fetchComTimeout';

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

/** Erro já em português, pronto para a tela. `status` 0 = sem resposta (rede). */
export class VendaServidorError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'VendaServidorError';
    this.status = status;
  }
}

export interface ResultadoDoFechamento {
  ok: true;
  jaEnviado: boolean;
  pedidoId: string;
  numeroPedido: string;
  vendedorId: string;
  vendedorNome: string;
  totalCentavos: number;
  formaPagamento: string;
  condicaoPagamento: 'avista' | 'aprazo';
}

export const finalizarVendaNoServidor = async (corpo: Record<string, unknown>): Promise<ResultadoDoFechamento> => {
  if (!API_URL) {
    throw new VendaServidorError('A venda desta empresa é fechada pelo servidor, que não está configurado neste ambiente. Avise o suporte.', 0);
  }
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new VendaServidorError('Sua sessão expirou. Entre novamente para continuar.', 401);

  let resposta: Response;
  try {
    resposta = await fetchComTimeout(`${API_URL}/api/vendas/finalizar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
  } catch (erro) {
    // Sem resposta não dá para saber se gravou. Repetir é seguro: o servidor
    // reconhece a mesma venda e não grava duas vezes.
    throw new VendaServidorError(`${mensagemDeFalhaDeRede(erro)} Toque em Finalizar de novo: se a venda já tiver sido gravada, o sistema não grava duas vezes.`, 0);
  }

  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new VendaServidorError(dados.error || 'Não foi possível finalizar a venda. Nada foi gravado. Tente novamente.', resposta.status);
  }
  return dados as ResultadoDoFechamento;
};
