import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Users, TrendingUp, AlertTriangle, Building2, CheckCircle, Ban, Search, ExternalLink, Edit2, Trash2, Megaphone, Blocks, Wallet } from 'lucide-react';
import { collection, query, getDocs, updateDoc, doc, deleteDoc, where, setDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, AreaChart, Area } from 'recharts';
import Swal from 'sweetalert2';
import { isPlatformAdminRole } from '../../utils/roles';
import { moduleLabelMap } from '../../utils/moduleCatalog';

interface TenantInfo {
  id: string;
  email: string;
  role: string;
  status: 'Ativo' | 'Inadimplente';
  plano: 'Pro' | 'Premium';
  valor: number;
  nomeOficina: string;
  modulosBloqueados?: string[];
  limiteUsuarios?: number;
  createdAt?: any;
}

const toDate = (value?: any): Date | null => {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  if (value?.seconds) return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const normalizeDeleteConfirmation = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

const SuperAdmin: React.FC = () => {
  const { userRole } = useAuth();
  const navigate = useNavigate();
  const [tenants, setTenants] = useState<TenantInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const filteredTenants = tenants.filter(t => 
    (t.nomeOficina || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
    (t.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Redireciona se não for o SuperAdmin
  useEffect(() => {
    if (userRole && !isPlatformAdminRole(userRole)) {
      navigate('/dashboard');
    }
  }, [userRole, navigate]);

  useEffect(() => {
    const fetchSaaSTenants = async () => {
      // Aqui num SaaS real teríamos uma integração com Asaas/Stripe para ler o status
      // Vamos simular a busca das empresas e mockar o status para o painel
      
      try {
        const q = query(collection(db, 'usuarios'));
        const snap = await getDocs(q);
        
        const listOfTenants: TenantInfo[] = [];
        snap.forEach(doc => {
          const data = doc.data();
          
          // Ignora contas SuperAdmin para não somar no faturamento e indicadores
          if (data.role === 'NexarAdmin' || data.role === 'SuperAdmin') {
            return;
          }

          // Pega apenas contas "Admin", ou seja, donos de empresa (ignora funcionários/vendedores logados)
          if (data.role === 'Master' || data.role === 'Admin' || doc.id === data.tenantId) {
            listOfTenants.push({
              id: doc.id,
              email: data.email || 'N/A',
              role: data.role,
              status: data.status || 'Ativo',
              plano: data.plano || 'Pro',
              valor: data.valorMensalidade || 149.90,
              nomeOficina: data.nomeOficina || 'Sem Nome',
              modulosBloqueados: data.modulosBloqueados || [],
              limiteUsuarios: data.limiteUsuarios !== undefined ? data.limiteUsuarios : 3,
              createdAt: data.createdAt
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

    if (isPlatformAdminRole(userRole)) {
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

  const handleEditNome = async (tenantId: string, nomeAtual: string) => {
    const { value: novoNome } = await Swal.fire({
      title: 'Editar Nome da Empresa',
      input: 'text',
      inputLabel: 'Novo nome da empresa',
      inputValue: nomeAtual,
      showCancelButton: true,
      inputValidator: (value) => {
        if (!value || !value.trim()) {
          return 'Você precisa informar um nome válido!';
        }
      }
    });

    if (novoNome) {
      setLoading(true);
      try {
        await updateDoc(doc(db, 'usuarios', tenantId), {
          nomeOficina: novoNome.trim()
        });
        
        try {
          await updateDoc(doc(db, 'configuracoes', tenantId), {
            nomeOficina: novoNome.trim()
          });
        } catch (err) {
          console.warn("Erro ao atualizar configuracoes da empresa, tentando setDoc com merge...", err);
          await setDoc(doc(db, 'configuracoes', tenantId), {
            nomeOficina: novoNome.trim()
          }, { merge: true });
        }

        setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, nomeOficina: novoNome.trim() } : t));
        Swal.fire('Atualizado!', 'Nome da empresa atualizado com sucesso.', 'success');
      } catch (err) {
        console.error("Erro ao atualizar nome da empresa", err);
        Swal.fire('Erro', 'Não foi possível atualizar o nome da empresa.', 'error');
      } finally {
        setLoading(false);
      }
    }
  };

  const handleDeleteTenant = async (tenant: TenantInfo) => {
    const tenantName = tenant.nomeOficina || 'Sem Nome';
    const result = await Swal.fire({
      title: 'Atenção, Exclusão Definitiva!',
      text: `Você está prestes a EXCLUIR DEFINITIVAMENTE a empresa "${tenantName}" (${tenant.email}). Isso apagará TODOS os clientes, ordens de serviço, finanças, configurações e usuários desta empresa. Essa ação é completamente irreversível!`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#3b82f6',
      confirmButtonText: 'Sim, excluir tudo!',
      cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
      const expectedName = normalizeDeleteConfirmation(tenantName);
      const confirmation = await Swal.fire({
        title: 'Confirme o nome da empresa',
        input: 'text',
        inputLabel: `Digite o nome da empresa para confirmar: ${tenantName}`,
        inputPlaceholder: tenantName,
        icon: 'error',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#3b82f6',
        confirmButtonText: 'Excluir definitivamente',
        cancelButtonText: 'Cancelar',
        inputAttributes: {
          autocomplete: 'off',
          autocapitalize: 'off',
          spellcheck: 'false'
        },
        inputValidator: (value) => {
          if (!value || !value.trim()) {
            return 'Digite o nome da empresa para continuar.';
          }

          if (normalizeDeleteConfirmation(value) !== expectedName) {
            return 'O nome digitado não confere com a empresa selecionada.';
          }
        }
      });

      if (!confirmation.isConfirmed) {
        return;
      }

      setLoading(true);
      try {
        // Coleções onde o campo tenantId é utilizado
        const collectionsToDelete = [
          'configuracoes', 'usuarios', 'usernames', 'clientes', 
          'ordens_de_servico', 'produtos', 'transacoes', 'categorias', 'servicos', 'lembretes'
        ];

        for (const colName of collectionsToDelete) {
          if (colName === 'configuracoes') {
             // Em configuracoes o ID do documento é o próprio tenantId
             await deleteDoc(doc(db, colName, tenant.id));
          } else {
             const q = query(collection(db, colName), where('tenantId', '==', tenant.id));
             const snap = await getDocs(q);
             const deletePromises = snap.docs.map(d => deleteDoc(doc(db, colName, d.id)));
             await Promise.all(deletePromises);
          }
        }

        setTenants(prev => prev.filter(t => t.id !== tenant.id));
        
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
          Swal.fire('Publicado!', 'O aviso aparecerá para todas as empresas agora.', 'success');
        } else {
          Swal.fire('Removido!', 'O aviso global foi retirado.', 'success');
        }
      } catch (err) {
        console.error(err);
        Swal.fire('Erro', 'Não foi possível atualizar o aviso global.', 'error');
      }
    }
  };

  const handleEditLimit = async (tenantId: string, currentLimit: number) => {
    const { value: novoLimite } = await Swal.fire({
      title: 'Editar Limite de Usuários',
      input: 'number',
      inputLabel: 'Quantidade máxima de funcionários/usuários permitidos para esta empresa',
      inputValue: String(currentLimit),
      showCancelButton: true,
      confirmButtonColor: '#8b5cf6',
      inputValidator: (value) => {
        if (!value || isNaN(Number(value)) || Number(value) < 1) {
          return 'Você precisa informar um limite maior ou igual a 1!';
        }
      }
    });

    if (novoLimite) {
      setLoading(true);
      try {
        const val = Number(novoLimite);
        await updateDoc(doc(db, 'usuarios', tenantId), {
          limiteUsuarios: val
        });
        
        try {
          await updateDoc(doc(db, 'configuracoes', tenantId), {
            limiteUsuarios: val
          });
        } catch {
          await setDoc(doc(db, 'configuracoes', tenantId), {
            limiteUsuarios: val
          }, { merge: true });
        }

        setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, limiteUsuarios: val } : t));
        Swal.fire('Atualizado!', 'Limite de usuários atualizado com sucesso.', 'success');
      } catch (err) {
        console.error(err);
        Swal.fire('Erro', 'Não foi possível atualizar o limite de usuários.', 'error');
      } finally {
        setLoading(false);
      }
    }
  };

  if (!isPlatformAdminRole(userRole)) return null;

  const mrr = tenants.filter(t => t.status === 'Ativo').reduce((acc, curr) => acc + curr.valor, 0);
  const ativos = tenants.filter(t => t.status === 'Ativo').length;
  const inadimplentes = tenants.filter(t => t.status === 'Inadimplente').length;
  const ticketMedio = ativos > 0 ? mrr / ativos : 0;
  const modulosBloqueadosTotal = tenants.reduce((acc, tenant) => acc + (tenant.modulosBloqueados?.length || 0), 0);

  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

  const mrrData = Array.from({ length: 6 }).map((_, i) => {
    let mIndex = currentMonth - (5 - i);
    let year = currentYear;
    if (mIndex < 0) {
      mIndex += 12;
      year -= 1;
    }

    const monthEnd = new Date(year, mIndex + 1, 0, 23, 59, 59);
    const isCurrentMonth = mIndex === currentMonth && year === currentYear;
    const mrrMes = tenants
      .filter(t => t.status === 'Ativo')
      .filter(t => {
        const date = toDate(t.createdAt);
        if (!date) return isCurrentMonth;
        return date <= monthEnd;
      })
      .reduce((acc, tenant) => acc + Number(tenant.valor || 0), 0);

    return { name: monthNames[mIndex], mrr: mrrMes };
  });

  const planData = [
    { name: 'Plano Pro', value: tenants.filter(t => t.plano === 'Pro').length },
    { name: 'Plano Premium', value: tenants.filter(t => t.plano === 'Premium').length }
  ];

  const planRevenueData = [
    { name: 'Pro', receita: tenants.filter(t => t.status === 'Ativo' && t.plano === 'Pro').reduce((acc, t) => acc + Number(t.valor || 0), 0) },
    { name: 'Premium', receita: tenants.filter(t => t.status === 'Ativo' && t.plano === 'Premium').reduce((acc, t) => acc + Number(t.valor || 0), 0) }
  ];

  const statusData = [
    { name: 'Ativos', value: ativos, color: '#10b981' },
    { name: 'Inadimplentes', value: inadimplentes, color: '#ef4444' }
  ];

  const blockedModuleMap = tenants.reduce<Record<string, number>>((acc, tenant) => {
    (tenant.modulosBloqueados || []).forEach(moduleId => {
      acc[moduleId] = (acc[moduleId] || 0) + 1;
    });
    return acc;
  }, {});

  const moduleBlockData = Object.entries(blockedModuleMap)
    .map(([id, count]) => ({ name: moduleLabelMap[id] || id, bloqueios: count }))
    .sort((a, b) => b.bloqueios - a.bloqueios)
    .slice(0, 6);

  const COLORS = ['#8b5cf6', '#10b981', '#3b82f6', '#f59e0b', '#ef4444'];

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
          <button className="btn-secondary" onClick={handlePublishAlert} style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Megaphone size={16} /> Aviso Global
          </button>
          <button className="btn-secondary">Exportar Dados</button>
          <button className="btn-primary" onClick={() => navigate('/configuracoes')}>Configurações do SaaS</button>
        </div>
      </div>

      {/* Cards de Métricas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '24px' }}>
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
            <Wallet size={16} /> Ticket médio: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(ticketMedio)}
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
            Empresas usando a plataforma hoje
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

        <div className="card" style={{ padding: '28px', backgroundColor: 'var(--bg-secondary)', borderTop: '4px solid #3b82f6', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
            <div>
              <p style={{ color: 'var(--text-muted)', fontSize: '15px', marginBottom: '8px', fontWeight: 500 }}>Módulos Bloqueados</p>
              <h3 style={{ fontSize: '36px', margin: 0, fontWeight: 800 }}>{modulosBloqueadosTotal}</h3>
            </div>
            <div style={{ padding: '14px', backgroundColor: 'rgba(59, 130, 246, 0.1)', borderRadius: '14px', color: '#3b82f6' }}>
              <Blocks size={28} />
            </div>
          </div>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: 0 }}>
            Restrições ativas na carteira
          </p>
        </div>
      </div>

      {/* Gráficos */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }}>
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)' }}>
          <h3 style={{ fontSize: '18px', marginBottom: '24px', fontWeight: 600 }}>Crescimento do MRR (6 Meses)</h3>
          <div style={{ height: '360px' }}>
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
                  formatter={(value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0))}
                />
                <Area type="monotone" dataKey="mrr" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorMrr)" name="MRR" />
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '24px' }}>
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)' }}>
          <h3 style={{ fontSize: '18px', marginBottom: '24px', fontWeight: 600 }}>Receita por Plano</h3>
          <div style={{ height: '280px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={planRevenueData} margin={{ top: 20, right: 24, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
                <XAxis dataKey="name" stroke="var(--text-muted)" tick={{fill: 'var(--text-muted)'}} axisLine={false} tickLine={false} />
                <YAxis stroke="var(--text-muted)" tick={{fill: 'var(--text-muted)'}} axisLine={false} tickLine={false} tickFormatter={(val) => `R$ ${val}`} />
                <Tooltip
                  formatter={(value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0))}
                  contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: 'none', borderRadius: '8px', color: '#fff' }}
                />
                <Bar dataKey="receita" fill="#10b981" radius={[6, 6, 0, 0]} name="Receita ativa" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)' }}>
          <h3 style={{ fontSize: '18px', marginBottom: '24px', fontWeight: 600 }}>Módulos mais Bloqueados</h3>
          <div style={{ height: '280px' }}>
            {moduleBlockData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={moduleBlockData} layout="vertical" margin={{ top: 8, right: 24, left: 96, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" horizontal={false} />
                  <XAxis type="number" stroke="var(--text-muted)" tick={{fill: 'var(--text-muted)'}} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={92} stroke="var(--text-muted)" tick={{fill: 'var(--text-muted)', fontSize: 11}} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: 'none', borderRadius: '8px', color: '#fff' }} />
                  <Bar dataKey="bloqueios" fill="#f59e0b" radius={[0, 6, 6, 0]} name="Empresas com bloqueio" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', textAlign: 'center' }}>
                Nenhum módulo bloqueado na carteira.
              </div>
            )}
          </div>
        </div>

        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)' }}>
          <h3 style={{ fontSize: '18px', marginBottom: '24px', fontWeight: 600 }}>Status da Carteira</h3>
          <div style={{ height: '300px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={80}
                  outerRadius={110}
                  paddingAngle={5}
                  dataKey="value"
                  stroke="none"
                >
                  {statusData.map((entry) => (
                    <Cell key={`status-${entry.name}`} fill={entry.color} />
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
            <Users size={24} color="#8b5cf6" /> Carteira de Clientes (Empresas)
          </h3>
          <div className="search-bar" style={{ position: 'relative', width: '300px' }}>
            <Search size={18} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              type="text" 
              placeholder="Pesquisar empresa..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '100%', padding: '10px 16px 10px 44px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Carregando dados das empresas...</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '13px', textTransform: 'uppercase' }}>
                  <th style={{ padding: '16px 0' }}>Empresa / E-mail</th>
                  <th style={{ padding: '16px 0' }}>Plano</th>
                  <th style={{ padding: '16px 0' }}>Mensalidade</th>
                  <th style={{ padding: '16px 0' }}>Usuários</th>
                  <th style={{ padding: '16px 0' }}>Status Fatura</th>
                  <th style={{ padding: '16px 0', textAlign: 'right' }}>Ação</th>
                </tr>
              </thead>
              <tbody>
                {filteredTenants.map(tenant => (
                  <tr key={tenant.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '16px 0' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {tenant.nomeOficina}
                        </span>
                        <button 
                          className="icon-btn" 
                          onClick={() => handleEditNome(tenant.id, tenant.nomeOficina)}
                          style={{ padding: '4px', backgroundColor: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                          title="Editar Nome da Empresa"
                        >
                          <Edit2 size={13} />
                        </button>
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {tenant.email} <span style={{ opacity: 0.5 }}>•</span> ID: {tenant.id}
                      </div>
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
                    <td style={{ padding: '16px 0', fontWeight: 500 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>L: {tenant.limiteUsuarios !== undefined ? tenant.limiteUsuarios : 3}</span>
                        <button 
                          className="icon-btn" 
                          onClick={() => handleEditLimit(tenant.id, tenant.limiteUsuarios !== undefined ? tenant.limiteUsuarios : 3)}
                          style={{ padding: '4px', backgroundColor: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                          title="Editar Limite de Usuários"
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
                          <button 
                            className="btn-secondary" 
                            style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '6px 12px', borderRadius: 'var(--radius-md)' }}
                          >
                            <Ban size={14} /> Suspender
                          </button>
                        ) : (
                          <button 
                            className="btn-secondary" 
                            style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: 'var(--radius-md)' }}
                          >
                            Acessar Dados <ExternalLink size={14} />
                          </button>
                        )}
                        <button 
                          className="icon-btn" 
                          onClick={() => handleDeleteTenant(tenant)}
                          style={{ padding: '8px', color: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: 'var(--radius-md)', border: 'none', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          title="Excluir Empresa"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                
                {filteredTenants.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      {tenants.length === 0 ? "Nenhuma empresa cadastrada ainda." : "Nenhuma empresa corresponde à pesquisa."}
                    </td>
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
