import React, { useState, useEffect } from 'react';
import { UserCog, Plus, Search, Edit2, Power, Shield } from 'lucide-react';
import { collection, query, where, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { isTenantManagerRole } from '../../utils/roles';
import {
  NIVEL_ACESSO_LABELS,
  type NivelAcesso,
  parseNivelAcesso,
} from '../../utils/visibilidadeVendasDomain';
import PermissoesUsuarioModal from '../../components/common/PermissoesUsuarioModal';
import {
  EXPLICACAO_VENDEDOR_SEM_LOGIN,
  isRegistroDeVendedor,
  menuVendedoresVisivel,
} from '../../utils/vendedorCadastroDomain';

interface UsuarioData {
  id: string;
  nome: string;
  nomeResponsavel?: string;
  username: string;
  email: string;
  role: string;
  status: string;
  nivelAcesso?: string;
}

const UsuariosList: React.FC = () => {
  const {
    currentUser,
    tenantId,
    userRole,
    restringirVendasPorUsuario,
    exigirIdentificacaoVendedor,
    temVendedorCadastrado,
  } = useAuth();
  const { openTab } = useTabs();
  const [usuarios, setUsuarios] = useState<UsuarioData[]>([]);
  const [loading, setLoading] = useState(true);
  // Define permissoes sem sair da tela. Popup em vez de link pra Configuracoes
  // porque as duas telas exigem permissoes diferentes (administrativo.equipe
  // vs administrativo.config) -- ver comentario em PermissoesUsuarioModal.
  const [usuarioPermissoes, setUsuarioPermissoes] = useState<UsuarioData | null>(null);
  const canManageUsers = isTenantManagerRole(userRole);

  useEffect(() => {
    if (!tenantId) return;

    const q = query(collection(db, 'usuarios'), where('tenantId', '==', tenantId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const users: UsuarioData[] = [];
      snapshot.forEach(doc => {
        // Vendedor de balcao mora na mesma colecao mas NAO tem login: sem
        // senha, sem username, sem modulo pra liberar. Listar aqui daria um
        // "usuario" com botao de permissao que nao serve pra nada e um
        // login que nao existe. Ele fica em Cadastros Auxiliares >
        // Vendedores -- ver src/utils/vendedorCadastroDomain.ts.
        if (isRegistroDeVendedor(doc.data())) return;
        users.push({ id: doc.id, ...doc.data() } as UsuarioData);
      });
      setUsuarios(users);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [tenantId]);

  const handleToggleStatus = async (user: UsuarioData) => {
    if (!isTenantManagerRole(userRole)) {
      showError('Negado', 'Apenas o administrador pode alterar o acesso de usuários.');
      return;
    }
    if (!currentUser) return;

    const statusAtual = user.status || 'Ativo';
    const novoStatus = statusAtual === 'Ativo' ? 'Inativo' : 'Ativo';
    const nome = user.nome || user.nomeResponsavel || user.username || 'este usuário';

    const confirm = await NexusSwal.fire({
      title: novoStatus === 'Ativo' ? `Ativar ${nome}?` : `Inativar ${nome}?`,
      text: novoStatus === 'Ativo'
        ? `${nome} volta a conseguir entrar no sistema.`
        : `${nome} é desconectado na hora e não consegue mais entrar no sistema, mas o histórico dele (OS, vendas, comissões) continua intacto. Pode ser reativado quando quiser.`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: novoStatus === 'Ativo' ? 'Sim, ativar' : 'Sim, inativar',
      cancelButtonText: 'Cancelar',
    });
    if (!confirm.isConfirmed) return;

    try {
      await updateDoc(doc(db, 'usuarios', user.id), {
        status: novoStatus,
        ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), novoStatus === 'Ativo' ? 'Usuário reativado' : 'Usuário inativado'),
      });
      showSuccess(novoStatus === 'Ativo' ? 'Usuário ativado!' : 'Usuário inativado!');
    } catch {
      showError('Erro', 'Não foi possível atualizar o status do usuário.');
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

  // Nivel de acesso (Funcionario/Administracao) governa SO a visibilidade
  // de vendas -- e' proposital que ele apareca separado do perfil do
  // sistema, que continua sendo quem manda nos modulos.
  const getNivelBadge = (user: UsuarioData) => {
    const ehDono = user.id === tenantId;
    // Dono e papel de gestor ja veem tudo por outro caminho -- a etiqueta
    // mostra o efeito, nao o campo gravado.
    const nivel: NivelAcesso = ehDono || isTenantManagerRole(user.role)
      ? 'gerente'
      : parseNivelAcesso(user.nivelAcesso);
    const cor = nivel === 'funcionario' ? '#6b7280' : '#10b981';
    return (
      <span style={{ backgroundColor: cor + '1a', color: cor, padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>
        {NIVEL_ACESSO_LABELS[nivel]}
      </span>
    );
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
          <button className="btn-primary" onClick={() => openTab('/usuarios/novo')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={20} /> Adicionar Funcionário
          </button>
        )}
      </div>

      {menuVendedoresVisivel({ exigirIdentificacaoVendedor, temVendedorCadastrado }) && (
        <div style={{ padding: '14px 18px', backgroundColor: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', fontSize: '13px', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
          <UserCog size={18} style={{ color: '#3b82f6', flexShrink: 0, marginTop: '1px' }} />
          <span>{EXPLICACAO_VENDEDOR_SEM_LOGIN} Esta lista mostra só quem entra no sistema.</span>
        </div>
      )}

      {restringirVendasPorUsuario && (
        <div style={{ padding: '14px 18px', backgroundColor: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', fontSize: '13px', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
          <Shield size={18} style={{ color: '#10b981', flexShrink: 0, marginTop: '1px' }} />
          <span>
            Esta empresa está com <strong>&quot;Não visualizar vendas de outro usuário&quot;</strong> ligado. Quem está como
            {' '}<strong>Funcionário</strong> enxerga apenas as próprias vendas; quem está como <strong>Administração</strong> vê todas.
            {' '}Para mudar o nível de alguém, clique no escudo na linha dele.
          </span>
        </div>
      )}
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
                <th style={{ padding: '16px' }}>Perfil no Sistema</th>
                <th style={{ padding: '16px' }}>Nível (Vendas)</th>
                <th style={{ padding: '16px' }}>Status</th>
                {canManageUsers && <th style={{ padding: '16px', textAlign: 'right' }}>Ações</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>Carregando equipe...</td>
                </tr>
              ) : usuarios.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>Nenhum funcionário cadastrado.</td>
                </tr>
              ) : (
                usuarios.map(user => (
                  <tr key={user.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '16px', fontWeight: 500 }}>{user.nome || user.nomeResponsavel || 'S/N'}</td>
                    <td style={{ padding: '16px', color: 'var(--text-muted)' }}>
                      {user.username ? (user.username.includes('-') ? user.username.split('-').slice(1).join('-') : user.username) : user.email}
                    </td>
                    <td style={{ padding: '16px' }}>{getRoleBadge(user.role)}</td>
                    <td style={{ padding: '16px' }}>{getNivelBadge(user)}</td>
                    <td style={{ padding: '16px' }}>
                      {(() => {
                        const ativo = (user.status || 'Ativo') === 'Ativo';
                        return (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: ativo ? '#10b981' : '#6b7280', fontSize: '13px' }}>
                            <span style={{ width: '8px', height: '8px', backgroundColor: ativo ? '#10b981' : '#6b7280', borderRadius: '50%' }}></span>
                            {ativo ? 'Ativo' : 'Inativo'}
                          </span>
                        );
                      })()}
                    </td>
                    {canManageUsers && (
                      <td style={{ padding: '16px', textAlign: 'right' }}>
                        {!isTenantManagerRole(user.role) && (
                          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                            <button
                              className="icon-btn"
                              style={{ color: '#8b5cf6' }}
                              onClick={() => setUsuarioPermissoes(user)}
                              title="Definir Permissões de Acesso"
                            >
                              <Shield size={18} />
                            </button>
                            <button className="icon-btn" style={{ color: '#3b82f6' }} onClick={() => openTab(`/usuarios/editar/${user.id}`)} title="Editar Usuário">
                              <Edit2 size={18} />
                            </button>
                            <button
                              className="icon-btn"
                              style={{ color: (user.status || 'Ativo') === 'Ativo' ? '#ef4444' : '#10b981' }}
                              onClick={() => handleToggleStatus(user)}
                              title={(user.status || 'Ativo') === 'Ativo' ? 'Inativar Usuário' : 'Ativar Usuário'}
                            >
                              <Power size={18} />
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

      {usuarioPermissoes && (
        <PermissoesUsuarioModal
          usuarioId={usuarioPermissoes.id}
          usuarioNome={usuarioPermissoes.nome || usuarioPermissoes.nomeResponsavel || usuarioPermissoes.username || 'Funcionário'}
          onClose={() => setUsuarioPermissoes(null)}
        />
      )}
    </div>
  );
};

export default UsuariosList;
