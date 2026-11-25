import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, PackageSearch, RotateCcw, Trash2, X } from 'lucide-react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import ClientAutocomplete from '../../components/common/ClientAutocomplete';
import ProductAutocomplete from '../../components/common/ProductAutocomplete';
import { renderProdutoOpcaoBusca } from '../../components/common/ProdutoOpcaoBusca';
import { acompanharCatalogoEstoque } from '../../services/catalogoEstoqueService';
import { NexusSwal, escaparHtml, showError } from '../../utils/alerts';
import { hasTenantFullAccess } from '../../utils/roles';
import { aplicarCaixaAltaCadastro } from '../../utils/textoCadastroDomain';
import { lerNumeroDigitado } from '../../utils/notaManualItensDomain';
import { isValidSaleQuantity } from '../../utils/saleQuantity';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import { PARAMETROS_VENDA_PADRAO, checarPrazoDevolucao, parseParametrosVenda, type ParametrosVenda } from '../../utils/parametrosVendaDomain';
import {
  MOTIVOS_DEVOLUCAO,
  PERMISSAO_DEVOLUCAO_ALTERAR_PRECO,
  PERMISSAO_DEVOLUCAO_SEM_PEDIDO,
  type DestinoDoValor,
} from '../../utils/devolucaoVendaDomain';
import {
  devolucaoEscritorioService,
  novoIdDeDevolucao,
  type PedidoDoClienteComProduto,
} from '../../services/devolucaoEscritorioService';
import DestinoDoValorModal from './DestinoDoValorModal';
import { textoDoDestino } from './destinoDoValorTexto';

/*
 * DEVOLUCAO ESCOLHENDO CLIENTE E PRODUTOS (25/11/2026, Embala Minas).
 *
 * Sem digitar o pedido: escolhe o cliente e os produtos; para cada produto o
 * sistema mostra os pedidos do cliente que tem aquele produto (e quanto ainda
 * da' para devolver de cada um) e a pessoa diz de qual pedido sai cada
 * quantidade. Uma devolucao pode juntar itens de pedidos diferentes: cada
 * pedido fica com a sua devolucao, com os itens dele.
 *
 * SEM PEDIDO (o cliente comprou antes do sistema): devolve assim mesmo, fica
 * registrado "sem pedido" e gera CREDITO pelo PRECO DE VENDA do cadastro;
 * so' o dono e quem tem a permissao propria alteram esse preco. Fazer
 * devolucao sem pedido tambem tem permissao propria. Tudo conferido de novo
 * no servidor (services/devolucaoVendaEscritorio.js).
 */

interface Props {
  onClose: () => void;
  /** Quem ja' sabe o numero do pedido abre a escolha antiga. */
  onPeloNumeroDoPedido: () => void;
  /** Ids das devolucoes gravadas, para imprimir os comprovantes. */
  onComprovantes: (ids: string[]) => void;
}

interface ClienteDaBusca {
  id: string;
  nome: string;
  codigo?: string;
  documento?: string;
  cpfCnpj?: string;
  ativo?: boolean;
}

interface ProdutoDaBusca {
  id: string;
  nome: string;
  codigo?: string;
  codigoBarras?: string;
  referencia?: string;
  marca?: string;
  categoria?: string;
  ativo?: boolean;
  temGrade?: boolean;
  precoVenda?: number;
  quantidade?: number;
  unidadeMedidaSigla?: string;
  unidadeMedidaFracionado?: boolean;
  unidadeMedidaCasasDecimais?: number;
}

const moeda = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
const dataBr = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '—');
const chaveDaLinha = (pedidoId: string, indice: number) => `${pedidoId}#${indice}`;

