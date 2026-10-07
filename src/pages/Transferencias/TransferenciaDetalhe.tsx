import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, FileText, Loader2, PackageCheck, RefreshCw, Send, Undo2, XCircle } from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { NexusSwal, showError, showSuccess, showWarning } from '../../utils/alerts';
import { ROTULO_STATUS_TRANSFERENCIA } from '../../utils/transferenciaDomain';
import { STATUS_NOTA_SEM_VALOR, rotuloStatusNota, statusEfetivoDaNota } from '../../utils/notaTransferenciaDomain';
import {
  cancelarTransferencia,
  consultarNotaDaTransferencia,
  receberTransferencia,
  recusarTransferencia,
  reemitirNotaDaTransferencia,
} from '../../services/transferenciaService';
import { ESTILO_STATUS_TRANSFERENCIA, dataHora, moeda, quantidade as fmtQtd, type TransferenciaDoc } from './transferenciaTipos';

/**
 * DETALHE DA TRANSFERENCIA (Filiais, fase 3). Na filial de destino, a
 * transferencia em transito e' CONFERIDA: cada item comeca com o enviado e a
 * pessoa corrige o que chegou; a falta volta para a origem. O destino tambem
 * pode recusar tudo; a origem pode cancelar enquanto nao foi recebida.
 * Fase 4: com nota, o quadro "Nota fiscal" mostra a situacao (espelho gravado
 * pelo servidor), deixa consultar a Spedy e, na origem, emitir de novo
 * quando a nota nao vale; o recebimento so' libera com a nota autorizada.
 */
