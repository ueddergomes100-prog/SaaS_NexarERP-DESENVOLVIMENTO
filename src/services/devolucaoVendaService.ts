import { collection, doc, getDocs, query, runTransaction, serverTimestamp, where } from 'firebase/firestore';
import { db } from './firebase';
import { createAuditLog } from './logService';
import { buildDocumentUpdateMetadata } from '../utils/documentMetadata';
import {
  STATUS_DEVOLUCAO,
  erroParaDecidirDevolucao,
  lerMotivoDaRecusa,
  quantidadesEmAguardo,
} from '../utils/devolucaoVendaDomain';

/**
 * DEVOLUCAO DE VENDA PELO NAVEGADOR: so' a recusa da devolucao pedida pelo
 * app e a leitura do que esta' aguardando confirmacao (24-25/11/2026).
 */

interface Quem {
  tenantId: string;
  usuarioId: string;
  usuarioNome: string;
}

/*
 * A devolucao feita no sistema e o "Confirmar" da que veio do app gravam no
 * SERVIDOR desde 25/11/2026 (services/devolucaoEscritorioService.ts ->
 * server/services/devolucaoVendaEscritorio.js), com a janela do destino do
 * valor (credito, dinheiro, Pix ou abater das parcelas). Aqui ficam so' a
 * recusa (nada mexe em estoque nem dinheiro) e a leitura do que esta' em aguardo.
 */

const reais = (valor: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0);

/** Recusa a devolucao pedida pelo app: nada mexe; o vendedor ve o motivo no app. */
export const recusarDevolucaoVenda = async (
  quem: Quem & { usuarioEmail: string },
  devolucaoId: string,
  motivoBruto: string,
): Promise<void> => {
  const lido = lerMotivoDaRecusa(motivoBruto);
  if (!lido.ok) throw new Error(lido.erro);
  const ref = doc(db, 'devolucoes_venda', devolucaoId);
  let dados: Record<string, unknown> = {};
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    const atual = snap.exists() && snap.data().tenantId === quem.tenantId ? snap.data() : null;
    const erro = erroParaDecidirDevolucao(atual, 'recusar');
    if (erro || !atual) throw new Error(erro || 'Esta devolução não existe mais. Atualize a lista.');
    dados = atual;
    transaction.update(ref, {
      status: STATUS_DEVOLUCAO.recusada,
      motivoRecusa: lido.motivo,
      recusadaPorId: quem.usuarioId,
      recusadaPorNome: quem.usuarioNome,
      recusadaEm: serverTimestamp(),
      ...buildDocumentUpdateMetadata(quem.usuarioId, serverTimestamp(), 'Devolução recusada'),
    });
  });
  const numero = String(dados.numeroPedidoOriginal || '');
  createAuditLog({
    tenantId: quem.tenantId,
    usuarioId: quem.usuarioId,
    usuarioEmail: quem.usuarioEmail,
    modulo: 'vendas',
    acao: 'devolucao_recusada',
    descricao: `Devolução pedida pelo aplicativo RECUSADA para o pedido #${numero} (${reais(Number(dados.valorTotalDevolvido || 0))}). Estoque e dinheiro não foram mexidos.`,
    registroRelacionadoId: devolucaoId,
    documentosRelacionados: [String(dados.pedidoVendaId || '')],
    documentoTipo: 'devolucao',
    documentoNumero: `Devolução do Pedido ${numero}`,
    motivo: lido.motivo,
    ...(dados.vendedorId ? { vendedorId: String(dados.vendedorId) } : {}),
    ...(dados.vendedorNome ? { vendedorNome: String(dados.vendedorNome) } : {}),
    alteracoes: [{ campo: 'Situação', valorAnterior: 'Aguardando confirmação', valorNovo: 'Recusada' }],
    status: 'sucesso',
  });
};

/** Quanto de cada linha do pedido esta' em devolucao aguardando confirmacao (por indice). */
export const lerQuantidadesEmAguardo = async (tenantId: string, pedidoId: string): Promise<Map<number, number>> => {
  const snap = await getDocs(query(collection(db, 'devolucoes_venda'), where('tenantId', '==', tenantId), where('pedidoVendaId', '==', pedidoId)));
  return quantidadesEmAguardo(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
};
