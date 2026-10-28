import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Factory, Loader2, Play, Pause, CheckCircle2, XCircle, RotateCcw, Package, Undo2, X } from 'lucide-react';
import { collection, doc, getDoc, getDocs, updateDoc, serverTimestamp, query, where, runTransaction } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { reserveTenantSequence, formatSequenceValue, getCurrentMaxSequence } from '../../utils/firestoreAtomic';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { isPlatformAdminRole } from '../../utils/roles';
import { isRegistroDeVendedor } from '../../utils/vendedorCadastroDomain';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import {
  baixarLotesNaTransacao,
  devolucaoTotalDosLotes,
  devolverAosLotesNaTransacao,
  gravarEntradasEmLotesNaTransacao,
  lotesDaEntradaParaGravar,
  pedirLotesDeEntrada,
  prepararBaixaDeLotes,
  prepararEntradasEmLotes,
  prepararEstornoDeEntradaEmLotes,
  produtosQueControlamLote,
  type EntradaDeLotePreparada,
} from '../../services/loteBaixaService';
import { somarLotesUsados, type PlanoDeLotes } from '../../utils/loteDomain';
import { chaveComponente, colecaoDoComponente, normalizarComponente, type OrigemComponente } from '../../utils/producaoDomain';
import { calcularPesagem, consumoDoComponente, ganhoDePeso, parseTaras, unidadeEmKg, type TaraProducao } from '../../utils/producaoPesagemDomain';
import { salvarTarasNoServidor } from '../../services/producaoService';

type StatusOrdem = 'criada' | 'em_producao' | 'pausada' | 'finalizada' | 'cancelada' | 'estornada';

interface ItemConsumido {
  componenteId: string;
  componenteNome: string;
  origem: OrigemComponente;
  unidade: string;
  quantidadeNecessaria: number;
  perdaExtra: number;
  sobra: number;
  quantidadeConsumida: number;
  /** Consumo digitado ("usada de verdade") em vez da receita (26/10/2026). */
  usadaReal?: boolean;
}

interface ItemComposicaoPreview {
  componenteId: string;
  componenteNome: string;
  origem: OrigemComponente;
  unidade: string;
  quantidadePorUnidade: number;
  perdaExtra: string;
  sobra: string;
  /** "Usada de verdade" (26/10/2026); vazio = receita + perda - sobra. */
  usadaReal: string;
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
  /** Pesagem da producao (26/10/2026), quando foi pesada. */
  pesagem?: PesagemGravada | null;
}

/** O que fica gravado na ordem quando a producao foi pesada. */
interface PesagemGravada {
  pesoBrutoKg: number;
  taras: Array<{ nome: string; quantidade: number; pesoKg: number; totalKg: number }>;
  taraKg: number;
  embalagemKg: number;
  liquidoKg: number;
  pesoUnidadeKg: number;
  unidadesSugeridas: number;
  residuoKg: number;
  refugoUnidades: number;
  refugoMotivo: string;
  materiaPrimaKg: number;
  ganhoKg: number;
  ganhoPercentual: number;
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
  const { currentUser, tenantId, userRole, userPermissions, isOwner, loteModoSaida, loteAvisarVencido } = useAuth();
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

  // Pesagem da producao (26/10/2026, pedido do dono): peso da balanca - caixas
  // (taras) - embalagens = pacotes fechados + residuo. Regra em producaoPesagemDomain.ts.
  const [pesagemAtiva, setPesagemAtiva] = useState(false);
  const [taras, setTaras] = useState<TaraProducao[]>([]);
  const [pesoBruto, setPesoBruto] = useState('');
  const [tarasUsadas, setTarasUsadas] = useState<Record<string, string>>({});
  const [pesoUnidade, setPesoUnidade] = useState('');
  const [pesoEmbalagemUn, setPesoEmbalagemUn] = useState('');
  const [refugoUnidades, setRefugoUnidades] = useState('');
  const [refugoMotivo, setRefugoMotivo] = useState('');
  // A quantidade segue a sugestao da balanca ate' a pessoa digitar a dela (contagem).
  const [quantidadeDigitada, setQuantidadeDigitada] = useState(false);
  const [editandoTaras, setEditandoTaras] = useState(false);
  const [tarasRascunho, setTarasRascunho] = useState<Array<{ id: string; nome: string; pesoKg: string }>>([]);
  const [salvandoTaras, setSalvandoTaras] = useState(false);

