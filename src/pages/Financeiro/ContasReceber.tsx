import React, { useEffect, useMemo, useState } from 'react';
import { collection, query, where, doc, getDoc, getDocs, serverTimestamp, runTransaction } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { showSuccess, showError, showWarning, NexusSwal, escaparHtml } from '../../utils/alerts';
import { CheckCircle, Clock, X, Wallet, AlertCircle, MessageCircle, ChevronDown, ChevronRight, User, Search, Upload, Undo2, FileText, Edit } from 'lucide-react';
import {
  applyPaymentReceipt,
  fromCents,
  legacyPaymentForTransaction,
  paymentRequiresBankAccount,
  summarizePayments,
  tagPaymentAsChequeAwaitingClearance,
  toCents,
  transactionDueDateInput,
  transactionNetAmount,
  type ChequeDetails,
  type PaymentMethod,
  type PaymentRecord, transactionNetCents } from '../../utils/financeDomain';
import { differenceInCalendarDays, getDateInputInTimeZone } from '../../utils/dateTime';
import { hasTenantFullAccess, isPlatformAdminRole } from '../../utils/roles';
import { PERMISSAO_DESCONTO_NA_BAIXA, SEM_AJUSTES, acrescimoDosAjustes, type AjustesDaBaixa } from '../../utils/ajustesDaBaixaDomain';
import { bloqueioDoParcial, principalDaBaixa, textoDoParcial, type TituloParaParcial } from '../../utils/baixaParcialDomain';
import {
  dataBrasileira,
  planejarEstornoReceber,
  validarDataBaixa,
  type TituloParaEstorno,
} from '../../utils/baixaFinanceiraDomain';
import { pedirDadosBaixa } from '../../utils/baixaFinanceiraUi';
import { PARAMETROS_VENDA_PADRAO, acrescimoPorAtraso, descricaoDoAcrescimo, diasDeAtraso, parseParametrosVenda, type ParametrosVenda } from '../../utils/parametrosVendaDomain';
import { emitenteDaConfiguracao, montarRecibo, parseEmissaoDocumentos, parteDoCliente } from '../../utils/documentosCobrancaDomain';
import { gerarPdfRecibo } from '../../utils/documentosCobrancaPdf';
import { mensagemDoDocumento, parseMensagensPadrao } from '../../utils/mensagensPadraoDomain';
import PdfVisualizador from '../../components/common/PdfVisualizador';
import { alterarValorDaParcela, desfazerRenegociacaoDaParcela, estornarBaixaComConfirmacao, prepararCobrancaEmBoleto, registrarBaixa } from '../../services/baixaFinanceiraService';
import RenegociacaoModal, { type ParcelaParaRenegociar } from '../../components/finance/RenegociacaoModal';
import {
  PERMISSAO_RENEGOCIAR,
  STATUS_RENEGOCIADA,
  ehParcelaDeRenegociacao,
  validarMotivoRenegociacao,
  validarTitulosParaRenegociar,
  type RegistroRenegociacao,
} from '../../utils/renegociacaoDomain';
import { FORMA_BOLETO, bloqueioParaCobrarEmBoleto, validarVencimentoDoBoleto, vencimentoSugeridoDoBoleto } from '../../utils/cobrancaEmBoletoDomain';
import {
  bancoDoBoleto,
  carregarBancosComBoleto,
  emitirUmTitulo,
  gerarPdfDoBoleto,
  paraTituloBoleto,
  validarTituloParaEmissao,
  type BancoBoleto,
} from '../../services/boletoEmissaoService';
import {
  PERMISSAO_ALTERAR_VALOR,
  bloqueioParaAlterarValor,
  centavosAtuaisDoTitulo,
  centavosParaAOrigem,
  resumoDaAlteracaoValor,
  valorAlteradoAtivo,
  type AlteracaoValorRegistro,
} from '../../utils/alteracaoValorTituloDomain';
import { pedirNovoValorDaParcela } from '../../utils/alteracaoValorTituloUi';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { filtrarLancamentosVisiveis } from '../../utils/visibilidadeVendasDomain';
import ChequeCaptureModal from '../../components/finance/ChequeCaptureModal';
import {
  ROTULO_SITUACAO_TITULO,
  SITUACAO_TITULO_PADRAO,
  passaNaSituacaoTitulo,
  passaNoPeriodoDoTitulo,
  type SituacaoTitulo,
} from '../../utils/filtroListaDomain';
import { BotaoFiltros, CampoFiltro, CampoPeriodo, PainelFiltros, estiloCampoFiltro } from '../../components/common/PainelFiltros';
import MenuMaisOpcoes from '../../components/common/MenuMaisOpcoes';
import { BaixaEmLoteModal, BarraDeSelecaoLote, CaixaDeSelecao, type ItemDoLote } from '../../components/finance/BaixaEmLote';
import { estadoDaSelecao, LIMITE_BAIXA_EM_LOTE, marcarNaSelecao, podeEntrarNoLote } from '../../utils/baixaEmLoteDomain';
import { useTitulosFinanceiros, type HistoricoDePagas } from '../../hooks/useTitulosFinanceiros';
import './Financeiro.css';

interface TransacaoData extends TituloParaEstorno {
  id: string;
  data: string;
  descricao: string;
  categoria: string;
  valor: number;
  valorCentavos?: number;
  tipo: 'entrada' | 'saida';
  status: 'Paga' | 'Pendente';
  formaPagamento?: string;
  osId?: string;
  dataPagamento?: string;
  createdAt?: any;
  clienteId?: string | null;
  clienteNome?: string;
  pedidoId?: string;
  paymentIndex?: number;
  movimentaCaixaFisico?: boolean;
  naturezaFinanceira?: string;
  dataVencimento?: string;
  dataPrevistaRecebimento?: string;
  sourceType?: string;
  vendedorId?: string;
  usuarioResponsavelId?: string;
  criadoPor?: string;
  /** Valor da parcela alterado a mao (15/10/2026) -- ver alteracaoValorTituloDomain. */
  alteracaoValor?: Partial<AlteracaoValorRegistro> | null;
  /** Parcela NOVA de uma renegociacao (renegociacaoDomain). */
  renegociacao?: Partial<RegistroRenegociacao> | null;
}

interface GrupoCliente {
  chave: string;
  clienteId: string | null;
  clienteNome: string;
  transacoes: TransacaoData[];
  totalPendente: number;
  vencimentoMaisAntigo: string | null;
  diasAtrasoMax: number;
}

/** Regra compartilhada com o Dashboard -- ver transactionDueDateInput. */
const dataReferenciaTransacao = (t: TransacaoData) => transactionDueDateInput(t) || undefined;

