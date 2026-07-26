import React, { useState, useEffect } from 'react';
import { UserCog, Plus, Search, Edit2, Trash2 } from 'lucide-react';
import { collection, query, where, onSnapshot, doc, deleteDoc, getDocs, limit } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { confirmDelete, showSuccess, showError } from '../../utils/alerts';
import { isTenantManagerRole } from '../../utils/roles';

interface UsuarioData {
  id: string;
  nome: string;
  nomeResponsavel?: string;
  username: string;
  email: string;
  role: string;
  status: string;
}

const UsuariosList: React.FC = () => {
  const { tenantId, userRole } = useAuth();
  const navigate = useNavigate();
  const [usuarios, setUsuarios] = useState<UsuarioData[]>([]);
  const [loading, setLoading] = useState(true);
  const canManageUsers = isTenantManagerRole(userRole);

  useEffect(() => {
    if (!tenantId) return;

    const q = query(collection(db, 'usuarios'), where('tenantId', '==', tenantId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const users: UsuarioData[] = [];
      snapshot.forEach(doc => {
        users.push({ id: doc.id, ...doc.data() } as UsuarioData);
      });
      setUsuarios(users);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [tenantId]);

  const handleDelete = async (id: string, username: string) => {
    if (!isTenantManagerRole(userRole)) {
      showError('Negado', 'Apenas o administrador pode excluir usuários.');
      return;
    }

    try {
      // Verificar se o funcionário já possui Movimentação (Ordens de Serviço, etc.)
      const qOS = query(collection(db, 'ordens_de_servico'), where('mecanicoId', '==', id), limit(1));
      const snapOS = await getDocs(qOS);

      if (!snapOS.empty) {
        showError('Ação Bloqueada', 'Este funcionário possui Ordens de Serviço vinculadas. Não é possível excluí-lo para não corromper relatórios. Por favor, apenas altere o nome dele ou desative-o.');
        return;
      }
    } catch (err) {
      console.error("Erro ao verificar movimentações:", err);
    }

    const confirmed = await confirmDelete('este usuário');
    if (confirmed) {
      try {
        // Exclui do firestore (O Auth deve ser excluído idealmente por Cloud Function, mas para o app, excluir o documento já barra o acesso no ACL)
        await deleteDoc(doc(db, 'usuarios', id));
        // Remove do índice global
        if (username) {
          await deleteDoc(doc(db, 'usernames', username));
        }
        showSuccess('Usuário excluído com sucesso!');
      } catch {
        showError('Erro', 'Não foi possível excluir o usuário.');
      }
    }
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'Master': return <span style={{ backgroundColor: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>Dono / Master</span>;
      case 'Admin': return <span style={{ backgroundColor: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>Administrador</span>;
      case 'Funcionario': return <span style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>Funcionário (Permissões Customizadas)</span>;
      case 'Mecanico': return <span style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>Mecânico (Legado)</span>;
      case 'Vendedor': return <span style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>Vendedor / Recepção (Legado)</span>;
      default: return <span style={{ backgroundColor: 'rgba(107, 114, 128, 0.1)', color: '#6b7280', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>{role}</span>;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <UserCog size={28} color="var(--accent-purple)" />
            Equipe & Acessos
          </h1>
          <p style={{ color: 'var(--text-muted)' }}>Crie logins para seus funcionários e defina o que eles podem ver no sistema.</p>
        </div>
        {canManageUsers && (
          <button className="btn-primary" onClick={() => navigate('/usuarios/novo')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={20} /> Adicionar Funcionário
          </button>
        )}
      </div>

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
          <div className="search-bar" style={{ flex: 1, position: 'relative' }}>
            <Search size={20} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              type="text" 
              placeholder="Buscar funcionário..." 
              style={{ width: '100%', padding: '12px 16px 12px 48px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '13px', textTransform: 'uppercase' }}>
                <th style={{ padding: '16px' }}>Nome do Funcionário</th>
                <th style={{ padding: '16px' }}>Login (Usuário)</th>
                <th style={{ padding: '16px' }}>Nível de Acesso</th>
                <th style={{ padding: '16px' }}>Status</th>
                {canManageUsers && <th style={{ padding: '16px', textAlign: 'right' }}>Ações</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>Carregando equipe...</td>
                </tr>
              ) : usuarios.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>Nenhum funcionário cadastrado.</td>
                </tr>
              ) : (
                usuarios.map(user => (
                  <tr key={user.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '16px', fontWeight: 500 }}>{user.nome || user.nomeResponsavel || 'S/N'}</td>
                    <td style={{ padding: '16px', color: 'var(--text-muted)' }}>
                      {user.username ? (user.username.includes('-') ? user.username.split('-').slice(1).join('-') : user.username) : user.email}
                    </td>
                    <td style={{ padding: '16px' }}>{getRoleBadge(user.role)}</td>
                    <td style={{ padding: '16px' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#10b981', fontSize: '13px' }}>
                        <span style={{ width: '8px', height: '8px', backgroundColor: '#10b981', borderRadius: '50%' }}></span>
                        Ativo
                      </span>
                    </td>
                    {canManageUsers && (
                      <td style={{ padding: '16px', textAlign: 'right' }}>
                        {!isTenantManagerRole(user.role) && (
                          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                            <button className="icon-btn" style={{ color: '#3b82f6' }} onClick={() => navigate(`/usuarios/editar/${user.id}`)} title="Editar Usuário">
                              <Edit2 size={18} />
                            </button>
                            <button className="icon-btn" style={{ color: '#ef4444' }} onClick={() => handleDelete(user.id, user.username)} title="Remover Acesso">
                              <Trash2 size={18} />
                            </button>
                          </div>
                        )}
                      </td>
                    )}
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

export default UsuariosList;
