import React, { useEffect, useState } from 'react';
import { Plus, Search, Filter, AlertCircle, Package, Edit, Trash2, Upload } from 'lucide-react';
import { collection, query, onSnapshot, doc, deleteDoc, where, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { confirmDelete, showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import './Estoque.css';

interface PecaData {
  id: string;
  nome: string;
  codigo: string;
  categoria: string;
  quantidade: number;
  precoVenda: number;
  unidadeMedidaSigla?: string;
  unidadeMedidaCasasDecimais?: number;
}

const EstoqueList: React.FC = () => {
  const { openTab } = useTabs();
  const [pecasList, setPecasList] = useState<PecaData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  /** Linha destacada por um clique simples. Editar exige duplo clique (ou
   * Enter), pra um clique de leitura nao abrir uma aba sem querer. */
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { currentUser, tenantId } = useAuth();

  useEffect(() => {
    if (!currentUser) return;
    const q = query(collection(db, 'estoque'), where('tenantId', '==', tenantId));
    
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const pecas: PecaData[] = [];
      querySnapshot.forEach((doc) => {
        pecas.push({ id: doc.id, ...doc.data() } as PecaData);
      });
      pecas.sort((a, b) => a.nome.localeCompare(b.nome));
      setPecasList(pecas);
      setLoading(false);
    }, (error) => {
      console.error("Erro ao buscar estoque:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser]);

  const handleDelete = async (id: string) => {
    const isConfirmed = await confirmDelete('este produto do estoque');
    if (isConfirmed) {
      try {
        const nomePeca = pecasList.find(p => p.id === id)?.nome || 'Desconhecido';
        await deleteDoc(doc(db, 'estoque', id));
        try {
          const { createAuditLog } = await import('../../services/logService');
          createAuditLog({
            tenantId: tenantId || '',
            usuarioId: currentUser?.uid || '',
            usuarioEmail: currentUser?.email || '',
            modulo: 'estoque',
            acao: 'exclusao',
            descricao: `Produto ${nomePeca} excluído do estoque.`,
            registroRelacionadoId: id,
            status: 'sucesso',
            critical: true
          });
        } catch (logErr) {}
        showSuccess('Produto excluído!');
      } catch (error) {
        console.error("Erro ao excluir produto:", error);
        showError('Erro ao excluir', 'Tente novamente mais tarde.');
      }
    }
  };

  const handleFixNames = async () => {
    if (!currentUser) return;
    const isConfirmed = await NexusSwal.fire({
      title: 'Padronizar Nomes?',
      text: 'Isto converterá o nome de TODOS os produtos do estoque para MAIÚSCULAS.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sim, padronizar agora'
    });

    if (isConfirmed.isConfirmed) {
      setLoading(true);
      try {
        let count = 0;
        for (const p of pecasList) {
          const upName = p.nome.toUpperCase().trim();
          if (p.nome !== upName) {
            await updateDoc(doc(db, 'estoque', p.id), {
              nome: upName,
              ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Nome padronizado para maiúsculas'),
            });
            count++;
          }
        }
        showSuccess(`Pronto! ${count} produtos foram atualizados.`);
      } catch(err) {
        showError('Erro', 'Ocorreu um erro na migração.');
      } finally {
        setLoading(false);
      }
    }
  };

  const filteredPecas = pecasList.filter((peca) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      peca.nome.toLowerCase().includes(term) ||
      peca.codigo.toLowerCase().includes(term) ||
      peca.categoria.toLowerCase().includes(term)
    );
  });

  const getStatusBadge = (quantidade: number) => {
    if (quantidade <= 0) {
      return (
        <span className="status-badge" style={{ backgroundColor: '#ef444420', color: '#ef4444' }}>
          <span className="status-dot" style={{ backgroundColor: '#ef4444' }}></span>
          Esgotado
        </span>
      );
    } else if (quantidade < 5) {
      return (
        <span className="status-badge" style={{ backgroundColor: '#f59e0b20', color: '#f59e0b' }}>
          <span className="status-dot" style={{ backgroundColor: '#f59e0b' }}></span>
          Baixo
        </span>
      );
    } else {
      return (
        <span className="status-badge" style={{ backgroundColor: '#10b98120', color: '#10b981' }}>
          <span className="status-dot" style={{ backgroundColor: '#10b981' }}></span>
          Em Estoque
        </span>
      );
    }
  };

  return (
    <div className="estoque-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Estoque e Produtos</h1>
          <p className="page-subtitle">Controle de inventário, produtos e insumos</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn-secondary" onClick={handleFixNames} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
            Padronizar (A-Z)
          </button>
          <button
            className="btn-secondary"
            onClick={() => openTab('/estoque/importar', 'Importar Produtos')}
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <Upload size={18} />
            Importar produtos
          </button>
          <button
            className="btn-primary"
            onClick={() => openTab('/estoque/nova')}
          >
            <Plus size={18} style={{ marginRight: 8 }} />
            Novo Produto
          </button>
        </div>
      </div>

      <div className="dashboard-charts" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: '8px' }}>
         <div className="card stat-card" style={{ padding: '20px' }}>
          <div className="stat-header">
            <div className="stat-icon blue-bg">
              <Package size={24} />
            </div>
          </div>
          <div className="stat-info">
            <h3>{pecasList.length}</h3>
            <p>Itens Cadastrados</p>
          </div>
        </div>
        <div className="card stat-card" style={{ padding: '20px' }}>
          <div className="stat-header">
            <div className="stat-icon yellow-bg">
              <AlertCircle size={24} />
            </div>
          </div>
          <div className="stat-info">
            <h3>{pecasList.filter(p => p.quantidade > 0 && p.quantidade < 5).length}</h3>
            <p>Estoque Baixo</p>
          </div>
        </div>
        <div className="card stat-card" style={{ padding: '20px' }}>
          <div className="stat-header">
            <div className="stat-icon" style={{ backgroundColor: '#ef444415', color: '#ef4444' }}>
              <AlertCircle size={24} />
            </div>
          </div>
          <div className="stat-info">
            <h3>{pecasList.filter(p => p.quantidade <= 0).length}</h3>
            <p>Itens Esgotados</p>
          </div>
        </div>
      </div>

      <div className="card list-container">
        <div className="list-toolbar">
          <div className="search-box">
            <Search size={18} className="search-icon" />
            <input
              type="text"
              placeholder="Buscar por código, nome ou categoria..."
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
                <th>Código / SKU</th>
                <th>Nome do Produto</th>
                <th>Categoria</th>
                <th>Qtd.</th>
                <th>Preço (Venda)</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '20px' }}>Carregando Estoque...</td>
                </tr>
              ) : filteredPecas.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '20px' }}>
                    {searchTerm ? `Nenhum resultado encontrado para "${searchTerm}".` : 'Nenhum produto cadastrado no estoque.'}
                  </td>
                </tr>
              ) : (
                filteredPecas.map((peca) => (
                  <tr
                    key={peca.id}
                    className={selectedId === peca.id ? 'row-selectable is-selected' : 'row-selectable'}
                    onClick={() => setSelectedId(peca.id)}
                    onDoubleClick={() => openTab(`/estoque/editar/${peca.id}`)}
                    // Enter abre o produto selecionado -- o duplo clique sozinho
                    // deixaria a linha inacessivel por teclado.
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') openTab(`/estoque/editar/${peca.id}`);
                    }}
                    tabIndex={0}
                    title="Clique para selecionar, duplo clique para editar"
                  >
                    <td className="font-medium" style={{ color: 'var(--text-muted)' }}>{peca.codigo}</td>
                    <td>{peca.nome}</td>
                    <td>{peca.categoria}</td>
                    <td className="font-medium">
                      {Number(peca.quantidade).toFixed(peca.unidadeMedidaCasasDecimais ?? 0)} {peca.unidadeMedidaSigla || 'UN'}
                    </td>
                    <td>
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(peca.precoVenda))}
                    </td>
                    <td>{getStatusBadge(Number(peca.quantidade))}</td>
                    <td>
                      {/* stopPropagation: sem isso, um duplo clique acidental
                          em cima da lixeira tambem abriria a tela de edicao. */}
                      <div style={{ display: 'flex', gap: '8px' }} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                        <button className="icon-btn" title="Editar" onClick={() => openTab(`/estoque/editar/${peca.id}`)}>
                          <Edit size={16} />
                        </button>
                        <button className="icon-btn" title="Excluir" style={{ color: '#ef4444' }} onClick={() => handleDelete(peca.id)}>
                          <Trash2 size={16} />
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

export default EstoqueList;
