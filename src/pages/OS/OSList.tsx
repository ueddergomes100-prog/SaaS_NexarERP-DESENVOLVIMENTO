import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Filter, Printer, Edit, MessageCircle } from 'lucide-react';
import { collection, query, onSnapshot, where, doc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { isPlatformAdminRole } from '../../utils/roles';
import {
  DEFAULT_MOSTRAR_VALOR_LISTA_OS,
  formatarValorListaOS,
  parseMostrarValorListaOS,
} from '../../utils/osListaValorDomain';
import './OS.css';

interface OSData {
  id: string;
  numeroOS?: string;
  clienteNome: string;
  modelo: string;
  placa: string;
  status: string;
  statusColor: string;
  createdAt: any;
  clienteTelefone?: string;
  total?: number;
  /** Total da OS ja com o desconto abatido. Centavos e' a fonte boa; o campo
   *  em reais existe pra OS gravada antes dos centavos. */
  valorTotal?: number;
  valorTotalCentavos?: number;
}

const OSList: React.FC = () => {
  const navigate = useNavigate();
  const { openTab } = useTabs();
  const [osList, setOsList] = useState<OSData[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'Ativas' | 'Finalizadas' | 'Canceladas'>('Ativas');
  const [searchTerm, setSearchTerm] = useState('');
  /** Linha destacada por um clique simples. Abrir exige duplo clique (ou Enter). */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Configuracoes -> Ordem de Servico: mostrar o valor na lista. */
  const [mostrarValor, setMostrarValor] = useState(DEFAULT_MOSTRAR_VALOR_LISTA_OS);
  const { currentUser, tenantId, userRole, userPermissions, isOwner } = useAuth();

  const canEditOS = isOwner || isPlatformAdminRole(userRole) || (userPermissions && userPermissions.includes('mecanica.os_alterar'));

  useEffect(() => {
    if (!currentUser) return;
    const q = query(collection(db, 'ordens_de_servico'), where('tenantId', '==', tenantId));
    
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const osData: OSData[] = [];
      querySnapshot.forEach((doc) => {
        osData.push({ id: doc.id, ...doc.data() } as OSData);
      });
      // Sort in Javascript to avoid composite index requirement
      osData.sort((a, b) => {
        const dateA = a.createdAt?.seconds || 0;
        const dateB = b.createdAt?.seconds || 0;
        return dateB - dateA;
      });
      setOsList(osData);
      setLoading(false);
    }, (error) => {
      console.error("Erro ao buscar OS:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser]);

  // Ao vivo, como o resto das configuracoes: o dono liga/desliga em
  // Configuracoes e a lista acompanha sem ninguem precisar relogar.
  useEffect(() => {
    if (!tenantId) return;
    const unsubscribe = onSnapshot(doc(db, 'configuracoes', tenantId), (snap) => {
      setMostrarValor(parseMostrarValorListaOS(snap.exists() ? snap.data().mostrarValorListaOS : undefined));
    }, (error) => {
      // Falha de leitura MANTEM o que ja estava: piscar a coluna por causa de
      // uma queda de rede seria pior do que continuar mostrando.
      console.error('Erro ao carregar a configuracao de valor na lista de OS:', error);
    });

    return () => unsubscribe();
  }, [tenantId]);

  const handleOpenWhatsApp = (os: OSData) => {
    if (!os.clienteTelefone) {
      alert("Esta Ordem de Serviço não possui telefone de cliente vinculado.");
      return;
    }
    
    // Limpar telefone (remover não numéricos)
    const telLimpado = os.clienteTelefone.replace(/\D/g, '');
    if (telLimpado.length < 10) {
      alert("Número de telefone inválido.");
      return;
    }

    const mensagem = encodeURIComponent(
      `Olá, ${os.clienteNome}! Tudo bem?\n\n` +
      `Somos da Hennder ERP. Gostaríamos de atualizar sobre o serviço do seu ${os.modelo || 'veículo'} (Placa: ${os.placa.toUpperCase()}).\n` +
      `O status atual da sua OS #${os.numeroOS || os.id.substring(0,8).toUpperCase()} é: *${os.status}*.\n\n` +
      `Acesse seu orçamento/OS neste link: (Link do PDF aqui)`
    );

    window.open(`https://wa.me/55${telLimpado}?text=${mensagem}`, '_blank');
  };

  const filteredOsList = osList.filter(os => {
    const matchesTab = activeTab === 'Canceladas'
      ? os.status === 'Cancelada'
      : activeTab === 'Finalizadas'
        ? os.status === 'Finalizada'
        : os.status !== 'Cancelada' && os.status !== 'Finalizada';

    if (!matchesTab) return false;
    if (!searchTerm) return true;

    const term = searchTerm.toLowerCase();
    return (
      (os.clienteNome && os.clienteNome.toLowerCase().includes(term)) ||
      (os.placa && os.placa.toLowerCase().includes(term)) ||
      (os.numeroOS && os.numeroOS.toLowerCase().includes(term))
    );
  });

  return (
    <div className="os-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Ordens de Serviço</h1>
          <p className="page-subtitle">Gerencie ordens de serviço e atendimentos da empresa</p>
        </div>
        <button 
          className="btn-primary"
          onClick={() => openTab('/os/nova')}
        >
          <Plus size={18} style={{ marginRight: 8 }} />
          Nova OS
        </button>
      </div>

      <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
        <button 
          onClick={() => setActiveTab('Ativas')}
          style={{ 
            padding: '10px 20px', 
            borderRadius: 'var(--radius-md)', 
            border: 'none', 
            cursor: 'pointer',
            backgroundColor: activeTab === 'Ativas' ? 'var(--accent-purple)' : 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            fontWeight: 600
          }}
        >
          Em Andamento
        </button>
        <button 
          onClick={() => setActiveTab('Finalizadas')}
          style={{ 
            padding: '10px 20px', 
            borderRadius: 'var(--radius-md)', 
            border: 'none', 
            cursor: 'pointer',
            backgroundColor: activeTab === 'Finalizadas' ? '#10b981' : 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            fontWeight: 600
          }}
        >
          Finalizadas
        </button>
        <button 
          onClick={() => setActiveTab('Canceladas')}
          style={{ 
            padding: '10px 20px', 
            borderRadius: 'var(--radius-md)', 
            border: 'none', 
            cursor: 'pointer',
            backgroundColor: activeTab === 'Canceladas' ? '#ef4444' : 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            fontWeight: 600
          }}
        >
          Canceladas
        </button>
      </div>

      <div className="card list-container">
        <div className="list-toolbar">
          <div className="search-box">
            <Search size={18} className="search-icon" />
            <input 
              type="text" 
              placeholder="Buscar por placa, cliente ou nº OS..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button className="btn-secondary filter-btn">
            <Filter size={18} style={{ marginRight: 8 }} />
            Filtros
          </button>
        </div>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nº OS</th>
                <th>Cliente</th>
                <th>Veículo</th>
                <th>Placa</th>
                <th>Status</th>
                {mostrarValor && <th style={{ textAlign: 'right' }}>Valor</th>}
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={mostrarValor ? 7 : 6} style={{ textAlign: 'center', padding: '20px' }}>Carregando Ordens de Serviço...</td>
                </tr>
              ) : filteredOsList.length === 0 ? (
                <tr>
                  <td colSpan={mostrarValor ? 7 : 6} style={{ textAlign: 'center', padding: '20px' }}>
                    {searchTerm ? `Nenhum resultado encontrado para "${searchTerm}".` : "Nenhuma Ordem de Serviço encontrada nesta aba."}
                  </td>
                </tr>
              ) : (
                filteredOsList.map((os) => (
                  <tr
                    key={os.id}
                    // Sem permissao de alterar OS a linha nao abre nada -- seria
                    // um duplo clique que so devolve erro.
                    className={canEditOS ? (selectedId === os.id ? 'row-selectable is-selected' : 'row-selectable') : undefined}
                    onClick={canEditOS ? () => setSelectedId(os.id) : undefined}
                    onDoubleClick={canEditOS ? () => openTab(`/os/editar/${os.id}`) : undefined}
                    onKeyDown={canEditOS ? (event) => {
                      if (event.key === 'Enter') openTab(`/os/editar/${os.id}`);
                    } : undefined}
                    tabIndex={canEditOS ? 0 : undefined}
                    title={canEditOS ? 'Clique para selecionar, duplo clique para editar' : undefined}
                  >
                    <td className="font-medium" style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
                      #{os.numeroOS || os.id.substring(0, 8).toUpperCase()}
                    </td>
                    <td>{os.clienteNome}</td>
                    <td>{os.modelo || '-'}</td>
                    <td style={{ textTransform: 'uppercase' }}>{os.placa}</td>
                    <td>
                      <span className="status-badge" style={{ backgroundColor: `${os.statusColor}20`, color: os.statusColor }}>
                        <span className="status-dot" style={{ backgroundColor: os.statusColor }}></span>
                        {os.status}
                      </span>
                    </td>
                    {mostrarValor && (
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <span className="os-valor-chip">{formatarValorListaOS(os)}</span>
                      </td>
                    )}
                    <td>
                      <div style={{ display: 'flex', gap: '8px' }} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                        <button
                          className="icon-btn"
                          onClick={() => handleOpenWhatsApp(os)}
                          title="Enviar por WhatsApp"
                          style={{ color: '#10b981' }}
                        >
                          <MessageCircle size={18} />
                        </button>
                        {canEditOS && (
                          <button 
                            className="icon-btn" 
                            onClick={() => openTab(`/os/editar/${os.id}`)}
                            title="Editar OS"
                          >
                            <Edit size={18} />
                          </button>
                        )}
                        <button 
                          className="icon-btn" 
                          onClick={() => navigate(`/os/print/${os.id}`)}
                          title="Imprimir OS"
                        >
                          <Printer size={18} />
                        </button>
                      </div>
                    </td>
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

export default OSList;
