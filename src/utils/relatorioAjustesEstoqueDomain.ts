import { labelMotivoAjusteEstoque, type TipoAjusteEstoque } from './ajusteEstoqueDomain';
import { matchesAllSearchTerms } from './textSearch';
import {
  formatarDataRelatorio,
  type ColunaRelatorio,
  type IndicadorRelatorio,
  type SecaoRelatorio,
} from './relatorioPdfDomain';

/*
 * RELATORIO DE AJUSTES DE ESTOQUE -- trilha dos ajustes manuais (ajustes_estoque),
 * no padrao de relatorio do sistema (decisao do dono, 2026-09-23 e 2026-10-02):
 * abre na tela como PDF, colunas escolhidas por caixa de marcar.
 *
 * Regra pura: recebe os ajustes ja lidos e devolve os filtrados (a tabela da
 * tela usa a mesma lista) e o documento do relatorio. Mesmos filtros do
 * relatorio antigo: periodo, tipo, motivo, produto (termos com "+") e usuario.
 * Ajuste sem data gravada nao e' cortado pelo periodo.
 */

export interface AjusteDoRelatorio {
  id: string;
  produtoNome: string;
  produtoCodigo?: string;
  /** 'materia_prima' | 'insumo' quando o ajuste nao foi de produto; ausente = produto. */
  origem?: string;
  tipo: TipoAjusteEstoque;
  quantidade: number;
  motivo: string;
  observacao?: string;
  lote?: string;
  validade?: string;
  usuarioNome: string;
  /** createdAt do ajuste; null quando nao foi gravado. */
  data: Date | null;
}

export interface FiltroRelatorioAjustes {
  inicio: Date;
  fim: Date;
  tipo: 'todos' | TipoAjusteEstoque;
  motivo: string;
  produto: string;
  usuario: string;
}

export const ajustesDoRelatorio = (ajustes: AjusteDoRelatorio[], filtro: FiltroRelatorioAjustes): AjusteDoRelatorio[] => {
  const inicio = filtro.inicio.getTime();
  const fim = filtro.fim.getTime();
  return ajustes
    .filter((a) => {
      const quando = a.data ? a.data.getTime() : null;
      const dentroPeriodo = quando === null ? true : quando >= inicio && quando <= fim;
      const bateTipo = filtro.tipo === 'todos' || a.tipo === filtro.tipo;
      const bateMotivo = !filtro.motivo || a.motivo === filtro.motivo;
      const bateProduto = matchesAllSearchTerms([a.produtoNome], filtro.produto);
      const bateUsuario = !filtro.usuario || a.usuarioNome === filtro.usuario;
      return dentroPeriodo && bateTipo && bateMotivo && bateProduto && bateUsuario;
    })
    .sort((a, b) => (b.data?.getTime() || 0) - (a.data?.getTime() || 0));
};

/** Soma com arredondamento em 3 casas: quantidade em KG nao pode sair 0,30000000000000004. */
const somar = (valores: number[]): number => Math.round(valores.reduce((soma, v) => soma + v, 0) * 1000) / 1000;

export interface ResumoRelatorioAjustes {
  total: number;
  totalEntradas: number;
  totalSaidas: number;
}

export const resumirAjustes = (filtrados: AjusteDoRelatorio[]): ResumoRelatorioAjustes => ({
  total: filtrados.length,
  totalEntradas: somar(filtrados.filter((a) => a.tipo === 'entrada').map((a) => a.quantidade)),
  totalSaidas: somar(filtrados.filter((a) => a.tipo === 'saida').map((a) => a.quantidade)),
});

/** Quantidade pode ser fracionada (KG, L): sai em pt-BR com ate 3 casas. */
export const formatarQuantidadeAjuste = (n: number): string => (
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(Number(n || 0))
);

export const rotuloTipoAjuste = (tipo: TipoAjusteEstoque): string => (tipo === 'entrada' ? 'Entrada' : 'Saída');

export const rotuloOrigemAjuste = (origem?: string): string => {
  if (origem === 'materia_prima') return 'Matéria-prima';
  if (origem === 'insumo') return 'Insumo';
  return 'Produto';
};

const dataBr = (valor?: string): string => (valor && /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor.split('-').reverse().join('/') : (valor || ''));

