import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Phone, MapPin, Mail, Plus } from 'lucide-react';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import { calcularSaldoEmAbertoClienteCents } from '../../utils/contasReceberQuery';
import { buscarIdsClientesMaisFrequentes } from '../../services/vendedorRankingService';
import ClientAutocomplete from '../../components/common/ClientAutocomplete';
import type { SearchableClient } from '../../utils/clientSearch';
import type { VendedorNovoPedidoNavState } from './vendedorNavState';
import VendedorHeader from './VendedorHeader';

interface ClienteVendedor extends SearchableClient {
  id: string;
  nome: string;
  telefone?: string;
  email?: string;
  endereco?: string;
  bairro?: string;
  cidade?: string;
  estado?: string;
}

interface HistoricoItem {
  id: string;
  tipo: 'Pedido' | 'Orçamento';
  numero: string;
  status: string;
  valorTotal: number;
  createdAtMillis: number;
}

const formatarMoeda = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const toMillis = (value: unknown): number => {
  const withToMillis = value as { toMillis?: () => number } | undefined;
  return typeof withToMillis?.toMillis === 'function' ? withToMillis.toMillis() : 0;
};

const VendedorConsultarCliente: React.FC = () => {
  const navigate = useNavigate();
  const { tenantId } = useAuth();
  const { items: clientes } = useTenantCollection<ClienteVendedor>('clientes', tenantId);

  const [busca, setBusca] = useState('');
  const [selecionado, setSelecionado] = useState<ClienteVendedor | null>(null);
  const [saldoCents, setSaldoCents] = useState<number | null>(null);
  const [historico, setHistorico] = useState<HistoricoItem[]>([]);
  const [carregandoDetalhe, setCarregandoDetalhe] = useState(false);
  const [idsFrequentes, setIdsFrequentes] = useState<string[]>([]);

  useEffect(() => {
    if (!tenantId) return;
    let cancelado = false;
    buscarIdsClientesMaisFrequentes(tenantId).then((ids) => { if (!cancelado) setIdsFrequentes(ids); }).catch(() => {});
    return () => { cancelado = true; };
  }, [tenantId]);

  const clientesFrequentes = useMemo(() => {
    const porId = new Map(clientes.map((c) => [c.id, c]));
    return idsFrequentes.map((id) => porId.get(id)).filter((c): c is ClienteVendedor => !!c);
  }, [idsFrequentes, clientes]);

  const irParaNovoPedido = (cliente: ClienteVendedor) => {
    const state: VendedorNovoPedidoNavState = { clientePreSelecionado: { id: cliente.id, nome: cliente.nome } };
    navigate('/vendedor/pedido/novo', { state });
  };

  useEffect(() => {
    if (!selecionado || !tenantId) {
      setSaldoCents(null);
      setHistorico([]);
      return;
    }

    let cancelado = false;
    setCarregandoDetalhe(true);

    (async () => {
      const [saldo, pedidosSnap, orcamentosSnap] = await Promise.all([
        calcularSaldoEmAbertoClienteCents(tenantId, selecionado.id).catch(() => 0),
        getDocs(query(
          collection(db, 'pedidos_venda'),
          where('tenantId', '==', tenantId),
          where('clienteId', '==', selecionado.id),
          orderBy('createdAt', 'desc'),
          limit(5),
        )).catch(() => null),
        getDocs(query(
          collection(db, 'orcamentos'),
          where('tenantId', '==', tenantId),
          where('clienteId', '==', selecionado.id),
          orderBy('createdAt', 'desc'),
          limit(5),
        )).catch(() => null),
      ]);

      if (cancelado) return;

      const itensPedidos: HistoricoItem[] = (pedidosSnap?.docs || []).map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          tipo: 'Pedido' as const,
          numero: data.numeroPedido || '',
          status: data.status || '',
          valorTotal: Number(data.valorTotal || 0),
          createdAtMillis: toMillis(data.createdAt),
        };
      });
      const itensOrcamentos: HistoricoItem[] = (orcamentosSnap?.docs || []).map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          tipo: 'Orçamento' as const,
          numero: data.numeroOrcamento || '',
          status: data.status || '',
          valorTotal: Number(data.valorTotal || 0),
          createdAtMillis: toMillis(data.createdAt),
        };
      });

      setSaldoCents(saldo);
      setHistorico([...itensPedidos, ...itensOrcamentos].sort((a, b) => b.createdAtMillis - a.createdAtMillis).slice(0, 6));
      setCarregandoDetalhe(false);
    })();

    return () => { cancelado = true; };
  }, [selecionado, tenantId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader titulo="Consultar Cliente" />

      <div style={{ padding: '16px 20px 0' }}>
        <ClientAutocomplete
          value={busca}
          onChange={setBusca}
          clients={clientes}
          onSelect={(cliente) => setSelecionado(cliente)}
          renderItem={(cliente) => <span>{cliente.nome}</span>}
          placeholder="Buscar cliente por nome"
          ariaLabel="Buscar cliente"
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {!selecionado ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {clientesFrequentes.length > 0 && (
              <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '2px' }}>
                Clientes frequentes
              </div>
            )}
            {clientesFrequentes.map((cliente) => (
              <div
                key={cliente.id}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '13px 14px', borderRadius: '14px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}
              >
                <button
                  type="button"
                  onClick={() => setSelecionado(cliente)}
                  style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {cliente.nome}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => irParaNovoPedido(cliente)}
                  aria-label={`Novo pedido para ${cliente.nome}`}
                  style={{
                    width: '36px', height: '36px', borderRadius: '10px', border: 'none', flexShrink: 0,
                    background: 'linear-gradient(135deg, var(--brand-500) 0%, var(--brand-700) 100%)',
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                  }}
                >
                  <Plus size={18} />
                </button>
              </div>
            ))}
            {clientesFrequentes.length === 0 && (
              <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                Busque um cliente pra ver os dados.
              </div>
            )}
          </div>
        ) : (
          <>
            <div style={{ borderRadius: '18px', padding: '20px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)' }}>{selecionado.nome}</div>

              <div style={{ height: '1px', backgroundColor: 'var(--border-color)' }} />

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {selecionado.telefone && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13.5px', color: 'var(--text-secondary)' }}>
                    <Phone size={16} color="var(--brand-400)" /> {selecionado.telefone}
                  </div>
                )}
                {(selecionado.endereco || selecionado.cidade) && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13.5px', color: 'var(--text-secondary)' }}>
                    <MapPin size={16} color="var(--brand-400)" />
                    {[selecionado.endereco, selecionado.bairro, selecionado.cidade, selecionado.estado].filter(Boolean).join(' - ')}
                  </div>
                )}
                {selecionado.email && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13.5px', color: 'var(--text-secondary)' }}>
                    <Mail size={16} color="var(--brand-400)" /> {selecionado.email}
                  </div>
                )}
              </div>

              {saldoCents !== null && saldoCents > 0 && (
                <div style={{ fontSize: '13px', color: '#f59e0b', fontWeight: 600 }}>
                  Saldo em aberto: {formatarMoeda(saldoCents / 100)}
                </div>
              )}

              <button
                type="button"
                onClick={() => irParaNovoPedido(selecionado)}
                style={{
                  height: '46px', borderRadius: '14px', border: 'none', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '14px', fontWeight: 700,
                  color: '#fff', cursor: 'pointer', background: 'linear-gradient(135deg, var(--brand-500) 0%, var(--brand-700) 100%)',
                }}
              >
                <Plus size={18} /> Novo pedido para este cliente
              </button>
              <button
                type="button"
                onClick={() => { setSelecionado(null); setBusca(''); }}
                style={{ fontSize: '12.5px', color: 'var(--brand-400)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, alignSelf: 'center' }}
              >
                Buscar outro cliente
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Histórico recente
              </div>
              {carregandoDetalhe ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '12px 0' }}>Carregando...</div>
              ) : historico.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '12px 0' }}>Nenhum pedido ou orçamento ainda.</div>
              ) : (
                historico.map((item) => (
                  <div
                    key={`${item.tipo}-${item.id}`}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '13px 14px', borderRadius: '14px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {item.tipo} #{item.numero} &middot; {item.status}
                      </div>
                    </div>
                    <div style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text-primary)' }}>{formatarMoeda(item.valorTotal)}</div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default VendedorConsultarCliente;
