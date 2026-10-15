import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ClipboardCheck, Lock, Search } from 'lucide-react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import VendedorHeader from './VendedorHeader';
import { useTravasAtivas } from '../../hooks/useTravaDeEdicao';
import { hasTenantFullAccess } from '../../utils/roles';
import { filtrarVendasVisiveis } from '../../utils/visibilidadeVendasDomain';
import {
  COR_CONFERENCIA,
  ROTULO_CONFERENCIA,
  STATUS_CONFERENCIA_PENDENTES,
  podeConferirNoApp,
  type StatusConferencia,
} from '../../utils/conferenciaDomain';
import { descreverTrava, mensagemDeBloqueio, type TravaDeEdicao } from '../../utils/travaEdicaoDomain';
import { NexusSwal } from '../../utils/alerts';

/**
 * CONFERENCIA PELO CELULAR -- fila (pedido do dono, 15/10/2026). Os mesmos
 * pedidos e trocas da Fila de Expedicao do computador que ainda tem o que
 * conferir. O que outra pessoa esta conferindo (no computador ou em outro
 * celular) aparece cinza e nao abre.
 */

interface ItemDaFila {
  id: string;
  tipo: 'pedido' | 'troca';
  numero: string;
  clienteNome: string;
  statusConferencia: StatusConferencia;
  criadoEmSeg: number;
  // Para a visibilidade de vendas (cada vendedor so' as proprias).
  vendedorId?: string;
  usuarioResponsavelId?: string;
  criadoPor?: string;
  tenantId: string;
}

const formatarData = (seg: number) => (seg ? new Date(seg * 1000).toLocaleDateString('pt-BR') : '');

const VendedorConferenciaFila: React.FC = () => {
  const navigate = useNavigate();
  const { tenantId, userRole, isOwner, userPermissions, conferenciaMercadoriaAtiva, vendasVisiveisDeUsuarioId } = useAuth();
  const podeVer = podeConferirNoApp({ acessoTotal: hasTenantFullAccess(userRole, isOwner), permissoes: userPermissions, conferenciaAtiva: conferenciaMercadoriaAtiva });
  const [pedidos, setPedidos] = useState<ItemDaFila[]>([]);
  const [trocas, setTrocas] = useState<ItemDaFila[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');
  const travas = useTravasAtivas('conferencia', podeVer);

  useEffect(() => {
    if (!tenantId || !podeVer) return undefined;
    const pendentes = (colecao: 'pedidos_venda' | 'trocas') => query(
      collection(db, colecao),
      where('tenantId', '==', tenantId),
      where('statusConferencia', 'in', STATUS_CONFERENCIA_PENDENTES),
    );
    const pararPedidos = onSnapshot(pendentes('pedidos_venda'), (snap) => {
      setPedidos(snap.docs
        // Pedido ou pre-venda cancelado sai da fila: nao ha mercadoria a separar.
        .filter((d) => d.data().status !== 'Cancelada')
        .map((d) => {
          const dados = d.data();
          return {
            id: d.id, tipo: 'pedido' as const, numero: String(dados.numeroPedido || ''), clienteNome: dados.clienteNome || 'Consumidor Final',
            statusConferencia: dados.statusConferencia, criadoEmSeg: dados.createdAt?.seconds || 0,
            vendedorId: dados.vendedorId, usuarioResponsavelId: dados.usuarioResponsavelId, criadoPor: dados.criadoPor, tenantId: dados.tenantId,
          };
        }));
      setCarregando(false);
    }, (erro) => {
      console.error('Erro ao buscar a fila de conferência:', erro);
      setCarregando(false);
    });
    const pararTrocas = onSnapshot(pendentes('trocas'), (snap) => {
      setTrocas(snap.docs
        .filter((d) => d.data().status !== 'Recusada' && d.data().status !== 'Cancelada')
        .map((d) => {
          const dados = d.data();
          return {
            id: d.id, tipo: 'troca' as const, numero: String(dados.numeroTroca || ''), clienteNome: dados.clienteNome || 'Consumidor Final',
            statusConferencia: dados.statusConferencia, criadoEmSeg: dados.createdAt?.seconds || 0,
            vendedorId: dados.vendedorId, usuarioResponsavelId: dados.usuarioResponsavelId, criadoPor: dados.criadoPor, tenantId: dados.tenantId,
          };
        }));
    }, (erro) => console.error('Erro ao buscar as trocas da fila de conferência:', erro));
    return () => { pararPedidos(); pararTrocas(); };
  }, [tenantId, podeVer]);

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return filtrarVendasVisiveis([...pedidos, ...trocas], vendasVisiveisDeUsuarioId)
      .filter((item) => !termo || item.numero.toLowerCase().includes(termo) || item.clienteNome.toLowerCase().includes(termo))
      // O que espera ha mais tempo primeiro: e' o proximo a separar.
      .sort((a, b) => a.criadoEmSeg - b.criadoEmSeg);
  }, [pedidos, trocas, busca, vendasVisiveisDeUsuarioId]);

  if (!podeVer) return <Navigate to="/vendedor" replace />;

  const abrir = (item: ItemDaFila, trava: TravaDeEdicao | undefined) => {
    if (trava) {
      void NexusSwal.fire({ title: 'Em edição por outra pessoa', text: mensagemDeBloqueio('conferencia', trava), icon: 'info', confirmButtonText: 'Entendi' });
      return;
    }
    navigate(item.tipo === 'troca' ? `/vendedor/conferencia/troca/${item.id}` : `/vendedor/conferencia/${item.id}`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader titulo="Conferência" subtitulo="Pedidos e trocas para separar" aoVoltar={() => navigate('/vendedor')} />

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <label style={{ position: 'relative', display: 'block', flexShrink: 0 }}>
          <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar pelo número ou cliente"
            inputMode="search"
            style={{ width: '100%', padding: '13px 14px 13px 42px', borderRadius: 'var(--app-raio-linha)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: '15px' }}
          />
        </label>

        {carregando ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>Carregando...</div>
        ) : lista.length === 0 ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>
            {busca.trim() ? `Nada encontrado para "${busca.trim()}".` : 'Nenhum pedido aguardando conferência.'}
          </div>
        ) : lista.map((item) => {
          const trava = travas.get(item.id);
          return (
            <button
              key={`${item.tipo}-${item.id}`}
              type="button"
              onClick={() => abrir(item, trava)}
              style={{
                flexShrink: 0, display: 'flex', alignItems: 'center', gap: '12px', padding: '14px', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit',
                borderRadius: 'var(--app-raio-linha)', backgroundColor: 'var(--bg-elevated)', boxShadow: 'var(--app-sombra)', border: '1px solid var(--border-color)',
                opacity: trava ? 0.55 : 1,
              }}
            >
              <span className="app-icone">{trava ? <Lock size={20} /> : <ClipboardCheck size={20} />}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: '15px', color: 'var(--text-primary)' }}>#{item.numero}</strong>
                  {item.tipo === 'troca' && <span style={{ padding: '1px 7px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, color: '#fff', backgroundColor: '#8b5cf6' }}>TROCA</span>}
                  <span style={{ padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 700, color: '#fff', backgroundColor: COR_CONFERENCIA[item.statusConferencia] }}>
                    {ROTULO_CONFERENCIA[item.statusConferencia]}
                  </span>
                </div>
                <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: 1.3, overflowWrap: 'anywhere' }}>{item.clienteNome}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '3px' }}>
                  {trava ? descreverTrava(trava) : formatarData(item.criadoEmSeg)}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default VendedorConferenciaFila;
