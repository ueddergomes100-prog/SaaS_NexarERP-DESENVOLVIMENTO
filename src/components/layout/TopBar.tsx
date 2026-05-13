import React, { useState, useEffect, useRef } from 'react';
import { Search, Bell, User, Calendar, X, Loader2, Settings, LogOut, ChevronDown, Menu, Sun, Moon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, onSnapshot, doc, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import PerfilModal from './PerfilModal';
import './Layout.css';

const TopBar: React.FC = () => {
  const { currentUser, tenantId, userRole, userPermissions } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [configData, setConfigData] = useState<any>(null);
  const [userData, setUserData] = useState<any>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [showPerfilModal, setShowPerfilModal] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const profileDropdownRef = useRef<HTMLDivElement>(null);
  
  // Global search state
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<{ type: string, id: string, title: string, subtitle: string, link: string }[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const [expandAll, setExpandAll] = useState(() => localStorage.getItem('nexus_sidebar_expand_all') === 'true');
  const [miniSidebar, setMiniSidebar] = useState(() => localStorage.getItem('nexus_mini_sidebar') === 'true');
  const [theme, setTheme] = useState(() => localStorage.getItem('nexus_theme') || 'dark');

  useEffect(() => {
    if (theme === 'light') {
      document.body.classList.add('light-theme');
    } else {
      document.body.classList.remove('light-theme');
    }
    localStorage.setItem('nexus_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

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
    if (!currentUser || !tenantId) return;

    let diasNotificacao = 15;
    let currentLembretes: any[] = [];
    let currentAgendamentos: any[] = [];

    const updateNotifs = () => {
      const notifs = [...currentLembretes, ...currentAgendamentos];
      notifs.sort((a, b) => a.diasRestantes - b.diasRestantes);
      setNotifications(notifs);
    };

    let userUnsub = () => {};
    if (userRole !== 'Admin' && userRole !== 'SuperAdmin') {
      userUnsub = onSnapshot(doc(db, 'usuarios', currentUser.uid), (docSnap) => {
        if (docSnap.exists()) {
          setUserData(docSnap.data());
        }
      });
    }

    const configUnsub = onSnapshot(doc(db, 'configuracoes', tenantId), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setConfigData(data);
        diasNotificacao = Number(data.diasNotificacaoLembrete || 15);
        updateNotifs();
      }
    });
    
    // Listen to Lembretes (Alertas de Retorno)
    const qLembretes = query(collection(db, 'lembretes'), where('tenantId', '==', tenantId), where('status', '==', 'Pendente'));
    const lembretesUnsub = onSnapshot(qLembretes, (snap) => {
      const temp: any[] = [];
      const hoje = new Date();
      hoje.setHours(0,0,0,0);

      snap.forEach(d => {
        const lembrete = d.data();
        if (lembrete.dataPrevisao) {
          const [y, m, day] = lembrete.dataPrevisao.split('-');
          const prev = new Date(Number(y), Number(m) - 1, Number(day));
          
          const diffTime = prev.getTime() - hoje.getTime();
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          
          if (diffDays > 0 && diffDays <= diasNotificacao) {
            temp.push({
              id: d.id,
              tipoLogico: 'lembrete',
              labelTipo: 'Lembrete de Retorno',
              ...lembrete,
              diasRestantes: diffDays
            });
          }
        }
      });
      
      currentLembretes = temp;
      updateNotifs();
    });

    // Listen to Agendamentos
    const qAgendamentos = query(collection(db, 'agendamentos'), where('tenantId', '==', tenantId), where('status', '==', 'Agendado'));
    const agendamentosUnsub = onSnapshot(qAgendamentos, (snap) => {
      const temp: any[] = [];
      const hoje = new Date();
      hoje.setHours(0,0,0,0);

      snap.forEach(d => {
        const ag = d.data();
        if (ag.data) {
          const [y, m, day] = ag.data.split('-');
          const prev = new Date(Number(y), Number(m) - 1, Number(day));
          
          const diffTime = prev.getTime() - hoje.getTime();
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          
          if (diffDays > 0 && diffDays <= diasNotificacao) {
            temp.push({
              id: d.id,
              tipoLogico: 'agendamento',
              labelTipo: 'Agendamento Marcado',
              veiculo: ag.veiculo,
              clienteNome: ag.clienteNome,
              diasRestantes: diffDays
            });
          }
        }
      });
      
      currentAgendamentos = temp;
      updateNotifs();
    });

    return () => {
      configUnsub();
      lembretesUnsub();
      agendamentosUnsub();
      userUnsub();
    };
  }, [currentUser, tenantId, userRole]);

  // Handle clicking outside to close dropdowns
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSearchDropdown(false);
      }
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(event.target as Node)) {
        setShowProfileDropdown(false);
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <button 
          className="mobile-menu-btn" 
          onClick={() => document.body.classList.toggle('mobile-sidebar-open')}
          style={{ display: 'none', background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', padding: '8px', marginLeft: '-8px' }}
        >
          <Menu size={24} />
        </button>
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

        <button 
          className="action-btn theme-toggle-btn" 
          onClick={toggleTheme}
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            backgroundColor: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-color)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            marginRight: '8px'
          }}
          title={theme === 'dark' ? "Mudar para tema claro" : "Mudar para tema escuro"}
        >
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
        </button>

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
                    onClick={() => {
                      if (notif.tipoLogico === 'agendamento') navigate('/crm/agenda');
                      else navigate('/crm/lembretes');
                      setShowDropdown(false);
                    }}
                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'}
                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: 'rgba(139, 92, 246, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b5cf6', flexShrink: 0 }}>
                        <Calendar size={16} />
                      </div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <span style={{ fontSize: '10px', backgroundColor: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '4px', color: 'var(--text-muted)', fontWeight: 'bold', textTransform: 'uppercase' }}>
                            {notif.labelTipo}
                          </span>
                        </div>
                        <p style={{ margin: '0 0 4px 0', fontSize: '13px', fontWeight: 600 }}>{notif.veiculo}</p>
                        <p style={{ margin: '0 0 4px 0', fontSize: '12px', color: 'var(--text-secondary)' }}>Cliente: {notif.clienteNome}</p>
                        <p style={{ margin: 0, fontSize: '11px', color: '#f59e0b', fontWeight: 500 }}>
                          Faltam {notif.diasRestantes} dias
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

        <div style={{ position: 'relative' }} ref={profileDropdownRef}>
          <div className="profile-menu" onClick={() => setShowProfileDropdown(!showProfileDropdown)} style={{ cursor: 'pointer' }}>
            <div className="profile-avatar">
              <User size={20} />
            </div>
            <div className="profile-info">
              <span className="profile-name">{userData?.nome || configData?.nomeUsuario || 'Administrador'}</span>
              <span className="profile-role">{configData?.nomeOficina || 'Oficina Logada'}</span>
            </div>
            <ChevronDown size={16} style={{ color: 'var(--text-muted)', marginLeft: '8px' }} />
          </div>

          {showProfileDropdown && (
            <div style={{
              position: 'absolute', top: '50px', right: '0', width: '220px', 
              backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
              boxShadow: '0 10px 25px rgba(0,0,0,0.5)', border: '1px solid var(--border-color)',
              zIndex: 1000, overflow: 'hidden', animation: 'fadeInUpLogout 0.2s ease-out forwards',
              display: 'flex', flexDirection: 'column'
            }}>
              <div style={{ padding: '16px', borderBottom: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '14px' }}>{userData?.nome || configData?.nomeUsuario || 'Administrador'}</span>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{currentUser?.email || 'Usuário do Sistema'}</span>
              </div>
              
              <div style={{ padding: '8px' }}>
                <button 
                  onClick={() => { setShowProfileDropdown(false); setShowPerfilModal(true); }}
                  style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', padding: '10px 12px', background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', borderRadius: 'var(--radius-md)', transition: 'background 0.2s', textAlign: 'left', fontSize: '13px' }}
                  onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; e.currentTarget.style.color = 'white'; }}
                  onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                >
                  <User size={16} /> Meu Perfil
                </button>

                {(userRole === 'Admin' || userPermissions?.includes('administrativo.config')) && (
                  <button 
                    onClick={() => { setShowProfileDropdown(false); navigate('/configuracoes'); }}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', padding: '10px 12px', background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', borderRadius: 'var(--radius-md)', transition: 'background 0.2s', textAlign: 'left', fontSize: '13px' }}
                    onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; e.currentTarget.style.color = 'white'; }}
                    onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                  >
                    <Settings size={16} /> Configurações
                  </button>
                )}
              </div>

              <div style={{ padding: '8px', borderTop: '1px solid var(--border-color)' }}>
                <button 
                  onClick={() => { setShowProfileDropdown(false); window.dispatchEvent(new Event('trigger-logout')); }}
                  style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', padding: '10px 12px', background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', borderRadius: 'var(--radius-md)', transition: 'background 0.2s', textAlign: 'left', fontSize: '13px', fontWeight: 500 }}
                  onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
                  onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <LogOut size={16} /> Sair do Sistema
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showPerfilModal && (
        <PerfilModal 
          onClose={() => setShowPerfilModal(false)} 
          userData={userData} 
          configData={configData} 
        />
      )}
    </header>
  );
};

export default TopBar;
