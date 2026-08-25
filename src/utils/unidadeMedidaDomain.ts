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

// ---------------------------------------------------------------------------
// Fallback 'UN' para produto com cadastro de unidade incompleto
// ---------------------------------------------------------------------------
//
// REGRA DE NEGOCIO (decisao do dono do produto, 2026-08-24):
//
//   Item que chega sem unidade de medida preenchida NAO faz o sistema mudar
//   de comportamento. Ele e' completado com a unidade padrao 'UN' e o fluxo
//   segue normal -- venda, OS, orcamento e pedido salvam igual.
//
// O que isso NAO e': nao e' o sistema "se adaptando" a um cadastro incompleto,
// nem contornando validacao. Nenhuma regra de venda, estoque ou fiscal muda
// por causa disso. O que acontece e' so o preenchimento do campo que faltou,
// com o mesmo padrao que o cadastro de produto (EstoqueForm.tsx) ja grava
// quando o usuario nao escolhe unidade nenhuma.
//
// De onde vem produto sem unidade (as duas unicas origens):
//   1. Produto legado, cadastrado antes da feature de unidade de medida;
//   2. Produto criado pelo cadastro rapido dentro da OS, que grava o produto
//      sem passar pela tela de Estoque.
//
// Motivo tecnico de existir um lugar so pra isso: antes, cada tela copiava
// `unidadeMedidaSigla: doc.data().unidadeMedidaSigla` cru. Produto sem o
// campo virava a chave com valor `undefined`, que o Firestore recusa no
// save -- "Unsupported field value: undefined (found in document
// ordens_de_servico/...)". Era o erro que estourava ao salvar OS nova com
// peca legada.
//
// ATENCAO ao mexer: 'UN' nao e' neutro. Ele significa produto unitario e
// NAO fracionavel, e a sigla vai pra nota fiscal. Produto que na vida real
// e' vendido em KG/LTS e chegar aqui sem cadastro vai ser tratado como
// unitario ate alguem corrigir o cadastro dele no Estoque. O fallback existe
// pra nao travar a operacao, nao pra substituir o cadastro correto.

/** Os tres campos de unidade que todo item vendido carrega desnormalizados. */
export interface UnidadeMedidaProduto {
  unidadeMedidaSigla: string;
  unidadeMedidaFracionado: boolean;
  unidadeMedidaCasasDecimais: number;
}

/** Unidade atribuida a produto sem cadastro de unidade. Mesmos valores que
 * EstoqueForm.tsx grava quando nenhuma unidade e' selecionada. */
export const UNIDADE_MEDIDA_FALLBACK: UnidadeMedidaProduto = {
  unidadeMedidaSigla: 'UN',
  unidadeMedidaFracionado: false,
  unidadeMedidaCasasDecimais: 0,
};

interface FonteUnidadeMedida {
  unidadeMedidaSigla?: unknown;
  unidadeMedidaFracionado?: unknown;
  unidadeMedidaCasasDecimais?: unknown;
}

/**
 * Le os tres campos de unidade de um produto/item e devolve todos preenchidos,
 * caindo em UNIDADE_MEDIDA_FALLBACK ('UN') no que faltar. Sempre devolve os
 * tres com valor concreto -- nunca `undefined`, que o Firestore recusa.
 *
 * Usar em TODO ponto onde produto do estoque vira item de venda/OS/orcamento
 * (leitura do catalogo e carga de documento antigo), pra que o item ja nasca
 * completo em vez de cada tela tratar o buraco do seu jeito.
 *
 * `fracionado` so fica true quando o cadastro diz explicitamente `true`:
 * campo ausente significa "nao fracionavel", mesma leitura que
 * isValidSaleQuantity() ja faz em saleQuantity.ts.
 */
export const resolveUnidadeMedidaProduto = (
  fonte: FonteUnidadeMedida | null | undefined,
): UnidadeMedidaProduto => {
  const sigla = normalizeSigla(fonte?.unidadeMedidaSigla);
  const casasDecimais = Number(fonte?.unidadeMedidaCasasDecimais);
  return {
    unidadeMedidaSigla: sigla || UNIDADE_MEDIDA_FALLBACK.unidadeMedidaSigla,
    unidadeMedidaFracionado: fonte?.unidadeMedidaFracionado === true,
    unidadeMedidaCasasDecimais: Number.isFinite(casasDecimais) && casasDecimais > 0
      ? casasDecimais
      : UNIDADE_MEDIDA_FALLBACK.unidadeMedidaCasasDecimais,
  };
};

/**
 * True quando o produto TEM unidade de medida cadastrada de verdade.
 *
 * Existe pra separar as duas situacoes que resolveUnidadeMedidaProduto()
 * trata igual: produto cadastrado como 'UN' de propósito e produto que caiu
 * em 'UN' por falta de cadastro. A tela usa isso pra avisar o usuario --
 * em portugues, na hora -- que aquele item entrou com a unidade padrao e o
 * cadastro dele precisa ser corrigido no Estoque.
 *
 * So a sigla decide. Um produto com sigla mas sem casasDecimais/fracionado
 * (cadastro parcial de versao antiga) conta como cadastrado: os outros dois
 * campos tem padrao natural (0 casas, nao fracionavel) e nao mudam o que o
 * usuario ve na tela nem o que sai na nota.
 */
export const temUnidadeMedidaCadastrada = (
  fonte: FonteUnidadeMedida | null | undefined,
): boolean => normalizeSigla(fonte?.unidadeMedidaSigla).length > 0;

/** Texto unico do aviso de unidade ausente, pra mensagem nao divergir entre
 * OS, Orcamento e demais telas que vendem produto. */
export const avisoUnidadeMedidaAusente = (nomeProduto: string): { title: string; text: string } => ({
  title: `"${nomeProduto}" está sem unidade de medida`,
  text: `Esta peça não tem unidade de medida cadastrada. Ela entrou como ${UNIDADE_MEDIDA_FALLBACK.unidadeMedidaSigla} (unidade, sem venda fracionada). Para corrigir, edite o produto em Estoque e informe a unidade certa.`,
});
