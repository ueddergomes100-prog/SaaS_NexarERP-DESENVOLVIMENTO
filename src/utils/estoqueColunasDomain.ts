/**
 * LISTA DE ESTOQUE: COLUNAS QUE A EMPRESA ESCOLHE E ORDEM PELO CABECALHO
 * (17/11/2026, pedido do dono: "o cliente nao quer que apareca categoria
 * nessa aba; personalizar o que aparece e o que nao aparece"; "clicar em
 * codigo reorganiza pelo codigo, clicar em nome reorganiza por alfabetica").
 *
 * As colunas escondidas ficam em `configuracoes/{filial}.colunasOcultasEstoque`
 * (vale para todos os usuarios da filial, como mostrarResumoEstoque). Nome do
 * produto e Acoes aparecem sempre.
 */

/** vista (21/11/2026, redesenho da lista). Custo e margem NAO entram na lista
 * (decisao do dono, 21/11/2026): ficam so' dentro do cadastro do produto. */
export type ColunaOpcionalEstoque = 'codigo' | 'categoria' | 'quantidade' | 'reservado' | 'disponivel' | 'preco' | 'vista' | 'status' | 'ativo';

export const COLUNAS_OPCIONAIS_ESTOQUE: ReadonlyArray<{ chave: ColunaOpcionalEstoque; rotulo: string }> = [
  { chave: 'codigo', rotulo: 'Código / SKU' },
  { chave: 'categoria', rotulo: 'Categoria' },
  { chave: 'quantidade', rotulo: 'Qtd.' },
  { chave: 'reservado', rotulo: 'Reservado' },
  { chave: 'disponivel', rotulo: 'Disponível' },
  { chave: 'preco', rotulo: 'Preço de venda' },
  { chave: 'vista', rotulo: 'Preço à vista' },
  { chave: 'status', rotulo: 'Status' },
  { chave: 'ativo', rotulo: 'Ativo' },
];

const CHAVES = new Set<string>(COLUNAS_OPCIONAIS_ESTOQUE.map((c) => c.chave));

/** Valor gravado -> lista valida (lixo e coluna desconhecida ficam de fora). */
export const parseColunasOcultasEstoque = (valor: unknown): ColunaOpcionalEstoque[] => (
  Array.isArray(valor) ? [...new Set(valor.filter((v): v is ColunaOpcionalEstoque => typeof v === 'string' && CHAVES.has(v)))] : []
);

const numeroDoCodigo = (codigo: unknown): number => {
  const n = Number.parseFloat(String(codigo ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
};

/**
 * Ordem da lista: pelo nome (A-Z, acento nao conta) ou pelo codigo como
 * NUMERO (2 antes de 10; variacao "12.01" logo depois do 12). Empate: o outro campo.
 */
export const compararPelaOrdem = (
  a: { nome?: unknown; codigo?: unknown },
  b: { nome?: unknown; codigo?: unknown },
  campo: 'nome' | 'codigo',
  desc: boolean,
): number => {
  const porNome = String(a.nome ?? '').localeCompare(String(b.nome ?? ''), 'pt-BR', { sensitivity: 'base' });
  const ca = numeroDoCodigo(a.codigo);
  const cb = numeroDoCodigo(b.codigo);
  const porCodigo = ca === cb ? String(a.codigo ?? '').localeCompare(String(b.codigo ?? '')) : (ca < cb ? -1 : 1);
  const resultado = campo === 'codigo' ? (porCodigo || porNome) : (porNome || porCodigo);
  return desc ? -resultado : resultado;
};
