import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { FileText, Printer, ArrowLeft } from 'lucide-react';
import '../OS/OsPrint.css'; // Usando os estilos de impressão

const PrintRelatorioFinanceiro: React.FC = () => {
  const { search } = useLocation();
  const navigate = useNavigate();
  const { tenantId, currentUser } = useAuth();
  
  const queryParams = new URLSearchParams(search);
  const tipo = queryParams.get('tipo') as 'entrada' | 'saida';
  const status = queryParams.get('status') as 'Pendente' | 'Paga';
  const inicio = queryParams.get('inicio') || '';
  const fim = queryParams.get('fim') || '';

  const [transacoes, setTransacoes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser || !tenantId) return;

    const fetchData = async () => {
      try {
        const q = query(
          collection(db, 'transacoes'),
          where('tenantId', '==', tenantId),
          where('tipo', '==', tipo),
          where('status', '==', status)
        );

        const snapshot = await getDocs(q);
        const results: any[] = [];
        
        snapshot.forEach(doc => {
          results.push({ id: doc.id, ...doc.data() });
        });

        // Filtragem por data localmente
        const filteredResults = results.filter(t => {
          let tDateStr = '';
          
          if (status === 'Pendente') {
             // Se for pendente, usamos a data de vencimento/agendamento
             tDateStr = t.data;
          } else {
             // Se for paga, usamos a dataPagamento, ou a data de vencimento, ou a data de criação
             if (t.dataPagamento) {
               tDateStr = t.dataPagamento;
             } else if (t.data) {
               tDateStr = t.data;
             } else if (t.createdAt) {
               tDateStr = new Date(t.createdAt.seconds * 1000).toISOString().split('T')[0];
             }
          }

          if (!tDateStr) return false;

          // Se tDateStr estiver no formato AAAA-MM-DD
          return tDateStr >= inicio && tDateStr <= fim;
        });

        // Ordenar por data
        filteredResults.sort((a, b) => {
          const dateA = status === 'Paga' ? (a.dataPagamento || a.data || '') : (a.data || '');
          const dateB = status === 'Paga' ? (b.dataPagamento || b.data || '') : (b.data || '');
          return dateA.localeCompare(dateB);
        });

        setTransacoes(filteredResults);
      } catch (error) {
        console.error("Erro ao buscar relatório financeiro:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [currentUser, tenantId, tipo, status, inicio, fim]);

  const handlePrint = () => {
    window.print();
  };

  const totalRelatorio = transacoes.reduce((acc, curr) => acc + Number(curr.valor || 0), 0);

  const tituloRelatorio = tipo === 'entrada' 
    ? (status === 'Pendente' ? 'Relatório de Débitos de Clientes (A Receber)' : 'Relatório de Recebimentos (Pagos)')
    : (status === 'Pendente' ? 'Relatório de Contas a Pagar (Pendentes)' : 'Relatório de Pagamentos (Despesas Pagas)');

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center' }}>Gerando relatório...</div>;
  }

  return (
    <div className="print-container">
      <div className="no-print" style={{ padding: '20px', backgroundColor: 'var(--bg-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)' }}>
        <button className="btn-secondary" onClick={() => navigate(-1)} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ArrowLeft size={18} /> Voltar
        </button>
        <button className="btn-primary" onClick={handlePrint} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Printer size={18} /> IMPRIMIR PDF
        </button>
      </div>

      <div className="print-content" style={{ padding: '40px', backgroundColor: 'white', color: 'black', minHeight: '100vh', fontFamily: 'Arial, sans-serif' }}>
        <div style={{ textAlign: 'center', borderBottom: '2px solid #eee', paddingBottom: '20px', marginBottom: '30px' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: '0 0 10px 0', color: '#111' }}>
            {tituloRelatorio}
          </h1>
          <div style={{ color: '#555', fontSize: '14px', display: 'flex', justifyContent: 'center', gap: '24px' }}>
            <span><strong>Período:</strong> {inicio.split('-').reverse().join('/')} a {fim.split('-').reverse().join('/')}</span>
            <span><strong>Total de Registros:</strong> {transacoes.length}</span>
            <span><strong>Gerado em:</strong> {new Date().toLocaleDateString('pt-BR')} às {new Date().toLocaleTimeString('pt-BR')}</span>
          </div>
        </div>

        {transacoes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#888' }}>
            <p>Nenhuma transação encontrada para os filtros selecionados no período.</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #ddd' }}>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 'bold', color: '#333' }}>
                  {status === 'Paga' ? 'Data Pgto' : 'Vencimento'}
                </th>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 'bold', color: '#333' }}>Descrição / Origem</th>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 'bold', color: '#333' }}>Categoria</th>
                {tipo === 'entrada' && <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 'bold', color: '#333' }}>Cliente</th>}
                {status === 'Paga' && <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 'bold', color: '#333' }}>Forma Pgto</th>}
                <th style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 'bold', color: '#333' }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {transacoes.map((t, index) => {
                const dataExibicao = status === 'Paga' ? (t.dataPagamento || t.data || '') : (t.data || '');
                const dataFormatada = dataExibicao ? dataExibicao.split('-').reverse().join('/') : '-';

                return (
                  <tr key={t.id} style={{ borderBottom: '1px solid #eee', backgroundColor: index % 2 === 0 ? '#fff' : '#fafafa' }}>
                    <td style={{ padding: '10px 8px' }}>{dataFormatada}</td>
                    <td style={{ padding: '10px 8px', fontWeight: 'bold' }}>{t.descricao}</td>
                    <td style={{ padding: '10px 8px', color: '#555' }}>{t.categoria || '-'}</td>
                    {tipo === 'entrada' && <td style={{ padding: '10px 8px' }}>{t.clienteNome || '-'}</td>}
                    {status === 'Paga' && <td style={{ padding: '10px 8px' }}>{t.formaPagamento || '-'}</td>}
                    <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 'bold', color: tipo === 'entrada' ? '#10b981' : '#ef4444' }}>
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(t.valor)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={tipo === 'entrada' ? (status === 'Paga' ? 5 : 4) : (status === 'Paga' ? 4 : 3)} style={{ padding: '20px 8px', textAlign: 'right', fontWeight: 'bold', fontSize: '16px', color: '#111', borderTop: '2px solid #333' }}>
                  TOTAL {status === 'Paga' ? 'PAGO/RECEBIDO' : 'EM ABERTO'}:
                </td>
                <td style={{ padding: '20px 8px', textAlign: 'right', fontWeight: 'bold', fontSize: '18px', color: '#111', borderTop: '2px solid #333' }}>
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalRelatorio)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}

        <div style={{ marginTop: '50px', textAlign: 'center', color: '#888', fontSize: '11px', borderTop: '1px solid #eee', paddingTop: '20px' }}>
          Documento auxiliar de caráter gerencial. Este relatório reflete as movimentações financeiras da empresa até a data de sua emissão.
        </div>
      </div>
    </div>
  );
};

export default PrintRelatorioFinanceiro;
