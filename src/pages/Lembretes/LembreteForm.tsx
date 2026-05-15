import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Bell, Loader2, Plus, Trash2 } from 'lucide-react';
import { collection, addDoc, serverTimestamp, getDocs, query, where, doc, getDoc, updateDoc, deleteDoc, getCountFromServer } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError, confirmDelete } from '../../utils/alerts';

interface ClienteBasico {
  id: string;
  nome: string;
  telefone: string;
}

interface VeiculoBasico {
  id: string;
  placa: string;
  modelo: string;
  clienteId: string;
}

const LembreteForm: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = !!id;
  
  const [formData, setFormData] = useState({
    clienteNome: '',
    telefone: '',
    placa: '',
    modelo: '',
    ultimaRevisao: '',
    motivoLembrete: '',
    dataPrevisao: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(isEditing);
  const [motivoPersonalizado, setMotivoPersonalizado] = useState('');
  const [clientesDisponiveis, setClientesDisponiveis] = useState<ClienteBasico[]>([]);
  const [veiculosDisponiveis, setVeiculosDisponiveis] = useState<VeiculoBasico[]>([]);
  const [veiculosDoCliente, setVeiculosDoCliente] = useState<VeiculoBasico[]>([]);
  const [isVeiculoDropdownOpen, setIsVeiculoDropdownOpen] = useState(false);
  const { currentUser, tenantId } = useAuth();
  
  const [isClientDropdownOpen, setIsClientDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsClientDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const fetchClientes = async () => {
      if (!currentUser) return;
      const q = query(collection(db, 'clientes'), where('tenantId', '==', tenantId));
      const querySnapshot = await getDocs(q);
      const data: ClienteBasico[] = [];
      querySnapshot.forEach((doc) => {
        data.push({ id: doc.id, nome: doc.data().nome, telefone: doc.data().telefone });
      });
      setClientesDisponiveis(data);

      const qVeic = query(collection(db, 'veiculos'), where('tenantId', '==', tenantId));
      const snapVeic = await getDocs(qVeic);
      const veicData: VeiculoBasico[] = [];
      snapVeic.forEach((doc) => veicData.push({ id: doc.id, placa: doc.data().placa, modelo: doc.data().modelo, clienteId: doc.data().clienteId }));
      setVeiculosDisponiveis(veicData);

      if (isEditing && id) {
        try {
          const docRef = doc(db, 'lembretes', id);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const lembrete = docSnap.data();
            let dataStr = '';
            if (lembrete.dataPrevisao) {
              const d = lembrete.dataPrevisao.toDate ? lembrete.dataPrevisao.toDate() : new Date(lembrete.dataPrevisao);
              dataStr = d.toISOString().split('T')[0];
            }
            let motivoField = lembrete.motivoLembrete || '';
            const defaultMotivos = ['Troca de Óleo e Filtros', 'Alinhamento e Balanceamento', 'Revisão de Freios', 'Troca de Correia Dentada', 'Revisão Geral Anual'];
            if (!defaultMotivos.includes(motivoField)) {
              setMotivoPersonalizado(motivoField);
              motivoField = 'Outro';
            }

            setFormData({
              clienteNome: lembrete.clienteNome || '',
              telefone: lembrete.telefone || '',
              placa: lembrete.placa || '',
              modelo: lembrete.modelo || '',
              ultimaRevisao: lembrete.ultimaRevisao || '',
              motivoLembrete: motivoField,
              dataPrevisao: dataStr,
            });
          }
        } catch (err) {
          console.error("Erro ao buscar lembrete", err);
          showError('Erro', 'Lembrete não encontrado.');
        }
      }
      setIsFetching(false);
    };
    fetchClientes();
  }, [currentUser, isEditing, id]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    
    if (name === 'clienteNome') {
      const clienteEncontrado = clientesDisponiveis.find(c => c.nome === value);
      if (clienteEncontrado) {
        setFormData({ ...formData, clienteNome: value, telefone: clienteEncontrado.telefone || '' });
        return;
      }
    }
    
    setFormData({ ...formData, [name]: value });
  };

  const setQuickDate = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const dateStr = d.toISOString().split('T')[0];
    setFormData(prev => ({ ...prev, dataPrevisao: dateStr }));
  };

  const handleSave = async (e: React.FormEvent) => {
    const motivoFinal = formData.motivoLembrete === 'Outro' ? motivoPersonalizado : formData.motivoLembrete;
    
    if (!formData.clienteNome || !motivoFinal || !formData.dataPrevisao) {
      showError('Campos obrigatórios', 'Preencha pelo menos Nome do Cliente, Motivo e a Data de Previsão.');
      return;
    }

    setIsLoading(true);

    try {
      if (!currentUser) return;
      // Garantir que cliente existe
      const clienteExiste = clientesDisponiveis.some(c => c.nome.toLowerCase() === formData.clienteNome.toLowerCase());
      if (!clienteExiste) {
        const qC = query(collection(db, 'clientes'), where('tenantId', '==', tenantId));
        const snapC = await getCountFromServer(qC);
        const nextId = snapC.data().count + 1;

        await addDoc(collection(db, 'clientes'), {
          codigo: String(nextId),
          nome: formData.clienteNome,
          telefone: formData.telefone,
          tenantId,
          createdAt: serverTimestamp()
        });
      }

      // Prepara a data no formato pro Firebase
      const [ano, mes, dia] = formData.dataPrevisao.split('-');
      const dataPrevDate = new Date(Number(ano), Number(mes) - 1, Number(dia));

      const lembreteData = {
        ...formData,
        motivoLembrete: motivoFinal,
        dataPrevisao: dataPrevDate,
        tenantId,
      };

      if (isEditing && id) {
        await updateDoc(doc(db, 'lembretes', id), {
          ...lembreteData,
          updatedAt: serverTimestamp()
        });
        showSuccess('Lembrete editado com sucesso!');
      } else {
        await addDoc(collection(db, 'lembretes'), {
          ...lembreteData,
          status: 'Pendente',
          createdAt: serverTimestamp()
        });
        showSuccess('Lembrete salvo com sucesso!');
      }
      
      navigate('/crm/lembretes');
    } catch (error) {
      console.error('Erro ao salvar lembrete:', error);
      showError('Erro', 'Erro ao salvar lembrete. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    const confirmed = await confirmDelete(`o lembrete deste cliente`);
    if (confirmed) {
      try {
        await deleteDoc(doc(db, 'lembretes', id));
        showSuccess('Lembrete excluído!');
        navigate('/crm/lembretes');
      } catch (err) {
        showError('Erro', 'Não foi possível excluir o lembrete.');
      }
    }
  };

  if (isFetching) {
    return <div style={{ padding: '40px', color: 'var(--text-primary)', textAlign: 'center' }}>Carregando dados do lembrete...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="icon-btn back-btn" onClick={() => navigate('/crm/lembretes')} title="Voltar"><ArrowLeft size={20} /></button>
          <div>
            <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0' }}>{isEditing ? 'Editar Lembrete CRM' : 'Novo Lembrete CRM'}</h1>
            <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>{isEditing ? 'Atualize as informações do aviso de manutenção' : 'Crie um aviso futuro de manutenção para um cliente'}</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          {isEditing && (
            <button 
              className="btn-secondary" 
              onClick={handleDelete}
              style={{ color: '#ef4444', borderColor: '#ef444450', display: 'flex', alignItems: 'center' }}
            >
              <Trash2 size={18} style={{ marginRight: 8 }} />
              Excluir Lembrete
            </button>
          )}
          <button 
            className="btn-primary" 
            onClick={handleSave}
            disabled={isLoading}
            style={{ opacity: isLoading ? 0.7 : 1, display: 'flex', alignItems: 'center' }}
          >
            {isLoading ? (
              <Loader2 size={18} className="spin-icon" style={{ marginRight: 8 }} />
            ) : (
              <Save size={18} style={{ marginRight: 8 }} />
            )}
            {isLoading ? 'Salvando...' : (isEditing ? 'Salvar Alterações' : 'Salvar Lembrete')}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '800px' }}>
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)' }}>
            <Bell size={20} style={{ color: 'var(--accent-purple)' }} />
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Dados do Lembrete</h3>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px', position: 'relative' }} ref={dropdownRef}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Cliente *</label>
              <input 
                type="text" 
                name="clienteNome"
                placeholder="Busque ou digite novo cliente..." 
                value={formData.clienteNome}
                onChange={(e) => {
                  handleChange(e);
                  setIsClientDropdownOpen(true);
                }}
                onFocus={() => setIsClientDropdownOpen(true)}
                autoComplete="off"
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
              />
              
              {isClientDropdownOpen && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '4px',
                  backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)', maxHeight: '200px', overflowY: 'auto',
                  boxShadow: '0 10px 25px rgba(0,0,0,0.5)', zIndex: 50
                }}>
                  {clientesDisponiveis
                    .filter(c => c.nome.toLowerCase().includes(formData.clienteNome.toLowerCase()))
                    .map(c => (
                      <div 
                        key={c.id} 
                        onClick={() => {
                          setIsClientDropdownOpen(false);
                          
                          const vDoCliente = veiculosDisponiveis.filter(v => v.clienteId === c.id);
                          if (vDoCliente.length === 1) {
                            const v = vDoCliente[0];
                            setFormData({ ...formData, clienteNome: c.nome, telefone: c.telefone || '', placa: v.placa, modelo: v.modelo });
                            setVeiculosDoCliente([]);
                            setIsVeiculoDropdownOpen(false);
                          } else if (vDoCliente.length > 1) {
                            setFormData({ ...formData, clienteNome: c.nome, telefone: c.telefone || '' });
                            setVeiculosDoCliente(vDoCliente);
                            setIsVeiculoDropdownOpen(true);
                          } else {
                            setFormData({ ...formData, clienteNome: c.nome, telefone: c.telefone || '', placa: '', modelo: '' });
                            setVeiculosDoCliente([]);
                            setIsVeiculoDropdownOpen(false);
                          }
                        }}
                        style={{ padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                        onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'}
                        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        <span style={{ fontWeight: 500, fontSize: '14px' }}>{c.nome}</span>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{c.telefone}</span>
                      </div>
                    ))}
                  {formData.clienteNome && !clientesDisponiveis.some(c => c.nome.toLowerCase() === formData.clienteNome.toLowerCase()) && (
                    <div style={{ padding: '12px 16px', color: 'var(--accent-purple)', fontSize: '13px', fontWeight: 500 }}>
                      <Plus size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }}/>
                      Cadastrar "{formData.clienteNome}" como novo cliente
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Telefone WhatsApp</label>
              <input 
                type="text" 
                name="telefone"
                placeholder="(00) 00000-0000" 
                value={formData.telefone}
                onChange={handleChange}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
              />
            </div>
          </div>


          {isVeiculoDropdownOpen && veiculosDoCliente.length > 1 && (
            <div style={{ padding: '16px', backgroundColor: 'rgba(59, 130, 246, 0.1)', border: '1px dashed #3b82f6', borderRadius: '8px' }}>
              <p style={{ color: '#3b82f6', marginBottom: '12px', fontWeight: 'bold' }}>Selecione o veículo para o lembrete:</p>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {veiculosDoCliente.map(v => (
                  <button 
                    key={v.id} 
                    type="button"
                    onClick={() => {
                      setFormData(prev => ({...prev, placa: v.placa, modelo: v.modelo}));
                      setIsVeiculoDropdownOpen(false);
                    }}
                    style={{ padding: '8px 16px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}
                  >
                    {v.placa} - {v.modelo}
                  </button>
                ))}
                <button 
                  type="button" 
                  onClick={() => setIsVeiculoDropdownOpen(false)} 
                  style={{ padding: '8px 16px', backgroundColor: 'transparent', color: '#3b82f6', border: '1px solid #3b82f6', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}
                >
                  Outro / Não informar
                </button>
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Veículo (Modelo)</label>
              <input 
                type="text" 
                name="modelo"
                placeholder="Ex: Fiat Uno" 
                value={formData.modelo}
                onChange={handleChange}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
              />
            </div>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Placa</label>
              <input 
                type="text" 
                name="placa"
                placeholder="ABC-1234" 
                value={formData.placa}
                onChange={handleChange}
                style={{ textTransform: 'uppercase', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Motivo Preventivo *</label>
              <select 
                name="motivoLembrete"
                value={formData.motivoLembrete}
                onChange={handleChange}
                className="form-select"
              >
                <option value="">Selecione o Motivo...</option>
                <option value="Troca de Óleo e Filtros">Troca de Óleo e Filtros</option>
                <option value="Alinhamento e Balanceamento">Alinhamento e Balanceamento</option>
                <option value="Revisão de Freios">Revisão de Freios</option>
                <option value="Troca de Correia Dentada">Troca de Correia Dentada</option>
                <option value="Revisão Geral Anual">Revisão Geral Anual</option>
                <option value="Outro">Outro (Digitar)</option>
              </select>
              {formData.motivoLembrete === 'Outro' && (
                <input 
                  type="text" 
                  placeholder="Digite o motivo..." 
                  value={motivoPersonalizado}
                  onChange={(e) => setMotivoPersonalizado(e.target.value)}
                  style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)', marginTop: '8px' }}
                />
              )}
            </div>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Data Prevista para o Aviso *</label>
              <input 
                type="date" 
                name="dataPrevisao"
                value={formData.dataPrevisao}
                onChange={handleChange}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)', colorScheme: 'dark' }}
              />
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
                {[7, 30, 90, 180].map((days) => (
                  <button 
                    key={days}
                    type="button" 
                    onClick={() => setQuickDate(days)} 
                    style={{ 
                      backgroundColor: 'var(--bg-secondary)', 
                      border: '1px solid var(--border-color)', 
                      color: 'var(--text-secondary)', 
                      padding: '4px 10px', 
                      borderRadius: '16px', 
                      fontSize: '11px', 
                      cursor: 'pointer', 
                      transition: 'all 0.2s' 
                    }} 
                    onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'var(--accent-purple)'; e.currentTarget.style.color = 'white'; e.currentTarget.style.borderColor = 'var(--accent-purple)'; }} 
                    onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'; e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                  >
                    +{days} Dias
                  </button>
                ))}
              </div>
            </div>
          </div>
          
          <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Data da Última Revisão (opcional)</label>
            <input 
              type="text" 
              name="ultimaRevisao"
              placeholder="Ex: 10/05/2026"
              value={formData.ultimaRevisao}
              onChange={handleChange}
              style={{ width: '50%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
            />
          </div>

        </div>
      </div>
    </div>
  );
};

export default LembreteForm;
