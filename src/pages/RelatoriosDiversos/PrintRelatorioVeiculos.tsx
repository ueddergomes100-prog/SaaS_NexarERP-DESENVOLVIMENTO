import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { Printer, ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';

interface Veiculo {
  id: string;
  placa: string;
  modelo: string;
  marca?: string;
  ano: string;
  cor: string;
  kmAtual?: number;
  clienteNome?: string;
}

const PrintRelatorioVeiculos: React.FC = () => {
  const { tenantId } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [veiculos, setVeiculos] = useState<Veiculo[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Extract search term from URL
  const queryParams = new URLSearchParams(location.search);
  const searchTerm = queryParams.get('search') || '';

  useEffect(() => {
    const fetchVeiculos = async () => {
      if (!tenantId) return;
      try {
        const q = query(
          collection(db, 'veiculos'),
          where('tenantId', '==', tenantId)
        );
        const querySnapshot = await getDocs(q);
        const data: Veiculo[] = [];
        querySnapshot.forEach((doc) => {
          data.push({ id: doc.id, ...doc.data() } as Veiculo);
        });

        // Local sort
        data.sort((a, b) => a.placa.localeCompare(b.placa));

        // Apply filter
        const filtered = searchTerm ? data.filter(v => 
          v.placa.toLowerCase().includes(searchTerm.toLowerCase()) ||
          v.modelo.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (v.clienteNome && v.clienteNome.toLowerCase().includes(searchTerm.toLowerCase()))
        ) : data;

        setVeiculos(filtered);
      } catch (error) {
        console.error("Erro ao buscar veículos:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchVeiculos();
  }, [tenantId, searchTerm]);

  useEffect(() => {
    if (!isLoading && veiculos.length > 0) {
      // Pequeno delay para garantir que o CSS e o DOM renderizaram
      setTimeout(() => {
        window.print();
      }, 500);
    }
  }, [isLoading, veiculos]);

  if (isLoading) {
    return <div style={{ padding: '40px', textAlign: 'center' }}>Preparando Relatório para Impressão...</div>;
  }

  return (
    <>
      <div className="no-print" style={{ padding: '20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button 
          onClick={() => navigate('/relatorios-diversos')} 
          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', backgroundColor: 'white', border: '1px solid #cbd5e1', borderRadius: '4px', cursor: 'pointer', fontWeight: 500 }}
        >
          <ArrowLeft size={18} />
          Voltar
        </button>
        <button 
          onClick={() => window.print()} 
          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
        >
          <Printer size={18} />
          Imprimir / Salvar PDF
        </button>
      </div>

      <div className="print-container" style={{ padding: '40px', backgroundColor: 'white', color: 'black', minHeight: '100vh', fontFamily: 'Arial, sans-serif' }}>
        <div style={{ textAlign: 'center', marginBottom: '30px', borderBottom: '2px solid #000', paddingBottom: '20px' }}>
          <h1 style={{ margin: '0 0 10px 0', fontSize: '24px', textTransform: 'uppercase' }}>Relatório de Frota e Veículos</h1>
          <p style={{ margin: 0, fontSize: '14px', color: '#555' }}>
            Gerado em {format(new Date(), 'dd/MM/yyyy às HH:mm')}
          </p>
          {searchTerm && (
            <p style={{ margin: '10px 0 0 0', fontSize: '14px', fontStyle: 'italic', backgroundColor: '#f1f5f9', padding: '4px 8px', display: 'inline-block', borderRadius: '4px' }}>
              Filtro aplicado: "{searchTerm}"
            </p>
          )}
        </div>

        {veiculos.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
            Nenhum veículo encontrado com os filtros atuais.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ backgroundColor: '#f1f5f9', borderBottom: '2px solid #cbd5e1' }}>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 'bold', width: '15%' }}>Placa</th>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 'bold', width: '25%' }}>Veículo (Marca/Modelo)</th>
                <th style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 'bold', width: '10%' }}>Ano/Cor</th>
                <th style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 'bold', width: '15%' }}>KM Atual</th>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 'bold', width: '35%' }}>Dono (Cliente)</th>
              </tr>
            </thead>
            <tbody>
              {veiculos.map((v, index) => (
                <tr key={v.id} style={{ borderBottom: '1px solid #e2e8f0', backgroundColor: index % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                  <td style={{ padding: '10px 8px', fontWeight: 'bold', textTransform: 'uppercase' }}>{v.placa}</td>
                  <td style={{ padding: '10px 8px' }}>
                    {v.marca ? `${v.marca} ` : ''}{v.modelo}
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                    {v.ano || '-'} / {v.cor || '-'}
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                    {v.kmAtual ? v.kmAtual.toLocaleString('pt-BR') : '-'}
                  </td>
                  <td style={{ padding: '10px 8px', fontWeight: 500 }}>
                    {v.clienteNome || 'Não informado'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} style={{ padding: '16px 8px', textAlign: 'right', fontWeight: 'bold', fontSize: '14px', borderTop: '2px solid #cbd5e1' }}>
                  Total de Veículos Listados: {veiculos.length}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      <style>
        {`
          @media print {
            body { background: white !important; }
            .no-print, .sidebar, .navbar { display: none !important; }
            .print-container { padding: 0 !important; width: 100% !important; margin: 0 !important; }
            @page { margin: 1cm; size: A4 portrait; }
          }
        `}
      </style>
    </>
  );
};

export default PrintRelatorioVeiculos;
