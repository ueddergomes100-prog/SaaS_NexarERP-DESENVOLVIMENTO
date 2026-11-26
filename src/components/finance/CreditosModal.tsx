import React, { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, Loader2, Wallet, X } from 'lucide-react';
import {
  creditosConsultaService,
  type ContaDoFornecedor,
  type CreditoDoCliente,
  type SaldoDoCliente,
  type SaldoDoFornecedor,
  type UsoDeCredito,
} from '../../services/creditosConsultaService';
import { useValoresOcultos } from '../../hooks/useValoresOcultos';

/*
 * CREDITOS E DE ONDE VEM CADA UM (26/11/2026, pedido do dono).
 *
 * Contas a Receber (modo "cliente"): o saldo de credito do cliente, cada
 * credito com a origem pelo numero que o usuario conhece (devolucao do pedido
 * #N, devolucao sem pedido, venda #N cancelada), quanto ja' foi usado e quanto
 * sobra, e onde foi usado. Dali abre o documento de origem.
 *
 * Contas a Pagar (modo "fornecedor"): o que o fornecedor deve a empresa
 * (devolucao ao fornecedor que passou do que estava em aberto, ou conta
 * lancada a mao), com a origem. O sistema nao tem saldo de "credito com
 * fornecedor": e' conta a receber dele.
 *
 * Sem alvo, abre a lista (quem tem credito); clicando, mostra o detalhe.
 */

type Alvo = { id: string; nome: string };

interface Props {
  modo: 'cliente' | 'fornecedor';
  alvo: Alvo | null;
  onFechar: () => void;
  /** Abre a venda de origem (aba do Pedido). */
  onAbrirPedido: (pedidoId: string, rotulo: string) => void;
  /** Abre a tela de Devolucoes (devolucao sem pedido) ou o historico de notas de entrada. */
  onAbrirTela: (caminho: string, rotulo: string) => void;
}

