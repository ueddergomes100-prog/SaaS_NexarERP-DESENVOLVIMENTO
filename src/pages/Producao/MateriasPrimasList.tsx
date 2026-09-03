import React, { useEffect, useState } from 'react';
import { Search, Plus, Factory, Edit, Power, AlertTriangle } from 'lucide-react';
import { collection, query, onSnapshot, doc, updateDoc, serverTimestamp, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { useReservedRawMaterialStock } from '../../hooks/useReservedRawMaterialStock';
import { computeEstoquePrevisto } from '../../utils/producaoDomain';

interface MateriaPrimaData {
  id: string;
  codigo: string;
  nome: string;
  categoria: string;
  unidade: string;
  quantidade: number;
  estoqueMinimo: number;
  precoCusto: number;
  fornecedor: string;
  ativo?: boolean;
}

const MateriasPrimasList: React.FC = () => {
  const { openTab } = useTabs();
  const [materiasPrimas, setMateriasPrimas] = useState<MateriaPrimaData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const { currentUser, tenantId } = useAuth();
  const { reservedMap } = useReservedRawMaterialStock(tenantId);

  useEffect(() => {
    if (!currentUser) return;

    const q = query(collection(db, 'materias_primas'), where('tenantId', '==', tenantId));

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const data: MateriaPrimaData[] = [];
      querySnapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as MateriaPrimaData);
      });
      data.sort((a, b) => a.nome.localeCompare(b.nome));
      setMateriasPrimas(data);
      setLoading(false);
    }, (error) => {
      console.error("Erro ao buscar matérias-primas:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser, tenantId]);

  const handleToggleAtivo = async (item: MateriaPrimaData) => {
    if (!currentUser) return;
    const novoStatus = item.ativo === false;

    const confirm = await NexusSwal.fire({
      title: novoStatus ? `Ativar "${item.nome}"?` : `Inativar "${item.nome}"?`,
      text: novoStatus
        ? 'A matéria-prima volta a aparecer na hora de montar composição de produção.'
        : 'A matéria-prima some da hora de montar composição de produção, mas o histórico continua intacto. Pode ser reativada quando quiser.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: novoStatus ? 'Sim, ativar' : 'Sim, inativar',
      cancelButtonText: 'Cancelar',
    });
    if (!confirm.isConfirmed) return;

    try {
      await updateDoc(doc(db, 'materias_primas', item.id), {
        ativo: novoStatus,
        ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), novoStatus ? 'Matéria-prima reativada' : 'Matéria-prima inativada'),
      });
      showSuccess(novoStatus ? 'Matéria-prima ativada!' : 'Matéria-prima inativada!');
    } catch (error) {
      console.error("Erro ao atualizar status da matéria-prima:", error);
      showError('Erro ao atualizar', 'Tente novamente mais tarde.');
    }
  };

  const filteredMateriasPrimas = materiasPrimas.filter(item => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      (item.nome && item.nome.toLowerCase().includes(term)) ||
      (item.codigo && item.codigo.toLowerCase().includes(term)) ||
      (item.categoria && item.categoria.toLowerCase().includes(term))
    );
  });

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>Matéria-Prima</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>Estoque de matéria-prima, separado do estoque de produtos acabados e itens que não dependem de produção</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn-primary" onClick={() => openTab('/materias-primas/nova')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={18} /> Nova Matéria-Prima
          </button>
        </div>
      </div>

      <div className="card list-container" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div className="list-toolbar" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div className="search-box" style={{ position: 'relative', width: '350px' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '10px', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Buscar por nome, código ou categoria..."
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
                <th>Nome</th>
                <th>Categoria</th>
                <th>Quantidade</th>
                <th>Estoque Previsto</th>
                <th>Custo Unitário</th>
                <th>Fornecedor</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '20px' }}>Carregando matérias-primas...</td>
                </tr>
              ) : filteredMateriasPrimas.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                    <Factory size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
                    <p>{searchTerm ? `Nenhum resultado encontrado para "${searchTerm}".` : "Nenhuma matéria-prima cadastrada."}</p>
                  </td>
                </tr>
              ) : (
                filteredMateriasPrimas.map((item) => {
                  const abaixoDoMinimo = item.estoqueMinimo > 0 && item.quantidade <= item.estoqueMinimo;
                  const reservado = reservedMap.get(item.id) || 0;
                  const emProducao = reservado > 0;
                  const estoquePrevisto = computeEstoquePrevisto(item.quantidade, reservado);
                  return (
                    <tr key={item.id}>
                      <td style={{ color: 'var(--text-muted)' }}>{item.codigo || '-'}</td>
                      <td className="font-medium">
                        {item.nome}
                        {emProducao && (
                          <span
                            title={`${reservado} ${item.unidade || 'UN'} reservados por ordens de produção em andamento`}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginLeft: '10px', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 700, color: '#8b5cf6', backgroundColor: 'rgba(139, 92, 246, 0.14)' }}
                          >
                            <Factory size={11} /> Em Produção
                          </span>
                        )}
                      </td>
                      <td>{item.categoria || '-'}</td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: abaixoDoMinimo ? '#ef4444' : 'inherit', fontWeight: abaixoDoMinimo ? 600 : 400 }}>
                          {abaixoDoMinimo && <AlertTriangle size={14} />}
                          {item.quantidade} {item.unidade || 'UN'}
                        </span>
                      </td>
                      <td style={{ color: emProducao ? '#8b5cf6' : 'var(--text-muted)', fontWeight: emProducao ? 600 : 400 }}>
                        {emProducao ? `${estoquePrevisto} ${item.unidade || 'UN'}` : '-'}
                      </td>
                      <td>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.precoCusto || 0)}</td>
                      <td>{item.fornecedor || '-'}</td>
                      <td>
                        <span style={{
                          backgroundColor: item.ativo === false ? 'rgba(255,255,255,0.05)' : '#10b98120',
                          color: item.ativo === false ? 'var(--text-muted)' : '#10b981',
                          padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600,
                        }}>
                          {item.ativo === false ? 'Inativa' : 'Ativa'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button className="icon-btn" title="Editar" onClick={() => openTab(`/materias-primas/editar/${item.id}`)}>
                            <Edit size={16} />
                          </button>
                          <button
                            className="icon-btn"
                            title={item.ativo === false ? 'Ativar' : 'Inativar'}
                            style={{ color: item.ativo === false ? '#10b981' : '#ef4444' }}
                            onClick={() => handleToggleAtivo(item)}
                          >
                            <Power size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default MateriasPrimasList;
