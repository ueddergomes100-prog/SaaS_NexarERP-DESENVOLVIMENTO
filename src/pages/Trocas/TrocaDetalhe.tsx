import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Check, Loader2, PackageCheck, Printer, Repeat, X } from 'lucide-react';
import { collection, doc, getDoc, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { NexusSwal, showError, showSuccess } from '../../utils/alerts';
import { hasTenantFullAccess } from '../../utils/roles';
import { trocaService } from '../../services/trocaService';
import {
  ESTILO_STATUS_TROCA,
  PERMISSAO_TROCA_GERENCIAR,
  acoesDaLoja,
  custoEmReais,
  rotuloDoMotivoTroca,
  type AcaoTroca,
  type Troca,
} from '../../utils/trocaDomain';

/**
 * Uma TROCA: a loja ve o que o vendedor pediu, os avisos, e decide -- aprovar
 * (reserva o estoque da reposicao), recusar (com motivo), imprimir a minuta,
 * confirmar a entrega (baixa o estoque, UMA vez) ou cancelar. Tudo isso roda no
 * servidor; a tela so' pede. Sem financeiro, sem comissao.
 */

type TrocaDoc = Omit<Troca, 'createdAtMillis'> & { createdAt?: { toMillis?: () => number; seconds?: number } };

interface InfoProduto {
  quantidade: number;
  quantidadeReservada: number;
  controlarLote: boolean;
}

interface LoteInfo {
  id: string;
  lote: string;
  validade?: string | null;
  quantidade: number;
}

const formatarDataHora = (iso: string | number) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

const moeda = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const TrocaDetalhe: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { tenantId, userRole, isOwner, userPermissions } = useAuth();
  const podeGerenciar = hasTenantFullAccess(userRole, isOwner) || userPermissions.includes(PERMISSAO_TROCA_GERENCIAR);

  const [troca, setTroca] = useState<(TrocaDoc & { id: string }) | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [produtos, setProdutos] = useState<Record<string, InfoProduto>>({});
  const [lotes, setLotes] = useState<Record<string, LoteInfo[]>>({});
  const [lotesEscolhidos, setLotesEscolhidos] = useState<Record<number, string>>({});
  const [executando, setExecutando] = useState<AcaoTroca | null>(null);

  useEffect(() => {
    if (!id || !tenantId) return undefined;
    return onSnapshot(doc(db, 'trocas', id), (snap) => {
      if (snap.exists() && snap.data().tenantId === tenantId) setTroca({ id: snap.id, ...snap.data() } as TrocaDoc & { id: string });
      else setTroca(null);
      setCarregando(false);
    }, (erro) => {
      console.error('Erro ao ler a troca:', erro);
      setCarregando(false);
    });
  }, [id, tenantId]);

  // Estoque atual de cada produto (pra decidir a aprovacao) e os lotes dos que controlam lote (pra escolher na entrega).
  const idsDosItens = useMemo(() => [...new Set((troca?.itens || []).map((i) => i.id))].join('|'), [troca]);
  const emAndamento = troca?.status === 'Solicitada' || troca?.status === 'Aprovada';
  useEffect(() => {
    if (!tenantId || !idsDosItens || !emAndamento) return undefined;
    let cancelado = false;
    (async () => {
      const infos: Record<string, InfoProduto> = {};
      const lotesPorProduto: Record<string, LoteInfo[]> = {};
      for (const produtoId of idsDosItens.split('|')) {
        try {
          const snap = await getDoc(doc(db, 'estoque', produtoId));
          if (!snap.exists() || snap.data().tenantId !== tenantId) continue;
          const d = snap.data();
          infos[produtoId] = { quantidade: Number(d.quantidade || 0), quantidadeReservada: Number(d.quantidadeReservada || 0), controlarLote: d.controlarLote === true };
          if (d.controlarLote === true) {
            const lotesSnap = await getDocs(query(collection(db, 'estoque_lotes'), where('tenantId', '==', tenantId), where('produtoId', '==', produtoId)));
            lotesPorProduto[produtoId] = lotesSnap.docs
              .map((l) => ({ id: l.id, lote: String(l.data().lote || ''), validade: l.data().validade || null, quantidade: Number(l.data().quantidade || 0) }))
              .filter((l) => l.quantidade > 0)
              .sort((a, b) => String(a.validade || '9999').localeCompare(String(b.validade || '9999')));
          }
        } catch (erro) {
          console.error('Erro ao ler o produto da troca:', erro);
        }
      }
      if (!cancelado) { setProdutos(infos); setLotes(lotesPorProduto); }
    })();
    return () => { cancelado = true; };
  }, [tenantId, idsDosItens, emAndamento, troca?.status]);

  const executar = async (acao: AcaoTroca, fn: () => Promise<unknown>, sucesso: string) => {
    setExecutando(acao);
    try {
      await fn();
      showSuccess(sucesso);
    } catch (erro) {
      showError('Não foi possível concluir', (erro as Error).message);
    } finally {
      setExecutando(null);
    }
  };

  if (carregando) return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>Carregando troca...</div>;
  if (!troca) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Troca não encontrada.
        <div style={{ marginTop: '16px' }}><button className="btn-secondary" onClick={() => navigate('/vendas/trocas')}>Voltar para as trocas</button></div>
      </div>
    );
  }

  const estilo = ESTILO_STATUS_TROCA[troca.status] || ESTILO_STATUS_TROCA.Solicitada;
  const acoes = podeGerenciar ? acoesDaLoja(troca.status) : [];

  const aprovar = async () => {
    const r = await NexusSwal.fire({
      icon: 'question', title: `Aprovar a troca #${troca.numeroTroca}?`,
      text: 'O estoque da reposição fica reservado até a entrega. Nada é cobrado do cliente.',
      showCancelButton: true, confirmButtonText: 'Sim, aprovar', cancelButtonText: 'Voltar',
    });
    if (r.isConfirmed) await executar('aprovar', () => trocaService.aprovar(troca.id), 'Troca aprovada e estoque reservado.');
  };

  const recusar = async () => {
    const r = await NexusSwal.fire({
      icon: 'warning', title: `Recusar a troca #${troca.numeroTroca}?`,
      input: 'textarea', inputLabel: 'Motivo da recusa (o vendedor vai ver no aplicativo)', inputAttributes: { maxlength: '200' },
      showCancelButton: true, confirmButtonText: 'Recusar troca', cancelButtonText: 'Voltar', confirmButtonColor: '#ef4444',
      inputValidator: (valor) => (!valor || valor.trim().length < 5 ? 'Escreva o motivo (pelo menos 5 letras).' : undefined),
    });
    if (r.isConfirmed) await executar('recusar', () => trocaService.recusar(troca.id, String(r.value)), 'Troca recusada.');
  };

  const cancelar = async () => {
    const r = await NexusSwal.fire({
      icon: 'warning', title: `Cancelar a troca #${troca.numeroTroca}?`,
      text: troca.estoqueReservado ? 'A reserva de estoque da reposição será liberada.' : undefined,
      input: 'text', inputPlaceholder: 'Motivo (opcional)', inputAttributes: { maxlength: '200' },
      showCancelButton: true, confirmButtonText: 'Sim, cancelar', cancelButtonText: 'Voltar', confirmButtonColor: '#ef4444',
    });
    if (r.isConfirmed) await executar('cancelar', () => trocaService.cancelar(troca.id, String(r.value || '')), 'Troca cancelada.');
  };

  const entregar = async () => {
    // Produto que controla lote: a loja diz de qual lote a reposicao saiu.
    const semLote = troca.itens.findIndex((item, indice) => produtos[item.id]?.controlarLote && !lotesEscolhidos[indice]);
    if (semLote >= 0) {
      showError('Escolha o lote', `"${troca.itens[semLote].nome}" controla lote e validade: escolha de qual lote a reposição saiu.`);
      return;
    }
    const r = await NexusSwal.fire({
      icon: 'question', title: `Confirmar a entrega da troca #${troca.numeroTroca}?`,
      text: 'O estoque da reposição será baixado agora, uma única vez. Não gera cobrança nem financeiro.',
      showCancelButton: true, confirmButtonText: 'Sim, entregue', cancelButtonText: 'Voltar',
    });
    if (r.isConfirmed) await executar('entregar', () => trocaService.entregar(troca.id, lotesEscolhidos), 'Entrega confirmada e estoque baixado.');
  };

  const botao = (acao: AcaoTroca, rotulo: string, icone: React.ReactNode, aoClicar: () => void, tipo: 'primario' | 'secundario' | 'perigo') => (
    <button
      key={acao}
      type="button"
      onClick={aoClicar}
      disabled={executando !== null}
      className={tipo === 'primario' ? 'btn-primary' : 'btn-secondary'}
      style={{ display: 'flex', alignItems: 'center', gap: '8px', ...(tipo === 'perigo' ? { color: '#ef4444', borderColor: 'rgba(239,68,68,0.5)' } : {}) }}
    >
      {executando === acao ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : icone}
      {rotulo}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1000px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
        <button className="icon-btn" onClick={() => navigate('/vendas/trocas')} aria-label="Voltar" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
          <ArrowLeft size={20} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <Repeat size={26} color="var(--accent-purple)" /> Troca #{troca.numeroTroca}
            <span style={{ backgroundColor: estilo.fundo, color: estilo.cor, padding: '4px 12px', borderRadius: '999px', fontSize: '13px', fontWeight: 700 }}>{troca.status}</span>
          </h1>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '13px' }}>{estilo.explicacao}</p>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {acoes.includes('minuta') && botao('minuta', 'Imprimir minuta', <Printer size={16} />, () => navigate(`/vendas/trocas/${troca.id}/minuta`), 'secundario')}
          {acoes.includes('aprovar') && botao('aprovar', 'Aprovar', <Check size={16} />, () => void aprovar(), 'primario')}
          {acoes.includes('recusar') && botao('recusar', 'Recusar', <X size={16} />, () => void recusar(), 'perigo')}
          {acoes.includes('entregar') && botao('entregar', 'Confirmar entrega', <PackageCheck size={16} />, () => void entregar(), 'primario')}
          {acoes.includes('cancelar') && botao('cancelar', 'Cancelar', <X size={16} />, () => void cancelar(), 'perigo')}
        </div>
      </div>

      <div role="note" style={{ padding: '12px 16px', borderRadius: 'var(--radius-md)', border: '1px solid rgba(245,158,11,0.5)', backgroundColor: 'rgba(245,158,11,0.10)', color: 'var(--text-primary)', fontSize: '14px', fontWeight: 600 }}>
        TROCA — sem cobrança, sem comissão, sem financeiro. O produto estragado não volta ao estoque: só a reposição dá baixa.
      </div>

      {troca.status === 'Recusada' && troca.motivoRecusa && (
        <div style={{ padding: '12px 16px', borderRadius: 'var(--radius-md)', border: '1px solid rgba(239,68,68,0.5)', fontSize: '14px' }}>
          <strong style={{ color: '#ef4444' }}>Motivo da recusa:</strong> {troca.motivoRecusa}
        </div>
      )}
      {troca.status === 'Cancelada' && troca.motivoCancelamento && (
        <div style={{ padding: '12px 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', fontSize: '14px' }}>
          <strong>Motivo do cancelamento:</strong> {troca.motivoCancelamento}
        </div>
      )}

      {troca.status === 'Solicitada' && (troca.avisos?.length || 0) > 0 && (
        <div style={{ padding: '12px 16px', borderRadius: 'var(--radius-md)', border: '1px solid #f59e0b', display: 'flex', gap: '10px', fontSize: '14px', lineHeight: 1.5 }}>
          <AlertTriangle size={20} color="#f59e0b" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <strong>Confira antes de aprovar:</strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: '18px' }}>{troca.avisos.map((a) => <li key={a.produtoId}>{a.mensagem}</li>)}</ul>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: '20px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
        <div><div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Cliente</div><div style={{ fontWeight: 600 }}>{troca.clienteNome}</div>{troca.clienteTelefone && <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{troca.clienteTelefone}</div>}</div>
        <div><div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Vendedor</div><div style={{ fontWeight: 600 }}>{troca.vendedorNome || '-'}</div></div>
        <div><div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Solicitada em</div><div style={{ fontWeight: 600 }}>{troca.historico?.[0] ? formatarDataHora(troca.historico[0].em) : '-'}</div></div>
        {troca.observacao && <div style={{ gridColumn: '1 / -1' }}><div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Observação do vendedor</div><div>{troca.observacao}</div></div>}
      </div>

      <div className="card" style={{ padding: '20px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', overflowX: 'auto' }}>
        <h2 style={{ fontSize: '16px', margin: '0 0 12px' }}>Itens da troca</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase', borderBottom: '1px solid var(--border-color)' }}>
              <th style={{ padding: '8px' }}>Produto</th>
              <th style={{ padding: '8px' }}>Qtd a repor</th>
              <th style={{ padding: '8px' }}>Motivo</th>
              {emAndamento && <th style={{ padding: '8px' }}>Estoque disponível</th>}
              {troca.status === 'Aprovada' && <th style={{ padding: '8px' }}>Lote</th>}
              {troca.status === 'Entregue' && <th style={{ padding: '8px', textAlign: 'right' }}>Custo</th>}
            </tr>
          </thead>
          <tbody>
            {troca.itens.map((item, indice) => {
              const info = produtos[item.id];
              const disponivel = info ? info.quantidade - info.quantidadeReservada + (troca.estoqueReservado ? item.quantidade : 0) : null;
              return (
                <tr key={`${item.id}-${indice}`} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '10px 8px', fontWeight: 600 }}>{item.nome}{item.codigo ? <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · cód. {item.codigo}</span> : null}</td>
                  <td style={{ padding: '10px 8px' }}>{item.quantidade} {item.unidadeMedidaSigla}</td>
                  <td style={{ padding: '10px 8px' }}>{rotuloDoMotivoTroca(item.motivo)}{item.motivoDescricao ? ` (${item.motivoDescricao})` : ''}</td>
                  {emAndamento && (
                    <td style={{ padding: '10px 8px', color: disponivel !== null && disponivel < item.quantidade ? '#ef4444' : 'var(--text-primary)' }}>
                      {disponivel === null ? '…' : `${Math.max(0, disponivel)} ${item.unidadeMedidaSigla}`}
                    </td>
                  )}
                  {troca.status === 'Aprovada' && (
                    <td style={{ padding: '10px 8px' }}>
                      {info?.controlarLote ? (
                        <select
                          value={lotesEscolhidos[indice] || ''}
                          onChange={(e) => setLotesEscolhidos((atual) => ({ ...atual, [indice]: e.target.value }))}
                          aria-label={`Lote de ${item.nome}`}
                          style={{ padding: '8px 10px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
                        >
                          <option value="">Escolha o lote...</option>
                          {(lotes[item.id] || []).map((l) => <option key={l.id} value={l.id}>{l.lote}{l.validade ? ` · val. ${l.validade.split('-').reverse().join('/')}` : ''} · {l.quantidade} disp.</option>)}
                        </select>
                      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                  )}
                  {troca.status === 'Entregue' && (
                    <td style={{ padding: '10px 8px', textAlign: 'right' }}>{moeda(custoEmReais(Math.round((item.custoUnitarioCentavos || 0) * item.quantidade)))}{item.lote ? <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>lote {item.lote}</div> : null}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
          {troca.status === 'Entregue' && typeof troca.custoTotalCentavos === 'number' && (
            <tfoot>
              <tr style={{ fontWeight: 700 }}>
                <td colSpan={4} style={{ padding: '10px 8px', textAlign: 'right' }}>Custo da reposição</td>
                <td style={{ padding: '10px 8px', textAlign: 'right' }}>{moeda(custoEmReais(troca.custoTotalCentavos))}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="card" style={{ padding: '20px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <h2 style={{ fontSize: '16px', margin: '0 0 12px' }}>Histórico</h2>
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {[...(troca.historico || [])].reverse().map((h, i) => {
            const e = ESTILO_STATUS_TROCA[h.status] || ESTILO_STATUS_TROCA.Solicitada;
            return (
              <li key={`${h.em}-${i}`} style={{ display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap', fontSize: '14px' }}>
                <span style={{ backgroundColor: e.fundo, color: e.cor, padding: '2px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 700 }}>{h.status}</span>
                <span style={{ color: 'var(--text-muted)' }}>{formatarDataHora(h.em)} · {h.porNome}</span>
                {h.motivo && <span>— {h.motivo}</span>}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
};

export default TrocaDetalhe;
