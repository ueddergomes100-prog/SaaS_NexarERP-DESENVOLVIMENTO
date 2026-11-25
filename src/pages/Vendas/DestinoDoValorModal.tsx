import React, { useEffect, useMemo, useState } from 'react';
import { Banknote, CreditCard, Landmark, ListChecks, Loader2, X } from 'lucide-react';
import {
  FORMAS_BANCARIAS_DEVOLUCAO,
  planoDoAbatimento,
  type DestinoDevolucao,
  type DestinoDoValor,
  type FormaBancariaDevolucao,
} from '../../utils/devolucaoVendaDomain';
import { devolucaoEscritorioService, type OpcoesDoValor } from '../../services/devolucaoEscritorioService';
import { showError } from '../../utils/alerts';

/*
 * JANELA "O QUE FAZER COM O VALOR DA DEVOLUCAO" (25/11/2026, Embala Minas).
 *
 * Aparece ao confirmar QUALQUER devolucao (a feita no sistema e a que veio do
 * app). Caso real: uma devolucao de teste pelo app foi aprovada e o cliente
 * ficou sem credito -- quem confirmava nao via nem escolhia o destino.
 *  - Gerar credito do cliente;
 *  - Devolver em dinheiro (sai do caixa);
 *  - Devolver por Pix/transferencia (escolhe o banco);
 *  - Abater das parcelas em aberto do cliente no Contas a Receber: a pessoa
 *    marca as parcelas (as mais antigas ja' vem marcadas ate' cobrir o valor).
 * Devolucao com item sem pedido so' gera credito (decisao do dono).
 * Quem grava e' o servidor (services/devolucaoVendaEscritorio.js).
 */

interface Props {
  valor: number;
  cliente: { id?: string; nome: string };
  /** O que o vendedor pediu no app (ou o padrao). */
  sugerido?: { destino: DestinoDevolucao; bancoId?: string; formaBancaria?: string; doVendedor?: boolean };
  /** Itens sem pedido: so' credito. */
  soCredito?: boolean;
  ocupado?: boolean;
  onConfirmar: (destino: DestinoDoValor) => void;
  onVoltar: () => void;
}

type Tipo = DestinoDoValor['tipo'];

const moeda = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
const dataBr = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '—');

const OPCOES: Array<{ tipo: Tipo; titulo: string; texto: string; cor: string; Icone: typeof CreditCard }> = [
  { tipo: 'credito', titulo: 'Gerar crédito do cliente', texto: 'Fica de saldo para a próxima compra ou para abater depois no Contas a Receber.', cor: '#8b5cf6', Icone: CreditCard },
  { tipo: 'caixa', titulo: 'Devolver em dinheiro', texto: 'Sai do caixa hoje, com o lançamento de saída.', cor: '#10b981', Icone: Banknote },
  { tipo: 'banco', titulo: 'Devolver por Pix ou transferência', texto: 'Sai do banco escolhido hoje, com o lançamento de saída.', cor: '#3b82f6', Icone: Landmark },
  { tipo: 'abater', titulo: 'Abater das parcelas em aberto', texto: 'O valor quita as parcelas que você marcar no Contas a Receber do cliente.', cor: '#f59e0b', Icone: ListChecks },
];

