import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { ArrowLeft, Check, FileText, MessageCircle, PackageCheck, Pencil, Send, X } from 'lucide-react';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantCollection, type TenantCollectionItem } from '../../hooks/useTenantCollection';
import ClientAutocomplete from '../../components/common/ClientAutocomplete';
import MenuMaisOpcoes from '../../components/common/MenuMaisOpcoes';
import PdfVisualizador from '../../components/common/PdfVisualizador';
import { NexusSwal, showError, showSuccess } from '../../utils/alerts';
import { ROTULO_STATUS_PEDIDO_COMPRA, formatarReais, podeEditarPedido, type PedidoCompra } from '../../utils/comprasDomain';
import { gerarPdfPedidoCompra, linkDoWhatsApp, nomeDoArquivoPdf } from '../../utils/comprasPdf';
import { criarPedidoCompra, editarPedidoCompra, mudarStatusPedidoCompra } from '../../services/comprasService';
import { carregarEmpresaResumo, type EmpresaResumo } from '../../services/empresaResumoService';
import { compartilharOuBaixarPdf } from '../Vendedor/folhaParaPdf';
import { GradeDeItens, centavosDoTexto, estiloCampo, estiloRotulo, textoDosCentavos, useProdutosParaCompra, type LinhaDeItem } from './comprasUi';

/**
 * PEDIDO DE COMPRA (22/10/2026): a mao (fornecedor, itens com preco, prazo,
 * condicao) ou vindo da cotacao. PDF para o fornecedor (ver, baixar,
 * WhatsApp); situacao Aberto -> Enviado -> Recebido, ou Cancelado. A
 * entrada de NF-e ligada ao pedido fica para a fase 2.
 */

interface FornecedorCadastro extends TenantCollectionItem { nome?: string; codigo?: string; celular?: string; telefone?: string; ativo?: boolean }

const dataBr = (iso: string) => (iso ? iso.split('T')[0].split('-').reverse().join('/') : '—');

const pedidoDoDocumento = (id: string, d: Record<string, unknown>): PedidoCompra => ({
  id,
  numero: Number(d.numero) || 0,
  status: (d.status as PedidoCompra['status']) || 'aberto',
  fornecedorId: String(d.fornecedorId || ''),
  fornecedorNome: String(d.fornecedorNome || ''),
  itens: Array.isArray(d.itens) ? d.itens as PedidoCompra['itens'] : [],
  totalCentavos: Number(d.totalCentavos) || 0,
  prazoEntregaDias: d.prazoEntregaDias === null || d.prazoEntregaDias === undefined ? null : Number(d.prazoEntregaDias),
  condicaoPagamento: String(d.condicaoPagamento || ''),
  observacao: String(d.observacao || ''),
  cotacaoId: String(d.cotacaoId || ''),
  cotacaoNumero: d.cotacaoNumero ? Number(d.cotacaoNumero) : null,
  criadoEmIso: String(d.criadoEmIso || ''),
  enviadoEmIso: String(d.enviadoEmIso || ''),
  recebidoEmIso: String(d.recebidoEmIso || ''),
  canceladoEmIso: String(d.canceladoEmIso || ''),
});

