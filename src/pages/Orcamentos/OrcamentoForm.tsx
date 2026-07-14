import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { 
  ArrowLeft, Save, User, Car, FileText, Loader2, Plus, Trash2, 
  Calendar, Package, Wrench, Printer, ShoppingCart, Share2, X
} from 'lucide-react';
import { 
  collection, updateDoc, doc, getDoc, getDocs,
  getCountFromServer, serverTimestamp, query, where, runTransaction
} from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { applyStockAdjustments, formatSequenceValue, getCurrentMaxSequence, getNextTenantSequenceValue, reserveTenantSequence, writeTenantSequenceValue } from '../../utils/firestoreAtomic';
import '../OS/OS.css';

interface ClienteBasico { id: string; nome: string; telefone: string; }
interface ServicoData { id: string; nome: string; preco: number; }
interface ItemOrcamento { id: string; nome: string; preco: number; quantidade: number; tipo: 'servico' | 'peca'; }
interface VeiculoBasico { id: string; placa: string; modelo: string; ano: string; cor: string; clienteId: string; }

const OrcamentoForm: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = !!id;
  
  const [formData, setFormData] = useState({
    clienteNome: '', 
    clienteTelefone: '',
    placa: '', 
    modelo: '', 
    ano: '', 
    cor: '',
    observacoes: '',
    status: 'Pendente', 
    numeroOrcamento: '',
    validadeDias: '15',
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(isEditing);
  const [permitirVendaSemEstoque, setPermitirVendaSemEstoque] = useState(false);
  const [clientesDisponiveis, setClientesDisponiveis] = useState<ClienteBasico[]>([]);
  const [veiculosDisponiveis, setVeiculosDisponiveis] = useState<VeiculoBasico[]>([]);
  const [veiculosDoCliente, setVeiculosDoCliente] = useState<VeiculoBasico[]>([]);
  const [isVeiculoDropdownOpen, setIsVeiculoDropdownOpen] = useState(false);
  
  const [servicosCatalogo, setServicosCatalogo] = useState<ServicoData[]>([]);
  const [servicoNomeInput, setServicoNomeInput] = useState('');
  const [servicoPrecoInput, setServicoPrecoInput] = useState('');
  
  const [pecasEstoque, setPecasEstoque] = useState<any[]>([]);
  const [pecaNomeInput, setPecaNomeInput] = useState('');
  const [pecaPrecoInput, setPecaPrecoInput] = useState('');

  const [itens, setItens] = useState<ItemOrcamento[]>([]);

  const { currentUser, tenantId } = useAuth();
  
  const [isClientDropdownOpen, setIsClientDropdownOpen] = useState(false);
  const [isServicoDropdownOpen, setIsServicoDropdownOpen] = useState(false);
  const [isPecaDropdownOpen, setIsPecaDropdownOpen] = useState(false);
  
  const dropdownRef = useRef<HTMLDivElement>(null);
  const servicoDropdownRef = useRef<HTMLDivElement>(null);
  const pecaDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setIsClientDropdownOpen(false);
      if (servicoDropdownRef.current && !servicoDropdownRef.current.contains(event.target as Node)) setIsServicoDropdownOpen(false);
      if (pecaDropdownRef.current && !pecaDropdownRef.current.contains(event.target as Node)) setIsPecaDropdownOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const fetchInitialData = async () => {
      if (!currentUser || !tenantId) return;

      try {
        const qC = query(collection(db, 'clientes'), where('tenantId', '==', tenantId));
        const snapC = await getDocs(qC);
        const dataC: ClienteBasico[] = [];
        snapC.forEach((doc) => dataC.push({ id: doc.id, nome: doc.data().nome, telefone: doc.data().telefone }));
        setClientesDisponiveis(dataC);

        const qV = query(collection(db, 'veiculos'), where('tenantId', '==', tenantId));
        const snapV = await getDocs(qV);
        const dataV: VeiculoBasico[] = [];
        snapV.forEach((doc) => dataV.push({ id: doc.id, placa: doc.data().placa, modelo: doc.data().modelo, ano: doc.data().ano, cor: doc.data().cor, clienteId: doc.data().clienteId }));
        setVeiculosDisponiveis(dataV);

        const qS = query(collection(db, 'servicos'), where('tenantId', '==', tenantId));
        const snapS = await getDocs(qS);
        const dataS: ServicoData[] = [];
        snapS.forEach((doc) => dataS.push({ id: doc.id, nome: doc.data().nome, preco: doc.data().preco }));
        setServicosCatalogo(dataS);

        const qE = query(collection(db, 'estoque'), where('tenantId', '==', tenantId));
        const snapE = await getDocs(qE);
        const dataE: any[] = [];
        snapE.forEach((doc) => dataE.push({ id: doc.id, ...doc.data() }));
        setPecasEstoque(dataE);

        // Fetch Configurações
        try {
          const configRef = doc(db, 'configuracoes', tenantId);
          const configSnap = await getDoc(configRef);
          if (configSnap.exists()) {
            setPermitirVendaSemEstoque(configSnap.data().venderSemEstoque === true);
          }
        } catch (err) { console.error(err); }

        if (isEditing && id) {
          const docRef = doc(db, 'orcamentos', id);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const data = docSnap.data();
            setFormData({
              clienteNome: data.clienteNome || '',
              clienteTelefone: data.clienteTelefone || '',
              placa: data.placa || '',
              modelo: data.modelo || '',
              ano: data.ano || '',
              cor: data.cor || '',
              observacoes: data.observacoes || '',
              status: data.status || 'Pendente',
              numeroOrcamento: data.numeroOrcamento || '',
              validadeDias: data.validadeDias || '15',
            });
            
            const loadedItens: ItemOrcamento[] = [];
            if (data.servicos) data.servicos.forEach((s: any) => loadedItens.push({ ...s, tipo: 'servico' }));
            if (data.pecas) data.pecas.forEach((p: any) => loadedItens.push({ ...p, tipo: 'peca' }));
            setItens(loadedItens);
          }
        } else {
          const snap = await getCountFromServer(query(collection(db, 'orcamentos'), where('tenantId', '==', tenantId)));
          const nextNum = String(snap.data().count + 1).padStart(4, '0');
          setFormData(prev => ({ ...prev, numeroOrcamento: nextNum }));
        }
      } catch (error) {
        console.error("Erro ao carregar dados:", error);
      } finally {
        setIsFetching(false);
      }
    };
    fetchInitialData();
  }, [id, isEditing, currentUser, tenantId]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleClearServicoInput = () => {
    setServicoNomeInput('');
    setServicoPrecoInput('');
    setIsServicoDropdownOpen(false);
  };

  const handleClearPecaInput = () => {
    setPecaNomeInput('');
    setPecaPrecoInput('');
    setIsPecaDropdownOpen(false);
  };

  const handleAddItem = (tipo: 'servico' | 'peca') => {
    const nome = tipo === 'servico' ? servicoNomeInput : pecaNomeInput;
    const preco = tipo === 'servico' ? servicoPrecoInput : pecaPrecoInput;
    
    if (!nome || !preco) return;
    
    const precoNum = parseFloat(preco.replace(',', '.'));
    const catalogo = tipo === 'servico' ? servicosCatalogo : pecasEstoque;
    const exists = catalogo.find(i => i.nome.toLowerCase() === nome.toLowerCase());

    if (tipo === 'peca') {
      if (!permitirVendaSemEstoque && exists) {
        if (1 > (exists.quantidade || 0)) {
          showError('Estoque Insuficiente', `Você tem apenas ${exists.quantidade || 0} un. no estoque. Venda sem estoque desativada.`);
          return;
        }
      }
    }

    const novoItem: ItemOrcamento = {
      id: exists?.id || 'avulso',
      nome: nome.toUpperCase(),
      preco: precoNum,
      quantidade: 1,
      tipo
    };

    setItens([...itens, novoItem]);
    
    if (tipo === 'servico') {
      setServicoNomeInput('');
      setServicoPrecoInput('');
    } else {
      setPecaNomeInput('');
      setPecaPrecoInput('');
    }
  };

  const removeItem = (index: number) => {
    setItens(itens.filter((_, i) => i !== index));
  };

  const updateItemQtd = (index: number, qtd: number) => {
    const novos = [...itens];
    const novaQtd = Math.max(1, qtd);
    
    if (novos[index].tipo === 'peca' && !permitirVendaSemEstoque) {
      const pecaEstoque = pecasEstoque.find(p => p.id === novos[index].id);
      if (pecaEstoque && novaQtd > (pecaEstoque.quantidade || 0)) {
        showError('Estoque Insuficiente', `Você tem apenas ${pecaEstoque.quantidade || 0} un. no estoque.`);
        return;
      }
    }

    novos[index].quantidade = novaQtd;
    setItens(novos);
  };

  const totalServicos = itens.filter(i => i.tipo === 'servico').reduce((acc, curr) => acc + (curr.preco * curr.quantidade), 0);
  const totalPecas = itens.filter(i => i.tipo === 'peca').reduce((acc, curr) => acc + (curr.preco * curr.quantidade), 0);
  const totalGeral = totalServicos + totalPecas;

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!formData.clienteNome) {
      showError('Erro', 'Informe o nome do cliente.');
      return;
    }

    setIsLoading(true);
    try {
      if (!currentUser || !tenantId) return;

      const dataToSave = {
        ...formData,
        clienteNome: formData.clienteNome.toUpperCase().trim(),
        servicos: itens.filter(i => i.tipo === 'servico'),
        pecas: itens.filter(i => i.tipo === 'peca'),
        valorTotal: totalGeral,
        tenantId,
        updatedAt: serverTimestamp(),
      };

      if (isEditing && id) {
        await updateDoc(doc(db, 'orcamentos', id), dataToSave);
      } else {
        let finalNumeroOrcamento = formData.numeroOrcamento;
        const currentMaxOrcamento = await getCurrentMaxSequence(db, 'orcamentos', tenantId, 'numeroOrcamento').catch(() => 0);

        await runTransaction(db, async (transaction) => {
          const nextOrcamento = await reserveTenantSequence(transaction, db, tenantId, 'orcamentos', currentMaxOrcamento);
          finalNumeroOrcamento = formatSequenceValue(nextOrcamento, 4);
          const newOrcamentoRef = doc(collection(db, 'orcamentos'));
          transaction.set(newOrcamentoRef, {
            ...dataToSave,
            numeroOrcamento: finalNumeroOrcamento,
            createdAt: serverTimestamp(),
          });
        });
        setFormData(prev => ({ ...prev, numeroOrcamento: finalNumeroOrcamento }));
      }

      showSuccess(`Orçamento ${isEditing ? 'atualizado' : 'criado'}!`);
      navigate('/orcamentos');
    } catch {
      showError('Erro', 'Não foi possível salvar o orçamento.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConvertToOS = async () => {
    const confirm = await NexusSwal.fire({
      title: 'Converter para OS?',
      text: 'Será criada uma nova Ordem de Serviço.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sim, Gerar OS',
      cancelButtonText: 'Cancelar'
    });

      if (confirm.isConfirmed) {
      setIsLoading(true);
      try {
        if (!tenantId) throw new Error('Tenant nao carregado.');
        const currentMaxOs = await getCurrentMaxSequence(db, 'ordens_de_servico', tenantId, 'numeroOS').catch(() => 0);
        let newOsId = '';

        await runTransaction(db, async (transaction) => {
          const nextOs = await reserveTenantSequence(transaction, db, tenantId, 'ordens_de_servico', currentMaxOs);
          const newRef = doc(collection(db, 'ordens_de_servico'));
          newOsId = newRef.id;

          transaction.set(newRef, {
            numeroOS: formatSequenceValue(nextOs, 2),
            clienteNome: formData.clienteNome.toUpperCase(),
            clienteTelefone: formData.clienteTelefone,
            placa: formData.placa,
            modelo: formData.modelo,
            ano: formData.ano,
            cor: formData.cor,
            status: 'Orçamento Aprovado',
            servicos: itens.filter(i => i.tipo === 'servico'),
            pecas: itens.filter(i => i.tipo === 'peca'),
            valorTotal: totalGeral,
            tenantId,
            createdAt: serverTimestamp(),
            orcamentoId: id
          });

          if (id) transaction.update(doc(db, 'orcamentos', id), { status: 'Finalizado' });
        });
        showSuccess('Convertido em OS!');
        navigate(`/os/editar/${newOsId}`);
      } catch {
        showError('Erro ao converter');
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleConvertToVenda = async () => {
    const confirm = await NexusSwal.fire({
      title: 'Converter para Venda?',
      text: 'Isso criará um Pedido de Venda e baixará o estoque.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sim, Finalizar Venda',
      cancelButtonText: 'Cancelar'
    });

    if (confirm.isConfirmed) {
      setIsLoading(true);
      try {
        // Filtrar apenas PEÇAS para a Venda
        const soPecas = itens.filter(i => i.tipo === 'peca');
        const valorProdutos = soPecas.reduce((acc, i) => acc + (i.preco * i.quantidade), 0);

        if (soPecas.length === 0) {
          showError('Erro', 'Este orçamento não contém peças para gerar uma venda.');
          setIsLoading(false);
          return;
        }

        if (!tenantId) throw new Error('Tenant nao carregado.');
        const currentMaxPedido = await getCurrentMaxSequence(db, 'pedidos_venda', tenantId, 'numeroPedido').catch(() => 0);

        await runTransaction(db, async (transaction) => {
          const nextPedido = await getNextTenantSequenceValue(transaction, db, tenantId, 'pedidos_venda', currentMaxPedido);
          const newVendaRef = doc(collection(db, 'pedidos_venda'));
          const vendaItens = soPecas.map(i => ({
            id: i.id,
            nome: i.nome,
            precoUnitario: i.preco,
            quantidade: i.quantidade,
            desconto: 0,
            subtotal: i.preco * i.quantidade
          }));

          await applyStockAdjustments(
            transaction,
            db,
            vendaItens.map(item => ({ id: item.id, nome: item.nome, quantidade: item.quantidade })),
            'decrement',
            permitirVendaSemEstoque
          );

          writeTenantSequenceValue(transaction, db, tenantId, 'pedidos_venda', nextPedido);

          transaction.set(newVendaRef, {
            numeroPedido: formatSequenceValue(nextPedido, 4),
            clienteNome: formData.clienteNome.toUpperCase(),
            itens: vendaItens,
            valorTotalItens: valorProdutos,
            valorTotalDescontos: 0,
            valorTotal: valorProdutos,
            formaPagamento: 'Dinheiro',
            status: 'Finalizada',
            tenantId,
            usuarioResponsavelId: currentUser?.uid || '',
            createdAt: serverTimestamp(),
            orcamentoId: id
          });

          transaction.set(doc(collection(db, 'transacoes')), {
            descricao: `Venda via Orçamento #${formData.numeroOrcamento}`,
            categoria: 'Venda de Peças',
            valor: valorProdutos,
            tipo: 'entrada',
            status: 'Paga',
            formaPagamento: 'Dinheiro',
            tenantId,
            createdAt: serverTimestamp(),
            pedidoId: newVendaRef.id
          });

          if (id) transaction.update(doc(db, 'orcamentos', id), { status: 'Finalizado' });
        });
        showSuccess('Venda realizada com sucesso!');
        navigate('/pedidos-venda');
      } catch {
        showError('Erro ao converter');
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleShareWhatsApp = () => {
    const texto = `Olá! Segue o seu orçamento *#${formData.numeroOrcamento}* da *Sistema Nexus*.\n\n` +
      `*Cliente:* ${formData.clienteNome}\n` +
      `*Total:* R$ ${totalGeral.toFixed(2)}\n\n` +
      `Aguardamos sua aprovação!`;
    const url = `https://wa.me/${formData.clienteTelefone.replace(/\D/g, '')}?text=${encodeURIComponent(texto)}`;
    window.open(url, '_blank');
  };

  if (isFetching) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '16px' }}>
        <Loader2 size={48} className="spin-icon" color="var(--accent-purple)" />
        <p style={{ color: 'var(--text-muted)' }}>Carregando dados do orçamento...</p>
      </div>
    );
  }

  return (
    <div className="os-page">
      <div className="page-header">
        <div className="header-title-group">
          <button className="icon-btn back-btn" onClick={() => navigate('/orcamentos')}><ArrowLeft size={20} /></button>
          <div>
            <h1 className="page-title">{isEditing ? 'Editar Orçamento' : 'Novo Orçamento'}</h1>
            <p className="page-subtitle">{isEditing ? `Orçamento #${formData.numeroOrcamento}` : 'Crie uma nova proposta comercial'}</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          {isEditing && (
            <>
              <button className="btn-secondary" onClick={handleShareWhatsApp} title="Compartilhar WhatsApp">
                <Share2 size={18} />
              </button>
              <button className="btn-secondary" onClick={() => navigate(`/orcamentos/print/${id}`)}>
                <Printer size={18} />
              </button>
              {formData.status !== 'Convertido' && (
                <>
                  <button className="btn-secondary" onClick={handleConvertToOS} style={{ color: '#8b5cf6', borderColor: 'rgba(139, 92, 246, 0.3)' }}>
                    <Wrench size={18} style={{ marginRight: 8 }} /> OS
                  </button>
                  <button className="btn-secondary" onClick={handleConvertToVenda} style={{ color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.3)' }}>
                    <ShoppingCart size={18} style={{ marginRight: 8 }} /> Venda
                  </button>
                </>
              )}
            </>
          )}
          <button className="btn-primary" onClick={() => handleSave()} disabled={isLoading}>
            {isLoading ? <Loader2 size={18} className="spin-icon" /> : <Save size={18} style={{ marginRight: 8 }} />}
            {isLoading ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>

      <div className="form-grid">
        <div className="form-column">
          <div className="card form-section">
            <div className="section-header">
              <User size={20} className="section-icon" />
              <h3>Dados do Cliente</h3>
            </div>
            <div className="input-group" style={{ position: 'relative' }} ref={dropdownRef}>
              <label>Cliente</label>
              <input
                type="text"
                name="clienteNome"
                value={formData.clienteNome}
                onChange={(e) => { handleChange(e); setIsClientDropdownOpen(true); }}
                onFocus={() => setIsClientDropdownOpen(true)}
                placeholder="Busque ou digite o nome"
                autoComplete="off"
                style={{ textTransform: 'uppercase' }}
              />
              {isClientDropdownOpen && (
                <div className="select-dropdown">
                  {clientesDisponiveis.filter(c => c.nome.toLowerCase().includes(formData.clienteNome.toLowerCase())).map(cliente => (
                    <div 
                      key={cliente.id} 
                      className="select-option"
                      onClick={() => {
                        setIsClientDropdownOpen(false);
                        
                        const vDoCliente = veiculosDisponiveis.filter(v => v.clienteId === cliente.id);
                        if (vDoCliente.length === 1) {
                          const v = vDoCliente[0];
                          setFormData({...formData, clienteNome: cliente.nome, clienteTelefone: cliente.telefone, placa: v.placa, modelo: v.modelo, ano: v.ano, cor: v.cor});
                          setVeiculosDoCliente([]);
                          setIsVeiculoDropdownOpen(false);
                        } else if (vDoCliente.length > 1) {
                          setFormData({...formData, clienteNome: cliente.nome, clienteTelefone: cliente.telefone});
                          setVeiculosDoCliente(vDoCliente);
                          setIsVeiculoDropdownOpen(true);
                        } else {
                          setFormData({...formData, clienteNome: cliente.nome, clienteTelefone: cliente.telefone});
                          setVeiculosDoCliente([]);
                          setIsVeiculoDropdownOpen(false);
                        }
                      }}
                    >
                      <span>{cliente.nome}</span>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{cliente.telefone}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="input-group">
              <label>WhatsApp / Telefone</label>
              <input type="text" name="clienteTelefone" value={formData.clienteTelefone} onChange={handleChange} placeholder="(00) 00000-0000" />
            </div>
          </div>

          <div className="card form-section">
            <div className="section-header">
              <Car size={20} className="section-icon" />
              <h3>Dados do Veículo</h3>
            </div>

            {isVeiculoDropdownOpen && veiculosDoCliente.length > 1 && (
              <div style={{ padding: '16px', backgroundColor: 'rgba(59, 130, 246, 0.1)', border: '1px dashed #3b82f6', borderRadius: '8px', marginBottom: '16px' }}>
                <p style={{ color: '#3b82f6', marginBottom: '12px', fontWeight: 'bold' }}>Este cliente possui múltiplos veículos. Selecione qual será atendido:</p>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {veiculosDoCliente.map(v => (
                    <button 
                      key={v.id} 
                      type="button"
                      onClick={() => {
                        setFormData(prev => ({...prev, placa: v.placa, modelo: v.modelo, ano: v.ano, cor: v.cor}));
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
                    Outro / Novo
                  </button>
                </div>
              </div>
            )}

            <div className="grid-2-col">
              <div className="input-group"><label>Placa</label><input type="text" name="placa" value={formData.placa} onChange={handleChange} placeholder="AAA-0000" style={{ textTransform: 'uppercase' }} /></div>
              <div className="input-group"><label>Modelo</label><input type="text" name="modelo" value={formData.modelo} onChange={handleChange} placeholder="Ex: Civic" /></div>
              <div className="input-group"><label>Ano</label><input type="text" name="ano" value={formData.ano} onChange={handleChange} placeholder="2020" /></div>
              <div className="input-group"><label>Cor</label><input type="text" name="cor" value={formData.cor} onChange={handleChange} placeholder="Prata" /></div>
            </div>
          </div>

          <div className="card form-section">
            <div className="section-header">
              <Calendar size={20} className="section-icon" />
              <h3>Validade e Status</h3>
            </div>
            <div className="grid-2-col">
              <div className="input-group">
                <label>Validade (Dias)</label>
                <input type="number" name="validadeDias" value={formData.validadeDias} onChange={handleChange} />
              </div>
              <div className="input-group">
                <label>Status</label>
                <select name="status" value={formData.status} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}>
                  <option value="Pendente">Pendente</option>
                  <option value="Aprovado">Aprovado</option>
                  <option value="Recusado">Recusado</option>
                  {formData.status === 'Convertido' && <option value="Convertido">Convertido</option>}
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="form-column">
          <div className="card form-section">
            <div className="section-header">
              <Wrench size={20} className="section-icon" />
              <h3>Peças e Serviços</h3>
            </div>
            
            <div className="item-add-container">
              <div className="item-add-row">
                <div style={{ position: 'relative' }} ref={servicoDropdownRef}>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', display: 'block' }}>Serviço</label>
                  <input 
                    type="text" 
                    placeholder="Nome do Serviço..." 
                    value={servicoNomeInput}
                    onChange={(e) => { setServicoNomeInput(e.target.value); setIsServicoDropdownOpen(true); }}
                    onFocus={() => setIsServicoDropdownOpen(true)}
                    style={{ paddingRight: '42px' }}
                  />
                  {servicoNomeInput && (
                    <button
                      type="button"
                      onClick={handleClearServicoInput}
                      className="clear-selection-btn"
                      title="Limpar seleção"
                      style={{ top: 'calc(50% + 10px)' }}
                    >
                      <X size={16} />
                    </button>
                  )}
                  {isServicoDropdownOpen && servicosCatalogo.filter(s => s.nome.toLowerCase().includes(servicoNomeInput.toLowerCase())).length > 0 && (
                    <div className="select-dropdown">
                      {servicosCatalogo.filter(s => s.nome.toLowerCase().includes(servicoNomeInput.toLowerCase())).map(s => (
                        <div key={s.id} className="select-option" onClick={() => {
                          setServicoNomeInput(s.nome);
                          setServicoPrecoInput(s.preco.toString());
                          setIsServicoDropdownOpen(false);
                        }}>
                          <span>{s.nome}</span>
                          <span style={{ color: '#10b981' }}>R$ {s.preco.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', display: 'block' }}>Preço</label>
                  <input type="text" placeholder="R$ 0,00" value={servicoPrecoInput} onChange={(e) => setServicoPrecoInput(e.target.value)} />
                </div>
                <button className="add-item-btn" onClick={() => handleAddItem('servico')} title="Adicionar Serviço">
                  <Plus size={20} />
                </button>
              </div>

              <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '8px 0' }}></div>

              <div className="item-add-row">
                <div style={{ position: 'relative' }} ref={pecaDropdownRef}>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', display: 'block' }}>Peça / Produto</label>
                  <input 
                    type="text" 
                    placeholder="Nome da Peça..." 
                    value={pecaNomeInput}
                    onChange={(e) => { setPecaNomeInput(e.target.value); setIsPecaDropdownOpen(true); }}
                    onFocus={() => setIsPecaDropdownOpen(true)}
                    style={{ paddingRight: '42px' }}
                  />
                  {pecaNomeInput && (
                    <button
                      type="button"
                      onClick={handleClearPecaInput}
                      className="clear-selection-btn"
                      title="Limpar seleção"
                      style={{ top: 'calc(50% + 10px)' }}
                    >
                      <X size={16} />
                    </button>
                  )}
                  {isPecaDropdownOpen && pecasEstoque.filter(p => p.nome.toLowerCase().includes(pecaNomeInput.toLowerCase())).length > 0 && (
                    <div className="select-dropdown">
                      {pecasEstoque.filter(p => p.nome.toLowerCase().includes(pecaNomeInput.toLowerCase())).map(p => (
                        <div key={p.id} className="select-option" onClick={() => {
                          setPecaNomeInput(p.nome);
                          setPecaPrecoInput(p.precoVenda.toString());
                          setIsPecaDropdownOpen(false);
                        }}>
                          <span>{p.nome}</span>
                          <span style={{ color: '#10b981' }}>R$ {p.precoVenda.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', display: 'block' }}>Preço</label>
                  <input type="text" placeholder="R$ 0,00" value={pecaPrecoInput} onChange={(e) => setPecaPrecoInput(e.target.value)} />
                </div>
                <button className="add-item-btn" onClick={() => handleAddItem('peca')} title="Adicionar Peça">
                  <Plus size={20} />
                </button>
              </div>
            </div>

            <div className="items-list">
              {itens.map((item, index) => (
                <div key={index} className="item-row">
                  <div className="item-info">
                    <div className="item-name">{item.nome}</div>
                    <div className="item-type">{item.tipo === 'servico' ? 'Mão de Obra' : 'Peça/Produto'}</div>
                  </div>
                  <div className="item-actions">
                    <input 
                      type="number" 
                      className="item-qty-input"
                      value={item.quantidade} 
                      onChange={(e) => updateItemQtd(index, Number(e.target.value))}
                    />
                    <div className="item-total-price">
                      R$ {(item.preco * item.quantidade).toFixed(2)}
                    </div>
                    <button className="delete-item-btn" onClick={() => removeItem(index)}>
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              ))}
              {itens.length === 0 && (
                <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)', border: '2px dashed var(--border-color)', borderRadius: 'var(--radius-lg)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
                  <Package size={32} style={{ opacity: 0.1, marginBottom: '8px' }} />
                  <p>Nenhum item adicionado ao orçamento.</p>
                </div>
              )}
            </div>
          </div>

          <div className="card form-section totals-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)', fontSize: '14px' }}>
              <span>Mão de Obra:</span>
              <span style={{ fontWeight: 600 }}>R$ {totalServicos.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)', fontSize: '14px' }}>
              <span>Peças:</span>
              <span style={{ fontWeight: 600 }}>R$ {totalPecas.toFixed(2)}</span>
            </div>
            <div className="grand-total-row">
              <span className="grand-total-label">TOTAL GERAL</span>
              <span className="grand-total-value">R$ {totalGeral.toFixed(2)}</span>
            </div>
          </div>

          <div className="card form-section">
            <div className="section-header">
              <FileText size={20} className="section-icon" />
              <h3>Observações Internas / Cliente</h3>
            </div>
            <textarea name="observacoes" value={formData.observacoes} onChange={handleChange} placeholder="Ex: Desconto condicionado ao pagamento à vista..." rows={4} style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px', color: 'var(--text-primary)' }} />
          </div>
      </div>
    </div>

    <div className="form-actions-bottom" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px', marginBottom: '40px' }}>
      <button 
        className="btn-primary" 
        onClick={() => handleSave()} 
          disabled={isLoading}
          style={{ 
            padding: '16px 32px', 
            borderRadius: '8px',
            fontSize: '16px', 
            fontWeight: 'bold', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '8px',
            transition: 'all 0.2s ease'
          }}
        >
          {isLoading ? <Loader2 size={20} className="spin-icon" /> : <Save size={20} />}
          {isLoading ? 'Salvando...' : 'SALVAR ORÇAMENTO'}
        </button>
      </div>
    </div>

  );
};

export default OrcamentoForm;
