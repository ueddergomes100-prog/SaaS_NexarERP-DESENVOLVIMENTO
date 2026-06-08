import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { collection, doc, getDoc, addDoc, updateDoc, query, where, getDocs, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { ArrowLeft, Save, Car, User, Settings, Hash, MapPin, Calendar, Activity } from 'lucide-react';
import { showSuccess, showError } from '../../utils/alerts';
import '../OS/OS.css'; // Reusing OS styles

interface ClienteBasico { id: string; nome: string; telefone: string; }

const VeiculoForm: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = !!id;
  const { tenantId, currentUser } = useAuth();

  const [formData, setFormData] = useState({
    placa: '',
    modelo: '',
    marca: '',
    ano: '',
    cor: '',
    kmAtual: '',
    clienteId: '',
    clienteNome: ''
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(isEditing);
  const [clientesDisponiveis, setClientesDisponiveis] = useState<ClienteBasico[]>([]);
  const [isClientDropdownOpen, setIsClientDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setIsClientDropdownOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const fetchInitialData = async () => {
      if (!tenantId) return;

      try {
        // Fetch Clientes
        const qC = query(collection(db, 'clientes'), where('tenantId', '==', tenantId));
        const snapC = await getDocs(qC);
        const dataC: ClienteBasico[] = [];
        snapC.forEach((d) => dataC.push({ id: d.id, nome: d.data().nome, telefone: d.data().telefone }));
        setClientesDisponiveis(dataC);

        if (isEditing && id) {
          const docRef = doc(db, 'veiculos', id);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const data = docSnap.data();
            setFormData({
              placa: data.placa || '',
              modelo: data.modelo || '',
              marca: data.marca || '',
              ano: data.ano || '',
              cor: data.cor || '',
              kmAtual: data.kmAtual ? String(data.kmAtual) : '',
              clienteId: data.clienteId || '',
              clienteNome: data.clienteNome || ''
            });
          } else {
            showError('Erro', 'Veículo não encontrado.');
            navigate('/veiculos');
          }
        }
      } catch (error) {
        console.error("Erro ao carregar dados:", error);
      } finally {
        setIsFetching(false);
      }
    };
    fetchInitialData();
  }, [id, isEditing, tenantId, navigate]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'placa') {
      setFormData({ ...formData, [name]: value.toUpperCase() });
    } else {
      setFormData({ ...formData, [name]: value });
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.placa || !formData.modelo || !formData.clienteId) {
      showError('Atenção', 'Os campos Placa, Modelo e Cliente são obrigatórios.');
      return;
    }

    setIsLoading(true);
    try {
      const dataToSave = {
        ...formData,
        kmAtual: formData.kmAtual ? Number(formData.kmAtual) : 0,
        tenantId,
        updatedAt: serverTimestamp()
      };

      if (isEditing && id) {
        await updateDoc(doc(db, 'veiculos', id), dataToSave);
        showSuccess('Veículo atualizado com sucesso!');
      } else {
        // Check if placa already exists
        const qCheck = query(collection(db, 'veiculos'), where('tenantId', '==', tenantId), where('placa', '==', formData.placa));
        const checkSnap = await getDocs(qCheck);
        if (!checkSnap.empty) {
          showError('Atenção', 'Já existe um veículo cadastrado com esta placa.');
          setIsLoading(false);
          return;
        }

        await addDoc(collection(db, 'veiculos'), {
          ...dataToSave,
          createdAt: serverTimestamp()
        });
        showSuccess('Veículo cadastrado com sucesso!');
      }
      navigate('/veiculos');
    } catch (error) {
      console.error("Erro ao salvar veículo:", error);
      showError('Erro', 'Não foi possível salvar o veículo.');
    } finally {
      setIsLoading(false);
    }
  };

  if (isFetching) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '16px' }}>
        <div className="spin-icon" style={{ width: '40px', height: '40px', border: '4px solid var(--accent-purple)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
        <p style={{ color: 'var(--text-muted)' }}>Carregando dados do veículo...</p>
      </div>
    );
  }

  return (
    <div className="os-page">
      <div className="page-header">
        <div className="header-title-group">
          <button className="icon-btn back-btn" onClick={() => navigate('/veiculos')}><ArrowLeft size={20} /></button>
          <div>
            <h1 className="page-title">{isEditing ? 'Editar Veículo' : 'Novo Veículo'}</h1>
            <p className="page-subtitle">{isEditing ? `Placa: ${formData.placa}` : 'Cadastre os detalhes do carro e vincule ao cliente'}</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSave} className="form-grid">
        <div className="form-column">
          <div className="card form-section" style={{ padding: '24px' }}>
            <div className="section-header" style={{ marginBottom: '24px' }}>
              <User size={20} className="section-icon" color="var(--accent-purple)" />
              <h3>Proprietário do Veículo</h3>
            </div>
            
            <div className="input-group" style={{ position: 'relative' }} ref={dropdownRef}>
              <label>Cliente / Dono *</label>
              <input
                type="text"
                name="clienteNome"
                value={formData.clienteNome}
                onChange={(e) => { 
                  setFormData({ ...formData, clienteNome: e.target.value, clienteId: '' }); 
                  setIsClientDropdownOpen(true); 
                }}
                onFocus={() => setIsClientDropdownOpen(true)}
                placeholder="Busque ou digite o nome do cliente"
                autoComplete="off"
                style={{ textTransform: 'uppercase', width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
              />
              {isClientDropdownOpen && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '4px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', maxHeight: '200px', overflowY: 'auto', zIndex: 50, boxShadow: '0 10px 25px rgba(0,0,0,0.5)' }}>
                  {clientesDisponiveis.filter(c => c.nome.toLowerCase().includes(formData.clienteNome.toLowerCase())).map(cliente => (
                    <div 
                      key={cliente.id} 
                      onClick={() => {
                        setFormData({...formData, clienteNome: cliente.nome, clienteId: cliente.id});
                        setIsClientDropdownOpen(false);
                      }}
                      style={{ padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <span style={{ fontWeight: 500 }}>{cliente.nome}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{cliente.telefone}</span>
                    </div>
                  ))}
                  {clientesDisponiveis.filter(c => c.nome.toLowerCase().includes(formData.clienteNome.toLowerCase())).length === 0 && (
                    <div style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center' }}>
                      Nenhum cliente encontrado.
                    </div>
                  )}
                </div>
              )}
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>
              Dica: O cliente já deve estar cadastrado na base.
            </p>
          </div>

          <div className="card form-section" style={{ padding: '24px' }}>
            <div className="section-header" style={{ marginBottom: '24px' }}>
              <Activity size={20} className="section-icon" color="#f59e0b" />
              <h3>Hodômetro</h3>
            </div>
            <div className="input-group">
              <label>Quilometragem Atual (KM)</label>
              <input 
                type="number" 
                name="kmAtual" 
                value={formData.kmAtual} 
                onChange={handleChange} 
                placeholder="Ex: 45000" 
                style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', fontSize: '18px', fontWeight: 600, color: '#f59e0b' }}
              />
            </div>
          </div>
        </div>

        <div className="form-column">
          <div className="card form-section" style={{ padding: '24px' }}>
            <div className="section-header" style={{ marginBottom: '24px' }}>
              <Car size={20} className="section-icon" color="#10b981" />
              <h3>Dados do Veículo</h3>
            </div>
            
            <div className="grid-2-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="input-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Hash size={14}/> Placa *</label>
                <input 
                  type="text" 
                  name="placa" 
                  value={formData.placa} 
                  onChange={handleChange} 
                  placeholder="AAA-0000" 
                  style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: '#10b981', fontWeight: 700, fontSize: '16px', textTransform: 'uppercase' }} 
                  required
                />
              </div>
              
              <div className="input-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Settings size={14}/> Marca</label>
                <input 
                  type="text" 
                  name="marca" 
                  value={formData.marca} 
                  onChange={handleChange} 
                  placeholder="Ex: Honda" 
                  style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} 
                />
              </div>

              <div className="input-group" style={{ gridColumn: 'span 2' }}>
                <label>Modelo *</label>
                <input 
                  type="text" 
                  name="modelo" 
                  value={formData.modelo} 
                  onChange={handleChange} 
                  placeholder="Ex: Civic Touring 1.5 Turbo" 
                  style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} 
                  required
                />
              </div>

              <div className="input-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Calendar size={14}/> Ano</label>
                <input 
                  type="text" 
                  name="ano" 
                  value={formData.ano} 
                  onChange={handleChange} 
                  placeholder="Ex: 2020" 
                  style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} 
                />
              </div>

              <div className="input-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><MapPin size={14}/> Cor</label>
                <input 
                  type="text" 
                  name="cor" 
                  value={formData.cor} 
                  onChange={handleChange} 
                  placeholder="Ex: Prata" 
                  style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} 
                />
              </div>
            </div>
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '32px' }}>
            <button 
              type="submit" 
              className="btn-primary" 
              disabled={isLoading}
              style={{ 
                padding: '16px 32px', 
                borderRadius: '8px',
                fontSize: '16px', 
                fontWeight: 'bold', 
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px'
              }}
            >
              <Save size={20} />
              {isLoading ? 'SALVANDO...' : 'SALVAR VEÍCULO'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

export default VeiculoForm;
