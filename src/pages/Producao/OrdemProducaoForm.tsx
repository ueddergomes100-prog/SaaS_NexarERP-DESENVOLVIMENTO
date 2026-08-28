import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Factory, Loader2, Play, Pause, CheckCircle2, XCircle, RotateCcw, Package, Trash2, Undo2 } from 'lucide-react';
import { collection, doc, deleteDoc, getDoc, getDocs, updateDoc, serverTimestamp, query, where, runTransaction } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError, confirmDelete, NexusSwal } from '../../utils/alerts';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { reserveTenantSequence, formatSequenceValue, getCurrentMaxSequence } from '../../utils/firestoreAtomic';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { isPlatformAdminRole } from '../../utils/roles';
import { isRegistroDeVendedor } from '../../utils/vendedorCadastroDomain';

type StatusOrdem = 'criada' | 'em_producao' | 'pausada' | 'finalizada' | 'cancelada' | 'estornada';

interface ItemConsumido {
  materiaPrimaId: string;
  materiaPrimaNome: string;
  unidade: string;
  quantidadeNecessaria: number;
  perdaExtra: number;
  sobra: number;
  quantidadeConsumida: number;
}

interface ItemComposicaoPreview {
  materiaPrimaId: string;
  materiaPrimaNome: string;
  unidade: string;
  quantidadePorUnidade: number;
  perdaExtra: string;
  sobra: string;
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
  dataInicio: any;
  dataFim: any;
  dataEstorno: any;
}

/** Formata um Timestamp do Firestore (ou um Date "otimista" gravado
 * localmente logo apos a acao, antes do refetch) como data+hora no
 * relogio do sistema. Retorna null se ainda nao aconteceu. */
const formatDateTime = (value: any): string | null => {
  const date = value?.toDate ? value.toDate() : value instanceof Date ? value : null;
  return date ? date.toLocaleString('pt-BR') : null;
};

interface OpcaoSimples { id: string; nome: string; }

const STATUS_LABELS: Record<StatusOrdem, string> = {
  criada: 'Criada',
  em_producao: 'Em Produção',
  pausada: 'Pausada',
  finalizada: 'Finalizada',
  cancelada: 'Cancelada',
  estornada: 'Estornada',
};

const STATUS_COLORS: Record<StatusOrdem, string> = {
  criada: '#3b82f6',
  em_producao: '#8b5cf6',
  pausada: '#f59e0b',
  finalizada: '#10b981',
  cancelada: '#ef4444',
  estornada: '#64748b',
};

/** Status que ainda nao tocaram estoque -- excluir e so apagar o documento,
 * sem nenhuma reversao necessaria. */
