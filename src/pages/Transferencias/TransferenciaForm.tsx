import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowLeftRight, Loader2, Send, Trash2 } from 'lucide-react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import ProductAutocomplete from '../../components/common/ProductAutocomplete';
import { NexusSwal, escaparHtml, showError, showSuccess } from '../../utils/alerts';
import { parseTransferenciaSemNota, podeTransferirSemNota } from '../../utils/transferenciaDomain';
import { rotuloFilial } from '../../utils/filialDomain';
import { enviarTransferencia } from '../../services/transferenciaService';
import { quantidade as fmtQtd } from './transferenciaTipos';

interface ProdutoTransferivel {
  id: string;
  nome: string;
  codigo?: string;
  codigoBarras?: string;
  quantidade?: number;
  quantidadeReservada?: number;
  unidadeMedidaSigla?: string;
  controlarLote?: boolean;
  filialOrigem?: string;
  ativo?: boolean;
}

interface Linha {
  produto: ProdutoTransferivel;
  quantidade: string;
}

/** "Permitir transferencia sem nota" da filial em que a pessoa esta (ao vivo). */
const useSemNotaDaFilial = (tenantId: string | null) => {
  const [semNotaLigada, setSemNotaLigada] = useState(false);
  useEffect(() => {
    if (!tenantId) return undefined;
    return onSnapshot(
      doc(db, 'configuracoes', tenantId),
      (snap) => setSemNotaLigada(parseTransferenciaSemNota(snap.exists() ? snap.data().transferenciaSemNota : undefined)),
      () => setSemNotaLigada(false),
    );
  }, [tenantId]);
  return { semNotaLigada };
};

const disponivel = (p: ProdutoTransferivel) => (Number(p.quantidade) || 0) - Math.max(0, Number(p.quantidadeReservada) || 0);

/**
 * NOVA TRANSFERENCIA (Filiais, fase 3). Origem = a filial em que a pessoa esta.
 * Escolhe o destino e os itens; o servidor baixa o estoque (e os lotes, pelo
 * vence-primeiro) e a mercadoria fica em transito ate' o destino receber.
 */
