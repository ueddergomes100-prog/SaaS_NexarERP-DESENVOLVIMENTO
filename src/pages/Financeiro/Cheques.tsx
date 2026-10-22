import React, { useMemo, useState } from 'react';
import { useTitulosFinanceiros, type HistoricoDePagas } from '../../hooks/useTitulosFinanceiros';
import { compensarChequeRecebido, compensarChequeEmitido } from '../../services/baixaFinanceiraService';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError, NexusSwal, escaparHtml } from '../../utils/alerts';
import { FileCheck2, CheckCircle, AlertTriangle, Search, FileText } from 'lucide-react';
import {
  transactionNetAmount,
  transactionNetCents,
  type ChequeDetails,
} from '../../utils/financeDomain';
import MenuMaisOpcoes from '../../components/common/MenuMaisOpcoes';
import RelatorioPreview from '../../components/Reports/RelatorioPreview';
import { depositarCheque, devolverCheque, voltarChequeParaCarteira } from '../../services/caixasService';
import { ROTULO_SITUACAO_CHEQUE_RECEBIDO, situacaoDoCheque } from '../../utils/contasDinheiroDomain';
import { nomeArquivoRelatorio } from '../../utils/relatorioPdfDomain';
import { montarDocumentoCheques } from '../../utils/relatorioChequesDomain';
import { differenceInCalendarDays, getDateInputInTimeZone } from '../../utils/dateTime';
import { useTenantCollection, type TenantCollectionItem } from '../../hooks/useTenantCollection';
import {
  SITUACAO_TITULO_PADRAO,
  passaNaSituacaoTitulo,
  passaNoPeriodoDoTitulo,
  type SituacaoTitulo,
} from '../../utils/filtroListaDomain';
import { BotaoFiltros, CampoFiltro, CampoPeriodo, PainelFiltros, estiloCampoFiltro } from '../../components/common/PainelFiltros';
import './Financeiro.css';

const ROTULO_SITUACAO_CHEQUE: Record<SituacaoTitulo, string> = {
  abertas: 'A compensar',
  vencidas: 'Vencidos (a compensar)',
  pagas: 'Compensados',
  todas: 'Todos',
};

/**
 * Fila de cheques Pendentes aguardando compensação -- mesmo padrao de
 * "confirmar depois" que Banco.tsx ja usa pra cartao (confirmarRecebimentoCartao),
 * so trocando o filtro pra formaPagamento === 'Cheque' e usando os campos
 * do objeto `cheque` em vez de `cartao`. Nao credita banco na captura (venda
 * ou baixa em Contas a Receber) -- so aqui, quando compensa de verdade.
 */

interface TransacaoData {
  id: string;
  data: string;
  descricao: string;
  categoria: string;
  valor: number;
  valorCentavos?: number;
  tipo: 'entrada' | 'saida';
  status: 'Paga' | 'Pendente' | 'Cancelada';
  formaPagamento?: string;
  osId?: string;
  pedidoId?: string;
  paymentIndex?: number;
  createdAt?: any;
  clienteNome?: string;
  fornecedorNome?: string;
  dataPrevistaRecebimento?: string;
  dataPagamento?: string;
  cheque?: ChequeDetails | null;
  bancoId?: string;
  bancoNome?: string;
}

interface Banco extends TenantCollectionItem {
  nome: string;
  ativo: boolean;
  ordem: number;
  saldoCentavos: number;
}

const DIAS_AVISO_VENCIMENTO = 3;

