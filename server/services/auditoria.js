const { admin, db } = require('../config/firebase');
const { montarRegistroHistorico } = require('../domain/historicoAlteracoesDomain');
const { reduzirSnapshotDeLog } = require('../domain/auditoriaSnapshotDomain');

/**
 * HISTORICO DE ALTERACOES feito pelo servidor: `empresas/{tenantId}/logs`, o
 * mesmo lugar e formato do createAuditLog da tela (src/services/logService.ts),
 * montado pela MESMA regra (historicoAlteracoesDomain).
 *
 * `user` e' o req.user do middleware (com nome, papel, filial e a tela que
 * chamou, em `telaCliente`). Ninguem altera nem apaga esses registros: as
 * rules so' aceitam criacao, e o servidor so' cria.
 *
 * Campos aceitos em `dados`: modulo, acao, descricao, registroId,
 * documentosRelacionados, documentoTipo, documentoNumero, motivo, alteracoes,
 * critico, vendedorId, vendedorNome, snapshotExcluido, tela, origem.
 */
const montar = (user, dados) => ({
  ...montarRegistroHistorico({
    modulo: dados.modulo,
    acao: dados.acao,
    descricao: dados.descricao,
    registroId: dados.registroId,
    documentosRelacionados: dados.documentosRelacionados,
    documentoTipo: dados.documentoTipo,
    documentoNumero: dados.documentoNumero,
    motivo: dados.motivo,
    alteracoes: dados.alteracoes,
    vendedorId: dados.vendedorId,
    vendedorNome: dados.vendedorNome,
    snapshot: dados.snapshotExcluido ? reduzirSnapshotDeLog(dados.snapshotExcluido) : null,
    critico: dados.critico,
    rota: user.telaCliente || '',
    tela: dados.tela,
    origem: dados.origem,
  }, {
    usuarioId: user.uid,
    usuarioEmail: user.email,
    usuarioNome: user.nome,
    papel: user.role,
    nivelAcesso: user.nivelAcesso,
    dono: user.dono,
    empresaId: user.homeTenantId,
    filialId: user.tenantId,
    filialNome: user.filialNome,
  }),
  dataHora: admin.firestore.FieldValue.serverTimestamp(),
});

const referencia = (tenantId) => db.collection('empresas').doc(tenantId).collection('logs').doc();

/**
 * Grava depois da acao. Nunca derruba a operacao que ja' aconteceu: falha
 * aqui so' vai pro console. Devolve a promessa para quem quiser esperar.
 */
const registrarLog = (user, dados) => {
  if (!user || !user.tenantId) return Promise.resolve();
  try {
    return referencia(user.tenantId).set(montar(user, dados))
      .catch((erro) => console.error(`[Historico] falha ao gravar registro de ${dados.modulo}:`, erro.message));
  } catch (erro) {
    console.error(`[Historico] falha ao montar registro de ${dados && dados.modulo}:`, erro.message);
    return Promise.resolve();
  }
};

/**
 * Grava DENTRO da transacao da propria acao: ou grava a acao e o registro, ou
 * nenhum dos dois. Use nas acoes que derrubam ou devolvem coisas (cancelar,
 * reabrir, estornar). Escrita, entao chame depois de todas as leituras.
 */
const registrarLogNaTransacao = (tx, user, dados) => {
  if (!user || !user.tenantId) return;
  tx.set(referencia(user.tenantId), montar(user, dados));
};

module.exports = { registrarLog, registrarLogNaTransacao };
