import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Loader2, PackagePlus, X } from 'lucide-react';
import { db } from '../../services/firebase';
import { STATUS_NOTA_AVULSA_CANCELADA, quantidadeEstoqueNotaAvulsaItem, type NotaAvulsaItem } from '../../utils/notaAvulsaDomain';

/**
 * VER UMA NOTA AVULSA JA LANCADA (pedido do dono, 2026-10-01: "clicar 2 vezes
 * no pedido avulso ja lancado e conseguir visualizar o que foi lancado").
 *
 * So' leitura: a nota lancada ja mexeu em estoque, custo e financeiro, entao
 * nao se edita -- o caminho para corrigir continua sendo cancelar e lancar de
 * novo. As parcelas vem dos titulos do financeiro (o estado de hoje: paga ou
 * pendente), nao de uma copia guardada na nota.
 */

export interface NotaAvulsaParaVer {
  id: string;
  numero: string;
  fornecedorNome: string;
  itens: NotaAvulsaItem[];
  valorTotal: number;
  formaPagamento: 'a_vista' | 'pendente';
  destinoPagamento?: 'caixa' | 'banco';
  bancoNome?: string;
  dataVencimento?: string;
  frete?: number;
  desconto?: number;
  observacao?: string | null;
  status: string;
  lotesEntrada?: Array<{ produtoId: string; lote: string; validade: string; quantidade: number }>;
  createdAt?: { seconds?: number };
}

interface TituloDaNota {
  id: string;
  descricao: string;
  data: string;
  valorCentavos: number;
  status: string;
  bancoNome?: string;
}

const moeda = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);
const dataBr = (data?: string) => (data ? data.slice(0, 10).split('-').reverse().join('/') : '—');

