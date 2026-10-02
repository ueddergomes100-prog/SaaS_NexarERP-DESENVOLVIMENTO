import type { ColunaRelatorio, IndicadorRelatorio, SecaoRelatorio } from './relatorioPdfDomain';

/*
 * RELATORIOS DIVERSOS > VEICULOS DOS CLIENTES (frota cadastrada na OS).
 *
 * Mesmo filtro e ordem da pagina antiga de impressao: busca por placa,
 * modelo ou nome do cliente, ordenado pela placa. Agora sai no padrao de
 * relatorio do sistema (PDF na tela, colunas por caixa de marcar -- decisao
 * do dono de 2026-09-23 e 2026-10-02).
 *
 * Regra pura: recebe os veiculos ja lidos e devolve o documento.
 */

export interface VeiculoDoRelatorio {
  id: string;
  placa?: string;
  modelo?: string;
  marca?: string;
  ano?: string;
  cor?: string;
  kmAtual?: number;
  clienteNome?: string;
}

export interface DocumentoRelatorioVeiculos {
  titulo: string;
  filtros: string[];
  indicadores: IndicadorRelatorio[];
  secoes: SecaoRelatorio[];
}

export const TITULO_RELATORIO_VEICULOS = 'Relatório de Frota e Veículos';

/** Ordena pela placa e aplica a busca (placa, modelo ou cliente), sem diferenciar maiuscula. */
export const veiculosDoRelatorio = (veiculos: VeiculoDoRelatorio[], busca: string): VeiculoDoRelatorio[] => {
  const termo = (busca || '').toLowerCase();
  return [...veiculos]
    .sort((a, b) => (a.placa || '').localeCompare(b.placa || ''))
    .filter((v) => !termo
      || (v.placa || '').toLowerCase().includes(termo)
      || (v.modelo || '').toLowerCase().includes(termo)
      || Boolean(v.clienteNome && v.clienteNome.toLowerCase().includes(termo)));
};

const marcaModelo = (v: VeiculoDoRelatorio): string => `${v.marca ? `${v.marca} ` : ''}${v.modelo || ''}`;

export const montarDocumentoVeiculos = (veiculos: VeiculoDoRelatorio[], busca: string): DocumentoRelatorioVeiculos => {
  const lista = veiculosDoRelatorio(veiculos, busca);

  const colunas: ColunaRelatorio<VeiculoDoRelatorio>[] = [
    { id: 'placa', titulo: 'Placa', tipo: 'texto', largura: 22, valor: (v) => v.placa || '' },
    { id: 'veiculo', titulo: 'Veículo (Marca/Modelo)', tipo: 'texto', largura: 50, valor: marcaModelo },
    { id: 'anoCor', titulo: 'Ano/Cor', tipo: 'texto', largura: 26, valor: (v) => `${v.ano || '-'} / ${v.cor || '-'}` },
    // Quilometragem nao se soma entre veiculos: sem total.
    { id: 'km', titulo: 'KM Atual', tipo: 'inteiro', total: 'nenhum', largura: 20, valor: (v) => (v.kmAtual ? v.kmAtual : null) },
    { id: 'cliente', titulo: 'Dono (Cliente)', tipo: 'texto', largura: 60, valor: (v) => v.clienteNome || 'Não informado' },
  ];

  return {
    titulo: TITULO_RELATORIO_VEICULOS,
    filtros: busca ? [`Filtro aplicado: "${busca}"`] : [],
    indicadores: [{ rotulo: 'Veículos listados', valor: String(lista.length) }],
    secoes: [{
      id: 'veiculos',
      titulo: 'Veículos',
      colunas,
      linhas: lista,
      rotuloTotal: 'Total de veículos listados',
      unidade: ['veículo', 'veículos'],
      mensagemVazia: 'Nenhum veículo encontrado com os filtros atuais.',
    } as SecaoRelatorio],
  };
};
