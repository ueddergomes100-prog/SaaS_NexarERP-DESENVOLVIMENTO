import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, FileText, Loader2, PackageCheck, RefreshCw, Route, Search, Truck } from 'lucide-react';
import { useTabs } from '../../contexts/TabsContext';
import { NexusSwal, showError, showSuccess, showWarning } from '../../utils/alerts';
import { ROTULO_SITUACAO_ENTREGA } from '../../utils/entregaFuturaDomain';
import {
  colocarEntregaNaRota,
  detalheDaEntregaFutura,
  emitirNotaDaEntrega,
  listarEntregasPendentes,
  registrarEntrega,
  type DetalheDaEntregaFutura,
  type PedidoAEntregar,
} from '../../services/entregaFuturaService';

/**
 * EXPEDICAO > ENTREGAS FUTURAS (23/10/2026, item 5 do dono).
 *
 * Vendas faturadas para entrega futura (Pedido de Venda com a caixa "Entrega
 * futura"): o estoque ficou reservado e a nota de simples faturamento (5.922)
 * ja' saiu. Aqui a loja registra cada entrega -- parcial ou total --, que
 * baixa o estoque, emite a nota de REMESSA (5.116/5.117) referenciando a de
 * faturamento e, se escolher, entra numa rota em montagem. Atrasados primeiro.
 * Tudo pelo servidor (server/services/entregaFutura.js).
 */

