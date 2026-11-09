import { collection, doc, serverTimestamp, setDoc, type Transaction, type WriteBatch } from 'firebase/firestore';
import { db } from './firebase';
import { reduzirSnapshotDeLog } from '../utils/auditoriaSnapshotDomain';
import {
  montarRegistroHistorico,
  type MudancaDeCampo,
  type OrigemHistorico,
} from '../utils/historicoAlteracoesDomain';
import { contextoDoHistorico, rotaAtual } from './historicoContexto';

/**
 * HISTORICO DE ALTERACOES -- gravacao pela tela.
 *
 * Grava em `empresas/{tenantId}/logs`. As firestore.rules so' aceitam CRIAR,
 * com o uid de quem esta' logado e a hora do servidor (`dataHora`); ninguem
 * altera nem apaga (decisao do dono, 09/11/2026: guardar tudo para sempre).
 *
 * Nome, papel, empresa e filial vem do AuthContext (historicoContexto.ts);
 * a tela e a origem (sistema, app Vendas, app do motorista...) vem do caminho
 * da tela. Regra de montagem em historicoAlteracoesDomain.ts.
 */

/** Uma mudanca pontual de campo (antes -> depois). */
export type AuditLogFieldChange = MudancaDeCampo;

export interface AuditLogInput {
  tenantId: string;
  usuarioId: string;
  usuarioEmail: string;
  modulo: string;
  acao: string;
  descricao: string;
  /** Documento principal: e' por ele que o "Histórico de alterações" do documento acha o registro. */
  registroRelacionadoId?: string;
  /** Outros documentos em que o registro tambem aparece (ex.: a devolucao no pedido). */
  documentosRelacionados?: Array<string | null | undefined>;
  /** "romaneio", "pedido", "os"... */
  documentoTipo?: string;
  /** Como o usuario conhece o documento: "Rota 02", "Pedido 0375". */
  documentoNumero?: string;
  motivo?: string;
  valorAnterior?: string;
  valorNovo?: string;
  status: 'sucesso' | 'erro' | 'negado';
  /** Destaque (cancelamento, exclusao...). Nada e' apagado, critico ou nao. */
  critical?: boolean;
  /** Vendedor que autenticou (codigo+PIN) ou responde pela venda -- separado
   * de usuarioId, que e' sempre o usuario logado na estacao. */
  vendedorId?: string;
  vendedorNome?: string;
  /** O que mudou, campo a campo (use diferencasEntre). */
  alteracoes?: AuditLogFieldChange[];
  /** Copia do documento no momento em que foi excluido/cancelado. */
  snapshotExcluido?: Record<string, unknown> | null;
  /** So' quando a tela nao serve (ex.: acao disparada fora da tela do documento). */
  tela?: string;
  origem?: OrigemHistorico;
}

const montarDados = (logData: AuditLogInput): Record<string, unknown> => {
  const contexto = contextoDoHistorico();
  // Nome/papel/filial so' quando o contexto e' do MESMO usuario do registro.
  const doMesmoUsuario = contexto && contexto.usuarioId === logData.usuarioId ? contexto : null;
  const registro = montarRegistroHistorico({
    modulo: logData.modulo,
    acao: logData.acao,
    descricao: logData.descricao,
    registroId: logData.registroRelacionadoId,
    documentosRelacionados: logData.documentosRelacionados,
    documentoTipo: logData.documentoTipo,
    documentoNumero: logData.documentoNumero,
    motivo: logData.motivo,
    valorAnterior: logData.valorAnterior,
    valorNovo: logData.valorNovo,
    vendedorId: logData.vendedorId,
    vendedorNome: logData.vendedorNome,
    alteracoes: logData.alteracoes,
    // Reduz antes: pedido gigante estourava o teto de 1 MB do Firestore e a
    // gravacao falhava, perdendo justamente o registro da exclusao.
    snapshot: reduzirSnapshotDeLog(logData.snapshotExcluido) as Record<string, unknown> | null,
    status: logData.status,
    critico: logData.critical,
    rota: rotaAtual(),
    tela: logData.tela,
    origem: logData.origem,
  }, {
    usuarioId: logData.usuarioId,
    usuarioEmail: logData.usuarioEmail,
    usuarioNome: doMesmoUsuario?.usuarioNome,
    papel: doMesmoUsuario?.papel,
    nivelAcesso: doMesmoUsuario?.nivelAcesso,
    dono: doMesmoUsuario?.dono,
    empresaId: doMesmoUsuario?.empresaId,
    filialId: logData.tenantId,
    filialNome: doMesmoUsuario && doMesmoUsuario.filialId === logData.tenantId ? doMesmoUsuario.filialNome : null,
  });
  // As rules exigem dataHora == hora do servidor (ninguem grava com data atrasada).
  return { ...registro, dataHora: serverTimestamp() };
};

const novaReferencia = (tenantId: string) => doc(collection(db, 'empresas', tenantId, 'logs'));

/**
 * Registra no Histórico de alterações. Nao espera o servidor responder (sem
 * sinal, o Firestore guarda e envia depois) e nunca derruba a operacao do
 * usuario: falha so' vai para o console.
 */
export const createAuditLog = (logData: AuditLogInput): void => {
  try {
    if (!logData.tenantId) return;
    setDoc(novaReferencia(logData.tenantId), montarDados(logData))
      .catch((err) => console.error('Falha ao gravar o histórico de alterações:', err));
  } catch (err) {
    console.error('Falha ao montar o histórico de alterações:', err);
  }
};

/**
 * Registra DENTRO do lote/transacao da propria acao: ou grava os dois, ou
 * nenhum. Use quando a acao e' gravada pela tela num writeBatch/runTransaction
 * pequeno (as rules do historico custam pouco, mas somam ao lote).
 */
export const registrarHistoricoNoLote = (lote: WriteBatch | Transaction, logData: AuditLogInput): void => {
  if (!logData.tenantId) return;
  (lote as WriteBatch).set(novaReferencia(logData.tenantId), montarDados(logData));
};
