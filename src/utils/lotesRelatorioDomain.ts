import type { ColunaRelatorio, IndicadorRelatorio, SecaoRelatorio } from './relatorioPdfDomain';
import { ROTULO_ABA_LOTES, ROTULO_SITUACAO_LOTE, contarPorAba, diasParaVencer, pertenceAAba, situacaoDoLote, type AbaDeLotes, type LoteSaldo } from './loteDomain';

/*
 * TELA E RELATORIO "LOTES E VALIDADES" (2026-09-25): saldo por lote, dias para
 * vencer, abas de vencimento (vencidos / 15 / 30 / 45 dias) e busca. Sem
 * escrita: so' leitura de estoque_lotes + nome/codigo do produto. Regra pura.
 */

export interface LoteDoProduto extends LoteSaldo {
  produtoId: string;
  produtoNome: string;
  produtoCodigo: string;
}

const semAcento = (texto: string): string => String(texto ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const dataBr = (iso: string | null | undefined): string => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('/') : '');

/** Lotes da aba escolhida que casam com a busca (produto, codigo ou lote), do que vence primeiro ao ultimo. */
export const lotesDaTela = (lotes: LoteDoProduto[], aba: AbaDeLotes, busca: string, hoje: string): LoteDoProduto[] => {
  const termo = semAcento(busca);
  return lotes
    .filter((l) => pertenceAAba(l, aba, hoje))
    .filter((l) => !termo || semAcento(`${l.produtoNome} ${l.produtoCodigo} ${l.lote}`).includes(termo))
    .sort((a, b) => {
      const da = diasParaVencer(a.validade, hoje);
      const db = diasParaVencer(b.validade, hoje);
      if (da === null && db !== null) return 1;
      if (da !== null && db === null) return -1;
      if (da !== null && db !== null && da !== db) return da - db;
      return a.produtoNome.localeCompare(b.produtoNome, 'pt-BR') || a.lote.localeCompare(b.lote, 'pt-BR', { numeric: true });
    });
};

export const rotuloDosDias = (validade: string | null | undefined, hoje: string): string => {
  const dias = diasParaVencer(validade, hoje);
  if (dias === null) return '';
  if (dias < 0) return `venceu há ${Math.abs(dias)} ${Math.abs(dias) === 1 ? 'dia' : 'dias'}`;
  if (dias === 0) return 'vence hoje';
  return `${dias} ${dias === 1 ? 'dia' : 'dias'}`;
};

const quantidadeBr = (n: number): string => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(Number(n || 0));

export interface DocumentoLotes {
  titulo: string;
  periodo: string;
  filtros: string[];
  indicadores: IndicadorRelatorio[];
  secoes: SecaoRelatorio[];
}

export const montarDocumentoLotes = (lotes: LoteDoProduto[], aba: AbaDeLotes, busca: string, hoje: string): DocumentoLotes => {
  const linhas = lotesDaTela(lotes, aba, busca, hoje);
  const contagem = contarPorAba(lotes, hoje);

  const colunas: ColunaRelatorio<LoteDoProduto>[] = [
    { id: 'produto', titulo: 'Produto', tipo: 'texto', largura: 70, valor: (l) => l.produtoNome },
    { id: 'codigo', titulo: 'Código', tipo: 'texto', largura: 22, padrao: false, valor: (l) => l.produtoCodigo },
    { id: 'lote', titulo: 'Lote', tipo: 'texto', largura: 26, valor: (l) => l.lote },
    { id: 'validade', titulo: 'Validade', tipo: 'texto', largura: 22, valor: (l) => dataBr(l.validade) || 'Sem validade' },
    { id: 'dias', titulo: 'Prazo', tipo: 'texto', largura: 28, valor: (l) => rotuloDosDias(l.validade, hoje) },
    { id: 'saldo', titulo: 'Saldo', tipo: 'texto', largura: 20, valor: (l) => quantidadeBr(l.quantidade) },
    { id: 'situacao', titulo: 'Situação', tipo: 'texto', largura: 36, valor: (l) => ROTULO_SITUACAO_LOTE[situacaoDoLote(l.validade, hoje)] },
  ];

  return {
    titulo: 'Lotes e Validades',
    periodo: `Posição em ${dataBr(hoje)}`,
    filtros: [`Mostrando: ${ROTULO_ABA_LOTES[aba]}`, ...(busca.trim() ? [`Busca: ${busca.trim()}`] : [])],
    indicadores: [
      { rotulo: 'Vencidos', valor: String(contagem.vencidos) },
      { rotulo: 'Vencem em 15 dias', valor: String(contagem.vence_15) },
      { rotulo: 'Vencem em 30 dias', valor: String(contagem.vence_30) },
      { rotulo: 'Vencem em 45 dias', valor: String(contagem.vence_45) },
      { rotulo: 'Lotes listados', valor: String(linhas.length) },
    ],
    secoes: [
      { id: 'lotes', titulo: ROTULO_ABA_LOTES[aba], colunas, linhas, unidade: ['lote', 'lotes'], mensagemVazia: 'Nenhum lote nesta situação.' } as SecaoRelatorio,
    ],
  };
};
