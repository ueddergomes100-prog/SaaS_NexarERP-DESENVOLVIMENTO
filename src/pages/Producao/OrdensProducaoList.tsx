import React, { useEffect, useState } from 'react';
import { Search, Plus, Factory } from 'lucide-react';
import { collection, query, onSnapshot, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';

type StatusOrdem = 'criada' | 'em_producao' | 'pausada' | 'finalizada' | 'cancelada';

interface OrdemProducaoData {
  id: string;
  numero: string;
  produtoNome: string;
  quantidadePlanejada: number;
  quantidadeProduzida: number | null;
  status: StatusOrdem;
  responsavelNome: string;
}

const STATUS_LABELS: Record<StatusOrdem, string> = {
  criada: 'Criada',
  em_producao: 'Em Produção',
  pausada: 'Pausada',
  finalizada: 'Finalizada',
  cancelada: 'Cancelada',
};

const STATUS_COLORS: Record<StatusOrdem, string> = {
  criada: '#3b82f6',
  em_producao: '#8b5cf6',
  pausada: '#f59e0b',
  finalizada: '#10b981',
  cancelada: '#ef4444',
};

const OrdensProducaoList: React.FC = () => {
  const { openTab } = useTabs();
  const [ordens, setOrdens] = useState<OrdemProducaoData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const { currentUser, tenantId } = useAuth();

  useEffect(() => {
    if (!currentUser) return;

    const q = query(collection(db, 'ordens_producao'), where('tenantId', '==', tenantId));

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const data: OrdemProducaoData[] = [];
      querySnapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as OrdemProducaoData);
      });
      data.sort((a, b) => b.numero.localeCompare(a.numero));
      setOrdens(data);
      setLoading(false);
    }, (error) => {
      console.error("Erro ao buscar ordens de produção:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser, tenantId]);

  const filteredOrdens = ordens.filter(ordem => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      (ordem.numero && ordem.numero.toLowerCase().includes(term)) ||
      (ordem.produtoNome && ordem.produtoNome.toLowerCase().includes(term))
    );
  });

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>Ordens de Produção</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>Entrada de matéria-prima → Estoque → Ordem de Produção → Produto Acabado</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn-primary" onClick={() => openTab('/producao/ordens/nova')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={18} /> Nova Ordem
          </button>
        </div>
      </div>

      <div className="card list-container" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div className="list-toolbar" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div className="search-box" style={{ position: 'relative', width: '350px' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '10px', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Buscar por número ou produto..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '100%', padding: '10px 16px 10px 40px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Número</th>
                <th>Produto</th>
                <th>Qtd. Planejada</th>
                <th>Qtd. Produzida</th>
                <th>Status</th>
                <th>Responsável</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '20px' }}>Carregando ordens de produção...</td>
                </tr>
              ) : filteredOrdens.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                    <Factory size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
                    <p>{searchTerm ? `Nenhum resultado encontrado para "${searchTerm}".` : "Nenhuma ordem de produção cadastrada."}</p>
                  </td>
                </tr>
              ) : (
                filteredOrdens.map((ordem) => (
                  <tr
                    key={ordem.id}
                    onClick={() => openTab(`/producao/ordens/editar/${ordem.id}`)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td className="font-medium">{ordem.numero}</td>
                    <td>{ordem.produtoNome}</td>
                    <td>{ordem.quantidadePlanejada}</td>
                    <td>{ordem.quantidadeProduzida ?? '-'}</td>
                    <td>
                      <span style={{ padding: '4px 10px', borderRadius: '14px', fontSize: '12px', fontWeight: 700, color: '#fff', backgroundColor: STATUS_COLORS[ordem.status] }}>
                        {STATUS_LABELS[ordem.status]}
                      </span>
                    </td>
                    <td>{ordem.responsavelNome || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default OrdensProducaoList;
