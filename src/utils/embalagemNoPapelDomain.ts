/*
 * EMBALAGEM NO PAPEL DO PEDIDO (26/11/2026, pedido do dono, Embala Minas).
 *
 * O papel saia "QTD 1 · 75,60" para 1 CAIXA com 30 pacotes de 10: o cliente
 * nao sabia quanto estava levando. Agora a linha do item diz a quantidade NA
 * UNIDADE VENDIDA ("1 CX") e, embaixo da descricao, quanto isso da':
 *
 *   1 CX = 30 PCT de 10 UN = 300 UN
 *
 * De onde vem cada parte:
 *  - "1 CX = 30 PCT": a embalagem vendida (CX, fator 30) sobre a unidade do
 *    estoque do produto (PCT);
 *  - "de 10 UN = 300 UN": o CONTEUDO DA UNIDADE, campo do cadastro do produto
 *    (aba Embalagens: "Cada PCT contem 10 UN"). Ele so' informa o papel: nao
 *    mexe em estoque, preco nem nota;
 *  - sem o conteudo, quando o produto tem uma embalagem do meio (a maior
 *    ativa que cabe um numero inteiro de vezes na vendida), ela entra:
 *    estoque em UN, PCT de 10 e CX de 300 -> "1 CX = 30 PCT de 10 UN = 300 UN".
 *
 * Item vendido na unidade do estoque so' ganha linha quando o produto tem o
 * conteudo ("3 PCT de 10 UN = 30 UN"). A unidade do estoque vem do cadastro;
 * sem ela, `UN` (CLAUDE.md, regra 4).
 *
 * Regra pura: sem tela e sem Firestore.
 */
import { normalizeEmbalagens } from './embalagemDomain';
import { UNIDADE_MEDIDA_FALLBACK } from './unidadeMedidaDomain';

export interface ItemComEmbalagem {
  quantidade?: unknown;
  unidadeMedidaSigla?: unknown;
  embalagemId?: unknown;
  fatorConversao?: unknown;
}

export interface ProdutoDoPapel {
  /** Unidade do estoque do produto (a base das embalagens). */
  siglaBase?: unknown;
  /** Campo `embalagens` cru do cadastro. */
  embalagens?: unknown;
  /** Conteudo de 1 unidade do estoque (cadastro do produto): 10 em "cada PCT contem 10 UN". */
  conteudoQuantidade?: unknown;
  /** Unidade do conteudo: UN em "cada PCT contem 10 UN". */
  conteudoSigla?: unknown;
}

/** Campos do cadastro do produto (documento `estoque`). Zero/vazio = sem conteudo. */
export const CAMPO_CONTEUDO_QUANTIDADE = 'conteudoDaUnidadeQuantidade';
export const CAMPO_CONTEUDO_SIGLA = 'conteudoDaUnidadeSigla';

const numero = (valor: unknown): number => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};

const sigla = (valor: unknown): string => String(valor ?? '').trim().toUpperCase();

const siglaPadrao = (): string => UNIDADE_MEDIDA_FALLBACK.unidadeMedidaSigla;

/** 300 -> "300"; 2,5 -> "2,5" (sem casas de sobra). */
const escrito = (n: number): string => (Math.round(n * 1000) / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

const inteiro = (n: number): boolean => Math.abs(n - Math.round(n)) < 1e-9;

/** Quantidade com a unidade em que o item foi vendido: "1 CX", "2,5 KG". */
export const quantidadeComUnidade = (item: ItemComEmbalagem, casasDecimais = 0): string => {
  const qtd = numero(item.quantidade).toLocaleString('pt-BR', { minimumFractionDigits: casasDecimais, maximumFractionDigits: casasDecimais });
  const un = sigla(item.unidadeMedidaSigla) || siglaPadrao();
  return `${qtd} ${un}`;
};

/**
 * Conteudo de 1 unidade do estoque como o cadastro guarda, ou null quando nao
 * ha (quantidade zero/invalida, ou a mesma unidade do estoque: "PCT de 1 PCT").
 */
export const conteudoDaUnidade = (produto: ProdutoDoPapel | null | undefined): { quantidade: number; sigla: string } | null => {
  const quantidade = numero(produto?.conteudoQuantidade);
  if (!(quantidade > 0)) return null;
  const s = sigla(produto?.conteudoSigla) || siglaPadrao();
  const base = sigla(produto?.siglaBase) || siglaPadrao();
  if (s === base) return null;
  return { quantidade, sigla: s };
};

/** O que gravar no cadastro: numero >= 0 e sigla; nunca undefined (CLAUDE.md, regra 3). */
export const conteudoParaGravar = (quantidadeDigitada: unknown, siglaEscolhida: unknown): { quantidade: number; sigla: string } => {
  const cru = String(quantidadeDigitada ?? '').trim().replace(/\s/g, '');
  // '1.000,5' e '10,5' (virgula decimal) ou '10.5' (ponto decimal).
  const texto = cru.includes(',') ? cru.replace(/\./g, '').replace(',', '.') : cru;
  const n = Number(texto);
  const quantidade = Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : 0;
  return { quantidade, sigla: quantidade > 0 ? sigla(siglaEscolhida) || siglaPadrao() : '' };
};

/**
 * "1 CX = 30 PCT de 10 UN = 300 UN", ou '' quando nao ha nada a explicar
 * (item na unidade do estoque e produto sem conteudo).
 */
export const composicaoDaEmbalagemNoPapel = (item: ItemComEmbalagem, produto: ProdutoDoPapel | null | undefined): string => {
  const quantidade = numero(item.quantidade);
  if (!(quantidade > 0)) return '';
  const base = sigla(produto?.siglaBase) || siglaPadrao();
  const conteudo = conteudoDaUnidade(produto);
  const fator = numero(item.fatorConversao);
  const vendida = sigla(item.unidadeMedidaSigla);
  const emEmbalagem = Boolean(String(item.embalagemId ?? '').trim()) && fator > 1 && Boolean(vendida) && vendida !== base;

  if (!emEmbalagem) {
    // Na unidade do estoque: so' com o conteudo ("3 PCT de 10 UN = 30 UN").
    if (!conteudo) return '';
    return `${escrito(quantidade)} ${vendida || base} de ${escrito(conteudo.quantidade)} ${conteudo.sigla} = ${escrito(quantidade * conteudo.quantidade)} ${conteudo.sigla}`;
  }

  const totalBase = quantidade * fator;
  const inicio = `${escrito(quantidade)} ${vendida}`;
  if (conteudo) {
    return `${inicio} = ${escrito(totalBase)} ${base} de ${escrito(conteudo.quantidade)} ${conteudo.sigla} = ${escrito(totalBase * conteudo.quantidade)} ${conteudo.sigla}`;
  }

  const meio = normalizeEmbalagens(produto?.embalagens)
    .filter((e) => e.ativo && e.fatorConversao > 1 && e.fatorConversao < fator && inteiro(fator / e.fatorConversao))
    .filter((e) => e.unidadeMedidaSigla && e.unidadeMedidaSigla.toUpperCase() !== vendida && e.unidadeMedidaSigla.toUpperCase() !== base)
    .sort((a, b) => b.fatorConversao - a.fatorConversao)[0];
  const fim = `${escrito(totalBase)} ${base}`;
  if (!meio) return `${inicio} = ${fim}`;
  return `${inicio} = ${escrito(totalBase / meio.fatorConversao)} ${meio.unidadeMedidaSigla.toUpperCase()} de ${escrito(meio.fatorConversao)} ${base} = ${fim}`;
};
