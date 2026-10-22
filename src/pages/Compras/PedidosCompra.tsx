import React, { useState } from 'react';
import { ClipboardList, Plus, Search } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { useTenantCollection, type TenantCollectionItem } from '../../hooks/useTenantCollection';
import { ROTULO_STATUS_PEDIDO_COMPRA, formatarReais, type PedidoCompra, type StatusPedidoCompra } from '../../utils/comprasDomain';

/**
 * COMPRAS > PEDIDOS DE COMPRA (22/10/2026): os pedidos gerados da cotacao e
 * os feitos a mao. Ver PedidoCompraForm.tsx.
 */

type PedidoDoc = TenantCollectionItem & Partial<PedidoCompra>;

type Aba = 'aberto' | 'enviado' | 'recebido' | 'cancelado' | 'todos';
const ABAS: Array<[Aba, string]> = [['aberto', 'Abertos'], ['enviado', 'Enviados'], ['recebido', 'Recebidos'], ['cancelado', 'Cancelados'], ['todos', 'Todos']];

const dataBr = (iso?: string) => (iso ? iso.split('T')[0].split('-').reverse().join('/') : '—');

const PedidosCompra: React.FC = () => {
  const { tenantId } = useAuth();
  const { openTab } = useTabs();
  const { items, loading } = useTenantCollection<PedidoDoc>('pedidos_compra', tenantId);
  const [aba, setAba] = useState<Aba>('aberto');
  const [busca, setBusca] = useState('');

  const termo = busca.trim().toLowerCase();
  const lista = items
    .filter((p) => aba === 'todos' || (p.status || 'aberto') === aba)
    .filter((p) => !termo || String(p.fornecedorNome || '').toLowerCase().includes(termo) || String(p.numero || '').includes(termo))
    .sort((a, b) => (Number(b.numero) || 0) - (Number(a.numero) || 0));
  const contagem = (status: Aba) => items.filter((p) => status === 'todos' || (p.status || 'aberto') === status).length;

  return (
    <div className="financeiro-page" style={{ padding: '24px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700 }}>Pedidos de Compra</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>Gerados da cotação ou feitos à mão. Saem em PDF para o fornecedor; marque Enviado e, quando a mercadoria chegar, Recebido.</p>
        </div>
        <button className="btn-primary" onClick={() => openTab('/compras/pedidos-compra/novo')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Plus size={18} /> Novo pedido
        </button>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
        {ABAS.map(([chave, rotulo]) => (
          <button key={chave} type="button" className={aba === chave ? 'btn-primary' : 'btn-secondary'} onClick={() => setAba(chave)} style={{ padding: '8px 14px', fontSize: '13px' }}>
            {rotulo} ({contagem(chave)})
          </button>
        ))}
        <div className="search-bar" style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
          <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar…" style={{ width: '100%', padding: '10px 14px 10px 40px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }} />
        </div>
      </div>

      <div className="card list-container">
        <div className="table-wrapper">
          <table className="data-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Nº</th>
                <th>Fornecedor</th>
                <th style={{ textAlign: 'right' }}>Itens</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th>Criado em</th>
                <th>Origem</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>Carregando...</td></tr>
              ) : lista.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    <ClipboardList size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                    <div>{items.length === 0 ? 'Nenhum pedido de compra ainda.' : 'Nenhum pedido nesta situação com essa busca.'}</div>
                  </td>
                </tr>
              ) : lista.map((p) => (
                <tr key={p.id} onClick={() => openTab(`/compras/pedidos-compra/${p.id}`)} style={{ cursor: 'pointer' }}>
                  <td style={{ fontWeight: 700 }}>{String(p.numero || 0).padStart(4, '0')}</td>
                  <td>{p.fornecedorNome}</td>
                  <td style={{ textAlign: 'right' }}>{(p.itens || []).length}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatarReais(Number(p.totalCentavos) || 0)}</td>
                  <td>{dataBr(p.criadoEmIso)}</td>
                  <td>{p.cotacaoNumero ? `Cotação ${String(p.cotacaoNumero).padStart(4, '0')}` : 'À mão'}</td>
                  <td>{ROTULO_STATUS_PEDIDO_COMPRA[(p.status || 'aberto') as StatusPedidoCompra]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default PedidosCompra;
