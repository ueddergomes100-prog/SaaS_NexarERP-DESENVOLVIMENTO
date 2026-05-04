import React, { useState, useEffect, useRef } from 'react';
import { Search, Bell, User, Calendar, X, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, onSnapshot, doc, getDocs } from 'firebase/firestore';
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
  
  // Global search state
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<{ type: string, id: string, title: string, subtitle: string, link: string }[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const [expandAll, setExpandAll] = useState(() => localStorage.getItem('nexus_sidebar_expand_all') === 'true');
  const [miniSidebar, setMiniSidebar] = useState(() => localStorage.getItem('nexus_mini_sidebar') === 'true');

  useEffect(() => {
    const updateState = () => {
      setExpandAll(localStorage.getItem('nexus_sidebar_expand_all') === 'true');
      setMiniSidebar(localStorage.getItem('nexus_mini_sidebar') === 'true');
    };
    window.addEventListener('sidebar-state-change', updateState);
    return () => window.removeEventListener('sidebar-state-change', updateState);
  }, []);

  useEffect(() => {
    if (miniSidebar && expandAll) {
      document.body.classList.add('mini-sidebar');
    } else if (!expandAll && miniSidebar) {
      setMiniSidebar(false);
      localStorage.setItem('nexus_mini_sidebar', 'false');
      document.body.classList.remove('mini-sidebar');
    } else if (!miniSidebar) {
      document.body.classList.remove('mini-sidebar');
    }
  }, [miniSidebar, expandAll]);

  const handleMiniSidebarToggle = () => {
    if (!expandAll) return;
    const newVal = !miniSidebar;
    setMiniSidebar(newVal);
    localStorage.setItem('nexus_mini_sidebar', String(newVal));
    if (newVal) {
      document.body.classList.add('mini-sidebar');
    } else {
      document.body.classList.remove('mini-sidebar');
    }
  };

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

  // Handle clicking outside to close dropdowns
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSearchDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleNotificationClick = () => {
    setShowDropdown(!showDropdown);
  };

  useEffect(() => {
    if (searchTerm.length < 2) {
      setSearchResults([]);
      setShowSearchDropdown(false);
      return;
    }

    setShowSearchDropdown(true);
    setIsSearching(true);

    const debounceTimer = setTimeout(async () => {
      const termLower = searchTerm.toLowerCase();
      try {
        if (!currentUser) return;
        const results: any[] = [];
        const qOs = query(collection(db, 'ordens_de_servico'), where('tenantId', '==', currentUser.uid));
        const qClientes = query(collection(db, 'clientes'), where('tenantId', '==', currentUser.uid));
        
        const [osSnap, clientesSnap] = await Promise.all([getDocs(qOs), getDocs(qClientes)]);
        
        osSnap.forEach(doc => {
          const data = doc.data();
          if (
            (data.clienteNome && data.clienteNome.toLowerCase().includes(termLower)) ||
            (data.placa && data.placa.toLowerCase().includes(termLower)) ||
            (data.numeroOS && data.numeroOS.toLowerCase().includes(termLower))
          ) {
            results.push({
              type: 'OS',
              id: doc.id,
              title: `OS #${data.numeroOS || doc.id.substring(0,8).toUpperCase()} - Placa: ${data.placa?.toUpperCase()}`,
              subtitle: data.clienteNome,
              link: `/os/editar/${doc.id}`
            });
          }
        });

        clientesSnap.forEach(doc => {
          const data = doc.data();
          if (
            (data.nome && data.nome.toLowerCase().includes(termLower)) ||
            (data.telefone && data.telefone.includes(termLower)) ||
            (data.documento && data.documento.includes(termLower))
          ) {
            results.push({
              type: 'Cliente',
              id: doc.id,
              title: data.nome,
              subtitle: data.telefone || data.documento || 'Sem detalhes',
              link: `/clientes/editar/${doc.id}`
            });
          }
        });

        setSearchResults(results.slice(0, 10)); // Top 10 results max
      } catch (error) {
        console.error(error);
      } finally {
        setIsSearching(false);
      }
    }, 500);

    return () => clearTimeout(debounceTimer);
  }, [searchTerm, currentUser]);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  const goToResult = (link: string) => {
    setShowSearchDropdown(false);
    setSearchTerm('');
    navigate(link);
  };

  const goToLembretes = () => {
    setShowDropdown(false);
    navigate('/lembretes');
  };

  return (
    <header className="topbar">
      <div className="topbar-search" ref={searchRef}>
        <Search className="search-icon" size={18} />
        <input 
          type="text" 
          placeholder="Buscar OS, cliente, placa ou peça..." 
          className="search-input"
          value={searchTerm}
          onChange={handleSearch}
          onFocus={() => searchTerm.length >= 2 && setShowSearchDropdown(true)}
        />
        
        {showSearchDropdown && (
          <div className="search-dropdown" style={{
            position: 'absolute', top: '50px', left: 0, width: '100%', 
            backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
            boxShadow: '0 10px 25px rgba(0,0,0,0.5)', border: '1px solid var(--border-color)',
            zIndex: 1000, overflow: 'hidden', animation: 'fadeInUpLogout 0.2s ease-out forwards'
          }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Resultados da busca</span>
            </div>
            
            <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
              {isSearching ? (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  <Loader2 size={24} className="spin-animation" style={{ margin: '0 auto 8px', color: 'var(--accent-purple)' }} />
                  <p style={{ fontSize: '13px' }}>Buscando...</p>
                </div>
              ) : searchResults.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  <Search size={24} style={{ opacity: 0.2, margin: '0 auto 8px' }} />
                  <p style={{ fontSize: '13px' }}>Nenhum resultado encontrado para "{searchTerm}"</p>
                </div>
              ) : (
                searchResults.map((result, idx) => (
                  <div key={idx} style={{ 
                    padding: '12px 16px', borderBottom: '1px solid var(--border-color)', 
                    display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', transition: 'background 0.2s'
                  }}
                  onClick={() => goToResult(result.link)}
                  onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'}
                  onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <div style={{ 
                      width: '36px', height: '36px', borderRadius: 'var(--radius-md)', 
                      backgroundColor: result.type === 'OS' ? 'rgba(139, 92, 246, 0.1)' : 'rgba(16, 185, 129, 0.1)', 
                      display: 'flex', alignItems: 'center', justifyContent: 'center', 
                      color: result.type === 'OS' ? 'var(--accent-purple)' : '#10b981', 
                      flexShrink: 0, fontSize: '11px', fontWeight: 700 
                    }}>
                      {result.type}
                    </div>
                    <div>
                      <p style={{ margin: '0 0 2px 0', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{result.title}</p>
                      <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)' }}>{result.subtitle}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
      
      <div className="topbar-actions">
        {/* Toggle Menu Compacto */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: expandAll ? 1 : 0.5, marginRight: '8px' }} title={!expandAll ? "Ative 'Expandir todos os blocos' no menu lateral primeiro" : "Recolher menu lateral"}>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Menu Compacto</span>
          <div 
            onClick={handleMiniSidebarToggle}
            style={{ 
              position: 'relative', 
              width: '32px', 
              height: '18px', 
              backgroundColor: miniSidebar && expandAll ? 'var(--accent-purple)' : 'var(--bg-tertiary)', 
              borderRadius: '10px', 
              transition: 'background-color 0.3s',
              cursor: expandAll ? 'pointer' : 'not-allowed',
              border: '1px solid var(--border-color)'
            }}
          >
            <div style={{ 
              position: 'absolute', 
              top: '0px', 
              left: miniSidebar && expandAll ? '14px' : '0px', 
              width: '16px', 
              height: '16px', 
              backgroundColor: '#fff', 
              borderRadius: '50%', 
              transition: 'left 0.3s',
              boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
            }} />
          </div>
        </div>

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
