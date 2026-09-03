import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, PackagePlus, Plus, Save, Trash2 } from 'lucide-react';
import { collection, doc, getDocs, query, runTransaction, serverTimestamp, where } from 'firebase/firestore';
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
import { calcularValorTotalNotaAvulsa, itemNotaAvulsaValido, type NotaAvulsaItem } from '../../utils/notaAvulsaDomain';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import { toCents } from '../../utils/financeDomain';

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
  const [showCadastroProduto, setShowCadastroProduto] = useState(false);

  const [itens, setItens] = useState<NotaAvulsaItem[]>([]);

  const [formaPagamento, setFormaPagamento] = useState<'a_vista' | 'pendente'>('pendente');
  const [destinoPagamento, setDestinoPagamento] = useState<'caixa' | 'banco'>('caixa');
  const [bancos, setBancos] = useState<BancoBasico[]>([]);
  const [bancoId, setBancoId] = useState('');
  const [dataVencimento, setDataVencimento] = useState('');
  const [observacao, setObservacao] = useState('');

  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    getDocs(query(collection(db, 'fornecedores'), where('tenantId', '==', tenantId)))
      .then((snap) => setFornecedores(snap.docs.map((d) => ({ id: d.id, nome: d.data().nome || '', codigo: d.data().codigo }))))
      .catch((error) => console.error('Erro ao carregar fornecedores:', error));
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    getDocs(query(collection(db, 'estoque'), where('tenantId', '==', tenantId)))
      .then((snap) => setProdutos(snap.docs.map((d) => ({
        id: d.id,
        nome: d.data().nome || '',
        codigo: d.data().codigo,
        categoria: d.data().categoria,
        precoCusto: Number(d.data().precoCusto) || 0,
        precoVenda: Number(d.data().precoVenda) || 0,
      }))))
      .catch((error) => console.error('Erro ao carregar produtos:', error));
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    getDocs(query(collection(db, 'bancos'), where('tenantId', '==', tenantId), where('ativo', '==', true)))
      .then((snap) => setBancos(snap.docs.map((d) => ({ id: d.id, nome: d.data().nome || '' }))))
      .catch((error) => console.error('Erro ao carregar bancos:', error));
  }, [tenantId]);

  useEffect(() => {
    setDataVencimento(getDateInputInTimeZone());
  }, []);

  const valorTotal = useMemo(() => calcularValorTotalNotaAvulsa(itens), [itens]);

  const adicionarItem = () => {
    if (!produtoSelecionado) {
      showError('Selecione um produto', 'Busque um produto do estoque na lista, ou cadastre um novo antes de adicionar.');
      return;
    }
    const quantidade = Number(quantidadeAtual.replace(',', '.'));
    const custo = Number(custoAtual.replace(',', '.'));
    const venda = Number(vendaAtual.replace(',', '.')) || 0;
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      showError('Quantidade inválida', 'Informe uma quantidade maior que zero.');
      return;
    }
    if (!Number.isFinite(custo) || custo <= 0) {
      showError('Custo inválido', 'Informe o valor de custo unitário deste item.');
      return;
    }

    setItens((atual) => {
      const existenteIndex = atual.findIndex((item) => item.produtoId === produtoSelecionado.id);
      if (existenteIndex >= 0) {
        const copia = [...atual];
        copia[existenteIndex] = { ...copia[existenteIndex], quantidade: copia[existenteIndex].quantidade + quantidade, precoCusto: custo, precoVenda: venda };
        return copia;
      }
      return [...atual, { produtoId: produtoSelecionado.id, produtoNome: produtoSelecionado.nome, quantidade, precoCusto: custo, precoVenda: venda }];
    });

    setProdutoBusca('');
    setProdutoSelecionado(null);
    setQuantidadeAtual('');
    setCustoAtual('');
    setVendaAtual('');
  };

  const removerItem = (produtoId: string) => {
    setItens((atual) => atual.filter((item) => item.produtoId !== produtoId));
  };

  const handleProdutoCriado = (produto: ProdutoCadastradoRapido) => {
    const novo: ProdutoBasico = { id: produto.id, nome: produto.nome, codigo: produto.codigo, precoCusto: 0, precoVenda: 0 };
    setProdutos((atual) => [...atual, novo]);
    setProdutoBusca(produto.nome);
    setProdutoSelecionado(novo);
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

    setIsSaving(true);
    let numeroFinal = '';
    try {
      const currentMax = await getCurrentMaxSequence(db, 'notas_avulsas', tenantId, 'numero').catch(() => 0);
      const totalNota = calcularValorTotalNotaAvulsa(itensValidos);
      const bancoNomeEscolhido = bancos.find((b) => b.id === bancoId)?.nome || '';
      const usaBanco = formaPagamento === 'a_vista' && destinoPagamento === 'banco';

      await runTransaction(db, async (transaction) => {
        // 1. LEITURAS -- todas antes de qualquer escrita (regra do Firestore).
        const nextNumero = await getNextTenantSequenceValue(transaction, db, tenantId, 'notas_avulsas', currentMax);
        const bancoRef = usaBanco ? doc(db, 'bancos', bancoId) : null;
        const bancoSnap = bancoRef ? await transaction.get(bancoRef) : null;
        if (bancoRef && !bancoSnap?.exists()) {
          throw new Error('O banco selecionado não foi encontrado. Atualize a página e tente novamente.');
        }
        const saldoBancoCentavos = bancoSnap ? Number(bancoSnap.data()?.saldoCentavos || 0) : 0;

        const produtoRefs = itensValidos.map((item) => ({ item, ref: doc(db, 'estoque', item.produtoId) }));
        const produtoSnaps = await Promise.all(produtoRefs.map(({ ref }) => transaction.get(ref)));

        // 2. ESCRITAS.
        numeroFinal = formatSequenceValue(nextNumero, 4);
        writeTenantSequenceValue(transaction, db, tenantId, 'notas_avulsas', nextNumero);

        produtoRefs.forEach(({ item, ref }, index) => {
          const snap = produtoSnaps[index];
          // Produto apagado entre a busca e a confirmacao (bem raro): o item
          // fica registrado na nota do mesmo jeito, so nao ha estoque pra
          // incrementar -- melhor que travar a nota inteira por um item.
          if (!snap.exists()) return;
          const quantidadeAtualEstoque = Number(snap.data()?.quantidade || 0);
          transaction.update(ref, {
            quantidade: quantidadeAtualEstoque + item.quantidade,
            precoCusto: item.precoCusto,
            updatedAt: serverTimestamp(),
          });
        });

        const notaRef = doc(collection(db, 'notas_avulsas'));
        const transacaoRef = doc(collection(db, 'transacoes'));

        if (formaPagamento === 'a_vista') {
          transaction.set(transacaoRef, {
            descricao: `Nota Avulsa #${numeroFinal} - ${fornecedorSelecionado.nome}`,
            categoria: 'FORNECEDORES DE PEÇAS',
            valor: totalNota,
            valorCentavos: toCents(totalNota),
            tipo: 'saida',
            status: 'Paga',
            data: getDateInputInTimeZone(),
            dataPagamento: getDateInputInTimeZone(),
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
          transaction.set(transacaoRef, {
            descricao: `Nota Avulsa #${numeroFinal} - ${fornecedorSelecionado.nome}`,
            categoria: 'FORNECEDORES DE PEÇAS',
            valor: totalNota,
            valorCentavos: toCents(totalNota),
            tipo: 'saida',
            status: 'Pendente',
            data: dataVencimento,
            fornecedorId: fornecedorSelecionado.id,
            fornecedorNome: fornecedorSelecionado.nome,
            notaAvulsaId: notaRef.id,
            tenantId,
            createdAt: serverTimestamp(),
            ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
          });
        }

        transaction.set(notaRef, {
          numero: numeroFinal,
          fornecedorId: fornecedorSelecionado.id,
          fornecedorNome: fornecedorSelecionado.nome,
          itens: itensValidos,
          valorTotal: totalNota,
          valorTotalCentavos: toCents(totalNota),
          formaPagamento,
          ...(formaPagamento === 'a_vista'
            ? { destinoPagamento, ...(destinoPagamento === 'banco' ? { bancoId, bancoNome: bancoNomeEscolhido } : {}) }
            : { dataVencimento }),
          transacaoId: transacaoRef.id,
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

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto', gap: '12px', alignItems: 'flex-end' }}>
          <div className="input-group" style={{ position: 'relative' }}>
            <label style={labelStyle}>Produto</label>
            <ProductAutocomplete
              value={produtoBusca}
              products={produtos}
              onChange={(value) => {
                setProdutoBusca(value);
                const existe = produtos.find((p) => p.nome.toLowerCase() === value.toLowerCase() || p.codigo === value);
                setProdutoSelecionado(existe || null);
              }}
              onSelect={(p) => {
                setProdutoBusca(p.nome);
                setProdutoSelecionado(p);
                if (p.precoCusto) setCustoAtual(String(p.precoCusto));
                if (p.precoVenda) setVendaAtual(String(p.precoVenda));
              }}
              placeholder="Busque um produto do estoque..."
              ariaLabel="Buscar produto"
              renderItem={(p) => (<><span>{p.codigo ? `#${p.codigo} — ${p.nome}` : p.nome}</span><span style={{ color: 'var(--text-muted)' }}>{p.categoria}</span></>)}
            />
          </div>
          <div className="input-group">
            <label style={labelStyle}>Quantidade</label>
            <input type="number" min="0" step="any" value={quantidadeAtual} onChange={(e) => setQuantidadeAtual(e.target.value)} style={inputStyle} />
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
                <tr key={item.produtoId} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '10px' }}>{item.produtoNome}</td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>{item.quantidade}</td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.precoCusto)}</td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.precoVenda)}</td>
                  <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600 }}>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.quantidade * item.precoCusto)}</td>
                  <td style={{ padding: '10px', textAlign: 'center' }}>
                    <button type="button" onClick={() => removerItem(item.produtoId)} className="icon-btn" title="Remover item" style={{ color: '#ef4444' }}>
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: '18px', fontWeight: 700 }}>
          Total: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valorTotal)}
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
          <div className="input-group" style={{ maxWidth: '240px' }}>
            <label style={labelStyle}>Data de vencimento *</label>
            <input type="date" value={dataVencimento} onChange={(e) => setDataVencimento(e.target.value)} style={inputStyle} />
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
        onClose={() => setShowCadastroProduto(false)}
        onCriado={handleProdutoCriado}
      />
    </div>
  );
};

export default NotaAvulsaForm;
