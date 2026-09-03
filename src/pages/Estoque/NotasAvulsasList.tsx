import React, { useEffect, useState } from 'react';
import { PackagePlus, Plus, RotateCcw, Search } from 'lucide-react';
import { collection, doc, onSnapshot, query, runTransaction, serverTimestamp, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { showError, showSuccess, NexusSwal } from '../../utils/alerts';
import { buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { STATUS_NOTA_AVULSA_ATIVA, STATUS_NOTA_AVULSA_CANCELADA, type NotaAvulsaItem } from '../../utils/notaAvulsaDomain';

interface NotaAvulsaData {
  id: string;
  numero: string;
  fornecedorNome: string;
  itens: NotaAvulsaItem[];
  valorTotal: number;
  formaPagamento: 'a_vista' | 'pendente';
  destinoPagamento?: 'caixa' | 'banco';
  bancoId?: string;
  bancoNome?: string;
  transacaoId: string;
  status: string;
  createdAt?: { seconds?: number };
}

const NotasAvulsasList: React.FC = () => {
  const { currentUser, tenantId } = useAuth();
  const { openTab } = useTabs();
  const [notas, setNotas] = useState<NotaAvulsaData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [cancelandoId, setCancelandoId] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    const q = query(collection(db, 'notas_avulsas'), where('tenantId', '==', tenantId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const lista: NotaAvulsaData[] = [];
      snapshot.forEach((docSnap) => lista.push({ id: docSnap.id, ...docSnap.data() } as NotaAvulsaData));
      lista.sort((a, b) => Number(b.numero) - Number(a.numero));
      setNotas(lista);
      setLoading(false);
    }, (error) => {
      console.error('Erro ao carregar notas avulsas:', error);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [tenantId]);

  const termo = searchTerm.trim().toLowerCase();
  const notasFiltradas = termo
    ? notas.filter((n) => n.numero?.toLowerCase().includes(termo) || n.fornecedorNome?.toLowerCase().includes(termo))
    : notas;

  const handleCancelar = async (nota: NotaAvulsaData) => {
    if (!currentUser || !tenantId) return;

    const confirm = await NexusSwal.fire({
      title: `Cancelar Nota Avulsa #${nota.numero}?`,
      text: 'O estoque recebido por esta nota será retirado de novo e o lançamento financeiro ligado a ela será cancelado. A nota fica registrada como cancelada, nunca é apagada.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sim, cancelar nota',
      cancelButtonText: 'Manter nota',
      confirmButtonColor: '#ef4444',
      reverseButtons: true,
    });
    if (!confirm.isConfirmed) return;

    setCancelandoId(nota.id);
    try {
      await runTransaction(db, async (transaction) => {
        const notaRef = doc(db, 'notas_avulsas', nota.id);
        const notaSnap = await transaction.get(notaRef);
        if (!notaSnap.exists()) throw new Error('Esta nota avulsa não existe mais.');
        if (notaSnap.data().status !== STATUS_NOTA_AVULSA_ATIVA) throw new Error('Esta nota avulsa já está cancelada.');

        const transacaoRef = nota.transacaoId ? doc(db, 'transacoes', nota.transacaoId) : null;
        const transacaoSnap = transacaoRef ? await transaction.get(transacaoRef) : null;

        const bancoRef = nota.destinoPagamento === 'banco' && nota.bancoId ? doc(db, 'bancos', nota.bancoId) : null;
        const bancoSnap = bancoRef ? await transaction.get(bancoRef) : null;

        const produtoRefs = nota.itens.map((item) => ({ item, ref: doc(db, 'estoque', item.produtoId) }));
        const produtoSnaps = await Promise.all(produtoRefs.map(({ ref }) => transaction.get(ref)));

        // Reverte o estoque -- bloqueia se ja foi vendido/usado mais do que
        // esta nota trouxe (ficaria negativo). Mesma logica de qualquer
        // estorno do sistema: nao deixa o dado ficar inconsistente.
        produtoRefs.forEach(({ item, ref }, index) => {
          const snap = produtoSnaps[index];
          if (!snap.exists()) return;
          const quantidadeAtual = Number(snap.data()?.quantidade || 0);
          const quantidadeDepois = quantidadeAtual - item.quantidade;
          if (quantidadeDepois < 0) {
            throw new Error(`Não é possível cancelar: o estoque de "${item.produtoNome}" recebido por esta nota já foi parcial ou totalmente utilizado (disponível: ${quantidadeAtual}, a retirar: ${item.quantidade}).`);
          }
          transaction.update(ref, { quantidade: quantidadeDepois, updatedAt: serverTimestamp() });
        });

        transaction.update(notaRef, {
          status: STATUS_NOTA_AVULSA_CANCELADA,
          canceladoEm: serverTimestamp(),
          canceladoPor: currentUser.uid,
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Nota avulsa cancelada'),
        });

        if (transacaoRef && transacaoSnap?.exists()) {
          transaction.update(transacaoRef, {
            status: 'Cancelada',
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Nota Avulsa #${nota.numero} cancelada`),
          });

          // Se ja tinha sido pago via banco, devolve o saldo -- simetrico ao
          // debito feito no lancamento. Caixa fisico nao tem saldo guardado
          // em documento (so aparece agregado em relatorio por status
          // 'Paga'), entao cancelar a transacao ja e suficiente ali.
          if (bancoRef && bancoSnap?.exists()) {
            const saldoAtualCentavos = Number(bancoSnap.data().saldoCentavos || 0);
            transaction.update(bancoRef, {
              saldoCentavos: saldoAtualCentavos + Number(transacaoSnap.data().valorCentavos || 0),
              updatedAt: serverTimestamp(),
              ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Cancelamento da Nota Avulsa #${nota.numero}`),
            });
          }
        }
      });

      try {
        const { createAuditLog } = await import('../../services/logService');
        createAuditLog({
          tenantId,
          usuarioId: currentUser.uid,
          usuarioEmail: currentUser.email || currentUser.uid,
          modulo: 'nota_avulsa',
          acao: 'cancelamento',
          descricao: `Nota Avulsa #${nota.numero} cancelada (fornecedor "${nota.fornecedorNome}").`,
          registroRelacionadoId: nota.id,
          status: 'sucesso',
          critical: true,
        });
      } catch (logError) {
        console.error('Erro ao registrar auditoria do cancelamento:', logError);
      }

      showSuccess('Nota avulsa cancelada!');
    } catch (error) {
      console.error('Erro ao cancelar nota avulsa:', error);
      showError('Erro ao cancelar', error instanceof Error ? error.message : 'Não foi possível cancelar a nota. Tente novamente.');
    } finally {
      setCancelandoId(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <PackagePlus size={28} color="var(--accent-purple)" />
            Notas Avulsas
          </h1>
          <p style={{ color: 'var(--text-muted)' }}>Compras manuais de mercadoria sem XML fiscal.</p>
        </div>
        <button className="btn-primary" onClick={() => openTab('/estoque/notas-avulsas/nova', 'Nova Nota Avulsa')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Plus size={20} /> Nova Nota Avulsa
        </button>
      </div>

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div className="search-bar" style={{ position: 'relative', marginBottom: '24px' }}>
          <Search size={20} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Buscar por número ou fornecedor..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: '100%', padding: '12px 16px 12px 48px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
          />
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '13px', textTransform: 'uppercase' }}>
                <th style={{ padding: '16px' }}>Nº</th>
                <th style={{ padding: '16px' }}>Data</th>
                <th style={{ padding: '16px' }}>Fornecedor</th>
                <th style={{ padding: '16px' }}>Itens</th>
                <th style={{ padding: '16px' }}>Pagamento</th>
                <th style={{ padding: '16px' }}>Status</th>
                <th style={{ padding: '16px', textAlign: 'right' }}>Total (R$)</th>
                <th style={{ padding: '16px', textAlign: 'center' }}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '40px' }}>Carregando notas avulsas...</td></tr>
              ) : notasFiltradas.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <PackagePlus size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
                    <p>Nenhuma nota avulsa lançada ainda.</p>
                  </td>
                </tr>
              ) : (
                notasFiltradas.map((n) => (
                  <tr key={n.id} style={{ borderBottom: '1px solid var(--border-color)', opacity: n.status === STATUS_NOTA_AVULSA_CANCELADA ? 0.6 : 1 }}>
                    <td style={{ padding: '16px', fontWeight: 600 }}>#{n.numero}</td>
                    <td style={{ padding: '16px' }}>{n.createdAt?.seconds ? new Date(n.createdAt.seconds * 1000).toLocaleDateString('pt-BR') : '-'}</td>
                    <td style={{ padding: '16px' }}>{n.fornecedorNome}</td>
                    <td style={{ padding: '16px' }}>{(n.itens || []).length} {(n.itens || []).length === 1 ? 'item' : 'itens'}</td>
                    <td style={{ padding: '16px' }}>{n.formaPagamento === 'a_vista' ? 'À vista' : 'Pendente'}</td>
                    <td style={{ padding: '16px' }}>
                      <span style={{
                        backgroundColor: n.status === STATUS_NOTA_AVULSA_CANCELADA ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.2)',
                        color: n.status === STATUS_NOTA_AVULSA_CANCELADA ? '#ef4444' : '#10b981',
                        padding: '4px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 600,
                      }}>
                        {n.status === STATUS_NOTA_AVULSA_CANCELADA ? 'Cancelada' : 'Ativa'}
                      </span>
                    </td>
                    <td style={{ padding: '16px', textAlign: 'right', fontWeight: 700 }}>
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n.valorTotal)}
                    </td>
                    <td style={{ padding: '16px', textAlign: 'center' }}>
                      {n.status === STATUS_NOTA_AVULSA_ATIVA && (
                        <button
                          onClick={() => void handleCancelar(n)}
                          className="icon-btn"
                          title="Cancelar Nota Avulsa"
                          disabled={cancelandoId === n.id}
                          style={{ color: '#ef4444' }}
                        >
                          <RotateCcw size={18} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default NotasAvulsasList;
