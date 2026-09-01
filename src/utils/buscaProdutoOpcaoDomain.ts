import { normalizeSearchText, splitSearchTerms } from './textSearch';

/**
 * Regras da linha de produto na busca (autocomplete e popup "Ver mais").
 *
 * Ficam aqui, fora do componente, por dois motivos: sao as unicas partes com
 * decisao de verdade -- o resto e' marcacao -- e assim dao pra testar sem
 * montar React.
 */

/**
 * Ate quantas unidades o estoque conta como BAIXO.
 *
 * O numero nao e' novo: a tela de Estoque ja usava `< 5` no cartao "Estoque
 * Baixo", so que escrito solto no meio do JSX. Trazer pra ca faz a busca e a
 * lista de Estoque contarem a mesma coisa -- antes um produto podia aparecer
 * como "baixo" num lugar e verde no outro sem ninguem entender por que.
 */
export const ESTOQUE_BAIXO_ATE = 5;

export type NivelEstoque = 'zerado' | 'baixo' | 'ok';

/**
 * Tres estados, nao dois.
 *
 * Antes a linha so distinguia verde (tem) de vermelho (zerado). "Baixo" e' o
 * unico dos tres em que ainda da pra fazer alguma coisa -- repor antes de
 * faltar --, e era justamente o que nao aparecia.
 *
 * Quantidade invalida ou ausente conta como zerada: produto sem estoque
 * confiavel nao pode aparecer verde na tela de quem esta vendendo.
 */
export const nivelDeEstoque = (quantidade: unknown): NivelEstoque => {
  const valor = Number(quantidade);
  if (!Number.isFinite(valor) || valor <= 0) return 'zerado';
  return valor < ESTOQUE_BAIXO_ATE ? 'baixo' : 'ok';
};

export interface TrechoDestacado {
  texto: string;
  destaque: boolean;
}

/**
 * Quebra o nome do produto marcando os pedacos que casaram com a busca.
 *
 * Serve pra quem digitou "racao+20kg" enxergar ONDE bateu, num catalogo em
 * que os nomes comecam todos igual ("RACAO QUATREE GOURMET...").
 *
 * A comparacao ignora acento, como o resto da busca. Isso exige comparar o
 * texto normalizado e devolver os pedacos do texto ORIGINAL, o que so vale
 * enquanto normalizar nao muda o tamanho da string. Quando muda (caractere
 * fora do previsto), a funcao devolve o nome inteiro sem destaque -- errar o
 * recorte e' pior que nao destacar, porque cortaria letra no meio da palavra.
 */
export const destacarTrechosDaBusca = (texto: unknown, termo: unknown): TrechoDestacado[] => {
  const original = String(texto ?? '');
  if (!original) return [];

  const termos = splitSearchTerms(termo)
    .map((parte) => normalizeSearchText(parte))
    .filter((parte) => parte.length > 0);
  if (termos.length === 0) return [{ texto: original, destaque: false }];

  const normalizado = normalizeSearchText(original);
  if (normalizado.length !== original.length) return [{ texto: original, destaque: false }];

  // Marca posicao a posicao: termos podem se sobrepor ("rac" e "racao"), e
  // somar intervalos soltos daria destaque duplicado no mesmo pedaco.
  const marcado = new Array<boolean>(original.length).fill(false);
  for (const parte of termos) {
    let de = normalizado.indexOf(parte);
    while (de !== -1) {
      for (let i = de; i < de + parte.length; i += 1) marcado[i] = true;
      de = normalizado.indexOf(parte, de + 1);
    }
  }

  const trechos: TrechoDestacado[] = [];
  for (let i = 0; i < original.length; i += 1) {
    const ultimo = trechos[trechos.length - 1];
    if (ultimo && ultimo.destaque === marcado[i]) {
      ultimo.texto += original[i];
    } else {
      trechos.push({ texto: original[i], destaque: marcado[i] });
    }
  }

  return trechos;
};
