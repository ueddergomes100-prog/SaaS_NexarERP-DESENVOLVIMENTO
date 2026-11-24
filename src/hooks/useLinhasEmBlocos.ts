import { useCallback, useMemo, useState } from 'react';
import { LINHAS_POR_BLOCO, linhasDoBloco, linhasRestantes, proximoLimite } from '../utils/linhasEmBlocosDomain';

export interface LinhasEmBlocos<T> {
  /** As linhas que a tabela desenha agora. */
  visiveis: readonly T[];
  /** Quantas ficaram de fora (0 = a lista inteira esta' na tela). */
  restam: number;
  mostrarMais: () => void;
  mostrarTudo: () => void;
}

/**
 * Desenha a lista em blocos (regra e porque em utils/linhasEmBlocosDomain.ts).
 *
 * `linhas` e' a lista ja' filtrada e ordenada, INTEIRA: use-a para totais,
 * selecao e relatorio; use `visiveis` so' no `.map()` das linhas da tabela.
 *
 * `chave`: quando muda (texto da busca, filtro, aba), a lista volta ao
 * primeiro bloco. Sem chave, o que a pessoa ja' abriu continua aberto.
 * Atualizacao ao vivo dos dados nunca encolhe a lista.
 */
export function useLinhasEmBlocos<T>(linhas: readonly T[], chave: unknown = null, passo: number = LINHAS_POR_BLOCO): LinhasEmBlocos<T> {
  const [limite, setLimite] = useState(passo);
  const [chaveVista, setChaveVista] = useState(chave);
  if (chaveVista !== chave) {
    setChaveVista(chave);
    setLimite(passo);
  }

  const visiveis = useMemo(() => linhasDoBloco(linhas, limite), [linhas, limite]);
  const mostrarMais = useCallback(() => setLimite((atual) => proximoLimite(atual, passo)), [passo]);
  const mostrarTudo = useCallback(() => setLimite(Number.MAX_SAFE_INTEGER), []);
  const restam = linhasRestantes(linhas.length, limite);

  return useMemo(() => ({ visiveis, restam, mostrarMais, mostrarTudo }), [visiveis, restam, mostrarMais, mostrarTudo]);
}
