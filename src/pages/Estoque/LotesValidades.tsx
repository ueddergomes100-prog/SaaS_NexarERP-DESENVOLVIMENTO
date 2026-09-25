import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, FileText, Search, SlidersHorizontal } from 'lucide-react';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import { nomeArquivoRelatorio } from '../../utils/relatorioPdfDomain';
import {
  ROTULO_ABA_LOTES,
  ROTULO_SITUACAO_LOTE,
  contarPorAba,
  situacaoDoLote,
  type AbaDeLotes,
  type SituacaoDoLote,
} from '../../utils/loteDomain';
import { lotesDaTela, montarDocumentoLotes, rotuloDosDias, type LoteDoProduto } from '../../utils/lotesRelatorioDomain';
import RelatorioPreview, { type DocumentoRelatorioSemEmpresa } from '../../components/Reports/RelatorioPreview';

/**
 * LOTES E VALIDADES (2026-09-25): saldo por lote, dias para vencer e as abas de
 * vencimento (vencidos / 15 / 30 / 45 dias), com relatorio em PDF na tela.
 * So' leitura: o lote nasce na Entrada de NF-e / Ajuste de Estoque e baixa na
 * venda. Ver docs/PLANO_LOTE_VALIDADE.md.
 */

const ABAS: AbaDeLotes[] = ['vencidos', 'vence_15', 'vence_30', 'vence_45', 'todos'];

const COR_SITUACAO: Record<SituacaoDoLote, { fundo: string; texto: string }> = {
  vencido: { fundo: 'rgba(239,68,68,0.15)', texto: '#ef4444' },
  vence_15: { fundo: 'rgba(249,115,22,0.15)', texto: '#f97316' },
  vence_30: { fundo: 'rgba(245,158,11,0.15)', texto: '#f59e0b' },
  vence_45: { fundo: 'rgba(234,179,8,0.15)', texto: '#ca8a04' },
  ok: { fundo: 'rgba(16,185,129,0.15)', texto: '#10b981' },
  sem_validade: { fundo: 'rgba(148,163,184,0.15)', texto: '#94a3b8' },
};

const campoStyle: React.CSSProperties = { padding: '10px 14px 10px 42px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', width: '100%' };

const quantidadeBr = (n: number): string => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(Number(n || 0));
const dataBr = (iso: string | null | undefined): string => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('/') : 'Sem validade');

