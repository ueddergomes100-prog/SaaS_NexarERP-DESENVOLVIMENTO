import React, { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { dateInputToUtcEnd, dateInputToUtcStart, formatDateInputPtBr } from '../../utils/dateTime';
import {
  enriquecerVendas,
  resumoPorVendedor,
  totaisVendas,
  vendaNoPeriodo,
} from '../../utils/relatorioVendasDomain';
import {
  indicadoresVendas,
  secaoDetalheVendas,
  secaoResumoVendedor,
  secaoVendasPorVendedorDetalhe,
} from '../../utils/relatorioVendasPdf';
import { nomeArquivoRelatorio } from '../../utils/relatorioPdfDomain';
import { useDadosRelatorioVendas } from '../../hooks/useDadosRelatorioVendas';
import RelatorioPreview, { type DocumentoRelatorioSemEmpresa } from '../../components/Reports/RelatorioPreview';

/*
 * Relatorios Diversos > Vendas (Geral) e Vendas por Vendedor.
 *
 * Mesma conta da tela Vendas > Relatorio de Vendas (relatorioVendasDomain):
 * data da venda, pre-venda em aberto fora, desconto e devolucao abatidos. A
 * versao antiga usava a data de criacao e somava pedido em aberto, entao o
 * total do papel nao batia com o da tela.
 */
const PrintRelatorioVendas: React.FC = () => {
  const { search } = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(search);
  const tipo = params.get('tipo') === 'vendedor' ? 'vendedor' : 'geral';
  const inicio = params.get('inicio') || '';
  const fim = params.get('fim') || '';

  const { data, loading, error } = useDadosRelatorioVendas();

  const vendas = useMemo(() => {
    const start = dateInputToUtcStart(inicio);
    const end = dateInputToUtcEnd(fim);
    return enriquecerVendas(data)
      .filter((venda) => vendaNoPeriodo(venda, start, end))
      .sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));
  }, [data, inicio, fim]);

  const titulo = tipo === 'vendedor' ? 'Vendas por Vendedor' : 'Relatório de Vendas';

  const documento = useMemo<DocumentoRelatorioSemEmpresa | null>(() => {
    if (loading) return null;
    const resumo = resumoPorVendedor(vendas);
    const base = {
      titulo,
      periodo: inicio === fim
        ? `Data: ${formatDateInputPtBr(inicio)}`
        : `Período: ${formatDateInputPtBr(inicio)} a ${formatDateInputPtBr(fim)}`,
      indicadores: indicadoresVendas(totaisVendas(vendas)),
    };
    return tipo === 'vendedor'
      ? { ...base, secoes: [secaoResumoVendedor(resumo), secaoVendasPorVendedorDetalhe(vendas)] }
      : { ...base, secoes: [secaoDetalheVendas(vendas), secaoResumoVendedor(resumo, { opcional: true, padrao: false })] };
  }, [fim, inicio, loading, tipo, titulo, vendas]);

  const periodoInvalido = !inicio || !fim || inicio > fim;

  return (
    <div style={{ padding: '20px' }}>
      <RelatorioPreview
        relatorioId={tipo === 'vendedor' ? 'vendas-por-vendedor' : 'relatorio-vendas'}
        documento={periodoInvalido ? null : documento}
        nomeArquivo={nomeArquivoRelatorio(titulo, inicio, fim)}
        onFechar={() => navigate('/relatorios-diversos')}
        carregando={loading}
        erro={periodoInvalido ? 'Período inválido: volte e confira a data inicial e a data final.' : error}
      />
    </div>
  );
};

export default PrintRelatorioVendas;
