import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Building2, Database, LogOut, ArrowLeftRight, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import hennderIcon from '../../assets/hennder-icon.svg';

/**
 * Shell do painel da plataforma. Deliberadamente NAO usa AppLayout: nao tem
 * sidebar de modulos nem sistema de abas, porque esses sao conceitos de
 * tenant (vendas, estoque, financeiro de UMA empresa) e nao fazem sentido
 * na administracao da plataforma. Mesmo precedente do PDV, que ja vive fora
 * do AppLayout desde sempre.
 */
const PlatformAdminLayout: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser, logout } = useAuth();

  const linkStyle = ({ isActive }: { isActive: boolean }): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 16px',
    borderRadius: 'var(--radius-md)',
    fontSize: '14px',
    fontWeight: 600,
    textDecoration: 'none',
    color: isActive ? '#fff' : 'var(--text-secondary)',
    backgroundColor: isActive ? 'var(--accent-purple)' : 'transparent',
    transition: 'background-color 0.2s, color 0.2s',
  });

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg-primary)', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '24px', flexWrap: 'wrap',
          padding: '14px 28px',
          backgroundColor: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <img src={hennderIcon} alt="" style={{ width: '34px', height: '34px', objectFit: 'contain' }} />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldCheck size={16} style={{ color: 'var(--accent-purple)' }} />
              <strong style={{ fontSize: '15px', color: 'var(--text-primary)' }}>Painel da Plataforma</strong>
            </div>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Administração do SaaS — todas as empresas
            </span>
          </div>
        </div>

        <nav style={{ display: 'flex', gap: '8px' }}>
          <NavLink to="/superadmin" end style={linkStyle}>
            <Building2 size={16} /> Empresas
          </NavLink>
          <NavLink to="/superadmin/backups" style={linkStyle}>
            <Database size={16} /> Backups
          </NavLink>
        </nav>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {currentUser?.email}
          </span>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => navigate('/dashboard')}
            title="Voltar para o sistema de uma empresa"
            style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}
          >
            <ArrowLeftRight size={16} /> Ir para o ERP
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={logout}
            title="Sair do sistema"
            style={{ color: '#ef4444' }}
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <main style={{ flex: 1, padding: '28px', overflowX: 'hidden' }}>
        <Outlet />
      </main>
    </div>
  );
};

export default PlatformAdminLayout;
