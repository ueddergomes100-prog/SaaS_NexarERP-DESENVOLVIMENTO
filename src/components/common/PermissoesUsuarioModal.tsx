import React, { useEffect, useMemo, useState } from 'react';
import { X, Shield, Loader2, Save, Search } from 'lucide-react';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError } from '../../utils/alerts';
import { buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { useEscapeLayer } from '../../hooks/useKeyboardFlow';
import { PERMISSION_GROUPS, PERMISSION_CATALOG } from '../../utils/permissionCatalog';
import {
  DEFAULT_NIVEL_ACESSO,
  NIVEL_ACESSO_LABELS,
  parseNivelAcesso,
  type NivelAcesso,
} from '../../utils/visibilidadeVendasDomain';

interface PermissoesUsuarioModalProps {
  usuarioId: string;
  usuarioNome: string;
  onClose: () => void;
  /** Chamado apos salvar com sucesso, pra tela dona atualizar o que precisar. */
  onSaved?: (permissoes: string[]) => void;
}

/**
 * Define as permissoes de um funcionario sem sair da tela de Usuarios.
 *
 * Por que popup e nao um link pra Configuracoes: as duas telas exigem
 * permissoes DIFERENTES -- /usuarios pede `administrativo.equipe` e
 * /configuracoes pede `administrativo.config` (ver routeAccess.ts). Quem
 * administra a equipe sem ter acesso a Configuracoes clicaria no link e
 * bateria numa parede. O popup funciona pra quem ja esta na tela.
 */
const PermissoesUsuarioModal: React.FC<PermissoesUsuarioModalProps> = ({ usuarioId, usuarioNome, onClose, onSaved }) => {
  const { currentUser, restringirVendasPorUsuario } = useAuth();
  const [permissoes, setPermissoes] = useState<string[]>([]);
  const [nivelAcesso, setNivelAcesso] = useState<NivelAcesso>(DEFAULT_NIVEL_ACESSO);
  const [busca, setBusca] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEscapeLayer(true, onClose);

  useEffect(() => {
    const carregar = async () => {
      setIsLoading(true);
      try {
        const snap = await getDoc(doc(db, 'usuarios', usuarioId));
        const atuais = snap.exists() ? snap.data().permissoes : [];
        setPermissoes(Array.isArray(atuais) ? atuais.filter((p): p is string => typeof p === 'string') : []);
        setNivelAcesso(parseNivelAcesso(snap.exists() ? snap.data().nivelAcesso : undefined));
      } catch (err) {
        console.error('Erro ao carregar permissões do usuário:', err);
        showError('Erro', 'Não foi possível carregar as permissões deste usuário.');
      } finally {
        setIsLoading(false);
      }
    };
    carregar();
  }, [usuarioId]);

  const toggle = (id: string) => {
    setPermissoes(prev => (prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]));
  };

  const gruposFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return PERMISSION_GROUPS;
    return PERMISSION_GROUPS
      .map(grupo => ({ ...grupo, itens: grupo.itens.filter(item => item.label.toLowerCase().includes(termo)) }))
      .filter(grupo => grupo.itens.length > 0);
  }, [busca]);

  const handleSalvar = async () => {
    if (!currentUser) return;
    setIsSaving(true);
    try {
      await updateDoc(doc(db, 'usuarios', usuarioId), {
        permissoes,
        nivelAcesso,
        ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Permissões atualizadas'),
      });
      showSuccess('Permissões salvas!');
      onSaved?.(permissoes);
      onClose();
    } catch (err) {
      console.error('Erro ao salvar permissões:', err);
      showError('Erro', 'Não foi possível salvar as permissões.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
        display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '24px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '760px',
          maxHeight: '90vh', display: 'flex', flexDirection: 'column',
          border: '1px solid var(--border-color)', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)', overflow: 'hidden',
        }}
      >
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(139, 92, 246, 0.1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Shield size={20} style={{ color: 'var(--accent-purple)' }} />
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--text-primary)' }}>Permissões de Acesso</h3>
              <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{usuarioNome}</span>
            </div>
          </div>
          <button onClick={onClose} className="icon-btn" title="Fechar" style={{ color: 'var(--text-muted)' }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <label htmlFor="nivel-acesso-usuario" style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>
              Nível de acesso
            </label>
            <select
              id="nivel-acesso-usuario"
              value={nivelAcesso}
              onChange={(e) => setNivelAcesso(parseNivelAcesso(e.target.value))}
              disabled={isLoading}
              style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--text-primary)', fontSize: '13px' }}
            >
              <option value="funcionario">{NIVEL_ACESSO_LABELS.funcionario}</option>
              <option value="administracao">{NIVEL_ACESSO_LABELS.administracao}</option>
            </select>
          </div>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
            {restringirVendasPorUsuario
              ? (nivelAcesso === 'funcionario'
                ? 'Sua empresa está com "Não visualizar vendas de outro usuário" ligado: este usuário verá somente as vendas em que ele é o vendedor.'
                : 'Este usuário verá as vendas de todos os vendedores, mesmo com a restrição ligada.')
              : 'O nível só decide quais vendas a pessoa enxerga, e hoje ele não muda nada: a opção "Não visualizar vendas de outro usuário" está desligada em Configurações → Configurações Avançadas.'}
          </p>
        </div>

        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '220px' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar permissão..."
              style={{ width: '100%', padding: '9px 12px 9px 36px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: '13px' }}
            />
          </div>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {permissoes.length} de {PERMISSION_CATALOG.length} liberadas
          </span>
        </div>

        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '22px' }}>
          {isLoading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Carregando permissões...</div>
          ) : gruposFiltrados.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Nenhuma permissão encontrada para "{busca}".</div>
          ) : (
            gruposFiltrados.map(grupo => (
              <div key={grupo.grupo}>
                <h4 style={{ margin: '0 0 12px', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', fontWeight: 700 }}>
                  {grupo.grupo}
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '10px' }}>
                  {grupo.itens.map(item => {
                    const marcada = permissoes.includes(item.id);
                    return (
                      <label
                        key={item.id}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer',
                          fontSize: '13px', color: marcada ? 'var(--text-primary)' : 'var(--text-secondary)',
                          backgroundColor: marcada ? 'rgba(255,255,255,0.03)' : 'var(--bg-primary)',
                          padding: '12px 14px', borderRadius: 'var(--radius-md)',
                          border: `1px solid ${marcada ? item.color : 'var(--border-color)'}`,
                          borderLeft: `4px solid ${marcada ? item.color : 'transparent'}`,
                          transition: 'all 0.2s',
                        }}
                      >
                        <span style={{ fontWeight: marcada ? 600 : 400 }}>{item.label}</span>
                        <span style={{ position: 'relative', width: '38px', height: '21px', backgroundColor: marcada ? item.color : 'var(--bg-tertiary)', borderRadius: '20px', transition: 'all 0.3s', border: `1px solid ${marcada ? item.color : 'var(--border-color)'}`, flexShrink: 0, marginLeft: '10px' }}>
                          <span style={{ position: 'absolute', top: '2px', left: marcada ? '19px' : '2px', width: '15px', height: '15px', backgroundColor: marcada ? '#fff' : 'var(--text-muted)', borderRadius: '50%', transition: 'all 0.3s' }} />
                        </span>
                        <input type="checkbox" checked={marcada} onChange={() => toggle(item.id)} style={{ display: 'none' }} />
                      </label>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button className="btn-secondary" onClick={onClose} disabled={isSaving}>Cancelar</button>
          <button
            className="btn-primary"
            onClick={handleSalvar}
            disabled={isSaving || isLoading}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: isSaving || isLoading ? 0.7 : 1 }}
          >
            {isSaving ? <Loader2 size={18} className="spin-icon" /> : <Save size={18} />}
            {isSaving ? 'Salvando...' : 'Salvar Permissões'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PermissoesUsuarioModal;
