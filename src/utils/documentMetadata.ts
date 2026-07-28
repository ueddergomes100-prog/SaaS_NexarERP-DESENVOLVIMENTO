export interface DocumentCreationMetadata<TTimestamp> {
  criadoPor: string;
  criadoEm: TTimestamp;
  alteradoPor: string;
  alteradoEm: TTimestamp;
}

export interface DocumentUpdateMetadata<TTimestamp> {
  alteradoPor: string;
  alteradoEm: TTimestamp;
  ultimaAlteracao?: string;
}

/**
 * Metadados de responsabilidade para um documento novo (Modulo 20).
 * O timestamp e recebido por parametro (nao chama serverTimestamp()
 * aqui) para o helper continuar puro e testavel; o chamador passa
 * serverTimestamp() do firebase/firestore, Timestamp.now() ou uma
 * data literal em migracoes.
 */
export const buildDocumentMetadata = <TTimestamp>(
  userId: string,
  timestamp: TTimestamp,
): DocumentCreationMetadata<TTimestamp> => ({
  criadoPor: userId,
  criadoEm: timestamp,
  alteradoPor: userId,
  alteradoEm: timestamp,
});

/**
 * Metadados a aplicar numa atualizacao (Modulo 20). "summary", quando
 * informado, vira o campo ultimaAlteracao (resumo curto e legivel da
 * mudanca, ex: "Status alterado de Pendente para Finalizada"). Nao deve
 * substituir o log de auditoria (createAuditLog), que registra o
 * historico completo.
 */
export const buildDocumentUpdateMetadata = <TTimestamp>(
  userId: string,
  timestamp: TTimestamp,
  summary?: string,
): DocumentUpdateMetadata<TTimestamp> => ({
  alteradoPor: userId,
  alteradoEm: timestamp,
  ...(summary ? { ultimaAlteracao: summary } : {}),
});
