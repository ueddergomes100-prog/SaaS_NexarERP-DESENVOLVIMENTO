import React, { useState, useEffect } from 'react';
import { DollarSign, Download, Search, Filter, Loader2, User } from 'lucide-react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { getServiceTotal } from '../../utils/osServicePricing';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
};

interface ComissaoMecanico {
  mecanicoId: string;
  mecanicoNome: string;
  osFinalizadas: number;
  vendasFinalizadas: number;
  totalMaoDeObra: number;
  totalPecas: number;
  totalVendasDiretas: number;
  totalDevolucoes: number;
  percentualServicos: number;
  percentualPecas: number;
  valorComissaoServicos: number;
  valorComissaoPecas: number;
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
        // 1. Fetch mechanics (todos os usuários para exibir no gráfico e tabela)
        const qM = query(collection(db, 'usuarios'), where('tenantId', '==', tenantId));
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
            mecanicoNome: mecData.nome || 'Sem Nome',
            osFinalizadas: 0,
            vendasFinalizadas: 0,
            totalMaoDeObra: 0,
            totalPecas: 0,
            totalVendasDiretas: 0,
            totalDevolucoes: 0,
            percentualServicos: Number(mecData.comissaoPercentualServicos) || 0,
            percentualPecas: Number(mecData.comissaoPercentualPecas) || 0,
            valorComissaoServicos: 0,
            valorComissaoPecas: 0,
            valorComissao: 0
          });
        });

        snapOS.forEach(doc => {
          const os = doc.data();
          if (os.mecanicoId) {
            let atual = agregacao.get(os.mecanicoId);
            
            // Se o mecânico foi excluído, mas ainda tem OS vinculada, criamos uma entrada temporária
            if (!atual) {
              atual = {
                mecanicoId: os.mecanicoId,
                mecanicoNome: `[Excluído] Func. Antigo`,
                osFinalizadas: 0,
                vendasFinalizadas: 0,
                totalMaoDeObra: 0,
                totalPecas: 0,
                totalVendasDiretas: 0,
                totalDevolucoes: 0,
                percentualServicos: 0,
                percentualPecas: 0,
                valorComissaoServicos: 0,
                valorComissaoPecas: 0,
                valorComissao: 0
              };
            }

            // Calculate total services value
            const totalServicos = (os.servicos || []).reduce((acc: number, s: any) => {
              return acc + getServiceTotal(s);
            }, 0);
            
            const totalPecas = (os.pecas || []).reduce((acc: number, p: any) => {
              const preco = Number(p.preco) || Number(p.precoVenda) || Number(p.precoUnitario) || 0;
              const qtd = Number(p.quantidade) || 1;
              return acc + (preco * qtd);
            }, 0);
            
            atual.osFinalizadas += 1;
            atual.totalMaoDeObra += totalServicos;
            atual.totalPecas += totalPecas;
            
            agregacao.set(os.mecanicoId, atual);
          }
        });

        // 3. Fetch Vendas Diretas (pedidos_venda)
        const qVendas = query(collection(db, 'pedidos_venda'), where('tenantId', '==', tenantId), where('status', 'in', ['Concluída', 'Faturada', 'Finalizada']));
        const snapVendas = await getDocs(qVendas);
        snapVendas.forEach(doc => {
          const v = doc.data();
          if (v.usuarioResponsavelId) {
            let atual = agregacao.get(v.usuarioResponsavelId);
            if (!atual) return; // Ignorar vendas de usuários não mapeados para comissão
            
            const totalVenda = (v.itens || []).reduce((acc: number, item: any) => {
              // Já calculamos descontos no subtotal, então preferimos usar subtotal, ou recalcular
              return acc + (Number(item.subtotal) || ((Number(item.precoUnitario) * Number(item.quantidade)) - Number(item.desconto || 0)));
            }, 0);
            
            atual.vendasFinalizadas += 1;
            atual.totalVendasDiretas += totalVenda;
            atual.totalPecas += totalVenda; // Vendas diretas contam como 'Peças' para fins de comissão
            
            agregacao.set(v.usuarioResponsavelId, atual);
          }
        });

        // 4. Fetch Devoluções e descontar
        const qDev = query(collection(db, 'devolucoes_venda'), where('tenantId', '==', tenantId), where('status', '==', 'concluida'));
        const snapDev = await getDocs(qDev);
        snapDev.forEach(doc => {
          const d = doc.data();
          if (d.usuarioResponsavelId) {
            let atual = agregacao.get(d.usuarioResponsavelId);
            if (!atual) return;
            
            const valorDevolvido = Number(d.valorTotalDevolvido) || 0;
            atual.totalDevolucoes += valorDevolvido;
            atual.totalPecas -= valorDevolvido; // Abate do total de comissionamento de vendas/peças
            
            agregacao.set(d.usuarioResponsavelId, atual);
          }
        });

        // 5. Calculate Final Commissions
        agregacao.forEach(atual => {
          atual.valorComissaoServicos = atual.totalMaoDeObra * (atual.percentualServicos / 100);
          // Previne comissão negativa caso devoluções superem vendas no mês (ou define regras)
          const basePecas = Math.max(0, atual.totalPecas); 
          atual.valorComissaoPecas = basePecas * (atual.percentualPecas / 100);
          atual.valorComissao = atual.valorComissaoServicos + atual.valorComissaoPecas;
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

  const filtrados = comissoes.filter(c => (c.mecanicoNome || 'Sem Nome').toLowerCase().includes((searchTerm || '').toLowerCase()));
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
        <button className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}>
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
          <p style={{ fontSize: '28px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            {filtrados.filter(c => c.osFinalizadas > 0).length} / {filtrados.length}
          </p>
        </div>
      </div>

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '16px' }}>Comissões por Funcionário</h3>
        <div style={{ height: '300px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={filtrados} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
              <XAxis dataKey="mecanicoNome" stroke="#888" tick={{ fill: '#888' }} />
              <YAxis stroke="#888" tick={{ fill: '#888' }} tickFormatter={(value) => `R$ ${value}`} width={80} />
              <Tooltip 
                cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', color: 'var(--text-primary)', borderRadius: '8px' }}
                formatter={(value) => [formatCurrency(Number(value || 0)), 'Comissão']}
              />
              <Bar dataKey="valorComissao" radius={[4, 4, 0, 0]}>
                {filtrados.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.valorComissao > 0 ? '#10b981' : '#4b5563'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
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
              style={{ width: '100%', padding: '12px 16px 12px 48px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
            />
          </div>
          <button className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 16px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}>
            <Filter size={20} /> Fechamento do Mês
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '13px', textTransform: 'uppercase' }}>
                <th style={{ padding: '16px' }}>Mecânico / Vendedor</th>
                <th style={{ padding: '16px', textAlign: 'center' }}>Qtd. OS / Vendas</th>
                <th style={{ padding: '16px' }}>Base Serviço (OS)</th>
                <th style={{ padding: '16px' }}>Base Peças/Vendas</th>
                <th style={{ padding: '16px', textAlign: 'center' }}>% Serv / % Peça</th>
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
                    <td style={{ padding: '16px', textAlign: 'center' }}>
                      <span title="OS Finalizadas" style={{ color: 'var(--text-muted)' }}>{c.osFinalizadas} OS</span><br/>
                      <span title="Vendas Diretas" style={{ fontSize: '12px', color: '#8b5cf6' }}>{c.vendasFinalizadas} Vendas</span>
                    </td>
                    <td style={{ padding: '16px', color: 'var(--text-secondary)' }}>
                      {formatCurrency(c.totalMaoDeObra)}<br/>
                      <span style={{fontSize: '11px', color: '#10b981'}}>+ {formatCurrency(c.valorComissaoServicos)}</span>
                    </td>
                    <td style={{ padding: '16px', color: 'var(--text-secondary)' }}>
                      {formatCurrency(c.totalPecas)}
                      {c.totalDevolucoes > 0 && (
                        <span style={{fontSize: '10px', color: '#ef4444', marginLeft: '4px'}} title={`Inclui -${formatCurrency(c.totalDevolucoes)} de devoluções`}>
                          (Abatido: {formatCurrency(c.totalDevolucoes)})
                        </span>
                      )}
                      <br/>
                      <span style={{fontSize: '11px', color: '#10b981'}}>+ {formatCurrency(c.valorComissaoPecas)}</span>
                    </td>
                    <td style={{ padding: '16px', textAlign: 'center' }}>
                      <span style={{ backgroundColor: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6', padding: '4px 8px', borderRadius: '4px', fontWeight: 600, marginRight: '4px' }}>
                        {c.percentualServicos}%
                      </span>
                      <span style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', padding: '4px 8px', borderRadius: '4px', fontWeight: 600 }}>
                        {c.percentualPecas}%
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
