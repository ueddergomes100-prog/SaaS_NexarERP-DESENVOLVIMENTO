import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, doc, getDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { ArrowLeft, Printer } from 'lucide-react';
import { formatCompanyAddress, getCompanyAddressParts } from '../../utils/companyAddress';
import '../OS/OsPrint.css'; // Reusing print layout styles

interface PedidoVenda {
  id: string;
  numeroPedido: number;
  clienteId: string;
  clienteNome: string;
  usuarioResponsavelId: string;
  vendedorNome?: string;
  itens: any[];
  valorTotal: number;
  valorTotalDescontos?: number;
  formaPagamento: string;
  status: string;
  createdAt: any;
}

interface DevolucaoVenda {
  id: string;
  pedidoId: string;
  pedidoNumero: string;
  clienteId: string;
  clienteNome: string;
  usuarioResponsavelId: string;
  vendedorNome?: string;
  itens: any[];
  valorTotalDevolvido: number;
  status: string;
  createdAt: any;
}

const PrintRelatorioVendas: React.FC = () => {
  const { search } = useLocation();
  const navigate = useNavigate();
  const { tenantId, currentUser } = useAuth();

  const queryParams = new URLSearchParams(search);
  const tipo = queryParams.get('tipo') as 'geral' | 'vendedor';
  const inicio = queryParams.get('inicio') || '';
  const fim = queryParams.get('fim') || '';

  const [config, setConfig] = useState<any>(null);
  const [usuarios, setUsuarios] = useState<Record<string, string>>({});
  const [pedidos, setPedidos] = useState<PedidoVenda[]>([]);
  const [devolucoes, setDevolucoes] = useState<DevolucaoVenda[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser || !tenantId || !inicio || !fim) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        // 1. Buscar configurações da empresa
        const configSnap = await getDoc(doc(db, 'configuracoes', tenantId));
        if (configSnap.exists()) {
          setConfig(configSnap.data());
        }

        // 2. Buscar usuários
        const usersSnap = await getDocs(query(collection(db, 'usuarios'), where('tenantId', '==', tenantId)));
        const usersMap: Record<string, string> = {};
        usersSnap.forEach(d => {
          const u = d.data();
          usersMap[d.id] = u.nome || u.email || 'N/A';
        });
        setUsuarios(usersMap);

        // 3. Timestamps para consulta no Firestore
        const startTimestamp = Timestamp.fromDate(new Date(`${inicio}T00:00:00`));
        const endTimestamp = Timestamp.fromDate(new Date(`${fim}T23:59:59`));

        // 4. Buscar vendas (pedidos_venda)
        const qVendas = query(
          collection(db, 'pedidos_venda'),
          where('tenantId', '==', tenantId),
          where('createdAt', '>=', startTimestamp),
          where('createdAt', '<=', endTimestamp)
        );
        const snapVendas = await getDocs(qVendas);
        const listVendas: PedidoVenda[] = [];
        snapVendas.forEach(docSnap => {
          const data = docSnap.data() as Omit<PedidoVenda, 'id'>;
          if (data.status !== 'Cancelada') {
            listVendas.push({ id: docSnap.id, ...data } as PedidoVenda);
          }
        });

        listVendas.sort((a, b) => {
          const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date();
          const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date();
          return dateA.getTime() - dateB.getTime();
        });
        setPedidos(listVendas);

        // 5. Buscar devoluções (devolucoes_venda)
        const qDevolucoes = query(
          collection(db, 'devolucoes_venda'),
          where('tenantId', '==', tenantId),
          where('createdAt', '>=', startTimestamp),
          where('createdAt', '<=', endTimestamp),
          where('status', '==', 'concluida')
        );
        const snapDev = await getDocs(qDevolucoes);
        const listDev: DevolucaoVenda[] = [];
        snapDev.forEach(docSnap => {
          const data = docSnap.data() as Omit<DevolucaoVenda, 'id'>;
          listDev.push({ id: docSnap.id, ...data } as DevolucaoVenda);
        });

        listDev.sort((a, b) => {
          const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date();
          const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date();
          return dateA.getTime() - dateB.getTime();
        });
        setDevolucoes(listDev);

      } catch (err) {
        console.error("Erro ao carregar dados do relatório de vendas:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [currentUser, tenantId, inicio, fim]);

  // Agrupamento por Vendedor
  const sellerStats = React.useMemo(() => {
    const map: Record<string, {
      vendedorId: string;
      nome: string;
      vendasQtd: number;
      vendasTotal: number;
      devolucoesQtd: number;
      devolucoesTotal: number;
      saldoLiquido: number;
    }> = {};

    pedidos.forEach(p => {
      const vId = p.usuarioResponsavelId || 'admin';
      const vNome = usuarios[vId] || p.vendedorNome || 'Administrador';

      if (!map[vId]) {
        map[vId] = {
          vendedorId: vId,
          nome: vNome,
          vendasQtd: 0,
          vendasTotal: 0,
          devolucoesQtd: 0,
          devolucoesTotal: 0,
          saldoLiquido: 0
        };
      }
      map[vId].vendasQtd += 1;
      map[vId].vendasTotal += Number(p.valorTotal || 0);
    });

    devolucoes.forEach(d => {
      const vId = d.usuarioResponsavelId || 'admin';
      const vNome = usuarios[vId] || d.vendedorNome || 'Administrador';

      if (!map[vId]) {
        map[vId] = {
          vendedorId: vId,
          nome: vNome,
          vendasQtd: 0,
          vendasTotal: 0,
          devolucoesQtd: 0,
          devolucoesTotal: 0,
          saldoLiquido: 0
        };
      }
      map[vId].devolucoesQtd += 1;
      map[vId].devolucoesTotal += Number(d.valorTotalDevolvido || 0);
    });

    return Object.values(map).map(item => {
      const saldo = item.vendasTotal - item.devolucoesTotal;
      return {
        ...item,
        saldoLiquido: saldo
      };
    }).sort((a, b) => b.saldoLiquido - a.saldoLiquido);
  }, [pedidos, devolucoes, usuarios]);

  const totalVendasValor = pedidos.reduce((acc, curr) => acc + Number(curr.valorTotal || 0), 0);
  const totalVendasQtd = pedidos.length;

  const totalDevolucoesValor = devolucoes.reduce((acc, curr) => acc + Number(curr.valorTotalDevolvido || 0), 0);
  const totalDevolucoesQtd = devolucoes.length;

  const saldoLiquido = totalVendasValor - totalDevolucoesValor;

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return '-';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('pt-BR');
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'sans-serif' }}>Gerando relatório...</div>;
  }

  const companyAddressParts = getCompanyAddressParts(config);
  const legacyCompanyAddress = !companyAddressParts.rua && !companyAddressParts.numero && !companyAddressParts.bairro
    ? formatCompanyAddress(config)
    : '';

  return (
    <div className="print-layout-wrapper">
      <div className="print-actions no-print">
        <button className="btn-secondary" onClick={() => navigate(-1)} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ArrowLeft size={18} /> Voltar
        </button>
        <button className="btn-primary" onClick={handlePrint} style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#8b5cf6' }}>
          <Printer size={18} /> IMPRIMIR PDF
        </button>
      </div>

      <div className="a4-page">
        {/* Header */}
        <div className="a4-header">
          <div className="a4-logo">
            <h2>{config?.nomeOficina || 'Nexus Company'}</h2>
            {config?.cnpj && <p><strong>CNPJ:</strong> {config.cnpj}</p>}
            {config?.telefone && <p><strong>Telefone:</strong> {config.telefone}</p>}
            {config?.email && <p><strong>E-mail:</strong> {config.email}</p>}
            {companyAddressParts.rua && <p><strong>Rua:</strong> {companyAddressParts.rua}</p>}
            {companyAddressParts.numero && <p><strong>Número:</strong> {companyAddressParts.numero}</p>}
            {companyAddressParts.bairro && <p><strong>Bairro:</strong> {companyAddressParts.bairro}</p>}
            {legacyCompanyAddress && <p><strong>Endereço:</strong> {legacyCompanyAddress}</p>}
          </div>
          <div className="a4-os-info">
            <h1>{tipo === 'geral' ? 'RELATÓRIO DE VENDAS' : 'VENDAS POR VENDEDOR'}</h1>
            <p style={{ marginTop: '10px' }}><strong>Período:</strong> {inicio.split('-').reverse().join('/')} a {fim.split('-').reverse().join('/')}</p>
            <p><strong>Gerado em:</strong> {new Date().toLocaleDateString('pt-BR')} às {new Date().toLocaleTimeString('pt-BR')}</p>
          </div>
        </div>

        {/* Resumo de Indicadores */}
        <div className="section-title">Resumo Financeiro do Período</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '32px' }}>
          <div style={{ border: '1px solid #e5e7eb', padding: '16px', borderRadius: '6px', backgroundColor: '#f9fafb' }}>
            <span style={{ fontSize: '11px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>Faturamento Bruto</span>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#111827', marginTop: '4px' }}>{formatCurrency(totalVendasValor)}</div>
            <span style={{ fontSize: '12px', color: '#4b5563', marginTop: '2px', display: 'block' }}>{totalVendasQtd} vendas realizadas</span>
          </div>

          <div style={{ border: '1px solid #e5e7eb', padding: '16px', borderRadius: '6px', backgroundColor: '#f9fafb' }}>
            <span style={{ fontSize: '11px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>Total Devolvido</span>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#ef4444', marginTop: '4px' }}>{formatCurrency(totalDevolucoesValor)}</div>
            <span style={{ fontSize: '12px', color: '#4b5563', marginTop: '2px', display: 'block' }}>{totalDevolucoesQtd} devoluções efetuadas</span>
          </div>

          <div style={{ border: '1px solid #e5e7eb', padding: '16px', borderRadius: '6px', backgroundColor: '#f9fafb' }}>
            <span style={{ fontSize: '11px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>Faturamento Líquido</span>
            <div style={{ fontSize: '20px', fontWeight: 800, color: saldoLiquido >= 0 ? '#10b981' : '#ef4444', marginTop: '4px' }}>{formatCurrency(saldoLiquido)}</div>
            <span style={{ fontSize: '12px', color: '#4b5563', marginTop: '2px', display: 'block' }}>Saldo líquido de vendas</span>
          </div>
        </div>

        {/* Layout do Relatório Geral */}
        {tipo === 'geral' && (
          <>
            <div className="section-title">Vendas Concluídas</div>
            {pedidos.length === 0 ? (
              <p style={{ fontSize: '13px', color: '#6b7280', padding: '12px 0', marginBottom: '24px' }}>Nenhuma venda realizada neste período.</p>
            ) : (
              <table className="a4-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Pedido</th>
                    <th>Cliente</th>
                    <th>Vendedor</th>
                    <th>Forma Pgto</th>
                    <th style={{ textAlign: 'right' }}>Desconto</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {pedidos.map(p => (
                    <tr key={p.id}>
                      <td>{formatDate(p.createdAt)}</td>
                      <td style={{ fontWeight: 'bold' }}>#{p.numeroPedido}</td>
                      <td>{p.clienteNome || 'Consumidor'}</td>
                      <td>{usuarios[p.usuarioResponsavelId] || p.vendedorNome || 'Administrador'}</td>
                      <td>{p.formaPagamento}</td>
                      <td style={{ textAlign: 'right' }}>{formatCurrency(p.valorTotalDescontos || 0)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{formatCurrency(p.valorTotal)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'right', fontWeight: 'bold', fontSize: '14px', padding: '12px' }}>Total de Vendas:</td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold', fontSize: '14px', padding: '12px' }}>{formatCurrency(totalVendasValor)}</td>
                  </tr>
                </tfoot>
              </table>
            )}

            <div className="section-title" style={{ marginTop: '40px' }}>Devoluções Efetuadas</div>
            {devolucoes.length === 0 ? (
              <p style={{ fontSize: '13px', color: '#6b7280', padding: '12px 0' }}>Nenhuma devolução realizada neste período.</p>
            ) : (
              <table className="a4-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Pedido Ref.</th>
                    <th>Cliente</th>
                    <th>Vendedor</th>
                    <th style={{ textAlign: 'right' }}>Valor Devolvido</th>
                  </tr>
                </thead>
                <tbody>
                  {devolucoes.map(d => (
                    <tr key={d.id}>
                      <td>{formatDate(d.createdAt)}</td>
                      <td style={{ fontWeight: 'bold' }}>#{d.pedidoNumero}</td>
                      <td>{d.clienteNome || 'Consumidor'}</td>
                      <td>{usuarios[d.usuarioResponsavelId] || d.vendedorNome || 'Administrador'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#ef4444' }}>{formatCurrency(d.valorTotalDevolvido)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'right', fontWeight: 'bold', fontSize: '14px', padding: '12px' }}>Total Devolvido:</td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold', fontSize: '14px', padding: '12px', color: '#ef4444' }}>{formatCurrency(totalDevolucoesValor)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </>
        )}

        {/* Layout do Relatório por Vendedor */}
        {tipo === 'vendedor' && (
          <>
            <div className="section-title">Vendas e Devoluções por Vendedor</div>
            <table className="a4-table">
              <thead>
                <tr>
                  <th>Vendedor</th>
                  <th style={{ textAlign: 'center' }}>Qtd. Vendas</th>
                  <th style={{ textAlign: 'right' }}>Total Vendas</th>
                  <th style={{ textAlign: 'center' }}>Qtd. Devoluções</th>
                  <th style={{ textAlign: 'right' }}>Total Devolvido</th>
                  <th style={{ textAlign: 'right' }}>Saldo Líquido</th>
                </tr>
              </thead>
              <tbody>
                {sellerStats.map(s => (
                  <tr key={s.vendedorId}>
                    <td style={{ fontWeight: 'bold' }}>{s.nome}</td>
                    <td style={{ textAlign: 'center' }}>{s.vendasQtd}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(s.vendasTotal)}</td>
                    <td style={{ textAlign: 'center' }}>{s.devolucoesQtd}</td>
                    <td style={{ textAlign: 'right', color: s.devolucoesTotal > 0 ? '#ef4444' : 'inherit' }}>{formatCurrency(s.devolucoesTotal)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold', color: s.saldoLiquido >= 0 ? '#10b981' : '#ef4444' }}>{formatCurrency(s.saldoLiquido)}</td>
                  </tr>
                ))}
                {sellerStats.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: '#6b7280' }}>Nenhuma venda ou devolução registrada no período.</td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 'bold', backgroundColor: '#f9fafb' }}>
                  <td>TOTAL GERAL:</td>
                  <td style={{ textAlign: 'center' }}>{totalVendasQtd}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(totalVendasValor)}</td>
                  <td style={{ textAlign: 'center' }}>{totalDevolucoesQtd}</td>
                  <td style={{ textAlign: 'right', color: '#ef4444' }}>{formatCurrency(totalDevolucoesValor)}</td>
                  <td style={{ textAlign: 'right', color: saldoLiquido >= 0 ? '#10b981' : '#ef4444' }}>{formatCurrency(saldoLiquido)}</td>
                </tr>
              </tfoot>
            </table>

            {/* Detalhamento por Vendedor */}
            <div style={{ marginTop: '40px', pageBreakBefore: 'always' }}>
              <div className="section-title">Detalhamento das Operações por Vendedor</div>
              {sellerStats.map(s => {
                const sellerVendas = pedidos.filter(p => (p.usuarioResponsavelId || 'admin') === s.vendedorId);
                const sellerDevolucoes = devolucoes.filter(d => (d.usuarioResponsavelId || 'admin') === s.vendedorId);

                if (sellerVendas.length === 0 && sellerDevolucoes.length === 0) return null;

                return (
                  <div key={s.vendedorId} style={{ marginBottom: '32px', pageBreakInside: 'avoid' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: 'bold', borderBottom: '1px solid #ddd', paddingBottom: '6px', color: '#3b82f6', marginBottom: '12px' }}>
                      {s.nome}
                    </h3>
                    
                    {sellerVendas.length > 0 && (
                      <div style={{ marginBottom: '12px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#4b5563', textTransform: 'uppercase' }}>Vendas</span>
                        <table className="a4-table" style={{ marginTop: '6px', fontSize: '12px' }}>
                          <thead>
                            <tr style={{ fontSize: '11px' }}>
                              <th>Data</th>
                              <th>Pedido</th>
                              <th>Cliente</th>
                              <th>Forma Pgto</th>
                              <th style={{ textAlign: 'right' }}>Valor</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sellerVendas.map(p => (
                              <tr key={p.id}>
                                <td>{formatDate(p.createdAt)}</td>
                                <td style={{ fontWeight: 'bold' }}>#{p.numeroPedido}</td>
                                <td>{p.clienteNome || 'Consumidor'}</td>
                                <td>{p.formaPagamento}</td>
                                <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{formatCurrency(p.valorTotal)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {sellerDevolucoes.length > 0 && (
                      <div>
                        <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#ef4444', textTransform: 'uppercase' }}>Devoluções</span>
                        <table className="a4-table" style={{ marginTop: '6px', fontSize: '12px' }}>
                          <thead>
                            <tr style={{ fontSize: '11px' }}>
                              <th>Data</th>
                              <th>Pedido Ref.</th>
                              <th>Cliente</th>
                              <th style={{ textAlign: 'right' }}>Valor Devolvido</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sellerDevolucoes.map(d => (
                              <tr key={d.id}>
                                <td>{formatDate(d.createdAt)}</td>
                                <td style={{ fontWeight: 'bold' }}>#{d.pedidoNumero}</td>
                                <td>{d.clienteNome || 'Consumidor'}</td>
                                <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#ef4444' }}>{formatCurrency(d.valorTotalDevolvido)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="a4-footer">
          Documento gerencial auxiliar emitido pelo Sistema Nexus Company. A veracidade das informações apresentadas é de inteira responsabilidade da administração da empresa.
        </div>
      </div>
    </div>
  );
};

export default PrintRelatorioVendas;
