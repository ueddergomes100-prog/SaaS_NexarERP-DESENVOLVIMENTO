import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, PackagePlus, Plus, Save, Trash2 } from 'lucide-react';
import { collection, doc, onSnapshot, query, runTransaction, serverTimestamp, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { avisarSemPermissao, usePodePermissao } from '../../hooks/usePodePermissao';
import { PERMISSAO_ESTOQUE } from '../../utils/permissoesNovasDomain';
import { showError, showSuccess } from '../../utils/alerts';
import { sincronizarCustosSemFalhar } from '../../services/custoProducaoService';
import type { MudancaDeCusto } from '../../utils/custoProducaoDomain';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { gravarEntradasEmLotesNaTransacao, lotesDaEntradaParaGravar, pedirLotesDeEntrada, prepararEntradasEmLotes, produtosQueControlamLote, type EntradaDeLotePreparada } from '../../services/loteBaixaService';
import {
  formatSequenceValue,
  getCurrentMaxSequence,
  getNextTenantSequenceValue,
  writeTenantSequenceValue,
} from '../../utils/firestoreAtomic';
import ClientAutocomplete from '../../components/common/ClientAutocomplete';
import ProductAutocomplete from '../../components/common/ProductAutocomplete';
import CadastroRapidoProdutoModal, { type ProdutoCadastradoRapido } from '../../components/common/CadastroRapidoProdutoModal';
import { calcularValorTotalNotaAvulsa, custoUnitarioComRateio, itemNotaAvulsaValido, quantidadeEstoqueNotaAvulsaItem, ratearValorPorPesos, type NotaAvulsaItem } from '../../utils/notaAvulsaDomain';
import { getDateInputInTimeZone, addDaysToDateInput } from '../../utils/dateTime';
import { toCents } from '../../utils/financeDomain';
import ParcelasEditor from '../../components/financeiro/ParcelasEditor';
import type { ParcelaComCheque } from '../../utils/chequeEmitidoDomain';
import { conferirParcelas, FORMAS_DE_PAGAMENTO, redistribuirValores, trocarFormaPadrao } from '../../utils/pagamentoEntradaDomain';
import { camposDoTituloDaParcela, debitosDasParcelasPagas, erroDasParcelasPorForma, parcelaParaRegistro } from '../../utils/despesaParceladaDomain';
import { buildOpcoesUnidadeVenda, findOpcaoUnidadeVenda, toBaseQuantity, DEFAULT_VENDER_POR_EMBALAGEM } from '../../utils/embalagemDomain';
import { isValidSaleQuantity } from '../../utils/saleQuantity';
import { acompanharCatalogo, acompanharCatalogoEstoque } from '../../services/catalogoEstoqueService';
import ChequesDeClienteNaNota from './ChequesDeClienteNaNota';
import ImportarXmlNaNotaAvulsa, { type OrigemXmlDaNota } from './ImportarXmlNaNotaAvulsa';
import { notaAvulsaChequesService, type ChequeDaCarteira } from '../../services/notaAvulsaChequesService';

interface FornecedorBasico {
  id: string;
  nome: string;
  codigo?: string;
  /** CNPJ/CPF do cadastro: acha o fornecedor do XML (25/11/2026). */
  documento?: string;
}

interface ProdutoBasico {
  id: string;
  nome: string;
  codigo?: string;
  categoria?: string;
  precoCusto?: number;
  precoVenda?: number;
  /** Vinculo dos itens do XML (o mesmo da Entrada de XML): codigo de barras e o codigo de cada fornecedor. */
  codigoBarras?: string;
  codigosFornecedor?: Record<string, string>;
  fatoresFornecedor?: Record<string, number>;
  unidadeMedidaSigla?: string;
  unidadeMedidaCasasDecimais?: number;
  unidadeMedidaFracionado?: boolean;
  embalagens?: unknown;
  /** `false` = produto inativado -- searchProducts() ja exclui isso da
   * busca (src/utils/productSearch.ts), precisa vir junto do Firestore. */
  ativo?: boolean;
  /** `true` = principal de uma grade (gradeProdutosDomain.ts): sem estoque,
   * quem se vende sao as variacoes -- searchProducts() tambem exclui. */
  temGrade?: boolean;
}

interface BancoBasico {
  id: string;
  nome: string;
}

const inputStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--text-primary)', width: '100%',
};
const labelStyle: React.CSSProperties = { fontSize: '13px', color: 'var(--text-secondary)' };