const dataBr = (iso: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const reais = (centavos: number) => (Number(centavos || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const qtd = (n: number) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

const COR_SITUACAO = { pendente: '#f59e0b', parcial: '#3b82f6', entregue: '#10b981' } as const;

const ROTULO_NOTA: Record<string, string> = {
  authorized: 'Autorizada',
  enqueued: 'Enviada à SEFAZ',
  processing: 'Processando',
  created: 'Enviada',
  rejected: 'Rejeitada',
  denied: 'Denegada',
  canceled: 'Cancelada',
  pendente: 'Emitindo...',
  nao_emitida: 'Não emitida',
  falha_envio: 'Sem confirmação',
};

const EntregasFuturas: React.FC = () => {
  const { openTab } = useTabs();
  const [lista, setLista] = useState<PedidoAEntregar[] | null>(null);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState<DetalheDaEntregaFutura | null>(null);
  const [carregandoDetalhe, setCarregandoDetalhe] = useState('');
  const [quantidades, setQuantidades] = useState<Record<number, string>>({});
  const [romaneioId, setRomaneioId] = useState('');
  const [observacao, setObservacao] = useState('');
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setLista(await listarEntregasPendentes());
      setErro('');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar as entregas. Confira a conexão.');
    }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  const abrir = async (pedidoId: string) => {
    setCarregandoDetalhe(pedidoId);
    try {
      const d = await detalheDaEntregaFutura(pedidoId);
      setAberto(d);
      // Sugere entregar tudo o que falta; a pessoa diminui o que nao vai agora.
      setQuantidades(Object.fromEntries(d.pedido.itens.map((i) => [i.indice, i.saldo > 0 ? String(i.saldo) : '0'])));
      setRomaneioId(d.rotas.length === 1 ? d.rotas[0].id : '');
      setObservacao('');
    } catch (e) {
      showError('Não foi possível abrir o pedido', e instanceof Error ? e.message : 'Tente de novo.');
    } finally {
      setCarregandoDetalhe('');
    }
  };

  const recarregarAberto = async () => {
    if (!aberto) return;
    const d = await detalheDaEntregaFutura(aberto.pedido.id).catch(() => null);
    if (d) setAberto(d);
  };

  const termo = busca.trim().toLowerCase();
  const filtrada = useMemo(() => (lista || []).filter((p) => !termo
    || p.clienteNome.toLowerCase().includes(termo)
    || p.numeroPedido.includes(termo)
    || p.itens.some((i) => i.nome.toLowerCase().includes(termo))), [lista, termo]);
  const atrasados = (lista || []).filter((p) => p.atrasada).length;

  const entregar = async () => {
    if (!aberto) return;
    const itens = aberto.pedido.itens
      .map((i) => ({ indice: i.indice, quantidade: Number(String(quantidades[i.indice] ?? '0').replace(',', '.')) || 0 }))
      .filter((l) => l.quantidade > 0);
    if (itens.length === 0) { showWarning('Informe a quantidade de pelo menos um item para entregar.'); return; }
    const resumo = itens.map((l) => {
      const item = aberto.pedido.itens.find((i) => i.indice === l.indice)!;
      return `<li>${qtd(l.quantidade)} ${item.unidade || ''} × ${item.nome}</li>`;
    }).join('');
    const notaTexto = aberto.notaFaturamento.situacao === 'autorizada'
      ? 'Sai a <strong>nota de remessa</strong> (5.116/5.117) referenciando a NF-e de faturamento.'
      : 'O pedido não tem NF-e de faturamento autorizada: a entrega sai <strong>sem nota de remessa</strong>.';
    const r = await NexusSwal.fire({
      icon: 'question',
      title: `Registrar a entrega do pedido #${aberto.pedido.numeroPedido}?`,
      html: `<ul style="text-align:left;margin:0 0 8px">${resumo}</ul><p style="text-align:left;margin:0">O estoque baixa agora. ${notaTexto}</p>`,
      showCancelButton: true,
      confirmButtonText: 'Registrar entrega',
      cancelButtonText: 'Voltar',
    });
    if (!r.isConfirmed) return;
    setEnviando(true);
    try {
      const res = await registrarEntrega(aberto.pedido.id, { itens, ...(romaneioId ? { romaneioId } : {}), ...(observacao.trim() ? { observacao: observacao.trim() } : {}) });
      const partes = [
        `${res.titulo} registrada.`,
        res.nota?.ok ? 'Nota de remessa enviada à SEFAZ.' : '',
        res.rota?.rota ? `Entrou na ${res.rota.rota.titulo}.` : '',
      ].filter(Boolean).join(' ');
      if (res.avisos.length > 0) showWarning(`${partes} ${res.avisos.join(' ')}`);
      else showSuccess(partes);
      await Promise.all([carregar(), recarregarAberto()]);
      if (res.situacao === 'entregue') setAberto(null);
    } catch (e) {
      showError('Entrega não registrada', e instanceof Error ? e.message : 'Tente de novo.');
    } finally {
      setEnviando(false);
    }
  };

  const reemitir = async (entregaId: string) => {
    setEnviando(true);
    try {
      const r = await emitirNotaDaEntrega(entregaId);
      if (r.ok) showSuccess('Nota de remessa enviada à SEFAZ.');
      else showError('A nota de remessa não saiu', r.mensagem || 'Confira o cadastro e tente de novo.');
      await recarregarAberto();
    } catch (e) {
      showError('A nota de remessa não saiu', e instanceof Error ? e.message : 'Tente de novo.');
    } finally {
      setEnviando(false);
    }
  };

  const porNaRota = async (entregaId: string) => {
    if (!aberto) return;
    if (aberto.rotas.length === 0) { showWarning('Nenhuma rota em montagem. Crie uma em Expedição › Romaneio de Entrega.'); return; }
    const opcoes = Object.fromEntries(aberto.rotas.map((r) => [r.id, r.titulo]));
    const escolha = aberto.rotas.length === 1
      ? { isConfirmed: true, value: aberto.rotas[0].id }
      : await NexusSwal.fire({ title: 'Em qual rota?', input: 'select', inputOptions: opcoes, showCancelButton: true, confirmButtonText: 'Colocar', cancelButtonText: 'Voltar' });
    if (!escolha.isConfirmed || !escolha.value) return;
    try {
      const r = await colocarEntregaNaRota(entregaId, String(escolha.value));
      showSuccess(`Entrega colocada na ${r.rota.titulo}.`);
      await recarregarAberto();
    } catch (e) {
      showError('Não entrou na rota', e instanceof Error ? e.message : 'Tente de novo.');
    }
  };

  return (
    <div className="financeiro-page" style={{ padding: '24px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <PackageCheck size={26} color="var(--accent-purple)" /> Entregas futuras
          </h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>
            Vendas já faturadas com a mercadoria ainda reservada. Registre cada entrega: o estoque baixa, sai a nota de remessa e o pedido pode ir para a rota.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => void carregar()} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <RefreshCw size={16} /> Atualizar
        </button>
      </div>

      {erro && <div className="card" style={{ padding: '12px 16px', marginBottom: '14px', border: '1px solid #ef4444', color: 'var(--text-primary)' }}>{erro}</div>}

      <div style={{ display: 'flex', gap: '12px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="search-bar" style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
          <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar…" title="Cliente, número do pedido ou produto" style={{ width: '100%', padding: '10px 14px 10px 40px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }} />
        </div>
        {atrasados > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '999px', fontSize: '13px', fontWeight: 700, backgroundColor: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>
            <AlertTriangle size={15} /> {atrasados} atrasada(s)
          </span>
        )}
      </div>

      <div className="card list-container">
        <div className="table-wrapper">
          <table className="data-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Cliente</th>
                <th>Faturado em</th>
                <th>Previsão</th>
                <th>Falta entregar</th>
                <th style={{ textAlign: 'right' }}>Valor</th>
                <th>Nota de faturamento</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {lista === null && !erro ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>Carregando...</td></tr>
              ) : filtrada.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    <Truck size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                    <div>{(lista || []).length === 0 ? 'Nenhuma entrega futura pendente.' : 'Nenhum pedido com essa busca.'}</div>
                  </td>
                </tr>
              ) : filtrada.map((p) => {
                const faltam = p.itens.filter((i) => i.saldo > 1e-9);
                return (
                  <tr key={p.id} onClick={() => void abrir(p.id)} style={{ cursor: 'pointer', ...(aberto?.pedido.id === p.id ? { backgroundColor: 'var(--bg-tertiary)' } : {}) }}>
                    <td style={{ fontWeight: 700 }}>#{p.numeroPedido}{carregandoDetalhe === p.id && <Loader2 size={14} style={{ marginLeft: 6, animation: 'spin 1s linear infinite' }} />}</td>
                    <td>{p.clienteNome}</td>
                    <td>{dataBr(p.dataVenda)}</td>
                    <td style={p.atrasada ? { color: '#ef4444', fontWeight: 700 } : undefined}>
                      {p.previsaoEntrega ? dataBr(p.previsaoEntrega) : '—'}{p.atrasada ? ' · atrasada' : ''}
                    </td>
                    <td style={{ fontSize: '13px', whiteSpace: 'nowrap' }} title={faltam.map((i) => `${qtd(i.saldo)} ${i.unidade} ${i.nome}`).join('\n')}>
                      {faltam.length} item(ns) · {qtd(faltam.reduce((t, i) => t + i.saldo, 0))} un.
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{reais(p.valorTotalCentavos)}</td>
                    <td style={{ fontSize: '13px' }}>{p.notaFaturamento ? `NF-e ${p.notaFaturamento.numero ?? ''} · ${ROTULO_NOTA[String(p.notaFaturamento.status)] || p.notaFaturamento.status}` : 'Sem nota'}</td>
                    <td>
                      <span style={{ padding: '3px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 700, backgroundColor: `${COR_SITUACAO[p.situacao]}20`, color: COR_SITUACAO[p.situacao] }}>
                        {ROTULO_SITUACAO_ENTREGA[p.situacao]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {aberto && (
        <div className="card" style={{ marginTop: '18px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Pedido #{aberto.pedido.numeroPedido} · {aberto.pedido.clienteNome}</h2>
              <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '13px' }}>
                Faturado em {dataBr(aberto.pedido.dataVenda)}{aberto.pedido.previsaoEntrega ? ` · previsão ${dataBr(aberto.pedido.previsaoEntrega)}` : ''} · vendedor {aberto.pedido.vendedorNome || '—'}
              </p>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: aberto.notaFaturamento.situacao === 'autorizada' ? '#10b981' : '#f59e0b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <FileText size={14} />
                {aberto.notaFaturamento.situacao === 'autorizada'
                  ? `NF-e de faturamento nº ${aberto.notaFaturamento.numero ?? ''} autorizada — a remessa referencia esta nota.`
                  : aberto.notaFaturamento.situacao === 'em_transito'
                    ? 'NF-e de faturamento aguardando a SEFAZ: espere a resposta antes de entregar.'
                    : 'Sem NF-e de faturamento: a entrega sai sem nota de remessa.'}
              </p>
            </div>
            <button type="button" className="btn-secondary" onClick={() => openTab(`/pedidos-venda/visualizar/${aberto.pedido.id}`)}>Abrir o pedido</button>
          </div>

          <div className="table-wrapper">
            <table className="data-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Item</th>
                  <th style={{ textAlign: 'right' }}>Vendido</th>
                  <th style={{ textAlign: 'right' }}>Entregue</th>
                  <th style={{ textAlign: 'right' }}>Falta</th>
                  <th style={{ width: '160px' }}>Entregar agora</th>
                </tr>
              </thead>
              <tbody>
                {aberto.pedido.itens.map((i) => (
                  <tr key={i.indice}>
                    <td>{i.nome}{i.controlaLote ? <span style={{ marginLeft: 6, fontSize: '11px', color: 'var(--text-muted)' }}>· sai do lote que vence antes</span> : null}</td>
                    <td style={{ textAlign: 'right' }}>{qtd(i.vendida)} {i.unidade}</td>
                    <td style={{ textAlign: 'right' }}>{qtd(i.entregue)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{qtd(i.saldo)}</td>
                    <td>
                      <input
                        inputMode="decimal"
                        aria-label={`Quantidade de ${i.nome} a entregar agora`}
                        title={`No máximo ${qtd(i.saldo)}`}
                        value={quantidades[i.indice] ?? ''}
                        onChange={(e) => setQuantidades((q) => ({ ...q, [i.indice]: e.target.value.replace(/[^\d.,]/g, '') }))}
                        disabled={i.saldo <= 1e-9 || enviando}
                        style={{ width: '100%', padding: '8px 10px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', textAlign: 'right' }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: 'var(--text-secondary)', minWidth: '220px' }}>
              Rota (opcional)
              <select value={romaneioId} onChange={(e) => setRomaneioId(e.target.value)} disabled={enviando} style={{ padding: '9px 12px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}>
                <option value="">Sem rota agora</option>
                {aberto.rotas.map((r) => <option key={r.id} value={r.id}>{r.titulo} ({r.quantidadePedidos})</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: 'var(--text-secondary)', flex: 1, minWidth: '220px' }}>
              Observação (opcional)
              <input value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={300} disabled={enviando} style={{ padding: '9px 12px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }} />
            </label>
            <button type="button" className="btn-primary" onClick={() => void entregar()} disabled={enviando || aberto.notaFaturamento.situacao === 'em_transito'} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '11px 18px' }}>
              {enviando ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Truck size={16} />} Registrar entrega
            </button>
          </div>

          {aberto.entregas.length > 0 && (
            <div>
              <h3 style={{ margin: '4px 0 8px', fontSize: '15px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}><CalendarClock size={16} /> Entregas feitas</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {aberto.entregas.map((e) => {
                  const st = e.notaFiscal?.status || '';
                  const notaFalhou = st === 'nao_emitida' || st === 'falha_envio' || st === 'rejected';
                  return (
                    <div key={e.id} style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                      <div style={{ fontSize: '13px' }}>
                        <strong>{e.titulo}</strong> · {dataBr(e.criadoEmIso)} · {e.criadoPorNome} · {reais(e.valorCentavos)}
                        <div style={{ color: 'var(--text-muted)' }}>{e.itens.map((i) => `${qtd(i.quantidade)} ${i.unidade} ${i.nome}${i.lotes.length ? ` (lote ${i.lotes.map((l) => l.lote).join(', ')})` : ''}`).join(' · ')}</div>
                        {e.observacao && <div style={{ color: 'var(--text-muted)' }}>{e.observacao}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', fontSize: '12px' }}>
                        <span title={e.notaFiscal?.mensagem || ''} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: notaFalhou ? '#ef4444' : st === 'authorized' ? '#10b981' : 'var(--text-muted)' }}>
                          {st === 'authorized' ? <CheckCircle2 size={14} /> : <FileText size={14} />}
                          {e.notaFiscal ? `Remessa ${e.notaFiscal.number ? `nº ${e.notaFiscal.number} · ` : ''}${ROTULO_NOTA[st] || st}` : 'Sem nota'}
                        </span>
                        {notaFalhou && (
                          <button type="button" className="btn-secondary" onClick={() => void reemitir(e.id)} disabled={enviando} style={{ padding: '6px 10px', fontSize: '12px' }} title={e.notaFiscal?.mensagem || ''}>
                            Emitir a nota de novo
                          </button>
                        )}
                        {e.romaneio
                          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Route size={14} /> {e.romaneio.titulo}</span>
                          : (
                            <button type="button" className="btn-secondary" onClick={() => void porNaRota(e.id)} style={{ padding: '6px 10px', fontSize: '12px' }}>
                              Colocar na rota
                            </button>
                          )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default EntregasFuturas;
