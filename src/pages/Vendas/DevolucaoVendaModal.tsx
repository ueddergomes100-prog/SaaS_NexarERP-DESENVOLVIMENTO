import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Receipt, X } from 'lucide-react';
import { collection, doc, getDocs, query, runTransaction, serverTimestamp, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError } from '../../utils/alerts';
import { applyStockAdjustments } from '../../utils/firestoreAtomic';
import { toStockAdjustmentItems } from '../../utils/embalagemDomain';
import { recalculateCommissionAfterReturn, toCents } from '../../utils/financeDomain';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';

/** Formas de devolucao que saem de conta bancaria (nao do caixa fisico). */
const FORMAS_BANCARIAS = ['Pix', 'Transferência'] as const;
type FormaBancaria = typeof FORMAS_BANCARIAS[number];

interface BancoOption {
  id: string;
  nome: string;
}

interface DevolucaoItem {
  id: string;
  nome: string;
  precoUnitario: number;
  quantidade: number;
  desconto: number;
  quantidadeJaDevolvida?: number;
  selecionado: boolean;
  quantidadeSelecionada: number;
  /** Fator da embalagem em que o item foi vendido -- devolver 1 saco tem que
   * repor 20kg no estoque, nao 1. Ausente = venda na unidade base (fator 1). */
  fatorConversao?: number;
  unidadeMedidaSigla?: string;
}