const LotesValidades: React.FC = () => {
  const { tenantId } = useAuth();
  const navigate = useNavigate();
  const hoje = getDateInputInTimeZone();
  const [lotesBrutos, setLotesBrutos] = useState<Array<{ id: string; produtoId: string; lote: string; validade: string | null; quantidade: number }>>([]);
  const [produtos, setProdutos] = useState<Record<string, { nome: string; codigo: string }>>({});
  const [carregando, setCarregando] = useState(true);
  const [semAcesso, setSemAcesso] = useState(false);
  const [aba, setAba] = useState<AbaDeLotes>('vence_30');
  const [busca, setBusca] = useState('');
  const [previewAberto, setPreviewAberto] = useState(false);

  useEffect(() => {
    if (!tenantId) return undefined;
    const pararLotes = onSnapshot(query(collection(db, 'estoque_lotes'), where('tenantId', '==', tenantId)), (snap) => {
      setLotesBrutos(snap.docs.map((d) => {
        const x = d.data();
        return { id: d.id, produtoId: String(x.produtoId || ''), lote: String(x.lote || ''), validade: x.validade ? String(x.validade) : null, quantidade: Number(x.quantidade || 0) };
      }));
      setCarregando(false);
    }, (erro) => {
      console.error('Erro ao buscar lotes:', erro);
      setSemAcesso(true);
      setCarregando(false);
    });
    const pararProdutos = onSnapshot(query(collection(db, 'estoque'), where('tenantId', '==', tenantId)), (snap) => {
      const mapa: Record<string, { nome: string; codigo: string }> = {};
      snap.forEach((d) => { mapa[d.id] = { nome: String(d.data().nome || ''), codigo: String(d.data().codigo || '') }; });
      setProdutos(mapa);
    }, (erro) => console.error('Erro ao buscar produtos dos lotes:', erro));
    return () => { pararLotes(); pararProdutos(); };
  }, [tenantId]);

  const lotes = useMemo<LoteDoProduto[]>(() => lotesBrutos.map((l) => ({
    ...l,
    produtoNome: produtos[l.produtoId]?.nome || 'Produto não encontrado',
    produtoCodigo: produtos[l.produtoId]?.codigo || '',
  })), [lotesBrutos, produtos]);

  const contagem = useMemo(() => contarPorAba(lotes, hoje), [lotes, hoje]);
  const visiveis = useMemo(() => lotesDaTela(lotes, aba, busca, hoje), [lotes, aba, busca, hoje]);
  const documento = useMemo<DocumentoRelatorioSemEmpresa>(() => montarDocumentoLotes(lotes, aba, busca, hoje), [lotes, aba, busca, hoje]);

  if (previewAberto) {
    return (
      <RelatorioPreview
        relatorioId="lotes-validades"
        documento={documento}
        nomeArquivo={nomeArquivoRelatorio('Lotes e Validades', hoje, hoje)}
        onFechar={() => setPreviewAberto(false)}
        rotuloFechar="Voltar aos lotes"
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <CalendarClock size={26} color="var(--accent-purple)" />
            Lotes e Validades
          </h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>
            Saldo de cada lote dos produtos que controlam lote, com o prazo para vencer. Os lotes nascem na Entrada de NF-e e no Ajuste de Estoque.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button className="btn-secondary" onClick={() => navigate('/estoque/ajuste')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <SlidersHorizontal size={17} /> Ajuste de Estoque
          </button>
          <button className="btn-primary" onClick={() => setPreviewAberto(true)} disabled={carregando} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileText size={17} /> Relatório
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
        {ABAS.map((id) => {
          const ativa = aba === id;
          const alerta = id === 'vencidos' && contagem.vencidos > 0;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setAba(id)}
              aria-pressed={ativa}
              style={{ textAlign: 'left', padding: '14px 16px', borderRadius: 'var(--radius-md)', cursor: 'pointer', color: 'var(--text-primary)', backgroundColor: ativa ? 'rgba(139,92,246,0.15)' : 'var(--bg-secondary)', border: `1px solid ${ativa ? 'var(--accent-purple)' : 'var(--border-color)'}` }}
            >
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>{ROTULO_ABA_LOTES[id]}</div>
              <div style={{ fontSize: '26px', fontWeight: 700, color: alerta ? '#ef4444' : 'inherit' }}>{contagem[id]}</div>
            </button>
          );
        })}
      </div>

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
        <div style={{ position: 'relative', marginBottom: '20px' }}>
          <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input type="text" placeholder="Buscar por produto, código ou lote..." value={busca} onChange={(e) => setBusca(e.target.value)} style={campoStyle} />
        </div>

        {semAcesso && (
          <div role="note" style={{ padding: '12px 16px', borderRadius: 'var(--radius-md)', border: '1px solid rgba(245,158,11,0.5)', fontSize: '13px', marginBottom: '16px' }}>
            Você não tem acesso à leitura de lotes. Peça ao administrador da empresa para liberar a permissão de estoque no seu usuário.
          </div>
        )}

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '13px', textTransform: 'uppercase' }}>
                <th style={{ padding: '14px' }}>Produto</th>
                <th style={{ padding: '14px' }}>Lote</th>
                <th style={{ padding: '14px' }}>Validade</th>
                <th style={{ padding: '14px' }}>Prazo</th>
                <th style={{ padding: '14px', textAlign: 'right' }}>Saldo</th>
                <th style={{ padding: '14px' }}>Situação</th>
              </tr>
            </thead>
            <tbody>
              {carregando ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '30px' }}>Carregando os lotes...</td></tr>
              ) : visiveis.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '50px', color: 'var(--text-muted)' }}>
                    <CalendarClock size={44} style={{ margin: '0 auto 14px', opacity: 0.25 }} />
                    <div>{lotes.length === 0
                      ? 'Nenhum lote cadastrado ainda. Ligue "Controlar lote" no cadastro do produto e dê entrada informando lote e validade.'
                      : 'Nenhum lote nesta situação.'}</div>
                  </td>
                </tr>
              ) : visiveis.map((l) => {
                const situacao = situacaoDoLote(l.validade, hoje);
                return (
                  <tr key={l.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '14px', fontWeight: 600 }}>{l.produtoNome}{l.produtoCodigo ? <span style={{ display: 'block', fontSize: '12px', fontWeight: 400, color: 'var(--text-muted)' }}>cód. {l.produtoCodigo}</span> : null}</td>
                    <td style={{ padding: '14px', fontFamily: 'monospace' }}>{l.lote}</td>
                    <td style={{ padding: '14px' }}>{dataBr(l.validade)}</td>
                    <td style={{ padding: '14px' }}>{rotuloDosDias(l.validade, hoje) || '-'}</td>
                    <td style={{ padding: '14px', textAlign: 'right', fontWeight: 700 }}>{quantidadeBr(l.quantidade)}</td>
                    <td style={{ padding: '14px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 700, padding: '4px 10px', borderRadius: '12px', backgroundColor: COR_SITUACAO[situacao].fundo, color: COR_SITUACAO[situacao].texto, whiteSpace: 'nowrap' }}>
                        {ROTULO_SITUACAO_LOTE[situacao]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default LotesValidades;
