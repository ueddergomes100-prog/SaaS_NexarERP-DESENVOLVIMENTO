import React, { useState, useEffect, useRef } from 'react';
import { Search, Bell, User, Calendar, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, onSnapshot, doc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import './Layout.css';

const TopBar: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [configData, setConfigData] = useState<any>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!currentUser) return;

    const configUnsub = onSnapshot(doc(db, 'configuracoes', currentUser.uid), (docSnap) => {
      let diasNotificacao = 15;
      if (docSnap.exists()) {
        const data = docSnap.data();
        setConfigData(data);
        diasNotificacao = Number(data.diasNotificacaoLembrete || 15);
      }
      
      // Listen to lembretes
      const q = query(collection(db, 'lembretes'), where('tenantId', '==', currentUser.uid), where('status', '==', 'Pendente'));
      const lembretesUnsub = onSnapshot(q, (snap) => {
        const notifs: any[] = [];
        const hoje = new Date();
        hoje.setHours(0,0,0,0);

        snap.forEach(d => {
          const lembrete = d.data();
          if (lembrete.dataPrevisao) {
            // Lembrete data format is 'YYYY-MM-DD'
            const [y, m, day] = lembrete.dataPrevisao.split('-');
            const prev = new Date(Number(y), Number(m) - 1, Number(day));
            
            const diffTime = prev.getTime() - hoje.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays <= diasNotificacao) {
              notifs.push({
                id: d.id,
                ...lembrete,
                diasRestantes: diffDays
              });
            }
          }
        });
        
        // Sort by closest date
        notifs.sort((a, b) => a.diasRestantes - b.diasRestantes);
        setNotifications(notifs);
      });

      return () => lembretesUnsub();
    });

    return () => configUnsub();
  }, [currentUser]);

  // Handle clicking outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleNotificationClick = () => {
    setShowDropdown(!showDropdown);
  };

  const goToLembretes = () => {
    setShowDropdown(false);
    navigate('/lembretes');
  };

  return (
    <header className="topbar">
      <div className="topbar-search">
        <Search className="search-icon" size={18} />
        <input 
          type="text" 
          placeholder="Buscar OS, cliente, placa ou peça..." 
          className="search-input"
        />
      </div>
      
      <div className="topbar-actions">
        <div style={{ position: 'relative' }} ref={dropdownRef}>
          <button className="action-btn notifications-btn" onClick={handleNotificationClick}>
            <Bell size={20} />
            {notifications.length > 0 && (
              <span className="badge pulse-badge">{notifications.length}</span>
            )}
          </button>
          
          {showDropdown && (
            <div className="notifications-dropdown" style={{
              position: 'absolute', top: '50px', right: '-10px', width: '320px', 
              backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
              boxShadow: '0 10px 25px rgba(0,0,0,0.5)', border: '1px solid var(--border-color)',
              zIndex: 1000, overflow: 'hidden', animation: 'fadeInUpLogout 0.2s ease-out forwards'
            }}>
              <div style={{ padding: '16px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>Notificações CRM</h3>
                <button onClick={() => setShowDropdown(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={16} /></button>
              </div>
              
              <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                {notifications.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <Bell size={24} style={{ opacity: 0.2, margin: '0 auto 8px' }} />
                    <p style={{ fontSize: '13px' }}>Nenhum alerta pendente.</p>
                  </div>
                ) : (
                  notifications.map((notif) => (
                    <div key={notif.id} style={{ 
                      padding: '16px', borderBottom: '1px solid var(--border-color)', 
                      display: 'flex', gap: '12px', cursor: 'pointer', transition: 'background 0.2s'
                    }}
                    onClick={goToLembretes}
                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'}
                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: notif.diasRestantes <= 0 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: notif.diasRestantes <= 0 ? '#ef4444' : '#f59e0b', flexShrink: 0 }}>
                        <Calendar size={16} />
                      </div>
                      <div>
                        <p style={{ margin: '0 0 4px 0', fontSize: '13px', fontWeight: 600 }}>{notif.veiculo}</p>
                        <p style={{ margin: '0 0 4px 0', fontSize: '12px', color: 'var(--text-secondary)' }}>Cliente: {notif.clienteNome}</p>
                        <p style={{ margin: 0, fontSize: '11px', color: notif.diasRestantes <= 0 ? '#ef4444' : '#f59e0b', fontWeight: 500 }}>
                          {notif.diasRestantes < 0 ? `Vencido há ${Math.abs(notif.diasRestantes)} dias` : 
                           notif.diasRestantes === 0 ? 'Vence hoje!' :
                           `Vence em ${notif.diasRestantes} dias`}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
              
              {notifications.length > 0 && (
                <div style={{ padding: '12px', borderTop: '1px solid var(--border-color)', textAlign: 'center' }}>
                  <button onClick={goToLembretes} style={{ background: 'transparent', border: 'none', color: 'var(--accent-purple)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
                    Ver todos os lembretes
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="profile-menu">
          <div className="profile-avatar">
            <User size={20} />
          </div>
          <div className="profile-info">
            <span className="profile-name">{configData?.nomeUsuario || 'Administrador'}</span>
            <span className="profile-role">{configData?.nomeOficina || 'Oficina Logada'}</span>
          </div>
        </div>
      </div>
    </header>
  );
};

export default TopBar;
