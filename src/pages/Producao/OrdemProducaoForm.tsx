import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Factory, Loader2, Play, Pause, CheckCircle2, XCircle, RotateCcw, Package } from 'lucide-react';
import { collection, doc, getDoc, getDocs, updateDoc, serverTimestamp, query, where, runTransaction } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { reserveTenantSequence, formatSequenceValue, getCurrentMaxSequence } from '../../utils/firestoreAtomic';

type StatusOrdem = 'criada' | 'em_producao' | 'pausada' | 'finalizada' | 'cancelada';

interface ItemConsumido {
  materiaPrimaId: string;
  materiaPrimaNome: string;
  unidade: string;
  quantidadeConsumida: number;
}

interface OrdemData {
  numero: string;
  produtoId: string;
  produtoNome: string;
  quantidadePlanejada: number;
  quantidadeProduzida: number | null;
  status: StatusOrdem;
  responsavelId: string;
  responsavelNome: string;
  observacoes: string;
  itensConsumidos: ItemConsumido[];
}

interface OpcaoSimples { id: string; nome: string; }

const STATUS_LABELS: Record<StatusOrdem, string> = {
  criada: 'Criada',
  em_producao: 'Em Produção',
  pausada: 'Pausada',
  finalizada: 'Finalizada',
  cancelada: 'Cancelada',
};

const STATUS_COLORS: Record<StatusOrdem, string> = {
  criada: '#3b82f6',
  em_producao: '#8b5cf6',
  pausada: '#f59e0b',
  finalizada: '#10b981',
  cancelada: '#ef4444',
};

const inputStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-tertiary)',
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-md)',
  padding: '12px 16px',
  color: 'var(--text-primary)',
  width: '100%'
};

