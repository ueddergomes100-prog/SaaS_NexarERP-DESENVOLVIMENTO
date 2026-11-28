import React, { useEffect, useMemo, useRef, useState } from 'react';
import ConferenciaRetornoModal from '../../components/finance/ConferenciaRetornoModal';
import { montarConferenciaDoRetorno, type ConferenciaDoRetorno } from '../../utils/conferenciaRetornoDomain';
import { collection, deleteField, doc, getDoc, getDocs, onSnapshot, query, runTransaction, serverTimestamp, where } from 'firebase/firestore';
import { assinarComReserva } from '../../services/consultaComReserva';
import { Barcode, Download, FileUp, FolderOpen, Link2, Loader2, Printer, Receipt, Search, Undo2 } from 'lucide-react';
import { db } from '../../services/firebase';
import { baixarBoletoPeloRetorno, receberBoletoCanceladoPeloRetorno, vincularBoletosDoSistemaAnterior, type ResultadoVinculoBoletosAnteriores } from '../../services/baixaFinanceiraService';
import MenuMaisOpcoes from '../../components/common/MenuMaisOpcoes';
import { AVISO_SEGUNDA_VIA_SISTEMA_ANTERIOR, LIMITE_DE_BOLETOS_POR_ENVIO, lerPlanilhaBoletosAnteriores } from '../../utils/boletoSistemaAnteriorDomain';
import { useAuth } from '../../contexts/AuthContext';
import { escaparHtml, showError, showSuccess, showWarning, NexusSwal } from '../../utils/alerts';
import { hasModuleAccess } from '../../utils/roles';
import { buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { createAuditLog } from '../../services/logService';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import { fromCents, type BoletoDetails } from '../../utils/financeDomain';
import { reserveTenantSequence } from '../../utils/firestoreAtomic';
import { formatarNossoNumeroSicoobExibicao, parcelaDoBoletoSicoob } from '../../utils/boletoCnabDomain';
import { formatarLinhaDigitavel } from '../../utils/boletoDomain';
import { gerarPdfBoletos, type DadosPdfBoleto } from '../../utils/boletoPdf';
import PdfVisualizador from '../../components/common/PdfVisualizador';
import {
  cadastroDoPagador,
  dadosPdfDoBoleto as dadosPdfDoBoletoComum,
  emitirUmTitulo as emitirUmTituloComum,
  gerarPdfDoBoleto as gerarPdfDoBoletoComum,
  nomePdfBoleto,
  numeroDaNotaDoPedido,
  paraTituloBoleto,
  recalcularBoleto as recalcularBoletoComum,
  validarTituloParaEmissao as validarTituloParaEmissaoComum,
  type BancoBoleto,
  type TituloBoleto,
} from '../../services/boletoEmissaoService';
import { faltandoNoPagador, pagadorDoCadastro } from '../../utils/cobrancaEmBoletoDomain';
import {
  contarFiltrosExtras,
  documentoDoBoleto,
  lerArquivoRetornoSicoob,
  faturadoNoPeriodo,
  FILTROS_EXTRAS_VAZIOS,
  ROTULO_PERIODO_FATURAMENTO,
  ROTULO_PERIODO_VENCIMENTO,
  ROTULO_STATUS_BOLETO,
  statusBoletoEfetivo,
  tituloPassaNosFiltrosExtras,
  type FiltrosExtrasBoleto,
  type PeriodoFaturamento,
  type PeriodoVencimento,
  type StatusBoletoEfetivo,
  detalheDoRecebimentoBoleto,
  type DetalheRetornoBoleto,
} from '../../utils/boletoEmissaoDomain';
import { montarRemessaSicoob, nomeArquivoRemessaSicoob, type TituloRemessaSicoob } from '../../utils/boletoRemessaSicoobDomain';
import { compararPorNumero, useOrdemNumero } from '../../hooks/useOrdemNumero';
import '../OS/OS.css';
import { useLinhasEmBlocos } from '../../hooks/useLinhasEmBlocos';
import MostrarMaisLinhas from '../../components/common/MostrarMaisLinhas';
import {
  AJUDA_NAO_ENCONTRADOS,
  gravidadeDoRetorno,
  movimentacaoPorDia,
  tituloDoRetorno,
  type BaixaDoRetorno,
  type ResumoDoRetorno,
} from '../../utils/movimentacaoBoletosDomain';
import { retornosNovos } from '../../utils/pastasDoBoletoDomain';
import {
  arquivosDaPasta,
  gravarNaPasta,
  lerPasta,
  liberarPasta,
  marcarRetornosVistos,
  permissaoDaPasta,
  retornosJaVistos,
} from '../../utils/pastasDoBoletoStorage';
import PastasDosBoletosModal from '../../components/finance/PastasDosBoletosModal';

/**
 * FINANCEIRO > BOLETOS (2026-09-22).
 *
 * Emissao, arquivo de remessa e leitura do retorno dos boletos Sicoob.
 * O calculo esta todo em boletoDomain/boletoCnabDomain/boletoRemessaSicoob
 * (puro e testado); aqui e' so' tela + escrita no Firestore.
 *
 * O titulo E' a transacao de contas a receber -- boleto nao e' colecao
 * nova, e' um campo `boleto` dentro do proprio titulo, do mesmo jeito que
 * cheque e cartao ja funcionam.
 */

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

type Aba = 'aguardando' | 'emitidos' | 'remessa' | 'pagos' | 'vencidos';

const ROTULO_ABA: Record<Aba, string> = {
  aguardando: 'Aguardando emissão',
  emitidos: 'Emitidos',
  remessa: 'Em remessa',
  pagos: 'Pagos',
  vencidos: 'Vencidos',
};

/**
 * Boleto RECEBIDO (28/11/2026, pedido do dono): o que entrou de fato, com o
 * caminho da conta -- valor do boleto, + juros e multa, - desconto, pago pelo
 * cliente, - tarifa do banco = liquido. Regra em detalheDoRecebimentoBoleto.
 */
const CelulaRecebidoDoBoleto: React.FC<{ titulo: TituloBoleto }> = ({ titulo }) => {
  const d = detalheDoRecebimentoBoleto(titulo);
  const linha = (texto: string, cor?: string) => (
    <div style={{ fontSize: '11.5px', fontWeight: 500, color: cor || 'var(--text-muted)', whiteSpace: 'nowrap' }}>{texto}</div>
  );
  const reais = (c: number) => currency.format(fromCents(c));
  return (
    <td style={{ padding: '14px 16px', textAlign: 'right' }}>
      <div style={{ fontWeight: 800, fontSize: '15px' }}>{reais(d.liquido)}</div>
      {linha(`boleto ${reais(d.valorBoleto)}`)}
      {d.jurosMulta > 0 && linha(`+ ${reais(d.jurosMulta)} juros e multa`, '#059669')}
      {d.desconto > 0 && linha(`− ${reais(d.desconto)} desconto`, '#b45309')}
      {(d.jurosMulta > 0 || d.desconto > 0 || d.tarifa > 0) && linha(`pago pelo cliente ${reais(d.pago)}`)}
      {d.tarifa > 0 && linha(`− ${reais(d.tarifa)} tarifa do banco`, '#b91c1c')}
    </td>
  );
};

const Boletos: React.FC = () => {
  const { tenantId, currentUser, userRole, isOwner, userPermissions } = useAuth();
  const podeAcessar = hasModuleAccess({
    role: userRole,
    isOwner,
    permissions: userPermissions,
    requiredPermission: 'financeiro.boletos',
  });

  const [titulos, setTitulos] = useState<TituloBoleto[]>([]);
  const [bancos, setBancos] = useState<BancoBoleto[]>([]);
  const [loading, setLoading] = useState(true);
  const [aba, setAba] = useState<Aba>('aguardando');
  const [ordemNumero, inverterOrdemNumero] = useOrdemNumero('boletos.ordemNumero');
  const [busca, setBusca] = useState('');
  const [periodoFaturamento, setPeriodoFaturamento] = useState<PeriodoFaturamento>('todos');
  const [faturadoDe, setFaturadoDe] = useState('');
  const [faturadoAte, setFaturadoAte] = useState('');
  // Vencimento, emissao do boleto, banco e valor (23/10/2026): painel "Mais filtros".
  const [filtrosExtras, setFiltrosExtras] = useState<FiltrosExtrasBoleto>(FILTROS_EXTRAS_VAZIOS);
  const [maisFiltrosAberto, setMaisFiltrosAberto] = useState(false);
  const mudarFiltro = (mudanca: Partial<FiltrosExtrasBoleto>) => {
    setFiltrosExtras((atual) => ({ ...atual, ...mudanca }));
    setSelecionados(new Set());
  };
  const filtrosExtrasAtivos = contarFiltrosExtras(filtrosExtras);
  const [processando, setProcessando] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const inputRetornoRef = useRef<HTMLInputElement>(null);
  const inputSistemaAnteriorRef = useRef<HTMLInputElement>(null);
  const [pdfBoleto, setPdfBoleto] = useState<{ blob: Blob; nome: string } | null>(null);

  // Leitura enxuta (otimizacao de leituras, 2026-10-14). Antes: TODOS os
  // boletos da empresa desde sempre. Agora: os em aberto de qualquer data
  // (abas Aguardando, Emitidos, Em remessa, Vencidos) + os PAGOS no mes atual
  // (decisao do dono), ou de todo o periodo quando a pessoa pede na aba Pagos.
  // O retorno do banco procura no banco o boleto que nao estiver na tela.
  const [pagosDeTodoPeriodo, setPagosDeTodoPeriodo] = useState(false);
  const inicioDoMes = `${getDateInputInTimeZone().slice(0, 7)}-01`;
  useEffect(() => {
    if (!tenantId || !podeAcessar) { setLoading(false); return undefined; }
    setLoading(true);
    const boletosDaEmpresa = query(
      collection(db, 'transacoes'),
      where('tenantId', '==', tenantId),
      where('formaPagamento', '==', 'Boleto'),
      // Sem isto, despesa lancada em Contas a Pagar com forma "Boleto" (o boleto que UM FORNECEDOR
      // mandou pra gente pagar) entrava aqui como se fosse algo que a empresa precisasse EMITIR --
      // nao faz sentido, so' emitimos boleto pra cobrar cliente (tipo 'entrada'). O boleto do
      // fornecedor e' so' um dado informativo da despesa; ele e' pago, nunca emitido por aqui.
      where('tipo', '==', 'entrada'),
    );
    let abertos: TituloBoleto[] = [];
    let pagos: TituloBoleto[] = [];
    let chegaram = 0;
    const publicar = () => {
      const porId = new Map<string, TituloBoleto>();
      [...pagos, ...abertos].forEach((titulo) => porId.set(titulo.id, titulo));
      setTitulos(Array.from(porId.values()));
      if (chegaram >= 2) setLoading(false);
    };
    const falhar = (erro: unknown) => {
      console.error('Erro ao carregar boletos:', erro);
      showError('Erro', 'Não foi possível carregar os boletos. Confira sua conexão e suas permissões.');
      setLoading(false);
    };
    const pararAbertos = onSnapshot(query(boletosDaEmpresa, where('status', '==', 'Pendente')), (snap) => {
      abertos = snap.docs.map((d) => paraTituloBoleto(d.id, d.data()));
      chegaram += 1;
      publicar();
    }, falhar);
    const todosPagos = query(boletosDaEmpresa, where('status', '==', 'Paga'));
    const pagosEnxuta = pagosDeTodoPeriodo ? todosPagos : query(todosPagos, where('dataPagamento', '>=', inicioDoMes));
    const pararPagos = assinarComReserva(pagosEnxuta, todosPagos, 'Boletos (pagos do mês)', (snap) => {
      // Mesmo filtro da consulta enxuta, para a reserva (sem indice) mostrar o mesmo.
      pagos = snap.docs
        .filter((d) => pagosDeTodoPeriodo || String(d.data().dataPagamento || '') >= inicioDoMes)
        .map((d) => paraTituloBoleto(d.id, d.data()));
      chegaram += 1;
      publicar();
    }, falhar);
    return () => {
      pararAbertos();
      pararPagos();
    };
  }, [tenantId, podeAcessar, pagosDeTodoPeriodo, inicioDoMes]);

  useEffect(() => {
    if (!tenantId || !podeAcessar) return undefined;
    const q = query(collection(db, 'bancos'), where('tenantId', '==', tenantId), where('ativo', '==', true));
    const unsubscribe = onSnapshot(q, (snap) => {
      setBancos(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as BancoBoleto[]);
    });
    return () => unsubscribe();
  }, [tenantId, podeAcessar]);

  const bancosComBoleto = useMemo(() => bancos.filter((b) => b.boleto?.ativo), [bancos]);

  const porAba = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const filtraBusca = (t: TituloBoleto) => !termo
      || (t.clienteNome || t.fornecedorNome || '').toLowerCase().includes(termo)
      || (t.descricao || '').toLowerCase().includes(termo)
      || (t.boleto?.nossoNumero || '').includes(termo);

    const visiveis = titulos
      .filter((t) => t.status !== 'Cancelada')
      .filter(filtraBusca)
      .filter((t) => faturadoNoPeriodo(t.faturadoEm, periodoFaturamento, { de: faturadoDe, ate: faturadoAte }))
      .filter((t) => tituloPassaNosFiltrosExtras(t, filtrosExtras));
    const efetivo = (t: TituloBoleto): StatusBoletoEfetivo | 'aguardando' => (
      t.boleto ? statusBoletoEfetivo(t.boleto) : 'aguardando'
    );

    return {
      // So' titulo EM ABERTO aguarda emissao (25/11/2026): juros/multa ou desconto
      // lancados pela baixa (pagos, forma Boleto, sem boleto proprio) nao sao boleto a emitir.
      aguardando: visiveis.filter((t) => !t.boleto && t.status === 'Pendente'),
      emitidos: visiveis.filter((t) => efetivo(t) === 'emitido'),
      remessa: visiveis.filter((t) => efetivo(t) === 'em_remessa'),
      pagos: visiveis.filter((t) => efetivo(t) === 'pago'),
      vencidos: visiveis.filter((t) => efetivo(t) === 'vencido'),
    } as Record<Aba, TituloBoleto[]>;
  }, [titulos, busca, periodoFaturamento, faturadoDe, faturadoAte, filtrosExtras]);

  // Ordem pelo NOSSO NUMERO (a numeracao do boleto), crescente por padrao -- pedido do
  // dono (2026-09-30). Titulo ainda sem boleto (aba Aguardando): pelo numero da venda
  // ("Venda Direta #0064"), e o vencimento desempata as parcelas da mesma venda.
  const numeroDaVenda = (t: TituloBoleto) => (String(t.descricao || '').match(/#\s*(\d+)/) || [])[1] || '';
  const listaAtual = [...porAba[aba]].sort((a, b) => {
    const porNumero = a.boleto?.nossoNumero && b.boleto?.nossoNumero
      ? compararPorNumero(a.boleto.nossoNumero, b.boleto.nossoNumero, ordemNumero)
      : compararPorNumero(numeroDaVenda(a), numeroDaVenda(b), ordemNumero);
    return porNumero || String(a.dataVencimento || '').localeCompare(String(b.dataVencimento || ''));
  });
  // Velocidade (24/11/2026): a tabela desenha em blocos; totais, selecao e relatorio seguem na lista inteira.
  const blocos = useLinhasEmBlocos(listaAtual);

  // --- Emissao --------------------------------------------------------

  /** Confere convenio e vencimento (services/boletoEmissaoService). */
  const validarTituloParaEmissao = (titulo: TituloBoleto): BancoBoleto => validarTituloParaEmissaoComum(titulo, bancosComBoleto);

  /** Reserva o nosso numero e grava o boleto (services/boletoEmissaoService). */
  const emitirUmTitulo = async (titulo: TituloBoleto, banco: BancoBoleto): Promise<BoletoDetails> => {
    if (!tenantId || !currentUser) throw new Error('Sessão sem empresa identificada. Atualize a página.');
    return emitirUmTituloComum({ tenantId, uid: currentUser.uid, titulo, banco });
  };

  const emitirBoleto = async (titulo: TituloBoleto) => {
    if (!tenantId || !currentUser) return;
    let banco: BancoBoleto;
    try {
      banco = validarTituloParaEmissao(titulo);
    } catch (erro: any) {
      showError('Não foi possível emitir', erro?.message || 'Tente novamente.');
      return;
    }
    const vencimento = titulo.dataVencimento || titulo.dataPrevistaRecebimento!;

    const confirmacao = await NexusSwal.fire({
      title: 'Emitir boleto?',
      html: `<div style="text-align:left;font-size:14px">`
        + `<b>Cliente:</b> ${(titulo.clienteNome || titulo.fornecedorNome || 'Sem cliente').replace(/[<>&]/g, '')}<br/>`
        + `<b>Valor:</b> ${currency.format(fromCents(titulo.valorCentavos))}<br/>`
        + `<b>Vencimento:</b> ${vencimento.split('-').reverse().join('/')}<br/>`
        + `<b>Banco:</b> ${banco.nome.replace(/[<>&]/g, '')}`
        + `</div>`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Emitir',
      cancelButtonText: 'Cancelar',
    });
    if (!confirmacao.isConfirmed) return;

    setProcessando(true);
    try {
      const gerado = await emitirUmTitulo(titulo, banco);
      try {
        const pdf = await gerarPdfDoBoleto({ ...titulo, boleto: gerado, bancoId: banco.id, bancoNome: banco.nome });
        setPdfBoleto(pdf);
        showSuccess('Boleto emitido com sucesso.');
      } catch (erroPdf: any) {
        console.error('Erro ao gerar o PDF do boleto recem-emitido:', erroPdf);
        await NexusSwal.fire({
          title: 'Boleto emitido — PDF não pôde ser gerado agora',
          html: `<div style="text-align:left;font-size:14px">`
            + `<b>Nosso número:</b> ${formatarNossoNumeroSicoobExibicao(gerado?.nossoNumero || '')}<br/><br/>`
            + `<b>Linha digitável:</b><br/><span style="font-family:monospace">${formatarLinhaDigitavel(gerado?.linhaDigitavel || '')}</span><br/><br/>`
            + `${String(erroPdf?.message || 'Tente novamente pelo botão Imprimir.').replace(/[<>&]/g, '')}`
            + `</div>`,
          icon: 'warning',
        });
      }
    } catch (erro: any) {
      console.error('Erro ao emitir boleto:', erro);
      showError('Não foi possível emitir', erro?.message || 'Tente novamente em instantes.');
    } finally {
      setProcessando(false);
    }
  };

  /** Emite todos os titulos marcados na aba "Aguardando emissao", um de cada vez (a reserva do nosso
   *  numero e' atomica por banco, nao da' pra paralelizar). Sem popup de PDF por titulo -- o resumo no
   *  final diz quantos saíram, e cada um pode ser impresso depois pela lista de Emitidos. */
  const emitirSelecionados = async () => {
    if (!tenantId || !currentUser) return;
    const lista = porAba.aguardando.filter((t) => selecionados.has(t.id));
    if (lista.length === 0) {
      showError('Nada selecionado', 'Marque pelo menos um título de "Aguardando emissão" antes.');
      return;
    }

    const confirmacao = await NexusSwal.fire({
      title: `Emitir ${lista.length} boleto(s)?`,
      html: `<div style="text-align:left;font-size:14px">`
        + `<b>Quantidade:</b> ${lista.length}<br/>`
        + `<b>Total:</b> ${currency.format(fromCents(lista.reduce((soma, t) => soma + t.valorCentavos, 0)))}`
        + `</div>`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Emitir todos',
      cancelButtonText: 'Cancelar',
    });
    if (!confirmacao.isConfirmed) return;

    setProcessando(true);
    let emitidos = 0;
    const falhas: string[] = [];
    try {
      for (const titulo of lista) {
        try {
          const banco = validarTituloParaEmissao(titulo);
          await emitirUmTitulo(titulo, banco);
          emitidos += 1;
        } catch (erro: any) {
          falhas.push(`${titulo.clienteNome || titulo.fornecedorNome || titulo.descricao || titulo.id}: ${erro?.message || 'erro desconhecido'}`);
        }
      }
      setSelecionados(new Set());
      if (falhas.length === 0) {
        showSuccess(`${emitidos} boleto(s) emitido(s). Abra "Emitidos" pra ver, imprimir ou gerar a remessa.`);
      } else {
        await NexusSwal.fire({
          title: `${emitidos} de ${lista.length} boleto(s) emitidos`,
          html: `<div style="text-align:left;font-size:14px">Não deu pra emitir:<br/>${falhas.map((f) => f.replace(/[<>&]/g, '')).join('<br/>')}</div>`,
          icon: emitidos > 0 ? 'warning' : 'error',
        });
      }
    } finally {
      setProcessando(false);
    }
  };

  /**
   * "Desfazer" de um boleto ainda nao pago, por linha ou para os marcados. Dois destinos:
   *  - 'aguardando': apaga a emissao (nosso numero, linha digitavel, codigo de barras) -- por exemplo
   *    um boleto emitido de teste, ou antes de uma correcao no calculo. O titulo volta para "Aguardando
   *    emissao" e, emitido de novo, sai com OUTRO nosso numero (o contador nunca anda pra tras).
   *  - 'emitidos': so' tira da remessa (status volta a 'emitido', numeroRemessa 0, como na emissao).
   *    Nosso numero e codigo de barras ficam os mesmos: o boleto que o cliente ja tem continua valendo
   *    e entra na proxima remessa. So' vale para quem esta em remessa.
   * Nao mexe em nada do lado do banco: so' no que ficou gravado aqui.
   */
  type DestinoDesfazer = 'aguardando' | 'emitidos';

  const desfazerUm = async (titulo: TituloBoleto, destino: DestinoDesfazer, uid: string): Promise<boolean> => {
    let feito = false;
    let remessaAnterior = '';
    let nossoNumeroAnterior = '';
    await runTransaction(db, async (transaction) => {
      const ref = doc(db, 'transacoes', titulo.id);
      const snap = await transaction.get(ref);
      if (!snap.exists()) throw new Error('Título não encontrado. Atualize a página.');
      if (snap.data().status === 'Paga') throw new Error('Este título já foi pago — não é possível desfazer a emissão.');
      remessaAnterior = String(snap.data().boleto?.numeroRemessa || '');
      nossoNumeroAnterior = String(snap.data().boleto?.nossoNumero || '');
      if (destino === 'emitidos') {
        // Fora da remessa ja': nada a fazer (num lote misto, os "Emitido" ficam como estao).
        if (snap.data().boleto?.status !== 'em_remessa') return;
        if (snap.data().boleto?.sistemaAnterior) {
          throw new Error('Este boleto foi emitido pelo sistema anterior e já está registrado no banco: não entra numa remessa nova. Para desligar o vínculo, use "Voltar para Aguardando emissão".');
        }
        transaction.update(ref, {
          'boleto.status': 'emitido',
          'boleto.numeroRemessa': 0,
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(uid, serverTimestamp(), `Boleto tirado da remessa ${snap.data().boleto?.numeroRemessa || ''}`.trim()),
        });
      } else {
        transaction.update(ref, {
          boleto: deleteField(),
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(uid, serverTimestamp(), 'Emissão de boleto desfeita'),
        });
      }
      feito = true;
    });
    // Historico de alteracoes (09/11/2026): depois da transacao dar certo.
    if (feito && tenantId) {
      const nossoNumero = formatarNossoNumeroSicoobExibicao(nossoNumeroAnterior || titulo.boleto?.nossoNumero || '');
      const pagador = titulo.clienteNome || titulo.fornecedorNome || '';
      const tituloDoBoleto = `"${titulo.descricao}"${pagador ? ` (${pagador})` : ''}`;
      createAuditLog({
        tenantId,
        usuarioId: uid,
        usuarioEmail: currentUser?.email || uid,
        modulo: 'financeiro',
        acao: destino === 'emitidos' ? 'edicao' : 'cancelamento',
        descricao: destino === 'emitidos'
          ? `Boleto nosso número ${nossoNumero} de ${tituloDoBoleto} tirado da remessa ${remessaAnterior || ''}`.trim()
            + '. Voltou para Emitidos com o mesmo código de barras e entra na próxima remessa.'
          : `Emissão do boleto nosso número ${nossoNumero} de ${tituloDoBoleto} desfeita. O título voltou para Aguardando emissão; emitido de novo, sai com outro nosso número.`,
        registroRelacionadoId: titulo.id,
        documentosRelacionados: [titulo.pedidoId, titulo.osId],
        documentoTipo: 'conta_receber',
        documentoNumero: `Boleto ${nossoNumero}`,
        alteracoes: destino === 'emitidos'
          ? [{ campo: 'Boleto', valorAnterior: `Em remessa${remessaAnterior ? ` ${remessaAnterior}` : ''}`, valorNovo: 'Emitido' }]
          : [{ campo: 'Boleto', valorAnterior: `Emitido (nosso número ${nossoNumero})`, valorNovo: 'Aguardando emissão' }],
        status: 'sucesso',
        critical: true,
      });
    }
    return feito;
  };

  /** Pergunta para onde volta; quem esta em remessa pode voltar para Emitidos sem trocar o codigo de barras. */
  const perguntarDestino = async (lista: TituloBoleto[]): Promise<DestinoDesfazer | null> => {
    const umSo = lista.length === 1;
    const emRemessa = lista.filter((t) => t.boleto?.status === 'em_remessa').length;
    const titulo = umSo ? 'Desfazer este boleto?' : `Desfazer ${lista.length} boletos?`;
    if (emRemessa === 0) {
      const r = await NexusSwal.fire({
        title: titulo,
        html: `<div style="text-align:left;font-size:14px">`
          + `Remove o nosso número, a linha digitável e o código de barras gravados ${umSo ? 'neste título' : 'nos títulos marcados'}. `
          + `${umSo ? 'Ele volta' : 'Eles voltam'} para "Aguardando emissão" e ${umSo ? 'pode ser emitido' : 'podem ser emitidos'} de novo, com outro código. `
          + `Isso não desfaz nada que já tenha sido enviado ao banco.`
          + `</div>`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Voltar para Aguardando emissão',
        cancelButtonText: 'Cancelar',
      });
      return r.isConfirmed ? 'aguardando' : null;
    }
    const foraDaRemessa = lista.length - emRemessa;
    const r = await NexusSwal.fire({
      title: titulo,
      html: `<div style="text-align:left;font-size:14px">`
        + `<b>Voltar para Emitidos:</b> tira da remessa e mantém o mesmo nosso número, linha digitável e código de barras. `
        + `O boleto que o cliente já tem continua valendo; ${umSo ? 'ele entra' : 'eles entram'} na próxima remessa que você gerar.`
        + (foraDaRemessa > 0 ? ` (${foraDaRemessa} dos marcados não ${foraDaRemessa === 1 ? 'está' : 'estão'} em remessa e ${foraDaRemessa === 1 ? 'fica' : 'ficam'} como ${foraDaRemessa === 1 ? 'está' : 'estão'}.)` : '')
        + `<br/><br/><b>Voltar para Aguardando emissão:</b> apaga o nosso número e o código de barras; emitido de novo, sai com outro código.`
        + `<br/><br/>Nenhuma das duas desfaz o que já foi enviado ao banco.`
        + `</div>`,
      icon: 'question',
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: 'Voltar para Emitidos',
      denyButtonText: 'Voltar para Aguardando emissão',
      cancelButtonText: 'Cancelar',
    });
    if (r.isConfirmed) return 'emitidos';
    if (r.isDenied) return 'aguardando';
    return null;
  };

  const desfazer = async (lista: TituloBoleto[]) => {
    if (!currentUser) return;
    if (lista.length === 0) {
      showError('Nada marcado', 'Marque os boletos que quer desfazer. Boleto já pago não pode ser desfeito.');
      return;
    }
    const destino = await perguntarDestino(lista);
    if (!destino) return;

    setProcessando(true);
    let feitos = 0;
    const falhas: string[] = [];
    try {
      for (const titulo of lista) {
        try {
          if (await desfazerUm(titulo, destino, currentUser.uid)) feitos += 1;
        } catch (erro: any) {
          console.error('Erro ao desfazer o boleto:', erro);
          const nome = titulo.clienteNome || titulo.fornecedorNome || 'Título';
          falhas.push(`${nome} (nosso número ${formatarNossoNumeroSicoobExibicao(titulo.boleto?.nossoNumero || '')}): ${erro?.message || 'tente novamente em instantes.'}`);
        }
      }
      setSelecionados(new Set());
      const paraOnde = destino === 'emitidos' ? '"Emitidos", com o mesmo código de barras' : '"Aguardando emissão"';
      if (falhas.length === 0) {
        showSuccess(feitos === 1 ? `O boleto voltou para ${paraOnde}.` : `${feitos} boletos voltaram para ${paraOnde}.`);
      } else {
        await NexusSwal.fire({
          title: `${feitos} de ${lista.length} boleto(s) desfeito(s)`,
          html: `<div style="text-align:left;font-size:14px">Não deu pra desfazer:<br/>${falhas.map((f) => f.replace(/[<>&]/g, '')).join('<br/>')}</div>`,
          icon: feitos > 0 ? 'warning' : 'error',
        });
      }
    } finally {
      setProcessando(false);
    }
  };

  /** Mesmo "Desfazer" da linha, para todos os marcados que ainda nao foram pagos. */
  const marcadosParaDesfazer = listaAtual.filter((t) => selecionados.has(t.id) && t.boleto && statusBoletoEfetivo(t.boleto) !== 'pago');

  // --- Boleto para imprimir / ver -------------------------------------------

  const recalcularBoleto = (titulo: TituloBoleto) => recalcularBoletoComum(titulo, bancosComBoleto);

  const mostrarBoleto = (titulo: TituloBoleto) => {
    if (titulo.boleto?.sistemaAnterior) {
      void NexusSwal.fire({
        title: 'Boleto do sistema anterior',
        html: `<div style="text-align:left;font-size:14px">`
          + `<b>Nosso número:</b> ${formatarNossoNumeroSicoobExibicao(titulo.boleto.nossoNumero || '')}<br/>`
          + (titulo.boleto.valorNoBancoCentavos ? `<b>Valor no banco:</b> ${currency.format(fromCents(titulo.boleto.valorNoBancoCentavos))}<br/>` : '')
          + (titulo.boleto.remessaSistemaAnterior ? `<b>Remessa do sistema anterior:</b> ${escaparHtml(titulo.boleto.remessaSistemaAnterior)}<br/>` : '')
          + `<br/>${escaparHtml(AVISO_SEGUNDA_VIA_SISTEMA_ANTERIOR)} O arquivo de retorno dá baixa nele normalmente.`
          + `</div>`,
        icon: 'info',
      });
      return;
    }
    const calc = recalcularBoleto(titulo);
    void NexusSwal.fire({
      title: 'Boleto',
      html: `<div style="text-align:left;font-size:14px">`
        + `<b>Nosso número:</b> ${formatarNossoNumeroSicoobExibicao(titulo.boleto?.nossoNumero || '')}<br/><br/>`
        + `<b>Linha digitável:</b><br/><span style="font-family:monospace">${formatarLinhaDigitavel(calc?.linhaDigitavel || titulo.boleto?.linhaDigitavel || '')}</span>`
        + `</div>`,
      icon: 'info',
    });
  };

  /** PDF do boleto (services/boletoEmissaoService): botao "Imprimir" e logo apos a emissao. */
  const dadosPdfDoBoleto = (titulo: TituloBoleto): Promise<DadosPdfBoleto> => dadosPdfDoBoletoComum({ tenantId: tenantId || '', titulo, bancosComBoleto });
  const gerarPdfDoBoleto = (titulo: TituloBoleto) => gerarPdfDoBoletoComum({ tenantId: tenantId || '', titulo, bancosComBoleto });

  /** 2a via de varios boletos marcados: um PDF so', um boleto por pagina. */
  const imprimirSelecionados = async () => {
    const lista = listaAtual.filter((t) => selecionados.has(t.id) && t.boleto);
    if (lista.length === 0) {
      showError('Nada marcado', 'Marque os boletos que quer imprimir.');
      return;
    }
    setProcessando(true);
    try {
      const dados: DadosPdfBoleto[] = [];
      const falhas: string[] = [];
      for (const titulo of lista) {
        try {
          dados.push(await dadosPdfDoBoleto(titulo));
        } catch (erro) {
          falhas.push(`${titulo.clienteNome || titulo.fornecedorNome || 'Boleto'}: ${(erro as Error).message}`);
        }
      }
      if (dados.length > 0) {
        setPdfBoleto({
          blob: gerarPdfBoletos(dados),
          nome: lista.length === 1 ? nomePdfBoleto(lista[0]) : `BOLETOS ${getDateInputInTimeZone().split('-').reverse().join('-')} - ${dados.length} boletos.pdf`,
        });
      }
      if (falhas.length > 0) showError(`${falhas.length} boleto(s) ficaram de fora`, falhas.join(' '));
    } finally {
      setProcessando(false);
    }
  };

  const imprimirBoleto = async (titulo: TituloBoleto) => {
    setProcessando(true);
    try {
      const pdf = await gerarPdfDoBoleto(titulo);
      setPdfBoleto(pdf);
    } catch (erro: any) {
      console.error('Erro ao gerar o PDF do boleto:', erro);
      showError('Não foi possível gerar o boleto', erro?.message || 'Tente novamente.');
    } finally {
      setProcessando(false);
    }
  };

  // --- Arquivo de remessa -------------------------------------------------

  const gerarRemessa = async () => {
    if (!tenantId || !currentUser) return;
    const paraEnviar = porAba.emitidos.filter((t) => selecionados.has(t.id));
    const lista = paraEnviar.length > 0 ? paraEnviar : porAba.emitidos;
    if (lista.length === 0) {
      showError('Nada para enviar', 'Não há boleto emitido aguardando remessa. Emita pelo menos um boleto antes.');
      return;
    }

    const banco = bancosComBoleto.find((b) => b.id === lista[0].bancoId) || bancosComBoleto[0];
    if (!banco) { showError('Sem convênio', 'Configure o convênio de boleto em Cadastros Auxiliares → Bancos.'); return; }
    if (!banco.boleto?.cnpjCedente || !banco.boleto?.nomeCedente) {
      showError(
        'Cedente incompleto',
        'Preencha o CNPJ e o nome do cedente na Configuração de Boleto do banco antes de gerar a remessa.',
      );
      return;
    }

    setProcessando(true);
    try {
      const hoje = getDateInputInTimeZone();
      const agora = new Date();
      const hora = `${String(agora.getHours()).padStart(2, '0')}${String(agora.getMinutes()).padStart(2, '0')}${String(agora.getSeconds()).padStart(2, '0')}`;

      let numeroRemessa = 0;
      await runTransaction(db, async (transaction) => {
        const piso = Number(banco.boleto?.proximaRemessa || 0);
        numeroRemessa = await reserveTenantSequence(
          transaction, db, tenantId, `boleto_remessa_${banco.id}`, Math.max(0, piso - 1),
        );
      });

      // O Sicoob rejeita titulo sem CPF/CNPJ e CEP do pagador -- entao o dado
      // vem do cadastro do cliente e, se faltar, o arquivo nao sai: a mensagem
      // diz quem completar e onde (Clientes), em vez de mandar arquivo torto.
      const titulosRemessa: TituloRemessaSicoob[] = [];
      const problemas: string[] = [];
      for (const [indice, t] of lista.entries()) {
        let numeroPedido = '';
        let clienteId = t.clienteId || '';
        if (t.pedidoId) {
          const pedidoSnap = await getDoc(doc(db, 'pedidos_venda', t.pedidoId));
          if (pedidoSnap.exists() && pedidoSnap.data().tenantId === tenantId) {
            numeroPedido = String(pedidoSnap.data().numeroPedido || '');
            clienteId = clienteId || String(pedidoSnap.data().clienteId || '');
          }
        }
        // Pagador: o cliente ou, em conta a receber de fornecedor (19/10/2026), o fornecedor.
        const cadastro = await cadastroDoPagador(tenantId, { clienteId, fornecedorId: t.fornecedorId });
        const pagador = pagadorDoCadastro(cadastro.dados, t.clienteNome || t.fornecedorNome || '');
        const nomeCliente = pagador.nome;
        const documento = pagador.documento;
        const cep = pagador.cep;
        const faltando = faltandoNoPagador(pagador);
        if (faltando.length > 0) {
          problemas.push(`${nomeCliente || 'Pagador sem nome'} (${cadastro.deFornecedor ? 'cadastro em Fornecedores' : 'cadastro em Clientes'}, título ${t.descricao || t.id}): falta ${faltando.join(', ')}`);
          continue;
        }
        const nossoNumero = Number(String(t.boleto?.nossoNumero || '0').slice(0, -1)) || indice + 1;
        // O documento do titulo no banco e' o mesmo do boleto impresso: a nota fiscal da venda;
        // sem nota autorizada, o pedido (12/11/2026 -- boletoEmissaoDomain.ts).
        const documentoBoleto = documentoDoBoleto({ numeroNota: await numeroDaNotaDoPedido(tenantId, t.pedidoId), numeroPedido, nossoNumero });
        titulosRemessa.push({
          nossoNumero,
          numeroDocumento: documentoBoleto.numeroDocumento,
          // Mesma linha "Ref." do boleto impresso (o arquivo real aceito pelo Sicoob ja' levava "Ref. NF.").
          ...(documentoBoleto.referencia ? { referencia: documentoBoleto.referencia, referenciaEhPedido: documentoBoleto.referenciaEhPedido } : {}),
          parcela: parcelaDoBoletoSicoob(t),
          vencimento: t.boleto?.vencimento || t.dataVencimento || hoje,
          valorCentavos: t.valorCentavos,
          sacado: {
            tipoDocumento: documento.length === 14 ? 'CNPJ' : 'CPF',
            documento,
            nome: nomeCliente,
            endereco: [pagador.endereco, pagador.numero].filter(Boolean).join(', '),
            bairro: pagador.bairro,
            cep,
            cidade: pagador.cidade,
            uf: pagador.uf,
          },
        });
      }
      if (problemas.length > 0) {
        throw new Error(`Complete o cadastro do pagador antes de gerar a remessa — o banco exige CPF/CNPJ, CEP, cidade e UF. ${problemas.join(' | ')}`);
      }

      const conteudo = montarRemessaSicoob({
        convenio: {
          cooperativa: String(banco.agencia || ''),
          conta: String(banco.conta || ''),
          contaDv: banco.boleto?.contaDv,
          ...(banco.boleto?.codigoCliente ? { codigoCliente: banco.boleto.codigoCliente } : {}),
          cnpjCedente: banco.boleto.cnpjCedente,
          nomeCedente: banco.boleto.nomeCedente,
          instrucoes: banco.boleto?.instrucoes,
          multaPercentual: banco.boleto?.multaPercentual,
          jurosMensalPercentual: banco.boleto?.jurosMensalPercentual,
          numeroRemessa,
        },
        titulos: titulosRemessa,
        dataGeracao: hoje,
        horaGeracao: hora,
      });

      // CNAB e' texto de largura fixa em latin1; o Blob sai como o banco espera.
      const blob = new Blob([conteudo], { type: 'text/plain;charset=iso-8859-1' });
      const nomeDaRemessa = nomeArquivoRemessaSicoob(numeroRemessa, hoje);
      // Pasta da remessa deste computador (25/11/2026): ja' liberada, o arquivo vai
      // direto para ela; senao (ou se falhar) baixa como sempre.
      const pastaDaRemessa = tenantId ? await lerPasta('remessa', tenantId) : null;
      const salvoNaPasta = Boolean(pastaDaRemessa
        && (await permissaoDaPasta(pastaDaRemessa, 'remessa')) === 'granted'
        && (await gravarNaPasta(pastaDaRemessa, nomeDaRemessa, blob)));
      if (!salvoNaPasta) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = nomeDaRemessa;
        link.click();
        URL.revokeObjectURL(url);
      }

      // Marca os titulos como enviados so' DEPOIS do arquivo sair.
      const incluidos: string[] = [];
      for (const t of lista) {
        const marcou = await runTransaction(db, async (transaction) => {
          const ref = doc(db, 'transacoes', t.id);
          const snap = await transaction.get(ref);
          if (!snap.exists()) return false;
          const atual = snap.data().boleto;
          if (!atual || atual.status !== 'emitido') return false;
          transaction.update(ref, {
            boleto: { ...atual, status: 'em_remessa', numeroRemessa },
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Incluído na remessa ${numeroRemessa}`),
          });
          return true;
        });
        if (marcou) incluidos.push(t.id);
      }

      // Historico de alteracoes (09/11/2026): um registro pela remessa inteira,
      // no banco e nos titulos que entraram (os primeiros, ate' o limite do registro).
      const totalDaRemessa = lista.filter((t) => incluidos.includes(t.id)).reduce((soma, t) => soma + t.valorCentavos, 0);
      createAuditLog({
        tenantId,
        usuarioId: currentUser.uid,
        usuarioEmail: currentUser.email || currentUser.uid,
        modulo: 'financeiro',
        acao: 'emissao',
        descricao: `Remessa ${numeroRemessa} do banco ${banco.nome} gerada com ${incluidos.length} boleto(s), total de ${currency.format(fromCents(totalDaRemessa))}`
          + `${incluidos.length < lista.length ? ` (o arquivo levou ${lista.length}; ${lista.length - incluidos.length} já não estava(m) em Emitidos e não mudou(aram) de situação)` : ''}.`,
        registroRelacionadoId: banco.id,
        documentosRelacionados: incluidos,
        documentoTipo: 'remessa_boleto',
        documentoNumero: `Remessa ${numeroRemessa}`,
        status: 'sucesso',
      });

      setSelecionados(new Set());
      showSuccess(`Remessa ${numeroRemessa} gerada com ${lista.length} boleto(s)${salvoNaPasta && pastaDaRemessa ? ` e gravada na pasta "${pastaDaRemessa.name}"` : ''}.`);
    } catch (erro: any) {
      console.error('Erro ao gerar remessa:', erro);
      showError('Não foi possível gerar a remessa', erro?.message || 'Tente novamente.');
    } finally {
      setProcessando(false);
    }
  };

  // --- Arquivo de retorno -------------------------------------------------

  // Janela de conferencia do retorno (28/11/2026): espera a pessoa confirmar ou cancelar.
  const [conferenciaAberta, setConferenciaAberta] = useState<{
    dados: ConferenciaDoRetorno; arquivo: string; outras: number; informativos: number; responder: (ok: boolean) => void;
  } | null>(null);
  const pedirConferencia = (args: { dados: ConferenciaDoRetorno; arquivo: string; outras: number; informativos: number }) => (
    new Promise<boolean>((resolve) => {
      setConferenciaAberta({ ...args, responder: (ok) => { setConferenciaAberta(null); resolve(ok); } });
    })
  );

  const importarRetorno = (arquivo: File) => {
    const leitor = new FileReader();
    leitor.onload = async (evento) => {
      const conteudo = String(evento.target?.result || '');
      const resumo = lerArquivoRetornoSicoob(conteudo);

      if (resumo.liquidados.length === 0 && resumo.paraConferir.length === 0 && resumo.informativos.length === 0) {
        showError('Nada reconhecido', 'Nenhum título foi encontrado neste arquivo. Confira se é o arquivo de retorno do Sicoob.');
        return;
      }

      const conferir = resumo.paraConferir.slice(0, 8)
        .map((l) => `${escaparHtml(l.nossoNumero)}${l.valorPagoCentavos ? ` (${currency.format(fromCents(l.valorPagoCentavos))})` : ''}`)
        .join(', ');
      const html = `<div style="text-align:left;font-size:14px">`
        + `<b>${resumo.liquidados.length}</b> título(s) pagos (liquidação), prontos para baixa.<br/>`
        + `<b>${resumo.informativos.length}</b> confirmação(ões) de entrada / título(s) em aberto — só informativo.<br/>`
        + `<b>${resumo.paraConferir.length}</b> com outra ocorrência — <u>não</u> serão tocados`
        + (conferir ? `: ${conferir}${resumo.paraConferir.length > 8 ? '…' : ''}` : '') + `.`
        + `</div>`;

      if (resumo.liquidados.length === 0) {
        await NexusSwal.fire({ title: 'Nenhum pagamento neste arquivo', html, icon: 'info' });
        return;
      }

      // A tela carrega os em aberto e os pagos do mes: boleto pago ha' mais
      // tempo (ou fora da lista por qualquer motivo) e' procurado no banco
      // pelo nosso numero, para nao virar "nao encontrado" sem ser.
      // Feito ANTES da conferencia (28/11/2026): a janela ja' mostra cada documento.
      let candidatos: TituloBoleto[];
      setProcessando(true);
      try {
        const naTela = new Set(titulos.map((t) => t.boleto?.nossoNumero).filter(Boolean));
        const faltando = [...new Set(resumo.liquidados.map((l) => l.nossoNumero).filter((n) => n && !naTela.has(n)))];
        const achados: TituloBoleto[] = [];
        for (let i = 0; i < faltando.length; i += 30) {
          const snap = await getDocs(query(
            collection(db, 'transacoes'),
            where('tenantId', '==', tenantId),
            where('boleto.nossoNumero', 'in', faltando.slice(i, i + 30)),
          ));
          snap.docs.forEach((d) => achados.push(paraTituloBoleto(d.id, d.data())));
        }
        candidatos = [...titulos, ...achados];
      } catch (erro) {
        console.error('Retorno: não foi possível procurar os boletos do arquivo.', erro);
        showError('Não foi possível conferir o retorno', 'A busca dos boletos do arquivo falhou. Confira a internet e importe o arquivo de novo; nada foi baixado.');
        setProcessando(false);
        return;
      }
      setProcessando(false);

      // Conferir antes de dar baixa (28/11/2026, pedido do dono): documento por
      // documento, com vencimento, dia do pagamento, juros e multa e os totais.
      const conferencia = montarConferenciaDoRetorno(resumo.liquidados, candidatos);
      if (conferencia.aBaixar.length === 0) {
        await NexusSwal.fire({
          title: 'Nada novo para baixar',
          html: `<div style="text-align:left;font-size:14px">`
            + (conferencia.jaPagos.length ? `<b>${conferencia.jaPagos.length}</b> boleto(s) deste arquivo já estavam pagos.<br/>` : '')
            + (conferencia.naoEncontrados.length ? `<b>${conferencia.naoEncontrados.length}</b> não encontrado(s) no sistema: ${escaparHtml(conferencia.naoEncontrados.slice(0, 8).join(', '))}.<br/>` : '')
            + html.replace(/^<div[^>]*>/, '').replace(/<\/div>$/, '')
            + `</div>`,
          icon: 'info',
        });
        return;
      }
      const confirmou = await pedirConferencia({
        dados: conferencia,
        arquivo: arquivo.name,
        outras: resumo.paraConferir.length,
        informativos: resumo.informativos.length,
      });
      if (!confirmou) return;

      setProcessando(true);
      // Resumo do fim (25/11/2026): o que entrou e o que ficou de fora, por nome.
      const baixadosLista: BaixaDoRetorno[] = [];
      const naoEncontradosLista: string[] = [];
      let jaPagos = 0;
      try {
        // Um titulo que o servidor recusa (cancelado aqui, renegociado...) NAO
        // derruba o lote: os outros pagos seguem baixando e o recusado vai para
        // a lista do fim (03/11/2026 -- 1 boleto cancelado travava 46 pagos).
        const recusados: string[] = [];
        // Cancelado no sistema, pago no banco: o servidor nao baixa (a venda nao
        // existe mais) e a tela pergunta, no fim, se lanca como recebimento avulso.
        const canceladosPagos: Array<{ titulo: TituloBoleto; valorPagoCentavos: number; dataPagamento?: string; descricao: string; clienteNome: string }> = [];
        for (const linha of resumo.liquidados) {
          const titulo = candidatos.find((t) => t.boleto?.nossoNumero === linha.nossoNumero);
          if (!titulo) { naoEncontradosLista.push(String(linha.nossoNumero || '')); continue; }
          if (titulo.status === 'Paga') { jaPagos += 1; continue; }
          const valorPagoCentavos = linha.valorPagoCentavos || titulo.valorCentavos;
          try {
            const resultado = await darBaixaBoleto(titulo, valorPagoCentavos, linha.dataOcorrencia, linha.detalhe);
            if (resultado.boletoCancelado) {
              if (!resultado.jaLancadoAvulso) {
                canceladosPagos.push({
                  titulo,
                  valorPagoCentavos,
                  ...(linha.dataOcorrencia ? { dataPagamento: linha.dataOcorrencia } : {}),
                  descricao: resultado.descricao || titulo.descricao || titulo.id,
                  clienteNome: resultado.clienteNome || titulo.clienteNome || '',
                });
              }
              continue;
            }
            if (resultado.jaEstavaPago) jaPagos += 1;
            else {
              baixadosLista.push({
                clienteNome: titulo.clienteNome || titulo.fornecedorNome || titulo.descricao || '',
                nossoNumero: String(linha.nossoNumero || ''),
                dataPagamento: linha.dataOcorrencia || '',
                valorPagoCentavos: resultado.valorPagoCentavos || valorPagoCentavos,
                acrescimoCentavos: resultado.acrescimoCentavos || 0,
                descontoCentavos: resultado.descontoCentavos || 0,
              });
            }
          } catch (erro: any) {
            recusados.push(erro?.message || `O boleto "${titulo.descricao || titulo.id}" não pôde receber baixa.`);
          }
        }

        let avulsosLancados = 0;
        if (canceladosPagos.length > 0) {
          const lista = canceladosPagos
            .map((c) => `<li><b>${escaparHtml(c.descricao)}</b>${c.clienteNome ? ` — ${escaparHtml(c.clienteNome)}` : ''} — ${currency.format(fromCents(c.valorPagoCentavos))}${c.dataPagamento ? ` (pago em ${c.dataPagamento.split('-').reverse().join('/')})` : ''}</li>`)
            .join('');
          const pergunta = await NexusSwal.fire({
            icon: 'question',
            title: canceladosPagos.length === 1 ? 'Boleto cancelado, mas pago no banco' : `${canceladosPagos.length} boletos cancelados, mas pagos no banco`,
            html: `<div style="text-align:left;font-size:14px">`
              + `O cliente pagou no banco um boleto que está <b>cancelado</b> aqui:<ul style="margin:8px 0 12px 18px;padding:0">${lista}</ul>`
              + `Lançar como <b>recebimento avulso</b> no banco? A venda e o boleto continuam cancelados — depois você decide se devolve o valor ou refatura.`
              + `</div>`,
            showCancelButton: true,
            confirmButtonText: 'Lançar recebimento avulso',
            cancelButtonText: 'Deixar para depois',
          });
          if (pergunta.isConfirmed) {
            for (const c of canceladosPagos) {
              try {
                const r = await receberBoletoCanceladoPeloRetorno({
                  transacaoId: c.titulo.id,
                  valorPagoCentavos: c.valorPagoCentavos,
                  ...(c.dataPagamento ? { dataPagamento: c.dataPagamento } : {}),
                  tenantId: tenantId || '',
                });
                if (!r.jaLancado) avulsosLancados += 1;
              } catch (erro: any) {
                recusados.push(erro?.message || `O recebimento do boleto cancelado "${c.descricao}" não pôde ser lançado.`);
              }
            }
          } else {
            canceladosPagos.forEach((c) => recusados.push(`O boleto "${c.descricao}" está cancelado e ficou sem lançamento (${currency.format(fromCents(c.valorPagoCentavos))} pagos no banco).`));
          }
        }

        // Fim da importacao (25/11/2026): lista do que foi baixado e do que ficou
        // de fora. Nada encontrado e' AVISO -- a Embala Minas viu "concluido" em
        // verde com 0 baixados e os boletos continuaram em aberto.
        const resumoDoRetorno: ResumoDoRetorno = { baixados: baixadosLista, naoEncontrados: naoEncontradosLista, jaPagos, recusados, avulsosLancados };
        const dataBr = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '—');
        const tabelaBaixados = baixadosLista.length === 0 ? '' : `<div style="max-height:260px;overflow:auto;margin:6px 0 12px">`
          + `<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="text-align:left">`
          + `<th style="padding:4px 6px">Cliente</th><th style="padding:4px 6px">Nosso nº</th><th style="padding:4px 6px">Pago em</th><th style="padding:4px 6px;text-align:right">Valor pago</th></tr></thead><tbody>`
          + baixadosLista.map((b) => `<tr style="border-top:1px solid var(--border-color)">`
            + `<td style="padding:4px 6px">${escaparHtml(b.clienteNome)}</td>`
            + `<td style="padding:4px 6px">${escaparHtml(formatarNossoNumeroSicoobExibicao(b.nossoNumero))}</td>`
            + `<td style="padding:4px 6px">${dataBr(b.dataPagamento)}</td>`
            + `<td style="padding:4px 6px;text-align:right">${currency.format(fromCents(b.valorPagoCentavos))}`
            + (b.acrescimoCentavos > 0 ? `<div style="font-size:11px;color:var(--text-muted)">+ ${currency.format(fromCents(b.acrescimoCentavos))} de juros/multa</div>` : '')
            + (b.descontoCentavos > 0 ? `<div style="font-size:11px;color:var(--text-muted)">${currency.format(fromCents(b.descontoCentavos))} a menos (desconto)</div>` : '')
            + `</td></tr>`).join('')
          + `</tbody></table></div>`;
        const naoEncontradosTexto = naoEncontradosLista.length === 0 ? ''
          : `<p style="margin:8px 0 4px"><b>${naoEncontradosLista.length} pago(s) no banco não encontrado(s) aqui</b> (nosso número): `
            + `${naoEncontradosLista.slice(0, 15).map((n) => escaparHtml(formatarNossoNumeroSicoobExibicao(n))).join(', ')}${naoEncontradosLista.length > 15 ? '…' : ''}.</p>`
            + `<p style="margin:0 0 8px;color:var(--text-muted)">${escaparHtml(AJUDA_NAO_ENCONTRADOS)}</p>`;
        const recusadosTexto = recusados.length === 0 ? ''
          : `<p style="margin:8px 0 4px"><b>O banco recebeu, mas o sistema não pôde dar baixa em:</b></p><ul style="margin:0 0 8px 18px;padding:0">`
            + recusados.map((m) => `<li>${escaparHtml(m)}</li>`).join('') + `</ul>`;
        const extras = [
          jaPagos > 0 ? `${jaPagos} já estava(m) pago(s) aqui (nada mudou).` : '',
          avulsosLancados > 0 ? `${avulsosLancados} recebimento(s) avulso(s) de boleto cancelado lançado(s).` : '',
        ].filter(Boolean).join(' ');
        await NexusSwal.fire({
          icon: gravidadeDoRetorno(resumoDoRetorno) === 'sucesso' ? 'success' : 'warning',
          title: tituloDoRetorno(resumoDoRetorno),
          width: 720,
          html: `<div style="text-align:left;font-size:14px">${tabelaBaixados}${naoEncontradosTexto}${recusadosTexto}`
            + (extras ? `<p style="margin:8px 0 0;color:var(--text-muted)">${escaparHtml(extras)}</p>` : '')
            + (baixadosLista.length > 0 ? `<p style="margin:8px 0 0;color:var(--text-muted)">Os baixados estão na aba "Pagos" e em Mais opções › "Ver movimentação".</p>` : '')
            + `</div>`,
        });
      } catch (erro: any) {
        console.error('Erro ao aplicar retorno:', erro);
        showError('Não foi possível concluir a baixa', erro?.message || 'Confira os títulos e tente novamente.');
      } finally {
        setProcessando(false);
      }
    };
    leitor.readAsText(arquivo, 'ISO-8859-1');
  };

  // --- Boletos do sistema anterior (24/11/2026) ------------------------------
  //
  // As contas a receber da migracao entraram sem o boleto que o sistema antigo
  // ja' registrou no banco; sem o nosso numero, o retorno nao as achava. A
  // planilha liga cada conta (pela chave da migracao) ao boleto dela. Regra em
  // utils/boletoSistemaAnteriorDomain.ts; gravacao pelo servidor.

  const vincularBoletosAnteriores = (arquivo: File) => {
    const leitor = new FileReader();
    leitor.onload = async (evento) => {
      if (!tenantId) return;
      const { linhas, erros } = lerPlanilhaBoletosAnteriores(String(evento.target?.result || ''));
      const listaDeErros = (lista: string[]) => (lista.length === 0 ? ''
        : `<ul style="margin:6px 0 0 18px;padding:0;max-height:160px;overflow:auto">${lista.slice(0, 30).map((e) => `<li>${escaparHtml(e)}</li>`).join('')}</ul>`
          + (lista.length > 30 ? `<div>… e mais ${lista.length - 30}.</div>` : ''));
      if (linhas.length === 0) {
        await NexusSwal.fire({
          icon: 'error',
          title: 'Nenhum boleto na planilha',
          html: `<div style="text-align:left;font-size:14px">Confira se é a planilha de boletos do sistema anterior.${listaDeErros(erros)}</div>`,
        });
        return;
      }
      if (bancosComBoleto.length === 0) {
        showError('Nenhum banco preparado para boleto', 'Abra Cadastros Auxiliares → Bancos, edite o banco do Sicoob e marque "Emite boleto por este banco".');
        return;
      }
      let bancoId = bancosComBoleto[0].id;
      if (bancosComBoleto.length > 1) {
        const escolha = await NexusSwal.fire({
          title: 'Qual banco emitiu esses boletos?',
          input: 'select',
          inputOptions: Object.fromEntries(bancosComBoleto.map((b) => [b.id, b.nome])),
          inputValue: bancoId,
          showCancelButton: true,
          confirmButtonText: 'Continuar',
          cancelButtonText: 'Cancelar',
        });
        if (!escolha.isConfirmed) return;
        bancoId = String(escolha.value || bancoId);
      }
      const banco = bancosComBoleto.find((b) => b.id === bancoId) || bancosComBoleto[0];
      const total = linhas.reduce((soma, l) => soma + l.valorBoletoCentavos, 0);
      const confirmacao = await NexusSwal.fire({
        icon: 'question',
        title: `Vincular ${linhas.length} boleto(s) do sistema anterior?`,
        html: `<div style="text-align:left;font-size:14px">`
          + `<b>Banco:</b> ${escaparHtml(banco.nome)}<br/>`
          + `<b>Valor dos boletos no banco:</b> ${currency.format(fromCents(total))}<br/><br/>`
          + `Cada conta a receber da migração recebe o nosso número do boleto que o sistema anterior já registrou no banco. `
          + `Eles entram em "Em remessa" (não vão numa remessa nova) e o arquivo de retorno passa a dar baixa neles. `
          + `Valor, vencimento, caixa e saldo do banco não mudam.`
          + (erros.length > 0 ? `<br/><br/><b>${erros.length} linha(s) da planilha com problema ficam de fora:</b>${listaDeErros(erros)}` : '')
          + `</div>`,
        showCancelButton: true,
        confirmButtonText: 'Vincular',
        cancelButtonText: 'Cancelar',
      });
      if (!confirmacao.isConfirmed) return;

      setProcessando(true);
      const soma: Omit<ResultadoVinculoBoletosAnteriores, 'ok' | 'bancoNome'> = { vinculados: 0, totalCentavos: 0, jaVinculados: 0, jaPagos: 0, recusados: [], avisos: [] };
      try {
        for (let i = 0; i < linhas.length; i += LIMITE_DE_BOLETOS_POR_ENVIO) {
          const lote = linhas.slice(i, i + LIMITE_DE_BOLETOS_POR_ENVIO).map((l) => ({
            chave: l.chave,
            nossoNumero: l.nossoNumero,
            vencimento: l.vencimento,
            emissao: l.emissao,
            valorBoletoCentavos: l.valorBoletoCentavos,
            arquivoRemessa: l.arquivoRemessa,
          }));
          const r = await vincularBoletosDoSistemaAnterior({ tenantId, bancoId, boletos: lote });
          soma.vinculados += r.vinculados;
          soma.totalCentavos += r.totalCentavos;
          soma.jaVinculados += r.jaVinculados;
          soma.jaPagos += r.jaPagos;
          soma.recusados.push(...r.recusados);
          soma.avisos.push(...r.avisos);
        }
      } catch (erro: any) {
        console.error('Erro ao vincular os boletos do sistema anterior:', erro);
        showError('Não foi possível vincular os boletos', `${erro?.message || 'Tente novamente.'}${soma.vinculados > 0 ? ` (${soma.vinculados} já tinham sido vinculados antes do erro; enviar a planilha de novo não repete esses.)` : ''}`);
        setProcessando(false);
        return;
      }
      setProcessando(false);
      const foraDaPlanilha = [...erros, ...soma.recusados.map((r) => r.motivo)];
      await NexusSwal.fire({
        icon: foraDaPlanilha.length > 0 ? 'warning' : 'success',
        title: `${soma.vinculados} boleto(s) vinculado(s)`,
        html: `<div style="text-align:left;font-size:14px">`
          + `${soma.vinculados} conta(s) a receber ligada(s) ao boleto do sistema anterior (${currency.format(fromCents(soma.totalCentavos))}). Estão na aba "Em remessa" ou "Vencidos".`
          + (soma.jaVinculados > 0 ? `<br/>${soma.jaVinculados} já estavam vinculados (nada mudou).` : '')
          + (soma.jaPagos > 0 ? `<br/>${soma.jaPagos} já estão pagos aqui (ficaram como estão).` : '')
          + (foraDaPlanilha.length > 0 ? `<br/><br/><b>${foraDaPlanilha.length} ficaram de fora:</b>${listaDeErros(foraDaPlanilha)}` : '')
          + (soma.avisos.length > 0 ? `<br/><b>Para conferir (${soma.avisos.length}):</b>${listaDeErros(soma.avisos)}` : '')
          + `</div>`,
      });
    };
    leitor.readAsText(arquivo, 'UTF-8');
  };

  /**
   * Ver movimentacao (25/11/2026, pedido do dono): os boletos pagos, dia por dia
   * (data do pagamento), com cliente, nosso numero e o que o banco recebeu --
   * como o "ver movimentacao" de Caixas e Transferencias. Usa os pagos que a
   * tela ja' leu (deste mes, ou de todo o periodo quando pedido na aba Pagos).
   */
  const verMovimentacao = () => {
    const pagos = titulos
      .filter((t) => t.status === 'Paga' && t.boleto)
      .map((t) => ({
        id: t.id,
        clienteNome: t.clienteNome || t.fornecedorNome || '—',
        descricao: t.descricao,
        nossoNumero: String(t.boleto?.nossoNumero || ''),
        dataPagamento: t.dataPagamento || '',
        valorCentavos: t.valorCentavos,
        valorPagoCentavos: t.valorPagoCentavos || t.valorCentavos,
        bancoNome: t.bancoNome || '',
      }));
    const dias = movimentacaoPorDia(pagos);
    const dataBr = (iso: string) => (iso ? iso.split('-').reverse().join('/') : 'Sem data de pagamento');
    const periodo = pagosDeTodoPeriodo ? 'em todo o período' : 'neste mês';
    const total = dias.reduce((soma, d) => soma + d.totalPagoCentavos, 0);
    const corpo = dias.length === 0
      ? `<p style="margin:0">Nenhum boleto pago ${periodo}.</p>`
      : dias.map((d) => `<div style="margin:0 0 14px">`
        + `<div style="display:flex;justify-content:space-between;gap:12px;font-weight:700;padding:6px 8px;border-radius:8px;background:var(--bg-tertiary)">`
        + `<span>${escaparHtml(dataBr(d.data))} · ${d.boletos.length} boleto(s)</span><span>${currency.format(fromCents(d.totalPagoCentavos))}</span></div>`
        + `<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:4px"><tbody>`
        + d.boletos.map((b) => `<tr style="border-bottom:1px solid var(--border-color)">`
          + `<td style="padding:4px 8px">${escaparHtml(b.clienteNome)}<div style="font-size:11px;color:var(--text-muted)">${escaparHtml(b.descricao)}</div></td>`
          + `<td style="padding:4px 8px;white-space:nowrap">${escaparHtml(b.nossoNumero ? formatarNossoNumeroSicoobExibicao(b.nossoNumero) : '—')}</td>`
          + `<td style="padding:4px 8px;white-space:nowrap">${escaparHtml(b.bancoNome)}</td>`
          + `<td style="padding:4px 8px;text-align:right;white-space:nowrap">${currency.format(fromCents(b.valorPagoCentavos || b.valorCentavos))}</td></tr>`).join('')
        + `</tbody></table></div>`).join('');
    void NexusSwal.fire({
      title: 'Movimentação dos boletos pagos',
      width: 820,
      html: `<div style="text-align:left;font-size:14px">`
        + `<p style="margin:0 0 12px;color:var(--text-muted)">Pagos ${periodo}: ${pagos.length} boleto(s), ${currency.format(fromCents(total))}.`
        + (pagosDeTodoPeriodo ? '' : ' Para ver os meses anteriores, abra a aba "Pagos", clique em "Ver pagos de todo o período" e abra esta janela de novo.')
        + `</p><div style="max-height:60vh;overflow:auto">${corpo}</div></div>`,
      confirmButtonText: 'Fechar',
    });
  };

  /** Baixa de um boleto pago no retorno: titulo + saldo do banco gravados pelo servidor. */
  const darBaixaBoleto = (titulo: TituloBoleto, valorPagoCentavos: number, dataPagamento?: string, detalheDoRetorno?: DetalheRetornoBoleto) => (
    baixarBoletoPeloRetorno({
      transacaoId: titulo.id,
      valorPagoCentavos,
      ...(dataPagamento ? { dataPagamento } : {}),
      ...(detalheDoRetorno ? { detalheDoRetorno } : {}),
      tenantId: tenantId || '',
    })
  );

  // --- Pastas do computador (25/11/2026) -------------------------------------
  // Pasta do retorno escolhida e liberada: a cada minuto (com o navegador a
  // vista) o sistema olha se chegou arquivo de retorno novo e pergunta se
  // importa. Arquivo perguntado fica marcado neste computador (nao pergunta de
  // novo); o importado a mao pelo botao tambem. Regra em pastasDoBoletoDomain.ts.
  const [pastasAbertas, setPastasAbertas] = useState(false);
  const [versaoDasPastas, setVersaoDasPastas] = useState(0);
  const [retornoParaLiberar, setRetornoParaLiberar] = useState<string | null>(null);
  const importarRetornoRef = useRef(importarRetorno);
  const processandoRef = useRef(processando);
  useEffect(() => {
    importarRetornoRef.current = importarRetorno;
    processandoRef.current = processando;
  });
  const olhandoPasta = useRef(false);
  useEffect(() => {
    if (!tenantId || !podeAcessar) return undefined;
    let viva = true;
    const olhar = async () => {
      if (olhandoPasta.current || document.visibilityState !== 'visible' || processandoRef.current || NexusSwal.isVisible()) return;
      olhandoPasta.current = true;
      try {
        const pasta = await lerPasta('retorno', tenantId);
        if (!viva) return;
        if (!pasta) { setRetornoParaLiberar(null); return; }
        if ((await permissaoDaPasta(pasta, 'retorno')) !== 'granted') { setRetornoParaLiberar(pasta.name); return; }
        setRetornoParaLiberar(null);
        const novos = retornosNovos(await arquivosDaPasta(pasta), await retornosJaVistos(tenantId));
        if (!viva || novos.length === 0 || NexusSwal.isVisible()) return;
        const arquivo = novos[0];
        const resposta = await NexusSwal.fire({
          icon: 'info',
          title: 'Chegou um arquivo de retorno novo',
          html: `<div style="text-align:left;font-size:14px">Arquivo <b>${escaparHtml(arquivo.name)}</b>, na pasta "${escaparHtml(pasta.name)}".`
            + (novos.length > 1 ? `<br/>Depois dele há mais ${novos.length - 1} arquivo(s) novo(s); o sistema pergunta um de cada vez.` : '')
            + '<br/><br/>Importar agora dá baixa nos boletos pagos que ele trouxer (você confere antes).</div>',
          showCancelButton: true,
          confirmButtonText: 'Importar agora',
          cancelButtonText: 'Agora não',
        });
        await marcarRetornosVistos(tenantId, [arquivo]);
        if (resposta.isConfirmed) importarRetornoRef.current(arquivo);
        else showWarning('Este arquivo não será perguntado de novo. Para importar depois, use "Importar retorno".');
      } finally {
        olhandoPasta.current = false;
      }
    };
    void olhar();
    const id = window.setInterval(() => { void olhar(); }, 60000);
    return () => { viva = false; window.clearInterval(id); };
  }, [tenantId, podeAcessar, versaoDasPastas]);

  const liberarPastaDoRetorno = async () => {
    if (!tenantId) return;
    await liberarPasta(await lerPasta('retorno', tenantId), 'retorno');
    setVersaoDasPastas((v) => v + 1);
  };

  // --- Render -------------------------------------------------------------

  if (!podeAcessar) {
    return (
      <div className="os-page">
        <div className="card" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
          Você não tem permissão para acessar os boletos. Peça a permissão "Financeiro: Boletos" ao responsável.
        </div>
      </div>
    );
  }

  return (
    <div className="os-page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
        <div className="header-title-group">
          <div>
            <h1 className="page-title">Boletos</h1>
            <p className="page-subtitle">Emissão, arquivo de remessa e retorno do banco</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {aba === 'aguardando' && selecionados.size > 0 && (
            <button className="btn-primary" onClick={emitirSelecionados} disabled={processando} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Receipt size={18} /> Emitir selecionados ({selecionados.size})
            </button>
          )}
          {aba !== 'aguardando' && selecionados.size > 0 && (
            <button className="btn-primary" onClick={() => void imprimirSelecionados()} disabled={processando} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Printer size={18} /> Imprimir 2ª via ({selecionados.size})
            </button>
          )}
          {aba !== 'aguardando' && marcadosParaDesfazer.length > 0 && (
            <button
              className="btn-secondary"
              onClick={() => void desfazer(marcadosParaDesfazer)}
              disabled={processando}
              title="Tira os marcados da remessa (voltam para Emitidos, mesmo código de barras) ou apaga a emissão (voltam para Aguardando emissão)"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ef4444' }}
            >
              <Undo2 size={18} /> Desfazer selecionados ({marcadosParaDesfazer.length})
            </button>
          )}
          <button className="btn-secondary" onClick={gerarRemessa} disabled={processando} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Download size={18} /> {(() => {
              // Diz o que vai no arquivo: so' os marcados na aba Emitidos, ou todos.
              const marcadosEmitidos = porAba.emitidos.filter((t) => selecionados.has(t.id)).length;
              if (marcadosEmitidos > 0) return `Gerar remessa (${marcadosEmitidos} marcado${marcadosEmitidos === 1 ? '' : 's'})`;
              return porAba.emitidos.length > 0 ? `Gerar remessa (todos os ${porAba.emitidos.length})` : 'Gerar remessa';
            })()}
          </button>
          <button className="btn-secondary" onClick={() => inputRetornoRef.current?.click()} disabled={processando} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileUp size={18} /> Importar retorno
          </button>
          <input
            ref={inputRetornoRef}
            type="file"
            style={{ display: 'none' }}
            onChange={(e) => {
              const arquivo = e.target.files?.[0];
              if (arquivo) {
                importarRetorno(arquivo);
                // Importado a mao: o aviso da pasta do retorno nao pergunta de novo por ele.
                if (tenantId) void marcarRetornosVistos(tenantId, [arquivo]);
              }
              e.target.value = '';
            }}
          />
          <MenuMaisOpcoes
            itens={[{
              texto: 'Pastas do computador',
              Icone: FolderOpen,
              titulo: 'Escolhe neste computador a pasta onde a remessa é gravada e a pasta onde chegam os arquivos de retorno (o sistema avisa quando chega um novo)',
              onClick: () => setPastasAbertas(true),
            }, {
              texto: 'Ver movimentação',
              Icone: Receipt,
              titulo: 'Boletos pagos dia por dia (data do pagamento), com cliente, nosso número, banco e o valor que entrou',
              desabilitado: loading,
              onClick: verMovimentacao,
            }, {
              texto: 'Vincular boletos do sistema anterior',
              Icone: Link2,
              titulo: 'Planilha da migração: liga as contas a receber importadas ao boleto que o sistema anterior já registrou no banco, para o retorno dar baixa nelas',
              desabilitado: processando,
              onClick: () => inputSistemaAnteriorRef.current?.click(),
            }]}
          />
          <input
            ref={inputSistemaAnteriorRef}
            type="file"
            accept=".csv,.txt"
            aria-label="Planilha de boletos do sistema anterior"
            style={{ display: 'none' }}
            onChange={(e) => {
              const arquivo = e.target.files?.[0];
              if (arquivo) vincularBoletosAnteriores(arquivo);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {bancosComBoleto.length === 0 && (
        <div className="card" style={{ padding: '16px 20px', marginBottom: '20px', backgroundColor: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.4)' }}>
          <strong style={{ color: '#f59e0b' }}>Nenhum banco preparado para boleto.</strong>
          <span style={{ color: 'var(--text-secondary)' }}>
            {' '}Abra Cadastros Auxiliares → Bancos, edite o banco do Sicoob e marque "Emite boleto por este banco".
          </span>
        </div>
      )}

      <div className="card form-section" style={{ padding: '16px 20px', marginBottom: '20px', display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '220px' }}>
          <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            style={{ width: '100%', padding: '10px 12px 10px 32px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar…"
            title="Cliente, descrição ou nosso número"
          />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
          Faturados
          <select
            value={periodoFaturamento}
            onChange={(e) => { setPeriodoFaturamento(e.target.value as PeriodoFaturamento); setSelecionados(new Set()); }}
            aria-label="Filtrar pela data de faturamento"
            style={{ padding: '9px 10px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
          >
            {(Object.keys(ROTULO_PERIODO_FATURAMENTO) as PeriodoFaturamento[]).map((chave) => (
              <option key={chave} value={chave}>{ROTULO_PERIODO_FATURAMENTO[chave]}</option>
            ))}
          </select>
        </label>
        {periodoFaturamento === 'periodo' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>
            <input type="date" value={faturadoDe} onChange={(e) => setFaturadoDe(e.target.value)} aria-label="Faturados a partir de"
              style={{ padding: '8px 10px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }} />
            até
            <input type="date" value={faturadoAte} onChange={(e) => setFaturadoAte(e.target.value)} aria-label="Faturados até"
              style={{ padding: '8px 10px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }} />
          </div>
        )}
        <button
          type="button"
          className={filtrosExtrasAtivos > 0 ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setMaisFiltrosAberto((aberto) => !aberto)}
          aria-expanded={maisFiltrosAberto}
          title="Vencimento, emissão do boleto, banco e valor"
          style={{ padding: '8px 14px', fontSize: '13px' }}
        >
          Mais filtros{filtrosExtrasAtivos > 0 ? ` (${filtrosExtrasAtivos})` : ''}
        </button>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {(Object.keys(ROTULO_ABA) as Aba[]).map((chave) => (
            <button
              key={chave}
              type="button"
              className={aba === chave ? 'btn-primary' : 'btn-secondary'}
              onClick={() => { setAba(chave); setSelecionados(new Set()); }}
              style={{ padding: '8px 14px', fontSize: '13px' }}
            >
              {ROTULO_ABA[chave]} ({porAba[chave].length})
            </button>
          ))}
        </div>
      </div>

      {maisFiltrosAberto && (() => {
        const campo: React.CSSProperties = { padding: '8px 10px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' };
        const rotulo: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: 'var(--text-secondary)' };
        return (
          <div className="card" style={{ padding: '16px 20px', marginBottom: '20px', display: 'flex', flexDirection: 'row', gap: '18px', alignItems: 'flex-end', flexWrap: 'wrap', textAlign: 'left' }}>
            <label style={rotulo}>Vencimento
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                <select value={filtrosExtras.vencimento} onChange={(e) => mudarFiltro({ vencimento: e.target.value as PeriodoVencimento })} style={campo} aria-label="Filtrar pelo vencimento">
                  {(Object.keys(ROTULO_PERIODO_VENCIMENTO) as PeriodoVencimento[]).map((chave) => <option key={chave} value={chave}>{ROTULO_PERIODO_VENCIMENTO[chave]}</option>)}
                </select>
                {filtrosExtras.vencimento === 'periodo' && (
                  <>
                    <input type="date" value={filtrosExtras.vencimentoDe} onChange={(e) => mudarFiltro({ vencimentoDe: e.target.value })} aria-label="Vencimento a partir de" style={campo} />
                    até
                    <input type="date" value={filtrosExtras.vencimentoAte} onChange={(e) => mudarFiltro({ vencimentoAte: e.target.value })} aria-label="Vencimento até" style={campo} />
                  </>
                )}
              </div>
            </label>
            <label style={rotulo}>Emissão do boleto
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                <select value={filtrosExtras.emissao} onChange={(e) => mudarFiltro({ emissao: e.target.value as PeriodoFaturamento })} style={campo} aria-label="Filtrar pela data de emissão do boleto" title="Dia em que o boleto foi gerado. Título ainda sem boleto só aparece em Todos.">
                  {(Object.keys(ROTULO_PERIODO_FATURAMENTO) as PeriodoFaturamento[]).map((chave) => <option key={chave} value={chave}>{ROTULO_PERIODO_FATURAMENTO[chave]}</option>)}
                </select>
                {filtrosExtras.emissao === 'periodo' && (
                  <>
                    <input type="date" value={filtrosExtras.emissaoDe} onChange={(e) => mudarFiltro({ emissaoDe: e.target.value })} aria-label="Emitidos a partir de" style={campo} />
                    até
                    <input type="date" value={filtrosExtras.emissaoAte} onChange={(e) => mudarFiltro({ emissaoAte: e.target.value })} aria-label="Emitidos até" style={campo} />
                  </>
                )}
              </div>
            </label>
            <label style={rotulo}>Banco
              <select value={filtrosExtras.bancoId} onChange={(e) => mudarFiltro({ bancoId: e.target.value })} style={campo} aria-label="Filtrar pelo banco">
                <option value="">Todos</option>
                {bancos.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
              </select>
            </label>
            <label style={rotulo}>Valor (R$)
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input inputMode="decimal" value={filtrosExtras.valorDe} onChange={(e) => mudarFiltro({ valorDe: e.target.value })} aria-label="Valor a partir de" title="Valor mínimo" style={{ ...campo, width: '110px' }} />
                até
                <input inputMode="decimal" value={filtrosExtras.valorAte} onChange={(e) => mudarFiltro({ valorAte: e.target.value })} aria-label="Valor até" title="Valor máximo" style={{ ...campo, width: '110px' }} />
              </div>
            </label>
            {filtrosExtrasAtivos > 0 && (
              <button type="button" className="btn-secondary" onClick={() => mudarFiltro(FILTROS_EXTRAS_VAZIOS)} style={{ padding: '8px 14px', fontSize: '13px' }}>
                Limpar filtros
              </button>
            )}
          </div>
        );
      })()}

      {retornoParaLiberar && (
        <div role="status" style={{ margin: '0 0 12px', padding: '10px 14px', borderRadius: '12px', background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontSize: '13px' }}>
          <FolderOpen size={16} />
          <span>A pasta do retorno ("{retornoParaLiberar}") precisa ser liberada neste computador para o sistema avisar quando chegar arquivo novo.</span>
          <button type="button" className="btn-secondary" onClick={() => void liberarPastaDoRetorno()} style={{ padding: '4px 10px', fontSize: '12px' }}>Liberar</button>
        </div>
      )}
      {aba === 'pagos' && (
        <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {pagosDeTodoPeriodo ? 'Pagos de todo o período.' : 'Pagos neste mês.'}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setPagosDeTodoPeriodo((atual) => !atual)}
            style={{ padding: '4px 10px', fontSize: '12px' }}
          >
            {pagosDeTodoPeriodo ? 'Ver só os deste mês' : 'Ver pagos de todo o período'}
          </button>
        </p>
      )}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '48px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', color: 'var(--text-muted)' }}>
            <Loader2 size={20} className="spin" /> Carregando boletos...
          </div>
        ) : listaAtual.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <Receipt size={32} style={{ marginBottom: '12px', opacity: 0.5 }} />
            <p style={{ margin: 0 }}>
              Nenhum boleto em "{ROTULO_ABA[aba]}"
              {periodoFaturamento !== 'todos' ? ` faturado em "${ROTULO_PERIODO_FATURAMENTO[periodoFaturamento]}". Troque o filtro "Faturados" para ver os outros.` : '.'}
            </p>
            {filtrosExtrasAtivos > 0 && (
              <p style={{ margin: '8px 0 0' }}>
                Há {filtrosExtrasAtivos === 1 ? '1 filtro' : `${filtrosExtrasAtivos} filtros`} em "Mais filtros".{' '}
                <button type="button" className="btn-secondary" onClick={() => mudarFiltro(FILTROS_EXTRAS_VAZIOS)} style={{ padding: '4px 10px', fontSize: '12px' }}>Limpar filtros</button>
              </p>
            )}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-tertiary)', textAlign: 'left' }}>
                  <th style={{ padding: '14px 16px', width: '40px' }}>
                    <input
                      type="checkbox"
                      title="Marcar todos desta aba"
                      aria-label="Marcar todos os boletos desta aba"
                      checked={listaAtual.length > 0 && listaAtual.every((t) => selecionados.has(t.id))}
                      onChange={(e) => setSelecionados(e.target.checked ? new Set(listaAtual.map((t) => t.id)) : new Set())}
                    />
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>Cliente</th>
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>Descrição</th>
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>Faturado em</th>
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>Vencimento</th>
                  {aba === 'pagos' && (
                    <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)' }} title="Dia em que o cliente pagou (vem do arquivo de retorno)">Pago em</th>
                  )}
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>
                    <button type="button" onClick={inverterOrdemNumero} title="Inverter a ordem"
                      style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', font: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      {aba === 'aguardando' ? 'Nosso número (ordem da venda)' : 'Nosso número'} {ordemNumero === 'asc' ? '▲' : '▼'}
                    </button>
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>Situação</th>
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)', textAlign: 'right' }}
                    title={aba === 'pagos' ? 'O que entrou de fato: valor do boleto + juros e multa - desconto - tarifa do banco' : undefined}>
                    {aba === 'pagos' ? 'Recebido (líquido)' : 'Valor'}
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)', textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {blocos.visiveis.map((t) => {
                  const situacao: StatusBoletoEfetivo | 'aguardando' = t.boleto ? statusBoletoEfetivo(t.boleto) : 'aguardando';
                  const vencimento = t.boleto?.vencimento || t.dataVencimento || '';
                  return (
                    <tr key={t.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '14px 16px' }}>
                        <input
                          type="checkbox"
                          title={aba === 'aguardando' ? 'Marcar para emitir vários boletos de uma vez' : 'Marcar para imprimir a 2ª via (ou, em Emitidos, mandar só estes na remessa)'}
                          aria-label={aba === 'aguardando' ? `Marcar ${t.clienteNome || t.fornecedorNome || 'título'} para emitir` : `Marcar boleto de ${t.clienteNome || t.fornecedorNome || 'cliente'}`}
                          checked={selecionados.has(t.id)}
                          onChange={(e) => {
                            const novo = new Set(selecionados);
                            if (e.target.checked) novo.add(t.id); else novo.delete(t.id);
                            setSelecionados(novo);
                          }}
                        />
                      </td>
                      <td style={{ padding: '14px 16px' }}>{t.clienteNome || (t.fornecedorNome ? `${t.fornecedorNome} (fornecedor)` : '—')}</td>
                      <td style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>{t.descricao}</td>
                      <td style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>
                        {t.faturadoEm ? t.faturadoEm.split('-').reverse().join('/') : '—'}
                      </td>
                      <td style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>
                        {vencimento ? vencimento.split('-').reverse().join('/') : '—'}
                      </td>
                      {aba === 'pagos' && (
                        <td style={{ padding: '14px 16px', fontWeight: 600 }}>
                          {t.dataPagamento ? t.dataPagamento.split('-').reverse().join('/') : '—'}
                        </td>
                      )}
                      <td style={{ padding: '14px 16px', fontFamily: 'monospace', fontSize: '13px' }}>
                        {t.boleto?.nossoNumero ? formatarNossoNumeroSicoobExibicao(t.boleto.nossoNumero) : '—'}
                        {t.boleto?.sistemaAnterior && (
                          <div style={{ fontFamily: 'inherit', fontSize: '11px', color: 'var(--text-muted)' }} title={AVISO_SEGUNDA_VIA_SISTEMA_ANTERIOR}>sistema anterior</div>
                        )}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <span style={{
                          padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 700,
                          backgroundColor: situacao === 'pago' ? 'rgba(16,185,129,0.18)'
                            : situacao === 'vencido' ? 'rgba(239,68,68,0.18)'
                              : 'rgba(148,163,184,0.18)',
                          color: situacao === 'pago' ? '#10b981' : situacao === 'vencido' ? '#ef4444' : 'var(--text-muted)',
                        }}>
                          {situacao === 'aguardando' ? 'Aguardando emissão' : ROTULO_STATUS_BOLETO[situacao]}
                        </span>
                      </td>
                      {aba === 'pagos' && t.status === 'Paga' ? (
                        <CelulaRecebidoDoBoleto titulo={t} />
                      ) : (
                      <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 600 }}>
                        {currency.format(fromCents(t.valorCentavos))}
                        {t.valorPagoCentavos && t.valorPagoCentavos !== t.valorCentavos && (
                          <div style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-muted)' }} title="O que o banco recebeu; a diferença está lançada à parte (juros/multa ou desconto)">
                            pago {currency.format(fromCents(t.valorPagoCentavos))}
                          </div>
                        )}
                      </td>
                      )}
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        {!t.boleto ? (
                          <button
                            className="btn-primary"
                            style={{ padding: '6px 12px', fontSize: '13px' }}
                            onClick={() => emitirBoleto(t)}
                            disabled={processando}
                          >
                            Emitir
                          </button>
                        ) : (
                          <span style={{ display: 'inline-flex', gap: '6px' }}>
                            <button
                              className="btn-secondary"
                              style={{ padding: '6px 12px', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                              onClick={() => mostrarBoleto(t)}
                            >
                              <Barcode size={14} /> Ver
                            </button>
                            <button
                              className="btn-primary"
                              style={{ padding: '6px 12px', fontSize: '13px' }}
                              onClick={() => void imprimirBoleto(t)}
                              disabled={processando}
                            >
                              Imprimir
                            </button>
                            {situacao !== 'pago' && (
                              <button
                                className="btn-secondary"
                                style={{ padding: '6px 12px', fontSize: '13px', color: '#ef4444' }}
                                onClick={() => void desfazer([t])}
                                disabled={processando}
                                title="Tira da remessa (volta para Emitidos, mesmo código de barras) ou apaga a emissão (volta para Aguardando emissão)"
                              >
                                Desfazer
                              </button>
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <MostrarMaisLinhas blocos={blocos} />
      </div>
      {pastasAbertas && tenantId && (
        <PastasDosBoletosModal tenantId={tenantId} onFechar={() => setPastasAbertas(false)} onMudou={() => setVersaoDasPastas((v) => v + 1)} />
      )}
      {pdfBoleto && <PdfVisualizador titulo="Boleto" nomeArquivo={pdfBoleto.nome} pdf={pdfBoleto.blob} onFechar={() => setPdfBoleto(null)} />}
      {conferenciaAberta && (
        <ConferenciaRetornoModal
          conferencia={conferenciaAberta.dados}
          nomeDoArquivo={conferenciaAberta.arquivo}
          outrasOcorrencias={conferenciaAberta.outras}
          informativos={conferenciaAberta.informativos}
          onConfirmar={() => conferenciaAberta.responder(true)}
          onCancelar={() => conferenciaAberta.responder(false)}
        />
      )}
    </div>
  );
};

export default Boletos;
