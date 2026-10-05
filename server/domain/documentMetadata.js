"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDocumentUpdateMetadata = exports.buildDocumentMetadata = void 0;
/**
 * Metadados de responsabilidade para um documento novo (Modulo 20).
 * O timestamp e recebido por parametro (nao chama serverTimestamp()
 * aqui) para o helper continuar puro e testavel; o chamador passa
 * serverTimestamp() do firebase/firestore, Timestamp.now() ou uma
 * data literal em migracoes.
 */
const buildDocumentMetadata = (userId, timestamp) => ({
    criadoPor: userId,
    criadoEm: timestamp,
    alteradoPor: userId,
    alteradoEm: timestamp,
});
exports.buildDocumentMetadata = buildDocumentMetadata;
/**
 * Metadados a aplicar numa atualizacao (Modulo 20). "summary", quando
 * informado, vira o campo ultimaAlteracao (resumo curto e legivel da
 * mudanca, ex: "Status alterado de Pendente para Finalizada"). Nao deve
 * substituir o log de auditoria (createAuditLog), que registra o
 * historico completo.
 */
const buildDocumentUpdateMetadata = (userId, timestamp, summary) => ({
    alteradoPor: userId,
    alteradoEm: timestamp,
    ...(summary ? { ultimaAlteracao: summary } : {}),
});
exports.buildDocumentUpdateMetadata = buildDocumentUpdateMetadata;
