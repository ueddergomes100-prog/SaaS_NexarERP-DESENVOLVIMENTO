const { admin, db } = require('../config/firebase');

/**
 * Registro de auditoria feito pelo servidor: `empresas/{tenantId}/logs`, o mesmo
 * lugar e formato do createAuditLog da tela (src/services/logService.ts).
 * Auditoria nunca derruba a operacao que ja' aconteceu: falha aqui so' vai pro
 * console.
 */
const registrarLog = (user, { modulo, acao, descricao, registroId, alteracoes }) => {
  db.collection('empresas').doc(user.tenantId).collection('logs').add({
    usuarioId: user.uid,
    usuario: user.email || user.uid,
    modulo,
    acao,
    descricao,
    registroRelacionadoId: registroId,
    valorAnterior: null,
    valorNovo: null,
    vendedorId: null,
    vendedorNome: null,
    alteracoes: alteracoes || null,
    snapshotExcluido: null,
    status: 'sucesso',
    critical: acao === 'exclusao',
    dataHora: admin.firestore.FieldValue.serverTimestamp(),
  }).catch((erro) => console.error(`[Auditoria] falha ao gravar log de ${modulo}:`, erro.message));
};

module.exports = { registrarLog };
