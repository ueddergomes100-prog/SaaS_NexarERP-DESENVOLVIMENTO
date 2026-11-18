/*
 * DUPLO CLIQUE NAO MARCA O TEXTO DE AZUL (18/11/2026).
 *
 * Reclamacao do dono: ao clicar duas vezes numa linha para abrir (produto,
 * cliente, pedido, OS...), o navegador marca de azul a palavra clicada, como
 * se a pessoa quisesse copiar. O duplo clique do sistema e' "abrir", nao
 * "selecionar palavra".
 *
 * Correcao unica, na janela (ligada em main.tsx): o navegador marca a palavra
 * no SEGUNDO apertar do mouse; cancelar o padrao desse apertar tira a marcacao
 * e nada mais -- o clique e o duplo clique continuam chegando na tela.
 *
 * O que continua igual, de proposito:
 *  - dentro de campo de digitar (input, textarea, caixa de selecao, texto
 *    editavel), duplo clique segue marcando a palavra: ali e' edicao de texto;
 *  - ARRASTAR o mouse por cima de um texto segue selecionando, entao da' para
 *    copiar nome, codigo ou valor de qualquer lista.
 *
 * Nao resolva isso com "user-select: none" na linha: tiraria tambem o copiar
 * arrastando.
 */

export interface ApertoDoMouse {
  /** Quantos cliques seguidos este apertar completa (MouseEvent.detail): 2 = duplo, 3 = triplo. */
  cliques: number;
  /** 0 = botao principal (esquerdo). */
  botao: number;
  /** O alvo e' (ou esta' dentro de) um campo de digitar. */
  emCampoDeDigitar: boolean;
}

export const deveImpedirSelecao = (aperto: ApertoDoMouse): boolean => (
  aperto.cliques >= 2 && aperto.botao === 0 && !aperto.emCampoDeDigitar
);

const SELETOR_CAMPO_DE_DIGITAR = 'input, textarea, select, option';

const estaEmCampoDeDigitar = (alvo: EventTarget | null): boolean => {
  if (!(alvo instanceof Element)) return false;
  if (alvo.closest(SELETOR_CAMPO_DE_DIGITAR)) return true;
  return alvo instanceof HTMLElement && alvo.isContentEditable;
};

export const iniciarDuploCliqueSemSelecao = (): void => {
  // Na captura: a tela pode parar a propagacao do evento (botoes dentro da linha fazem isso).
  document.addEventListener('mousedown', (evento) => {
    if (deveImpedirSelecao({
      cliques: evento.detail,
      botao: evento.button,
      emCampoDeDigitar: estaEmCampoDeDigitar(evento.target),
    })) {
      evento.preventDefault();
    }
  }, true);
};
