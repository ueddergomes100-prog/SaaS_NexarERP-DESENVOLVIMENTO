import React, { useEffect, useState } from 'react';
import { Search, Plus, Truck, Edit, Trash2 } from 'lucide-react';
import { collection, query, onSnapshot, doc, deleteDoc, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { confirmDelete, showSuccess, showError } from '../../utils/alerts';

interface FornecedorData {
  id: string;
  codigo: string;
  nome: string;
  cnpj: string;
  telefone: string;
  email: string;
  createdAt: any;
}

const formatCnpjOuCpf = (digits: string) => {
  if (!digits) return '-';
  if (digits.length === 14) return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (digits.length === 11) return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return digits;
};

const FornecedoresList: React.FC = () => {
  const { openTab } = useTabs();
  const [fornecedores, setFornecedores] = useState<FornecedorData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const { currentUser, tenantId } = useAuth();

  useEffect(() => {
    if (!currentUser) return;

    const q = query(collection(db, 'fornecedores'), where('tenantId', '==', tenantId));

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const data: FornecedorData[] = [];
      querySnapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as FornecedorData);
      });
      data.sort((a, b) => a.nome.localeCompare(b.nome));
      setFornecedores(data);
      setLoading(false);
    }, (error) => {
      console.error("Erro ao buscar fornecedores:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser, tenantId]);

  const handleDelete = async (id: string) => {
    const isConfirmed = await confirmDelete('este fornecedor');
    if (isConfirmed) {
      try {
        await deleteDoc(doc(db, 'fornecedores', id));
        showSuccess('Fornecedor excluído!');
      } catch (error) {
        console.error("Erro ao excluir fornecedor:", error);
        showError('Erro ao excluir', 'Tente novamente mais tarde.');
      }
    }
  };

  const filteredFornecedores = fornecedores.filter(fornecedor => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      (fornecedor.nome && fornecedor.nome.toLowerCase().includes(term)) ||
      (fornecedor.cnpj && fornecedor.cnpj.includes(searchTerm)) ||
      (fornecedor.telefone && fornecedor.telefone.includes(searchTerm))
    );
  });

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>Fornecedores</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>Cadastro de fornecedores usados na entrada de notas fiscais e compras</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn-primary" onClick={() => openTab('/fornecedores/novo')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={18} /> Novo Fornecedor
          </button>
        </div>
      </div>

      <div className="card list-container" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div className="list-toolbar" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div className="search-box" style={{ position: 'relative', width: '350px' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '10px', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Buscar fornecedor, CNPJ ou telefone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '100%', padding: '10px 16px 10px 40px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nome / Razão Social</th>
                <th>Telefone</th>
                <th>CNPJ / CPF</th>
                <th>E-mail</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '20px' }}>Carregando fornecedores...</td>
                </tr>
              ) : filteredFornecedores.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                    <Truck size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
                    <p>{searchTerm ? `Nenhum resultado encontrado para "${searchTerm}".` : "Nenhum fornecedor cadastrado."}</p>
                  </td>
                </tr>
              ) : (
                filteredFornecedores.map((fornecedor) => (
                  <tr key={fornecedor.id}>
                    <td style={{ color: 'var(--text-muted)' }}>{fornecedor.codigo || '-'}</td>
                    <td className="font-medium">{fornecedor.nome}</td>
                    <td>{fornecedor.telefone || '-'}</td>
                    <td>{formatCnpjOuCpf(fornecedor.cnpj)}</td>
                    <td>{fornecedor.email || '-'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="icon-btn" title="Editar" onClick={() => openTab(`/fornecedores/editar/${fornecedor.id}`)}>
                          <Edit size={16} />
                        </button>
                        <button className="icon-btn" title="Excluir" style={{ color: '#ef4444' }} onClick={() => handleDelete(fornecedor.id)}>
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

export default FornecedoresList;
