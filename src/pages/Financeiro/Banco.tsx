import React, { useMemo, useState } from 'react';
import { useTitulosFinanceiros, type HistoricoDePagas } from '../../hooks/useTitulosFinanceiros';
import { alterarTaxaDoCartao, conciliarCartaoNoBanco } from '../../services/baixaFinanceiraService';
import { usePodePermissao } from '../../hooks/usePodePermissao';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError, NexusSwal, escaparHtml } from '../../utils/alerts';
import { Landmark, CreditCard, CheckCircle, Calendar, Search, Clock, FileText, Pencil } from 'lucide-react';
import { FORMA_ACERTO_FORNECEDOR } from '../../utils/acertoFornecedorDomain';
import {
  fromCents,
  toCents,
  transactionMovesPhysicalCash,
  transactionNetAmount,
} from '../../utils/financeDomain';
import { addDaysToDateInput, dateInputToUtcStart, getDateInputInTimeZone } from '../../utils/dateTime';
import { useTenantCollection, type TenantCollectionItem } from '../../hooks/useTenantCollection';
import MenuMaisOpcoes from '../../components/common/MenuMaisOpcoes';
import RelatorioPreview from '../../components/Reports/RelatorioPreview';
import { nomeArquivoRelatorio } from '../../utils/relatorioPdfDomain';
import { montarDocumentoExtratoBanco } from '../../utils/relatorioExtratoBancoDomain';
import BotaoOlhoValores from '../../components/common/BotaoOlhoValores';
import { useValoresOcultos } from '../../hooks/useValoresOcultos';
import './Financeiro.css';
import './BancoPorBanco.css';
import { CaixaDeSelecao } from '../../components/finance/BaixaEmLote';
import '../../components/finance/BaixaEmLote.css';
import { useLinhasEmBlocos } from '../../hooks/useLinhasEmBlocos';
import MostrarMaisLinhas from '../../components/common/MostrarMaisLinhas';
import {
  agruparExtratoPorBanco,
  chaveDoBanco,
  corDoBanco,
  dataDoExtrato,
  formatarDataDoExtrato,
  NOME_SEM_BANCO,
  pertenceAoFiltro,
  SEM_BANCO,
  TODOS_OS_BANCOS,
  type GrupoDoExtrato,
  type LinhaDoExtrato,
} from '../../utils/extratoBancoDomain';

interface CartaoInfo {
  bandeira?: string;
  numero?: number;
  totalParcelas?: number;
  valorTaxaCentavos?: number;
  valorLiquidoCentavos?: number;
}

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
  dataPagamento?: string;
  createdAt?: any;
  clienteNome?: string;
  movimentaCaixaFisico?: boolean;
  naturezaFinanceira?: string;
  dataPrevistaRecebimento?: string;
  cartao?: CartaoInfo | null;
  bancoId?: string;
  bancoNome?: string;
}

interface Banco extends TenantCollectionItem {
  nome: string;
  ativo: boolean;
  ordem: number;
  saldoCentavos: number;
}

const transactionDate = (transaction: TransacaoData) => {
  if (transaction.dataPagamento) {
    const date = dateInputToUtcStart(transaction.dataPagamento);
    if (date) return date;
  }
  if (transaction.data) {
    const date = dateInputToUtcStart(transaction.data);
    if (date) return date;
  }
  if (transaction.createdAt?.toDate) return transaction.createdAt.toDate() as Date;
  if (transaction.createdAt?.seconds) return new Date(transaction.createdAt.seconds * 1000);
  return null;
};

const isCardMethod = (formaPagamento?: string) => (
  formaPagamento === 'Cartão de Crédito' || formaPagamento === 'Cartão de Débito'
);

const moeda = (valor: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);

/** Linha do extrato separado por banco (25/11/2026): o lancamento + o valor liquido em centavos. */
type LinhaDoBanco = LinhaDoExtrato & { transacao: TransacaoData };

/** O que a tabela do extrato desenha: o cabecalho de cada banco (so' em "Todos") e as linhas. */
type ItemDoExtrato =
  | { tipo: 'grupo'; chave: string; grupo: GrupoDoExtrato<LinhaDoBanco> }
  | { tipo: 'linha'; chave: string; grupoChave: string; linha: LinhaDoBanco };

const criadoEmMs = (t: TransacaoData) => (
  t.createdAt?.toMillis ? Number(t.createdAt.toMillis()) : Number(t.createdAt?.seconds || 0) * 1000
);