const DestinoDoValorModal: React.FC<Props> = ({ valor, cliente, sugerido, soCredito = false, ocupado = false, onConfirmar, onVoltar }) => {
  const [opcoes, setOpcoes] = useState<OpcoesDoValor | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [tipo, setTipo] = useState<Tipo>(soCredito ? 'credito' : (sugerido?.destino || 'credito'));
  const [bancoId, setBancoId] = useState(sugerido?.bancoId || '');
  const [forma, setForma] = useState<FormaBancariaDevolucao>((FORMAS_BANCARIAS_DEVOLUCAO as readonly string[]).includes(sugerido?.formaBancaria || '') ? sugerido!.formaBancaria as FormaBancariaDevolucao : 'Pix');
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const valorCentavos = Math.round(valor * 100);
  const clienteId = cliente.id || '';
  const clienteNome = cliente.nome || '';

  useEffect(() => {
    let ativo = true;
    devolucaoEscritorioService.opcoesDoValor({ id: clienteId, nome: clienteNome })
      .then((r) => {
        if (!ativo) return;
        setOpcoes(r);
        // As mais antigas marcadas ate' cobrir o valor (a pessoa pode trocar).
        const iniciais: string[] = [];
        let falta = valorCentavos;
        for (const p of r.parcelas) {
          if (falta <= 0) break;
          iniciais.push(p.id);
          falta -= p.centavos;
        }
        setMarcadas(iniciais);
      })
      .catch((erro) => {
        if (!ativo) return;
        setOpcoes({ parcelas: [], bancos: [], podeAbater: false });
        showError('Não foi possível carregar as opções', erro instanceof Error ? erro.message : 'Tente de novo.');
      })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [clienteId, clienteNome, valorCentavos]);

  const parcelasMarcadas = useMemo(
    () => (opcoes?.parcelas || []).filter((p) => marcadas.includes(p.id)).sort((a, b) => marcadas.indexOf(a.id) - marcadas.indexOf(b.id)),
    [opcoes, marcadas],
  );
  const plano = planoDoAbatimento(valorCentavos, parcelasMarcadas.map((p) => ({ id: p.id, centavos: p.centavos })));
  const abatido = plano.usos.reduce((s, u) => s + u.centavos, 0);
  const parcial = plano.usos.find((u) => !u.quita);

  const disponivel = (t: Tipo): string | null => {
    if (soCredito && t !== 'credito') return 'Devolução com item sem pedido só gera crédito.';
    if (t === 'banco' && opcoes && opcoes.bancos.length === 0) return 'Nenhum banco ativo cadastrado (Cadastros > Bancos).';
    if (t === 'abater' && opcoes && !opcoes.podeAbater) return 'Você não tem a permissão "Devolução — abater o valor das parcelas".';
    if (t === 'abater' && opcoes && opcoes.parcelas.length === 0) return 'O cliente não tem parcelas em aberto que aceitem abatimento.';
    return null;
  };

  const confirmar = () => {
    if (tipo === 'banco') {
      if (!bancoId) { showError('Atenção', 'Escolha de qual banco o dinheiro sai.'); return; }
      onConfirmar({ tipo: 'banco', bancoId, formaBancaria: forma });
      return;
    }
    if (tipo === 'abater') {
      if (plano.usos.length === 0) { showError('Atenção', 'Marque pelo menos uma parcela para abater o valor.'); return; }
      // So' as parcelas que entram no abatimento, na ordem marcada.
      onConfirmar({ tipo: 'abater', parcelas: plano.usos.map((u) => u.id) });
      return;
    }
    onConfirmar({ tipo });
  };

  const alternar = (id: string) => setMarcadas((atuais) => (atuais.includes(id) ? atuais.filter((x) => x !== id) : [...atuais, id]));

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div className="card" role="dialog" aria-modal="true" aria-label="O que fazer com o valor da devolução" style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '760px', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-primary)' }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>O que fazer com o valor?</h2>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '2px' }}>
              {cliente.nome || 'Cliente'} · <strong style={{ color: 'var(--text-primary)' }}>{moeda(valor)}</strong>
              {sugerido?.doVendedor && ` · o vendedor pediu: ${OPCOES.find((o) => o.tipo === sugerido.destino)?.titulo.toLowerCase() || sugerido.destino}`}
            </div>
          </div>
          <button type="button" onClick={onVoltar} aria-label="Voltar" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={22} /></button>
        </div>

        <div style={{ overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {carregando ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)' }}><Loader2 size={16} className="spin-icon" /> Carregando…</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
                {OPCOES.map(({ tipo: t, titulo, texto, cor, Icone }) => {
                  const bloqueio = disponivel(t);
                  const escolhido = tipo === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      disabled={Boolean(bloqueio)}
                      onClick={() => setTipo(t)}
                      aria-pressed={escolhido}
                      title={bloqueio || undefined}
                      style={{ textAlign: 'left', padding: '12px', borderRadius: '8px', cursor: bloqueio ? 'not-allowed' : 'pointer', opacity: bloqueio ? 0.45 : 1, border: `2px solid ${escolhido ? cor : 'var(--border-color)'}`, backgroundColor: escolhido ? 'var(--bg-tertiary)' : 'transparent', color: 'var(--text-primary)', display: 'flex', flexDirection: 'column', gap: '6px' }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '13.5px', color: escolhido ? cor : 'var(--text-primary)' }}><Icone size={16} /> {titulo}</span>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.4 }}>{bloqueio || texto}</span>
                    </button>
                  );
                })}
              </div>

              {tipo === 'banco' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '12px' }}>
                  <div className="input-group">
                    <label htmlFor="destino-forma" style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Forma *</label>
                    <select id="destino-forma" value={forma} onChange={(e) => setForma(e.target.value as FormaBancariaDevolucao)} className="form-select">
                      {FORMAS_BANCARIAS_DEVOLUCAO.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                  <div className="input-group">
                    <label htmlFor="destino-banco" style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>De qual banco sai o dinheiro? *</label>
                    <select id="destino-banco" value={bancoId} onChange={(e) => setBancoId(e.target.value)} className="form-select">
                      <option value="">Escolha o banco</option>
                      {(opcoes?.bancos || []).map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
                    </select>
                  </div>
                </div>
              )}

              {tipo === 'abater' && opcoes && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div className="table-wrapper" style={{ maxHeight: '280px', overflowY: 'auto' }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th style={{ width: '36px' }} aria-label="Marcar" />
                          <th>Parcela</th>
                          <th>Vencimento</th>
                          <th style={{ textAlign: 'right' }}>Em aberto</th>
                          <th style={{ textAlign: 'right' }}>Abate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {opcoes.parcelas.map((p) => {
                          const uso = plano.usos.find((u) => u.id === p.id);
                          return (
                            <tr key={p.id} onClick={() => alternar(p.id)} style={{ cursor: 'pointer' }}>
                              <td><input type="checkbox" checked={marcadas.includes(p.id)} onChange={() => alternar(p.id)} onClick={(e) => e.stopPropagation()} aria-label={`Abater em ${p.descricao}`} /></td>
                              <td>{p.descricao}{p.formaPagamento ? <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}> · {p.formaPagamento}</span> : null}</td>
                              <td>{dataBr(p.vencimento)}</td>
                              <td style={{ textAlign: 'right' }}>{moeda(p.centavos / 100)}</td>
                              <td style={{ textAlign: 'right', fontWeight: 600, color: uso ? '#f59e0b' : 'var(--text-muted)' }}>{uso ? moeda(uso.centavos / 100) : marcadas.includes(p.id) ? 'não precisa' : '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ fontSize: '13px', lineHeight: 1.5 }}>
                    Abate <strong>{moeda(abatido / 100)}</strong> em {plano.usos.length} parcela(s)
                    {parcial ? `; a parcela "${opcoes.parcelas.find((p) => p.id === parcial.id)?.descricao}" fica com ${moeda(((opcoes.parcelas.find((p) => p.id === parcial.id)?.centavos || 0) - parcial.centavos) / 100)} em aberto` : ''}
                    {plano.sobraCentavos > 0 ? `. Sobra ${moeda(plano.sobraCentavos / 100)} de crédito do cliente.` : '.'}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '12px', backgroundColor: 'var(--bg-primary)' }}>
          <button type="button" className="btn-secondary" onClick={onVoltar} disabled={ocupado}>Voltar</button>
          <button type="button" className="btn-primary" onClick={confirmar} disabled={ocupado || carregando || Boolean(disponivel(tipo))}>
            {ocupado ? 'Gravando…' : 'Confirmar devolução'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DestinoDoValorModal;
