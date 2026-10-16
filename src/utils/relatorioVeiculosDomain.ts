import type { ColunaRelatorio, IndicadorRelatorio, SecaoRelatorio } from './relatorioPdfDomain';
import { identificacaoCurta, rotulosOficina, type ModoOficina } from './oficinaDomain';

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

// ---------------------------------------------------------------------------
// RELATORIO DA TELA DE VEICULOS / EQUIPAMENTOS (16/10/2026, pedido do dono)
// ---------------------------------------------------------------------------
//
// "Mais opcoes › Relatorio" no cadastro: sai exatamente o que a lista mostra
// (busca e situacao ja aplicadas pela tela), com as colunas do modo da
// oficina -- placa/km para veiculos, frota/serie/horimetro para maquinas.

export interface VeiculoDaTela extends VeiculoDoRelatorio {
  frota?: string;
  serie?: string;
  horimetro?: number;
  ativo?: boolean;
}

export const montarDocumentoVeiculosDaTela = (
  veiculos: VeiculoDaTela[],
  opcoes: { modo: ModoOficina; filtrosAplicados: string[] },
): DocumentoRelatorioVeiculos & { periodo: string } => {
  const maquinas = opcoes.modo === 'maquinas_pesadas';
  const rotulos = rotulosOficina(opcoes.modo);
  const ativos = veiculos.filter((v) => v.ativo !== false).length;
  const donos = new Set(veiculos.map((v) => String(v.clienteNome || '').trim().toUpperCase()).filter(Boolean)).size;
  const medidor = (v: VeiculoDaTela): number | null => {
    const n = Number(maquinas ? v.horimetro : v.kmAtual);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const colunas: ColunaRelatorio<VeiculoDaTela>[] = [
    { id: 'identificacao', titulo: rotulos.identificacao, tipo: 'texto', largura: 26, valor: (v) => identificacaoCurta(opcoes.modo, v) },
    { id: 'placa', titulo: 'Placa', tipo: 'texto', largura: 20, padrao: false, valor: (v) => String(v.placa || '').toUpperCase() },
    { id: 'frota', titulo: 'Frota', tipo: 'texto', largura: 16, padrao: false, valor: (v) => v.frota || '' },
    { id: 'serie', titulo: 'Série / Chassi', tipo: 'texto', largura: 32, padrao: false, valor: (v) => v.serie || '' },
    { id: 'veiculo', titulo: 'Marca / Modelo', tipo: 'texto', largura: 50, valor: marcaModelo },
    { id: 'ano', titulo: 'Ano', tipo: 'texto', largura: 12, valor: (v) => v.ano || '' },
    { id: 'cor', titulo: 'Cor', tipo: 'texto', largura: 16, padrao: !maquinas, valor: (v) => v.cor || '' },
    // Quilometragem/horimetro nao se soma entre veiculos: sem total.
    { id: 'medidor', titulo: maquinas ? 'Horímetro (h)' : 'KM atual', tipo: 'inteiro', total: 'nenhum', largura: 20, valor: medidor },
    { id: 'cliente', titulo: 'Dono (cliente)', tipo: 'texto', largura: 60, valor: (v) => v.clienteNome || 'Não informado' },
    { id: 'situacao', titulo: 'Situação', tipo: 'texto', largura: 16, padrao: false, valor: (v) => (v.ativo === false ? 'Inativo' : 'Ativo') },
  ];

  return {
    titulo: `Relatório de ${rotulos.veiculos}`,
    periodo: 'Cadastro atual',
    filtros: opcoes.filtrosAplicados,
    indicadores: [
      { rotulo: rotulos.veiculos, valor: String(veiculos.length) },
      { rotulo: 'Ativos', valor: String(ativos) },
      { rotulo: 'Inativos', valor: String(veiculos.length - ativos) },
      { rotulo: 'Clientes donos', valor: String(donos) },
    ],
    secoes: [{
      id: 'veiculos',
      titulo: rotulos.veiculos,
      colunas,
      linhas: veiculos,
      unidade: maquinas ? ['equipamento', 'equipamentos'] : ['veículo', 'veículos'],
      mensagemVazia: 'Nenhum cadastro com esses filtros.',
    } as SecaoRelatorio],
  };
};
