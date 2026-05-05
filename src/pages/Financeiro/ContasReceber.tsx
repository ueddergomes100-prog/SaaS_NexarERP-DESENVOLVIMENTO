import React, { useEffect, useState } from 'react';
import { collection, query, onSnapshot, where, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { CheckCircle, Clock } from 'lucide-react';
import './Financeiro.css';

interface TransacaoData {
  id: string;
  data: string;
  descricao: string;
  categoria: string;
  valor: number;
  tipo: 'entrada' | 'saida';
  status: 'Paga' | 'Pendente';
  formaPagamento?: string;
  osId?: string;
  createdAt?: any;
}

const ContasReceber: React.FC = () => {
  const [transacoes, setTransacoes] = useState<TransacaoData[]>([]);
  const [loading, setLoading] = useState(true);
  const { currentUser } = useAuth();

  useEffect(() => {
    if (!currentUser) return;
    
    // Escutar apenas transacoes de entrada que estão pendentes
    const q = query(
      collection(db, 'transacoes'), 
      where('tenantId', '==', currentUser.uid),
      where('tipo', '==', 'entrada'),
      where('status', '==', 'Pendente')
    );

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const data: TransacaoData[] = [];
      querySnapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as TransacaoData);
      });
      data.sort((a, b) => {
        const dateA = a.createdAt?.seconds || 0;
        const dateB = b.createdAt?.seconds || 0;
        return dateB - dateA;
      });
      setTransacoes(data);
      setLoading(false);
    }, (error) => {
      console.error("Erro ao buscar contas a receber:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser]);

  const handleConciliar = async (t: TransacaoData) => {
    const result = await NexusSwal.fire({
      title: 'Confirmar Recebimento?',
      text: `Deseja dar baixa definitiva no valor de R$ ${Number(t.valor).toFixed(2)} referente a ${t.descricao}?`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sim, dar baixa no caixa',
      cancelButtonText: 'Ainda não'
    });

    if (result.isConfirmed) {
      try {
        const docRef = doc(db, 'transacoes', t.id);
        await updateDoc(docRef, { status: 'Paga' });
        showSuccess('Pagamento aprovado e somado ao Fluxo de Caixa!');
      } catch (err) {
        showError('Erro', 'Não foi possível aprovar a transação.');
      }
    }
  };

  const totalPendente = transacoes.reduce((acc, curr) => acc + curr.valor, 0);

  return (
    <div className="financeiro-page" style={{ padding: '24px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700 }}>Contas a Receber</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>Aguardando conciliação de pagamentos (Cartão, Boleto, Prazo)</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'var(--bg-secondary)', padding: '12px 24px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
          <Clock size={24} color="#f59e0b" />
          <div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Total a Receber</div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#f59e0b' }}>
              {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalPendente)}
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
        <div className="table-wrapper">
          <table className="data-table financeiro-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ padding: '16px' }}>Data da OS</th>
                <th style={{ padding: '16px' }}>Descrição / O.S</th>
                <th style={{ padding: '16px' }}>Forma de Pgto.</th>
                <th style={{ padding: '16px' }}>Status</th>
                <th style={{ padding: '16px', textAlign: 'right' }}>Valor (R$)</th>
                <th style={{ padding: '16px', textAlign: 'center' }}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '20px' }}>Carregando contas a receber...</td>
                </tr>
              ) : transacoes.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    <CheckCircle size={48} color="#10b981" style={{ margin: '0 auto 16px', opacity: 0.5 }} />
                    <div>Nenhuma conta pendente para conciliação no momento.</div>
                  </td>
                </tr>
              ) : (
                transacoes.map((t) => (
                  <tr key={t.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '16px', color: 'var(--text-muted)' }}>{t.data ? t.data.split('-').reverse().join('/') : new Date(t.createdAt?.seconds * 1000).toLocaleDateString('pt-BR')}</td>
                    <td style={{ padding: '16px', fontWeight: 500 }}>{t.descricao}</td>
                    <td style={{ padding: '16px' }}>
                      <span style={{ fontSize: '12px', backgroundColor: 'var(--bg-tertiary)', padding: '4px 8px', borderRadius: '4px', color: 'white', border: '1px solid var(--border-color)' }}>
                        {t.formaPagamento || 'Não informada'}
                      </span>
                    </td>
                    <td style={{ padding: '16px' }}>
                      <span className="status-badge" style={{ backgroundColor: '#f59e0b20', color: '#f59e0b', whiteSpace: 'nowrap', padding: '4px 8px', borderRadius: '12px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <span className="status-dot" style={{ backgroundColor: '#f59e0b', width: '6px', height: '6px', borderRadius: '50%' }}></span>
                        Aguardando Conciliação
                      </span>
                    </td>
                    <td style={{ padding: '16px', textAlign: 'right', fontWeight: '600', color: '#10b981' }}>
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(t.valor))}
                    </td>
                    <td style={{ padding: '16px', textAlign: 'center' }}>
                      <button 
                        onClick={() => handleConciliar(t)}
                        style={{ backgroundColor: '#10b981', border: 'none', color: 'white', cursor: 'pointer', borderRadius: '4px', padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px', transition: 'filter 0.2s' }}
                        onMouseOver={(e) => e.currentTarget.style.filter = 'brightness(1.1)'}
                        onMouseOut={(e) => e.currentTarget.style.filter = 'brightness(1)'}
                      >
                        <CheckCircle size={14} /> Dar Baixa
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

export default ContasReceber;
