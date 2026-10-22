import React, { useState } from 'react';
import { Inbox, Plus, Search } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { useTenantCollection, type TenantCollectionItem } from '../../hooks/useTenantCollection';
import { ROTULO_STATUS_COTACAO, cotacaoVencida, type Cotacao, type StatusCotacao } from '../../utils/comprasDomain';
import { getDateInputInTimeZone } from '../../utils/dateTime';

/**
 * COMPRAS > COTACOES (22/10/2026): lista as cotacoes da filial. Cada uma vai a
 * varios fornecedores por link; ver CotacaoForm.tsx. Leitura pelo Firestore
 * (regra de leitura por empresa); escrita pelo servidor.
 */

type CotacaoDoc = TenantCollectionItem & Partial<Cotacao>;

type Aba = 'aberta' | 'fechada' | 'cancelada' | 'todas';
const ABAS: Array<[Aba, string]> = [['aberta', 'Abertas'], ['fechada', 'Fechadas'], ['cancelada', 'Canceladas'], ['todas', 'Todas']];

const dataBr = (iso?: string) => (iso ? iso.split('T')[0].split('-').reverse().join('/') : '—');

const Cotacoes: React.FC = () => {
  const { tenantId } = useAuth();
  const { openTab } = useTabs();
  const { items, loading } = useTenantCollection<CotacaoDoc>('cotacoes_compra', tenantId);
  const [aba, setAba] = useState<Aba>('aberta');
  const [busca, setBusca] = useState('');
  const hoje = getDateInputInTimeZone();

  const termo = busca.trim().toLowerCase();
  const lista = items
    .filter((c) => aba === 'todas' || (c.status || 'aberta') === aba)
    .filter((c) => !termo || String(c.titulo || '').toLowerCase().includes(termo) || String(c.numero || '').includes(termo) || (c.fornecedores || []).some((f) => f.nome.toLowerCase().includes(termo)))
    .sort((a, b) => (Number(b.numero) || 0) - (Number(a.numero) || 0));
  const contagem = (status: Aba) => items.filter((c) => status === 'todas' || (c.status || 'aberta') === status).length;

  return (
    <div className="financeiro-page" style={{ padding: '24px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700 }}>Cotações de Compra</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>Monte a lista, mande o link aos fornecedores e compare as propostas item a item.</p>
        </div>
        <button className="btn-primary" onClick={() => openTab('/compras/cotacoes/nova')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Plus size={18} /> Nova cotação
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
                <th>Cotação</th>
                <th style={{ textAlign: 'right' }}>Itens</th>
                <th>Fornecedores (responderam)</th>
                <th>Responder até</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>Carregando...</td></tr>
              ) : lista.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    <Inbox size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                    <div>{items.length === 0 ? 'Nenhuma cotação ainda. Clique em "Nova cotação" para montar a primeira.' : 'Nenhuma cotação nesta situação com essa busca.'}</div>
                  </td>
                </tr>
              ) : lista.map((c) => {
                const status = (c.status || 'aberta') as StatusCotacao;
                const vencida = status === 'aberta' && cotacaoVencida(String(c.responderAte || ''), hoje);
                const fornecedores = c.fornecedores || [];
                return (
                  <tr key={c.id} onClick={() => openTab(`/compras/cotacoes/${c.id}`)} style={{ cursor: 'pointer' }}>
                    <td style={{ fontWeight: 700 }}>{String(c.numero || 0).padStart(4, '0')}</td>
                    <td>{c.titulo}</td>
                    <td style={{ textAlign: 'right' }}>{(c.itens || []).length}</td>
                    <td>{fornecedores.filter((f) => f.status === 'respondida').length} de {fornecedores.length}{fornecedores.length > 0 ? ` · ${fornecedores.map((f) => f.nome).join(', ')}` : ''}</td>
                    <td style={{ color: vencida ? '#ef4444' : undefined }}>{dataBr(c.responderAte)}{vencida ? ' (venceu)' : ''}</td>
                    <td>{ROTULO_STATUS_COTACAO[status]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Cotacoes;
