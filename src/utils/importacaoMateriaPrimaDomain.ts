// Funcoes puras da importacao em massa de materia-prima. Sem Firestore --
// leitura de arquivo, upload e gravacao ficam em
// src/pages/Producao/ImportarMateriasPrimas.tsx.
//
// Mais simples que a de Estoque (importacaoEstoqueDomain.ts): materia-prima
// nao tem embalagem, nao tem "vender por unidade diferente", e a unidade
// aqui e' so um campo de texto livre (nao um vinculo pra colecao
// unidades_medida). Reaproveita de importacaoEstoqueDomain.ts o que ja' e'
// generico (leitura de arquivo e parser de numero de export estruturado),
// pra nao duplicar logica ja testada.

import { parseNumeroExportado } from './importacaoEstoqueDomain';
import { buildDocumentMetadata } from './documentMetadata';

export {
  decodificarArquivoTexto,
  detectarDelimitador,
  parseDelimitedText,
} from './importacaoEstoqueDomain';

// ---------------------------------------------------------------------------
// Mapeamento de colunas
// ---------------------------------------------------------------------------

export type CampoColunaMateriaPrima = 'codigo' | 'descricao' | 'quantidade' | 'unidade' | 'custo' | 'marca' | 'referencia';

/** descricao/quantidade sempre tem uma coluna (mesmo que seja um chute
 * errado); os demais sao opcionais. */
export interface MapeamentoColunasMateriaPrima {
  codigo: number | null;
  descricao: number;
  quantidade: number;
  unidade: number | null;
  custo: number | null;
  marca: number | null;
  referencia: number | null;
}

const SINONIMOS: Record<CampoColunaMateriaPrima, string[]> = {
  codigo: ['matric', 'cod. interno', 'codigo interno', 'cod', 'codigo'],
  descricao: ['descricao', 'descr', 'produto', 'nome', 'item'],
  quantidade: ['quantidade', 'quant', 'qtd', 'qtde'],
  unidade: ['unidade', 'und', 'un.', 'medida'],
  custo: ['vr custo', 'valor custo', 'custo'],
  marca: ['marca'],
  referencia: ['referencia', 'ref.', 'ref'],
};

const normalizarTextoComparacao = (valor: string): string => valor
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLowerCase()
  .trim();

/** Mesma logica de exato-primeiro-depois-substring de importacaoEstoqueDomain.ts
 * -- ver o comentario la' pro porque (planilha real traz "Valor Custo" E
 * "Vr Custo" juntas, e um sinonimo generico nao pode roubar a coluna certa
 * so por aparecer antes na planilha). */
