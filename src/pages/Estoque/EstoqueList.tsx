import React, { useEffect, useState } from 'react';
import { Plus, Search, Filter, AlertCircle, Package, Edit, Power, Upload } from 'lucide-react';
import { collection, query, onSnapshot, doc, where, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { isPlatformAdminRole } from '../../utils/roles';
import { DICA_BUSCA_MULTIPLA, matchesAllSearchTerms } from '../../utils/textSearch';
import { DEFAULT_MOSTRAR_RESUMO_ESTOQUE, parseMostrarResumoEstoque } from '../../utils/estoqueResumoDomain';
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
  ativo?: boolean;
}

const EstoqueList: React.FC = () => {
  const { openTab } = useTabs();
  const [pecasList, setPecasList] = useState<PecaData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  /** Linha destacada por um clique simples. Editar exige duplo clique (ou
   * Enter), pra um clique de leitura nao abrir uma aba sem querer. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Configuracoes -> Estoque: mostrar os cartoes de resumo no topo. */
  const [mostrarResumo, setMostrarResumo] = useState(DEFAULT_MOSTRAR_RESUMO_ESTOQUE);

  const { currentUser, tenantId, userRole, userPermissions, isOwner } = useAuth();
  // So quem tem "Estoque: Abrir Cadastro de Produto" abre/cria/exclui um
  // produto -- ver a lista (nome, categoria, qtd, preco de venda) e' a
  // permissao base (cadastros.estoque). Sem isto, um funcionario so-leitura
  // dava duplo clique e via custo/margem/fornecedor do produto inteiro.
  const canEditProduto = isOwner || isPlatformAdminRole(userRole) || (userPermissions && userPermissions.includes('cadastros.estoque_alterar'));

  // Ao vivo: o dono liga/desliga em Configuracoes e a tela acompanha sem
  // ninguem precisar relogar.
  useEffect(() => {
    if (!tenantId) return;
    const unsubscribe = onSnapshot(doc(db, 'configuracoes', tenantId), (snap) => {
      setMostrarResumo(parseMostrarResumoEstoque(snap.exists() ? snap.data().mostrarResumoEstoque : undefined));
    }, (error) => {
      // Falha de leitura MANTEM o que ja estava: piscar os cartoes por causa
      // de uma queda de rede seria pior do que continuar mostrando.
      console.error('Erro ao carregar a configuracao de resumo do estoque:', error);
    });

    return () => unsubscribe();
  }, [tenantId]);

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

  const handleToggleAtivo = async (peca: PecaData) => {
    if (!currentUser) return;
    const novoStatus = peca.ativo === false;

    const confirm = await NexusSwal.fire({
      title: novoStatus ? `Ativar "${peca.nome}"?` : `Inativar "${peca.nome}"?`,
      text: novoStatus
        ? 'O produto volta a aparecer nas buscas de venda, OS e orçamento.'
        : 'O produto some das buscas de venda, OS e orçamento, mas o histórico e o estoque continuam intactos. Pode ser reativado quando quiser.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: novoStatus ? 'Sim, ativar' : 'Sim, inativar',
      cancelButtonText: 'Cancelar',
    });
    if (!confirm.isConfirmed) return;

    try {
      await updateDoc(doc(db, 'estoque', peca.id), {
        ativo: novoStatus,
        ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), novoStatus ? 'Produto reativado' : 'Produto inativado'),
      });
      try {
        const { createAuditLog } = await import('../../services/logService');
        createAuditLog({
          tenantId: tenantId || '',
          usuarioId: currentUser.uid,
          usuarioEmail: currentUser.email || '',
          modulo: 'estoque',
          acao: novoStatus ? 'ativacao' : 'inativacao',
          descricao: `Produto ${peca.nome} ${novoStatus ? 'reativado' : 'inativado'}.`,
          registroRelacionadoId: peca.id,
          alteracoes: [{ campo: 'ativo', valorAnterior: !novoStatus, valorNovo: novoStatus }],
          status: 'sucesso',
        });
      } catch (logErr) {}
      showSuccess(novoStatus ? 'Produto ativado!' : 'Produto inativado!');
    } catch (error) {
      console.error("Erro ao atualizar status do produto:", error);
      showError('Erro ao atualizar', 'Tente novamente mais tarde.');
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

  // Mesma busca das telas de venda: acento nao conta e "+" exige todas as
  // palavras ("Racao+Quatree+20KG"). Ver matchesAllSearchTerms.
  const filteredPecas = pecasList.filter((peca) => (
    matchesAllSearchTerms([peca.nome, peca.codigo, peca.categoria], searchTerm)
  ));

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
          {canEditProduto && (
            <button
              className="btn-primary"
              onClick={() => openTab('/estoque/nova')}
            >
              <Plus size={18} style={{ marginRight: 8 }} />
              Novo Produto
            </button>
          )}
        </div>
      </div>

      {/* Cartoes de resumo: a empresa decide se aparecem (Configuracoes ->
          Estoque). Ver DEFAULT_MOSTRAR_RESUMO_ESTOQUE. */}
      {mostrarResumo && (
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
      )}

      <div className="card list-container">
        <div className="list-toolbar">
          <div className="search-box">
            <Search size={18} className="search-icon" />
            <input
              type="text"
              placeholder={`Buscar por código, nome ou categoria — ${DICA_BUSCA_MULTIPLA}`}
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
                <th>Ativo</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '20px' }}>Carregando Estoque...</td>
                </tr>
              ) : filteredPecas.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '20px' }}>
                    {searchTerm ? `Nenhum resultado encontrado para "${searchTerm}".` : 'Nenhum produto cadastrado no estoque.'}
                  </td>
                </tr>
              ) : (
                filteredPecas.map((peca) => (
                  <tr
                    key={peca.id}
                    // Sem permissao de abrir o cadastro a linha nao abre nada --
                    // seria um duplo clique que so devolve erro.
                    className={canEditProduto ? (selectedId === peca.id ? 'row-selectable is-selected' : 'row-selectable') : undefined}
                    onClick={canEditProduto ? () => setSelectedId(peca.id) : undefined}
                    onDoubleClick={canEditProduto ? () => openTab(`/estoque/editar/${peca.id}`) : undefined}
                    // Enter abre o produto selecionado -- o duplo clique sozinho
                    // deixaria a linha inacessivel por teclado.
                    onKeyDown={canEditProduto ? (event) => {
                      if (event.key === 'Enter') openTab(`/estoque/editar/${peca.id}`);
                    } : undefined}
                    tabIndex={canEditProduto ? 0 : undefined}
                    title={canEditProduto ? 'Clique para selecionar, duplo clique para editar' : undefined}
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
                      <span style={{
                        backgroundColor: peca.ativo === false ? 'rgba(255,255,255,0.05)' : '#10b98120',
                        color: peca.ativo === false ? 'var(--text-muted)' : '#10b981',
                        padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600,
                      }}>
                        {peca.ativo === false ? 'Inativo' : 'Ativo'}
                      </span>
                    </td>
                    <td>
                      {canEditProduto && (
                        // stopPropagation: sem isso, um duplo clique acidental
                        // em cima do botao tambem abriria a tela de edicao.
                        <div style={{ display: 'flex', gap: '8px' }} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                          <button className="icon-btn" title="Editar" onClick={() => openTab(`/estoque/editar/${peca.id}`)}>
                            <Edit size={16} />
                          </button>
                          <button
                            className="icon-btn"
                            title={peca.ativo === false ? 'Ativar' : 'Inativar'}
                            style={{ color: peca.ativo === false ? '#10b981' : '#ef4444' }}
                            onClick={() => handleToggleAtivo(peca)}
                          >
                            <Power size={16} />
                          </button>
                        </div>
                      )}
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
