import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { Printer, ArrowLeft } from 'lucide-react';
import { fromCents } from '../../utils/financeDomain';
import { isVendaDoUsuario } from '../../utils/visibilidadeVendasDomain';
import '../OS/OsPrint.css'; // Usando os estilos de impressão

interface DescontoSnapshot {
  tipo?: 'valor' | 'percentual';
  valorInformado?: number;
  valorAplicadoCentavos?: number;
  excedeuLimite?: boolean;
  aprovacao?: {
    modo: 'senha';
    aprovadoPorId: string;
    aprovadoPorNome: string;
    aprovadoEm: string;
  };
}

interface DocumentoComDesconto {
  id: string;
  origem: 'Pedido de Venda' | 'PDV' | 'Ordem de Serviço' | 'Orçamento';
  numero: string;
  clienteNome?: string;
  data?: string;
  valorTotalCentavos: number;
  desconto: DescontoSnapshot;
}

/** Extrai a data (formato 'AAAA-MM-DD') de um documento que pode ter vindo
 * de fontes diferentes: `dataVenda`/`dataSaida` sao string; `createdAt` e'
 * Timestamp do Firestore. Documentos sem nenhuma data ficam de fora do
 * filtro por periodo (mais seguro do que assumir uma data errada). */
const extractDateInput = (data: Record<string, unknown>, ...fields: string[]): string | null => {
  for (const field of fields) {
    const value = data[field];
    if (typeof value === 'string' && value) return value;
  }
  const createdAt = data.createdAt as { toDate?: () => Date } | undefined;
  if (createdAt?.toDate) {
    return createdAt.toDate().toISOString().slice(0, 10);
  }
  return null;
};

