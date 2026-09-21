import { useState, type KeyboardEvent, type SyntheticEvent } from 'react';

/**
 * LINHA DE LISTA QUE ABRE COM DOIS CLIQUES (2026-09-19).
 *
 * Padrao unico de toda lista do sistema: um clique SELECIONA a linha (fica
 * destacada, pra pessoa saber sobre qual linha vai agir), dois cliques -- ou
 * Enter, com a linha em foco -- ABREM o registro, exatamente o que o botao
 * de editar/ver da linha faz. Nasceu em Clientes e Pedidos de Venda; aqui
 * vira um hook pra nao ser reescrito em cada tela.
 *
 * `abrir` e' a MESMA acao do botao da linha, e `null` quando o botao nao
 * aparece pra aquela linha (sem permissao, registro do sistema...): o duplo
 * clique nunca pode abrir o que o botao esconde.
 *
 * A celula de acoes recebe `semAbrirLinha`: clicar num botao ali nao pode
 * selecionar nem abrir a linha junto -- e Enter num botao focado nao pode
 * disparar o Enter da linha.
 */
export const useLinhaSelecionavel = () => {
  const [selecionadaId, setSelecionadaId] = useState<string | null>(null);

  const linha = (id: string, abrir: (() => void) | null) => {
    if (!abrir) return {};
    return {
      className: selecionadaId === id ? 'row-selectable is-selected' : 'row-selectable',
      onClick: () => setSelecionadaId(id),
      onDoubleClick: abrir,
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === 'Enter') abrir();
      },
      tabIndex: 0,
      title: 'Clique para selecionar, duplo clique para abrir',
    };
  };

  return { linha };
};

const pararPropagacao = (event: SyntheticEvent) => event.stopPropagation();

export const semAbrirLinha = {
  onClick: pararPropagacao,
  onDoubleClick: pararPropagacao,
  onKeyDown: pararPropagacao,
};
