import React, { useEffect, useMemo, useState } from 'react';
import { collection, query, where, doc, getDoc, getDocs, documentId } from 'firebase/firestore';
import { LOTE_IN_POR_ID } from '../../utils/firestoreLimites';
import { planoEfetivo } from '../../utils/vinculosPlanoContasDomain';
import { db } from '../../services/firebase';
import { gerarCashbackSemFalhar } from '../../services/cashbackService';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { showSuccess, showError, showWarning, NexusSwal, escaparHtml } from '../../utils/alerts';
import { Barcode, CheckCircle, Clock, X, Wallet, AlertCircle, MessageCircle, ChevronDown, ChevronRight, User, Search, Upload, Undo2, FileText, Edit, Plus, Building2, Pencil, XCircle, ArrowLeftRight } from 'lucide-react';
import {
  fromCents,
  parsePagamentoCartaoSimplificadoAtivo,
  paymentRequiresBankAccount,
  toCents,
  transactionDueDateInput,
  transactionNetAmount,
  lancamentoDesfeito,
  type ChequeDetails,
  type PaymentMethod,
  transactionNetCents } from '../../utils/financeDomain';
import { differenceInCalendarDays, getDateInputInTimeZone } from '../../utils/dateTime';
import { gerarPdfBoletos } from '../../utils/boletoPdf';
import { nomeArquivoDocumento } from '../../utils/nomeArquivoDomain';
import { hasTenantFullAccess, isPlatformAdminRole } from '../../utils/roles';
import { PERMISSAO_FINANCEIRO } from '../../utils/permissoesNovasDomain';
import { permissionLabelMap } from '../../utils/permissionCatalog';
import { PERMISSAO_DESCONTO_NA_BAIXA, SEM_AJUSTES, acrescimoDosAjustes, type AjustesDaBaixa } from '../../utils/ajustesDaBaixaDomain';
import { bloqueioDoParcial, principalDaBaixa, textoDoParcial, type TituloParaParcial } from '../../utils/baixaParcialDomain';
import { MENSAGEM_SEM_FORMA_DE_RECEBIMENTO, formasDeRecebimento, parseFormasOcultas, parseOrdemFormasPagamento } from '../../utils/formasPagamentoDomain';
import {
  dataBrasileira,
  planejarEstornoReceber,
  validarDataBaixa,
  type TituloParaEstorno,
} from '../../utils/baixaFinanceiraDomain';
import { pedirDadosBaixa } from '../../utils/baixaFinanceiraUi';
import { PARAMETROS_VENDA_PADRAO, acrescimoPorAtraso, descricaoDoAcrescimo, diasDeAtraso, parseParametrosVenda, type AcrescimoPorAtraso, type ParametrosVenda } from '../../utils/parametrosVendaDomain';
import {
  acrescimoDoTitulo,
  campoDoPercentual,
  lerPercentuaisDaTela,
  mesmosPercentuais,
  parametrosComPercentuaisDaTela,
  somaDosAcrescimos,
  temPercentuais,
  textoDosPercentuais,
  type PercentuaisDeAtraso,
} from '../../utils/atrasoReceberDomain';
import { emitenteDaConfiguracao, montarRecibo, parseEmissaoDocumentos, parteDoCliente } from '../../utils/documentosCobrancaDomain';
import { gerarPdfRecibo } from '../../utils/documentosCobrancaPdf';
import { mensagemDoDocumento, parseMensagensPadrao } from '../../utils/mensagensPadraoDomain';
import PdfVisualizador from '../../components/common/PdfVisualizador';
import { abaterComCreditoDoCliente, alterarValorDaParcela, cancelarContaAReceber, desfazerRenegociacaoDaParcela, estornarBaixaComConfirmacao, prepararCobrancaEmBoleto, registrarBaixa, registrarChequeAReceber } from '../../services/baixaFinanceiraService';
import LancarContaReceberModal, { type ContaParaEditar } from '../../components/finance/LancarContaReceberModal';
import { CATEGORIAS_RECEITA_PADRAO, MOTIVO_MINIMO_CANCELAR, bloqueioParaMexerNaConta, ehContaAvulsa, nomeDoDevedor } from '../../utils/lancamentoReceberDomain';
import RenegociacaoModal, { type ParcelaParaRenegociar, type ResultadoDaRenegociacao } from '../../components/finance/RenegociacaoModal';
import {
  PERMISSAO_RENEGOCIAR,
  ehParcelaDeRenegociacao,
  validarMotivoRenegociacao,
  validarTitulosParaRenegociar,
  type RegistroRenegociacao,
} from '../../utils/renegociacaoDomain';
import { FORMA_BOLETO, bloqueioParaCobrarEmBoleto, validarVencimentoDoBoleto, vencimentoSugeridoDoBoleto } from '../../utils/cobrancaEmBoletoDomain';
import {
  bancoDoBoleto,
  carregarBancosComBoleto,
  dadosPdfDoBoleto,
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
  resumoDaAlteracaoValor,
  valorAlteradoAtivo,
  type AlteracaoValorRegistro,
} from '../../utils/alteracaoValorTituloDomain';
import { pedirNovoValorDaParcela } from '../../utils/alteracaoValorTituloUi';
import { creditoEhDoCliente, juntarCreditosSemRepetir } from '../../utils/creditoDomain';
import { useValoresOcultos } from '../../hooks/useValoresOcultos';
import BotaoOlhoValores from '../../components/common/BotaoOlhoValores';
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
import CreditosModal from '../../components/finance/CreditosModal';
import { creditosConsultaService, type SaldoDoCliente } from '../../services/creditosConsultaService';
import RelatorioPreview from '../../components/Reports/RelatorioPreview';
import RelatorioRecebimentos, { pedirPeriodoDosRecebimentos } from '../../components/finance/RelatorioRecebimentos';
import AcertoFornecedorModal from '../../components/finance/AcertoFornecedorModal';
import type { AcertoFeito } from '../../services/acertoFornecedorService';
import type { FiltroDeRecebimentos } from '../../utils/relatorioRecebimentosDomain';
import { montarComprovanteDoAcerto } from '../../utils/relatorioAcertoFornecedorDomain';
import { nomeArquivoRelatorio } from '../../utils/relatorioPdfDomain';
import { BaixaEmLoteModal, BarraDeSelecaoLote, CaixaDeSelecao, type ItemDoLote } from '../../components/finance/BaixaEmLote';
import { estadoDaSelecao, FORMAS_DA_BAIXA_EM_LOTE, LIMITE_BAIXA_EM_LOTE, marcarNaSelecao, podeEntrarNoLote } from '../../utils/baixaEmLoteDomain';
import { useTitulosFinanceiros, type HistoricoDePagas } from '../../hooks/useTitulosFinanceiros';
import {
  abaDaSituacao,
  clienteCasaComBusca,
  passaNaAbaGeral,
  percentualQuitado,
  periodoDosRecebidos,
  periodoRecebidosAtivo,
  ROTULO_PERIODO_RECEBIDOS,
  totaisDoCliente,
  type AbaReceber,
  type PeriodoRecebidos,
} from '../../utils/contasReceberAbasDomain';
import './ContasReceberAbas.css';
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
  /** Conta lancada a mao (19/10/2026, lancamentoReceberDomain): pode ser de fornecedor. */
  fornecedorId?: string | null;
  fornecedorNome?: string | null;
  origemLancamento?: string | null;
  origemImportacao?: string | null;
  lancadoPorNome?: string;
  documento?: string;
  observacao?: string;
  pagoParcialCentavos?: number;
  parcialDaTransacaoId?: string;
}

interface GrupoCliente {
  chave: string;
  clienteId: string | null;
  clienteNome: string;
  /** Grupo de conta a receber de FORNECEDOR (lancada a mao). */
  deFornecedor: boolean;
  transacoes: TransacaoData[];
  /** So' o que esta' em aberto (28/11/2026: antes, na lista "todas", somava os recebidos tambem). */
  totalPendente: number;
  /** Recebido no periodo (liquido menos o desconto da baixa), em reais. */
  totalRecebido: number;
  vencimentoMaisAntigo: string | null;
  diasAtrasoMax: number;
}

/** Regra compartilhada com o Dashboard -- ver transactionDueDateInput. */
const dataReferenciaTransacao = (t: TransacaoData) => transactionDueDateInput(t) || undefined;

// Formas que o "Dar Baixa" aceita; a filial escolhe quais usa (formasDeRecebimento).
const FORMAS_RECEBIMENTO = ['Dinheiro', 'Pix', 'Cartão de Crédito', 'Cartão de Débito', 'Transferência', 'Cheque', 'Outros'];

/** Recebido x em aberto de um cliente na aba Geral (28/11/2026), com a barra do quanto ja' foi quitado. */
const CelulaRecebidoEmAberto: React.FC<{ recebido: number; emAberto: number }> = ({ recebido, emAberto }) => {
  const { mostrar } = useValoresOcultos();
  const reais = (v: number) => mostrar(new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v));
  const quitado = percentualQuitado({ recebidoCentavos: Math.round(recebido * 100), emAbertoCentavos: Math.round(emAberto * 100) });
  return (
    <div className="receber-cliente-totais">
      <div><span>recebido</span> <strong className="receber-verde">{reais(recebido)}</strong></div>
      <div><span>em aberto</span> <strong className={emAberto > 0 ? 'receber-ambar' : undefined}>{reais(emAberto)}</strong></div>
      <div className="receber-barra" role="img" aria-label={`${quitado}% já recebido`} title={`${quitado}% do total deste cliente já foi recebido`}>
        <span style={{ width: `${quitado}%` }} />
      </div>
    </div>
  );
};

