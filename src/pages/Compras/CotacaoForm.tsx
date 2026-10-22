import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { ArrowLeft, Check, ClipboardList, Copy, FileText, MessageCircle, Pencil, Send, X } from 'lucide-react';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { useTenantCollection, type TenantCollectionItem } from '../../hooks/useTenantCollection';
import ClientAutocomplete from '../../components/common/ClientAutocomplete';
import MenuMaisOpcoes from '../../components/common/MenuMaisOpcoes';
import PdfVisualizador from '../../components/common/PdfVisualizador';
import { NexusSwal, showError, showSuccess, showWarning } from '../../utils/alerts';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import {
  ROTULO_STATUS_COTACAO,
  cotacaoVencida,
  escolhasSugeridas,
  formatarReais,
  linkDaCotacao,
  montarComparativo,
  responderAtePadrao,
  textoDoConvite,
  type Cotacao,
  type FornecedorDaCotacao,
} from '../../utils/comprasDomain';
import { gerarPdfCotacao, linkDoWhatsApp, nomeDoArquivoPdf } from '../../utils/comprasPdf';
import { cancelarCotacao, criarCotacao, editarCotacao, fecharCotacao, gerarPedidosDaCotacao } from '../../services/comprasService';
import { carregarEmpresaResumo } from '../../services/empresaResumoService';
import { GradeDeItens, estiloCampo, estiloRotulo, useProdutosParaCompra, type LinhaDeItem } from './comprasUi';

/**
 * COTACAO DE COMPRA (22/10/2026): nova/edicao (itens, fornecedores, responder
 * ate') e, depois de gravada, a tela da cotacao: link + codigo de cada
 * fornecedor (copiar, WhatsApp, PDF), o COMPARATIVO das propostas e "Gerar
 * pedidos de compra" (um por fornecedor vencedor). Regra em comprasDomain.ts.
 */

interface FornecedorCadastro extends TenantCollectionItem {
  nome?: string;
  codigo?: string;
  email?: string;
  celular?: string;
  telefone?: string;
  ativo?: boolean;
}

interface FornecedorEscolhido { fornecedorId: string; nome: string; email: string; celular: string }

const dataBr = (iso: string) => (iso ? iso.split('T')[0].split('-').reverse().join('/') : '—');

const cotacaoDoDocumento = (id: string, d: Record<string, unknown>): Cotacao => ({
  id,
  numero: Number(d.numero) || 0,
  titulo: String(d.titulo || ''),
  status: (d.status as Cotacao['status']) || 'aberta',
  itens: Array.isArray(d.itens) ? d.itens as Cotacao['itens'] : [],
  fornecedores: Array.isArray(d.fornecedores) ? d.fornecedores as FornecedorDaCotacao[] : [],
  responderAte: String(d.responderAte || ''),
  observacao: String(d.observacao || ''),
  criadoEmIso: String(d.criadoEmIso || ''),
  escolhas: (d.escolhas && typeof d.escolhas === 'object' ? d.escolhas : {}) as Record<string, string>,
  pedidosGerados: Array.isArray(d.pedidosGerados) ? d.pedidosGerados as Cotacao['pedidosGerados'] : [],
});

