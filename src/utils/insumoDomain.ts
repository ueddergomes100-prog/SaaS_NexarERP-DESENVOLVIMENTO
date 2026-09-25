import { toCents } from './financeDomain';
import type { ColunaRelatorio, IndicadorRelatorio, SecaoRelatorio } from './relatorioPdfDomain';

/*
 * INSUMOS (2026-09-25): material de CONSUMO da empresa -- caixa, fita, etiqueta,
 * produto de limpeza, EPI. Decisao do dono: cadastro proprio, separado de
 * Estoque (nao e' vendido) e de Materia-Prima (nao entra na receita/custo de
 * nenhum produto acabado). Entra pela Entrada de NF-e, com saldo, custo medio
 * e ajuste manual, mas nunca aparece em venda, PDV, orcamento ou producao.
 *
 * Regra pura: sem Firestore, testavel.
 */

export interface InsumoDoCadastro {
  id: string;
  codigo?: string;
  nome: string;
  categoria?: string;
  unidade?: string;
  quantidade?: number;
  estoqueMinimo?: number;
  precoCusto?: number;
  custoMedio?: number;
  fornecedor?: string;
  observacao?: string;
  ativo?: boolean;
}

export interface FormularioDoInsumo {
  codigo: string;
  nome: string;
  unidade: string;
  estoqueMinimo: string;
  precoCusto: string;
  quantidade: string;
  fornecedor: string;
  observacao: string;
}

const semAcento = (texto: string): string => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Numero digitado na tela ("1.234,56" ou "1234.56"); vazio vale 0; invalido vira NaN. */
export const numeroDoInsumo = (texto: string): number => {
  const limpo = String(texto ?? '').trim();
  if (!limpo) return 0;
  const normalizado = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
  return Number(normalizado);
};

/** Mensagem em portugues quando o cadastro nao pode ser salvo; null quando esta ok. */
export const erroDoInsumo = (
  form: FormularioDoInsumo,
  existentes: InsumoDoCadastro[],
  editandoId: string | null,
): string | null => {
  if (!form.nome.trim()) return 'Informe o nome do insumo (por exemplo: Caixa de papelão 30x20).';
  if (!form.unidade.trim()) return 'Informe a unidade do insumo (por exemplo: UN, CX, KG, ROLO).';
  const nome = semAcento(form.nome);
  const repetido = existentes.find((i) => i.id !== editandoId && semAcento(i.nome) === nome);
  if (repetido) return `Já existe um insumo chamado "${repetido.nome}". Edite o existente em vez de cadastrar outro.`;
  const codigo = form.codigo.trim().toLowerCase();
  if (codigo) {
    const mesmoCodigo = existentes.find((i) => i.id !== editandoId && String(i.codigo || '').trim().toLowerCase() === codigo);
    if (mesmoCodigo) return `O código "${form.codigo.trim()}" já é do insumo "${mesmoCodigo.nome}". Use outro código.`;
  }
  for (const [rotulo, texto] of [['estoque mínimo', form.estoqueMinimo], ['custo', form.precoCusto], ['quantidade em estoque', form.quantidade]] as const) {
    const numero = numeroDoInsumo(texto);
    if (!Number.isFinite(numero) || numero < 0) return `O ${rotulo} precisa ser um número igual ou maior que zero.`;
  }
  return null;
};

const custoDoInsumo = (i: InsumoDoCadastro): number => Number(i.custoMedio ?? i.precoCusto ?? 0) || 0;

/** Valor parado em estoque, em centavos (quantidade x custo medio). */
export const valorEmEstoqueCentavos = (i: InsumoDoCadastro): number => toCents(Math.max(0, Number(i.quantidade || 0)) * custoDoInsumo(i));

export const abaixoDoMinimo = (i: InsumoDoCadastro): boolean => Number(i.estoqueMinimo || 0) > 0 && Number(i.quantidade || 0) <= Number(i.estoqueMinimo || 0);

export interface FiltroRelatorioInsumos {
  /** 'ativos' | 'todos' | 'abaixo_minimo' */
  situacao: 'ativos' | 'todos' | 'abaixo_minimo';
}

export const insumosDoRelatorio = (insumos: InsumoDoCadastro[], filtro: FiltroRelatorioInsumos): InsumoDoCadastro[] => (
  insumos
    .filter((i) => (filtro.situacao === 'todos' ? true : i.ativo !== false))
    .filter((i) => (filtro.situacao === 'abaixo_minimo' ? abaixoDoMinimo(i) : true))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
);

const quantidadeBr = (n: number | undefined): string => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(Number(n || 0));

const moeda = (centavos: number): string => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(centavos / 100);

export interface DocumentoInsumos {
  titulo: string;
  periodo: string;
  filtros: string[];
  indicadores: IndicadorRelatorio[];
  secoes: SecaoRelatorio[];
}

/** Documento (sem empresa/geradoPor, que a tela acrescenta) para o RelatorioPreview. */
export const montarDocumentoInsumos = (insumos: InsumoDoCadastro[], filtro: FiltroRelatorioInsumos, dataHoje: string): DocumentoInsumos => {
  const lista = insumosDoRelatorio(insumos, filtro);
  const total = lista.reduce((soma, i) => soma + valorEmEstoqueCentavos(i), 0);
  const abaixo = lista.filter(abaixoDoMinimo).length;

  const colunas: ColunaRelatorio<InsumoDoCadastro>[] = [
    { id: 'codigo', titulo: 'Código', tipo: 'texto', largura: 20, valor: (i) => i.codigo || '' },
    { id: 'nome', titulo: 'Insumo', tipo: 'texto', largura: 62, valor: (i) => i.nome },
    { id: 'unidade', titulo: 'Un.', tipo: 'texto', largura: 12, valor: (i) => i.unidade || '' },
    { id: 'quantidade', titulo: 'Em estoque', tipo: 'texto', largura: 22, valor: (i) => quantidadeBr(i.quantidade) },
    { id: 'minimo', titulo: 'Mínimo', tipo: 'texto', largura: 18, padrao: false, valor: (i) => quantidadeBr(i.estoqueMinimo) },
    { id: 'custo', titulo: 'Custo médio', tipo: 'moeda', valor: (i) => toCents(custoDoInsumo(i)) },
    { id: 'valor', titulo: 'Valor em estoque', tipo: 'moeda', valor: valorEmEstoqueCentavos },
    { id: 'fornecedor', titulo: 'Fornecedor', tipo: 'texto', largura: 34, padrao: false, valor: (i) => i.fornecedor || '' },
    { id: 'situacao', titulo: 'Situação', tipo: 'texto', largura: 22, valor: (i) => (abaixoDoMinimo(i) ? 'Abaixo do mínimo' : (i.ativo === false ? 'Inativo' : 'Ok')) },
  ];

  const filtros: string[] = [];
  if (filtro.situacao === 'abaixo_minimo') filtros.push('Somente abaixo do estoque mínimo');
  if (filtro.situacao === 'todos') filtros.push('Inclui insumos inativos');

  return {
    titulo: 'Estoque de Insumos',
    periodo: `Posição em ${dataHoje.split('-').reverse().join('/')}`,
    filtros,
    indicadores: [
      { rotulo: 'Insumos', valor: String(lista.length) },
      { rotulo: 'Valor em estoque', valor: moeda(total) },
      { rotulo: 'Abaixo do mínimo', valor: String(abaixo) },
    ],
    secoes: [
      { id: 'insumos', titulo: 'Insumos', colunas, linhas: lista, unidade: ['insumo', 'insumos'], mensagemVazia: 'Nenhum insumo com esses filtros.' } as SecaoRelatorio,
    ],
  };
};
