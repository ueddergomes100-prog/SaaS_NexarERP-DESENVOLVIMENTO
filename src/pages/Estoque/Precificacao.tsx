import React, { useEffect, useMemo, useState } from 'react';
import { Check, FileInput, Percent, Save, Tags, Trash2, X } from 'lucide-react';
import { collection, doc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showError, showSuccess, showWarning } from '../../utils/alerts';
import { buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import ProductAutocomplete from '../../components/common/ProductAutocomplete';
import {
  compararMargem,
  margemMarkup,
  montarAtualizacaoPreco,
  precoParaMargem,
  type LinhaPrecificacao,
} from '../../utils/precificacaoDomain';
import { formatDateInputPtBr } from '../../utils/dateTime';

/** O que a tela precisa saber de cada produto do estoque. Fica num mapa por
 * id: e' a fonte dos valores originais (pra saber o que mudou no save) e do
 * custo, que aqui e' sempre so leitura. */
interface ProdutoPrecificacao {
  id: string;
  nome: string;
  codigo?: string;
  categoria?: string;
  precoCusto: number;
  precoVenda: number;
  precoPromocional: number;
  precoAVista?: number | null;
  precoAPrazo?: number | null;
  custoNaUltimaPrecificacao?: number | null;
}

/** A linha da grade e' a linha do dominio mais a margem, que so existe na
 * tela: ela e' derivada do preco, mas precisa de campo proprio pra pessoa
 * conseguir digitar "8" a caminho de "80" sem o valor pular. */
type LinhaGrade = LinhaPrecificacao & { margem: string };

interface NotaParaImportar {
  id: string;
  titulo: string;
  subtitulo: string;
  produtoIds: string[];
}

const LOTE_MAXIMO = 400;

const inputStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-md)', padding: '6px 8px', color: 'var(--text-primary)',
  width: '100%', textAlign: 'right', fontSize: '13px',
};