const PrintRelatorioDescontos: React.FC = () => {
  const { search } = useLocation();
  const navigate = useNavigate();
  const { tenantId, currentUser, vendasVisiveisDeUsuarioId } = useAuth();

  const queryParams = new URLSearchParams(search);
  const inicio = queryParams.get('inicio') || '';
  const fim = queryParams.get('fim') || '';

  const [documentos, setDocumentos] = useState<DocumentoComDesconto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser || !tenantId) return;

    const fetchData = async () => {
      try {
        const [pedidosSnap, osSnap, orcamentosSnap] = await Promise.all([
          getDocs(query(collection(db, 'pedidos_venda'), where('tenantId', '==', tenantId))),
          getDocs(query(collection(db, 'ordens_de_servico'), where('tenantId', '==', tenantId))),
          getDocs(query(collection(db, 'orcamentos'), where('tenantId', '==', tenantId))),
        ]);

        const resultados: DocumentoComDesconto[] = [];

        pedidosSnap.forEach((docSnap) => {
          const data = docSnap.data();
          // Visibilidade de vendas: o desconto concedido revela o valor da
          // venda do colega, entao segue a mesma regra da tela de Vendas.
          if (vendasVisiveisDeUsuarioId && !isVendaDoUsuario(data, vendasVisiveisDeUsuarioId)) return;
          const desconto: DescontoSnapshot | undefined = data.descontoGeral;
          if (!desconto || !desconto.valorAplicadoCentavos) return;
          const dataDoc = extractDateInput(data, 'dataVenda');
          if (!dataDoc || dataDoc < inicio || dataDoc > fim) return;
          resultados.push({
            id: docSnap.id,
            // PDV grava na mesma colecao pedidos_venda, distinguido por
            // sourceOrigin (F16) -- sem essa checagem, venda de balcao
            // apareceria como "Pedido de Venda" no relatorio.
            origem: data.sourceOrigin === 'pdv' ? 'PDV' : 'Pedido de Venda',
            numero: data.numeroPedido || docSnap.id.slice(0, 6).toUpperCase(),
            clienteNome: data.clienteNome,
            data: dataDoc,
            valorTotalCentavos: Number(data.valorTotalCentavos || 0),
            desconto,
          });
        });

        osSnap.forEach((docSnap) => {
          const data = docSnap.data();
          const desconto: DescontoSnapshot | undefined = data.desconto;
          if (!desconto || !desconto.valorAplicadoCentavos) return;
          const dataDoc = extractDateInput(data, 'dataSaida', 'dataEntrada');
          if (!dataDoc || dataDoc < inicio || dataDoc > fim) return;
          resultados.push({
            id: docSnap.id,
            origem: 'Ordem de Serviço',
            numero: data.numeroOS ? `#${data.numeroOS}` : docSnap.id.slice(0, 6).toUpperCase(),
            clienteNome: data.clienteNome,
            data: dataDoc,
            valorTotalCentavos: Number(data.valorTotalCentavos || 0),
            desconto,
          });
        });

        orcamentosSnap.forEach((docSnap) => {
          const data = docSnap.data();
          const desconto: DescontoSnapshot | undefined = data.desconto;
          if (!desconto || !desconto.valorAplicadoCentavos) return;
          const dataDoc = extractDateInput(data);
          if (!dataDoc || dataDoc < inicio || dataDoc > fim) return;
          resultados.push({
            id: docSnap.id,
            origem: 'Orçamento',
            numero: data.numeroOrcamento ? `#${data.numeroOrcamento}` : docSnap.id.slice(0, 6).toUpperCase(),
            clienteNome: data.clienteNome,
            data: dataDoc,
            valorTotalCentavos: Math.round(Number(data.valorTotal || 0) * 100),
            desconto,
          });
        });

        resultados.sort((a, b) => (b.data || '').localeCompare(a.data || ''));
        setDocumentos(resultados);
      } catch (error) {
        console.error('Erro ao buscar relatório de descontos concedidos:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [currentUser, tenantId, inicio, fim, vendasVisiveisDeUsuarioId]);

  const handlePrint = () => {
    window.print();
  };

  const formatCurrency = (cents: number) => (
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(fromCents(cents))
  );

  const totalDescontoCentavos = documentos.reduce((acc, d) => acc + (d.desconto.valorAplicadoCentavos || 0), 0);
  const totalVendidoCentavos = documentos.reduce((acc, d) => acc + d.valorTotalCentavos, 0);
  const comAprovacaoPorSenha = documentos.filter((d) => d.desconto.aprovacao?.modo === 'senha');

  const totaisPorOrigem = Object.values(
    documentos.reduce((acc, d) => {
      if (!acc[d.origem]) acc[d.origem] = { origem: d.origem, quantidade: 0, descontoCentavos: 0 };
      acc[d.origem].quantidade += 1;
      acc[d.origem].descontoCentavos += d.desconto.valorAplicadoCentavos || 0;
      return acc;
    }, {} as Record<string, { origem: string; quantidade: number; descontoCentavos: number }>),
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
            Descontos Concedidos
          </h1>
          <div style={{ color: '#555', fontSize: '14px', display: 'flex', justifyContent: 'center', gap: '24px', flexWrap: 'wrap' }}>
            <span><strong>Período:</strong> {inicio.split('-').reverse().join('/')} a {fim.split('-').reverse().join('/')}</span>
            <span><strong>Vendas/OS/Orçamentos com desconto:</strong> {documentos.length}</span>
            <span><strong>Aprovados por senha:</strong> {comAprovacaoPorSenha.length}</span>
            <span><strong>Gerado em:</strong> {new Date().toLocaleDateString('pt-BR')} às {new Date().toLocaleTimeString('pt-BR')}</span>
          </div>
        </div>

        {documentos.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#888' }}>
            <p>Nenhum desconto concedido no período selecionado.</p>
          </div>
        ) : (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', marginBottom: '12px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #ddd' }}>
                  <th style={{ padding: '8px', textAlign: 'left' }}>Origem</th>
                  <th style={{ padding: '8px', textAlign: 'right' }}>Qtd.</th>
                  <th style={{ padding: '8px', textAlign: 'right' }}>Desconto Total</th>
                </tr>
              </thead>
              <tbody>
                {totaisPorOrigem.map((item) => (
                  <tr key={item.origem} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '8px', fontWeight: 'bold' }}>{item.origem}</td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>{item.quantidade}</td>
                    <td style={{ padding: '8px', textAlign: 'right', color: '#ef4444' }}>{formatCurrency(item.descontoCentavos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #ddd' }}>
                  <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 'bold', color: '#333' }}>Data</th>
                  <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 'bold', color: '#333' }}>Origem</th>
                  <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 'bold', color: '#333' }}>Nº</th>
                  <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 'bold', color: '#333' }}>Cliente</th>
                  <th style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 'bold', color: '#333' }}>Valor Total</th>
                  <th style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 'bold', color: '#333' }}>Desconto</th>
                  <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 'bold', color: '#333' }}>Aprovação</th>
                </tr>
              </thead>
              <tbody>
                {documentos.map((d) => (
                  <tr key={`${d.origem}-${d.id}`} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '10px 8px' }}>{d.data ? d.data.split('-').reverse().join('/') : '-'}</td>
                    <td style={{ padding: '10px 8px' }}>{d.origem}</td>
                    <td style={{ padding: '10px 8px' }}>{d.numero}</td>
                    <td style={{ padding: '10px 8px' }}>{d.clienteNome || '-'}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right' }}>{formatCurrency(d.valorTotalCentavos)}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 'bold', color: d.desconto.excedeuLimite ? '#ef4444' : '#555' }}>
                      {formatCurrency(d.desconto.valorAplicadoCentavos || 0)}
                    </td>
                    <td style={{ padding: '10px 8px', fontSize: '11px' }}>
                      {d.desconto.aprovacao?.modo === 'senha' ? `Senha: ${d.desconto.aprovacao.aprovadoPorNome}` : (d.desconto.excedeuLimite ? 'Acima do limite' : '-')}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} style={{ padding: '20px 8px', textAlign: 'right', fontWeight: 'bold', fontSize: '16px', color: '#111', borderTop: '2px solid #333' }}>
                    TOTAL:
                  </td>
                  <td style={{ padding: '20px 8px', textAlign: 'right', fontWeight: 'bold', fontSize: '14px', color: '#111', borderTop: '2px solid #333' }}>
                    {formatCurrency(totalVendidoCentavos)}
                  </td>
                  <td style={{ padding: '20px 8px', textAlign: 'right', fontWeight: 'bold', fontSize: '18px', color: '#ef4444', borderTop: '2px solid #333' }}>
                    {formatCurrency(totalDescontoCentavos)}
                  </td>
                  <td style={{ borderTop: '2px solid #333' }}></td>
                </tr>
              </tfoot>
            </table>
          </>
        )}

        <div style={{ marginTop: '50px', textAlign: 'center', color: '#888', fontSize: '11px', borderTop: '1px solid #eee', paddingTop: '20px' }}>
          Documento auxiliar de caráter gerencial. Considera o desconto GERAL de cada venda/OS/orçamento
          (soma dos descontos por item + desconto geral, quando houver), não cada abatimento individual.
        </div>
      </div>
    </div>
  );
};

export default PrintRelatorioDescontos;
