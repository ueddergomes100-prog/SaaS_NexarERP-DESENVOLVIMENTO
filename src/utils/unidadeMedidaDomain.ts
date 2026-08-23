// Funcoes puras do cadastro de Unidades de Medida. Sem Firestore -- a
// leitura/escrita fica em UnidadesMedidaList.tsx.
//
// Duas responsabilidades: o catalogo padrao que todo tenant recebe, e a
// regra de quando uma unidade pode ser excluida.

import { normalizeEmbalagens } from './embalagemDomain';

export interface UnidadeMedidaPadrao {
  sigla: string;
  nome: string;
  casasDecimais: number;
  permiteFracionado: boolean;
}

/**
 * As 10 unidades que todo tenant recebe ja cadastradas. A lista atende os
 * tres perfis de cliente do sistema: oficina (CJ/PC pra jogo e kit de
 * pecas), distribuidora (CX/PC) e agro (SC/KG/G).
 *
 * UN, KG, LTS e MT mantem a sigla e as casas decimais que o antigo botao
 * "Carregar Padroes" ja usava -- trocar agora criaria uma segunda unidade
 * equivalente (ex: "L" ao lado de "LTS") em todo tenant que ja tinha as
 * antigas.
 */
export const UNIDADES_MEDIDA_PADRAO: UnidadeMedidaPadrao[] = [
  { sigla: 'UN', nome: 'UNIDADE', casasDecimais: 0, permiteFracionado: false },
  { sigla: 'KG', nome: 'QUILOGRAMA', casasDecimais: 3, permiteFracionado: true },
  { sigla: 'G', nome: 'GRAMA', casasDecimais: 0, permiteFracionado: false },
  { sigla: 'LTS', nome: 'LITRO', casasDecimais: 2, permiteFracionado: true },
  { sigla: 'ML', nome: 'MILILITRO', casasDecimais: 0, permiteFracionado: false },
  { sigla: 'MT', nome: 'METRO', casasDecimais: 2, permiteFracionado: true },
  { sigla: 'CX', nome: 'CAIXA', casasDecimais: 0, permiteFracionado: false },
  { sigla: 'PC', nome: 'PACOTE', casasDecimais: 0, permiteFracionado: false },
  { sigla: 'SC', nome: 'SACO', casasDecimais: 0, permiteFracionado: false },
  { sigla: 'CJ', nome: 'CONJUNTO', casasDecimais: 0, permiteFracionado: false },
];

const normalizeSigla = (value: unknown): string => String(value ?? '').trim().toUpperCase();

/** Uma unidade e' padrao pela SIGLA, nao pelo id: tenants antigos criaram
 * UN/KG/LTS/MT a mao (com ids aleatorios) antes de existir a flag isPadrao,
 * e essas tambem precisam ficar protegidas contra exclusao. */
export const isSiglaPadrao = (sigla: unknown): boolean => {
  const alvo = normalizeSigla(sigla);
  return UNIDADES_MEDIDA_PADRAO.some((padrao) => padrao.sigla === alvo);
};

export interface ProdutoUsandoUnidade {
  id?: string;
  nome?: string;
  unidadeMedidaId?: string | null;
  embalagens?: unknown;
}

export interface UnidadeEmUso {
  produtoNome: string;
  /** 'base' = e' a unidade principal do produto; 'embalagem' = e' a unidade
   * de uma embalagem dele. Muda a mensagem mostrada ao usuario. */
  origem: 'base' | 'embalagem';
}

/**
 * Devolve o primeiro produto que usa esta unidade, ou null. Considera os
 * DOIS vinculos possiveis: a unidade principal do produto e a unidade de
 * qualquer embalagem cadastrada nele.
 *
 * Existe porque excluir uma unidade em uso deixa todo produto que a
 * referenciava orfao -- ele passa a cair no fallback 'UN'/0 casas, o que
 * silenciosamente quebra a venda fracionada de um produto vendido em quilo.
 */
export const findUnidadeEmUso = (
  unidadeId: string,
  produtos: ProdutoUsandoUnidade[],
): UnidadeEmUso | null => {
  const alvo = String(unidadeId ?? '').trim();
  if (!alvo) return null;

  for (const produto of produtos) {
    const nome = produto.nome || 'produto sem nome';
    if (String(produto.unidadeMedidaId ?? '').trim() === alvo) {
      return { produtoNome: nome, origem: 'base' };
    }
    const usaEmEmbalagem = normalizeEmbalagens(produto.embalagens)
      .some((embalagem) => embalagem.unidadeMedidaId === alvo);
    if (usaEmEmbalagem) {
      return { produtoNome: nome, origem: 'embalagem' };
    }
  }

  return null;
};
