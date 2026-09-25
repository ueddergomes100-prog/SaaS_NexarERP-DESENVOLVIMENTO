import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { BarChart2, FileText, Truck } from 'lucide-react';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import { nomeArquivoRelatorio } from '../../utils/relatorioPdfDomain';
import { rotuloDoVeiculo, type VeiculoDaFrota } from '../../utils/frotaDomain';
import { montarDocumentoCustoPorVeiculo, type FiltroCustoVeiculo, type TituloDeVeiculo } from '../../utils/custoPorVeiculoDomain';
import RelatorioPreview, { type DocumentoRelatorioSemEmpresa } from '../../components/Reports/RelatorioPreview';

/**
 * CUSTO POR VEICULO (2026-09-25): despesas do Contas a Pagar ligadas a cada
 * veiculo da frota, por periodo de vencimento. Abre na tela como PDF (Imprimir /
 * Salvar PDF, colunas por caixa de marcar), como todo relatorio do sistema.
 */

const primeiroDiaDoMes = (hoje: string): string => `${hoje.slice(0, 8)}01`;

const campoStyle: React.CSSProperties = { padding: '11px 13px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' };

const CustoPorVeiculo: React.FC = () => {
  const { tenantId } = useAuth();
  const hoje = getDateInputInTimeZone();
  const [titulos, setTitulos] = useState<TituloDeVeiculo[]>([]);
  const [frota, setFrota] = useState<VeiculoDaFrota[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState<FiltroCustoVeiculo>({ de: primeiroDiaDoMes(hoje), ate: hoje, situacao: 'todas' });
  const [previewAberto, setPreviewAberto] = useState(false);

  useEffect(() => {
    if (!tenantId) return undefined;
    const pararTitulos = onSnapshot(query(collection(db, 'transacoes'), where('tenantId', '==', tenantId), where('tipo', '==', 'saida')), (snap) => {
      const lista: TituloDeVeiculo[] = [];
      snap.forEach((d) => {
        const x = d.data();
        if (!x.veiculoId) return;
        lista.push({
          id: d.id,
          data: String(x.data || ''),
          descricao: String(x.descricao || ''),
          categoria: String(x.categoria || ''),
          valor: Number(x.valor || 0),
          ...(Number.isFinite(x.valorCentavos) ? { valorCentavos: Number(x.valorCentavos) } : {}),
          status: String(x.status || ''),
          veiculoId: String(x.veiculoId),
          veiculoNome: String(x.veiculoNome || ''),
          veiculoPlaca: String(x.veiculoPlaca || ''),
          motoristaNome: String(x.motoristaNome || ''),
          dataPagamento: String(x.dataPagamento || ''),
        });
      });
      setTitulos(lista);
      setCarregando(false);
    }, (erro) => {
      console.error('Erro ao buscar despesas de veículo:', erro);
      setCarregando(false);
    });
    const pararFrota = onSnapshot(query(collection(db, 'frota'), where('tenantId', '==', tenantId)), (snap) => {
      setFrota(snap.docs.map((d) => ({ id: d.id, ...d.data() } as VeiculoDaFrota)));
    }, (erro) => console.error('Erro ao buscar a frota:', erro));
    return () => { pararTitulos(); pararFrota(); };
  }, [tenantId]);

  const veiculoEscolhido = frota.find((v) => v.id === filtro.veiculoId);
  const documento = useMemo<DocumentoRelatorioSemEmpresa>(
    () => montarDocumentoCustoPorVeiculo(titulos, filtro, veiculoEscolhido ? rotuloDoVeiculo(veiculoEscolhido) : undefined),
    [titulos, filtro, veiculoEscolhido],
  );

  if (previewAberto) {
    return (
      <RelatorioPreview
        relatorioId="custo-por-veiculo"
        documento={documento}
        nomeArquivo={nomeArquivoRelatorio('Custo por Veículo', filtro.de, filtro.ate)}
        onFechar={() => setPreviewAberto(false)}
        rotuloFechar="Voltar aos filtros"
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div>
        <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <BarChart2 size={26} color="var(--accent-purple)" /> Custo por Veículo
        </h1>
        <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>
          Soma das despesas ligadas a cada veículo da frota (combustível, manutenção, IPVA, seguro...). As despesas são lançadas em Financeiro › Contas a Pagar, escolhendo o veículo.
        </p>
      </div>

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '18px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '16px' }}>
          <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Vencimento de</label>
            <input type="date" value={filtro.de} onChange={(e) => setFiltro({ ...filtro, de: e.target.value })} style={campoStyle} />
          </div>
          <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>até</label>
            <input type="date" value={filtro.ate} onChange={(e) => setFiltro({ ...filtro, ate: e.target.value })} style={campoStyle} />
          </div>
          <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Veículo</label>
            <select value={filtro.veiculoId || ''} onChange={(e) => setFiltro({ ...filtro, veiculoId: e.target.value || undefined })} className="form-select" style={campoStyle}>
              <option value="">Todos os veículos</option>
              {frota.map((v) => <option key={v.id} value={v.id}>{rotuloDoVeiculo(v)}{v.ativo === false ? ' (inativo)' : ''}</option>)}
            </select>
          </div>
          <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Situação da despesa</label>
            <select value={filtro.situacao || 'todas'} onChange={(e) => setFiltro({ ...filtro, situacao: e.target.value as FiltroCustoVeiculo['situacao'] })} className="form-select" style={campoStyle}>
              <option value="todas">Todas</option>
              <option value="pagas">Somente pagas</option>
              <option value="a_pagar">Somente a pagar</option>
            </select>
          </div>
        </div>

        {!carregando && titulos.length === 0 && (
          <div role="note" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', borderRadius: 'var(--radius-md)', border: '1px solid rgba(245,158,11,0.5)', fontSize: '13px' }}>
            <Truck size={18} color="#f59e0b" />
            Ainda não há despesa ligada a veículo. Cadastre os veículos em Expedição › Frota e, ao lançar a despesa no Contas a Pagar, escolha o veículo.
          </div>
        )}

        <div>
          <button className="btn-primary" onClick={() => setPreviewAberto(true)} disabled={carregando} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileText size={18} /> Gerar relatório
          </button>
        </div>
      </div>
    </div>
  );
};

export default CustoPorVeiculo;
