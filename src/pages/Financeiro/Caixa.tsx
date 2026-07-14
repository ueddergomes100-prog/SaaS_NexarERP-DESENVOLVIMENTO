import React, { useEffect, useState } from 'react';
import { ArrowUpCircle, ArrowDownCircle, Search, Filter, DollarSign, Eye, EyeOff, Calendar, Plus, X, Loader2, CheckCircle, RotateCcw } from 'lucide-react';
import { collection, query, onSnapshot, where, addDoc, doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { isPlatformAdminRole } from '../../utils/roles';
import './Financeiro.css';

interface TransacaoData {
  id: string;
  data: string;
  descricao: string;
  categoria: string;
  valor: number;
  tipo: 'entrada' | 'saida';
  status: 'Paga' | 'Pendente';
  formaPagamento?: string;
  osId?: string;
  createdAt?: any;
}

const Caixa: React.FC = () => {
  const [transacoes, setTransacoes] = useState<TransacaoData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSaldo, setShowSaldo] = useState(false);
  const [diasFiltro, setDiasFiltro] = useState<number>(30); // Padrão 30 dias
  const { currentUser, tenantId, userRole, userPermissions, isOwner } = useAuth();
  
  const podeEstornar = isOwner || isPlatformAdminRole(userRole) || (userPermissions && userPermissions.includes('financeiro.estornar'));

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTipo, setModalTipo] = useState<'entrada' | 'saida'>('entrada');
  const [isSaving, setIsSaving] = useState(false);
  
  // Categorias do Plano de Contas
  const [categoriasReceita, setCategoriasReceita] = useState<string[]>(['Serviços', 'Venda de Peças', 'Outras Receitas']);
  const [categoriasDespesa, setCategoriasDespesa] = useState<string[]>(['Aluguel', 'Água/Luz/Internet', 'Salários', 'Fornecedores de Peças', 'Outros']);

  const [formData, setFormData] = useState({
    descricao: '',
    data: new Date().toISOString().split('T')[0],
    valor: '',
    categoria: '',
    status: 'Paga' as 'Paga' | 'Pendente'
  });

  useEffect(() => {
    if (!currentUser) return;
    
    // Escutar transacoes
    const q = query(collection(db, 'transacoes'), where('tenantId', '==', tenantId));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const data: TransacaoData[] = [];
      querySnapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as TransacaoData);
      });
      data.sort((a, b) => {
        const dateA = a.createdAt?.seconds || 0;
        const dateB = b.createdAt?.seconds || 0;
        return dateB - dateA;
      });
      setTransacoes(data);
      setLoading(false);
    }, (error) => {
      console.error("Erro ao buscar transações:", error);
      setLoading(false);
    });

    // Buscar Plano de Contas das configurações
    const fetchConfig = async () => {
      try {
        const configRef = doc(db, 'configuracoes', tenantId || '');
        const configSnap = await getDoc(configRef);
        if (configSnap.exists()) {
          const data = configSnap.data();
          if (data.planoContasReceitas) {
            setCategoriasReceita(Array.isArray(data.planoContasReceitas) ? data.planoContasReceitas : data.planoContasReceitas.split('\n').filter((c: string) => c.trim() !== ''));
          }
          if (data.planoContasDespesas) {
            setCategoriasDespesa(Array.isArray(data.planoContasDespesas) ? data.planoContasDespesas : data.planoContasDespesas.split('\n').filter((c: string) => c.trim() !== ''));
          }
        }
      } catch (err) {
        console.error("Erro ao buscar plano de contas", err);
      }
    };
    
    fetchConfig();

    return () => unsubscribe();
  }, [currentUser]);

  const filteredTransacoes = transacoes.filter(t => {
    if (t.status !== 'Paga') return false; // Caixa PRINCIPAL só exibe o que já foi recebido/pago!
    if (diasFiltro === 0) return true; // 0 significa 'Tudo'
    if (!t.createdAt) return true;
    
    const dataTransacao = new Date(t.createdAt.seconds * 1000);
    const limite = new Date();
    limite.setDate(limite.getDate() - diasFiltro);
    
    return dataTransacao >= limite;
  });

  const totalEntradas = filteredTransacoes.filter(t => t.tipo === 'entrada' && t.status === 'Paga' && t.formaPagamento !== 'Crédito de Devolução').reduce((acc, curr) => acc + curr.valor, 0);
  const totalSaidas = filteredTransacoes.filter(t => t.tipo === 'saida' && t.status === 'Paga').reduce((acc, curr) => acc + curr.valor, 0);
  const saldoAtual = totalEntradas - totalSaidas;

  const handleOpenModal = (tipo: 'entrada' | 'saida') => {
    setModalTipo(tipo);
    setFormData({
      descricao: '',
      data: new Date().toISOString().split('T')[0],
      valor: '',
      categoria: tipo === 'entrada' ? categoriasReceita[0] || '' : categoriasDespesa[0] || '',
      status: 'Paga'
    });
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    if (!formData.descricao || !formData.valor || !formData.categoria) {
      showError('Atenção', 'Preencha todos os campos obrigatórios.');
      return;
    }

    setIsSaving(true);
    try {
      const docRef = await addDoc(collection(db, 'transacoes'), {
        descricao: formData.descricao,
        data: formData.data,
        valor: parseFloat(formData.valor.replace(',', '.')),
        categoria: formData.categoria,
        status: formData.status,
        tipo: modalTipo,
        tenantId,
        createdAt: serverTimestamp()
      });
      try {
        const { createAuditLog } = await import('../../services/logService');
        createAuditLog({
          tenantId: tenantId || '',
          usuarioId: currentUser?.uid || '',
          usuarioEmail: currentUser?.email || '',
          modulo: 'financeiro',
          acao: 'criacao',
          descricao: `Transação de ${modalTipo === 'entrada' ? 'entrada' : 'saída'} lançada: ${formData.descricao}. Categoria: ${formData.categoria}. Valor: R$ ${parseFloat(formData.valor.replace(',', '.')).toFixed(2)}.`,
          registroRelacionadoId: docRef.id,
          status: 'sucesso'
        });
      } catch (logErr) {}
      
      showSuccess('Transação adicionada com sucesso!');
      setIsModalOpen(false);
    } catch (error) {
      console.error("Erro ao salvar transação:", error);
      showError('Erro', 'Ocorreu um erro ao salvar a transação.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleEstornar = async (id: string, tipo: string) => {
    if (!podeEstornar) {
      showError('Sem Permissão', 'Você não tem permissão para estornar lançamentos.');
      return;
    }

    const result = await NexusSwal.fire({
      title: 'Estornar Lançamento?',
      text: `Ao estornar, este ${tipo === 'entrada' ? 'Recebimento' : 'Pagamento'} voltará para Contas a ${tipo === 'entrada' ? 'Receber' : 'Pagar'} como Pendente. Confirma?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#f59e0b',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Sim, Estornar',
      cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
      try {
        const transacao = transacoes.find(t => t.id === id);
        const transDesc = transacao?.descricao || 'Sem descrição';
        const transValor = transacao?.valor || 0;

        await updateDoc(doc(db, 'transacoes', id), {
          status: 'Pendente'
        });

        try {
          const { createAuditLog } = await import('../../services/logService');
          createAuditLog({
            tenantId: tenantId || '',
            usuarioId: currentUser?.uid || '',
            usuarioEmail: currentUser?.email || '',
            modulo: 'financeiro',
            acao: 'edicao',
            descricao: `Transação "${transDesc}" de R$ ${transValor.toFixed(2)} estornada para Pendente.`,
            registroRelacionadoId: id,
            status: 'sucesso',
            critical: true
          });
        } catch (logErr) {}

        showSuccess('Lançamento estornado com sucesso!');
      } catch (error) {
        console.error("Erro ao estornar:", error);
        showError('Erro', 'Ocorreu um erro ao estornar a transação.');
      }
    }
  };

  return (
    <div className="financeiro-page" style={{ position: 'relative' }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Fluxo de Caixa</h1>
          <p className="page-subtitle">Controle de entradas, saídas e faturamento</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn-secondary" style={{ color: '#ef4444', borderColor: '#ef444440' }} onClick={() => handleOpenModal('saida')}>
            <ArrowDownCircle size={18} style={{ marginRight: 8 }} />
            Nova Despesa
          </button>
          <button className="btn-primary" style={{ backgroundColor: '#10b981', boxShadow: '0 0 15px rgba(16, 185, 129, 0.4)' }} onClick={() => handleOpenModal('entrada')}>
            <ArrowUpCircle size={18} style={{ marginRight: 8 }} />
            Nova Receita
          </button>
        </div>
      </div>

      <div className="financeiro-cards">
        <div className="card stat-card">
          <div className="stat-header">
            <div className="stat-icon green-bg">
              <ArrowUpCircle size={24} />
            </div>
          </div>
          <div className="stat-info">
            <h3>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalEntradas)}</h3>
            <p>Entradas Recebidas</p>
          </div>
        </div>

        <div className="card stat-card">
          <div className="stat-header">
            <div className="stat-icon" style={{ backgroundColor: '#ef444415', color: '#ef4444' }}>
              <ArrowDownCircle size={24} />
            </div>
          </div>
          <div className="stat-info">
            <h3>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalSaidas)}</h3>
            <p>Saídas Pagas</p>
          </div>
        </div>

        <div className="card stat-card">
          <div className="stat-header">
            <div className="stat-icon purple-bg">
              <DollarSign size={24} />
            </div>
            <button 
              onClick={() => setShowSaldo(!showSaldo)} 
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              title={showSaldo ? 'Ocultar Saldo' : 'Mostrar Saldo'}
            >
              {showSaldo ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>
          <div className="stat-info">
            <h3>
              {showSaldo 
                ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(saldoAtual) 
                : 'R$ •••••'}
            </h3>
            <p>Saldo do Período</p>
          </div>
        </div>
      </div>

      <div className="card list-container">
        <div className="list-toolbar">
          <div className="search-box">
            <Search size={18} className="search-icon" />
            <input type="text" placeholder="Buscar transação..." />
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Calendar size={18} style={{ color: 'var(--text-muted)' }} />
            <select 
              value={diasFiltro} 
              onChange={(e) => setDiasFiltro(Number(e.target.value))}
              style={{ 
                backgroundColor: 'var(--bg-tertiary)', 
                border: '1px solid var(--border-color)', 
                color: 'var(--text-primary)', 
                padding: '8px 12px', 
                borderRadius: 'var(--radius-md)' 
              }}
            >
              <option value={7}>Últimos 7 dias</option>
              <option value={15}>Últimos 15 dias</option>
              <option value={30}>Últimos 30 dias</option>
              <option value={90}>Últimos 90 dias</option>
              <option value={0}>Todo o período</option>
            </select>
          </div>
        </div>

        <div className="table-wrapper">
          <table className="data-table financeiro-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Descrição</th>
                <th>Categoria</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Valor (R$)</th>
                {podeEstornar && <th style={{ textAlign: 'center', width: '80px' }}>Ações</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={podeEstornar ? 6 : 5} style={{ textAlign: 'center', padding: '20px' }}>Carregando fluxo de caixa...</td>
                </tr>
              ) : filteredTransacoes.length === 0 ? (
                <tr>
                  <td colSpan={podeEstornar ? 6 : 5} style={{ textAlign: 'center', padding: '20px' }}>Nenhuma transação encontrada no período selecionado.</td>
                </tr>
              ) : (
                filteredTransacoes.map((t) => (
                  <tr key={t.id}>
                    <td style={{ color: 'var(--text-muted)' }}>{t.data ? t.data.split('-').reverse().join('/') : new Date(t.createdAt?.seconds * 1000).toLocaleDateString('pt-BR')}</td>
                    <td className="font-medium">
                      {t.descricao}
                      {t.formaPagamento && (
                        <span style={{ marginLeft: '8px', fontSize: '11px', backgroundColor: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '4px', color: 'var(--text-muted)' }}>
                          {t.formaPagamento}
                        </span>
                      )}
                    </td>
                    <td>{t.categoria}</td>
                    <td style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="status-badge" style={{ 
                        backgroundColor: '#10b98120', 
                        color: '#10b981',
                        whiteSpace: 'nowrap'
                      }}>
                        <span className="status-dot" style={{ backgroundColor: '#10b981' }}></span>
                        Paga
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: '600', color: t.tipo === 'entrada' ? '#10b981' : '#ef4444' }}>
                      {t.tipo === 'entrada' ? '+' : '-'} {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(t.valor))}
                    </td>
                    {podeEstornar && (
                      <td style={{ textAlign: 'center' }}>
                        <button 
                          onClick={() => handleEstornar(t.id, t.tipo)}
                          style={{ 
                            background: 'none', border: 'none', cursor: 'pointer', 
                            color: '#f59e0b', display: 'flex', alignItems: 'center', 
                            justifyContent: 'center', width: '100%' 
                          }}
                          title="Estornar e voltar para Pendente"
                        >
                          <RotateCcw size={18} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de Transação */}
      {isModalOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '500px',
            border: '1px solid var(--border-color)', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)', overflow: 'hidden'
          }}>
            <div style={{
              padding: '20px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              backgroundColor: modalTipo === 'entrada' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            }}>
              <h2 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', color: modalTipo === 'entrada' ? '#10b981' : '#ef4444' }}>
                {modalTipo === 'entrada' ? <ArrowUpCircle size={24} /> : <ArrowDownCircle size={24} />}
                Lançar Nova {modalTipo === 'entrada' ? 'Receita' : 'Despesa'}
              </h2>
              <button onClick={() => setIsModalOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={24} />
              </button>
            </div>
            
            <form onSubmit={handleSave} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Descrição</label>
                <input 
                  type="text" 
                  value={formData.descricao} 
                  onChange={(e) => setFormData({...formData, descricao: e.target.value})} 
                  placeholder={modalTipo === 'entrada' ? "Ex: Troca de óleo Corsa" : "Ex: Conta de Luz"} 
                  style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px', color: 'var(--text-primary)' }}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Valor (R$)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={formData.valor} 
                    onChange={(e) => setFormData({...formData, valor: e.target.value})} 
                    placeholder="0,00" 
                    style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px', color: 'var(--text-primary)', fontWeight: 600, fontSize: '16px' }}
                    required
                  />
                </div>
                <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Data</label>
                  <input 
                    type="date" 
                    value={formData.data} 
                    onChange={(e) => setFormData({...formData, data: e.target.value})} 
                    style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px', color: 'var(--text-primary)' }}
                    required
                  />
                </div>
              </div>

              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Plano de Contas (Categoria)</label>
                <select 
                  value={formData.categoria} 
                  onChange={(e) => setFormData({...formData, categoria: e.target.value})}
                  style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px', color: 'var(--text-primary)' }}
                  required
                >
                  <option value="">Selecione uma categoria...</option>
                  {(modalTipo === 'entrada' ? categoriasReceita : categoriasDespesa).map((cat, idx) => (
                    <option key={idx} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Status do Pagamento</label>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', backgroundColor: formData.status === 'Paga' ? 'rgba(16, 185, 129, 0.2)' : 'var(--bg-tertiary)', padding: '12px 16px', borderRadius: 'var(--radius-md)', border: `1px solid ${formData.status === 'Paga' ? '#10b981' : 'var(--border-color)'}`, flex: 1 }}>
                    <input type="radio" name="status" checked={formData.status === 'Paga'} onChange={() => setFormData({...formData, status: 'Paga'})} style={{ display: 'none' }} />
                    <span style={{ color: formData.status === 'Paga' ? '#10b981' : 'var(--text-muted)', fontWeight: 500, margin: '0 auto' }}>Paga / Recebida</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', backgroundColor: formData.status === 'Pendente' ? 'rgba(245, 158, 11, 0.2)' : 'var(--bg-tertiary)', padding: '12px 16px', borderRadius: 'var(--radius-md)', border: `1px solid ${formData.status === 'Pendente' ? '#f59e0b' : 'var(--border-color)'}`, flex: 1 }}>
                    <input type="radio" name="status" checked={formData.status === 'Pendente'} onChange={() => setFormData({...formData, status: 'Pendente'})} style={{ display: 'none' }} />
                    <span style={{ color: formData.status === 'Pendente' ? '#f59e0b' : 'var(--text-muted)', fontWeight: 500, margin: '0 auto' }}>Pendente</span>
                  </label>
                </div>
              </div>

              <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={isSaving} style={{ backgroundColor: modalTipo === 'entrada' ? '#10b981' : '#ef4444', borderColor: modalTipo === 'entrada' ? '#10b981' : '#ef4444' }}>
                  {isSaving ? <Loader2 size={18} className="spin-animation" /> : <CheckCircle size={18} />}
                  Salvar Lançamento
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Caixa;
