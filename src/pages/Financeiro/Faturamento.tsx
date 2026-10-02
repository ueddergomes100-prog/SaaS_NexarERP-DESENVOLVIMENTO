import React, { useEffect, useMemo, useState } from 'react';
import { TrendingUp, FileText, PieChart, Calendar, Loader2 } from 'lucide-react';
import { collection, query, onSnapshot, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { fromCents } from '../../utils/financeDomain';
import { nomeArquivoRelatorio } from '../../utils/relatorioPdfDomain';
import {
  calcularFaturamentoAnual,
  montarDocumentoFaturamentoAnual,
  type TransacaoFaturamento,
} from '../../utils/relatorioFaturamentoAnualDomain';
import RelatorioPreview, { type DocumentoRelatorioSemEmpresa } from '../../components/Reports/RelatorioPreview';

/*
 * FATURAMENTO & DRE. Toda a conta (DRE, formas de pagamento, medias e
 * balancete) mora em relatorioFaturamentoAnualDomain.ts e e' a mesma do
 * relatorio: "Gerar relatorio" abre no RelatorioPreview (PDF, colunas por
 * caixa de marcar, Excel dentro da previa) -- padronizacao dos relatorios,
 * dono 2026-10-02.
 */

const Faturamento: React.FC = () => {
  const [transacoes, setTransacoes] = useState<TransacaoFaturamento[]>([]);
  const [loading, setLoading] = useState(true);
  const [anoFiltro, setAnoFiltro] = useState<number>(new Date().getFullYear());
  const [previewAberto, setPreviewAberto] = useState(false);
  const { currentUser, tenantId } = useAuth();

  useEffect(() => {
    if (!currentUser) return;
    const q = query(collection(db, 'transacoes'), where('tenantId', '==', tenantId));
    
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const data: TransacaoFaturamento[] = [];
      querySnapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as TransacaoFaturamento);
      });
      setTransacoes(data);
      setLoading(false);
    }, (error) => {
      console.error("Erro ao buscar transações pro Faturamento:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser, tenantId]);

  // Somente lancamentos pagos do ano selecionado; mesma conta do relatorio.
  const resumo = useMemo(() => calcularFaturamentoAnual(transacoes, anoFiltro), [transacoes, anoFiltro]);
  const documento = useMemo<DocumentoRelatorioSemEmpresa>(
    () => montarDocumentoFaturamentoAnual(transacoes, anoFiltro),
    [transacoes, anoFiltro],
  );

  const receitaBruta = fromCents(resumo.receitaBrutaCentavos);
  const receitaPecas = fromCents(resumo.receitaPecasCentavos);
  const receitaServicos = fromCents(resumo.receitaServicosCentavos);
  const receitaOutros = fromCents(resumo.receitaOutrosCentavos);
  const taxasCartao = fromCents(resumo.taxasCartaoCentavos);
  const totalEstornos = fromCents(resumo.estornosCentavos);
  const receitaLiquida = fromCents(resumo.receitaLiquidaCentavos);
  const totalDespesas = fromCents(resumo.despesasCentavos);
  const lucroLiquido = fromCents(resumo.lucroLiquidoCentavos);
  const margemLucro = resumo.margemLucro;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  if (previewAberto) {
    return (
      <RelatorioPreview
        relatorioId="faturamento-anual"
        documento={documento}
        nomeArquivo={nomeArquivoRelatorio(`Faturamento e DRE ${anoFiltro}`)}
        onFechar={() => setPreviewAberto(false)}
        rotuloFechar="Voltar"
      />
    );
  }

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: '100px' }}><Loader2 className="spin-animation" size={32} color="var(--accent-purple)" /></div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <TrendingUp size={28} color="var(--accent-purple)" />
            Faturamento & DRE
          </h1>
          <p style={{ color: 'var(--text-muted)' }}>Demonstrativo de Resultados e Balancete Mensal</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <select 
            value={anoFiltro}
            onChange={(e) => setAnoFiltro(Number(e.target.value))}
            style={{ padding: '10px 16px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
          >
            {[...Array(5)].map((_, i) => {
              const ano = new Date().getFullYear() - i;
              return <option key={ano} value={ano}>{ano}</option>;
            })}
          </select>
          <button className="btn-primary" onClick={() => setPreviewAberto(true)} title="Abre o DRE e o balancete do ano em PDF (dá para salvar em Excel)" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileText size={18} /> Gerar relatório
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        {/* Bloco DRE Simplificado */}
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
            <PieChart size={20} color="var(--accent-purple)" />
            DRE Simplificado ({anoFiltro})
          </h2>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>1. Receita Bruta Total</span>
              <span style={{ fontWeight: 600, color: '#10b981' }}>{formatCurrency(receitaBruta)}</span>
            </div>
            
            <div style={{ paddingLeft: '24px', display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--text-muted)' }}>
                <span>↳ Venda de Peças (Pedidos de Venda)</span>
                <span>{formatCurrency(receitaPecas)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--text-muted)' }}>
                <span>↳ Serviços (Mão de Obra / OS)</span>
                <span>{formatCurrency(receitaServicos)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--text-muted)' }}>
                <span>↳ Outras Receitas</span>
                <span>{formatCurrency(receitaOutros)}</span>
              </div>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>2. (-) Taxas de Cartão</span>
              <span style={{ fontWeight: 600, color: '#f59e0b' }}>{formatCurrency(taxasCartao)}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>
                3. (-) Cancelamentos e Devoluções
                <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)' }}>
                  Receita estornada por OS/venda cancelada ou devolução
                </span>
              </span>
              <span style={{ fontWeight: 600, color: '#f59e0b' }}>{formatCurrency(totalEstornos)}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', backgroundColor: 'rgba(16, 185, 129, 0.08)', borderRadius: 'var(--radius-md)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>4. (=) Receita Líquida Financeira</span>
              <span style={{ fontWeight: 600, color: '#10b981' }}>{formatCurrency(receitaLiquida)}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>5. (-) Despesas / Custos Totais</span>
              <span style={{ fontWeight: 600, color: '#ef4444' }}>{formatCurrency(totalDespesas)}</span>
            </div>

            <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '8px 0' }}></div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Receitas líquidas por Forma de Pagamento</span>
            </div>
            <div style={{ paddingLeft: '24px', display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '8px' }}>
              {resumo.formasPagamento.map(({ forma, valorCentavos }) => (
                <div key={forma} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--text-muted)' }}>
                  <span>↳ {forma}</span>
                  <span>{formatCurrency(fromCents(valorCentavos))}</span>
                </div>
              ))}
            </div>

            <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '8px 0' }}></div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', backgroundColor: lucroLiquido >= 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', borderRadius: 'var(--radius-md)', border: `1px solid ${lucroLiquido >= 0 ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}` }}>
              <span style={{ fontWeight: 700, fontSize: '16px' }}>(=) Lucro Líquido do Exercício</span>
              <span style={{ fontWeight: 700, fontSize: '20px', color: lucroLiquido >= 0 ? '#10b981' : '#ef4444' }}>
                {formatCurrency(lucroLiquido)}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Margem de Lucro:</span>
              <span style={{ fontWeight: 600, fontSize: '14px', padding: '4px 8px', borderRadius: '12px', backgroundColor: margemLucro >= 20 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)', color: margemLucro >= 20 ? '#10b981' : '#f59e0b' }}>
                {margemLucro.toFixed(2)}%
              </span>
            </div>
          </div>
        </div>

        {/* Bloco Resumo Gráfico / KPIs rápidos */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', flex: 1 }}>
            <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '24px', color: 'var(--text-secondary)' }}>Média Mensal de Receita</h2>
            <div style={{ fontSize: '32px', fontWeight: 700 }}>
              {formatCurrency(fromCents(resumo.mediaMensalReceitaCentavos))}
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '8px' }}>Com base nos meses transcorridos em {anoFiltro}.</p>
          </div>
          
          <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', flex: 1 }}>
            <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '24px', color: 'var(--text-secondary)' }}>Média Mensal de Despesas</h2>
            <div style={{ fontSize: '32px', fontWeight: 700 }}>
              {formatCurrency(fromCents(resumo.mediaMensalDespesasCentavos))}
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '8px' }}>Foco em redução de custos operacionais.</p>
          </div>
        </div>
      </div>

      {/* Tabela de Balancete Mensal */}
      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Calendar size={20} color="var(--accent-purple)" />
          Balancete Mensal
        </h2>
        
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '13px', textTransform: 'uppercase' }}>
                <th style={{ padding: '16px' }}>Mês</th>
                <th style={{ padding: '16px' }}>Receita Bruta</th>
                <th style={{ padding: '16px' }}>Taxas Cartão</th>
                <th style={{ padding: '16px' }}>Receita Líquida</th>
                <th style={{ padding: '16px' }}>Despesas</th>
                <th style={{ padding: '16px' }}>Resultado (Saldo)</th>
              </tr>
            </thead>
            <tbody>
              {/* So' meses que ja' passaram ou o atual, a menos que seja um ano anterior completo. */}
              {resumo.mesesExibidos.map((mes) => (
                <tr key={mes.nomeMes} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '16px', fontWeight: 500 }}>{mes.nomeMes}</td>
                  <td style={{ padding: '16px' }}>{formatCurrency(fromCents(mes.receitaBrutaCentavos))}</td>
                  <td style={{ padding: '16px', color: '#f59e0b' }}>{formatCurrency(fromCents(mes.taxasCentavos))}</td>
                  <td style={{ padding: '16px', color: '#10b981' }}>{formatCurrency(fromCents(mes.receitaLiquidaCentavos))}</td>
                  <td style={{ padding: '16px', color: '#ef4444' }}>{formatCurrency(fromCents(mes.despesasCentavos))}</td>
                  <td style={{ padding: '16px', fontWeight: 600, color: mes.resultadoCentavos >= 0 ? '#10b981' : '#ef4444' }}>
                    {formatCurrency(fromCents(mes.resultadoCentavos))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Faturamento;
