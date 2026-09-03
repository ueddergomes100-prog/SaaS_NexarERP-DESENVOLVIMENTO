import React, { useEffect, useState } from 'react';
import { Search, Filter, Plus, Users, Edit, Power, Upload } from 'lucide-react';
import { collection, query, onSnapshot, doc, where, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import ValidarDocumentoButton from '../../components/common/ValidarDocumentoButton';

interface ClienteData {
  id: string;
  codigo: string;
  nome: string;
  telefone: string;
  email: string;
  documento: string; // CPF/CNPJ
  endereco?: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  isPadrao?: boolean;
  ativo?: boolean;
  createdAt: any;
}

const ClientesList: React.FC = () => {
  const { openTab } = useTabs();
  const [clientes, setClientes] = useState<ClienteData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  /** Linha destacada por um clique simples. Abrir exige duplo clique (ou
   * Enter), pra um clique de leitura nao abrir uma aba sem querer. */
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { currentUser, tenantId } = useAuth();

  useEffect(() => {
    if (!currentUser) return;

    const q = query(collection(db, 'clientes'), where('tenantId', '==', tenantId));
    
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const data: ClienteData[] = [];
      querySnapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as ClienteData);
      });
      data.sort((a, b) => a.nome.localeCompare(b.nome));
      setClientes(data);
      setLoading(false);
    }, (error) => {
      console.error("Erro ao buscar clientes:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleToggleAtivo = async (cliente: ClienteData) => {
    if (!currentUser) return;
    const novoStatus = cliente.ativo === false;

    const confirm = await NexusSwal.fire({
      title: novoStatus ? `Ativar ${cliente.nome}?` : `Inativar ${cliente.nome}?`,
      text: novoStatus
        ? `${cliente.nome} volta a aparecer nas buscas de venda, OS e orçamento.`
        : `${cliente.nome} some das buscas de venda, OS e orçamento, mas o histórico dele continua intacto. Pode ser reativado quando quiser.`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: novoStatus ? 'Sim, ativar' : 'Sim, inativar',
      cancelButtonText: 'Cancelar',
    });
    if (!confirm.isConfirmed) return;

    try {
      await updateDoc(doc(db, 'clientes', cliente.id), {
        ativo: novoStatus,
        ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), novoStatus ? 'Cliente reativado' : 'Cliente inativado'),
      });
      showSuccess(novoStatus ? 'Cliente ativado!' : 'Cliente inativado!');
    } catch (error) {
      console.error('Erro ao atualizar status do cliente:', error);
      showError('Erro ao atualizar', 'Tente novamente mais tarde.');
    }
  };

  const handleFixNames = async () => {
    if (!currentUser) return;
    const isConfirmed = await NexusSwal.fire({
      title: 'Padronizar Nomes?',
      text: 'Isto converterá o nome de TODOS os clientes para MAIÚSCULAS.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sim, padronizar agora'
    });

    if (isConfirmed.isConfirmed) {
      setLoading(true);
      try {
        let count = 0;
        for (const c of clientes) {
          const upName = c.nome.toUpperCase().trim();
          if (c.nome !== upName) {
            await updateDoc(doc(db, 'clientes', c.id), {
              nome: upName,
              ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Nome padronizado para maiúsculas'),
            });
            count++;
          }
        }
        showSuccess(`Pronto! ${count} clientes foram atualizados.`);
      } catch(err) {
        showError('Erro', 'Ocorreu um erro na migração.');
      } finally {
        setLoading(false);
      }
    }
  };

  const filteredClientes = clientes.filter(cliente => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      (cliente.codigo && cliente.codigo.toLowerCase().includes(term)) ||
      (cliente.nome && cliente.nome.toLowerCase().includes(term)) ||
      (cliente.documento && cliente.documento.includes(searchTerm)) ||
      (cliente.telefone && cliente.telefone.includes(searchTerm))
    );
  });

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>Clientes</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>Gerenciamento da sua base de clientes</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn-secondary" onClick={handleFixNames} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
            Padronizar (A-Z)
          </button>
          <button
            className="btn-secondary"
            onClick={() => openTab('/clientes/importar', 'Importar Clientes')}
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <Upload size={18} />
            Importar clientes
          </button>
          <button className="btn-primary" onClick={() => openTab('/clientes/novo')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={18} /> Novo Cliente
          </button>
        </div>
      </div>

      <div className="card list-container" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div className="list-toolbar" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div className="search-box" style={{ position: 'relative', width: '350px' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '10px', color: 'var(--text-muted)' }} />
            <input 
              type="text" 
              placeholder="Buscar por código, cliente, CPF ou telefone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '100%', padding: '10px 16px 10px 40px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
            />
          </div>
          <button className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}>
            <Filter size={18} /> Filtros
          </button>
        </div>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nome</th>
                <th>Telefone</th>
                <th>CPF / CNPJ</th>
                <th>E-mail</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '20px' }}>Carregando clientes...</td>
                </tr>
              ) : filteredClientes.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                    <Users size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
                    <p>{searchTerm ? `Nenhum resultado encontrado para "${searchTerm}".` : "Nenhum cliente cadastrado."}</p>
                  </td>
                </tr>
              ) : (
                filteredClientes.map((cliente) => (
                  <tr
                    key={cliente.id}
                    // Consumidor Final e' registro do sistema e nao abre pra
                    // edicao (ClienteForm redireciona) -- por isso nem seleciona.
                    className={cliente.isPadrao ? undefined : (selectedId === cliente.id ? 'row-selectable is-selected' : 'row-selectable')}
                    onClick={cliente.isPadrao ? undefined : () => setSelectedId(cliente.id)}
                    onDoubleClick={cliente.isPadrao ? undefined : () => openTab(`/clientes/editar/${cliente.id}`)}
                    onKeyDown={cliente.isPadrao ? undefined : (event) => {
                      if (event.key === 'Enter') openTab(`/clientes/editar/${cliente.id}`);
                    }}
                    tabIndex={cliente.isPadrao ? undefined : 0}
                    title={cliente.isPadrao ? undefined : 'Clique para selecionar, duplo clique para editar'}
                  >
                    <td style={{ color: 'var(--text-muted)' }}>{cliente.codigo || '-'}</td>
                    <td className="font-medium">{cliente.nome}</td>
                    <td>{cliente.telefone || '-'}</td>
                    <td>{cliente.documento || '-'}</td>
                    <td>{cliente.email || '-'}</td>
                    <td>
                      {!cliente.isPadrao && (
                        <span style={{
                          backgroundColor: cliente.ativo === false ? 'rgba(255,255,255,0.05)' : '#10b98120',
                          color: cliente.ativo === false ? 'var(--text-muted)' : '#10b981',
                          padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600,
                        }}>
                          {cliente.ativo === false ? 'Inativo' : 'Ativo'}
                        </span>
                      )}
                    </td>
                    <td>
                      {cliente.isPadrao ? (
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>Sistema Padrão</span>
                      ) : (
                        <div style={{ display: 'flex', gap: '8px' }} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                          <ValidarDocumentoButton documento={cliente.documento} />
                          <button className="icon-btn" title="Editar" onClick={() => openTab(`/clientes/editar/${cliente.id}`)}>
                            <Edit size={16} />
                          </button>
                          <button
                            className="icon-btn"
                            title={cliente.ativo === false ? 'Ativar' : 'Inativar'}
                            style={{ color: cliente.ativo === false ? '#10b981' : '#ef4444' }}
                            onClick={() => handleToggleAtivo(cliente)}
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

export default ClientesList;