const OrdemProducaoForm: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = !!id;
  const { currentUser, tenantId } = useAuth();

  const [isFetching, setIsFetching] = useState(isEditing);
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const [produtosDisponiveis, setProdutosDisponiveis] = useState<OpcaoSimples[]>([]);
  const [usuariosDisponiveis, setUsuariosDisponiveis] = useState<OpcaoSimples[]>([]);
  const [ordem, setOrdem] = useState<OrdemData | null>(null);

  const [formData, setFormData] = useState({
    produtoId: '',
    produtoNome: '',
    quantidadePlanejada: '1',
    responsavelId: '',
    responsavelNome: '',
    observacoes: '',
  });

  useEffect(() => {
    const fetchDados = async () => {
      if (!tenantId) return;
      try {
        const qProdutos = query(collection(db, 'estoque'), where('tenantId', '==', tenantId));
        const snapProdutos = await getDocs(qProdutos);
        const produtos: OpcaoSimples[] = [];
        snapProdutos.forEach(d => produtos.push({ id: d.id, nome: d.data().nome || '' }));
        produtos.sort((a, b) => a.nome.localeCompare(b.nome));
        setProdutosDisponiveis(produtos);

        const qUsuarios = query(collection(db, 'usuarios'), where('tenantId', '==', tenantId));
        const snapUsuarios = await getDocs(qUsuarios);
        const usuarios: OpcaoSimples[] = [];
        snapUsuarios.forEach(d => usuarios.push({ id: d.id, nome: d.data().nome || d.data().nomeResponsavel || 'Usuário' }));
        setUsuariosDisponiveis(usuarios);

        if (isEditing && id) {
          const docSnap = await getDoc(doc(db, 'ordens_producao', id));
          if (docSnap.exists()) {
            const data = docSnap.data();
            setOrdem({
              numero: data.numero || '',
              produtoId: data.produtoId || '',
              produtoNome: data.produtoNome || '',
              quantidadePlanejada: Number(data.quantidadePlanejada || 0),
              quantidadeProduzida: data.quantidadeProduzida ?? null,
              status: data.status || 'criada',
              responsavelId: data.responsavelId || '',
              responsavelNome: data.responsavelNome || '',
              observacoes: data.observacoes || '',
              itensConsumidos: Array.isArray(data.itensConsumidos) ? data.itensConsumidos : [],
            });
          }
        } else if (currentUser) {
          const usuarioAtual = usuarios.find(u => u.id === currentUser.uid);
          setFormData(prev => ({
            ...prev,
            responsavelId: currentUser.uid,
            responsavelNome: usuarioAtual?.nome || currentUser.email?.split('@')[0] || 'Usuário',
          }));
        }
      } catch (error) {
        console.error('Erro ao carregar dados:', error);
        showError('Erro ao carregar', 'Não foi possível carregar os dados da ordem de produção.');
      } finally {
        setIsFetching(false);
      }
    };
    fetchDados();
  }, [id, isEditing, tenantId, currentUser]);

  const handleCriar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.produtoId) {
      showError('Selecione um produto', 'Escolha qual produto será fabricado nesta ordem.');
      return;
    }
    const quantidadeNum = Number(formData.quantidadePlanejada);
    if (!Number.isFinite(quantidadeNum) || quantidadeNum <= 0) {
      showError('Quantidade inválida', 'Informe uma quantidade planejada maior que zero.');
      return;
    }
    if (!currentUser || !tenantId) return;

    setIsLoading(true);
    try {
      const currentMax = await getCurrentMaxSequence(db, 'ordens_producao', tenantId, 'numero').catch(() => 0);
      let novoId = '';

      await runTransaction(db, async (transaction) => {
        const nextNum = await reserveTenantSequence(transaction, db, tenantId, 'ordens_producao', currentMax);
        const numero = formatSequenceValue(nextNum, 4);
        const ordemRef = doc(collection(db, 'ordens_producao'));
        novoId = ordemRef.id;

        transaction.set(ordemRef, {
          numero,
          produtoId: formData.produtoId,
          produtoNome: formData.produtoNome,
          quantidadePlanejada: quantidadeNum,
          quantidadeProduzida: null,
          status: 'criada',
          responsavelId: formData.responsavelId || currentUser.uid,
          responsavelNome: formData.responsavelNome || 'N/A',
          observacoes: formData.observacoes,
          dataInicio: null,
          dataFim: null,
          itensConsumidos: [],
          tenantId,
          createdAt: serverTimestamp(),
          ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
        });
      });

      showSuccess('Ordem de produção criada!');
      navigate(`/producao/ordens/editar/${novoId}`);
    } catch (error) {
      console.error('Erro ao criar ordem de produção:', error);
      showError('Erro ao criar', 'Não foi possível criar a ordem de produção.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleIniciar = async () => {
    if (!id || !currentUser) return;
    setIsProcessing(true);
    try {
      await updateDoc(doc(db, 'ordens_producao', id), {
        status: 'em_producao',
        dataInicio: serverTimestamp(),
        ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Produção iniciada'),
      });
      setOrdem(prev => prev ? { ...prev, status: 'em_producao' } : prev);
      showSuccess('Produção iniciada!');
    } catch (error) {
      console.error('Erro ao iniciar produção:', error);
      showError('Erro', 'Não foi possível iniciar a produção.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePausar = async () => {
    if (!id || !currentUser) return;
    setIsProcessing(true);
    try {
      await updateDoc(doc(db, 'ordens_producao', id), {
        status: 'pausada',
        ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Produção pausada'),
      });
      setOrdem(prev => prev ? { ...prev, status: 'pausada' } : prev);
      showSuccess('Produção pausada.');
    } catch (error) {
      console.error('Erro ao pausar produção:', error);
      showError('Erro', 'Não foi possível pausar a produção.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRetomar = async () => {
    if (!id || !currentUser) return;
    setIsProcessing(true);
    try {
      await updateDoc(doc(db, 'ordens_producao', id), {
        status: 'em_producao',
        ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Produção retomada'),
      });
      setOrdem(prev => prev ? { ...prev, status: 'em_producao' } : prev);
      showSuccess('Produção retomada!');
    } catch (error) {
      console.error('Erro ao retomar produção:', error);
      showError('Erro', 'Não foi possível retomar a produção.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancelar = async () => {
    if (!id || !currentUser) return;
    const confirm = await NexusSwal.fire({
      title: 'Cancelar ordem de produção?',
      text: 'Nenhuma matéria-prima será debitada e nenhum estoque será creditado. Esta ação não pode ser desfeita.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sim, cancelar ordem',
      cancelButtonText: 'Voltar',
    });
    if (!confirm.isConfirmed) return;

    setIsProcessing(true);
    try {
      await updateDoc(doc(db, 'ordens_producao', id), {
        status: 'cancelada',
        ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Ordem cancelada'),
      });
      setOrdem(prev => prev ? { ...prev, status: 'cancelada' } : prev);
      showSuccess('Ordem de produção cancelada.');
    } catch (error) {
      console.error('Erro ao cancelar ordem:', error);
      showError('Erro', 'Não foi possível cancelar a ordem de produção.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFinalizar = async () => {
    if (!id || !tenantId || !currentUser || !ordem) return;

    const confirm = await NexusSwal.fire({
      title: 'Finalizar produção?',
      text: `Isso vai debitar as matérias-primas da composição de "${ordem.produtoNome}" e creditar ${ordem.quantidadePlanejada} unidade(s) no estoque.`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sim, finalizar',
      cancelButtonText: 'Voltar',
    });
    if (!confirm.isConfirmed) return;

    setIsProcessing(true);
    try {
      const composicaoSnap = await getDoc(doc(db, 'produtos_composicao', ordem.produtoId));
      const itensComposicao = composicaoSnap.exists() && Array.isArray(composicaoSnap.data().itens) ? composicaoSnap.data().itens : [];
      if (itensComposicao.length === 0) {
        showError('Sem composição cadastrada', 'Este produto não tem composição de matéria-prima cadastrada. Defina a composição em Estoque → editar produto → aba "Composição" antes de finalizar.');
        return;
      }

      let itensConsumidosFinal: ItemConsumido[] = [];

      await runTransaction(db, async (transaction) => {
        const ordemRef = doc(db, 'ordens_producao', id);
        const materiaPrimaRefs = itensComposicao.map((item: any) => doc(db, 'materias_primas', item.materiaPrimaId));
        const materiaPrimaSnaps = await Promise.all(materiaPrimaRefs.map((ref: ReturnType<typeof doc>) => transaction.get(ref)));
        const produtoRef = doc(db, 'estoque', ordem.produtoId);
        const produtoSnap = await transaction.get(produtoRef);

        const itensConsumidos: ItemConsumido[] = [];
        for (let i = 0; i < itensComposicao.length; i++) {
          const itemComposicao = itensComposicao[i];
          const snap = materiaPrimaSnaps[i];
          if (!snap.exists()) {
            throw new Error(`Matéria-prima "${itemComposicao.materiaPrimaNome}" não foi encontrada (pode ter sido excluída).`);
          }
          const quantidadeNecessaria = Number(itemComposicao.quantidade || 0) * ordem.quantidadePlanejada;
          const quantidadeAtual = Number(snap.data().quantidade || 0);
          if (quantidadeAtual < quantidadeNecessaria) {
            throw new Error(`Estoque insuficiente de "${itemComposicao.materiaPrimaNome}". Necessário: ${quantidadeNecessaria} ${itemComposicao.unidade}, disponível: ${quantidadeAtual} ${itemComposicao.unidade}.`);
          }
          transaction.update(materiaPrimaRefs[i], {
            quantidade: quantidadeAtual - quantidadeNecessaria,
            updatedAt: serverTimestamp(),
          });
          itensConsumidos.push({
            materiaPrimaId: itemComposicao.materiaPrimaId,
            materiaPrimaNome: itemComposicao.materiaPrimaNome,
            unidade: itemComposicao.unidade,
            quantidadeConsumida: quantidadeNecessaria,
          });
        }

        if (produtoSnap.exists()) {
          const quantidadeProdutoAtual = Number(produtoSnap.data().quantidade || 0);
          transaction.update(produtoRef, {
            quantidade: quantidadeProdutoAtual + ordem.quantidadePlanejada,
            updatedAt: serverTimestamp(),
          });
        }

        transaction.update(ordemRef, {
          status: 'finalizada',
          quantidadeProduzida: ordem.quantidadePlanejada,
          itensConsumidos,
          dataFim: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Ordem finalizada'),
        });

        itensConsumidosFinal = itensConsumidos;
      });

      setOrdem(prev => prev ? {
        ...prev,
        status: 'finalizada',
        quantidadeProduzida: prev.quantidadePlanejada,
        itensConsumidos: itensConsumidosFinal,
      } : prev);
      showSuccess('Produção finalizada! Matéria-prima debitada e estoque do produto atualizado.');
    } catch (error) {
      console.error('Erro ao finalizar produção:', error);
      showError('Erro ao finalizar', (error as Error).message || 'Não foi possível finalizar a produção.');
    } finally {
      setIsProcessing(false);
    }
  };

  if (isFetching) return <div style={{ padding: '40px', color: 'var(--text-primary)' }}>Carregando...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="icon-btn" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }} onClick={() => navigate('/producao/ordens')}>
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0' }}>
              {isEditing ? `Ordem de Produção ${ordem?.numero || ''}` : 'Nova Ordem de Produção'}
            </h1>
            <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>
              {isEditing ? 'Acompanhe e gerencie o andamento da produção' : 'Entrada de matéria-prima → Estoque → Ordem de Produção'}
            </p>
          </div>
        </div>
        {!isEditing && (
          <button
            className="btn-primary"
            onClick={handleCriar}
            disabled={isLoading}
            style={{ opacity: isLoading ? 0.7 : 1, display: 'flex', alignItems: 'center' }}
          >
            {isLoading ? <Loader2 size={18} className="spin-icon" style={{ marginRight: 8 }} /> : <Save size={18} style={{ marginRight: 8 }} />}
            {isLoading ? 'Criando...' : 'Criar Ordem'}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '800px' }}>
        {isEditing && ordem && (
          <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ padding: '6px 14px', borderRadius: '20px', fontSize: '13px', fontWeight: 700, color: '#fff', backgroundColor: STATUS_COLORS[ordem.status] }}>
                {STATUS_LABELS[ordem.status]}
              </span>
              <div style={{ display: 'flex', gap: '10px' }}>
                {ordem.status === 'criada' && (
                  <button type="button" className="btn-primary" disabled={isProcessing} onClick={handleIniciar} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Play size={16} /> Iniciar Produção
                  </button>
                )}
                {ordem.status === 'em_producao' && (
                  <>
                    <button type="button" className="btn-secondary" disabled={isProcessing} onClick={handlePausar} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Pause size={16} /> Pausar
                    </button>
                    <button type="button" className="btn-primary" disabled={isProcessing} onClick={handleFinalizar} style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#10b981', borderColor: '#10b981' }}>
                      <CheckCircle2 size={16} /> Finalizar Produção
                    </button>
                  </>
                )}
                {ordem.status === 'pausada' && (
                  <button type="button" className="btn-primary" disabled={isProcessing} onClick={handleRetomar} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <RotateCcw size={16} /> Retomar
                  </button>
                )}
                {['criada', 'em_producao', 'pausada'].includes(ordem.status) && (
                  <button type="button" className="icon-btn" style={{ color: '#ef4444' }} title="Cancelar ordem" disabled={isProcessing} onClick={handleCancelar}>
                    <XCircle size={18} />
                  </button>
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Produto</label>
                <strong style={{ color: 'var(--text-primary)' }}>{ordem.produtoNome}</strong>
              </div>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Quantidade Planejada</label>
                <strong style={{ color: 'var(--text-primary)' }}>{ordem.quantidadePlanejada}</strong>
              </div>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Responsável</label>
                <strong style={{ color: 'var(--text-primary)' }}>{ordem.responsavelNome}</strong>
              </div>
              {ordem.quantidadeProduzida !== null && (
                <div>
                  <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Quantidade Produzida</label>
                  <strong style={{ color: '#10b981' }}>{ordem.quantidadeProduzida}</strong>
                </div>
              )}
            </div>

            {ordem.observacoes && (
              <div>
                <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Observações</label>
                <p style={{ margin: 0, color: 'var(--text-primary)' }}>{ordem.observacoes}</p>
              </div>
            )}

            {ordem.status === 'finalizada' && ordem.itensConsumidos.length > 0 && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', marginBottom: '12px' }}>
                  <Package size={18} color="var(--accent-purple)" />
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Matéria-prima consumida</h3>
                </div>
                <div className="table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Matéria-Prima</th>
                        <th>Quantidade consumida</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ordem.itensConsumidos.map(item => (
                        <tr key={item.materiaPrimaId}>
                          <td>{item.materiaPrimaNome}</td>
                          <td>{item.quantidadeConsumida} {item.unidade}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {!isEditing && (
          <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)' }}>
              <Factory size={20} style={{ color: 'var(--accent-purple)' }} />
              <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Dados da Ordem</h3>
            </div>

            <div className="input-group">
              <label>Produto a Fabricar *</label>
              <select
                value={formData.produtoId}
                onChange={(e) => {
                  const produto = produtosDisponiveis.find(p => p.id === e.target.value);
                  setFormData({ ...formData, produtoId: e.target.value, produtoNome: produto?.nome || '' });
                }}
                style={inputStyle}
              >
                <option value="">Selecione...</option>
                {produtosDisponiveis.map(produto => (
                  <option key={produto.id} value={produto.id}>{produto.nome}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div className="input-group">
                <label>Quantidade Planejada</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={formData.quantidadePlanejada}
                  onChange={(e) => setFormData({ ...formData, quantidadePlanejada: e.target.value })}
                  style={inputStyle}
                />
              </div>
              <div className="input-group">
                <label>Responsável</label>
                <select
                  value={formData.responsavelId}
                  onChange={(e) => {
                    const usuario = usuariosDisponiveis.find(u => u.id === e.target.value);
                    setFormData({ ...formData, responsavelId: e.target.value, responsavelNome: usuario?.nome || '' });
                  }}
                  style={inputStyle}
                >
                  <option value="">Selecione...</option>
                  {usuariosDisponiveis.map(usuario => (
                    <option key={usuario.id} value={usuario.id}>{usuario.nome}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="input-group">
              <label>Observações</label>
              <textarea
                value={formData.observacoes}
                onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
                rows={3}
                style={{ ...inputStyle, resize: 'vertical' as const }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OrdemProducaoForm;
