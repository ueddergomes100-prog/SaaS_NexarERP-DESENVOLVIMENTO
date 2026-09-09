// Funcoes puras da importacao em massa de categorias (grupos, no
// vocabulario do sistema antigo do cliente). Sem Firestore -- leitura de
// arquivo, upload e gravacao ficam em src/pages/Categorias/ImportarCategorias.tsx.
// Leitura de arquivo (encoding/delimitador/parser CSV) e compartilhada com a
// importacao de produtos, ver src/utils/importacaoEstoqueDomain.ts.

export type StatusCategoriaImportada = 'OK' | 'REVISAR';

export type TipoCategoria = 'Peça' | 'Serviço' | 'Matéria-Prima';

export const TIPOS_CATEGORIA: TipoCategoria[] = ['Peça', 'Serviço', 'Matéria-Prima'];

// ---------------------------------------------------------------------------
// Mapeamento de colunas
// ---------------------------------------------------------------------------

export interface MapeamentoColunasCategoria {
  nome: number;
  tipo: number | null;
}

const SINONIMOS_NOME = ['nome', 'categoria', 'grupo', 'descricao'];
const SINONIMOS_TIPO = ['tipo'];

const normalizarTextoComparacao = (valor: string): string => valor
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLowerCase()
  .trim();

export const inferirMapeamentoColunasCategoria = (cabecalho: string[]): MapeamentoColunasCategoria => {
  const normalizados = cabecalho.map(normalizarTextoComparacao);
  const encontrar = (sinonimos: string[]): number => normalizados.findIndex(
    (col) => sinonimos.some((sin) => col.includes(sin)),
  );

  const nome = encontrar(SINONIMOS_NOME);
  const tipo = encontrar(SINONIMOS_TIPO);

  return {
    nome: nome >= 0 ? nome : 0,
    tipo: tipo >= 0 ? tipo : null,
  };
};

/** Reconhece o texto livre da planilha antiga como um dos 3 tipos do
 * sistema -- sinonimo comum ("produto", "peca", "servico", "mp",
 * "materia prima") mapeia direto; qualquer outra coisa cai no default
 * "Peça" (mesmo default que CategoriaForm.tsx usa no cadastro manual). */
export const resolverTipoCategoria = (textoBruto: string): TipoCategoria => {
  const texto = normalizarTextoComparacao(textoBruto);
  if (!texto) return 'Peça';
  if (texto.includes('servi')) return 'Serviço';
  if (texto.includes('materia') || texto === 'mp') return 'Matéria-Prima';
  return 'Peça';
};

// ---------------------------------------------------------------------------
// Linha da planilha processada
// ---------------------------------------------------------------------------

export interface CategoriaImportada {
  /** Identificador estavel da linha -- usado pra reconciliar edicoes do
   * usuario na tela sem depender do nome, que pode repetir. */
  linhaId: number;
  nome: string;
  tipo: TipoCategoria;
  status: StatusCategoriaImportada;
  motivo: string;
}

export const processarLinhasCategorias = (
  linhas: string[][],
  mapeamento: MapeamentoColunasCategoria,
): CategoriaImportada[] => {
  const vistos = new Set<string>();

  return linhas
    .filter((linha) => linha.some((celula) => celula && celula.trim()))
    .map((linha, index) => {
      const nomeBruto = (linha[mapeamento.nome] || '').trim();
      const tipoBruto = mapeamento.tipo !== null ? (linha[mapeamento.tipo] || '').trim() : '';
      const nome = nomeBruto.toUpperCase();
      const chave = normalizarTextoComparacao(nome);

      let status: StatusCategoriaImportada = 'OK';
      let motivo = '';
      if (chave && vistos.has(chave)) {
        status = 'REVISAR';
        motivo = 'Nome repetido em mais de uma linha desta planilha.';
      }
      if (chave) vistos.add(chave);

      return {
        linhaId: index,
        nome,
        tipo: resolverTipoCategoria(tipoBruto),
        status,
        motivo,
      };
    })
    .filter((item) => item.nome);
};

// ---------------------------------------------------------------------------
// Montagem da categoria final (mesma forma que CategoriaForm.tsx grava)
// ---------------------------------------------------------------------------

export const montarCategoriaImportada = (
  categoria: { nome: string; tipo: TipoCategoria },
  tenantId: string,
  userId: string,
  timestamp: unknown,
): Record<string, unknown> => ({
  nome: categoria.nome.toUpperCase().trim(),
  tipo: categoria.tipo,
  tenantId,
  createdAt: timestamp,
  criadoPor: userId,
  criadoEm: timestamp,
  alteradoPor: userId,
  alteradoEm: timestamp,
  origemImportacao: 'migracao_cadastro',
});
