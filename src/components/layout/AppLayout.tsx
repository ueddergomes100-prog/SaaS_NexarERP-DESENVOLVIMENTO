import React, { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { Building2, Megaphone, X, ShieldAlert } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import './Layout.css';
import { hasTenantFullAccess } from '../../utils/roles';

const AppLayout: React.FC = () => {
  const [globalAlert, setGlobalAlert] = useState<{message: string} | null>(null);
  const [hideAlert, setHideAlert] = useState(false);
  const location = useLocation();
  const { blockedModules, userRole, userPermissions, isOwner, isPlatformAdmin, tenantOptions, setActiveTenantId, needsTenantSelection } = useAuth();

  useEffect(() => {
    // Retrigger animation without destroying the DOM node (fixes Google Translate crash)
    const pageEl = document.querySelector('.page-transition') as HTMLElement;
    if (pageEl) {
      pageEl.style.animation = 'none';
      void pageEl.offsetWidth; // Force reflow
      pageEl.style.animation = 'pageFadeIn 0.35s cubic-bezier(0.25, 1, 0.5, 1) forwards';
    }
  }, [location.pathname]);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'system_alerts', 'global'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.message) {
          setGlobalAlert({ message: data.message });
          setHideAlert(false); // Mostrar novamente se o texto mudar
        } else {
          setGlobalAlert(null);
        }
      } else {
        setGlobalAlert(null);
      }
    });
    return () => unsub();
  }, []);

  const path = location.pathname.toLowerCase();
  let routeModule = '';
  if (path.startsWith('/clientes')) routeModule = 'cadastros.clientes';
  else if (path.startsWith('/usuarios')) routeModule = 'cadastros.usuarios';
  else if (path.startsWith('/veiculos')) routeModule = 'cadastros.veiculos';
  else if (path.startsWith('/estoque')) routeModule = 'cadastros.estoque';
  else if (path.startsWith('/servicos')) routeModule = 'cadastros.servicos';
  else if (path.startsWith('/categorias')) routeModule = 'cadastros.categorias';
  else if (path.startsWith('/unidades-medida')) routeModule = 'cadastros.unidades_medida';
  else if (path.startsWith('/pedidos-venda')) routeModule = 'comercial.pedidos';
  else if (path.startsWith('/orcamentos')) routeModule = 'comercial.orcamentos';
  else if (path.startsWith('/vendas/devolucoes') || path.startsWith('/vendas')) routeModule = 'comercial.devolucoes';
  else if (path.startsWith('/relatorios-vendas')) routeModule = 'comercial.relatorios';
  else if (path.startsWith('/os')) routeModule = 'mecanica.os';
  else if (path.startsWith('/relatorios-mecanica')) routeModule = 'mecanica.relatorios';
  else if (path.startsWith('/crm/agenda')) routeModule = 'crm.agenda';
  else if (path.startsWith('/crm/lembretes') || path.startsWith('/crm')) routeModule = 'crm.lembretes';
  else if (path.startsWith('/financeiro/caixa')) routeModule = 'financeiro.caixa';
  else if (path.startsWith('/financeiro/contas-receber')) routeModule = 'financeiro.receber';
  else if (path.startsWith('/financeiro/contas-pagar')) routeModule = 'financeiro.pagar';
  else if (path.startsWith('/financeiro/faturamento')) routeModule = 'financeiro.faturamento';
  else if (path.startsWith('/financeiro/comissoes') || path.startsWith('/financeiro')) routeModule = 'financeiro.comissoes';
  else if (path.startsWith('/fiscal/nfe')) routeModule = 'fiscal.nfe';
  else if (path.startsWith('/fiscal/entrada-nfe') || path.startsWith('/fiscal')) routeModule = 'fiscal.entrada_nfe';
  else if (path.startsWith('/relatorios-diversos')) routeModule = 'logs.relatorios_diversos';
  else if (path.startsWith('/logs-sistema')) routeModule = 'logs.sistema';
  else if (path.startsWith('/configuracoes')) routeModule = 'admin.config';

  let routePermission = '';
  if (path.startsWith('/clientes') || path.startsWith('/veiculos')) routePermission = 'cadastros.clientes';
  else if (path.startsWith('/usuarios')) routePermission = 'administrativo.equipe';
  else if (path.startsWith('/estoque')) routePermission = 'cadastros.estoque';
  else if (path.startsWith('/servicos')) routePermission = 'cadastros.servicos';
  else if (path.startsWith('/categorias')) routePermission = 'cadastros.categorias';
  else if (path.startsWith('/unidades-medida')) routePermission = 'cadastros.unidades_medida';
  else if (path.startsWith('/pedidos-venda')) routePermission = 'vendas.pedidos';
  else if (path.startsWith('/orcamentos')) routePermission = 'vendas.orcamentos';
  else if (path.startsWith('/vendas/devolucoes') || path.startsWith('/vendas')) routePermission = 'vendas.devolucao';
  else if (path.startsWith('/relatorios-vendas')) routePermission = 'vendas.relatorios';
  else if (path.startsWith('/os')) routePermission = 'mecanica.os';
  else if (path.startsWith('/relatorios-mecanica')) routePermission = 'mecanica.relatorios';
  else if (path.startsWith('/crm/agenda')) routePermission = 'crm.agenda';
  else if (path.startsWith('/crm/lembretes') || path.startsWith('/crm')) routePermission = 'crm.alertas';
  else if (path.startsWith('/financeiro/caixa')) routePermission = 'financeiro.caixa';
  else if (path.startsWith('/financeiro/contas-receber')) routePermission = 'financeiro.receber';
  else if (path.startsWith('/financeiro/contas-pagar')) routePermission = 'financeiro.pagar';
  else if (path.startsWith('/financeiro/faturamento')) routePermission = 'financeiro.faturamento';
  else if (path.startsWith('/financeiro/comissoes') || path.startsWith('/financeiro')) routePermission = 'financeiro.comissoes';
  else if (path.startsWith('/fiscal/nfe')) routePermission = 'fiscal.emitir';
  else if (path.startsWith('/fiscal/entrada-nfe') || path.startsWith('/fiscal')) routePermission = 'fiscal.entrada';
  else if (path.startsWith('/logs-sistema')) routePermission = 'administrativo.logs';
  else if (path.startsWith('/configuracoes')) routePermission = 'administrativo.config';

  const isModuleBlocked = routeModule && !isPlatformAdmin && blockedModules?.includes(routeModule);
  const hasFullAccess = hasTenantFullAccess(userRole, isOwner);
  const isRouteAllowed = !routePermission || hasFullAccess || userPermissions?.includes(routePermission);

  return (
    <div className="app-layout-wrapper">
      {globalAlert && !hideAlert && (
        <div style={{ 
          backgroundColor: '#f59e0b', 
          color: '#000', 
          padding: '12px 24px', 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center', 
          gap: '12px',
          fontWeight: 600,
          fontSize: '14px',
          boxShadow: '0 4px 15px rgba(245,158,11,0.3)',
          zIndex: 9999,
          position: 'relative',
          flexShrink: 0
        }}>
          <Megaphone size={18} />
          <span style={{ paddingRight: '32px' }}>{globalAlert.message}</span>
          <button 
            onClick={() => setHideAlert(true)} 
            style={{ background: 'transparent', border: 'none', color: '#000', cursor: 'pointer', position: 'absolute', right: '16px', display: 'flex', alignItems: 'center' }}
            title="Fechar aviso"
          >
            <X size={20} />
          </button>
        </div>
      )}
      <div className="app-container">
        <Sidebar />
        <div className="main-content">
          <TopBar />
          <main className="page-content">
            <div className="page-transition">
              {needsTenantSelection ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '65vh', padding: '24px' }}>
                  <div className="card" style={{ width: '100%', maxWidth: '560px', padding: '28px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '18px' }}>
                      <div style={{ width: '44px', height: '44px', borderRadius: '12px', backgroundColor: 'rgba(139, 92, 246, 0.12)', color: 'var(--accent-purple)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Building2 size={24} />
                      </div>
                      <div>
                        <h2 style={{ margin: 0, fontSize: '20px', color: 'var(--text-primary)' }}>Selecionar empresa ativa</h2>
                        <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '13px' }}>Escolha a base do cliente que deseja acessar agora.</p>
                      </div>
                    </div>

                    {tenantOptions.length > 0 ? (
                      <select
                        defaultValue=""
                        onChange={(event) => setActiveTenantId(event.target.value)}
                        style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '13px 16px', color: 'var(--text-primary)' }}
                      >
                        <option value="" disabled>Selecione uma empresa</option>
                        {tenantOptions.map(tenant => (
                          <option key={tenant.id} value={tenant.id}>{tenant.nomeOficina} {tenant.email ? `- ${tenant.email}` : ''}</option>
                        ))}
                      </select>
                    ) : (
                      <div style={{ padding: '16px', borderRadius: '8px', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)', textAlign: 'center', fontSize: '14px' }}>
                        Nenhuma empresa cliente foi encontrada para este ambiente.
                      </div>
                    )}
                  </div>
                </div>
              ) : isModuleBlocked || !isRouteAllowed ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: '16px', color: 'var(--text-primary)', textAlign: 'center', padding: '24px' }}>
                  <div style={{ padding: '16px', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: '50%', color: '#ef4444' }}>
                    <ShieldAlert size={48} />
                  </div>
                  <h2 style={{ fontSize: '22px', fontWeight: 700, margin: '8px 0 4px 0' }}>
                    {isModuleBlocked ? 'Módulo Não Disponível' : 'Acesso não permitido'}
                  </h2>
                  <p style={{ color: 'var(--text-secondary)', maxWidth: '460px', fontSize: '15px', lineHeight: '1.6', margin: 0 }}>
                    {isModuleBlocked
                      ? 'Este módulo está desativado para a sua conta. Caso precise utilizá-lo, entre em contato com o suporte ou o administrador do sistema para atualizar o seu plano.'
                      : 'Seu usuário não possui permissão para acessar esta área. Peça ao administrador para revisar seus acessos.'}
                  </p>
                </div>
              ) : (
                <Outlet />
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
};

export default AppLayout;
