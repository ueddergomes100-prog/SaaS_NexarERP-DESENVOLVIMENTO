import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { usePendentesEPeriodo } from '../../hooks/usePendentesEPeriodo';
import { addDaysToDateInput, formatDateInputPtBr, getDateInputInTimeZone } from '../../utils/dateTime';
import { useAuth } from '../../contexts/AuthContext';
import { Wallet, Clock, History, Calendar, CalendarCheck, ChevronDown, ChevronUp, Banknote, FileText, Lock, MonitorCheck, User } from 'lucide-react';
import MenuMaisOpcoes from '../../components/common/MenuMaisOpcoes';
import RelatorioPreview from '../../components/Reports/RelatorioPreview';
import { nomeArquivoRelatorio } from '../../utils/relatorioPdfDomain';
import { montarDocumentoCaixaPdv, totaisPorForma, totalDoCaixaAberto, type ComposicaoDoRelatorio, type LancamentoDoCaixaAberto } from '../../utils/relatorioCaixaPdvDomain';
import { fromCents, toCents, transactionMovesPhysicalCash } from '../../utils/financeDomain';
import {
  DIAS_DA_COMPOSICAO,
  composicaoDaSessao,
  esperadoNoFechamento,
  lerConfigGaveta,
  type ComposicaoDaGaveta,
  type ModoDoFechamento,
} from '../../utils/gavetaDinheiroDomain';
import { acertarDiaDaGaveta, composicaoDaGaveta, resumoDaGaveta, type ComposicaoDaGavetaApi, type ResumoDaGaveta } from '../../services/caixasService';
import {
  calcularEsperadoDoFechamento,
  escolherDataDoFechamento,
  gravarFechamentoDoCaixa,
  mandarAoCofreDepoisDeFechar,
  mensagemDoErroDeFechamento,
  mensagemDoFechamento,
  pedirContadoETroco,
  pedirValorContado,
} from '../../services/fechamentoCaixaPdvService';
import { NexusSwal, showError, showSuccess, showWarning } from '../../utils/alerts';
import ComposicaoDoEsperado from './ComposicaoDoEsperado';
import { filtrarVendasVisiveis } from '../../utils/visibilidadeVendasDomain';
import { nomeDoOperador } from '../../utils/frenteDeCaixaDomain';
import { hasTenantFullAccess } from '../../utils/roles';
import ComputadoresDoCaixaModal from './ComputadoresDoCaixaModal';
import './Financeiro.css';

interface SangriaData {
  id: string;
  valorCentavos: number;
  motivo: string;
  registradoEm: string;
  registradoPorNome: string;
}

interface CaixaSessaoData {
  id: string;
  operadorId?: string;
  operadorNome: string;
  status: 'aberto' | 'fechado';
  saldoInicialCentavos: number;
  saldoAnteriorSugeridoCentavos: number | null;
  saldoAnteriorConfirmado: boolean;
  saldoFinalInformadoCentavos: number | null;
  saldoEsperadoCentavos: number | null;
  diferencaCentavos: number | null;
  sangrias: SangriaData[];
  totalSangriasCentavos: number;
  createdAt?: any;
  fechadoEm?: any;
  /** Computador onde o caixa foi aberto (entrada com codigo e senha, 22/11/2026). */
  terminalNome?: string;
}

/** Titulo de uma venda do caixa aberto, com a marca de dinheiro (entra no esperado). */
type LancamentoDaSessao = LancamentoDoCaixaAberto & { dinheiro: boolean };

interface VendaVinculada {
  id: string;
  numeroPedido?: string;
  valorTotal?: number;
  clienteNome?: string;
  createdAt?: any;
  vendedorId?: string;
  usuarioResponsavelId?: string;
  criadoPor?: string;
}

const currencyFormat = (value: number) => (
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
);

const toDate = (value: any): Date | null => {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  if (value.seconds) return new Date(value.seconds * 1000);
  return null;
};

const formatDateTime = (value: any): string => {
  const date = toDate(value);
  return date ? date.toLocaleString('pt-BR') : '-';
};

