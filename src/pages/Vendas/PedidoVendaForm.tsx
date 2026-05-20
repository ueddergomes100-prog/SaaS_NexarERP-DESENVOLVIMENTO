import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ShoppingCart, User, Package, Save, Trash2, XCircle, Printer } from 'lucide-react';
import { collection, addDoc, doc, getDoc, getDocs, updateDoc, getCountFromServer, serverTimestamp, query, where, setDoc, orderBy, limit } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';
import '../OS/OS.css'; // Reusing OS styles for layout consistency

interface ClienteBasico { id: string; nome: string; telefone: string; }
interface ProdutoEstoque { 
  id: string; 
  nome: string; 
  precoVenda: number; 
  quantidade: number; 
  codigo: string; 
  unidadeMedidaSigla?: string; 
  unidadeMedidaCasasDecimais?: number; 
  unidadeMedidaFracionado?: boolean; 
}
interface ItemVenda { 
  id: string; 
  nome: string; 
  precoUnitario: number; 
  quantidade: number; 
  desconto: number; 
  subtotal: number; 
  quantidadeJaDevolvida?: number; 
  unidadeMedidaSigla?: string; 
  unidadeMedidaCasasDecimais?: number; 
}

const PedidoVendaForm: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams(); // Para modo Visualização
  const isViewing = !!id;

  const [clienteNome, setClienteNome] = useState('');
  const [formaPagamento, setFormaPagamento] = useState('Dinheiro');
  const [numeroPedido, setNumeroPedido] = useState('');
  const [status, setStatus] = useState('Aberta');
  const [itens, setItens] = useState<ItemVenda[]>([]);
  const [orcamentoId, setOrcamentoId] = useState('');
  
  const [clientesDisponiveis, setClientesDisponiveis] = useState<ClienteBasico[]>([]);
  const [produtosCatalogo, setProdutosCatalogo] = useState<ProdutoEstoque[]>([]);
  
  const [produtoBusca, setProdutoBusca] = useState('');
  const [produtoQtd, setProdutoQtd] = useState<number | string>(1);
  const [produtoDesconto, setProdutoDesconto] = useState<number>(0);
  const [produtoPreco, setProdutoPreco] = useState<number>(0);
  const [produtoSelecionado, setProdutoSelecionado] = useState<ProdutoEstoque | null>(null);

  const [frete, setFrete] = useState<number>(0);
  const [encargos, setEncargos] = useState<number>(0);

  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingData, setIsFetchingData] = useState(true);
  const [permitirVendaSemEstoque, setPermitirVendaSemEstoque] = useState(false);

  const { currentUser, tenantId, userRole, userPermissions, isOwner } = useAuth();
  const canEditVenda = isOwner || userRole === 'SuperAdmin' || (userPermissions && userPermissions.includes('vendas.alterar'));
  
  const [isClientDropdownOpen, setIsClientDropdownOpen] = useState(false);
  const [isProdutoDropdownOpen, setIsProdutoDropdownOpen] = useState(false);
  const clientDropdownRef = useRef<HTMLDivElement>(null);
  const produtoDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const isConsumidorFinal = clienteNome.toLowerCase().includes('consumidor final');
    if (isConsumidorFinal && formaPagamento !== 'Dinheiro' && formaPagamento !== 'Pix') {
      setFormaPagamento('Dinheiro');
    }
  }, [clienteNome, formaPagamento]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (clientDropdownRef.current && !clientDropdownRef.current.contains(event.target as Node)) {
        setIsClientDropdownOpen(false);
      }
      if (produtoDropdownRef.current && !produtoDropdownRef.current.contains(event.target as Node)) {
        setIsProdutoDropdownOpen(false);
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

      // Fetch Estoque
      const qE = query(collection(db, 'estoque'), where('tenantId', '==', tenantId));
      const snapE = await getDocs(qE);
      const dataE: ProdutoEstoque[] = [];
      snapE.forEach((doc) => dataE.push({ 
        id: doc.id, 
        nome: doc.data().nome, 
        precoVenda: doc.data().precoVenda, 
        quantidade: doc.data().quantidade || 0, 
        codigo: doc.data().codigo || '',
        unidadeMedidaSigla: doc.data().unidadeMedidaSigla,
        unidadeMedidaCasasDecimais: doc.data().unidadeMedidaCasasDecimais,
        unidadeMedidaFracionado: doc.data().unidadeMedidaFracionado
      }));
      setProdutosCatalogo(dataE);

      // Fetch Configurações
      try {
        const configRef = doc(db, 'configuracoes', tenantId);
        const configSnap = await getDoc(configRef);
        if (configSnap.exists()) {
          setPermitirVendaSemEstoque(configSnap.data().venderSemEstoque === true);
        }
      } catch (err) { console.error(err); }

      // Fetch Pedido se for Visualização
      if (isViewing && id) {
        try {
          const docRef = doc(db, 'pedidos_venda', id);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const p = docSnap.data();
            setClienteNome(p.clienteNome || '');
            setFormaPagamento(p.formaPagamento || 'Dinheiro');
            setNumeroPedido(p.numeroPedido || '');
            setStatus(p.status || 'Finalizada');
            setItens(p.itens || []);
            setOrcamentoId(p.orcamentoId || '');
            setFrete(p.frete || 0);
            setEncargos(p.encargos || 0);
          } else {
            showError('Erro', 'Pedido não encontrado.');
            navigate('/pedidos-venda');
          }
        } catch (error) {
          console.error("Erro ao carregar pedido:", error);
        } finally {
          setIsFetchingData(false);
        }
      } else {
        // Novo Pedido - Buscar Próximo Número
        try {
          const qLast = query(collection(db, 'pedidos_venda'), where('tenantId', '==', tenantId), orderBy('numeroPedido', 'desc'), limit(1));
          const snapP = await getDocs(qLast);
          let nextNum = '0001';
          if (!snapP.empty) {
            const lastNum = parseInt(snapP.docs[0].data().numeroPedido) || 0;
            nextNum = String(lastNum + 1).padStart(4, '0');
          }
          setNumeroPedido(nextNum);
        } catch (err) {
          console.error("Erro ao buscar sequencia", err);
          const snapP = await getCountFromServer(query(collection(db, 'pedidos_venda'), where('tenantId', '==', tenantId)));
          setNumeroPedido(String(snapP.data().count + 1).padStart(4, '0'));
        }
        setIsFetchingData(false);
      }
    };
    fetchInitialData();
  }, [id, isViewing, navigate, currentUser, tenantId]);

  const handleAddItem = () => {
    if (!produtoBusca) {
      showError('Atenção', 'Selecione ou digite o nome de um produto.');
      return;
    }
    const qtdNum = Number(produtoQtd) || 0;
    if (qtdNum <= 0) {
      showError('Atenção', 'A quantidade deve ser maior que zero.');
      return;
    }
    
    // Tenta achar o produto no catálogo para pegar o ID real
    const produtoEncontrado = produtoSelecionado || produtosCatalogo.find(p => p.nome.toLowerCase() === produtoBusca.toLowerCase() || p.codigo === produtoBusca);
    
    if (produtoEncontrado) {
      if (!permitirVendaSemEstoque && qtdNum > (produtoEncontrado.quantidade || 0)) {
        showError('Estoque Insuficiente', `Você tem apenas ${produtoEncontrado.quantidade || 0} de ${produtoEncontrado.nome} em estoque. Venda sem estoque desativada.`);
        return;
      }

      // Validação de Venda Fracionada
      if (produtoEncontrado.unidadeMedidaFracionado === false && !Number.isInteger(qtdNum)) {
        showError('Operação Bloqueada', `O produto ${produtoEncontrado.nome} está configurado na unidade ${produtoEncontrado.unidadeMedidaSigla || 'UN'}, que NÃO permite venda fracionada. Utilize uma quantidade inteira.`);
        return;
      }
    }

    const precoFinal = produtoPreco > 0 ? produtoPreco : (produtoEncontrado?.precoVenda || 0);
    const subtotal = (precoFinal * qtdNum) - produtoDesconto;

    const novoItem: ItemVenda = {
      id: produtoEncontrado?.id || 'avulso',
      nome: produtoEncontrado?.nome || produtoBusca,
      precoUnitario: precoFinal,
      quantidade: qtdNum,
      desconto: produtoDesconto,
      subtotal: Math.max(0, subtotal),
      unidadeMedidaSigla: produtoEncontrado?.unidadeMedidaSigla || 'UN',
      unidadeMedidaCasasDecimais: produtoEncontrado?.unidadeMedidaCasasDecimais ?? 0
    };

    setItens([...itens, novoItem]);
    setProdutoBusca('');
    setProdutoQtd(1);
    setProdutoDesconto(0);
    setProdutoPreco(0);
    setProdutoSelecionado(null);
  };

  const handleRemoveItem = (index: number) => {
    setItens(itens.filter((_, i) => i !== index));
  };

  const valorTotalItens = itens.reduce((acc, curr) => acc + (curr.precoUnitario * curr.quantidade), 0);
  const valorTotalDescontos = itens.reduce((acc, curr) => acc + curr.desconto, 0);
  const valorTotalPedido = Math.max(0, valorTotalItens - valorTotalDescontos + Number(frete || 0) + Number(encargos || 0));

  const handleFinalizarVenda = async () => {
    if (!currentUser) return;
    if (itens.length === 0) {
      showError('Atenção', 'Adicione pelo menos um item à venda.');
      return;
    }

    let finalClienteNome = clienteNome.trim().toUpperCase();
    if (!finalClienteNome) {
      finalClienteNome = 'CONSUMIDOR FINAL';
      setClienteNome('CONSUMIDOR FINAL');
    }

    setIsLoading(true);

    try {
      // 1. Cadastrar Cliente (se não existir)
      const clienteExiste = clientesDisponiveis.some(c => c.nome.toUpperCase() === finalClienteNome);
      if (!clienteExiste) {
        const qC = query(collection(db, 'clientes'), where('tenantId', '==', tenantId));
        const snapC = await getCountFromServer(qC);
        await addDoc(collection(db, 'clientes'), {
          codigo: String(snapC.data().count + 1),
          nome: finalClienteNome,
          isPadrao: finalClienteNome === 'CONSUMIDOR FINAL',
          tenantId,
          createdAt: serverTimestamp()
        });
      }

      // 2. Baixar Estoque
      for (const item of itens) {
        if (item.id !== 'avulso') {
          try {
            const pecaRef = doc(db, 'estoque', item.id);
            const pecaSnap = await getDoc(pecaRef);
            if (pecaSnap.exists()) {
              const atual = pecaSnap.data().quantidade || 0;
              await updateDoc(pecaRef, { quantidade: Math.max(0, atual - item.quantidade) });
            }
          } catch (err) {
            console.error(`Erro baixar estoque do item ${item.nome}`, err);
          }
        }
      }

      // 3. Gravar Pedido de Venda
      const pedidoData = {
        numeroPedido,
        clienteNome: finalClienteNome,
        itens,
        valorTotalItens,
        valorTotalDescontos,
        frete: Number(frete || 0),
        encargos: Number(encargos || 0),
        valorTotal: valorTotalPedido,
        formaPagamento,
        status: 'Finalizada',
        tenantId,
        usuarioResponsavelId: currentUser.uid,
        createdAt: serverTimestamp()
      };

      const newPedidoRef = await addDoc(collection(db, 'pedidos_venda'), pedidoData);

      // 4. Gravar Transação Financeira
      let statusTransacao = 'Pendente';
      if (formaPagamento === 'Dinheiro' || formaPagamento === 'Pix') statusTransacao = 'Paga';

      await setDoc(doc(db, 'transacoes', newPedidoRef.id), {
        descricao: `Venda Direta #${numeroPedido}`,
        categoria: 'Venda de Peças',
        valor: valorTotalPedido,
        tipo: 'entrada',
        formaPagamento,
        status: statusTransacao,
        pedidoId: newPedidoRef.id,
        clienteNome: finalClienteNome,
        tenantId,
        createdAt: serverTimestamp()
      });

      try {
        const { createAuditLog } = await import('../../services/logService');
        createAuditLog({
          tenantId,
          usuarioId: currentUser.uid,
          usuarioEmail: currentUser.email || currentUser.uid,
          modulo: 'vendas',
          acao: 'criacao',
          descricao: `Venda Direta #${numeroPedido} finalizada no valor de R$ ${valorTotalPedido.toFixed(2)}. Cliente: ${finalClienteNome || 'Geral'}`,
          registroRelacionadoId: newPedidoRef.id,
          status: 'sucesso'
        });
      } catch (err) {
        console.error('Erro ao registrar log de criacao de venda:', err);
      }

      setIsLoading(false);

      // 5. Perguntar se quer Imprimir
      const result = await NexusSwal.fire({
        title: 'Venda Finalizada!',
        text: 'O pedido foi gravado, o estoque baixado e o financeiro atualizado. Deseja imprimir o recibo?',
        icon: 'success',
        showCancelButton: true,
        confirmButtonText: 'Sim, Imprimir',
        cancelButtonText: 'Não, Sair'
      });

      if (result.isConfirmed) {
        navigate(`/pedidos-venda/print/${newPedidoRef.id}`);
      } else {
        navigate('/pedidos-venda');
      }

    } catch (error) {
      console.error('Erro ao finalizar venda:', error);
      showError('Erro', 'Não foi possível finalizar a venda.');
      setIsLoading(false);
    }
  };

  const handleCancelarVenda = async () => {
    if (!currentUser || !id) return;
    
    const temDevolucao = itens.some(item => (item.quantidadeJaDevolvida || 0) > 0);
    if (temDevolucao) {
      showError('Operação Bloqueada', 'Não é possível cancelar uma venda que já possui itens devolvidos. O cancelamento só é permitido caso nenhuma devolução tenha sido feita.');
      return;
    }

    const confirm = await NexusSwal.fire({
      title: 'Cancelar Venda?',
      text: 'O estoque será devolvido e a transação financeira será estornada.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sim, Cancelar Venda',
      cancelButtonText: 'Manter Venda',
      confirmButtonColor: '#ef4444'
    });

    if (!confirm.isConfirmed) return;
    
    setIsLoading(true);
    try {
      // 1. Devolver Estoque
      for (const item of itens) {
        if (item.id !== 'avulso') {
          const pecaRef = doc(db, 'estoque', item.id);
          const pecaSnap = await getDoc(pecaRef);
          if (pecaSnap.exists()) {
            const atual = pecaSnap.data().quantidade || 0;
            await updateDoc(pecaRef, { quantidade: atual + item.quantidade });
          }
        }
      }

      // 2. Atualizar Pedido
      await updateDoc(doc(db, 'pedidos_venda', id), {
        status: 'Cancelada',
        updatedAt: serverTimestamp()
      });

      // 3. Atualizar Transação Financeira
      await setDoc(doc(db, 'transacoes', id), { status: 'Cancelada' }, { merge: true });

      try {
        const { createAuditLog } = await import('../../services/logService');
        createAuditLog({
          tenantId,
          usuarioId: currentUser.uid,
          usuarioEmail: currentUser.email || currentUser.uid,
          modulo: 'vendas',
          acao: 'cancelamento',
          descricao: `Venda Direta #${numeroPedido} CANCELADA e estoque estornado.`,
          registroRelacionadoId: id,
          status: 'sucesso',
          critical: true
        });
      } catch (err) {
        console.error('Erro ao registrar log de cancelamento de venda:', err);
      }

      // 4. Reabrir Orçamento se houver orcamentoId
      if (orcamentoId) {
        try {
          await updateDoc(doc(db, 'orcamentos', orcamentoId), { status: 'Pendente' });
        } catch (err) {
          console.error("Erro ao reabrir orçamento:", err);
        }
      }

      showSuccess('Venda cancelada com sucesso!');
      setStatus('Cancelada');
    } catch (err) {
      console.error('Erro ao cancelar:', err);
      showError('Erro', 'Não foi possível cancelar a venda.');
    } finally {
      setIsLoading(false);
    }
  };

  if (isFetchingData) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-primary)' }}>Carregando dados da Venda...</div>;
  }

  return (
    <div className="os-page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="header-title-group">
          <button className="icon-btn back-btn" onClick={() => navigate('/pedidos-venda')}><ArrowLeft size={20} /></button>
          <div>
            <h1 className="page-title">{isViewing ? `Pedido de Venda #${numeroPedido}` : 'Frente de Caixa (PDV)'}</h1>
            <p className="page-subtitle">
              {isViewing 
                ? (status === 'Cancelada' ? 'Esta venda foi CANCELADA' : 'Detalhes do Pedido e Impressão') 
                : 'Ponto de venda rápido para itens e produtos'}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          {isViewing && status === 'Finalizada' && (
            <>
              <button className="btn-secondary" onClick={() => navigate(`/pedidos-venda/print/${id}`)} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Printer size={18} /> Imprimir Recibo
              </button>
              {canEditVenda && (
                <button 
                  className="btn-secondary" 
                  onClick={handleCancelarVenda} 
                  disabled={isLoading || itens.some(item => (item.quantidadeJaDevolvida || 0) > 0)} 
                  style={{ 
                    display: 'flex', alignItems: 'center', gap: '8px', 
                    color: itens.some(item => (item.quantidadeJaDevolvida || 0) > 0) ? 'var(--text-muted)' : '#ef4444', 
                    borderColor: itens.some(item => (item.quantidadeJaDevolvida || 0) > 0) ? 'var(--border-color)' : 'rgba(239,68,68,0.3)',
                    cursor: itens.some(item => (item.quantidadeJaDevolvida || 0) > 0) ? 'not-allowed' : 'pointer'
                  }}
                  title={itens.some(item => (item.quantidadeJaDevolvida || 0) > 0) ? 'Não é possível cancelar: há itens devolvidos' : 'Cancelar Venda'}
                >
                  <XCircle size={18} /> Estornar/Cancelar
                </button>
              )}
            </>
          )}
          {!isViewing && (
            <button className="btn-primary" onClick={handleFinalizarVenda} disabled={isLoading} style={{ opacity: isLoading ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#10b981' }}>
              <ShoppingCart size={18} />
              {isLoading ? 'Finalizando...' : 'Finalizar Venda'}
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: '24px', alignItems: 'start' }}>
        
        {/* Lado Esquerdo: Carrinho e Busca */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* Seção Cliente */}
          <div className="card form-section" style={{ padding: '24px' }}>
            <div className="section-header" style={{ marginBottom: '16px' }}>
              <User size={20} className="section-icon" />
              <h3>Dados do Cliente</h3>
            </div>
            <div className="input-group" style={{ position: 'relative' }} ref={clientDropdownRef}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Nome do Cliente ou Consumidor Final *</label>
              <input 
                type="text" 
                placeholder="Busque ou digite o nome do cliente..." 
                value={clienteNome} 
                onChange={(e) => { setClienteNome(e.target.value); setIsClientDropdownOpen(true); }} 
                onFocus={() => setIsClientDropdownOpen(true)}
                disabled={isViewing}
                autoComplete="off" 
                style={{ textTransform: 'uppercase', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)', width: '100%' }}
              />
              {!isViewing && isClientDropdownOpen && clientesDisponiveis.filter(c => c.nome.toLowerCase().includes(clienteNome.toLowerCase())).length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '4px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', maxHeight: '200px', overflowY: 'auto', zIndex: 50, boxShadow: '0 10px 25px rgba(0,0,0,0.5)' }}>
                  {clientesDisponiveis.filter(c => c.nome.toLowerCase().includes(clienteNome.toLowerCase())).map(c => (
                    <div 
                      key={c.id}
                      onClick={() => { setClienteNome(c.nome); setIsClientDropdownOpen(false); }}
                      style={{ padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <span>{c.nome}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{c.telefone}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Seção Adicionar Produto */}
          {!isViewing && (
            <div className="card form-section" style={{ padding: '24px' }}>
              <div className="section-header" style={{ marginBottom: '16px' }}>
                <Package size={20} className="section-icon" />
                <h3>Adicionar Produto</h3>
              </div>
              
              <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ flex: '2', position: 'relative', minWidth: '200px' }} ref={produtoDropdownRef}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Buscar Produto</label>
                  <input 
                    type="text" 
                    placeholder="Nome ou Código..."
                    value={produtoBusca}
                    onChange={(e) => {
                      setProdutoBusca(e.target.value);
                      setIsProdutoDropdownOpen(true);
                      const exists = produtosCatalogo.find(p => p.nome.toLowerCase() === e.target.value.toLowerCase() || p.codigo === e.target.value);
                      if (exists) {
                        setProdutoPreco(exists.precoVenda);
                        setProdutoSelecionado(exists);
                      } else {
                        setProdutoSelecionado(null);
                      }
                    }}
                    onFocus={() => setIsProdutoDropdownOpen(true)}
                    autoComplete="off"
                    style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
                  />
                  {isProdutoDropdownOpen && produtosCatalogo.filter(p => p.nome.toLowerCase().includes(produtoBusca.toLowerCase()) || p.codigo.includes(produtoBusca)).length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '4px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', maxHeight: '250px', overflowY: 'auto', zIndex: 50, boxShadow: '0 4px 15px rgba(0,0,0,0.5)' }}>
                      {produtosCatalogo.filter(p => p.nome.toLowerCase().includes(produtoBusca.toLowerCase()) || p.codigo.includes(produtoBusca)).map(p => (
                        <div 
                          key={p.id}
                          onClick={() => { 
                            setProdutoBusca(p.nome); 
                            setProdutoPreco(p.precoVenda); 
                            setProdutoSelecionado(p);
                            setIsProdutoDropdownOpen(false); 
                          }}
                          style={{ padding: '10px 16px', cursor: 'pointer', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', fontSize: '13px', alignItems: 'center', gap: '12px' }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.nome} {p.codigo && <span style={{color: 'var(--text-muted)'}}>[{p.codigo}]</span>}</span>
                          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexShrink: 0 }}>
                            <span style={{ color: p.quantidade > 0 ? '#10b981' : '#ef4444' }}>
                              Est: {p.quantidade.toFixed(p.unidadeMedidaCasasDecimais ?? 0)} {p.unidadeMedidaSigla || 'UN'}
                            </span>
                            <span style={{ color: '#10b981', fontWeight: 600 }}>R$ {p.precoVenda.toFixed(2)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ flex: '0.5', minWidth: '85px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                    Qtd {produtoSelecionado?.unidadeMedidaSigla ? `(${produtoSelecionado.unidadeMedidaSigla})` : ''}
                  </label>
                  <input 
                    type="number" 
                    min="0.001" 
                    step={produtoSelecionado?.unidadeMedidaFracionado ? "any" : "1"} 
                    value={produtoQtd} 
                    onChange={(e) => setProdutoQtd(e.target.value)} 
                    style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} 
                  />
                </div>
                
                <div style={{ flex: '0.8', minWidth: '100px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Preço Unt.</label>
                  <input type="number" step="0.01" value={produtoPreco} onChange={(e) => setProdutoPreco(Number(e.target.value))} style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
                </div>

                <div style={{ flex: '0.8', minWidth: '100px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Desc. (R$)</label>
                  <input type="number" step="0.01" value={produtoDesconto} onChange={(e) => setProdutoDesconto(Number(e.target.value))} style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
                </div>

                <button type="button" onClick={handleAddItem} className="btn-primary" style={{ padding: '12px 24px', whiteSpace: 'nowrap' }}>
                  Adicionar
                </button>
              </div>
            </div>
          )}

          {/* Carrinho de Compras */}
          <div className="card form-section" style={{ padding: '24px' }}>
            <h3 style={{ marginBottom: '16px', fontSize: '16px', fontWeight: 600 }}>Itens da Venda</h3>
            
            <div className="table-wrapper">
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '12px 8px' }}>Produto</th>
                    <th style={{ padding: '12px 8px', textAlign: 'center' }}>Qtd</th>
                    <th style={{ padding: '12px 8px', textAlign: 'right' }}>V. Unit</th>
                    <th style={{ padding: '12px 8px', textAlign: 'right' }}>Desc.</th>
                    <th style={{ padding: '12px 8px', textAlign: 'right' }}>Subtotal</th>
                    {!isViewing && <th style={{ padding: '12px 8px', textAlign: 'center' }}>Ação</th>}
                  </tr>
                </thead>
                <tbody>
                  {itens.length === 0 ? (
                    <tr>
                      <td colSpan={isViewing ? 5 : 6} style={{ padding: '32px 8px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        Nenhum produto adicionado à venda.
                      </td>
                    </tr>
                  ) : (
                    itens.map((item, index) => (
                      <tr key={index} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '12px 8px' }}>{item.nome}</td>
                        <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                          {item.quantidade.toFixed(item.unidadeMedidaCasasDecimais ?? 0)} {item.unidadeMedidaSigla || 'UN'}
                        </td>
                        <td style={{ padding: '12px 8px', textAlign: 'right' }}>R$ {item.precoUnitario.toFixed(2)}</td>
                        <td style={{ padding: '12px 8px', textAlign: 'right', color: '#ef4444' }}>{item.desconto > 0 ? `-R$ ${item.desconto.toFixed(2)}` : '-'}</td>
                        <td style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 600 }}>R$ {item.subtotal.toFixed(2)}</td>
                        {!isViewing && (
                          <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                            <button onClick={() => handleRemoveItem(index)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>
                              <Trash2 size={16} />
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
        </div>

        {/* Lado Direito: Resumo e Pagamento */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '24px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>Resumo da Venda</h3>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', color: 'var(--text-secondary)', alignItems: 'center' }}>
              <span>Total Itens:</span>
              <span>R$ {valorTotalItens.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', color: '#ef4444', alignItems: 'center' }}>
              <span>Descontos:</span>
              <span>- R$ {valorTotalDescontos.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', color: 'var(--text-secondary)', alignItems: 'center' }}>
              <span>Frete (+):</span>
              {isViewing ? (
                <span>R$ {frete.toFixed(2)}</span>
              ) : (
                <input 
                  type="number" 
                  step="0.01" 
                  min="0"
                  placeholder="0.00"
                  value={frete || ''} 
                  onChange={(e) => setFrete(Math.max(0, Number(e.target.value)))}
                  style={{ width: '100px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '6px 10px', color: 'var(--text-primary)', textAlign: 'right' }} 
                />
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', color: 'var(--text-secondary)', alignItems: 'center' }}>
              <span>Encargos (+):</span>
              {isViewing ? (
                <span>R$ {encargos.toFixed(2)}</span>
              ) : (
                <input 
                  type="number" 
                  step="0.01" 
                  min="0"
                  placeholder="0.00"
                  value={encargos || ''} 
                  onChange={(e) => setEncargos(Math.max(0, Number(e.target.value)))}
                  style={{ width: '100px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '6px 10px', color: 'var(--text-primary)', textAlign: 'right' }} 
                />
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px', paddingTop: '16px', borderTop: '1px dashed var(--border-color)', fontSize: '24px', fontWeight: 800, color: '#10b981' }}>
              <span>TOTAL:</span>
              <span>R$ {valorTotalPedido.toFixed(2)}</span>
            </div>
          </div>

          <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '16px', textTransform: 'uppercase', color: 'var(--accent-purple)' }}>Forma de Pagamento</h3>
            
            {isViewing ? (
               <div style={{ padding: '16px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '8px', fontSize: '16px', fontWeight: 600, textAlign: 'center' }}>
                 {formaPagamento}
               </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
                {[
                  { value: 'Dinheiro', icon: '💵' },
                  { value: 'Pix', icon: '💠' },
                  { value: 'Cartão de Crédito', icon: '💳' },
                  { value: 'Cartão de Débito', icon: '💳' },
                  { value: 'A Prazo / Fiado', icon: '🤝' }
                ].filter(metodo => {
                  const isConsumidorFinal = clienteNome.toLowerCase().includes('consumidor final');
                  if (isConsumidorFinal) {
                    return metodo.value === 'Dinheiro' || metodo.value === 'Pix';
                  }
                  return true;
                }).map(metodo => (
                  <div 
                    key={metodo.value}
                    onClick={() => setFormaPagamento(metodo.value)}
                    style={{
                      backgroundColor: formaPagamento === metodo.value ? 'rgba(16, 185, 129, 0.2)' : 'var(--bg-tertiary)',
                      border: `1px solid ${formaPagamento === metodo.value ? '#10b981' : 'var(--border-color)'}`,
                      padding: '12px 16px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      transition: 'all 0.2s',
                    }}
                  >
                    <span style={{ fontSize: '20px' }}>{metodo.icon}</span>
                    <span style={{ fontSize: '14px', fontWeight: formaPagamento === metodo.value ? 600 : 400, color: formaPagamento === metodo.value ? '#10b981' : 'white' }}>{metodo.value}</span>
                  </div>
                ))}
              </div>
            )}
            
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '16px', textAlign: 'center' }}>
              {(formaPagamento === 'Dinheiro' || formaPagamento === 'Pix') 
                ? <span style={{ color: '#10b981' }}>✓ Irá somar no Caixa Principal.</span>
                : <span style={{ color: '#f59e0b' }}>ℹ️ Irá para o Contas a Receber.</span>}
            </div>
          </div>

          {!isViewing && (
            <button className="btn-primary" onClick={handleFinalizarVenda} disabled={isLoading} style={{ width: '100%', padding: '16px', fontSize: '16px', fontWeight: 700, backgroundColor: '#10b981', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px' }}>
              <ShoppingCart size={24} />
              FINALIZAR VENDA
            </button>
          )}

        </div>

      </div>
    </div>
  );
};

export default PedidoVendaForm;
