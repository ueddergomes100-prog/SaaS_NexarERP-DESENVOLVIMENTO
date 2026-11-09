import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, History, Loader2, X } from 'lucide-react';
import { lerHistoricoDoDocumento } from '../../services/historicoService';
import { useAuth } from '../../contexts/AuthContext';
import {
  comNomeDaFilial,
  corDaAcao,
  dataHoraBrasil,
  nomeDeQuemFez,
  rotuloDaAcao,
  rotuloDaOrigem,
  telaDoRegistro,
  valorParaHistorico,
  type RegistroLido,
} from '../../utils/historicoAlteracoesDomain';
import { montarDocumentoHistorico } from '../../utils/relatorioHistoricoDomain';
import { nomeArquivoRelatorio } from '../../utils/relatorioPdfDomain';
import RelatorioPreview from '../Reports/RelatorioPreview';

interface HistoricoAlteracoesModalProps {
  open: boolean;
  onClose: () => void;
  tenantId: string | null;
  /** Id do documento (e, se houver, ids ligados a ele) cujo historico se quer ver. */
  registroId: string | string[];
  /** "Romaneio Rota 02", "Pedido 0375"... */
  titulo: string;
}

const mostrarValor = (valor: unknown): string => {
  const v = valorParaHistorico(valor);
  if (v === null || v === '') return '(vazio)';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  return String(v);
};

/**
 * "Histórico de alterações" de UM documento (romaneio, pedido, OS,
 * orcamento...): quem fez, quando, de onde, o que mudou e o motivo. Abre em
 * "Mais opções"; so' dono, administrador e quem tem a permissao veem.
 * Daqui sai o relatorio em PDF -- a prova que se mostra ao cliente.
 */
