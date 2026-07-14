import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ArrowLeft, RotateCcw, AlertTriangle, Package, CheckCircle, X, Receipt } from 'lucide-react';
import { collection, query, where, getDocs, addDoc, doc, updateDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError } from '../../utils/alerts';
import { isPlatformAdminRole } from '../../utils/roles';

const DevolucoesVenda: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser, tenantId, userRole, userPermissions, isOwner } = useAuth();
  
  const [numeroPedidoBusca, setNumeroPedidoBusca] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [pedidoEncontrado, setPedidoEncontrado] = useState<any>(null);

  // Controle de Modal
  const [showModal, setShowModal] = useState(false);
  
  // State para os itens selecionados para devolução
  const [itensSelecionados, setItensSelecionados] = useState<any[]>([]);

  // Campos finais da devolução
  const [destinoValor, setDestinoValor] = useState<'credito' | 'caixa'>('credito');
  const [motivo, setMotivo] = useState('');
  const [observacao, setObservacao] = useState('');

  const canReturn = isOwner || isPlatformAdminRole(userRole) || (userPermissions && userPermissions.includes('vendas.devolucao'));

  if (!canReturn) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', padding: '20px', borderRadius: '50%', backgroundColor: 'rgba(239, 68, 68, 0.1)', marginBottom: '20px' }}>
          <AlertTriangle size={48} color="#ef4444" />
        </div>
        <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '12px', color: 'var(--text-primary)' }}>Acesso Negado</h2>
        <p style={{ color: 'var(--text-muted)', maxWidth: '500px', margin: '0 auto 24px' }}>
          Você não possui permissão para realizar devoluções de venda. Solicite ao administrador da empresa para liberar o módulo "Vendas: Devolução de Venda".
        </p>
        <button className="btn-primary" onClick={() => navigate('/pedidos-venda')}>
          Voltar para Pedidos de Venda
        </button>
      </div>
    );
  }

  const handleBuscarPedido = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!numeroPedidoBusca.trim() || !tenantId) return;

    setIsSearching(true);
    setPedidoEncontrado(null);

    try {
      // PedidoVendaForm salva o número como string (ex: '0001')
      // Se o usuario digitar '1', podemos precisar formatar
      const numFormatado = numeroPedidoBusca.padStart(4, '0');
      
      const q = query(
        collection(db, 'pedidos_venda'),
        where('tenantId', '==', tenantId),
        where('numeroPedido', '==', numFormatado)
      );

      const snap = await getDocs(q);

      if (snap.empty) {
        showError('Não encontrado', `Nenhum pedido de venda com número ${numFormatado} foi localizado.`);
      } else {
        const docP = snap.docs[0];
        const data = docP.data();
        
        // Formatar os itens para incluir propriedades de devolução
        const itensFormatados = (data.itens || []).map((item: any) => ({
          ...item,
          quantidadeJaDevolvida: item.quantidadeJaDevolvida || 0,
          quantidadeSelecionada: 0,
          selecionado: false
        }));

        setPedidoEncontrado({
          id: docP.id,
          ...data,
          itens: itensFormatados
        });
        
        // Resetar estados do form
        setItensSelecionados([]);
        setDestinoValor('credito');
        setMotivo('');
        setObservacao('');
        setShowModal(true);
      }
    } catch (err) {
      console.error(err);
      showError('Erro', 'Ocorreu um erro ao buscar o pedido.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleToggleItem = (index: number) => {
    const novosItens = [...pedidoEncontrado.itens];
    const item = novosItens[index];
    
    // Se está sendo marcado e a quantidade disponível é > 0
    if (!item.selecionado && (item.quantidade - item.quantidadeJaDevolvida) > 0) {
      item.selecionado = true;
      item.quantidadeSelecionada = 1; // Default 1
    } else {
      item.selecionado = false;
      item.quantidadeSelecionada = 0;
    }
    
    setPedidoEncontrado({ ...pedidoEncontrado, itens: novosItens });
  };

  const handleQtdChange = (index: number, novaQtd: number) => {
    const novosItens = [...pedidoEncontrado.itens];
    const item = novosItens[index];
    
    const maxPermitido = item.quantidade - item.quantidadeJaDevolvida;
    
    if (novaQtd < 0) novaQtd = 0;
    if (novaQtd > maxPermitido) novaQtd = maxPermitido;
    
    item.quantidadeSelecionada = novaQtd;
    item.selecionado = novaQtd > 0;
    
    setPedidoEncontrado({ ...pedidoEncontrado, itens: novosItens });
  };

  // Calcular Valor Total a ser Devolvido
  const calcularValorDevolucao = () => {
    if (!pedidoEncontrado) return 0;
    let total = 0;
    pedidoEncontrado.itens.forEach((i: any) => {
      if (i.selecionado && i.quantidadeSelecionada > 0) {
        // Desconto proporcional
        const valorOriginal = i.quantidade * i.precoUnitario;
        const proporcao = i.quantidadeSelecionada / i.quantidade;
        const subtotalBase = i.quantidadeSelecionada * i.precoUnitario;
        const descontoProporcional = i.desconto * proporcao;
        
        total += (subtotalBase - descontoProporcional);
      }
    });
    return total;
  };

  const valorTotalCalculado = calcularValorDevolucao();

  const handleConfirmarDevolucao = async () => {
    if (!currentUser || !tenantId || !pedidoEncontrado) return;
    
    if (valorTotalCalculado <= 0) {
      showError('Atenção', 'Selecione pelo menos um item com quantidade válida para devolução.');
      return;
    }

    setIsSearching(true);

    try {
      // 1. Criar Registro de Devolução
      const novaDevolucaoRef = await addDoc(collection(db, 'devolucoes_venda'), {
        pedidoVendaId: pedidoEncontrado.id,
        numeroPedidoOriginal: pedidoEncontrado.numeroPedido,
        clienteNome: pedidoEncontrado.clienteNome,
        valorTotalDevolvido: valorTotalCalculado,
        destinoValor: destinoValor,
        motivo: motivo,
        observacao: observacao,
        tenantId,
        usuarioResponsavelId: currentUser.uid,
        status: 'concluida',
        createdAt: serverTimestamp(),
        itensDevolvidos: pedidoEncontrado.itens.filter((i: any) => i.selecionado && i.quantidadeSelecionada > 0).map((i: any) => ({
          id: i.id,
          nome: i.nome,
          precoUnitario: i.precoUnitario,
          quantidadeDevolvida: i.quantidadeSelecionada,
          descontoProporcional: (i.desconto * (i.quantidadeSelecionada / i.quantidade)),
          subtotal: (i.quantidadeSelecionada * i.precoUnitario) - (i.desconto * (i.quantidadeSelecionada / i.quantidade))
        }))
      });

      try {
        const { createAuditLog } = await import('../../services/logService');
        createAuditLog({
          tenantId,
          usuarioId: currentUser.uid,
          usuarioEmail: currentUser.email || currentUser.uid,
          modulo: 'vendas',
          acao: 'devolucao',
          descricao: `Devolução concluída para o pedido #${pedidoEncontrado.numeroPedido} no valor de R$ ${valorTotalCalculado.toFixed(2)}.`,
          registroRelacionadoId: novaDevolucaoRef.id,
          status: 'sucesso',
          critical: true
        });
      } catch (logErr) {}

      // 2. Atualizar Estoque (Devolver Peças)
      const itensFiltrados = pedidoEncontrado.itens.filter((i: any) => i.selecionado && i.quantidadeSelecionada > 0);
      for (const item of itensFiltrados) {
        if (item.id && item.id !== 'avulso') {
          const pecaRef = doc(db, 'estoque', item.id);
          const pecaSnap = await getDoc(pecaRef);
          if (pecaSnap.exists()) {
            const atual = pecaSnap.data().quantidade || 0;
            await updateDoc(pecaRef, { quantidade: atual + item.quantidadeSelecionada });
          }
        }
      }

      // 3. Atualizar o Pedido Original
      const itensAtualizadosPedido = pedidoEncontrado.itens.map((item: any) => {
        if (item.selecionado && item.quantidadeSelecionada > 0) {
          return {
            ...item,
            quantidadeJaDevolvida: (item.quantidadeJaDevolvida || 0) + item.quantidadeSelecionada
          };
        }
        return item;
      });
      
      const itensLimpos = itensAtualizadosPedido.map((i: any) => {
        const { selecionado, quantidadeSelecionada, ...rest } = i;
        return rest;
      });

      await updateDoc(doc(db, 'pedidos_venda', pedidoEncontrado.id), {
        itens: itensLimpos,
        updatedAt: serverTimestamp()
      });

      // 4. Lidar com o Financeiro (Caixa vs Crédito)
      if (destinoValor === 'caixa') {
        await addDoc(collection(db, 'transacoes'), {
          descricao: `Devolução Pedido #${pedidoEncontrado.numeroPedido} - Caixa`,
          categoria: 'Devolução de Venda',
          valor: valorTotalCalculado,
          tipo: 'saida',
          formaPagamento: 'Dinheiro', 
          status: 'Paga',
          clienteNome: pedidoEncontrado.clienteNome,
          pedidoOrigemId: pedidoEncontrado.id,
          devolucaoId: novaDevolucaoRef.id,
          tenantId,
          createdAt: serverTimestamp()
        });
      } else if (destinoValor === 'credito') {
        await addDoc(collection(db, 'creditos_cliente'), {
          clienteNome: pedidoEncontrado.clienteNome,
          pedidoOrigemId: pedidoEncontrado.id,
          devolucaoId: novaDevolucaoRef.id,
          numeroPedidoOriginal: pedidoEncontrado.numeroPedido,
          valorOriginal: valorTotalCalculado,
          saldoDisponivel: valorTotalCalculado,
          status: 'disponivel', 
          motivo,
          tenantId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }

      showSuccess('Devolução processada com sucesso!');
      setShowModal(false);
      setPedidoEncontrado(null);
      setNumeroPedidoBusca('');
      
    } catch (err) {
      console.error(err);
      showError('Erro', 'Ocorreu um problema ao processar a devolução.');
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="icon-btn back-btn" onClick={() => navigate('/pedidos-venda')} title="Voltar">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <RotateCcw size={28} color="#ef4444" />
              Devolução de Venda
            </h1>
            <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>
              Processo de estorno de mercadorias, caixa e geração de crédito
            </p>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: '32px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', maxWidth: '600px', margin: '0 auto', width: '100%' }}>
        <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '24px', textAlign: 'center' }}>Localizar Venda Original</h3>
        
        <form onSubmit={handleBuscarPedido} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="input-group">
            <label style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Número do Pedido de Venda</label>
            <div style={{ position: 'relative' }}>
              <Search size={20} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input 
                type="text" 
                placeholder="Ex: 0045"
                value={numeroPedidoBusca}
                onChange={e => setNumeroPedidoBusca(e.target.value)}
                style={{ width: '100%', padding: '16px 16px 16px 48px', fontSize: '18px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
                autoFocus
              />
            </div>
          </div>
          <button 
            type="submit" 
            className="btn-primary" 
            disabled={isSearching || !numeroPedidoBusca.trim()}
            style={{ width: '100%', padding: '16px', fontSize: '16px', fontWeight: 600, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}
          >
            {isSearching ? 'Buscando...' : 'Buscar Pedido'}
          </button>
        </form>
      </div>

      {showModal && pedidoEncontrado && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
        }}>
          <div className="card" style={{
            backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
            width: '100%', maxWidth: '800px', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
            overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
          }}>
            {/* Header Modal */}
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-primary)' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Receipt size={20} color="#3b82f6" /> 
                Devolução - Pedido #{pedidoEncontrado.numeroPedido}
              </h2>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={24} />
              </button>
            </div>

            {/* Content Modal */}
            <div style={{ overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', backgroundColor: 'var(--bg-tertiary)', padding: '16px', borderRadius: '8px' }}>
                <div><span style={{color: 'var(--text-muted)', fontSize: '12px'}}>Cliente:</span><br/><strong style={{fontSize: '14px'}}>{pedidoEncontrado.clienteNome}</strong></div>
                <div><span style={{color: 'var(--text-muted)', fontSize: '12px'}}>Data da Venda:</span><br/><strong style={{fontSize: '14px'}}>{pedidoEncontrado.createdAt?.toDate().toLocaleDateString('pt-BR') || 'N/A'}</strong></div>
                <div><span style={{color: 'var(--text-muted)', fontSize: '12px'}}>Forma de Pgto:</span><br/><strong style={{fontSize: '14px'}}>{pedidoEncontrado.formaPagamento}</strong></div>
                <div><span style={{color: 'var(--text-muted)', fontSize: '12px'}}>Status do Pedido:</span><br/><strong style={{fontSize: '14px', color: pedidoEncontrado.status === 'Cancelada' ? '#ef4444' : '#10b981'}}>{pedidoEncontrado.status}</strong></div>
              </div>

              {pedidoEncontrado.status === 'Cancelada' && (
                <div style={{ padding: '16px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '8px', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <AlertTriangle size={24} />
                  <div>
                    <strong>Este pedido já está Cancelado!</strong>
                    <p style={{ margin: 0, fontSize: '13px' }}>O estoque já foi retornado e o financeiro estornado no momento do cancelamento.</p>
                  </div>
                </div>
              )}

              {pedidoEncontrado.status !== 'Cancelada' && (
                <>
                  <div>
                    <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>Selecione os Itens para Devolução</h3>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {pedidoEncontrado.itens.map((item: any, idx: number) => {
                        const disponivelParaDevolucao = item.quantidade - item.quantidadeJaDevolvida;
                        const esgotado = disponivelParaDevolucao <= 0;

                        return (
                          <div key={idx} style={{ 
                            display: 'flex', alignItems: 'center', gap: '16px', padding: '12px 16px', 
                            backgroundColor: esgotado ? 'rgba(255,255,255,0.02)' : 'var(--bg-tertiary)', 
                            border: `1px solid ${item.selecionado ? '#3b82f6' : 'var(--border-color)'}`, 
                            borderRadius: '8px',
                            opacity: esgotado ? 0.6 : 1
                          }}>
                            <input 
                              type="checkbox" 
                              checked={item.selecionado}
                              onChange={() => handleToggleItem(idx)}
                              disabled={esgotado}
                              style={{ width: '18px', height: '18px', accentColor: '#3b82f6', cursor: esgotado ? 'not-allowed' : 'pointer' }}
                            />
                            
                            <div style={{ flex: 1 }}>
                              <strong style={{ fontSize: '14px', display: 'block' }}>{item.nome}</strong>
                              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                Preço Un: R$ {item.precoUnitario.toFixed(2)} | Vendido: {item.quantidade} un. {item.quantidadeJaDevolvida > 0 && `(Já devolvido: ${item.quantidadeJaDevolvida})`}
                              </span>
                            </div>

                            {!esgotado && item.selecionado && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Qtd a devolver:</label>
                                <input 
                                  type="number"
                                  min="1"
                                  max={disponivelParaDevolucao}
                                  value={item.quantidadeSelecionada}
                                  onChange={(e) => handleQtdChange(idx, Number(e.target.value))}
                                  style={{ width: '60px', padding: '4px 8px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', textAlign: 'center' }}
                                />
                                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>/ {disponivelParaDevolucao}</span>
                              </div>
                            )}

                            {esgotado && (
                              <span style={{ fontSize: '12px', color: '#ef4444', fontWeight: 600 }}>Totalmente devolvido</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {valorTotalCalculado > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', backgroundColor: 'var(--bg-tertiary)', padding: '20px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Valor Total a Devolver (com dedução proporcional de descontos):</span>
                        <strong style={{ fontSize: '24px', color: '#10b981' }}>R$ {valorTotalCalculado.toFixed(2)}</strong>
                      </div>

                      <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                        <label style={{ fontSize: '14px', fontWeight: 600, display: 'block', marginBottom: '12px' }}>O que deseja fazer com o valor?</label>
                        <div style={{ display: 'flex', gap: '16px' }}>
                          <label style={{ flex: 1, padding: '16px', border: `2px solid ${destinoValor === 'credito' ? '#8b5cf6' : 'var(--border-color)'}`, borderRadius: '8px', cursor: 'pointer', backgroundColor: destinoValor === 'credito' ? 'rgba(139, 92, 246, 0.1)' : 'transparent', transition: 'all 0.2s', display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <input type="radio" name="destino" checked={destinoValor === 'credito'} onChange={() => setDestinoValor('credito')} style={{ display: 'none' }} />
                              <div style={{ width: '18px', height: '18px', borderRadius: '50%', border: `2px solid ${destinoValor === 'credito' ? '#8b5cf6' : 'var(--text-muted)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                {destinoValor === 'credito' && <div style={{ width: '10px', height: '10px', backgroundColor: '#8b5cf6', borderRadius: '50%' }} />}
                              </div>
                              <strong style={{ color: destinoValor === 'credito' ? '#8b5cf6' : 'white' }}>Gerar Crédito do Cliente</strong>
                            </div>
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '26px' }}>Fica como saldo para uso em Contas a Receber futuras.</span>
                          </label>

                          <label style={{ flex: 1, padding: '16px', border: `2px solid ${destinoValor === 'caixa' ? '#10b981' : 'var(--border-color)'}`, borderRadius: '8px', cursor: 'pointer', backgroundColor: destinoValor === 'caixa' ? 'rgba(16, 185, 129, 0.1)' : 'transparent', transition: 'all 0.2s', display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <input type="radio" name="destino" checked={destinoValor === 'caixa'} onChange={() => setDestinoValor('caixa')} style={{ display: 'none' }} />
                              <div style={{ width: '18px', height: '18px', borderRadius: '50%', border: `2px solid ${destinoValor === 'caixa' ? '#10b981' : 'var(--text-muted)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                {destinoValor === 'caixa' && <div style={{ width: '10px', height: '10px', backgroundColor: '#10b981', borderRadius: '50%' }} />}
                              </div>
                              <strong style={{ color: destinoValor === 'caixa' ? '#10b981' : 'white' }}>Devolver pelo Caixa</strong>
                            </div>
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '26px' }}>Lança uma Despesa no Fluxo de Caixa no dia de hoje.</span>
                          </label>
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px', marginTop: '8px' }}>
                        <div className="input-group">
                          <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Motivo *</label>
                          <select 
                            value={motivo} 
                            onChange={(e) => setMotivo(e.target.value)}
                            style={{ width: '100%', padding: '10px 12px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)' }}
                          >
                            <option value="">Selecione...</option>
                            <option value="Cliente desistiu">Cliente desistiu</option>
                            <option value="Produto com defeito">Produto com defeito</option>
                            <option value="Produto errado">Produto errado</option>
                            <option value="Troca">Troca</option>
                            <option value="Erro de Venda">Erro de Venda</option>
                            <option value="Outro">Outro</option>
                          </select>
                        </div>
                        <div className="input-group">
                          <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Observação (opcional)</label>
                          <input 
                            type="text" 
                            placeholder="Detalhes adicionais..."
                            value={observacao}
                            onChange={e => setObservacao(e.target.value)}
                            style={{ width: '100%', padding: '10px 12px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)' }}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer Modal */}
            <div style={{ padding: '20px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '12px', backgroundColor: 'var(--bg-primary)' }}>
              <button className="btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
              {pedidoEncontrado.status !== 'Cancelada' && (
                <button 
                  className="btn-primary" 
                  disabled={valorTotalCalculado <= 0 || !motivo || isSearching}
                  onClick={handleConfirmarDevolucao}
                  style={{ backgroundColor: '#ef4444', border: 'none', opacity: (valorTotalCalculado <= 0 || !motivo || isSearching) ? 0.5 : 1 }}
                >
                  {isSearching ? 'Processando...' : 'Confirmar Devolução'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DevolucoesVenda;
