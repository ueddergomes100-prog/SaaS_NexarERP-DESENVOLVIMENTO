import React, { useEffect, useState } from 'react';
import { Barcode, PackagePlus, Plus, RotateCcw, Search } from 'lucide-react';
import { collection, doc, getDocs, onSnapshot, query, runTransaction, serverTimestamp, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { showError, showSuccess, NexusSwal } from '../../utils/alerts';
import { buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { STATUS_NOTA_AVULSA_ATIVA, STATUS_NOTA_AVULSA_CANCELADA, quantidadeEstoqueNotaAvulsaItem, type NotaAvulsaItem } from '../../utils/notaAvulsaDomain';

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
      // Busca TODAS as transacoes desta nota (pode ser mais de uma, se foi
      // parcelada em boletos) FORA da transacao -- Firestore nao permite
      // Query dentro de uma transacao, so leitura de documento por ref
      // (mesmo padrao do cancelamento de venda/OS, ver
      // PedidoVendaForm.tsx). `notaAvulsaId` e' gravado em toda transacao
      // de nota avulsa desde que a feature existe -- nao precisa de
      // fallback pro campo antigo `nota.transacaoId`.
      const transacoesSnap = await getDocs(query(
        collection(db, 'transacoes'),
        where('tenantId', '==', tenantId),
        where('notaAvulsaId', '==', nota.id),
      ));
      const transacaoRefsExternos = transacoesSnap.docs.map((d) => d.ref);

      await runTransaction(db, async (transaction) => {
        const notaRef = doc(db, 'notas_avulsas', nota.id);
        const notaSnap = await transaction.get(notaRef);
        if (!notaSnap.exists()) throw new Error('Esta nota avulsa não existe mais.');
        if (notaSnap.data().status !== STATUS_NOTA_AVULSA_ATIVA) throw new Error('Esta nota avulsa já está cancelada.');

        const transacaoSnaps = await Promise.all(transacaoRefsExternos.map((ref) => transaction.get(ref)));

        // Le o banco do estado ATUAL de cada transacao, nunca dos campos da
        // nota (nota.destinoPagamento/nota.bancoId): esses dois so existem
        // quando a nota nasceu "a vista". Nota criada "pendente" nao os
        // grava nela mesma -- se foi baixada depois em Contas a Pagar (que
        // grava bancoId/status:'Paga' direto na transacao), so a transacao
        // sabe disso. Agrupado por banco (nao por transacao): duas parcelas
        // pagas no MESMO banco tem que somar o credito, nao sobrescrever.
        const creditoPorBanco = new Map<string, number>();
        transacaoSnaps.forEach((snap) => {
          const data = snap.data();
          if (data?.status === 'Paga' && data?.bancoId) {
            creditoPorBanco.set(data.bancoId, (creditoPorBanco.get(data.bancoId) || 0) + Number(data.valorCentavos || 0));
          }
        });
        const bancoRefsComCredito = Array.from(creditoPorBanco.entries()).map(([bancoId, valorCentavos]) => ({
          bancoId, ref: doc(db, 'bancos', bancoId), valorCentavos,
        }));
        const bancoSnaps = await Promise.all(bancoRefsComCredito.map(({ ref }) => transaction.get(ref)));

        // Agrupado por produto (nao por item): o mesmo produto pode ter
        // entrado duas vezes na nota, uma em cada unidade (KG e SC) -- sem
        // agrupar, a segunda escrita sobrescreveria a primeira em vez de
        // subtrair as duas, ja que ambas leem o mesmo snapshot original.
        const retiradaPorProduto = new Map<string, { quantidadeBase: number; produtoNome: string }>();
        nota.itens.forEach((item) => {
          const anterior = retiradaPorProduto.get(item.produtoId);
          retiradaPorProduto.set(item.produtoId, {
            quantidadeBase: (anterior?.quantidadeBase || 0) + quantidadeEstoqueNotaAvulsaItem(item),
            produtoNome: item.produtoNome,
          });
        });
        const produtoRefs = Array.from(retiradaPorProduto.entries()).map(([produtoId, dados]) => ({
          produtoId, ref: doc(db, 'estoque', produtoId), ...dados,
        }));
        const produtoSnaps = await Promise.all(produtoRefs.map(({ ref }) => transaction.get(ref)));

        // Reverte o estoque -- bloqueia se ja foi vendido/usado mais do que
        // esta nota trouxe (ficaria negativo). Mesma logica de qualquer
        // estorno do sistema: nao deixa o dado ficar inconsistente.
        produtoRefs.forEach(({ ref, quantidadeBase, produtoNome }, index) => {
          const snap = produtoSnaps[index];
          if (!snap.exists()) return;
          const quantidadeAtual = Number(snap.data()?.quantidade || 0);
          const quantidadeDepois = quantidadeAtual - quantidadeBase;
          if (quantidadeDepois < 0) {
            throw new Error(`Não é possível cancelar: o estoque de "${produtoNome}" recebido por esta nota já foi parcial ou totalmente utilizado (disponível: ${quantidadeAtual}, a retirar: ${quantidadeBase}).`);
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

        // Cancela TODAS as parcelas encontradas (uma so, no caso comum) --
        // caixa fisico nao tem saldo guardado em documento (so aparece
        // agregado em relatorio por status 'Paga'), entao cancelar a
        // transacao ja e suficiente ali.
        transacaoSnaps.forEach((snap, index) => {
          if (!snap.exists()) return;
          transaction.update(transacaoRefsExternos[index], {
            status: 'Cancelada',
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Nota Avulsa #${nota.numero} cancelada`),
          });
        });

        // Devolve o saldo de cada banco que recebeu debito -- simetrico ao
        // debito feito no lancamento (ou na baixa manual em Contas a Pagar).
        bancoRefsComCredito.forEach(({ ref, valorCentavos }, index) => {
          const snap = bancoSnaps[index];
          if (!snap.exists()) return;
          const saldoAtualCentavos = Number(snap.data().saldoCentavos || 0);
          transaction.update(ref, {
            saldoCentavos: saldoAtualCentavos + valorCentavos,
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Cancelamento da Nota Avulsa #${nota.numero}`),
          });
        });
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
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                        <button
                          onClick={() => openTab(`/estoque/etiquetas?notaAvulsaId=${n.id}`, 'Etiquetas')}
                          className="icon-btn"
                          title="Gerar etiquetas dos produtos desta nota"
                        >
                          <Barcode size={18} />
                        </button>
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
                      </div>
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
