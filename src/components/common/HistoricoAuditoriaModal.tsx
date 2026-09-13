import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { History, X, Loader2 } from 'lucide-react';

interface AuditoriaFieldChange {
  campo: string;
  valorAnterior: unknown;
  valorNovo: unknown;
}

interface AuditoriaLogEntry {
  id: string;
  dataHora: any;
  usuario: string;
  vendedorNome?: string;
  acao: string;
  descricao: string;
  alteracoes?: AuditoriaFieldChange[];
  snapshotExcluido?: Record<string, unknown> | null;
}

interface HistoricoAuditoriaModalProps {
  open: boolean;
  onClose: () => void;
  tenantId: string | null;
  /** Id do documento (orcamento/pedido/OS) cujo historico se quer ver --
   * casa com `registroRelacionadoId` gravado pelo createAuditLog. */
  registroId: string;
  titulo: string;
}

const formatTimestamp = (ts: any) => {
  if (!ts) return 'N/A';
  const date = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
  return date.toLocaleString('pt-BR');
};

const getAcaoColor = (acao: string) => {
  if (/cancel|exclu|negad|estorno/.test(acao)) return '#ef4444';
  if (/edic|alterac/.test(acao)) return '#3b82f6';
  if (/criac/.test(acao)) return '#10b981';
  return '#6b7280';
};

/** Historico de auditoria de UM registro especifico -- reusado no botao
 * "Auditoria" de Orcamento, Pedido de Venda e OS. Busca so por igualdade
 * (registroRelacionadoId) e ordena no client, pra nao depender de indice
 * composto (registroRelacionadoId + dataHora) que hoje nao existe no
 * Firestore -- ver logService.ts, que nunca fez esse tipo de consulta. */
const HistoricoAuditoriaModal: React.FC<HistoricoAuditoriaModalProps> = ({ open, onClose, tenantId, registroId, titulo }) => {
  const [logs, setLogs] = useState<AuditoriaLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [erro, setErro] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !tenantId || !registroId) return;

    let cancelado = false;
    const fetchLogs = async () => {
      setIsLoading(true);
      setErro('');
      try {
        const q = query(
          collection(db, 'empresas', tenantId, 'logs'),
          where('registroRelacionadoId', '==', registroId),
        );
        const snap = await getDocs(q);
        const dados: AuditoriaLogEntry[] = [];
        snap.forEach((docSnap) => dados.push({ id: docSnap.id, ...docSnap.data() } as AuditoriaLogEntry));
        dados.sort((a, b) => (b.dataHora?.seconds || 0) - (a.dataHora?.seconds || 0));
        if (!cancelado) setLogs(dados);
      } catch (err) {
        console.error('Erro ao buscar histórico de auditoria:', err);
        if (!cancelado) setErro('Não foi possível carregar o histórico de auditoria deste registro.');
      } finally {
        if (!cancelado) setIsLoading(false);
      }
    };
    fetchLogs();
    return () => { cancelado = true; };
  }, [open, tenantId, registroId]);

  if (!open) return null;

  return (
    <div
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }}
      onClick={onClose}
    >
      <div
        style={{ width: '100%', maxWidth: '720px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', boxShadow: '0 12px 48px rgba(0,0,0,0.5)', overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ background: 'linear-gradient(135deg, var(--bg-tertiary), var(--bg-secondary))', padding: '20px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <History size={20} color="var(--accent-purple)" />
            {titulo}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}>
            <X size={22} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
          {isLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '40px', color: 'var(--text-muted)' }}>
              <Loader2 size={20} className="spin-icon" /> Carregando histórico...
            </div>
          ) : erro ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#ef4444' }}>{erro}</div>
          ) : logs.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
              Nenhum registro de auditoria encontrado para este item.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {logs.map((log) => {
                const expandido = expandedId === log.id;
                const temDetalhe = Boolean(log.alteracoes?.length) || Boolean(log.snapshotExcluido);
                return (
                  <div key={log.id} style={{ border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden', backgroundColor: 'var(--bg-primary)' }}>
                    <button
                      type="button"
                      onClick={() => temDetalhe && setExpandedId(expandido ? null : log.id)}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '12px 14px', background: 'none', border: 'none', cursor: temDetalhe ? 'pointer' : 'default', textAlign: 'left', color: 'var(--text-primary)' }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600 }}>{log.descricao}</span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {formatTimestamp(log.dataHora)} — {log.usuario}{log.vendedorNome ? ` (vendedor: ${log.vendedorNome})` : ''}
                        </span>
                      </div>
                      <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'white', backgroundColor: getAcaoColor(log.acao), whiteSpace: 'nowrap' }}>
                        {log.acao.replace(/_/g, ' ')}
                      </span>
                    </button>

                    {expandido && (
                      <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {log.alteracoes && log.alteracoes.length > 0 && (
                          <div>
                            <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>O que mudou</label>
                            <div style={{ border: '1px solid var(--border-color)', borderRadius: '6px', overflow: 'hidden' }}>
                              {log.alteracoes.map((mudanca, index) => (
                                <div key={`${mudanca.campo}-${index}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', padding: '8px 10px', fontSize: '12px', borderTop: index === 0 ? 'none' : '1px solid var(--border-color)' }}>
                                  <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{mudanca.campo}</span>
                                  <span style={{ color: '#ef4444', textDecoration: 'line-through' }}>{String(mudanca.valorAnterior ?? '-')}</span>
                                  <span style={{ color: '#10b981' }}>{String(mudanca.valorNovo ?? '-')}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {log.snapshotExcluido && (
                          <div>
                            <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Registro no momento da ação</label>
                            <pre style={{ padding: '10px', backgroundColor: 'var(--bg-secondary)', borderRadius: '6px', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: '11px', maxHeight: '200px', overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                              {JSON.stringify(log.snapshotExcluido, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default HistoricoAuditoriaModal;
