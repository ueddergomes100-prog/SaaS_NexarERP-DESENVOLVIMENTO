import type { ColunaRelatorio, IndicadorRelatorio, SecaoRelatorio } from './relatorioPdfDomain';
import {
  dataDoRegistro,
  ehAcaoCritica,
  nomeDeQuemFez,
  resumoDasAlteracoes,
  rotuloDaAcao,
  rotuloDaOrigem,
  telaDoRegistro,
  type RegistroLido,
} from './historicoAlteracoesDomain';

/*
 * RELATORIO DO HISTORICO DE ALTERACOES (09/11/2026), no padrao de relatorio do
 * sistema: PDF na tela, colunas por caixa de marcar, Excel em botao separado.
 * Serve tanto para a tela geral (periodo + filtros) quanto para o historico de
 * um documento so' ("Rota 02"), que e' a prova que o dono mostra ao cliente.
 */

export interface DocumentoRelatorioHistorico {
  titulo: string;
  periodo?: string;
  filtros: string[];
  indicadores: IndicadorRelatorio[];
  secoes: SecaoRelatorio[];
}

const textoDoDocumento = (r: RegistroLido): string => {
  const numero = (r.documentoNumero || '').trim();
  return numero;
};

const colunas: ColunaRelatorio<RegistroLido>[] = [
  { id: 'dataHora', titulo: 'Data e hora', tipo: 'dataHora', largura: 28, valor: (r) => dataDoRegistro(r.dataHora) },
  { id: 'usuario', titulo: 'Quem fez', tipo: 'texto', largura: 36, valor: (r) => nomeDeQuemFez(r) },
  { id: 'papel', titulo: 'Papel', tipo: 'texto', largura: 22, valor: (r) => r.usuarioPapel || '' },
  { id: 'acao', titulo: 'Ação', tipo: 'texto', largura: 26, valor: (r) => rotuloDaAcao(r.acao) },
  { id: 'documento', titulo: 'Documento', tipo: 'texto', largura: 26, valor: textoDoDocumento },
  { id: 'descricao', titulo: 'O que aconteceu', tipo: 'texto', largura: 80, valor: (r) => r.descricao || '' },
  { id: 'motivo', titulo: 'Motivo', tipo: 'texto', largura: 40, valor: (r) => r.motivo || '' },
  { id: 'alteracoes', titulo: 'Antes → depois', tipo: 'texto', largura: 70, padrao: false, valor: (r) => resumoDasAlteracoes(r.alteracoes) },
  { id: 'tela', titulo: 'Tela', tipo: 'texto', largura: 34, valor: (r) => telaDoRegistro(r) },
  { id: 'origem', titulo: 'Origem', tipo: 'texto', largura: 26, padrao: false, valor: (r) => rotuloDaOrigem(r.origem) },
  { id: 'filial', titulo: 'Filial', tipo: 'texto', largura: 30, padrao: false, valor: (r) => r.filialNome || '' },
  { id: 'vendedor', titulo: 'Vendedor', tipo: 'texto', largura: 30, padrao: false, valor: (r) => r.vendedorNome || '' },
];

export const montarDocumentoHistorico = (
  registros: RegistroLido[],
  opcoes: { titulo?: string; periodo?: string; filtros?: string[] } = {},
): DocumentoRelatorioHistorico => {
  const usuarios = new Set(registros.map((r) => nomeDeQuemFez(r)));
  const criticos = registros.filter((r) => ehAcaoCritica(r.acao)).length;
  return {
    titulo: opcoes.titulo || 'Histórico de alterações',
    ...(opcoes.periodo ? { periodo: opcoes.periodo } : {}),
    filtros: opcoes.filtros || [],
    indicadores: [
      { rotulo: 'Registros', valor: String(registros.length) },
      { rotulo: 'Pessoas', valor: String(usuarios.size) },
      { rotulo: 'Cancelamentos, exclusões e estornos', valor: String(criticos) },
    ],
    secoes: [
      {
        id: 'registros',
        titulo: 'Registros',
        colunas,
        linhas: registros,
        unidade: ['registro', 'registros'],
        mensagemVazia: 'Nenhum registro encontrado com esses filtros.',
      } as SecaoRelatorio,
    ],
  };
};
