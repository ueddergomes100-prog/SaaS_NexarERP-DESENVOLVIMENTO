import React, { useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Loader2, Printer, UserCheck } from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { TabActiveContext } from '../../contexts/TabsContext';
import IdentificarVendedorModal from '../../components/common/IdentificarVendedorModal';
import type { VendedorIdentificado } from '../../utils/vendedorPinDomain';
import { contaComoFaturamento } from '../../utils/preVendaDomain';
import { fromCents, toCents } from '../../utils/financeDomain';
import {
  dateInputToUtcEnd,
  dateInputToUtcStart,
  formatDateInputPtBr,
  getDashboardPeriodRange,
  getDateInputInTimeZone,
  type DashboardPeriod,
} from '../../utils/dateTime';

/**
 * Autoatendimento do vendedor: trancada atras do MESMO popup de codigo+PIN
 * usado na hora da venda (IdentificarVendedorModal). Mostra so as vendas de
 * quem se identificou -- sem editar, cancelar ou estornar, so consultar e
 * reimprimir. Existe pra dar ao vendedor comum um jeito de ver as PROPRIAS
 * vendas quando "Exigir identificação do vendedor" esconde a lista geral de
 * Pedidos de Venda (ver listaGeralDeVendasEscondidaParaFuncionario em
 * vendedorPinDomain.ts).
 *
 * O popup NAO abre sozinho ao entrar na tela: fica um botao "Identificar
 * vendedor" primeiro. Motivo: esta tela roda dentro do Sistema de Abas
 * (TabsContext), e o popup so devolve o vendedor via onIdentificado/onClose
 * -- ele nao sabe navegar. Se o popup abrisse automatico e o usuario so
 * fechasse (sem digitar nada), nao ha pra onde a tela "voltar" a nao ser
 * ficar vazia; um `navigate('/dashboard')` aqui pra cobrir esse caso
 * reescreveria o path DESTA aba pro Dashboard (updateTabLocation), criando
 * uma aba "Dashboard" fantasma toda vez -- era exatamente o que enchia a
 * barra de abas de "Dashboard" duplicado. Com o botao, cancelar o popup so
 * fecha o popup e devolve pro botao, sem mexer na URL/aba.
 *
 * Busca so por `vendedorId` (nunca o fallback de 3 campos que
 * visibilidadeVendasDomain.ts usa pra outro cenario, login individual):
 * toda venda feita pelo fluxo de PIN sempre grava vendedorId real, entao a
 * query fica simples e nao precisa de indice composto (so igualdade em 2
 * campos).
 */

interface VendaData {
  id: string;
  numeroPedido?: string;
  clienteNome?: string;
  status: string;
  valorTotal?: number;
  valorTotalCentavos?: number;
  dataVenda?: string;
  createdAt?: unknown;
}

interface VendaComData extends VendaData {
  data: Date | null;
}

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const STATUS_CORES: Record<string, { bg: string; fg: string }> = {
  Finalizada: { bg: 'rgba(16,185,129,0.2)', fg: '#10b981' },
  'Pré-venda': { bg: 'rgba(245,158,11,0.2)', fg: '#f59e0b' },
  'Em Análise': { bg: 'rgba(245,158,11,0.2)', fg: '#f59e0b' },
  Cancelada: { bg: 'rgba(239,68,68,0.2)', fg: '#ef4444' },
};

const toDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  if (typeof value === 'object' && value !== null && 'seconds' in value) {
    return new Date(Number((value as { seconds: number }).seconds) * 1000);
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return dateInputToUtcStart(value);
  const parsed = new Date(value as string);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

type Preset = DashboardPeriod | 'personalizado';

const PAGE_STEP = 10;

const MinhasVendas: React.FC = () => {
  const navigate = useNavigate();
  const { tenantId } = useAuth();
  const isTabActive = useContext(TabActiveContext);

  const [vendedor, setVendedor] = useState<VendedorIdentificado | null>(null);
  const [modalAberto, setModalAberto] = useState(false);
  const [vendas, setVendas] = useState<VendaData[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  const [preset, setPreset] = useState<Preset>('mes');
  const [customStart, setCustomStart] = useState(getDateInputInTimeZone());
  const [customEnd, setCustomEnd] = useState(getDateInputInTimeZone());
  const [visivel, setVisivel] = useState(PAGE_STEP);

  // Estacao compartilhada + Sistema de Abas (F19): trocar de aba nao
  // desmonta esta tela, so esconde via CSS. Sem isto, o vendedor B veria
  // as vendas do vendedor A se so trocasse de aba sem fechar "Minhas
  // Vendas" -- o proximo a clicar de volta nesta aba ja aberta acharia o
  // identificado anterior ainda carregado. Ao sair da aba, esquece tudo e
  // forca identificar de novo na proxima vez que ela ficar visivel.
  useEffect(() => {
    if (!isTabActive) {
      setVendedor(null);
      setModalAberto(false);
      setVendas([]);
      setVisivel(PAGE_STEP);
      setErro('');
    }
  }, [isTabActive]);

  useEffect(() => {
    if (!vendedor || !tenantId) return;
    let cancelado = false;
    setLoading(true);
    setErro('');

    getDocs(query(
      collection(db, 'pedidos_venda'),
      where('tenantId', '==', tenantId),
      where('vendedorId', '==', vendedor.vendedorId),
    )).then((snap) => {
      if (cancelado) return;
      setVendas(snap.docs.map((documento) => ({ id: documento.id, ...documento.data() } as VendaData)));
    }).catch((err) => {
      console.error('Erro ao carregar Minhas Vendas:', err);
      if (!cancelado) setErro('Não foi possível carregar suas vendas. Verifique sua conexão e tente de novo.');
    }).finally(() => {
      if (!cancelado) setLoading(false);
    });

    return () => { cancelado = true; };
  }, [vendedor, tenantId]);

  const periodo = useMemo(() => {
    if (preset === 'personalizado') return { startDate: customStart, endDate: customEnd };
    const range = getDashboardPeriodRange(preset);
    return { startDate: range.startDate, endDate: range.endDate };
  }, [preset, customStart, customEnd]);

  const vendasDoPeriodo = useMemo<VendaComData[]>(() => {
    const start = dateInputToUtcStart(periodo.startDate);
    const end = dateInputToUtcEnd(periodo.endDate);
    if (!start || !end) return [];

    return vendas
      .map((venda) => ({ ...venda, data: toDate(venda.dataVenda) || toDate(venda.createdAt) }))
      .filter((venda) => venda.data && venda.data >= start && venda.data <= end)
      .sort((a, b) => (b.data?.getTime() || 0) - (a.data?.getTime() || 0));
  }, [vendas, periodo]);

  const totais = useMemo(() => {
    const faturadas = vendasDoPeriodo.filter((venda) => contaComoFaturamento(venda.status));
    const totalCentavos = faturadas.reduce(
      (soma, venda) => soma + Number(venda.valorTotalCentavos ?? toCents(venda.valorTotal)),
      0,
    );
    return { quantidade: faturadas.length, totalCentavos };
  }, [vendasDoPeriodo]);

  const listaVisivel = vendasDoPeriodo.slice(0, visivel);

  if (!vendedor) {
    return (
      <>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '80px 20px', textAlign: 'center' }}>
          <UserCheck size={40} color="var(--accent-purple)" />
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '6px' }}>Minhas Vendas</h1>
            <p style={{ color: 'var(--text-muted)', maxWidth: '360px' }}>
              Identifique-se com seu código e senha de vendedor para ver suas próprias vendas.
            </p>
          </div>
          <button type="button" className="btn-primary" onClick={() => setModalAberto(true)}>
            Identificar vendedor
          </button>
        </div>
        <IdentificarVendedorModal
          open={modalAberto}
          descricaoOperacao="Ver minhas vendas"
          onClose={() => setModalAberto(false)}
          onIdentificado={(identificado) => setVendedor(identificado)}
        />
      </>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '40px' }}>
      <div>
        <h1 style={{ fontSize: '24px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <UserCheck size={26} color="var(--accent-purple)" /> Minhas Vendas
        </h1>
        <p style={{ color: 'var(--text-muted)' }}>{vendedor.vendedorNome} (código {vendedor.codigo})</p>
      </div>

      {erro && (
        <div role="alert" style={{ padding: '14px 16px', backgroundColor: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.3)', color: '#fecaca', borderRadius: 'var(--radius-md)' }}>
          {erro}
        </div>
      )}

      <div className="card" style={{ padding: '20px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          {(['mes', 'semana', 'personalizado'] as Preset[]).map((opcao) => (
            <button
              key={opcao}
              type="button"
              onClick={() => setPreset(opcao)}
              style={{
                padding: '8px 16px', borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer', fontWeight: 600,
                backgroundColor: preset === opcao ? 'var(--accent-purple)' : 'var(--bg-tertiary)',
                color: preset === opcao ? 'white' : 'var(--text-muted)',
              }}
            >
              {opcao === 'mes' ? 'Mês atual' : opcao === 'semana' ? 'Semana atual' : 'Personalizado'}
            </button>
          ))}
        </div>
        {preset === 'personalizado' && (
          <>
            <label className="input-group">
              <span>De</span>
              <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
            </label>
            <label className="input-group">
              <span>Até</span>
              <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
            </label>
          </>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '14px' }}>
        <div className="card" style={{ padding: '18px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Vendas faturadas no período</span>
          <strong style={{ display: 'block', marginTop: '7px', fontSize: '21px' }}>{totais.quantidade}</strong>
        </div>
        <div className="card" style={{ padding: '18px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Valor faturado no período</span>
          <strong style={{ display: 'block', marginTop: '7px', fontSize: '21px' }}>{currency.format(fromCents(totais.totalCentavos))}</strong>
        </div>
      </div>

      <div className="card" style={{ padding: '20px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <h2 style={{ fontSize: '18px', marginBottom: '16px' }}>
          Vendas de {formatDateInputPtBr(periodo.startDate)} a {formatDateInputPtBr(periodo.endDate)}
        </h2>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px' }}>
            <Loader2 size={30} className="spin-animation" />
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '13px', textTransform: 'uppercase' }}>
                    <th style={{ padding: '12px' }}>Pedido</th>
                    <th style={{ padding: '12px' }}>Data</th>
                    <th style={{ padding: '12px' }}>Cliente</th>
                    <th style={{ padding: '12px' }}>Status</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>Total</th>
                    <th style={{ padding: '12px', textAlign: 'center' }}>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {listaVisivel.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>Nenhuma venda no período.</td>
                    </tr>
                  ) : listaVisivel.map((venda) => {
                    const cor = STATUS_CORES[venda.status] || { bg: 'var(--bg-tertiary)', fg: 'var(--text-muted)' };
                    return (
                      <tr key={venda.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '12px' }}>#{venda.numeroPedido || venda.id.slice(0, 6)}</td>
                        <td style={{ padding: '12px' }}>{venda.data ? venda.data.toLocaleDateString('pt-BR') : '-'}</td>
                        <td style={{ padding: '12px' }}>{venda.clienteNome || '-'}</td>
                        <td style={{ padding: '12px' }}>
                          <span style={{ backgroundColor: cor.bg, color: cor.fg, padding: '4px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 600 }}>
                            {venda.status}
                          </span>
                        </td>
                        <td style={{ padding: '12px', textAlign: 'right' }}>
                          {currency.format(fromCents(Number(venda.valorTotalCentavos ?? toCents(venda.valorTotal))))}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          <button
                            type="button"
                            className="icon-btn"
                            title="Reimprimir"
                            onClick={() => navigate(`/pedidos-venda/print/${venda.id}`)}
                          >
                            <Printer size={18} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {visivel < vendasDoPeriodo.length && (
              <div style={{ textAlign: 'center', marginTop: '16px' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setVisivel((atual) => atual + PAGE_STEP)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                >
                  <ChevronDown size={16} /> Ver mais ({vendasDoPeriodo.length - visivel} restantes)
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default MinhasVendas;