const NotaAvulsaDetalheModal: React.FC<{ tenantId: string; nota: NotaAvulsaParaVer; onFechar: () => void }> = ({ tenantId, nota, onFechar }) => {
  const [titulos, setTitulos] = useState<TituloDaNota[] | null>(null);
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent) => { if (evento.key === 'Escape') onFechar(); };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [onFechar]);

  useEffect(() => {
    getDocs(query(collection(db, 'transacoes'), where('tenantId', '==', tenantId), where('notaAvulsaId', '==', nota.id)))
      .then((snap) => setTitulos(snap.docs
        .map((d) => {
          const t = d.data();
          return {
            id: d.id,
            descricao: String(t.descricao || ''),
            data: String(t.dataVencimento || t.data || ''),
            valorCentavos: Number(t.valorCentavos ?? Math.round(Number(t.valor || 0) * 100)),
            status: String(t.status || ''),
            ...(t.bancoNome ? { bancoNome: String(t.bancoNome) } : {}),
          };
        })
        .sort((a, b) => a.data.localeCompare(b.data))))
      .catch((erro) => {
        console.error('Erro ao buscar os títulos da nota avulsa:', erro);
        setTitulos([]);
      });
  }, [tenantId, nota.id]);

  const itens = nota.itens || [];
  const subtotalItens = itens.reduce((t, i) => t + (Number(i.quantidade) || 0) * (Number(i.precoCusto) || 0), 0);
  const cancelada = nota.status === STATUS_NOTA_AVULSA_CANCELADA;
  const lotesDoProduto = (produtoId: string) => (nota.lotesEntrada || []).filter((l) => l.produtoId === produtoId);
  const celula: React.CSSProperties = { padding: '9px 8px', borderBottom: '1px solid var(--border-color)' };

  return (
    <div onClick={onFechar} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Nota avulsa ${nota.numero}`}
        onClick={(e) => e.stopPropagation()}
        style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '960px', maxHeight: '90vh', overflowY: 'auto', padding: '24px' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '16px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '19px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <PackagePlus size={22} color="var(--accent-purple)" /> Nota Avulsa #{nota.numero}
              <span style={{ fontSize: '12px', fontWeight: 700, padding: '3px 9px', borderRadius: '12px', color: cancelada ? '#ef4444' : '#10b981', backgroundColor: cancelada ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)' }}>
                {cancelada ? 'Cancelada' : 'Ativa'}
              </span>
            </h3>
            <div style={{ fontSize: '13.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
              {nota.fornecedorNome} · lançada em {nota.createdAt?.seconds ? new Date(nota.createdAt.seconds * 1000).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
            </div>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={22} /></button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13.5px' }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase' }}>
                <th style={celula}>Produto</th>
                <th style={{ ...celula, textAlign: 'right' }}>Quantidade</th>
                <th style={{ ...celula, textAlign: 'right' }}>Custo unit.</th>
                <th style={{ ...celula, textAlign: 'right' }}>Frete</th>
                <th style={{ ...celula, textAlign: 'right' }}>Desconto</th>
                <th style={{ ...celula, textAlign: 'right' }}>Subtotal</th>
                <th style={{ ...celula, textAlign: 'right' }}>Preço de venda</th>
              </tr>
            </thead>
            <tbody>
              {itens.length === 0 ? (
                <tr><td colSpan={7} style={{ ...celula, textAlign: 'center', color: 'var(--text-muted)' }}>Nota sem itens gravados.</td></tr>
              ) : itens.map((item, i) => {
                const sigla = item.unidadeSigla || 'UN';
                const base = quantidadeEstoqueNotaAvulsaItem(item);
                const lotes = lotesDoProduto(item.produtoId);
                return (
                  <tr key={`${item.produtoId}-${i}`}>
                    <td style={celula}>
                      <strong>{item.produtoNome}</strong>
                      {item.fatorConversao && item.fatorConversao !== 1 && (
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>entrou {base} no estoque (1 {sigla} = {item.fatorConversao})</div>
                      )}
                      {lotes.map((l) => (
                        <div key={l.lote} style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Lote {l.lote} · validade {dataBr(l.validade)} · {l.quantidade}</div>
                      ))}
                    </td>
                    <td style={{ ...celula, textAlign: 'right' }}>{item.quantidade} {sigla}</td>
                    <td style={{ ...celula, textAlign: 'right' }}>{moeda(item.precoCusto)}</td>
                    <td style={{ ...celula, textAlign: 'right', color: 'var(--text-secondary)' }}>{item.freteRateado ? moeda(item.freteRateado) : '—'}</td>
                    <td style={{ ...celula, textAlign: 'right', color: 'var(--text-secondary)' }}>{item.descontoRateado ? `-${moeda(item.descontoRateado)}` : '—'}</td>
                    <td style={{ ...celula, textAlign: 'right', fontWeight: 600 }}>{moeda((Number(item.quantidade) || 0) * (Number(item.precoCusto) || 0))}</td>
                    <td style={{ ...celula, textAlign: 'right', color: 'var(--text-secondary)' }}>{item.precoVenda ? moeda(item.precoVenda) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '14px', marginTop: '18px' }}>
          <div><div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Itens</div><strong>{moeda(subtotalItens)}</strong></div>
          <div><div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Frete</div><strong>{moeda(nota.frete || 0)}</strong></div>
          <div><div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Desconto</div><strong>{nota.desconto ? `-${moeda(nota.desconto)}` : moeda(0)}</strong></div>
          <div><div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total da nota</div><strong style={{ fontSize: '19px', color: 'var(--accent-purple)' }}>{moeda(nota.valorTotal)}</strong></div>
        </div>

        <div style={{ marginTop: '18px', padding: '14px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-tertiary)', fontSize: '13.5px' }}>
          <div style={{ fontWeight: 600, marginBottom: '6px' }}>
            Pagamento: {nota.formaPagamento === 'a_vista'
              ? `à vista, ${nota.destinoPagamento === 'banco' ? `pelo banco ${nota.bancoNome || ''}`.trim() : 'pelo caixa'}`
              : `a prazo${nota.dataVencimento ? `, 1º vencimento em ${dataBr(nota.dataVencimento)}` : ''}`}
          </div>
          {titulos === null ? (
            <div style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}><Loader2 size={14} className="spin-icon" /> Buscando os títulos no financeiro...</div>
          ) : titulos.length === 0 ? (
            <div style={{ color: 'var(--text-muted)' }}>Nenhum título encontrado no financeiro para esta nota.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <tbody>
                {titulos.map((t) => (
                  <tr key={t.id}>
                    <td style={{ padding: '4px 0' }}>{t.descricao}</td>
                    <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>{dataBr(t.data)}</td>
                    <td style={{ padding: '4px 8px', whiteSpace: 'nowrap', color: t.status === 'Paga' ? '#10b981' : t.status === 'Cancelada' ? '#ef4444' : '#f59e0b' }}>{t.status}{t.bancoNome ? ` · ${t.bancoNome}` : ''}</td>
                    <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 600 }}>{moeda(t.valorCentavos / 100)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {nota.observacao && (
          <div style={{ marginTop: '14px', fontSize: '13.5px' }}><span style={{ color: 'var(--text-muted)' }}>Observação:</span> {nota.observacao}</div>
        )}

        <p style={{ marginTop: '16px', marginBottom: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
          Nota lançada não se edita: ela já mexeu no estoque, no custo e no financeiro. Para corrigir, cancele (botão na lista) e lance de novo.
        </p>
      </div>
    </div>
  );
};

export default NotaAvulsaDetalheModal;
