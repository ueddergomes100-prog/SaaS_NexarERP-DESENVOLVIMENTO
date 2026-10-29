import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, deleteField, doc, getDoc, getDocs, onSnapshot, query, runTransaction, serverTimestamp, where } from 'firebase/firestore';
import { assinarComReserva } from '../../services/consultaComReserva';
import { Barcode, Download, FileUp, Loader2, Printer, Receipt, Search, Undo2 } from 'lucide-react';
import { db } from '../../services/firebase';
import { baixarBoletoPeloRetorno } from '../../services/baixaFinanceiraService';
import { useAuth } from '../../contexts/AuthContext';
import { showError, showSuccess, NexusSwal } from '../../utils/alerts';
import { hasModuleAccess } from '../../utils/roles';
import { buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
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
  paraTituloBoleto,
  recalcularBoleto as recalcularBoletoComum,
  validarTituloParaEmissao as validarTituloParaEmissaoComum,
  type BancoBoleto,
  type TituloBoleto,
} from '../../services/boletoEmissaoService';
import { faltandoNoPagador, pagadorDoCadastro } from '../../utils/cobrancaEmBoletoDomain';
import {
  contarFiltrosExtras,
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
} from '../../utils/boletoEmissaoDomain';
import { montarRemessaSicoob, nomeArquivoRemessaSicoob, type TituloRemessaSicoob } from '../../utils/boletoRemessaSicoobDomain';
import { compararPorNumero, useOrdemNumero } from '../../hooks/useOrdemNumero';
import '../OS/OS.css';

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
      aguardando: visiveis.filter((t) => !t.boleto),
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
   * Desfaz a emissao (nosso numero, linha digitavel, codigo de barras) de um titulo que ainda nao foi
   * pago -- por exemplo um boleto emitido de teste, ou emitido antes de uma correcao no calculo. O
   * titulo volta para "Aguardando emissao". Nao mexe em nada do lado do banco: so' apaga o que ficou
   * gravado aqui. O nosso numero que foi reservado fica "pulado" (o contador nunca anda pra tras).
   */
  const desfazerUmaEmissao = async (titulo: TituloBoleto, uid: string) => {
    await runTransaction(db, async (transaction) => {
      const ref = doc(db, 'transacoes', titulo.id);
      const snap = await transaction.get(ref);
      if (!snap.exists()) throw new Error('Título não encontrado. Atualize a página.');
      if (snap.data().status === 'Paga') throw new Error('Este título já foi pago — não é possível desfazer a emissão.');
      transaction.update(ref, {
        boleto: deleteField(),
        updatedAt: serverTimestamp(),
        ...buildDocumentUpdateMetadata(uid, serverTimestamp(), 'Emissão de boleto desfeita'),
      });
    });
  };

  const desfazerEmissao = async (titulo: TituloBoleto) => {
    if (!currentUser) return;
    const confirmacao = await NexusSwal.fire({
      title: 'Desfazer emissão deste boleto?',
      html: `<div style="text-align:left;font-size:14px">`
        + `Remove o nosso número, a linha digitável e o código de barras gravados neste título. `
        + `Ele volta para "Aguardando emissão" e pode ser emitido de novo. Isso não desfaz nada que já `
        + `tenha sido enviado ao banco.`
        + `</div>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Desfazer emissão',
      cancelButtonText: 'Cancelar',
    });
    if (!confirmacao.isConfirmed) return;

    setProcessando(true);
    try {
      await desfazerUmaEmissao(titulo, currentUser.uid);
      showSuccess('Emissão desfeita. O título voltou para "Aguardando emissão".');
    } catch (erro: any) {
      console.error('Erro ao desfazer emissão do boleto:', erro);
      showError('Não foi possível desfazer', erro?.message || 'Tente novamente em instantes.');
    } finally {
      setProcessando(false);
    }
  };

  /** Mesmo "Desfazer" da linha, para todos os marcados que ainda nao foram pagos. */
  const marcadosParaDesfazer = listaAtual.filter((t) => selecionados.has(t.id) && t.boleto && statusBoletoEfetivo(t.boleto) !== 'pago');

  const desfazerSelecionados = async () => {
    if (!currentUser) return;
    const lista = marcadosParaDesfazer;
    if (lista.length === 0) {
      showError('Nada marcado', 'Marque os boletos que quer desfazer. Boleto já pago não pode ser desfeito.');
      return;
    }
    const confirmacao = await NexusSwal.fire({
      title: `Desfazer a emissão de ${lista.length} boleto${lista.length === 1 ? '' : 's'}?`,
      html: `<div style="text-align:left;font-size:14px">`
        + `Remove o nosso número, a linha digitável e o código de barras gravados nos títulos marcados. `
        + `Eles voltam para "Aguardando emissão" e podem ser emitidos de novo. Isso não desfaz nada que já `
        + `tenha sido enviado ao banco.`
        + `</div>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Desfazer emissão',
      cancelButtonText: 'Cancelar',
    });
    if (!confirmacao.isConfirmed) return;

    setProcessando(true);
    let desfeitos = 0;
    const falhas: string[] = [];
    try {
      for (const titulo of lista) {
        try {
          await desfazerUmaEmissao(titulo, currentUser.uid);
          desfeitos += 1;
        } catch (erro: any) {
          console.error('Erro ao desfazer emissão do boleto:', erro);
          const nome = titulo.clienteNome || titulo.fornecedorNome || 'Título';
          falhas.push(`${nome} (nosso número ${formatarNossoNumeroSicoobExibicao(titulo.boleto?.nossoNumero || '')}): ${erro?.message || 'tente novamente em instantes.'}`);
        }
      }
      setSelecionados(new Set());
      if (falhas.length === 0) {
        showSuccess(`${desfeitos} emissão(ões) desfeita(s). Os títulos voltaram para "Aguardando emissão".`);
      } else {
        await NexusSwal.fire({
          title: `${desfeitos} de ${lista.length} emissão(ões) desfeita(s)`,
          html: `<div style="text-align:left;font-size:14px">Não deu pra desfazer:<br/>${falhas.map((f) => f.replace(/[<>&]/g, '')).join('<br/>')}</div>`,
          icon: desfeitos > 0 ? 'warning' : 'error',
        });
      }
    } finally {
      setProcessando(false);
    }
  };

  // --- Boleto para imprimir / ver -------------------------------------------

  const recalcularBoleto = (titulo: TituloBoleto) => recalcularBoletoComum(titulo, bancosComBoleto);

  const mostrarBoleto = (titulo: TituloBoleto) => {
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
        titulosRemessa.push({
          nossoNumero,
          numeroDocumento: numeroPedido || String(nossoNumero),
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
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = nomeArquivoRemessaSicoob(numeroRemessa, hoje);
      link.click();
      URL.revokeObjectURL(url);

      // Marca os titulos como enviados so' DEPOIS do arquivo sair.
      for (const t of lista) {
        await runTransaction(db, async (transaction) => {
          const ref = doc(db, 'transacoes', t.id);
          const snap = await transaction.get(ref);
          if (!snap.exists()) return;
          const atual = snap.data().boleto;
          if (!atual || atual.status !== 'emitido') return;
          transaction.update(ref, {
            boleto: { ...atual, status: 'em_remessa', numeroRemessa },
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Incluído na remessa ${numeroRemessa}`),
          });
        });
      }

      setSelecionados(new Set());
      showSuccess(`Remessa ${numeroRemessa} gerada com ${lista.length} boleto(s).`);
    } catch (erro: any) {
      console.error('Erro ao gerar remessa:', erro);
      showError('Não foi possível gerar a remessa', erro?.message || 'Tente novamente.');
    } finally {
      setProcessando(false);
    }
  };

  // --- Arquivo de retorno -------------------------------------------------

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
        .map((l) => `${l.nossoNumero}${l.valorPagoCentavos ? ` (${currency.format(fromCents(l.valorPagoCentavos))})` : ''}`)
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

      const confirmacao = await NexusSwal.fire({
        title: 'Conferir antes de dar baixa',
        html,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Dar baixa nos pagos',
        cancelButtonText: 'Cancelar',
      });
      if (!confirmacao.isConfirmed) return;

      setProcessando(true);
      let baixados = 0;
      let naoEncontrados = 0;
      try {
        // A tela carrega os em aberto e os pagos do mes: boleto pago ha' mais
        // tempo (ou fora da lista por qualquer motivo) e' procurado no banco
        // pelo nosso numero, para nao virar "nao encontrado" sem ser.
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
        const candidatos = [...titulos, ...achados];
        for (const linha of resumo.liquidados) {
          const titulo = candidatos.find((t) => t.boleto?.nossoNumero === linha.nossoNumero);
          if (!titulo) { naoEncontrados += 1; continue; }
          if (titulo.status === 'Paga') continue;
          if (await darBaixaBoleto(titulo, linha.valorPagoCentavos || titulo.valorCentavos, linha.dataOcorrencia)) baixados += 1;
        }
        showSuccess(
          naoEncontrados > 0
            ? `${baixados} boleto(s) baixados. ${naoEncontrados} do arquivo não foram encontrados aqui.`
            : `${baixados} boleto(s) baixados.`,
        );
      } catch (erro: any) {
        console.error('Erro ao aplicar retorno:', erro);
        showError('Não foi possível concluir a baixa', erro?.message || 'Confira os títulos e tente novamente.');
      } finally {
        setProcessando(false);
      }
    };
    leitor.readAsText(arquivo, 'ISO-8859-1');
  };

  /** Baixa de um boleto pago no retorno: titulo + saldo do banco gravados pelo servidor. Devolve false se ja' estava pago. */
  const darBaixaBoleto = async (titulo: TituloBoleto, valorPagoCentavos: number, dataPagamento?: string): Promise<boolean> => {
    if (!tenantId || !currentUser) return false;
    const resultado = await baixarBoletoPeloRetorno({
      transacaoId: titulo.id,
      valorPagoCentavos,
      ...(dataPagamento ? { dataPagamento } : {}),
      tenantId,
    });
    return !resultado.jaEstavaPago;
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
              onClick={() => void desfazerSelecionados()}
              disabled={processando}
              title="Remove o nosso número/linha digitável dos marcados e volta para Aguardando emissão"
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
              if (arquivo) importarRetorno(arquivo);
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
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>
                    <button type="button" onClick={inverterOrdemNumero} title="Inverter a ordem"
                      style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', font: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      {aba === 'aguardando' ? 'Nosso número (ordem da venda)' : 'Nosso número'} {ordemNumero === 'asc' ? '▲' : '▼'}
                    </button>
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>Situação</th>
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)', textAlign: 'right' }}>Valor</th>
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)', textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {listaAtual.map((t) => {
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
                      <td style={{ padding: '14px 16px', fontFamily: 'monospace', fontSize: '13px' }}>
                        {t.boleto?.nossoNumero ? formatarNossoNumeroSicoobExibicao(t.boleto.nossoNumero) : '—'}
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
                      <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 600 }}>
                        {currency.format(fromCents(t.valorCentavos))}
                      </td>
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
                                onClick={() => void desfazerEmissao(t)}
                                disabled={processando}
                                title="Remove o nosso número/linha digitável deste título e volta para Aguardando emissão"
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
      </div>
      {pdfBoleto && <PdfVisualizador titulo="Boleto" nomeArquivo={pdfBoleto.nome} pdf={pdfBoleto.blob} onFechar={() => setPdfBoleto(null)} />}
    </div>
  );
};

export default Boletos;