const DevolucaoPorClienteModal: React.FC<Props> = ({ onClose, onPeloNumeroDoPedido, onComprovantes }) => {
  const { tenantId, isOwner, userRole, userPermissions, controlaFiscal } = useAuth();
  const acessoTotal = hasTenantFullAccess(userRole, isOwner);
  const podeSemPedido = acessoTotal || Boolean(userPermissions?.includes(PERMISSAO_DEVOLUCAO_SEM_PEDIDO));
  const podeAlterarPreco = acessoTotal || Boolean(userPermissions?.includes(PERMISSAO_DEVOLUCAO_ALTERAR_PRECO));

  const { items: clientes } = useTenantCollection<ClienteDaBusca>('clientes', tenantId);
  const [buscaCliente, setBuscaCliente] = useState('');
  const [cliente, setCliente] = useState<ClienteDaBusca | null>(null);
  const [catalogo, setCatalogo] = useState<ProdutoDaBusca[]>([]);
  const [buscaProduto, setBuscaProduto] = useState('');
  const [produtos, setProdutos] = useState<ProdutoDaBusca[]>([]);
  const [pedidos, setPedidos] = useState<PedidoDoClienteComProduto[]>([]);
  const [carregandoPedidos, setCarregandoPedidos] = useState(false);
  const [quantidades, setQuantidades] = useState<Record<string, string>>({});
  const [semPedido, setSemPedido] = useState<Record<string, { quantidade: string; preco: string }>>({});
  const [motivo, setMotivo] = useState('');
  const [observacao, setObservacao] = useState('');
  const [parametrosVenda, setParametrosVenda] = useState<ParametrosVenda>(PARAMETROS_VENDA_PADRAO);
  const [escolhendoDestino, setEscolhendoDestino] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [idDocumento] = useState(novoIdDeDevolucao);

  useEffect(() => {
    if (!tenantId) return undefined;
    getDoc(doc(db, 'configuracoes', tenantId))
      .then((snap) => setParametrosVenda(parseParametrosVenda(snap.exists() ? snap.data().parametrosVenda : undefined)))
      .catch(() => setParametrosVenda(PARAMETROS_VENDA_PADRAO));
    return acompanharCatalogoEstoque(tenantId, (snap) => setCatalogo(snap.docs.map((d) => {
      const p = d.data();
      return {
        id: d.id,
        nome: String(p.nome || ''),
        codigo: p.codigo,
        codigoBarras: p.codigoBarras,
        referencia: p.referencia,
        marca: p.marca,
        categoria: p.categoria,
        ativo: p.ativo,
        temGrade: p.temGrade,
        precoVenda: Number(p.precoVenda) || 0,
        quantidade: Number(p.quantidade) || 0,
        unidadeMedidaSigla: p.unidadeMedidaSigla,
        unidadeMedidaFracionado: p.unidadeMedidaFracionado,
        unidadeMedidaCasasDecimais: p.unidadeMedidaCasasDecimais,
      };
    })), (erro) => console.error('Nao foi possivel carregar os produtos:', erro));
  }, [tenantId]);

  // Pedidos do cliente com os produtos escolhidos (o servidor confere o que sobra para devolver).
  const idsProdutos = produtos.map((p) => p.id).join(',');
  useEffect(() => {
    if (!cliente || !idsProdutos) { setPedidos([]); return undefined; }
    let ativo = true;
    setCarregandoPedidos(true);
    devolucaoEscritorioService.pedidosDoCliente(cliente.id, idsProdutos.split(','))
      .then((r) => { if (ativo) setPedidos(r.pedidos); })
      .catch((erro) => { if (ativo) showError('Não foi possível buscar os pedidos do cliente', erro instanceof Error ? erro.message : 'Tente de novo.'); })
      .finally(() => { if (ativo) setCarregandoPedidos(false); });
    return () => { ativo = false; };
  }, [cliente, idsProdutos]);

  const escolherProduto = (p: ProdutoDaBusca) => {
    setBuscaProduto('');
    setProdutos((atuais) => (atuais.some((x) => x.id === p.id) ? atuais : [...atuais, p]));
  };

  const tirarProduto = (id: string) => {
    setProdutos((atuais) => atuais.filter((p) => p.id !== id));
    setSemPedido((atual) => { const n = { ...atual }; delete n[id]; return n; });
  };

  /** Linhas de cada produto: de qual pedido sai e quanto. */
  const linhasDoProduto = (produtoId: string) => pedidos.flatMap((pedido) => pedido.linhas
    .filter((l) => l.produtoId === produtoId)
    .map((l) => ({ pedido, linha: l })));

  const valorDaLinha = (l: { quantidade: number; precoUnitario: number; desconto: number }, q: number) => (
    q > 0 && l.quantidade > 0 ? (q * l.precoUnitario) - (l.desconto * (q / l.quantidade)) : 0
  );

  const total = useMemo(() => {
    let soma = 0;
    pedidos.forEach((pedido) => pedido.linhas.forEach((l) => {
      soma += valorDaLinha(l, lerNumeroDigitado(quantidades[chaveDaLinha(pedido.id, l.indice)]));
    }));
    Object.values(semPedido).forEach((s) => { soma += lerNumeroDigitado(s.quantidade) * lerNumeroDigitado(s.preco); });
    return Math.round(soma * 100) / 100;
  }, [pedidos, quantidades, semPedido]);

  const temSemPedido = Object.values(semPedido).some((s) => lerNumeroDigitado(s.quantidade) > 0);

  /** Confere tudo antes da janela do destino. Mensagem em portugues, ou null. */
  const conferir = (): string | null => {
    if (!cliente) return 'Escolha o cliente da devolução.';
    if (produtos.length === 0) return 'Escolha pelo menos um produto.';
    for (const pedido of pedidos) {
      for (const l of pedido.linhas) {
        const q = lerNumeroDigitado(quantidades[chaveDaLinha(pedido.id, l.indice)]);
        if (q <= 0) continue;
        if (q > l.disponivel) return `${l.nome} do pedido #${pedido.numeroPedido}: dá para devolver no máximo ${l.disponivel.toLocaleString('pt-BR')}.`;
        if (!isValidSaleQuantity(q, l.fracionado, 3)) return `${l.nome} do pedido #${pedido.numeroPedido}: a quantidade precisa ser inteira.`;
      }
    }
    for (const p of produtos) {
      const s = semPedido[p.id];
      const q = s ? lerNumeroDigitado(s.quantidade) : 0;
      if (q <= 0) continue;
      if (!isValidSaleQuantity(q, p.unidadeMedidaFracionado === true, p.unidadeMedidaCasasDecimais)) return `${p.nome} (sem pedido): a quantidade precisa ser inteira.`;
      if (!(lerNumeroDigitado(s.preco) > 0)) return `${p.nome} (sem pedido): o produto está sem preço de venda no cadastro. Informe o preço no Estoque${podeAlterarPreco ? ' ou digite aqui' : ''}.`;
    }
    if (!(total > 0)) return 'Digite a quantidade a devolver em pelo menos um pedido (ou sem pedido).';
    if (!motivo) return 'Escolha o motivo da devolução.';
    return null;
  };

  const continuar = async () => {
    const erro = conferir();
    if (erro) { showError('Confira a devolução', erro); return; }
    // Prazo de devolucao da filial, pedido por pedido (parametros de venda).
    const hoje = getDateInputInTimeZone();
    const usados = pedidos.filter((p) => p.linhas.some((l) => lerNumeroDigitado(quantidades[chaveDaLinha(p.id, l.indice)]) > 0));
    const fora = usados.map((p) => ({ p, prazo: checarPrazoDevolucao(parametrosVenda, p.dataVenda, hoje) })).filter((x) => x.prazo.foraDoPrazo);
    const bloqueado = fora.find((x) => x.prazo.acao === 'bloquear');
    if (bloqueado) { showError('Devolução fora do prazo', `Pedido #${bloqueado.p.numeroPedido}: ${bloqueado.prazo.mensagem}`); return; }
    if (fora.length > 0) {
      const seguir = await NexusSwal.fire({
        icon: 'warning',
        title: 'Devolução fora do prazo',
        html: fora.map((x) => `<p style="margin:0 0 6px">Pedido #${escaparHtml(x.p.numeroPedido)}: ${escaparHtml(x.prazo.mensagem)}</p>`).join(''),
        showCancelButton: true,
        confirmButtonText: 'Registrar mesmo assim',
        cancelButtonText: 'Voltar',
      });
      if (!seguir.isConfirmed) return;
    }
    setEscolhendoDestino(true);
  };

  const pedidosComNota = async (ids: string[]): Promise<string[]> => {
    if (!controlaFiscal || !tenantId) return [];
    const comNota: string[] = [];
    for (const id of ids) {
      try {
        const snap = await getDocs(query(collection(db, 'notas_fiscais'), where('tenantId', '==', tenantId), where('pedidoId', '==', id)));
        if (snap.docs.some((d) => d.data().status === 'authorized' && ['NF-e', 'NFC-e'].includes(d.data().tipo) && d.data().finalidade !== 'devolucao')) comNota.push(id);
      } catch {
        // So' o aviso da nota: sem conseguir consultar, segue.
      }
    }
    return comNota;
  };

  const gravar = async (destino: DestinoDoValor) => {
    if (!cliente || gravando) return;
    setGravando(true);
    try {
      const r = await devolucaoEscritorioService.registrar({
        idDocumento,
        clienteId: cliente.id,
        clienteNome: cliente.nome,
        pedidos: pedidos
          .map((p) => ({ pedidoId: p.id, itens: p.linhas.map((l) => ({ indice: l.indice, quantidade: lerNumeroDigitado(quantidades[chaveDaLinha(p.id, l.indice)]) })).filter((i) => i.quantidade > 0) }))
          .filter((g) => g.itens.length > 0),
        semPedido: produtos
          .filter((p) => lerNumeroDigitado(semPedido[p.id]?.quantidade) > 0)
          .map((p) => {
            const preco = lerNumeroDigitado(semPedido[p.id]?.preco);
            const doCadastro = Math.round((Number(p.precoVenda) || 0) * 100) / 100;
            return { produtoId: p.id, quantidade: lerNumeroDigitado(semPedido[p.id]?.quantidade), precoUnitario: Math.abs(preco - doCadastro) > 0.004 ? preco : null };
          }),
        motivo,
        observacao,
        destino,
      });
      setEscolhendoDestino(false);
      const comNota = await pedidosComNota(r.devolucoes.filter((d) => d.pedidoId).map((d) => d.pedidoId));
      const numerosComNota = r.devolucoes.filter((d) => comNota.includes(d.pedidoId)).map((d) => `#${d.numeroPedido}`);
      const partes = r.devolucoes.map((d) => (d.semPedido ? `Sem pedido: ${moeda(d.valor)}` : `Pedido #${d.numeroPedido}: ${moeda(d.valor)}`));
      const fim = await NexusSwal.fire({
        icon: 'success',
        title: r.jaEnviada ? 'Esta devolução já estava registrada' : 'Devolução registrada',
        html: `<div style="text-align:left;font-size:14px;line-height:1.5">${partes.map((x) => `<p style="margin:0 0 4px">${escaparHtml(x)}</p>`).join('')}`
          + `<p style="margin:10px 0 0">${escaparHtml(r.jaEnviada ? 'O envio anterior chegou; nada foi gravado de novo.' : textoDoDestino(r.destino, r.bancoNome, r.sobraDeCreditoCentavos))}</p>`
          + (numerosComNota.length ? `<p style="margin:10px 0 0;color:#d97706">O pedido ${escaparHtml(numerosComNota.join(', '))} tem nota fiscal autorizada: emita a NF-e de devolução em Notas Fiscais.</p>` : '')
          + '</div>',
        showCancelButton: true,
        confirmButtonText: r.devolucoes.length > 1 ? 'Imprimir os comprovantes' : 'Imprimir comprovante',
        cancelButtonText: 'Fechar',
      });
      onClose();
      if (fim.isConfirmed) onComprovantes(r.devolucoes.map((d) => d.id));
    } catch (erro) {
      showError('Não foi possível registrar a devolução', erro instanceof Error ? erro.message : 'Tente de novo.');
    } finally {
      setGravando(false);
    }
  };

  const campo: React.CSSProperties = { padding: '6px 8px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', textAlign: 'right', width: '90px' };

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div className="card" role="dialog" aria-modal="true" aria-label="Fazer devolução" style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '980px', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-primary)' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}><RotateCcw size={20} color="var(--accent-purple)" /> Fazer devolução</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button type="button" className="btn-secondary" onClick={onPeloNumeroDoPedido} style={{ fontSize: '12.5px', padding: '6px 10px' }}>Já sei o número do pedido</button>
            <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={22} /></button>
          </div>
        </div>

        <div style={{ overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
            <div className="input-group">
              <label style={{ fontSize: '13px', fontWeight: 600 }}>1. Cliente</label>
              <ClientAutocomplete<ClienteDaBusca>
                value={buscaCliente}
                onChange={(v) => { setBuscaCliente(v); if (!v.trim()) setCliente(null); }}
                clients={clientes}
                onSelect={(c) => { setBuscaCliente(c.nome); setCliente(c); setQuantidades({}); }}
                ariaLabel="Buscar cliente da devolução"
                buscaDeCliente
              />
            </div>
            <div className="input-group">
              <label style={{ fontSize: '13px', fontWeight: 600 }}>2. Produtos devolvidos</label>
              <ProductAutocomplete<ProdutoDaBusca>
                value={buscaProduto}
                onChange={setBuscaProduto}
                products={catalogo}
                onSelect={escolherProduto}
                renderItem={renderProdutoOpcaoBusca}
                ariaLabel="Buscar produto devolvido"
                travarAoSelecionar={false}
                disabled={!cliente}
              />
            </div>
          </div>

          {!cliente && <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>Escolha o cliente e depois os produtos: o sistema mostra os pedidos dele que têm cada produto.</p>}
          {carregandoPedidos && <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '13px' }}><Loader2 size={15} className="spin-icon" /> Buscando os pedidos do cliente…</div>}

          {produtos.map((p) => {
            const linhas = linhasDoProduto(p.id);
            const sp = semPedido[p.id];
            return (
              <div key={p.id} style={{ border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
                <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-tertiary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                  <strong style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}><PackageSearch size={16} /> {p.nome}</strong>
                  <button type="button" onClick={() => tirarProduto(p.id)} aria-label={`Tirar ${p.nome}`} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}><Trash2 size={16} /></button>
                </div>
                {linhas.length > 0 ? (
                  <table className="data-table" style={{ margin: 0 }}>
                    <thead>
                      <tr><th>Pedido</th><th>Data</th><th style={{ textAlign: 'right' }}>Vendido</th><th style={{ textAlign: 'right' }}>Pode devolver</th><th style={{ textAlign: 'right' }}>Preço</th><th style={{ textAlign: 'right' }}>Devolver</th></tr>
                    </thead>
                    <tbody>
                      {linhas.map(({ pedido, linha }) => {
                        const chave = chaveDaLinha(pedido.id, linha.indice);
                        return (
                          <tr key={chave}>
                            <td style={{ fontWeight: 600 }}>#{pedido.numeroPedido}</td>
                            <td>{dataBr(pedido.dataVenda)}</td>
                            <td style={{ textAlign: 'right' }}>{linha.quantidade.toLocaleString('pt-BR')} {linha.unidadeMedidaSigla}</td>
                            <td style={{ textAlign: 'right' }}>{linha.disponivel.toLocaleString('pt-BR')}</td>
                            <td style={{ textAlign: 'right' }}>{moeda(linha.precoUnitario)}</td>
                            <td style={{ textAlign: 'right' }}>
                              <input type="text" inputMode="decimal" aria-label={`Quantidade de ${linha.nome} a devolver do pedido ${pedido.numeroPedido}`} value={quantidades[chave] || ''} onChange={(e) => setQuantidades((q) => ({ ...q, [chave]: e.target.value }))} style={campo} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : !carregandoPedidos && (
                  <p style={{ margin: 0, padding: '10px 14px', fontSize: '13px', color: '#d97706' }}>Nenhum pedido faturado deste cliente tem este produto (ou já foi todo devolvido).</p>
                )}
                {podeSemPedido && (
                  <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontSize: '13px' }}>
                    <span style={{ flex: '1 1 260px', color: 'var(--text-secondary)' }}>Sem pedido (comprou antes do sistema): gera crédito pelo preço do cadastro.</span>
                    <label htmlFor={`sp-q-${p.id}`}>Qtd</label>
                    <input id={`sp-q-${p.id}`} type="text" inputMode="decimal" value={sp?.quantidade || ''} onChange={(e) => setSemPedido((a) => ({ ...a, [p.id]: { quantidade: e.target.value, preco: a[p.id]?.preco ?? (Number(p.precoVenda) || 0).toFixed(2).replace('.', ',') } }))} style={campo} />
                    <label htmlFor={`sp-p-${p.id}`}>Preço</label>
                    <input
                      id={`sp-p-${p.id}`}
                      type="text"
                      inputMode="decimal"
                      value={sp?.preco ?? (Number(p.precoVenda) || 0).toFixed(2).replace('.', ',')}
                      onChange={(e) => setSemPedido((a) => ({ ...a, [p.id]: { quantidade: a[p.id]?.quantidade || '', preco: e.target.value } }))}
                      disabled={!podeAlterarPreco}
                      title={podeAlterarPreco ? 'Preço do cadastro; você pode mudar' : 'Só o dono e quem tem a permissão "Devolução sem pedido — alterar o preço" mudam este preço'}
                      style={{ ...campo, opacity: podeAlterarPreco ? 1 : 0.7 }}
                    />
                  </div>
                )}
              </div>
            );
          })}

          {produtos.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '14px' }}>
              <div className="input-group">
                <label htmlFor="dev-motivo" style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Motivo *</label>
                <select id="dev-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} className="form-select">
                  <option value="">Selecione</option>
                  {MOTIVOS_DEVOLUCAO.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="input-group">
                <label htmlFor="dev-obs" style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Observação (opcional)</label>
                <input id="dev-obs" type="text" value={observacao} onChange={(e) => setObservacao(aplicarCaixaAltaCadastro(e.target, e.target.value))} />
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', backgroundColor: 'var(--bg-primary)' }}>
          <span style={{ fontSize: '14px' }}>Total a devolver: <strong style={{ fontSize: '18px', color: '#10b981' }}>{moeda(total)}</strong>{temSemPedido ? <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}> · com item sem pedido: só crédito</span> : null}</span>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="button" className="btn-primary" onClick={() => void continuar()} disabled={gravando || !(total > 0)}>Continuar</button>
          </div>
        </div>
      </div>

      {escolhendoDestino && cliente && (
        <DestinoDoValorModal
          valor={total}
          cliente={{ id: cliente.id, nome: cliente.nome }}
          soCredito={temSemPedido}
          ocupado={gravando}
          onConfirmar={(d) => void gravar(d)}
          onVoltar={() => setEscolhendoDestino(false)}
        />
      )}
    </div>
  );
};

export default DevolucaoPorClienteModal;
