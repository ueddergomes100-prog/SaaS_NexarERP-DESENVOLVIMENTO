import React, { useState, useEffect } from 'react';
import { 
  Database, 
  Play, 
  Settings, 
  Download, 
  RefreshCw, 
  Trash2, 
  Clock, 
  Cloud, 
  Server, 
  Search,
  Building,
  HardDrive
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { isPlatformAdminRole } from '../../utils/roles';
import Swal from 'sweetalert2';

interface BackupRecord {
  id: string;
  companyId: string;
  companyName: string;
  filename: string;
  sizeBytes: number;
  status: 'enviado' | 'pendente' | 'erro' | 'restaurado' | 'gerando' | 'local';
  createdAt: string;
  tableCounts: Record<string, number>;
  restauradoEm?: string;
  restauradoPor?: string;
  error?: string;
}

interface TenantInfo {
  id: string;
  nomeOficina: string;
  email: string;
}

const SuperAdminBackup: React.FC = () => {
  const { userRole, tenantId, currentUser } = useAuth();
  
  const [tenants, setTenants] = useState<TenantInfo[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<string>('');
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  
  // Configurações do backup automático
  const [autoEnabled, setAutoEnabled] = useState<boolean>(false);
  const [autoFrequency, setAutoFrequency] = useState<'diario' | 'semanal' | 'mensal'>('diario');
  const [autoTime, setAutoTime] = useState<string>('02:00');
  const [autoKeepCount, setAutoKeepCount] = useState<number>(7);

  const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
  const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

  // Redireciona ou impede acesso se não for Admin ou SuperAdmin
  const isSuperAdmin = isPlatformAdminRole(userRole);
  
  useEffect(() => {
    if (tenantId) {
      setSelectedTenant(tenantId);
    }
  }, [tenantId]);

  useEffect(() => {
    if (currentUser) {
      if (isSuperAdmin) {
        fetchTenants();
      }
      fetchBackupsAndSettings();
    }
  }, [currentUser, selectedTenant]);

  const ensureApiUrl = () => {
    if (API_URL) return true;

    Swal.fire(
      'Backend não configurado',
      'Configure VITE_BACKEND_API_URL no ambiente de produção para usar backup e restauração.',
      'error'
    );
    return false;
  };

  const getAuthHeaders = async (): Promise<Record<string, string>> => {
    if (!currentUser) {
      throw new Error('Usuário não autenticado.');
    }

    const token = await currentUser.getIdToken();
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  };

  const getApiError = async (res: Response, fallback: string) => {
    try {
      const errData = await res.json();
      return errData.error || fallback;
    } catch {
      return fallback;
    }
  };

  const fetchTenants = async () => {
    if (!ensureApiUrl()) return;

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_URL}/api/backups/tenants`, { headers });
      if (res.ok) {
        const data = await res.json();
        setTenants(data);
        if (data.length > 0 && !selectedTenant) {
          setSelectedTenant(data[0].id);
        }
      }
    } catch (err) {
      console.error('Erro ao buscar empresas:', err);
    }
  };

  const fetchBackupsAndSettings = async () => {
    if (!selectedTenant) return;
    if (!ensureApiUrl()) return;

    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      
      // 1. Busca Histórico
      const resHistory = await fetch(`${API_URL}/api/backups/history?tenantId=${encodeURIComponent(selectedTenant)}`, { headers });
      if (resHistory.ok) {
        const historyData = await resHistory.json();
        setBackups(historyData);
      }

      // 2. Busca Configuração do Backup Automático
      const resSettings = await fetch(`${API_URL}/api/backups/settings?tenantId=${encodeURIComponent(selectedTenant)}`, { headers });
      if (resSettings.ok) {
        const settingsData = await resSettings.json();
        setAutoEnabled(settingsData.enabled);
        setAutoFrequency(settingsData.frequency);
        setAutoTime(settingsData.time);
        setAutoKeepCount(settingsData.keepCount);
      }
    } catch (err) {
      console.error('Erro ao carregar dados:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateBackup = async () => {
    if (!selectedTenant) return;
    
    const tenantName = isSuperAdmin 
      ? tenants.find(t => t.id === selectedTenant)?.nomeOficina || 'a empresa selecionada'
      : 'sua empresa';

    const result = await Swal.fire({
      title: 'Confirmar Backup',
      text: `Deseja gerar um novo backup criptografado completo para ${tenantName} agora?`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#8b5cf6',
      cancelButtonColor: '#3b82f6',
      confirmButtonText: 'Sim, gerar agora!',
      cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
      if (!ensureApiUrl()) return;

      setActionLoading(true);
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${API_URL}/api/backups/generate`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ tenantId: selectedTenant })
        });

        if (res.ok) {
          Swal.fire({
            title: 'Backup Iniciado!',
            text: 'A rotina foi disparada em segundo plano. Ela extrairá todos os dados, comprimirá com Gzip, aplicará criptografia AES-256 e fará o envio ao Google Cloud Storage. A lista será atualizada automaticamente.',
            icon: 'success',
            confirmButtonColor: '#8b5cf6'
          });
          // Recarrega a tabela após 3 segundos
          setTimeout(fetchBackupsAndSettings, 3000);
        } else {
          Swal.fire('Erro', await getApiError(res, 'Não foi possível disparar o backup.'), 'error');
        }
      } catch (err) {
        Swal.fire('Erro de Conexão', 'O servidor de backup está offline ou inacessível.', 'error');
      } finally {
        setActionLoading(false);
      }
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenant) return;

    setActionLoading(true);
    try {
      if (!ensureApiUrl()) return;

      const headers = await getAuthHeaders();
      const res = await fetch(`${API_URL}/api/backups/settings`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tenantId: selectedTenant,
          enabled: autoEnabled,
          frequency: autoFrequency,
          time: autoTime,
          keepCount: autoKeepCount
        })
      });

      if (res.ok) {
        Swal.fire({
          title: 'Configurações Salvas!',
          text: 'O agendador do servidor Express foi reconfigurado dinamicamente para aplicar o novo horário e frequência do cron job.',
          icon: 'success',
          confirmButtonColor: '#8b5cf6'
        });
        fetchBackupsAndSettings();
      } else {
        Swal.fire('Erro', await getApiError(res, 'Erro ao salvar configurações.'), 'error');
      }
    } catch (err) {
      Swal.fire('Erro', 'Não foi possível conectar ao servidor de backup.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDownload = async (backup: BackupRecord) => {
    if (!ensureApiUrl()) return;

    setActionLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_URL}/api/backups/download?backupId=${encodeURIComponent(backup.id)}`, {
        headers
      });

      if (!res.ok) {
        Swal.fire('Erro', await getApiError(res, 'Não foi possível baixar o backup.'), 'error');
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = backup.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      Swal.fire('Erro', 'Não foi possível baixar o backup do servidor.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRestore = async (backup: BackupRecord) => {
    const result = await Swal.fire({
      title: 'ATENÇÃO CRÍTICA!',
      html: `<div style="text-align: left;">
              <p>Você está prestes a restaurar a base de dados a partir do arquivo <strong>${backup.filename}</strong>.</p>
              <p style="color: #ef4444; font-weight: bold;">⚠️ Isso irá SUBSTITUIR COMPLETAMENTE os dados atuais desta empresa no sistema!</p>
              <p>Por segurança, o sistema fará um <strong>backup automático de emergência (salvaguarda)</strong> do estado atual antes da restauração.</p>
             </div>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#3b82f6',
      confirmButtonText: 'Sim, restaurar agora!',
      cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
      if (!ensureApiUrl()) return;

      setActionLoading(true);
      // Exibe loading persistente durante a restauração já que pode demorar alguns segundos
      Swal.fire({
        title: 'Restaurando Base de Dados...',
        text: 'Aguarde. O sistema está gerando o backup de emergência, descriptografando o arquivo, validando a assinatura SHA-256 e executando a restauração em transações no Firestore.',
        allowOutsideClick: false,
        didOpen: () => {
          Swal.showLoading();
        }
      });

      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${API_URL}/api/backups/restore`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ backupId: backup.id })
        });

        Swal.close();

        if (res.ok) {
          const resData = await res.json();
          Swal.fire({
            title: 'Restauração Concluída!',
            html: `<div style="text-align: left; font-size: 14px;">
                    <p>Os dados foram restaurados com absoluto sucesso!</p>
                    <p>🟢 Um backup de segurança com o estado anterior foi salvo automaticamente como: <strong>${resData.safetyBackup}</strong>.</p>
                   </div>`,
            icon: 'success',
            confirmButtonColor: '#8b5cf6'
          });
          fetchBackupsAndSettings();
        } else {
          Swal.fire('Erro na Restauração', await getApiError(res, 'Erro crítico durante o processo.'), 'error');
        }
      } catch (err) {
        Swal.close();
        Swal.fire('Erro de Conexão', 'O servidor Express não respondeu. Operação cancelada.', 'error');
      } finally {
        setActionLoading(false);
      }
    }
  };

  const handleDelete = async (backupId: string) => {
    const result = await Swal.fire({
      title: 'Excluir Backup?',
      text: 'Tem certeza que deseja apagar definitivamente este backup da nuvem do Google Cloud Storage? Essa ação não pode ser desfeita.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#3b82f6',
      confirmButtonText: 'Sim, excluir!',
      cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
      if (!ensureApiUrl()) return;

      setActionLoading(true);
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${API_URL}/api/backups/remove`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ backupId })
        });

        if (res.ok) {
          Swal.fire('Excluído!', 'O arquivo de backup foi removido da nuvem com sucesso.', 'success');
          fetchBackupsAndSettings();
        } else {
          Swal.fire('Erro', await getApiError(res, 'Erro ao remover backup.'), 'error');
        }
      } catch (err) {
        Swal.fire('Erro', 'Não foi possível conectar ao servidor de backup.', 'error');
      } finally {
        setActionLoading(false);
      }
    }
  };

  // Filtragem local
  const filteredBackups = backups.filter(b => 
    b.filename.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (b.companyName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    b.status.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalSpaceUsedBytes = backups
    .filter(b => b.status === 'enviado')
    .reduce((acc, curr) => acc + curr.sizeBytes, 0);
  
  const freeTierLimitBytes = 5 * 1024 * 1024 * 1024; // 5 GB
  const percentageSpaceUsed = Math.min((totalSpaceUsedBytes / freeTierLimitBytes) * 100, 100);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', backgroundColor: 'var(--bg-primary)', padding: '24px', borderRadius: '16px' }}>
      
      {/* Cabeçalho */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: '32px', fontWeight: 800, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-primary)' }}>
            <Database size={36} color="#8b5cf6" />
            Backup e Restauração Segura
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '16px' }}>
            Central de segurança de dados do SaaS. Backups automatizados, criptografados (AES-256) e armazenados no Google Cloud.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button 
            className="btn-secondary" 
            onClick={fetchBackupsAndSettings}
            disabled={loading || actionLoading}
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Atualizar Painel
          </button>
          <button 
            className="btn-primary" 
            onClick={handleGenerateBackup}
            disabled={loading || actionLoading || !selectedTenant}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: 'var(--accent-purple)' }}
          >
            <Play size={16} />
            Gerar Backup Agora
          </button>
        </div>
      </div>

      {/* Seleção de Empresa para SuperAdmin */}
      {isSuperAdmin && (
        <div className="card" style={{ padding: '20px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <Building size={20} color="#8b5cf6" />
          <span style={{ fontWeight: 600, color: 'var(--text-primary)', minWidth: '150px' }}>Selecione a Empresa/Cliente:</span>
          <select 
            value={selectedTenant}
            onChange={(e) => setSelectedTenant(e.target.value)}
            style={{ flex: 1, padding: '10px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
          >
            <option value="">-- Selecione uma Empresa --</option>
            {tenants.map(t => (
              <option key={t.id} value={t.id}>{t.nomeOficina} ({t.email})</option>
            ))}
          </select>
        </div>
      )}

      {/* Grid de Informações Rápidas e Configurações */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '24px' }}>
        
        {/* Lado Esquerdo: Widgets Rápidos */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* Card Espaço Armazenamento */}
          <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <span style={{ fontSize: '15px', color: 'var(--text-muted)', fontWeight: 500 }}>Espaço na Nuvem (GCS)</span>
              <HardDrive size={20} color="#10b981" />
            </div>
            <h3 style={{ fontSize: '28px', fontWeight: 800, margin: '0 0 12px 0' }}>
              {(totalSpaceUsedBytes / (1024 * 1024)).toFixed(2)} MB <span style={{ fontSize: '14px', color: 'var(--text-muted)', fontWeight: 500 }}>/ 5.0 GB grátis</span>
            </h3>
            
            {/* Barra de Progresso */}
            <div style={{ width: '100%', height: '8px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px', overflow: 'hidden', marginBottom: '8px' }}>
              <div style={{ width: `${percentageSpaceUsed}%`, height: '100%', backgroundColor: '#10b981', borderRadius: '4px', transition: 'width 0.5s ease-in-out' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-muted)' }}>
              <span>Consumido: {percentageSpaceUsed.toFixed(3)}%</span>
              <span>100% grátis</span>
            </div>
          </div>

          {/* Card Status do Módulo */}
          <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <span style={{ fontSize: '15px', color: 'var(--text-muted)', fontWeight: 500 }}>Backup Automático</span>
              <Clock size={20} color={autoEnabled ? '#10b981' : '#f59e0b'} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: autoEnabled ? '#10b981' : 'var(--text-muted)', animation: autoEnabled ? 'pulse 2s infinite' : 'none' }} />
              <h3 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>
                {autoEnabled ? 'Rotina Ativa' : 'Desativado'}
              </h3>
            </div>
            {autoEnabled && (
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                Frequência: <strong style={{ color: 'var(--text-primary)' }}>{autoFrequency === 'diario' ? 'Diária' : autoFrequency === 'semanal' ? 'Semanal' : 'Mensal'}</strong><br />
                Horário de Execução: <strong style={{ color: 'var(--text-primary)' }}>{autoTime}</strong> (em segundo plano).
              </p>
            )}
          </div>

        </div>

        {/* Lado Direito: Formulário de Configuração do Backup Automático */}
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Settings size={20} color="#8b5cf6" />
            Configurar Rotina Automática de Segurança
          </h3>
          
          <form onSubmit={handleSaveSettings} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
              <input 
                type="checkbox" 
                id="autoEnabled" 
                checked={autoEnabled}
                onChange={(e) => setAutoEnabled(e.target.checked)}
                style={{ width: '20px', height: '20px', accentColor: '#8b5cf6', cursor: 'pointer' }}
              />
              <label htmlFor="autoEnabled" style={{ fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer' }}>
                Ativar rotina de backup recorrente automático
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: 500 }}>Frequência do Backup</label>
                <select 
                  value={autoFrequency}
                  disabled={!autoEnabled}
                  onChange={(e) => setAutoFrequency(e.target.value as any)}
                  style={{ width: '100%', padding: '10px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
                >
                  <option value="diario">Diário (Todo dia)</option>
                  <option value="semanal">Semanal (Todo Domingo)</option>
                  <option value="mensal">Mensal (Todo dia 1º)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: 500 }}>Horário de Execução</label>
                <input 
                  type="time" 
                  value={autoTime}
                  disabled={!autoEnabled}
                  onChange={(e) => setAutoTime(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: 500 }}>Retenção (backups a manter)</label>
                <input 
                  type="number" 
                  min={2} 
                  max={30} 
                  value={autoKeepCount}
                  disabled={!autoEnabled}
                  onChange={(e) => setAutoKeepCount(parseInt(e.target.value, 10))}
                  style={{ width: '100%', padding: '9px 10px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
              <button 
                type="submit" 
                className="btn-primary" 
                disabled={loading || actionLoading || !selectedTenant}
                style={{ backgroundColor: '#8b5cf6', color: '#fff', padding: '10px 24px', fontWeight: 600 }}
              >
                Salvar Configurações de Rotina
              </button>
            </div>

          </form>
        </div>

      </div>

      {/* Histórico de Backups Realizados */}
      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h3 style={{ fontSize: '20px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Database size={24} color="#8b5cf6" />
            Histórico e Gerenciamento de Arquivos
          </h3>
          
          <div style={{ position: 'relative', width: '320px' }}>
            <Search size={16} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              type="text" 
              placeholder="Pesquisar por arquivo ou status..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '100%', padding: '10px 16px 10px 44px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: '14px' }}
            />
          </div>
        </div>

        {loading ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
            <RefreshCw size={32} className="animate-spin" style={{ margin: '0 auto 16px auto', color: '#8b5cf6' }} />
            Buscando backups cadastrados...
          </div>
        ) : filteredBackups.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)', backgroundColor: 'var(--bg-tertiary)', borderRadius: '8px', border: '1px dashed var(--border-color)' }}>
            Nenhum arquivo de backup localizado para esta empresa no histórico. Clique em "Gerar Backup Agora" para criar o primeiro.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '13px', textTransform: 'uppercase' }}>
                  <th style={{ padding: '16px' }}>Arquivo de Backup (Criptografado)</th>
                  <th style={{ padding: '16px' }}>Empresa</th>
                  <th style={{ padding: '16px' }}>Tamanho</th>
                  <th style={{ padding: '16px' }}>Canal</th>
                  <th style={{ padding: '16px' }}>Status</th>
                  <th style={{ padding: '16px', textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredBackups.map(backup => {
                  const dateStr = new Date(backup.createdAt).toLocaleString('pt-BR');
                  const sizeKB = (backup.sizeBytes / 1024).toFixed(1);
                  const isRestored = !!backup.restauradoEm;

                  return (
                    <tr key={backup.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', backgroundColor: isRestored ? 'rgba(59, 130, 246, 0.03)' : 'transparent' }}>
                      <td style={{ padding: '16px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '14px', fontFamily: 'monospace' }}>
                            {backup.filename}
                          </span>
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                            Gerado em: {dateStr}
                          </span>
                          {isRestored && (
                            <span style={{ fontSize: '12px', color: '#3b82f6', fontWeight: 500 }}>
                              ⏮️ Restaurado por {backup.restauradoPor} em {new Date(backup.restauradoEm || '').toLocaleString('pt-BR')}
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '16px', fontSize: '14px', fontWeight: 500, color: 'var(--text-secondary)' }}>
                        {backup.companyName}
                      </td>
                      <td style={{ padding: '16px', fontSize: '14px', fontWeight: 500, color: 'var(--text-secondary)' }}>
                        {sizeKB} KB
                      </td>
                      <td style={{ padding: '16px' }}>
                        {backup.status === 'pendente' ? (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', color: '#f59e0b', fontWeight: 500 }}>
                            <Server size={14} /> Servidor Local
                          </span>
                        ) : (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', color: '#10b981', fontWeight: 500 }}>
                            <Cloud size={14} /> Nuvem Google
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '16px' }}>
                        {backup.status === 'enviado' && (
                          <span style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>
                            Nuvem (GCS)
                          </span>
                        )}
                        {backup.status === 'pendente' && (
                          <span style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }} title="O arquivo falhou ao subir para o Google Storage e está guardado localmente aguardando reenvio automático.">
                            Sinc. Pendente
                          </span>
                        )}
                        {backup.status === 'erro' && (
                          <span style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }} title={backup.error}>
                            Falha
                          </span>
                        )}
                        {backup.status === 'gerando' && (
                          <span style={{ backgroundColor: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <RefreshCw size={12} className="animate-spin" /> Extraindo...
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '16px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                          
                          <button 
                            className="btn-secondary" 
                            onClick={() => handleDownload(backup)}
                            disabled={actionLoading || backup.status === 'gerando' || backup.status === 'erro'}
                            style={{ padding: '6px 10px', fontSize: '12px', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: '4px' }}
                            title="Baixar Backup Decriptografado"
                          >
                            <Download size={14} /> Baixar
                          </button>

                          <button 
                            className="btn-secondary" 
                            onClick={() => handleRestore(backup)}
                            disabled={actionLoading || backup.status === 'gerando' || backup.status === 'erro'}
                            style={{ padding: '6px 10px', fontSize: '12px', backgroundColor: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6', border: '1px solid rgba(139, 92, 246, 0.2)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: '4px' }}
                            title="Substituir dados atuais por este backup"
                          >
                            <RefreshCw size={14} /> Restaurar
                          </button>

                          <button 
                            className="icon-btn" 
                            onClick={() => handleDelete(backup.id)}
                            disabled={actionLoading}
                            style={{ padding: '8px', color: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: 'var(--radius-md)', border: 'none', display: 'flex', alignItems: 'center' }}
                            title="Excluir Backup Permanentemente"
                          >
                            <Trash2 size={15} />
                          </button>

                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
};

export default SuperAdminBackup;
