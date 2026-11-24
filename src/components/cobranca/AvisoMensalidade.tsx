import React, { useEffect, useState } from 'react';
import { AlertTriangle, Receipt, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { deveAbrirJanelaDeCobranca, etapaComAviso, textoDoAviso, type TomDoAviso } from '../../utils/mensalidadeDomain';
import { useSituacaoDaCobranca } from './useSituacaoDaCobranca';
import PagamentoDaMensalidade from './PagamentoDaMensalidade';

/**
 * AVISO DE MENSALIDADE (24/11/2026): faixa no topo do sistema e janela uma vez
 * por dia (como a de aniversario), so' para dono e administrador, desde o
 * lembrete antes do vencimento ate' a vespera do bloqueio. A faixa nao fecha:
 * some quando o suporte registra o pagamento.
 */

const COR: Record<TomDoAviso, { fundo: string; texto: string }> = {
  info: { fundo: '#2563eb', texto: '#fff' },
  alerta: { fundo: '#f59e0b', texto: '#000' },
  perigo: { fundo: '#dc2626', texto: '#fff' },
};

const chaveDoDia = (uid: string, tenant: string) => `hennder_mensalidade_avisada_${uid}_${tenant}`;

const AvisoMensalidade: React.FC = () => {
  const { currentUser, homeTenantId } = useAuth();
  const { resumo, situacao, hoje, quemPaga } = useSituacaoDaCobranca();
  const [janelaAberta, setJanelaAberta] = useState(false);
  const mostra = Boolean(resumo && quemPaga && etapaComAviso(situacao.etapa));

  // Janela 1x por dia: marca antes de abrir (outra aba nao abre de novo).
  useEffect(() => {
    if (!mostra || !currentUser) return;
    const chave = chaveDoDia(currentUser.uid, homeTenantId || '');
    let ultimo = '';
    try { ultimo = localStorage.getItem(chave) || ''; } catch { /* navegador sem armazenamento: abre */ }
    if (!deveAbrirJanelaDeCobranca(ultimo, hoje, situacao.etapa)) return;
    try { localStorage.setItem(chave, hoje); } catch { /* idem */ }
    setJanelaAberta(true);
  }, [mostra, currentUser, homeTenantId, hoje, situacao.etapa]);

  if (!mostra || !resumo) return null;
  const aviso = textoDoAviso(resumo, situacao);
  const cor = COR[aviso.tom];

  return (
    <>
      <div
        role="status"
        style={{ backgroundColor: cor.fundo, color: cor.texto, padding: '10px 24px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', fontWeight: 600, fontSize: '14px', flexShrink: 0, flexWrap: 'wrap', position: 'relative', zIndex: 9998 }}
      >
        <AlertTriangle size={18} />
        <span>{aviso.texto}</span>
        <button
          type="button"
          onClick={() => setJanelaAberta(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 12px', borderRadius: '6px', border: `1px solid ${cor.texto}`, background: 'transparent', color: cor.texto, fontWeight: 700, cursor: 'pointer' }}
        >
          <Receipt size={15} /> Ver boleto
        </button>
      </div>
      {janelaAberta && (
        <div role="dialog" aria-modal="true" aria-label={aviso.titulo} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div className="card" style={{ width: '100%', maxWidth: '600px', padding: '24px', borderRadius: 'var(--radius-lg)', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
              <h2 style={{ margin: 0, fontSize: '19px' }}>{aviso.titulo}</h2>
              <button type="button" onClick={() => setJanelaAberta(false)} aria-label="Fechar" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={22} />
              </button>
            </div>
            <p style={{ margin: 0, fontSize: '14.5px', lineHeight: 1.55, color: 'var(--text-secondary)' }}>{aviso.texto}</p>
            <PagamentoDaMensalidade resumo={resumo} />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn-secondary" onClick={() => setJanelaAberta(false)}>Entendi</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default AvisoMensalidade;