interface DevolucaoVendaModalProps {
  pedidoId: string;
  numeroPedido: string;
  clienteNome: string;
  itens: Array<{ id: string; nome: string; precoUnitario: number; quantidade: number; desconto: number; quantidadeJaDevolvida?: number; fatorConversao?: number; unidadeMedidaSigla?: string }>;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Devolucao de um pedido de venda ja carregado (aberta de dentro da tela
 * do proprio pedido, sem etapa de busca -- antes era uma tela separada,
 * DevolucoesVenda.tsx, que buscava o pedido pelo numero). Logica de
 * confirmar devolucao movida sem alteracao da tela antiga.
 */
const DevolucaoVendaModal: React.FC<DevolucaoVendaModalProps> = ({ pedidoId, numeroPedido, clienteNome, itens: itensOriginais, onClose, onSuccess }) => {
  const { currentUser, tenantId } = useAuth();
  const [itens, setItens] = useState<DevolucaoItem[]>([]);
  const [destinoValor, setDestinoValor] = useState<'credito' | 'caixa' | 'banco'>('credito');
  const [formaBancaria, setFormaBancaria] = useState<FormaBancaria>('Pix');
  const [bancoId, setBancoId] = useState('');
  const [bancos, setBancos] = useState<BancoOption[]>([]);
  const [motivo, setMotivo] = useState('');
  const [observacao, setObservacao] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const returnLockRef = useRef(false);

  useEffect(() => {
    setItens(itensOriginais.map((item) => ({
      ...item,
      quantidadeJaDevolvida: item.quantidadeJaDevolvida || 0,
      quantidadeSelecionada: 0,
      selecionado: false,
    })));
  }, [itensOriginais]);

  useEffect(() => {
    if (!tenantId) return;
    getDocs(query(collection(db, 'bancos'), where('tenantId', '==', tenantId), where('ativo', '==', true)))
      .then((snap) => setBancos(snap.docs.map((d) => ({ id: d.id, nome: String(d.data().nome || '') }))))
      .catch((error) => console.error('Erro ao carregar bancos:', error));
  }, [tenantId]);

  const handleToggleItem = (index: number) => {
    setItens((current) => current.map((item, idx) => {
      if (idx !== index) return item;
      const disponivel = item.quantidade - (item.quantidadeJaDevolvida || 0);
      if (!item.selecionado && disponivel > 0) return { ...item, selecionado: true, quantidadeSelecionada: 1 };
      return { ...item, selecionado: false, quantidadeSelecionada: 0 };
    }));
  };

  const handleQtdChange = (index: number, novaQtd: number) => {
    setItens((current) => current.map((item, idx) => {
      if (idx !== index) return item;
      const maxPermitido = item.quantidade - (item.quantidadeJaDevolvida || 0);
      const qtd = Math.max(0, Math.min(novaQtd, maxPermitido));
      return { ...item, quantidadeSelecionada: qtd, selecionado: qtd > 0 };
    }));
  };

  const valorTotalCalculado = itens.reduce((total, item) => {
    if (!item.selecionado || item.quantidadeSelecionada <= 0) return total;
    const proporcao = item.quantidadeSelecionada / item.quantidade;
    const subtotalBase = item.quantidadeSelecionada * item.precoUnitario;
    const descontoProporcional = item.desconto * proporcao;
    return total + (subtotalBase - descontoProporcional);
  }, 0);

  const handleConfirmarDevolucao = async () => {
    if (returnLockRef.current) return;
    if (!currentUser || !tenantId) return;

    if (valorTotalCalculado <= 0) {
      showError('Atenção', 'Selecione pelo menos um item com quantidade válida para devolução.');
      return;
    }
    if (!motivo) {
      showError('Atenção', 'Selecione o motivo da devolução.');
      return;
    }
    if (destinoValor === 'banco' && !bancoId) {
      showError('Atenção', 'Selecione de qual banco o dinheiro está saindo.');
      return;
    }

    returnLockRef.current = true;
    setIsProcessing(true);

    try {
      const novaDevolucaoRef = doc(collection(db, 'devolucoes_venda'));
      const saleRef = doc(db, 'pedidos_venda', pedidoId);
      const itensFiltrados = itens.filter((item) => item.selecionado && item.quantidadeSelecionada > 0);
      const itensDevolvidos = itensFiltrados.map((item) => ({
        id: item.id,
        nome: item.nome,
        precoUnitario: item.precoUnitario,
        quantidadeDevolvida: item.quantidadeSelecionada,
        descontoProporcional: item.desconto * (item.quantidadeSelecionada / item.quantidade),
        subtotal: (item.quantidadeSelecionada * item.precoUnitario) - (item.desconto * (item.quantidadeSelecionada / item.quantidade)),
        // Preservado no documento da devolucao para o estorno saber reverter
        // na mesma unidade -- sem isso, estornar devolveria a quantidade em
        // embalagem como se fosse unidade base.
        ...(item.fatorConversao ? { fatorConversao: item.fatorConversao } : {}),
      }));

      await runTransaction(db, async (transaction) => {
        const saleSnap = await transaction.get(saleRef);
        if (!saleSnap.exists()) throw new Error('A venda original não existe mais.');
        const saleData = saleSnap.data();
        if (saleData.status === 'Cancelada') throw new Error('Venda cancelada não pode receber nova devolução.');

        // Leitura do banco ANTES de qualquer escrita: applyStockAdjustments
        // ja grava, e transacao do Firestore recusa read depois de write.
        const bancoRef = destinoValor === 'banco' ? doc(db, 'bancos', bancoId) : null;
        let saldoBancoCentavos = 0;
        if (bancoRef) {
          const bancoSnap = await transaction.get(bancoRef);
          if (!bancoSnap.exists()) throw new Error('O banco selecionado não existe mais.');
          saldoBancoCentavos = Number(bancoSnap.data().saldoCentavos || 0);
        }

        const storedItems = Array.isArray(saleData.itens) ? saleData.itens : [];
        const updatedItems = storedItems.map((storedItem: DevolucaoItem) => {
          const returnedItem = itensFiltrados.find((item) => item.id === storedItem.id && item.nome === storedItem.nome);
          if (!returnedItem) return storedItem;
          const alreadyReturned = Number(storedItem.quantidadeJaDevolvida || 0);
          const available = Number(storedItem.quantidade || 0) - alreadyReturned;
          if (returnedItem.quantidadeSelecionada > available) {
            throw new Error(`A quantidade disponível para devolução de ${storedItem.nome} foi alterada.`);
          }
          return { ...storedItem, quantidadeJaDevolvida: alreadyReturned + returnedItem.quantidadeSelecionada };
        });

        await applyStockAdjustments(
          transaction,
          db,
          toStockAdjustmentItems(itensFiltrados.map((item) => ({
            id: item.id,
            nome: item.nome,
            quantidade: item.quantidadeSelecionada,
            fatorConversao: item.fatorConversao,
          }))),
          'increment',
          true,
        );

        transaction.set(novaDevolucaoRef, {
          pedidoVendaId: pedidoId,
          numeroPedidoOriginal: numeroPedido,
          clienteNome,
          valorTotalDevolvido: valorTotalCalculado,
          valorTotalDevolvidoCentavos: toCents(valorTotalCalculado),
          destinoValor,
          // Guardados pro estorno saber devolver o dinheiro pro mesmo
          // banco, sem depender do que estiver selecionado na tela depois.
          ...(destinoValor === 'banco' ? {
            bancoId,
            bancoNome: bancos.find((b) => b.id === bancoId)?.nome || '',
            formaDevolucao: formaBancaria,
          } : {}),
          motivo,
          observacao,
          tenantId,
          usuarioResponsavelId: currentUser.uid,
          status: 'concluida',
          idempotencyKey: `devolucao:${novaDevolucaoRef.id}`,
          createdAt: serverTimestamp(),
          itensDevolvidos,
          ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
        });

        const savedCommission = saleData.comissao?.regraVersion
          ? recalculateCommissionAfterReturn(
            saleData.comissao,
            itensDevolvidos.map((item) => ({ id: item.id, nome: item.nome, baseCents: toCents(item.subtotal) })),
          )
          : null;
        transaction.update(saleRef, {
          itens: updatedItems,
          ...(savedCommission ? { comissao: savedCommission } : {}),
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Devolução registrada'),
        });

        if (destinoValor === 'caixa') {
          transaction.set(doc(db, 'transacoes', `devolucao_${novaDevolucaoRef.id}`), {
            descricao: `Devolução Pedido #${numeroPedido} - Caixa`,
            categoria: 'Devolução de Venda',
            valor: valorTotalCalculado,
            valorCentavos: toCents(valorTotalCalculado),
            tipo: 'saida',
            formaPagamento: 'Dinheiro',
            naturezaFinanceira: 'caixa_fisico',
            movimentaCaixaFisico: true,
            status: 'Paga',
            data: getDateInputInTimeZone(),
            clienteNome,
            pedidoOrigemId: pedidoId,
            devolucaoId: novaDevolucaoRef.id,
            idempotencyKey: `devolucao:${novaDevolucaoRef.id}:caixa`,
            tenantId,
            createdAt: serverTimestamp(),
            ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
          });
        } else if (destinoValor === 'banco' && bancoRef) {
          const bancoNome = bancos.find((b) => b.id === bancoId)?.nome || '';
          transaction.set(doc(db, 'transacoes', `devolucao_${novaDevolucaoRef.id}`), {
            descricao: `Devolução Pedido #${numeroPedido} - ${formaBancaria}${bancoNome ? ` (${bancoNome})` : ''}`,
            categoria: 'Devolução de Venda',
            valor: valorTotalCalculado,
            valorCentavos: toCents(valorTotalCalculado),
            tipo: 'saida',
            formaPagamento: formaBancaria,
            naturezaFinanceira: 'bancario_digital',
            movimentaCaixaFisico: false,
            bancoId,
            bancoNome,
            status: 'Paga',
            data: getDateInputInTimeZone(),
            clienteNome,
            pedidoOrigemId: pedidoId,
            devolucaoId: novaDevolucaoRef.id,
            idempotencyKey: `devolucao:${novaDevolucaoRef.id}:banco`,
            tenantId,
            createdAt: serverTimestamp(),
            ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
          });
          // Debita o banco na hora, simetrico ao credito que a venda por
          // Pix/Transferencia aplica ao ser finalizada.
          transaction.update(bancoRef, {
            saldoCentavos: saldoBancoCentavos - toCents(valorTotalCalculado),
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Devolução do pedido #${numeroPedido}`),
          });
        } else {
          transaction.set(doc(db, 'creditos_cliente', `devolucao_${novaDevolucaoRef.id}`), {
            clienteNome,
            pedidoOrigemId: pedidoId,
            devolucaoId: novaDevolucaoRef.id,
            numeroPedidoOriginal: numeroPedido,
            valorOriginal: valorTotalCalculado,
            saldoDisponivel: valorTotalCalculado,
            status: 'disponivel',
            motivo,
            tenantId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
          });
        }
      });

      try {
        const { createAuditLog } = await import('../../services/logService');
        createAuditLog({
          tenantId,
          usuarioId: currentUser.uid,
          usuarioEmail: currentUser.email || currentUser.uid,
          modulo: 'vendas',
          acao: 'devolucao',
          descricao: `Devolução concluída para o pedido #${numeroPedido} no valor de R$ ${valorTotalCalculado.toFixed(2)}.`,
          registroRelacionadoId: novaDevolucaoRef.id,
          status: 'sucesso',
          critical: true
        });
      } catch (logError) {
        console.error('Erro ao registrar auditoria da devolução:', logError);
      }

      showSuccess('Devolução processada com sucesso!');
      onSuccess();
      onClose();
    } catch (err) {
      console.error(err);
      showError('Erro', err instanceof Error ? err.message : 'Ocorreu um problema ao processar a devolução.');
    } finally {
      returnLockRef.current = false;
      setIsProcessing(false);
    }
  };

  return (
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
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-primary)' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Receipt size={20} color="#3b82f6" />
            Devolução - Pedido #{numeroPedido}
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={24} />
          </button>
        </div>

        <div style={{ overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div>
            <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>Selecione os Itens para Devolução</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {itens.map((item, idx) => {
                const disponivelParaDevolucao = item.quantidade - (item.quantidadeJaDevolvida || 0);
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
                        Preço Un: R$ {item.precoUnitario.toFixed(2)} | Vendido: {item.quantidade} {item.unidadeMedidaSigla || 'un.'} {(item.quantidadeJaDevolvida || 0) > 0 && `(Já devolvido: ${item.quantidadeJaDevolvida})`}
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
                  <label style={{ flex: 1, padding: '16px', border: `2px solid ${destinoValor === 'credito' ? '#8b5cf6' : 'var(--border-color)'}`, borderRadius: '8px', cursor: 'pointer', backgroundColor: destinoValor === 'credito' ? 'rgba(139, 92, 246, 0.1)' : 'transparent', display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input type="radio" name="destino" checked={destinoValor === 'credito'} onChange={() => setDestinoValor('credito')} style={{ display: 'none' }} />
                      <div style={{ width: '18px', height: '18px', borderRadius: '50%', border: `2px solid ${destinoValor === 'credito' ? '#8b5cf6' : 'var(--text-muted)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {destinoValor === 'credito' && <div style={{ width: '10px', height: '10px', backgroundColor: '#8b5cf6', borderRadius: '50%' }} />}
                      </div>
                      <strong style={{ color: destinoValor === 'credito' ? '#8b5cf6' : 'white' }}>Gerar Crédito do Cliente</strong>
                    </div>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '26px' }}>Fica como saldo para uso em Contas a Receber futuras.</span>
                  </label>

                  <label style={{ flex: 1, padding: '16px', border: `2px solid ${destinoValor === 'caixa' ? '#10b981' : 'var(--border-color)'}`, borderRadius: '8px', cursor: 'pointer', backgroundColor: destinoValor === 'caixa' ? 'rgba(16, 185, 129, 0.1)' : 'transparent', display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input type="radio" name="destino" checked={destinoValor === 'caixa'} onChange={() => setDestinoValor('caixa')} style={{ display: 'none' }} />
                      <div style={{ width: '18px', height: '18px', borderRadius: '50%', border: `2px solid ${destinoValor === 'caixa' ? '#10b981' : 'var(--text-muted)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {destinoValor === 'caixa' && <div style={{ width: '10px', height: '10px', backgroundColor: '#10b981', borderRadius: '50%' }} />}
                      </div>
                      <strong style={{ color: destinoValor === 'caixa' ? '#10b981' : 'white' }}>Devolver em Dinheiro</strong>
                    </div>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '26px' }}>Sai do caixa físico e lança uma despesa no fluxo de caixa hoje.</span>
                  </label>

                  <label style={{ flex: 1, padding: '16px', border: `2px solid ${destinoValor === 'banco' ? '#3b82f6' : 'var(--border-color)'}`, borderRadius: '8px', cursor: 'pointer', backgroundColor: destinoValor === 'banco' ? 'rgba(59, 130, 246, 0.1)' : 'transparent', display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input type="radio" name="destino" checked={destinoValor === 'banco'} onChange={() => setDestinoValor('banco')} style={{ display: 'none' }} />
                      <div style={{ width: '18px', height: '18px', borderRadius: '50%', border: `2px solid ${destinoValor === 'banco' ? '#3b82f6' : 'var(--text-muted)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {destinoValor === 'banco' && <div style={{ width: '10px', height: '10px', backgroundColor: '#3b82f6', borderRadius: '50%' }} />}
                      </div>
                      <strong style={{ color: destinoValor === 'banco' ? '#3b82f6' : 'white' }}>Devolver pelo Banco</strong>
                    </div>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '26px' }}>Pix ou transferência: debita o saldo do banco escolhido.</span>
                  </label>
                </div>

                {destinoValor === 'banco' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px', marginTop: '16px' }}>
                    <div className="input-group">
                      <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Forma *</label>
                      <select
                        value={formaBancaria}
                        onChange={(e) => setFormaBancaria(e.target.value as FormaBancaria)}
                        style={{ width: '100%', padding: '10px 12px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)' }}
                      >
                        {FORMAS_BANCARIAS.map((forma) => <option key={forma} value={forma}>{forma}</option>)}
                      </select>
                    </div>
                    <div className="input-group">
                      <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>De qual banco está saindo o dinheiro? *</label>
                      <select
                        value={bancoId}
                        onChange={(e) => setBancoId(e.target.value)}
                        style={{ width: '100%', padding: '10px 12px', backgroundColor: 'var(--bg-primary)', border: `1px solid ${bancoId ? 'var(--border-color)' : '#ef4444'}`, borderRadius: '4px', color: 'var(--text-primary)' }}
                      >
                        <option value="">Selecione o banco...</option>
                        {bancos.map((banco) => <option key={banco.id} value={banco.id}>{banco.nome}</option>)}
                      </select>
                      {bancos.length === 0 && (
                        <small style={{ color: '#f59e0b' }}>Nenhum banco ativo cadastrado. Cadastre um em Cadastros → Bancos.</small>
                      )}
                    </div>
                  </div>
                )}
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

          {itens.every((item) => (item.quantidade - (item.quantidadeJaDevolvida || 0)) <= 0) && (
            <div style={{ padding: '16px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '8px', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <AlertTriangle size={24} />
              <div>
                <strong>Todos os itens já foram devolvidos!</strong>
                <p style={{ margin: 0, fontSize: '13px' }}>Não há mais nada disponível para devolução neste pedido.</p>
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: '20px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '12px', backgroundColor: 'var(--bg-primary)' }}>
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button
            className="btn-primary"
            disabled={valorTotalCalculado <= 0 || !motivo || isProcessing || (destinoValor === 'banco' && !bancoId)}
            onClick={handleConfirmarDevolucao}
            style={{ backgroundColor: '#ef4444', border: 'none', opacity: (valorTotalCalculado <= 0 || !motivo || isProcessing || (destinoValor === 'banco' && !bancoId)) ? 0.5 : 1 }}
          >
            {isProcessing ? 'Processando...' : 'Confirmar Devolução'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DevolucaoVendaModal;
