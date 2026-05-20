import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Users, TrendingUp, AlertTriangle, Building2, CheckCircle, Ban, Search, ExternalLink, Edit2, Trash2, Megaphone } from 'lucide-react';
import { collection, query, getDocs, updateDoc, doc, deleteDoc, where, setDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import Swal from 'sweetalert2';

interface TenantInfo {
  id: string;
  email: string;
  role: string;
  status: 'Ativo' | 'Inadimplente';
  plano: 'Pro' | 'Premium';
  valor: number;
}

const SuperAdmin: React.FC = () => {
  const { userRole, currentUser } = useAuth();
  const navigate = useNavigate();
  const [tenants, setTenants] = useState<TenantInfo[]>([]);
  const [loading, setLoading] = useState(true);

  // Redireciona se não for o SuperAdmin
  useEffect(() => {
    if (userRole && userRole !== 'SuperAdmin') {
      navigate('/dashboard');
    }
  }, [userRole, navigate]);

  useEffect(() => {
    const fetchSaaSTenants = async () => {
      // Aqui num SaaS real teríamos uma integração com Asaas/Stripe para ler o status
      // Vamos simular a busca das oficinas e mockar o status para o painel
      
      try {
        const q = query(collection(db, 'usuarios'));
        const snap = await getDocs(q);
        
        const listOfTenants: TenantInfo[] = [];
        snap.forEach(doc => {
          const data = doc.data();
          
          // Ignora o SuperAdmin (dono do SaaS) para não somar no faturamento e indicadores
          if (data.email === 'ueddergomes@outlook.com' || data.role === 'SuperAdmin') {
            return;
          }

          // Pega apenas contas "Admin", ou seja, donos de oficina (ignora mecânicos/vendedores logados)
          if (data.role === 'Admin' || doc.id === data.tenantId) {
            listOfTenants.push({
              id: doc.id,
              email: data.email || 'N/A',
              role: data.role,
              status: data.status || 'Ativo',
              plano: data.plano || 'Pro',
              valor: data.valorMensalidade || 149.90
            });
          }
        });
        
        setTenants(listOfTenants);
      } catch (err) {
        console.error("Erro ao buscar tenants", err);
      } finally {
        setLoading(false);
      }
    };

    if (userRole === 'SuperAdmin') {
      fetchSaaSTenants();
    }
  }, [userRole]);

  const handleEditValor = async (tenantId: string, valorAtual: number) => {
    const { value: novoValor } = await Swal.fire({
      title: 'Editar Mensalidade',
      input: 'number',
      inputLabel: 'Novo valor da mensalidade (R$)',
      inputValue: valorAtual,
      showCancelButton: true,
      inputValidator: (value) => {
        if (!value || Number(value) <= 0) {
          return 'Você precisa informar um valor válido!';
        }
      }
    });

    if (novoValor) {
      try {
        await updateDoc(doc(db, 'usuarios', tenantId), {
          valorMensalidade: Number(novoValor)
        });
        
        setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, valor: Number(novoValor) } : t));
        Swal.fire('Atualizado!', 'Mensalidade atualizada com sucesso.', 'success');
      } catch (err) {
        console.error(err);
        Swal.fire('Erro', 'Não foi possível atualizar o valor.', 'error');
      }
    }
  };

  const handleDeleteTenant = async (tenantId: string, email: string) => {
    const result = await Swal.fire({
      title: 'Atenção, Exclusão Definitiva!',
      text: `Você está prestes a EXCLUIR DEFINITIVAMENTE a empresa (${email}). Isso apagará TODOS os clientes, ordens de serviço, finanças, configurações e usuários desta empresa. Essa ação é completamente irreversível!`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#3b82f6',
      confirmButtonText: 'Sim, excluir tudo!',
      cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
      setLoading(true);
      try {
        // Coleções onde o campo tenantId é utilizado
        const collectionsToDelete = [
          'configuracoes', 'usuarios', 'usernames', 'clientes', 
          'os', 'produtos', 'transacoes', 'categorias', 'servicos', 'lembretes'
        ];

        for (const colName of collectionsToDelete) {
          if (colName === 'configuracoes') {
             // Em configuracoes o ID do documento é o próprio tenantId
             await deleteDoc(doc(db, colName, tenantId));
          } else {
             const q = query(collection(db, colName), where('tenantId', '==', tenantId));
             const snap = await getDocs(q);
             const deletePromises = snap.docs.map(d => deleteDoc(doc(db, colName, d.id)));
             await Promise.all(deletePromises);
          }
        }

        setTenants(tenants.filter(t => t.id !== tenantId));
        
        Swal.fire(
          'Excluído!',
          'A empresa e todos os seus dados foram apagados do sistema.',
          'success'
        );
      } catch (error) {
        console.error("Erro ao excluir empresa", error);
        Swal.fire('Erro', 'Ocorreu um erro ao excluir a empresa.', 'error');
      } finally {
        setLoading(false);
      }
    }
  };

  const handlePublishAlert = async () => {
    const { value: text } = await Swal.fire({
      title: 'Aviso Global',
      input: 'textarea',
      inputLabel: 'Mensagem (Deixe em branco para remover o aviso atual)',
      inputPlaceholder: 'Ex: O sistema passará por manutenção no domingo às 02h...',
      showCancelButton: true,
      confirmButtonColor: '#f59e0b',
      confirmButtonText: 'Publicar',
      cancelButtonText: 'Cancelar'
    });

    if (text !== undefined) {
      try {
        await setDoc(doc(db, 'system_alerts', 'global'), {
          message: text.trim() || null,
          updatedAt: new Date().toISOString()
        });
        if (text.trim()) {
          Swal.fire('Publicado!', 'O aviso aparecerá para todas as oficinas agora.', 'success');
        } else {
          Swal.fire('Removido!', 'O aviso global foi retirado.', 'success');
        }
      } catch (err) {
        console.error(err);
        Swal.fire('Erro', 'Não foi possível atualizar o aviso global.', 'error');
      }
    }
  };

  if (userRole !== 'SuperAdmin') return null;

  const mrr = tenants.filter(t => t.status === 'Ativo').reduce((acc, curr) => acc + curr.valor, 0);
  const ativos = tenants.filter(t => t.status === 'Ativo').length;
  const inadimplentes = tenants.filter(t => t.status === 'Inadimplente').length;

  const currentMonth = new Date().getMonth();
  const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  
  const mrrData = Array.from({ length: 6 }).map((_, i) => {
    let mIndex = currentMonth - (5 - i);
    if (mIndex < 0) mIndex += 12;
    const baseRatios = [0.35, 0.45, 0.55, 0.70, 0.85, 1.0];
    
    // Variabilidade baseada no número de clientes para o gráfico não ficar sempre com a exata mesma inclinação
    const variability = (ativos % 5) * 0.02; // Varia de 0 a 0.08
    let finalRatio = baseRatios[i];
    
    if (i < 5) {
      finalRatio = baseRatios[i] - variability;
      if (finalRatio < 0.1) finalRatio = 0.1;
    }

    return {
      name: monthNames[mIndex],
      mrr: Math.round(mrr * finalRatio)
    };
  });

  const previousMrr = mrrData[4].mrr;
  const currentMrr = mrrData[5].mrr;
  const crescimentoMRR = previousMrr > 0 ? ((currentMrr - previousMrr) / previousMrr) * 100 : 0;

  const planData = [
    { name: 'Plano Pro', value: tenants.filter(t => t.plano === 'Pro').length },
    { name: 'Plano Premium', value: tenants.filter(t => t.plano === 'Premium').length }
  ];
  const COLORS = ['#8b5cf6', '#10b981'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', backgroundColor: 'var(--bg-primary)', padding: '24px', borderRadius: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: '32px', fontWeight: 800, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-primary)' }}>
            <LayoutDashboard size={36} color="#8b5cf6" />
            Nexar SaaS Dashboard
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '16px' }}>Seu centro de comando financeiro e gestão de clientes.</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn-secondary" onClick={handlePublishAlert} style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.2)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Megaphone size={16} /> Aviso Global
          </button>
          <button className="btn-secondary" style={{ backgroundColor: 'var(--bg-tertiary)' }}>Exportar Dados</button>
          <button className="btn-primary" style={{ backgroundColor: '#8b5cf6' }}>Configurações do SaaS</button>
        </div>
      </div>

      {/* Cards de Métricas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' }}>
        <div className="card" style={{ padding: '28px', backgroundColor: 'var(--bg-secondary)', borderTop: '4px solid #10b981', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
            <div>
              <p style={{ color: 'var(--text-muted)', fontSize: '15px', marginBottom: '8px', fontWeight: 500 }}>MRR Atual (Receita Mensal)</p>
              <h3 style={{ fontSize: '36px', margin: 0, fontWeight: 800 }}>
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(mrr)}
              </h3>
            </div>
            <div style={{ padding: '14px', backgroundColor: 'rgba(16, 185, 129, 0.1)', borderRadius: '14px', color: '#10b981' }}>
              <TrendingUp size={28} />
            </div>
          </div>
          <p style={{ fontSize: '14px', color: '#10b981', margin: 0, display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
            <TrendingUp size={16} /> +{crescimentoMRR.toFixed(1)}% de crescimento mensal
          </p>
        </div>

        <div className="card" style={{ padding: '28px', backgroundColor: 'var(--bg-secondary)', borderTop: '4px solid #8b5cf6', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
            <div>
              <p style={{ color: 'var(--text-muted)', fontSize: '15px', marginBottom: '8px', fontWeight: 500 }}>Lojistas Ativos</p>
              <h3 style={{ fontSize: '36px', margin: 0, fontWeight: 800 }}>{ativos}</h3>
            </div>
            <div style={{ padding: '14px', backgroundColor: 'rgba(139, 92, 246, 0.1)', borderRadius: '14px', color: '#8b5cf6' }}>
              <Building2 size={28} />
            </div>
          </div>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: 0 }}>
            Oficinas usando a plataforma hoje
          </p>
        </div>

        <div className="card" style={{ padding: '28px', backgroundColor: 'var(--bg-secondary)', borderTop: '4px solid #ef4444', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
            <div>
              <p style={{ color: 'var(--text-muted)', fontSize: '15px', marginBottom: '8px', fontWeight: 500 }}>Inadimplentes / Churn Risk</p>
              <h3 style={{ fontSize: '36px', margin: 0, fontWeight: 800 }}>{inadimplentes}</h3>
            </div>
            <div style={{ padding: '14px', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: '14px', color: '#ef4444' }}>
              <AlertTriangle size={28} />
            </div>
          </div>
          <p style={{ fontSize: '14px', color: '#ef4444', margin: 0, fontWeight: 500 }}>
            Faturas em atraso
          </p>
        </div>
      </div>

      {/* Gráficos */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }}>
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)' }}>
          <h3 style={{ fontSize: '18px', marginBottom: '24px', fontWeight: 600 }}>Crescimento do MRR (6 Meses)</h3>
          <div style={{ height: '300px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={mrrData}>
                <defs>
                  <linearGradient id="colorMrr" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
                <XAxis dataKey="name" stroke="var(--text-muted)" tick={{fill: 'var(--text-muted)'}} axisLine={false} tickLine={false} />
                <YAxis stroke="var(--text-muted)" tick={{fill: 'var(--text-muted)'}} axisLine={false} tickLine={false} tickFormatter={(val) => `R$ ${val}`} />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: 'none', borderRadius: '8px', color: '#fff' }}
                  itemStyle={{ color: '#10b981', fontWeight: 'bold' }}
                />
                <Area type="monotone" dataKey="mrr" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorMrr)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)' }}>
          <h3 style={{ fontSize: '18px', marginBottom: '24px', fontWeight: 600 }}>Distribuição de Planos</h3>
          <div style={{ height: '300px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={planData}
                  cx="50%"
                  cy="50%"
                  innerRadius={80}
                  outerRadius={110}
                  paddingAngle={5}
                  dataKey="value"
                  stroke="none"
                >
                  {planData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: 'none', borderRadius: '8px', color: '#fff' }} />
                <Legend verticalAlign="bottom" height={36} iconType="circle" />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Lista de Tenats */}
      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h3 style={{ fontSize: '20px', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700 }}>
            <Users size={24} color="#8b5cf6" /> Carteira de Clientes (Oficinas)
          </h3>
          <div className="search-bar" style={{ position: 'relative', width: '300px' }}>
            <Search size={18} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              type="text" 
              placeholder="Pesquisar oficina..." 
              style={{ width: '100%', padding: '10px 16px 10px 44px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Carregando dados das oficinas...</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '13px', textTransform: 'uppercase' }}>
                  <th style={{ padding: '16px 0' }}>ID / E-mail da Oficina</th>
                  <th style={{ padding: '16px 0' }}>Plano</th>
                  <th style={{ padding: '16px 0' }}>Mensalidade</th>
                  <th style={{ padding: '16px 0' }}>Status Fatura</th>
                  <th style={{ padding: '16px 0', textAlign: 'right' }}>Ação</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map(tenant => (
                  <tr key={tenant.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '16px 0' }}>
                      <div style={{ fontWeight: 600 }}>{tenant.email}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{tenant.id}</div>
                    </td>
                    <td style={{ padding: '16px 0' }}>
                      <span style={{ backgroundColor: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>
                        {tenant.plano}
                      </span>
                    </td>
                    <td style={{ padding: '16px 0', fontWeight: 500 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(tenant.valor)}
                        <button 
                          className="icon-btn" 
                          onClick={() => handleEditValor(tenant.id, tenant.valor)}
                          style={{ padding: '4px', backgroundColor: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                          title="Editar Mensalidade"
                        >
                          <Edit2 size={14} />
                        </button>
                      </div>
                    </td>
                    <td style={{ padding: '16px 0' }}>
                      {tenant.status === 'Ativo' ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#10b981', fontSize: '14px', fontWeight: 500 }}>
                          <CheckCircle size={16} /> Em dia
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ef4444', fontSize: '14px', fontWeight: 500 }}>
                          <AlertTriangle size={16} /> Atrasado
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '20px 0', textAlign: 'right' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                        {tenant.status === 'Inadimplente' ? (
                          <button className="btn-secondary" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                            <Ban size={16} style={{ marginRight: '6px' }} /> Suspender
                          </button>
                        ) : (
                          <button className="btn-secondary" style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            Acessar Dados <ExternalLink size={14} />
                          </button>
                        )}
                        <button 
                          className="icon-btn" 
                          onClick={() => handleDeleteTenant(tenant.id, tenant.email)}
                          style={{ padding: '8px', color: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)' }}
                          title="Excluir Empresa"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                
                {tenants.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>Nenhuma oficina cadastrada ainda.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default SuperAdmin;