export const inferirMapeamentoColunasMateriaPrima = (cabecalho: string[]): MapeamentoColunasMateriaPrima => {
  const normalizados = cabecalho.map(normalizarTextoComparacao);

  const encontrar = (campo: CampoColunaMateriaPrima, evitar: number[] = []): number => {
    const sinonimos = SINONIMOS[campo];
    for (const sin of sinonimos) {
      const idx = normalizados.findIndex((col, i) => !evitar.includes(i) && col === sin);
      if (idx >= 0) return idx;
    }
    for (const sin of sinonimos) {
      const idx = normalizados.findIndex((col, i) => !evitar.includes(i) && col.includes(sin));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const descricao = encontrar('descricao');
  const quantidade = encontrar('quantidade');
  const unidade = encontrar('unidade');
  const custo = encontrar('custo');
  const marca = encontrar('marca');
  const referencia = encontrar('referencia');
  const codigo = encontrar('codigo', referencia >= 0 ? [referencia] : []);

  return {
    codigo: codigo >= 0 ? codigo : null,
    descricao: descricao >= 0 ? descricao : 0,
    quantidade: quantidade >= 0 ? quantidade : 1,
    unidade: unidade >= 0 ? unidade : null,
    custo: custo >= 0 ? custo : null,
    marca: marca >= 0 ? marca : null,
    referencia: referencia >= 0 ? referencia : null,
  };
};

// ---------------------------------------------------------------------------
// Linha da planilha processada
// ---------------------------------------------------------------------------

export type StatusItemImportado = 'OK' | 'REVISAR';

export interface ItemMateriaPrimaImportado {
  linhaId: number;
  codigoOriginal: string;
  descricao: string;
  quantidadeBruta: string;
  quantidade: number | null;
  unidade: string;
  custo: number | null;
  marca: string;
  referencia: string;
  status: StatusItemImportado;
  motivo: string;
}

/** Numero de custo -- tenta primeiro como numero "limpo" de export
 * estruturado (ponto decimal), so cai pro formato R$/virgula brasileira
 * quando esse nao bate. Mesma logica de parseNumeroOuMonetario em
 * importacaoEstoqueDomain.ts, duplicada aqui pra nao exportar uma funcao
 * privada so pra isso -- e' um literal de 3 linhas. */
const parseCusto = (bruto: string | undefined): number | null => {
  const limpo = (bruto || '').trim();
  if (!limpo) return null;
  const direto = parseNumeroExportado(limpo);
  if (direto !== null) return direto;
  const semMoeda = limpo.replace(/r\$\s*/i, '').replace(/\s/g, '');
  const numero = Number(semMoeda.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(numero) ? numero : null;
};

export const processarLinhasMateriaPrima = (
  linhas: string[][],
  mapeamento: MapeamentoColunasMateriaPrima,
): ItemMateriaPrimaImportado[] => linhas
  .filter((linha) => linha.some((celula) => celula && celula.trim()))
  .map((linha, index) => {
    const descricao = (linha[mapeamento.descricao] || '').trim();
    const quantidadeBruta = (linha[mapeamento.quantidade] || '').trim();
    const quantidade = parseNumeroExportado(quantidadeBruta);

    let status: StatusItemImportado = 'OK';
    let motivo = '';
    if (!quantidadeBruta) {
      status = 'REVISAR';
      motivo = 'Quantidade em branco';
    } else if (quantidade === null) {
      status = 'REVISAR';
      motivo = `Não foi possível interpretar "${quantidadeBruta}" como número`;
    }

    return {
      linhaId: index,
      codigoOriginal: mapeamento.codigo !== null ? (linha[mapeamento.codigo] || '').trim() : '',
      descricao,
      quantidadeBruta,
      quantidade,
      unidade: mapeamento.unidade !== null ? (linha[mapeamento.unidade] || '').trim().toUpperCase() : '',
      custo: mapeamento.custo !== null ? parseCusto(linha[mapeamento.custo]) : null,
      marca: mapeamento.marca !== null ? (linha[mapeamento.marca] || '').trim() : '',
      referencia: mapeamento.referencia !== null ? (linha[mapeamento.referencia] || '').trim() : '',
      status,
      motivo,
    };
  })
  .filter((item) => item.descricao);

// ---------------------------------------------------------------------------
// Montagem do documento final (mesma forma que MateriaPrimaForm.tsx grava)
// ---------------------------------------------------------------------------

export interface MateriaPrimaParaImportar {
  /** Sempre a sequencia PROPRIA do sistema (1, 2, 3...), nunca o codigo da
   * planilha do cliente -- mesma decisao ja tomada pra Estoque/Cliente/
   * Fornecedor. O codigo original do cliente fica so como referencia
   * (ItemMateriaPrimaImportado.codigoOriginal). */
  codigo: string;
  nome: string;
  categoria: string;
  unidade: string;
  quantidade: number;
  precoCusto?: number;
  marca?: string;
  referencia?: string;
}

export const montarMateriaPrimaImportada = (
  item: MateriaPrimaParaImportar,
  tenantId: string,
  userId: string,
  timestamp: unknown,
): Record<string, unknown> => ({
  codigo: item.codigo,
  nome: item.nome.toUpperCase().trim(),
  categoria: item.categoria.toUpperCase().trim(),
  unidade: (item.unidade || 'UN').toUpperCase().trim(),
  quantidade: item.quantidade,
  estoqueMinimo: 0,
  precoCusto: item.precoCusto ?? 0,
  fornecedor: '',
  lote: '',
  validade: '',
  marca: item.marca?.toUpperCase().trim() || '',
  referencia: item.referencia?.toUpperCase().trim() || '',
  tenantId,
  createdAt: timestamp,
  ...buildDocumentMetadata(userId, timestamp),
  origemImportacao: 'planilha_sistema_antigo',
});
