import React, { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { Megaphone, X } from 'lucide-react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import './Layout.css';

const AppLayout: React.FC = () => {
  const [globalAlert, setGlobalAlert] = useState<{message: string} | null>(null);
  const [hideAlert, setHideAlert] = useState(false);
  const location = useLocation();

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>
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
      <div className="app-container" style={{ flex: 1, height: 'auto', width: '100%' }}>
        <Sidebar />
        <div className="main-content">
          <TopBar />
          <main className="page-content">
            <div className="page-transition">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
};

export default AppLayout;