const formatBRL = (valor: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
const paraCampo = (valor: number | null | undefined) => (valor === null || valor === undefined ? '' : String(valor));

const Precificacao: React.FC = () => {
  const { currentUser, tenantId } = useAuth();

  const [produtos, setProdutos] = useState<Map<string, ProdutoPrecificacao>>(new Map());
  const [carregando, setCarregando] = useState(true);
  const [buscaProduto, setBuscaProduto] = useState('');

  const [linhas, setLinhas] = useState<LinhaGrade[]>([]);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [margemLote, setMargemLote] = useState('');

  const [modalImportacao, setModalImportacao] = useState<null | 'avulsa' | 'fiscal'>(null);
  const [notasParaImportar, setNotasParaImportar] = useState<NotaParaImportar[]>([]);
  const [carregandoNotas, setCarregandoNotas] = useState(false);

  const [isSaving, setIsSaving] = useState(false);

  // Leitura unica (nao onSnapshot) de proposito: se uma compra mudasse o
  // custo enquanto a pessoa digita, a grade se reescreveria embaixo dela.
  // Depois de salvar, a tela atualiza o mapa com o que acabou de gravar.
  useEffect(() => {
    if (!tenantId) return;
    setCarregando(true);
    getDocs(query(collection(db, 'estoque'), where('tenantId', '==', tenantId)))
      .then((snap) => {
        const mapa = new Map<string, ProdutoPrecificacao>();
        snap.docs.forEach((d) => {
          const data = d.data();
          mapa.set(d.id, {
            id: d.id,
            nome: data.nome || '',
            codigo: data.codigo,
            categoria: data.categoria,
            // Produto legado guarda preco no objeto `precos`, nao nos campos
            // planos -- mesmo fallback que EstoqueForm.tsx usa ao carregar.
            precoCusto: Number(data.precoCusto ?? data.precos?.custo ?? 0),
            precoVenda: Number(data.precoVenda ?? data.precos?.venda ?? 0),
            precoPromocional: Number(data.precoPromocional ?? data.precos?.promocional ?? 0),
            precoAVista: data.precoAVista ?? data.precos?.aVista ?? null,
            precoAPrazo: data.precoAPrazo ?? data.precos?.aPrazo ?? null,
            custoNaUltimaPrecificacao: data.custoNaUltimaPrecificacao ?? null,
          });
        });
        setProdutos(mapa);
      })
      .catch((error) => {
        console.error('Erro ao carregar produtos:', error);
        showError('Erro ao carregar produtos', 'Não foi possível carregar o estoque. Atualize a página e tente novamente.');
      })
      .finally(() => setCarregando(false));
  }, [tenantId]);

  const produtosLista = useMemo(() => Array.from(produtos.values()), [produtos]);

  const linhaDoProduto = (produto: ProdutoPrecificacao): LinhaGrade => ({
    produtoId: produto.id,
    produtoNome: produto.nome,
    custoAtual: produto.precoCusto,
    custoNaUltimaPrecificacao: produto.custoNaUltimaPrecificacao,
    precoVenda: paraCampo(produto.precoVenda),
    precoAVista: paraCampo(produto.precoAVista),
    precoAPrazo: paraCampo(produto.precoAPrazo),
    precoPromocional: paraCampo(produto.precoPromocional),
    margem: produto.precoCusto > 0 ? margemMarkup(produto.precoVenda, produto.precoCusto).toFixed(1) : '',
  });

  const adicionarProdutos = (ids: string[]) => {
    const novos: LinhaGrade[] = [];
    let jaNaGrade = 0;
    let semCadastro = 0;

    setLinhas((atual) => {
      const existentes = new Set(atual.map((l) => l.produtoId));
      ids.forEach((id) => {
        if (existentes.has(id)) { jaNaGrade += 1; return; }
        const produto = produtos.get(id);
        if (!produto) { semCadastro += 1; return; }
        existentes.add(id);
        novos.push(linhaDoProduto(produto));
      });
      return [...atual, ...novos];
    });

    if (semCadastro > 0) {
      showWarning(`${semCadastro} item da nota não está mais no estoque e ficou de fora da lista.`);
    } else if (novos.length === 0 && jaNaGrade > 0) {
      showWarning('Todos os produtos dessa nota já estavam na lista.');
    }
  };

  const atualizarLinha = (produtoId: string, patch: Partial<LinhaGrade>) => {
    setLinhas((atual) => atual.map((linha) => (linha.produtoId === produtoId ? { ...linha, ...patch } : linha)));
  };

  /** Preco e margem andam juntos: mexer num reescreve o outro. Mesma
   * mecanica do card de margem do cadastro do produto. */
  const digitarMargem = (linha: LinhaGrade, valor: string) => {
    const margem = Number(valor.replace(',', '.'));
    const patch: Partial<LinhaGrade> = { margem: valor };
    if (linha.custoAtual > 0 && Number.isFinite(margem)) {
      patch.precoVenda = precoParaMargem(linha.custoAtual, margem).toFixed(2);
    }
    atualizarLinha(linha.produtoId, patch);
  };

  const digitarPrecoVenda = (linha: LinhaGrade, valor: string) => {
    const preco = Number(valor.replace(',', '.'));
    const patch: Partial<LinhaGrade> = { precoVenda: valor };
    if (linha.custoAtual > 0 && Number.isFinite(preco)) {
      patch.margem = margemMarkup(preco, linha.custoAtual).toFixed(1);
    }
    atualizarLinha(linha.produtoId, patch);
  };

  const alternarSelecao = (produtoId: string) => {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(produtoId)) novo.delete(produtoId); else novo.add(produtoId);
      return novo;
    });
  };

  const todosSelecionados = linhas.length > 0 && selecionados.size === linhas.length;
  const alternarTodos = () => {
    setSelecionados(todosSelecionados ? new Set() : new Set(linhas.map((l) => l.produtoId)));
  };

  /** Aplica a margem nos selecionados -- so preenche a grade, nao grava
   * nada. Quem grava e' o botao "Salvar preços". */
  const aplicarMargemEmLote = () => {
    const margem = Number(margemLote.replace(',', '.'));
    if (!Number.isFinite(margem)) {
      showError('Margem inválida', 'Informe a margem em porcentagem, por exemplo 30.');
      return;
    }
    if (selecionados.size === 0) {
      showError('Nenhum produto selecionado', 'Marque os produtos que devem receber essa margem.');
      return;
    }

    let semCusto = 0;
    setLinhas((atual) => atual.map((linha) => {
      if (!selecionados.has(linha.produtoId)) return linha;
      if (!(linha.custoAtual > 0)) { semCusto += 1; return linha; }
      return {
        ...linha,
        margem: String(margem),
        precoVenda: precoParaMargem(linha.custoAtual, margem).toFixed(2),
      };
    }));

    if (semCusto > 0) {
      showWarning(`${semCusto} produto ficou sem alteração por não ter custo cadastrado — compre ou informe o custo antes de precificar pela margem.`);
    }
  };

  const abrirImportacao = async (origem: 'avulsa' | 'fiscal') => {
    if (!tenantId) return;
    setModalImportacao(origem);
    setCarregandoNotas(true);
    try {
      if (origem === 'avulsa') {
        const snap = await getDocs(query(collection(db, 'notas_avulsas'), where('tenantId', '==', tenantId)));
        const lista = snap.docs
          .filter((d) => d.data().status === 'ativa')
          .map((d) => {
            const data = d.data();
            const itens: Array<{ produtoId?: string }> = Array.isArray(data.itens) ? data.itens : [];
            return {
              id: d.id,
              titulo: `Nota Avulsa #${data.numero || '—'}`,
              subtitulo: `${data.fornecedorNome || 'Sem fornecedor'} · ${itens.length} ${itens.length === 1 ? 'item' : 'itens'} · ${formatBRL(Number(data.valorTotal || 0))}`,
              produtoIds: itens.map((item) => String(item.produtoId || '')).filter(Boolean),
            };
          })
          .sort((a, b) => b.titulo.localeCompare(a.titulo, 'pt-BR', { numeric: true }));
        setNotasParaImportar(lista);
      } else {
        const snap = await getDocs(query(collection(db, 'notas_fiscais_entrada'), where('tenantId', '==', tenantId)));
        const lista = snap.docs
          .filter((d) => d.data().status === 'ativa')
          .map((d) => {
            const data = d.data();
            const itens: Array<{ itemId?: string; tipo?: string }> = Array.isArray(data.itens) ? data.itens : [];
            // So itens de revenda: `itemId` de materia-prima aponta pra
            // `materias_primas`, que nem tem preco de venda pra precificar.
            const idsRevenda = itens
              .filter((item) => item.tipo === 'revenda')
              .map((item) => String(item.itemId || ''))
              .filter(Boolean);
            return {
              id: d.id,
              titulo: `NF-e ${data.numeroNF || '—'}`,
              subtitulo: `${data.fornecedorNome || 'Sem fornecedor'} · ${formatDateInputPtBr(data.dataEmissao)} · ${idsRevenda.length} ${idsRevenda.length === 1 ? 'item de revenda' : 'itens de revenda'}`,
              produtoIds: idsRevenda,
            };
          })
          .sort((a, b) => b.titulo.localeCompare(a.titulo, 'pt-BR', { numeric: true }));
        setNotasParaImportar(lista);
      }
    } catch (error) {
      console.error('Erro ao carregar notas:', error);
      showError('Erro ao carregar notas', 'Não foi possível listar as notas. Atualize a página e tente novamente.');
      setModalImportacao(null);
    } finally {
      setCarregandoNotas(false);
    }
  };

  const importarNota = (nota: NotaParaImportar) => {
    if (nota.produtoIds.length === 0) {
      showWarning('Essa nota não tem nenhum produto de revenda para precificar.');
      return;
    }
    adicionarProdutos(nota.produtoIds);
    setModalImportacao(null);
  };

  const handleSalvar = async () => {
    if (!currentUser || !tenantId) return;

    const agoraIso = new Date().toISOString();
    const alteracoes = linhas
      .map((linha) => {
        const original = produtos.get(linha.produtoId);
        if (!original) return null;
        const resultado = montarAtualizacaoPreco(linha, {
          precoVenda: original.precoVenda,
          precoPromocional: original.precoPromocional,
          precoAVista: original.precoAVista,
          precoAPrazo: original.precoAPrazo,
        }, agoraIso);
        return resultado.semMudanca ? null : { linha, resultado };
      })
      .filter((item): item is { linha: LinhaGrade; resultado: ReturnType<typeof montarAtualizacaoPreco> } => item !== null);

    if (alteracoes.length === 0) {
      showWarning('Nenhum preço foi alterado — não há o que salvar.');
      return;
    }

    setIsSaving(true);
    try {
      // Lotes de 400 (o limite do Firestore e' 500) -- mesmo padrao da
      // importacao de produtos. Lote ja gravado permanece se o seguinte
      // falhar; a mensagem de erro avisa quantos entraram.
      let gravados = 0;
      for (let inicio = 0; inicio < alteracoes.length; inicio += LOTE_MAXIMO) {
        const lote = alteracoes.slice(inicio, inicio + LOTE_MAXIMO);
        const batch = writeBatch(db);
        lote.forEach(({ linha, resultado }) => {
          batch.update(doc(db, 'estoque', linha.produtoId), {
            ...resultado.campos,
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Preço alterado na tela de Precificação'),
          });
        });
        await batch.commit();
        gravados += lote.length;
      }

      // Atualiza o mapa local com o que acabou de ser gravado, pra coluna
      // "Situação" e o "o que mudou" do proximo save partirem do estado novo
      // sem precisar recarregar a tela.
      setProdutos((atual) => {
        const novo = new Map(atual);
        alteracoes.forEach(({ linha, resultado }) => {
          const anterior = novo.get(linha.produtoId);
          if (!anterior) return;
          novo.set(linha.produtoId, {
            ...anterior,
            precoVenda: Number(resultado.campos.precoVenda ?? anterior.precoVenda),
            precoPromocional: Number(resultado.campos.precoPromocional ?? anterior.precoPromocional),
            precoAVista: resultado.campos.precoAVista !== undefined ? Number(resultado.campos.precoAVista) : anterior.precoAVista,
            precoAPrazo: resultado.campos.precoAPrazo !== undefined ? Number(resultado.campos.precoAPrazo) : anterior.precoAPrazo,
            custoNaUltimaPrecificacao: resultado.mudouPrecoVenda
              ? linha.custoAtual
              : anterior.custoNaUltimaPrecificacao,
          });
        });
        return novo;
      });
      setLinhas((atual) => atual.map((linha) => {
        const alterada = alteracoes.find((a) => a.linha.produtoId === linha.produtoId);
        return alterada?.resultado.mudouPrecoVenda
          ? { ...linha, custoNaUltimaPrecificacao: linha.custoAtual }
          : linha;
      }));

      showSuccess(`${gravados} ${gravados === 1 ? 'produto atualizado' : 'produtos atualizados'} com sucesso!`);
    } catch (error) {
      console.error('Erro ao salvar preços:', error);
      showError('Erro ao salvar preços', 'Não foi possível gravar todos os preços. Confira a lista e tente novamente — os produtos já gravados permanecem.');
    } finally {
      setIsSaving(false);
    }
  };

  const totalComMudanca = useMemo(() => {
    const agoraIso = new Date().toISOString();
    return linhas.filter((linha) => {
      const original = produtos.get(linha.produtoId);
      if (!original) return false;
      return !montarAtualizacaoPreco(linha, {
        precoVenda: original.precoVenda,
        precoPromocional: original.precoPromocional,
        precoAVista: original.precoAVista,
        precoAPrazo: original.precoAPrazo,
      }, agoraIso).semMudanca;
    }).length;
  }, [linhas, produtos]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Tags size={28} color="var(--accent-purple)" />
            Precificação
          </h1>
          <p style={{ color: 'var(--text-muted)' }}>
            Defina preço e margem de vários produtos de uma vez. O custo vem das compras e não é editável aqui.
          </p>
        </div>
        <button
          className="btn-primary"
          onClick={() => void handleSalvar()}
          disabled={isSaving || totalComMudanca === 0}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: isSaving || totalComMudanca === 0 ? 0.6 : 1 }}
        >
          <Save size={18} /> {isSaving ? 'Salvando...' : `Salvar preços (${totalComMudanca})`}
        </button>
      </div>

      <div className="card" style={{ padding: '20px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px', minWidth: '260px', position: 'relative' }}>
            <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Adicionar produto</label>
            <ProductAutocomplete
              value={buscaProduto}
              products={produtosLista}
              onChange={setBuscaProduto}
              onSelect={(produto) => { adicionarProdutos([produto.id]); setBuscaProduto(''); }}
              placeholder="Busque pelo nome ou código..."
              ariaLabel="Buscar produto para precificar"
              renderItem={(p) => (
                <>
                  <span>{p.codigo ? `#${p.codigo} — ${p.nome}` : p.nome}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{p.categoria}</span>
                </>
              )}
            />
          </div>
          <button type="button" className="btn-secondary" onClick={() => void abrirImportacao('avulsa')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileInput size={16} /> Importar Nota Avulsa
          </button>
          <button type="button" className="btn-secondary" onClick={() => void abrirImportacao('fiscal')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileInput size={16} /> Importar Nota Fiscal
          </button>
        </div>

        {selecionados.size > 0 && (
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', padding: '12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', flexWrap: 'wrap' }}>
            <Percent size={16} color="var(--accent-purple)" />
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Aplicar margem de</span>
            <input
              type="text"
              value={margemLote}
              onChange={(e) => setMargemLote(e.target.value)}
              placeholder="30"
              style={{ ...inputStyle, width: '80px' }}
            />
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>% em</span>
            <button type="button" className="btn-primary" onClick={aplicarMargemEmLote} style={{ padding: '6px 14px' }}>
              {selecionados.size} {selecionados.size === 1 ? 'produto selecionado' : 'produtos selecionados'}
            </button>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Só preenche a grade — nada é gravado até você salvar.
            </span>
          </div>
        )}

        {carregando ? (
          <p style={{ color: 'var(--text-muted)', padding: '20px', textAlign: 'center' }}>Carregando produtos...</p>
        ) : linhas.length === 0 ? (
          <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <Tags size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
            <p>Nenhum produto na lista ainda.</p>
            <p style={{ fontSize: '13px' }}>Busque um produto acima ou importe os itens de uma nota.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase' }}>
                  <th style={{ padding: '10px', width: '36px' }}>
                    <input type="checkbox" checked={todosSelecionados} onChange={alternarTodos} aria-label="Selecionar todos" />
                  </th>
                  <th style={{ padding: '10px' }}>Produto</th>
                  <th style={{ padding: '10px', textAlign: 'right' }}>Custo</th>
                  <th style={{ padding: '10px', textAlign: 'right', width: '100px' }}>Margem %</th>
                  <th style={{ padding: '10px', textAlign: 'right', width: '120px' }}>Preço venda</th>
                  <th style={{ padding: '10px', textAlign: 'right', width: '110px' }}>À vista</th>
                  <th style={{ padding: '10px', textAlign: 'right', width: '110px' }}>A prazo</th>
                  <th style={{ padding: '10px', textAlign: 'right', width: '110px' }}>Promocional</th>
                  <th style={{ padding: '10px' }}>Situação</th>
                  <th style={{ padding: '10px', width: '44px' }} />
                </tr>
              </thead>
              <tbody>
                {linhas.map((linha) => {
                  const comparacao = compararMargem(
                    Number(linha.precoVenda.replace(',', '.')) || 0,
                    linha.custoNaUltimaPrecificacao,
                    linha.custoAtual,
                  );
                  return (
                    <tr key={linha.produtoId} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '10px' }}>
                        <input
                          type="checkbox"
                          checked={selecionados.has(linha.produtoId)}
                          onChange={() => alternarSelecao(linha.produtoId)}
                          aria-label={`Selecionar ${linha.produtoNome}`}
                        />
                      </td>
                      <td style={{ padding: '10px', fontSize: '13px' }}>{linha.produtoNome}</td>
                      <td style={{ padding: '10px', textAlign: 'right', fontSize: '13px', color: 'var(--text-secondary)' }}>
                        {linha.custoAtual > 0 ? formatBRL(linha.custoAtual) : (
                          <span title="Produto sem custo — compre ou informe o custo no cadastro para precificar pela margem.">—</span>
                        )}
                      </td>
                      <td style={{ padding: '10px' }}>
                        <input
                          type="text"
                          value={linha.margem}
                          onChange={(e) => digitarMargem(linha, e.target.value)}
                          disabled={!(linha.custoAtual > 0)}
                          style={inputStyle}
                        />
                      </td>
                      <td style={{ padding: '10px' }}>
                        <input
                          type="text"
                          value={linha.precoVenda}
                          onChange={(e) => digitarPrecoVenda(linha, e.target.value)}
                          style={{ ...inputStyle, fontWeight: 600 }}
                        />
                      </td>
                      <td style={{ padding: '10px' }}>
                        <input
                          type="text"
                          value={linha.precoAVista}
                          onChange={(e) => atualizarLinha(linha.produtoId, { precoAVista: e.target.value })}
                          style={inputStyle}
                        />
                      </td>
                      <td style={{ padding: '10px' }}>
                        <input
                          type="text"
                          value={linha.precoAPrazo}
                          onChange={(e) => atualizarLinha(linha.produtoId, { precoAPrazo: e.target.value })}
                          style={inputStyle}
                        />
                      </td>
                      <td style={{ padding: '10px' }}>
                        <input
                          type="text"
                          value={linha.precoPromocional}
                          onChange={(e) => atualizarLinha(linha.produtoId, { precoPromocional: e.target.value })}
                          style={inputStyle}
                        />
                      </td>
                      <td style={{ padding: '10px', fontSize: '12px' }}>
                        {!comparacao || comparacao.direcao === 'manteve' ? (
                          <span style={{ color: 'var(--text-muted)' }}>—</span>
                        ) : (
                          <span
                            style={{ color: comparacao.direcao === 'caiu' ? '#ef4444' : '#10b981', fontWeight: 600 }}
                            title={`Quando o preço foi definido o custo era ${formatBRL(Number(linha.custoNaUltimaPrecificacao || 0))} (${comparacao.margemAnterior.toFixed(1).replace('.', ',')}%). Hoje o custo é ${formatBRL(linha.custoAtual)}.`}
                          >
                            {comparacao.direcao === 'caiu' ? '↓ caiu' : '↑ subiu'} para {comparacao.margemAtual.toFixed(1).replace('.', ',')}%
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '10px', textAlign: 'center' }}>
                        <button
                          type="button"
                          className="icon-btn"
                          title="Tirar da lista"
                          onClick={() => {
                            setLinhas((atual) => atual.filter((l) => l.produtoId !== linha.produtoId));
                            setSelecionados((atual) => {
                              const novo = new Set(atual);
                              novo.delete(linha.produtoId);
                              return novo;
                            });
                          }}
                          style={{ color: '#ef4444' }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalImportacao && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 1300,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
        }}>
          <div className="card" style={{
            backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
            width: '100%', maxWidth: '560px', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>
                {modalImportacao === 'avulsa' ? 'Importar de uma Nota Avulsa' : 'Importar de uma Nota Fiscal'}
              </h2>
              <button type="button" onClick={() => setModalImportacao(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={22} />
              </button>
            </div>
            <div style={{ padding: '16px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 8px' }}>
                A nota só escolhe quais produtos entram na lista. Os valores mostrados são sempre os atuais do cadastro.
              </p>
              {carregandoNotas ? (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '24px' }}>Carregando notas...</p>
              ) : notasParaImportar.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '24px' }}>
                  Nenhuma nota ativa encontrada.
                </p>
              ) : (
                notasParaImportar.map((nota) => (
                  <button
                    key={nota.id}
                    type="button"
                    onClick={() => importarNota(nota)}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px',
                      padding: '12px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    <span>
                      <strong style={{ fontSize: '14px' }}>{nota.titulo}</strong>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{nota.subtitulo}</div>
                    </span>
                    <Check size={18} color="var(--accent-purple)" />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Precificacao;