const ContasReceber: React.FC = () => {
  const { openTab } = useTabs();
  const { currentUser, tenantId, vendasVisiveisDeUsuarioId, userRole, userPermissions, isOwner } = useAuth();
  const podeEstornar = Boolean(isOwner || isPlatformAdminRole(userRole) || userPermissions?.includes('financeiro.estornar'));
  // Desconto na baixa (15/10/2026): permissao propria; dono e administrador ja' tem.
  const podeDescontar = Boolean(hasTenantFullAccess(userRole, isOwner) || isPlatformAdminRole(userRole) || userPermissions?.includes(PERMISSAO_DESCONTO_NA_BAIXA));
  const podeAlterarValor = Boolean(isOwner || isPlatformAdminRole(userRole) || userPermissions?.includes(PERMISSAO_ALTERAR_VALOR));
  const podeMexerEmBoleto = Boolean(isOwner || isPlatformAdminRole(userRole) || userPermissions?.includes('financeiro.boletos'));
  const podeRenegociar = Boolean(isOwner || isPlatformAdminRole(userRole) || userPermissions?.includes(PERMISSAO_RENEGOCIAR));
  // Uma permissao por acao (item 15, 25/11/2026): o servidor confere a mesma. Dono,
  // administrador e plataforma sempre; o funcionario, pelas efetivas do AuthContext
  // (ja' vem marcadas para quem tem Contas a Receber e ainda nao foi salvo de novo).
  const acessoTotal = hasTenantFullAccess(userRole, isOwner) || isPlatformAdminRole(userRole);
  const temAcao = (permissao: string) => acessoTotal || Boolean(userPermissions?.includes(permissao));
  const podeReceberBaixar = temAcao(PERMISSAO_FINANCEIRO.receberBaixar);
  const podeJurosMulta = temAcao(PERMISSAO_FINANCEIRO.baixaJurosMulta);
  const podeDataAnterior = temAcao(PERMISSAO_FINANCEIRO.baixaDataAnterior);
  const podeBaixaLote = temAcao(PERMISSAO_FINANCEIRO.baixaLote);
  const podeLancarConta = temAcao(PERMISSAO_FINANCEIRO.receberLancar);
  const podeEditarConta = temAcao(PERMISSAO_FINANCEIRO.receberEditar);
  const podeCancelarConta = temAcao(PERMISSAO_FINANCEIRO.receberCancelar);
  // O acerto da' baixa nos dois lados: alem da permissao dele, dar baixa em Receber e em Pagar.
  const podeAcerto = temAcao(PERMISSAO_FINANCEIRO.acertoFornecedor) && podeReceberBaixar && temAcao(PERMISSAO_FINANCEIRO.pagarBaixar);
  // Fase 2 (25/11/2026): credito do cliente (pelo servidor), recibo, WhatsApp, relatorios e importar.
  const podeCreditoCliente = temAcao(PERMISSAO_FINANCEIRO.baixaCreditoCliente);
  const podeRecibo = temAcao(PERMISSAO_FINANCEIRO.recibo);
  const podeCobrarWhatsapp = temAcao(PERMISSAO_FINANCEIRO.cobrarWhatsapp);
  const podeRelatorios = temAcao(PERMISSAO_FINANCEIRO.relatorios);
  const podeImportar = temAcao(PERMISSAO_FINANCEIRO.importarTitulos);
  // Creditos e de onde vem cada um (26/11/2026): saldo na linha do cliente e a ficha dos creditos.
  const podeVerCreditos = temAcao(PERMISSAO_FINANCEIRO.creditosVer);
  const [creditosAbertos, setCreditosAbertos] = useState<{ alvo: { id: string; nome: string } | null } | null>(null);
  const [saldosDeCredito, setSaldosDeCredito] = useState<SaldoDoCliente[]>([]);
  useEffect(() => {
    if (!podeVerCreditos || creditosAbertos) return;
    let ativo = true;
    creditosConsultaService.saldosDosClientes()
      .then((r) => { if (ativo) setSaldosDeCredito(r.clientes); })
      .catch((erro) => console.error('Erro ao ler os créditos dos clientes:', erro));
    return () => { ativo = false; };
  }, [podeVerCreditos, creditosAbertos]);
  /** Saldo de credito do cliente da linha (pelo codigo; credito antigo sem codigo, pelo nome). */
  const saldoDeCreditoDo = (clienteId: string | null, clienteNome: string): number => {
    const nome = clienteNome.trim().toUpperCase();
    return saldosDeCredito
      .filter((c) => (clienteId && c.clienteId ? c.clienteId === clienteId : c.clienteNome.trim().toUpperCase() === nome))
      .reduce((soma, c) => soma + c.saldoCentavos, 0);
  };
  const semPermissao = (permissao: string, acao: string) => `Você não tem permissão para ${acao}. Peça a um responsável liberar "${permissionLabelMap[permissao] || permissao}" no seu cadastro de funcionário.`;
  const [renegociando, setRenegociando] = useState<{ clienteNome: string; titulos: ParcelaParaRenegociar[] } | null>(null);
  
  const [modalConciliacao, setModalConciliacao] = useState<{ ativo: boolean, transacao: TransacaoData | null, creditos: any[], saldoTotal: number }>({
    ativo: false, transacao: null, creditos: [], saldoTotal: 0
  });
  const [valorAbater, setValorAbater] = useState<number>(0);
  const [dataBaixaCredito, setDataBaixaCredito] = useState<string>(getDateInputInTimeZone());
  const [isProcessing, setIsProcessing] = useState(false);
  // Uma conta (Dar Baixa) ou varias pagas com o MESMO cheque (Receber em lote, 28/11/2026).
  const [chequeBaixaState, setChequeBaixaState] = useState<{ transacoes: TransacaoData[]; bancoId?: string; bancoNome?: string } | null>(null);
  const [clientesExpandidos, setClientesExpandidos] = useState<Set<string>>(new Set());
  const [buscaCliente, setBuscaCliente] = useState('');
  // Codigo do cliente na lista (27/11/2026, pedido do dono): lido do cadastro em lotes, uma vez por cliente.
  const [codigosDosClientes, setCodigosDosClientes] = useState<Record<string, string>>({});
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
  // Recebimentos do periodo e acerto com fornecedor (24/11/2026, pedido do dono para a Jomarly).
  const [relatorioRecebimentos, setRelatorioRecebimentos] = useState<FiltroDeRecebimentos | null>(null);
  const [acertoAberto, setAcertoAberto] = useState(false);
  const [comprovanteDoAcerto, setComprovanteDoAcerto] = useState<AcertoFeito | null>(null);
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
  const [parametrosVendaDaFilial, setParametrosVenda] = useState<ParametrosVenda>(PARAMETROS_VENDA_PADRAO);
  // Juros e multa dos atrasados (24/11/2026): as % podem ser mudadas SO' nesta
  // tela (consulta e baixas daqui); nunca sao gravadas -- o padrao continua o da
  // configuracao da filial. null = vale a configuracao.
  const [percentuaisDaTela, setPercentuaisDaTela] = useState<PercentuaisDeAtraso | null>(null);
  const parametrosVenda = useMemo(
    () => parametrosComPercentuaisDaTela(parametrosVendaDaFilial, percentuaisDaTela),
    [parametrosVendaDaFilial, percentuaisDaTela],
  );
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
  // Conta lancada a mao (19/10/2026): janela de lancar/editar e o plano de contas de receitas da filial.
  const [lancamento, setLancamento] = useState<{ aberto: boolean; editando: ContaParaEditar | null }>({ aberto: false, editando: null });
  // "Nova Acao > Conta a Receber" no Dashboard (27/11/2026): abre o lancamento.
  useEffect(() => {
    const atender = () => {
      if (!consumirPedidoDeLancamento('receber')) return;
      if (podeLancarConta) setLancamento({ aberto: true, editando: null });
      else showWarning('Sem permissão', semPermissao(PERMISSAO_FINANCEIRO.receberLancar, 'lançar contas a receber'));
    };
    atender();
    window.addEventListener(EVENTO_ABRIR_LANCAMENTO, atender);
    return () => window.removeEventListener(EVENTO_ABRIR_LANCAMENTO, atender);
  }, [podeLancarConta]);
  const categoriasReceita = useMemo(() => {
    // Plano salvo + as pre-definidas dos lancamentos automaticos (28/11/2026).
    const limpas = planoEfetivo(configFilial).receitas;
    return limpas.length > 0 ? limpas : CATEGORIAS_RECEITA_PADRAO;
  }, [configFilial]);
  // Formas de pagamento "Usa" da filial: o recebimento acompanha a venda (16/10/2026).
  const ordemFormasDaFilial = useMemo(() => parseOrdemFormasPagamento(configFilial.ordemFormasPagamento), [configFilial]);
  const formasOcultasDaFilial = useMemo(() => parseFormasOcultas(configFilial.formasPagamentoOcultas), [configFilial]);
  // Pagamento simplificado (16/10/2026): cheque sem dados e sem banco (escolhido ao compensar).
  const pagamentoSimplificado = useMemo(() => parsePagamentoCartaoSimplificadoAtivo(configFilial.pagamentoCartaoSimplificadoAtivo), [configFilial]);
  const [pdfRecibo, setPdfRecibo] = useState<{ blob: Blob; nome: string } | null>(null);
  // Boleto emitido pelo Dar Baixa (15/10/2026): abre o PDF na hora, como na tela de Boletos.
  const [pdfBoleto, setPdfBoleto] = useState<{ blob: Blob; nome: string } | null>(null);

  /**
   * Recibo de pagamento em PDF (Configuracoes por filial, fase D -- 2026-10-07):
   * o titulo recebido mais os juros/multa da baixa, com a mensagem padrao da
   * filial. Sempre disponivel pelo botao "Recibo" da conta recebida; ao dar
   * baixa, sai conforme a filial configurou (perguntar / sempre / nunca).
   */
  const emitirRecibo = async (t: TransacaoData, dados: { formaPagamento?: string; dataPagamento?: string; acrescimoCentavos?: number; descontoCentavos?: number; principalCentavos?: number; reciboId?: string }) => {
    if (!podeRecibo) {
      showWarning('Sem permissão', semPermissao(PERMISSAO_FINANCEIRO.recibo, 'emitir recibo de pagamento'));
      return;
    }
    try {
      let cadastroCliente: unknown = null;
      if (t.clienteId) {
        const snapCliente = await getDoc(doc(db, 'clientes', t.clienteId));
        if (snapCliente.exists()) cadastroCliente = snapCliente.data();
      } else if (t.fornecedorId) {
        // Conta a receber de fornecedor (19/10/2026): o recibo sai com o cadastro dele.
        const snapFornecedor = await getDoc(doc(db, 'fornecedores', t.fornecedorId));
        if (snapFornecedor.exists()) cadastroCliente = snapFornecedor.data();
      }
      const recibo = montarRecibo({
        titulo: {
          // Parcial: o numero vem do lancamento parcial (cada pagamento tem o seu recibo).
          id: dados.reciboId || t.id,
          // Pagamento parcial (16/10/2026): o recibo e' do que entrou agora.
          descricao: dados.principalCentavos !== undefined ? `${t.descricao} (pagamento parcial)` : t.descricao,
          valorCentavos: dados.principalCentavos ?? transactionNetCents(t),
          formaPagamento: dados.formaPagamento || t.formaPagamento,
          dataPagamento: dados.dataPagamento || t.dataPagamento || getDateInputInTimeZone(),
        },
        acrescimoCentavos: dados.acrescimoCentavos,
        descontoCentavos: dados.descontoCentavos,
        empresa: emitenteDaConfiguracao(configFilial),
        cliente: parteDoCliente(cadastroCliente, nomeDoDevedor(t) || 'Cliente'),
        mensagem: mensagemDoDocumento(parseMensagensPadrao(configFilial.mensagensPadrao), 'recibo'),
      });
      setPdfRecibo({ blob: gerarPdfRecibo(recibo, emissaoDocumentos.recibo.vias), nome: `RECIBO ${recibo.numero} - ${recibo.pagador.nome}.pdf` });
    } catch (error) {
      console.error('Erro ao gerar o recibo:', error);
      showError('Não foi possível gerar o recibo', error instanceof Error ? error.message : 'Tente de novo pelo botão Recibo da conta recebida.');
    }
  };

  const oferecerRecibo = async (t: TransacaoData, dados: { formaPagamento?: string; dataPagamento?: string; acrescimoCentavos?: number; descontoCentavos?: number; principalCentavos?: number; reciboId?: string }) => {
    const modo = emissaoDocumentos.recibo.modo;
    // Sem a permissao de recibo (item 15, fase 2), a baixa segue sem oferecer o recibo.
    if (modo === 'nunca' || !podeRecibo) return;
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
    if (!tenantId || !currentUser) return undefined;
    return registrarBaixa({
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
    /** null = pagamento simplificado: cheque sem os dados (16/10/2026). */
    dadosCheque: ChequeDetails | null,
    dataCompensacao: string,
    bancoId?: string,
  ) => {
    if (!tenantId || !currentUser) return;
    // Pelo servidor (item 15, fase 2, 25/11/2026): mesma regra de antes -- a conta
    // continua em aberto, pelo valor inteiro, ate' o cheque compensar.
    await registrarChequeAReceber({
      transacaoId: t.id,
      dataCompensacao,
      ...(bancoId ? { bancoId } : {}),
      cheque: dadosCheque,
      tenantId,
    });
  };

  /**
   * O mesmo cheque para uma ou varias contas (Receber em lote com Cheque,
   * 28/11/2026). Cada conta fica em aberto pelo valor cheio ate' o cheque
   * compensar; uma que falhe nao desfaz as outras, e a mensagem diz qual.
   */
  const registrarChequeEmVarias = async (
    transacoes: TransacaoData[],
    dadosCheque: ChequeDetails | null,
    dataCompensacao: string,
    bancoId?: string,
  ) => {
    const falhas: string[] = [];
    const feitas: string[] = [];
    for (const t of transacoes) {
      try {
        await registrarChequeParaCompensar(t, dadosCheque, dataCompensacao, bancoId);
        feitas.push(t.id);
      } catch (erro) {
        console.error('Erro ao registrar cheque para baixa:', erro);
        falhas.push(`${t.descricao || 'Conta'}: ${erro instanceof Error && erro.message ? erro.message : 'não foi possível registrar.'}`);
      }
    }
    if (feitas.length > 0) setSelecionados((atual) => marcarNaSelecao(atual, feitas, false).selecao);
    const onde = bancoId
      ? 'Ele aparece em Financeiro → Cheques até ser compensado.'
      : 'Ele aparece em Financeiro → Cheques até ser compensado (o banco é escolhido ao compensar).';
    if (falhas.length === 0) {
      showSuccess(transacoes.length === 1 ? `Cheque registrado! ${onde}` : `Cheque registrado para ${transacoes.length} contas! ${onde}`);
      return;
    }
    showError(
      feitas.length > 0 ? `Cheque registrado em ${feitas.length} de ${transacoes.length} contas` : 'Não foi possível registrar o cheque',
      `${falhas.join(' ')} Confira essas contas e tente de novo pelo Dar Baixa de cada uma.`,
    );
  };

  /** Receber em lote com Cheque: simplificado registra direto; senao pede os dados do cheque uma vez, com o total. */
  const receberLoteEmCheque = async (pedido: { ids: string[]; data: string; bancoId: string }) => {
    const transacoes = pedido.ids.map((id) => elegiveis.get(id)).filter((t): t is TransacaoData => Boolean(t));
    if (transacoes.length === 0) return;
    const bancoId = pedido.bancoId || undefined;
    if (pagamentoSimplificado) {
      await registrarChequeEmVarias(transacoes, null, pedido.data, bancoId);
      return;
    }
    setChequeBaixaState({ transacoes, bancoId });
  };

  const solicitarFormaRecebimento = async (t: TransacaoData) => {
    // So' as formas marcadas como "Usa" na filial, na ordem dela (16/10/2026).
    const formasDaFilial = formasDeRecebimento([...FORMAS_RECEBIMENTO, FORMA_BOLETO], ordemFormasDaFilial, formasOcultasDaFilial);
    const FORMAS_RECEBIMENTO_DA_FILIAL = formasDaFilial.filter((forma) => forma !== FORMA_BOLETO);
    // Boleto (15/10/2026): so' com banco preparado para boleto e permissao de Boletos.
    // Escolher "Boleto" nao da' baixa -- emite o boleto (emitirBoletoPelaBaixa).
    let bancosComBoleto: BancoBoleto[] = [];
    if (tenantId && podeMexerEmBoleto && formasDaFilial.includes(FORMA_BOLETO) && !bloqueioParaCobrarEmBoleto({ ...t, tipo: t.tipo || 'entrada' })) {
      try {
        bancosComBoleto = await carregarBancosComBoleto(tenantId);
      } catch (erro) {
        console.warn('Contas a Receber: não foi possível conferir os bancos de boleto.', erro);
      }
    }
    const formas = bancosComBoleto.length > 0 ? [...FORMAS_RECEBIMENTO_DA_FILIAL, FORMA_BOLETO] : FORMAS_RECEBIMENTO_DA_FILIAL;
    if (formas.length === 0) {
      showError('Nenhuma forma de recebimento', MENSAGEM_SEM_FORMA_DE_RECEBIMENTO);
      return;
    }
    // Titulo vencido com juros/multa configurados na filial: ja' vem preenchido (editavel).
    // Mesmo vencimento que a lista usa para os dias em atraso (24/11/2026): o que a lista mostra e' o que a janela sugere.
    // Sem "alterar juros e multa" (item 15): sempre as % da filial (nunca as mudadas so' nesta tela), travadas.
    const parametrosDaBaixa = podeJurosMulta ? parametrosVenda : parametrosVendaDaFilial;
    const sugestao = acrescimoPorAtraso(parametrosDaBaixa, transactionNetCents(t), dataReferenciaTransacao(t), getDateInputInTimeZone());
    const semPercentuais = parametrosVenda.juros.aoMesPercentual <= 0 && parametrosVenda.juros.multaPercentual <= 0;
    const vencido = diasDeAtraso(dataReferenciaTransacao(t), getDateInputInTimeZone()) > 0;
    // Banco na mesma janela (23/11/2026): as formas que creditam um banco pedem
    // o banco logo abaixo da forma, em vez de uma segunda janela depois.
    // Cheque (28/11/2026, pedido do dono): o banco aparece mas e' opcional --
    // "Indefinido" deixa a escolha para a compensacao em Financeiro > Cheques.
    const formasComBanco = formas.filter((forma) => forma !== FORMA_BOLETO && forma !== 'Cheque'
      && paymentRequiresBankAccount(forma as PaymentMethod));
    const formasComBancoOpcional = formas.includes('Cheque') ? ['Cheque'] : [];
    let bancosDisponiveis: Array<{ id: string; nome: string }> = [];
    if (formasComBanco.length > 0 || formasComBancoOpcional.length > 0) {
      try {
        const snapBancos = await getDocs(query(collection(db, 'bancos'), where('tenantId', '==', tenantId), where('ativo', '==', true)));
        bancosDisponiveis = snapBancos.docs.map((d) => ({ id: d.id, nome: String(d.data().nome || '') }));
      } catch (erro) {
        console.error('Contas a Receber: não foi possível ler os bancos.', erro);
        showError('Não foi possível ler os bancos', 'Confira a internet e tente de novo.');
        return;
      }
    }
    const dados = await pedirDadosBaixa({
      titulo: 'Confirmar Recebimento?',
      texto: `Valor líquido de R$ ${transactionNetAmount(t).toFixed(2)} referente a ${t.descricao}.`,
      valorCentavos: transactionNetCents(t),
      rotuloValor: 'Valor recebido agora',
      // Pagamento parcial (16/10/2026): menos que o total deixa o resto em aberto.
      bloqueioParcial: bloqueioDoParcial(t as TituloParaParcial),
      sugestao: sugestao ? { jurosCentavos: sugestao.jurosCentavos, multaCentavos: sugestao.multaCentavos, detalhe: descricaoDoAcrescimo(sugestao) } : null,
      sugestaoNaData: (data: string) => {
        const nova = acrescimoPorAtraso(parametrosDaBaixa, transactionNetCents(t), dataReferenciaTransacao(t), data);
        return nova ? { jurosCentavos: nova.jurosCentavos, multaCentavos: nova.multaCentavos, detalhe: descricaoDoAcrescimo(nova) } : null;
      },
      podeDescontar,
      podeJurosMulta,
      podeDataAnterior,
      formasSemAjuste: ['Cheque', FORMA_BOLETO],
      dica: vencido && semPercentuais
        ? 'Conta vencida. Para o sistema já calcular os juros e a multa, preencha as % em Configurações da filial › Parâmetros de venda › "Juros e multa do crediário em atraso".'
        : undefined,
      formas,
      rotulosDasFormas: { [FORMA_BOLETO]: 'Boleto (emitir o boleto agora)' },
      // Boleto nao da' baixa: a janela vira "Emitir boleto", com o vencimento (24/11/2026).
      ...(formas.includes(FORMA_BOLETO) ? {
        emissao: {
          forma: FORMA_BOLETO,
          titulo: 'Emitir boleto',
          textoConfirmar: 'Emitir boleto',
          texto: `A conta não é baixada agora: o boleto sai em PDF${bancosComBoleto[0] ? ` pelo banco ${bancosComBoleto[0].nome}` : ''} e a baixa entra sozinha quando o retorno do banco for importado em Financeiro › Boletos.`,
          vencimentoSugerido: vencimentoSugeridoDoBoleto(dataReferenciaTransacao(t), getDateInputInTimeZone()),
          vencimentoMinimo: getDateInputInTimeZone(),
          validarVencimento: (v: string) => validarVencimentoDoBoleto(v, getDateInputInTimeZone()),
        },
      } : {}),
      formaInicial: t.formaPagamento && formas.includes(t.formaPagamento) ? t.formaPagamento : '',
      rotuloForma: 'Como foi recebido?',
      mensagemSemForma: 'Escolha como foi recebido antes de confirmar.',
      rotuloData: 'Data do recebimento (para cheque, vale a data de compensação)',
      textoConfirmar: 'Confirmar recebimento',
      banco: {
        bancos: bancosDisponiveis,
        formas: formasComBanco,
        formasOpcionais: formasComBancoOpcional,
        rotulo: (forma) => (forma === 'Cheque' ? 'Em qual banco vai cair quando compensar?' : 'Em qual banco caiu?'),
      },
    });
    if (!dados) return;
    if (dados.forma === FORMA_BOLETO) {
      await emitirBoletoPelaBaixa(t, bancosComBoleto, dados.vencimentoBoleto);
      return;
    }
    const formaPgto = dados.forma as PaymentMethod;
    const dataRecebimento = dados.data;

    // O banco veio da mesma janela (pedirDadosBaixa) quando a forma pede banco.
    const bancoId: string | undefined = formasComBanco.includes(formaPgto) || formasComBancoOpcional.includes(formaPgto) ? (dados.bancoId || undefined) : undefined;
    const bancoNome: string | undefined = bancoId ? bancosDisponiveis.find((b) => b.id === bancoId)?.nome : undefined;

    // Cheque nunca confirma na hora -- abre o modal de digitação, e só
    // quando confirmado lá é que registra (Pendente, aguardando
    // compensação em Financeiro > Cheques). Ver registrarChequeParaCompensar.
    if (formaPgto === 'Cheque') {
      if (pagamentoSimplificado) {
        // Simplificado: sem os dados do cheque; "bom para" = a data informada acima.
        try {
          await registrarChequeParaCompensar(t, null, dataRecebimento, bancoId);
          showSuccess(bancoId
            ? 'Cheque registrado! Ele aparece em Financeiro → Cheques até ser compensado.'
            : 'Cheque registrado! Ele aparece em Financeiro → Cheques até ser compensado (o banco é escolhido ao compensar).');
        } catch (error) {
          console.error('Erro ao registrar cheque para baixa:', error);
          showError('Não foi possível registrar o cheque', error instanceof Error ? error.message : 'Tente de novo em instantes.');
        }
        return;
      }
      setChequeBaixaState({ transacoes: [t], bancoId, bancoNome });
      return;
    }

    try {
      const gravado = await confirmarRecebimento(t, formaPgto, bancoId, dataRecebimento, dados.ajustes, dados.valorRecebidoCentavos);
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
        ...(parcial ? { principalCentavos: principal, reciboId: gravado?.parcial?.transacaoId } : {}),
      });
    } catch (error) {
      console.error('Erro ao confirmar recebimento:', error);
      showError('Erro', error instanceof Error ? error.message : 'Não foi possível aprovar a transação.');
    }
  };

  const handleConciliar = async (t: TransacaoData) => {
    if (!podeReceberBaixar) {
      showWarning('Sem permissão', semPermissao(PERMISSAO_FINANCEIRO.receberBaixar, 'dar baixa em contas a receber'));
      return;
    }
    // Parcela de renegociacao: o abatimento com credito grava pelo navegador e nao
    // quitaria as vendas de origem quando a renegociacao fecha -- recebe pelo servidor.
    if (ehParcelaDeRenegociacao(t)) {
      await solicitarFormaRecebimento(t);
      return;
    }
    // Sem "abater com credito do cliente" (item 15, fase 2): recebe sem oferecer o credito.
    if (!podeCreditoCliente) {
      await solicitarFormaRecebimento(t);
      return;
    }
    let saldoCredito = 0;
    const creditosAtivos: any[] = [];
    
    // Credito pelo codigo do cliente E pelo nome (21/11/2026): so' pelo nome,
    // renomear o cadastro escondia o credito (creditoDomain.ts).
    const idDoCliente = typeof t.clienteId === 'string' ? t.clienteId : '';
    if (t.clienteNome || idDoCliente) {
      const emAberto = where('status', 'in', ['disponivel', 'usado_parcial']);
      const [porNome, porCodigo] = await Promise.all([
        t.clienteNome
          ? getDocs(query(collection(db, 'creditos_cliente'), where('tenantId', '==', tenantId), where('clienteNome', '==', t.clienteNome), emAberto))
          : Promise.resolve(null),
        idDoCliente
          ? getDocs(query(collection(db, 'creditos_cliente'), where('tenantId', '==', tenantId), where('clienteId', '==', idDoCliente), emAberto))
          : Promise.resolve(null),
      ]);
      const doCliente = juntarCreditosSemRepetir(porCodigo?.docs ?? [], porNome?.docs ?? [])
        .filter((d) => creditoEhDoCliente(d.data(), { id: idDoCliente, nome: t.clienteNome }));
      doCliente.forEach(d => {
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
    if (!podeDataAnterior && dataBaixaCredito !== getDateInputInTimeZone()) {
      showError('Data inválida', semPermissao(PERMISSAO_FINANCEIRO.baixaDataAnterior, 'dar baixa com data anterior a hoje'));
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
      // Pelo servidor (item 15, fase 2, 25/11/2026): le os creditos do cliente, abate
      // ou quita, acerta a venda/OS e grava o Historico de alteracoes.
      const r = await abaterComCreditoDoCliente({
        transacaoId: t.id,
        valorCentavos: creditCents,
        dataPagamento: dataBaixaCredito,
        valorEsperadoCentavos: expectedTransactionCents,
        tenantId,
      });

      // Cashback (20/10/2026): titulo quitado pode ter deixado a venda toda paga -- o servidor confere e gera.
      if (r.quitou && t.pedidoId) void gerarCashbackSemFalhar(String(t.pedidoId));

      showSuccess(r.quitou
        ? 'Conta quitada com o crédito do cliente!'
        : `Crédito aplicado. Restam R$ ${fromCents(r.restanteCentavos).toFixed(2)} pendentes.`);
      fecharModalConciliacao();
    } catch (error) {
      console.error(error);
      showError('Não foi possível usar o crédito', error instanceof Error ? error.message : 'Ocorreu um erro ao processar o abatimento.');
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
   * Conta que e' de boleto (forma Boleto) e ainda nao tem boleto emitido: o botao
   * principal da linha e' "Emitir boleto" (24/11/2026, pedido do dono -- "Dar
   * Baixa" para emitir boleto confundia o cliente). O "Dar Baixa" continua ao
   * lado para quem pagou de outro jeito.
   */
  const contaParaEmitirBoleto = (t: TransacaoData): boolean => (
    podeMexerEmBoleto && t.formaPagamento === FORMA_BOLETO && !bloqueioParaCobrarEmBoleto({ ...t, tipo: t.tipo || 'entrada' })
  );

  const emitirBoletoDaLinha = async (t: TransacaoData) => {
    if (!tenantId) return;
    let bancosComBoleto: BancoBoleto[];
    try {
      bancosComBoleto = await carregarBancosComBoleto(tenantId);
    } catch (erro) {
      console.error('Contas a Receber: não foi possível ler os bancos de boleto.', erro);
      showError('Não foi possível ler os bancos', 'Confira a internet e tente de novo.');
      return;
    }
    if (bancosComBoleto.length === 0) {
      showError('Nenhum banco preparado para boleto', 'Abra Cadastros Auxiliares → Bancos, edite o banco do Sicoob e marque "Emite boleto por este banco".');
      return;
    }
    await emitirBoletoPelaBaixa(t, bancosComBoleto);
  };

  /**
   * "Dar Baixa" com a forma Boleto (15/10/2026, decisao do dono): em vez de dar
   * baixa, pede o vencimento e EMITE o boleto na hora -- a mesma emissao da tela
   * de Boletos (services/boletoEmissaoService). A baixa vem depois, sozinha,
   * pelo retorno do banco. A venda nao muda.
   */
  const emitirBoletoPelaBaixa = async (t: TransacaoData, bancosComBoleto: BancoBoleto[], vencimentoJaEscolhido?: string) => {
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
    // Vencimento ja' escolhido na janela do Dar Baixa (24/11/2026): nao pergunta de novo.
    const resposta = vencimentoJaEscolhido ? { isConfirmed: true, value: vencimentoJaEscolhido } : await NexusSwal.fire({
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

  // ---- Conta lancada a mao (19/10/2026): lancar, editar e cancelar pelo servidor, com log.
  const abrirEdicao = (t: TransacaoData) => {
    if (!podeEditarConta) {
      showWarning('Sem permissão', semPermissao(PERMISSAO_FINANCEIRO.receberEditar, 'alterar contas a receber'));
      return;
    }
    const bloqueio = bloqueioParaMexerNaConta(t, 'editar');
    if (bloqueio) { showWarning('Não dá para editar esta conta', bloqueio); return; }
    setLancamento({
      aberto: true,
      editando: {
        id: t.id,
        descricao: t.descricao,
        categoria: t.categoria,
        formaPagamento: t.formaPagamento,
        vencimento: dataReferenciaTransacao(t) || t.data,
        valor: transactionNetAmount(t),
        documento: t.documento,
        observacao: t.observacao,
        clienteId: t.clienteId,
        clienteNome: t.clienteNome,
        fornecedorId: t.fornecedorId,
        fornecedorNome: t.fornecedorNome,
      },
    });
  };

  const handleCancelarConta = async (t: TransacaoData) => {
    if (!tenantId) return;
    if (!podeCancelarConta) {
      showWarning('Sem permissão', semPermissao(PERMISSAO_FINANCEIRO.receberCancelar, 'cancelar contas a receber'));
      return;
    }
    const bloqueio = bloqueioParaMexerNaConta(t, 'cancelar');
    if (bloqueio) { showWarning('Não dá para cancelar esta conta', bloqueio); return; }
    const valorTexto = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(transactionNetAmount(t));
    const resposta = await NexusSwal.fire({
      title: 'Cancelar esta conta a receber?',
      html: `<div style="text-align:left"><b>${escaparHtml(t.descricao)}</b><br/>${escaparHtml(nomeDoDevedor(t) || 'Sem nome')} · ${valorTexto}<br/><br/>A conta sai do Contas a Receber e fica registrada como cancelada. Escreva o motivo do cancelamento:</div>`,
      input: 'text',
      showCancelButton: true,
      confirmButtonText: 'Cancelar a conta',
      cancelButtonText: 'Voltar',
      confirmButtonColor: '#ef4444',
      preConfirm: (motivo) => {
        if (!motivo || String(motivo).trim().length < MOTIVO_MINIMO_CANCELAR) {
          NexusSwal.showValidationMessage(`Escreva o motivo (pelo menos ${MOTIVO_MINIMO_CANCELAR} letras).`);
          return false;
        }
        return String(motivo).trim();
      },
    });
    if (!resposta.isConfirmed) return;
    setIsProcessing(true);
    try {
      await cancelarContaAReceber({ transacaoId: t.id, motivo: String(resposta.value), tenantId });
      showSuccess('Conta a receber cancelada.');
    } catch (erro) {
      showError('Não foi possível cancelar', erro instanceof Error ? erro.message : 'Tente de novo em instantes.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCobrarWhatsApp = (t: TransacaoData) => {
    const nomeCliente = nomeDoDevedor(t) || 'Cliente';
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
  // Atrasados ja' com juros e multa (24/11/2026): mesma conta da janela de baixa, com as % que valem na tela.
  const acrescimoDaLista = (t: TransacaoData): AcrescimoPorAtraso | null => acrescimoDoTitulo(
    parametrosVenda,
    { status: t.status, valorCentavos: transactionNetCents(t), dataVencimento: dataReferenciaTransacao(t) },
    hojeStr,
  );
  const percentuaisDaFilial: PercentuaisDeAtraso = parametrosVendaDaFilial.juros;
  const percentuaisEmUso: PercentuaisDeAtraso = parametrosVenda.juros;
  const totalAcrescimoCentavos = somaDosAcrescimos(contasPendentes.map(acrescimoDaLista));
  const haVencidas = contasPendentes.some((t) => diasDeAtraso(dataReferenciaTransacao(t), hojeStr) > 0);
  const alterarPercentuaisNaTela = async () => {
    const r = await NexusSwal.fire({
      title: 'Juros e multa desta consulta',
      html: `<p style="margin:0 0 10px;text-align:left;">Vale só nesta tela (a lista e as baixas feitas daqui). Não fica salvo: ao abrir a tela de novo volta o padrão da filial${temPercentuais(percentuaisDaFilial) ? ` (${escaparHtml(textoDosPercentuais(percentuaisDaFilial))})` : ''}. Para mudar o padrão, use Configurações da filial › Parâmetros de venda.</p>
        <label style="display:block;text-align:left;font-weight:600;margin-top:8px;">Juros ao mês (%)
          <input id="tela-juros" class="swal2-input" inputmode="decimal" value="${escaparHtml(campoDoPercentual(percentuaisEmUso.aoMesPercentual))}" style="margin:4px 0 0;width:100%;"></label>
        <label style="display:block;text-align:left;font-weight:600;margin-top:12px;">Multa (%)
          <input id="tela-multa" class="swal2-input" inputmode="decimal" value="${escaparHtml(campoDoPercentual(percentuaisEmUso.multaPercentual))}" style="margin:4px 0 0;width:100%;"></label>`,
      showCancelButton: true,
      confirmButtonText: 'Usar nesta consulta',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const lido = lerPercentuaisDaTela(
          (document.getElementById('tela-juros') as HTMLInputElement | null)?.value || '',
          (document.getElementById('tela-multa') as HTMLInputElement | null)?.value || '',
        );
        if ('erro' in lido) { NexusSwal.showValidationMessage(lido.erro); return false; }
        return lido.percentuais;
      },
    });
    if (!r.isConfirmed || !r.value) return;
    const escolhidos = r.value as PercentuaisDeAtraso;
    setPercentuaisDaTela(mesmosPercentuais(escolhidos, percentuaisDaFilial) ? null : escolhidos);
  };
  // Recebimento de venda/OS cancelada nao conta (cancelar so' remove -- 19/10/2026).
  const recebimentosHoje = transacoes.filter(t => t.status === 'Paga' && t.dataPagamento === hojeStr && !lancamentoDesfeito(t));

  // Olhinho (21/11/2026): esconde os totais do topo junto com as outras telas.
  const { mostrar: mostrarValor } = useValoresOcultos();
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
    // Aba Geral (28/11/2026): todo em aberto + o recebido no periodo, pela data do recebimento.
    if (situacaoTitulo === 'todas') return passaNaAbaGeral(titulo, periodoDe, periodoAte);
    return passaNaSituacaoTitulo(titulo, hojeStr, situacaoTitulo)
      && passaNoPeriodoDoTitulo(titulo, situacaoTitulo, periodoDe, periodoAte);
  });
  const abaAtiva = abaDaSituacao(situacaoTitulo);
  const totaisDaLista = totaisDoCliente(titulosFiltrados.map((t) => ({
    status: t.status,
    liquidoCentavos: transactionNetCents(t),
    descontoCentavos: Number(t.baixaManual?.descontoCentavos) || 0,
  })));
  const periodoRapido = periodoRecebidosAtivo(periodoDe, periodoAte, hojeStr);
  const escolherPeriodoRecebidos = (periodo: PeriodoRecebidos) => {
    const r = periodoDosRecebidos(periodo, hojeStr);
    setPeriodoDe(r.de);
    setPeriodoAte(r.ate);
  };
  const irParaAba = (aba: AbaReceber) => {
    if (aba === abaAtiva) return;
    setSituacaoTitulo(aba === 'abertos' ? 'abertas' : 'todas');
    // O periodo de cada aba e' outro (vencimento x recebimento): troca de aba limpa.
    setPeriodoDe('');
    setPeriodoAte('');
  };
  const filtrosAtivos = (situacaoTitulo !== SITUACAO_TITULO_PADRAO ? 1 : 0) + (periodoDe || periodoAte ? 1 : 0);
  const limparFiltros = () => {
    setSituacaoTitulo(SITUACAO_TITULO_PADRAO);
    setPeriodoDe('');
    setPeriodoAte('');
  };
  const listandoRecebidas = situacaoTitulo === 'pagas';
  const rotuloQuantidade = listandoRecebidas ? 'Títulos recebidos' : situacaoTitulo === 'todas' ? 'Títulos' : 'Títulos em aberto';
  const rotuloValor = listandoRecebidas ? 'Valor recebido (R$)' : situacaoTitulo === 'todas' ? 'Recebido × em aberto (R$)' : 'Valor pendente (R$)';

  // Agrupa os titulos filtrados por cliente. Usa clienteId quando disponivel
  // (vendas/OS finalizadas a partir de 2026-07-29); registros antigos sem
  // clienteId agrupam pelo nome, sem garantia de que seja o mesmo cadastro.
  const gruposPorCliente: GrupoCliente[] = (() => {
    const mapa = new Map<string, GrupoCliente>();
    titulosFiltrados.forEach((t) => {
      // Conta de fornecedor (lancada a mao, 19/10/2026) agrupa pelo fornecedor, nunca junto de cliente com o mesmo nome.
      const deFornecedor = Boolean(t.fornecedorId);
      const nome = (deFornecedor ? t.fornecedorNome?.trim() : t.clienteNome?.trim()) || (deFornecedor ? 'Fornecedor não identificado' : 'Cliente não identificado');
      const chave = deFornecedor ? `fornecedor:${t.fornecedorId}` : t.clienteId ? `id:${t.clienteId}` : `nome:${nome.toUpperCase()}`;
      const dataRef = dataReferenciaTransacao(t);
      const diasAtraso = dataRef && t.status === 'Pendente' ? (differenceInCalendarDays(dataRef, hojeStr) ?? 0) : 0;

      let grupo = mapa.get(chave);
      if (!grupo) {
        grupo = {
          chave,
          clienteId: t.clienteId || null,
          clienteNome: nome,
          deFornecedor,
          transacoes: [],
          totalPendente: 0,
          totalRecebido: 0,
          vencimentoMaisAntigo: null,
          diasAtrasoMax: 0,
        };
        mapa.set(chave, grupo);
      }
      grupo.transacoes.push(t);
      if (t.status === 'Paga') grupo.totalRecebido += Math.max(0, transactionNetAmount(t) - (Number(t.baixaManual?.descontoCentavos) || 0) / 100);
      else grupo.totalPendente += transactionNetAmount(t);
      if (dataRef && (!grupo.vencimentoMaisAntigo || dataRef < grupo.vencimentoMaisAntigo)) {
        grupo.vencimentoMaisAntigo = dataRef;
      }
      grupo.diasAtrasoMax = Math.max(grupo.diasAtrasoMax, diasAtraso);
    });

    return Array.from(mapa.values())
      .filter((g) => {
        const codigo = g.clienteId ? (codigosDosClientes[g.clienteId] || '') : '';
        return clienteCasaComBusca(g.clienteNome, codigo, buscaCliente);
      })
      .sort((a, b) => b.totalPendente - a.totalPendente || b.totalRecebido - a.totalRecebido);
  })();

  // Codigos que faltam: so' dos clientes que estao na lista agora (lotes de LOTE_IN_POR_ID).
  const idsSemCodigo = [...new Set(titulosFiltrados.map((t) => (!t.fornecedorId && t.clienteId ? t.clienteId : '')).filter((id) => id && !(id in codigosDosClientes)))].sort().join('|');
  useEffect(() => {
    if (!idsSemCodigo || !tenantId) return undefined;
    let vivo = true;
    const ids = idsSemCodigo.split('|');
    const lotes: string[][] = [];
    for (let i = 0; i < ids.length; i += LOTE_IN_POR_ID) lotes.push(ids.slice(i, i + LOTE_IN_POR_ID));
    Promise.all(lotes.map((lote) => getDocs(query(collection(db, 'clientes'), where('tenantId', '==', tenantId), where(documentId(), 'in', lote)))
      .then((snap) => {
        const achados: Record<string, string> = Object.fromEntries(lote.map((id) => [id, '']));
        snap.forEach((d) => { achados[d.id] = String(d.data().codigo ?? '').trim(); });
        return achados;
      })
      .catch(() => Object.fromEntries(lote.map((id) => [id, ''])) as Record<string, string>)))
      .then((partes) => { if (vivo) setCodigosDosClientes((atual) => Object.assign({}, atual, ...partes)); });
    return () => { vivo = false; };
  }, [idsSemCodigo, tenantId]);

  // ---- Baixa em lote: so' conta em aberto, sem cheque nem cartao (baixaEmLoteDomain).
  const elegiveis = new Map(titulosFiltrados.filter((t) => podeEntrarNoLote(t, 'entrada')).map((t) => [t.id, t]));
  const idsElegiveisDoGrupo = (grupo: GrupoCliente) => grupo.transacoes.filter((t) => elegiveis.has(t.id)).map((t) => t.id);
  const idsElegiveisVisiveis = gruposPorCliente.flatMap(idsElegiveisDoGrupo);
  // Velocidade (24/11/2026): a tabela desenha os clientes em blocos; totais e selecao seguem na lista inteira.
  const blocosDeClientes = useLinhasEmBlocos(gruposPorCliente, buscaCliente);
  const selecaoValida = [...selecionados].filter((id) => elegiveis.has(id));
  const marcar = (ids: string[], marcarIds: boolean) => {
    const { selecao, deFora } = marcarNaSelecao(selecionados, ids, marcarIds);
    setSelecionados(selecao);
    if (deFora > 0) {
      showWarning(`Até ${LIMITE_BAIXA_EM_LOTE} contas por vez`, `${deFora} ${deFora === 1 ? 'conta ficou' : 'contas ficaram'} de fora. Dê baixa nestas e selecione o resto depois.`);
    }
  };
  const montarItemDoLote = (t: TransacaoData): ItemDoLote => {
    const sugestao = acrescimoDaLista(t);
    return {
      id: t.id,
      nome: nomeDoDevedor(t) || 'Cliente não identificado',
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
    // Uma conta marcada (28/11/2026, pedido do dono): "Receber" abre a MESMA
    // janela do Dar Baixa (credito do cliente, juros, multa, cheque, boleto, parcial).
    if (selecaoValida.length === 1) {
      const unica = elegiveis.get(selecaoValida[0]);
      if (unica) void handleConciliar(unica);
      return;
    }
    if (!podeBaixaLote || !podeReceberBaixar) return;
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
  const fecharRenegociacao = (renegociou: boolean, resultado?: ResultadoDaRenegociacao) => {
    const ids = renegociando?.titulos.map((t) => t.id) || [];
    const clienteNome = renegociando?.clienteNome || '';
    setRenegociando(null);
    if (!renegociou) return;
    setSelecionados((atual) => marcarNaSelecao(atual, ids, false).selecao);
    if (resultado && resultado.formaPagamento === FORMA_BOLETO) {
      void emitirBoletosDaRenegociacao(resultado, clienteNome);
      return;
    }
    showSuccess('Renegociação registrada. As parcelas novas já estão na lista do cliente.');
  };

  /**
   * Renegociacao em Boleto (24/11/2026, pedido do dono): os boletos das parcelas
   * novas saem na hora, num PDF so', como no "Dar Baixa" com Boleto -- antes
   * ficavam em Financeiro > Boletos, aba "Aguardando emissao". Mesma emissao da
   * tela de Boletos (services/boletoEmissaoService). As parcelas novas tem id
   * fixo `<renegociacao>_p<n>` (services/renegociacao.js no servidor). O que nao
   * sair aqui continua em "Aguardando emissao" e a mensagem diz isso.
   */
  const emitirBoletosDaRenegociacao = async (resultado: ResultadoDaRenegociacao, clienteNome: string) => {
    if (!tenantId || !currentUser) return;
    const ondeFica = 'Emita em Financeiro › Boletos, aba "Aguardando emissão".';
    setIsProcessing(true);
    try {
      let bancosComBoleto: BancoBoleto[] = [];
      try {
        bancosComBoleto = await carregarBancosComBoleto(tenantId);
      } catch (erroBancos) {
        console.error('Erro ao ler os bancos para o boleto da renegociação:', erroBancos);
      }
      if (bancosComBoleto.length === 0) {
        showWarning('Renegociação registrada, boletos não emitidos', `Nenhum banco está preparado para boleto. Abra Cadastros Auxiliares → Bancos, edite o banco do Sicoob e marque "Emite boleto por este banco". Depois: ${ondeFica}`);
        return;
      }
      const dadosPdf: Awaited<ReturnType<typeof dadosPdfDoBoleto>>[] = [];
      const falhas: string[] = [];
      let emitidos = 0;
      for (let n = 1; n <= resultado.quantidadeParcelas; n += 1) {
        const id = `${resultado.renegociacaoId}_p${n}`;
        try {
          const snap = await getDoc(doc(db, 'transacoes', id));
          if (!snap.exists()) throw new Error('parcela não encontrada.');
          let titulo = paraTituloBoleto(id, snap.data() || {});
          if (!titulo.boleto) {
            const banco = validarTituloParaEmissao(titulo, bancosComBoleto);
            const gerado = await emitirUmTitulo({ tenantId, uid: currentUser.uid, titulo, banco });
            titulo = { ...titulo, boleto: gerado, bancoId: banco.id, bancoNome: banco.nome };
            emitidos += 1;
          }
          dadosPdf.push(await dadosPdfDoBoleto({ tenantId, titulo, bancosComBoleto }));
        } catch (erro) {
          falhas.push(`Parcela ${n}/${resultado.quantidadeParcelas}: ${erro instanceof Error ? erro.message : 'não foi possível emitir.'}`);
        }
      }
      if (dadosPdf.length > 0) {
        setPdfBoleto({
          blob: gerarPdfBoletos(dadosPdf),
          nome: nomeArquivoDocumento({ tipo: 'BOLETOS RENEGOCIACAO', destinatario: clienteNome }),
        });
      }
      if (falhas.length === 0) {
        showSuccess(`Renegociação registrada e ${emitidos === 1 ? '1 boleto emitido' : `${emitidos} boletos emitidos`}. A baixa entra sozinha pelo retorno do banco.`);
      } else {
        showWarning(
          `Renegociação registrada; ${falhas.length} boleto(s) não saíram`,
          `${emitidos > 0 ? `${emitidos} boleto(s) emitido(s). ` : ''}${falhas.join(' ')} ${ondeFica}`,
        );
      }
    } finally {
      setIsProcessing(false);
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


  if (relatorioRecebimentos && tenantId) {
    return <RelatorioRecebimentos tenantId={tenantId} filtro={relatorioRecebimentos} onFechar={() => setRelatorioRecebimentos(null)} />;
  }
  if (comprovanteDoAcerto) {
    return (
      <RelatorioPreview
        relatorioId="acerto-fornecedor-comprovante"
        documento={montarComprovanteDoAcerto(comprovanteDoAcerto)}
        nomeArquivo={nomeArquivoRelatorio(`Acerto com Fornecedor ${comprovanteDoAcerto.clienteNome}`, comprovanteDoAcerto.data, comprovanteDoAcerto.data)}
        onFechar={() => setComprovanteDoAcerto(null)}
        rotuloFechar="Voltar para Contas a Receber"
      />
    );
  }
  return (
    <div className="financeiro-page" style={{ padding: '24px' }}>
      {acertoAberto && tenantId && (
        <AcertoFornecedorModal
          tenantId={tenantId}
          titulosAReceber={transacoes.filter((t) => t.status === 'Pendente')}
          podeDesfazer={podeEstornar}
          onFechar={() => setAcertoAberto(false)}
          onComprovante={(acerto) => { setAcertoAberto(false); setComprovanteDoAcerto(acerto); }}
        />
      )}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700 }}>Contas a Receber</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>Clientes com débito em aberto (Boleto, a Prazo) — cartão fica na tela Banco</p>
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
          <MenuMaisOpcoes
            itens={[
              ...(podeRelatorios ? [{
                texto: 'Recebimentos', Icone: FileText,
                titulo: 'Relatório do que foi recebido no dia (ou num período): forma, banco ou caixa e totais. Abre em PDF, dá para imprimir e salvar em Excel',
                onClick: () => { void pedirPeriodoDosRecebimentos().then((filtro) => { if (filtro) setRelatorioRecebimentos(filtro); }); },
              }] : []),
              ...(podeAcerto ? [{
                texto: 'Acerto com fornecedor', Icone: ArrowLeftRight,
                titulo: 'O cliente pagou direto um fornecedor: dá baixa na conta dele e na conta do fornecedor de uma vez, sem mexer em caixa nem em banco',
                onClick: () => setAcertoAberto(true),
              }] : []),
              ...(podeVerCreditos ? [{
                texto: 'Créditos de clientes', Icone: Wallet,
                titulo: 'Quem tem crédito, quanto sobra e de onde vem cada crédito (devolução, venda cancelada)',
                onClick: () => setCreditosAbertos({ alvo: null }),
              }] : []),
              ...(podeImportar ? [{ texto: 'Importar títulos', Icone: Upload, separadorAntes: true, onClick: () => openTab('/financeiro/contas-receber/importar', 'Importar Contas a Receber') }] : []),
            ]}
          />
          {podeLancarConta && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => setLancamento({ aberto: true, editando: null })}
              style={{ backgroundColor: '#10b981', borderColor: '#10b981' }}
              title="Lançar à mão um valor que um cliente ou fornecedor deve à empresa"
            >
              <Plus size={18} /> Lançar conta
            </button>
          )}
          <BotaoOlhoValores />
          {/* Clicavel (25/11/2026, Jomarly): "tenho o valor, mas nao vejo as contas
              que foram pagas no dia" -- abre o relatorio Contas Recebidas de hoje. */}
          <button
            type="button"
            onClick={() => setRelatorioRecebimentos({ inicio: hojeStr, fim: hojeStr, somenteContas: true })}
            title="Ver as contas recebidas hoje, uma a uma, com forma, banco ou caixa e desconto (abre em PDF)"
            style={{ display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'rgba(16, 185, 129, 0.1)', padding: '12px 24px', borderRadius: 'var(--radius-lg)', border: '1px solid rgba(16, 185, 129, 0.2)', cursor: 'pointer', font: 'inherit', textAlign: 'left' }}
          >
            <Clock size={24} color="#10b981" />
            <div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Recebido Hoje</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#10b981' }}>
                {mostrarValor(new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalRecebidoHoje))}
              </div>
            </div>
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'var(--bg-secondary)', padding: '12px 24px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
            <Clock size={24} color="#f59e0b" />
            <div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Total a Receber</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#f59e0b' }}>
                {mostrarValor(new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalPendente))}
              </div>
              {totalAcrescimoCentavos > 0 && (
                <div style={{ fontSize: '11.5px', color: '#ef4444', fontWeight: 600 }} title="Os atrasados com juros e multa calculados até hoje">
                  com juros e multa: {mostrarValor(new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalPendente + totalAcrescimoCentavos / 100))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Abas (28/11/2026, pedido do dono): o recebido do cliente a vista, sem tirar relatorio. */}
      <div className="receber-abas" role="tablist" aria-label="O que mostrar no Contas a Receber">
        {([['abertos', 'Em aberto'], ['geral', 'Geral']] as const).map(([aba, rotulo]) => (
          <button
            key={aba}
            type="button"
            role="tab"
            id={`receber-aba-${aba}`}
            aria-selected={abaAtiva === aba}
            tabIndex={abaAtiva === aba ? 0 : -1}
            className="receber-aba"
            onClick={() => irParaAba(aba)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              e.preventDefault();
              const outra: AbaReceber = aba === 'abertos' ? 'geral' : 'abertos';
              irParaAba(outra);
              document.getElementById(`receber-aba-${outra}`)?.focus();
            }}
            title={aba === 'abertos' ? 'O que falta receber' : 'O que está em aberto e o que já foi recebido, cliente por cliente'}
          >
            {rotulo}
            {aba === 'abertos' && <span className="receber-aba-contador">{contasPendentes.length}</span>}
          </button>
        ))}
      </div>

      {abaAtiva === 'geral' && (
        <div className="receber-geral">
          <div className="receber-geral-periodos" role="group" aria-label="Recebidos de qual período">
            <span className="receber-geral-rotulo">Recebidos de</span>
            {(Object.keys(ROTULO_PERIODO_RECEBIDOS) as PeriodoRecebidos[]).map((p) => (
              <button key={p} type="button" className="receber-chip" aria-pressed={periodoRapido === p} onClick={() => escolherPeriodoRecebidos(p)}>
                {ROTULO_PERIODO_RECEBIDOS[p]}
              </button>
            ))}
            <button type="button" className="receber-chip" aria-pressed={periodoRapido === null} onClick={() => setFiltrosAbertos(true)} title="Escolha as datas em Filtros › Recebido em">
              {periodoRapido === null && periodoDe && periodoAte
                ? `${periodoDe.split('-').reverse().join('/')} a ${periodoAte.split('-').reverse().join('/')}`
                : 'Outro período'}
            </button>
          </div>
          <div className="receber-geral-totais" role="status" aria-live="polite">
            <div>
              <span>Recebido no período</span>
              <strong className="receber-verde">{mostrarValor(new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totaisDaLista.recebidoCentavos / 100))}</strong>
            </div>
            <div>
              <span>Em aberto</span>
              <strong className="receber-ambar">{mostrarValor(new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totaisDaLista.emAbertoCentavos / 100))}</strong>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div className="search-bar" style={{ position: 'relative', width: '360px', maxWidth: '100%' }}>
          <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <CampoBuscaAdiado
            placeholder="Buscar cliente ou código..."
            valor={buscaCliente}
            aoMudar={setBuscaCliente}
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
          rotulo={listaTemRecebidas ? 'Recebido em' : 'Vencimento'}
          de={periodoDe}
          ate={periodoAte}
          onChangeDe={setPeriodoDe}
          onChangeAte={setPeriodoAte}
        />
      </PainelFiltros>
      {listandoRecebidas && !periodoDe && !periodoAte && (
        <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--text-muted)' }}>
          Recebidas deste mês. Para outro período, use Filtros › Recebido em.
        </p>
      )}

      {/* Juros e multa dos atrasados (24/11/2026): % da filial, mudaveis so' nesta tela. */}
      {(haVencidas || percentuaisDaTela) && (
        <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          {temPercentuais(percentuaisEmUso) ? (
            <span>
              Atrasados calculados com {textoDosPercentuais(percentuaisEmUso)}
              {percentuaisDaTela ? <strong style={{ color: '#f59e0b' }}> (alterado só nesta tela, não fica salvo)</strong> : ' (padrão da filial)'}.
            </span>
          ) : (
            <span>
              {percentuaisDaTela
                ? 'Juros e multa zerados só nesta tela.'
                : 'Para mostrar os atrasados com juros e multa, preencha as % em Configurações da filial › Parâmetros de venda › "Juros e multa do crediário em atraso", ou informe aqui só para esta consulta.'}
            </span>
          )}
          {/* Mudar as % muda os juros das baixas: so' com "alterar juros e multa" (item 15). */}
          {podeJurosMulta && <button
            type="button"
            onClick={() => { void alterarPercentuaisNaTela(); }}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent-purple)', fontWeight: 600, textDecoration: 'underline', font: 'inherit' }}
          >
            Alterar só nesta tela
          </button>}
          {percentuaisDaTela && (
            <button
              type="button"
              onClick={() => setPercentuaisDaTela(null)}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-muted)', fontWeight: 600, textDecoration: 'underline', font: 'inherit' }}
            >
              Voltar ao padrão da filial
            </button>
          )}
        </p>
      )}

      <div className="card lote-tom-entrada" style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
        <div className="table-wrapper" data-tabela-janela>
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
                blocosDeClientes.visiveis.map((grupo) => {
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
                            {grupo.deFornecedor ? <Building2 size={16} style={{ color: 'var(--text-muted)' }} /> : <User size={16} style={{ color: 'var(--text-muted)' }} />}
                            {grupo.clienteId && codigosDosClientes[grupo.clienteId] && (
                              <span style={{ color: 'var(--text-muted)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }} title="Código do cliente">{codigosDosClientes[grupo.clienteId]} ·</span>
                            )}
                            {grupo.clienteNome}
                            {podeVerCreditos && !grupo.deFornecedor && saldoDeCreditoDo(grupo.clienteId, grupo.clienteNome) > 0 && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setCreditosAbertos({ alvo: { id: grupo.clienteId || '', nome: grupo.clienteNome } }); }}
                                title="Ver os créditos deste cliente e de onde vem cada um"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 600, color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.4)', borderRadius: '4px', padding: '1px 6px', background: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}
                              >
                                <Wallet size={12} /> Crédito {mostrarValor(new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(saldoDeCreditoDo(grupo.clienteId, grupo.clienteNome) / 100))}
                              </button>
                            )}
                            {grupo.deFornecedor && (
                              <span style={{ fontSize: '11px', fontWeight: 600, color: '#8b5cf6', border: '1px solid rgba(139, 92, 246, 0.4)', borderRadius: '4px', padding: '1px 6px' }}>Fornecedor</span>
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
                        {situacaoTitulo === 'todas' ? (
                          <td style={{ padding: '16px', textAlign: 'right' }}>
                            {/* Recebido x em aberto do cliente, com a barrinha do quanto ja' foi quitado (28/11/2026). */}
                            <CelulaRecebidoEmAberto recebido={grupo.totalRecebido} emAberto={grupo.totalPendente} />
                          </td>
                        ) : (
                        <td style={{ padding: '16px', textAlign: 'right', fontWeight: 700, color: listandoRecebidas ? '#10b981' : '#f59e0b' }}>
                          {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(listandoRecebidas ? grupo.totalRecebido : grupo.totalPendente)}
                          {(() => {
                            const acrescimo = somaDosAcrescimos(grupo.transacoes.map(acrescimoDaLista));
                            return acrescimo > 0 ? (
                              <div style={{ fontSize: '11.5px', fontWeight: 600, color: '#ef4444', marginTop: '2px' }} title="Valor em aberto com os juros e a multa dos títulos vencidos, calculados até hoje">
                                com juros e multa: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(grupo.totalPendente + acrescimo / 100)}
                              </div>
                            ) : null;
                          })()}
                        </td>
                        )}
                        <td style={{ padding: '16px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
{podeCobrarWhatsapp && grupo.transacoes.some((t) => t.status === 'Pendente') && (
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
                                      {t.status === 'Pendente' && t.boleto?.baixaPorPrazo && (
                                        <div
                                          title="Passou o prazo de pagamento e o banco tirou o boleto da cobrança. Cobre do jeito que quiser: Dar Baixa (dinheiro, Pix, cheque...), receber no caixa, renegociar ou emitir um boleto novo."
                                          style={{ display: 'inline-block', fontSize: '11px', fontWeight: 700, color: '#b45309', background: 'rgba(245, 158, 11, 0.14)', borderRadius: '999px', padding: '2px 8px', marginTop: '4px' }}
                                        >
                                          Boleto baixado pelo banco (decurso de prazo){t.boleto.baixaPorPrazo.em ? ` em ${t.boleto.baixaPorPrazo.em.split('-').reverse().join('/')}` : ''}: não pode mais ser pago
                                        </div>
                                      )}
                                      {t.origemLancamento === 'manual' && (
                                        <div
                                          title={[t.documento ? `Documento: ${t.documento}` : '', t.observacao ? `Observação: ${t.observacao}` : ''].filter(Boolean).join(' · ') || undefined}
                                          style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-muted)', marginTop: '2px' }}
                                        >
                                          Lançada à mão{t.lancadoPorNome ? ` por ${t.lancadoPorNome}` : ''}{t.documento ? ` · doc. ${t.documento}` : ''}
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
                                      {(() => {
                                        const acrescimo = acrescimoDaLista(t);
                                        if (!acrescimo) return null;
                                        const reais = (c: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c / 100);
                                        return (
                                          <div style={{ fontSize: '11px', fontWeight: 500, color: '#ef4444', marginTop: '2px' }} title={descricaoDoAcrescimo(acrescimo)}>
                                            {acrescimo.diasAtraso} {acrescimo.diasAtraso === 1 ? 'dia' : 'dias'}: {[acrescimo.jurosCentavos > 0 ? `juros ${reais(acrescimo.jurosCentavos)}` : '', acrescimo.multaCentavos > 0 ? `multa ${reais(acrescimo.multaCentavos)}` : ''].filter(Boolean).join(' + ')}
                                            <div style={{ fontWeight: 700 }}>atualizado {reais(transactionNetCents(t) + acrescimo.totalCentavos)}</div>
                                          </div>
                                        );
                                      })()}
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
                                          {podeRecibo && !t.acrescimoDaTransacaoId && (
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
                                        {podeCobrarWhatsapp && (
                                        <button
                                          onClick={() => handleCobrarWhatsApp(t)}
                                          style={{ backgroundColor: 'transparent', border: '1px solid #25D366', color: '#25D366', cursor: 'pointer', borderRadius: '6px', width: '30px', height: '30px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                                          title="Cobrar pelo WhatsApp"
                                          aria-label={`Cobrar ${t.descricao} pelo WhatsApp`}
                                        >
                                          <MessageCircle size={15} />
                                        </button>
                                        )}
                                        {contaParaEmitirBoleto(t) ? (
                                          <>
                                            <button
                                              onClick={() => void emitirBoletoDaLinha(t)}
                                              disabled={isProcessing}
                                              title="Emite o boleto desta conta (PDF). A baixa entra sozinha pelo retorno do banco."
                                              style={{ backgroundColor: '#10b981', border: 'none', color: 'white', cursor: 'pointer', borderRadius: '4px', padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px', opacity: isProcessing ? 0.6 : 1 }}
                                            >
                                              <Barcode size={14} /> Emitir boleto
                                            </button>
                                            {podeReceberBaixar && (
                                              <button
                                                onClick={() => handleConciliar(t)}
                                                title="O cliente pagou de outro jeito (dinheiro, Pix...): dar baixa sem boleto"
                                                style={{ backgroundColor: 'transparent', border: '1px solid #10b981', color: '#10b981', cursor: 'pointer', borderRadius: '4px', padding: '6px 10px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px' }}
                                              >
                                                <CheckCircle size={13} /> Dar Baixa
                                              </button>
                                            )}
                                          </>
                                        ) : podeReceberBaixar && (
                                          <button
                                            onClick={() => handleConciliar(t)}
                                            style={{ backgroundColor: '#10b981', border: 'none', color: 'white', cursor: 'pointer', borderRadius: '4px', padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px' }}
                                          >
                                            <CheckCircle size={14} /> Dar Baixa
                                          </button>
                                        )}
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
                                        {ehContaAvulsa(t) && (
                                          <>
                                            {podeEditarConta && (
                                            <button
                                              onClick={() => abrirEdicao(t)}
                                              disabled={isProcessing}
                                              title="Editar esta conta (descrição, vencimento, forma prevista, quem paga)"
                                              aria-label={`Editar ${t.descricao}`}
                                              style={{ backgroundColor: 'transparent', border: '1px solid #f59e0b', color: '#f59e0b', cursor: 'pointer', borderRadius: '6px', width: '30px', height: '30px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, opacity: isProcessing ? 0.6 : 1 }}
                                            >
                                              <Pencil size={14} />
                                            </button>
                                            )}
                                            {podeCancelarConta && (
                                            <button
                                              onClick={() => void handleCancelarConta(t)}
                                              disabled={isProcessing}
                                              title="Cancelar esta conta"
                                              aria-label={`Cancelar ${t.descricao}`}
                                              style={{ backgroundColor: 'transparent', border: '1px solid #ef4444', color: '#ef4444', cursor: 'pointer', borderRadius: '6px', width: '30px', height: '30px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, opacity: isProcessing ? 0.6 : 1 }}
                                            >
                                              <XCircle size={14} />
                                            </button>
                                            )}
                                          </>
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
        <MostrarMaisLinhas blocos={blocosDeClientes} />
      </div>

      <BarraDeSelecaoLote
        tipo="entrada"
        quantidade={selecaoValida.length}
        totalCentavos={totalSelecionadoCentavos}
        onLimpar={() => setSelecionados(new Set())}
        onDarBaixa={abrirBaixaEmLote}
        semPermissaoDeBaixa={!podeReceberBaixar
          ? semPermissao(PERMISSAO_FINANCEIRO.receberBaixar, 'dar baixa em contas a receber')
          : !podeBaixaLote && selecaoValida.length > 1 ? semPermissao(PERMISSAO_FINANCEIRO.baixaLote, 'dar baixa em lote') : undefined}
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
        <BaixaEmLoteModal
          tipo="entrada"
          itens={itensDoLote}
          tenantId={tenantId}
          podeDescontar={podeDescontar}
          podeJurosMulta={podeJurosMulta}
          acrescimoPadrao={(itemId, data) => {
            // Sem "alterar juros e multa" (item 15): padrao da filial na data da baixa, igual ao servidor.
            const t = elegiveis.get(itemId);
            return t ? acrescimoPorAtraso(parametrosVendaDaFilial, transactionNetCents(t), dataReferenciaTransacao(t), data) : null;
          }}
          podeDataAnterior={podeDataAnterior}
          formasPermitidas={formasDeRecebimento([...FORMAS_DA_BAIXA_EM_LOTE.entrada, 'Cheque'], ordemFormasDaFilial, formasOcultasDaFilial)}
          onCheque={(pedido) => void receberLoteEmCheque(pedido)}
          onFechar={fecharBaixaEmLote}
        />
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
                  min={podeDataAnterior ? undefined : getDateInputInTimeZone()}
                  disabled={!podeDataAnterior}
                  title={podeDataAnterior ? undefined : `Precisa da permissão ${permissionLabelMap[PERMISSAO_FINANCEIRO.baixaDataAnterior]}`}
                  onChange={(e) => setDataBaixaCredito(e.target.value)}
                  style={{ padding: '12px', fontSize: '16px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)' }}
                />
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px', display: 'block' }}>
                  {podeDataAnterior
                    ? 'Foi recebido em outro dia? Troque a data. Vale para a parte paga com crédito; se receber sem usar crédito, a data é perguntada na próxima tela.'
                    : `Fica com a data de hoje. Dar baixa com data anterior precisa da permissão "${permissionLabelMap[PERMISSAO_FINANCEIRO.baixaDataAnterior]}": peça ao responsável liberar no seu cadastro de funcionário.`}
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

      {tenantId && (
        <LancarContaReceberModal
          aberto={lancamento.aberto}
          tenantId={tenantId}
          categorias={categoriasReceita}
          editando={lancamento.editando}
          onFechar={() => setLancamento({ aberto: false, editando: null })}
          onSalvo={(mensagem) => { setLancamento({ aberto: false, editando: null }); showSuccess(mensagem); }}
          onCategoriasAtualizadas={(lista) => setConfigFilial((atual) => ({ ...atual, planoContasReceitas: lista }))}
        />
      )}
      {pdfRecibo && <PdfVisualizador titulo="Recibo de pagamento" nomeArquivo={pdfRecibo.nome} pdf={pdfRecibo.blob} onFechar={() => setPdfRecibo(null)} />}
      {pdfBoleto && <PdfVisualizador titulo="Boleto" nomeArquivo={pdfBoleto.nome} pdf={pdfBoleto.blob} onFechar={() => setPdfBoleto(null)} />}
      <ChequeCaptureModal
        aberto={chequeBaixaState !== null}
        dataMinima={getDateInputInTimeZone()}
        valorSugerido={chequeBaixaState ? chequeBaixaState.transacoes.reduce((soma, t) => soma + transactionNetCents(t), 0) / 100 : 0}
        onFechar={() => setChequeBaixaState(null)}
        onConfirmar={async (dados) => {
          if (!chequeBaixaState) return;
          const { transacoes, bancoId } = chequeBaixaState;
          setChequeBaixaState(null);
          await registrarChequeEmVarias(transacoes, dados, dados.dataCompensacao, bancoId);
        }}
      />
      {creditosAbertos && (
        <CreditosModal
          modo="cliente"
          alvo={creditosAbertos.alvo}
          onFechar={() => setCreditosAbertos(null)}
          onAbrirPedido={(pedidoId, rotulo) => { setCreditosAbertos(null); void openTab(`/pedidos-venda/visualizar/${pedidoId}`, rotulo); }}
          onAbrirTela={(caminho, rotulo) => { setCreditosAbertos(null); void openTab(caminho, rotulo); }}
        />
      )}
    </div>
  );
};

export default ContasReceber;
