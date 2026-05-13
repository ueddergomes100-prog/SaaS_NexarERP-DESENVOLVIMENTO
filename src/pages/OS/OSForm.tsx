import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, User, Car, FileText, Loader2, Plus, Trash2, Activity, Package } from 'lucide-react';
import { collection, addDoc, updateDoc, doc, getDoc, getDocs, getCountFromServer, serverTimestamp, query, where, setDoc, orderBy, limit } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError } from '../../utils/alerts';
import './OS.css';

interface ClienteBasico { id: string; nome: string; telefone: string; }
interface ServicoData { id: string; nome: string; preco: number; }
interface ServicoSelecionado { id: string; nome: string; preco: number; quantidade: number; }
interface PecaData { id: string; nome: string; precoVenda: number; }
interface PecaSelecionada { id: string; nome: string; preco: number; quantidade: number; }

const OSForm: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams(); // Para modo Edição
  const isEditing = !!id;
  
  const [formData, setFormData] = useState({
    clienteNome: '', clienteTelefone: '',
    placa: '', modelo: '', ano: '', cor: '',
    defeitoRelatado: '', relatorioTecnico: '',
    status: 'Orçamento Pendente', // Status padrão na criação
    numeroOS: '',
    estoqueBaixado: false,
    formaPagamento: 'Dinheiro',
    statusPagamento: 'Pendente',
    mecanicoId: '',
    mecanicoNome: '',
    orcamentoId: '',
  });

  const [mecanicosDisponiveis, setMecanicosDisponiveis] = useState<{id: string, nome: string}[]>([]);

  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingOS, setIsFetchingOS] = useState(isEditing);
  const [clientesDisponiveis, setClientesDisponiveis] = useState<ClienteBasico[]>([]);
  
  const [servicosCatalogo, setServicosCatalogo] = useState<ServicoData[]>([]);
  const [servicoNomeInput, setServicoNomeInput] = useState('');
  const [servicoPrecoInput, setServicoPrecoInput] = useState('');
  const [servicosSelecionados, setServicosSelecionados] = useState<ServicoSelecionado[]>([]);

  const [pecasEstoque, setPecasEstoque] = useState<PecaData[]>([]);
  const [pecaNomeInput, setPecaNomeInput] = useState('');
  const [pecaPrecoInput, setPecaPrecoInput] = useState('');
  const [pecasSelecionadas, setPecasSelecionadas] = useState<PecaSelecionada[]>([]);

  const { currentUser, tenantId } = useAuth();
  
  const [isClientDropdownOpen, setIsClientDropdownOpen] = useState(false);
  const [isServicoDropdownOpen, setIsServicoDropdownOpen] = useState(false);
  const [isPecaDropdownOpen, setIsPecaDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const servicoDropdownRef = useRef<HTMLDivElement>(null);
  const pecaDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsClientDropdownOpen(false);
      }
      if (servicoDropdownRef.current && !servicoDropdownRef.current.contains(event.target as Node)) {
        setIsServicoDropdownOpen(false);
      }
      if (pecaDropdownRef.current && !pecaDropdownRef.current.contains(event.target as Node)) {
        setIsPecaDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const fetchInitialData = async () => {
      if (!currentUser || !tenantId) return;

      // Fetch Clientes
      const qC = query(collection(db, 'clientes'), where('tenantId', '==', tenantId));
      const snapC = await getDocs(qC);
      const dataC: ClienteBasico[] = [];
      snapC.forEach((doc) => dataC.push({ id: doc.id, nome: doc.data().nome, telefone: doc.data().telefone }));
      setClientesDisponiveis(dataC);

      // Fetch Serviços
      const qS = query(collection(db, 'servicos'), where('tenantId', '==', tenantId));
      const snapS = await getDocs(qS);
      const dataS: ServicoData[] = [];
      snapS.forEach((doc) => dataS.push({ id: doc.id, nome: doc.data().nome, preco: doc.data().preco }));
      setServicosCatalogo(dataS);

      // Fetch Estoque
      const qE = query(collection(db, 'estoque'), where('tenantId', '==', tenantId));
      const snapE = await getDocs(qE);
      const dataE: PecaData[] = [];
      snapE.forEach((doc) => dataE.push({ id: doc.id, nome: doc.data().nome, precoVenda: doc.data().precoVenda }));
      setPecasEstoque(dataE);

      // Fetch Mecânicos
      const qM = query(collection(db, 'usuarios'), where('tenantId', '==', tenantId), where('recebeComissao', '==', true));
      const snapM = await getDocs(qM);
      const dataM: {id: string, nome: string}[] = [];
      snapM.forEach((doc) => dataM.push({ id: doc.id, nome: doc.data().nome }));
      setMecanicosDisponiveis(dataM);

      // Fetch OS se for Edição
      if (isEditing && id) {
        try {
          const docRef = doc(db, 'ordens_de_servico', id);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const os = docSnap.data();
            setFormData({
              clienteNome: os.clienteNome || '',
              clienteTelefone: os.clienteTelefone || '',
              placa: os.placa || '',
              modelo: os.modelo || '',
              ano: os.ano || '',
              cor: os.cor || '',
              defeitoRelatado: os.defeitoRelatado || '',
              relatorioTecnico: os.relatorioTecnico || '',
              status: os.status || 'Orçamento Pendente',
              numeroOS: os.numeroOS || '',
              estoqueBaixado: os.estoqueBaixado || false,
              formaPagamento: os.formaPagamento || 'Dinheiro',
              statusPagamento: os.statusPagamento || 'Pendente',
              mecanicoId: os.mecanicoId || '',
              mecanicoNome: os.mecanicoNome || '',
              orcamentoId: os.orcamentoId || '',
            });
            setServicosSelecionados(os.servicos || []);
            setPecasSelecionadas(os.pecas || []);
          } else {
            showError('Erro', 'OS não encontrada.');
            navigate('/os');
          }
        } catch (error) {
          console.error("Erro ao carregar OS:", error);
        } finally {
          setIsFetchingOS(false);
        }
      } else {
        try {
          const qLast = query(collection(db, 'ordens_de_servico'), where('tenantId', '==', tenantId), orderBy('numeroOS', 'desc'), limit(1));
          const snapOS = await getDocs(qLast);
          let nextOsNum = '01';
          if (!snapOS.empty) {
            const lastNum = parseInt(snapOS.docs[0].data().numeroOS) || 0;
            nextOsNum = String(lastNum + 1).padStart(2, '0');
          }
          setFormData(prev => ({ ...prev, numeroOS: nextOsNum }));
        } catch (err) {
          console.error("Erro ao buscar sequencia de OS", err);
          // Fallback para contagem simples se falhar
          const snapCount = await getCountFromServer(query(collection(db, 'ordens_de_servico'), where('tenantId', '==', tenantId)));
          const fallbackNum = String(snapCount.data().count + 1).padStart(2, '0');
          setFormData(prev => ({ ...prev, numeroOS: fallbackNum }));
        }
        setIsFetchingOS(false);
      }
    };
    fetchInitialData();
  }, [id, isEditing, navigate, currentUser, tenantId]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'clienteNome') {
      const clienteEncontrado = clientesDisponiveis.find(c => c.nome === value);
      if (clienteEncontrado) {
        setFormData({ ...formData, clienteNome: value, clienteTelefone: clienteEncontrado.telefone || '' });
        return;
      }
    }
    if (name === 'mecanicoId') {
      const mecEncontrado = mecanicosDisponiveis.find(m => m.id === value);
      setFormData({ ...formData, mecanicoId: value, mecanicoNome: mecEncontrado ? mecEncontrado.nome : '' });
      return;
    }
    setFormData({ ...formData, [name]: value });
  };

  const handleAddServico = async () => {
    if (!servicoNomeInput || !servicoPrecoInput) return;
    const precoNum = parseFloat(servicoPrecoInput.replace(',', '.'));
    
    let servico = servicosCatalogo.find(s => s.nome.toLowerCase() === servicoNomeInput.toLowerCase());
    
    if (!servico && currentUser) {
      setIsLoading(true);
      try {
        const q = query(collection(db, 'servicos'), where('tenantId', '==', currentUser.uid));
        const snap = await getCountFromServer(q);
        const nextId = snap.data().count + 1;
        
        const newRef = await addDoc(collection(db, 'servicos'), {
          codigo: String(nextId),
          nome: servicoNomeInput,
          preco: precoNum,
          categoria: 'Geral',
          tenantId: currentUser.uid,
          createdAt: serverTimestamp()
        });
        servico = { id: newRef.id, nome: servicoNomeInput, preco: precoNum };
        setServicosCatalogo([...servicosCatalogo, servico]);
        showSuccess('Serviço cadastrado no catálogo!');
      } catch (err) {
        showError('Erro', 'Não foi possível cadastrar o serviço.');
      } finally {
        setIsLoading(false);
      }
    }
    
    if (servico) {
      setServicosSelecionados([...servicosSelecionados, { ...servico, preco: precoNum, quantidade: 1 }]);
      setServicoNomeInput('');
      setServicoPrecoInput('');
    }
  };

  const handleRemoveServico = (index: number) => {
    const novos = [...servicosSelecionados];
    novos.splice(index, 1);
    setServicosSelecionados(novos);
  };

  const updatePrecoServico = (index: number, preco: number) => {
    const novos = [...servicosSelecionados];
    novos[index].preco = Math.max(0, preco);
    setServicosSelecionados(novos);
  };

  const handleAddPeca = async () => {
    if (!pecaNomeInput || !pecaPrecoInput) return;
    const precoNum = parseFloat(pecaPrecoInput.replace(',', '.'));
    
    let peca = pecasEstoque.find(p => p.nome.toLowerCase() === pecaNomeInput.toLowerCase());
    
    if (!peca && currentUser) {
      setIsLoading(true);
      try {
        const q = query(collection(db, 'estoque'), where('tenantId', '==', currentUser.uid));
        const snap = await getCountFromServer(q);
        const nextId = snap.data().count + 1;
        
        const newRef = await addDoc(collection(db, 'estoque'), {
          codigo: String(nextId),
          nome: pecaNomeInput,
          precoVenda: precoNum,
          categoria: 'Peças Adicionais',
          quantidade: 10, // Base default para não zerar logo de cara
          tenantId: currentUser.uid,
          createdAt: serverTimestamp()
        });
        peca = { id: newRef.id, nome: pecaNomeInput, precoVenda: precoNum };
        setPecasEstoque([...pecasEstoque, peca]);
        showSuccess('Peça adicionada ao estoque!');
      } catch (err) {
        showError('Erro', 'Não foi possível cadastrar a peça no estoque.');
      } finally {
        setIsLoading(false);
      }
    }
    
    if (peca) {
      setPecasSelecionadas([...pecasSelecionadas, { id: peca.id, nome: peca.nome, preco: precoNum, quantidade: 1 }]);
      setPecaNomeInput('');
      setPecaPrecoInput('');
    }
  };

  const handleRemovePeca = (index: number) => {
    const novas = [...pecasSelecionadas];
    novas.splice(index, 1);
    setPecasSelecionadas(novas);
  };

  const updateQuantidadePeca = (index: number, qtd: number) => {
    const novas = [...pecasSelecionadas];
    novas[index].quantidade = Math.max(1, qtd);
    setPecasSelecionadas(novas);
  };

  const updatePrecoPeca = (index: number, preco: number) => {
    const novas = [...pecasSelecionadas];
    novas[index].preco = Math.max(0, preco);
    setPecasSelecionadas(novas);
  };

  const totalServicos = servicosSelecionados.reduce((acc, curr) => acc + (curr.preco * curr.quantidade), 0);
  const totalPecas = pecasSelecionadas.reduce((acc, curr) => acc + (curr.preco * curr.quantidade), 0);
  const totalOS = totalServicos + totalPecas;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Finalizada': return '#10b981'; // Verde
      case 'Orçamento Pendente': return '#3b82f6'; // Azul
      case 'Aguardando Peça': return '#f59e0b'; // Amarelo
      case 'Em Manutenção': return '#8b5cf6'; // Roxo
      case 'Cancelada': return '#ef4444'; // Vermelho
      default: return '#6b7280'; // Cinza
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.clienteNome || !formData.placa) {
      showError('Campos incompletos', 'Por favor, preencha o Nome do Cliente e a Placa.');
      return;
    }

    setIsLoading(true);

    try {
      // 1. Check and Create Client if new
      if (!currentUser) return;
      const clienteExiste = clientesDisponiveis.some(c => c.nome.toUpperCase() === formData.clienteNome.toUpperCase().trim());
      if (!clienteExiste && formData.clienteNome.trim()) {
        const qC = query(collection(db, 'clientes'), where('tenantId', '==', currentUser.uid));
        const snapC = await getCountFromServer(qC);
        const nextId = snapC.data().count + 1;

        await addDoc(collection(db, 'clientes'), {
          codigo: String(nextId),
          nome: formData.clienteNome.toUpperCase().trim(),
          telefone: formData.clienteTelefone,
          tenantId: currentUser.uid,
          createdAt: serverTimestamp()
        });
      }

      // 2. Lógica de Baixa/Retorno de Estoque
      let estoqueFoiBaixado = formData.estoqueBaixado || false;

      if (formData.status === 'Finalizada' && !estoqueFoiBaixado) {
        for (const peca of pecasSelecionadas) {
          if (peca.id) {
            try {
              const pecaRef = doc(db, 'estoque', peca.id);
              const pecaSnap = await getDoc(pecaRef);
              if (pecaSnap.exists()) {
                const atual = pecaSnap.data().quantidade || 0;
                await updateDoc(pecaRef, { quantidade: Math.max(0, atual - peca.quantidade) });
              }
            } catch (err) {
              console.error(`Erro ao dar baixa na peça ${peca.nome}:`, err);
            }
          }
        }
        estoqueFoiBaixado = true;
      } else if (formData.status === 'Cancelada' && estoqueFoiBaixado) {
        for (const peca of pecasSelecionadas) {
          if (peca.id) {
            try {
              const pecaRef = doc(db, 'estoque', peca.id);
              const pecaSnap = await getDoc(pecaRef);
              if (pecaSnap.exists()) {
                const atual = pecaSnap.data().quantidade || 0;
                await updateDoc(pecaRef, { quantidade: atual + peca.quantidade });
              }
            } catch (err) {
              console.error(`Erro ao retornar peça ${peca.nome}:`, err);
            }
          }
        }
        estoqueFoiBaixado = false;
      }

      // 3. Prepare OS Data
      const osData = {
        ...formData,
        clienteNome: formData.clienteNome.toUpperCase().trim(),
        servicos: servicosSelecionados,
        pecas: pecasSelecionadas,
        valorTotal: totalOS,
        statusColor: getStatusColor(formData.status),
        estoqueBaixado: estoqueFoiBaixado
      };

      let osId = id;

      if (isEditing && id) {
        const docRef = doc(db, 'ordens_de_servico', id);
        await updateDoc(docRef, { ...osData, updatedAt: serverTimestamp() });
      } else {
        const newOsRef = await addDoc(collection(db, 'ordens_de_servico'), { 
          ...osData, 
          tenantId: currentUser.uid,
          createdAt: serverTimestamp() 
        });
        osId = newOsRef.id;
      }

      // 4. Integração BLINDADA com o Financeiro (Evita duplicação)
      if (osId) {
        const transacaoRef = doc(db, 'transacoes', osId);
        
        let calcStatusPagamento = 'Pendente'; // Cartão, Boleto, Fiado vão pro Contas a Receber
        if (formData.formaPagamento === 'Dinheiro' || formData.formaPagamento === 'Pix') {
          calcStatusPagamento = 'Paga'; // Dinheiro e Pix vão direto pro Caixa Principal
        }

        const transacaoData = {
          descricao: `Recebimento OS #${formData.numeroOS || osId.substring(0,6).toUpperCase()}`,
          categoria: 'Serviços Automotivos',
          valor: totalOS,
          tipo: 'entrada',
          formaPagamento: formData.formaPagamento,
          status: formData.status === 'Finalizada' ? calcStatusPagamento : (formData.status === 'Cancelada' ? 'Cancelada' : 'Pendente'),
          osId: osId,
          clienteNome: formData.clienteNome.toUpperCase().trim(),
          tenantId: currentUser.uid
        };

        if (formData.status === 'Finalizada') {
          await setDoc(transacaoRef, { ...transacaoData, createdAt: serverTimestamp() }, { merge: true });
        } else if (isEditing) {
          // Se reabriu a OS (não está mais finalizada) ou Cancelou, atualiza a transação para não somar no caixa
          await setDoc(transacaoRef, { ...transacaoData }, { merge: true });
        }
      }

      // 5. Atualizar Orçamento vinculado
      if (formData.orcamentoId) {
        try {
          const novoStatusOrcamento = formData.status === 'Cancelada' ? 'Pendente' : 'Finalizado';
          await updateDoc(doc(db, 'orcamentos', formData.orcamentoId), { status: novoStatusOrcamento });
        } catch (err) {
          console.error("Erro ao atualizar orçamento vinculado:", err);
        }
      }
      
      showSuccess(`OS ${isEditing ? 'atualizada' : 'criada'}!`);
      navigate('/os');
    } catch (error) {
      console.error('Erro ao salvar OS:', error);
      showError('Erro ao salvar', 'Verifique a conexão e tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  if (isFetchingOS) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'white' }}>Carregando dados da Ordem de Serviço...</div>;
  }

  return (
    <div className="os-page">
      <div className="page-header">
        <div className="header-title-group">
          <button className="icon-btn back-btn" onClick={() => navigate('/os')}><ArrowLeft size={20} /></button>
          <div>
            <h1 className="page-title">{isEditing ? 'Editar Ordem de Serviço' : 'Nova Ordem de Serviço'}</h1>
            <p className="page-subtitle">{isEditing ? `Gerenciando OS #${formData.numeroOS || id?.substring(0,6).toUpperCase()}` : `Preencha os dados (OS #${formData.numeroOS})`}</p>
          </div>
        </div>
        <button className="btn-primary" onClick={handleSave} disabled={isLoading} style={{ opacity: isLoading ? 0.7 : 1, display: 'flex', alignItems: 'center' }}>
          {isLoading ? <Loader2 size={18} className="spin-icon" style={{ marginRight: 8 }} /> : <Save size={18} style={{ marginRight: 8 }} />}
          {isLoading ? 'Salvando...' : 'Salvar OS'}
        </button>
      </div>

      <div className="form-grid">
        <div className="form-column">
          
          {/* Controle de Status */}
          <div className="card form-section" style={{ border: `1px solid ${getStatusColor(formData.status)}50` }}>
             <div className="section-header">
              <Activity size={20} className="section-icon" style={{ color: getStatusColor(formData.status) }} />
              <h3>Status da Ordem de Serviço</h3>
            </div>
            <div className="input-group">
              <select 
                name="status" 
                value={formData.status} 
                onChange={handleChange} 
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'white', fontWeight: 'bold' }}
              >
                <option value="Orçamento Pendente">Orçamento Pendente</option>
                <option value="Aguardando Peça">Aguardando Peça</option>
                <option value="Em Manutenção">Em Manutenção</option>
                <option value="Finalizada">Finalizada (Gera Receita no Caixa)</option>
                <option value="Cancelada">Cancelada</option>
              </select>
            </div>
            
            {formData.status === 'Finalizada' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px', padding: '16px', backgroundColor: 'rgba(16, 185, 129, 0.05)', borderRadius: 'var(--radius-md)', border: '1px dashed rgba(16, 185, 129, 0.3)' }}>
                <div className="input-group">
                  <label style={{ fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#10b981', fontWeight: 700 }}>Selecione a Forma de Pagamento</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px', marginTop: '8px' }}>
                    {[
                      { value: 'Dinheiro', icon: '💵' },
                      { value: 'Pix', icon: '💠' },
                      { value: 'Cartão de Crédito', icon: '💳' },
                      { value: 'Cartão de Débito', icon: '💳' },
                      { value: 'Boleto', icon: '📄' },
                      { value: 'A Prazo / Fiado', icon: '🤝' }
                    ].map(metodo => (
                      <div 
                        key={metodo.value}
                        onClick={() => setFormData({...formData, formaPagamento: metodo.value})}
                        style={{
                          backgroundColor: formData.formaPagamento === metodo.value ? 'rgba(16, 185, 129, 0.2)' : 'var(--bg-secondary)',
                          border: `1px solid ${formData.formaPagamento === metodo.value ? '#10b981' : 'var(--border-color)'}`,
                          padding: '12px 8px',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px',
                          transition: 'all 0.2s',
                          transform: formData.formaPagamento === metodo.value ? 'scale(1.02)' : 'scale(1)',
                          boxShadow: formData.formaPagamento === metodo.value ? '0 4px 12px rgba(16, 185, 129, 0.2)' : 'none'
                        }}
                      >
                        <span style={{ fontSize: '20px' }}>{metodo.icon}</span>
                        <span style={{ fontSize: '12px', fontWeight: formData.formaPagamento === metodo.value ? 600 : 400, color: formData.formaPagamento === metodo.value ? '#10b981' : 'var(--text-primary)', textAlign: 'center' }}>{metodo.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {(formData.formaPagamento === 'Dinheiro' || formData.formaPagamento === 'Pix') 
                    ? <span style={{ color: '#10b981' }}>✓ Irá somar automaticamente no saldo do <strong>Caixa</strong>.</span>
                    : <span style={{ color: '#f59e0b' }}>ℹ️ Será enviado para a tela de <strong>Contas a Receber</strong> (Aguardando Conciliação).</span>}
                </div>
              </div>
            )}
          </div>

          <div className="card form-section">
            <div className="section-header">
              <User size={20} className="section-icon" />
              <h3>Dados do Cliente</h3>
            </div>
            <div className="input-group" style={{ position: 'relative' }} ref={dropdownRef}>
              <label>Nome do Cliente *</label>
              <input 
                type="text" 
                name="clienteNome" 
                placeholder="Busque ou digite novo..." 
                value={formData.clienteNome} 
                onChange={(e) => {
                  handleChange(e);
                  setIsClientDropdownOpen(true);
                }} 
                onFocus={() => setIsClientDropdownOpen(true)}
                autoComplete="off" 
                style={{ textTransform: 'uppercase' }}
              />
              {isClientDropdownOpen && (
                <div className="select-dropdown">
                  {clientesDisponiveis
                    .filter(c => c.nome.toLowerCase().includes(formData.clienteNome.toLowerCase()))
                    .map(c => (
                      <div 
                        key={c.id} 
                        className="select-option"
                        onClick={() => {
                          setFormData({ ...formData, clienteNome: c.nome, clienteTelefone: c.telefone || '' });
                          setIsClientDropdownOpen(false);
                        }}
                      >
                        <span>{c.nome}</span>
                        <span>{c.telefone}</span>
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
            <div className="input-group">
              <label>Telefone / WhatsApp</label>
              <input type="text" name="clienteTelefone" placeholder="(00) 00000-0000" value={formData.clienteTelefone} onChange={handleChange} />
            </div>
          </div>

          <div className="card form-section">
            <div className="section-header">
              <Car size={20} className="section-icon" />
              <h3>Dados do Veículo</h3>
            </div>
            <div className="grid-2-col">
              <div className="input-group"><label>Placa *</label><input type="text" name="placa" placeholder="ABC-1234" style={{ textTransform: 'uppercase' }} value={formData.placa} onChange={handleChange} /></div>
              <div className="input-group"><label>Modelo</label><input type="text" name="modelo" placeholder="Ex: Honda Civic" value={formData.modelo} onChange={handleChange} /></div>
              <div className="input-group"><label>Ano</label><input type="text" name="ano" placeholder="Ex: 2018" value={formData.ano} onChange={handleChange} /></div>
              <div className="input-group"><label>Cor</label><input type="text" name="cor" placeholder="Ex: Prata" value={formData.cor} onChange={handleChange} /></div>
            </div>
          </div>

          <div className="card form-section">
            <div className="section-header">
              <FileText size={20} className="section-icon" />
              <h3>Inclusão de Serviços e Mão de Obra</h3>
            </div>
            
            <div className="input-group" style={{ marginBottom: '20px', paddingBottom: '20px', borderBottom: '1px dashed var(--border-color)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                Mecânico Responsável (Gera Comissão)
                <span style={{ fontSize: '11px', backgroundColor: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', padding: '2px 6px', borderRadius: '4px' }}>Opcional</span>
              </label>
              <select 
                name="mecanicoId" 
                value={formData.mecanicoId} 
                onChange={handleChange} 
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'white', width: '100%' }}
              >
                <option value="">-- Selecione o Mecânico (Nenhum) --</option>
                {mecanicosDisponiveis.map(m => (
                  <option key={m.id} value={m.id}>{m.nome}</option>
                ))}
              </select>
            </div>

            <div className="item-add-container" style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              <div style={{ flex: 2, position: 'relative' }} ref={servicoDropdownRef}>
                <input 
                  type="text" 
                  placeholder="Busque ou digite novo Serviço"
                  value={servicoNomeInput}
                  onChange={(e) => {
                    setServicoNomeInput(e.target.value);
                    setIsServicoDropdownOpen(true);
                    const exists = servicosCatalogo.find(s => s.nome.toLowerCase() === e.target.value.toLowerCase());
                    if (exists) setServicoPrecoInput(String(exists.preco));
                  }}
                  onFocus={() => setIsServicoDropdownOpen(true)}
                  autoComplete="off"
                  style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'white' }}
                />
                {isServicoDropdownOpen && servicosCatalogo.filter(s => s.nome.toLowerCase().includes(servicoNomeInput.toLowerCase())).length > 0 && (
                  <div className="select-dropdown">
                    {servicosCatalogo
                      .filter(s => s.nome.toLowerCase().includes(servicoNomeInput.toLowerCase()))
                      .map(s => (
                        <div 
                          key={s.id}
                          className="select-option"
                          onClick={() => {
                            setServicoNomeInput(s.nome);
                            setServicoPrecoInput(String(s.preco));
                            setIsServicoDropdownOpen(false);
                          }}
                        >
                          <span>{s.nome}</span>
                          <span>R$ {s.preco.toFixed(2)}</span>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              <input 
                type="number" 
                placeholder="R$ Valor"
                value={servicoPrecoInput}
                onChange={(e) => setServicoPrecoInput(e.target.value)}
                style={{ flex: 1, backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'white' }}
              />
              
              <button className="btn-secondary" type="button" onClick={handleAddServico} disabled={!servicoNomeInput || !servicoPrecoInput}><Plus size={18} /></button>
            </div>
            
            {servicosSelecionados.length > 0 && (
              <div style={{ backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', padding: '12px' }}>
                <table style={{ width: '100%', fontSize: '13px' }}>
                  <tbody>
                    {servicosSelecionados.map((s, index) => (
                      <tr key={index} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '8px 0' }}>{s.nome}</td>
                        <td style={{ padding: '8px 0', width: '120px' }}>
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            <span style={{ color: 'var(--text-muted)', marginRight: '4px' }}>R$</span>
                            <input 
                              type="number" 
                              value={s.preco} 
                              onChange={e => updatePrecoServico(index, Number(e.target.value))}
                              style={{ width: '100%', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'white', padding: '6px', borderRadius: '4px', fontSize: '13px' }} 
                              min="0" 
                              step="0.01"
                            />
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', width: '40px' }}>
                          <button onClick={() => handleRemoveServico(index)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}><Trash2 size={16} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td style={{ padding: '12px 0 0', fontWeight: 'bold' }}>Subtotal Serviços:</td>
                      <td colSpan={2} style={{ textAlign: 'right', padding: '12px 0 0', fontWeight: 'bold', color: '#10b981', fontSize: '14px' }}>
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalServicos)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
          
          <div className="card form-section">
            <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Package size={20} className="section-icon" />
                <h3>Inclusão de Peças (Estoque)</h3>
              </div>
              {formData.estoqueBaixado && (
                <span style={{ fontSize: '11px', backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981', padding: '4px 8px', borderRadius: '4px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                  Estoque Baixado
                </span>
              )}
            </div>
            <div className="item-add-container" style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              <div style={{ flex: 2, position: 'relative' }} ref={pecaDropdownRef}>
                <input 
                  type="text" 
                  placeholder="Busque ou digite nova Peça"
                  value={pecaNomeInput}
                  onChange={(e) => {
                    setPecaNomeInput(e.target.value);
                    setIsPecaDropdownOpen(true);
                    const exists = pecasEstoque.find(p => p.nome.toLowerCase() === e.target.value.toLowerCase());
                    if (exists) setPecaPrecoInput(String(exists.precoVenda));
                  }}
                  onFocus={() => setIsPecaDropdownOpen(true)}
                  autoComplete="off"
                  style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'white' }}
                />
                {isPecaDropdownOpen && pecasEstoque.filter(p => p.nome.toLowerCase().includes(pecaNomeInput.toLowerCase())).length > 0 && (
                  <div className="select-dropdown">
                    {pecasEstoque
                      .filter(p => p.nome.toLowerCase().includes(pecaNomeInput.toLowerCase()))
                      .map(p => (
                        <div 
                          key={p.id}
                          className="select-option"
                          onClick={() => {
                            setPecaNomeInput(p.nome);
                            setPecaPrecoInput(String(p.precoVenda));
                            setIsPecaDropdownOpen(false);
                          }}
                        >
                          <span>{p.nome}</span>
                          <span>R$ {p.precoVenda.toFixed(2)}</span>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              <input 
                type="number" 
                placeholder="R$ Valor"
                value={pecaPrecoInput}
                onChange={(e) => setPecaPrecoInput(e.target.value)}
                style={{ flex: 1, backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'white' }}
              />
              
              <button className="btn-secondary" type="button" onClick={handleAddPeca} disabled={!pecaNomeInput || !pecaPrecoInput}><Plus size={18} /></button>
            </div>
            
            {pecasSelecionadas.length > 0 && (
              <div style={{ backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', padding: '12px' }}>
                <table style={{ width: '100%', fontSize: '13px' }}>
                  <tbody>
                    {pecasSelecionadas.map((p, index) => (
                      <tr key={index} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '8px 0' }}>{p.nome}</td>
                        <td style={{ padding: '8px 0', width: '70px' }}>
                          <input 
                            type="number" 
                            value={p.quantidade} 
                            onChange={e => updateQuantidadePeca(index, Number(e.target.value))}
                            style={{ width: '100%', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'white', padding: '6px', borderRadius: '4px', fontSize: '13px' }} 
                            min="1" 
                          />
                        </td>
                        <td style={{ padding: '8px 0', width: '120px' }}>
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            <span style={{ color: 'var(--text-muted)', marginRight: '4px' }}>R$</span>
                            <input 
                              type="number" 
                              value={p.preco} 
                              onChange={e => updatePrecoPeca(index, Number(e.target.value))}
                              style={{ width: '100%', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'white', padding: '6px', borderRadius: '4px', fontSize: '13px' }} 
                              min="0" 
                              step="0.01"
                            />
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', width: '40px' }}>
                          <button onClick={() => handleRemovePeca(index)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}><Trash2 size={16} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={2} style={{ padding: '12px 0 0', fontWeight: 'bold' }}>Subtotal Peças:</td>
                      <td colSpan={2} style={{ textAlign: 'right', padding: '12px 0 0', fontWeight: 'bold', color: '#10b981', fontSize: '14px' }}>
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalPecas)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
          
          <div className="card form-section" style={{ backgroundColor: '#10b98115', border: '1px solid #10b98150' }}>
            <div className="total-os-container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '18px' }}>VALOR TOTAL DA OS</h3>
              <h2 style={{ margin: 0, fontSize: '24px', color: '#10b981' }}>
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalOS)}
              </h2>
            </div>
          </div>
        </div>

        <div className="form-column">
          <div className="card form-section fill-height">
            <div className="section-header">
              <FileText size={20} className="section-icon" />
              <h3>Relatório Técnico (Impressão)</h3>
            </div>
            <div className="input-group">
              <label>Defeito Relatado (Cliente)</label>
              <textarea name="defeitoRelatado" placeholder="Descreva o problema reclamado pelo cliente..." rows={3} value={formData.defeitoRelatado} onChange={handleChange}></textarea>
            </div>
            <div className="input-group" style={{ flex: 1 }}>
              <label>Relatório do Técnico (O que foi feito)</label>
              <textarea name="relatorioTecnico" placeholder="Descreva tecnicamente o que foi encontrado e reparado no veículo..." rows={10} value={formData.relatorioTecnico} onChange={handleChange}></textarea>
            </div>
          </div>
        </div>
      </div>

      {/* Botão de Salvar no final da página, alinhado à direita */}
      <div className="save-os-container" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px', marginBottom: '40px' }}>
        <button 
          className="btn-primary" 
          onClick={handleSave} 
          disabled={isLoading} 
          style={{ 
            padding: '16px 32px', 
            borderRadius: '8px', 
            display: 'flex', 
            alignItems: 'center',
            fontSize: '16px',
            fontWeight: 'bold',
            opacity: isLoading ? 0.8 : 1,
            transition: 'all 0.2s ease',
          }}
        >
          {isLoading ? <Loader2 size={20} className="spin-icon" style={{ marginRight: 8 }} /> : <Save size={20} style={{ marginRight: 8 }} />}
          {isLoading ? 'Salvando...' : 'SALVAR ORDEM DE SERVIÇO'}
        </button>
      </div>
    </div>
  );
};

export default OSForm;
