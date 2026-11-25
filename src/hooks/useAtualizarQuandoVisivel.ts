import { useEffect, useRef, type RefObject } from 'react';

/**
 * Atualiza a tela sozinha enquanto ela esta' A VISTA (25/11/2026, pedido do
 * dono: "Caixas e sessao PDV tem que atualizar automatico tudo sem ter que ficar
 * saindo da tela").
 *
 * Chama `atualizar` a cada `intervaloMs` e quando a janela volta ao foco -- mas
 * so' se a aba do navegador estiver visivel E a tela estiver na aba interna
 * ativa (as abas internas ficam montadas escondidas; `offsetParent` nulo =
 * escondida). Tela escondida nao gasta nada.
 *
 * Use para o que vem do servidor; o que vem direto do banco de dados deve ser
 * escutado ao vivo (onSnapshot), que nao relê o que nao mudou.
 */
export const useAtualizarQuandoVisivel = (
  atualizar: () => void,
  intervaloMs: number,
  ref: RefObject<HTMLElement | null>,
): void => {
  const atualizarRef = useRef(atualizar);
  useEffect(() => {
    atualizarRef.current = atualizar;
  });

  useEffect(() => {
    const visivel = () => document.visibilityState === 'visible' && Boolean(ref.current && ref.current.offsetParent !== null);
    const tentar = () => { if (visivel()) atualizarRef.current(); };
    const id = window.setInterval(tentar, intervaloMs);
    window.addEventListener('focus', tentar);
    document.addEventListener('visibilitychange', tentar);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', tentar);
      document.removeEventListener('visibilitychange', tentar);
    };
  }, [intervaloMs, ref]);
};