const PedidoCompraForm: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { tenantId } = useAuth();
  const produtos = useProdutosParaCompra(tenantId);
  const { items: fornecedoresCadastro } = useTenantCollection<FornecedorCadastro>('fornecedores', tenantId);

  const [pedido, setPedido] = useState<PedidoCompra | null>(null);
  const [carregando, setCarregando] = useState(Boolean(id));
  const [editando, setEditando] = useState(!id);
  const [salvando, setSalvando] = useState(false);
  const [fornecedor, setFornecedor] = useState<{ id: string; nome: string; celular: string } | null>(null);
  const [buscaFornecedor, setBuscaFornecedor] = useState('');
  const [linhas, setLinhas] = useState<LinhaDeItem[]>([]);
  const [prazo, setPrazo] = useState('');
  const [condicao, setCondicao] = useState('');
  const [observacao, setObservacao] = useState('');
  const [empresa, setEmpresa] = useState<EmpresaResumo | null>(null);
  const [pdf, setPdf] = useState<{ blob: Blob; nome: string } | null>(null);

  useEffect(() => { if (tenantId) void carregarEmpresaResumo(tenantId).then(setEmpresa); }, [tenantId]);

  useEffect(() => {
    if (!id || !tenantId) return undefined;
    return onSnapshot(doc(db, 'pedidos_compra', id), (snap) => {
      if (!snap.exists() || snap.data().tenantId !== tenantId) {
        showError('Pedido não encontrado', 'Este pedido de compra não existe ou é de outra empresa.');
        navigate('/compras/pedidos-compra');
        return;
      }
      setPedido(pedidoDoDocumento(snap.id, snap.data()));
      setCarregando(false);
    }, (erro) => { console.error('Erro ao abrir o pedido de compra:', erro); setCarregando(false); });
  }, [id, tenantId, navigate]);

  const comecarEdicao = () => {
    if (!pedido) return;
    setFornecedor({ id: pedido.fornecedorId, nome: pedido.fornecedorNome, celular: '' });
    setBuscaFornecedor(pedido.fornecedorNome);
    setLinhas(pedido.itens.map((i) => ({ produtoId: i.produtoId, codigo: i.codigo, nome: i.nome, unidade: i.unidade, quantidade: i.quantidade, quantidadeTexto: String(i.quantidade), observacao: '', precoTexto: textoDosCentavos(i.precoUnitarioCentavos) })));
    setPrazo(pedido.prazoEntregaDias === null ? '' : String(pedido.prazoEntregaDias));
    setCondicao(pedido.condicaoPagamento);
    setObservacao(pedido.observacao);
    setEditando(true);
  };

  const salvar = async () => {
    if (!fornecedor) { showError('Atenção', 'Escolha o fornecedor.'); return; }
    if (linhas.length === 0) { showError('Atenção', 'Coloque pelo menos um item.'); return; }
    setSalvando(true);
    try {
      const corpo = {
        fornecedorId: fornecedor.id,
        fornecedorNome: fornecedor.nome,
        itens: linhas.map((l) => ({ produtoId: l.produtoId, codigo: l.codigo, nome: l.nome, unidade: l.unidade, quantidade: l.quantidade, precoUnitarioCentavos: centavosDoTexto(l.precoTexto) })),
        prazoEntregaDias: prazo.trim() ? Number(prazo) : null,
        condicaoPagamento: condicao.trim(),
        observacao: observacao.trim(),
      };
      if (id) {
        await editarPedidoCompra(id, corpo);
        showSuccess('Pedido alterado.');
        setEditando(false);
      } else {
        const r = await criarPedidoCompra(corpo);
        showSuccess(`Pedido de compra nº ${String(r.numero).padStart(4, '0')} criado (${formatarReais(r.totalCentavos)}).`);
        navigate(`/compras/pedidos-compra/${r.id}`, { replace: true });
        setEditando(false);
      }
    } catch (erro) {
      showError('Não foi possível salvar', erro instanceof Error ? erro.message : 'Tente de novo.');
    } finally {
      setSalvando(false);
    }
  };

  const mudarStatus = async (status: 'enviado' | 'recebido' | 'cancelado') => {
    if (!pedido) return;
    const textos = {
      enviado: ['Marcar como enviado ao fornecedor?', 'O pedido deixa de poder ser alterado.'],
      recebido: ['Marcar como recebido?', 'A mercadoria chegou. O pedido fecha (a entrada da nota fiscal continua pelo Fiscal › Entrada de XML).'],
      cancelado: ['Cancelar o pedido?', 'O pedido fica cancelado e não pode ser reaberto.'],
    }[status];
    const confirma = await NexusSwal.fire({ icon: status === 'cancelado' ? 'warning' : 'question', title: textos[0], text: textos[1], showCancelButton: true, confirmButtonText: 'Sim', cancelButtonText: 'Voltar', ...(status === 'cancelado' ? { confirmButtonColor: '#ef4444' } : {}) });
    if (!confirma.isConfirmed) return;
    try {
      await mudarStatusPedidoCompra(pedido.id, status);
      showSuccess(`Pedido ${ROTULO_STATUS_PEDIDO_COMPRA[status].toLowerCase()}.`);
    } catch (erro) {
      showError('Não foi possível concluir', erro instanceof Error ? erro.message : 'Tente de novo.');
    }
  };

  const gerarPdf = () => (pedido ? gerarPdfPedidoCompra({ empresa: empresa?.nome || 'Empresa', pedido, dadosEmpresa: empresa || {} }) : null);
  const verPdf = () => { const blob = gerarPdf(); if (blob && pedido) setPdf({ blob, nome: nomeDoArquivoPdf('pedido-compra', pedido.numero, pedido.fornecedorNome) }); };
  const compartilhar = async () => {
    const blob = gerarPdf();
    if (!blob || !pedido) return;
    const r = await compartilharOuBaixarPdf(blob, nomeDoArquivoPdf('pedido-compra', pedido.numero, pedido.fornecedorNome), `Pedido de compra nº ${String(pedido.numero).padStart(4, '0')} — ${empresa?.nome || ''}`);
    if (r === 'baixado') showSuccess('PDF baixado. Anexe no WhatsApp ou no e-mail do fornecedor.');
  };
  const celularDoFornecedor = fornecedoresCadastro.find((f) => f.id === pedido?.fornecedorId);
  const textoWhats = pedido ? `Olá! Segue o pedido de compra nº ${String(pedido.numero).padStart(4, '0')} de ${empresa?.nome || 'nossa loja'} (${formatarReais(pedido.totalCentavos)}). O PDF vai em anexo.` : '';

  if (pdf) return <PdfVisualizador titulo="Pedido de compra" nomeArquivo={pdf.nome} pdf={pdf.blob} onFechar={() => setPdf(null)} />;

  const fornecedoresAtivos = fornecedoresCadastro.filter((f) => f.ativo !== false);
  const totalEdicao = linhas.reduce((t, l) => t + Math.round(l.quantidade * centavosDoTexto(l.precoTexto)), 0);

  return (
    <div className="financeiro-page" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => navigate('/compras/pedidos-compra')} aria-label="Voltar" className="btn-secondary" style={{ width: '40px', height: '40px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ArrowLeft size={18} /></button>
        <div style={{ flex: 1, minWidth: '200px' }}>
          <h1 className="page-title" style={{ fontSize: '22px', fontWeight: 700, margin: 0 }}>{pedido ? `Pedido de compra nº ${String(pedido.numero).padStart(4, '0')} — ${pedido.fornecedorNome}` : 'Novo pedido de compra'}</h1>
          {pedido && (
            <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>
              {ROTULO_STATUS_PEDIDO_COMPRA[pedido.status]} · criado em {dataBr(pedido.criadoEmIso)}{pedido.enviadoEmIso ? ` · enviado em ${dataBr(pedido.enviadoEmIso)}` : ''}{pedido.recebidoEmIso ? ` · recebido em ${dataBr(pedido.recebidoEmIso)}` : ''}{pedido.cotacaoNumero ? ` · da cotação nº ${String(pedido.cotacaoNumero).padStart(4, '0')}` : ''}
            </p>
          )}
        </div>
        {editando ? (
          <div style={{ display: 'flex', gap: '10px' }}>
            {id && <button type="button" className="btn-secondary" onClick={() => setEditando(false)}>Cancelar edição</button>}
            <button type="button" className="btn-primary" disabled={salvando} onClick={() => void salvar()} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Check size={18} /> {salvando ? 'Salvando...' : id ? 'Salvar alterações' : 'Criar pedido'}</button>
          </div>
        ) : pedido && (
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <MenuMaisOpcoes itens={[
              { texto: 'Ver / imprimir PDF', Icone: FileText, onClick: verPdf },
              { texto: 'Enviar PDF (WhatsApp, e-mail…)', Icone: Send, titulo: 'Abre o menu de compartilhar; sem ele, baixa o PDF', onClick: () => void compartilhar() },
              ...(podeEditarPedido(pedido.status) ? [{ texto: 'Editar', Icone: Pencil, onClick: comecarEdicao }] : []),
              ...(pedido.status === 'aberto' || pedido.status === 'enviado' ? [{ texto: 'Cancelar pedido', Icone: X, onClick: () => void mudarStatus('cancelado') }] : []),
            ]} />
            {pedido.status === 'aberto' && (
              <button type="button" className="btn-primary" onClick={() => void mudarStatus('enviado')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Send size={18} /> Marcar como enviado</button>
            )}
            {pedido.status === 'enviado' && (
              <button type="button" className="btn-primary" onClick={() => void mudarStatus('recebido')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><PackageCheck size={18} /> Marcar como recebido</button>
            )}
          </div>
        )}
      </div>

      {carregando ? (
        <div style={{ color: 'var(--text-muted)' }}>Carregando...</div>
      ) : editando ? (
        <>
          <div className="card" style={{ padding: '18px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', backgroundColor: 'var(--bg-secondary)', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '14px' }}>
            <label style={{ ...estiloRotulo, position: 'relative' }}>Fornecedor
              <ClientAutocomplete
                value={buscaFornecedor}
                onChange={(v) => { setBuscaFornecedor(v); if (!v.trim()) setFornecedor(null); }}
                clients={fornecedoresAtivos}
                onSelect={(f) => { setFornecedor({ id: f.id, nome: String(f.nome || '').trim(), celular: String(f.celular || f.telefone || '') }); setBuscaFornecedor(String(f.nome || '')); }}
                renderItem={(f) => <span>{f.codigo ? `${f.codigo} · ${f.nome}` : f.nome}</span>}
                placeholder="Buscar…"
                ariaLabel="Buscar fornecedor"
                emptyHint={<span>Nenhum fornecedor com esse nome. Cadastre em Cadastros › Fornecedores.</span>}
              />
            </label>
            <label style={estiloRotulo}>Prazo de entrega (dias)
              <input value={prazo} inputMode="numeric" onChange={(e) => setPrazo(e.target.value.replace(/\D/g, ''))} style={estiloCampo} />
            </label>
            <label style={estiloRotulo}>Condição de pagamento
              <input value={condicao} maxLength={120} onChange={(e) => setCondicao(e.target.value)} style={estiloCampo} title="Ex.: à vista, 28 dias, 30/60" />
            </label>
            <label style={{ ...estiloRotulo, gridColumn: '1 / -1' }}>Observação (sai no PDF)
              <input value={observacao} maxLength={500} onChange={(e) => setObservacao(e.target.value)} style={estiloCampo} />
            </label>
          </div>
          <GradeDeItens produtos={produtos} linhas={linhas} onMudar={setLinhas} comPreco />
          <div style={{ textAlign: 'right', fontSize: '18px', fontWeight: 800 }}>Total: {formatarReais(totalEdicao)}</div>
        </>
      ) : pedido && (
        <>
          <div className="card" style={{ padding: '18px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', backgroundColor: 'var(--bg-secondary)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', fontSize: '14px' }}>
            <div><div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Fornecedor</div><div style={{ fontWeight: 700 }}>{pedido.fornecedorNome}</div></div>
            <div><div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Prazo de entrega</div><div style={{ fontWeight: 700 }}>{pedido.prazoEntregaDias !== null ? `${pedido.prazoEntregaDias} dia(s)` : '—'}</div></div>
            <div><div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Condição de pagamento</div><div style={{ fontWeight: 700 }}>{pedido.condicaoPagamento || '—'}</div></div>
            <div><div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Total</div><div style={{ fontWeight: 800, fontSize: '18px' }}>{formatarReais(pedido.totalCentavos)}</div></div>
            {pedido.observacao && <div style={{ gridColumn: '1 / -1' }}><div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Observação</div><div>{pedido.observacao}</div></div>}
          </div>
          <div className="card list-container">
            <div className="table-wrapper">
              <table className="data-table" style={{ width: '100%' }}>
                <thead><tr><th>Código</th><th>Produto</th><th style={{ textAlign: 'right' }}>Qtd.</th><th>Und.</th><th style={{ textAlign: 'right' }}>Preço unit.</th><th style={{ textAlign: 'right' }}>Subtotal</th></tr></thead>
                <tbody>
                  {pedido.itens.map((i) => (
                    <tr key={i.produtoId}>
                      <td>{i.codigo || '—'}</td>
                      <td style={{ fontWeight: 600 }}>{i.nome}</td>
                      <td style={{ textAlign: 'right' }}>{i.quantidade.toLocaleString('pt-BR')}</td>
                      <td>{i.unidade}</td>
                      <td style={{ textAlign: 'right' }}>{formatarReais(i.precoUnitarioCentavos)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatarReais(i.subtotalCentavos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {celularDoFornecedor && (celularDoFornecedor.celular || celularDoFornecedor.telefone) && (
            <a href={linkDoWhatsApp(String(celularDoFornecedor.celular || celularDoFornecedor.telefone), textoWhats)} target="_blank" rel="noreferrer" className="btn-secondary" style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: '8px', textDecoration: 'none' }}>
              <MessageCircle size={16} /> Abrir WhatsApp do fornecedor (baixe o PDF em "Mais opções" e anexe)
            </a>
          )}
        </>
      )}
    </div>
  );
};

export default PedidoCompraForm;
