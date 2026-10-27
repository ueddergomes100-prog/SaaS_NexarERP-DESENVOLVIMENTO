import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Barcode, FileDown, FileText, History, Loader2, Package, Printer, RotateCcw, Search, Trash2, X } from 'lucide-react';
import DevolucaoCompraModal from '../../components/fiscal/entrada/DevolucaoCompraModal';
import { hasTenantFullAccess } from '../../utils/roles';
import { useNavigate } from 'react-router-dom';
import { collection, doc, documentId, query, where, getDocs, runTransaction, serverTimestamp, Timestamp, type DocumentData, type Query } from 'firebase/firestore';
import { assinarComReserva } from '../../services/consultaComReserva';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { NexusSwal, showError, showSuccess, escaparHtml } from '../../utils/alerts';
import { buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { dateInputToUtcStart, formatDateInputPtBr, getDateInputInTimeZone } from '../../utils/dateTime';
import {
  findTituloBloqueandoExclusao,
  findItemSemEstoqueParaReverter,
  type NotaFiscalEntradaItemRecord,
  type NotaFiscalEntradaStatus,
} from '../../utils/entradaNfeDomain';
import { semAbrirLinha, useLinhaSelecionavel } from '../../hooks/useLinhaSelecionavel';
import PdfVisualizador from '../../components/common/PdfVisualizador';
import { descompactarXml } from '../../utils/xmlCompactoDomain';
import { parseNfeXml } from '../../utils/nfeXmlDomain';
import { formatarChave } from '../../utils/danfePdf';
import { BotaoFiltros, CampoFiltro, CampoPeriodo, PainelFiltros, estiloCampoFiltro } from '../../components/common/PainelFiltros';
import { dentroDoPeriodo } from '../../utils/filtroListaDomain';
import EstadoVazio from '../../components/common/EstadoVazio';
import { emLotes, LOTE_IN_POR_ID } from '../../utils/firestoreLimites';

interface NotaFiscalEntradaDoc {
  id: string;
  numeroNF: string;
  dataEmissao: string;
  valorTotal: number;
  fornecedorId: string;
  fornecedorNome: string;
  fornecedorCnpj: string;
  status: NotaFiscalEntradaStatus;
  itens: NotaFiscalEntradaItemRecord[];
  titulosPagarIds: string[];
  motivoExclusao?: string;
  createdAt?: Timestamp;
  // Gravados a partir de 2026-09-24 (notas antigas nao tem).
  chaveAcesso?: string;
  serie?: string;
  modelo?: string;
  naturezaOperacao?: string;
  dataEntrada?: string;
  observacao?: string;
  pagamento?: { modo?: string; forma?: string; categoria?: string };
  xmlGzipBase64?: string;
  /** Entrada lancada sozinha pela transferencia entre filiais (Filiais F4). */
  transferenciaId?: string;
  /** Devolucao ao fornecedor (21/10/2026): quanto de cada item (indice) ja voltou, e as devolucoes. */
  devolvidoPorItem?: Record<string, number>;
  devolucoesCompraIds?: string[];
  /** 'nfse' = NFS-e de servico tomado (27/10/2026, EntradaNFSe.tsx): sem itens. */
  tipoDocumento?: string;
  servico?: {
    descricao?: string;
    codigoServico?: string;
    competencia?: string;
    codigoVerificacao?: string;
    valorIss?: number;
    issRetido?: boolean;
    retencoes?: Record<string, number>;
    valorLiquido?: number;
  };
}

/** NFS-e (servico) ou NF-e, para os textos da tela. */
const rotuloDoDocumento = (nota: Pick<NotaFiscalEntradaDoc, 'tipoDocumento'>) => (nota.tipoDocumento === 'nfse' ? 'NFS-e' : 'NF-e');

interface TituloPagar {
  id: string;
  descricao: string;
  data: string;
  valor: number;
  status: string;
}

const currency = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);

const STATUS_LABEL: Record<NotaFiscalEntradaStatus, string> = {
  ativa: 'Ativa',
  excluida: 'Excluída',
};

const STATUS_COLOR: Record<NotaFiscalEntradaStatus, string> = {
  ativa: '#10b981',
  excluida: '#ef4444',
};

const TIPO_ITEM_LABEL: Record<NotaFiscalEntradaItemRecord['tipo'], string> = {
  revenda: 'Revenda',
  materia_prima: 'Matéria-Prima',
  insumo: 'Insumo',
  registro: 'Só registro (sem estoque)',
};