const NotaAvulsaForm: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser, tenantId } = useAuth();
  const podePermissao = usePodePermissao();
  // Item 15 (25/11/2026): a nota sempre lanca o pagamento (banco ou Contas a Pagar) -- permissao propria.
  const podeLancarPagamento = podePermissao(PERMISSAO_ESTOQUE.notaAvulsaPagamento);
  // Cheque de cliente pagando a nota (25/11/2026): permissao propria, conferida no servidor.
  const podePagarComCheque = podePermissao('estoque.nota_avulsa_cheque_cliente');
  const [chequesEscolhidos, setChequesEscolhidos] = useState<ChequeDaCarteira[]>([]);

  const [fornecedores, setFornecedores] = useState<FornecedorBasico[]>([]);
  const [fornecedorNome, setFornecedorNome] = useState('');
  const [fornecedorSelecionado, setFornecedorSelecionado] = useState<FornecedorBasico | null>(null);

  const [produtos, setProdutos] = useState<ProdutoBasico[]>([]);
  const [produtoBusca, setProdutoBusca] = useState('');
  const [produtoSelecionado, setProdutoSelecionado] = useState<ProdutoBasico | null>(null);
  const [quantidadeAtual, setQuantidadeAtual] = useState('');
  const [custoAtual, setCustoAtual] = useState('');
  const [vendaAtual, setVendaAtual] = useState('');
  const [embalagemSelecionadaId, setEmbalagemSelecionadaId] = useState('');
  const [venderPorEmbalagem, setVenderPorEmbalagem] = useState(DEFAULT_VENDER_POR_EMBALAGEM);
  const [showCadastroProduto, setShowCadastroProduto] = useState(false);

  const [itens, setItens] = useState<NotaAvulsaItem[]>([]);

  const [frete, setFrete] = useState('');
  const [desconto, setDesconto] = useState('');

  const [formaPagamento, setFormaPagamento] = useState<'a_vista' | 'pendente'>('pendente');
  const [destinoPagamento, setDestinoPagamento] = useState<'caixa' | 'banco'>('caixa');
  const [bancos, setBancos] = useState<BancoBasico[]>([]);
  const [bancoId, setBancoId] = useState('');
  // Fica pendente: parcelas com forma propria (24/11/2026). Comeca com uma, em 30 dias.
  const [parcelas, setParcelas] = useState<ParcelaComCheque[]>(() => [{ numero: '1', vencimento: addDaysToDateInput(getDateInputInTimeZone(), 30), valor: 0 }]);
  const [formaPadraoParcelas, setFormaPadraoParcelas] = useState<string>('Boleto');
  const [observacao, setObservacao] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  /** XML de outro CNPJ que deu origem a nota (25/11/2026). */
  const [xmlOrigem, setXmlOrigem] = useState<OrigemXmlDaNota | null>(null);
  const [cnpjDaEmpresa, setCnpjDaEmpresa] = useState('');

  useEffect(() => {
    if (!tenantId) return;
    const unsubscribe = acompanharCatalogo(
      'fornecedores', tenantId,
      (snap) => setFornecedores(snap.docs.map((d) => ({ id: d.id, nome: d.data().nome || '', codigo: d.data().codigo, documento: String(d.data().cnpj || d.data().cpfCnpj || d.data().documento || '') }))),
      (error) => console.error('Erro ao carregar fornecedores:', error),
    );
    return unsubscribe;
  }, [tenantId]);

  // onSnapshot (nao getDocs) de proposito: a aba de Nota Avulsa fica aberta
  // enquanto o usuario cadastra um produto novo em outra aba/tela (Estoque
  // ou o modal "Cadastrar Produto" abaixo) -- sem live update, o produto
  // recem-criado so aparecia na busca depois de fechar e reabrir esta aba.
  useEffect(() => {
    if (!tenantId) return;
    const unsubscribe = acompanharCatalogoEstoque(
      tenantId,
      // produtoRevenda === false = item de uso interno (peca de veiculo,
      // embalagem, insumo a granel...) -- nunca entra em nota avulsa, so
      // continua no controle de estoque.
      (snap) => setProdutos(snap.docs.filter((d) => d.data().produtoRevenda !== false).map((d) => ({
        id: d.id,
        nome: d.data().nome || '',
        codigo: d.data().codigo,
        categoria: d.data().categoria,
        precoCusto: Number(d.data().precoCusto) || 0,
        precoVenda: Number(d.data().precoVenda) || 0,
        codigoBarras: d.data().codigoBarras,
        codigosFornecedor: d.data().codigosFornecedor || {},
        fatoresFornecedor: d.data().fatoresFornecedor || {},
        unidadeMedidaSigla: d.data().unidadeMedidaSigla,
        unidadeMedidaCasasDecimais: d.data().unidadeMedidaCasasDecimais,
        unidadeMedidaFracionado: d.data().unidadeMedidaFracionado,
        embalagens: d.data().embalagens,
        ativo: d.data().ativo ?? d.data().statusAtivo ?? true,
        temGrade: d.data().temGrade === true,
      }))),
      (error) => console.error('Erro ao carregar produtos:', error),
    );
    return unsubscribe;
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    const unsubscribe = onSnapshot(
      doc(db, 'configuracoes', tenantId),
      (snap) => {
        setVenderPorEmbalagem(snap.data()?.venderPorEmbalagem ?? DEFAULT_VENDER_POR_EMBALAGEM);
        setCnpjDaEmpresa(String(snap.data()?.cnpj || ''));
      },
      (error) => console.error('Erro ao carregar configuração de embalagem:', error),
    );
    return unsubscribe;
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    const unsubscribe = onSnapshot(
      query(collection(db, 'bancos'), where('tenantId', '==', tenantId), where('ativo', '==', true)),
      (snap) => setBancos(snap.docs.map((d) => ({ id: d.id, nome: d.data().nome || '' }))),
      (error) => console.error('Erro ao carregar bancos:', error),
    );
    return unsubscribe;
  }, [tenantId]);

  // Padrao de boleto: 30 dias da data de hoje (mesmo prazo padrao usado no
  // crediario de venda) -- a primeira parcela ja' nasce assim (estado acima);
  // o usuario troca livremente e divide em N parcelas no editor.

  const valorItens = useMemo(() => calcularValorTotalNotaAvulsa(itens), [itens]);
  const freteValor = Number(frete.replace(',', '.')) || 0;
  const descontoValor = Number(desconto.replace(',', '.')) || 0;
  const valorTotal = Math.max(0, valorItens + freteValor - descontoValor);
  const chequesCentavos = chequesEscolhidos.reduce((soma, c) => soma + c.centavos, 0);
  /** O que sobra depois dos cheques de clientes: e' isto que vira parcela ou pagamento a vista. */
  const valorRestante = Math.max(0, Math.round((valorTotal - chequesCentavos / 100) * 100) / 100);
  const temRestante = valorRestante > 0;

  /** Itens com a parte do frete/desconto ja distribuida em cada um. Fica
   * aqui (e nao so dentro do save) porque a tabela mostra o CMV ao vivo --
   * assim a coluna "CMV Unit." e o custo que vai pro estoque saem do MESMO
   * calculo, sem chance de divergir. */
  const itensComRateio = useMemo(() => {
    const validos = itens.filter(itemNotaAvulsaValido);
    const pesos = validos.map((item) => item.quantidade * item.precoCusto);
    const freteRateado = ratearValorPorPesos(freteValor, pesos);
    const descontoRateado = ratearValorPorPesos(descontoValor, pesos);
    return validos.map((item, index) => ({
      ...item,
      ...(freteValor > 0 ? { freteRateado: freteRateado[index] } : {}),
      ...(descontoValor > 0 ? { descontoRateado: descontoRateado[index] } : {}),
    }));
  }, [itens, freteValor, descontoValor]);

  /*
   * PARCELAS COM FORMA PROPRIA (pedido do dono, 24/11/2026): o mesmo editor da
   * Entrada de NF-e -- cada parcela com a sua forma (boleto, cheque, PIX...),
   * cheque com banco e numero, e parcela que ja' nasce PAGA (sai do caixa ou
   * do banco na hora). A soma TEM de fechar com o total da nota, como sempre.
   *
   * Os valores acompanham o total (itens + frete - desconto) enquanto a pessoa
   * nao mexe neles; depois de mexer, mudar o frete/desconto nao apaga o que ela
   * ajustou -- o aviso de "nao fecha" e o "Redistribuir igualmente" cobrem.
   */
  const [parcelasMexidas, setParcelasMexidas] = useState(false);
  useEffect(() => {
    if (parcelasMexidas) return;
    setParcelas((atual) => redistribuirValores(atual, valorRestante));
  }, [valorRestante, parcelasMexidas]);

  const somaParcelasCentavos = parcelas.reduce((soma, parcela) => soma + toCents(parcela.valor), 0);
  const parcelasDivergem = temRestante && formaPagamento === 'pendente' && somaParcelasCentavos !== toCents(valorRestante);

  /** Mudanca vinda do editor: mexer em valor (ou na quantidade de parcelas) para de acompanhar o total. */
  const alterarParcelas = (novas: ParcelaComCheque[]) => {
    const valoresMudaram = novas.length !== parcelas.length || novas.some((parcela, i) => toCents(parcela.valor) !== toCents(parcelas[i].valor));
    if (valoresMudaram) setParcelasMexidas(true);
    setParcelas(novas);
  };
  const redistribuirIgualmente = () => {
    setParcelasMexidas(false);
    setParcelas((atual) => redistribuirValores(atual, valorRestante));
  };
  const trocarFormaDasParcelas = (nova: string) => {
    setParcelas((atual) => trocarFormaPadrao(atual, formaPadraoParcelas, nova));
    setFormaPadraoParcelas(nova);
  };

  /** Opcoes do seletor "Unidade": a base do produto sempre, mais as
   * embalagens ativas quando a chave venderPorEmbalagem esta ligada. Mesma
   * chave e mesmo comportamento da venda (PDV/Pedido) -- entrada e saida do
   * mesmo estoque seguem a mesma configuracao do tenant. */
  const opcoesUnidadeVenda = useMemo(() => {
    const opcoes = buildOpcoesUnidadeVenda(produtoSelecionado);
    return venderPorEmbalagem ? opcoes : opcoes.slice(0, 1);
  }, [produtoSelecionado, venderPorEmbalagem]);
  const opcaoUnidadeSelecionada = findOpcaoUnidadeVenda(opcoesUnidadeVenda, embalagemSelecionadaId);

  /** Trocar de embalagem reseta custo/venda de proposito: o custo do saco
   * nao tem relacao com o custo do quilo que o usuario possa ter digitado
   * antes -- nao ha como sugerir um valor confiavel. */
  const handleSelecionarEmbalagem = (embalagemId: string) => {
    setEmbalagemSelecionadaId(embalagemId);
    setCustoAtual('');
    setVendaAtual(String(findOpcaoUnidadeVenda(opcoesUnidadeVenda, embalagemId).precoVenda || ''));
  };

  const adicionarItem = () => {
    if (!produtoSelecionado) {
      showError('Selecione um produto', 'Busque um produto do estoque na lista, ou cadastre um novo antes de adicionar.');
      return;
    }
    const quantidade = Number(quantidadeAtual.replace(',', '.'));
    const custo = Number(custoAtual.replace(',', '.'));
    const venda = Number(vendaAtual.replace(',', '.')) || 0;
    if (!isValidSaleQuantity(quantidade, opcaoUnidadeSelecionada.permiteFracionado, opcaoUnidadeSelecionada.casasDecimais)) {
      showError('Quantidade inválida', opcaoUnidadeSelecionada.permiteFracionado
        ? `A quantidade aceita no máximo ${opcaoUnidadeSelecionada.casasDecimais ?? 0} casa(s) decimal(is), conforme a unidade ${opcaoUnidadeSelecionada.sigla}.`
        : `${produtoSelecionado.nome} está sendo recebido na unidade ${opcaoUnidadeSelecionada.sigla}, que não permite quantidade fracionada. Utilize uma quantidade inteira.`);
      return;
    }
    if (!Number.isFinite(custo) || custo <= 0) {
      showError('Custo inválido', 'Informe o valor de custo unitário deste item.');
      return;
    }

    const fatorConversao = opcaoUnidadeSelecionada.fatorConversao;
    const quantidadeBase = toBaseQuantity(quantidade, fatorConversao);
    const dadosEmbalagem = opcaoUnidadeSelecionada.embalagemId
      ? { embalagemId: opcaoUnidadeSelecionada.embalagemId, unidadeSigla: opcaoUnidadeSelecionada.sigla, fatorConversao, quantidadeBase }
      : {};

    setItens((atual) => {
      const existenteIndex = atual.findIndex((item) => (
        item.produtoId === produtoSelecionado.id && (item.embalagemId || '') === (opcaoUnidadeSelecionada.embalagemId || '')
      ));
      if (existenteIndex >= 0) {
        const copia = [...atual];
        const anterior = copia[existenteIndex];
        copia[existenteIndex] = {
          ...anterior,
          quantidade: anterior.quantidade + quantidade,
          precoCusto: custo,
          precoVenda: venda,
          ...(dadosEmbalagem.quantidadeBase !== undefined
            ? { ...dadosEmbalagem, quantidadeBase: (anterior.quantidadeBase || 0) + quantidadeBase }
            : {}),
        };
        return copia;
      }
      return [...atual, { produtoId: produtoSelecionado.id, produtoNome: produtoSelecionado.nome, quantidade, precoCusto: custo, precoVenda: venda, ...dadosEmbalagem }];
    });

    setProdutoBusca('');
    setProdutoSelecionado(null);
    setQuantidadeAtual('');
    setCustoAtual('');
    setVendaAtual('');
    setEmbalagemSelecionadaId('');
  };

  /** Itens, frete/desconto e boletos vindos do XML de outro CNPJ (ImportarXmlNaNotaAvulsa). */
  const aplicarXml: React.ComponentProps<typeof ImportarXmlNaNotaAvulsa<ProdutoBasico, FornecedorBasico>>['onAplicar'] = (r) => {
    setItens((atual) => {
      const juntos = [...atual];
      r.itens.forEach((novo) => {
        const i = juntos.findIndex((x) => x.produtoId === novo.produtoId && !x.embalagemId && Math.abs(x.precoCusto - novo.precoCusto) < 0.0001);
        if (i >= 0) juntos[i] = { ...juntos[i], quantidade: Math.round((juntos[i].quantidade + novo.quantidade) * 1000) / 1000 };
        else juntos.push(novo);
      });
      return juntos;
    });
    if (r.frete > 0) setFrete(String(r.frete));
    if (r.desconto > 0) setDesconto(String(r.desconto));
    if (r.parcelas.length > 0) {
      setFormaPagamento('pendente');
      setFormaPadraoParcelas('Boleto');
      setParcelas(r.parcelas);
      setParcelasMexidas(true);
    }
    setXmlOrigem(r.origem);
  };

  const removerItem = (produtoId: string, embalagemId?: string) => {
    setItens((atual) => atual.filter((item) => !(item.produtoId === produtoId && (item.embalagemId || '') === (embalagemId || ''))));
  };

  const handleProdutoCriado = (produto: ProdutoCadastradoRapido) => {
    const novo: ProdutoBasico = { id: produto.id, nome: produto.nome, codigo: produto.codigo, precoCusto: 0, precoVenda: 0 };
    setProdutos((atual) => [...atual, novo]);
    setProdutoBusca(produto.nome);
    setProdutoSelecionado(novo);
    setEmbalagemSelecionadaId('');
  };

  const handleSalvar = async () => {
    if (!currentUser || !tenantId) return;
    if (!podeLancarPagamento) {
      avisarSemPermissao(PERMISSAO_ESTOQUE.notaAvulsaPagamento, 'lançar o pagamento da nota avulsa (banco e Contas a Pagar)', 'Sem ela, a compra entra pela Entrada de NF-e ou por quem tem a permissão.');
      return;
    }
    if (!fornecedorSelecionado) {
      showError('Fornecedor obrigatório', 'Busque e selecione o fornecedor desta compra.');
      return;
    }
    const itensValidos = itens.filter(itemNotaAvulsaValido);
    if (itensValidos.length === 0) {
      showError('Nenhum item válido', 'Adicione ao menos um item com produto, quantidade e custo preenchidos.');
      return;
    }
    if (chequesCentavos > toCents(valorTotal)) {
      showError('Cheques passam do valor da nota', 'Os cheques de clientes escolhidos passam do valor da nota. Desmarque algum cheque: o que faltar se paga com outra forma.');
      return;
    }
    if (temRestante && formaPagamento === 'pendente') {
      const erroDasParcelas = conferirParcelas(parcelas, valorRestante).erro
        || erroDasParcelasPorForma(parcelas, { formaPadrao: formaPadraoParcelas, bancos, hoje: getDateInputInTimeZone() });
      if (erroDasParcelas) {
        showError('Confira as parcelas', erroDasParcelas);
        return;
      }
    }
    if (parcelasDivergem) {
      showError(
        'Parcelas não fecham o total da nota',
        `As parcelas somam ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(somaParcelasCentavos / 100)}, mas falta pagar ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valorRestante)}${chequesCentavos > 0 ? ' (o total da nota menos os cheques de clientes)' : ''}. Ajuste os valores das parcelas até fechar.`,
      );
      return;
    }
    if (temRestante && formaPagamento === 'a_vista' && destinoPagamento === 'banco' && !bancoId) {
      showError('Banco obrigatório', 'Selecione de qual banco o pagamento vai sair.');
      return;
    }
    const valorItensValidos = calcularValorTotalNotaAvulsa(itensValidos);
    if (descontoValor > valorItensValidos + freteValor) {
      showError('Desconto maior que o total', 'O desconto não pode ser maior que itens + frete. Revise os valores.');
      return;
    }

    setIsSaving(true);
    let numeroFinal = '';
    // Historico de alteracoes (09/11/2026): ids gravados na transacao, para ligar o registro.
    let notaAvulsaIdGravada = '';
    let titulosDaNotaIds: string[] = [];
    try {
      const currentMax = await getCurrentMaxSequence(db, 'notas_avulsas', tenantId, 'numero').catch(() => 0);
      const totalNota = Math.max(0, valorItensValidos + freteValor - descontoValor);
      const bancoNomeEscolhido = bancos.find((b) => b.id === bancoId)?.nome || '';
      // O que sai do banco AGORA: a nota a vista pelo banco, ou as parcelas ja' pagas pelo banco.
      // O que os cheques de clientes pagam nao sai do caixa nem do banco (o servidor repassa depois).
      const restanteDaNota = Math.max(0, Math.round((totalNota - chequesCentavos / 100) * 100) / 100);
      const debitosDeBanco = !(restanteDaNota > 0) ? []
        : formaPagamento === 'a_vista'
          ? (destinoPagamento === 'banco' ? [{ bancoId, centavos: toCents(restanteDaNota) }] : [])
          : debitosDasParcelasPagas(parcelas, formaPadraoParcelas);
      const numParcelasFinal = formaPagamento === 'pendente' ? parcelas.length : 1;

      // Custo que mudou em cada produto: alimenta o recalculo do custo dos
      // produtos acabados que o usam como componente. Zera a cada tentativa
      // (a transacao pode ser repetida pelo Firestore).
      let mudancasDeCusto: MudancaDeCusto[] = [];

      // Lote e Validade: so' o produto que controla lote pede lote e validade; os demais entram como sempre.
      const totaisPorProduto = new Map<string, { nome: string; quantidade: number }>();
      itensComRateio.forEach((item) => {
        const atual = totaisPorProduto.get(item.produtoId);
        totaisPorProduto.set(item.produtoId, { nome: item.produtoNome, quantidade: (atual?.quantidade || 0) + quantidadeEstoqueNotaAvulsaItem(item) });
      });
      const produtosComLote = await produtosQueControlamLote(db, [...totaisPorProduto.keys()]);
      let entradasDeLote: EntradaDeLotePreparada[] = [];
      if (produtosComLote.size > 0) {
        const informados = await pedirLotesDeEntrada(
          [...produtosComLote].map((produtoId) => ({ chave: produtoId, nome: totaisPorProduto.get(produtoId)?.nome || 'Produto', quantidade: totaisPorProduto.get(produtoId)?.quantidade || 0 })),
          'Lote e validade da nota avulsa',
        );
        if (informados === null) {
          setIsSaving(false);
          return;
        }
        entradasDeLote = await prepararEntradasEmLotes(db, tenantId, [...produtosComLote].map((produtoId) => ({
          produtoId,
          lote: informados[produtoId].lote,
          validade: informados[produtoId].validade,
          quantidade: totaisPorProduto.get(produtoId)?.quantidade || 0,
        })));
      }

      await runTransaction(db, async (transaction) => {
        mudancasDeCusto = [];
        // 1. LEITURAS -- todas antes de qualquer escrita (regra do Firestore).
        const nextNumero = await getNextTenantSequenceValue(transaction, db, tenantId, 'notas_avulsas', currentMax);
        const bancosDebitados = debitosDeBanco.map((debito) => ({ ...debito, ref: doc(db, 'bancos', debito.bancoId) }));
        const bancoSnaps = await Promise.all(bancosDebitados.map((debito) => transaction.get(debito.ref)));
        if (bancoSnaps.some((snap) => !snap.exists())) {
          throw new Error('O banco selecionado não foi encontrado. Atualize a página e tente novamente.');
        }

        // Agrupado por produto (nao por item): o mesmo produto pode entrar
        // duas vezes na nota, uma em cada unidade (KG e SC) -- sem agrupar,
        // a segunda escrita sobrescreveria a primeira em vez de somar, ja
        // que as duas leem o mesmo snapshot original.
        const incrementoPorProduto = new Map<string, { quantidadeBase: number; precoCusto: number; codigoFornecedor?: string; fatorXml?: number }>();
        itensComRateio.forEach((item) => {
          const anterior = incrementoPorProduto.get(item.produtoId);
          // CMV do item (custo + parte do frete - parte do desconto), na
          // unidade em que foi comprado. So depois disso converte pra
          // unidade BASE do estoque (por kg, nao por saco): sem dividir
          // pelo fator, comprar em saco deixaria o custo por kg do produto
          // 20x maior que o real.
          const cmv = custoUnitarioComRateio(item);
          const precoCustoBase = item.fatorConversao ? cmv / item.fatorConversao : cmv;
          const doXml = item as NotaAvulsaItem & { codigoFornecedor?: string; fatorXml?: number };
          incrementoPorProduto.set(item.produtoId, {
            quantidadeBase: (anterior?.quantidadeBase || 0) + quantidadeEstoqueNotaAvulsaItem(item),
            precoCusto: precoCustoBase,
            ...(doXml.codigoFornecedor ? { codigoFornecedor: doXml.codigoFornecedor } : anterior?.codigoFornecedor ? { codigoFornecedor: anterior.codigoFornecedor } : {}),
            ...(doXml.fatorXml ? { fatorXml: doXml.fatorXml } : anterior?.fatorXml ? { fatorXml: anterior.fatorXml } : {}),
          });
        });
        const produtoRefs = Array.from(incrementoPorProduto.entries()).map(([produtoId, dados]) => ({
          produtoId, ref: doc(db, 'estoque', produtoId), ...dados,
        }));
        const produtoSnaps = await Promise.all(produtoRefs.map(({ ref }) => transaction.get(ref)));

        // 2. ESCRITAS.
        numeroFinal = formatSequenceValue(nextNumero, 4);
        writeTenantSequenceValue(transaction, db, tenantId, 'notas_avulsas', nextNumero);

        produtoRefs.forEach(({ ref, quantidadeBase, precoCusto, codigoFornecedor, fatorXml }, index) => {
          const snap = produtoSnaps[index];
          // Produto apagado entre a busca e a confirmacao (bem raro): o item
          // fica registrado na nota do mesmo jeito, so nao ha estoque pra
          // incrementar -- melhor que travar a nota inteira por um item.
          if (!snap.exists()) return;
          const quantidadeAtualEstoque = Number(snap.data()?.quantidade || 0);
          mudancasDeCusto.push({
            origem: 'estoque',
            id: ref.id,
            nome: String(snap.data()?.nome || ''),
            custoAnterior: Number(snap.data()?.precoCusto ?? snap.data()?.precos?.custo ?? 0),
            custoNovo: precoCusto,
          });
          transaction.update(ref, {
            quantidade: quantidadeAtualEstoque + quantidadeBase,
            precoCusto,
            // Item vindo do XML: guarda o vinculo (o mesmo da Entrada de XML) para a proxima nota deste fornecedor.
            ...(codigoFornecedor ? { [`codigosFornecedor.${fornecedorSelecionado.id}`]: codigoFornecedor } : {}),
            ...(fatorXml ? { [`fatoresFornecedor.${fornecedorSelecionado.id}`]: fatorXml } : {}),
            updatedAt: serverTimestamp(),
          });
        });

        gravarEntradasEmLotesNaTransacao(transaction, db, tenantId, entradasDeLote, buildDocumentMetadata(currentUser.uid, serverTimestamp()), `Nota Avulsa #${numeroFinal}`);

        const notaRef = doc(collection(db, 'notas_avulsas'));

        // A vista: um titulo so', pago hoje. Pendente: um titulo por parcela,
        // com os valores/datas/formas que a pessoa viu e pode ter ajustado na
        // tela (ja' validados acima pra fechar exatamente o total) -- nao
        // recalcula um split novo aqui, senao o ajuste manual seria perdido.
        const transacoesParaCriar = !(restanteDaNota > 0) ? [] : formaPagamento === 'pendente'
          ? parcelas.map((parcela) => ({
              ref: doc(collection(db, 'transacoes')),
              valorCentavos: toCents(parcela.valor),
              data: parcela.vencimento,
              parcela,
            }))
          : [{
              ref: doc(collection(db, 'transacoes')),
              valorCentavos: toCents(restanteDaNota),
              data: getDateInputInTimeZone(),
              parcela: null,
            }];
        const sufixoParcela = (index: number) => (numParcelasFinal > 1 ? ` (parcela ${index + 1}/${numParcelasFinal})` : '');
        notaAvulsaIdGravada = notaRef.id;
        titulosDaNotaIds = transacoesParaCriar.map(({ ref }) => ref.id);

        if (formaPagamento === 'a_vista' && transacoesParaCriar.length > 0) {
          const [{ ref: transacaoRef, valorCentavos, data }] = transacoesParaCriar;
          transaction.set(transacaoRef, {
            descricao: `Nota Avulsa #${numeroFinal} - ${fornecedorSelecionado.nome}`,
            categoria: 'FORNECEDORES DE PEÇAS',
            valor: valorCentavos / 100,
            valorCentavos,
            tipo: 'saida',
            status: 'Paga',
            data,
            dataPagamento: data,
            formaPagamento: destinoPagamento === 'banco' ? 'Transferência' : 'Dinheiro',
            naturezaFinanceira: destinoPagamento === 'banco' ? 'bancario_digital' : 'caixa_fisico',
            movimentaCaixaFisico: destinoPagamento === 'caixa',
            ...(destinoPagamento === 'banco' ? { bancoId, bancoNome: bancoNomeEscolhido } : {}),
            fornecedorId: fornecedorSelecionado.id,
            fornecedorNome: fornecedorSelecionado.nome,
            notaAvulsaId: notaRef.id,
            tenantId,
            createdAt: serverTimestamp(),
            ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
          });
        } else {
          transacoesParaCriar.forEach(({ ref, parcela }, index) => {
            if (!parcela) return;
            transaction.set(ref, {
              descricao: `Nota Avulsa #${numeroFinal} - ${fornecedorSelecionado.nome}${sufixoParcela(index)}`,
              categoria: 'FORNECEDORES DE PEÇAS',
              tipo: 'saida',
              // Forma DA PARCELA (24/11/2026): em aberto, ou ja' paga (debito do banco logo abaixo).
              ...camposDoTituloDaParcela(parcela, { formaPadrao: formaPadraoParcelas, bancos }),
              ...(numParcelasFinal > 1 ? { parcela: index + 1, totalParcelas: numParcelasFinal } : {}),
              fornecedorId: fornecedorSelecionado.id,
              fornecedorNome: fornecedorSelecionado.nome,
              notaAvulsaId: notaRef.id,
              tenantId,
              createdAt: serverTimestamp(),
              ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
            });
          });
        }
        // Saldo dos bancos: a nota a vista pelo banco, ou as parcelas ja' pagas pelo banco.
        bancosDebitados.forEach((debito, indice) => {
          transaction.update(debito.ref, {
            saldoCentavos: Number(bancoSnaps[indice].data()?.saldoCentavos || 0) - debito.centavos,
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Nota Avulsa #${numeroFinal}`),
          });
        });

        transaction.set(notaRef, {
          numero: numeroFinal,
          fornecedorId: fornecedorSelecionado.id,
          fornecedorNome: fornecedorSelecionado.nome,
          itens: itensComRateio,
          // Lotes que esta nota criou/somou: o cancelamento usa isto para desfazer o saldo de cada lote.
          ...(entradasDeLote.length > 0 ? { lotesEntrada: lotesDaEntradaParaGravar(entradasDeLote) } : {}),
          ...(freteValor > 0 ? { frete: freteValor } : {}),
          ...(descontoValor > 0 ? { desconto: descontoValor } : {}),
          valorTotal: totalNota,
          valorTotalCentavos: toCents(totalNota),
          formaPagamento,
          ...(xmlOrigem ? { xmlOrigem } : {}),
          // Cheques de clientes (25/11/2026): o servidor repassa logo depois (services/repasseCheques.js).
          ...(chequesEscolhidos.length > 0 ? { pagamentoComCheques: { chequeIds: chequesEscolhidos.map((c) => c.id), totalCentavos: chequesCentavos, situacao: 'a_repassar' } } : {}),
          ...(!(restanteDaNota > 0) ? {} : formaPagamento === 'a_vista'
            ? { destinoPagamento, ...(destinoPagamento === 'banco' ? { bancoId, bancoNome: bancoNomeEscolhido } : {}) }
            : { dataVencimento: parcelas[0]?.vencimento || '', parcelas: parcelas.map((parcela) => parcelaParaRegistro(parcela, formaPadraoParcelas)) }),
          transacaoId: transacoesParaCriar[0]?.ref.id || `repasse_cheques_${notaRef.id}`,
          observacao: observacao.trim() || null,
          status: 'ativa',
          tenantId,
          createdAt: serverTimestamp(),
          ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
        });
      });

      try {
        const { createAuditLog } = await import('../../services/logService');
        createAuditLog({
          tenantId,
          usuarioId: currentUser.uid,
          usuarioEmail: currentUser.email || currentUser.uid,
          modulo: 'nota_avulsa',
          acao: 'criacao',
          descricao: `Nota Avulsa #${numeroFinal} lançada para o fornecedor "${fornecedorSelecionado.nome}", valor R$ ${totalNota.toFixed(2)}.`,
          ...(notaAvulsaIdGravada ? { registroRelacionadoId: notaAvulsaIdGravada } : {}),
          documentosRelacionados: titulosDaNotaIds,
          documentoTipo: 'nota_avulsa',
          documentoNumero: `Nota Avulsa ${numeroFinal} — ${fornecedorSelecionado.nome}`,
          status: 'sucesso',
        });
      } catch (logError) {
        console.error('Erro ao registrar auditoria da nota avulsa:', logError);
      }

      // A nota ja foi gravada; o custo dos produtos acabados que usam estes
      // itens como componente acompanha (falha vira aviso, nao erro).
      await sincronizarCustosSemFalhar({
        tenantId,
        usuarioId: currentUser.uid,
        origemDaMudanca: `Nota avulsa #${numeroFinal}`,
        mudancas: mudancasDeCusto,
      });

      if (chequesEscolhidos.length > 0 && notaAvulsaIdGravada) {
        try {
          await notaAvulsaChequesService.repassar(notaAvulsaIdGravada);
        } catch (erroRepasse) {
          showError(
            'Nota lançada, mas os cheques não foram repassados',
            `${erroRepasse instanceof Error ? erroRepasse.message : 'Falha ao falar com o servidor.'} A nota #${numeroFinal} ficou gravada. Em Notas Avulsas, abra o menu da nota e use "Repassar os cheques" para tentar de novo.`,
          );
          navigate('/estoque/notas-avulsas');
          return;
        }
      }
      showSuccess(chequesEscolhidos.length > 0 ? 'Nota avulsa lançada e cheques repassados ao fornecedor!' : 'Nota avulsa lançada com sucesso!');
      navigate('/estoque/notas-avulsas');
    } catch (error) {
      console.error('Erro ao lançar nota avulsa:', error);
      showError('Erro ao lançar nota', error instanceof Error ? error.message : 'Não foi possível concluir o lançamento. Tente novamente.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="icon-btn" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }} onClick={() => navigate('/estoque/notas-avulsas')}>
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>Nova Nota Avulsa</h1>
            <p style={{ color: 'var(--text-muted)' }}>Compra manual de mercadoria sem XML fiscal -- soma o estoque e lança o financeiro.</p>
          </div>
        </div>
        <button className="btn-primary" onClick={() => void handleSalvar()} disabled={isSaving} style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: isSaving ? 0.6 : 1 }}>
          <Save size={18} /> {isSaving ? 'Lançando...' : 'Lançar Nota Avulsa'}
        </button>
      </div>

      <div className="card form-section" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div className="section-header">
          <h3>Fornecedor</h3>
        </div>
        <div className="input-group" style={{ maxWidth: '480px', position: 'relative' }}>
          <label style={labelStyle}>Fornecedor *</label>
          <ClientAutocomplete
            value={fornecedorNome}
            onChange={setFornecedorNome}
            clients={fornecedores}
            onSelect={(f) => { setFornecedorNome(f.nome); setFornecedorSelecionado(f); }}
            placeholder="Busque o fornecedor pelo nome ou código..."
            ariaLabel="Buscar fornecedor"
            renderItem={(f) => (<><span>{f.codigo ? `#${f.codigo} — ${f.nome}` : f.nome}</span></>)}
          />
        </div>
      </div>

      <div className="card form-section" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>Itens da Compra</h3>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <ImportarXmlNaNotaAvulsa<ProdutoBasico, FornecedorBasico>
            produtos={produtos}
            fornecedores={fornecedores}
            fornecedorSelecionado={fornecedorSelecionado}
            cnpjDaEmpresa={cnpjDaEmpresa}
            onFornecedor={(f) => { setFornecedorNome(f.nome); setFornecedorSelecionado(f); }}
            onAplicar={aplicarXml}
          />
          <button type="button" className="btn-secondary" onClick={() => setShowCadastroProduto(true)} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <PackagePlus size={16} /> Cadastrar Produto
          </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: opcoesUnidadeVenda.length > 1 ? '2fr 0.8fr 1fr 1fr 1fr auto' : '2fr 1fr 1fr 1fr auto', gap: '12px', alignItems: 'flex-end' }}>
          <div className="input-group" style={{ position: 'relative' }}>
            <label style={labelStyle}>Produto</label>
            <ProductAutocomplete
              value={produtoBusca}
              products={produtos}
              onChange={(value) => {
                setProdutoBusca(value);
                const existe = produtos.find((p) => p.nome.toLowerCase() === value.toLowerCase() || p.codigo === value);
                setProdutoSelecionado(existe || null);
                setEmbalagemSelecionadaId('');
              }}
              onSelect={(p) => {
                setProdutoBusca(p.nome);
                setProdutoSelecionado(p);
                setEmbalagemSelecionadaId('');
                if (p.precoCusto) setCustoAtual(String(p.precoCusto));
                if (p.precoVenda) setVendaAtual(String(p.precoVenda));
              }}
              placeholder="Busque um produto do estoque..."
              ariaLabel="Buscar produto"
              renderItem={(p) => (<><span>{p.codigo ? `#${p.codigo} — ${p.nome}` : p.nome}</span><span style={{ color: 'var(--text-muted)' }}>{p.categoria}</span></>)}
            />
          </div>

          {/* Seletor de embalagem: so aparece quando a chave "vender por
              embalagem" esta ligada E o produto tem mais de uma unidade de
              compra cadastrada -- mesma condicao da venda (PDV/Pedido). */}
          {opcoesUnidadeVenda.length > 1 && (
            <div className="input-group">
              <label style={labelStyle}>Unidade</label>
              <select
                value={embalagemSelecionadaId}
                onChange={(e) => handleSelecionarEmbalagem(e.target.value)}
                className="form-select"
                style={inputStyle}
              >
                {opcoesUnidadeVenda.map((opcao) => (
                  <option key={opcao.embalagemId || 'base'} value={opcao.embalagemId}>{opcao.label}</option>
                ))}
              </select>
            </div>
          )}

          <div className="input-group">
            <label style={labelStyle}>Quantidade {produtoSelecionado ? `(${opcaoUnidadeSelecionada.sigla})` : ''}</label>
            <input
              type="number"
              min="0"
              step={opcaoUnidadeSelecionada.permiteFracionado ? 'any' : '1'}
              value={quantidadeAtual}
              onChange={(e) => setQuantidadeAtual(e.target.value)}
              style={inputStyle}
            />
            {opcaoUnidadeSelecionada.fatorConversao !== 1 && Number(quantidadeAtual.replace(',', '.')) > 0 && (
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Soma {toBaseQuantity(quantidadeAtual.replace(',', '.'), opcaoUnidadeSelecionada.fatorConversao)} {produtoSelecionado?.unidadeMedidaSigla || 'UN'} no estoque
              </span>
            )}
          </div>
          <div className="input-group">
            <label style={labelStyle}>Custo Unit. (R$)</label>
            <input type="number" min="0" step="0.01" value={custoAtual} onChange={(e) => setCustoAtual(e.target.value)} style={inputStyle} />
          </div>
          <div className="input-group">
            <label style={labelStyle}>Venda Unit. (R$)</label>
            <input type="number" min="0" step="0.01" value={vendaAtual} onChange={(e) => setVendaAtual(e.target.value)} style={inputStyle} />
          </div>
          <button type="button" className="btn-primary" onClick={adicionarItem} style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '42px' }}>
            <Plus size={16} /> Adicionar
          </button>
        </div>

        {itens.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', marginTop: '8px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '13px', textTransform: 'uppercase' }}>
                <th style={{ padding: '10px' }}>Produto</th>
                <th style={{ padding: '10px', textAlign: 'right' }}>Qtd</th>
                <th style={{ padding: '10px', textAlign: 'right' }}>Custo Unit.</th>
                <th style={{ padding: '10px', textAlign: 'right' }}>CMV Unit.</th>
                <th style={{ padding: '10px', textAlign: 'right' }}>Venda Unit.</th>
                <th style={{ padding: '10px', textAlign: 'right' }}>Subtotal</th>
                <th style={{ padding: '10px', textAlign: 'center' }}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {itensComRateio.map((item) => (
                <tr key={`${item.produtoId}::${item.embalagemId || ''}`} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '10px' }}>{item.produtoNome}</td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>
                    {item.quantidade} {item.unidadeSigla || ''}
                    {item.quantidadeBase !== undefined && (
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>({item.quantidadeBase} no estoque)</div>
                    )}
                  </td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.precoCusto)}</td>
                  {/* CMV: custo real da mercadoria, ja com a parte do frete e
                      do desconto que couberam a este item. Recalcula sozinho
                      conforme o frete/desconto sao digitados. */}
                  <td style={{ padding: '10px', textAlign: 'right' }}>
                    <span style={{ fontWeight: 600, color: 'var(--accent-purple)' }}>
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(custoUnitarioComRateio(item))}
                    </span>
                    {item.fatorConversao ? (
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(custoUnitarioComRateio(item) / item.fatorConversao)} por unidade base
                      </div>
                    ) : null}
                  </td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.precoVenda)}</td>
                  <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600 }}>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.quantidade * item.precoCusto)}</td>
                  <td style={{ padding: '10px', textAlign: 'center' }}>
                    <button type="button" onClick={() => removerItem(item.produtoId, item.embalagemId)} className="icon-btn" title="Remover item" style={{ color: '#ef4444' }}>
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Itens:</span>
            <span style={{ minWidth: '110px', textAlign: 'right' }}>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valorItens)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <label style={{ color: 'var(--text-secondary)' }}>Frete (R$):</label>
            <input type="text" value={frete} onChange={(e) => setFrete(e.target.value)} style={{ ...inputStyle, width: '110px', textAlign: 'right' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <label style={{ color: 'var(--text-secondary)' }}>Desconto (R$):</label>
            <input type="text" value={desconto} onChange={(e) => setDesconto(e.target.value)} style={{ ...inputStyle, width: '110px', textAlign: 'right' }} />
          </div>
          <div style={{ fontSize: '18px', fontWeight: 700 }}>
            Total: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valorTotal)}
          </div>
          {(freteValor > 0 || descontoValor > 0) && (
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0, maxWidth: '320px', textAlign: 'right' }}>
              Frete e desconto são diluídos entre os itens (proporcional ao valor de cada um) e entram no custo que vai pro estoque.
            </p>
          )}
        </div>
      </div>

      <div className="card form-section" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div className="section-header">
          <h3>Pagamento ao Fornecedor</h3>
        </div>
        {podePagarComCheque && (
          <ChequesDeClienteNaNota escolhidos={chequesEscolhidos} onEscolhidos={setChequesEscolhidos} valorDaNota={valorTotal} />
        )}
        {chequesEscolhidos.length > 0 && !temRestante ? (
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>Os cheques de clientes pagam a nota inteira: não há parcela nem pagamento à vista.</p>
        ) : (<>
        <div style={{ display: 'flex', gap: '24px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text-primary)' }}>
            <input type="radio" checked={formaPagamento === 'pendente'} onChange={() => setFormaPagamento('pendente')} />
            Fica pendente (a pagar)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text-primary)' }}>
            <input type="radio" checked={formaPagamento === 'a_vista'} onChange={() => setFormaPagamento('a_vista')} />
            Já foi pago à vista
          </label>
        </div>

        {formaPagamento === 'pendente' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div className="input-group" style={{ maxWidth: '280px' }}>
              <label style={labelStyle}>Forma de pagamento (padrão das parcelas)</label>
              <select value={formaPadraoParcelas} onChange={(e) => trocarFormaDasParcelas(e.target.value)} className="form-select" style={inputStyle}>
                {FORMAS_DE_PAGAMENTO.map((opcao) => <option key={opcao} value={opcao}>{opcao}</option>)}
              </select>
            </div>
            <ParcelasEditor
              parcelas={parcelas}
              onParcelas={alterarParcelas}
              total={valorRestante}
              dataBase={getDateInputInTimeZone()}
              forma={formaPadraoParcelas}
              bancos={bancos}
              aceitas={false}
              onAceitar={() => undefined}
              formaPorParcela
              exigirSomaExata
            />
            {(parcelasMexidas || parcelasDivergem) && (
              <button
                type="button"
                onClick={redistribuirIgualmente}
                style={{ fontSize: '12px', color: 'var(--accent-purple)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, width: 'fit-content' }}
              >
                Redistribuir igualmente
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', gap: '24px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text-primary)' }}>
                <input type="radio" checked={destinoPagamento === 'caixa'} onChange={() => setDestinoPagamento('caixa')} />
                Caixa físico
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text-primary)' }}>
                <input type="radio" checked={destinoPagamento === 'banco'} onChange={() => setDestinoPagamento('banco')} />
                Banco
              </label>
            </div>
            {destinoPagamento === 'banco' && (
              <div className="input-group" style={{ maxWidth: '320px' }}>
                <label style={labelStyle}>Banco *</label>
                <select value={bancoId} onChange={(e) => setBancoId(e.target.value)} className="form-select" style={inputStyle}>
                  <option value="">Selecione...</option>
                  {bancos.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
                </select>
              </div>
            )}
          </div>
        )}
        </>)}

        <div className="input-group">
          <label style={labelStyle}>Observação</label>
          <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
        </div>
      </div>

      <CadastroRapidoProdutoModal
        open={showCadastroProduto}
        nomeInicial={produtoBusca}
        venderPorEmbalagem={venderPorEmbalagem}
        onClose={() => setShowCadastroProduto(false)}
        onCriado={handleProdutoCriado}
      />
    </div>
  );
};

export default NotaAvulsaForm;