const CotacaoForm: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { openTab } = useTabs();
  const { tenantId } = useAuth();
  const produtos = useProdutosParaCompra(tenantId);
  const { items: fornecedoresCadastro } = useTenantCollection<FornecedorCadastro>('fornecedores', tenantId);
  const hoje = getDateInputInTimeZone();

  const [cotacao, setCotacao] = useState<Cotacao | null>(null);
  const [carregando, setCarregando] = useState(Boolean(id));
  const [editando, setEditando] = useState(!id);
  const [salvando, setSalvando] = useState(false);
  const [titulo, setTitulo] = useState('');
  const [responderAte, setResponderAte] = useState(responderAtePadrao(hoje));
  const [observacao, setObservacao] = useState('');
  const [linhas, setLinhas] = useState<LinhaDeItem[]>([]);
  const [fornecedores, setFornecedores] = useState<FornecedorEscolhido[]>([]);
  const [buscaFornecedor, setBuscaFornecedor] = useState('');
  const [escolhas, setEscolhas] = useState<Record<string, string>>({});
  const [empresaNome, setEmpresaNome] = useState('');
  const [pdf, setPdf] = useState<{ blob: Blob; nome: string } | null>(null);

  useEffect(() => { if (tenantId) void carregarEmpresaResumo(tenantId).then((e) => setEmpresaNome(e.nome)); }, [tenantId]);

  // Documento ao vivo: a resposta do fornecedor aparece sem recarregar.
  useEffect(() => {
    if (!id || !tenantId) return undefined;
    return onSnapshot(doc(db, 'cotacoes_compra', id), (snap) => {
      if (!snap.exists() || snap.data().tenantId !== tenantId) {
        showError('Cotação não encontrada', 'Esta cotação não existe ou é de outra empresa.');
        navigate('/compras/cotacoes');
        return;
      }
      const lida = cotacaoDoDocumento(snap.id, snap.data());
      setCotacao(lida);
      setCarregando(false);
    }, (erro) => { console.error('Erro ao abrir a cotação:', erro); setCarregando(false); });
  }, [id, tenantId, navigate]);

  const comparativo = useMemo(() => (cotacao ? montarComparativo(cotacao) : null), [cotacao]);
  const temResposta = Boolean(cotacao?.fornecedores.some((f) => f.status === 'respondida'));
  useEffect(() => {
    if (!comparativo || !cotacao) return;
    setEscolhas(Object.keys(cotacao.escolhas).length > 0 ? cotacao.escolhas : escolhasSugeridas(comparativo.linhas));
  }, [comparativo, cotacao]);

  const comecarEdicao = () => {
    if (!cotacao) return;
    setTitulo(cotacao.titulo);
    setResponderAte(cotacao.responderAte);
    setObservacao(cotacao.observacao);
    setLinhas(cotacao.itens.map((i) => ({ ...i, quantidadeTexto: String(i.quantidade), precoTexto: '' })));
    setFornecedores(cotacao.fornecedores.map((f) => ({ fornecedorId: f.fornecedorId, nome: f.nome, email: f.email, celular: f.celular })));
    setEditando(true);
  };

  const salvar = async () => {
    if (linhas.some((l) => !(l.quantidade > 0))) { showError('Atenção', 'Tem item sem quantidade.'); return; }
    setSalvando(true);
    try {
      const corpo = { titulo, itens: linhas.map(({ quantidadeTexto: _q, precoTexto: _p, ...item }) => item), fornecedores, responderAte, observacao };
      if (id) {
        await editarCotacao(id, corpo);
        showSuccess('Cotação alterada.');
        setEditando(false);
      } else {
        const r = await criarCotacao(corpo);
        showSuccess(`Cotação nº ${String(r.numero).padStart(4, '0')} criada. Agora mande o link a cada fornecedor.`);
        navigate(`/compras/cotacoes/${r.id}`, { replace: true });
        setEditando(false);
      }
    } catch (erro) {
      showError('Não foi possível salvar', erro instanceof Error ? erro.message : 'Tente de novo.');
    } finally {
      setSalvando(false);
    }
  };

  const mudarStatus = async (acao: 'cancelar' | 'fechar') => {
    if (!cotacao) return;
    const confirma = await NexusSwal.fire({
      icon: 'warning',
      title: acao === 'cancelar' ? 'Cancelar a cotação?' : 'Fechar sem gerar pedido?',
      text: acao === 'cancelar' ? 'Os links dos fornecedores param de funcionar e nada é gerado.' : 'A cotação fecha e os links param de aceitar propostas. Nenhum pedido de compra é gerado.',
      showCancelButton: true,
      confirmButtonText: acao === 'cancelar' ? 'Sim, cancelar' : 'Sim, fechar',
      cancelButtonText: 'Voltar',
      confirmButtonColor: '#ef4444',
    });
    if (!confirma.isConfirmed) return;
    try {
      await (acao === 'cancelar' ? cancelarCotacao(cotacao.id) : fecharCotacao(cotacao.id));
      showSuccess(acao === 'cancelar' ? 'Cotação cancelada.' : 'Cotação fechada.');
    } catch (erro) {
      showError('Não foi possível concluir', erro instanceof Error ? erro.message : 'Tente de novo.');
    }
  };

  const gerarPedidos = async () => {
    if (!cotacao || !comparativo) return;
    const porFornecedor = new Map<string, number>();
    Object.entries(escolhas).forEach(([produtoId, fornecedorId]) => {
      const linha = comparativo.linhas.find((l) => l.produtoId === produtoId);
      const preco = linha?.precos[fornecedorId];
      if (linha && preco) porFornecedor.set(fornecedorId, (porFornecedor.get(fornecedorId) || 0) + Math.round(preco * linha.quantidade));
    });
    if (porFornecedor.size === 0) { showError('Atenção', 'Escolha o fornecedor de pelo menos um item.'); return; }
    const resumo = [...porFornecedor.entries()].map(([fId, total]) => `${cotacao.fornecedores.find((f) => f.fornecedorId === fId)?.nome || fId}: ${formatarReais(total)}`).join('<br/>');
    const confirma = await NexusSwal.fire({
      icon: 'question',
      title: `Gerar ${porFornecedor.size === 1 ? '1 pedido de compra' : `${porFornecedor.size} pedidos de compra`}?`,
      html: `${resumo}<br/><br/>A cotação fecha e os pedidos nascem Abertos (confira e marque Enviado ao mandar ao fornecedor).`,
      showCancelButton: true,
      confirmButtonText: 'Gerar pedidos',
      cancelButtonText: 'Voltar',
    });
    if (!confirma.isConfirmed) return;
    try {
      const r = await gerarPedidosDaCotacao(cotacao.id, escolhas);
      showSuccess(`${r.pedidos.length === 1 ? 'Pedido' : `${r.pedidos.length} pedidos`} de compra gerado(s): ${r.pedidos.map((p) => `nº ${String(p.numero).padStart(4, '0')} (${p.fornecedorNome})`).join(', ')}.`);
    } catch (erro) {
      showError('Não foi possível gerar os pedidos', erro instanceof Error ? erro.message : 'Tente de novo.');
    }
  };

  const linkDe = (f: FornecedorDaCotacao) => linkDaCotacao(window.location.origin, f.token);
  const conviteDe = (f: FornecedorDaCotacao) => (cotacao ? textoDoConvite({ empresa: empresaNome || 'A empresa', titulo: cotacao.titulo, link: linkDe(f), codigoAcesso: f.codigoAcesso, responderAte: cotacao.responderAte }) : '');
  const copiar = async (f: FornecedorDaCotacao) => {
    try {
      await navigator.clipboard.writeText(conviteDe(f));
      showSuccess('Convite copiado: cole no WhatsApp ou no e-mail do fornecedor.');
    } catch {
      showWarning('Não deu para copiar sozinho. Selecione o texto do link e copie.');
    }
  };
  const abrirPdf = (f: FornecedorDaCotacao) => {
    if (!cotacao) return;
    setPdf({ blob: gerarPdfCotacao({ empresa: empresaNome || 'Empresa', cotacao, fornecedor: f, link: linkDe(f) }), nome: nomeDoArquivoPdf('cotacao', cotacao.numero, f.nome) });
  };

  if (pdf) return <PdfVisualizador titulo="Cotação para o fornecedor" nomeArquivo={pdf.nome} pdf={pdf.blob} onFechar={() => setPdf(null)} />;

  const fornecedoresAtivos = fornecedoresCadastro.filter((f) => f.ativo !== false && !fornecedores.some((x) => x.fornecedorId === f.id));
  const cabecalhoTitulo = cotacao ? `Cotação nº ${String(cotacao.numero).padStart(4, '0')}` : 'Nova cotação de compra';

  return (
    <div className="financeiro-page" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => navigate('/compras/cotacoes')} aria-label="Voltar" className="btn-secondary" style={{ width: '40px', height: '40px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ArrowLeft size={18} /></button>
        <div style={{ flex: 1, minWidth: '200px' }}>
          <h1 className="page-title" style={{ fontSize: '22px', fontWeight: 700, margin: 0 }}>{cabecalhoTitulo}{cotacao ? ` — ${cotacao.titulo}` : ''}</h1>
          {cotacao && (
            <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>
              {ROTULO_STATUS_COTACAO[cotacao.status]} · responder até {dataBr(cotacao.responderAte)}{cotacao.status === 'aberta' && cotacaoVencida(cotacao.responderAte, hoje) ? ' (prazo vencido — os links não aceitam mais propostas)' : ''}
            </p>
          )}
        </div>
        {editando ? (
          <div style={{ display: 'flex', gap: '10px' }}>
            {id && <button type="button" className="btn-secondary" onClick={() => setEditando(false)}>Cancelar edição</button>}
            <button type="button" className="btn-primary" disabled={salvando} onClick={() => void salvar()} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Check size={18} /> {salvando ? 'Salvando...' : id ? 'Salvar alterações' : 'Criar cotação'}</button>
          </div>
        ) : cotacao && (
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            {cotacao.status === 'aberta' && (
              <MenuMaisOpcoes itens={[
                { texto: 'Editar', Icone: Pencil, titulo: temResposta ? 'Com proposta recebida, só nome, prazo, observação e fornecedores mudam' : 'Altera itens, fornecedores e prazo', onClick: comecarEdicao },
                { texto: 'Fechar sem pedido', Icone: X, onClick: () => void mudarStatus('fechar') },
                { texto: 'Cancelar cotação', Icone: X, onClick: () => void mudarStatus('cancelar') },
              ]} />
            )}
            {cotacao.status === 'aberta' && temResposta && (
              <button type="button" className="btn-primary" onClick={() => void gerarPedidos()} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><ClipboardList size={18} /> Gerar pedidos de compra</button>
            )}
          </div>
        )}
      </div>

      {carregando ? (
        <div style={{ color: 'var(--text-muted)' }}>Carregando...</div>
      ) : editando ? (
        <>
          <div className="card" style={{ padding: '18px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', backgroundColor: 'var(--bg-secondary)', display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '14px' }}>
            <label style={estiloRotulo}>Nome da cotação
              <input value={titulo} maxLength={120} onChange={(e) => setTitulo(e.target.value)} style={estiloCampo} title="Ex.: Reposição de outubro" />
            </label>
            <label style={estiloRotulo}>Fornecedores respondem até
              <input type="date" value={responderAte} min={hoje} onChange={(e) => setResponderAte(e.target.value)} style={estiloCampo} />
            </label>
            <label style={{ ...estiloRotulo, gridColumn: '1 / -1' }}>Observação para os fornecedores (opcional)
              <input value={observacao} maxLength={500} onChange={(e) => setObservacao(e.target.value)} style={estiloCampo} title="Ex.: entrega na loja, frete CIF" />
            </label>
          </div>

          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Itens</div>
          <GradeDeItens produtos={produtos} linhas={linhas} onMudar={setLinhas} comPreco={false} somenteLeitura={Boolean(id) && temResposta} />
          {Boolean(id) && temResposta && <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>Um fornecedor já respondeu: os itens e as quantidades não mudam mais. Para outra lista, cancele e abra uma cotação nova.</p>}

          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Fornecedores</div>
          <div className="card" style={{ padding: '18px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', backgroundColor: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ position: 'relative' }}>
              <ClientAutocomplete
                value={buscaFornecedor}
                onChange={setBuscaFornecedor}
                clients={fornecedoresAtivos}
                onSelect={(f) => {
                  setFornecedores([...fornecedores, { fornecedorId: f.id, nome: String(f.nome || '').trim(), email: String(f.email || '').trim(), celular: String(f.celular || f.telefone || '').trim() }]);
                  setBuscaFornecedor('');
                }}
                renderItem={(f) => <span>{f.codigo ? `${f.codigo} · ${f.nome}` : f.nome}</span>}
                placeholder="Buscar…"
                ariaLabel="Buscar fornecedor"
                emptyHint={<span>Nenhum fornecedor com esse nome. Cadastre em Cadastros › Fornecedores.</span>}
              />
            </div>
            {fornecedores.length === 0 ? (
              <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Cada fornecedor escolhido recebe um link próprio com código de acesso.</span>
            ) : (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {fornecedores.map((f) => (
                  <span key={f.fornecedorId} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 10px 6px 12px', borderRadius: '999px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', fontSize: '13px', color: 'var(--text-primary)' }}>
                    {f.nome}{f.celular ? <span style={{ color: 'var(--text-muted)' }}>{f.celular}</span> : null}
                    <button type="button" onClick={() => setFornecedores(fornecedores.filter((x) => x.fornecedorId !== f.fornecedorId))} aria-label={`Tirar ${f.nome}`} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, display: 'flex' }}><X size={14} /></button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </>
      ) : cotacao && comparativo && (
        <>
          {cotacao.observacao && <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>{cotacao.observacao}</p>}

          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Fornecedores e links</div>
          <div className="card list-container">
            <div className="table-wrapper">
              <table className="data-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Fornecedor</th>
                    <th>Código de acesso</th>
                    <th>Situação</th>
                    <th>Prazo / condição</th>
                    <th style={{ textAlign: 'right' }}>Total cotado</th>
                    <th>Enviar</th>
                  </tr>
                </thead>
                <tbody>
                  {cotacao.fornecedores.map((f) => {
                    const total = comparativo.totais.find((t) => t.fornecedorId === f.fornecedorId);
                    return (
                      <tr key={f.fornecedorId}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{f.nome}</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{[f.celular, f.email].filter(Boolean).join(' · ')}</div>
                        </td>
                        <td style={{ fontFamily: 'monospace', fontSize: '15px', letterSpacing: '0.15em' }}>{f.codigoAcesso}</td>
                        <td>
                          {f.status === 'respondida'
                            ? <span style={{ color: '#10b981', fontWeight: 700 }}>Respondeu{f.respondidoEmIso ? ` em ${dataBr(f.respondidoEmIso)}` : ''}{total && !total.completo ? ` (${total.itensCotados} de ${cotacao.itens.length} itens)` : ''}</span>
                            : <span style={{ color: '#f59e0b', fontWeight: 600 }}>Aguardando</span>}
                        </td>
                        <td style={{ fontSize: '13px' }}>{f.status === 'respondida' ? `${f.prazoEntregaDias !== null ? `${f.prazoEntregaDias} dia(s)` : '—'} / ${f.condicaoPagamento || '—'}` : '—'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{total && total.itensCotados > 0 ? formatarReais(total.totalCentavos) : '—'}</td>
                        <td>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            <button type="button" className="btn-secondary" onClick={() => void copiar(f)} title="Copia o texto do convite com o link e o código" style={{ padding: '6px 10px', fontSize: '12px', display: 'inline-flex', gap: '6px', alignItems: 'center' }}><Copy size={14} /> Copiar</button>
                            {f.celular && (
                              <a href={linkDoWhatsApp(f.celular, conviteDe(f))} target="_blank" rel="noreferrer" className="btn-secondary" title="Abre o WhatsApp com o convite pronto" style={{ padding: '6px 10px', fontSize: '12px', display: 'inline-flex', gap: '6px', alignItems: 'center', textDecoration: 'none' }}><MessageCircle size={14} /> WhatsApp</a>
                            )}
                            <button type="button" className="btn-secondary" onClick={() => abrirPdf(f)} title="PDF da cotação para mandar por fora" style={{ padding: '6px 10px', fontSize: '12px', display: 'inline-flex', gap: '6px', alignItems: 'center' }}><FileText size={14} /> PDF</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Comparativo {temResposta ? '(menor preço em destaque; escolha o fornecedor de cada item)' : '(aparece quando alguém responder)'}</div>
          <div className="card list-container">
            <div className="table-wrapper">
              <table className="data-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th style={{ textAlign: 'right' }}>Qtd.</th>
                    {cotacao.fornecedores.map((f) => <th key={f.fornecedorId} style={{ textAlign: 'right' }}>{f.nome}</th>)}
                    {cotacao.status === 'aberta' && temResposta && <th>Comprar de</th>}
                    {cotacao.status !== 'aberta' && Object.keys(cotacao.escolhas).length > 0 && <th>Comprado de</th>}
                  </tr>
                </thead>
                <tbody>
                  {comparativo.linhas.map((l) => (
                    <tr key={l.produtoId}>
                      <td><div style={{ fontWeight: 600 }}>{l.nome}</div><div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{l.codigo}</div></td>
                      <td style={{ textAlign: 'right' }}>{l.quantidade.toLocaleString('pt-BR')} {l.unidade}</td>
                      {cotacao.fornecedores.map((f) => {
                        const preco = l.precos[f.fornecedorId];
                        const melhor = l.melhorFornecedorId === f.fornecedorId;
                        return (
                          <td key={f.fornecedorId} style={{ textAlign: 'right', fontWeight: melhor ? 800 : 400, color: melhor ? '#10b981' : undefined }}>
                            {preco ? formatarReais(preco) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                          </td>
                        );
                      })}
                      {cotacao.status === 'aberta' && temResposta && (
                        <td>
                          <select value={escolhas[l.produtoId] || ''} onChange={(e) => setEscolhas({ ...escolhas, [l.produtoId]: e.target.value })} style={{ ...estiloCampo, padding: '6px 8px', width: 'auto' }} aria-label={`Fornecedor de ${l.nome}`}>
                            <option value="">Não comprar agora</option>
                            {cotacao.fornecedores.filter((f) => l.precos[f.fornecedorId]).map((f) => <option key={f.fornecedorId} value={f.fornecedorId}>{f.nome} — {formatarReais(l.precos[f.fornecedorId])}</option>)}
                          </select>
                        </td>
                      )}
                      {cotacao.status !== 'aberta' && Object.keys(cotacao.escolhas).length > 0 && (
                        <td>{cotacao.fornecedores.find((f) => f.fornecedorId === cotacao.escolhas[l.produtoId])?.nome || '—'}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
                {temResposta && (
                  <tfoot>
                    <tr>
                      <td colSpan={2} style={{ fontWeight: 700 }}>Total por fornecedor</td>
                      {comparativo.totais.map((t) => (
                        <td key={t.fornecedorId} style={{ textAlign: 'right', fontWeight: 700 }} title={t.completo ? 'Cotou todos os itens' : `Cotou ${t.itensCotados} de ${cotacao.itens.length} itens`}>
                          {t.itensCotados > 0 ? `${formatarReais(t.totalCentavos)}${t.completo ? '' : ' *'}` : '—'}
                        </td>
                      ))}
                      {(cotacao.status === 'aberta' || Object.keys(cotacao.escolhas).length > 0) && <td />}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {temResposta && comparativo.totais.some((t) => t.itensCotados > 0 && !t.completo) && <p style={{ margin: 0, padding: '10px 16px', fontSize: '12px', color: 'var(--text-muted)' }}>* fornecedor que não cotou todos os itens: o total dele não compara com o dos outros.</p>}
          </div>

          {cotacao.pedidosGerados.length > 0 && (
            <div className="card" style={{ padding: '14px 18px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', backgroundColor: 'var(--bg-secondary)', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
              <Send size={16} color="var(--accent-purple)" /> <strong>Pedidos gerados:</strong>
              {cotacao.pedidosGerados.map((p) => (
                <button key={p.pedidoId} type="button" className="btn-secondary" onClick={() => openTab(`/compras/pedidos-compra/${p.pedidoId}`)} style={{ padding: '6px 10px', fontSize: '12px' }}>
                  nº {String(p.numero).padStart(4, '0')} — {cotacao.fornecedores.find((f) => f.fornecedorId === p.fornecedorId)?.nome || p.fornecedorId}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default CotacaoForm;
