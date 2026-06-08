import React, { useEffect, useState } from 'react';
import { collection, query, onSnapshot, where, doc, updateDoc, addDoc, serverTimestamp, getDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { CheckCircle, Clock, Plus, X, ArrowDownCircle, Loader2, Calendar, Edit, Trash2 } from 'lucide-react';
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
  vendaId?: string;
  dataPagamento?: string;
  createdAt?: any;
}

const ContasPagar: React.FC = () => {
  const [transacoes, setTransacoes] = useState<TransacaoData[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const { currentUser, tenantId } = useAuth();

  // Categorias de despesa do plano de contas
  const [categoriasDespesa, setCategoriasDespesa] = useState<string[]>(['Aluguel', 'Água/Luz/Internet', 'Salários', 'Fornecedores de Peças', 'Outros']);

  const [formData, setFormData] = useState({
    descricao: '',
    data: new Date().toISOString().split('T')[0],
    valor: '',
    categoria: '',
    status: 'Pendente' as 'Paga' | 'Pendente'
  });

  useEffect(() => {
    if (!currentUser) return;
    
    // Escutar TODAS as transacoes de saída para poder calcular os pagamentos de hoje
    const q = query(
      collection(db, 'transacoes'), 
      where('tenantId', '==', tenantId),
      where('tipo', '==', 'saida')
    );

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const data: TransacaoData[] = [];
      querySnapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as TransacaoData);
      });
      data.sort((a, b) => {
        const dateA = a.data || '';
        const dateB = b.data || '';
        return dateA.localeCompare(dateB); // Ordenar por vencimento (mais próximos primeiro)
      });
      setTransacoes(data);
      setLoading(false);
    }, (error) => {
      console.error("Erro ao buscar contas a pagar:", error);
      setLoading(false);
    });

    // Buscar Plano de Contas das configurações
    const fetchConfig = async () => {
      try {
        const configRef = doc(db, 'configuracoes', tenantId || '');
        const configSnap = await getDoc(configRef);
        if (configSnap.exists()) {
          const data = configSnap.data();
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

  const handleConciliar = async (t: TransacaoData) => {
    const result = await NexusSwal.fire({
      title: 'Confirmar Pagamento?',
      text: `Selecione como foi pago o valor de R$ ${Number(t.valor).toFixed(2)} referente a ${t.descricao}:`,
      icon: 'question',
      input: 'select',
      inputOptions: {
        'Dinheiro': 'Dinheiro',
        'Pix': 'Pix',
        'Cartão de Crédito': 'Cartão de Crédito',
        'Cartão de Débito': 'Cartão de Débito',
        'Transferência': 'Transferência',
        'Boleto': 'Boleto',
        'Outros': 'Outros'
      },
      inputPlaceholder: 'Como foi pago?',
      inputValue: t.formaPagamento && ['Dinheiro', 'Pix', 'Cartão de Crédito', 'Cartão de Débito', 'Transferência', 'Boleto', 'Outros'].includes(t.formaPagamento) ? t.formaPagamento : '',
      showCancelButton: true,
      confirmButtonText: 'Sim, confirmar pagamento',
      cancelButtonText: 'Cancelar',
      inputValidator: (value) => {
        if (!value) {
          return 'Você precisa selecionar uma forma de pagamento!'
        }
      }
    });

    if (result.isConfirmed) {
      const formaPgto = result.value;
      try {
        const docRef = doc(db, 'transacoes', t.id);
        const dataPagamento = new Date().toISOString().split('T')[0];
        await updateDoc(docRef, { status: 'Paga', formaPagamento: formaPgto, dataPagamento });
        showSuccess('Pagamento registrado no Fluxo de Caixa!');
      } catch (err) {
        showError('Erro', 'Não foi possível confirmar o pagamento.');
      }
    }
  };

  const handleOpenModal = () => {
    setFormData({
      descricao: '',
      data: new Date().toISOString().split('T')[0],
      valor: '',
      categoria: categoriasDespesa[0] || '',
      status: 'Pendente'
    });
    setEditingId(null);
    setIsModalOpen(true);
  };

  const handleEdit = (t: TransacaoData) => {
    setFormData({
      descricao: t.descricao,
      data: t.data,
      valor: t.valor.toString().replace('.', ','),
      categoria: t.categoria,
      status: t.status
    });
    setEditingId(t.id);
    setIsModalOpen(true);
  };

  const handleExcluir = async (t: TransacaoData) => {
    const result = await NexusSwal.fire({
      title: 'Excluir Lançamento?',
      text: `Para excluir a despesa "${t.descricao}", digite o motivo (mínimo 12 caracteres):`,
      input: 'text',
      inputAttributes: {
        minlength: '12',
        required: 'true',
        placeholder: 'Motivo da exclusão...'
      },
      showCancelButton: true,
      confirmButtonText: 'Confirmar Exclusão',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#ef4444',
      preConfirm: (motivo) => {
        if (!motivo || motivo.trim().length < 12) {
          NexusSwal.showValidationMessage('O motivo deve ter pelo menos 12 caracteres.');
          return false;
        }
        return motivo;
      }
    });

    if (result.isConfirmed) {
      try {
        await deleteDoc(doc(db, 'transacoes', t.id));
        showSuccess('Despesa excluída com sucesso!');
      } catch (err) {
        showError('Erro', 'Não foi possível excluir o lançamento.');
      }
    }
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
      const valorNum = parseFloat(formData.valor.toString().replace(',', '.'));
      if (editingId) {
        await updateDoc(doc(db, 'transacoes', editingId), {
          descricao: formData.descricao.toUpperCase().trim(),
          data: formData.data,
          valor: valorNum,
          categoria: formData.categoria.toUpperCase().trim(),
          status: formData.status
        });
        showSuccess('Conta atualizada com sucesso!');
      } else {
        await addDoc(collection(db, 'transacoes'), {
          descricao: formData.descricao.toUpperCase().trim(),
          data: formData.data,
          valor: valorNum,
          categoria: formData.categoria.toUpperCase().trim(),
          status: formData.status,
          tipo: 'saida',
          tenantId,
          createdAt: serverTimestamp()
        });
        showSuccess('Conta a pagar lançada com sucesso!');
      }
      setIsModalOpen(false);
    } catch (error) {
      console.error("Erro ao salvar conta a pagar:", error);
      showError('Erro', 'Ocorreu um erro ao salvar o lançamento.');
    } finally {
      setIsSaving(false);
    }
  };

  const hojeStr = new Date().toISOString().split('T')[0];
  const contasPendentes = transacoes.filter(t => t.status === 'Pendente');
  const pagamentosHoje = transacoes.filter(t => t.status === 'Paga' && t.dataPagamento === hojeStr);

  const totalPendente = contasPendentes.reduce((acc, curr) => acc + curr.valor, 0);
  const totalPagoHoje = pagamentosHoje.reduce((acc, curr) => acc + curr.valor, 0);

  return (
    <div className="financeiro-page" style={{ padding: '24px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px', alignItems: 'center' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>Contas a Pagar</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>Gestão de custos, boletos e despesas agendadas</p>
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: '12px 24px', borderRadius: 'var(--radius-lg)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
            <Clock size={24} color="#ef4444" />
            <div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Pago Hoje</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#ef4444' }}>
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalPagoHoje)}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'var(--bg-secondary)', padding: '12px 24px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
            <Clock size={24} color="#ef4444" />
            <div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Total Pendente</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#ef4444' }}>
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalPendente)}
              </div>
            </div>
          </div>
          <button className="btn-primary" onClick={handleOpenModal} style={{ backgroundColor: '#ef4444', borderColor: '#ef4444', boxShadow: '0 0 15px rgba(239, 68, 68, 0.4)' }}>
            <Plus size={18} style={{ marginRight: 8 }} />
            Lançar Despesa
          </button>
        </div>
      </div>

      <div className="card" style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
        <div className="table-wrapper">
          <table className="data-table financeiro-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ padding: '16px' }}>Vencimento</th>
                <th style={{ padding: '16px' }}>Descrição</th>
                <th style={{ padding: '16px' }}>Categoria</th>
                <th style={{ padding: '16px' }}>Status</th>
                <th style={{ padding: '16px', textAlign: 'right' }}>Valor (R$)</th>
                <th style={{ padding: '16px', textAlign: 'center' }}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '20px' }}>Carregando contas a pagar...</td>
                </tr>
              ) : contasPendentes.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    <CheckCircle size={48} color="#10b981" style={{ margin: '0 auto 16px', opacity: 0.5 }} />
                    <div>Tudo em dia! Nenhuma conta pendente para pagamento.</div>
                  </td>
                </tr>
              ) : (
                contasPendentes.map((t) => (
                  <tr key={t.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '16px', color: 'var(--text-muted)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Calendar size={14} />
                        {t.data ? t.data.split('-').reverse().join('/') : '-'}
                      </div>
                    </td>
                    <td style={{ padding: '16px', fontWeight: 500 }}>{t.descricao}</td>
                    <td style={{ padding: '16px' }}>
                      <span style={{ fontSize: '12px', backgroundColor: 'var(--bg-tertiary)', padding: '4px 8px', borderRadius: '4px', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>
                        {t.categoria}
                      </span>
                    </td>
                    <td style={{ padding: '16px' }}>
                      <span className="status-badge" style={{ backgroundColor: '#ef444420', color: '#ef4444', whiteSpace: 'nowrap', padding: '4px 8px', borderRadius: '12px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <span className="status-dot" style={{ backgroundColor: '#ef4444', width: '6px', height: '6px', borderRadius: '50%' }}></span>
                        Pendente
                      </span>
                    </td>
                    <td style={{ padding: '16px', textAlign: 'right', fontWeight: '600', color: '#ef4444' }}>
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(t.valor))}
                    </td>
                    <td style={{ padding: '16px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                        {(!t.osId && !t.vendaId) && (
                          <>
                            <button 
                              onClick={() => handleEdit(t)}
                              style={{ backgroundColor: '#f59e0b', border: 'none', color: 'white', cursor: 'pointer', borderRadius: '4px', padding: '6px 10px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px', transition: 'filter 0.2s' }}
                              title="Editar Despesa"
                              onMouseOver={(e) => e.currentTarget.style.filter = 'brightness(1.1)'}
                              onMouseOut={(e) => e.currentTarget.style.filter = 'brightness(1)'}
                            >
                              <Edit size={14} />
                            </button>
                            <button 
                              onClick={() => handleExcluir(t)}
                              style={{ backgroundColor: '#ef4444', border: 'none', color: 'white', cursor: 'pointer', borderRadius: '4px', padding: '6px 10px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px', transition: 'filter 0.2s' }}
                              title="Excluir Despesa"
                              onMouseOver={(e) => e.currentTarget.style.filter = 'brightness(1.1)'}
                              onMouseOut={(e) => e.currentTarget.style.filter = 'brightness(1)'}
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                        <button 
                          onClick={() => handleConciliar(t)}
                          style={{ backgroundColor: '#10b981', border: 'none', color: 'white', cursor: 'pointer', borderRadius: '4px', padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px', transition: 'filter 0.2s' }}
                          onMouseOver={(e) => e.currentTarget.style.filter = 'brightness(1.1)'}
                          onMouseOut={(e) => e.currentTarget.style.filter = 'brightness(1)'}
                        >
                          <CheckCircle size={14} /> Dar Baixa
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

      {/* Modal de Novo Lançamento */}
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
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
            }}>
              <h2 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', color: '#ef4444' }}>
                <ArrowDownCircle size={24} />
                {editingId ? 'Editar Despesa' : 'Lançar Conta a Pagar'}
              </h2>
              <button onClick={() => setIsModalOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={24} />
              </button>
            </div>
            
            <form onSubmit={handleSave} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Descrição / Fornecedor</label>
                <input 
                  type="text" 
                  value={formData.descricao} 
                  onChange={(e) => setFormData({...formData, descricao: e.target.value})} 
                  placeholder="Ex: ALUGUEL MAIO, FORNECEDOR PEÇAS X, LUZ..." 
                  style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px', color: 'var(--text-primary)', textTransform: 'uppercase' }}
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
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Data de Vencimento</label>
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
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Categoria (Plano de Contas)</label>
                <select 
                  value={formData.categoria} 
                  onChange={(e) => setFormData({...formData, categoria: e.target.value})}
                  style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px', color: 'var(--text-primary)' }}
                  required
                >
                  <option value="">Selecione uma categoria...</option>
                  {categoriasDespesa.map((cat, idx) => (
                    <option key={idx} value={cat}>{cat.toUpperCase()}</option>
                  ))}
                </select>
              </div>

              <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={isSaving} style={{ backgroundColor: '#ef4444', borderColor: '#ef4444' }}>
                  {isSaving ? <Loader2 size={18} className="spin-animation" /> : <CheckCircle size={18} />}
                  Salvar Conta
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ContasPagar;