const STATUS_EXCLUIVEL: StatusOrdem[] = ['criada', 'em_producao', 'pausada', 'cancelada'];

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
  const { currentUser, tenantId, userRole, userPermissions, isOwner } = useAuth();
  const canManageProducao = isOwner || isPlatformAdminRole(userRole) || (userPermissions && userPermissions.includes('operacoes.producao'));

  const [isFetching, setIsFetching] = useState(isEditing);
  // Decoupled de isFetching (que so controla o spinner de tela cheia, e
  // no modo "nova ordem" ja comeca `false` mesmo com a busca assincrona
  // do responsavel padrao em andamento) -- marca quando o carregamento
  // inicial de verdade terminou.
  const [formReady, setFormReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const [produtosDisponiveis, setProdutosDisponiveis] = useState<OpcaoSimples[]>([]);
  const [usuariosDisponiveis, setUsuariosDisponiveis] = useState<OpcaoSimples[]>([]);
  const [ordem, setOrdem] = useState<OrdemData | null>(null);

  // Conferencia antes de finalizar (perdas/producao parcial): abre com a
  // composicao carregada, deixa revisar a quantidade produzida e lancar
  // perda extra por materia-prima antes de aplicar o debito de verdade.
  const [isLoadingRevisao, setIsLoadingRevisao] = useState(false);
  const [showRevisaoFinalizacao, setShowRevisaoFinalizacao] = useState(false);
  const [quantidadeProduzidaInput, setQuantidadeProduzidaInput] = useState('');
  const [composicaoPreview, setComposicaoPreview] = useState<ItemComposicaoPreview[]>([]);

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
        // Fora vendedor de balcao: ele nao entra no sistema, entao nao pode
        // ser responsavel por ordem de producao.
        snapUsuarios.forEach(d => {
          if (isRegistroDeVendedor(d.data())) return;
          usuarios.push({ id: d.id, nome: d.data().nome || d.data().nomeResponsavel || 'Usuário' });
        });
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
              dataInicio: data.dataInicio || null,
              dataFim: data.dataFim || null,
              dataEstorno: data.dataEstorno || null,
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
        setFormReady(true);
      }
    };
    fetchDados();
  }, [id, isEditing, tenantId, currentUser]);

  // Snapshot dos campos de negocio pre-criacao, reaproveitado tanto pro
  // snapshot inicial quanto pro atual (evita falso-positivo por ordem de
  // chave diferente no JSON.stringify). So faz sentido enquanto !isEditing
  // -- depois de criada, a tela nao tem mais campo de texto livre, so
  // botoes de acao (ver isDirty abaixo).
  const buildDirtySnapshot = () => JSON.stringify(formData);
  const initialSnapshotRef = useRef<string | null>(null);
  const [isFormDirty, setIsFormDirty] = useState(false);
  useEffect(() => {
    if (!formReady) return;
    if (initialSnapshotRef.current === null) {
      initialSnapshotRef.current = buildDirtySnapshot();
      setIsFormDirty(false);
    } else {
      setIsFormDirty(buildDirtySnapshot() !== initialSnapshotRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formReady, formData]);

  // Duas fases: antes de criar, "sujo" e o formulario ter mudado desde o
  // carregamento; depois de criada, a unica forma de trabalho nao salvo
  // e a conferencia de finalizacao aberta (perda/sobra digitadas ali
  // ainda nao foram confirmadas) -- fechar a aba nesse momento tambem
  // deve perguntar, por isso nao da pra so desligar o guard em edicao.
  const isDirty = !isEditing ? isFormDirty : showRevisaoFinalizacao;

  const handleCriar = async (): Promise<boolean> => {
    if (!formData.produtoId) {
      showError('Selecione um produto', 'Escolha qual produto será fabricado nesta ordem.');
      return false;
    }
    const quantidadeNum = Number(formData.quantidadePlanejada);
    if (!Number.isFinite(quantidadeNum) || quantidadeNum <= 0) {
      showError('Quantidade inválida', 'Informe uma quantidade planejada maior que zero.');
      return false;
    }
    if (!currentUser || !tenantId) return false;

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
      initialSnapshotRef.current = buildDirtySnapshot();
      setIsFormDirty(false);
      navigate(`/producao/ordens/editar/${novoId}`);
      return true;
    } catch (error) {
      console.error('Erro ao criar ordem de produção:', error);
      showError('Erro ao criar', 'Não foi possível criar a ordem de produção.');
      return false;
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
      setOrdem(prev => prev ? { ...prev, status: 'em_producao', dataInicio: new Date() } : prev);
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
    if (!canManageProducao) {
      showError('Acesso negado', 'Você não tem permissão para cancelar ordens de produção.');
      return;
    }
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
      try {
        const { createAuditLog } = await import('../../services/logService');
        createAuditLog({
          tenantId: tenantId || '',
          usuarioId: currentUser.uid,
          usuarioEmail: currentUser.email || currentUser.uid,
          modulo: 'producao',
          acao: 'cancelamento',
          descricao: `Ordem de produção ${ordem?.numero || id} cancelada.`,
          registroRelacionadoId: id,
          status: 'sucesso',
          critical: true,
        });
      } catch (logError) {
        console.error('Erro ao registrar log de cancelamento da ordem:', logError);
      }
      showSuccess('Ordem de produção cancelada.');
    } catch (error) {
      console.error('Erro ao cancelar ordem:', error);
      showError('Erro', 'Não foi possível cancelar a ordem de produção.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Exclusao definitiva -- so permitida pra status que nunca tocaram
  // estoque (STATUS_EXCLUIVEL), entao nao ha nada pra reverter.
  const handleExcluir = async () => {
    if (!id || !ordem) return;
    if (!canManageProducao) {
      showError('Acesso negado', 'Você não tem permissão para excluir ordens de produção.');
      return;
    }
    const isConfirmed = await confirmDelete(`a ordem de produção ${ordem.numero}`);
    if (!isConfirmed) return;

    setIsProcessing(true);
    try {
      await deleteDoc(doc(db, 'ordens_producao', id));
      try {
        const { createAuditLog } = await import('../../services/logService');
        createAuditLog({
          tenantId: tenantId || '',
          usuarioId: currentUser?.uid || '',
          usuarioEmail: currentUser?.email || '',
          modulo: 'producao',
          acao: 'exclusao',
          descricao: `Ordem de produção ${ordem.numero} excluída permanentemente.`,
          registroRelacionadoId: id,
          status: 'sucesso',
          critical: true,
        });
      } catch {
        // ignore audit log error
      }
      showSuccess('Ordem de produção excluída!');
      navigate('/producao/ordens');
    } catch (error) {
      console.error('Erro ao excluir ordem de produção:', error);
      showError('Erro ao excluir', 'Tente novamente mais tarde.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Estorno de uma ordem ja finalizada -- devolve a materia-prima
  // debitada, retira a quantidade creditada no produto acabado, e marca
  // a ordem como 'estornada' (mantem o registro, nao apaga -- mesmo
  // padrao do cancelamento de OS/venda ja usado no sistema).
  const handleEstornar = async () => {
    if (!id || !tenantId || !currentUser || !ordem) return;
    if (!canManageProducao) {
      showError('Acesso negado', 'Você não tem permissão para estornar ordens de produção.');
      return;
    }
    const confirm = await NexusSwal.fire({
      title: 'Estornar produção?',
      text: `A matéria-prima debitada será devolvida ao estoque e ${ordem.quantidadeProduzida} unidade(s) de "${ordem.produtoNome}" serão retiradas do estoque de produtos. O registro da ordem é mantido, com status "Estornada". Esta ação não pode ser desfeita.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sim, estornar produção',
      cancelButtonText: 'Voltar',
    });
    if (!confirm.isConfirmed) return;

    setIsProcessing(true);
    try {
      await runTransaction(db, async (transaction) => {
        const ordemRef = doc(db, 'ordens_producao', id);
        const produtoRef = doc(db, 'estoque', ordem.produtoId);
        const materiaPrimaRefs = ordem.itensConsumidos.map(item => doc(db, 'materias_primas', item.materiaPrimaId));

        const produtoSnap = await transaction.get(produtoRef);
        const materiaPrimaSnaps = await Promise.all(materiaPrimaRefs.map((ref) => transaction.get(ref)));

        const quantidadeProduzida = ordem.quantidadeProduzida || 0;
        if (produtoSnap.exists()) {
          const quantidadeProdutoAtual = Number(produtoSnap.data().quantidade || 0);
          if (quantidadeProdutoAtual < quantidadeProduzida) {
            throw new Error(`Não é possível estornar: parte das ${quantidadeProduzida} unidades produzidas de "${ordem.produtoNome}" já saiu do estoque (venda ou outro movimento). Estoque atual: ${quantidadeProdutoAtual}.`);
          }
          transaction.update(produtoRef, {
            quantidade: quantidadeProdutoAtual - quantidadeProduzida,
            updatedAt: serverTimestamp(),
          });
        }

        for (let i = 0; i < ordem.itensConsumidos.length; i++) {
          const item = ordem.itensConsumidos[i];
          const snap = materiaPrimaSnaps[i];
          if (!snap.exists()) continue; // materia-prima pode ter sido excluida desde a finalizacao
          const quantidadeAtual = Number(snap.data().quantidade || 0);
          transaction.update(materiaPrimaRefs[i], {
            quantidade: quantidadeAtual + item.quantidadeConsumida,
            updatedAt: serverTimestamp(),
          });
        }

        transaction.update(ordemRef, {
          status: 'estornada',
          dataEstorno: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Ordem estornada'),
        });
      });

      setOrdem(prev => prev ? { ...prev, status: 'estornada', dataEstorno: new Date() } : prev);
      try {
        const { createAuditLog } = await import('../../services/logService');
        createAuditLog({
          tenantId,
          usuarioId: currentUser.uid,
          usuarioEmail: currentUser.email || currentUser.uid,
          modulo: 'producao',
          acao: 'estorno',
          descricao: `Ordem de produção ${ordem.numero} estornada.`,
          registroRelacionadoId: id,
          status: 'sucesso',
          critical: true,
        });
      } catch (logError) {
        console.error('Erro ao registrar log de estorno da ordem:', logError);
      }
      showSuccess('Produção estornada! Matéria-prima devolvida e estoque do produto atualizado.');
    } catch (error) {
      console.error('Erro ao estornar produção:', error);
      showError('Erro ao estornar', (error as Error).message || 'Não foi possível estornar a produção.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Passo 1: carrega a composicao atual do produto e abre a tela de
  // conferencia -- nada e gravado ainda aqui.
  const handleAbrirRevisaoFinalizacao = async () => {
    if (!ordem) return;
    setIsLoadingRevisao(true);
    try {
      const composicaoSnap = await getDoc(doc(db, 'produtos_composicao', ordem.produtoId));
      const itensComposicao = composicaoSnap.exists() && Array.isArray(composicaoSnap.data().itens) ? composicaoSnap.data().itens : [];
      if (itensComposicao.length === 0) {
        showError('Sem composição cadastrada', 'Este produto não tem composição de matéria-prima cadastrada. Defina a composição em Estoque → editar produto → aba "Composição" antes de finalizar.');
        return;
      }

      setComposicaoPreview(itensComposicao.map((item: any) => ({
        materiaPrimaId: item.materiaPrimaId,
        materiaPrimaNome: item.materiaPrimaNome,
        unidade: item.unidade,
        quantidadePorUnidade: Number(item.quantidade || 0),
        perdaExtra: '0',
        sobra: '0',
      })));
      setQuantidadeProduzidaInput(String(ordem.quantidadePlanejada));
      setShowRevisaoFinalizacao(true);
    } catch (error) {
      console.error('Erro ao carregar composição:', error);
      showError('Erro ao carregar', 'Não foi possível carregar a composição deste produto.');
    } finally {
      setIsLoadingRevisao(false);
    }
  };

  const handleAlterarPerdaExtra = (materiaPrimaId: string, valor: string) => {
    setComposicaoPreview(prev => prev.map(item => (
      item.materiaPrimaId === materiaPrimaId ? { ...item, perdaExtra: valor } : item
    )));
  };

  const handleAlterarSobra = (materiaPrimaId: string, valor: string) => {
    setComposicaoPreview(prev => prev.map(item => (
      item.materiaPrimaId === materiaPrimaId ? { ...item, sobra: valor } : item
    )));
  };

  // Passo 2: aplica o debito de verdade, com a quantidade produzida (nao
  // a planejada) e a perda extra revisadas na tela de conferencia.
  const handleConfirmarFinalizacao = async (): Promise<boolean> => {
    if (!id || !tenantId || !currentUser || !ordem) return false;

    const quantidadeProduzida = Number(quantidadeProduzidaInput);
    if (!Number.isFinite(quantidadeProduzida) || quantidadeProduzida <= 0) {
      showError('Quantidade inválida', 'Informe a quantidade produzida (maior que zero).');
      return false;
    }

    setIsProcessing(true);
    try {
      let itensConsumidosFinal: ItemConsumido[] = [];

      await runTransaction(db, async (transaction) => {
        const ordemRef = doc(db, 'ordens_producao', id);
        const materiaPrimaRefs = composicaoPreview.map(item => doc(db, 'materias_primas', item.materiaPrimaId));
        const materiaPrimaSnaps = await Promise.all(materiaPrimaRefs.map((ref) => transaction.get(ref)));
        const produtoRef = doc(db, 'estoque', ordem.produtoId);
        const produtoSnap = await transaction.get(produtoRef);

        const itensConsumidos: ItemConsumido[] = [];
        for (let i = 0; i < composicaoPreview.length; i++) {
          const itemPreview = composicaoPreview[i];
          const snap = materiaPrimaSnaps[i];
          if (!snap.exists()) {
            throw new Error(`Matéria-prima "${itemPreview.materiaPrimaNome}" não foi encontrada (pode ter sido excluída).`);
          }
          const quantidadeNecessaria = itemPreview.quantidadePorUnidade * quantidadeProduzida;
          const perdaExtra = Math.max(0, Number(itemPreview.perdaExtra) || 0);
          const sobra = Math.max(0, Number(itemPreview.sobra) || 0);
          const quantidadeConsumida = quantidadeNecessaria + perdaExtra - sobra;
          if (quantidadeConsumida < 0) {
            throw new Error(`Sobra informada para "${itemPreview.materiaPrimaNome}" é maior do que o necessário + perda extra (não é possível devolver mais do que foi retirado do estoque).`);
          }
          const quantidadeAtual = Number(snap.data().quantidade || 0);
          if (quantidadeAtual < quantidadeConsumida) {
            throw new Error(`Estoque insuficiente de "${itemPreview.materiaPrimaNome}". Necessário: ${quantidadeConsumida} ${itemPreview.unidade}, disponível: ${quantidadeAtual} ${itemPreview.unidade}.`);
          }
          transaction.update(materiaPrimaRefs[i], {
            quantidade: quantidadeAtual - quantidadeConsumida,
            updatedAt: serverTimestamp(),
          });
          itensConsumidos.push({
            materiaPrimaId: itemPreview.materiaPrimaId,
            materiaPrimaNome: itemPreview.materiaPrimaNome,
            unidade: itemPreview.unidade,
            quantidadeNecessaria,
            perdaExtra,
            sobra,
            quantidadeConsumida,
          });
        }

        if (produtoSnap.exists()) {
          const quantidadeProdutoAtual = Number(produtoSnap.data().quantidade || 0);
          transaction.update(produtoRef, {
            quantidade: quantidadeProdutoAtual + quantidadeProduzida,
            updatedAt: serverTimestamp(),
          });
        }

        transaction.update(ordemRef, {
          status: 'finalizada',
          quantidadeProduzida,
          itensConsumidos,
          dataFim: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Ordem finalizada'),
        });

        itensConsumidosFinal = itensConsumidos;
      });

      setOrdem(prev => prev ? {
        ...prev,
        status: 'finalizada',
        quantidadeProduzida,
        itensConsumidos: itensConsumidosFinal,
        dataFim: new Date(),
      } : prev);
      setShowRevisaoFinalizacao(false);
      showSuccess('Produção finalizada! Matéria-prima debitada e estoque do produto atualizado.');
      return true;
    } catch (error) {
      console.error('Erro ao finalizar produção:', error);
      showError('Erro ao finalizar', (error as Error).message || 'Não foi possível finalizar a produção.');
      return false;
    } finally {
      setIsProcessing(false);
    }
  };

  /** Escolhe qual dos dois fluxos de salvar chamar, dependendo da fase
   * atual (ver isDirty acima) -- e o que useUnsavedChangesGuard chama ao
   * usuario escolher "Salvar e fechar" na hora de fechar a aba. */
  const saveForGuard = (): Promise<boolean> => (
    !isEditing ? handleCriar() : handleConfirmarFinalizacao()
  );

  useUnsavedChangesGuard(isDirty, saveForGuard);

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
                    <button type="button" className="btn-primary" disabled={isProcessing || isLoadingRevisao} onClick={handleAbrirRevisaoFinalizacao} style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#10b981', borderColor: '#10b981' }}>
                      {isLoadingRevisao ? <Loader2 size={16} className="spin-icon" /> : <CheckCircle2 size={16} />} Finalizar Produção
                    </button>
                  </>
                )}
                {ordem.status === 'pausada' && (
                  <button type="button" className="btn-primary" disabled={isProcessing} onClick={handleRetomar} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <RotateCcw size={16} /> Retomar
                  </button>
                )}
                {canManageProducao && ['criada', 'em_producao', 'pausada'].includes(ordem.status) && (
                  <button type="button" className="icon-btn" style={{ color: '#ef4444' }} title="Cancelar ordem" disabled={isProcessing} onClick={handleCancelar}>
                    <XCircle size={18} />
                  </button>
                )}
                {canManageProducao && ordem.status === 'finalizada' && (
                  <button type="button" className="btn-secondary" disabled={isProcessing} onClick={handleEstornar} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#f59e0b' }}>
                    <Undo2 size={16} /> Estornar Produção
                  </button>
                )}
                {canManageProducao && STATUS_EXCLUIVEL.includes(ordem.status) && (
                  <button type="button" className="icon-btn" style={{ color: '#ef4444' }} title="Excluir ordem" disabled={isProcessing} onClick={handleExcluir}>
                    <Trash2 size={18} />
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
              {formatDateTime(ordem.dataInicio) && (
                <div>
                  <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Início da Produção</label>
                  <strong style={{ color: 'var(--text-primary)' }}>{formatDateTime(ordem.dataInicio)}</strong>
                </div>
              )}
              {formatDateTime(ordem.dataFim) && (
                <div>
                  <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Término da Produção</label>
                  <strong style={{ color: 'var(--text-primary)' }}>{formatDateTime(ordem.dataFim)}</strong>
                </div>
              )}
              {formatDateTime(ordem.dataEstorno) && (
                <div>
                  <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Estornada em</label>
                  <strong style={{ color: '#64748b' }}>{formatDateTime(ordem.dataEstorno)}</strong>
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
                        <th>Necessário (receita)</th>
                        <th>Perda extra</th>
                        <th>Sobra</th>
                        <th>Total consumido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ordem.itensConsumidos.map(item => (
                        <tr key={item.materiaPrimaId}>
                          <td>{item.materiaPrimaNome}</td>
                          <td>{item.quantidadeNecessaria} {item.unidade}</td>
                          <td>{item.perdaExtra > 0 ? `${item.perdaExtra} ${item.unidade}` : '-'}</td>
                          <td>{item.sobra > 0 ? `${item.sobra} ${item.unidade}` : '-'}</td>
                          <td><strong>{item.quantidadeConsumida} {item.unidade}</strong></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {showRevisaoFinalizacao && (
              <div style={{ padding: '20px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', border: '1px dashed var(--accent-purple)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Package size={18} color="var(--accent-purple)" />
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Conferência antes de finalizar</h3>
                </div>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
                  Confira a quantidade produzida e a matéria-prima que será debitada. Se houve refugo/desperdício além do previsto na receita, informe a perda extra por item; se sobrou material que volta pro estoque, informe a sobra.
                </p>

                <div className="input-group" style={{ maxWidth: '260px' }}>
                  <label>Quantidade Produzida (boas)</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={quantidadeProduzidaInput}
                    onChange={(e) => setQuantidadeProduzidaInput(e.target.value)}
                    style={inputStyle}
                  />
                </div>

                <div className="table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Matéria-Prima</th>
                        <th>Necessário (receita × produzido)</th>
                        <th>Perda extra</th>
                        <th>Sobra</th>
                      </tr>
                    </thead>
                    <tbody>
                      {composicaoPreview.map(item => {
                        const quantidadeProduzidaNum = Number(quantidadeProduzidaInput) || 0;
                        const necessario = item.quantidadePorUnidade * quantidadeProduzidaNum;
                        return (
                          <tr key={item.materiaPrimaId}>
                            <td>{item.materiaPrimaNome}</td>
                            <td>{necessario} {item.unidade}</td>
                            <td style={{ maxWidth: '140px' }}>
                              <input
                                type="number"
                                step="any"
                                min="0"
                                value={item.perdaExtra}
                                onChange={(e) => handleAlterarPerdaExtra(item.materiaPrimaId, e.target.value)}
                                style={{ ...inputStyle, padding: '8px 12px' }}
                              />
                            </td>
                            <td style={{ maxWidth: '140px' }}>
                              <input
                                type="number"
                                step="any"
                                min="0"
                                value={item.sobra}
                                onChange={(e) => handleAlterarSobra(item.materiaPrimaId, e.target.value)}
                                style={{ ...inputStyle, padding: '8px 12px' }}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                  <button type="button" className="btn-secondary" disabled={isProcessing} onClick={() => setShowRevisaoFinalizacao(false)}>
                    Voltar
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={isProcessing}
                    onClick={handleConfirmarFinalizacao}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#10b981', borderColor: '#10b981', opacity: isProcessing ? 0.7 : 1 }}
                  >
                    {isProcessing ? <Loader2 size={16} className="spin-icon" /> : <CheckCircle2 size={16} />}
                    {isProcessing ? 'Finalizando...' : 'Confirmar Finalização'}
                  </button>
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
