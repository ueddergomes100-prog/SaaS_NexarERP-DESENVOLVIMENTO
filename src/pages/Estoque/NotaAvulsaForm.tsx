import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, PackagePlus, Plus, Save, Trash2 } from 'lucide-react';
import { collection, doc, onSnapshot, query, runTransaction, serverTimestamp, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showError, showSuccess } from '../../utils/alerts';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import {
  formatSequenceValue,
  getCurrentMaxSequence,
  getNextTenantSequenceValue,
  writeTenantSequenceValue,
} from '../../utils/firestoreAtomic';
import ClientAutocomplete from '../../components/common/ClientAutocomplete';
import ProductAutocomplete from '../../components/common/ProductAutocomplete';
import CadastroRapidoProdutoModal, { type ProdutoCadastradoRapido } from '../../components/common/CadastroRapidoProdutoModal';
import { calcularValorTotalNotaAvulsa, itemNotaAvulsaValido, quantidadeEstoqueNotaAvulsaItem, ratearValorPorPesos, type NotaAvulsaItem } from '../../utils/notaAvulsaDomain';
import { getDateInputInTimeZone, addMonthsToDateInput, formatDateInputPtBr } from '../../utils/dateTime';
import { toCents, splitCents } from '../../utils/financeDomain';
import { buildOpcoesUnidadeVenda, findOpcaoUnidadeVenda, toBaseQuantity, DEFAULT_VENDER_POR_EMBALAGEM } from '../../utils/embalagemDomain';
import { isValidSaleQuantity } from '../../utils/saleQuantity';

interface FornecedorBasico {
  id: string;
  nome: string;
  codigo?: string;
}

