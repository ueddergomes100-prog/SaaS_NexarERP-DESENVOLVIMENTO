import React, { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { Building2, Megaphone, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { TabsProvider } from '../../contexts/TabsContext';
import { useGlobalEscapeKey } from '../../hooks/useKeyboardFlow';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import TabBar from './TabBar';
import { TabPanesArea } from './TabPane';
import './Layout.css';

const AppLayout: React.FC = () => {
  const [globalAlert, setGlobalAlert] = useState<{message: string} | null>(null);
  const [hideAlert, setHideAlert] = useState(false);
  const { tenantOptions, setActiveTenantId, needsTenantSelection } = useAuth();

  useGlobalEscapeKey();

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

  return (
    <div className="app-layout-wrapper">
      {globalAlert && !hideAlert && (
        <div className="global-alert-banner" style={{
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
        {needsTenantSelection ? (
          <>
            <Sidebar />
            <div className="main-content">
              <TopBar />
              <main className="page-content">
                <div className="page-transition">
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
                </div>
              </main>
            </div>
          </>
        ) : (
          <TabsProvider>
            <Sidebar />
            <div className="main-content">
              <TopBar />
              <TabBar />
              <TabPanesArea />
            </div>
          </TabsProvider>
        )}
      </div>
    </div>
  );
};

export default AppLayout;