const Banco: React.FC = () => {
  // Olhinho (21/11/2026): esconde os saldos e o total do cartao junto com as outras telas.
  const { mostrar: mostrarValor } = useValoresOcultos();
  const [searchTerm, setSearchTerm] = useState('');
  const [diasFiltro, setDiasFiltro] = useState<number>(30);
  const [processingId, setProcessingId] = useState<string | null>(null);
  // Conciliar varios de uma vez (28/11/2026, pedido do dono): cartoes marcados e a soma deles.
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set());
  const [conciliandoLote, setConciliandoLote] = useState(false);
  // Relatorio (19/10/2026): extrato do periodo + cartao a conciliar, como a tela mostra.
  const [previewAberto, setPreviewAberto] = useState(false);
  const { currentUser, tenantId } = useAuth();
  // Taxa do cartao a conciliar (26/11/2026): o dono e quem tem a permissao corrigem a taxa de uma parcela.
  const podeAlterarTaxa = usePodePermissao()('financeiro.cartao_taxa');
  const { items: bancos } = useTenantCollection<Banco>('bancos', tenantId, { sortField: 'ordem' });
  const bancosAtivos = useMemo(() => bancos.filter((b) => b.ativo), [bancos]);

  // Leitura enxuta (otimizacao de leituras, 2026-10-14): cartoes PENDENTES de
  // qualquer data (a conciliar) + extrato PAGO nos ultimos N dias ("Todo o
  // periodo" le tudo). Antes: TODAS as transacoes da empresa.
  const hojeLeitura = getDateInputInTimeZone();
  const historicoDoExtrato: HistoricoDePagas = diasFiltro === 0
    ? 'todo'
    : { de: addDaysToDateInput(hojeLeitura, -diasFiltro), ate: '' };
  const { titulos: titulosLidos, carregando: loading } = useTitulosFinanceiros<TransacaoData>({
    tenantId,
    historico: historicoDoExtrato,
    formasDasAbertas: ['Cartão de Crédito', 'Cartão de Débito'],
    pagasHoje: false,
  });
  const transacoes = useMemo(
    () => [...titulosLidos].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)),
    [titulosLidos],
  );


  const confirmarRecebimentoCartao = async (t: TransacaoData) => {
    if (!tenantId || !currentUser || processingId) return;

    let bancoId = t.bancoId;
    let bancoNome = t.bancoNome;
    if (!bancoId) {
      if (bancosAtivos.length === 0) {
        showError('Nenhum banco cadastrado', 'Cadastre um banco em Cadastros > Bancos antes de conciliar este título.');
        return;
      }
      const bancoResult = await NexusSwal.fire({
        title: 'Em qual banco caiu?',
        text: 'Esta venda não tem banco de destino definido (venda antiga). Selecione onde o valor caiu:',
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
      title: 'Confirmar recebimento no banco?',
      text: `Confirma que o valor líquido de R$ ${transactionNetAmount(t).toFixed(2)} referente a "${t.descricao}" caiu em "${bancoNome}"?`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sim, confirmar',
      cancelButtonText: 'Cancelar',
    });
    if (!confirmacao.isConfirmed) return;

    setProcessingId(t.id);
    try {
      // Titulo, saldo do banco e venda/OS gravados pelo servidor (services/baixaFinanceiraService).
      await conciliarCartaoNoBanco({ transacaoId: t.id, bancoId, tenantId });
      showSuccess('Recebimento conciliado com o banco!');
    } catch (error) {
      console.error('Erro ao conciliar recebimento de cartão:', error);
      showError('Erro', error instanceof Error ? error.message : 'Não foi possível confirmar o recebimento.');
    } finally {
      setProcessingId(null);
    }
  };

  /**
   * Conciliar os cartoes marcados (28/11/2026): a mesma confirmacao de um por
   * um, pelo servidor, cartao a cartao. Quem nao tem banco definido pergunta
   * o banco uma vez so' para todos eles. Um que falhe nao para os outros.
   */
  const confirmarMarcados = async () => {
    if (!tenantId || !currentUser || conciliandoLote || cartoesMarcados.length === 0) return;
    const lista = [...cartoesMarcados];
    let bancoDosSemBanco: { id: string; nome: string } | null = null;
    if (lista.some((t) => !t.bancoId)) {
      if (bancosAtivos.length === 0) {
        showError('Nenhum banco cadastrado', 'Cadastre um banco em Cadastros > Bancos antes de conciliar.');
        return;
      }
      const escolha = await NexusSwal.fire({
        title: 'Em qual banco caiu?',
        text: `${lista.filter((t) => !t.bancoId).length} dos cartões marcados não têm banco de destino (venda antiga). Escolha onde o valor caiu:`,
        input: 'select',
        inputOptions: Object.fromEntries(bancosAtivos.map((b) => [b.id, escaparHtml(b.nome)])),
        inputPlaceholder: 'Selecione o banco',
        showCancelButton: true,
        confirmButtonText: 'Continuar',
        cancelButtonText: 'Cancelar',
        inputValidator: (value) => (value ? undefined : 'Selecione um banco.'),
      });
      if (!escolha.isConfirmed) return;
      const banco = bancosAtivos.find((b) => b.id === escolha.value);
      if (!banco) return;
      bancoDosSemBanco = { id: banco.id, nome: banco.nome };
    }
    // Total por banco, para a pessoa conferir com o extrato antes de confirmar.
    const porBanco = new Map<string, number>();
    lista.forEach((t) => {
      const nome = t.bancoId ? (t.bancoNome || 'Banco') : (bancoDosSemBanco?.nome || 'Banco');
      porBanco.set(nome, (porBanco.get(nome) || 0) + Math.round(transactionNetAmount(t) * 100));
    });
    const linhas = [...porBanco.entries()].map(([nome, c]) => `<li><strong>${escaparHtml(nome)}</strong>: ${escaparHtml(moeda(c / 100))}</li>`).join('');
    const confirmacao = await NexusSwal.fire({
      title: `Confirmar ${lista.length} ${lista.length === 1 ? 'cartão' : 'cartões'} no banco?`,
      html: `<p style="margin:0 0 8px">Líquido total de <strong>${escaparHtml(moeda(somaMarcados.liquidoCentavos / 100))}</strong>, que caiu em:</p><ul style="text-align:left;margin:0;padding-left:20px">${linhas}</ul>`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sim, confirmar',
      cancelButtonText: 'Cancelar',
    });
    if (!confirmacao.isConfirmed) return;

    setConciliandoLote(true);
    const falhas: string[] = [];
    let feitos = 0;
    for (const t of lista) {
      const bancoId = t.bancoId || bancoDosSemBanco?.id;
      if (!bancoId) continue;
      try {
        await conciliarCartaoNoBanco({ transacaoId: t.id, bancoId, tenantId });
        feitos += 1;
        marcar([t.id], false);
      } catch (error) {
        falhas.push(`${t.descricao}: ${error instanceof Error ? error.message : 'não foi possível confirmar.'}`);
      }
    }
    setConciliandoLote(false);
    if (falhas.length === 0) {
      showSuccess(feitos === 1 ? 'Cartão conciliado com o banco!' : `${feitos} cartões conciliados com o banco!`);
    } else {
      showError(
        feitos > 0 ? `${feitos} conciliado(s); ${falhas.length} não` : 'Nenhum cartão foi conciliado',
        `${falhas.join(' · ')} Os que não foram continuam marcados: confira e tente de novo.`,
      );
    }
  };

  /**
   * Corrigir a taxa de uma parcela de cartao ainda a conciliar (26/11/2026): a
   * maquininha as vezes cobra diferente. Digita a taxa em R$; mostra na hora o
   * percentual e o liquido que vai entrar no banco. O servidor confere a permissao.
   */
  const corrigirTaxa = async (t: TransacaoData) => {
    if (!tenantId || processingId) return;
    const brutoCents = toCents(Number(t.valor) || 0);
    const taxaAtualCents = Number(t.cartao?.valorTaxaCentavos ?? 0) || 0;
    const brl = (c: number) => fromCents(c).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const lerTaxa = (texto: string): number | null => {
      const limpo = String(texto || '').trim().replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
      if (limpo === '') return null;
      const n = Number(limpo);
      return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
    };
    const resultado = await NexusSwal.fire({
      title: 'Corrigir a taxa do cartão',
      html: `<div style="text-align:left;font-size:14px;line-height:1.6">`
        + `<div><b>${escaparHtml(String(t.descricao || ''))}</b>${t.cartao?.numero ? ` (${t.cartao.numero}/${t.cartao.totalParcelas})` : ''}</div>`
        + `<div>Valor bruto: <b>${brl(brutoCents)}</b> · taxa de agora: ${brl(taxaAtualCents)}</div>`
        + `<label for="taxa-cartao-nova" style="display:block;margin-top:12px;font-weight:600">Taxa cobrada (R$)</label>`
        + `<input id="taxa-cartao-nova" class="swal2-input" inputmode="decimal" style="margin:6px 0 0;width:100%;box-sizing:border-box" value="${fromCents(taxaAtualCents).toFixed(2).replace('.', ',')}">`
        + `<div id="taxa-cartao-previa" style="margin-top:8px;color:var(--text-secondary)"></div></div>`,
      showCancelButton: true,
      confirmButtonText: 'Salvar taxa',
      cancelButtonText: 'Cancelar',
      didOpen: () => {
        const campo = document.getElementById('taxa-cartao-nova') as HTMLInputElement | null;
        const previa = document.getElementById('taxa-cartao-previa');
        const atualizar = () => {
          const c = lerTaxa(campo?.value || '');
          if (!previa) return;
          previa.textContent = c === null || c >= brutoCents
            ? 'Digite a taxa em reais, menor que o valor da parcela.'
            : `${(c / brutoCents * 100).toFixed(2).replace('.', ',')}% · líquido que vai entrar no banco: ${brl(brutoCents - c)}`;
        };
        campo?.addEventListener('input', atualizar);
        campo?.focus();
        campo?.select();
        atualizar();
      },
      preConfirm: () => {
        const c = lerTaxa((document.getElementById('taxa-cartao-nova') as HTMLInputElement | null)?.value || '');
        if (c === null || c >= brutoCents) {
          NexusSwal.showValidationMessage(`Digite a taxa em reais, de zero até menos que ${brl(brutoCents)}.`);
          return false;
        }
        return c;
      },
    });
    if (!resultado.isConfirmed || typeof resultado.value !== 'number') return;
    if (resultado.value === taxaAtualCents) return;
    setProcessingId(t.id);
    try {
      const r = await alterarTaxaDoCartao({ transacaoId: t.id, taxaCentavos: resultado.value, tenantId });
      showSuccess(`Taxa corrigida. Líquido a conciliar: ${brl(r.liquidoCentavos)}.`);
    } catch (error) {
      showError('Não foi possível corrigir a taxa', error instanceof Error ? error.message : 'Tente de novo em instantes.');
    } finally {
      setProcessingId(null);
    }
  };

  const isWithinSelectedDays = (transaction: TransacaoData) => {
    if (diasFiltro === 0) return true;
    const date = transactionDate(transaction);
    if (!date) return true;
    const limit = new Date();
    limit.setDate(limit.getDate() - diasFiltro);
    return date >= limit;
  };

  // Banco por banco (25/11/2026): o cartao de saldo escolhido filtra a tela
  // inteira; "Todos" mostra o extrato separado por banco. Regra em utils/extratoBancoDomain.ts.
  const [filtroBanco, setFiltroBanco] = useState<string>(TODOS_OS_BANCOS);
  const bancosDoExtrato = useMemo(() => bancosAtivos.map((b) => ({ id: b.id, nome: b.nome })), [bancosAtivos]);
  const doFiltro = (t: TransacaoData) => pertenceAoFiltro(t, filtroBanco, bancosDoExtrato);

  const todosPendentesCartao = transacoes.filter((t) => t.status === 'Pendente' && isCardMethod(t.formaPagamento));
  const pendentesCartao = todosPendentesCartao
    .filter(doFiltro)
    .filter((t) => !searchTerm.trim() || `${t.descricao} ${t.clienteNome || ''}`.toLowerCase().includes(searchTerm.trim().toLowerCase()))
    .sort((a, b) => (a.dataPrevistaRecebimento || a.data || '').localeCompare(b.dataPrevistaRecebimento || b.data || ''));

  const totalPendenteCartao = pendentesCartao.reduce((acc, t) => acc + transactionNetAmount(t), 0);
  // So' conta o que esta' marcado E ainda aparece na lista (conciliado ou filtrado sai da soma).
  const cartoesMarcados = pendentesCartao.filter((t) => marcados.has(t.id));
  const somaMarcados = cartoesMarcados.reduce((acc, t) => ({
    brutoCentavos: acc.brutoCentavos + Math.round(Number(t.valor || 0) * 100),
    taxaCentavos: acc.taxaCentavos + Math.round(Number(t.cartao?.valorTaxaCentavos || 0)),
    liquidoCentavos: acc.liquidoCentavos + Math.round(transactionNetAmount(t) * 100),
  }), { brutoCentavos: 0, taxaCentavos: 0, liquidoCentavos: 0 });
  const estadoDaLista: 'nenhum' | 'alguns' | 'todos' = cartoesMarcados.length === 0
    ? 'nenhum'
    : cartoesMarcados.length === pendentesCartao.length ? 'todos' : 'alguns';
  const marcar = (ids: string[], marcar: boolean) => setMarcados((atual) => {
    const novo = new Set(atual);
    ids.forEach((id) => (marcar ? novo.add(id) : novo.delete(id)));
    return novo;
  });

  const extratoDoPeriodo = transacoes.filter((t) => (
    t.status === 'Paga' &&
    !transactionMovesPhysicalCash(t) &&
    t.formaPagamento !== 'Crédito de Devolução' &&
    t.formaPagamento !== 'Cashback' &&
    // Acerto com fornecedor (24/11/2026): o cliente pagou direto o fornecedor; nao passou por banco.
    t.formaPagamento !== FORMA_ACERTO_FORNECEDOR &&
    isWithinSelectedDays(t)
  ));
  const extratoDigital = extratoDoPeriodo.filter(doFiltro);

  const grupos = agruparExtratoPorBanco<LinhaDoBanco>(
    extratoDigital.map((t) => ({
      id: t.id,
      bancoId: t.bancoId,
      bancoNome: t.bancoNome,
      tipo: t.tipo === 'saida' ? 'saida' : 'entrada',
      centavos: Math.round(transactionNetAmount(t) * 100),
      dataPagamento: t.dataPagamento,
      data: t.data,
      criadoEmMs: criadoEmMs(t),
      transacao: t,
    })),
    bancosDoExtrato,
  );
  const separarPorBanco = filtroBanco === TODOS_OS_BANCOS;
  const itensDoExtrato: ItemDoExtrato[] = grupos.flatMap((grupo) => [
    ...(separarPorBanco ? [{ tipo: 'grupo' as const, chave: `grupo-${grupo.chave}`, grupo }] : []),
    ...grupo.linhas.map((linha) => ({ tipo: 'linha' as const, chave: linha.id, grupoChave: grupo.chave, linha })),
  ]);
  const totalEntradas = grupos.reduce((soma, g) => soma + g.entradasCentavos, 0);
  const totalSaidas = grupos.reduce((soma, g) => soma + g.saidasCentavos, 0);

  // Cartao a conciliar por banco e lancamentos sem banco (para o cartao "Sem banco definido").
  const pendentesPorBanco = new Map<string, number>();
  todosPendentesCartao.forEach((t) => {
    const chave = chaveDoBanco(t, bancosDoExtrato);
    pendentesPorBanco.set(chave, (pendentesPorBanco.get(chave) || 0) + 1);
  });
  const temSemBanco = (pendentesPorBanco.get(SEM_BANCO) || 0) > 0
    || extratoDoPeriodo.some((t) => chaveDoBanco(t, bancosDoExtrato) === SEM_BANCO);
  const saldoTotal = bancosAtivos.reduce((soma, b) => soma + Number(b.saldoCentavos || 0), 0);
  const nomeDoFiltro = filtroBanco === TODOS_OS_BANCOS
    ? ''
    : filtroBanco === SEM_BANCO ? NOME_SEM_BANCO : (bancosAtivos.find((b) => b.id === filtroBanco)?.nome || '');

  // Velocidade (24/11/2026): a tabela desenha em blocos; totais, selecao e relatorio seguem na lista inteira.
  const blocos = useLinhasEmBlocos(itensDoExtrato);
  const blocosPendentes = useLinhasEmBlocos(pendentesCartao);

  if (previewAberto) {
    const hoje = getDateInputInTimeZone();
    const periodo = diasFiltro === 0 ? 'Todo o período' : `Últimos ${diasFiltro} dias`;
    const bancosDoRelatorio = filtroBanco === TODOS_OS_BANCOS ? bancosAtivos : bancosAtivos.filter((b) => b.id === filtroBanco);
    return (
      <RelatorioPreview
        relatorioId="extrato-banco"
        documento={montarDocumentoExtratoBanco({
          // Na ordem da tela: banco por banco, do mais recente para o mais antigo.
          extrato: grupos.flatMap((g) => g.linhas.map((l) => l.transacao)),
          cartaoAConciliar: pendentesCartao,
          saldos: bancosDoRelatorio.map((b) => ({ nome: b.nome, saldoCentavos: Number(b.saldoCentavos || 0) })),
          periodo,
          filtrosAplicados: [
            ...(nomeDoFiltro ? [`Banco: ${nomeDoFiltro}`] : []),
            ...(searchTerm.trim() ? [`Busca no cartão a conciliar: "${searchTerm.trim()}"`] : []),
          ],
        })}
        nomeArquivo={nomeArquivoRelatorio('Extrato do Banco', diasFiltro === 0 ? '' : addDaysToDateInput(hoje, -diasFiltro), hoje)}
        onFechar={() => setPreviewAberto(false)}
        rotuloFechar="Voltar ao Banco"
      />
    );
  }

  const cartaoDeSaldo = (props: {
    chave: string;
    nome: string;
    saldoCentavos?: number;
    cor: string;
    nota: string;
    alerta?: boolean;
    todos?: boolean;
  }) => {
    const ativo = filtroBanco === props.chave;
    return (
      <button
        key={props.chave}
        type="button"
        className={`bpb-saldo${props.todos ? ' bpb-saldo--todos' : ''}`}
        style={{ ['--cor-banco' as string]: props.cor } as React.CSSProperties}
        aria-pressed={ativo}
        title={ativo ? 'Mostrando só este banco' : `Mostrar só ${props.nome}`}
        onClick={() => setFiltroBanco(props.chave)}
      >
        <span className="bpb-saldo__nome">
          {!props.todos && <span className="bpb-ponto" aria-hidden="true" />}
          {props.nome}
        </span>
        {props.saldoCentavos !== undefined && (
          <span className={`bpb-saldo__valor${props.saldoCentavos < 0 ? ' bpb-saldo__valor--negativo' : ''}`}>
            {mostrarValor(moeda(fromCents(props.saldoCentavos)))}
          </span>
        )}
        <span className={`bpb-saldo__nota${props.alerta ? ' bpb-saldo__nota--alerta' : ''}`}>{props.nota}</span>
      </button>
    );
  };

  const notaDoCartao = (qtd: number) => (qtd === 0 ? 'Nenhum cartão a conciliar' : `${qtd} cartão(ões) a conciliar`);

  return (
    <div className="financeiro-page" style={{ padding: '24px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Landmark size={26} color="var(--brand)" />
            Banco
          </h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>
            Saldo, cartão a conciliar e extrato de cada banco. Clique num banco para ver só ele.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          {bancosAtivos.length > 0 && <BotaoOlhoValores />}
          {/* No fim (canto direito): o menu abre para a esquerda sem passar por cima do menu lateral. */}
          <MenuMaisOpcoes
            itens={[{
              texto: 'Relatório', Icone: FileText,
              titulo: 'Abre em PDF o extrato do período e o cartão a conciliar do banco escolhido (dali dá para imprimir, salvar o PDF ou salvar em Excel)',
              desabilitado: loading,
              onClick: () => setPreviewAberto(true),
            }]}
          />
        </div>
      </div>

      {bancosAtivos.length === 0 ? (
        <div className="bpb-cartao" style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-muted)' }}>
          <CheckCircle size={22} color="var(--brand)" />
          Nenhum banco cadastrado ainda. Cadastre em Cadastros Auxiliares › Bancos para ver o saldo de cada um aqui.
        </div>
      ) : (
        <div className="bpb-saldos" role="group" aria-label="Escolha o banco que a tela mostra">
          {cartaoDeSaldo({
            chave: TODOS_OS_BANCOS,
            nome: 'Todos os bancos',
            saldoCentavos: saldoTotal,
            cor: 'var(--brand)',
            nota: notaDoCartao(todosPendentesCartao.length),
            alerta: todosPendentesCartao.length > 0,
            todos: true,
          })}
          {bancosAtivos.map((banco) => {
            const qtd = pendentesPorBanco.get(banco.id) || 0;
            return cartaoDeSaldo({
              chave: banco.id,
              nome: banco.nome,
              saldoCentavos: Number(banco.saldoCentavos || 0),
              cor: corDoBanco(banco.id, bancosDoExtrato),
              nota: notaDoCartao(qtd),
              alerta: qtd > 0,
            });
          })}
          {temSemBanco && cartaoDeSaldo({
            chave: SEM_BANCO,
            nome: NOME_SEM_BANCO,
            cor: corDoBanco(SEM_BANCO, bancosDoExtrato),
            nota: 'Lançamentos que não dizem em que banco caíram',
          })}
        </div>
      )}

      <section className="bpb-cartao" aria-labelledby="bpb-titulo-cartao">
        <div className="bpb-cartao__topo">
          <h3 id="bpb-titulo-cartao" className="bpb-cartao__titulo">
            <CreditCard size={20} color="var(--status-yellow)" />
            Cartão pendente de conciliação
            {nomeDoFiltro && <span className="bpb-filtro-ativo">{nomeDoFiltro}</span>}
          </h3>
          <div style={{ fontSize: '16px', color: 'var(--status-yellow)', fontWeight: 800 }}>
            {mostrarValor(moeda(totalPendenteCartao))}
          </div>
        </div>

        <div className="search-bar" style={{ position: 'relative', maxWidth: '360px', marginBottom: '16px' }}>
          <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Buscar por descrição ou cliente..."
            aria-label="Buscar no cartão a conciliar por descrição ou cliente"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: '100%', padding: '10px 14px 10px 40px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '999px', color: 'var(--text-primary)' }}
          />
        </div>

        {cartoesMarcados.length > 0 && (
          <div className="lote-barra lote-tom-entrada" role="region" aria-label="Cartões marcados para conciliar" style={{ marginBottom: '12px' }}>
            <div className="lote-barra-resumo" aria-live="polite">
              <strong>{cartoesMarcados.length === 1 ? '1 cartão marcado' : `${cartoesMarcados.length} cartões marcados`}</strong>
              <span className="lote-barra-total lote-numero">{mostrarValor(moeda(somaMarcados.liquidoCentavos / 100))}</span>
              <span style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
                bruto {mostrarValor(moeda(somaMarcados.brutoCentavos / 100))} · taxa {mostrarValor(moeda(somaMarcados.taxaCentavos / 100))}
              </span>
            </div>
            <div className="lote-barra-acoes">
              <button type="button" className="lote-botao lote-botao-discreto" onClick={() => setMarcados(new Set())} disabled={conciliandoLote}>Limpar seleção</button>
              <button type="button" className="lote-botao lote-botao-principal" onClick={() => void confirmarMarcados()} disabled={conciliandoLote}>
                <CheckCircle size={18} aria-hidden="true" />
                {conciliandoLote ? 'Confirmando...' : `Confirmar ${cartoesMarcados.length} no banco`}
              </button>
            </div>
          </div>
        )}

        <div className="table-wrapper">
          <table className="data-table financeiro-table bpb-tabela" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ padding: '12px 4px 12px 10px', width: '36px' }}>
                  {pendentesCartao.length > 0 && (
                    <CaixaDeSelecao
                      estado={estadoDaLista}
                      rotulo={estadoDaLista === 'todos' ? 'Desmarcar todos os cartões' : 'Marcar todos os cartões da lista'}
                      onAlternar={(marcarTodos) => marcar(pendentesCartao.map((t) => t.id), marcarTodos)}
                      desabilitada={conciliandoLote}
                    />
                  )}
                </th>
                <th style={{ padding: '12px 8px' }}>Vencimento previsto</th>
                <th style={{ padding: '12px 8px' }}>Descrição</th>
                <th style={{ padding: '12px 8px' }}>Cliente</th>
                <th style={{ padding: '12px 8px' }}>Bandeira</th>
                {separarPorBanco && <th style={{ padding: '12px 8px' }}>Banco</th>}
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Valor Bruto</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Taxa</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Valor Líquido</th>
                <th style={{ padding: '12px 8px', textAlign: 'center' }}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={separarPorBanco ? 10 : 9} style={{ textAlign: 'center', padding: '20px' }}>Carregando...</td></tr>
              ) : pendentesCartao.length === 0 ? (
                <tr>
                  <td colSpan={separarPorBanco ? 10 : 9} style={{ textAlign: 'center', padding: '36px', color: 'var(--text-muted)' }}>
                    <CheckCircle size={36} color="var(--status-green)" style={{ margin: '0 auto 10px', opacity: 0.6, display: 'block' }} />
                    {nomeDoFiltro ? `Nenhum cartão a conciliar em ${nomeDoFiltro}.` : 'Nenhum cartão pendente de conciliação no momento.'}
                  </td>
                </tr>
              ) : (
                blocosPendentes.visiveis.map((t) => {
                  const vencimento = t.dataPrevistaRecebimento || t.data;
                  const parcelaLabel = t.cartao?.numero ? ` (${t.cartao.numero}/${t.cartao.totalParcelas})` : '';
                  const cor = corDoBanco(chaveDoBanco(t, bancosDoExtrato), bancosDoExtrato);
                  return (
                    <tr
                      key={t.id}
                      onClick={podeAlterarTaxa ? () => { void corrigirTaxa(t); } : undefined}
                      title={podeAlterarTaxa ? 'Clique para corrigir a taxa desta parcela' : undefined}
                      className={marcados.has(t.id) ? 'lote-linha-marcada' : undefined}
                      style={{ borderBottom: '1px solid var(--border-color)', cursor: podeAlterarTaxa ? 'pointer' : undefined, ['--cor-banco' as string]: cor } as React.CSSProperties}
                    >
                      <td style={{ padding: '10px 4px 10px 10px' }}>
                        <CaixaDeSelecao
                          estado={marcados.has(t.id) ? 'todos' : 'nenhum'}
                          rotulo={`Marcar ${t.descricao}`}
                          onAlternar={(marcarEste) => marcar([t.id], marcarEste)}
                          desabilitada={conciliandoLote}
                        />
                      </td>
                      <td style={{ padding: '10px 8px', color: 'var(--text-muted)' }}>{vencimento ? vencimento.split('-').reverse().join('/') : '-'}</td>
                      <td style={{ padding: '10px 8px', fontWeight: 500 }}>{t.descricao}{parcelaLabel}</td>
                      <td style={{ padding: '10px 8px' }}>{t.clienteNome || '-'}</td>
                      <td style={{ padding: '10px 8px' }}>{t.cartao?.bandeira || '-'}</td>
                      {separarPorBanco && (
                        <td style={{ padding: '10px 8px' }}>{t.bancoNome || <span style={{ color: 'var(--text-muted)' }}>A definir</span>}</td>
                      )}
                      <td className="bpb-valor" style={{ padding: '10px 8px' }}>{moeda(Number(t.valor))}</td>
                      <td className="bpb-valor bpb-saida" style={{ padding: '10px 8px' }}>
                        {moeda(fromCents(t.cartao?.valorTaxaCentavos || 0))}
                        {podeAlterarTaxa && <Pencil size={12} aria-hidden="true" style={{ marginLeft: '6px', opacity: 0.6 }} />}
                      </td>
                      <td className="bpb-valor bpb-entrada" style={{ padding: '10px 8px' }}>{moeda(transactionNetAmount(t))}</td>
                      <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                        <button
                          type="button"
                          className="bpb-confirmar"
                          onClick={(e) => { e.stopPropagation(); void confirmarRecebimentoCartao(t); }}
                          disabled={processingId === t.id}
                        >
                          <CheckCircle size={14} /> {processingId === t.id ? 'Confirmando...' : 'Confirmar no banco'}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <MostrarMaisLinhas blocos={blocosPendentes} />
      </section>

      <section className="bpb-cartao list-container" aria-labelledby="bpb-titulo-extrato" style={{ marginBottom: 0 }}>
        <div className="bpb-cartao__topo">
          <h3 id="bpb-titulo-extrato" className="bpb-cartao__titulo">
            <Clock size={20} color="var(--brand)" />
            Extrato digital confirmado
            {nomeDoFiltro && <span className="bpb-filtro-ativo">{nomeDoFiltro}</span>}
          </h3>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Calendar size={18} style={{ color: 'var(--text-muted)' }} />
            <select
              value={diasFiltro}
              aria-label="Período do extrato"
              onChange={(e) => setDiasFiltro(Number(e.target.value))}
              style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '8px 12px', borderRadius: '999px' }}
            >
              <option value={7}>Últimos 7 dias</option>
              <option value={15}>Últimos 15 dias</option>
              <option value={30}>Últimos 30 dias</option>
              <option value={90}>Últimos 90 dias</option>
              <option value={0}>Todo o período</option>
            </select>
          </div>
        </div>

        {!loading && grupos.length > 0 && (
          <div className="bpb-resumo" style={{ marginBottom: '14px' }}>
            <div className="bpb-resumo__item">
              <span className="bpb-resumo__rotulo">Entradas no período</span>
              <span className="bpb-resumo__valor bpb-entrada">{mostrarValor(moeda(fromCents(totalEntradas)))}</span>
            </div>
            <div className="bpb-resumo__item">
              <span className="bpb-resumo__rotulo">Saídas no período</span>
              <span className="bpb-resumo__valor bpb-saida">{mostrarValor(moeda(fromCents(totalSaidas)))}</span>
            </div>
            <div className="bpb-resumo__item">
              <span className="bpb-resumo__rotulo">Resultado</span>
              <span className={`bpb-resumo__valor ${totalEntradas - totalSaidas < 0 ? 'bpb-saida' : 'bpb-entrada'}`}>
                {mostrarValor(moeda(fromCents(totalEntradas - totalSaidas)))}
              </span>
            </div>
          </div>
        )}

        <div className="table-wrapper">
          <table className="data-table financeiro-table bpb-tabela" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ padding: '12px 8px 12px 14px' }} title="Dia em que o dinheiro entrou ou saiu do banco">Data do pagamento</th>
                <th style={{ padding: '12px 8px' }}>Descrição</th>
                <th style={{ padding: '12px 8px' }}>Cliente</th>
                <th style={{ padding: '12px 8px' }}>Forma</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Valor (R$)</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '20px' }}>Carregando...</td></tr>
              ) : itensDoExtrato.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
                    {nomeDoFiltro ? `Nenhuma movimentação digital em ${nomeDoFiltro} no período escolhido.` : 'Nenhuma movimentação digital no período selecionado.'}
                  </td>
                </tr>
              ) : (
                blocos.visiveis.map((item) => {
                  if (item.tipo === 'grupo') {
                    const g = item.grupo;
                    const cor = corDoBanco(g.chave, bancosDoExtrato);
                    return (
                      <tr key={item.chave} className="bpb-grupo" style={{ ['--cor-banco' as string]: cor } as React.CSSProperties}>
                        <td colSpan={5}>
                          <div className="bpb-grupo__linha">
                            <span className="bpb-grupo__nome">
                              <span className="bpb-ponto" aria-hidden="true" />
                              {g.nome}
                              <span className="bpb-grupo__qtd">{g.linhas.length} lançamento(s)</span>
                            </span>
                            <span className="bpb-grupo__totais">
                              <span className="bpb-entrada">Entradas {mostrarValor(moeda(fromCents(g.entradasCentavos)))}</span>
                              <span className="bpb-saida">Saídas {mostrarValor(moeda(fromCents(g.saidasCentavos)))}</span>
                              <span className={g.resultadoCentavos < 0 ? 'bpb-saida' : 'bpb-entrada'}>
                                Resultado {mostrarValor(moeda(fromCents(g.resultadoCentavos)))}
                              </span>
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  }
                  const t = item.linha.transacao;
                  const cor = corDoBanco(item.grupoChave, bancosDoExtrato);
                  return (
                    <tr key={item.chave} style={{ borderBottom: '1px solid var(--border-color)', ['--cor-banco' as string]: cor } as React.CSSProperties}>
                      <td style={{ padding: '10px 8px 10px 14px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {formatarDataDoExtrato(dataDoExtrato(t))}
                      </td>
                      <td style={{ padding: '10px 8px', fontWeight: 500 }}>{t.descricao}</td>
                      <td style={{ padding: '10px 8px' }}>{t.clienteNome || '-'}</td>
                      <td style={{ padding: '10px 8px' }}>
                        <span className="bpb-pilula">{t.formaPagamento || 'Não informada'}</span>
                      </td>
                      <td className={`bpb-valor ${t.tipo === 'entrada' ? 'bpb-entrada' : 'bpb-saida'}`} style={{ padding: '10px 8px' }}>
                        {t.tipo === 'entrada' ? '+' : '-'} {moeda(transactionNetAmount(t))}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <MostrarMaisLinhas blocos={blocos} />
      </section>
    </div>
  );
};

export default Banco;
