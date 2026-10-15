import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import { spedyService, type SpedyInvoice } from './spedyService';
import { buildDocumentUpdateMetadata } from '../utils/documentMetadata';
import {
  descricaoDaNota,
  ehErroDePrazo,
  ORIENTACAO_FORA_DO_PRAZO,
  tipoSpedyDaNota,
  type NotaDaVenda,
} from '../utils/cancelamentoNotaVendaDomain';

/**
 * Cancela UMA nota da venda pela tela do pedido e so' responde "ok" depois que
 * a Spedy CONFIRMA a nota como cancelada (15/10/2026 -- ver
 * cancelamentoNotaVendaDomain.ts). A tela de Notas Fiscais marca "cancelada"
 * na hora e confia no retorno da Spedy depois; aqui nao da: a venda so' pode
 * ser cancelada com a nota cancelada de verdade.
 *
 * Antes de pedir, consulta a situacao na Spedy: nota que ja' esta' cancelada
 * la' (por exemplo, numa tentativa anterior que demorou) nao e' pedida de novo.
 */

export type ResultadoCancelamentoNota =
  | { ok: true }
  | { ok: false; titulo: string; mensagem: string };

const CHAVE_PELO_SERVIDOR = '__backend_proxy__';
const TENTATIVAS_DE_CONFIRMACAO = 10;
const INTERVALO_DE_CONFIRMACAO_MS = 3000;

const esperar = (ms: number) => new Promise((resolver) => { window.setTimeout(resolver, ms); });

export const cancelarNotaDaVenda = async (a: {
  nota: NotaDaVenda;
  justificativa: string;
  usuario: { uid: string; email?: string | null };
  tenantId: string;
  numeroPedido: string;
}): Promise<ResultadoCancelamentoNota> => {
  const descricao = descricaoDaNota(a.nota);
  const spedyId = String(a.nota.spedyId || '');
  if (!spedyId) {
    return { ok: false, titulo: 'Não foi possível cancelar a nota', mensagem: `A ${descricao} não tem o código da Spedy gravado. Cancele a nota pela tela Notas Fiscais e depois cancele a venda aqui.` };
  }

  const runtime = await spedyService.getRuntimeConfig();
  if (!runtime.spedyEnabled || !runtime.spedyApiKeyConfigured) {
    return { ok: false, titulo: 'Módulo fiscal desligado', mensagem: 'A integração com a Spedy não está configurada nesta empresa, então a nota não pode ser cancelada daqui. Fale com o suporte.' };
  }
  const ambiente = runtime.spedyEnvironment;
  const tipo = tipoSpedyDaNota(a.nota.tipo);
  const consultar = (): Promise<SpedyInvoice> => (
    tipo === 'consumer'
      ? spedyService.getConsumerInvoice(CHAVE_PELO_SERVIDOR, ambiente, spedyId)
      : spedyService.getProductInvoice(CHAVE_PELO_SERVIDOR, ambiente, spedyId)
  );

  let atual: SpedyInvoice;
  try {
    atual = await consultar();
  } catch (erro) {
    return { ok: false, titulo: 'Não foi possível consultar a nota', mensagem: `${erro instanceof Error ? erro.message : 'A Spedy não respondeu.'} A venda NÃO foi cancelada. Tente de novo em instantes.` };
  }

  if (atual.status !== 'canceled') {
    if (atual.status !== 'authorized') {
      return { ok: false, titulo: 'A nota ainda está sendo processada', mensagem: `A ${descricao} está em processamento na SEFAZ (situação "${atual.status}"). A venda NÃO foi cancelada. Espere alguns minutos e tente de novo.` };
    }
    try {
      await spedyService.cancelInvoice(CHAVE_PELO_SERVIDOR, ambiente, tipo, spedyId, a.justificativa);
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : 'Erro ao pedir o cancelamento da nota.';
      return ehErroDePrazo(mensagem)
        ? { ok: false, titulo: 'Passou do prazo de cancelamento da nota', mensagem: `${mensagem}\n\n${ORIENTACAO_FORA_DO_PRAZO}` }
        : { ok: false, titulo: 'A SEFAZ não cancelou a nota', mensagem: `${mensagem}\n\nA venda NÃO foi cancelada.` };
    }
    for (let tentativa = 0; tentativa < TENTATIVAS_DE_CONFIRMACAO && atual.status !== 'canceled'; tentativa += 1) {
      await esperar(INTERVALO_DE_CONFIRMACAO_MS);
      try {
        atual = await consultar();
      } catch {
        // Rede oscilou: tenta de novo na proxima volta.
      }
    }
  }

  const refNota = doc(db, 'notas_fiscais', a.nota.id);
  if (atual.status !== 'canceled') {
    await updateDoc(refNota, {
      processingMessage: 'Cancelamento pedido pela tela do pedido; aguardando a SEFAZ confirmar.',
      ...buildDocumentUpdateMetadata(a.usuario.uid, serverTimestamp(), `Cancelamento pedido pela venda #${a.numeroPedido}: ${a.justificativa}`),
    }).catch(() => undefined);
    return {
      ok: false,
      titulo: 'A SEFAZ ainda não confirmou o cancelamento da nota',
      mensagem: `O cancelamento da ${descricao} foi pedido, mas a SEFAZ ainda não confirmou. A venda NÃO foi cancelada. Espere alguns minutos e clique em "Estornar/Cancelar venda" de novo — a nota não será pedida duas vezes.`,
    };
  }

  await updateDoc(refNota, {
    status: 'canceled',
    processingMessage: `Cancelada pela tela do pedido #${a.numeroPedido}.`,
    ...buildDocumentUpdateMetadata(a.usuario.uid, serverTimestamp(), `Cancelamento pela venda #${a.numeroPedido}: ${a.justificativa}`),
  });
  try {
    const { createAuditLog } = await import('./logService');
    createAuditLog({
      tenantId: a.tenantId,
      usuarioId: a.usuario.uid,
      usuarioEmail: a.usuario.email || a.usuario.uid,
      modulo: 'fiscal',
      acao: 'cancelamento',
      descricao: `${descricao} cancelada pela tela da venda #${a.numeroPedido}. Motivo: ${a.justificativa}`,
      registroRelacionadoId: a.nota.id,
      status: 'sucesso',
      critical: true,
    });
  } catch {
    // auditoria nunca derruba a operacao que ja' aconteceu
  }
  return { ok: true };
};