const TransferenciaForm: React.FC = () => {
  const { tenantId, filialAtual, filiaisDoUsuario, userRole, nivelAcesso } = useAuth();
  const { openTab } = useTabs();
  const { items: produtos } = useTenantCollection<ProdutoTransferivel>('estoque', tenantId);
  const [destino, setDestino] = useState('');
  const [busca, setBusca] = useState('');
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [observacao, setObservacao] = useState('');
  const [enviando, setEnviando] = useState(false);
  // Id fixo do envio: repetir depois de uma queda de internet nao baixa duas vezes.
  const [idDocumento] = useState(() => doc(collection(db, 'transferencias')).id);
  const { semNotaLigada } = useSemNotaDaFilial(tenantId);

  const destinos = filiaisDoUsuario.filter((f) => f.tenantId !== tenantId);
  const podeSemNota = podeTransferirSemNota({ role: userRole, nivelAcesso });
  const comEstoque = useMemo(() => produtos.filter((p) => p.ativo !== false && disponivel(p) > 0), [produtos]);

  const adicionar = (produto: ProdutoTransferivel) => {
    setBusca('');
    setLinhas((atual) => (atual.some((l) => l.produto.id === produto.id) ? atual : [...atual, { produto, quantidade: '1' }]));
  };

  const enviar = async () => {
    const destinoFilial = destinos.find((f) => f.tenantId === destino);
    if (!destinoFilial) { showError('Escolha o destino', 'Selecione para qual filial a mercadoria vai.'); return; }
    const itens = linhas.map((l) => ({ produtoId: l.produto.id, quantidade: Number(String(l.quantidade).replace(',', '.')) }));
    if (itens.length === 0) { showError('Nenhum produto', 'Adicione ao menos um produto para transferir.'); return; }
    const invalido = linhas.find((l, i) => !(itens[i].quantidade > 0) || itens[i].quantidade > disponivel(l.produto));
    if (invalido) { showError('Quantidade inválida', `Confira a quantidade de ${invalido.produto.nome}: precisa ser maior que zero e até ${fmtQtd(disponivel(invalido.produto))} (disponível).`); return; }

    const resposta = await NexusSwal.fire({
      title: `Enviar para ${rotuloFilial(destinoFilial)}?`,
      html: `${itens.length} produto(s) saem do estoque desta filial agora e ficam <strong>em trânsito</strong> até a filial <strong>${escaparHtml(destinoFilial.nome)}</strong> conferir e receber.<br/><br/>Transferência <strong>sem nota fiscal</strong>.`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Enviar transferência',
      cancelButtonText: 'Voltar',
    });
    if (!resposta.isConfirmed) return;
    setEnviando(true);
    try {
      const r = await enviarTransferencia({ destino, itens, observacao, comNota: false, idDocumento });
      showSuccess(`Transferência nº ${r.numeroTransferencia} enviada.`);
      openTab(`/estoque/transferencias/${r.id}`, `Transferência #${r.numeroTransferencia}`);
    } catch (erro) {
      showError('Não foi possível enviar a transferência', erro instanceof Error ? erro.message : undefined);
    } finally {
      setEnviando(false);
    }
  };

  const bloqueioSemNota = !semNotaLigada
    ? 'A transferência sem nota está desligada nesta filial. Para ligar: Configurações → "Permitir transferência sem nota" (só dono e gerente usam).'
    : !podeSemNota ? 'Só o dono ou um gerente faz transferência sem nota.' : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button className="icon-btn back-btn" onClick={() => openTab('/estoque/transferencias', 'Transferências')} title="Voltar" aria-label="Voltar para as transferências">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <ArrowLeftRight size={22} style={{ color: 'var(--accent-purple)' }} /> Nova transferência
          </h1>
          <p style={{ color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Saindo da filial <strong>{filialAtual ? rotuloFilial(filialAtual) : '—'}</strong>.
          </p>
        </div>
      </div>

      {bloqueioSemNota && (
        <div style={{ padding: '12px 16px', borderRadius: 'var(--radius-md)', border: '1px solid rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.1)', fontSize: '14px' }}>
          {bloqueioSemNota} A transferência com nota fiscal chega na próxima etapa.
        </div>
      )}

      <div className="card" style={{ padding: '20px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '420px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Para qual filial</span>
          <select value={destino} onChange={(e) => setDestino(e.target.value)} style={{ padding: '10px 12px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}>
            <option value="">Escolha o destino</option>
            {destinos.map((f) => <option key={f.tenantId} value={f.tenantId}>{rotuloFilial(f)}</option>)}
          </select>
        </label>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Produtos (só os com estoque disponível nesta filial)</span>
          <ProductAutocomplete
            value={busca}
            onChange={setBusca}
            products={comEstoque}
            onSelect={adicionar}
            placeholder="Nome, código ou código de barras (# lista tudo)"
            ariaLabel="Produto para transferir"
            renderItem={(p) => (
              <>
                <span>{p.codigo ? `${p.codigo} — ` : ''}{p.nome}</span>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>disp. {fmtQtd(disponivel(p))} {p.unidadeMedidaSigla || 'UN'}</span>
              </>
            )}
          />
        </div>

        {linhas.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase' }}>
                  <th style={{ padding: '10px 12px' }}>Produto</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right' }}>Disponível</th>
                  <th style={{ padding: '10px 12px', width: '140px' }}>Transferir</th>
                  <th style={{ padding: '10px 12px', width: '50px' }} aria-label="Remover" />
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => (
                  <tr key={l.produto.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ fontWeight: 600 }}>{l.produto.codigo ? `${l.produto.codigo} — ` : ''}{l.produto.nome}</div>
                      {l.produto.controlarLote && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Controla lote: sai pelo vence-primeiro</div>}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtQtd(disponivel(l.produto))} {l.produto.unidadeMedidaSigla || 'UN'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <input
                        inputMode="decimal"
                        aria-label={`Quantidade de ${l.produto.nome}`}
                        value={l.quantidade}
                        onChange={(e) => { const v = e.target.value.replace(/[^0-9,.]/g, ''); setLinhas((atual) => atual.map((x, j) => (j === i ? { ...x, quantidade: v } : x))); }}
                        style={{ width: '100%', padding: '8px 10px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', textAlign: 'right' }}
                      />
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <button type="button" className="btn-secondary" aria-label={`Remover ${l.produto.nome}`} onClick={() => setLinhas((atual) => atual.filter((_, j) => j !== i))} style={{ padding: '6px 8px', display: 'inline-flex', color: '#ef4444' }}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Observação</span>
          <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} maxLength={500} placeholder="Opcional" style={{ padding: '10px 12px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontFamily: 'inherit', resize: 'vertical' }} />
        </label>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="btn-primary" disabled={enviando || Boolean(bloqueioSemNota)} onClick={() => { void enviar(); }} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            {enviando ? <Loader2 size={16} className="spin-icon" /> : <Send size={16} />}
            Enviar transferência
          </button>
        </div>
      </div>
    </div>
  );
};

export default TransferenciaForm;