/** "Lote 123 — 31/12/2026", igual a coluna da tela. */
export const loteValidadeAjuste = (a: AjusteDoRelatorio): string => (
  a.lote ? `${a.lote}${a.validade ? ` — ${dataBr(a.validade)}` : ''}` : ''
);

export interface EntradaDocumentoRelatorioAjustes {
  filtrados: AjusteDoRelatorio[];
  filtro: FiltroRelatorioAjustes;
  /** Rotulo do motivo escolhido no filtro (a tela ja tem a lista). */
  rotuloMotivo?: string;
}

export interface DocumentoRelatorioAjustes {
  titulo: string;
  periodo: string;
  filtros: string[];
  indicadores: IndicadorRelatorio[];
  secoes: SecaoRelatorio[];
}

/** Monta o documento (sem empresa/geradoPor, que o RelatorioPreview acrescenta). */
export const montarDocumentoRelatorioAjustes = ({
  filtrados, filtro, rotuloMotivo,
}: EntradaDocumentoRelatorioAjustes): DocumentoRelatorioAjustes => {
  const resumo = resumirAjustes(filtrados);

  const colunas: ColunaRelatorio<AjusteDoRelatorio>[] = [
    { id: 'data', titulo: 'Data', tipo: 'dataHora', valor: (a) => a.data },
    {
      id: 'produto', titulo: 'Produto', tipo: 'texto', largura: 62,
      valor: (a) => {
        const marca = a.origem === 'materia_prima' ? ' — MATÉRIA-PRIMA' : a.origem === 'insumo' ? ' — INSUMO' : '';
        return `${a.produtoNome}${a.produtoCodigo ? ` (${a.produtoCodigo})` : ''}${marca}`;
      },
    },
    { id: 'codigo', titulo: 'Código', tipo: 'texto', largura: 22, padrao: false, valor: (a) => a.produtoCodigo || '' },
    { id: 'origem', titulo: 'Origem', tipo: 'texto', largura: 24, padrao: false, valor: (a) => rotuloOrigemAjuste(a.origem) },
    { id: 'tipo', titulo: 'Tipo', tipo: 'texto', largura: 16, valor: (a) => rotuloTipoAjuste(a.tipo) },
    // Texto porque pode ser fracionada; sem total (entrada e saida no mesmo bolo nao somam).
    { id: 'quantidade', titulo: 'Quantidade', tipo: 'texto', largura: 20, total: 'nenhum', valor: (a) => formatarQuantidadeAjuste(a.quantidade) },
    { id: 'motivo', titulo: 'Motivo', tipo: 'texto', largura: 34, valor: (a) => labelMotivoAjusteEstoque(a.tipo, a.motivo) },
    { id: 'lote', titulo: 'Lote / Validade', tipo: 'texto', largura: 30, valor: loteValidadeAjuste },
    { id: 'usuario', titulo: 'Usuário', tipo: 'texto', largura: 28, valor: (a) => a.usuarioNome },
    { id: 'observacao', titulo: 'Observação', tipo: 'texto', largura: 44, valor: (a) => a.observacao || '' },
  ];

  const filtros: string[] = [];
  if (filtro.tipo !== 'todos') filtros.push(`Tipo: ${rotuloTipoAjuste(filtro.tipo)}`);
  if (filtro.motivo) filtros.push(`Motivo: ${rotuloMotivo || filtro.motivo}`);
  if (filtro.produto.trim()) filtros.push(`Produto: ${filtro.produto.trim()}`);
  if (filtro.usuario) filtros.push(`Usuário: ${filtro.usuario}`);

  return {
    titulo: 'Relatório de Ajustes de Estoque',
    periodo: `De ${formatarDataRelatorio(filtro.inicio)} a ${formatarDataRelatorio(filtro.fim)}`,
    filtros,
    indicadores: [
      { rotulo: 'Total de ajustes', valor: String(resumo.total) },
      { rotulo: 'Total em entradas', valor: formatarQuantidadeAjuste(resumo.totalEntradas) },
      { rotulo: 'Total em saídas', valor: formatarQuantidadeAjuste(resumo.totalSaidas) },
    ],
    secoes: [
      {
        id: 'ajustes', titulo: 'Ajustes', colunas, linhas: filtrados,
        unidade: ['ajuste', 'ajustes'], mensagemVazia: 'Nenhum ajuste encontrado para os filtros selecionados.',
      } as SecaoRelatorio,
    ],
  };
};
