import React, { useEffect, useRef, useState } from 'react';
import { Search, Plus, Award, Edit, Power } from 'lucide-react';
import { collection, query, onSnapshot, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardFlow';
import { semAbrirLinha, useLinhaSelecionavel } from '../../hooks/useLinhaSelecionavel';
import FiltroSituacao, { passaNaSituacao, SITUACAO_PADRAO, type Situacao } from '../../components/common/FiltroSituacao';
import { alterarSituacaoCadastro } from '../../services/cadastroService';

interface MarcaData {
  id: string;
  nome: string;
  ativo?: boolean;
}

const MarcasList: React.FC = () => {
  const { linha } = useLinhaSelecionavel();
  const [situacao, setSituacao] = useState<Situacao>(SITUACAO_PADRAO);
  const { openTab } = useTabs();
  const [marcas, setMarcas] = useState<MarcaData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { currentUser, tenantId } = useAuth();

  useKeyboardShortcuts([
    { key: 'F2', handler: () => searchInputRef.current?.focus() },
    { key: 'F6', handler: () => openTab('/marcas/nova') },
  ]);

  useEffect(() => {
    if (!currentUser) return;
    const q = query(collection(db, 'marcas'), where('tenantId', '==', tenantId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: MarcaData[] = [];
      snapshot.forEach(doc => data.push({ id: doc.id, ...doc.data() } as MarcaData));
      data.sort((a, b) => a.nome.localeCompare(b.nome));
      setMarcas(data);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [currentUser, tenantId]);

  const handleToggleAtivo = async (marca: MarcaData) => {
    if (!currentUser) return;
    const novoStatus = marca.ativo === false;

    const confirm = await NexusSwal.fire({
      title: novoStatus ? `Ativar "${marca.nome}"?` : `Inativar "${marca.nome}"?`,
      text: novoStatus
        ? 'A marca volta a aparecer na hora de cadastrar produto/matéria-prima.'
        : 'A marca some da hora de cadastrar produto/matéria-prima, mas continua valendo para quem já usa. Pode ser reativada quando quiser.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: novoStatus ? 'Sim, ativar' : 'Sim, inativar',
      cancelButtonText: 'Cancelar',
    });
    if (!confirm.isConfirmed) return;

    try {
      await alterarSituacaoCadastro('marcas', marca.id, novoStatus);
      showSuccess(novoStatus ? 'Marca ativada!' : 'Marca inativada!');
    } catch (error) {
      showError('Erro', (error as Error).message || 'Não foi possível atualizar o status da marca.');
    }
  };

  const filteredMarcas = marcas.filter((registro) => passaNaSituacao(registro.ativo !== false, situacao)).filter((m) => m.nome.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>Marcas</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>Marcas usadas no cadastro de produtos e matéria-prima</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn-primary" onClick={() => openTab('/marcas/nova')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={18} /> Nova Marca
          </button>
        </div>
      </div>

      <div className="card list-container" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div className="list-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
          <div className="search-box" style={{ position: 'relative', width: '350px' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '10px', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Buscar marca..."
              ref={searchInputRef}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '100%', padding: '10px 16px 10px 40px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
            />
          </div>
          <FiltroSituacao valor={situacao} onChange={setSituacao} />
          <div className="shortcuts-hint">
            <span><kbd>F2</kbd> Buscar</span>
            <span><kbd>F6</kbd> Nova</span>
          </div>
        </div>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nome da Marca</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={3} style={{ textAlign: 'center', padding: '20px' }}>Carregando...</td></tr>
              ) : filteredMarcas.length === 0 ? (
                <tr><td colSpan={3} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}><Award size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} /><p>Nenhuma marca encontrada.</p></td></tr>
              ) : (
                filteredMarcas.map((marca) => (
                  <tr key={marca.id} {...linha(marca.id, () => openTab(`/marcas/editar/${marca.id}`))}>
                    <td className="font-medium">{marca.nome}</td>
                    <td>
                      <span style={{
                        backgroundColor: marca.ativo === false ? 'rgba(255,255,255,0.05)' : '#10b98120',
                        color: marca.ativo === false ? 'var(--text-muted)' : '#10b981',
                        padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600,
                      }}>
                        {marca.ativo === false ? 'Inativa' : 'Ativa'}
                      </span>
                    </td>
                    <td {...semAbrirLinha}>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="icon-btn" title="Editar" onClick={() => openTab(`/marcas/editar/${marca.id}`)}>
                          <Edit size={16} />
                        </button>
                        <button
                          className="icon-btn"
                          title={marca.ativo === false ? 'Ativar' : 'Inativar'}
                          style={{ color: marca.ativo === false ? '#10b981' : '#ef4444' }}
                          onClick={() => handleToggleAtivo(marca)}
                        >
                          <Power size={16} />
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

export default MarcasList;
