/**
 * AVATAR DE INICIAIS (design de 14/10/2026).
 *
 * Nas listas (Dashboard, Pedidos de Venda, Pedido) o cliente aparece com um
 * quadradinho colorido com as iniciais, como nas previas aprovadas pelo dono.
 * A cor sai do proprio nome: o mesmo cliente tem sempre a mesma cor, em
 * qualquer tela, sem gravar nada no cadastro. As cores em si moram no CSS
 * (.hd-avatar.cor-0 ... cor-5, visualDesktop.css), com versao clara e escura.
 */

export const QUANTIDADE_CORES_AVATAR = 6;

/** Palavras curtas (de, da, do, e) nao entram nas iniciais. */
const TAMANHO_MINIMO_PALAVRA = 3;

export const iniciaisDoNome = (nome: string | null | undefined): string => {
  const limpo = (nome || '').trim();
  if (!limpo) return '?';
  const palavras = limpo.split(/\s+/).filter((palavra) => /[\p{L}\p{N}]/u.test(palavra));
  const longas = palavras.filter((palavra) => palavra.length >= TAMANHO_MINIMO_PALAVRA);
  const usadas = (longas.length ? longas : palavras).slice(0, 2);
  const iniciais = usadas.map((palavra) => palavra.match(/[\p{L}\p{N}]/u)?.[0] || '').join('');
  return (iniciais || limpo[0]).toUpperCase();
};

/** Indice da cor (0 a 5): estavel para o mesmo nome, sem diferenciar maiuscula/minuscula. */
export const corDoAvatar = (nome: string | null | undefined): number => {
  const chave = (nome || '').trim().toUpperCase();
  let soma = 0;
  for (let i = 0; i < chave.length; i += 1) soma = (soma * 31 + chave.charCodeAt(i)) % 1_000_003;
  return soma % QUANTIDADE_CORES_AVATAR;
};