const NotasFiscaisEntradaList: React.FC = () => {
  const { linha } = useLinhaSelecionavel();
  const navigate = useNavigate();
  const { tenantId, currentUser, userRole, isOwner, userPermissions } = useAuth();
  // Devolucao de compra ao fornecedor (21/10/2026): quem lanca entrada devolve; quem emite nota emite a NF-e.
  const acessoTotal = hasTenantFullAccess(userRole, isOwner);
  const podeDevolver = acessoTotal || userPermissions.includes('fiscal.entrada');
  const podeEmitirNota = acessoTotal || userPermissions.includes('fiscal.emitir');
  const [devolucaoNotaId, setDevolucaoNotaId] = useState<string | null>(null);
  const { openTab } = useTabs();
  const [notas, setNotas] = useState<NotaFiscalEntradaDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  /** '' = todas (ativas e excluidas). */
  const [statusFiltro, setStatusFiltro] = useState<'' | NotaFiscalEntradaStatus>('');
  const [periodoDe, setPeriodoDe] = useState('');
  const [periodoAte, setPeriodoAte] = useState('');

  const [notaSelecionada, setNotaSelecionada] = useState<NotaFiscalEntradaDoc | null>(null);
  const [danfe, setDanfe] = useState<{ blob: Blob; nome: string } | null>(null);
  const [preparandoXml, setPreparandoXml] = useState(false);
  const [titulos, setTitulos] = useState<TituloPagar[]>([]);
  const [carregandoTitulos, setCarregandoTitulos] = useState(false);
  const [excluindoId, setExcluindoId] = useState<string | null>(null);

  // Leitura enxuta (otimizacao de leituras, 2026-10-14). Antes: TODAS as
  // notas de entrada da empresa, cada uma com o XML dentro. Agora:
  //  - sem filtro de emissao: as LANCADAS este mes (createdAt) -- a nota
  //    recem-lancada aparece mesmo se foi emitida no mes passado;
  //  - com o filtro "Emissao": as emitidas no periodo (dataEmissao).
  // Sem o indice publicado, cai na colecao inteira e o mesmo corte e' feito aqui.
  const lancadasNoMes = !periodoDe && !periodoAte;
  const inicioDoMes = `${getDateInputInTimeZone().slice(0, 7)}-01`;
  useEffect(() => {
    if (!tenantId) return undefined;
    setLoading(true);
    const todas = query(collection(db, 'notas_fiscais_entrada'), where('tenantId', '==', tenantId));
    let enxuta: Query<DocumentData> = todas;
    let noCorte: (dados: DocumentData) => boolean = () => true;
    const inicio = lancadasNoMes ? dateInputToUtcStart(inicioDoMes) : null;
    if (inicio) {
      enxuta = query(todas, where('createdAt', '>=', Timestamp.fromDate(inicio)));
      noCorte = (dados) => Boolean(dados.createdAt?.toDate && dados.createdAt.toDate() >= inicio);
    } else if (!lancadasNoMes) {
      enxuta = query(
        todas,
        ...(periodoDe ? [where('dataEmissao', '>=', periodoDe)] : []),
        ...(periodoAte ? [where('dataEmissao', '<=', periodoAte)] : []),
      );
      noCorte = (dados) => dentroDoPeriodo(dados.dataEmissao, periodoDe, periodoAte);
    }
    const rotulo = lancadasNoMes ? 'Notas de entrada (lançadas no mês)' : 'Notas de entrada (emissão)';
    return assinarComReserva(enxuta, todas, rotulo, (snap) => {
      const data = snap.docs
        .filter((d) => noCorte(d.data()))
        .map((d) => ({ id: d.id, ...d.data() } as NotaFiscalEntradaDoc));
      data.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      setNotas(data);
      setLoading(false);
    }, (error) => {
      console.error('Erro ao buscar notas de entrada:', error);
      setLoading(false);
    });
  }, [tenantId, lancadasNoMes, inicioDoMes, periodoDe, periodoAte]);

  const notasFiltradas = useMemo(() => {
    const termo = searchTerm.trim().toLowerCase();
    return notas.filter((nota) => (
      (!termo || nota.numeroNF.toLowerCase().includes(termo) || nota.fornecedorNome.toLowerCase().includes(termo))
      && (!statusFiltro || nota.status === statusFiltro)
      && dentroDoPeriodo(nota.dataEmissao, periodoDe, periodoAte)
    ));
  }, [notas, searchTerm, statusFiltro, periodoDe, periodoAte]);

  const filtrosAtivos = (statusFiltro ? 1 : 0) + (periodoDe || periodoAte ? 1 : 0);
  const limparFiltros = () => {
    setStatusFiltro('');
    setPeriodoDe('');
    setPeriodoAte('');
  };

  const handleVerDetalhes = async (nota: NotaFiscalEntradaDoc) => {
    setNotaSelecionada(nota);
    setTitulos([]);

    if (nota.titulosPagarIds.length === 0) return;

    setCarregandoTitulos(true);
    try {
      // Por id, lotes de 10: acima de ~17 ids a consulta volta "sem permissao"
      // (firestoreLimites.ts) -- nota com muitas duplicatas nao carregava os titulos.
      const data: TituloPagar[] = [];
      for (const lote of emLotes(nota.titulosPagarIds, LOTE_IN_POR_ID)) {
        const snap = await getDocs(query(collection(db, 'transacoes'), where(documentId(), 'in', lote)));
        snap.forEach((d) => {
          const t = d.data();
          data.push({ id: d.id, descricao: t.descricao || '', data: t.data || '', valor: Number(t.valor || 0), status: t.status || '' });
        });
      }
      data.sort((a, b) => a.data.localeCompare(b.data));
      setTitulos(data);
    } catch (error) {
      console.error('Erro ao buscar títulos da nota:', error);
    } finally {
      setCarregandoTitulos(false);
    }
  };

  /** XML guardado na entrada -> DANFE na tela (com Imprimir e Salvar). */
  const handleImprimirDanfe = async (nota: NotaFiscalEntradaDoc) => {
    if (!nota.xmlGzipBase64) return;
    setPreparandoXml(true);
    try {
      const xml = await descompactarXml(nota.xmlGzipBase64);
      const notaParseada = parseNfeXml(xml);
      const { gerarDanfePdf, nomeDoArquivoDanfe } = await import('../../utils/danfePdf');
      setDanfe({ blob: gerarDanfePdf(notaParseada).output('blob'), nome: nomeDoArquivoDanfe(notaParseada) });
    } catch (erro) {
      showError('Não foi possível gerar o DANFE', erro instanceof Error ? erro.message : 'Tente novamente.');
    } finally {
      setPreparandoXml(false);
    }
  };

  const handleBaixarXml = async (nota: NotaFiscalEntradaDoc) => {
    if (!nota.xmlGzipBase64) return;
    setPreparandoXml(true);
    try {
      const xml = await descompactarXml(nota.xmlGzipBase64);
      const endereco = URL.createObjectURL(new Blob([xml], { type: 'text/xml' }));
      const link = document.createElement('a');
      link.href = endereco;
      link.download = `${nota.tipoDocumento === 'nfse' ? 'NFSe' : 'NFe'}-${nota.chaveAcesso || nota.numeroNF}.xml`;
      link.click();
      URL.revokeObjectURL(endereco);
    } catch (erro) {
      showError('Não foi possível baixar o XML', erro instanceof Error ? erro.message : 'Tente novamente.');
    } finally {
      setPreparandoXml(false);
    }
  };

  const handleFecharDetalhes = () => {
    setNotaSelecionada(null);
    setTitulos([]);
  };

  // Fatia 3/N -- exclui uma nota ja confirmada, revertendo a quantidade
  // que ela somou ao estoque/materia-prima (mantendo o cadastro do
  // produto) e removendo os titulos de Contas a Pagar gerados por ela.
  // Bloqueia se algum titulo ja estiver pago ou se parte do estoque somado
  // ja tiver sido vendida/consumida por outro caminho (mesmo principio ja
  // usado no estorno de Producao) -- checagens puras em entradaNfeDomain.ts,
  // a transacao so le/escreve com base no resultado delas.
  const handleExcluirNota = async (nota: NotaFiscalEntradaDoc) => {
    if (!currentUser || !tenantId) return;
    // Nota com devolucao ao fornecedor: excluir reverteria o estoque que ja saiu de novo.
    if ((nota.devolucoesCompraIds || []).length > 0) {
      showError('Nota com devolução ao fornecedor', `A NF-e ${nota.numeroNF} já tem devolução ao fornecedor registrada, então não pode ser excluída (o estoque e o financeiro já foram acertados pela devolução).`);
      return;
    }

    const result = await NexusSwal.fire({
      title: 'Excluir Nota de Entrada?',
      html: nota.tipoDocumento === 'nfse'
        ? `Isso remove os títulos de Contas a Pagar gerados pela NFS-e <strong>${escaparHtml(nota.numeroNF)}</strong> (${escaparHtml(nota.fornecedorNome)}). O fornecedor continua cadastrado.<br/><br/>Digite o motivo (mínimo 12 caracteres):`
        : `Isso reverte a quantidade somada ao estoque, matéria-prima ou insumo e remove os títulos de Contas a Pagar gerados pela NF-e <strong>${escaparHtml(nota.numeroNF)}</strong> (${escaparHtml(nota.fornecedorNome)}). O cadastro dos itens não é apagado.<br/><br/>Digite o motivo (mínimo 12 caracteres):`,
      input: 'text',
      inputLabel: 'Motivo da exclusão',
      inputAttributes: { minlength: '12', required: 'true' },
      showCancelButton: true,
      confirmButtonText: 'Confirmar Exclusão',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#ef4444',
      preConfirm: (motivo) => {
        if (!motivo || motivo.trim().length < 12) {
          NexusSwal.showValidationMessage('O motivo deve ter pelo menos 12 caracteres.');
          return false;
        }
        return motivo;
      },
    });

    if (!result.isConfirmed) return;
    const motivo = (result.value as string).trim();

    setExcluindoId(nota.id);
    try {
      await runTransaction(db, async (transaction) => {
        const notaRef = doc(db, 'notas_fiscais_entrada', nota.id);
        const notaSnap = await transaction.get(notaRef);
        if (!notaSnap.exists() || notaSnap.data().status !== 'ativa') {
          throw new Error('Esta nota já foi excluída ou não existe mais.');
        }

        const titulosRefs = nota.titulosPagarIds.map((id) => doc(db, 'transacoes', id));
        const titulosSnaps = await Promise.all(titulosRefs.map((ref) => transaction.get(ref)));
        const titulosExistentes = titulosSnaps.filter((snap) => snap.exists());
        const tituloBloqueando = findTituloBloqueandoExclusao(
          titulosExistentes.map((snap) => ({ id: snap.id, status: (snap.data()?.status as string) || '', descricao: (snap.data()?.descricao as string) || '' }))
        );
        if (tituloBloqueando) {
          throw new Error(`Não é possível excluir: o título "${tituloBloqueando.descricao}" já está com status "${tituloBloqueando.status}".`);
        }

        const itensRevenda = nota.itens.filter((item) => item.tipo === 'revenda');
        const itensMateriaPrima = nota.itens.filter((item) => item.tipo === 'materia_prima');
        const itensInsumo = nota.itens.filter((item) => item.tipo === 'insumo');

        const estoqueSnaps = await Promise.all(itensRevenda.map((item) => transaction.get(doc(db, 'estoque', item.itemId))));
        const materiaPrimaSnaps = await Promise.all(itensMateriaPrima.map((item) => transaction.get(doc(db, 'materias_primas', item.itemId))));

        const insumoSnaps = await Promise.all(itensInsumo.map((item) => transaction.get(doc(db, 'insumos', item.itemId))));

        const estoqueAtualPorId = new Map(estoqueSnaps.map((snap) => [snap.id, Number(snap.data()?.quantidade || 0)]));
        const materiaPrimaAtualPorId = new Map(materiaPrimaSnaps.map((snap) => [snap.id, Number(snap.data()?.quantidade || 0)]));

        // Lotes que esta entrada criou/somou (produto que controla lote): cada um precisa ainda ter
        // o saldo que entrou, senao parte ja foi vendida/ajustada e o estorno deixaria o lote negativo.
        const lotesDaNota = new Map<string, { loteId: string; lote: string; produto: string; quantidade: number }>();
        itensRevenda.forEach((item) => (item.lotes || []).forEach((l) => {
          const atual = lotesDaNota.get(l.loteId);
          lotesDaNota.set(l.loteId, { loteId: l.loteId, lote: l.lote, produto: item.descricaoXml, quantidade: (atual?.quantidade || 0) + l.quantidade });
        }));
        const lotesParaReverter = [...lotesDaNota.values()];
        const loteSnaps = await Promise.all(lotesParaReverter.map((l) => transaction.get(doc(db, 'estoque_lotes', l.loteId))));
        const loteSemSaldo = lotesParaReverter.find((l, idx) => !loteSnaps[idx].exists() || Number(loteSnaps[idx].data()?.quantidade || 0) < l.quantidade - 0.0005);
        if (loteSemSaldo) {
          throw new Error(`Não é possível excluir: o lote "${loteSemSaldo.lote}" de "${loteSemSaldo.produto}" já teve parte do saldo vendida ou ajustada desde essa entrada.`);
        }

        const insumoAtualPorId = new Map(insumoSnaps.map((snap) => [snap.id, Number(snap.data()?.quantidade || 0)]));

        const itemSemEstoqueRevenda = findItemSemEstoqueParaReverter(
          itensRevenda.map((item) => ({ itemId: item.itemId, descricaoXml: item.descricaoXml, quantidade: item.quantidadeEstoque ?? item.quantidade })),
          estoqueAtualPorId,
        );
        if (itemSemEstoqueRevenda) {
          throw new Error(`Não é possível excluir: "${itemSemEstoqueRevenda.descricaoXml}" já teve parte do estoque vendida/consumida desde essa entrada.`);
        }

        const itemSemEstoqueMateriaPrima = findItemSemEstoqueParaReverter(
          itensMateriaPrima.map((item) => ({ itemId: item.itemId, descricaoXml: item.descricaoXml, quantidade: item.quantidadeEstoque ?? item.quantidade })),
          materiaPrimaAtualPorId,
        );
        if (itemSemEstoqueMateriaPrima) {
          throw new Error(`Não é possível excluir: "${itemSemEstoqueMateriaPrima.descricaoXml}" já teve parte do estoque consumida em produção desde essa entrada.`);
        }

        const itemSemEstoqueInsumo = findItemSemEstoqueParaReverter(
          itensInsumo.map((item) => ({ itemId: item.itemId, descricaoXml: item.descricaoXml, quantidade: item.quantidadeEstoque ?? item.quantidade })),
          insumoAtualPorId,
        );
        if (itemSemEstoqueInsumo) {
          throw new Error(`Não é possível excluir: "${itemSemEstoqueInsumo.descricaoXml}" já teve parte do estoque consumida desde essa entrada.`);
        }

        // Todas as leituras feitas -- a partir daqui, so escritas
        // (exigencia do Firestore: leituras antes de qualquer escrita na
        // transacao inteira, nao so por documento).
        const resumoMotivo = `Exclusão da NF ${nota.numeroNF}: ${motivo}`;

        estoqueSnaps.forEach((snap, idx) => {
          const item = itensRevenda[idx];
          const atual = Number(snap.data()?.quantidade || 0);
          transaction.update(snap.ref, {
            quantidade: atual - (item.quantidadeEstoque ?? item.quantidade),
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), resumoMotivo),
          });
        });

        materiaPrimaSnaps.forEach((snap, idx) => {
          const item = itensMateriaPrima[idx];
          const atual = Number(snap.data()?.quantidade || 0);
          transaction.update(snap.ref, {
            quantidade: atual - (item.quantidadeEstoque ?? item.quantidade),
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), resumoMotivo),
          });
        });

        loteSnaps.forEach((snap, idx) => {
          transaction.update(snap.ref, {
            quantidade: Number(snap.data()?.quantidade || 0) - lotesParaReverter[idx].quantidade,
            updatedAt: serverTimestamp(),
          });
        });

        insumoSnaps.forEach((snap, idx) => {
          const item = itensInsumo[idx];
          const atual = Number(snap.data()?.quantidade || 0);
          transaction.update(snap.ref, {
            quantidade: atual - (item.quantidadeEstoque ?? item.quantidade),
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), resumoMotivo),
          });
        });

        titulosExistentes.forEach((snap) => transaction.update(snap.ref, {
          status: 'Cancelada',
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), resumoMotivo),
        }));

        transaction.update(notaRef, {
          status: 'excluida',
          motivoExclusao: motivo,
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), resumoMotivo),
        });
      });

      try {
        const { createAuditLog } = await import('../../services/logService');
        await createAuditLog({
          tenantId,
          usuarioId: currentUser.uid,
          usuarioEmail: currentUser.email || '',
          modulo: 'estoque',
          acao: 'exclusao',
          descricao: `Nota de entrada NF ${nota.numeroNF} (${nota.fornecedorNome}) excluída. Estoque revertido e ${nota.titulosPagarIds.length} título(s) de Contas a Pagar removido(s). Motivo: ${motivo}.`,
          status: 'sucesso',
        });
      } catch {
        // Ignora erros ao registrar auditoria
      }

      if (notaSelecionada?.id === nota.id) handleFecharDetalhes();
      showSuccess('Nota de entrada excluída — estoque revertido e títulos removidos.');
    } catch (error) {
      console.error('Erro ao excluir nota de entrada:', error);
      showError('Erro ao excluir', (error as Error).message || 'Não foi possível excluir a nota de entrada.');
    } finally {
      setExcluindoId(null);
    }
  };

  return (
    <div className="os-page" style={{ padding: '24px' }}>
      <div className="page-header" style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '16px' }}>
        <button className="icon-btn back-btn" onClick={() => navigate('/fiscal/entrada-nfe')} title="Voltar para Entrada de XML">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '24px', margin: 0 }}>
            <History size={28} color="var(--accent-purple)" />
            Histórico de Entradas
          </h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>
            Notas fiscais de entrada já lançadas (NF-e de mercadoria e NFS-e de serviço), com os itens e títulos de Contas a Pagar gerados por cada uma.
          </p>
        </div>
      </div>

      <div className="card list-container" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div className="list-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
          <div className="search-box" style={{ position: 'relative', width: '350px' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '10px', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Buscar por número da NF ou fornecedor..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '100%', padding: '10px 16px 10px 40px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
            />
          </div>
          <BotaoFiltros aberto={filtrosAbertos} onToggle={() => setFiltrosAbertos((v) => !v)} quantidadeAtiva={filtrosAtivos} />
        </div>
        <PainelFiltros aberto={filtrosAbertos} quantidadeAtiva={filtrosAtivos} onLimpar={limparFiltros}>
          <CampoFiltro rotulo="Situação">
            <select value={statusFiltro} onChange={(e) => setStatusFiltro(e.target.value as '' | NotaFiscalEntradaStatus)} style={estiloCampoFiltro}>
              <option value="">Todas</option>
              <option value="ativa">{STATUS_LABEL.ativa}</option>
              <option value="excluida">{STATUS_LABEL.excluida}</option>
            </select>
          </CampoFiltro>
          <CampoPeriodo rotulo="Emissão" de={periodoDe} ate={periodoAte} onChangeDe={setPeriodoDe} onChangeAte={setPeriodoAte} />
        </PainelFiltros>
        {lancadasNoMes && (
          <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--text-muted)' }}>
            Notas lançadas este mês. Para outro período, use Filtros › Emissão.
          </p>
        )}

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Data de Emissão</th>
                <th>Nº da nota</th>
                <th>Fornecedor</th>
                <th style={{ textAlign: 'center' }}>Itens</th>
                <th style={{ textAlign: 'right' }}>Valor Total</th>
                <th style={{ textAlign: 'center' }}>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '20px' }}>Carregando histórico...</td>
                </tr>
              ) : notasFiltradas.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '8px' }}>
                    <EstadoVazio titulo={searchTerm ? `Nenhum resultado encontrado para "${searchTerm}".` : (lancadasNoMes ? 'Nenhuma nota de entrada lançada este mês.' : 'Nenhuma nota de entrada emitida neste período.')} compacto />
                  </td>
                </tr>
              ) : (
                notasFiltradas.map((nota) => (
                  <tr key={nota.id} {...linha(nota.id, () => handleVerDetalhes(nota))}>
                    <td>{formatDateInputPtBr(nota.dataEmissao)}</td>
                    <td className="font-medium">
                      {nota.numeroNF}
                      {nota.tipoDocumento === 'nfse' && (
                        <span title="Nota fiscal de serviço (serviço tomado)" style={{ marginLeft: '6px', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', backgroundColor: 'rgba(168,85,247,0.15)', color: 'var(--accent-purple)', fontWeight: 600 }}>
                          NFS-e
                        </span>
                      )}
                    </td>
                    <td>
                      {nota.fornecedorNome}
                      {nota.transferenciaId && (
                        <span title="Entrada lançada pela transferência entre filiais. Para desfazer, use a transferência." style={{ marginLeft: '6px', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', backgroundColor: 'rgba(14,165,233,0.15)', color: '#38bdf8', fontWeight: 600 }}>
                          Transferência
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center' }}>{nota.tipoDocumento === 'nfse' ? 'Serviço' : nota.itens.length}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{currency(nota.valorTotal)}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, backgroundColor: `${STATUS_COLOR[nota.status]}1a`, color: STATUS_COLOR[nota.status] }}>
                        {STATUS_LABEL[nota.status]}
                      </span>
                    </td>
                    <td {...semAbrirLinha}>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="icon-btn" title="Ver detalhes" onClick={() => handleVerDetalhes(nota)}>
                          <FileText size={16} />
                        </button>
                        {nota.tipoDocumento !== 'nfse' && (
                          <button
                            className="icon-btn"
                            title="Gerar etiquetas dos produtos desta nota"
                            onClick={() => openTab(`/estoque/etiquetas?notaFiscalId=${nota.id}`, 'Etiquetas')}
                          >
                            <Barcode size={16} />
                          </button>
                        )}
                        {nota.status === 'ativa' && !nota.transferenciaId && nota.tipoDocumento !== 'nfse' && podeDevolver && (
                          <button
                            className="icon-btn"
                            title="Devolver ao fornecedor (NF-e de devolução)"
                            onClick={() => setDevolucaoNotaId(nota.id)}
                          >
                            <RotateCcw size={16} />
                          </button>
                        )}
                        {nota.status === 'ativa' && !nota.transferenciaId && (
                          <button
                            className="icon-btn"
                            title="Excluir (reverte estoque e títulos)"
                            style={{ color: '#ef4444' }}
                            disabled={excluindoId === nota.id}
                            onClick={() => handleExcluirNota(nota)}
                          >
                            {excluindoId === nota.id ? <Loader2 size={16} className="spin-icon" /> : <Trash2 size={16} />}
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

      {danfe && <PdfVisualizador titulo="DANFE" nomeArquivo={danfe.nome} pdf={danfe.blob} onFechar={() => setDanfe(null)} />}

      {notaSelecionada && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '24px' }} onClick={handleFecharDetalhes}>
          <div className="card" style={{ width: '100%', maxWidth: '720px', maxHeight: '85vh', overflowY: 'auto', padding: '28px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <FileText size={22} color="var(--accent-purple)" />
                <div>
                  <h2 style={{ margin: 0, fontSize: '18px' }}>{rotuloDoDocumento(notaSelecionada)} {notaSelecionada.numeroNF}</h2>
                  <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>{notaSelecionada.fornecedorNome}</p>
                </div>
              </div>
              <button className="icon-btn" onClick={handleFecharDetalhes} title="Fechar">
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px', marginBottom: '24px', padding: '16px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block' }}>Data de Emissão</label>
                <strong style={{ fontSize: '14px' }}>{formatDateInputPtBr(notaSelecionada.dataEmissao)}</strong>
              </div>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block' }}>Valor Total</label>
                <strong style={{ fontSize: '14px' }}>{currency(notaSelecionada.valorTotal)}</strong>
              </div>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block' }}>Status</label>
                <strong style={{ fontSize: '14px', color: STATUS_COLOR[notaSelecionada.status] }}>{STATUS_LABEL[notaSelecionada.status]}</strong>
              </div>
            </div>

            {(notaSelecionada.chaveAcesso || notaSelecionada.serie || notaSelecionada.naturezaOperacao || notaSelecionada.dataEntrada || notaSelecionada.observacao || notaSelecionada.pagamento) && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '20px', fontSize: '12.5px' }}>
                {notaSelecionada.serie && <div><span style={{ color: 'var(--text-muted)' }}>Série / Modelo:</span> <strong>{notaSelecionada.serie} / {notaSelecionada.modelo || '—'}</strong></div>}
                {notaSelecionada.naturezaOperacao && <div><span style={{ color: 'var(--text-muted)' }}>Natureza:</span> <strong>{notaSelecionada.naturezaOperacao}</strong></div>}
                {notaSelecionada.dataEntrada && <div><span style={{ color: 'var(--text-muted)' }}>{notaSelecionada.tipoDocumento === 'nfse' ? 'Lançada em:' : 'Entrada da mercadoria:'}</span> <strong>{formatDateInputPtBr(notaSelecionada.dataEntrada)}</strong></div>}
                {notaSelecionada.pagamento?.modo && <div><span style={{ color: 'var(--text-muted)' }}>Pagamento:</span> <strong>{notaSelecionada.pagamento.modo === 'avista' ? 'À vista' : 'A prazo'}{notaSelecionada.pagamento.forma ? ` · ${notaSelecionada.pagamento.forma}` : ''}</strong></div>}
                {notaSelecionada.observacao && <div style={{ gridColumn: '1 / -1' }}><span style={{ color: 'var(--text-muted)' }}>Observação:</span> {notaSelecionada.observacao}</div>}
                {notaSelecionada.chaveAcesso && <div style={{ gridColumn: '1 / -1', fontFamily: 'monospace', wordBreak: 'break-all' }}><span style={{ color: 'var(--text-muted)', fontFamily: 'inherit' }}>Chave:</span> {formatarChave(notaSelecionada.chaveAcesso)}</div>}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '20px' }}>
              {notaSelecionada.tipoDocumento !== 'nfse' && (
                <button type="button" className="btn-secondary" disabled={!notaSelecionada.xmlGzipBase64 || preparandoXml} onClick={() => void handleImprimirDanfe(notaSelecionada)} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
                  {preparandoXml ? <Loader2 size={15} className="spin-icon" /> : <Printer size={15} />} Imprimir DANFE
                </button>
              )}
              <button type="button" className="btn-secondary" disabled={!notaSelecionada.xmlGzipBase64 || preparandoXml} onClick={() => void handleBaixarXml(notaSelecionada)} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
                <FileDown size={15} /> Baixar XML
              </button>
              {!notaSelecionada.xmlGzipBase64 && (
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', alignSelf: 'center' }}>
                  {notaSelecionada.tipoDocumento === 'nfse'
                    ? 'NFS-e digitada, sem o arquivo XML.'
                    : 'Esta nota foi lançada antes de o sistema guardar o XML: DANFE e XML só estão nas notas novas.'}
                </span>
              )}
            </div>

            {notaSelecionada.status === 'excluida' && notaSelecionada.motivoExclusao && (
              <div style={{ padding: '12px 16px', backgroundColor: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: 'var(--radius-md)', marginBottom: '24px', fontSize: '13px', color: '#ef4444' }}>
                <strong>Motivo da exclusão:</strong> {notaSelecionada.motivoExclusao}
              </div>
            )}

            {notaSelecionada.tipoDocumento === 'nfse' && notaSelecionada.servico && (() => {
              const s = notaSelecionada.servico;
              const r = s.retencoes || {};
              const retencoes = [['IR', r.irrf], ['PIS', r.pis], ['COFINS', r.cofins], ['CSLL', r.csll], ['INSS', r.inss], ['Outras', r.outras]]
                .filter(([, v]) => Number(v) > 0) as Array<[string, number]>;
              return (
                <div style={{ marginBottom: '24px', padding: '16px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', fontSize: '13px', display: 'grid', gap: '8px' }}>
                  {s.descricao && <div><span style={{ color: 'var(--text-muted)' }}>Serviço:</span> {s.descricao}</div>}
                  <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                    {s.codigoServico && <span><span style={{ color: 'var(--text-muted)' }}>Código:</span> <strong>{s.codigoServico}</strong></span>}
                    {s.competencia && <span><span style={{ color: 'var(--text-muted)' }}>Competência:</span> <strong>{formatDateInputPtBr(s.competencia).slice(3)}</strong></span>}
                    {s.codigoVerificacao && <span><span style={{ color: 'var(--text-muted)' }}>Verificação:</span> <strong>{s.codigoVerificacao}</strong></span>}
                    <span><span style={{ color: 'var(--text-muted)' }}>ISS:</span> <strong>{currency(Number(s.valorIss || 0))}{s.issRetido ? ' (retido)' : ''}</strong></span>
                  </div>
                  {retencoes.length > 0 && (
                    <div><span style={{ color: 'var(--text-muted)' }}>Retenções:</span> {retencoes.map(([nome, v]) => `${nome} ${currency(v)}`).join(' · ')}</div>
                  )}
                  <div><span style={{ color: 'var(--text-muted)' }}>Líquido pago ao prestador:</span> <strong>{currency(Number(s.valorLiquido || 0))}</strong></div>
                </div>
              );
            })()}

            {notaSelecionada.tipoDocumento !== 'nfse' && (<>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <Package size={16} color="var(--accent-purple)" />
              <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>Itens ({notaSelecionada.itens.length})</h3>
            </div>
            <div className="table-wrapper" style={{ marginBottom: '24px' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Descrição</th>
                    <th>Tipo</th>
                    <th style={{ textAlign: 'center' }}>Qtd. nota</th>
                    <th style={{ textAlign: 'center' }}>Entrou no estoque</th>
                    <th style={{ textAlign: 'right' }}>Vlr. Unit.</th>
                    <th style={{ textAlign: 'right' }}>Custo real (un. estoque)</th>
                    <th style={{ textAlign: 'center' }}>Cadastro</th>
                  </tr>
                </thead>
                <tbody>
                  {notaSelecionada.itens.map((item, idx) => (
                    <tr key={idx}>
                      <td>{item.descricaoXml}</td>
                      <td>
                        {TIPO_ITEM_LABEL[item.tipo] ?? item.tipo}
                        {item.cfopEntrada && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>CFOP {item.cfopEntrada.replace(/^(\d)(\d{3})$/, '$1.$2')}</div>}
                      </td>
                      <td style={{ textAlign: 'center' }}>{item.quantidade}{item.unidadeNota ? ` ${item.unidadeNota}` : ''}</td>
                      <td style={{ textAlign: 'center' }}>{item.tipo === 'registro' ? '—' : (item.quantidadeEstoque ?? item.quantidade)}</td>
                      <td style={{ textAlign: 'right' }}>{currency(item.valorUnitario)}</td>
                      <td style={{ textAlign: 'right' }}>{item.custoUnitarioEstoque !== undefined ? currency(item.custoUnitarioEstoque) : '—'}</td>
                      {item.tipo === 'registro' ? (
                        <td style={{ textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }} title="O CFOP de entrada deste item não movimenta estoque: ficou só registrado na nota.">Não entra no estoque</td>
                      ) : (
                        <td style={{ textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }} title={item.novo ? 'Foi criado um cadastro novo para este item.' : 'A quantidade foi somada a um cadastro que já existia.'}>{item.novo ? 'Cadastro novo' : 'Somado a cadastro existente'}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>)}

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <FileText size={16} color="var(--accent-purple)" />
              <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>Títulos em Contas a Pagar ({notaSelecionada.titulosPagarIds.length})</h3>
            </div>
            {carregandoTitulos ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '13px' }}>
                <Loader2 size={16} className="spin-icon" /> Carregando títulos...
              </div>
            ) : titulos.length === 0 ? (
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Nenhum título encontrado.</p>
            ) : (
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Vencimento</th>
                      <th style={{ textAlign: 'right' }}>Valor</th>
                      <th style={{ textAlign: 'center' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {titulos.map((titulo) => (
                      <tr key={titulo.id}>
                        <td>{formatDateInputPtBr(titulo.data)}</td>
                        <td style={{ textAlign: 'right' }}>{currency(titulo.valor)}</td>
                        <td style={{ textAlign: 'center' }}>{titulo.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {notaSelecionada.status === 'ativa' && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px' }}>
                <button
                  className="btn-secondary"
                  style={{ color: '#ef4444', borderColor: '#ef444450', display: 'flex', alignItems: 'center', gap: '8px' }}
                  disabled={excluindoId === notaSelecionada.id}
                  onClick={() => handleExcluirNota(notaSelecionada)}
                >
                  {excluindoId === notaSelecionada.id ? <Loader2 size={16} className="spin-icon" /> : <Trash2 size={16} />}
                  Excluir Nota de Entrada
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <DevolucaoCompraModal
        aberto={Boolean(devolucaoNotaId)}
        nota={notas.find((n) => n.id === devolucaoNotaId) || null}
        podeEmitir={podeEmitirNota}
        onFechar={() => setDevolucaoNotaId(null)}
        // A lista e' ao vivo: a nota chega com o novo "devolvido" sozinha.
        onRegistrada={() => undefined}
      />
    </div>
  );
};

export default NotasFiscaisEntradaList;
