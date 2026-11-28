import React, { useEffect, useMemo, useState } from 'react';
import { painelDoContasAPagar } from '../../utils/painelContasPagarDomain';
import './ContasPagarVisual.css';
import { collection, query, where, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import ClientAutocomplete from '../../components/common/ClientAutocomplete';
import { showSuccess, showError, showWarning, NexusSwal } from '../../utils/alerts';
import { aplicarCaixaAltaCadastro } from '../../utils/textoCadastroDomain';
import { hasTenantFullAccess, isPlatformAdminRole } from '../../utils/roles';
import { PERMISSAO_FINANCEIRO } from '../../utils/permissoesNovasDomain';
import { permissionLabelMap } from '../../utils/permissionCatalog';
import { PERMISSAO_DESCONTO_NA_BAIXA } from '../../utils/ajustesDaBaixaDomain';
import { bloqueioDoParcial, principalDaBaixa, textoDoParcial, type TituloParaParcial } from '../../utils/baixaParcialDomain';
import {
  dataBrasileira,
  planejarEstornoPagar,
  type TituloParaEstorno,
} from '../../utils/baixaFinanceiraDomain';
import { pedirDadosBaixa } from '../../utils/baixaFinanceiraUi';
import { cancelarContaAPagar, editarContaAPagar, estornarBaixaComConfirmacao, lancarContaAPagar, registrarBaixa } from '../../services/baixaFinanceiraService';
import { MOTIVO_MINIMO_CANCELAR_DESPESA } from '../../utils/lancamentoPagarDomain';
import ParcelasEditor from '../../components/financeiro/ParcelasEditor';
import NovaCategoriaInline from '../../components/finance/NovaCategoriaInline';
import { FORMAS_DE_PAGAMENTO, dividirEmParcelas } from '../../utils/pagamentoEntradaDomain';
import type { ParcelaComCheque } from '../../utils/chequeEmitidoDomain';
import { avisoDeSoma, erroDaDespesa } from '../../utils/despesaParceladaDomain';
import { rotuloDoVeiculo, type VeiculoDaFrota } from '../../utils/frotaDomain';
import { CheckCircle, Plus, X, ArrowDownCircle, Loader2, Calendar, Edit, XCircle, ChevronDown, ChevronRight, Search, Truck, Tag, Upload, Undo2, FileText, Wallet } from 'lucide-react';
import RelatorioPreview from '../../components/Reports/RelatorioPreview';
import { nomeArquivoRelatorio } from '../../utils/relatorioPdfDomain';
import {
  FORMAS_DO_FILTRO,
  formaDoTitulo,
  grupoDaForma,
  montarDocumentoContasPagar,
  passaNoFiltroDeForma,
  resumoAPagarPorForma,
  rotuloDaFormaDoTitulo,
} from '../../utils/formaContaPagarDomain';
import { differenceInCalendarDays, getDateInputInTimeZone } from '../../utils/dateTime';
import {
  ATALHO_VENCIMENTO_PADRAO,
  ROTULO_ATALHO_VENCIMENTO,
  ROTULO_SITUACAO_TITULO,
  SITUACAO_TITULO_PADRAO,
  intervaloDoAtalhoVencimento,
  passaNaSituacaoTitulo,
  passaNoPeriodoDoTitulo,
  type AtalhoVencimento,
  type SituacaoTitulo,
} from '../../utils/filtroListaDomain';
import { BotaoFiltros, CampoFiltro, CampoPeriodo, PainelFiltros, estiloCampoFiltro } from '../../components/common/PainelFiltros';
import MenuMaisOpcoes from '../../components/common/MenuMaisOpcoes';
import CreditosModal from '../../components/finance/CreditosModal';
import { creditosConsultaService, type SaldoDoFornecedor } from '../../services/creditosConsultaService';
import BotaoOlhoValores from '../../components/common/BotaoOlhoValores';
import { useValoresOcultos } from '../../hooks/useValoresOcultos';
import { BaixaEmLoteModal, BarraDeSelecaoLote, CaixaDeSelecao, type ItemDoLote } from '../../components/finance/BaixaEmLote';
import { estadoDaSelecao, LIMITE_BAIXA_EM_LOTE, marcarNaSelecao, podeEntrarNoLote } from '../../utils/baixaEmLoteDomain';
import { useTitulosFinanceiros, type HistoricoDePagas } from '../../hooks/useTitulosFinanceiros';
import { toCents } from '../../utils/financeDomain';
import './Financeiro.css';
import { useLinhasEmBlocos } from '../../hooks/useLinhasEmBlocos';
import MostrarMaisLinhas from '../../components/common/MostrarMaisLinhas';
import CampoBuscaAdiado from '../../components/common/CampoBuscaAdiado';
import { consumirPedidoDeLancamento, EVENTO_ABRIR_LANCAMENTO } from '../../utils/pedidoDeLancamento';

interface TransacaoData extends TituloParaEstorno {
  id: string;
  data: string;
  descricao: string;
  categoria: string;
  valor: number;
  tipo: 'entrada' | 'saida';
  status: 'Paga' | 'Pendente' | 'Cancelada';
  formaPagamento?: string;
  /** Forma prevista no lancamento (nota de entrada, despesa): a coluna "Forma" do titulo em aberto. */
  formaPagamentoPrevista?: string;
  osId?: string;
  vendaId?: string;
  dataPagamento?: string;
  createdAt?: any;
  bancoId?: string;
  bancoNome?: string;
  fornecedorId?: string | null;
  fornecedorNome?: string;
  /** Cheque emitido para pagar esta despesa (banco, numero, data de compensacao). */
  cheque?: { numeroCheque?: string; dataCompensacao?: string; bancoEmissor?: string } | null;
  /** Marca da baixa (servidor); desconto obtido na baixa (15/10/2026) e' lancamento de entrada a parte. */
  baixaManual?: { descontoCentavos?: number } | null;
  /** Veiculo da frota (e motorista) a que a despesa pertence. */
  veiculoId?: string;
  veiculoNome?: string;
  veiculoPlaca?: string;
  motoristaId?: string;
  motoristaNome?: string;
}

// Espelha GrupoCliente de ContasReceber.tsx. Diferenca deliberada: uma
// despesa nem sempre tem fornecedor -- compras importadas de XML gravam
// fornecedorId/fornecedorNome (ver EntradaNFE.tsx), mas despesa lancada a
// mao (aluguel, luz, salario) so tem categoria. Por isso o grupo cai pra
// categoria quando nao ha fornecedor, em vez de jogar tudo num balde
// "sem fornecedor" -- `porFornecedor` diz qual dos dois foi usado.
interface GrupoDespesa {
  chave: string;
  fornecedorId: string | null;
  titulo: string;
  porFornecedor: boolean;
  transacoes: TransacaoData[];
  totalPendente: number;
  vencimentoMaisAntigo: string | null;
  diasAtrasoMax: number;
}

const ContasPagar: React.FC = () => {
  const { openTab } = useTabs();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Como a conta estava ao abrir a edicao: base do "antes e depois" do historico.
  const [contaEmEdicao, setContaEmEdicao] = useState<TransacaoData | null>(null);
  const [gruposExpandidos, setGruposExpandidos] = useState<Set<string>>(new Set());
  const [buscaGrupo, setBuscaGrupo] = useState('');
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [situacaoTitulo, setSituacaoTitulo] = useState<SituacaoTitulo>(SITUACAO_TITULO_PADRAO);
  const [periodoDe, setPeriodoDe] = useState('');
  const [periodoAte, setPeriodoAte] = useState('');
  /**
   * A TELA ABRE NO QUE VENCE HOJE (pedido do dono, 2026-09-21).
   *
   * Antes abria em "todas as contas em aberto", agrupadas por fornecedor e
   * ORDENADAS POR VALOR -- quem entrava pra pagar o dia tinha de garimpar a
   * data no meio de tudo. Agora abre no vencimento de hoje, em lista unica
   * ordenada por data, com todos os fornecedores juntos.
   *
   * O agrupamento por fornecedor nao sumiu: virou um botao, pra quem quer
   * ver o total por credor.
   */
  const [atalhoVencimento, setAtalhoVencimento] = useState<AtalhoVencimento>(ATALHO_VENCIMENTO_PADRAO);
  const [agrupar, setAgrupar] = useState(false);
  // Forma de pagamento (24/11/2026): '' = todas; senao, um grupo de FORMAS_DO_FILTRO.
  const [formaFiltro, setFormaFiltro] = useState('');
  // Relatorio em PDF (Mais opcoes › Relatorio): a lista com os filtros da tela.
  const [previewAberto, setPreviewAberto] = useState(false);
  const { currentUser, tenantId, userRole, userPermissions, isOwner } = useAuth();
  const podeEstornar = Boolean(isOwner || isPlatformAdminRole(userRole) || userPermissions?.includes('financeiro.estornar'));
  // Desconto na baixa (15/10/2026): permissao propria; dono e administrador ja' tem.
  const podeDescontar = Boolean(hasTenantFullAccess(userRole, isOwner) || isPlatformAdminRole(userRole) || userPermissions?.includes(PERMISSAO_DESCONTO_NA_BAIXA));
  // Uma permissao por acao (item 15, 25/11/2026): o servidor confere a mesma. Dono,
  // administrador e plataforma sempre; o funcionario, pelas efetivas do AuthContext
  // (ja' vem marcadas para quem tem Contas a Pagar e ainda nao foi salvo de novo).
  // Lancar, alterar e cancelar despesa gravam pelo servidor desde a fase 2 (25/11/2026).
  const acessoTotal = hasTenantFullAccess(userRole, isOwner) || isPlatformAdminRole(userRole);
  const temAcao = (permissao: string) => acessoTotal || Boolean(userPermissions?.includes(permissao));
  const podePagarBaixar = temAcao(PERMISSAO_FINANCEIRO.pagarBaixar);
  const podeJurosMulta = temAcao(PERMISSAO_FINANCEIRO.baixaJurosMulta);
  const podeDataAnterior = temAcao(PERMISSAO_FINANCEIRO.baixaDataAnterior);
  const podeBaixaLote = temAcao(PERMISSAO_FINANCEIRO.baixaLote);
  const podePagarLancar = temAcao(PERMISSAO_FINANCEIRO.pagarLancar);
  const podePagarEditar = temAcao(PERMISSAO_FINANCEIRO.pagarEditar);
  const podePagarCancelar = temAcao(PERMISSAO_FINANCEIRO.pagarCancelar);
  const podeRelatorios = temAcao(PERMISSAO_FINANCEIRO.relatorios);
  const podeImportar = temAcao(PERMISSAO_FINANCEIRO.importarTitulos);
  // O que o fornecedor deve a empresa e de onde vem (26/11/2026): na linha do fornecedor e em Mais opcoes.
  const podeVerCreditos = temAcao(PERMISSAO_FINANCEIRO.creditosVer);
  const [creditosAbertos, setCreditosAbertos] = useState<{ alvo: { id: string; nome: string } | null } | null>(null);
  const [saldosDeFornecedor, setSaldosDeFornecedor] = useState<SaldoDoFornecedor[]>([]);
  useEffect(() => {
    if (!podeVerCreditos || creditosAbertos) return;
    let ativo = true;
    creditosConsultaService.saldosDosFornecedores()
      .then((r) => { if (ativo) setSaldosDeFornecedor(r.fornecedores); })
      .catch((erro) => console.error('Erro ao ler o que os fornecedores devem:', erro));
    return () => { ativo = false; };
  }, [podeVerCreditos, creditosAbertos]);
  const deveAEmpresa = (fornecedorId: string | null): number => (fornecedorId ? (saldosDeFornecedor.find((f) => f.fornecedorId === fornecedorId)?.saldoCentavos || 0) : 0);
  const semPermissao = (permissao: string, acao: string) => `Você não tem permissão para ${acao}. Peça a um responsável liberar "${permissionLabelMap[permissao] || permissao}" no seu cadastro de funcionário.`;

  // Leitura enxuta (otimizacao de leituras, 2026-10-14 -- useTitulosFinanceiros):
  // em aberto de qualquer data (soma o Total Pendente e o aviso de vencidas) +
  // pagas de hoje; o historico de pagas so' quando a lista mostra pagas, no
  // periodo do atalho ("Qualquer data" = tudo, escolha explicita; personalizado
  // vazio = mes atual). Antes eram todas as saidas desde sempre.
  const listaTemPagas = situacaoTitulo === 'pagas' || situacaoTitulo === 'todas';
  const hojeLeitura = getDateInputInTimeZone();
  const intervaloLeitura = atalhoVencimento === 'personalizado'
    ? { de: periodoDe, ate: periodoAte }
    : intervaloDoAtalhoVencimento(atalhoVencimento, hojeLeitura);
  const historicoDePagas: HistoricoDePagas = !listaTemPagas
    ? null
    : atalhoVencimento === 'todos'
      ? 'todo'
      : (intervaloLeitura.de || intervaloLeitura.ate ? intervaloLeitura : { de: `${hojeLeitura.slice(0, 7)}-01`, ate: hojeLeitura });
  const { titulos: titulosLidos, carregando: loading } = useTitulosFinanceiros<TransacaoData>({
    tenantId,
    tipo: 'saida',
    historico: historicoDePagas,
  });
  // Ordenar por vencimento (mais proximos primeiro).
  const transacoes = useMemo(
    () => [...titulosLidos].sort((a, b) => (a.data || '').localeCompare(b.data || '')),
    [titulosLidos],
  );

  // Baixa em lote (2026-10-14): contas marcadas e o borderô congelado ao abrir.
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [itensDoLote, setItensDoLote] = useState<ItemDoLote[] | null>(null);

  /**
   * FORNECEDOR DO CADASTRO NO LANCAMENTO MANUAL (pedido do dono, 2026-09-21).
   *
   * A entrada de XML sempre gravou `fornecedorId`/`fornecedorNome` no titulo,
   * e e' por eles que esta tela agrupa. A despesa lancada na mao so' tinha um
   * texto livre: "FORN. JOAO" e "JOAO DISTRIBUIDORA" viravam dois grupos
   * diferentes do mesmo credor. Escolher no cadastro resolve na origem.
   *
   * Continua OPCIONAL -- aluguel, luz e imposto nao tem fornecedor, e exigir
   * um faria a pessoa cadastrar "COPASA" como fornecedor so' pra conseguir
   * salvar a conta de agua.
   */
  const { items: fornecedores } = useTenantCollection<{ id: string; nome?: string; codigo?: string; ativo?: boolean }>('fornecedores', tenantId, { enabled: isModalOpen });
  const fornecedoresAtivos = fornecedores.filter((f) => f.ativo !== false);
  const [buscaFornecedor, setBuscaFornecedor] = useState('');

  /**
   * DESPESA PARCELADA E CHEQUE (pedido do dono, 2026-09-24). Lancamento novo pode ser
   * em varias parcelas (cada uma um titulo) e, pagando em Cheque, cada parcela leva o
   * banco, o numero e a data de compensacao. O cheque so' sai do banco quando
   * alguem da' baixa nele aqui mesmo, no dia em que compensa (24/11/2026).
   */
  const { items: bancosCadastrados } = useTenantCollection<{ id: string; nome?: string; ativo?: boolean }>('bancos', tenantId, { enabled: isModalOpen });
  const bancosParaCheque = bancosCadastrados.filter((b) => b.ativo !== false).map((b) => ({ id: b.id, nome: String(b.nome || '') }));
  // Despesa de VEICULO da frota (2026-09-25): opcional; alimenta o relatorio de Custo por Veiculo.
  const { items: frotaCadastrada } = useTenantCollection<VeiculoDaFrota>('frota', tenantId, { enabled: isModalOpen });
  const { items: motoristasCadastrados } = useTenantCollection<{ id: string; nome?: string; ativo?: boolean }>('motoristas', tenantId, { enabled: isModalOpen });
  const veiculosAtivos = frotaCadastrada.filter((v) => v.ativo !== false);
  const motoristasAtivos = motoristasCadastrados.filter((m) => m.ativo !== false);
  const [veiculoDaDespesa, setVeiculoDaDespesa] = useState('');
  const [motoristaDaDespesa, setMotoristaDaDespesa] = useState('');
  const [formaDespesa, setFormaDespesa] = useState<string>('Boleto');
  const [parcelarDespesa, setParcelarDespesa] = useState(false);
  const [parcelasDespesa, setParcelasDespesa] = useState<ParcelaComCheque[]>([]);
  const [parcelasAceitas, setParcelasAceitas] = useState(false);
  const [idLancamento, setIdLancamento] = useState('');

  // Categorias de despesa do plano de contas
  const [categoriasDespesa, setCategoriasDespesa] = useState<string[]>(['Aluguel', 'Água/Luz/Internet', 'Salários', 'Fornecedores de Peças', 'Outros']);

  const [formData, setFormData] = useState({
    descricao: '',
    data: getDateInputInTimeZone(),
    valor: '',
    categoria: '',
    fornecedorId: '',
    fornecedorNome: '',
    status: 'Pendente' as 'Paga' | 'Pendente'
  });

  // Plano de contas das configuracoes (categorias da despesa).
  useEffect(() => {
    if (!currentUser || !tenantId) return;
    const fetchConfig = async () => {
      try {
        const configSnap = await getDoc(doc(db, 'configuracoes', tenantId));
        if (configSnap.exists()) {
          const data = configSnap.data();
          if (data.planoContasDespesas) {
            setCategoriasDespesa(Array.isArray(data.planoContasDespesas) ? data.planoContasDespesas : data.planoContasDespesas.split('\n').filter((c: string) => c.trim() !== ''));
          }
        }
      } catch (err) {
        console.error("Erro ao buscar plano de contas", err);
      }
    };
    fetchConfig();
  }, [currentUser, tenantId]);

  // Cheque (24/11/2026): o cheque emitido se baixa aqui, debitando o banco dele na hora.
  const FORMAS_PAGAMENTO = ['Dinheiro', 'Pix', 'Cartão de Crédito', 'Cartão de Débito', 'Transferência', 'Boleto', 'Cheque', 'Outros'];
  /** Forma que a janela da baixa ja' traz escolhida: a do titulo, quando ela existe na lista. */
  const formaInicialDaBaixa = (t: TransacaoData): string => {
    if (t.cheque || t.formaPagamento === 'Cheque') return 'Cheque';
    const forma = formaDoTitulo(t);
    if (FORMAS_PAGAMENTO.includes(forma)) return forma;
    const grupo = grupoDaForma(forma);
    if (grupo === 'PIX') return 'Pix';
    return FORMAS_PAGAMENTO.includes(grupo) ? grupo : '';
  };

  const handleConciliar = async (t: TransacaoData) => {
    if (!currentUser || !tenantId) return;
    if (!podePagarBaixar) {
      showWarning('Sem permissão', semPermissao(PERMISSAO_FINANCEIRO.pagarBaixar, 'dar baixa em contas a pagar'));
      return;
    }
    // Banco na mesma janela (23/11/2026): tudo que nao e' dinheiro sai de um banco.
    const formasComBanco = FORMAS_PAGAMENTO.filter((forma) => forma !== 'Dinheiro');
    let bancosDisponiveis: Array<{ id: string; nome: string }>;
    try {
      const snapBancos = await getDocs(query(collection(db, 'bancos'), where('tenantId', '==', tenantId), where('ativo', '==', true)));
      bancosDisponiveis = snapBancos.docs.map((d) => ({ id: d.id, nome: String(d.data().nome || '') }));
    } catch (erro) {
      console.error('Contas a Pagar: não foi possível ler os bancos.', erro);
      showError('Não foi possível ler os bancos', 'Confira a internet e tente de novo.');
      return;
    }
    // Cheque emitido: a janela ja' abre com o banco do cheque (da' para trocar).
    const bancoDoCheque = t.bancoId
      || bancosDisponiveis.find((b) => t.cheque?.bancoEmissor && b.nome.trim().toUpperCase() === t.cheque.bancoEmissor.trim().toUpperCase())?.id
      || '';
    const dados = await pedirDadosBaixa({
      titulo: 'Confirmar Pagamento?',
      texto: `Valor de R$ ${Number(t.valor).toFixed(2)} referente a ${t.descricao}.`,
      // Juros, multa e desconto (15/10/2026): o que o fornecedor cobrou a mais ou deu de abatimento.
      valorCentavos: toCents(Number(t.valor || 0)),
      rotuloValor: 'Valor pago agora',
      pagar: true,
      // Pagamento parcial (16/10/2026): menos que o total deixa o resto em aberto.
      bloqueioParcial: bloqueioDoParcial(t as TituloParaParcial),
      podeDescontar,
      podeJurosMulta,
      podeDataAnterior,
      formas: FORMAS_PAGAMENTO,
      formaInicial: formaInicialDaBaixa(t),
      // O cheque ja' emitido tem valor escrito: sai inteiro, sem juros, multa, desconto ou parcial.
      ...(t.cheque ? { formasSemAjuste: ['Cheque'] } : {}),
      cheque: { forma: 'Cheque', inicial: t.cheque?.numeroCheque || '' },
      rotuloForma: 'Como foi pago?',
      mensagemSemForma: 'Escolha como foi pago antes de confirmar.',
      rotuloData: 'Data do pagamento',
      textoConfirmar: 'Sim, confirmar pagamento',
      banco: {
        bancos: bancosDisponiveis,
        formas: formasComBanco,
        rotulo: (forma) => (forma === 'Cheque' ? 'De qual banco saiu o cheque?' : 'De qual banco saiu?'),
        ...(bancoDoCheque ? { bancoInicial: bancoDoCheque } : {}),
      },
    });
    if (!dados) return;
    const formaPgto = dados.forma;
    const dataPagamento = dados.data;
    // O banco veio da mesma janela (pedirDadosBaixa).
    const bancoId: string | undefined = formaPgto !== 'Dinheiro' ? dados.bancoId : undefined;

    try {
      // Titulo + saldo do banco gravados pelo servidor (services/baixaFinanceiraService).
      await registrarBaixa({
        tipo: 'saida',
        transacaoId: t.id,
        formaPagamento: formaPgto,
        dataPagamento,
        ...(bancoId ? { bancoId } : {}),
        ...(formaPgto === 'Cheque' && dados.numeroCheque ? { numeroCheque: dados.numeroCheque } : {}),
        ajustes: dados.ajustes,
        valorRecebidoCentavos: dados.valorRecebidoCentavos,
        tenantId,
      });
      const principal = principalDaBaixa(dados.valorRecebidoCentavos, dados.ajustes);
      const restante = toCents(Number(t.valor || 0)) - principal;
      const reais = (centavos: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(centavos / 100);
      showSuccess(restante > 0
        ? `Pagamento parcial de ${reais(principal)} registrado. Fica em aberto ${reais(restante)}.`
        : dataPagamento === getDateInputInTimeZone()
          ? 'Pagamento registrado no Fluxo de Caixa!'
          : `Pagamento registrado com a data de ${dataBrasileira(dataPagamento)}!`);
    } catch (err) {
      console.error(err);
      showError('Erro', err instanceof Error ? err.message : 'Não foi possível confirmar o pagamento.');
    }
  };

  /** Estorno: um caminho so' para o sistema (services/baixaFinanceiraService). */
  const handleEstornar = (t: TransacaoData) => estornarBaixaComConfirmacao({
    titulo: t,
    tipo: 'saida',
    podeEstornar,
    tenantId,
    usuario: currentUser ? { uid: currentUser.uid, email: currentUser.email } : null,
  });

  const handleOpenModal = () => {
    if (!podePagarLancar) {
      showWarning('Sem permissão', semPermissao(PERMISSAO_FINANCEIRO.pagarLancar, 'lançar despesas no Contas a Pagar'));
      return;
    }
    // Id do lancamento, gerado ao abrir: repetir o envio (internet caiu) nao lanca duas vezes.
    setIdLancamento(doc(collection(db, 'transacoes')).id);
    setFormData({
      descricao: '',
      data: getDateInputInTimeZone(),
      valor: '',
      categoria: categoriasDespesa[0] || '',
      fornecedorId: '',
      fornecedorNome: '',
      status: 'Pendente'
    });
    setBuscaFornecedor('');
    setEditingId(null);
    setContaEmEdicao(null);
    setVeiculoDaDespesa('');
    setMotoristaDaDespesa('');
    setFormaDespesa('Boleto');
    setParcelarDespesa(false);
    setParcelasDespesa([]);
    setParcelasAceitas(false);
    setIsModalOpen(true);
  };

  // "Nova Acao > Conta a Pagar" no Dashboard (27/11/2026): abre o lancamento (sem permissao, o aviso de sempre).
  const abrirLancamentoRef = React.useRef(handleOpenModal);
  useEffect(() => { abrirLancamentoRef.current = handleOpenModal; });
  useEffect(() => {
    const atender = () => {
      if (consumirPedidoDeLancamento('pagar')) abrirLancamentoRef.current();
    };
    atender();
    window.addEventListener(EVENTO_ABRIR_LANCAMENTO, atender);
    return () => window.removeEventListener(EVENTO_ABRIR_LANCAMENTO, atender);
  }, []);

  /** Liga o parcelamento (ou o cheque) e ja monta as parcelas com o valor digitado. */
  const prepararParcelas = (forma: string, parcelar: boolean) => {
    setFormaDespesa(forma);
    setParcelarDespesa(parcelar);
    setParcelasAceitas(false);
    if ((parcelar || forma === 'Cheque') && parcelasDespesa.length === 0) {
      const total = parseFloat(String(formData.valor).replace(',', '.')) || 0;
      setParcelasDespesa(dividirEmParcelas(total, 1, formData.data));
    }
  };

  const handleEdit = (t: TransacaoData) => {
    if (!podePagarEditar) {
      showWarning('Sem permissão', semPermissao(PERMISSAO_FINANCEIRO.pagarEditar, 'alterar despesas do Contas a Pagar'));
      return;
    }
    setFormData({
      descricao: t.descricao,
      data: t.data,
      valor: t.valor.toString().replace('.', ','),
      categoria: t.categoria,
      fornecedorId: t.fornecedorId || '',
      fornecedorNome: t.fornecedorNome || '',
      status: t.status === 'Paga' ? 'Paga' : 'Pendente'
    });
    setBuscaFornecedor(t.fornecedorNome || '');
    setVeiculoDaDespesa(t.veiculoId || '');
    setMotoristaDaDespesa(t.motoristaId || '');
    setEditingId(t.id);
    setContaEmEdicao(t);
    setIsModalOpen(true);
  };

  const handleCancelar = async (t: TransacaoData) => {
    if (!currentUser || !tenantId) return;
    if (!podePagarCancelar) {
      showWarning('Sem permissão', semPermissao(PERMISSAO_FINANCEIRO.pagarCancelar, 'cancelar despesas do Contas a Pagar'));
      return;
    }
    const result = await NexusSwal.fire({
      title: 'Cancelar Lançamento?',
      text: `Para cancelar a despesa "${t.descricao}", digite o motivo (mínimo ${MOTIVO_MINIMO_CANCELAR_DESPESA} caracteres). O lançamento continua registrado, só sai da lista de pendentes/pagas.`,
      input: 'text',
      inputAttributes: {
        minlength: String(MOTIVO_MINIMO_CANCELAR_DESPESA),
        required: 'true',
      },
      showCancelButton: true,
      confirmButtonText: 'Confirmar Cancelamento',
      cancelButtonText: 'Voltar',
      confirmButtonColor: '#ef4444',
      preConfirm: (motivo) => {
        if (!motivo || motivo.trim().length < MOTIVO_MINIMO_CANCELAR_DESPESA) {
          NexusSwal.showValidationMessage(`O motivo deve ter pelo menos ${MOTIVO_MINIMO_CANCELAR_DESPESA} caracteres.`);
          return false;
        }
        return motivo;
      }
    });

    if (result.isConfirmed) {
      try {
        // Pelo servidor (item 15, fase 2): confere a permissao e grava o Historico de alteracoes.
        await cancelarContaAPagar({ transacaoId: t.id, motivo: String(result.value || '').trim(), tenantId });
        showSuccess('Despesa cancelada com sucesso!');
      } catch (err) {
        console.error('Erro ao cancelar a conta a pagar:', err);
        showError('Não foi possível cancelar', err instanceof Error ? err.message : 'Tente de novo em instantes.');
      }
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !tenantId) return;
    if (!formData.descricao || !formData.valor || !formData.categoria) {
      showError('Atenção', 'Preencha todos os campos obrigatórios.');
      return;
    }
    const valorNum = parseFloat(formData.valor.toString().replace(',', '.'));
    if (!(toCents(valorNum) > 0)) {
      showError('Confira a despesa', 'Informe o valor da despesa (maior que zero).');
      return;
    }
    // Fornecedor, veiculo e motorista vao so' pelo id: o servidor le o nome no cadastro.
    const fornecedorId = formData.fornecedorId && formData.fornecedorNome ? formData.fornecedorId : '';
    const veiculoId = veiculosAtivos.some((v) => v.id === veiculoDaDespesa) ? veiculoDaDespesa : '';
    const motoristaId = motoristasAtivos.some((m) => m.id === motoristaDaDespesa) ? motoristaDaDespesa : '';

    // Alterar (item 15, fase 2): valor, vencimento e dados, pelo servidor, com o Historico de alteracoes.
    if (editingId) {
      if (!podePagarEditar) {
        showWarning('Sem permissão', semPermissao(PERMISSAO_FINANCEIRO.pagarEditar, 'alterar despesas do Contas a Pagar'));
        return;
      }
      // Na edicao, o veiculo/motorista que ja' estava gravado continua valendo mesmo se nao estiver mais ativo.
      const veiculoGravado = contaEmEdicao?.veiculoId && veiculoDaDespesa === contaEmEdicao.veiculoId ? contaEmEdicao.veiculoId : veiculoId;
      const motoristaGravado = contaEmEdicao?.motoristaId && motoristaDaDespesa === contaEmEdicao.motoristaId ? contaEmEdicao.motoristaId : motoristaId;
      setIsSaving(true);
      try {
        const r = await editarContaAPagar({
          transacaoId: editingId,
          descricao: formData.descricao,
          categoria: formData.categoria,
          valorCentavos: toCents(valorNum),
          vencimento: formData.data,
          fornecedorId,
          veiculoId: veiculoGravado,
          motoristaId: motoristaGravado,
          tenantId,
        });
        showSuccess(r.alterou ? 'Conta atualizada com sucesso!' : 'Nada mudou nesta conta.');
        setIsModalOpen(false);
      } catch (error) {
        console.error('Erro ao alterar a conta a pagar:', error);
        showError('Não foi possível salvar', error instanceof Error ? error.message : 'Tente de novo em instantes.');
      } finally {
        setIsSaving(false);
      }
      return;
    }

    if (!podePagarLancar) {
      showWarning('Sem permissão', semPermissao(PERMISSAO_FINANCEIRO.pagarLancar, 'lançar despesas no Contas a Pagar'));
      return;
    }
    // Despesa nova em varias parcelas e/ou em cheque: um titulo por parcela. A tela
    // confere antes (mesma regra do servidor) para a pessoa corrigir sem esperar.
    const emParcelas = parcelarDespesa || formaDespesa === 'Cheque';
    if (emParcelas) {
      const problema = erroDaDespesa(
        { descricao: formData.descricao, categoria: formData.categoria, forma: formaDespesa },
        parcelasDespesa,
        valorNum,
        bancosParaCheque,
      );
      if (problema) {
        showError('Confira a despesa', problema);
        return;
      }
      const avisoSoma = avisoDeSoma(parcelasDespesa, valorNum);
      if (avisoSoma && !parcelasAceitas) {
        showError('As parcelas não fecham com o valor', `${avisoSoma} Ajuste os valores ou marque "Conferi as parcelas e quero lançar assim".`);
        return;
      }
    }

    setIsSaving(true);
    try {
      const r = await lancarContaAPagar({
        idLancamento,
        descricao: formData.descricao,
        categoria: formData.categoria,
        forma: formaDespesa,
        totalCentavos: toCents(valorNum),
        fornecedorId,
        veiculoId,
        motoristaId,
        tenantId,
        ...(emParcelas
          ? {
            parcelas: parcelasDespesa.map((p) => ({
              numero: p.numero,
              vencimento: p.vencimento,
              valorCentavos: toCents(p.valor),
              ...(p.bancoId ? { bancoId: p.bancoId } : {}),
              ...(p.numeroCheque ? { numeroCheque: p.numeroCheque } : {}),
            })),
            aceitarSomaDiferente: parcelasAceitas,
          }
          : { vencimento: formData.data }),
      });
      if (r.jaLancado) showSuccess('Esta despesa já estava lançada (o envio anterior chegou ao servidor).');
      else if (formaDespesa === 'Cheque') showSuccess(`${r.quantidade} cheque(s) lançado(s)! Quando cada cheque compensar, dê baixa nele aqui em Contas a Pagar.`);
      else if (r.quantidade > 1) showSuccess(`${r.quantidade} parcela(s) lançada(s) em Contas a Pagar!`);
      else showSuccess('Conta a pagar lançada com sucesso!');
      setIsModalOpen(false);
    } catch (error) {
      console.error('Erro ao salvar conta a pagar:', error);
      showError('Não foi possível lançar', error instanceof Error ? error.message : 'Tente de novo em instantes.');
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * Acoes de um titulo (editar, cancelar, dar baixa) -- uma funcao so' porque
   * a tela mostra a mesma linha em dois lugares: a lista por vencimento e o
   * detalhe dentro do grupo por fornecedor. Duplicar o bloco seria garantir
   * que um dos dois ficaria pra tras na proxima mudanca.
   */
  const acoesDoTitulo = (t: TransacaoData) => (
    t.status === 'Paga' ? (
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '12px', color: '#10b981', fontWeight: 600 }}>
          Paga{t.dataPagamento ? ` em ${t.dataPagamento.split('-').reverse().join('/')}` : ''}
        </span>
        {podeEstornar && planejarEstornoPagar(t).mostrarBotao && (
          <button
            onClick={() => void handleEstornar(t)}
            title="Desfazer esta baixa e voltar a conta para Pendente"
            style={{ backgroundColor: 'transparent', border: '1px solid #f59e0b', color: '#f59e0b', cursor: 'pointer', borderRadius: '4px', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px' }}
          >
            <Undo2 size={13} /> Estornar
          </button>
        )}
      </div>
    ) : (
    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
      {(!t.osId && !t.vendaId) && (
        <>
          {podePagarEditar && (
          <button
            onClick={() => handleEdit(t)}
            style={{ backgroundColor: '#f59e0b', border: 'none', color: 'white', cursor: 'pointer', borderRadius: '4px', padding: '6px 10px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px', transition: 'filter 0.2s' }}
            title="Editar Despesa"
            onMouseOver={(e) => e.currentTarget.style.filter = 'brightness(1.1)'}
            onMouseOut={(e) => e.currentTarget.style.filter = 'brightness(1)'}
          >
            <Edit size={14} />
          </button>
          )}
          {podePagarCancelar && (
          <button
            onClick={() => handleCancelar(t)}
            style={{ backgroundColor: '#ef4444', border: 'none', color: 'white', cursor: 'pointer', borderRadius: '4px', padding: '6px 10px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px', transition: 'filter 0.2s' }}
            title="Cancelar Despesa"
            onMouseOver={(e) => e.currentTarget.style.filter = 'brightness(1.1)'}
            onMouseOut={(e) => e.currentTarget.style.filter = 'brightness(1)'}
          >
            <XCircle size={14} />
          </button>
          )}
        </>
      )}
      {/* Cheque emitido (24/11/2026): o mesmo Dar Baixa, ja' em Cheque e no banco do cheque. */}
      {podePagarBaixar && (
      <button
        onClick={() => handleConciliar(t)}
        title={t.formaPagamento === 'Cheque' || t.cheque ? `Cheque nº ${t.cheque?.numeroCheque || '-'}: dê baixa quando ele compensar (o valor sai do banco nessa hora).` : undefined}
        style={{ backgroundColor: '#10b981', border: 'none', color: 'white', cursor: 'pointer', borderRadius: '4px', padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px', transition: 'filter 0.2s' }}
        onMouseOver={(e) => e.currentTarget.style.filter = 'brightness(1.1)'}
        onMouseOut={(e) => e.currentTarget.style.filter = 'brightness(1)'}
      >
        <CheckCircle size={14} /> Dar Baixa
      </button>
      )}
    </div>
    )
  );

  // Usa o helper de fuso do projeto (America/Sao_Paulo, Secao 1.4 do plano)
  // em vez de new Date().toISOString(), que e' UTC -- de madrugada o UTC ja
  // virou o dia seguinte e "Pago Hoje"/dias de atraso saiam errados.
  const hojeStr = getDateInputInTimeZone();

  // Olhinho (21/11/2026): esconde os totais do topo junto com as outras telas.
  const { mostrar: mostrarValor } = useValoresOcultos();

  // O que aparece na lista: situacao (em aberto / vencidas / pagas / todas) e
  // periodo. Os cartoes do topo (Total Pendente, Pago Hoje) seguem o total
  // geral -- nao mudam com o filtro.
  // O atalho calcula o intervalo; "personalizado" deixa os campos de/ate
  // mandarem. Situacao e periodo continuam sendo dois eixos separados.
  const intervaloAtalho = intervaloDoAtalhoVencimento(atalhoVencimento, hojeStr);
  const filtroDe = atalhoVencimento === 'personalizado' ? periodoDe : intervaloAtalho.de;
  const filtroAte = atalhoVencimento === 'personalizado' ? periodoAte : intervaloAtalho.ate;

  const titulosFiltrados = transacoes.filter((t) => (
    passaNaSituacaoTitulo(t, hojeStr, situacaoTitulo)
    && passaNoPeriodoDoTitulo(t, situacaoTitulo, filtroDe, filtroAte)
    && passaNoFiltroDeForma(t, formaFiltro)
  ));

  const mostrandoVencidas = situacaoTitulo === 'vencidas';

  const filtrosAtivos = (situacaoTitulo !== SITUACAO_TITULO_PADRAO ? 1 : 0)
    + (atalhoVencimento !== ATALHO_VENCIMENTO_PADRAO ? 1 : 0)
    + (atalhoVencimento === 'personalizado' && (periodoDe || periodoAte) ? 1 : 0)
    + (formaFiltro ? 1 : 0);
  const limparFiltros = () => {
    setFormaFiltro('');
    setSituacaoTitulo(SITUACAO_TITULO_PADRAO);
    setAtalhoVencimento(ATALHO_VENCIMENTO_PADRAO);
    setPeriodoDe('');
    setPeriodoAte('');
  };
  /** Pula pras vencidas (do banner e do vazio) sem mexer no resto. */
  const verVencidas = () => {
    setSituacaoTitulo('vencidas');
    setAtalhoVencimento('todos');
    setPeriodoDe('');
    setPeriodoAte('');
  };
  // Cartoes do painel (28/11/2026): cada um leva a lista para a situacao e o vencimento dele.
  const irPara = (situacao: SituacaoTitulo, atalho: AtalhoVencimento) => {
    setSituacaoTitulo(situacao);
    setAtalhoVencimento(atalho);
    setPeriodoDe('');
    setPeriodoAte('');
  };
  const painel = painelDoContasAPagar(transacoes.map((t) => ({
    status: t.status,
    data: t.data,
    valor: Number(t.valor) || 0,
    dataPagamento: t.dataPagamento,
    descontoCentavos: Number(t.baixaManual?.descontoCentavos) || 0,
  })), hojeStr);
  const listandoPagas = situacaoTitulo === 'pagas';
  const rotuloQuantidade = listandoPagas ? 'Títulos pagos' : situacaoTitulo === 'todas' ? 'Títulos' : 'Títulos em aberto';
  const rotuloValor = listandoPagas ? 'Valor pago (R$)' : situacaoTitulo === 'todas' ? 'Valor (R$)' : 'Valor pendente (R$)';

  // Agrupa os titulos filtrados por fornecedor (compras de XML) ou, na falta
  // dele, pela categoria da despesa. Mesmo padrao de gruposPorCliente em
  // ContasReceber.tsx.
  const gruposPorFornecedor: GrupoDespesa[] = (() => {
    const mapa = new Map<string, GrupoDespesa>();
    titulosFiltrados.forEach((t) => {
      const nomeFornecedor = t.fornecedorNome?.trim();
      const porFornecedor = Boolean(t.fornecedorId || nomeFornecedor);
      const titulo = porFornecedor
        ? (nomeFornecedor || 'Fornecedor não identificado')
        : (t.categoria?.trim() || 'Sem categoria');
      const chave = t.fornecedorId
        ? `forn:${t.fornecedorId}`
        : porFornecedor
          ? `forn-nome:${titulo.toUpperCase()}`
          : `cat:${titulo.toUpperCase()}`;
      const diasAtraso = t.data && t.status === 'Pendente' ? (differenceInCalendarDays(t.data, hojeStr) ?? 0) : 0;

      let grupo = mapa.get(chave);
      if (!grupo) {
        grupo = {
          chave,
          fornecedorId: t.fornecedorId || null,
          titulo,
          porFornecedor,
          transacoes: [],
          totalPendente: 0,
          vencimentoMaisAntigo: null,
          diasAtrasoMax: 0,
        };
        mapa.set(chave, grupo);
      }
      grupo.transacoes.push(t);
      grupo.totalPendente += Number(t.valor || 0);
      if (t.data && (!grupo.vencimentoMaisAntigo || t.data < grupo.vencimentoMaisAntigo)) {
        grupo.vencimentoMaisAntigo = t.data;
      }
      grupo.diasAtrasoMax = Math.max(grupo.diasAtrasoMax, diasAtraso);
    });

    return Array.from(mapa.values())
      .filter((g) => !buscaGrupo.trim() || g.titulo.toLowerCase().includes(buscaGrupo.trim().toLowerCase()))
      // Agrupado, o que importa e' quem vence primeiro -- nao quem deve mais.
      .sort((a, b) => String(a.vencimentoMaisAntigo || '9999-12-31').localeCompare(String(b.vencimentoMaisAntigo || '9999-12-31')));
  })();

  /** A lista que a tela abre: todos os fornecedores juntos, do vencimento
   *  mais proximo pro mais distante. A busca continua valendo (fornecedor,
   *  categoria ou descricao). */
  const titulosPorVencimento = titulosFiltrados
    .filter((t) => {
      const termo = buscaGrupo.trim().toLowerCase();
      if (!termo) return true;
      return [t.fornecedorNome, t.categoria, t.descricao]
        .some((campo) => String(campo || '').toLowerCase().includes(termo));
    })
    .sort((a, b) => String(a.data || '9999-12-31').localeCompare(String(b.data || '9999-12-31')));

  // ---- Baixa em lote: so' conta em aberto; cheque emitido entra desde 24/11/2026 (baixaEmLoteDomain).
  const elegiveis = new Map(titulosFiltrados.filter((t) => podeEntrarNoLote(t, 'saida')).map((t) => [t.id, t]));
  const idsElegiveisDe = (lista: TransacaoData[]) => lista.filter((t) => elegiveis.has(t.id)).map((t) => t.id);
  const idsElegiveisVisiveis = agrupar
    ? gruposPorFornecedor.flatMap((g) => idsElegiveisDe(g.transacoes))
    : idsElegiveisDe(titulosPorVencimento);
  // Velocidade (24/11/2026): a tabela desenha em blocos; totais, selecao e relatorio seguem na lista inteira.
  const blocosDeTitulos = useLinhasEmBlocos(titulosPorVencimento, buscaGrupo);
  const blocosDeGrupos = useLinhasEmBlocos(gruposPorFornecedor, buscaGrupo);
  const selecaoValida = [...selecionados].filter((id) => elegiveis.has(id));
  const marcar = (ids: string[], marcarIds: boolean) => {
    const { selecao, deFora } = marcarNaSelecao(selecionados, ids, marcarIds);
    setSelecionados(selecao);
    if (deFora > 0) {
      showWarning(`Até ${LIMITE_BAIXA_EM_LOTE} contas por vez`, `${deFora} ${deFora === 1 ? 'conta ficou' : 'contas ficaram'} de fora. Dê baixa nestas e selecione o resto depois.`);
    }
  };
  const centavosDoTitulo = (t: TransacaoData) => toCents(Number(t.valor || 0));
  const totalSelecionadoCentavos = selecaoValida.reduce((soma, id) => soma + centavosDoTitulo(elegiveis.get(id) as TransacaoData), 0);
  const abrirBaixaEmLote = () => {
    if (!podeBaixaLote || !podePagarBaixar) return;
    // O borderô congela ao abrir: as contas pagas saem da lista ao vivo, mas o
    // resultado de cada uma continua na janela.
    setItensDoLote(selecaoValida.map((id) => {
      const t = elegiveis.get(id) as TransacaoData;
      return {
        id: t.id,
        nome: t.fornecedorNome?.trim() || t.categoria?.trim() || 'Sem fornecedor',
        descricao: t.descricao,
        vencimento: t.data || '',
        valorCentavos: centavosDoTitulo(t),
        formaPrevista: formaInicialDaBaixa(t),
      };
    }));
  };
  const fecharBaixaEmLote = (baixados: string[]) => {
    setItensDoLote(null);
    if (baixados.length > 0) setSelecionados((atual) => marcarNaSelecao(atual, baixados, false).selecao);
  };
  const caixaDoTitulo = (t: TransacaoData) => (elegiveis.has(t.id) ? (
    <CaixaDeSelecao
      estado={selecionados.has(t.id) ? 'todos' : 'nenhum'}
      rotulo={`Selecionar ${t.descricao}`}
      onAlternar={(marcarConta) => marcar([t.id], marcarConta)}
    />
  ) : null);
  const classeDaLinha = (t: TransacaoData) => (selecionados.has(t.id) && elegiveis.has(t.id) ? 'lote-linha-marcada' : undefined);

  // O que a lista mostra agora (filtros + busca): base do resumo por forma e do relatorio.
  const titulosDaLista = agrupar ? gruposPorFornecedor.flatMap((g) => g.transacoes) : titulosPorVencimento;
  const resumoPorForma = resumoAPagarPorForma(titulosDaLista);

  const toggleGrupoExpandido = (chave: string) => {
    setGruposExpandidos((current) => {
      const next = new Set(current);
      if (next.has(chave)) next.delete(chave);
      else next.add(chave);
      return next;
    });
  };

  if (previewAberto) {
    const dataBr = (dia: string) => (dia ? dia.split('-').reverse().join('/') : '—');
    const periodoTexto = filtroDe || filtroAte
      ? `${listandoPagas ? 'Pago em' : 'Vencimento'} de ${dataBr(filtroDe)} a ${dataBr(filtroAte)}`
      : ROTULO_ATALHO_VENCIMENTO[atalhoVencimento];
    const filtrosAplicados = [
      `Situação: ${ROTULO_SITUACAO_TITULO[situacaoTitulo]}`,
      `Vencimento: ${ROTULO_ATALHO_VENCIMENTO[atalhoVencimento]}`,
      `Forma de pagamento: ${formaFiltro || 'Todas'}`,
      buscaGrupo.trim() ? `Busca: "${buscaGrupo.trim()}"` : '',
      agrupar ? 'Agrupado por fornecedor na tela' : '',
    ].filter(Boolean);
    return (
      <RelatorioPreview
        relatorioId="contas-pagar"
        documento={montarDocumentoContasPagar(titulosDaLista, { filtrosAplicados, periodo: periodoTexto, dataHoje: hojeStr })}
        nomeArquivo={nomeArquivoRelatorio('Contas a Pagar', filtroDe, filtroAte)}
        onFechar={() => setPreviewAberto(false)}
        rotuloFechar="Voltar ao Contas a Pagar"
      />
    );
  }

  return (
    <div className="financeiro-page" style={{ padding: '24px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>Contas a Pagar</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>O que a empresa tem para pagar, por vencimento</p>
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
          <BotaoOlhoValores />
          <MenuMaisOpcoes
            itens={[
              ...(podeVerCreditos ? [{
                texto: 'O que os fornecedores devem', Icone: Wallet,
                titulo: 'Fornecedores que devem à empresa (devolução ao fornecedor, conta lançada à mão) e de onde vem cada valor',
                onClick: () => setCreditosAbertos({ alvo: null }),
              }] : []),
              ...(podeImportar ? [{ texto: 'Importar títulos', Icone: Upload, onClick: () => openTab('/financeiro/contas-pagar/importar', 'Importar Contas a Pagar') }] : []),
              ...(podeRelatorios ? [{
                texto: 'Relatório', Icone: FileText,
                titulo: 'Abre em PDF as contas da lista, com os filtros da tela (situação, vencimento, forma e busca). Dali dá para imprimir, salvar o PDF ou salvar em Excel',
                desabilitado: loading,
                onClick: () => setPreviewAberto(true),
              }] : []),
            ]}
          />
          {podePagarLancar && (
          <button className="btn-primary pagar-botao-lancar" onClick={handleOpenModal}>
            <Plus size={18} style={{ marginRight: 8 }} />
            Lançar despesa
          </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div className="search-bar" style={{ position: 'relative', width: '360px', maxWidth: '100%' }}>
          <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <CampoBuscaAdiado
            placeholder="Buscar fornecedor ou categoria..."
            valor={buscaGrupo}
            aoMudar={setBuscaGrupo}
            style={{ width: '100%', padding: '10px 14px 10px 40px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
          />
        </div>
        <button
          type="button"
          onClick={() => setAgrupar((v) => !v)}
          title={agrupar ? 'Ver como lista, por data de vencimento' : 'Somar por fornecedor'}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 14px',
            backgroundColor: agrupar ? 'var(--accent-purple)' : 'var(--bg-tertiary)',
            color: agrupar ? '#fff' : 'var(--text-primary)',
            border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
            fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          <Truck size={16} />
          Agrupar por fornecedor
        </button>
        <BotaoFiltros aberto={filtrosAbertos} onToggle={() => setFiltrosAbertos((v) => !v)} quantidadeAtiva={filtrosAtivos} />
      </div>

      {/* Painel (28/11/2026, redesenho pedido pelo dono): cada cartao e' um atalho de
          filtro. Conta vencida nunca some da tela: o cartao "Vencidas" fica sempre a vista. */}
      <div className="pagar-painel" role="group" aria-label="Resumo do Contas a Pagar">
        {([
          { chave: 'vencidas', rotulo: 'Vencidas', numero: painel.vencidas, tom: 'vermelho', ativo: mostrandoVencidas, acao: verVencidas, dica: 'Contas que já passaram do vencimento e continuam em aberto' },
          { chave: 'hoje', rotulo: 'Vencem hoje', numero: painel.hoje, tom: 'ambar', ativo: situacaoTitulo === 'abertas' && atalhoVencimento === 'hoje', acao: () => irPara('abertas', 'hoje'), dica: 'Contas em aberto que vencem hoje' },
          { chave: 'semana', rotulo: 'Esta semana', numero: painel.semana, tom: 'violeta', ativo: situacaoTitulo === 'abertas' && atalhoVencimento === 'semana', acao: () => irPara('abertas', 'semana'), dica: 'Contas em aberto que vencem de segunda a domingo desta semana' },
          { chave: 'aberto', rotulo: 'Em aberto', numero: painel.emAberto, tom: 'neutro', ativo: situacaoTitulo === 'abertas' && atalhoVencimento === 'todos', acao: () => irPara('abertas', 'todos'), dica: 'Tudo o que falta pagar, de qualquer data' },
          { chave: 'pago', rotulo: 'Pago hoje', numero: painel.pagoHoje, tom: 'verde', ativo: situacaoTitulo === 'pagas' && atalhoVencimento === 'hoje', acao: () => irPara('pagas', 'hoje'), dica: 'O que foi pago hoje' },
        ] as const).map((c) => (
          <button key={c.chave} type="button" className={`pagar-cartao pagar-cartao--${c.tom}`} aria-pressed={c.ativo} onClick={c.acao} title={c.dica}>
            <span className="pagar-cartao-rotulo">{c.rotulo}</span>
            <strong className="pagar-cartao-valor">{mostrarValor(new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c.numero.centavos / 100))}</strong>
            <span className="pagar-cartao-qtd">{c.numero.quantidade} {c.numero.quantidade === 1 ? 'conta' : 'contas'}</span>
          </button>
        ))}
      </div>

      <div className="pagar-atalhos" role="group" aria-label={listandoPagas ? 'Pago em' : 'Vencimento'}>
        <span className="pagar-atalhos-rotulo">{listandoPagas ? 'Pago em' : 'Vencimento'}</span>
        {(Object.keys(ROTULO_ATALHO_VENCIMENTO) as AtalhoVencimento[]).map((chave) => (
          <button
            key={chave}
            type="button"
            className="pagar-chip"
            aria-pressed={atalhoVencimento === chave}
            onClick={() => { setAtalhoVencimento(chave); if (chave === 'personalizado') setFiltrosAbertos(true); }}
          >
            {chave === 'hoje' ? (listandoPagas ? 'Hoje' : 'Vencem hoje') : ROTULO_ATALHO_VENCIMENTO[chave]}
          </button>
        ))}
      </div>
      <PainelFiltros aberto={filtrosAbertos} quantidadeAtiva={filtrosAtivos} onLimpar={limparFiltros}>
        <CampoFiltro rotulo="Situação">
          <select value={situacaoTitulo} onChange={(e) => setSituacaoTitulo(e.target.value as SituacaoTitulo)} style={estiloCampoFiltro}>
            {(Object.keys(ROTULO_SITUACAO_TITULO) as SituacaoTitulo[]).map((chave) => (
              <option key={chave} value={chave}>{ROTULO_SITUACAO_TITULO[chave]}</option>
            ))}
          </select>
        </CampoFiltro>
        <CampoFiltro rotulo={listandoPagas ? 'Pago em' : 'Vencimento'}>
          <select
            value={atalhoVencimento}
            onChange={(e) => setAtalhoVencimento(e.target.value as AtalhoVencimento)}
            style={estiloCampoFiltro}
          >
            {(Object.keys(ROTULO_ATALHO_VENCIMENTO) as AtalhoVencimento[]).map((chave) => (
              <option key={chave} value={chave}>{ROTULO_ATALHO_VENCIMENTO[chave]}</option>
            ))}
          </select>
        </CampoFiltro>
        {atalhoVencimento === 'personalizado' && (
          <CampoPeriodo
            rotulo="De / até"
            de={periodoDe}
            ate={periodoAte}
            onChangeDe={setPeriodoDe}
            onChangeAte={setPeriodoAte}
          />
        )}
        <CampoFiltro rotulo="Forma de pagamento">
          <select value={formaFiltro} onChange={(e) => setFormaFiltro(e.target.value)} style={estiloCampoFiltro}>
            <option value="">Todas</option>
            {FORMAS_DO_FILTRO.map((forma) => <option key={forma} value={forma}>{forma}</option>)}
          </select>
        </CampoFiltro>
      </PainelFiltros>
      {resumoPorForma.length > 0 && (
        <div className="pagar-formas">
          <span className="pagar-formas-rotulo">Em aberto na lista, por forma</span>
          {resumoPorForma.map((linha) => (
            <span key={linha.forma} className="pagar-forma">
              {linha.forma} <strong>{mostrarValor(new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(linha.centavos / 100))}</strong>
            </span>
          ))}
        </div>
      )}

      <div className="card lote-tom-saida" style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
        <div className="table-wrapper">
          {!agrupar ? (
            /* LISTA POR VENCIMENTO -- o modo padrao. Todos os fornecedores
               juntos, do que vence primeiro pro que vence depois. */
            <table className="data-table financeiro-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <th style={{ padding: '8px 0 8px 8px', width: '44px' }}>
                  <CaixaDeSelecao
                    estado={estadoDaSelecao(selecionados, idsElegiveisVisiveis)}
                    rotulo="Selecionar todas as contas em aberto da lista"
                    desabilitada={idsElegiveisVisiveis.length === 0}
                    onAlternar={(marcarTodos) => marcar(idsElegiveisVisiveis, marcarTodos)}
                  />
                  </th>
                  <th style={{ padding: '16px' }}>Vencimento</th>
                  <th style={{ padding: '16px' }}>Fornecedor</th>
                  <th style={{ padding: '16px' }}>Descrição</th>
                  <th style={{ padding: '16px' }}>Categoria</th>
                  <th style={{ padding: '16px' }}>Forma</th>
                  <th style={{ padding: '16px', textAlign: 'right' }}>Valor (R$)</th>
                  <th style={{ padding: '16px', textAlign: 'center' }}>Ação</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: '20px' }}>Carregando contas a pagar...</td></tr>
                ) : titulosPorVencimento.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                      <CheckCircle size={48} color="#10b981" style={{ margin: '0 auto 16px', opacity: 0.5 }} />
                      <div>
                        {buscaGrupo.trim()
                          ? 'Nenhum título encontrado com essa busca.'
                          : atalhoVencimento === 'hoje' && situacaoTitulo === SITUACAO_TITULO_PADRAO
                            ? 'Nenhuma conta vence hoje.'
                            : 'Nenhum título encontrado com esses filtros.'}
                      </div>
                      {atalhoVencimento === 'hoje' && situacaoTitulo === SITUACAO_TITULO_PADRAO && (
                        <button
                          type="button"
                          onClick={() => setAtalhoVencimento('todos')}
                          style={{ marginTop: '14px', padding: '8px 16px', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                        >
                          Ver todas as contas em aberto
                        </button>
                      )}
                    </td>
                  </tr>
                ) : blocosDeTitulos.visiveis.map((t) => {
                  const diasAtraso = t.data && t.status === 'Pendente' ? (differenceInCalendarDays(t.data, hojeStr) ?? 0) : 0;
                  const venceHoje = t.data === hojeStr && t.status === 'Pendente';
                  return (
                    <tr key={t.id} className={classeDaLinha(t)} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '4px 0 4px 8px' }}>{caixaDoTitulo(t)}</td>
                      <td style={{ padding: '16px' }}>
                        <div className="pagar-vencimento">
                          <span>{t.data ? t.data.split('-').reverse().join('/') : '-'}</span>
                          {diasAtraso > 0 && <span className="pagar-selo pagar-selo--vermelho">vencida há {diasAtraso} {diasAtraso === 1 ? 'dia' : 'dias'}</span>}
                          {venceHoje && <span className="pagar-selo pagar-selo--ambar">vence hoje</span>}
                          {t.status === 'Paga' && <span className="pagar-selo pagar-selo--verde">paga{t.dataPagamento ? ` em ${t.dataPagamento.split('-').reverse().join('/')}` : ''}</span>}
                        </div>
                      </td>
                      <td style={{ padding: '16px', fontWeight: 600 }}>
                        {t.fornecedorNome
                          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}><Truck size={15} style={{ color: 'var(--text-muted)' }} />{t.fornecedorNome}</span>
                          : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td style={{ padding: '16px' }}>
                        {t.descricao}
                        {textoDoParcial(t as { pagoParcialCentavos?: number; valorAntesDoParcialCentavos?: number }, true) && (
                          <div style={{ fontSize: '11px', fontWeight: 600, color: '#ef4444', marginTop: '2px' }}>
                            {textoDoParcial(t as { pagoParcialCentavos?: number; valorAntesDoParcialCentavos?: number }, true)}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '16px' }}>
                        <span className="pagar-categoria">{t.categoria}</span>
                      </td>
                      <td style={{ padding: '16px', fontSize: '13px', color: formaDoTitulo(t) ? 'var(--text-primary)' : 'var(--text-muted)' }}>{rotuloDaFormaDoTitulo(t)}</td>
                      <td className={`pagar-valor${t.status === 'Paga' ? ' pagar-valor--pago' : ''}`}>
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(t.valor))}
                      </td>
                      <td style={{ padding: '16px', textAlign: 'center' }}>{acoesDoTitulo(t)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
          <table className="data-table financeiro-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ padding: '8px 0 8px 8px', width: '44px' }}>
                  <CaixaDeSelecao
                    estado={estadoDaSelecao(selecionados, idsElegiveisVisiveis)}
                    rotulo="Selecionar todas as contas em aberto da lista"
                    desabilitada={idsElegiveisVisiveis.length === 0}
                    onAlternar={(marcarTodos) => marcar(idsElegiveisVisiveis, marcarTodos)}
                  />
                </th>
                <th style={{ padding: '16px 0', width: '24px' }}></th>
                <th style={{ padding: '16px' }}>Fornecedor / Categoria</th>
                <th style={{ padding: '16px', textAlign: 'center' }}>{rotuloQuantidade}</th>
                <th style={{ padding: '16px' }}>Vencimento mais antigo</th>
                <th style={{ padding: '16px', textAlign: 'right' }}>{rotuloValor}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '20px' }}>Carregando contas a pagar...</td>
                </tr>
              ) : gruposPorFornecedor.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    <CheckCircle size={48} color="#10b981" style={{ margin: '0 auto 16px', opacity: 0.5 }} />
                    <div>{buscaGrupo.trim() || filtrosAtivos > 0 ? 'Nenhum título encontrado com esses filtros.' : 'Tudo em dia! Nenhuma conta pendente para pagamento.'}</div>
                  </td>
                </tr>
              ) : (
                blocosDeGrupos.visiveis.map((grupo) => {
                  const expandido = gruposExpandidos.has(grupo.chave);
                  const emAtraso = grupo.diasAtrasoMax > 0;
                  const idsDoGrupo = idsElegiveisDe(grupo.transacoes);
                  const estadoDoGrupo = estadoDaSelecao(selecionados, idsDoGrupo);
                  return (
                    <React.Fragment key={grupo.chave}>
                      <tr
                        onClick={() => toggleGrupoExpandido(grupo.chave)}
                        className={estadoDoGrupo === 'todos' ? 'lote-linha-marcada' : undefined}
                        style={{ borderBottom: expandido ? 'none' : '1px solid var(--border-color)', cursor: 'pointer', backgroundColor: expandido ? 'var(--bg-tertiary)' : 'transparent' }}
                      >
                        <td style={{ padding: '8px 0 8px 8px' }}>
                          {idsDoGrupo.length > 0 && (
                            <CaixaDeSelecao
                              estado={estadoDoGrupo}
                              rotulo={`Selecionar as contas em aberto de ${grupo.titulo}`}
                              onAlternar={(marcarGrupo) => marcar(idsDoGrupo, marcarGrupo)}
                            />
                          )}
                        </td>
                        <td style={{ padding: '16px 0', color: 'var(--text-muted)' }}>
                          {expandido ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                        </td>
                        <td style={{ padding: '16px', fontWeight: 600 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {grupo.porFornecedor
                              ? <Truck size={16} style={{ color: 'var(--text-muted)' }} />
                              : <Tag size={16} style={{ color: 'var(--text-muted)' }} />}
                            {grupo.titulo}
                            {podeVerCreditos && deveAEmpresa(grupo.fornecedorId) > 0 && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setCreditosAbertos({ alvo: { id: grupo.fornecedorId || '', nome: grupo.titulo } }); }}
                                title="Este fornecedor deve à empresa: ver de onde vem"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 600, color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.4)', borderRadius: '4px', padding: '1px 6px', background: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}
                              >
                                <Wallet size={12} /> Deve à empresa {mostrarValor(new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(deveAEmpresa(grupo.fornecedorId) / 100))}
                              </button>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: '16px', textAlign: 'center', color: 'var(--text-secondary)' }}>{grupo.transacoes.length}</td>
                        <td style={{ padding: '16px' }}>
                          {grupo.vencimentoMaisAntigo ? (
                            <span style={{ color: emAtraso ? '#ef4444' : 'var(--text-secondary)', fontWeight: emAtraso ? 700 : 400 }}>
                              {grupo.vencimentoMaisAntigo.split('-').reverse().join('/')}
                              {emAtraso && ` (${grupo.diasAtrasoMax} ${grupo.diasAtrasoMax === 1 ? 'dia' : 'dias'} em atraso)`}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>-</span>
                          )}
                        </td>
                        <td className="pagar-valor">
                          {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(grupo.totalPendente)}
                        </td>
                      </tr>
                      {expandido && (
                        <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td colSpan={6} style={{ padding: '0 16px 16px 48px', backgroundColor: 'var(--bg-tertiary)' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                              <thead>
                                <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                  <th style={{ padding: '10px 0', width: '44px' }}><span className="lote-so-leitor">Selecionar</span></th>
                                  <th style={{ padding: '10px 8px', fontSize: '12px', color: 'var(--text-muted)' }}>Vencimento</th>
                                  <th style={{ padding: '10px 8px', fontSize: '12px', color: 'var(--text-muted)' }}>Descrição</th>
                                  <th style={{ padding: '10px 8px', fontSize: '12px', color: 'var(--text-muted)' }}>Categoria</th>
                                  <th style={{ padding: '10px 8px', fontSize: '12px', color: 'var(--text-muted)' }}>Forma</th>
                                  <th style={{ padding: '10px 8px', fontSize: '12px', color: 'var(--text-muted)', textAlign: 'right' }}>Valor (R$)</th>
                                  <th style={{ padding: '10px 8px', fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center' }}>Ação</th>
                                </tr>
                              </thead>
                              <tbody>
                                {grupo.transacoes.map((t) => (
                                  <tr key={t.id} className={classeDaLinha(t)} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                    <td style={{ padding: '4px 0' }}>{caixaDoTitulo(t)}</td>
                                    <td style={{ padding: '10px 8px', color: 'var(--text-muted)' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <Calendar size={14} />
                                        {t.data ? t.data.split('-').reverse().join('/') : '-'}
                                      </div>
                                    </td>
                                    <td style={{ padding: '10px 8px', fontWeight: 500 }}>
                                      {t.descricao}
                                      {textoDoParcial(t as { pagoParcialCentavos?: number; valorAntesDoParcialCentavos?: number }, true) && (
                                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#ef4444', marginTop: '2px' }}>
                                          {textoDoParcial(t as { pagoParcialCentavos?: number; valorAntesDoParcialCentavos?: number }, true)}
                                        </div>
                                      )}
                                    </td>
                                    <td style={{ padding: '10px 8px' }}>
                                      <span className="pagar-categoria">{t.categoria}</span>
                                    </td>
                                    <td style={{ padding: '10px 8px', fontSize: '12.5px', color: formaDoTitulo(t) ? 'var(--text-primary)' : 'var(--text-muted)' }}>{rotuloDaFormaDoTitulo(t)}</td>
                                    <td className={`pagar-valor pagar-valor--compacto${t.status === 'Paga' ? ' pagar-valor--pago' : ''}`}>
                                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(t.valor))}
                                    </td>
                                    <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                                      {acoesDoTitulo(t)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
          )}
        </div>
        <MostrarMaisLinhas blocos={agrupar ? blocosDeGrupos : blocosDeTitulos} />
      </div>

      <BarraDeSelecaoLote
        tipo="saida"
        quantidade={selecaoValida.length}
        totalCentavos={totalSelecionadoCentavos}
        onLimpar={() => setSelecionados(new Set())}
        onDarBaixa={abrirBaixaEmLote}
        semPermissaoDeBaixa={!podePagarBaixar
          ? semPermissao(PERMISSAO_FINANCEIRO.pagarBaixar, 'dar baixa em contas a pagar')
          : !podeBaixaLote ? semPermissao(PERMISSAO_FINANCEIRO.baixaLote, 'dar baixa em lote') : undefined}
      />
      {itensDoLote && tenantId && (
        <BaixaEmLoteModal
          tipo="saida"
          itens={itensDoLote}
          tenantId={tenantId}
          podeDescontar={podeDescontar}
          podeJurosMulta={podeJurosMulta}
          podeDataAnterior={podeDataAnterior}
          onFechar={fecharBaixaEmLote}
        />
      )}

      {/* Modal de Novo Lançamento */}
      {isModalOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: (!editingId && (parcelarDespesa || formaDespesa === 'Cheque')) ? '980px' : '500px',
            maxHeight: '92vh', overflowY: 'auto',
            border: '1px solid var(--border-color)', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)', overflow: 'hidden auto'
          }}>
            <div style={{
              padding: '20px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
            }}>
              <h2 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', color: '#ef4444' }}>
                <ArrowDownCircle size={24} />
                {editingId ? 'Editar Despesa' : 'Lançar Conta a Pagar'}
              </h2>
              <button onClick={() => setIsModalOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={24} />
              </button>
            </div>
            
            <form onSubmit={handleSave} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                  Fornecedor <span style={{ color: 'var(--text-muted)' }}>(opcional — aluguel, luz e imposto não têm)</span>
                </label>
                <ClientAutocomplete
                  value={buscaFornecedor}
                  onChange={(valor) => {
                    setBuscaFornecedor(valor);
                    // Apagou o nome: desvincula. Sem isto o titulo ficaria
                    // preso a um fornecedor que nao esta mais escrito na tela.
                    if (!valor.trim()) setFormData((atual) => ({ ...atual, fornecedorId: '', fornecedorNome: '' }));
                  }}
                  clients={fornecedoresAtivos}
                  onSelect={(fornecedor) => {
                    const nome = String(fornecedor.nome || '').trim();
                    setFormData((atual) => ({
                      ...atual,
                      fornecedorId: fornecedor.id,
                      fornecedorNome: nome,
                      // Descricao ainda vazia ganha o nome do fornecedor: e' o
                      // que a pessoa escreveria a mao logo em seguida.
                      descricao: atual.descricao.trim() ? atual.descricao : nome,
                    }));
                    setBuscaFornecedor(nome);
                  }}
                  renderItem={(fornecedor) => (
                    <span>{fornecedor.codigo ? `${fornecedor.codigo} · ${fornecedor.nome}` : fornecedor.nome}</span>
                  )}
                  placeholder="Buscar fornecedor por nome ou código..."
                  ariaLabel="Buscar fornecedor"
                  emptyHint={<span>Nenhum fornecedor com esse nome. Cadastre em Cadastros &gt; Fornecedores, ou deixe em branco.</span>}
                />
              </div>

              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Descrição</label>
                <input 
                  type="text" 
                  value={formData.descricao}
                  onChange={(e) => setFormData({...formData, descricao: aplicarCaixaAltaCadastro(e.target, e.target.value)})} 
                  style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px', color: 'var(--text-primary)', textTransform: 'uppercase' }}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Valor (R$)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={formData.valor} 
                    onChange={(e) => setFormData({...formData, valor: e.target.value})} 
                    style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px', color: 'var(--text-primary)', fontWeight: 600, fontSize: '16px' }}
                    required
                  />
                </div>
                <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Data de Vencimento</label>
                  <input 
                    type="date" 
                    value={formData.data} 
                    onChange={(e) => setFormData({...formData, data: e.target.value})} 
                    style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px', color: 'var(--text-primary)' }}
                    required
                  />
                </div>
              </div>

              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Categoria (Plano de Contas)</label>
                <select 
                  value={formData.categoria} 
                  onChange={(e) => setFormData({...formData, categoria: e.target.value})}
                  style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px', color: 'var(--text-primary)' }}
                  required
                >
                  <option value="">Selecione uma categoria...</option>
                  {categoriasDespesa.map((cat, idx) => (
                    <option key={idx} value={cat}>{cat.toUpperCase()}</option>
                  ))}
                </select>
                {/* Categoria nova ali mesmo (19/10/2026): vale para o plano de contas de todas as filiais. */}
                {tenantId && (
                  <NovaCategoriaInline
                    tipo="despesa"
                    tenantId={tenantId}
                    onCriada={(nome, lista) => {
                      setCategoriasDespesa(lista);
                      setFormData((atual) => ({ ...atual, categoria: lista.find((c) => c.toUpperCase() === nome.toUpperCase()) || nome }));
                    }}
                  />
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                    Veículo da frota <span style={{ color: 'var(--text-muted)' }}>(opcional)</span>
                  </label>
                  <select
                    value={veiculoDaDespesa}
                    onChange={(e) => {
                      setVeiculoDaDespesa(e.target.value);
                      // Motorista padrao do veiculo entra sozinho, se ainda nao houver escolha.
                      const padrao = veiculosAtivos.find((v) => v.id === e.target.value)?.motoristaPadraoId;
                      if (padrao && !motoristaDaDespesa) setMotoristaDaDespesa(padrao);
                    }}
                    style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px', color: 'var(--text-primary)' }}
                  >
                    <option value="">Nenhum (despesa geral)</option>
                    {veiculosAtivos.map((v) => <option key={v.id} value={v.id}>{rotuloDoVeiculo(v)}</option>)}
                  </select>
                </div>
                <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Motorista <span style={{ color: 'var(--text-muted)' }}>(opcional)</span></label>
                  <select
                    value={motoristaDaDespesa}
                    onChange={(e) => setMotoristaDaDespesa(e.target.value)}
                    style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px', color: 'var(--text-primary)' }}
                  >
                    <option value="">Nenhum</option>
                    {motoristasAtivos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
                  </select>
                </div>
              </div>
              {veiculosAtivos.length === 0 && (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '-8px' }}>
                  Nenhum veículo na frota ainda. Cadastre em Expedição › Frota para lançar despesas por veículo.
                </div>
              )}

              {!editingId && (
                <>
                  <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Forma de pagamento</label>
                    <select
                      value={formaDespesa}
                      onChange={(e) => prepararParcelas(e.target.value, parcelarDespesa)}
                      style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px', color: 'var(--text-primary)' }}
                    >
                      {FORMAS_DE_PAGAMENTO.map((forma) => <option key={forma} value={forma}>{forma}</option>)}
                    </select>
                  </div>
                  {formaDespesa !== 'Cheque' && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                      <input type="checkbox" checked={parcelarDespesa} onChange={(e) => prepararParcelas(formaDespesa, e.target.checked)} />
                      Parcelar esta despesa em várias vezes
                    </label>
                  )}
                  {(parcelarDespesa || formaDespesa === 'Cheque') && (
                    <ParcelasEditor
                      parcelas={parcelasDespesa}
                      onParcelas={setParcelasDespesa}
                      total={parseFloat(String(formData.valor).replace(',', '.')) || 0}
                      dataBase={getDateInputInTimeZone()}
                      forma={formaDespesa}
                      bancos={bancosParaCheque}
                      aceitas={parcelasAceitas}
                      onAceitar={setParcelasAceitas}
                    />
                  )}
                </>
              )}

              <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={isSaving} style={{ backgroundColor: '#ef4444', borderColor: '#ef4444' }}>
                  {isSaving ? <Loader2 size={18} className="spin-animation" /> : <CheckCircle size={18} />}
                  {(!editingId && (parcelarDespesa || formaDespesa === 'Cheque')) ? 'Lançar parcelas' : 'Salvar Conta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {creditosAbertos && (
        <CreditosModal
          modo="fornecedor"
          alvo={creditosAbertos.alvo}
          onFechar={() => setCreditosAbertos(null)}
          onAbrirPedido={(pedidoId, rotulo) => { setCreditosAbertos(null); void openTab(`/pedidos-venda/visualizar/${pedidoId}`, rotulo); }}
          onAbrirTela={(caminho, rotulo) => { setCreditosAbertos(null); void openTab(caminho, rotulo); }}
        />
      )}
    </div>
  );
};

export default ContasPagar;
