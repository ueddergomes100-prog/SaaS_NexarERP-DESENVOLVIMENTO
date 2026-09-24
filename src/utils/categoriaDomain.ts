/*
 * CATEGORIA INATIVA NAO APARECE NA ESCOLHA DO CADASTRO (pedido do dono,
 * 2026-09-24, implantacao da Sol Life).
 *
 * Categoria inativada em Cadastros > Categorias continuava na lista do
 * cadastro de produto, e o operador escolhia uma categoria que a empresa ja
 * tinha desligado. Agora a lista so' traz as ativas.
 *
 * EXCECAO deliberada: produto que JA esta numa categoria inativa continua
 * mostrando essa categoria (marcada "(inativa)") ate' alguem trocar. Se ela
 * sumisse da lista, o <select> cairia silenciosamente na primeira categoria
 * e o proximo "Salvar" mudaria a categoria do produto sem ninguem pedir.
 */

export interface CategoriaCadastrada {
  nome?: unknown;
  ativo?: unknown;
  tipo?: unknown;
}

export interface CategoriasParaEscolha {
  ativas: string[];
  inativas: string[];
}

/** Separa ativas e inativas de um tipo de cadastro. `ativo` ausente = ativa (registro antigo). */
export const separarCategoriasPorSituacao = (
  categorias: CategoriaCadastrada[],
  tipoAceito: (tipo: string) => boolean,
): CategoriasParaEscolha => {
  const ativas: string[] = [];
  const inativas: string[] = [];
  categorias.forEach((categoria) => {
    const nome = String(categoria.nome ?? '').trim();
    if (!nome || !tipoAceito(String(categoria.tipo ?? ''))) return;
    const destino = categoria.ativo === false ? inativas : ativas;
    if (!destino.includes(nome)) destino.push(nome);
  });
  return { ativas, inativas };
};

export interface OpcaoCategoria {
  valor: string;
  rotulo: string;
}

/** Opcoes do select: as ativas e, se preciso, a categoria atual do produto (marcada quando inativa). */
export const opcoesDeCategoria = (categorias: CategoriasParaEscolha, atual: string): OpcaoCategoria[] => {
  const opcoes = categorias.ativas.map((nome) => ({ valor: nome, rotulo: nome }));
  const nomeAtual = String(atual ?? '').trim();
  if (nomeAtual && !categorias.ativas.includes(nomeAtual)) {
    opcoes.push({
      valor: nomeAtual,
      rotulo: categorias.inativas.includes(nomeAtual) ? `${nomeAtual} (inativa)` : nomeAtual,
    });
  }
  return opcoes;
};