const Cheques: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [situacaoCheque, setSituacaoCheque] = useState<SituacaoTitulo>(SITUACAO_TITULO_PADRAO);
  const [periodoDe, setPeriodoDe] = useState('');
  const [periodoAte, setPeriodoAte] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  // Relatorio (16/10/2026): a aba aberta, com a situacao, o periodo e a busca da tela.
  const [previewAberto, setPreviewAberto] = useState(false);
  // Recebidos = cheque de cliente (entra no banco ao compensar). Emitidos = cheque que a
  // empresa deu para pagar despesa (sai do banco ao compensar).
  const [aba, setAba] = useState<'recebidos' | 'emitidos'>('recebidos');
  const { currentUser, tenantId } = useAuth();
  const { items: bancos } = useTenantCollection<Banco>('bancos', tenantId, { sortField: 'ordem' });
  const bancosAtivos = bancos.filter((b) => b.ativo);

  // Leitura enxuta (otimizacao de leituras, 2026-10-14): cheques a compensar
  // de qualquer data (soma o total e o aviso de vencimento) + o historico de
  // compensados so' quando a lista mostra compensados, pelo periodo do filtro
  // ou, vazio, o mes atual. Antes: todos os cheques da empresa desde sempre.
  const listaTemCompensados = situacaoCheque === 'pagas' || situacaoCheque === 'todas';
  const hojeLeitura = getDateInputInTimeZone();
  const historicoDeCompensados: HistoricoDePagas = !listaTemCompensados
    ? null
    : (periodoDe || periodoAte ? { de: periodoDe, ate: periodoAte } : { de: `${hojeLeitura.slice(0, 7)}-01`, ate: hojeLeitura });
  const { titulos: titulosLidos, carregando: loading } = useTitulosFinanceiros<TransacaoData>({
    tenantId,
    formaPagamento: 'Cheque',
    historico: historicoDeCompensados,
    pagasHoje: false,
  });
  const transacoes = useMemo(
    () => [...titulosLidos].sort((a, b) => (a.dataPrevistaRecebimento || a.data || '').localeCompare(b.dataPrevistaRecebimento || b.data || '')),
    [titulosLidos],
  );

  const confirmarCompensacao = async (t: TransacaoData) => {
    if (!tenantId || !currentUser || processingId) return;

    let bancoId = t.bancoId;
    let bancoNome = t.bancoNome;
    if (!bancoId) {
      if (bancosAtivos.length === 0) {
        showError('Nenhum banco cadastrado', 'Cadastre um banco em Cadastros > Bancos antes de compensar este cheque.');
        return;
      }
      const bancoResult = await NexusSwal.fire({
        title: 'Em qual banco compensou?',
        text: 'Este cheque não tem banco de destino definido. Selecione onde o valor caiu:',
        input: 'select',
        inputOptions: Object.fromEntries(bancosAtivos.map((b) => [b.id, escaparHtml(b.nome)])),
        inputPlaceholder: 'Selecione o banco',
        showCancelButton: true,
        confirmButtonText: 'Continuar',
        cancelButtonText: 'Cancelar',
        inputValidator: (value) => (value ? undefined : 'Selecione um banco.'),
      });
      if (!bancoResult.isConfirmed) return;
      bancoId = bancoResult.value as string;
      bancoNome = bancosAtivos.find((b) => b.id === bancoId)?.nome;
    }

    const confirmacao = await NexusSwal.fire({
      title: 'Confirmar compensação do cheque?',
      text: `Confirma que o cheque nº ${t.cheque?.numeroCheque || '-'} (R$ ${transactionNetAmount(t).toFixed(2)}, referente a "${t.descricao}") compensou em "${bancoNome}"?`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sim, compensou',
      cancelButtonText: 'Cancelar',
    });
    if (!confirmacao.isConfirmed) return;

    setProcessingId(t.id);
    try {
      // Titulo, saldo do banco e venda/OS gravados pelo servidor (services/baixaFinanceiraService).
      await compensarChequeRecebido({ transacaoId: t.id, bancoId, tenantId });
      showSuccess('Cheque compensado! O valor já entrou no saldo do banco.');
    } catch (error) {
      console.error('Erro ao compensar cheque:', error);
      showError('Erro', error instanceof Error ? error.message : 'Não foi possível confirmar a compensação.');
    } finally {
      setProcessingId(null);
    }
  };

  /**
   * Cheque EMITIDO (a empresa deu para pagar despesa): a compensacao e' manual, aqui.
   * So' agora o banco e' debitado e o titulo vira Pago. A baixa usa a mesma marca do
   * "Dar Baixa" do Contas a Pagar, entao o estorno funciona igual.
   */
  const confirmarCompensacaoEmitido = async (t: TransacaoData) => {
    if (!tenantId || !currentUser || processingId) return;
    if (!t.bancoId) {
      showError('Banco do cheque não informado', 'Este cheque emitido não tem o banco da conta. Lance a despesa de novo informando o banco do cheque.');
      return;
    }
    const escolha = await NexusSwal.fire({
      title: 'Confirmar compensação do cheque?',
      html: `O cheque nº <strong>${escaparHtml(t.cheque?.numeroCheque || '-')}</strong> (R$ ${transactionNetAmount(t).toFixed(2)}, "${escaparHtml(t.descricao)}") saiu do banco <strong>${escaparHtml(t.bancoNome || '')}</strong>?<br/><br/>O valor será debitado do saldo do banco. Informe o dia em que compensou:`,
      icon: 'question',
      input: 'date',
      inputValue: getDateInputInTimeZone(),
      showCancelButton: true,
      confirmButtonText: 'Sim, compensou',
      cancelButtonText: 'Cancelar',
      inputValidator: (valor) => (/^\d{4}-\d{2}-\d{2}$/.test(String(valor || '')) ? undefined : 'Informe a data em que o cheque compensou.'),
    });
    if (!escolha.isConfirmed) return;
    const dataPagamento = String(escolha.value);

    setProcessingId(t.id);
    try {
      // Debito no banco + marca de baixa (estornavel) gravados pelo servidor.
      await compensarChequeEmitido({ transacaoId: t.id, dataPagamento, tenantId });
      showSuccess('Cheque compensado! O valor já saiu do saldo do banco.');
    } catch (error) {
      console.error('Erro ao compensar cheque emitido:', error);
      showError('Erro', error instanceof Error ? error.message : 'Não foi possível confirmar a compensação.');
    } finally {
      setProcessingId(null);
    }
  };

  /**
   * Antes de compensar (21/10/2026, decisao do dono): DEPOSITAR escolhe o banco
   * e o cheque fica "aguardando compensacao"; DEVOLVIDO marca o que o banco
   * devolveu (o cliente continua devendo); os dois voltam para a carteira.
   * Nada disto mexe em saldo -- so' a compensacao credita o banco.
   */
  const mudarSituacao = async (t: TransacaoData, acao: () => Promise<unknown>, mensagem: string) => {
    setProcessingId(t.id);
    try {
      await acao();
      showSuccess(mensagem);
    } catch (error) {
      showError('Não foi possível concluir', error instanceof Error ? error.message : 'Tente de novo.');
    } finally {
      setProcessingId(null);
    }
  };

  const depositar = async (t: TransacaoData) => {
    if (processingId) return;
    if (bancosAtivos.length === 0) {
      showError('Nenhum banco cadastrado', 'Cadastre um banco em Cadastros > Bancos antes de depositar este cheque.');
      return;
    }
    const escolha = await NexusSwal.fire({
      title: 'Em qual banco foi depositado?',
      text: `Cheque nº ${t.cheque?.numeroCheque || '-'} (R$ ${transactionNetAmount(t).toFixed(2)}). O valor só entra no saldo quando você confirmar a compensação.`,
      input: 'select',
      inputOptions: Object.fromEntries(bancosAtivos.map((b) => [b.id, escaparHtml(b.nome)])),
      inputValue: t.bancoId || '',
      inputPlaceholder: 'Selecione o banco',
      showCancelButton: true,
      confirmButtonText: 'Depositado',
      cancelButtonText: 'Cancelar',
      inputValidator: (value) => (value ? undefined : 'Selecione um banco.'),
    });
    if (!escolha.isConfirmed) return;
    await mudarSituacao(t, () => depositarCheque(t.id, String(escolha.value)), 'Cheque marcado como depositado. Quando o banco confirmar, use "Confirmar compensação".');
  };

  const devolver = async (t: TransacaoData) => {
    if (processingId) return;
    const escolha = await NexusSwal.fire({
      title: 'O banco devolveu este cheque?',
      text: `Cheque nº ${t.cheque?.numeroCheque || '-'} (R$ ${transactionNetAmount(t).toFixed(2)}). O título continua em aberto: o cliente ainda deve esse valor.`,
      input: 'text',
      inputPlaceholder: 'Motivo (opcional): sem fundos, assinatura...',
      inputAttributes: { maxlength: '200' },
      showCancelButton: true,
      confirmButtonText: 'Marcar como devolvido',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#ef4444',
    });
    if (!escolha.isConfirmed) return;
    await mudarSituacao(t, () => devolverCheque(t.id, String(escolha.value || '')), 'Cheque marcado como devolvido.');
  };

  const voltarCarteira = async (t: TransacaoData) => {
    if (processingId) return;
    const confirma = await NexusSwal.fire({
      title: 'Voltar o cheque para a carteira?',
      text: 'Desfaz a marca de depositado/devolvido. O cheque volta a aparecer como "em carteira".',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sim, voltar',
      cancelButtonText: 'Cancelar',
    });
    if (!confirma.isConfirmed) return;
    await mudarSituacao(t, () => voltarChequeParaCarteira(t.id), 'Cheque de volta à carteira.');
  };

  const hojeStr = getDateInputInTimeZone();
  // Cada aba enxerga so' os seus: cheque de saida nunca cai na fila de recebimento (creditaria o banco).
  const transacoesDaAba = transacoes.filter((t) => (t.tipo === 'saida') === (aba === 'emitidos'));
  const chequesPendentes = transacoesDaAba
    .filter((t) => t.status === 'Pendente')
    .filter((t) => !searchTerm.trim() || `${t.descricao} ${t.clienteNome || t.fornecedorNome || ''} ${t.cheque?.numeroCheque || ''}`.toLowerCase().includes(searchTerm.trim().toLowerCase()));

  // O que a tabela mostra: situacao + periodo + busca. O total e o aviso de
  // vencimento acima olham so' os a compensar -- nao mudam com o filtro.
  const buscaTexto = searchTerm.trim().toLowerCase();
  const chequesLista = transacoesDaAba.filter((t) => {
    const titulo = { status: t.status, data: t.dataPrevistaRecebimento || t.data, dataPagamento: t.dataPagamento };
    return passaNaSituacaoTitulo(titulo, hojeStr, situacaoCheque)
      && passaNoPeriodoDoTitulo(titulo, situacaoCheque, periodoDe, periodoAte)
      && (!buscaTexto || `${t.descricao} ${t.clienteNome || t.fornecedorNome || ''} ${t.cheque?.numeroCheque || ''}`.toLowerCase().includes(buscaTexto));
  });
  const filtrosAtivos = (situacaoCheque !== SITUACAO_TITULO_PADRAO ? 1 : 0) + (periodoDe || periodoAte ? 1 : 0);
  const limparFiltros = () => {
    setSituacaoCheque(SITUACAO_TITULO_PADRAO);
    setPeriodoDe('');
    setPeriodoAte('');
  };

  const totalPendente = chequesPendentes.reduce((acc, t) => acc + transactionNetAmount(t), 0);

  if (previewAberto) {
    const emitidos = aba === 'emitidos';
    const periodoTexto = periodoDe || periodoAte
      ? `${situacaoCheque === 'pagas' ? 'Compensados' : 'Bom para'} de ${periodoDe ? periodoDe.split('-').reverse().join('/') : '—'} a ${periodoAte ? periodoAte.split('-').reverse().join('/') : '—'}`
      : ROTULO_SITUACAO_CHEQUE[situacaoCheque];
    const filtrosAplicados = [
      `Situação: ${ROTULO_SITUACAO_CHEQUE[situacaoCheque]}`,
      searchTerm.trim() ? `Busca: "${searchTerm.trim()}"` : '',
      // Compensados sem periodo: a tela le so' o mes atual (leitura enxuta).
      listaTemCompensados && !periodoDe && !periodoAte ? 'Compensados: só os do mês atual (para outro período, use Filtros)' : '',
    ].filter(Boolean);
    return (
      <RelatorioPreview
        relatorioId={emitidos ? 'cheques-emitidos' : 'cheques-recebidos'}
        documento={montarDocumentoCheques(
          chequesLista.map((t) => ({
            id: t.id,
            tipo: t.tipo,
            status: t.status,
            pessoa: t.clienteNome || t.fornecedorNome || '',
            descricao: t.descricao || '',
            bancoEmissor: t.cheque?.bancoEmissor || '',
            numero: t.cheque?.numeroCheque || '',
            agencia: t.cheque?.agencia || '',
            emitente: t.cheque?.emitente || t.cheque?.titular || '',
            bancoDestino: t.bancoNome || '',
            bomPara: t.dataPrevistaRecebimento || t.data || '',
            dataPagamento: t.dataPagamento || '',
            valorCentavos: transactionNetCents(t),
          })),
          { emitidos, filtrosAplicados, periodo: periodoTexto, dataHoje: hojeStr },
        )}
        nomeArquivo={nomeArquivoRelatorio(emitidos ? 'Cheques Emitidos' : 'Cheques Recebidos', periodoDe, periodoAte)}
        onFechar={() => setPreviewAberto(false)}
        rotuloFechar="Voltar aos cheques"
      />
    );
  }
  const chequesVencendoEmBreve = chequesPendentes.filter((t) => {
    const dias = differenceInCalendarDays(hojeStr, t.dataPrevistaRecebimento || t.data);
    return dias !== null && dias <= DIAS_AVISO_VENCIMENTO;
  });

  return (
    <div className="financeiro-page" style={{ padding: '24px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px', alignItems: 'center' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700 }}>Cheques</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>
            {aba === 'recebidos'
              ? 'Cheques recebidos aguardando compensação -- entram no banco só quando confirmados aqui'
              : 'Cheques emitidos para pagar despesas -- saem do banco só quando você confirma a compensação aqui'}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <MenuMaisOpcoes
          itens={[{
            texto: 'Relatório', Icone: FileText,
            titulo: 'Abre em PDF os cheques da aba e dos filtros da tela (dali dá para imprimir, salvar o PDF ou salvar em Excel)',
            desabilitado: loading,
            onClick: () => setPreviewAberto(true),
          }]}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'rgba(139, 92, 246, 0.1)', padding: '12px 24px', borderRadius: 'var(--radius-lg)', border: '1px solid rgba(139, 92, 246, 0.2)' }}>
          <FileCheck2 size={24} color="#8b5cf6" />
          <div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{aba === 'recebidos' ? 'Total a compensar' : 'Total a sair do banco'}</div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#8b5cf6' }}>
              {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalPendente)}
            </div>
          </div>
        </div>
        </div>
      </div>

      <div role="tablist" style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        {([['recebidos', 'Recebidos (de clientes)'], ['emitidos', 'Emitidos (para pagar despesas)']] as const).map(([chave, rotulo]) => (
          <button
            key={chave}
            type="button"
            role="tab"
            aria-selected={aba === chave}
            onClick={() => setAba(chave)}
            style={{ padding: '10px 18px', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)', backgroundColor: aba === chave ? 'var(--accent-purple)' : 'var(--bg-secondary)' }}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {chequesVencendoEmBreve.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: 'var(--radius-lg)', padding: '14px 20px', marginBottom: '16px', color: '#f59e0b' }}>
          <AlertTriangle size={20} />
          <span>
            <strong>{chequesVencendoEmBreve.length}</strong> cheque(s) vencendo nos próximos {DIAS_AVISO_VENCIMENTO} dias (ou já vencido(s)) -- confira e compense assim que possível.
          </span>
        </div>
      )}

      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div className="search-bar" style={{ position: 'relative', width: '360px', maxWidth: '100%' }}>
          <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Buscar cliente, descrição ou nº do cheque..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: '100%', padding: '10px 14px 10px 40px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
          />
        </div>
        <BotaoFiltros aberto={filtrosAbertos} onToggle={() => setFiltrosAbertos((v) => !v)} quantidadeAtiva={filtrosAtivos} />
      </div>
      <PainelFiltros aberto={filtrosAbertos} quantidadeAtiva={filtrosAtivos} onLimpar={limparFiltros}>
        <CampoFiltro rotulo="Situação">
          <select value={situacaoCheque} onChange={(e) => setSituacaoCheque(e.target.value as SituacaoTitulo)} style={estiloCampoFiltro}>
            {(Object.keys(ROTULO_SITUACAO_CHEQUE) as SituacaoTitulo[]).map((chave) => (
              <option key={chave} value={chave}>{ROTULO_SITUACAO_CHEQUE[chave]}</option>
            ))}
          </select>
        </CampoFiltro>
        <CampoPeriodo
          rotulo={situacaoCheque === 'pagas' ? 'Compensado em' : 'Compensação prevista'}
          de={periodoDe}
          ate={periodoAte}
          onChangeDe={setPeriodoDe}
          onChangeAte={setPeriodoAte}
        />
      </PainelFiltros>

      <div className="card" style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
        <div className="table-wrapper">
          <table className="data-table financeiro-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ padding: '16px' }}>{aba === 'recebidos' ? 'Cliente/Fornecedor' : 'Fornecedor'}</th>
                <th style={{ padding: '16px' }}>Descrição</th>
                <th style={{ padding: '16px' }}>{aba === 'recebidos' ? 'Banco emissor' : 'Banco da empresa'}</th>
                <th style={{ padding: '16px' }}>Nº cheque</th>
                <th style={{ padding: '16px' }}>Compensação prevista</th>
                <th style={{ padding: '16px', textAlign: 'right' }}>Valor (R$)</th>
                <th style={{ padding: '16px', textAlign: 'center' }}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '20px' }}>Carregando cheques...</td>
                </tr>
              ) : chequesLista.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    <CheckCircle size={48} color="#10b981" style={{ margin: '0 auto 16px', opacity: 0.5 }} />
                    <div>{searchTerm.trim() || filtrosAtivos > 0 ? 'Nenhum cheque encontrado com essa busca e esses filtros.' : (aba === 'recebidos' ? 'Nenhum cheque aguardando compensação no momento.' : 'Nenhum cheque emitido aguardando compensação. Eles nascem ao lançar uma despesa (ou uma nota de entrada) pagando em cheque.')}</div>
                  </td>
                </tr>
              ) : (
                chequesLista.map((t) => {
                  const dias = differenceInCalendarDays(hojeStr, t.dataPrevistaRecebimento || t.data);
                  const vencido = t.status === 'Pendente' && dias !== null && dias < 0;
                  const venceLogo = t.status === 'Pendente' && dias !== null && dias >= 0 && dias <= DIAS_AVISO_VENCIMENTO;
                  return (
                    <tr key={t.id} style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: vencido ? 'rgba(239, 68, 68, 0.06)' : venceLogo ? 'rgba(245, 158, 11, 0.06)' : undefined }}>
                      <td style={{ padding: '16px', fontWeight: 600 }}>{t.clienteNome || t.fornecedorNome || 'Não identificado'}</td>
                      <td style={{ padding: '16px' }}>{t.descricao}</td>
                      <td style={{ padding: '16px' }}>{t.tipo === 'saida' ? (t.bancoNome || t.cheque?.bancoEmissor || '-') : (t.cheque?.bancoEmissor || '-')}</td>
                      <td style={{ padding: '16px' }}>{t.cheque?.numeroCheque || '-'}</td>
                      <td style={{ padding: '16px' }}>
                        {t.dataPrevistaRecebimento ? (
                          <span style={{ color: vencido ? '#ef4444' : venceLogo ? '#f59e0b' : 'var(--text-secondary)', fontWeight: (vencido || venceLogo) ? 700 : 400 }}>
                            {t.dataPrevistaRecebimento.split('-').reverse().join('/')}
                            {vencido && ` (${Math.abs(dias!)} ${Math.abs(dias!) === 1 ? 'dia' : 'dias'} em atraso)`}
                            {!vencido && venceLogo && ` (em ${dias} ${dias === 1 ? 'dia' : 'dias'})`}
                          </span>
                        ) : '-'}
                      </td>
                      <td style={{ padding: '16px', textAlign: 'right', fontWeight: 700, color: '#8b5cf6' }}>
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(transactionNetAmount(t))}
                      </td>
                      <td style={{ padding: '16px', textAlign: 'center' }}>
                        {t.status === 'Paga' ? (
                          <span style={{ fontSize: '12px', color: '#10b981', fontWeight: 600 }}>
                            Compensado{t.dataPagamento ? ` em ${t.dataPagamento.split('-').reverse().join('/')}` : ''}
                          </span>
                        ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                          {t.tipo !== 'saida' && situacaoDoCheque(t) !== 'em_carteira' && (
                            <span style={{ fontSize: '11px', fontWeight: 700, color: situacaoDoCheque(t) === 'devolvido' ? '#ef4444' : '#f59e0b' }}>
                              {ROTULO_SITUACAO_CHEQUE_RECEBIDO[situacaoDoCheque(t)]}{situacaoDoCheque(t) === 'depositado' && t.bancoNome ? ` · ${t.bancoNome}` : ''}
                            </span>
                          )}
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center' }}>
                            <button
                              onClick={() => (t.tipo === 'saida' ? confirmarCompensacaoEmitido(t) : confirmarCompensacao(t))}
                              disabled={processingId === t.id}
                              style={{ backgroundColor: '#10b981', border: 'none', color: 'white', cursor: 'pointer', borderRadius: '4px', padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px', opacity: processingId === t.id ? 0.6 : 1 }}
                            >
                              <CheckCircle size={14} /> {processingId === t.id ? 'Confirmando...' : 'Confirmar compensação'}
                            </button>
                            {t.tipo !== 'saida' && situacaoDoCheque(t) !== 'depositado' && (
                              <button type="button" onClick={() => void depositar(t)} disabled={processingId === t.id} className="btn-secondary" title="Levou o cheque ao banco: fica aguardando a compensação" style={{ padding: '6px 10px', fontSize: '12px' }}>Depositar</button>
                            )}
                            {t.tipo !== 'saida' && situacaoDoCheque(t) !== 'devolvido' && (
                              <button type="button" onClick={() => void devolver(t)} disabled={processingId === t.id} className="btn-secondary" title="O banco devolveu o cheque; o cliente continua devendo" style={{ padding: '6px 10px', fontSize: '12px', color: '#ef4444' }}>Devolvido</button>
                            )}
                            {t.tipo !== 'saida' && situacaoDoCheque(t) !== 'em_carteira' && (
                              <button type="button" onClick={() => void voltarCarteira(t)} disabled={processingId === t.id} className="btn-secondary" title="Desfaz a marca de depositado/devolvido" style={{ padding: '6px 10px', fontSize: '12px' }}>Voltar à carteira</button>
                            )}
                          </div>
                        </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Cheques;
