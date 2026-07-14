import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, getDocs, startAfter, where, Timestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { createAuditLog, runLogsCleanup } from '../../services/logService';
import { ShieldAlert, Search, Calendar, Filter, Loader2, Info, Lock, KeyRound } from 'lucide-react';
import { showError, showSuccess } from '../../utils/alerts';
import { isPlatformAdminRole } from '../../utils/roles';

interface LogDocument {
  id: string;
  dataHora: any;
  usuario: string;
  usuarioId: string;
  modulo: string;
  acao: string;
  descricao: string;
  registroRelacionadoId?: string;
  valorAnterior?: string;
  valorNovo?: string;
  status: 'sucesso' | 'erro' | 'negado';
  critical?: boolean;
}

const LogsSistema: React.FC = () => {
  const { currentUser, tenantId, userRole, userPermissions, isOwner } = useAuth();
  
  // Acesso e Autenticação da Tela
  const [authorized, setAuthorized] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [hasPermission, setHasPermission] = useState(true);

  // States dos Logs
  const [logs, setLogs] = useState<LogDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastVisibleDoc, setLastVisibleDoc] = useState<any>(null);
  const [hasMore, setHasMore] = useState(true);

  // Filtros
  const [moduloFilter, setModuloFilter] = useState('todos');
  const [acaoFilter, setAcaoFilter] = useState('todos');
  const [statusFilter, setStatusFilter] = useState('todos');
  const [searchUser, setSearchUser] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Modal de Detalhes
  const [selectedLog, setSelectedLog] = useState<LogDocument | null>(null);

  // Verificar permissão geral do módulo
  useEffect(() => {
    if (userRole === null) return; // Aguarda o carregamento da role

    const allowed = isOwner || isPlatformAdminRole(userRole) || userPermissions?.includes('administrativo.logs');
    if (!allowed) {
      setHasPermission(false);
      if (currentUser && tenantId) {
        // Gravar tentativa de intrusão sem permissão
        createAuditLog({
          tenantId,
          usuarioId: currentUser.uid,
          usuarioEmail: currentUser.email || currentUser.uid,
          modulo: 'logs',
          acao: 'acesso_negado',
          descricao: `Tentativa de acesso à rota de logs do sistema sem permissão administrativa.`,
          status: 'negado',
          critical: true
        });
      }
    } else {
      setHasPermission(true);
    }
  }, [userRole, userPermissions, currentUser, tenantId]);

  // Limpeza automática dos logs em background após a autorização da tela
  useEffect(() => {
    if (authorized && tenantId) {
      runLogsCleanup(tenantId);
    }
  }, [authorized, tenantId]);

  // Carregar dados iniciais
  useEffect(() => {
    if (authorized && tenantId) {
      fetchLogs(true);
    }
  }, [authorized, tenantId, moduloFilter, acaoFilter, statusFilter, startDate, endDate]);

  const fetchLogs = async (isInitial = true) => {
    if (!tenantId) return;
    
    if (isInitial) {
      setLoading(true);
      setLogs([]);
    } else {
      setLoadingMore(true);
    }

    try {
      const logsRef = collection(db, 'empresas', tenantId, 'logs');
      
      // Montagem da query
      let q = query(logsRef, orderBy('dataHora', 'desc'));

      // Filtros a nível de banco
      if (moduloFilter !== 'todos') {
        q = query(q, where('modulo', '==', moduloFilter));
      }
      if (statusFilter !== 'todos') {
        q = query(q, where('status', '==', statusFilter));
      }
      if (acaoFilter !== 'todos') {
        q = query(q, where('acao', '==', acaoFilter));
      }

      // Filtros de datas a nível de banco
      if (startDate) {
        const sTimestamp = Timestamp.fromDate(new Date(startDate + 'T00:00:00'));
        q = query(q, where('dataHora', '>=', sTimestamp));
      }
      if (endDate) {
        const eTimestamp = Timestamp.fromDate(new Date(endDate + 'T23:59:59'));
        q = query(q, where('dataHora', '<=', eTimestamp));
      }

      // Paginação
      q = query(q, limit(50));

      if (!isInitial && lastVisibleDoc) {
        q = query(q, startAfter(lastVisibleDoc));
      }

      const querySnapshot = await getDocs(q);
      const fetchedLogs: LogDocument[] = [];
      
      querySnapshot.forEach(docSnap => {
        fetchedLogs.push({
          id: docSnap.id,
          ...docSnap.data()
        } as LogDocument);
      });

      // Salva o último documento para paginação posterior
      const lastVisible = querySnapshot.docs[querySnapshot.docs.length - 1] || null;
      setLastVisibleDoc(lastVisible);
      setHasMore(querySnapshot.docs.length === 50);

      if (isInitial) {
        setLogs(fetchedLogs);
      } else {
        setLogs(prev => [...prev, ...fetchedLogs]);
      }
    } catch (err: any) {
      console.error('Erro ao buscar logs:', err);
      // Se houver erro de index composto no firestore, avisa e cai de volta para query básica
      if (err.code === 'failed-precondition') {
        showError(
          'Índice Necessário',
          'Esta combinação de filtros requer que você crie um índice composto no painel do Firebase.'
        );
      } else {
        showError('Erro ao Carregar', 'Não foi possível recuperar os logs de auditoria.');
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const handleVerifyPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !tenantId) return;

    if (password === '6924') {
      setAuthorized(true);
      setPasswordError('');
      createAuditLog({
        tenantId,
        usuarioId: currentUser.uid,
        usuarioEmail: currentUser.email || currentUser.uid,
        modulo: 'logs',
        acao: 'acesso_autorizado',
        descricao: 'Acesso autorizado à tela de logs do sistema.',
        status: 'sucesso',
        critical: true
      });
    } else {
      setPasswordError('Senha incorreta! A tentativa foi gravada nos logs de auditoria.');
      createAuditLog({
        tenantId,
        usuarioId: currentUser.uid,
        usuarioEmail: currentUser.email || currentUser.uid,
        modulo: 'logs',
        acao: 'senha_incorreta',
        descricao: `Tentativa falha de entrada no painel de auditoria utilizando a senha: ${password || 'vazia'}.`,
        status: 'negado',
        critical: true
      });
    }
  };

  // Filtro de Busca de Usuário (executado no cliente por flexibilidade e performance)
  const filteredLogs = logs.filter(log => {
    if (!searchUser) return true;
    return log.usuario.toLowerCase().includes(searchUser.toLowerCase());
  });

  const formatTimestamp = (ts: any) => {
    if (!ts) return 'N/A';
    const date = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
    return date.toLocaleString('pt-BR');
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'sucesso': return '#10b981';
      case 'erro': return '#ef4444';
      case 'negado': return '#f59e0b';
      default: return '#6b7280';
    }
  };

  const getModuloBadgeColor = (modulo: string) => {
    switch (modulo) {
      case 'autenticacao': return 'rgba(59, 130, 246, 0.15)';
      case 'vendas': return 'rgba(245, 158, 11, 0.15)';
      case 'estoque': return 'rgba(139, 92, 246, 0.15)';
      case 'financeiro': return 'rgba(16, 185, 129, 0.15)';
      case 'logs': return 'rgba(239, 68, 68, 0.15)';
      default: return 'rgba(107, 114, 128, 0.15)';
    }
  };

  if (!hasPermission) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', color: 'var(--text-primary)', textAlign: 'center', padding: '20px' }}>
        <ShieldAlert size={64} color="#ef4444" style={{ marginBottom: '16px', filter: 'drop-shadow(0 0 10px rgba(239,68,68,0.3))' }} />
        <h2 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '8px' }}>Acesso Negado</h2>
        <p style={{ color: 'var(--text-muted)', maxWidth: '400px' }}>Você não tem permissão para visualizar a tela de auditoria e logs do sistema.</p>
      </div>
    );
  }

  // Tela de verificação de senha
  if (!authorized) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '65vh', padding: '20px' }}>
        <div style={{
          width: '100%',
          maxWidth: '420px',
          backgroundColor: 'var(--bg-secondary)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-color)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          overflow: 'hidden'
        }}>
          <div style={{
            background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-blue))',
            padding: '24px',
            textAlign: 'center',
            color: 'white'
          }}>
            <Lock size={36} style={{ marginBottom: '12px' }} />
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700 }}>Acesso Protegido</h2>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', opacity: 0.8 }}>Digite a chave de segurança para abrir a auditoria.</p>
          </div>

          <form onSubmit={handleVerifyPassword} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {passwordError && (
              <div style={{
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '8px',
                padding: '12px',
                color: '#ef4444',
                fontSize: '13px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <Info size={16} />
                <span>{passwordError}</span>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>Senha de Acesso</label>
              <div style={{ position: 'relative' }}>
                <KeyRound size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Informe a senha de 4 dígitos"
                  style={{
                    width: '100%',
                    padding: '12px 12px 12px 38px',
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    color: 'white',
                    fontSize: '14px',
                    outline: 'none',
                    transition: 'border-color 0.2s'
                  }}
                  autoFocus
                />
              </div>
            </div>

            <button type="submit" style={{
              width: '100%',
              padding: '12px',
              backgroundColor: 'var(--accent-purple)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'opacity 0.2s',
              marginTop: '8px'
            }}
            onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
            onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
            >
              Liberar Painel
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', color: 'var(--text-primary)' }}>
      {/* Cabeçalho */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldAlert size={28} color="var(--accent-purple)" />
            Logs de Auditoria do Sistema
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Auditoria, segurança e rastreabilidade de ações importantes realizadas no sistema.</p>
        </div>
      </div>

      {/* Painel de Filtros */}
      <div style={{
        backgroundColor: 'var(--bg-secondary)',
        borderRadius: 'var(--radius-md)',
        padding: '20px',
        border: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px'
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
          {/* Busca por Usuário */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>Buscar por Usuário</label>
            <div style={{ position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="E-mail ou ID do usuário..."
                value={searchUser}
                onChange={(e) => setSearchUser(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 10px 10px 36px',
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  color: 'white',
                  fontSize: '13px'
                }}
              />
            </div>
          </div>

          {/* Filtro Módulo */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>Módulo</label>
            <select
              value={moduloFilter}
              onChange={(e) => setModuloFilter(e.target.value)}
              style={{
                width: '100%',
                padding: '10px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                color: 'white',
                fontSize: '13px',
                cursor: 'pointer'
              }}
            >
              <option value="todos">Todos Módulos</option>
              <option value="autenticacao">Autenticação (Acesso)</option>
              <option value="vendas">Vendas e Orçamentos</option>
              <option value="estoque">Estoque de Peças</option>
              <option value="financeiro">Financeiro / Caixa</option>
              <option value="logs">Painel de Logs</option>
            </select>
          </div>

          {/* Filtro Ação */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>Ação</label>
            <select
              value={acaoFilter}
              onChange={(e) => setAcaoFilter(e.target.value)}
              style={{
                width: '100%',
                padding: '10px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                color: 'white',
                fontSize: '13px',
                cursor: 'pointer'
              }}
            >
              <option value="todos">Todas Ações</option>
              <option value="login">Login</option>
              <option value="logout">Logout</option>
              <option value="criacao">Criação (Adicionar)</option>
              <option value="edicao">Edição (Editar)</option>
              <option value="exclusao">Exclusão (Apagar)</option>
              <option value="cancelamento">Cancelamento</option>
              <option value="devolucao">Devolução</option>
              <option value="acesso_negado">Acesso Negado</option>
              <option value="senha_incorreta">Senha Incorreta</option>
            </select>
          </div>

          {/* Filtro Status */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{
                width: '100%',
                padding: '10px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                color: 'white',
                fontSize: '13px',
                cursor: 'pointer'
              }}
            >
              <option value="todos">Todos Status</option>
              <option value="sucesso">Sucesso</option>
              <option value="erro">Erro</option>
              <option value="negado">Negado / Bloqueado</option>
            </select>
          </div>
        </div>

        {/* Datas */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>De (Data Inicial)</label>
            <div style={{ position: 'relative' }}>
              <Calendar size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 10px 10px 36px',
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  color: 'white',
                  fontSize: '13px',
                  cursor: 'pointer'
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>Até (Data Final)</label>
            <div style={{ position: 'relative' }}>
              <Calendar size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 10px 10px 36px',
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  color: 'white',
                  fontSize: '13px',
                  cursor: 'pointer'
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', gridColumn: 'span 2' }}>
            <button
              onClick={() => {
                setModuloFilter('todos');
                setAcaoFilter('todos');
                setStatusFilter('todos');
                setSearchUser('');
                setStartDate('');
                setEndDate('');
              }}
              style={{
                padding: '10px 16px',
                backgroundColor: 'rgba(255,255,255,0.05)',
                color: 'white',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background-color 0.2s'
              }}
              onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)'}
              onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'}
            >
              Limpar Filtros
            </button>
          </div>
        </div>
      </div>

      {/* Tabela de Logs */}
      <div style={{
        backgroundColor: 'var(--bg-secondary)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-color)',
        overflow: 'hidden'
      }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px', gap: '12px' }}>
            <Loader2 className="spin-icon" size={32} color="var(--accent-purple)" />
            <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Consultando logs de auditoria...</span>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-muted)' }}>
            Nenhum registro de log encontrado para os filtros selecionados.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '800px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
                  <th style={{ padding: '16px 20px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: 600 }}>Data/Hora</th>
                  <th style={{ padding: '16px 20px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: 600 }}>Usuário</th>
                  <th style={{ padding: '16px 20px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: 600 }}>Módulo</th>
                  <th style={{ padding: '16px 20px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: 600 }}>Ação</th>
                  <th style={{ padding: '16px 20px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: 600 }}>Descrição</th>
                  <th style={{ padding: '16px 20px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: 600, width: '110px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => (
                  <tr
                    key={log.id}
                    onClick={() => setSelectedLog(log)}
                    style={{
                      borderBottom: '1px solid var(--border-color)',
                      cursor: 'pointer',
                      transition: 'background-color 0.2s',
                    }}
                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.01)'}
                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <td style={{ padding: '16px 20px', fontSize: '13px', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                      {formatTimestamp(log.dataHora)}
                    </td>
                    <td style={{ padding: '16px 20px', fontSize: '13px', color: 'white', fontWeight: 500 }}>
                      {log.usuario}
                    </td>
                    <td style={{ padding: '16px 20px', fontSize: '12px' }}>
                      <span style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        backgroundColor: getModuloBadgeColor(log.modulo),
                        color: log.modulo === 'logs' ? '#ef4444' : 'var(--text-primary)'
                      }}>
                        {log.modulo}
                      </span>
                    </td>
                    <td style={{ padding: '16px 20px', fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                      {log.acao}
                    </td>
                    <td style={{ padding: '16px 20px', fontSize: '13px', color: 'var(--text-muted)', maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {log.descricao}
                    </td>
                    <td style={{ padding: '16px 20px', fontSize: '13px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{
                          display: 'inline-block',
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          backgroundColor: getStatusColor(log.status)
                        }} />
                        <span style={{ fontSize: '12px', fontWeight: 600, color: getStatusColor(log.status), textTransform: 'capitalize' }}>
                          {log.status}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Paginação */}
        {hasMore && !loading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '20px', borderTop: '1px solid var(--border-color)' }}>
            <button
              onClick={() => fetchLogs(false)}
              disabled={loadingMore}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 24px',
                backgroundColor: 'var(--accent-purple)',
                color: 'white',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'opacity 0.2s'
              }}
              onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
              onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
            >
              {loadingMore ? (
                <>
                  <Loader2 className="spin-icon" size={16} />
                  <span>Carregando...</span>
                </>
              ) : (
                <span>Carregcar Mais Logs</span>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Modal de Detalhes do Log (Apenas Leitura) */}
      {selectedLog && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '20px'
        }}
        onClick={() => setSelectedLog(null)}
        >
          <div style={{
            width: '100%',
            maxWidth: '650px',
            backgroundColor: 'var(--bg-secondary)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-color)',
            boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
            overflow: 'hidden'
          }}
          onClick={(e) => e.stopPropagation()}
          >
            <div style={{
              background: 'linear-gradient(135deg, var(--bg-tertiary), var(--bg-secondary))',
              padding: '20px 24px',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ShieldAlert size={20} color="var(--accent-purple)" />
                Detalhes da Auditoria
              </h3>
              <button
                onClick={() => setSelectedLog(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: '20px',
                  cursor: 'pointer',
                  padding: '4px'
                }}
              >
                &times;
              </button>
            </div>

            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Data / Hora</label>
                  <span style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: 500 }}>{formatTimestamp(selectedLog.dataHora)}</span>
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Usuário</label>
                  <span style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: 500 }}>{selectedLog.usuario}</span>
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Módulo</label>
                  <span style={{
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    backgroundColor: getModuloBadgeColor(selectedLog.modulo),
                    color: 'white',
                    display: 'inline-block'
                  }}>{selectedLog.modulo}</span>
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Ação</label>
                  <span style={{ fontSize: '14px', color: 'white', fontWeight: 600 }}>{selectedLog.acao}</span>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Descrição da Ocorrência</label>
                <div style={{
                  padding: '12px',
                  backgroundColor: 'var(--bg-primary)',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-secondary)',
                  fontSize: '13px',
                  lineHeight: '1.5'
                }}>
                  {selectedLog.descricao}
                </div>
              </div>

              {selectedLog.registroRelacionadoId && (
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>ID do Registro Relacionado</label>
                  <span style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-primary)' }}>{selectedLog.registroRelacionadoId}</span>
                </div>
              )}

              {selectedLog.critical && (
                <div style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  borderRadius: '8px',
                  padding: '12px',
                  fontSize: '12px',
                  color: '#ef4444',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <Info size={16} />
                  <span>Este é um registro crítico de segurança e auditoria (mantido permanentemente).</span>
                </div>
              )}
            </div>

            <div style={{
              padding: '16px 24px',
              backgroundColor: 'rgba(255,255,255,0.01)',
              borderTop: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'flex-end'
            }}>
              <button
                onClick={() => setSelectedLog(null)}
                style={{
                  padding: '8px 20px',
                  backgroundColor: 'var(--accent-purple)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Fechar Detalhes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LogsSistema;
