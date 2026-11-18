/**
 * CURSOR NO LUGAR QUANDO O CAMPO TROCA A CAIXA DA LETRA (18/11/2026).
 *
 * Reclamacao do dono: "quando digita uma letra em qualquer campo, o sistema
 * esta indo com o cursor la pro final".
 *
 * O QUE ACONTECIA. Os campos de cadastro gravam em CAIXA ALTA na digitacao
 * (ver textoCadastroDomain.ts). A pessoa digita "x" no meio de "CANETA AZUL";
 * o navegador poe "CANETAx AZUL" no campo; a tela devolve "CANETAX AZUL". Como
 * o texto que a tela manda e' diferente do que esta' no campo, o navegador
 * reescreve o campo inteiro -- e todo campo reescrito por programa fica com o
 * cursor no FIM. A letra seguinte ja' saia no fim do texto. Com o Caps Lock
 * ligado nao acontecia, porque a letra ja' chegava maiuscula e nada era
 * reescrito. Corrigir o meio de um nome ou de uma descricao virava apagar tudo.
 *
 * A CORRECAO E' UMA SO', PARA O SISTEMA TODO. A troca de caixa esta' em mais
 * de 130 pontos de dezenas de telas (aplicarCaixaAltaCadastro e toUpperCase
 * direto no onChange). Em vez de mexer em cada um -- e esquecer o proximo campo
 * novo --, a janela anota onde o cursor estava ANTES de a tela reescrever o
 * campo e o devolve para la' DEPOIS.
 *
 * So' age no caso exato do defeito (ver posicaoParaRestaurar): o texto mudou
 * APENAS de caixa e o cursor foi jogado para o fim. Mascara de CPF, telefone,
 * valor e data mudam o texto de outro jeito e continuam cuidando do proprio
 * cursor.
 */

export interface EstadoDoCampo {
  valor: string;
  /** null em campo que nao tem selecao de texto (numero, e-mail, data...). */
  inicio: number | null;
  fim: number | null;
}

/**
 * Para onde o cursor deve voltar, ou null quando nao e' o caso de mexer.
 * `antes`: o campo logo depois da tecla; `depois`: o campo depois que a tela
 * reescreveu o valor.
 */
export const posicaoParaRestaurar = (antes: EstadoDoCampo, depois: EstadoDoCampo): { inicio: number; fim: number } | null => {
  if (antes.inicio === null || antes.fim === null) return null;
  // A tela nao reescreveu nada: o cursor ja' esta' onde a pessoa deixou.
  if (depois.valor === antes.valor) return null;
  // Mudou de tamanho ("ß" vira "SS") ou mudou mais do que a caixa (mascara,
  // limpeza de caracteres): a posicao antiga nao vale mais.
  if (depois.valor.length !== antes.valor.length) return null;
  if (depois.valor.toLowerCase() !== antes.valor.toLowerCase()) return null;
  // Ja' estava digitando no fim: nao ha' o que devolver.
  if (antes.inicio >= antes.valor.length) return null;
  // So' corrige o defeito de verdade: cursor jogado para o fim.
  if (depois.inicio !== depois.valor.length || depois.fim !== depois.valor.length) return null;
  return { inicio: antes.inicio, fim: antes.fim };
};

type CampoDeTexto = HTMLInputElement | HTMLTextAreaElement;

const lerCampo = (campo: CampoDeTexto): EstadoDoCampo => {
  try {
    return { valor: campo.value, inicio: campo.selectionStart, fim: campo.selectionEnd };
  } catch {
    return { valor: campo.value, inicio: null, fim: null };
  }
};

/** Liga a protecao uma vez, para a janela inteira (chamado em main.tsx). */
export const iniciarCursorNaCaixaAlta = (): void => {
  let pendente: { campo: CampoDeTexto; antes: EstadoDoCampo } | null = null;

  const devolverCursor = (anotado: { campo: CampoDeTexto; antes: EstadoDoCampo }) => {
    if (pendente !== anotado) return; // ja' resolvido, ou veio outra tecla
    pendente = null;
    if (document.activeElement !== anotado.campo) return;
    const posicao = posicaoParaRestaurar(anotado.antes, lerCampo(anotado.campo));
    if (!posicao) return;
    try {
      anotado.campo.setSelectionRange(posicao.inicio, posicao.fim);
    } catch {
      // Campo sem selecao de texto: nada a devolver.
    }
  };

  // Na descida do evento (antes de a tela tratar a tecla): anota o cursor.
  document.addEventListener('input', (evento) => {
    pendente = null;
    const alvo = evento.target;
    if (!(alvo instanceof HTMLInputElement) && !(alvo instanceof HTMLTextAreaElement)) return;
    // Digitacao composta (acento em duas teclas no celular, teclado oriental):
    // o texto ainda nao e' o final, o navegador cuida do cursor.
    if ((evento as InputEvent).isComposing) return;
    const anotado = { campo: alvo, antes: lerCampo(alvo) };
    pendente = anotado;
    // Garantia: se alguma tela segurar o evento antes de ele subir ate' a
    // janela, o cursor volta antes de a tela ser desenhada de novo.
    window.requestAnimationFrame(() => devolverCursor(anotado));
  }, true);

  // Na subida (depois que a tela tratou a tecla): devolve o cursor assim que
  // o campo for reescrito, antes da proxima tecla.
  window.addEventListener('input', () => {
    const anotado = pendente;
    if (anotado) queueMicrotask(() => devolverCursor(anotado));
  });
};
