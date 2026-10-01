import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { AlertTriangle, ArrowLeft, Loader2, Plus, Power, Save, Tag, Trash2 } from 'lucide-react';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import ProductAutocomplete from '../../components/common/ProductAutocomplete';
import { NexusSwal, showError, showSuccess } from '../../utils/alerts';
import { erroDeAcessoNegado } from '../../utils/erroFirestoreDomain';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import { alterarSituacaoDaPromocao, salvarPromocao, vendidoNaPromocao } from '../../services/promocaoService';
import {
  DIAS_DA_SEMANA,
  lerPromocao,
  margemDaPromocao,
  precoBaseDaPromocao,
  precoPromocionalDoItem,
  ROTULO_STATUS_PROMOCAO,
  statusDaPromocao,
  type ItemPromocao,
  type Promocao,
  type TipoPrecoPromocao,
} from '../../utils/promocaoDomain';

/**
 * CADASTRO DE UMA PROMOCAO (2026-10-01; modelo: Uniplus). Cabecalho (nome,
 * periodo ou continua, dias da semana, formas de pagamento, limite por venda)
 * e os produtos -- um a um, ou de uma vez por categoria/marca/fornecedor --
 * com preco fixo ou % e a quota. Mostra preco atual, custo e % de lucro com a
 * promocao, e avisa quando fica abaixo do custo. Regra: promocaoDomain.ts.
 */

interface ProdutoDoEstoque {
  id: string;
  nome: string;
  codigo?: string;
  codigoBarras?: string;
  categoria?: string;
  marca?: string;
  fornecedor?: string;
  precoVenda?: number;
  precoAVista?: number;
  precoCusto?: number;
  ativo?: boolean;
  statusAtivo?: boolean;
  produtoRevenda?: boolean;
}

