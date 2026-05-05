import React, { useState, useEffect } from 'react';
import { DollarSign, Download, Search, Filter, Loader2, User } from 'lucide-react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
};

interface ComissaoMecanico {
  mecanicoId: string;
  mecanicoNome: string;
  osFinalizadas: number;
  totalMaoDeObra: number;
  percentual: number;
  valorComissao: number;
}

const RelatorioComissoes: React.FC = () => {
  const { tenantId, currentUser } = useAuth();
  const [comissoes, setComissoes] = useState<ComissaoMecanico[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const fetchComissoes = async () => {
      if (!tenantId || !currentUser) return;
      setIsLoading(true);

      try {
        // 1. Fetch mechanics that receive commission
        const qM = query(collection(db, 'usuarios'), where('tenantId', '==', tenantId), where('recebeComissao', '==', true));
        const snapM = await getDocs(qM);
        const mapMecanicos = new Map<string, any>();
        snapM.forEach(doc => mapMecanicos.set(doc.id, doc.data()));

        // 2. Fetch finalized OS
        const qOS = query(collection(db, 'ordens_de_servico'), where('tenantId', '==', tenantId), where('status', '==', 'Finalizada'));
        const snapOS = await getDocs(qOS);
        
        const agregacao = new Map<string, ComissaoMecanico>();

        // Init aggregation with all eligible mechanics (even if 0 OS)
        mapMecanicos.forEach((mecData, mId) => {
          agregacao.set(mId, {
            mecanicoId: mId,
            mecanicoNome: mecData.nome,
            osFinalizadas: 0,
            totalMaoDeObra: 0,
            percentual: mecData.comissaoPercentual || 0,
            valorComissao: 0
          });
        });

        snapOS.forEach(doc => {
          const os = doc.data();
          if (os.mecanicoId && mapMecanicos.has(os.mecanicoId)) {
            // Calculate total services value
            const totalServicos = (os.servicos || []).reduce((acc: number, s: any) => acc + (Number(s.preco) * (s.quantidade || 1)), 0);
            
            const atual = agregacao.get(os.mecanicoId)!;
            atual.osFinalizadas += 1;
            atual.totalMaoDeObra += totalServicos;
            atual.valorComissao = atual.totalMaoDeObra * (atual.percentual / 100);
            
            agregacao.set(os.mecanicoId, atual);
          }
        });

        setComissoes(Array.from(agregacao.values()).sort((a, b) => b.valorComissao - a.valorComissao));
      } catch (err) {
        console.error("Erro ao buscar comissões", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchComissoes();
  }, [tenantId, currentUser]);

  const filtrados = comissoes.filter(c => c.mecanicoNome.toLowerCase().includes(searchTerm.toLowerCase()));
  const totalGeralComissoes = filtrados.reduce((acc, c) => acc + c.valorComissao, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <DollarSign size={28} color="#10b981" />
            Relatório de Comissões
          </h1>
          <p style={{ color: 'var(--text-muted)' }}>Acompanhamento e fechamento das comissões da equipe técnica</p>
        </div>
        <button className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'white' }}>
          <Download size={18} /> Exportar Completo
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px' }}>
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
          <h3 style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '8px' }}>Total a Pagar em Comissões</h3>
          <p style={{ fontSize: '28px', fontWeight: 700, color: '#10b981', margin: 0 }}>
            {formatCurrency(totalGeralComissoes)}
          </p>
        </div>
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
          <h3 style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '8px' }}>Mecânicos Produtivos</h3>
          <p style={{ fontSize: '28px', fontWeight: 700, color: 'white', margin: 0 }}>
            {filtrados.filter(c => c.osFinalizadas > 0).length} / {filtrados.length}
          </p>
        </div>
      </div>

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
          <div className="search-bar" style={{ flex: 1, position: 'relative' }}>
            <Search size={20} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              type="text" 
              placeholder="Buscar por mecânico..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '100%', padding: '12px 16px 12px 48px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'white' }}
            />
          </div>
          <button className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 16px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'white' }}>
            <Filter size={20} /> Fechamento do Mês
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '13px', textTransform: 'uppercase' }}>
                <th style={{ padding: '16px' }}>Mecânico</th>
                <th style={{ padding: '16px', textAlign: 'center' }}>OS Finalizadas</th>
                <th style={{ padding: '16px' }}>Base de Cálculo (Mão de Obra)</th>
                <th style={{ padding: '16px', textAlign: 'center' }}>% Comissão</th>
                <th style={{ padding: '16px' }}>Valor a Pagar</th>
                <th style={{ padding: '16px', textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} style={{ padding: '40px', textAlign: 'center' }}>
                    <Loader2 size={32} className="spin-icon" style={{ margin: '0 auto', color: 'var(--accent-purple)' }} />
                  </td>
                </tr>
              ) : filtrados.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <User size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
                    <p>Nenhum mecânico com comissão configurada encontrado.</p>
                  </td>
                </tr>
              ) : (
                filtrados.map(c => (
                  <tr key={c.mecanicoId} style={{ borderBottom: '1px solid var(--border-color)', transition: 'background-color 0.2s' }}>
                    <td style={{ padding: '16px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <User size={16} style={{ color: 'var(--accent-purple)' }} />
                      </div>
                      {c.mecanicoNome}
                    </td>
                    <td style={{ padding: '16px', textAlign: 'center' }}>{c.osFinalizadas}</td>
                    <td style={{ padding: '16px', color: 'var(--text-secondary)' }}>{formatCurrency(c.totalMaoDeObra)}</td>
                    <td style={{ padding: '16px', textAlign: 'center' }}>
                      <span style={{ backgroundColor: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6', padding: '4px 8px', borderRadius: '4px', fontWeight: 600 }}>
                        {c.percentual}%
                      </span>
                    </td>
                    <td style={{ padding: '16px', fontWeight: 700, color: '#10b981' }}>{formatCurrency(c.valorComissao)}</td>
                    <td style={{ padding: '16px', textAlign: 'right' }}>
                      <button className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }}>
                        Ver OS
                      </button>
                    </td>
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

export default RelatorioComissoes;
