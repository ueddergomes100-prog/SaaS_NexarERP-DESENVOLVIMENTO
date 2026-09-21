import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import { NexusSwal, showError, showSuccess } from '../../utils/alerts';
import { trocaService } from '../../services/trocaService';
import {
  ESTILO_STATUS_TROCA,
  rotuloDoMotivoTroca,
  vendedorPodeCancelar,
  type Troca,
} from '../../utils/trocaDomain';
import VendedorHeader from './VendedorHeader';

/**
 * "Minhas Trocas": as trocas que ESTE vendedor enviou e em que pe' cada uma
 * esta' (a loja aprova, recusa -- com o motivo --, e entrega). So' leitura, mais
 * o cancelamento da propria troca enquanto a loja ainda nao aprovou.
 */

type TrocaDoFirestore = Omit<Troca, 'createdAtMillis'> & { createdAt?: { toMillis?: () => number; seconds?: number } };

const dataDaTroca = (t: TrocaDoFirestore): number => (
  typeof t.createdAt?.toMillis === 'function' ? t.createdAt.toMillis() : (t.createdAt?.seconds || 0) * 1000
);

const formatarData = (millis: number) => (millis ? new Date(millis).toLocaleDateString('pt-BR') : '');

const VendedorTrocas: React.FC = () => {
  const navigate = useNavigate();
  const { tenantId, currentUser } = useAuth();
  const { items, loading } = useTenantCollection<TrocaDoFirestore & { id: string }>('trocas', tenantId);
  const [aberta, setAberta] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState<string | null>(null);

  const minhas = useMemo(() => (
    items
      .filter((t) => t.vendedorId === currentUser?.uid)
      .sort((a, b) => dataDaTroca(b) - dataDaTroca(a))
  ), [items, currentUser]);

  const cancelar = async (troca: TrocaDoFirestore & { id: string }) => {
    const confirmacao = await NexusSwal.fire({
      icon: 'warning',
      title: `Cancelar a troca #${troca.numeroTroca}?`,
      text: 'A loja ainda não aprovou. Cancelando, o pedido de troca é encerrado.',
      showCancelButton: true,
      confirmButtonText: 'Sim, cancelar',
      cancelButtonText: 'Voltar',
      confirmButtonColor: '#ef4444',
      reverseButtons: true,
    });
    if (!confirmacao.isConfirmed) return;
    setCancelando(troca.id);
    try {
      await trocaService.cancelar(troca.id, 'Cancelada pelo vendedor no aplicativo');
      showSuccess('Troca cancelada.');
    } catch (erro) {
      showError('Não foi possível cancelar', (erro as Error).message);
    } finally {
      setCancelando(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader
        titulo="Minhas Trocas"
        aoVoltar={() => navigate('/vendedor')}
        acao={(
          <button
            type="button"
            onClick={() => navigate('/vendedor/troca/nova')}
            style={{ height: '38px', padding: '0 14px', borderRadius: '10px', border: 'none', color: '#fff', fontSize: '13px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', background: 'linear-gradient(135deg, var(--brand-500) 0%, var(--brand-700) 100%)' }}
          >
            <Plus size={16} /> Nova
          </button>
        )}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {loading ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>Carregando...</div>
        ) : minhas.length === 0 ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', lineHeight: 1.5 }}>
            Você ainda não enviou nenhuma troca.<br />Toque em "Nova" para pedir a reposição de um produto estragado.
          </div>
        ) : minhas.map((troca) => {
          const estilo = ESTILO_STATUS_TROCA[troca.status] || ESTILO_STATUS_TROCA.Solicitada;
          const expandida = aberta === troca.id;
          return (
            <div key={troca.id} style={{ borderRadius: '14px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
              <button
                type="button"
                onClick={() => setAberta(expandida ? null : troca.id)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '14px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    #{troca.numeroTroca} · {troca.clienteNome}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '3px' }}>
                    {troca.itens.length} {troca.itens.length === 1 ? 'item' : 'itens'} · {formatarData(dataDaTroca(troca))}
                  </div>
                  <span style={{ display: 'inline-block', marginTop: '7px', padding: '3px 10px', borderRadius: '999px', fontSize: '11.5px', fontWeight: 700, backgroundColor: estilo.fundo, color: estilo.cor }}>
                    {troca.status}
                  </span>
                </div>
                {expandida ? <ChevronUp size={18} color="var(--text-muted)" /> : <ChevronDown size={18} color="var(--text-muted)" />}
              </button>

              {expandida && (
                <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: '10px', borderTop: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '12.5px', color: estilo.cor, fontWeight: 600, marginTop: '10px' }}>{estilo.explicacao}</div>
                  {troca.status === 'Recusada' && troca.motivoRecusa && (
                    <div style={{ padding: '10px 12px', borderRadius: '10px', border: '1px solid rgba(239,68,68,0.45)', fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.4 }}>
                      <strong>Motivo da recusa:</strong> {troca.motivoRecusa}
                    </div>
                  )}
                  {troca.itens.map((item, indice) => (
                    <div key={`${item.id}-${indice}`} style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                      <strong style={{ color: 'var(--text-primary)' }}>{item.quantidade} {item.unidadeMedidaSigla}</strong> {item.nome}<br />
                      <span style={{ color: 'var(--text-muted)' }}>{rotuloDoMotivoTroca(item.motivo)}{item.motivoDescricao ? ` (${item.motivoDescricao})` : ''}</span>
                    </div>
                  ))}
                  {troca.observacao && (
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                      <strong style={{ color: 'var(--text-primary)' }}>Obs.:</strong> {troca.observacao}
                    </div>
                  )}
                  {vendedorPodeCancelar(troca, currentUser?.uid || '') && (
                    <button
                      type="button"
                      onClick={() => void cancelar(troca)}
                      disabled={cancelando === troca.id}
                      style={{ height: '44px', borderRadius: '12px', border: '1px solid rgba(239,68,68,0.5)', backgroundColor: 'transparent', color: '#f87171', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}
                    >
                      {cancelando === troca.id ? 'Cancelando...' : 'Cancelar esta troca'}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default VendedorTrocas;