const HistoricoAlteracoesModal: React.FC<HistoricoAlteracoesModalProps> = ({ open, onClose, tenantId, registroId, titulo }) => {
  const { grupo } = useAuth();
  const [lidos, setRegistros] = useState<RegistroLido[]>([]);
  const registros = useMemo(() => comNomeDaFilial(lidos, grupo?.filiais), [lidos, grupo]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [aberto, setAberto] = useState<string | null>(null);
  const [relatorio, setRelatorio] = useState(false);
  const ids = useMemo(() => (Array.isArray(registroId) ? registroId : [registroId]).filter(Boolean), [registroId]);
  const chaveIds = ids.join('|');

  useEffect(() => {
    if (!open || !tenantId || ids.length === 0) return undefined;
    let cancelado = false;
    setCarregando(true);
    setErro('');
    lerHistoricoDoDocumento(tenantId, ids)
      .then((lidos) => { if (!cancelado) setRegistros(lidos); })
      .catch((err) => {
        console.error('Erro ao ler o histórico de alterações do documento:', err);
        if (!cancelado) setErro('Não foi possível carregar o histórico deste documento. Confira a internet e tente de novo; se continuar, peça ao dono ou administrador da empresa para conferir sua permissão "Histórico de alterações".');
      })
      .finally(() => { if (!cancelado) setCarregando(false); });
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tenantId, chaveIds]);

  useEffect(() => {
    if (!open) { setRelatorio(false); setAberto(null); }
  }, [open]);

  if (!open) return null;

  if (relatorio) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 10000, backgroundColor: 'var(--bg-primary)', overflowY: 'auto', padding: '16px' }}>
        <RelatorioPreview
          relatorioId="historico-alteracoes-documento"
          documento={montarDocumentoHistorico(registros, { titulo: `Histórico de alterações — ${titulo}` })}
          nomeArquivo={nomeArquivoRelatorio(`Histórico de alterações ${titulo}`)}
          onFechar={() => setRelatorio(false)}
          rotuloFechar="Voltar ao histórico"
        />
      </div>
    );
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0, 0, 0, 0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '16px' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={`Histórico de alterações — ${titulo}`}
        style={{ width: '100%', maxWidth: '760px', maxHeight: '88vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', boxShadow: '0 12px 48px rgba(0,0,0,0.35)', overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <History size={19} color="var(--accent-purple)" />
            Histórico de alterações — {titulo}
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              className="btn-secondary"
              disabled={carregando || registros.length === 0}
              onClick={() => setRelatorio(true)}
              title="Abre o histórico deste documento em PDF, para imprimir ou salvar"
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <FileText size={16} /> Relatório em PDF
            </button>
            <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}>
              <X size={22} />
            </button>
          </div>
        </div>

        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
          {carregando ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '40px', color: 'var(--text-muted)' }}>
              <Loader2 size={20} className="spin-icon" /> Carregando o histórico...
            </div>
          ) : erro ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#ef4444' }}>{erro}</div>
          ) : registros.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
              Nenhuma alteração registrada para este documento.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {registros.map((r) => {
                const expandido = aberto === r.id;
                const temDetalhe = Boolean(r.alteracoes?.length) || Boolean(r.snapshotExcluido);
                const onde = [telaDoRegistro(r), rotuloDaOrigem(r.origem), r.filialNome || ''].filter(Boolean).join(' · ');
                return (
                  <div key={r.id} style={{ border: '1px solid var(--border-color)', borderRadius: '8px', backgroundColor: 'var(--bg-primary)', overflow: 'hidden' }}>
                    <button
                      type="button"
                      onClick={() => temDetalhe && setAberto(expandido ? null : r.id)}
                      style={{ width: '100%', display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px 14px', background: 'none', border: 'none', cursor: temDetalhe ? 'pointer' : 'default', textAlign: 'left', color: 'var(--text-primary)' }}
                    >
                      <span style={{ flexShrink: 0, marginTop: '2px', padding: '3px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, color: 'white', backgroundColor: corDaAcao(r.acao), whiteSpace: 'nowrap' }}>
                        {rotuloDaAcao(r.acao)}
                      </span>
                      <span style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: '13px', fontWeight: 600 }}>{r.descricao}</span>
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                          <strong>{dataHoraBrasil(r.dataHora)}</strong> · {nomeDeQuemFez(r)}{r.usuarioPapel ? ` (${r.usuarioPapel})` : ''}
                          {r.vendedorNome ? ` · vendedor: ${r.vendedorNome}` : ''}
                        </span>
                        {onde && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{onde}</span>}
                        {r.motivo && <span style={{ fontSize: '12px', color: 'var(--text-primary)' }}>Motivo: {r.motivo}</span>}
                      </span>
                      {temDetalhe && (expandido ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
                    </button>

                    {expandido && (
                      <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {r.alteracoes && r.alteracoes.length > 0 && (
                          <div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase' }}>O que mudou</div>
                            <div style={{ border: '1px solid var(--border-color)', borderRadius: '6px', overflow: 'hidden' }}>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', padding: '6px 10px', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700 }}>
                                <span>Campo</span><span>Antes</span><span>Depois</span>
                              </div>
                              {r.alteracoes.map((m, i) => (
                                <div key={`${m.campo}-${i}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', padding: '7px 10px', fontSize: '12px', borderTop: '1px solid var(--border-color)', wordBreak: 'break-word' }}>
                                  <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{m.campo}</span>
                                  <span style={{ color: '#ef4444' }}>{mostrarValor(m.valorAnterior)}</span>
                                  <span style={{ color: '#10b981' }}>{mostrarValor(m.valorNovo)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {r.snapshotExcluido && (
                          <div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase' }}>Como o documento estava antes</div>
                            <pre style={{ margin: 0, padding: '10px', backgroundColor: 'var(--bg-secondary)', borderRadius: '6px', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: '11px', maxHeight: '220px', overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                              {JSON.stringify(r.snapshotExcluido, null, 2)}
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

export default HistoricoAlteracoesModal;