const moeda = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
const numero = (texto: string): number => {
  const n = Number(String(texto).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const textoDoNumero = (v: number | null | undefined) => (v ? String(v).replace('.', ',') : '');

const estiloCampo: React.CSSProperties = {
  padding: '10px 12px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', width: '100%', boxSizing: 'border-box',
};
const estiloCartao: React.CSSProperties = { padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' };
const estiloRotulo: React.CSSProperties = { fontSize: '13px', color: 'var(--text-secondary)' };

const promocaoVazia = (): Promocao => ({
  nome: '', individual: false, dataInicio: getDateInputInTimeZone(), dataFim: '', continua: false, inativa: false,
  diasSemana: [], formas: 'todas', limitePorVenda: null, observacao: '', itens: [],
});

const mensagemDoErro = (erro: unknown, padrao: string): string => {
  if (erroDeAcessoNegado(erro)) return 'Você não tem permissão para alterar promoções. Peça ao administrador a permissão "Vendas: Promoções".';
  if ((erro as { code?: string })?.code) return padrao;
  return (erro as Error)?.message || padrao;
};

const PromocaoForm: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const { currentUser, tenantId } = useAuth();
  const { items: todosProdutos } = useTenantCollection<ProdutoDoEstoque>('estoque', tenantId);
  const produtos = useMemo(() => todosProdutos.filter((p) => p.produtoRevenda !== false && (p.ativo ?? p.statusAtivo ?? true) !== false), [todosProdutos]);
  const porId = useMemo(() => new Map(produtos.map((p) => [p.id, p])), [produtos]);

  const [promocao, setPromocao] = useState<Promocao>(promocaoVazia);
  const [carregando, setCarregando] = useState(Boolean(id));
  const [salvando, setSalvando] = useState(false);
  const [busca, setBusca] = useState('');
  // O autocomplete trava depois de escolher (padrao do pedido); aqui cada escolha
  // ja' vira item, entao o campo e' recriado limpo para a proxima busca.
  const [chaveBusca, setChaveBusca] = useState(0);
  const [vendido, setVendido] = useState<Record<string, number>>({});
  const [lote, setLote] = useState<{ campo: 'categoria' | 'marca' | 'fornecedor'; valor: string }>({ campo: 'categoria', valor: '' });
  const [paraTodos, setParaTodos] = useState<{ tipo: TipoPrecoPromocao; valor: string; quota: string }>({ tipo: 'percentual', valor: '', quota: '' });

  useEffect(() => {
    if (!id || !tenantId) return;
    getDoc(doc(db, 'promocoes', id))
      .then(async (snap) => {
        if (!snap.exists() || snap.data().tenantId !== tenantId) {
          showError('Promoção não encontrada', 'Esta promoção não existe ou é de outra empresa.');
          navigate('/vendas/promocoes');
          return;
        }
        setPromocao(lerPromocao(snap.data()));
        setVendido(await vendidoNaPromocao(tenantId, id).catch(() => ({})));
      })
      .catch((erro) => showError('Erro ao abrir', mensagemDoErro(erro, 'Não foi possível carregar a promoção.')))
      .finally(() => setCarregando(false));
  }, [id, tenantId, navigate]);

  const mudar = (m: Partial<Promocao>) => setPromocao((atual) => ({ ...atual, ...m }));
  const mudarItem = (produtoId: string, m: Partial<ItemPromocao>) => mudar({ itens: promocao.itens.map((i) => (i.produtoId === produtoId ? { ...i, ...m } : i)) });

  const precosDe = (produtoId: string) => {
    const p = porId.get(produtoId);
    return { venda: Number(p?.precoVenda) || 0, vista: Number(p?.precoAVista) || 0, custo: Number(p?.precoCusto) || 0 };
  };

  const itemNovo = (p: ProdutoDoEstoque): ItemPromocao => ({
    produtoId: p.id,
    codigo: String(p.codigo || ''),
    nome: String(p.nome || '').toUpperCase(),
    tipo: paraTodos.valor ? paraTodos.tipo : 'percentual',
    valor: paraTodos.valor ? numero(paraTodos.valor) : 10,
    quota: paraTodos.quota ? numero(paraTodos.quota) || null : null,
  });

  const adicionar = (lista: ProdutoDoEstoque[]) => {
    const novos = lista.filter((p) => !promocao.itens.some((i) => i.produtoId === p.id)).map(itemNovo);
    if (novos.length === 0) { showError('Nada a adicionar', 'Esses produtos já estão na promoção.'); return; }
    mudar({ itens: [...promocao.itens, ...novos] });
    if (novos.length > 1) showSuccess(`${novos.length} produtos adicionados.`);
  };

  const opcoesLote = useMemo(() => {
    const valores = new Set<string>();
    produtos.forEach((p) => { const v = String(p[lote.campo] || '').trim(); if (v) valores.add(v); });
    return [...valores].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [produtos, lote.campo]);
  const produtosDoLote = lote.valor ? produtos.filter((p) => String(p[lote.campo] || '').trim() === lote.valor) : [];

  const aplicarATodos = () => {
    const valor = numero(paraTodos.valor);
    if (!(valor > 0)) { showError('Aplicar a todos', 'Informe o preço ou o % de desconto.'); return; }
    mudar({ itens: promocao.itens.map((i) => ({ ...i, tipo: paraTodos.tipo, valor, ...(paraTodos.quota !== '' ? { quota: numero(paraTodos.quota) || null } : {}) })) });
  };

  const salvar = async () => {
    if (!tenantId || !currentUser) return;
    const precosAtuais = Object.fromEntries(promocao.itens.map((i) => [i.produtoId, precoBaseDaPromocao(promocao.formas, precosDe(i.produtoId))]));
    setSalvando(true);
    try {
      const novoId = await salvarPromocao({ tenantId, uid: currentUser.uid, id, promocao, precosAtuais });
      showSuccess('Promoção salva.');
      if (!id) navigate(`/vendas/promocoes/${novoId}`, { replace: true });
    } catch (erro) {
      console.error('Erro ao salvar a promoção:', erro);
      showError('Não foi possível salvar a promoção', mensagemDoErro(erro, 'Confira sua conexão e tente de novo.'));
    } finally {
      setSalvando(false);
    }
  };

  const alternarSituacao = async () => {
    if (!id || !currentUser) return;
    const inativar = !promocao.inativa;
    const confirma = await NexusSwal.fire({
      icon: 'question',
      title: inativar ? 'Encerrar esta promoção agora?' : 'Reativar esta promoção?',
      text: inativar ? 'Os produtos voltam ao preço normal na próxima venda. A promoção continua na lista, como inativa.' : 'Ela volta a valer no período cadastrado.',
      showCancelButton: true,
      confirmButtonText: inativar ? 'Encerrar' : 'Reativar',
      cancelButtonText: 'Voltar',
    });
    if (!confirma.isConfirmed) return;
    try {
      await alterarSituacaoDaPromocao(currentUser.uid, id, inativar);
      mudar({ inativa: inativar });
      showSuccess(inativar ? 'Promoção encerrada.' : 'Promoção reativada.');
    } catch (erro) {
      showError('Não foi possível alterar', mensagemDoErro(erro, 'Tente de novo.'));
    }
  };

  if (carregando) return <div style={{ padding: '40px', color: 'var(--text-primary)' }}>Carregando promoção...</div>;
  const status = statusDaPromocao(promocao, getDateInputInTimeZone());
  const abaixoDoCusto = promocao.itens.filter((i) => {
    const p = precosDe(i.produtoId);
    return margemDaPromocao(precoPromocionalDoItem(i, precoBaseDaPromocao(promocao.formas, p)), p.custo).abaixoDoCusto;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="icon-btn" onClick={() => navigate('/vendas/promocoes')} title="Voltar" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <Tag size={26} color="var(--accent-purple)" />
              {id ? promocao.nome || 'Promoção' : 'Nova promoção'}
              {id && <span style={{ fontSize: '13px', fontWeight: 700, padding: '4px 10px', borderRadius: '12px', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>{ROTULO_STATUS_PROMOCAO[status]}</span>}
              {promocao.individual && <span style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '12px', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>individual (cadastro do produto)</span>}
            </h1>
            <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>
              Um produto só pode estar em uma promoção por vez no mesmo período, contando a promoção individual do cadastro do produto.
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {id && (
            <button type="button" className="btn-secondary" onClick={() => void alternarSituacao()} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: promocao.inativa ? '#10b981' : '#ef4444' }}>
              <Power size={17} /> {promocao.inativa ? 'Reativar' : 'Encerrar agora'}
            </button>
          )}
          <button type="button" className="btn-primary" onClick={() => void salvar()} disabled={salvando} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {salvando ? <Loader2 size={17} className="spin-icon" /> : <Save size={17} />} Salvar promoção
          </button>
        </div>
      </div>

      {/* Cabecalho */}
      <div className="card" style={{ ...estiloCartao, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', gridColumn: 'span 2' }}>
          <span style={estiloRotulo}>Nome da promoção *</span>
          <input value={promocao.nome} maxLength={60} onChange={(e) => mudar({ nome: e.target.value.toUpperCase() })} placeholder="Ex.: SEMANA DO PET" style={{ ...estiloCampo, textTransform: 'uppercase' }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={estiloRotulo}>Data inicial *</span>
          <input type="date" value={promocao.dataInicio} onChange={(e) => mudar({ dataInicio: e.target.value })} style={estiloCampo} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={estiloRotulo}>Data final {promocao.continua ? '' : '*'}</span>
          <input type="date" value={promocao.continua ? '' : promocao.dataFim} disabled={promocao.continua} onChange={(e) => mudar({ dataFim: e.target.value })} style={estiloCampo} />
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={promocao.continua} onChange={(e) => mudar({ continua: e.target.checked })} /> Promoção contínua (sem data para acabar)
          </label>
        </label>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', gridColumn: 'span 2' }}>
          <span style={estiloRotulo}>Formas de pagamento</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
            <input type="radio" checked={promocao.formas === 'todas'} onChange={() => mudar({ formas: 'todas' })} /> Todas as formas de pagamento
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
            <input type="radio" checked={promocao.formas === 'vista'} onChange={() => mudar({ formas: 'vista' })} /> Só à vista (dinheiro, Pix, débito, crédito 1x)
          </label>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>"Só à vista": se o pagamento for parcelado, o item volta ao preço de venda. O % é calculado sobre o preço à vista.</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={estiloRotulo}>Dias da semana</span>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {DIAS_DA_SEMANA.map((dia, i) => {
              const marcado = promocao.diasSemana.includes(i);
              return (
                <button key={dia} type="button" className={marcado ? 'btn-primary' : 'btn-secondary'} style={{ padding: '6px 9px', fontSize: '12px' }}
                  onClick={() => mudar({ diasSemana: marcado ? promocao.diasSemana.filter((d) => d !== i) : [...promocao.diasSemana, i] })}>
                  {dia}
                </button>
              );
            })}
          </div>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{promocao.diasSemana.length === 0 ? 'Nenhum marcado = todos os dias.' : 'Só nos dias marcados.'}</span>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={estiloRotulo}>Limite por venda (unidades)</span>
          <input inputMode="numeric" value={promocao.limitePorVenda ?? ''} onChange={(e) => mudar({ limitePorVenda: numero(e.target.value) || null })} placeholder="Sem limite" style={estiloCampo} />
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Máximo de cada produto, por venda, no preço promocional.</span>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', gridColumn: '1 / -1' }}>
          <span style={estiloRotulo}>Observação</span>
          <input value={promocao.observacao} onChange={(e) => mudar({ observacao: e.target.value })} placeholder="Opcional" style={estiloCampo} />
        </label>
      </div>

      {/* Produtos */}
      <div className="card" style={estiloCartao}>
        <h3 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 600 }}>Produtos da promoção ({promocao.itens.length})</h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={estiloRotulo}>Adicionar um produto</span>
            <ProductAutocomplete
              key={chaveBusca}
              value={busca}
              onChange={setBusca}
              products={produtos}
              onSelect={(p) => { adicionar([p]); setBusca(''); setChaveBusca((k) => k + 1); }}
              placeholder="Nome, código ou código de barras (# lista tudo)"
              ariaLabel="Buscar produto para a promoção"
              renderItem={(p) => (
                <span style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', width: '100%' }}>
                  <span><strong>{p.nome}</strong>{p.codigo ? <span style={{ color: 'var(--text-muted)' }}> · {p.codigo}</span> : null}</span>
                  <span>{moeda(Number(p.precoVenda) || 0)}</span>
                </span>
              )}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={estiloRotulo}>Adicionar vários de uma vez</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <select value={lote.campo} onChange={(e) => setLote({ campo: e.target.value as typeof lote.campo, valor: '' })} style={{ ...estiloCampo, width: 'auto' }}>
                <option value="categoria">Categoria</option>
                <option value="marca">Marca</option>
                <option value="fornecedor">Fornecedor</option>
              </select>
              <select value={lote.valor} onChange={(e) => setLote({ ...lote, valor: e.target.value })} style={estiloCampo}>
                <option value="">Escolha...</option>
                {opcoesLote.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
              <button type="button" className="btn-secondary" disabled={produtosDoLote.length === 0} onClick={() => adicionar(produtosDoLote)} style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
                <Plus size={16} /> {produtosDoLote.length || ''}
              </button>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '16px', padding: '12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, alignSelf: 'center' }}>Aplicar a todos:</span>
          <select value={paraTodos.tipo} onChange={(e) => setParaTodos({ ...paraTodos, tipo: e.target.value as TipoPrecoPromocao })} style={{ ...estiloCampo, width: 'auto' }}>
            <option value="percentual">% de desconto</option>
            <option value="valor">Preço fixo (R$)</option>
          </select>
          <input inputMode="decimal" value={paraTodos.valor} onChange={(e) => setParaTodos({ ...paraTodos, valor: e.target.value })} placeholder={paraTodos.tipo === 'percentual' ? 'Ex.: 10' : 'Ex.: 49,90'} style={{ ...estiloCampo, width: '120px' }} />
          <input inputMode="numeric" value={paraTodos.quota} onChange={(e) => setParaTodos({ ...paraTodos, quota: e.target.value })} placeholder="Quota (opcional)" style={{ ...estiloCampo, width: '150px' }} />
          <button type="button" className="btn-secondary" onClick={aplicarATodos} disabled={promocao.itens.length === 0}>Aplicar</button>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Também vale para os próximos produtos adicionados.</span>
        </div>

        {abaixoDoCusto.length > 0 && (
          <div style={{ marginBottom: '12px', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid #ef4444', color: '#fca5a5', fontSize: '13px', display: 'flex', gap: '10px' }}>
            <AlertTriangle size={17} style={{ flexShrink: 0, marginTop: '1px' }} />
            <div>{abaixoDoCusto.length} produto(s) ficam <strong>abaixo do custo</strong> com esta promoção: {abaixoDoCusto.map((i) => i.nome).slice(0, 5).join(', ')}{abaixoDoCusto.length > 5 ? '...' : ''}. Dá para salvar, mas confira.</div>
          </div>
        )}

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13.5px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase' }}>
                <th style={{ padding: '10px 8px' }}>Produto</th>
                <th style={{ padding: '10px 8px', textAlign: 'right' }}>Preço atual</th>
                <th style={{ padding: '10px 8px' }}>Tipo</th>
                <th style={{ padding: '10px 8px', width: '110px' }}>Valor</th>
                <th style={{ padding: '10px 8px', textAlign: 'right' }}>Promoção</th>
                <th style={{ padding: '10px 8px', textAlign: 'right' }}>Custo</th>
                <th style={{ padding: '10px 8px', textAlign: 'right' }}>% Lucro</th>
                <th style={{ padding: '10px 8px', width: '110px' }}>Quota</th>
                {id && <th style={{ padding: '10px 8px', textAlign: 'right' }}>Vendido</th>}
                <th style={{ padding: '10px 8px' }} />
              </tr>
            </thead>
            <tbody>
              {promocao.itens.length === 0 ? (
                <tr><td colSpan={10} style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>Nenhum produto ainda. Busque um produto ou adicione vários por categoria, marca ou fornecedor.</td></tr>
              ) : promocao.itens.map((i) => {
                const p = precosDe(i.produtoId);
                const base = precoBaseDaPromocao(promocao.formas, p);
                const preco = precoPromocionalDoItem(i, base);
                const margem = margemDaPromocao(preco, p.custo);
                const semCadastro = !porId.has(i.produtoId);
                return (
                  <tr key={i.produtoId} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '8px' }}>
                      <strong>{i.nome}</strong>{i.codigo ? <span style={{ color: 'var(--text-muted)' }}> · {i.codigo}</span> : null}
                      {semCadastro && <div style={{ fontSize: '12px', color: '#f59e0b' }}>Produto inativo ou fora do estoque de revenda</div>}
                    </td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>
                      {moeda(p.venda)}
                      {p.vista > 0 && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>à vista {moeda(p.vista)}</div>}
                    </td>
                    <td style={{ padding: '8px' }}>
                      <select value={i.tipo} onChange={(e) => mudarItem(i.produtoId, { tipo: e.target.value as TipoPrecoPromocao })} style={{ ...estiloCampo, padding: '7px 8px' }}>
                        <option value="percentual">%</option>
                        <option value="valor">R$</option>
                      </select>
                    </td>
                    <td style={{ padding: '8px' }}>
                      <input inputMode="decimal" defaultValue={textoDoNumero(i.valor)} key={`${i.produtoId}-${i.tipo}-${i.valor}`} onBlur={(e) => mudarItem(i.produtoId, { valor: numero(e.target.value) })} style={{ ...estiloCampo, padding: '7px 8px', textAlign: 'right' }} />
                    </td>
                    <td style={{ padding: '8px', textAlign: 'right', fontWeight: 700, color: 'var(--accent-purple)' }}>{moeda(preco)}</td>
                    <td style={{ padding: '8px', textAlign: 'right', color: 'var(--text-secondary)' }}>{p.custo > 0 ? moeda(p.custo) : '—'}</td>
                    <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600, color: margem.abaixoDoCusto ? '#ef4444' : 'var(--text-primary)' }}>{margem.lucroPercentual === null ? '—' : `${margem.lucroPercentual.toFixed(1)}%`}</td>
                    <td style={{ padding: '8px' }}>
                      <input inputMode="numeric" defaultValue={i.quota ?? ''} key={`${i.produtoId}-q-${i.quota}`} onBlur={(e) => mudarItem(i.produtoId, { quota: numero(e.target.value) || null })} placeholder="Sem limite" style={{ ...estiloCampo, padding: '7px 8px' }} />
                    </td>
                    {id && <td style={{ padding: '8px', textAlign: 'right' }}>{vendido[i.produtoId] || 0}{i.quota ? ` / ${i.quota}` : ''}</td>}
                    <td style={{ padding: '8px', textAlign: 'center' }}>
                      <button type="button" className="icon-btn" title="Tirar da promoção" onClick={() => mudar({ itens: promocao.itens.filter((x) => x.produtoId !== i.produtoId) })} style={{ color: '#ef4444' }}><Trash2 size={16} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default PromocaoForm;