  const resultadoPesagem = useMemo(() => calcularPesagem({
    pesoBrutoKg: pesoBruto, tarasUsadas, taras, pesoUnidadeKg: pesoUnidade, pesoEmbalagemKg: pesoEmbalagemUn,
  }), [pesoBruto, tarasUsadas, taras, pesoUnidade, pesoEmbalagemUn]);

  useEffect(() => {
    if (pesagemAtiva && !quantidadeDigitada && !resultadoPesagem.erro) setQuantidadeProduzidaInput(String(resultadoPesagem.unidadesSugeridas));
  }, [pesagemAtiva, quantidadeDigitada, resultadoPesagem]);

  /** Consumo de cada componente com o que esta' na tela (receita ou "usada de verdade"). */
  const consumosDaTela = composicaoPreview.map((item) => {
    const necessario = item.quantidadePorUnidade * (Number(quantidadeProduzidaInput) || 0);
    return { item, necessario, ...consumoDoComponente({ necessario, perdaExtra: item.perdaExtra, sobra: item.sobra, usadaReal: item.usadaReal }) };
  });
  const materiaPrimaKgDaTela = consumosDaTela.filter((c) => unidadeEmKg(c.item.unidade)).reduce((s, c) => s + c.consumo, 0);
  const ganhoDaTela = ganhoDePeso(resultadoPesagem.liquidoKg, materiaPrimaKgDaTela);

  const salvarTaras = async () => {
    const lista = tarasRascunho.filter((t) => t.nome.trim() || t.pesoKg.trim());
    setSalvandoTaras(true);
    try {
      const r = await salvarTarasNoServidor(lista.map((t) => ({ id: t.id, nome: t.nome, pesoKg: t.pesoKg })));
      setTaras(parseTaras(r.taras));
      setEditandoTaras(false);
      showSuccess('Caixas salvas!');
    } catch (erro) {
      showError('Não foi possível salvar as caixas', erro instanceof Error && erro.message ? erro.message : 'Tente de novo em instantes.');
    } finally {
      setSalvandoTaras(false);
    }
  };

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
        snapProdutos.forEach(d => {
          // Produto inativado nao aparece pra escolher em ordem de producao
          // nova -- mesmo criterio das buscas de venda/OS/orcamento (ver
          // src/utils/productSearch.ts). So sem <select> aqui, filtra antes
          // de montar a lista mesmo.
          const dados = d.data();
          if ((dados.ativo ?? dados.statusAtivo ?? true) === false) return;
          produtos.push({ id: d.id, nome: dados.nome || '' });
        });
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
              // Ordem finalizada ANTES da composicao aceitar componente do
              // estoque gravou `materiaPrimaId`/`materiaPrimaNome` sem
              // `origem` -- normalizarComponente le os dois formatos, entao
              // estorno de ordem antiga continua funcionando.
              itensConsumidos: Array.isArray(data.itensConsumidos)
                ? data.itensConsumidos.map((item: any) => {
                  const componente = normalizarComponente(item);
                  return {
                    componenteId: componente.componenteId,
                    componenteNome: componente.componenteNome,
                    origem: componente.origem,
                    unidade: componente.unidade,
                    quantidadeNecessaria: Number(item.quantidadeNecessaria || 0),
                    perdaExtra: Number(item.perdaExtra || 0),
                    sobra: Number(item.sobra || 0),
                    quantidadeConsumida: Number(item.quantidadeConsumida || 0),
                    ...(item.usadaReal === true ? { usadaReal: true } : {}),
                  };
                })
                : [],
              dataInicio: data.dataInicio || null,
              dataFim: data.dataFim || null,
              dataEstorno: data.dataEstorno || null,
              pesagem: data.pesagem && typeof data.pesagem === 'object' ? data.pesagem as PesagemGravada : null,
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
      text: 'Nenhum componente será debitado e nenhum estoque será creditado. Esta ação não pode ser desfeita.',
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

  // Estorno de uma ordem ja finalizada -- devolve os componentes
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
      text: `Os componentes debitados serão devolvidos ao estoque e ${ordem.quantidadeProduzida} unidade(s) de "${ordem.produtoNome}" serão retiradas do estoque de produtos. O registro da ordem é mantido, com status "Estornada". Esta ação não pode ser desfeita.`,
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
        // Devolve cada componente na colecao de onde ele foi debitado.
        const componenteRefs = ordem.itensConsumidos.map(item => doc(db, colecaoDoComponente(item.origem), item.componenteId));