const CaixaRegistros: React.FC = () => {
  const { currentUser, tenantId, vendasVisiveisDeUsuarioId, userRole, isOwner } = useAuth();
  const [diasFiltro, setDiasFiltro] = useState<number>(30);
  // Filtro por operador (22/11/2026): o caixa de cada funcionario na troca de turno.
  const [operadorFiltro, setOperadorFiltro] = useState('');
  const [computadoresAberto, setComputadoresAberto] = useState(false);
  const ehGerente = hasTenantFullAccess(userRole, isOwner);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [vendasPorSessao, setVendasPorSessao] = useState<Record<string, VendaVinculada[]>>({});
  const [loadingVendas, setLoadingVendas] = useState<string | null>(null);
  // Relatorio (16/10/2026): caixas abertos + historico do periodo escolhido.
  const [previewAberto, setPreviewAberto] = useState(false);
  // Caixa aberto ao vivo (23/11/2026): o que ja' passou por cada caixa aberto, sem esperar fechar.
  const [lancamentosPorSessao, setLancamentosPorSessao] = useState<Record<string, LancamentoDaSessao[]>>({});
  // "Dinheiro das vendas na gaveta" ligado: o fechamento confere contra o saldo da gaveta.
  const [gaveta, setGaveta] = useState<ResumoDaGaveta | null>(null);
  // O que compoe o saldo da gaveta, dia a dia (pedido do dono, 24/11/2026).
  const [composicaoGaveta, setComposicaoGaveta] = useState<ComposicaoDaGavetaApi | null>(null);
  const [fechandoId, setFechandoId] = useState<string | null>(null);

  // Caixas abertos de qualquer data + os fechados nos ultimos N dias do
  // filtro (0 = todos), direto no banco (otimizacao de leituras, 2026-10-14)
  // -- antes lia todas as sessoes de caixa da empresa e filtrava aqui.
  const fechadosDesde = diasFiltro > 0 ? addDaysToDateInput(getDateInputInTimeZone(), -diasFiltro) : '';
  const { items: sessoesLidas, loading } = usePendentesEPeriodo<CaixaSessaoData>('caixas_pdv', tenantId, {
    statusPendentes: ['aberto'],
    campoData: 'fechadoEm',
    tipoData: 'timestamp',
    de: fechadosDesde,
    ate: '',
    enabled: Boolean(currentUser),
  });
  const sessoes = useMemo(
    () => [...sessoesLidas].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)),
    [sessoesLidas],
  );

  const idsDosAbertos = useMemo(
    () => sessoesLidas.filter((s) => s.status === 'aberto').map((s) => s.id).sort().join('|'),
    [sessoesLidas],
  );
  const carregarAoVivo = useCallback(async () => {
    if (!tenantId) return;
    const ids = idsDosAbertos ? idsDosAbertos.split('|') : [];
    try {
      const pares = await Promise.all(ids.map(async (id) => {
        const snap = await getDocs(query(collection(db, 'transacoes'), where('tenantId', '==', tenantId), where('pdvSessionId', '==', id)));
        const lista: LancamentoDaSessao[] = snap.docs
          .filter((d) => d.data().tipo !== 'saida')
          .map((d) => {
            const t = d.data();
            return {
              id: d.id,
              descricao: String(t.descricao || ''),
              clienteNome: String(t.clienteNome || ''),
              formaPagamento: String(t.formaPagamento || ''),
              valorCentavos: Number.isFinite(Number(t.valorCentavos)) && t.valorCentavos !== null && t.valorCentavos !== undefined ? Number(t.valorCentavos) : toCents(Number(t.valor || 0)),
              criadoEm: toDate(t.createdAt),
              cancelado: t.estornada === true || t.status === 'Cancelada',
              pendente: t.status === 'Pendente',
              dinheiro: transactionMovesPhysicalCash(t),
            };
          })
          .sort((a, b) => (a.criadoEm?.getTime() || 0) - (b.criadoEm?.getTime() || 0));
        return [id, lista] as const;
      }));
      setLancamentosPorSessao(Object.fromEntries(pares));
    } catch (erro) {
      console.error('Caixa (Sessões PDV): não foi possível ler os lançamentos dos caixas abertos.', erro);
    }
    try {
      const configSnap = await getDoc(doc(db, 'configuracoes', tenantId));
      const ligada = lerConfigGaveta(configSnap.exists() ? configSnap.data() : null).ativo;
      if (!ligada) {
        setGaveta(null);
        setComposicaoGaveta(null);
      } else {
        const [resumo, composicao] = await Promise.all([
          resumoDaGaveta(),
          composicaoDaGaveta().catch((erro) => {
            console.error('Caixa (Sessões PDV): não foi possível montar o que compõe o saldo da gaveta.', erro);
            return null;
          }),
        ]);
        setGaveta(resumo);
        setComposicaoGaveta(composicao);
      }
    } catch (erro) {
      console.error('Caixa (Sessões PDV): não foi possível consultar o saldo da gaveta.', erro);
      setGaveta(null);
      setComposicaoGaveta(null);
    }
  }, [tenantId, idsDosAbertos]);
  useEffect(() => { void carregarAoVivo(); }, [carregarAoVivo]);

  const totalDeAbertos = idsDosAbertos ? idsDosAbertos.split('|').length : 0;
  /** Dinheiro das vendas do caixa e o saldo esperado de agora; null enquanto os lancamentos nao chegaram. */
  const aoVivo = (s: CaixaSessaoData): { vendidoCentavos: number; dinheiroCentavos: number; esperadoCentavos: number; modo: ModoDoFechamento } | null => {
    const lancamentos = lancamentosPorSessao[s.id];
    if (!lancamentos) return null;
    const dinheiroCentavos = lancamentos.filter((l) => l.dinheiro && !l.cancelado).reduce((soma, l) => soma + l.valorCentavos, 0);
    const esperado = esperadoNoFechamento({
      gavetaAtiva: Boolean(gaveta?.ativo),
      saldoDaGavetaCentavos: gaveta?.ativo ? gaveta.saldoCentavos : null,
      caixasAbertos: totalDeAbertos,
      saldoInicialCentavos: Number(s.saldoInicialCentavos || 0),
      dinheiroDaSessaoCentavos: dinheiroCentavos,
      totalSangriasCentavos: Number(s.totalSangriasCentavos || 0),
    });
    return { vendidoCentavos: totalDoCaixaAberto(lancamentos), dinheiroCentavos, esperadoCentavos: esperado.saldoEsperadoCentavos, modo: esperado.modo };
  };

  /**
   * O que compoe o "Esperado agora" deste caixa (setinha e relatorio, 24/11/2026):
   * pela gaveta, o saldo do CAIXA dia a dia; por sessao, saldo inicial + vendas
   * em dinheiro - sangrias.
   */
  const composicaoDoCaixa = (s: CaixaSessaoData): { composicao: ComposicaoDaGaveta; explicacao: string } | null => {
    const vivo = aoVivo(s);
    if (!vivo) return null;
    if (vivo.modo === 'gaveta') {
      if (!composicaoGaveta || !composicaoGaveta.ativo) return null;
      return {
        composicao: composicaoGaveta,
        explicacao: `É o saldo do ${composicaoGaveta.caixaNome || 'CAIXA'}: o dinheiro que entrou e saiu, no caixa e nos pedidos, separado por dia. `
          + 'O dinheiro de um dia que não foi para o COFRE continua na gaveta e passa para o dia seguinte. '
          + 'O saldo inicial contado na abertura não soma de novo: ele já é o dinheiro que estava na gaveta.',
      };
    }
    const lancamentos = lancamentosPorSessao[s.id] || [];
    return {
      composicao: composicaoDaSessao({
        abertoEm: toDate(s.createdAt),
        saldoInicialCentavos: Number(s.saldoInicialCentavos || 0),
        lancamentosEmDinheiro: lancamentos.filter((l) => l.dinheiro && !l.cancelado),
        sangrias: Array.isArray(s.sangrias) ? s.sangrias : [],
      }),
      explicacao: 'Saldo inicial + vendas em dinheiro deste caixa − sangrias.',
    };
  };

  // Fechar o caixa por aqui (pedido do dono, 23/11/2026): so' dono/administrador. A conta e a
  // gravacao sao as mesmas do PDV (services/fechamentoCaixaPdvService).
  const fecharCaixa = async (sessao: CaixaSessaoData) => {
    if (!currentUser || !tenantId || fechandoId) return;
    setFechandoId(sessao.id);
    try {
      // Caixa esquecido aberto (24/11/2026): fecha com a data de um dia anterior.
      const dataDoFechamento = await escolherDataDoFechamento(toDate(sessao.createdAt));
      if (dataDoFechamento === null) return;
      const esperado = await calcularEsperadoDoFechamento(tenantId, {
        id: sessao.id,
        saldoInicialCentavos: Number(sessao.saldoInicialCentavos || 0),
        totalSangriasCentavos: Number(sessao.totalSangriasCentavos || 0),
        sangrias: Array.isArray(sessao.sangrias) ? sessao.sangrias : [],
      }, dataDoFechamento);
      const contagem = await pedirValorContado(
        esperado,
        `Fechar o caixa de ${nomeDaSessao(sessao) || 'operador'}`,
        'O computador desse caixa sai do caixa na próxima venda ou ao atualizar a tela, e pede para abrir um caixa novo.',
        Number(sessao.saldoInicialCentavos || 0),
      );
      if (contagem === null) return;
      const contado = contagem.contadoCentavos;
      const diferenca = await gravarFechamentoDoCaixa({
        tenantId,
        sessaoId: sessao.id,
        usuarioId: currentUser.uid,
        usuarioEmail: currentUser.email || '',
        fechadoPorNome: currentUser.displayName || currentUser.email?.split('@')[0] || 'Responsável',
        pelaTelaDeSessoes: true,
        esperado,
        saldoInformadoCentavos: contado,
      });
      // Gaveta ligada: o contado menos o troco vai para o COFRE.
      const cofre = contagem.trocoCentavos !== null ? await mandarAoCofreDepoisDeFechar(sessao.id, contagem.trocoCentavos) : null;
      if (cofre && !cofre.ok) showWarning(`${mensagemDoFechamento(diferenca, esperado.modo)} ${cofre.texto}`);
      else showSuccess(mensagemDoFechamento(diferenca, esperado.modo, cofre?.texto || ''));
      void carregarAoVivo();
    } catch (erro) {
      console.error('Erro ao fechar o caixa pela tela de sessões:', erro);
      showError('Não foi possível fechar o caixa', mensagemDoErroDeFechamento(erro));
    } finally {
      setFechandoId(null);
    }
  };

  /**
   * "Fechar o caixa de ontem" (decisao do dono, 24/11/2026): conta o dinheiro que
   * ficou de um dia que ja' passou. Sobra/falta e a ida ao COFRE entram com a
   * data daquele dia; o esperado de hoje passa a partir do troco.
   */
  const acertarDiaAnterior = async () => {
    if (!gaveta?.ativo) return;
    const hoje = getDateInputInTimeZone();
    const ontem = addDaysToDateInput(hoje, -1);
    const limite = addDaysToDateInput(hoje, -DIAS_DA_COMPOSICAO);
    const primeiro = gaveta.desde > limite ? gaveta.desde : limite;
    if (primeiro > ontem) {
      showWarning('O dinheiro das vendas na gaveta foi ligado hoje: ainda não há dia anterior para acertar.');
      return;
    }
    const dias: string[] = [];
    for (let d = ontem; d >= primeiro; d = addDaysToDateInput(d, -1)) dias.push(d);
    const escolha = await NexusSwal.fire({
      title: 'Acertar a gaveta de um dia anterior',
      html: `<div style="text-align:left;font-size:14px;color:var(--text-secondary);line-height:1.5;">
          Use quando o dinheiro de um dia ficou na gaveta sem ser conferido ou mandado para o COFRE.
          Você informa quanto havia no fim daquele dia e quanto ficou de troco; a sobra ou falta e a ida ao COFRE entram com a data daquele dia.
        </div>`,
      input: 'select',
      inputOptions: Object.fromEntries(dias.map((d) => [d, `${formatDateInputPtBr(d)}${d === ontem ? ' (ontem)' : ''}`])),
      inputValue: ontem,
      inputAttributes: { 'aria-label': 'Dia que vai acertar' },
      showCancelButton: true,
      confirmButtonText: 'Continuar',
      cancelButtonText: 'Cancelar',
    });
    if (!escolha.isConfirmed) return;
    const dia = String(escolha.value || '');
    if (!dias.includes(dia)) return;
    let sistemaCentavos: number;
    try {
      sistemaCentavos = (await resumoDaGaveta(dia)).saldoCentavos ?? 0;
    } catch (erro) {
      showError('Não foi possível consultar a gaveta', mensagemDoErroDeFechamento(erro));
      return;
    }
    const contagem = await pedirContadoETroco({
      titulo: `Gaveta de ${formatDateInputPtBr(dia)}`,
      cabecalhoHtml: `Pelo sistema, no fim de ${formatDateInputPtBr(dia)} a gaveta tinha <strong style="color:var(--text-primary);">${currencyFormat(fromCents(sistemaCentavos))}</strong>.
          <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">É o dinheiro que entrou e saiu até aquele dia (caixa e pedidos), menos sangrias e transferências. A lista está na setinha ao lado de "Fechar caixa".</div>`,
      rotuloContado: `Quanto havia de fato no fim de ${formatDateInputPtBr(dia)} (R$)`,
      contadoSugeridoCentavos: sistemaCentavos,
      comTroco: true,
      trocoSugeridoCentavos: 0,
      textoConfirmar: 'Continuar',
    });
    if (!contagem || contagem.trocoCentavos === null) return;
    const diferenca = contagem.contadoCentavos - sistemaCentavos;
    const paraCofre = contagem.contadoCentavos - contagem.trocoCentavos;
    const linha = (rotulo: string, valor: string) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:3px 0;"><span>${rotulo}</span><strong style="color:var(--text-primary);">${valor}</strong></div>`;
    const confirmacao = await NexusSwal.fire({
      title: 'Confirmar o acerto',
      html: `<div style="text-align:left;font-size:14px;color:var(--text-secondary);line-height:1.5;">
          ${linha(`Sistema no fim de ${formatDateInputPtBr(dia)}`, currencyFormat(fromCents(sistemaCentavos)))}
          ${linha('Contado', currencyFormat(fromCents(contagem.contadoCentavos)))}
          ${linha(diferenca === 0 ? 'Diferença' : diferenca > 0 ? 'Sobra (entra no extrato do CAIXA)' : 'Falta (sai do extrato do CAIXA)', currencyFormat(fromCents(Math.abs(diferenca))))}
          ${linha('Vai para o COFRE', currencyFormat(fromCents(paraCofre)))}
          ${linha('Fica de troco na gaveta', currencyFormat(fromCents(contagem.trocoCentavos)))}
          <div style="font-size:12px;color:var(--text-muted);margin-top:8px;">Tudo fica com a data de ${formatDateInputPtBr(dia)}, em Caixas e Transferências.</div>
        </div>`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Confirmar acerto',
      cancelButtonText: 'Voltar',
    });
    if (!confirmacao.isConfirmed) return;
    try {
      const r = await acertarDiaDaGaveta({ data: dia, contadoCentavos: contagem.contadoCentavos, trocoCentavos: contagem.trocoCentavos });
      showSuccess(`Gaveta de ${formatDateInputPtBr(dia)} acertada.${r.paraCofreCentavos > 0 ? ` ${currencyFormat(fromCents(r.paraCofreCentavos))} foram para o ${r.cofreNome || 'COFRE'}.` : ''}`);
      await carregarAoVivo();
    } catch (erro) {
      console.error('Erro ao acertar a gaveta de um dia anterior:', erro);
      showError('Não foi possível acertar a gaveta', mensagemDoErroDeFechamento(erro));
    }
  };

  // Operador pelo nome do CADASTRO (pedido do dono, 20/10/2026): as sessoes
  // antigas gravaram o login ("50672123000147-uedder"). Um cadastro por
  // operador; sem permissao de ler (outra filial), fica o nome gravado.
  const [nomesDosOperadores, setNomesDosOperadores] = useState<Record<string, string>>({});
  const idsDosOperadores = useMemo(
    () => [...new Set(sessoesLidas.map((s) => s.operadorId).filter((id): id is string => Boolean(id)))].sort().join('|'),
    [sessoesLidas],
  );
  useEffect(() => {
    const ids = idsDosOperadores ? idsDosOperadores.split('|') : [];
    if (ids.length === 0) return undefined;
    let ativo = true;
    Promise.all(ids.map((id) => getDoc(doc(db, 'usuarios', id))
      .then((snap) => [id, nomeDoOperador(snap.exists() ? snap.data() : null, '')] as const)
      .catch(() => [id, ''] as const)))
      .then((pares) => { if (ativo) setNomesDosOperadores(Object.fromEntries(pares.filter(([, nome]) => nome))); });
    return () => { ativo = false; };
  }, [idsDosOperadores]);
  const nomeDaSessao = (s: CaixaSessaoData): string => (s.operadorId && nomesDosOperadores[s.operadorId]) || s.operadorNome || '';
  const chaveDoOperador = (s: CaixaSessaoData) => s.operadorId || `nome:${s.operadorNome || ''}`;
  const operadores = useMemo(() => {
    const mapa = new Map<string, string>();
    sessoes.forEach((s) => { if (!mapa.has(chaveDoOperador(s))) mapa.set(chaveDoOperador(s), nomeDaSessao(s) || 'Sem nome'); });
    return [...mapa.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessoes, nomesDosOperadores]);
  const doOperador = (s: CaixaSessaoData) => !operadorFiltro || chaveDoOperador(s) === operadorFiltro;
  const rotuloDoOperador = (s: CaixaSessaoData) => (
    <>
      {nomeDaSessao(s)}
      {s.terminalNome && (
        <span style={{ display: 'block', fontSize: '12px', fontWeight: 400, color: 'var(--text-muted)' }}>{s.terminalNome}</span>
      )}
    </>
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const caixasAbertos = useMemo(() => sessoes.filter((s) => s.status === 'aberto' && doOperador(s)), [sessoes, operadorFiltro]);

  const historico = useMemo(() => {
    const limite = diasFiltro > 0 ? new Date() : null;
    if (limite) limite.setDate(limite.getDate() - diasFiltro);
    return sessoes.filter((s) => {
      if (s.status !== 'fechado' || !doOperador(s)) return false;
      if (!limite) return true;
      const data = toDate(s.fechadoEm);
      return data ? data >= limite : true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessoes, diasFiltro, operadorFiltro]);

  /** Pela gaveta, uma composicao so' (a do CAIXA); por sessao, uma por caixa aberto. */
  const composicoesDoRelatorio = (): ComposicaoDoRelatorio[] => {
    const itens: ComposicaoDoRelatorio[] = [];
    let gavetaJaEntrou = false;
    caixasAbertos.forEach((s) => {
      const c = composicaoDoCaixa(s);
      if (!c) return;
      if (aoVivo(s)?.modo === 'gaveta') {
        if (gavetaJaEntrou) return;
        gavetaJaEntrou = true;
        itens.push({ rotulo: (composicaoGaveta && composicaoGaveta.ativo && composicaoGaveta.caixaNome) || 'CAIXA', composicao: c.composicao });
      } else {
        itens.push({ rotulo: nomeDaSessao(s) || 'Caixa', composicao: c.composicao });
      }
    });
    return itens;
  };

  if (previewAberto) {
    const rotuloPeriodo = diasFiltro > 0 ? `Fechadas nos últimos ${diasFiltro} dias + caixas abertos` : 'Todo o período + caixas abertos';
    const hoje = getDateInputInTimeZone();
    return (
      <RelatorioPreview
        relatorioId="caixa-sessoes-pdv"
        documento={montarDocumentoCaixaPdv(
          [...caixasAbertos, ...historico].map((s) => ({
            id: s.id,
            operadorNome: nomeDaSessao(s),
            status: s.status,
            abertoEm: toDate(s.createdAt),
            fechadoEm: toDate(s.fechadoEm),
            saldoInicialCentavos: Number(s.saldoInicialCentavos || 0),
            totalSangriasCentavos: Number(s.totalSangriasCentavos || 0),
            saldoEsperadoCentavos: s.saldoEsperadoCentavos ?? null,
            saldoFinalInformadoCentavos: s.saldoFinalInformadoCentavos ?? null,
            diferencaCentavos: s.diferencaCentavos ?? null,
            sangrias: Array.isArray(s.sangrias) ? s.sangrias : [],
            // Caixa aberto: esperado de agora e o que ja' passou por ele (23/11/2026).
            ...(s.status === 'aberto' && lancamentosPorSessao[s.id]
              ? { esperadoAoVivoCentavos: aoVivo(s)?.esperadoCentavos ?? null, lancamentos: lancamentosPorSessao[s.id] }
              : {}),
          })),
          {
            periodo: rotuloPeriodo,
            filtrosAplicados: operadorFiltro ? [`Operador: ${operadores.find(([chave]) => chave === operadorFiltro)?.[1] || ''}`] : [],
            composicoes: composicoesDoRelatorio(),
          },
        )}
        nomeArquivo={nomeArquivoRelatorio('Caixa Sessões PDV', diasFiltro > 0 ? addDaysToDateInput(hoje, -diasFiltro) : '', hoje)}
        onFechar={() => setPreviewAberto(false)}
        rotuloFechar="Voltar ao caixa"
      />
    );
  }

  const toggleExpand = async (sessao: CaixaSessaoData) => {
    if (expandedId === sessao.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(sessao.id);
    // Caixa aberto: rele o que compoe o esperado (pode ter entrado venda desde que a tela abriu).
    if (sessao.status === 'aberto') void carregarAoVivo();
    if (vendasPorSessao[sessao.id]) return;

    setLoadingVendas(sessao.id);
    try {
      // tenantId na consulta: sem ele as regras (canReadTenantDocument) negam a
      // lista inteira e "Vendas vinculadas" ficava sempre vazio.
      const q = query(collection(db, 'pedidos_venda'), where('tenantId', '==', tenantId), where('pdvSessionId', '==', sessao.id));
      const snap = await getDocs(q);
      // As vendas listadas dentro da sessao de caixa seguem a mesma regra
      // de visibilidade das demais telas de venda.
      const vendas: VendaVinculada[] = filtrarVendasVisiveis(
        snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as VendaVinculada)),
        vendasVisiveisDeUsuarioId,
      );
      vendas.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setVendasPorSessao((prev) => ({ ...prev, [sessao.id]: vendas }));
    } catch (error) {
      console.error('Erro ao buscar vendas da sessão de caixa:', error);
    } finally {
      setLoadingVendas(null);
    }
  };

  const renderExpandedRow = (sessao: CaixaSessaoData, colSpan: number) => {
    if (expandedId !== sessao.id) return null;
    const vendas = vendasPorSessao[sessao.id];
    return (
      <tr key={`${sessao.id}-detalhe`}>
        <td colSpan={colSpan} style={{ padding: '16px', backgroundColor: 'var(--bg-tertiary)' }}>
          {sessao.status === 'aberto' && (() => {
            const c = composicaoDoCaixa(sessao);
            if (!c) return <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '0 0 16px' }}>Montando o que compõe o esperado...</p>;
            return <ComposicaoDoEsperado composicao={c.composicao} rotuloTotal="Esperado agora" explicacao={c.explicacao} />;
          })()}
          {sessao.sangrias.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: '13px', fontWeight: 700 }}>
                <Banknote size={16} color="#f59e0b" /> Sangrias
              </div>
              <table className="data-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ padding: '6px 8px' }}>Horário</th>
                    <th style={{ padding: '6px 8px' }}>Motivo</th>
                    <th style={{ padding: '6px 8px' }}>Responsável</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {sessao.sangrias.map((sangria) => (
                    <tr key={sangria.id}>
                      <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>{new Date(sangria.registradoEm).toLocaleString('pt-BR')}</td>
                      <td style={{ padding: '6px 8px' }}>{sangria.motivo}</td>
                      <td style={{ padding: '6px 8px' }}>{sangria.registradoPorNome}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', color: '#f59e0b', fontWeight: 600 }}>{currencyFormat(fromCents(sangria.valorCentavos))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {sessao.status === 'aberto' && lancamentosPorSessao[sessao.id] && lancamentosPorSessao[sessao.id].length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: '13px', fontWeight: 700 }}>
                <Banknote size={16} color="#10b981" /> Recebido até agora, por forma de pagamento
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {totaisPorForma(lancamentosPorSessao[sessao.id]).map((forma) => (
                  <span key={forma.formaPagamento} style={{ padding: '6px 10px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', fontSize: '13px' }}>
                    {forma.formaPagamento}: <strong>{currencyFormat(fromCents(forma.valorCentavos))}</strong>
                    <span style={{ color: 'var(--text-muted)' }}> ({forma.quantidade})</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: '13px', fontWeight: 700 }}>
            <Wallet size={16} color="#37d7ff" /> Vendas vinculadas
          </div>
          {loadingVendas === sessao.id ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Carregando vendas...</p>
          ) : !vendas || vendas.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Nenhuma venda registrada nesta sessão.</p>
          ) : (
            <table className="data-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ padding: '6px 8px' }}>Pedido</th>
                  <th style={{ padding: '6px 8px' }}>Cliente</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {vendas.map((venda) => (
                  <tr key={venda.id}>
                    <td style={{ padding: '6px 8px' }}>#{venda.numeroPedido || venda.id.substring(0, 6).toUpperCase()}</td>
                    <td style={{ padding: '6px 8px' }}>{venda.clienteNome || '-'}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: '#10b981' }}>{currencyFormat(Number(venda.valorTotal || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="financeiro-page" style={{ padding: '24px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Wallet size={26} color="#f59e0b" />
            Caixa (Sessões PDV)
          </h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>
            Abertura, sangria e fechamento de todos os caixas da Frente de Caixa
          </p>
        </div>
        <MenuMaisOpcoes
          itens={[{
            texto: 'Relatório', Icone: FileText,
            titulo: 'Abre em PDF os caixas abertos e as sessões fechadas no período escolhido (dali dá para imprimir, salvar o PDF ou salvar em Excel)',
            desabilitado: loading,
            // Rele os caixas abertos antes de abrir: o relatorio sai com os valores de agora.
            onClick: () => { void carregarAoVivo().finally(() => setPreviewAberto(true)); },
          }, {
            texto: 'Acertar a gaveta de um dia anterior', Icone: CalendarCheck,
            titulo: 'Conta o dinheiro que ficou de um dia que já passou: a sobra ou falta e a ida ao COFRE entram com a data daquele dia',
            oculto: !ehGerente || !gaveta?.ativo,
            onClick: () => { void acertarDiaAnterior(); },
          }, {
            texto: 'Computadores do caixa', Icone: MonitorCheck,
            titulo: 'Computadores onde cada funcionário entra com código e senha; dá para desativar um deles',
            oculto: !ehGerente,
            separadorAntes: true,
            onClick: () => setComputadoresAberto(true),
          }]}
        />
      </div>
      {computadoresAberto && <ComputadoresDoCaixaModal onFechar={() => setComputadoresAberto(false)} />}

      <div className="card" style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', padding: '24px', marginBottom: '24px' }}>
        <div className="section-header" style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Clock size={20} color="#10b981" />
          <h3 style={{ margin: 0 }}>Caixas abertos agora</h3>
        </div>
        {gaveta?.ativo && gaveta.saldoCentavos !== null && (
          <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--text-muted)' }}>
            Dinheiro das vendas na gaveta ligado: o {gaveta.caixaNome || 'CAIXA'} tem agora <strong style={{ color: 'var(--text-primary)' }}>{currencyFormat(fromCents(gaveta.saldoCentavos))}</strong> (vendas em dinheiro do caixa e dos pedidos, menos sangrias e transferências).
          </p>
        )}

        <div className="table-wrapper">
          <table className="data-table financeiro-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ padding: '12px 8px' }}>Operador</th>
                <th style={{ padding: '12px 8px' }}>Aberto em</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Saldo inicial</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }} title="Tudo que já passou por este caixa, em todas as formas de pagamento">Vendido</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }} title="Vendas em dinheiro deste caixa">Em dinheiro</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Total sangrias</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }} title="Quanto deve ter de dinheiro no caixa agora">Esperado agora</th>
                <th style={{ padding: '12px 8px', textAlign: 'center' }}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '20px' }}>Carregando...</td></tr>
              ) : caixasAbertos.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>Nenhum caixa aberto no momento.</td></tr>
              ) : (
                caixasAbertos.flatMap((sessao) => {
                  const vivo = aoVivo(sessao);
                  const valorAoVivo = (centavos: number | undefined) => (centavos === undefined ? '…' : currencyFormat(fromCents(centavos)));
                  return [
                    <tr key={sessao.id} style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }} onClick={() => toggleExpand(sessao)}>
                      <td style={{ padding: '10px 8px', fontWeight: 500 }}>{rotuloDoOperador(sessao)}</td>
                      <td style={{ padding: '10px 8px', color: 'var(--text-muted)' }}>{formatDateTime(sessao.createdAt)}</td>
                      <td style={{ padding: '10px 8px', textAlign: 'right' }}>{currencyFormat(fromCents(sessao.saldoInicialCentavos))}</td>
                      <td style={{ padding: '10px 8px', textAlign: 'right' }}>{valorAoVivo(vivo?.vendidoCentavos)}</td>
                      <td style={{ padding: '10px 8px', textAlign: 'right', color: '#10b981' }}>{valorAoVivo(vivo?.dinheiroCentavos)}</td>
                      <td style={{ padding: '10px 8px', textAlign: 'right', color: '#f59e0b' }}>{currencyFormat(fromCents(sessao.totalSangriasCentavos))}</td>
                      <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700 }}>{valorAoVivo(vivo?.esperadoCentavos)}</td>
                      <td style={{ padding: '10px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {ehGerente && (
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={fechandoId !== null}
                            title="Fecha este caixa por aqui: confere o valor contado com o esperado"
                            onClick={(e) => { e.stopPropagation(); void fecharCaixa(sessao); }}
                            style={{ padding: '6px 10px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '6px', marginRight: '8px' }}
                          >
                            <Lock size={14} /> {fechandoId === sessao.id ? 'Fechando...' : 'Fechar caixa'}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn-secondary"
                          aria-expanded={expandedId === sessao.id}
                          title="Ver as vendas e lançamentos que compõem o Esperado agora"
                          onClick={(e) => { e.stopPropagation(); void toggleExpand(sessao); }}
                          style={{ padding: '6px 8px', display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle' }}
                        >
                          {expandedId === sessao.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      </td>
                    </tr>,
                    renderExpandedRow(sessao, 8),
                  ];
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card list-container" style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', padding: '24px' }}>
        <div className="list-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <History size={20} color="#37d7ff" />
            <h3 style={{ margin: 0 }}>Histórico de sessões</h3>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <User size={18} style={{ color: 'var(--text-muted)' }} />
            <select
              value={operadorFiltro}
              onChange={(e) => setOperadorFiltro(e.target.value)}
              aria-label="Filtrar por operador"
              style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '8px 12px', borderRadius: 'var(--radius-md)' }}
            >
              <option value="">Todos os operadores</option>
              {operadores.map(([chave, nome]) => <option key={chave} value={chave}>{nome}</option>)}
            </select>
            <Calendar size={18} style={{ color: 'var(--text-muted)' }} />
            <select
              value={diasFiltro}
              onChange={(e) => setDiasFiltro(Number(e.target.value))}
              style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '8px 12px', borderRadius: 'var(--radius-md)' }}
            >
              <option value={7}>Últimos 7 dias</option>
              <option value={15}>Últimos 15 dias</option>
              <option value={30}>Últimos 30 dias</option>
              <option value={90}>Últimos 90 dias</option>
              <option value={0}>Todo o período</option>
            </select>
          </div>
        </div>

        <div className="table-wrapper">
          <table className="data-table financeiro-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ padding: '12px 8px' }}>Operador</th>
                <th style={{ padding: '12px 8px' }}>Abertura</th>
                <th style={{ padding: '12px 8px' }}>Fechamento</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Saldo inicial</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Sangrias</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Esperado</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Informado</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Diferença</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '20px' }}>Carregando...</td></tr>
              ) : historico.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>Nenhuma sessão fechada no período selecionado.</td></tr>
              ) : (
                historico.flatMap((sessao) => {
                  const diferenca = sessao.diferencaCentavos || 0;
                  return [
                    <tr key={sessao.id} style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }} onClick={() => toggleExpand(sessao)}>
                      <td style={{ padding: '10px 8px', fontWeight: 500 }}>{rotuloDoOperador(sessao)}</td>
                      <td style={{ padding: '10px 8px', color: 'var(--text-muted)' }}>{formatDateTime(sessao.createdAt)}</td>
                      <td style={{ padding: '10px 8px', color: 'var(--text-muted)' }}>{formatDateTime(sessao.fechadoEm)}</td>
                      <td style={{ padding: '10px 8px', textAlign: 'right' }}>{currencyFormat(fromCents(sessao.saldoInicialCentavos))}</td>
                      <td style={{ padding: '10px 8px', textAlign: 'right', color: '#f59e0b' }}>{currencyFormat(fromCents(sessao.totalSangriasCentavos))}</td>
                      <td style={{ padding: '10px 8px', textAlign: 'right' }}>{currencyFormat(fromCents(sessao.saldoEsperadoCentavos || 0))}</td>
                      <td style={{ padding: '10px 8px', textAlign: 'right' }}>{currencyFormat(fromCents(sessao.saldoFinalInformadoCentavos || 0))}</td>
                      <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700, color: diferenca === 0 ? '#10b981' : diferenca > 0 ? '#37d7ff' : '#ef4444' }}>
                        {diferenca > 0 ? '+' : ''}{currencyFormat(fromCents(diferenca))}
                      </td>
                    </tr>,
                    renderExpandedRow(sessao, 8),
                  ];
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default CaixaRegistros;