const moeda = (centavos: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((centavos || 0) / 100);
const dataBr = (iso: string) => {
  if (!iso) return '—';
  const s = iso.length >= 10 ? iso.slice(0, 10) : iso;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split('-').reverse().join('/') : '—';
};
const COR_STATUS: Record<string, string> = { disponivel: '#10b981', usado_parcial: '#f59e0b', esgotado: 'var(--text-muted)', cancelado: '#ef4444', aberto: '#f59e0b', recebido: '#10b981' };

const botaoLink: React.CSSProperties = { background: 'none', border: 'none', padding: 0, color: 'var(--accent-purple)', cursor: 'pointer', font: 'inherit', textAlign: 'left', display: 'inline-flex', alignItems: 'center', gap: '4px' };

const CreditosModal: React.FC<Props> = ({ modo, alvo: alvoInicial, onFechar, onAbrirPedido, onAbrirTela }) => {
  const { mostrar } = useValoresOcultos();
  const [alvo, setAlvo] = useState<Alvo | null>(alvoInicial);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [lista, setLista] = useState<Array<SaldoDoCliente | SaldoDoFornecedor>>([]);
  const [creditos, setCreditos] = useState<CreditoDoCliente[]>([]);
  const [usos, setUsos] = useState<UsoDeCredito[]>([]);
  const [contas, setContas] = useState<ContaDoFornecedor[]>([]);
  const [saldo, setSaldo] = useState(0);
  const cliente = modo === 'cliente';

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    setErro('');
    const pedido = !alvo
      ? (cliente
        ? creditosConsultaService.saldosDosClientes().then((r) => { if (ativo) setLista(r.clientes); })
        : creditosConsultaService.saldosDosFornecedores().then((r) => { if (ativo) setLista(r.fornecedores); }))
      : (cliente
        ? creditosConsultaService.doCliente(alvo).then((r) => { if (ativo) { setCreditos(r.creditos); setUsos(r.usos); setSaldo(r.saldoCentavos); } })
        : creditosConsultaService.doFornecedor(alvo.id).then((r) => { if (ativo) { setContas(r.contas); setSaldo(r.saldoCentavos); } }));
    pedido
      .catch((e) => { if (ativo) setErro(e instanceof Error ? e.message : 'Não foi possível ver os créditos agora. Tente de novo.'); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [alvo, cliente]);

  const titulo = cliente
    ? (alvo ? `Créditos de ${alvo.nome}` : 'Créditos de clientes')
    : (alvo ? `O que ${alvo.nome} deve à empresa` : 'O que os fornecedores devem à empresa');

  const abrirOrigem = (c: CreditoDoCliente) => {
    if (c.pedidoId) onAbrirPedido(c.pedidoId, c.documento);
    else if (c.tipo === 'devolucao_sem_pedido') onAbrirTela('/vendas/devolucoes', 'Devolução de Venda');
  };

  const th: React.CSSProperties = { padding: '10px 12px', fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', textAlign: 'left' };
  const td: React.CSSProperties = { padding: '10px 12px', fontSize: '13.5px', verticalAlign: 'top' };

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }} onClick={onFechar}>
      <div className="card" role="dialog" aria-modal="true" aria-label={titulo} onClick={(e) => e.stopPropagation()} style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '980px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', backgroundColor: 'var(--bg-primary)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            {alvo && !alvoInicial && (
              <button type="button" onClick={() => setAlvo(null)} aria-label="Voltar à lista" title="Voltar à lista" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><ArrowLeft size={20} /></button>
            )}
            <Wallet size={20} color="var(--accent-purple)" />
            <div style={{ minWidth: 0 }}>
              <h2 style={{ fontSize: '17px', fontWeight: 600, margin: 0 }}>{titulo}</h2>
              {alvo && !carregando && !erro && (
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  {cliente ? 'Saldo de crédito disponível' : 'Em aberto'}: <strong style={{ color: saldo > 0 ? '#10b981' : 'var(--text-primary)' }}>{mostrar(moeda(saldo))}</strong>
                </div>
              )}
            </div>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={22} /></button>
        </div>

        <div style={{ overflowY: 'auto', padding: '16px 24px 24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {carregando ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)' }}><Loader2 size={16} className="spin-icon" /> Carregando…</div>
          ) : erro ? (
            <p style={{ margin: 0, color: '#ef4444' }}>{erro}</p>
          ) : !alvo ? (
            lista.length === 0 ? (
              <p style={{ margin: 0, color: 'var(--text-muted)' }}>{cliente ? 'Nenhum cliente com crédito disponível agora.' : 'Nenhum fornecedor deve à empresa agora.'}</p>
            ) : (
              <div className="table-wrapper">
                <table className="data-table">
                  <thead><tr><th style={th}>{cliente ? 'Cliente' : 'Fornecedor'}</th><th style={{ ...th, textAlign: 'center' }}>{cliente ? 'Créditos' : 'Contas'}</th><th style={{ ...th, textAlign: 'right' }}>{cliente ? 'Saldo' : 'Em aberto'}</th></tr></thead>
                  <tbody>
                    {lista.map((l) => {
                      const id = 'clienteId' in l ? l.clienteId : l.fornecedorId;
                      const nome = 'clienteNome' in l ? l.clienteNome : l.fornecedorNome;
                      return (
                        <tr key={`${id}-${nome}`} onClick={() => setAlvo({ id, nome })} style={{ cursor: 'pointer' }} title="Ver de onde vem">
                          <td style={td}>{nome || '—'}</td>
                          <td style={{ ...td, textAlign: 'center' }}>{l.quantidade}</td>
                          <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#10b981' }}>{mostrar(moeda(l.saldoCentavos))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : cliente ? (
            <>
              {creditos.length === 0 ? (
                <p style={{ margin: 0, color: 'var(--text-muted)' }}>Este cliente não tem crédito registrado.</p>
              ) : (
                <div className="table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={th}>De onde vem</th>
                        <th style={th}>Data</th>
                        <th style={{ ...th, textAlign: 'right' }}>Valor</th>
                        <th style={{ ...th, textAlign: 'right' }}>Já usado</th>
                        <th style={{ ...th, textAlign: 'right' }}>Sobra</th>
                        <th style={th}>Situação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {creditos.map((c) => (
                        <tr key={c.id}>
                          <td style={td}>
                            <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>{c.rotulo}</div>
                            {c.pedidoId || c.tipo === 'devolucao_sem_pedido' ? (
                              <button type="button" style={botaoLink} onClick={() => abrirOrigem(c)} title={c.pedidoId ? 'Abrir a venda de origem' : 'Abrir a tela de Devoluções'}>
                                {c.documento} <ExternalLink size={12} />
                              </button>
                            ) : <span>{c.documento}</span>}
                            {c.motivo && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Motivo: {c.motivo}</div>}
                            {c.abatimentos.length > 0 && (
                              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                Abatido na hora em: {c.abatimentos.map((a) => `${a.descricao} (${mostrar(moeda(a.centavos))}${a.quitou ? ', quitou' : ''})`).join('; ')}
                              </div>
                            )}
                            {c.ultimaMovimentacao && c.usadoCentavos > 0 && (
                              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Última movimentação: {c.ultimaMovimentacao}{c.movimentadoEm ? ` em ${dataBr(c.movimentadoEm)}` : ''}</div>
                            )}
                          </td>
                          <td style={td}>{dataBr(c.criadoEm)}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{mostrar(moeda(c.valorCentavos))}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{mostrar(moeda(c.usadoCentavos))}</td>
                          <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: c.saldoCentavos > 0 ? '#10b981' : 'var(--text-muted)' }}>{mostrar(moeda(c.saldoCentavos))}</td>
                          <td style={{ ...td, fontWeight: 600, color: COR_STATUS[c.status] || 'var(--text-secondary)' }}>{c.statusRotulo}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div>
                <h3 style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 8px' }}>Onde o crédito foi usado</h3>
                {usos.length === 0 ? (
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>Nenhuma venda ou parcela paga com crédito deste cliente.</p>
                ) : (
                  <div className="table-wrapper">
                    <table className="data-table">
                      <thead><tr><th style={th}>Data</th><th style={th}>Onde</th><th style={{ ...th, textAlign: 'right' }}>Valor</th></tr></thead>
                      <tbody>
                        {usos.map((u) => (
                          <tr key={u.id}>
                            <td style={td}>{dataBr(u.data)}</td>
                            <td style={td}>
                              {u.pedidoId ? (
                                <button type="button" style={botaoLink} onClick={() => onAbrirPedido(u.pedidoId, u.descricao)} title="Abrir a venda">{u.descricao} <ExternalLink size={12} /></button>
                              ) : u.descricao}
                            </td>
                            <td style={{ ...td, textAlign: 'right' }}>{mostrar(moeda(u.centavos))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {contas.length === 0 ? (
                <p style={{ margin: 0, color: 'var(--text-muted)' }}>Este fornecedor não deve nada à empresa.</p>
              ) : (
                <div className="table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr><th style={th}>De onde vem</th><th style={th}>Data</th><th style={{ ...th, textAlign: 'right' }}>Valor</th><th style={th}>Situação</th></tr>
                    </thead>
                    <tbody>
                      {contas.map((c) => (
                        <tr key={c.id}>
                          <td style={td}>
                            <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>{c.rotulo}</div>
                            {c.notaEntradaId ? (
                              <button type="button" style={botaoLink} onClick={() => onAbrirTela('/fiscal/entrada-nfe/historico', 'Histórico de Entradas')} title="Abrir o Histórico de Entradas (a nota de compra)">{c.documento} <ExternalLink size={12} /></button>
                            ) : <span>{c.documento}</span>}
                          </td>
                          <td style={td}>{dataBr(c.criadoEm)}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{mostrar(moeda(c.valorCentavos))}</td>
                          <td style={{ ...td, fontWeight: 600, color: COR_STATUS[c.status] || 'var(--text-secondary)' }}>
                            {c.statusRotulo}{c.status === 'recebido' && c.recebidoEm ? ` em ${dataBr(c.recebidoEm)}${c.formaRecebimento ? ` (${c.formaRecebimento})` : ''}` : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-muted)' }}>
                O que o fornecedor deve aparece também no Contas a Receber, pelo nome dele. Para usar contra uma conta a pagar dele, use "Acerto com fornecedor" no Contas a Receber.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CreditosModal;
