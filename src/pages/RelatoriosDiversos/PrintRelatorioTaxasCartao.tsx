import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { Printer, ArrowLeft } from 'lucide-react';
import { fromCents } from '../../utils/financeDomain';
import '../OS/OsPrint.css'; // Usando os estilos de impressão

interface CardTransaction {
  id: string;
  data?: string;
  cartao?: {
    bandeira?: string;
    valorBrutoCentavos?: number;
    valorTaxaCentavos?: number;
    valorLiquidoCentavos?: number;
  } | null;
}

interface BrandTotals {
  bandeira: string;
  transacoes: number;
  brutoCentavos: number;
  taxaCentavos: number;
  liquidoCentavos: number;
}

const PrintRelatorioTaxasCartao: React.FC = () => {
  const { search } = useLocation();
  const navigate = useNavigate();
  const { tenantId, currentUser } = useAuth();

  const queryParams = new URLSearchParams(search);
  const inicio = queryParams.get('inicio') || '';
  const fim = queryParams.get('fim') || '';

  const [transacoes, setTransacoes] = useState<CardTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser || !tenantId) return;

    const fetchData = async () => {
      try {
        const q = query(collection(db, 'transacoes'), where('tenantId', '==', tenantId));
        const snapshot = await getDocs(q);
        const results: CardTransaction[] = [];

        snapshot.forEach((doc) => {
          results.push({ id: doc.id, ...doc.data() } as CardTransaction);
        });

        const filtered = results.filter((t) => (
          Boolean(t.cartao) &&
          Boolean(t.data) &&
          (t.data as string) >= inicio &&
          (t.data as string) <= fim
        ));

        setTransacoes(filtered);
      } catch (error) {
        console.error('Erro ao buscar relatório de taxas de cartão:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [currentUser, tenantId, inicio, fim]);

  const handlePrint = () => {
    window.print();
  };

  const totaisPorBandeira: BrandTotals[] = Object.values(
    transacoes.reduce((acc, t) => {
      const bandeira = t.cartao?.bandeira?.trim() || 'Sem bandeira';
      if (!acc[bandeira]) {
        acc[bandeira] = { bandeira, transacoes: 0, brutoCentavos: 0, taxaCentavos: 0, liquidoCentavos: 0 };
      }
      acc[bandeira].transacoes += 1;
      acc[bandeira].brutoCentavos += Number(t.cartao?.valorBrutoCentavos || 0);
      acc[bandeira].taxaCentavos += Number(t.cartao?.valorTaxaCentavos || 0);
      acc[bandeira].liquidoCentavos += Number(t.cartao?.valorLiquidoCentavos || 0);
      return acc;
    }, {} as Record<string, BrandTotals>),
  ).sort((a, b) => b.taxaCentavos - a.taxaCentavos);

  const totalGeral = totaisPorBandeira.reduce((acc, item) => ({
    transacoes: acc.transacoes + item.transacoes,
    brutoCentavos: acc.brutoCentavos + item.brutoCentavos,
    taxaCentavos: acc.taxaCentavos + item.taxaCentavos,
    liquidoCentavos: acc.liquidoCentavos + item.liquidoCentavos,
  }), { transacoes: 0, brutoCentavos: 0, taxaCentavos: 0, liquidoCentavos: 0 });

  const formatCurrency = (cents: number) => (
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(fromCents(cents))
  );

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
            Taxas Pagas às Administradoras
          </h1>
          <div style={{ color: '#555', fontSize: '14px', display: 'flex', justifyContent: 'center', gap: '24px' }}>
            <span><strong>Período:</strong> {inicio.split('-').reverse().join('/')} a {fim.split('-').reverse().join('/')}</span>
            <span><strong>Total de Pagamentos em Cartão:</strong> {totalGeral.transacoes}</span>
            <span><strong>Gerado em:</strong> {new Date().toLocaleDateString('pt-BR')} às {new Date().toLocaleTimeString('pt-BR')}</span>
          </div>
        </div>

        {totaisPorBandeira.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#888' }}>
            <p>Nenhum pagamento em cartão encontrado para o período selecionado.</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #ddd' }}>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 'bold', color: '#333' }}>Bandeira</th>
                <th style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 'bold', color: '#333' }}>Transações</th>
                <th style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 'bold', color: '#333' }}>Valor Bruto</th>
                <th style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 'bold', color: '#333' }}>Taxa Média</th>
                <th style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 'bold', color: '#333' }}>Taxa Paga</th>
                <th style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 'bold', color: '#333' }}>Valor Líquido</th>
              </tr>
            </thead>
            <tbody>
              {totaisPorBandeira.map((item, index) => (
                <tr key={item.bandeira} style={{ borderBottom: '1px solid #eee', backgroundColor: index % 2 === 0 ? '#fff' : '#fafafa' }}>
                  <td style={{ padding: '10px 8px', fontWeight: 'bold' }}>{item.bandeira}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right' }}>{item.transacoes}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right' }}>{formatCurrency(item.brutoCentavos)}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', color: '#555' }}>
                    {item.brutoCentavos > 0 ? `${((item.taxaCentavos / item.brutoCentavos) * 100).toFixed(2)}%` : '-'}
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 'bold', color: '#ef4444' }}>{formatCurrency(item.taxaCentavos)}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', color: '#10b981' }}>{formatCurrency(item.liquidoCentavos)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} style={{ padding: '20px 8px', textAlign: 'right', fontWeight: 'bold', fontSize: '16px', color: '#111', borderTop: '2px solid #333' }}>
                  TOTAL:
                </td>
                <td style={{ padding: '20px 8px', textAlign: 'right', fontWeight: 'bold', fontSize: '14px', color: '#111', borderTop: '2px solid #333' }}>
                  {totalGeral.brutoCentavos > 0 ? `${((totalGeral.taxaCentavos / totalGeral.brutoCentavos) * 100).toFixed(2)}%` : '-'}
                </td>
                <td style={{ padding: '20px 8px', textAlign: 'right', fontWeight: 'bold', fontSize: '18px', color: '#ef4444', borderTop: '2px solid #333' }}>
                  {formatCurrency(totalGeral.taxaCentavos)}
                </td>
                <td style={{ padding: '20px 8px', textAlign: 'right', fontWeight: 'bold', fontSize: '16px', color: '#10b981', borderTop: '2px solid #333' }}>
                  {formatCurrency(totalGeral.liquidoCentavos)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}

        <div style={{ marginTop: '50px', textAlign: 'center', color: '#888', fontSize: '11px', borderTop: '1px solid #eee', paddingTop: '20px' }}>
          Documento auxiliar de caráter gerencial. A taxa aplicada é a que estava configurada por bandeira no momento de cada pagamento.
        </div>
      </div>
    </div>
  );
};

export default PrintRelatorioTaxasCartao;