        const produtoSnap = await transaction.get(produtoRef);
        const componenteSnaps = await Promise.all(componenteRefs.map((ref) => transaction.get(ref)));
        // Lote e Validade: o lote que a producao criou precisa ainda ter o saldo (senao parte ja foi vendida).
        const ordemSnapAtual = await transaction.get(ordemRef);
        const retirarLotesProduzidos = await prepararEstornoDeEntradaEmLotes(transaction, db, ordemSnapAtual.data()?.lotesProduzidos, 'a produção');

        const quantidadeProduzida = ordem.quantidadeProduzida || 0;
        retirarLotesProduzidos();
        // Componentes que controlam lote voltam ao MESMO lote de onde a producao tirou.
        devolverAosLotesNaTransacao(transaction, db, devolucaoTotalDosLotes([{ lotes: ordemSnapAtual.data()?.lotesConsumidos }]));
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
          const snap = componenteSnaps[i];
          if (!snap.exists()) continue; // componente pode ter sido excluido desde a finalizacao
          const quantidadeAtual = Number(snap.data().quantidade || 0);
          transaction.update(componenteRefs[i], {
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
      showSuccess('Produção estornada! Componentes devolvidos e estoque do produto atualizado.');
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
        showError('Sem composição cadastrada', 'Este produto não tem composição cadastrada. Defina a composição em Estoque → editar produto → aba "Composição" antes de finalizar.');
        return;
      }

      setComposicaoPreview(itensComposicao.map((item: any) => {
        const componente = normalizarComponente(item);
        return {
          componenteId: componente.componenteId,
          componenteNome: componente.componenteNome,
          origem: componente.origem,
          unidade: componente.unidade,
          quantidadePorUnidade: componente.quantidade,
          perdaExtra: '0',
          sobra: '0',
          usadaReal: '',
        };
      }));
      setQuantidadeProduzidaInput(String(ordem.quantidadePlanejada));
      // Pesagem: pesos do produto e caixas da filial. Liga sozinha quando o produto tem o peso da unidade.
      try {
        const [produtoSnap, configSnap] = await Promise.all([
          getDoc(doc(db, 'estoque', ordem.produtoId)),
          tenantId ? getDoc(doc(db, 'configuracoes', tenantId)) : Promise.resolve(null),
        ]);
        const produto = produtoSnap.exists() ? produtoSnap.data() : {};
        const pesoUn = Number(produto.pesoLiquidoUnitarioKg) || 0;
        setPesoUnidade(pesoUn > 0 ? String(pesoUn) : '');
        setPesoEmbalagemUn(Number(produto.pesoEmbalagemKg) > 0 ? String(produto.pesoEmbalagemKg) : '');
        setTaras(parseTaras(configSnap && configSnap.exists() ? configSnap.data().tarasProducao : []));
        setPesagemAtiva(pesoUn > 0);
      } catch (erroPesos) {
        console.error('Erro ao ler os pesos da produção:', erroPesos);
        setPesagemAtiva(false);
      }
      setPesoBruto('');
      setTarasUsadas({});
      setRefugoUnidades('');
      setRefugoMotivo('');
      setQuantidadeDigitada(false);
      setShowRevisaoFinalizacao(true);
    } catch (error) {
      console.error('Erro ao carregar composição:', error);
      showError('Erro ao carregar', 'Não foi possível carregar a composição deste produto.');
    } finally {
      setIsLoadingRevisao(false);
    }
  };

  const handleAlterarPerdaExtra = (chave: string, valor: string) => {
    setComposicaoPreview(prev => prev.map(item => (
      chaveComponente(item.origem, item.componenteId) === chave ? { ...item, perdaExtra: valor } : item
    )));
  };

  const handleAlterarSobra = (chave: string, valor: string) => {
    setComposicaoPreview(prev => prev.map(item => (
      chaveComponente(item.origem, item.componenteId) === chave ? { ...item, sobra: valor } : item
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
    // Pesagem ligada e incompleta: a pessoa corrige (ou desliga a pesagem) antes de baixar estoque.
    if (pesagemAtiva && resultadoPesagem.erro) {
      showError('Confira a pesagem', resultadoPesagem.erro);
      return false;
    }
    const refugo = Math.max(0, Math.floor(Number(refugoUnidades) || 0));
    if (refugo > 0 && !refugoMotivo.trim()) {
      showError('Motivo do refugo', `Informe por que ${refugo === 1 ? 'a unidade foi perdida' : `as ${refugo} unidades foram perdidas`} (ex.: pacote rasgado, peso errado).`);
      return false;
    }
    const pesagemParaGravar: PesagemGravada | null = pesagemAtiva ? {
      pesoBrutoKg: Number(String(pesoBruto).replace(',', '.')) || 0,
      taras: resultadoPesagem.detalheTaras,
      taraKg: resultadoPesagem.taraKg,
      embalagemKg: resultadoPesagem.embalagemKg,
      liquidoKg: resultadoPesagem.liquidoKg,
      pesoUnidadeKg: Number(String(pesoUnidade).replace(',', '.')) || 0,
      unidadesSugeridas: resultadoPesagem.unidadesSugeridas,
      residuoKg: resultadoPesagem.residuoKg,
      refugoUnidades: refugo,
      refugoMotivo: refugoMotivo.trim().slice(0, 200),
      materiaPrimaKg: Math.round(materiaPrimaKgDaTela * 1000) / 1000,
      ganhoKg: ganhoDaTela.ganhoKg,
      ganhoPercentual: ganhoDaTela.percentual,
    } : null;

    setIsProcessing(true);
    try {
      let itensConsumidosFinal: ItemConsumido[] = [];

      // Lote e Validade (so' produto marcado "Controlar lote"; os demais seguem so' com o estoque):
      // 1) o produto ACABADO que controla lote pede o lote e a validade do que foi produzido;
      // 2) componente do estoque (semiacabado) que controla lote sai do lote pela regra da configuracao.
      let entradasDeLote: EntradaDeLotePreparada[] = [];
      if ((await produtosQueControlamLote(db, [ordem.produtoId])).has(ordem.produtoId)) {
        const informado = await pedirLotesDeEntrada([{ chave: 'produzido', nome: ordem.produtoNome, quantidade: quantidadeProduzida }], 'Lote da produção');
        if (informado === null) return false;
        entradasDeLote = await prepararEntradasEmLotes(db, tenantId, [{
          produtoId: ordem.produtoId,
          lote: informado.produzido.lote,
          validade: informado.produzido.validade,
          quantidade: quantidadeProduzida,
        }]);
      }
      const linhasDosComponentes = composicaoPreview
        .map((item, indice) => ({
          chave: String(indice),
          produtoId: item.origem === 'estoque' ? item.componenteId : '',
          nome: item.componenteNome,
          quantidade: Math.max(0, consumoDoComponente({ necessario: item.quantidadePorUnidade * quantidadeProduzida, perdaExtra: item.perdaExtra, sobra: item.sobra, usadaReal: item.usadaReal }).consumo),
        }))
        .filter((linha) => linha.produtoId && linha.quantidade > 0);
      const planoLotes: PlanoDeLotes | null = await prepararBaixaDeLotes({ db, tenantId, linhas: linhasDosComponentes, modo: loteModoSaida, avisarVencido: loteAvisarVencido });
      if (planoLotes === null) return false;

      await runTransaction(db, async (transaction) => {
        const ordemRef = doc(db, 'ordens_producao', id);
        // Cada componente e' baixado na SUA colecao: matéria-prima em
        // `materias_primas`, semiacabado/granel em `estoque` (as duas
        // guardam o saldo no mesmo campo `quantidade`).
        const componenteRefs = composicaoPreview.map(item => doc(db, colecaoDoComponente(item.origem), item.componenteId));
        const componenteSnaps = await Promise.all(componenteRefs.map((ref) => transaction.get(ref)));
        const produtoRef = doc(db, 'estoque', ordem.produtoId);
        const produtoSnap = await transaction.get(produtoRef);

        const itensConsumidos: ItemConsumido[] = [];
        for (let i = 0; i < composicaoPreview.length; i++) {
          const itemPreview = composicaoPreview[i];
          const snap = componenteSnaps[i];
          if (!snap.exists()) {
            throw new Error(`"${itemPreview.componenteNome}" não foi encontrado no cadastro (pode ter sido excluído). Revise a composição em Estoque → editar produto → aba "Composição".`);
          }
          const quantidadeNecessaria = itemPreview.quantidadePorUnidade * quantidadeProduzida;
          const perdaExtra = Math.max(0, Number(itemPreview.perdaExtra) || 0);
          const sobra = Math.max(0, Number(itemPreview.sobra) || 0);
          // "Usada de verdade" (26/10/2026) manda quando digitada; senao receita + perda - sobra.
          const { consumo: quantidadeConsumida, real: usadaReal } = consumoDoComponente({ necessario: quantidadeNecessaria, perdaExtra, sobra, usadaReal: itemPreview.usadaReal });
          if (quantidadeConsumida < 0) {
            throw new Error(`Sobra informada para "${itemPreview.componenteNome}" é maior do que o necessário + perda extra (não é possível devolver mais do que foi retirado do estoque).`);
          }
          const quantidadeAtual = Number(snap.data().quantidade || 0);
          if (quantidadeAtual < quantidadeConsumida) {
            throw new Error(`Estoque insuficiente de "${itemPreview.componenteNome}". Necessário: ${quantidadeConsumida} ${itemPreview.unidade}, disponível: ${quantidadeAtual} ${itemPreview.unidade}.`);
          }
          transaction.update(componenteRefs[i], {
            quantidade: quantidadeAtual - quantidadeConsumida,
            updatedAt: serverTimestamp(),
          });
          itensConsumidos.push({
            componenteId: itemPreview.componenteId,
            componenteNome: itemPreview.componenteNome,
            origem: itemPreview.origem,
            unidade: itemPreview.unidade,
            quantidadeNecessaria,
            perdaExtra,
            sobra,
            quantidadeConsumida,
            ...(usadaReal ? { usadaReal: true } : {}),
          });
        }

        if (produtoSnap.exists()) {
          const quantidadeProdutoAtual = Number(produtoSnap.data().quantidade || 0);
          transaction.update(produtoRef, {
            quantidade: quantidadeProdutoAtual + quantidadeProduzida,
            // Denormalizado pra tela de Etiquetas mostrar "data de producao"
            // sem consulta cruzada por produto (mesmo padrao de precoCusto/
            // unidadeMedidaSigla) -- nao revertido no estorno, mesma decisao
            // ja tomada pra precoCusto (ultimo valor manda, nao versionado).
            ultimaProducaoData: getDateInputInTimeZone(),
            updatedAt: serverTimestamp(),
          });
        }

        gravarEntradasEmLotesNaTransacao(transaction, db, tenantId, entradasDeLote, buildDocumentMetadata(currentUser.uid, serverTimestamp()), `Produção ${ordem.numero}`);
        baixarLotesNaTransacao(transaction, db, planoLotes);

        transaction.update(ordemRef, {
          status: 'finalizada',
          quantidadeProduzida,
          itensConsumidos,
          // Pesagem (26/10/2026): balanca, caixas, residuo, refugo e ganho de peso, para o historico.
          ...(pesagemParaGravar ? { pesagem: pesagemParaGravar } : {}),
          ...(!pesagemParaGravar && refugo > 0 ? { refugoUnidades: refugo, refugoMotivo: refugoMotivo.trim().slice(0, 200) } : {}),
          // Lotes para o estorno desfazer: o que a producao criou e de onde os componentes sairam.
          ...(entradasDeLote.length > 0 ? { lotesProduzidos: lotesDaEntradaParaGravar(entradasDeLote) } : {}),
          ...(planoLotes && Object.keys(planoLotes.porLinha).length > 0 ? { lotesConsumidos: somarLotesUsados(Object.values(planoLotes.porLinha)) } : {}),
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
        pesagem: pesagemParaGravar,
      } : prev);
      setShowRevisaoFinalizacao(false);
      showSuccess('Produção finalizada! Componentes debitados e estoque do produto atualizado.');
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
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Componentes consumidos</h3>
                </div>
                <div className="table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Componente</th>
                        <th>Necessário (receita)</th>
                        <th>Perda extra</th>
                        <th>Sobra</th>
                        <th>Total consumido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ordem.itensConsumidos.map(item => (
                        <tr key={chaveComponente(item.origem, item.componenteId)}>
                          <td>{item.componenteNome}</td>
                          <td>{item.quantidadeNecessaria} {item.unidade}</td>
                          <td>{item.perdaExtra > 0 ? `${item.perdaExtra} ${item.unidade}` : '-'}</td>
                          <td>{item.sobra > 0 ? `${item.sobra} ${item.unidade}` : '-'}</td>
                          <td><strong>{item.quantidadeConsumida} {item.unidade}</strong>{item.usadaReal && <span style={{ marginLeft: '6px', fontSize: '11px', color: 'var(--text-muted)' }} title="Digitado na finalização (usada de verdade)">real</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Pesagem gravada (26/10/2026). */}
                {ordem.pesagem && (() => {
                  const p = ordem.pesagem;
                  const kgTxt = (v: number) => `${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg`;
                  return (
                    <div style={{ marginTop: '14px', fontSize: '13px', lineHeight: 1.7, padding: '10px 12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
                      <strong>Pesagem</strong>
                      <div>Peso bruto {kgTxt(p.pesoBrutoKg)}{p.taras.map((t) => ` − ${t.nome}${t.quantidade > 1 ? ` × ${t.quantidade}` : ''} ${kgTxt(t.totalKg)}`).join('')}{p.embalagemKg > 0 ? ` − embalagens ${kgTxt(p.embalagemKg)}` : ''} = <strong>{kgTxt(p.liquidoKg)}</strong> líquidos</div>
                      <div>Pacotes pela balança: {p.unidadesSugeridas} de {kgTxt(p.pesoUnidadeKg)} · produzidas (boas): {ordem.quantidadeProduzida ?? '-'} · resíduo do processo: {kgTxt(p.residuoKg)}</div>
                      {p.refugoUnidades > 0 && <div>Refugo: {p.refugoUnidades} unid. — {p.refugoMotivo}</div>}
                      {p.materiaPrimaKg > 0 && <div>Matéria-prima usada: {kgTxt(p.materiaPrimaKg)} · {p.ganhoKg >= 0 ? 'ganho' : 'perda'} de peso: <strong>{p.ganhoKg >= 0 ? '+' : ''}{kgTxt(p.ganhoKg)} ({Number(p.ganhoPercentual || 0).toLocaleString('pt-BR')}%)</strong></div>}
                    </div>
                  );
                })()}
              </div>
            )}

            {showRevisaoFinalizacao && (
              <div style={{ padding: '20px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', border: '1px dashed var(--accent-purple)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Package size={18} color="var(--accent-purple)" />
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Conferência antes de finalizar</h3>
                </div>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
                  Confira a quantidade produzida e os componentes que serão debitados. Se houve refugo/desperdício além do previsto na receita, informe a perda extra por item; se sobrou material que volta pro estoque, informe a sobra.
                </p>

                {/* PESAGEM (26/10/2026): balanca - caixas - embalagens = pacotes fechados + residuo. */}
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
                  <input type="checkbox" checked={pesagemAtiva} onChange={(e) => { setPesagemAtiva(e.target.checked); setQuantidadeDigitada(false); }} style={{ width: '17px', height: '17px', accentColor: 'var(--accent-purple)' }} />
                  Pesar a produção (desconta caixas e embalagens e calcula os pacotes)
                </label>
                {pesagemAtiva && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '14px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-secondary)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                      <div className="input-group">
                        <label>Peso bruto da balança (kg)</label>
                        <input type="number" step="0.001" min="0" value={pesoBruto} onChange={(e) => setPesoBruto(e.target.value)} style={inputStyle} title="Tudo junto: produto, caixas e embalagens" />
                      </div>
                      <div className="input-group">
                        <label>Peso de cada unidade (kg)</label>
                        <input type="number" step="0.001" min="0" value={pesoUnidade} onChange={(e) => setPesoUnidade(e.target.value)} style={inputStyle} title="Vem do cadastro do produto (peso líquido unitário). Ex.: pacote de 250 g = 0,250" />
                      </div>
                      <div className="input-group">
                        <label>Peso de cada embalagem (kg)</label>
                        {/* 28/10/2026: por unidade, como no cadastro (vem preenchido de la'); antes era o total e confundia. */}
                        <input type="number" step="0.001" min="0" value={pesoEmbalagemUn} onChange={(e) => setPesoEmbalagemUn(e.target.value)} style={inputStyle}
                          title="Sacolinha/pacote vazio. Vem do cadastro do produto; troque se hoje a embalagem for outra. Em branco ou 0 = não desconta." />
                        {resultadoPesagem.embalagemKg > 0 && (
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                            Total: {resultadoPesagem.unidadesSugeridas} × {(Number(String(pesoEmbalagemUn).replace(',', '.')) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3 })} = {resultadoPesagem.embalagemKg.toLocaleString('pt-BR', { minimumFractionDigits: 3 })} kg
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Caixas usadas</span>
                        <button type="button" className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12.5px' }}
                          onClick={() => { setTarasRascunho(taras.map((t) => ({ id: t.id, nome: t.nome, pesoKg: String(t.pesoKg) }))); setEditandoTaras(true); }}>
                          Cadastrar caixas (taras)
                        </button>
                      </div>
                      {taras.filter((t) => t.ativa).length === 0 ? (
                        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Nenhuma caixa cadastrada. Use "Cadastrar caixas (taras)" para informar o peso de cada uma.</span>
                      ) : (
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                          {taras.filter((t) => t.ativa).map((t) => (
                            <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', padding: '6px 10px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
                              {t.nome} ({t.pesoKg.toLocaleString('pt-BR', { minimumFractionDigits: 3 })} kg) ×
                              <input type="number" min="0" step="1" value={tarasUsadas[t.id] ?? ''} onChange={(e) => setTarasUsadas((atual) => ({ ...atual, [t.id]: e.target.value }))}
                                aria-label={`Quantidade de ${t.nome}`} style={{ ...inputStyle, width: '70px', padding: '6px 8px' }} />
                            </label>
                          ))}
                        </div>
                      )}
                    </div>

                    {editandoTaras && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', border: '1px dashed var(--accent-purple)', borderRadius: 'var(--radius-md)' }}>
                        <strong style={{ fontSize: '13px' }}>Caixas (taras) da filial</strong>
                        {tarasRascunho.map((t, i) => (
                          <div key={t.id || `nova-${i}`} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <input value={t.nome} onChange={(e) => setTarasRascunho((l) => l.map((x, j) => (j === i ? { ...x, nome: e.target.value.toLocaleUpperCase('pt-BR') } : x)))} aria-label="Nome da caixa" title="Ex.: Caixa 1" style={{ ...inputStyle, padding: '8px 10px' }} />
                            <input type="number" step="0.001" min="0" value={t.pesoKg} onChange={(e) => setTarasRascunho((l) => l.map((x, j) => (j === i ? { ...x, pesoKg: e.target.value } : x)))} aria-label="Peso da caixa (kg)" title="Peso da caixa vazia em kg (ex.: 1,900)" style={{ ...inputStyle, padding: '8px 10px', width: '140px' }} />
                            <button type="button" className="icon-btn" title="Remover" onClick={() => setTarasRascunho((l) => l.filter((_, j) => j !== i))}><X size={16} /></button>
                          </div>
                        ))}
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                          <button type="button" className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12.5px' }} onClick={() => setTarasRascunho((l) => [...l, { id: '', nome: '', pesoKg: '' }])}>+ Caixa</button>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button type="button" className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12.5px' }} onClick={() => setEditandoTaras(false)} disabled={salvandoTaras}>Cancelar</button>
                            <button type="button" className="btn-primary" style={{ padding: '6px 12px', fontSize: '12.5px' }} onClick={() => void salvarTaras()} disabled={salvandoTaras}>{salvandoTaras ? 'Salvando...' : 'Salvar caixas'}</button>
                          </div>
                        </div>
                      </div>
                    )}

                    {resultadoPesagem.erro ? (
                      <span style={{ fontSize: '13px', color: '#f59e0b', fontWeight: 600 }}>{resultadoPesagem.erro}</span>
                    ) : (
                      <div style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '13px', lineHeight: 1.7, padding: '10px 12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
                        {(() => {
                          const kgTxt = (v: number) => `${v.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg`;
                          const linha = (rotulo: string, valor: string, forte = false) => (
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontWeight: forte ? 700 : 400 }}><span>{rotulo}</span><span>{valor}</span></div>
                          );
                          return (
                            <>
                              {linha('Peso bruto', kgTxt(Number(String(pesoBruto).replace(',', '.')) || 0))}
                              {resultadoPesagem.detalheTaras.map((t) => <React.Fragment key={t.nome}>{linha(`(−) ${t.nome}${t.quantidade > 1 ? ` × ${t.quantidade}` : ''}`, kgTxt(t.totalKg))}</React.Fragment>)}
                              {resultadoPesagem.embalagemKg > 0 && linha('(−) Embalagens', kgTxt(resultadoPesagem.embalagemKg))}
                              {linha('= Peso líquido', kgTxt(resultadoPesagem.liquidoKg), true)}
                              {linha(`Pacotes de ${kgTxt(Number(String(pesoUnidade).replace(',', '.')) || 0)}`, `${resultadoPesagem.unidadesSugeridas} (${resultadoPesagem.unidadesExatas.toLocaleString('pt-BR')} → só fechados)`, true)}
                              {linha('Resíduo do processo (perda)', kgTxt(resultadoPesagem.residuoKg))}
                              {materiaPrimaKgDaTela > 0 && linha('Matéria-prima usada (kg)', kgTxt(materiaPrimaKgDaTela))}
                              {materiaPrimaKgDaTela > 0 && linha(ganhoDaTela.ganhoKg >= 0 ? 'Ganho de peso' : 'Perda de peso', `${ganhoDaTela.ganhoKg >= 0 ? '+' : ''}${kgTxt(ganhoDaTela.ganhoKg)} (${ganhoDaTela.percentual.toLocaleString('pt-BR')}%)`, true)}
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div className="input-group" style={{ maxWidth: '260px' }}>
                    <label>Quantidade Produzida (boas)</label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={quantidadeProduzidaInput}
                      onChange={(e) => { setQuantidadeProduzidaInput(e.target.value); setQuantidadeDigitada(true); }}
                      style={inputStyle}
                      title={pesagemAtiva ? 'Vem da pesagem (só pacotes fechados). Se a contagem na mesa deu outro número, digite aqui.' : undefined}
                    />
                    {pesagemAtiva && !resultadoPesagem.erro && quantidadeDigitada && Number(quantidadeProduzidaInput) !== resultadoPesagem.unidadesSugeridas && (
                      <span style={{ fontSize: '12px', color: '#f59e0b' }}>
                        A balança indica {resultadoPesagem.unidadesSugeridas}.{' '}
                        <button type="button" onClick={() => setQuantidadeDigitada(false)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent-purple)', cursor: 'pointer', font: 'inherit', fontWeight: 600 }}>Usar {resultadoPesagem.unidadesSugeridas}</button>
                      </span>
                    )}
                  </div>
                  <div className="input-group" style={{ maxWidth: '180px' }}>
                    <label>Perdidas / refugo (unid.)</label>
                    <input type="number" step="1" min="0" value={refugoUnidades} onChange={(e) => setRefugoUnidades(e.target.value)} style={inputStyle} title="Unidades que não servem (pacote rasgado, peso errado). Fica registrado na ordem." />
                  </div>
                  {Number(refugoUnidades) > 0 && (
                    <div className="input-group" style={{ flex: '1 1 220px' }}>
                      <label>Motivo do refugo *</label>
                      <input value={refugoMotivo} onChange={(e) => setRefugoMotivo(e.target.value)} style={inputStyle} title="Ex.: pacote rasgado, peso errado" />
                    </div>
                  )}
                </div>

                <div className="table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Componente</th>
                        <th>Necessário (receita × produzido)</th>
                        <th>Perda extra</th>
                        <th>Sobra</th>
                        <th title="O que realmente saiu do estoque. Em branco = receita + perda extra − sobra.">Usada de verdade</th>
                      </tr>
                    </thead>
                    <tbody>
                      {composicaoPreview.map(item => {
                        const quantidadeProduzidaNum = Number(quantidadeProduzidaInput) || 0;
                        const necessario = item.quantidadePorUnidade * quantidadeProduzidaNum;
                        const chave = chaveComponente(item.origem, item.componenteId);
                        return (
                          <tr key={chave}>
                            <td>{item.componenteNome}</td>
                            <td>{necessario} {item.unidade}</td>
                            <td style={{ maxWidth: '140px' }}>
                              <input
                                type="number"
                                step="any"
                                min="0"
                                value={item.perdaExtra}
                                onChange={(e) => handleAlterarPerdaExtra(chave, e.target.value)}
                                style={{ ...inputStyle, padding: '8px 12px' }}
                              />
                            </td>
                            <td style={{ maxWidth: '140px' }}>
                              <input
                                type="number"
                                step="any"
                                min="0"
                                value={item.sobra}
                                onChange={(e) => handleAlterarSobra(chave, e.target.value)}
                                style={{ ...inputStyle, padding: '8px 12px' }}
                              />
                            </td>
                            <td style={{ maxWidth: '150px' }}>
                              <input
                                type="number"
                                step="any"
                                min="0"
                                value={item.usadaReal}
                                onChange={(e) => setComposicaoPreview((prev) => prev.map((x) => (chaveComponente(x.origem, x.componenteId) === chave ? { ...x, usadaReal: e.target.value } : x)))}
                                aria-label={`Quantidade de ${item.componenteNome} usada de verdade`}
                                title={`Em branco = ${Math.round((necessario + (Number(item.perdaExtra) || 0) - (Number(item.sobra) || 0)) * 1000) / 1000} ${item.unidade}`}
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