const ContasReceber: React.FC = () => {
  const { openTab } = useTabs();
  const { currentUser, tenantId, vendasVisiveisDeUsuarioId, userRole, userPermissions, isOwner } = useAuth();
  const podeEstornar = Boolean(isOwner || isPlatformAdminRole(userRole) || userPermissions?.includes('financeiro.estornar'));
  // Desconto na baixa (15/10/2026): permissao propria; dono e administrador ja' tem.
  const podeDescontar = Boolean(hasTenantFullAccess(userRole, isOwner) || isPlatformAdminRole(userRole) || userPermissions?.includes(PERMISSAO_DESCONTO_NA_BAIXA));
  const podeAlterarValor = Boolean(isOwner || isPlatformAdminRole(userRole) || userPermissions?.includes(PERMISSAO_ALTERAR_VALOR));
  const podeMexerEmBoleto = Boolean(isOwner || isPlatformAdminRole(userRole) || userPermissions?.includes('financeiro.boletos'));
  const podeRenegociar = Boolean(isOwner || isPlatformAdminRole(userRole) || userPermissions?.includes(PERMISSAO_RENEGOCIAR));
  const [renegociando, setRenegociando] = useState<{ clienteNome: string; titulos: ParcelaParaRenegociar[] } | null>(null);
  
  const [modalConciliacao, setModalConciliacao] = useState<{ ativo: boolean, transacao: TransacaoData | null, creditos: any[], saldoTotal: number }>({
    ativo: false, transacao: null, creditos: [], saldoTotal: 0
  });
  const [valorAbater, setValorAbater] = useState<number>(0);
  const [dataBaixaCredito, setDataBaixaCredito] = useState<string>(getDateInputInTimeZone());
  const [isProcessing, setIsProcessing] = useState(false);
  const [chequeBaixaState, setChequeBaixaState] = useState<{ transacao: TransacaoData; bancoId?: string; bancoNome?: string } | null>(null);
  const [clientesExpandidos, setClientesExpandidos] = useState<Set<string>>(new Set());
  const [buscaCliente, setBuscaCliente] = useState('');
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [situacaoTitulo, setSituacaoTitulo] = useState<SituacaoTitulo>(SITUACAO_TITULO_PADRAO);
  const [periodoDe, setPeriodoDe] = useState('');
  const [periodoAte, setPeriodoAte] = useState('');

  // Leitura enxuta (otimizacao de leituras, 2026-10-14 -- useTitulosFinanceiros):
  // em aberto de qualquer data + recebidas de hoje; o historico de recebidas so'
  // quando a lista mostra recebidas, pelo periodo do filtro ou, vazio, o mes
  // atual (decisao do dono). Antes eram todas as entradas desde sempre.
  const listaTemRecebidas = situacaoTitulo === 'pagas' || situacaoTitulo === 'todas';
  const hojeLeitura = getDateInputInTimeZone();
  const historicoDeRecebidas: HistoricoDePagas = !listaTemRecebidas
    ? null
    : (periodoDe || periodoAte ? { de: periodoDe, ate: periodoAte } : { de: `${hojeLeitura.slice(0, 7)}-01`, ate: hojeLeitura });
  const { titulos: titulosLidos, carregando: loading } = useTitulosFinanceiros<TransacaoData>({
    tenantId,
    tipo: 'entrada',
    historico: historicoDeRecebidas,
  });
  const transacoes = useMemo(() => {
    const data = [...titulosLidos];
    data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    // Visibilidade de vendas: some so o que veio de venda de OUTRO
    // vendedor. Recebimento de OS, credito e lancamento manual continuam
    // na lista -- ver src/utils/visibilidadeVendasDomain.ts.
    return filtrarLancamentosVisiveis(data, vendasVisiveisDeUsuarioId);
  }, [titulosLidos, vendasVisiveisDeUsuarioId]);

  // Baixa em lote (2026-10-14): contas marcadas e o borderô congelado ao abrir.
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [itensDoLote, setItensDoLote] = useState<ItemDoLote[] | null>(null);
  // Parametros de venda da filial (fase A, 2026-10-07): juros e multa sugeridos na baixa em atraso.
  const [parametrosVenda, setParametrosVenda] = useState<ParametrosVenda>(PARAMETROS_VENDA_PADRAO);
  // O documento inteiro fica guardado para o recibo de pagamento (fase D): empresa, mensagem padrao e regra de emissao.
  const [configFilial, setConfigFilial] = useState<Record<string, unknown>>({});
  useEffect(() => {
    if (!tenantId) return;
    getDoc(doc(db, 'configuracoes', tenantId))
      .then((snap) => {
        const data = (snap.exists() ? snap.data() : {}) as Record<string, unknown>;
        setConfigFilial(data);
        setParametrosVenda(parseParametrosVenda(data.parametrosVenda));
      })
      .catch(() => { setConfigFilial({}); setParametrosVenda(PARAMETROS_VENDA_PADRAO); });
  }, [tenantId]);
  const emissaoDocumentos = useMemo(() => parseEmissaoDocumentos(configFilial.emissaoDocumentos), [configFilial]);
  const [pdfRecibo, setPdfRecibo] = useState<{ blob: Blob; nome: string } | null>(null);
  // Boleto emitido pelo Dar Baixa (15/10/2026): abre o PDF na hora, como na tela de Boletos.
  const [pdfBoleto, setPdfBoleto] = useState<{ blob: Blob; nome: string } | null>(null);

  /**
   * Recibo de pagamento em PDF (Configuracoes por filial, fase D -- 2026-10-07):
   * o titulo recebido mais os juros/multa da baixa, com a mensagem padrao da
   * filial. Sempre disponivel pelo botao "Recibo" da conta recebida; ao dar
   * baixa, sai conforme a filial configurou (perguntar / sempre / nunca).
   */
  const emitirRecibo = async (t: TransacaoData, dados: { formaPagamento?: string; dataPagamento?: string; acrescimoCentavos?: number; descontoCentavos?: number; principalCentavos?: number }) => {
    try {
      let cadastroCliente: unknown = null;
      if (t.clienteId) {
        const snapCliente = await getDoc(doc(db, 'clientes', t.clienteId));
        if (snapCliente.exists()) cadastroCliente = snapCliente.data();
      }
      const recibo = montarRecibo({
        titulo: {
          id: t.id,
          // Pagamento parcial (16/10/2026): o recibo e' do que entrou agora.
          descricao: dados.principalCentavos !== undefined ? `${t.descricao} (pagamento parcial)` : t.descricao,
          valorCentavos: dados.principalCentavos ?? transactionNetCents(t),
          formaPagamento: dados.formaPagamento || t.formaPagamento,
          dataPagamento: dados.dataPagamento || t.dataPagamento || getDateInputInTimeZone(),
        },
        acrescimoCentavos: dados.acrescimoCentavos,
        descontoCentavos: dados.descontoCentavos,
        empresa: emitenteDaConfiguracao(configFilial),
        cliente: parteDoCliente(cadastroCliente, t.clienteNome || 'Cliente'),
        mensagem: mensagemDoDocumento(parseMensagensPadrao(configFilial.mensagensPadrao), 'recibo'),
      });
      setPdfRecibo({ blob: gerarPdfRecibo(recibo, emissaoDocumentos.recibo.vias), nome: `RECIBO ${recibo.numero} - ${recibo.pagador.nome}.pdf` });
    } catch (error) {
      console.error('Erro ao gerar o recibo:', error);
      showError('Não foi possível gerar o recibo', error instanceof Error ? error.message : 'Tente de novo pelo botão Recibo da conta recebida.');
    }
  };

  const oferecerRecibo = async (t: TransacaoData, dados: { formaPagamento?: string; dataPagamento?: string; acrescimoCentavos?: number; descontoCentavos?: number; principalCentavos?: number }) => {
    const modo = emissaoDocumentos.recibo.modo;
    if (modo === 'nunca') return;
    if (modo === 'perguntar') {
      const resposta = await NexusSwal.fire({
        title: 'Emitir recibo de pagamento?',
        text: `Recibo de ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(((dados.principalCentavos ?? transactionNetCents(t)) + (dados.acrescimoCentavos || 0) - (dados.descontoCentavos || 0)) / 100)} para ${t.clienteNome || 'o cliente'}.`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Emitir recibo',
        cancelButtonText: 'Agora não',
      });
      if (!resposta.isConfirmed) return;
    }
    await emitirRecibo(t, dados);
  };

  /** Juros/multa e desconto da baixa, para o recibo manual repetir o valor recebido de fato. */
  const ajustesDoRecibo = (t: TransacaoData) => ({
    acrescimoCentavos: Math.max(0, Math.round(Number(t.baixaManual?.acrescimoCentavos) || 0)),
    descontoCentavos: Math.max(0, Math.round(Number(t.baixaManual?.descontoCentavos) || 0)),
  });

  /**
   * Baixa de Receber pelo servidor (services/baixaFinanceiraService): titulo,
   * saldo do banco e venda/OS de origem numa transacao so', gravados la'.
   */
  const confirmarRecebimento = async (
    t: TransacaoData,
    formaPgto: PaymentMethod,
    bancoId?: string,
    dataRecebimento: string = getDateInputInTimeZone(),
    ajustes: AjustesDaBaixa = SEM_AJUSTES,
    valorRecebidoCentavos?: number,
  ) => {
    if (!tenantId || !currentUser) return;
    await registrarBaixa({
      tipo: 'entrada',
      transacaoId: t.id,
      formaPagamento: formaPgto,
      // Dia em que o dinheiro entrou de verdade (pode ser anterior a hoje).
      dataPagamento: dataRecebimento,
      ...(bancoId ? { bancoId } : {}),
      ajustes,
      ...(valorRecebidoCentavos ? { valorRecebidoCentavos } : {}),
      tenantId,
    });
  };

  /**
   * Baixa em cheque NÃO pode confirmar na hora, diferente de
   * confirmarRecebimento (que marca Paga e credita o banco na mesma
   * transação, sempre). Cheque só é Paga de verdade quando compensa --
   * até lá fica Pendente, com os dados do cheque anexados, e aparece na
   * fila de Financeiro > Cheques (mesmo caminho de um cheque capturado já
   * na venda/OS).
   */
  const registrarChequeParaCompensar = async (
    t: TransacaoData,
    dadosCheque: ChequeDetails,
    bancoId?: string,
    bancoNome?: string,
  ) => {
    if (!tenantId || !currentUser) return;
    const transactionRef = doc(db, 'transacoes', t.id);

    await runTransaction(db, async (transaction) => {
      const transactionSnap = await transaction.get(transactionRef);
      if (!transactionSnap.exists()) throw new Error('Conta a receber não encontrada.');
      const transactionData = transactionSnap.data();
      if (transactionData.status === 'Paga') return;
      if (transactionData.status === 'Cancelada') {
        throw new Error('Uma conta cancelada não pode ser recebida.');
      }
      if (transactionData.status === STATUS_RENEGOCIADA) {
        throw new Error('Esta parcela foi renegociada. Receba pelas parcelas da renegociação (ou desfaça a renegociação).');
      }

      let sourceRef = null;
      let sourceSnap = null;
      const saleId = transactionData.pedidoId || t.pedidoId;
      const serviceOrderId = transactionData.osId || t.osId;
      if (saleId) {
        sourceRef = doc(db, 'pedidos_venda', saleId);
        sourceSnap = await transaction.get(sourceRef);
      } else if (serviceOrderId) {
        sourceRef = doc(db, 'ordens_de_servico', serviceOrderId);
        sourceSnap = await transaction.get(sourceRef);
      }
      if (sourceSnap?.exists() && sourceSnap.data().status === 'Cancelada') {
        throw new Error(saleId ? 'A venda vinculada está cancelada.' : 'A OS vinculada está cancelada.');
      }

      transaction.update(transactionRef, {
        formaPagamentoOriginal: transactionData.formaPagamentoOriginal || transactionData.formaPagamento || null,
        formaPagamento: 'Cheque',
        cheque: dadosCheque,
        dataPrevistaRecebimento: dadosCheque.dataCompensacao,
        ...(bancoId ? { bancoId, bancoNome: bancoNome || null } : {}),
        updatedAt: serverTimestamp(),
        ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Baixa registrada em cheque, aguardando compensação'),
      });

      if (sourceRef && sourceSnap?.exists()) {
        const sourceData = sourceSnap.data();
        const payments: PaymentRecord[] = Array.isArray(sourceData.pagamentos) && sourceData.pagamentos.length > 0
          ? sourceData.pagamentos
          : [legacyPaymentForTransaction(t.id, transactionData)];
        const updatedPayments = tagPaymentAsChequeAwaitingClearance(payments, {
          transactionId: t.id,
          paymentIndex: transactionData.paymentIndex,
          cheque: dadosCheque,
          bancoId,
          bancoNome,
        });

        transaction.update(sourceRef, {
          pagamentos: updatedPayments,
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Baixa registrada em cheque, aguardando compensação'),
        });
      }
    });
  };

  const solicitarFormaRecebimento = async (t: TransacaoData) => {
    const FORMAS_RECEBIMENTO = ['Dinheiro', 'Pix', 'Cartão de Crédito', 'Cartão de Débito', 'Transferência', 'Cheque', 'Outros'];
    // Boleto (15/10/2026): so' com banco preparado para boleto e permissao de Boletos.
    // Escolher "Boleto" nao da' baixa -- emite o boleto (emitirBoletoPelaBaixa).
    let bancosComBoleto: BancoBoleto[] = [];
    if (tenantId && podeMexerEmBoleto && !bloqueioParaCobrarEmBoleto({ ...t, tipo: t.tipo || 'entrada' })) {
      try {
        bancosComBoleto = await carregarBancosComBoleto(tenantId);
      } catch (erro) {
        console.warn('Contas a Receber: não foi possível conferir os bancos de boleto.', erro);
      }
    }
    const formas = bancosComBoleto.length > 0 ? [...FORMAS_RECEBIMENTO, FORMA_BOLETO] : FORMAS_RECEBIMENTO;
    // Titulo vencido com juros/multa configurados na filial: ja' vem preenchido (editavel).
    const sugestao = acrescimoPorAtraso(parametrosVenda, transactionNetCents(t), t.dataVencimento, getDateInputInTimeZone());
    const semPercentuais = parametrosVenda.juros.aoMesPercentual <= 0 && parametrosVenda.juros.multaPercentual <= 0;
    const vencido = diasDeAtraso(t.dataVencimento, getDateInputInTimeZone()) > 0;
    const dados = await pedirDadosBaixa({
      titulo: 'Confirmar Recebimento?',
      texto: `Valor líquido de R$ ${transactionNetAmount(t).toFixed(2)} referente a ${t.descricao}.`,
      valorCentavos: transactionNetCents(t),
      rotuloValor: 'Valor recebido agora',
      // Pagamento parcial (16/10/2026): menos que o total deixa o resto em aberto.
      bloqueioParcial: bloqueioDoParcial(t as TituloParaParcial),
      sugestao: sugestao ? { jurosCentavos: sugestao.jurosCentavos, multaCentavos: sugestao.multaCentavos, detalhe: descricaoDoAcrescimo(sugestao) } : null,
      podeDescontar,
      formasSemAjuste: ['Cheque', FORMA_BOLETO],
      dica: vencido && semPercentuais
        ? 'Conta vencida. Para o sistema já calcular os juros e a multa, preencha as % em Configurações da filial › Parâmetros de venda › "Juros e multa do crediário em atraso".'
        : undefined,
      formas,
      rotulosDasFormas: { [FORMA_BOLETO]: 'Boleto (emitir agora; a baixa vem pelo retorno do banco)' },
      formaInicial: t.formaPagamento && formas.includes(t.formaPagamento) ? t.formaPagamento : '',
      rotuloForma: 'Como foi recebido?',
      mensagemSemForma: 'Escolha como foi recebido antes de confirmar.',
      rotuloData: 'Data do recebimento (para cheque, vale a data de compensação)',
      textoConfirmar: 'Confirmar recebimento',
    });
    if (!dados) return;
    if (dados.forma === FORMA_BOLETO) {
      await emitirBoletoPelaBaixa(t, bancosComBoleto);
      return;
    }
    const formaPgto = dados.forma as PaymentMethod;
    const dataRecebimento = dados.data;

    let bancoId: string | undefined;
    let bancoNome: string | undefined;
    if (paymentRequiresBankAccount(formaPgto)) {
      const qBancos = query(
        collection(db, 'bancos'),
        where('tenantId', '==', tenantId),
        where('ativo', '==', true),
      );
      const snapBancos = await getDocs(qBancos);
      const bancosDisponiveis = snapBancos.docs.map((d) => ({ id: d.id, nome: String(d.data().nome || '') }));
      if (bancosDisponiveis.length === 0) {
        showError('Nenhum banco cadastrado', 'Cadastre um banco em Cadastros > Bancos antes de confirmar este recebimento.');
        return;
      }
      const bancoResult = await NexusSwal.fire({
        title: formaPgto === 'Cheque' ? 'Em qual banco vai cair quando compensar?' : 'Em qual banco caiu?',
        input: 'select',
        inputOptions: Object.fromEntries(bancosDisponiveis.map((b) => [b.id, escaparHtml(b.nome)])),
        inputPlaceholder: 'Selecione o banco',
        showCancelButton: true,
        confirmButtonText: 'Confirmar',
        cancelButtonText: 'Cancelar',
        inputValidator: (value) => (value ? undefined : 'Selecione um banco.'),
      });
      if (!bancoResult.isConfirmed) return;
      bancoId = bancoResult.value as string;
      bancoNome = bancosDisponiveis.find((b) => b.id === bancoId)?.nome;
    }

    // Cheque nunca confirma na hora -- abre o modal de digitação, e só
    // quando confirmado lá é que registra (Pendente, aguardando
    // compensação em Financeiro > Cheques). Ver registrarChequeParaCompensar.
    if (formaPgto === 'Cheque') {
      setChequeBaixaState({ transacao: t, bancoId, bancoNome });
      return;
    }

    try {
      await confirmarRecebimento(t, formaPgto, bancoId, dataRecebimento, dados.ajustes, dados.valorRecebidoCentavos);
      const noDia = dataRecebimento === getDateInputInTimeZone() ? '' : ` com a data de ${dataBrasileira(dataRecebimento)}`;
      const principal = principalDaBaixa(dados.valorRecebidoCentavos, dados.ajustes);
      const parcial = principal < transactionNetCents(t);
      const reais = (centavos: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(centavos / 100);
      showSuccess(parcial
        ? `Recebimento parcial de ${reais(principal)} registrado${noDia}. Fica em aberto ${reais(transactionNetCents(t) - principal)}.`
        : formaPgto === 'Dinheiro'
          ? `Recebimento confirmado e lançado no caixa físico${noDia}!`
          : `Recebimento confirmado no fluxo financeiro correspondente${noDia}!`);
      await oferecerRecibo(t, {
        formaPagamento: formaPgto,
        dataPagamento: dataRecebimento,
        acrescimoCentavos: acrescimoDosAjustes(dados.ajustes),
        descontoCentavos: dados.ajustes.descontoCentavos,
        ...(parcial ? { principalCentavos: principal } : {}),
      });
    } catch (error) {
      console.error('Erro ao confirmar recebimento:', error);
      showError('Erro', error instanceof Error ? error.message : 'Não foi possível aprovar a transação.');
    }
  };

  const handleConciliar = async (t: TransacaoData) => {
    // Parcela de renegociacao: o abatimento com credito grava pelo navegador e nao
    // quitaria as vendas de origem quando a renegociacao fecha -- recebe pelo servidor.
    if (ehParcelaDeRenegociacao(t)) {
      await solicitarFormaRecebimento(t);
      return;
    }
    let saldoCredito = 0;
    const creditosAtivos: any[] = [];
    
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
      setDataBaixaCredito(getDateInputInTimeZone());
      setModalConciliacao({ ativo: true, transacao: t, creditos: creditosAtivos, saldoTotal: saldoCredito });
      return;
    }

    await solicitarFormaRecebimento(t);
  };

  const confirmarBaixaComCredito = async (valorInformado = valorAbater) => {
    const t = modalConciliacao.transacao;
    if (!t || !currentUser || !tenantId) return;

    if (valorInformado <= 0) {
      fecharModalConciliacao();
      await solicitarFormaRecebimento(t);
      return;
    }

    const erroData = validarDataBaixa(dataBaixaCredito, getDateInputInTimeZone());
    if (erroData) {
      showError('Data inválida', erroData);
      return;
    }

    const creditCents = toCents(valorInformado);
    const expectedTransactionCents = Number(t.valorCentavos ?? toCents(t.valor));
    if (
      creditCents <= 0 ||
      creditCents > toCents(modalConciliacao.saldoTotal) ||
      creditCents > expectedTransactionCents
    ) {
      showError('Erro', 'Valor de abatimento inválido.');
      return;
    }

    setIsProcessing(true);
    try {
      const transactionRef = doc(db, 'transacoes', t.id);
      const creditPaymentRef = doc(collection(db, 'transacoes'));
      const creditRefs = modalConciliacao.creditos.map((credit) => doc(db, 'creditos_cliente', credit.id));
      const paymentDate = dataBaixaCredito;

      let remainingCents = 0;
      await runTransaction(db, async (transaction) => {
        const transactionSnap = await transaction.get(transactionRef);
        if (!transactionSnap.exists()) throw new Error('Conta a receber não encontrada.');
        const transactionData = transactionSnap.data();
        if (transactionData.status !== 'Pendente') {
          throw new Error('Esta conta já foi processada ou cancelada.');
        }
        const currentTransactionCents = Number(transactionData.valorCentavos ?? toCents(transactionData.valor));
        if (currentTransactionCents !== expectedTransactionCents) {
          throw new Error('O saldo da conta foi alterado. Reabra a conciliação.');
        }

        const creditSnapshots = await Promise.all(creditRefs.map((creditRef) => transaction.get(creditRef)));
        const saleId = transactionData.pedidoId || t.pedidoId;
        const serviceOrderId = transactionData.osId || t.osId;
        const sourceRef = saleId
          ? doc(db, 'pedidos_venda', saleId)
          : serviceOrderId
            ? doc(db, 'ordens_de_servico', serviceOrderId)
            : null;
        const sourceSnap = sourceRef ? await transaction.get(sourceRef) : null;
        if (sourceSnap?.exists() && sourceSnap.data().status === 'Cancelada') {
          throw new Error(saleId ? 'A venda vinculada está cancelada.' : 'A OS vinculada está cancelada.');
        }

        let remainingCreditCents = creditCents;
        const creditUpdates: Array<{ ref: ReturnType<typeof doc>; balanceCents: number }> = [];
        creditSnapshots.forEach((creditSnap, index) => {
          if (remainingCreditCents <= 0 || !creditSnap.exists()) return;
          const creditData = creditSnap.data();
          if (creditData.tenantId !== tenantId || !['disponivel', 'usado_parcial'].includes(creditData.status)) return;
          const availableCents = Number(creditData.saldoDisponivelCentavos ?? toCents(creditData.saldoDisponivel));
          const usedCents = Math.min(availableCents, remainingCreditCents);
          if (usedCents <= 0) return;
          creditUpdates.push({ ref: creditRefs[index], balanceCents: availableCents - usedCents });
          remainingCreditCents -= usedCents;
        });
        if (remainingCreditCents > 0) {
          throw new Error('O saldo de crédito disponível foi alterado. Reabra a conciliação.');
        }

        remainingCents = currentTransactionCents - creditCents;
        creditUpdates.forEach(({ ref, balanceCents }) => {
          transaction.update(ref, {
            saldoDisponivelCentavos: balanceCents,
            saldoDisponivel: fromCents(balanceCents),
            status: balanceCents <= 0 ? 'esgotado' : 'usado_parcial',
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Crédito usado na baixa'),
          });
        });

        const receiptTransactionId = remainingCents === 0 ? t.id : creditPaymentRef.id;
        if (remainingCents === 0) {
          transaction.update(transactionRef, {
            status: 'Paga',
            formaPagamentoOriginal: transactionData.formaPagamentoOriginal || transactionData.formaPagamento || null,
            formaPagamento: 'Crédito de Devolução',
            naturezaFinanceira: 'credito_cliente',
            movimentaCaixaFisico: false,
            dataPagamento: paymentDate,
            recebidoEm: serverTimestamp(),
            observacao: `Pagamento realizado utilizando ${fromCents(creditCents).toFixed(2)} em crédito do cliente.`,
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Quitada com crédito de devolução'),
          });
        } else {
          transaction.update(transactionRef, {
            valorCentavos: remainingCents,
            valor: fromCents(remainingCents),
            observacao: `Abatimento de R$ ${fromCents(creditCents).toFixed(2)} em crédito; saldo pendente de R$ ${fromCents(remainingCents).toFixed(2)}.`,
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Abatida parcialmente com crédito de devolução'),
          });
          transaction.set(creditPaymentRef, {
            descricao: `${transactionData.descricao || t.descricao} - Crédito de devolução`,
            categoria: transactionData.categoria || t.categoria,
            valorCentavos: creditCents,
            valor: fromCents(creditCents),
            tipo: 'entrada',
            status: 'Paga',
            formaPagamento: 'Crédito de Devolução',
            naturezaFinanceira: 'credito_cliente',
            movimentaCaixaFisico: false,
            data: paymentDate,
            dataPagamento: paymentDate,
            recebidoEm: serverTimestamp(),
            clienteNome: transactionData.clienteNome || t.clienteNome || null,
            pedidoId: saleId || null,
            osId: serviceOrderId || null,
            sourcePaymentTransactionId: t.id,
            idempotencyKey: `credito:${creditPaymentRef.id}`,
            tenantId,
            createdAt: serverTimestamp(),
            ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
          });
        }

        if (sourceRef && sourceSnap?.exists()) {
          const sourceData = sourceSnap.data();
          const payments: PaymentRecord[] = Array.isArray(sourceData.pagamentos) && sourceData.pagamentos.length > 0
            ? sourceData.pagamentos
            : [legacyPaymentForTransaction(t.id, transactionData)];
          const updatedPayments = applyPaymentReceipt(payments, {
            transactionId: t.id,
            paymentIndex: transactionData.paymentIndex,
            // Parcela com valor alterado: a venda so' fecha junto com a parcela, e por inteiro.
            amountCents: centavosParaAOrigem(payments, {
              transactionId: t.id,
              paymentIndex: transactionData.paymentIndex,
              titulo: transactionData,
              recebidoCentavos: creditCents,
              tituloQuitado: remainingCents === 0,
            }),
            method: 'Crédito de Devolução',
            receiptId: receiptTransactionId,
            receivedAt: paymentDate,
          });
          const summary = summarizePayments(updatedPayments);
          transaction.update(sourceRef, {
            pagamentos: updatedPayments,
            totalRecebidoCentavos: summary.receivedCents,
            totalRecebido: summary.received,
            totalPendenteCentavos: summary.pendingCents,
            totalPendente: summary.pending,
            totalTaxasPagamentoCentavos: summary.cardFeeCents,
            totalTaxasPagamento: summary.cardFee,
            totalLiquidoFinanceiroCentavos: summary.financialNetCents,
            totalLiquidoFinanceiro: summary.financialNet,
            statusPagamento: summary.pendingCents === 0
              ? 'Paga'
              : summary.receivedCents > 0
                ? 'Parcial'
                : 'Pendente',
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Baixa com crédito de devolução'),
          });
        }
      });

      showSuccess(remainingCents === 0
        ? 'Conta quitada com o crédito do cliente!'
        : `Crédito aplicado. Restam R$ ${fromCents(remainingCents).toFixed(2)} pendentes.`);
      fecharModalConciliacao();
    } catch (error) {
      console.error(error);
      showError('Erro', error instanceof Error ? error.message : 'Ocorreu um erro ao processar o abatimento.');
    } finally {
      setIsProcessing(false);
    }
  };

  /** Estorno: um caminho so' para o sistema (services/baixaFinanceiraService). */
  const handleEstornar = async (t: TransacaoData) => {
    setIsProcessing(true);
    try {
      await estornarBaixaComConfirmacao({
        titulo: t,
        tipo: 'entrada',
        podeEstornar,
        tenantId,
        usuario: currentUser ? { uid: currentUser.uid, email: currentUser.email } : null,
      });
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * Alterar o valor de UMA parcela em aberto (15/10/2026): nota com o valor da
   * venda, boleto com desconto. Quem grava e confere de novo e' o servidor.
   */
  const handleAlterarValor = async (t: TransacaoData) => {
    if (!tenantId || !currentUser) return;
    if (!podeAlterarValor) {
      showError('Sem permissão', 'Você não tem permissão para alterar o valor de parcelas. Peça a um responsável liberar "Financeiro: Alterar Valor de Documentos" no seu usuário.');
      return;
    }
    const bloqueio = bloqueioParaAlterarValor({ ...t, tipo: t.tipo || 'entrada' });
    if (bloqueio) {
      showError('Não é possível alterar o valor', bloqueio);
      return;
    }
    const dados = await pedirNovoValorDaParcela({
      descricao: t.descricao,
      atualCentavos: centavosAtuaisDoTitulo(t),
      temOrigem: Boolean(t.pedidoId || t.osId),
      alteracaoAnterior: t.alteracaoValor,
    });
    if (!dados) return;
    setIsProcessing(true);
    try {
      await alterarValorDaParcela({ transacaoId: t.id, novoValorCentavos: dados.novoCentavos, motivo: dados.motivo, tenantId });
      showSuccess(`Valor da parcela alterado para ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(dados.novoCentavos / 100)}.`);
    } catch (erro) {
      console.error('Erro ao alterar o valor da parcela:', erro);
      showError('Não foi possível alterar o valor', erro instanceof Error ? erro.message : 'Tente de novo em instantes.');
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * "Dar Baixa" com a forma Boleto (15/10/2026, decisao do dono): em vez de dar
   * baixa, pede o vencimento e EMITE o boleto na hora -- a mesma emissao da tela
   * de Boletos (services/boletoEmissaoService). A baixa vem depois, sozinha,
   * pelo retorno do banco. A venda nao muda.
   */
  const emitirBoletoPelaBaixa = async (t: TransacaoData, bancosComBoleto: BancoBoleto[]) => {
    if (!tenantId || !currentUser) return;
    const bloqueio = bloqueioParaCobrarEmBoleto({ ...t, tipo: t.tipo || 'entrada' });
    if (bloqueio) {
      showError('Não é possível emitir o boleto', bloqueio);
      return;
    }
    const hoje = getDateInputInTimeZone();
    const sugerido = vencimentoSugeridoDoBoleto(dataReferenciaTransacao(t), hoje);
    const banco = bancoDoBoleto({ bancoId: t.bancoId }, bancosComBoleto);
    const valor = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(centavosAtuaisDoTitulo(t) / 100);
    const resposta = await NexusSwal.fire({
      title: 'Emitir boleto',
      icon: 'question',
      html: `<div style="text-align:left;font-size:14px;color:var(--text-secondary);">`
        + `Parcela <strong>${escaparHtml(t.descricao)}</strong>, valor <strong>${valor}</strong>${banco ? `, pelo banco <strong>${escaparHtml(banco.nome)}</strong>` : ''}. `
        + 'A baixa entra sozinha quando o retorno do banco for importado em Financeiro › Boletos.</div>'
        + '<label for="boleto-vencimento" style="display:block;text-align:left;font-size:13px;margin-top:14px;color:var(--text-secondary);">Vencimento do boleto</label>'
        + `<input id="boleto-vencimento" type="date" class="swal2-input" min="${hoje}" value="${sugerido}" style="width:100%;margin:6px 0 0;box-sizing:border-box;" />`,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Emitir boleto',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const vencimento = (document.getElementById('boleto-vencimento') as HTMLInputElement | null)?.value || '';
        const erro = validarVencimentoDoBoleto(vencimento, hoje);
        if (erro) {
          NexusSwal.showValidationMessage(erro);
          return false;
        }
        return vencimento;
      },
    });
    if (!resposta.isConfirmed) return;

    setIsProcessing(true);
    let preparou = false;
    try {
      await prepararCobrancaEmBoleto({ transacaoId: t.id, vencimento: String(resposta.value), tenantId });
      preparou = true;
      const snap = await getDoc(doc(db, 'transacoes', t.id));
      const titulo = paraTituloBoleto(t.id, snap.data() || {});
      const bancoDaEmissao = validarTituloParaEmissao(titulo, bancosComBoleto);
      const gerado = await emitirUmTitulo({ tenantId, uid: currentUser.uid, titulo, banco: bancoDaEmissao });
      try {
        const pdf = await gerarPdfDoBoleto({
          tenantId,
          titulo: { ...titulo, boleto: gerado, bancoId: bancoDaEmissao.id, bancoNome: bancoDaEmissao.nome },
          bancosComBoleto,
        });
        setPdfBoleto(pdf);
        showSuccess('Boleto emitido. A baixa entra sozinha pelo retorno do banco.');
      } catch (erroPdf) {
        console.error('Erro ao gerar o PDF do boleto emitido:', erroPdf);
        showWarning('Boleto emitido', `O PDF não pôde ser gerado agora (${erroPdf instanceof Error ? erroPdf.message : 'tente de novo'}). Imprima em Financeiro › Boletos, aba "Emitidos".`);
      }
    } catch (erro) {
      console.error('Erro ao emitir o boleto pela baixa:', erro);
      const motivo = erro instanceof Error ? erro.message : 'Tente de novo em instantes.';
      showError('Não foi possível emitir o boleto', preparou
        ? `${motivo} A parcela já ficou como boleto: emita em Financeiro › Boletos, aba "Aguardando emissão".`
        : motivo);
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * Desfazer renegociacao (15/10/2026), a partir de qualquer parcela nova: as
   * novas sao canceladas (as recebidas tem o recebimento estornado: o dinheiro
   * sai do banco/caixa), as antigas voltam para em aberto. Tudo no servidor.
   */
  const handleDesfazerRenegociacao = async (t: TransacaoData) => {
    if (!tenantId || !t.renegociacao) return;
    const novas = Array.isArray(t.renegociacao.titulosNovos) ? t.renegociacao.titulosNovos.length : 0;
    const antigas = Array.isArray(t.renegociacao.titulosOrigem) ? t.renegociacao.titulosOrigem.length : 0;
    const resposta = await NexusSwal.fire({
      title: 'Desfazer esta renegociação?',
      html: `<div style="text-align:left;font-size:14px;">`
        + `As <strong>${novas}</strong> parcela(s) nova(s) serão canceladas. As que já foram recebidas têm o recebimento estornado: o valor sai do banco/caixa, como no Estornar.<br/><br/>`
        + `As <strong>${antigas}</strong> parcela(s) antiga(s) voltam para em aberto, com o valor de antes.</div>`,
      icon: 'warning',
      input: 'textarea',
      inputLabel: 'Motivo',
      inputPlaceholder: 'Escreva por que a renegociação está sendo desfeita',
      showCancelButton: true,
      confirmButtonText: 'Desfazer renegociação',
      cancelButtonText: 'Manter',
      confirmButtonColor: '#ef4444',
      preConfirm: (motivo: string) => {
        const erro = validarMotivoRenegociacao(motivo, 'desfazer');
        if (erro) {
          NexusSwal.showValidationMessage(erro);
          return false;
        }
        return motivo.trim();
      },
    });
    if (!resposta.isConfirmed) return;
    setIsProcessing(true);
    try {
      const resultado = await desfazerRenegociacaoDaParcela({ transacaoId: t.id, motivo: String(resposta.value), tenantId });
      showSuccess(resultado.estornadas > 0
        ? `Renegociação desfeita. ${resultado.estornadas} recebimento(s) estornado(s) e as parcelas antigas voltaram para em aberto.`
        : 'Renegociação desfeita. As parcelas antigas voltaram para em aberto.');
    } catch (erro) {
      console.error('Erro ao desfazer a renegociação:', erro);
      showError('Não foi possível desfazer a renegociação', erro instanceof Error ? erro.message : 'Tente de novo em instantes.');
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

  const hojeStr = getDateInputInTimeZone();
  const contasPendentes = transacoes.filter(t => (
    t.status === 'Pendente' &&
    t.formaPagamento !== 'Cartão de Crédito' &&
    t.formaPagamento !== 'Cartão de Débito'
  ));
  const recebimentosHoje = transacoes.filter(t => t.status === 'Paga' && t.dataPagamento === hojeStr);

  const totalPendente = contasPendentes.reduce((acc, curr) => acc + transactionNetAmount(curr), 0);
  // Desconto dado na baixa (15/10/2026) e' lancamento de saida: sai daqui para o card mostrar o que entrou de fato.
  const totalRecebidoHoje = recebimentosHoje.reduce((acc, curr) => acc + transactionNetAmount(curr) - (Number(curr.baixaManual?.descontoCentavos) || 0) / 100, 0);

  // O que aparece na lista: situacao (em aberto / vencidas / recebidas / todas)
  // e periodo. Cartao continua fora daqui (fica na tela Banco), seja qual for
  // o filtro. Os cartoes do topo (Total a Receber, Recebido Hoje) seguem o
  // total geral -- nao mudam com o filtro.
  const titulosFiltrados = transacoes.filter((t) => {
    if (t.formaPagamento === 'Cartão de Crédito' || t.formaPagamento === 'Cartão de Débito') return false;
    const titulo = { status: t.status, data: dataReferenciaTransacao(t) || t.data, dataPagamento: t.dataPagamento };
    return passaNaSituacaoTitulo(titulo, hojeStr, situacaoTitulo)
      && passaNoPeriodoDoTitulo(titulo, situacaoTitulo, periodoDe, periodoAte);
  });
  const filtrosAtivos = (situacaoTitulo !== SITUACAO_TITULO_PADRAO ? 1 : 0) + (periodoDe || periodoAte ? 1 : 0);
  const limparFiltros = () => {
    setSituacaoTitulo(SITUACAO_TITULO_PADRAO);
    setPeriodoDe('');
    setPeriodoAte('');
  };
  const listandoRecebidas = situacaoTitulo === 'pagas';
  const rotuloQuantidade = listandoRecebidas ? 'Títulos recebidos' : situacaoTitulo === 'todas' ? 'Títulos' : 'Títulos em aberto';
  const rotuloValor = listandoRecebidas ? 'Valor recebido (R$)' : situacaoTitulo === 'todas' ? 'Valor (R$)' : 'Valor pendente (R$)';

  // Agrupa os titulos filtrados por cliente. Usa clienteId quando disponivel
  // (vendas/OS finalizadas a partir de 2026-07-29); registros antigos sem
  // clienteId agrupam pelo nome, sem garantia de que seja o mesmo cadastro.
  const gruposPorCliente: GrupoCliente[] = (() => {
    const mapa = new Map<string, GrupoCliente>();
    titulosFiltrados.forEach((t) => {
      const nome = t.clienteNome?.trim() || 'Cliente não identificado';
      const chave = t.clienteId ? `id:${t.clienteId}` : `nome:${nome.toUpperCase()}`;
      const dataRef = dataReferenciaTransacao(t);
      const diasAtraso = dataRef && t.status === 'Pendente' ? (differenceInCalendarDays(dataRef, hojeStr) ?? 0) : 0;

      let grupo = mapa.get(chave);
      if (!grupo) {
        grupo = {
          chave,
          clienteId: t.clienteId || null,
          clienteNome: nome,
          transacoes: [],
          totalPendente: 0,
          vencimentoMaisAntigo: null,
          diasAtrasoMax: 0,
        };
        mapa.set(chave, grupo);
      }
      grupo.transacoes.push(t);
      grupo.totalPendente += transactionNetAmount(t);
      if (dataRef && (!grupo.vencimentoMaisAntigo || dataRef < grupo.vencimentoMaisAntigo)) {
        grupo.vencimentoMaisAntigo = dataRef;
      }
      grupo.diasAtrasoMax = Math.max(grupo.diasAtrasoMax, diasAtraso);
    });

    return Array.from(mapa.values())
      .filter((g) => !buscaCliente.trim() || g.clienteNome.toLowerCase().includes(buscaCliente.trim().toLowerCase()))
      .sort((a, b) => b.totalPendente - a.totalPendente);
  })();

  // ---- Baixa em lote: so' conta em aberto, sem cheque nem cartao (baixaEmLoteDomain).
  const elegiveis = new Map(titulosFiltrados.filter((t) => podeEntrarNoLote(t, 'entrada')).map((t) => [t.id, t]));
  const idsElegiveisDoGrupo = (grupo: GrupoCliente) => grupo.transacoes.filter((t) => elegiveis.has(t.id)).map((t) => t.id);
  const idsElegiveisVisiveis = gruposPorCliente.flatMap(idsElegiveisDoGrupo);
  const selecaoValida = [...selecionados].filter((id) => elegiveis.has(id));
  const marcar = (ids: string[], marcarIds: boolean) => {
    const { selecao, deFora } = marcarNaSelecao(selecionados, ids, marcarIds);
    setSelecionados(selecao);
    if (deFora > 0) {
      showWarning(`Até ${LIMITE_BAIXA_EM_LOTE} contas por vez`, `${deFora} ${deFora === 1 ? 'conta ficou' : 'contas ficaram'} de fora. Dê baixa nestas e selecione o resto depois.`);
    }
  };
  const montarItemDoLote = (t: TransacaoData): ItemDoLote => {
    const sugestao = acrescimoPorAtraso(parametrosVenda, transactionNetCents(t), t.dataVencimento, hojeStr);
    return {
      id: t.id,
      nome: t.clienteNome?.trim() || 'Cliente não identificado',
      descricao: t.descricao,
      vencimento: dataReferenciaTransacao(t) || t.data || '',
      valorCentavos: transactionNetCents(t),
      formaPrevista: t.formaPagamento,
      jurosSugeridoCentavos: sugestao?.jurosCentavos || 0,
      multaSugeridaCentavos: sugestao?.multaCentavos || 0,
    };
  };
  const totalSelecionadoCentavos = selecaoValida.reduce((soma, id) => soma + transactionNetCents(elegiveis.get(id) as TransacaoData), 0);
  const abrirBaixaEmLote = () => {
    // O borderô congela ao abrir: as contas baixadas saem da lista ao vivo,
    // mas o resultado de cada uma continua na janela.
    setItensDoLote(selecaoValida.map((id) => montarItemDoLote(elegiveis.get(id) as TransacaoData)));
  };
  const fecharBaixaEmLote = (baixados: string[]) => {
    setItensDoLote(null);
    if (baixados.length > 0) setSelecionados((atual) => marcarNaSelecao(atual, baixados, false).selecao);
  };

  // ---- Renegociacao (15/10/2026): as marcadas, de um cliente so', viram um documento novo.
  const abrirRenegociacao = () => {
    const marcadas = selecaoValida.map((id) => elegiveis.get(id) as TransacaoData);
    const erro = validarTitulosParaRenegociar(marcadas.map((t) => ({ ...t, tipo: t.tipo || 'entrada' })));
    if (erro) {
      showError('Não é possível renegociar', erro);
      return;
    }
    setRenegociando({
      clienteNome: marcadas[0]?.clienteNome?.trim() || 'Cliente',
      titulos: marcadas.map((t) => ({
        id: t.id,
        descricao: t.descricao,
        vencimento: dataReferenciaTransacao(t) || t.data || '',
        // O mesmo valor que o servidor renegocia (valor atual da parcela).
        valorCentavos: Number(t.valorCentavos ?? toCents(t.valor)),
      })),
    });
  };
  const fecharRenegociacao = (renegociou: boolean) => {
    const ids = renegociando?.titulos.map((t) => t.id) || [];
    setRenegociando(null);
    if (renegociou) {
      setSelecionados((atual) => marcarNaSelecao(atual, ids, false).selecao);
      showSuccess('Renegociação registrada. As parcelas novas já estão na lista do cliente.');
    }
  };

  const toggleClienteExpandido = (chave: string) => {
    setClientesExpandidos((current) => {
      const next = new Set(current);
      if (next.has(chave)) next.delete(chave);
      else next.add(chave);
      return next;
    });
  };

  const handleCobrarClienteWhatsApp = (grupo: GrupoCliente) => {
    // Cobra so' o que ainda esta em aberto -- com o filtro em "Todas" o grupo
    // tambem traz titulo ja recebido, que nao entra na cobranca.
    const emAberto = grupo.transacoes.filter((t) => t.status === 'Pendente');
    const valorMsg = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
      emAberto.reduce((soma, t) => soma + transactionNetAmount(t), 0),
    );
    const qtd = emAberto.length;
    const mensagem = `Olá ${grupo.clienteNome}. Gostaríamos de lembrar amigavelmente sobre ${qtd === 1 ? 'uma pendência financeira' : `${qtd} pendências financeiras`} no valor total de ${valorMsg}. O acerto tempestivo é fundamental para mantermos nossa excelência no atendimento. Aguardamos o seu retorno e estamos à disposição para eventuais dúvidas.`;
    window.open(`https://wa.me/?text=${encodeURIComponent(mensagem)}`, '_blank');
  };

  return (
    <div className="financeiro-page" style={{ padding: '24px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700 }}>Contas a Receber</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>Clientes com débito em aberto (Boleto, a Prazo) — cartão fica na tela Banco</p>
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
          <MenuMaisOpcoes
            itens={[
              { texto: 'Importar títulos', Icone: Upload, onClick: () => openTab('/financeiro/contas-receber/importar', 'Importar Contas a Receber') },
            ]}
          />
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

      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div className="search-bar" style={{ position: 'relative', width: '360px', maxWidth: '100%' }}>
          <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Buscar cliente..."
            value={buscaCliente}
            onChange={(e) => setBuscaCliente(e.target.value)}
            style={{ width: '100%', padding: '10px 14px 10px 40px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
          />
        </div>
        <BotaoFiltros aberto={filtrosAbertos} onToggle={() => setFiltrosAbertos((v) => !v)} quantidadeAtiva={filtrosAtivos} />
      </div>
      <PainelFiltros aberto={filtrosAbertos} quantidadeAtiva={filtrosAtivos} onLimpar={limparFiltros}>
        <CampoFiltro rotulo="Situação">
          <select value={situacaoTitulo} onChange={(e) => setSituacaoTitulo(e.target.value as SituacaoTitulo)} style={estiloCampoFiltro}>
            {(Object.keys(ROTULO_SITUACAO_TITULO) as SituacaoTitulo[]).map((chave) => (
              <option key={chave} value={chave}>{chave === 'pagas' ? 'Recebidas' : ROTULO_SITUACAO_TITULO[chave]}</option>
            ))}
          </select>
        </CampoFiltro>
        <CampoPeriodo
          rotulo={listandoRecebidas ? 'Recebido em' : 'Vencimento'}
          de={periodoDe}
          ate={periodoAte}
          onChangeDe={setPeriodoDe}
          onChangeAte={setPeriodoAte}
        />
      </PainelFiltros>
      {listaTemRecebidas && !periodoDe && !periodoAte && (
        <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--text-muted)' }}>
          Recebidas deste mês. Para outro período, use Filtros › Recebido em.
        </p>
      )}

      <div className="card lote-tom-entrada" style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
        <div className="table-wrapper">
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
                <th style={{ padding: '16px' }}>Cliente</th>
                <th style={{ padding: '16px', textAlign: 'center' }}>{rotuloQuantidade}</th>
                <th style={{ padding: '16px' }}>Vencimento mais antigo</th>
                <th style={{ padding: '16px', textAlign: 'right' }}>{rotuloValor}</th>
                <th style={{ padding: '16px', textAlign: 'center' }}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '20px' }}>Carregando contas a receber...</td>
                </tr>
              ) : gruposPorCliente.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    <CheckCircle size={48} color="#10b981" style={{ margin: '0 auto 16px', opacity: 0.5 }} />
                    <div>{buscaCliente.trim() || filtrosAtivos > 0 ? 'Nenhum título encontrado com esses filtros.' : 'Nenhuma conta pendente para conciliação no momento.'}</div>
                  </td>
                </tr>
              ) : (
                gruposPorCliente.map((grupo) => {
                  const expandido = clientesExpandidos.has(grupo.chave);
                  const emAtraso = grupo.diasAtrasoMax > 0;
                  const idsDoGrupo = idsElegiveisDoGrupo(grupo);
                  const estadoDoGrupo = estadoDaSelecao(selecionados, idsDoGrupo);
                  return (
                    <React.Fragment key={grupo.chave}>
                      <tr
                        onClick={() => toggleClienteExpandido(grupo.chave)}
                        className={estadoDoGrupo === 'todos' ? 'lote-linha-marcada' : undefined}
                        style={{ borderBottom: expandido ? 'none' : '1px solid var(--border-color)', cursor: 'pointer', backgroundColor: expandido ? 'var(--bg-tertiary)' : 'transparent' }}
                      >
                        <td style={{ padding: '8px 0 8px 8px' }}>
                          {idsDoGrupo.length > 0 && (
                            <CaixaDeSelecao
                              estado={estadoDoGrupo}
                              rotulo={`Selecionar as contas em aberto de ${grupo.clienteNome}`}
                              onAlternar={(marcarGrupo) => marcar(idsDoGrupo, marcarGrupo)}
                            />
                          )}
                        </td>
                        <td style={{ padding: '16px 0', color: 'var(--text-muted)' }}>
                          {expandido ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                        </td>
                        <td style={{ padding: '16px', fontWeight: 600 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <User size={16} style={{ color: 'var(--text-muted)' }} />
                            {grupo.clienteNome}
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
                        <td style={{ padding: '16px', textAlign: 'right', fontWeight: 700, color: '#f59e0b' }}>
                          {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(grupo.totalPendente)}
                        </td>
                        <td style={{ padding: '16px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
{grupo.transacoes.some((t) => t.status === 'Pendente') && (
                          /* So' o icone, igual ao da parcela (pedido do dono, 15/10/2026). */
                          <button
                            onClick={() => handleCobrarClienteWhatsApp(grupo)}
                            style={{ backgroundColor: 'transparent', border: '1px solid #25D366', color: '#25D366', cursor: 'pointer', borderRadius: '6px', width: '30px', height: '30px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                            title="Cobrar pelo WhatsApp"
                            aria-label={`Cobrar ${grupo.clienteNome} pelo WhatsApp`}
                          >
                            <MessageCircle size={15} />
                          </button>
                          )}
                        </td>
                      </tr>
                      {expandido && (
                        <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td colSpan={7} style={{ padding: '0 16px 16px 48px', backgroundColor: 'var(--bg-tertiary)' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                              <thead>
                                <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                  <th style={{ padding: '10px 0', width: '44px' }}><span className="lote-so-leitor">Selecionar</span></th>
                                  <th style={{ padding: '10px 8px', fontSize: '12px', color: 'var(--text-muted)' }}>Data</th>
                                  <th style={{ padding: '10px 8px', fontSize: '12px', color: 'var(--text-muted)' }}>Descrição / O.S</th>
                                  <th style={{ padding: '10px 8px', fontSize: '12px', color: 'var(--text-muted)' }}>Forma de Pgto.</th>
                                  <th style={{ padding: '10px 8px', fontSize: '12px', color: 'var(--text-muted)', textAlign: 'right' }}>Valor líquido (R$)</th>
                                  <th style={{ padding: '10px 8px', fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center' }}>Ação</th>
                                </tr>
                              </thead>
                              <tbody>
                                {grupo.transacoes.map((t) => (
                                  <tr key={t.id} className={selecionados.has(t.id) && elegiveis.has(t.id) ? 'lote-linha-marcada' : undefined} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                    <td style={{ padding: '4px 0' }}>
                                      {elegiveis.has(t.id) && (
                                        <CaixaDeSelecao
                                          estado={selecionados.has(t.id) ? 'todos' : 'nenhum'}
                                          rotulo={`Selecionar ${t.descricao}`}
                                          onAlternar={(marcarConta) => marcar([t.id], marcarConta)}
                                        />
                                      )}
                                    </td>
                                    <td style={{ padding: '10px 8px', color: 'var(--text-muted)' }}>{t.data ? t.data.split('-').reverse().join('/') : new Date(t.createdAt?.seconds * 1000).toLocaleDateString('pt-BR')}</td>
                                    <td style={{ padding: '10px 8px', fontWeight: 500 }}>
                                      {t.descricao}
                                      {textoDoParcial(t as { pagoParcialCentavos?: number; valorAntesDoParcialCentavos?: number }) && (
                                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#10b981', marginTop: '2px' }}>
                                          {textoDoParcial(t as { pagoParcialCentavos?: number; valorAntesDoParcialCentavos?: number })}
                                        </div>
                                      )}
                                      {ehParcelaDeRenegociacao(t) && (
                                        <div
                                          title={`Renegociou: ${(t.renegociacao?.titulosOrigem || []).map((o) => o.descricao).join('; ')}${t.renegociacao?.motivo ? `. Motivo: ${t.renegociacao.motivo}` : ''}`}
                                          style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-muted)', marginTop: '2px' }}
                                        >
                                          {(t.renegociacao?.titulosOrigem || []).length} parcela(s) antiga(s) renegociada(s)
                                        </div>
                                      )}
                                    </td>
                                    <td style={{ padding: '10px 8px' }}>
                                      <span style={{ fontSize: '12px', backgroundColor: 'var(--bg-secondary)', padding: '4px 8px', borderRadius: '4px', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>
                                        {t.formaPagamento || 'Não informada'}
                                      </span>
                                    </td>
                                    <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 600, color: '#10b981' }}>
                                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(transactionNetAmount(t))}
                                      {valorAlteradoAtivo(t) && (
                                        <div
                                          title={resumoDaAlteracaoValor(t.alteracaoValor)}
                                          style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-muted)', marginTop: '2px' }}
                                        >
                                          valor alterado
                                        </div>
                                      )}
                                    </td>
                                    <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                                      {t.status === 'Paga' ? (
                                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
                                          <span style={{ fontSize: '12px', color: '#10b981', fontWeight: 600 }}>
                                            Recebida{t.dataPagamento ? ` em ${t.dataPagamento.split('-').reverse().join('/')}` : ''}
                                          </span>
                                          {podeEstornar && planejarEstornoReceber(t).mostrarBotao && (
                                            <button
                                              onClick={() => void handleEstornar(t)}
                                              disabled={isProcessing}
                                              title="Desfazer esta baixa e voltar a conta para Pendente"
                                              style={{ backgroundColor: 'transparent', border: '1px solid #f59e0b', color: '#f59e0b', cursor: 'pointer', borderRadius: '4px', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px', opacity: isProcessing ? 0.6 : 1 }}
                                            >
                                              <Undo2 size={13} /> Estornar
                                            </button>
                                          )}
                                          {!t.acrescimoDaTransacaoId && (
                                            <button
                                              onClick={() => void emitirRecibo(t, ajustesDoRecibo(t))}
                                              disabled={isProcessing}
                                              title="Recibo de pagamento desta conta, em PDF"
                                              style={{ backgroundColor: 'transparent', border: '1px solid #3b82f6', color: '#3b82f6', cursor: 'pointer', borderRadius: '4px', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px', opacity: isProcessing ? 0.6 : 1 }}
                                            >
                                              <FileText size={13} /> Recibo
                                            </button>
                                          )}
                                          {podeRenegociar && ehParcelaDeRenegociacao(t) && (
                                            <button
                                              onClick={() => void handleDesfazerRenegociacao(t)}
                                              disabled={isProcessing}
                                              title="Cancela as parcelas novas (estornando as recebidas) e volta as parcelas antigas para em aberto"
                                              style={{ backgroundColor: 'transparent', border: '1px solid #ef4444', color: '#ef4444', cursor: 'pointer', borderRadius: '4px', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px', opacity: isProcessing ? 0.6 : 1 }}
                                            >
                                              <Undo2 size={13} /> Desfazer renegociação
                                            </button>
                                          )}
                                        </div>
                                      ) : (
                                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
                                        {/* Cobrar pelo WhatsApp: so' o icone (pedido do dono, 15/10/2026 -- linha menos poluida). */}
                                        <button
                                          onClick={() => handleCobrarWhatsApp(t)}
                                          style={{ backgroundColor: 'transparent', border: '1px solid #25D366', color: '#25D366', cursor: 'pointer', borderRadius: '6px', width: '30px', height: '30px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                                          title="Cobrar pelo WhatsApp"
                                          aria-label={`Cobrar ${t.descricao} pelo WhatsApp`}
                                        >
                                          <MessageCircle size={15} />
                                        </button>
                                        <button
                                          onClick={() => handleConciliar(t)}
                                          style={{ backgroundColor: '#10b981', border: 'none', color: 'white', cursor: 'pointer', borderRadius: '4px', padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px' }}
                                        >
                                          <CheckCircle size={14} /> Dar Baixa
                                        </button>
                                        {podeAlterarValor && (
                                          <button
                                            onClick={() => void handleAlterarValor(t)}
                                            disabled={isProcessing}
                                            title="Alterar o valor desta parcela (ex.: boleto com desconto). A venda e a nota não mudam."
                                            style={{ backgroundColor: 'transparent', border: '1px solid #8b5cf6', color: '#8b5cf6', cursor: 'pointer', borderRadius: '4px', padding: '6px 10px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px', opacity: isProcessing ? 0.6 : 1 }}
                                          >
                                            <Edit size={13} /> Alterar valor
                                          </button>
                                        )}
                                        {podeRenegociar && ehParcelaDeRenegociacao(t) && (
                                          <button
                                            onClick={() => void handleDesfazerRenegociacao(t)}
                                            disabled={isProcessing}
                                            title="Cancela as parcelas novas (estornando as recebidas) e volta as parcelas antigas para em aberto"
                                            style={{ backgroundColor: 'transparent', border: '1px solid #ef4444', color: '#ef4444', cursor: 'pointer', borderRadius: '4px', padding: '6px 10px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px', opacity: isProcessing ? 0.6 : 1 }}
                                          >
                                            <Undo2 size={13} /> Desfazer renegociação
                                          </button>
                                        )}
                                      </div>
                                      )}
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
        </div>
      </div>

      <BarraDeSelecaoLote
        tipo="entrada"
        quantidade={selecaoValida.length}
        totalCentavos={totalSelecionadoCentavos}
        onLimpar={() => setSelecionados(new Set())}
        onDarBaixa={abrirBaixaEmLote}
        acaoExtra={podeRenegociar ? {
          texto: `Renegociar ${selecaoValida.length}`,
          onClick: abrirRenegociacao,
          titulo: 'Juntar as parcelas marcadas (de um cliente só) num documento novo, em 1 ou mais parcelas',
        } : undefined}
      />
      {renegociando && tenantId && (
        <RenegociacaoModal clienteNome={renegociando.clienteNome} titulos={renegociando.titulos} tenantId={tenantId} onFechar={fecharRenegociacao} />
      )}
      {itensDoLote && tenantId && (
        <BaixaEmLoteModal tipo="entrada" itens={itensDoLote} tenantId={tenantId} podeDescontar={podeDescontar} onFechar={fecharBaixaEmLote} />
      )}

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

              <div className="input-group">
                <label style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Data do recebimento</label>
                <input
                  type="date"
                  value={dataBaixaCredito}
                  max={getDateInputInTimeZone()}
                  onChange={(e) => setDataBaixaCredito(e.target.value)}
                  style={{ padding: '12px', fontSize: '16px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)' }}
                />
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px', display: 'block' }}>
                  Foi recebido em outro dia? Troque a data. Vale para a parte paga com crédito; se receber sem usar crédito, a data é perguntada na próxima tela.
                </span>
              </div>
            </div>

            <div style={{ padding: '20px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '12px', backgroundColor: 'var(--bg-primary)' }}>
              <button className="btn-secondary" onClick={() => void confirmarBaixaComCredito(0)}>Receber sem usar crédito</button>
              <button 
                className="btn-primary" 
                disabled={isProcessing}
                onClick={() => void confirmarBaixaComCredito()}
                style={{ backgroundColor: '#10b981', border: 'none', opacity: isProcessing ? 0.7 : 1 }}
              >
                {isProcessing ? 'Processando...' : 'Confirmar Baixa'}
              </button>
            </div>
          </div>
        </div>
      )}

      {pdfRecibo && <PdfVisualizador titulo="Recibo de pagamento" nomeArquivo={pdfRecibo.nome} pdf={pdfRecibo.blob} onFechar={() => setPdfRecibo(null)} />}
      {pdfBoleto && <PdfVisualizador titulo="Boleto" nomeArquivo={pdfBoleto.nome} pdf={pdfBoleto.blob} onFechar={() => setPdfBoleto(null)} />}
      <ChequeCaptureModal
        aberto={chequeBaixaState !== null}
        dataMinima={getDateInputInTimeZone()}
        valorSugerido={chequeBaixaState ? transactionNetAmount(chequeBaixaState.transacao) : 0}
        onFechar={() => setChequeBaixaState(null)}
        onConfirmar={async (dados) => {
          if (!chequeBaixaState) return;
          try {
            await registrarChequeParaCompensar(chequeBaixaState.transacao, dados, chequeBaixaState.bancoId, chequeBaixaState.bancoNome);
            showSuccess('Cheque registrado! Ele aparece em Financeiro → Cheques até ser compensado.');
          } catch (error) {
            console.error('Erro ao registrar cheque para baixa:', error);
            showError('Erro', error instanceof Error ? error.message : 'Não foi possível registrar o cheque.');
          } finally {
            setChequeBaixaState(null);
          }
        }}
      />
    </div>
  );
};

export default ContasReceber;
