import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { Printer, ArrowLeft } from 'lucide-react';
import { isRevenueReversal, transactionNetAmount } from '../../utils/financeDomain';
import '../OS/OsPrint.css'; // Usando os estilos de impressão

/**
 * Ao cancelar uma OS/venda o sistema grava a saida compensatoria com id
 * `estorno_cancelamento_{idDaTransacaoOriginal}` (ver OSForm.tsx e
 * PedidoVendaForm.tsx). Isso da ligacao EXATA de volta ao recebimento que
 * foi estornado, sem depender de casar por valor/data.
 */
const ESTORNO_ID_PREFIX = 'estorno_cancelamento_';
const originalTransactionIdFromReversal = (reversalId: string): string | null => (
  reversalId.startsWith(ESTORNO_ID_PREFIX) ? reversalId.slice(ESTORNO_ID_PREFIX.length) : null
);

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
  const [estornadosIds, setEstornadosIds] = useState<Set<string>>(new Set());
  const [outrosEstornos, setOutrosEstornos] = useState(0);
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

        // Marca no relatorio de RECEBIMENTOS quais entradas foram estornadas
        // depois (OS/venda cancelada, devolucao). O estorno e' uma SAIDA,
        // entao nunca apareceria neste relatorio, que filtra tipo='entrada'
        // -- sem isso o total soma dinheiro que voltou pro cliente.
        if (tipo === 'entrada' && status === 'Paga') {
          const estornoSnap = await getDocs(query(
            collection(db, 'transacoes'),
            where('tenantId', '==', tenantId),
            where('tipo', '==', 'saida'),
            where('status', '==', 'Paga'),
          ));

          const listadosPorId = new Map(filteredResults.map((t) => [t.id, t]));
          const idsEstornados = new Set<string>();
          let naoCasados = 0;

          estornoSnap.forEach((docSnap) => {
            const estorno = { id: docSnap.id, ...docSnap.data() } as any;
            if (!isRevenueReversal(estorno)) return;

            const dataEstorno = estorno.dataPagamento || estorno.data || '';
            if (!dataEstorno || dataEstorno < inicio || dataEstorno > fim) return;

            const originalId = originalTransactionIdFromReversal(estorno.id);
            if (originalId && listadosPorId.has(originalId)) {
              idsEstornados.add(originalId);
            } else {
              // Devolucao (que aponta pro pedido, nao pra uma parcela) ou
              // estorno de recebimento fora do periodo do relatorio: nao da
              // pra marcar uma linha, entao entra como abatimento no rodape.
              naoCasados += transactionNetAmount(estorno);
            }
          });

          setEstornadosIds(idsEstornados);
          setOutrosEstornos(naoCasados);
        }
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

  // Linhas estornadas continuam VISIVEIS (marcadas), mas fora do total: o
  // relatorio e' de auditoria, entao esconder o lancamento apagaria o
  // rastro -- somar dinheiro que voltou pro cliente e' que estaria errado.
  const totalBruto = transacoes.reduce((acc, curr) => acc + transactionNetAmount(curr), 0);
  const totalEstornadoListado = transacoes
    .filter((t) => estornadosIds.has(t.id))
    .reduce((acc, curr) => acc + transactionNetAmount(curr), 0);
  const totalEstornos = totalEstornadoListado + outrosEstornos;
  const totalRelatorio = totalBruto - totalEstornos;

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
                <th style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 'bold', color: '#333' }}>{tipo === 'entrada' ? 'Valor Líquido' : 'Valor'}</th>
              </tr>
            </thead>
            <tbody>
              {transacoes.map((t, index) => {
                const dataExibicao = status === 'Paga' ? (t.dataPagamento || t.data || '') : (t.data || '');
                const dataFormatada = dataExibicao ? dataExibicao.split('-').reverse().join('/') : '-';
                const estornado = estornadosIds.has(t.id);

                return (
                  <tr key={t.id} style={{ borderBottom: '1px solid #eee', backgroundColor: index % 2 === 0 ? '#fff' : '#fafafa', color: estornado ? '#999' : 'inherit' }}>
                    <td style={{ padding: '10px 8px' }}>{dataFormatada}</td>
                    <td style={{ padding: '10px 8px', fontWeight: 'bold' }}>
                      <span style={{ textDecoration: estornado ? 'line-through' : 'none' }}>{t.descricao}</span>
                      {estornado && (
                        <span style={{ marginLeft: '8px', fontSize: '10px', fontWeight: 'bold', color: '#b45309', border: '1px solid #b45309', borderRadius: '3px', padding: '1px 5px', whiteSpace: 'nowrap' }}>
                          ESTORNADO
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '10px 8px', color: estornado ? '#999' : '#555' }}>{t.categoria || '-'}</td>
                    {tipo === 'entrada' && <td style={{ padding: '10px 8px' }}>{t.clienteNome || '-'}</td>}
                    {status === 'Paga' && <td style={{ padding: '10px 8px' }}>{t.formaPagamento || '-'}</td>}
                    <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 'bold', textDecoration: estornado ? 'line-through' : 'none', color: estornado ? '#999' : (tipo === 'entrada' ? '#10b981' : '#ef4444') }}>
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(transactionNetAmount(t))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              {totalEstornos > 0 && (
                <>
                  <tr>
                    <td colSpan={tipo === 'entrada' ? (status === 'Paga' ? 5 : 4) : (status === 'Paga' ? 4 : 3)} style={{ padding: '12px 8px', textAlign: 'right', color: '#555', borderTop: '2px solid #333' }}>
                      Subtotal listado:
                    </td>
                    <td style={{ padding: '12px 8px', textAlign: 'right', color: '#555', borderTop: '2px solid #333' }}>
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalBruto)}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={tipo === 'entrada' ? (status === 'Paga' ? 5 : 4) : (status === 'Paga' ? 4 : 3)} style={{ padding: '4px 8px', textAlign: 'right', color: '#b45309' }}>
                      (-) Estornado (cancelamentos e devoluções):
                    </td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', color: '#b45309' }}>
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalEstornos)}
                    </td>
                  </tr>
                </>
              )}
              <tr>
                <td colSpan={tipo === 'entrada' ? (status === 'Paga' ? 5 : 4) : (status === 'Paga' ? 4 : 3)} style={{ padding: '20px 8px', textAlign: 'right', fontWeight: 'bold', fontSize: '16px', color: '#111', borderTop: totalEstornos > 0 ? '1px solid #999' : '2px solid #333' }}>
                  TOTAL {status === 'Paga' ? 'PAGO/RECEBIDO' : 'EM ABERTO'}:
                </td>
                <td style={{ padding: '20px 8px', textAlign: 'right', fontWeight: 'bold', fontSize: '18px', color: '#111', borderTop: totalEstornos > 0 ? '1px solid #999' : '2px solid #333' }}>
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
