import { collection, addDoc, serverTimestamp, query, where, getDocs, writeBatch, limit, Timestamp } from 'firebase/firestore';
import { db } from './firebase';

/** Uma mudança pontual de campo, registrada para permitir diff estruturado
 * (em vez de so uma frase solta em `descricao`). */
export interface AuditLogFieldChange {
  campo: string;
  valorAnterior: unknown;
  valorNovo: unknown;
}

export interface AuditLogInput {
  tenantId: string;
  usuarioId: string;
  usuarioEmail: string;
  modulo: string;
  acao: string;
  descricao: string;
  registroRelacionadoId?: string;
  valorAnterior?: string;
  valorNovo?: string;
  status: 'sucesso' | 'erro' | 'negado';
  critical?: boolean; // if true, log will be kept permanently
  /** Vendedor que autenticou (codigo+PIN) ou responde pela venda/pedido em
   * questao -- separado de usuarioId, que e' sempre o usuario logado na
   * estacao (ex: "balcao01"). Sem isso, o log nao diz quem realmente vendeu. */
  vendedorId?: string;
  vendedorNome?: string;
  /** Diff estruturado de uma edicao (campo a campo), pra nao depender so do
   * texto livre de `descricao`. */
  alteracoes?: AuditLogFieldChange[];
  /** Copia completa do documento no momento em que ele foi excluido
   * fisicamente (o sistema nao faz soft-delete de venda) -- sem isso, uma
   * exclusao apaga o unico registro de como o pedido era. */
  snapshotExcluido?: Record<string, unknown> | null;
}

/** Remove `undefined`/funcoes/referencias circulares antes de gravar no
 * Firestore, que recusa `undefined` e derruba o save inteiro. */
const sanitizeForLog = <T,>(value: T | undefined | null): T | null => {
  if (value === undefined || value === null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    console.error('Falha ao serializar dado de log de auditoria:', err);
    return null;
  }
};

/**
 * Registra um log de auditoria de forma assíncrona e segura (não-bloqueante).
 */
export const createAuditLog = (logData: AuditLogInput) => {
  // Executa fora da thread principal para não impactar a performance do usuário
  setTimeout(async () => {
    try {
      if (!logData.tenantId) return;

      const logsCollection = collection(db, 'empresas', logData.tenantId, 'logs');
      await addDoc(logsCollection, {
        usuarioId: logData.usuarioId || 'desconhecido',
        usuario: logData.usuarioEmail || 'desconhecido',
        modulo: logData.modulo,
        acao: logData.acao,
        descricao: logData.descricao,
        registroRelacionadoId: logData.registroRelacionadoId || null,
        valorAnterior: logData.valorAnterior || null,
        valorNovo: logData.valorNovo || null,
        vendedorId: logData.vendedorId || null,
        vendedorNome: logData.vendedorNome || null,
        alteracoes: sanitizeForLog(logData.alteracoes),
        snapshotExcluido: sanitizeForLog(logData.snapshotExcluido),
        status: logData.status,
        critical: !!logData.critical,
        dataHora: serverTimestamp(),
      });
    } catch (err) {
      console.error('Falha silenciosa ao registrar log de auditoria:', err);
    }
  }, 0);
};

/**
 * Limpa logs comuns (não críticos) com mais de 6 meses de idade de forma assíncrona.
 * Limita a exclusão a 100 documentos por execução para evitar consumo excessivo de gravação.
 */
export const runLogsCleanup = async (tenantId: string) => {
  if (!tenantId) return;

  try {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const logsCollection = collection(db, 'empresas', tenantId, 'logs');
    const q = query(
      logsCollection,
      where('critical', '==', false),
      where('dataHora', '<', Timestamp.fromDate(sixMonthsAgo)),
      limit(100)
    );

    const snapshot = await getDocs(q);
    if (snapshot.empty) return;

    const batch = writeBatch(db);
    snapshot.forEach(docSnap => {
      batch.delete(docSnap.ref);
    });

    await batch.commit();
    console.log(`Limpeza de logs executada para ${tenantId}: ${snapshot.size} registros expirados removidos.`);
  } catch (err) {
    console.error('Erro ao executar limpeza automática de logs:', err);
  }
};
