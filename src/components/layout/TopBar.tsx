import React, { useState, useEffect, useRef } from 'react';
import { Search, Bell, User, Calendar, X, Loader2, Settings, LogOut, ChevronDown, Menu, Sun, Moon, SunMoon, Receipt, LifeBuoy, ShieldCheck } from 'lucide-react';
import { usePreferenciaTema } from '../../hooks/usePreferenciaTema';
import { proximaPreferenciaTema, tituloDoBotaoDeTema } from '../../utils/temaDomain';
import FilialSeletor from './FilialSeletor';
import { useNavigate } from 'react-router-dom';
import { useTabs } from '../../contexts/TabsContext';
import { collection, query, where, onSnapshot, doc, getDocs, limit, orderBy, Timestamp, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { isTenantManagerRole } from '../../utils/roles';
import { type SearchableProduct } from '../../utils/productSearch';
import { consultasDaBusca, fimDoPrefixo, LIMITE_POR_CONSULTA } from '../../utils/buscaGlobalDomain';
import PerfilModal from './PerfilModal';
import './Layout.css';
import { addDaysToDateInput, dateInputToUtcEnd, dateInputToUtcStart, getDateInputInTimeZone } from '../../utils/dateTime';
import { assinarComReserva, lerComReserva } from '../../services/consultaComReserva';
import { diasAteAData } from '../../utils/avisosSinoDomain';

const TopBar: React.FC = () => {
  const { currentUser, tenantId, userRole, userPermissions, isPlatformAdmin, tenantOptions, selectedTenant, setActiveTenantId, userNome } = useAuth();
  const { openTab } = useTabs();
  // Navegacao real (nao openTab): o painel da plataforma vive FORA do sistema
  // de abas, com shell proprio -- abrir como aba o colocaria dentro do ERP de
  // tenant, que e' justamente o que ele nao deve ser.
  const navigate = useNavigate();
  const SUPPORT_DESK_URL = import.meta.env.VITE_SUPPORT_DESK_URL || '';
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

  // Escuro -> claro -> automatico (segue o aparelho) -> escuro. Ver utils/temaDomain.ts.
  const { preferencia: temaPreferido, aparelhoEscuro, escolher: escolherTema } = usePreferenciaTema();
  const toggleTheme = () => escolherTema(proximaPreferenciaTema(temaPreferido));

  // Avisos do sino (otimizacao de leituras, 2026-10-14). Cada fonte tem a
  // SUA escuta, ja' limitada no banco ao que o sino mostra. Antes eram todos
  // os pendentes de sempre (lembretes, agendamentos, contas a pagar) num
  // efeito que dependia do array de permissoes -- recriado a cada sinal de
  // sessao de 30 s --, entao tudo era relido do servidor a cada 30 s.
  const diasNotificacao = Math.max(1, Math.round(Number(configData?.diasNotificacaoLembrete) || 15));
  const hasContasPagarAccess = isPlatformAdmin || isTenantManagerRole(userRole) || userPermissions.includes('financeiro.pagar');
  const [avisosLembretes, setAvisosLembretes] = useState<any[]>([]);
  const [avisosAgendamentos, setAvisosAgendamentos] = useState<any[]>([]);
  const [avisosContasPagar, setAvisosContasPagar] = useState<any[]>([]);

  useEffect(() => {
    const notifs = [...avisosLembretes, ...avisosAgendamentos, ...avisosContasPagar];
    notifs.sort((a, b) => a.diasRestantes - b.diasRestantes);
    setNotifications(notifs);
  }, [avisosLembretes, avisosAgendamentos, avisosContasPagar]);

  useEffect(() => {
    if (!currentUser || !tenantId) return;

    let userUnsub = () => {};
    if (!isTenantManagerRole(userRole) && !isPlatformAdmin) {
      userUnsub = onSnapshot(doc(db, 'usuarios', currentUser.uid), (docSnap) => {
        if (docSnap.exists()) {
          setUserData(docSnap.data());
        }
      });
    }

    const configUnsub = onSnapshot(doc(db, 'configuracoes', tenantId), (docSnap) => {
      if (docSnap.exists()) {
        setConfigData(docSnap.data());
      }
    });

    return () => {
      configUnsub();
      userUnsub();
    };
  }, [currentUser, tenantId, userRole, isPlatformAdmin]);

  // Lembretes de retorno: pendentes com previsao de amanha ate' daqui a N dias.
  useEffect(() => {
    if (!currentUser || !tenantId) {
      setAvisosLembretes([]);
      return undefined;
    }
    const hoje = getDateInputInTimeZone();
    const base = collection(db, 'lembretes');
    const reserva = query(base, where('tenantId', '==', tenantId), where('status', '==', 'Pendente'));
    const enxuta = query(
      base,
      where('tenantId', '==', tenantId),
      where('status', '==', 'Pendente'),
      where('dataPrevisao', '>=', Timestamp.fromDate(dateInputToUtcStart(addDaysToDateInput(hoje, 1)) ?? new Date())),
      where('dataPrevisao', '<=', Timestamp.fromDate(dateInputToUtcEnd(addDaysToDateInput(hoje, diasNotificacao)) ?? new Date())),
    );
    return assinarComReserva(enxuta, reserva, 'Sino (lembretes)', (snap) => {
      const temp: any[] = [];
      snap.forEach(d => {
        const lembrete = d.data();
        // dataPrevisao e' Timestamp (o LembreteForm grava um Date). Ver avisosSinoDomain.ts.
        const diffDays = diasAteAData(lembrete.dataPrevisao, hoje);
        if (diffDays !== null && diffDays > 0 && diffDays <= diasNotificacao) {
          temp.push({
            id: d.id,
            tipoLogico: 'lembrete',
            labelTipo: 'Lembrete de Retorno',
            ...lembrete,
            diasRestantes: diffDays
          });
        }
      });
      setAvisosLembretes(temp);
    });
  }, [currentUser, tenantId, diasNotificacao]);

  // Agendamentos marcados de amanha ate' daqui a N dias (`data` e' texto AAAA-MM-DD).
  useEffect(() => {
    if (!currentUser || !tenantId) {
      setAvisosAgendamentos([]);
      return undefined;
    }
    const hoje = getDateInputInTimeZone();
    const base = collection(db, 'agendamentos');
    const reserva = query(base, where('tenantId', '==', tenantId), where('status', '==', 'Agendado'));
    const enxuta = query(
      base,
      where('tenantId', '==', tenantId),
      where('status', '==', 'Agendado'),
      where('data', '>=', addDaysToDateInput(hoje, 1)),
      where('data', '<=', addDaysToDateInput(hoje, diasNotificacao)),
    );
    return assinarComReserva(enxuta, reserva, 'Sino (agendamentos)', (snap) => {
      const temp: any[] = [];
      snap.forEach(d => {
        const ag = d.data();
        const diffDays = diasAteAData(ag.data, hoje);
        if (diffDays !== null && diffDays > 0 && diffDays <= diasNotificacao) {
          temp.push({
            id: d.id,
            tipoLogico: 'agendamento',
            labelTipo: 'Agendamento Marcado',
            veiculo: ag.veiculo,
            clienteNome: ag.clienteNome,
            diasRestantes: diffDays
          });
        }
      });
      setAvisosAgendamentos(temp);
    });
  }, [currentUser, tenantId, diasNotificacao]);

  // Contas a pagar que vencem HOJE. So' igualdades: o Firestore responde sem
  // indice composto. A pagina recarrega na virada do dia (VerificadorDataDoSistema).
  useEffect(() => {
    if (!currentUser || !tenantId || !hasContasPagarAccess) {
      setAvisosContasPagar([]);
      return undefined;
    }
    const hojeStr = getDateInputInTimeZone();
    const qContasPagar = query(
      collection(db, 'transacoes'),
      where('tenantId', '==', tenantId),
      where('tipo', '==', 'saida'),
      where('status', '==', 'Pendente'),
      where('data', '==', hojeStr),
    );
    return onSnapshot(qContasPagar, (snap) => {
      const temp: any[] = [];
      const dismissedStr = localStorage.getItem(`nexus_dismissed_notifs_${currentUser.uid}`);
      const dismissed = dismissedStr ? JSON.parse(dismissedStr) : [];

      snap.forEach(d => {
        const t = d.data();
        if (t.data === hojeStr && !dismissed.includes(d.id)) {
          temp.push({
            id: d.id,
            tipoLogico: 'conta_pagar',
            labelTipo: 'Conta a Pagar Hoje',
            veiculo: t.descricao || 'Despesa',
            clienteNome: t.categoria || 'Financeiro',
            diasRestantes: 0
          });
        }
      });
      setAvisosContasPagar(temp);
    }, (erro) => console.error('Sino (contas a pagar):', erro));
  }, [currentUser, tenantId, hasContasPagarAccess]);

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

  const handleDismissNotification = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!currentUser) return;
    
    // Save dismissal
    const key = `nexus_dismissed_notifs_${currentUser.uid}`;
    const dismissedStr = localStorage.getItem(key);
    const dismissed = dismissedStr ? JSON.parse(dismissedStr) : [];
    
    if (!dismissed.includes(id)) {
      dismissed.push(id);
      localStorage.setItem(key, JSON.stringify(dismissed));
    }
    
    // Update UI immediately
    setNotifications(prev => prev.filter(n => n.id !== id));
    setAvisosContasPagar(prev => prev.filter(n => n.id !== id));
  };

  useEffect(() => {
    if (searchTerm.length < 2) {
      setSearchResults([]);
      setShowSearchDropdown(false);
      return;
    }

    setShowSearchDropdown(true);
    setIsSearching(true);

    // Consultas pequenas no cadastro INTEIRO (buscaGlobalDomain.ts): nome que
    // comeca com o termo e codigos exatos, ate' 5 por consulta. Antes eram os
    // 80 primeiros documentos de cada colecao (240 leituras por busca) e o
    // "contem" so' enxergava esses 80. Sem o indice de nome publicado, a
    // consulta de nome cai na antiga (lerComReserva) e o filtro abaixo segura.
    const debounceTimer = setTimeout(async () => {
      const termLower = searchTerm.toLowerCase();
      try {
        if (!currentUser || !tenantId) return;
        const c = consultasDaBusca(searchTerm);
        type Docs = QueryDocumentSnapshot<DocumentData>[];
        const semResultado: Promise<Docs> = Promise.resolve([]);
        const falhou = (erro: unknown): Docs => {
          console.error('Busca global:', erro);
          return [];
        };
        const porNome = (colecao: string, campo: string): Promise<Docs> => {
          if (!c.prefixoNome) return semResultado;
          const enxuta = query(
            collection(db, colecao),
            where('tenantId', '==', tenantId),
            where(campo, '>=', c.prefixoNome),
            where(campo, '<=', fimDoPrefixo(c.prefixoNome)),
            orderBy(campo),
            limit(LIMITE_POR_CONSULTA),
          );
          const reserva = query(collection(db, colecao), where('tenantId', '==', tenantId), limit(80));
          return lerComReserva(enxuta, reserva, `Busca global (${colecao})`)
            .then((snap) => snap.docs.filter((d) => String(d.data()[campo] || '').toLowerCase().includes(termLower)))
            .catch(falhou);
        };
        const porValor = (colecao: string, campo: string, valores: Array<string | number>): Promise<Docs> => (
          valores.length === 0 ? semResultado : getDocs(query(
            collection(db, colecao),
            where('tenantId', '==', tenantId),
            where(campo, 'in', valores),
            limit(LIMITE_POR_CONSULTA),
          )).then((snap) => snap.docs).catch(falhou)
        );

        const [osPorNumero, osPorPlaca, osPorCliente, clientesPorNome, clientesPorDocumento, produtosPorCodigo, produtosPorBarras, produtosPorNome] = await Promise.all([
          porValor('ordens_de_servico', 'numeroOS', c.numerosOS),
          porValor('ordens_de_servico', 'placa', c.placas),
          porNome('ordens_de_servico', 'clienteNome'),
          porNome('clientes', 'nome'),
          porValor('clientes', 'documento', c.documentos),
          porValor('estoque', 'codigo', c.codigosProduto),
          c.codigoBarras ? porValor('estoque', 'codigoBarras', [c.codigoBarras]) : semResultado,
          porNome('estoque', 'nome'),
        ]);
        const unicos = (...listas: Docs[]) => {
          const vistos = new Set<string>();
          return listas.flat().filter((d) => {
            if (vistos.has(d.id)) return false;
            vistos.add(d.id);
            return true;
          });
        };

        const results: any[] = [];
        unicos(osPorNumero, osPorPlaca, osPorCliente).forEach(doc => {
          const data = doc.data();
          results.push({
            type: 'OS',
            id: doc.id,
            title: `OS #${data.numeroOS || doc.id.substring(0,8).toUpperCase()} - Placa: ${data.placa?.toUpperCase()}`,
            subtitle: data.clienteNome,
            link: `/os/editar/${doc.id}`
          });
        });

        unicos(clientesPorDocumento, clientesPorNome).forEach(doc => {
          const data = doc.data();
          results.push({
            type: 'Cliente',
            id: doc.id,
            title: data.nome,
            subtitle: data.telefone || data.documento || 'Sem detalhes',
            link: `/clientes/editar/${doc.id}`
          });
        });

        unicos(produtosPorCodigo, produtosPorBarras, produtosPorNome).forEach(doc => {
          const data = doc.data() as SearchableProduct;
          // Produto inativado nunca aparece na busca (mesma regra de productMatchesSearch).
          if (data.ativo === false) return;
          results.push({
            type: 'Produto',
            id: doc.id,
            title: data.nome || 'Produto sem nome',
            subtitle: `Código: ${data.codigo || data.codigoBarras || data.skuSistema || '-'}`,
            link: `/estoque/editar/${doc.id}`
          });
        });

        setSearchResults(results.slice(0, 10)); // Top 10 results max
      } catch (error) {
        console.error(error);
      } finally {
        setIsSearching(false);
      }
    }, 500);

    return () => clearTimeout(debounceTimer);
  }, [searchTerm, currentUser, tenantId]);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  const goToResult = (link: string) => {
    setShowSearchDropdown(false);
    setSearchTerm('');
    openTab(link);
  };

  const goToLembretes = () => {
    setShowDropdown(false);
    openTab('/crm/lembretes', 'Alertas de Retorno');
  };

  const handleSupportClick = () => {
    setShowProfileDropdown(false);
    if (!SUPPORT_DESK_URL) {
      alert('Link da plataforma de suporte ainda não configurado.');
      return;
    }

    window.open(SUPPORT_DESK_URL, '_blank', 'noopener,noreferrer');
  };

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button 
          className="mobile-menu-btn" 
          onClick={() => document.body.classList.toggle('mobile-sidebar-open')}
          style={{ display: 'none' }}
        >
          <Menu size={24} />
        </button>
        <div className="topbar-search" ref={searchRef}>
          <Search className="search-icon" size={18} />
        <input 
          type="text" 
          placeholder="Buscar OS, cliente, venda ou produto..."
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
        {isPlatformAdmin && (
          <button
            className="action-btn"
            onClick={() => navigate('/superadmin')}
            title="Abrir o Painel da Plataforma"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent-purple)' }}
          >
            <ShieldCheck size={20} />
          </button>
        )}

        {isPlatformAdmin && (
          <div className="tenant-switcher">
            <span>Empresa ativa</span>
            <select
              value={selectedTenant?.id || ''}
              onChange={(event) => setActiveTenantId(event.target.value)}
            >
              <option value="" disabled>Selecionar</option>
              {tenantOptions.map(tenant => (
                <option key={tenant.id} value={tenant.id}>{tenant.nomeOficina}</option>
              ))}
            </select>
          </div>
        )}

        <FilialSeletor />

        <button
          className="action-btn theme-toggle-btn" 
          onClick={toggleTheme}
          title={tituloDoBotaoDeTema(temaPreferido, aparelhoEscuro)}
          aria-label={tituloDoBotaoDeTema(temaPreferido, aparelhoEscuro)}
        >
          {temaPreferido === 'dark' ? <Sun size={20} /> : temaPreferido === 'light' ? <SunMoon size={20} /> : <Moon size={20} />}
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
                      display: 'flex', gap: '12px', cursor: 'pointer', transition: 'background 0.2s', position: 'relative'
                    }}
                    onClick={() => {
                      if (notif.tipoLogico === 'agendamento') openTab('/crm/agenda', 'Agendamentos');
                      else if (notif.tipoLogico === 'conta_pagar') openTab('/financeiro/contas-pagar', 'Contas a Pagar');
                      else openTab('/crm/lembretes', 'Alertas de Retorno');
                      setShowDropdown(false);
                    }}
                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'}
                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: notif.tipoLogico === 'conta_pagar' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(139, 92, 246, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: notif.tipoLogico === 'conta_pagar' ? '#ef4444' : '#8b5cf6', flexShrink: 0 }}>
                        {notif.tipoLogico === 'conta_pagar' ? <Receipt size={16} /> : <Calendar size={16} />}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <span style={{ fontSize: '10px', backgroundColor: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '4px', color: 'var(--text-muted)', fontWeight: 'bold', textTransform: 'uppercase' }}>
                            {notif.labelTipo}
                          </span>
                        </div>
                        <p style={{ margin: '0 0 4px 0', fontSize: '13px', fontWeight: 600, paddingRight: '20px' }}>{notif.veiculo}</p>
                        <p style={{ margin: '0 0 4px 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                          {notif.tipoLogico === 'conta_pagar' ? `Categoria: ${notif.clienteNome}` : `Cliente: ${notif.clienteNome}`}
                        </p>
                        <p style={{ margin: 0, fontSize: '11px', color: notif.tipoLogico === 'conta_pagar' ? '#ef4444' : '#f59e0b', fontWeight: 500 }}>
                          {notif.tipoLogico === 'conta_pagar' ? 'Vence Hoje' : `Faltam ${notif.diasRestantes} dias`}
                        </p>
                      </div>
                      
                      {notif.tipoLogico === 'conta_pagar' && (
                        <button 
                          onClick={(e) => handleDismissNotification(e, notif.id)}
                          style={{ position: 'absolute', top: '16px', right: '16px', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%' }}
                          title="Remover aviso"
                          onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                          onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                        >
                          <X size={14} />
                        </button>
                      )}
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
              <span className="profile-name">{userNome || userData?.nome || configData?.nomeUsuario || 'Administrador'}</span>
              <span className="profile-role">{selectedTenant?.nomeOficina || configData?.nomeOficina || 'Empresa Logada'}</span>
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
                <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '14px' }}>{userNome || userData?.nome || configData?.nomeUsuario || 'Administrador'}</span>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{currentUser?.email || 'Usuário do Sistema'}</span>
              </div>
              
              <div style={{ padding: '8px' }}>
                <button 
                  onClick={() => { setShowProfileDropdown(false); setShowPerfilModal(true); }}
                  style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', padding: '10px 12px', background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', borderRadius: 'var(--radius-md)', transition: 'background 0.2s', textAlign: 'left', fontSize: '13px' }}
                  onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                  onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                >
                  <User size={16} /> Meu Perfil
                </button>

                {(isPlatformAdmin || isTenantManagerRole(userRole) || userPermissions?.includes('administrativo.config')) && (
                  <button 
                    onClick={() => { setShowProfileDropdown(false); openTab('/configuracoes', 'Configurações'); }}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', padding: '10px 12px', background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', borderRadius: 'var(--radius-md)', transition: 'background 0.2s', textAlign: 'left', fontSize: '13px' }}
                    onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                    onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                  >
                    <Settings size={16} /> Configurações
                  </button>
                )}
                <button 
                  onClick={handleSupportClick}
                  style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', padding: '10px 12px', background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', borderRadius: 'var(--radius-md)', transition: 'background 0.2s', textAlign: 'left', fontSize: '13px' }}
                  onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                  onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                >
                  <LifeBuoy size={16} /> Suporte
                </button>
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
