import React, { useEffect, useState } from 'react';
import { collection, query, onSnapshot, where, doc, updateDoc, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { CheckCircle, Clock, X, Wallet, AlertCircle, MessageCircle } from 'lucide-react';
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
  dataPagamento?: string;
  createdAt?: any;
  clienteNome?: string;
}

const ContasReceber: React.FC = () => {
  const [transacoes, setTransacoes] = useState<TransacaoData[]>([]);
  const [loading, setLoading] = useState(true);
  const { currentUser, tenantId } = useAuth();
  
  const [modalConciliacao, setModalConciliacao] = useState<{ ativo: boolean, transacao: TransacaoData | null, creditos: any[], saldoTotal: number }>({
    ativo: false, transacao: null, creditos: [], saldoTotal: 0
  });
  const [valorAbater, setValorAbater] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (!currentUser) return;
    
    // Escutar TODAS as transacoes de entrada para poder calcular o recebido de hoje
    const q = query(
      collection(db, 'transacoes'), 
      where('tenantId', '==', tenantId),
      where('tipo', '==', 'entrada')
    );

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
      console.error("Erro ao buscar contas a receber:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser]);

  const handleConciliar = async (t: TransacaoData) => {
    let saldoCredito = 0;
    let creditosAtivos: any[] = [];
    
    if (t.clienteNome) {
      const qC = query(
        collection(db, 'creditos_cliente'), 
        where('tenantId', '==', tenantId), 
        where('clienteNome', '==', t.clienteNome), 
        where('status', 'in', ['disponivel', 'usado_parcial'])
      );
      const snapC = await getDocs(qC);
      snapC.forEach(d => {
        const data = d.data();
        if (data.saldoDisponivel > 0) {
          creditosAtivos.push({ id: d.id, ...data });
          saldoCredito += data.saldoDisponivel;
        }
      });
    }

    if (saldoCredito > 0) {
      const sugerido = Math.min(t.valor, saldoCredito);
      setValorAbater(sugerido);
      setModalConciliacao({ ativo: true, transacao: t, creditos: creditosAtivos, saldoTotal: saldoCredito });
      return;
    }

    const result = await NexusSwal.fire({
      title: 'Confirmar Recebimento?',
      text: `Selecione como foi recebido o valor de R$ ${Number(t.valor).toFixed(2)} referente a ${t.descricao}:`,
      icon: 'question',
      input: 'select',
      inputOptions: {
        'Dinheiro': 'Dinheiro',
        'Pix': 'Pix',
        'Cartão de Crédito': 'Cartão de Crédito',
        'Cartão de Débito': 'Cartão de Débito',
        'Transferência': 'Transferência',
        'Outros': 'Outros'
      },
      inputPlaceholder: 'Selecione a forma de pagamento',
      inputValue: t.formaPagamento && ['Dinheiro', 'Pix', 'Cartão de Crédito', 'Cartão de Débito', 'Transferência', 'Outros'].includes(t.formaPagamento) ? t.formaPagamento : '',
      showCancelButton: true,
      confirmButtonText: 'Sim, dar baixa no caixa',
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
        showSuccess('Pagamento aprovado e somado ao Fluxo de Caixa!');
      } catch (err) {
        showError('Erro', 'Não foi possível aprovar a transação.');
      }
    }
  };

  const confirmarBaixaComCredito = async () => {
    const t = modalConciliacao.transacao;
    if (!t || !currentUser || !tenantId) return;

    if (valorAbater < 0 || valorAbater > modalConciliacao.saldoTotal || valorAbater > t.valor) {
      showError('Erro', 'Valor de abatimento inválido.');
      return;
    }

    setIsProcessing(true);
    try {
      let valorRestanteAbater = valorAbater;
      
      // 1. Descontar do(s) crédito(s) do cliente
      for (const cred of modalConciliacao.creditos) {
        if (valorRestanteAbater <= 0) break;
        
        const disponivel = cred.saldoDisponivel;
        const usarDeste = Math.min(disponivel, valorRestanteAbater);
        
        const novoSaldo = disponivel - usarDeste;
        const novoStatus = novoSaldo <= 0 ? 'esgotado' : 'usado_parcial';
        
        await updateDoc(doc(db, 'creditos_cliente', cred.id), {
          saldoDisponivel: novoSaldo,
          status: novoStatus,
          updatedAt: serverTimestamp()
        });
        
        valorRestanteAbater -= usarDeste;
      }

      // 2. Atualizar ou desdobrar a transação
      if (valorAbater === t.valor) {
        // Abateu tudo, marca como paga
        await updateDoc(doc(db, 'transacoes', t.id), {
          status: 'Paga',
          observacao: `Pagamento realizado utilizando R$ ${valorAbater.toFixed(2)} de crédito do cliente.`,
          formaPagamento: 'Crédito de Devolução'
        });
      } else if (valorAbater > 0) {
        // Abateu parcial
        const novoValorPendente = t.valor - valorAbater;
        // Atualiza a original para o valor menor
        await updateDoc(doc(db, 'transacoes', t.id), {
          valor: novoValorPendente,
          observacao: `Foi abatido R$ ${valorAbater.toFixed(2)} de crédito. Restante R$ ${novoValorPendente.toFixed(2)} pendente.`
        });
        // Lança uma nova transacao como "Paga" representando o crédito usado
        await addDoc(collection(db, 'transacoes'), {
          ...t,
          id: undefined, // remove o id original
          valor: valorAbater,
          status: 'Paga',
          formaPagamento: 'Crédito de Devolução',
          observacao: 'Transação desdobrada (Abatimento de Crédito)',
          createdAt: serverTimestamp()
        });
      } else {
        // valorAbater == 0, apenas dá baixa normal (usuário optou por não usar o crédito)
        await updateDoc(doc(db, 'transacoes', t.id), { status: 'Paga' });
      }

      showSuccess('Pagamento aprovado e atualizado!');
      fecharModalConciliacao();
    } catch (error) {
      console.error(error);
      showError('Erro', 'Ocorreu um erro ao processar o abatimento.');
    } finally {
      setIsProcessing(false);
    }
  };

  const fecharModalConciliacao = () => {
    setModalConciliacao({ ativo: false, transacao: null, creditos: [], saldoTotal: 0 });
    setValorAbater(0);
  };

  const handleCobrarWhatsApp = (t: TransacaoData) => {
    const nomeCliente = t.clienteNome || 'Cliente';
    const valorMsg = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(t.valor));
    
    const mensagem = `Olá ${nomeCliente}. Gostaríamos de lembrar amigavelmente sobre uma pendência financeira referente à(o) ${t.descricao} no valor de ${valorMsg}. O acerto tempestivo é fundamental para mantermos nossa excelência no atendimento. Aguardamos o seu retorno e estamos à disposição para eventuais dúvidas.`;
    
    const url = `https://wa.me/?text=${encodeURIComponent(mensagem)}`;
    window.open(url, '_blank');
  };

  const hojeStr = new Date().toISOString().split('T')[0];
  const contasPendentes = transacoes.filter(t => t.status === 'Pendente');
  const recebimentosHoje = transacoes.filter(t => t.status === 'Paga' && t.dataPagamento === hojeStr);

  const totalPendente = contasPendentes.reduce((acc, curr) => acc + curr.valor, 0);
  const totalRecebidoHoje = recebimentosHoje.reduce((acc, curr) => acc + curr.valor, 0);

  return (
    <div className="financeiro-page" style={{ padding: '24px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700 }}>Contas a Receber</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>Aguardando conciliação de pagamentos (Cartão, Boleto, Prazo)</p>
        </div>
        <div style={{ display: 'flex', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'rgba(16, 185, 129, 0.1)', padding: '12px 24px', borderRadius: 'var(--radius-lg)', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
            <Clock size={24} color="#10b981" />
            <div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Recebido Hoje</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#10b981' }}>
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalRecebidoHoje)}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'var(--bg-secondary)', padding: '12px 24px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
            <Clock size={24} color="#f59e0b" />
            <div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Total a Receber</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#f59e0b' }}>
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalPendente)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
        <div className="table-wrapper">
          <table className="data-table financeiro-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ padding: '16px' }}>Data da OS</th>
                <th style={{ padding: '16px' }}>Descrição / O.S</th>
                <th style={{ padding: '16px' }}>Forma de Pgto.</th>
                <th style={{ padding: '16px' }}>Status</th>
                <th style={{ padding: '16px', textAlign: 'right' }}>Valor (R$)</th>
                <th style={{ padding: '16px', textAlign: 'center' }}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '20px' }}>Carregando contas a receber...</td>
                </tr>
              ) : contasPendentes.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    <CheckCircle size={48} color="#10b981" style={{ margin: '0 auto 16px', opacity: 0.5 }} />
                    <div>Nenhuma conta pendente para conciliação no momento.</div>
                  </td>
                </tr>
              ) : (
                contasPendentes.map((t) => (
                  <tr key={t.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '16px', color: 'var(--text-muted)' }}>{t.data ? t.data.split('-').reverse().join('/') : new Date(t.createdAt?.seconds * 1000).toLocaleDateString('pt-BR')}</td>
                    <td style={{ padding: '16px', fontWeight: 500 }}>{t.descricao}</td>
                    <td style={{ padding: '16px' }}>
                      <span style={{ fontSize: '12px', backgroundColor: 'var(--bg-tertiary)', padding: '4px 8px', borderRadius: '4px', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>
                        {t.formaPagamento || 'Não informada'}
                      </span>
                    </td>
                    <td style={{ padding: '16px' }}>
                      <span className="status-badge" style={{ backgroundColor: '#f59e0b20', color: '#f59e0b', whiteSpace: 'nowrap', padding: '4px 8px', borderRadius: '12px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <span className="status-dot" style={{ backgroundColor: '#f59e0b', width: '6px', height: '6px', borderRadius: '50%' }}></span>
                        Aguardando Conciliação
                      </span>
                    </td>
                    <td style={{ padding: '16px', textAlign: 'right', fontWeight: '600', color: '#10b981' }}>
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(t.valor))}
                    </td>
                    <td style={{ padding: '16px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                        <button 
                          onClick={() => handleCobrarWhatsApp(t)}
                          style={{ backgroundColor: '#25D366', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', borderRadius: '4px', padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px', transition: 'filter 0.2s' }}
                          title="Cobrar via WhatsApp"
                          onMouseOver={(e) => e.currentTarget.style.filter = 'brightness(1.1)'}
                          onMouseOut={(e) => e.currentTarget.style.filter = 'brightness(1)'}
                        >
                          <MessageCircle size={14} /> Cobrar
                        </button>
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

      {/* Modal de Conciliação com Crédito */}
      {modalConciliacao.ativo && modalConciliacao.transacao && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
        }}>
          <div className="card" style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '500px', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-primary)' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Wallet size={20} color="#8b5cf6" /> 
                Crédito Disponível
              </h2>
              <button onClick={fecharModalConciliacao} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={24} />
              </button>
            </div>
            
            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ padding: '16px', backgroundColor: 'rgba(139, 92, 246, 0.1)', border: '1px solid rgba(139, 92, 246, 0.3)', borderRadius: '8px', color: '#8b5cf6', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <AlertCircle size={32} />
                <div>
                  <strong style={{ fontSize: '15px' }}>O cliente {modalConciliacao.transacao.clienteNome} possui R$ {modalConciliacao.saldoTotal.toFixed(2)} em créditos!</strong>
                  <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>Você pode usar esse saldo para abater o valor desta conta.</p>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', backgroundColor: 'var(--bg-tertiary)', padding: '16px', borderRadius: '8px' }}>
                <div>
                  <span style={{color: 'var(--text-muted)', fontSize: '12px'}}>Valor da Conta:</span><br/>
                  <strong style={{fontSize: '18px', color: '#ef4444'}}>R$ {modalConciliacao.transacao.valor.toFixed(2)}</strong>
                </div>
                <div>
                  <span style={{color: 'var(--text-muted)', fontSize: '12px'}}>Saldo de Crédito:</span><br/>
                  <strong style={{fontSize: '18px', color: '#8b5cf6'}}>R$ {modalConciliacao.saldoTotal.toFixed(2)}</strong>
                </div>
              </div>

              <div className="input-group">
                <label style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Quanto do crédito deseja utilizar?</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <input 
                    type="number"
                    min="0"
                    max={Math.min(modalConciliacao.transacao.valor, modalConciliacao.saldoTotal)}
                    step="0.01"
                    value={valorAbater}
                    onChange={(e) => setValorAbater(Number(e.target.value))}
                    style={{ flex: 1, padding: '12px', fontSize: '18px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)' }}
                  />
                  <button 
                    type="button" 
                    className="btn-secondary" 
                    onClick={() => setValorAbater(Math.min(modalConciliacao.transacao?.valor || 0, modalConciliacao.saldoTotal))}
                    style={{ padding: '12px 16px', height: '100%' }}
                  >
                    Usar Máximo
                  </button>
                </div>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px', display: 'block' }}>
                  Restará R$ {Math.max(0, modalConciliacao.transacao.valor - valorAbater).toFixed(2)} pendente após o abatimento.
                </span>
              </div>
            </div>

            <div style={{ padding: '20px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '12px', backgroundColor: 'var(--bg-primary)' }}>
              <button className="btn-secondary" onClick={() => { setValorAbater(0); confirmarBaixaComCredito(); }}>Dar baixa sem usar crédito</button>
              <button 
                className="btn-primary" 
                disabled={isProcessing}
                onClick={confirmarBaixaComCredito}
                style={{ backgroundColor: '#10b981', border: 'none', opacity: isProcessing ? 0.7 : 1 }}
              >
                {isProcessing ? 'Processando...' : 'Confirmar Baixa'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ContasReceber;