interface ProdutoBasico {
  id: string;
  nome: string;
  codigo?: string;
  categoria?: string;
  precoCusto?: number;
  precoVenda?: number;
  unidadeMedidaSigla?: string;
  unidadeMedidaCasasDecimais?: number;
  unidadeMedidaFracionado?: boolean;
  embalagens?: unknown;
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
  const [dataVencimento, setDataVencimento] = useState('');
  const [numeroParcelas, setNumeroParcelas] = useState('1');
  const [observacao, setObservacao] = useState('');

  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    const unsubscribe = onSnapshot(
      query(collection(db, 'fornecedores'), where('tenantId', '==', tenantId)),
      (snap) => setFornecedores(snap.docs.map((d) => ({ id: d.id, nome: d.data().nome || '', codigo: d.data().codigo }))),
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
    const unsubscribe = onSnapshot(
      query(collection(db, 'estoque'), where('tenantId', '==', tenantId)),
      (snap) => setProdutos(snap.docs.map((d) => ({
        id: d.id,
        nome: d.data().nome || '',
        codigo: d.data().codigo,
        categoria: d.data().categoria,
        precoCusto: Number(d.data().precoCusto) || 0,
        precoVenda: Number(d.data().precoVenda) || 0,
        unidadeMedidaSigla: d.data().unidadeMedidaSigla,
        unidadeMedidaCasasDecimais: d.data().unidadeMedidaCasasDecimais,
        unidadeMedidaFracionado: d.data().unidadeMedidaFracionado,
        embalagens: d.data().embalagens,
      }))),
      (error) => console.error('Erro ao carregar produtos:', error),
    );
    return unsubscribe;
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    const unsubscribe = onSnapshot(
      doc(db, 'configuracoes', tenantId),
      (snap) => setVenderPorEmbalagem(snap.data()?.venderPorEmbalagem ?? DEFAULT_VENDER_POR_EMBALAGEM),
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

  useEffect(() => {
    setDataVencimento(getDateInputInTimeZone());
  }, []);

  const valorItens = useMemo(() => calcularValorTotalNotaAvulsa(itens), [itens]);
  const freteValor = Number(frete.replace(',', '.')) || 0;
  const descontoValor = Number(desconto.replace(',', '.')) || 0;
  const valorTotal = Math.max(0, valorItens + freteValor - descontoValor);

  const numeroParcelasValido = Math.max(1, Number.parseInt(numeroParcelas, 10) || 1);

  /** Preview das parcelas (so exibicao) -- mesma divisao que vai rodar no
   * save: splitCents (financeDomain.ts, ja usado pra parcela de cartao)
   * garante soma exata; addMonthsToDateInput (dateTime.ts) espaca cada
   * parcela em 1 mes de calendario a partir da primeira, convencao padrao
   * de boleto (dia fixo do mes, nao "+30 dias corridos"). */
  const parcelasPreview = useMemo(() => {
    if (formaPagamento !== 'pendente' || numeroParcelasValido <= 1 || !dataVencimento) return [];
    const valoresCentavos = splitCents(toCents(valorTotal), numeroParcelasValido);
    return valoresCentavos.map((centavos, index) => ({
      numero: index + 1,
      valor: centavos / 100,
      data: index === 0 ? dataVencimento : addMonthsToDateInput(dataVencimento, index),
    }));
  }, [formaPagamento, numeroParcelasValido, dataVencimento, valorTotal]);

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
    if (!fornecedorSelecionado) {
      showError('Fornecedor obrigatório', 'Busque e selecione o fornecedor desta compra.');
      return;
    }
    const itensValidos = itens.filter(itemNotaAvulsaValido);
    if (itensValidos.length === 0) {
      showError('Nenhum item válido', 'Adicione ao menos um item com produto, quantidade e custo preenchidos.');
      return;
    }
    if (formaPagamento === 'pendente' && !dataVencimento) {
      showError('Data de vencimento obrigatória', 'Informe a data de vencimento do pagamento pendente.');
      return;
    }
    if (formaPagamento === 'a_vista' && destinoPagamento === 'banco' && !bancoId) {
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
    try {
      const currentMax = await getCurrentMaxSequence(db, 'notas_avulsas', tenantId, 'numero').catch(() => 0);
      const totalNota = Math.max(0, valorItensValidos + freteValor - descontoValor);
      const bancoNomeEscolhido = bancos.find((b) => b.id === bancoId)?.nome || '';
      const usaBanco = formaPagamento === 'a_vista' && destinoPagamento === 'banco';
      const numParcelasFinal = formaPagamento === 'pendente' ? numeroParcelasValido : 1;

      // Frete e desconto sao rateados entre os itens, proporcional ao valor
      // de cada um (quantidade x custo) -- e' o que faz o CMV (custo que
      // vai pro estoque) refletir o custo real da mercadoria entregue, nao
      // so o preco de tabela digitado por item.
      const pesosRateio = itensValidos.map((item) => item.quantidade * item.precoCusto);
      const freteRateadoPorItem = ratearValorPorPesos(freteValor, pesosRateio);
      const descontoRateadoPorItem = ratearValorPorPesos(descontoValor, pesosRateio);
      const itensComRateio: NotaAvulsaItem[] = itensValidos.map((item, index) => ({
        ...item,
        ...(freteValor > 0 ? { freteRateado: freteRateadoPorItem[index] } : {}),
        ...(descontoValor > 0 ? { descontoRateado: descontoRateadoPorItem[index] } : {}),
      }));

      await runTransaction(db, async (transaction) => {
        // 1. LEITURAS -- todas antes de qualquer escrita (regra do Firestore).
        const nextNumero = await getNextTenantSequenceValue(transaction, db, tenantId, 'notas_avulsas', currentMax);
        const bancoRef = usaBanco ? doc(db, 'bancos', bancoId) : null;
        const bancoSnap = bancoRef ? await transaction.get(bancoRef) : null;
        if (bancoRef && !bancoSnap?.exists()) {
          throw new Error('O banco selecionado não foi encontrado. Atualize a página e tente novamente.');
        }
        const saldoBancoCentavos = bancoSnap ? Number(bancoSnap.data()?.saldoCentavos || 0) : 0;

        // Agrupado por produto (nao por item): o mesmo produto pode entrar
        // duas vezes na nota, uma em cada unidade (KG e SC) -- sem agrupar,
        // a segunda escrita sobrescreveria a primeira em vez de somar, ja
        // que as duas leem o mesmo snapshot original.
        const incrementoPorProduto = new Map<string, { quantidadeBase: number; precoCusto: number }>();
        itensComRateio.forEach((item) => {
          const anterior = incrementoPorProduto.get(item.produtoId);
          // Custo unitario (na unidade escolhida) JA com a parte do
          // frete/desconto deste item embutida -- e' o CMV real, nao so o
          // preco de tabela digitado. So depois disso converte pra unidade
          // BASE do estoque (por kg, nao por saco): sem dividir pelo fator,
          // comprar em saco deixaria o custo por kg do produto 20x maior
          // que o real.
          const custoUnitarioComRateio = item.precoCusto
            + ((item.freteRateado || 0) - (item.descontoRateado || 0)) / item.quantidade;
          const precoCustoBase = item.fatorConversao ? custoUnitarioComRateio / item.fatorConversao : custoUnitarioComRateio;
          incrementoPorProduto.set(item.produtoId, {
            quantidadeBase: (anterior?.quantidadeBase || 0) + quantidadeEstoqueNotaAvulsaItem(item),
            precoCusto: precoCustoBase,
          });
        });
        const produtoRefs = Array.from(incrementoPorProduto.entries()).map(([produtoId, dados]) => ({
          produtoId, ref: doc(db, 'estoque', produtoId), ...dados,
        }));
        const produtoSnaps = await Promise.all(produtoRefs.map(({ ref }) => transaction.get(ref)));

        // 2. ESCRITAS.
        numeroFinal = formatSequenceValue(nextNumero, 4);
        writeTenantSequenceValue(transaction, db, tenantId, 'notas_avulsas', nextNumero);

        produtoRefs.forEach(({ ref, quantidadeBase, precoCusto }, index) => {
          const snap = produtoSnaps[index];
          // Produto apagado entre a busca e a confirmacao (bem raro): o item
          // fica registrado na nota do mesmo jeito, so nao ha estoque pra
          // incrementar -- melhor que travar a nota inteira por um item.
          if (!snap.exists()) return;
          const quantidadeAtualEstoque = Number(snap.data()?.quantidade || 0);
          transaction.update(ref, {
            quantidade: quantidadeAtualEstoque + quantidadeBase,
            precoCusto,
            updatedAt: serverTimestamp(),
          });
        });

        const notaRef = doc(collection(db, 'notas_avulsas'));

        // Parcela unica (a vista, ou pendente sem parcelar) e' um caso
        // particular de "1 parcela" -- monta sempre a lista de transacoes a
        // criar, pra nao duplicar a logica de campos entre os dois casos.
        const valoresParcelasCentavos = formaPagamento === 'pendente'
          ? splitCents(toCents(totalNota), numParcelasFinal)
          : [toCents(totalNota)];
        const transacoesParaCriar = valoresParcelasCentavos.map((valorCentavos, index) => ({
          ref: doc(collection(db, 'transacoes')),
          valorCentavos,
          data: formaPagamento === 'pendente'
            ? (index === 0 ? dataVencimento : addMonthsToDateInput(dataVencimento, index))
            : getDateInputInTimeZone(),
        }));
        const sufixoParcela = (index: number) => (numParcelasFinal > 1 ? ` (parcela ${index + 1}/${numParcelasFinal})` : '');

        if (formaPagamento === 'a_vista') {
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

          if (bancoRef) {
            transaction.update(bancoRef, {
              saldoCentavos: saldoBancoCentavos - toCents(totalNota),
              updatedAt: serverTimestamp(),
              ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Nota Avulsa #${numeroFinal}`),
            });
          }
        } else {
          transacoesParaCriar.forEach(({ ref, valorCentavos, data }, index) => {
            transaction.set(ref, {
              descricao: `Nota Avulsa #${numeroFinal} - ${fornecedorSelecionado.nome}${sufixoParcela(index)}`,
              categoria: 'FORNECEDORES DE PEÇAS',
              valor: valorCentavos / 100,
              valorCentavos,
              tipo: 'saida',
              status: 'Pendente',
              data,
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

        transaction.set(notaRef, {
          numero: numeroFinal,
          fornecedorId: fornecedorSelecionado.id,
          fornecedorNome: fornecedorSelecionado.nome,
          itens: itensComRateio,
          ...(freteValor > 0 ? { frete: freteValor } : {}),
          ...(descontoValor > 0 ? { desconto: descontoValor } : {}),
          valorTotal: totalNota,
          valorTotalCentavos: toCents(totalNota),
          formaPagamento,
          ...(formaPagamento === 'a_vista'
            ? { destinoPagamento, ...(destinoPagamento === 'banco' ? { bancoId, bancoNome: bancoNomeEscolhido } : {}) }
            : { dataVencimento }),
          transacaoId: transacoesParaCriar[0].ref.id,
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
          status: 'sucesso',
        });
      } catch (logError) {
        console.error('Erro ao registrar auditoria da nota avulsa:', logError);
      }

      showSuccess('Nota avulsa lançada com sucesso!');
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
          <button type="button" className="btn-secondary" onClick={() => setShowCadastroProduto(true)} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <PackagePlus size={16} /> Cadastrar Produto
          </button>
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
                <th style={{ padding: '10px', textAlign: 'right' }}>Venda Unit.</th>
                <th style={{ padding: '10px', textAlign: 'right' }}>Subtotal</th>
                <th style={{ padding: '10px', textAlign: 'center' }}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((item) => (
                <tr key={`${item.produtoId}::${item.embalagemId || ''}`} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '10px' }}>{item.produtoNome}</td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>
                    {item.quantidade} {item.unidadeSigla || ''}
                    {item.quantidadeBase !== undefined && (
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>({item.quantidadeBase} no estoque)</div>
                    )}
                  </td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.precoCusto)}</td>
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
            <input type="text" value={frete} onChange={(e) => setFrete(e.target.value)} placeholder="0,00" style={{ ...inputStyle, width: '110px', textAlign: 'right' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <label style={{ color: 'var(--text-secondary)' }}>Desconto (R$):</label>
            <input type="text" value={desconto} onChange={(e) => setDesconto(e.target.value)} placeholder="0,00" style={{ ...inputStyle, width: '110px', textAlign: 'right' }} />
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
            <div style={{ display: 'flex', gap: '16px' }}>
              <div className="input-group" style={{ maxWidth: '240px' }}>
                <label style={labelStyle}>{numeroParcelasValido > 1 ? 'Data da 1ª parcela *' : 'Data de vencimento *'}</label>
                <input type="date" value={dataVencimento} onChange={(e) => setDataVencimento(e.target.value)} style={inputStyle} />
              </div>
              <div className="input-group" style={{ maxWidth: '160px' }}>
                <label style={labelStyle}>Nº de parcelas (boleto)</label>
                <input type="number" min="1" step="1" value={numeroParcelas} onChange={(e) => setNumeroParcelas(e.target.value)} style={inputStyle} />
              </div>
            </div>

            {parcelasPreview.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px' }}>
                {parcelasPreview.map((parcela) => (
                  <div key={parcela.numero} style={{ display: 'flex', justifyContent: 'space-between', maxWidth: '320px', color: 'var(--text-secondary)' }}>
                    <span>Parcela {parcela.numero}/{parcelasPreview.length} — {formatDateInputPtBr(parcela.data)}</span>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(parcela.valor)}</span>
                  </div>
                ))}
              </div>
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