const TransferenciaDetalhe: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { tenantId } = useAuth();
  const { openTab } = useTabs();
  const [t, setT] = useState<TransferenciaDoc | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [conferidas, setConferidas] = useState<Record<number, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [consultandoNota, setConsultandoNota] = useState(false);
  // Relogio da tela (reserva de nota esquecida vira "sem confirmacao" depois de 5 min).
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const relogio = window.setInterval(() => setAgora(Date.now()), 30_000);
    return () => window.clearInterval(relogio);
  }, []);

  useEffect(() => {
    if (!id) return undefined;
    return onSnapshot(doc(db, 'transferencias', id), (snap) => {
      setT(snap.exists() ? ({ id: snap.id, ...snap.data() } as TransferenciaDoc) : null);
      setCarregando(false);
    }, () => setCarregando(false));
  }, [id]);

  if (carregando) return <div style={{ padding: '40px', color: 'var(--text-muted)' }}>Carregando...</div>;
  if (!t) return <div style={{ padding: '40px', color: 'var(--text-muted)' }}>Transferência não encontrada.</div>;

  const souDestino = t.tenantDestino === tenantId;
  const souOrigem = t.tenantOrigem === tenantId;
  const emTransito = t.status === 'em_transito';
  const estilo = ESTILO_STATUS_TRANSFERENCIA[t.status];
  const statusNota = t.comNota ? statusEfetivoDaNota(t.notaFiscal, agora) : '';
  const notaAutorizada = statusNota === 'authorized';
  const notaSemValor = !statusNota || STATUS_NOTA_SEM_VALOR.includes(statusNota);
  const recebimentoTravado = Boolean(t.comNota) && !notaAutorizada;

  const atualizarNota = async () => {
    setConsultandoNota(true);
    try {
      const r = await consultarNotaDaTransferencia(t.id);
      if (r.nota) showSuccess(`Nota ${rotuloStatusNota(r.nota.status)}.`);
    } catch (erro) {
      showError('Não foi possível consultar a nota', erro instanceof Error ? erro.message : undefined);
    } finally {
      setConsultandoNota(false);
    }
  };

  const emitirDeNovo = async () => {
    const r = await NexusSwal.fire({
      title: 'Emitir a nota de novo?',
      html: 'Corrija antes o que fez a nota não valer (o motivo está no quadro da nota). O sistema monta a nota de novo a partir do cadastro e envia para a SEFAZ.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Emitir a nota',
      cancelButtonText: 'Voltar',
    });
    if (!r.isConfirmed) return;
    setSalvando(true);
    try {
      const resultado = await reemitirNotaDaTransferencia(t.id);
      showSuccess('Nota fiscal na fila da SEFAZ.');
      if (resultado.avisos.length > 0) showWarning('Confira o cadastro', resultado.avisos.join(' '));
    } catch (erro) {
      showError('A nota não foi emitida', erro instanceof Error ? erro.message : undefined);
    } finally {
      setSalvando(false);
    }
  };

  const pedirMotivo = async (titulo: string, confirmar: string) => {
    const r = await NexusSwal.fire({
      title: titulo,
      input: 'text',
      inputLabel: 'Motivo (fica no histórico das duas filiais)',
      inputValidator: (v) => (String(v || '').trim().length < 5 ? 'Escreva o motivo (pelo menos 5 letras).' : undefined),
      showCancelButton: true,
      confirmButtonText: confirmar,
      cancelButtonText: 'Voltar',
    });
    return r.isConfirmed ? String(r.value).trim() : null;
  };

  const receber = async () => {
    const recebidas: Record<number, number> = {};
    for (const [indice, valor] of Object.entries(conferidas)) recebidas[Number(indice)] = Number(String(valor).replace(',', '.'));
    const faltas = t.itens.filter((item, i) => recebidas[i] !== undefined && recebidas[i] < item.quantidade);
    const r = await NexusSwal.fire({
      title: 'Confirmar o recebimento?',
      html: faltas.length > 0
        ? `Faltou mercadoria em <strong>${faltas.length}</strong> item(ns). O que faltou <strong>volta para o estoque da filial ${t.origemCodigo}</strong> e a transferência fica marcada "com falta".`
        : 'Todos os itens chegaram como enviados. O estoque desta filial recebe a mercadoria agora.',
      icon: faltas.length > 0 ? 'warning' : 'question',
      showCancelButton: true,
      confirmButtonText: 'Confirmar recebimento',
      cancelButtonText: 'Voltar',
    });
    if (!r.isConfirmed) return;
    setSalvando(true);
    try {
      const resultado = await receberTransferencia(t.id, recebidas);
      showSuccess(resultado.divergente ? 'Recebida com falta: a diferença voltou para a origem.' : 'Transferência recebida!');
    } catch (erro) {
      showError('Não foi possível receber a transferência', erro instanceof Error ? erro.message : undefined);
    } finally {
      setSalvando(false);
    }
  };

  const desfazer = async (acao: 'recusar' | 'cancelar') => {
    const motivo = await pedirMotivo(acao === 'recusar' ? 'Recusar a transferência?' : 'Cancelar a transferência?', acao === 'recusar' ? 'Recusar e devolver' : 'Cancelar e devolver');
    if (!motivo) return;
    setSalvando(true);
    try {
      if (acao === 'recusar') await recusarTransferencia(t.id, motivo);
      else await cancelarTransferencia(t.id, motivo);
      showSuccess(acao === 'recusar' ? 'Transferência recusada: tudo voltou para a origem.' : 'Transferência cancelada: o estoque voltou.');
    } catch (erro) {
      showError(acao === 'recusar' ? 'Não foi possível recusar' : 'Não foi possível cancelar', erro instanceof Error ? erro.message : undefined);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <button className="icon-btn back-btn" onClick={() => openTab('/estoque/transferencias', 'Transferências')} title="Voltar" aria-label="Voltar para as transferências">
          <ArrowLeft size={20} />
        </button>
        <h1 style={{ fontSize: '22px', fontWeight: 700, margin: 0 }}>Transferência #{t.numeroTransferencia}</h1>
        <span style={{ padding: '3px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 600, background: estilo.fundo, color: estilo.cor }}>
          {ROTULO_STATUS_TRANSFERENCIA[t.status]}{t.divergente ? ' (com falta)' : ''}
        </span>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{t.comNota ? 'Com nota fiscal' : 'Sem nota fiscal'}</span>
      </div>

      <div className="card" style={{ padding: '16px 20px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>De</div>
          <div style={{ fontWeight: 700 }}>{t.origemCodigo} · {t.origemNome}{souOrigem ? ' (esta filial)' : ''}</div>
        </div>
        <ArrowRight size={18} style={{ color: 'var(--text-muted)' }} />
        <div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Para</div>
          <div style={{ fontWeight: 700 }}>{t.destinoCodigo} · {t.destinoNome}{souDestino ? ' (esta filial)' : ''}</div>
        </div>
        <div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Enviada</div>
          <div>{dataHora(t.enviadoEm)} por {t.enviadoPorNome || '—'}</div>
        </div>
        <div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Valor (custo)</div>
          <div style={{ fontWeight: 700 }}>{moeda(t.valorCentavos)}</div>
        </div>
      </div>

      {t.comNota && (
        <div className="card" style={{ padding: '16px 20px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <FileText size={18} style={{ color: 'var(--accent-purple)' }} aria-hidden="true" />
            <strong>Nota fiscal de transferência</strong>
            <span style={{
              padding: '3px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 600,
              background: notaAutorizada ? 'rgba(16, 185, 129, 0.15)' : notaSemValor ? 'rgba(239, 68, 68, 0.12)' : 'rgba(245, 158, 11, 0.15)',
              color: notaAutorizada ? '#10b981' : notaSemValor ? '#ef4444' : '#f59e0b',
            }}
            >
              {rotuloStatusNota(statusNota)}
            </span>
            {t.notaFiscal?.number ? <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>NF-e nº {t.notaFiscal.number}</span> : null}
            <div style={{ flex: 1 }} />
            <button type="button" className="btn-secondary" disabled={consultandoNota} onClick={() => { void atualizarNota(); }} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', fontSize: '13px' }}>
              {consultandoNota ? <Loader2 size={14} className="spin-icon" /> : <RefreshCw size={14} />} Atualizar situação
            </button>
            {souOrigem && emTransito && notaSemValor && (
              <button type="button" className="btn-primary" disabled={salvando} onClick={() => { void emitirDeNovo(); }} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', fontSize: '13px' }}>
                <Send size={14} /> Emitir a nota de novo
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', fontSize: '13px', color: 'var(--text-secondary)' }}>
            {t.notaFiscal?.cfops?.length ? <span>CFOP de saída: <strong>{t.notaFiscal.cfops.join(', ')}</strong></span> : null}
            {t.notaFiscal?.cfopsEntrada?.length ? <span>Entrada no destino: <strong>{t.notaFiscal.cfopsEntrada.join(', ')}</strong></span> : null}
            {t.notaFiscal?.accessKey ? <span style={{ fontVariantNumeric: 'tabular-nums', wordBreak: 'break-all' }}>Chave: {t.notaFiscal.accessKey}</span> : null}
          </div>
          {t.notaFiscal?.mensagem && !notaAutorizada && (
            <p style={{ margin: 0, fontSize: '13px', color: notaSemValor ? '#ef4444' : 'var(--text-secondary)' }}>{t.notaFiscal.mensagem}</p>
          )}
          {statusNota === 'falha_envio' && (
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
              A Spedy não respondeu no envio. {souOrigem ? 'Use "Emitir a nota de novo": o sistema reenvia com a mesma identificação e a Spedy não cria nota dobrada.' : 'A filial que enviou precisa emitir a nota de novo.'}
            </p>
          )}
          {souDestino && t.entradaNotaId && (
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>A nota de entrada foi lançada no Histórico de Entradas desta filial.</p>
          )}
        </div>
      )}

      {t.divergente && (
        <div style={{ padding: '12px 16px', borderRadius: 'var(--radius-md)', border: '1px solid rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.1)', fontSize: '14px' }}>
          Faltou mercadoria na conferência. A diferença voltou para o estoque da filial {t.origemCodigo} · {t.origemNome}.
        </div>
      )}
      {t.motivo && <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Motivo: {t.motivo}</div>}
      {t.observacao && <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Observação: {t.observacao}</div>}

      <div className="card" style={{ padding: '20px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        {souDestino && emTransito && (
          <p style={{ marginTop: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
            <PackageCheck size={15} style={{ verticalAlign: '-3px', marginRight: '6px', color: 'var(--accent-purple)' }} />
            Confira a mercadoria: a coluna <strong>Chegou</strong> já vem com o enviado — corrija só o que veio a menos.
            {recebimentoTravado && <> O recebimento libera quando a nota fiscal for <strong>autorizada</strong>.</>}
          </p>
        )}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase' }}>
                <th style={{ padding: '10px 12px' }}>Produto</th>
                <th style={{ padding: '10px 12px' }}>Lotes</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Enviado</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Custo un.</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', width: '130px' }}>Chegou</th>
              </tr>
            </thead>
            <tbody>
              {t.itens.map((item, i) => (
                <tr key={`${item.produtoIdOrigem}-${i}`} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ fontWeight: 600 }}>{item.codigo ? `${item.codigo} — ` : ''}{item.nome}</div>
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                    {item.lotes.length === 0 ? '—' : item.lotes.map((l) => `${l.lote}${l.validade ? ` (${l.validade.split('-').reverse().join('/')})` : ''} × ${fmtQtd(l.quantidade)}`).join(', ')}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtQtd(item.quantidade)} {item.unidade}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{moeda(Math.round(item.custoUnitario * 100))}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    {souDestino && emTransito ? (
                      <input
                        inputMode="decimal"
                        aria-label={`Quanto chegou de ${item.nome}`}
                        value={conferidas[i] ?? fmtQtd(item.quantidade)}
                        onChange={(e) => { const v = e.target.value.replace(/[^0-9,.]/g, ''); setConferidas((atual) => ({ ...atual, [i]: v })); }}
                        style={{ width: '100%', padding: '8px 10px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', textAlign: 'right' }}
                      />
                    ) : (
                      <span style={{ fontVariantNumeric: 'tabular-nums', color: item.quantidadeRecebida !== undefined && item.quantidadeRecebida < item.quantidade ? '#f59e0b' : undefined }}>
                        {item.quantidadeRecebida === undefined ? '—' : `${fmtQtd(item.quantidadeRecebida)} ${item.unidade}`}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {emTransito && (souDestino || souOrigem) && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px', flexWrap: 'wrap' }}>
            {souDestino && (
              <>
                <button type="button" className="btn-secondary" disabled={salvando} onClick={() => { void desfazer('recusar'); }} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#ef4444' }}>
                  <XCircle size={16} /> Recusar
                </button>
                <button type="button" className="btn-primary" disabled={salvando || recebimentoTravado} title={recebimentoTravado ? 'Aguarde a nota fiscal ser autorizada' : undefined} onClick={() => { void receber(); }} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  {salvando ? <Loader2 size={16} className="spin-icon" /> : <CheckCircle2 size={16} />} Confirmar recebimento
                </button>
              </>
            )}
            {souOrigem && (
              <button type="button" className="btn-secondary" disabled={salvando} onClick={() => { void desfazer('cancelar'); }} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <Undo2 size={16} /> Cancelar transferência
              </button>
            )}
          </div>
        )}
      </div>

      {(t.historico || []).length > 0 && (
        <div className="card" style={{ padding: '16px 20px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
          <div style={{ fontWeight: 700, marginBottom: '8px' }}>Histórico</div>
          <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {(t.historico || []).map((h, i) => (
              <li key={i}>
                <strong style={{ textTransform: 'capitalize' }}>{h.acao}</strong> em {new Date(h.em).toLocaleString('pt-BR')} por {h.por}{h.motivo ? ` — ${h.motivo}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default TransferenciaDetalhe;
