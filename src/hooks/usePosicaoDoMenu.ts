import { useCallback, useEffect, useState } from 'react';
import {
  EVENTO_POSICAO_DO_MENU,
  chavePosicaoDoMenu,
  lerPosicaoDoMenu,
  menuFicaNoTopo,
  type PosicaoDoMenu,
} from '../utils/menuNoTopoDomain';

const lerGuardada = (uid: string | null | undefined): PosicaoDoMenu => {
  try { return lerPosicaoDoMenu(window.localStorage.getItem(chavePosicaoDoMenu(uid))); } catch { return 'lateral'; }
};

/**
 * Menu no topo ou na lateral, escolhido pelo usuario e guardado neste computador
 * (regra em utils/menuNoTopoDomain.ts). A barra de cima e o menu usam este mesmo
 * gancho e ficam em dia um com o outro pelo evento da troca.
 */
export const usePosicaoDoMenu = (uid: string | null | undefined): {
  posicao: PosicaoDoMenu;
  noTopo: boolean;
  escolher: (posicao: PosicaoDoMenu) => void;
} => {
  const [posicao, setPosicao] = useState<PosicaoDoMenu>(() => lerGuardada(uid));
  const [largura, setLargura] = useState<number>(() => (typeof window === 'undefined' ? 0 : window.innerWidth));

  useEffect(() => {
    setPosicao(lerGuardada(uid));
    const aoTrocar = () => setPosicao(lerGuardada(uid));
    const aoRedimensionar = () => setLargura(window.innerWidth);
    window.addEventListener(EVENTO_POSICAO_DO_MENU, aoTrocar);
    window.addEventListener('storage', aoTrocar);
    window.addEventListener('resize', aoRedimensionar);
    return () => {
      window.removeEventListener(EVENTO_POSICAO_DO_MENU, aoTrocar);
      window.removeEventListener('storage', aoTrocar);
      window.removeEventListener('resize', aoRedimensionar);
    };
  }, [uid]);

  const escolher = useCallback((nova: PosicaoDoMenu) => {
    try {
      window.localStorage.setItem(chavePosicaoDoMenu(uid), nova);
    } catch {
      // Sem armazenamento (janela anonima): vale enquanto a tela estiver aberta.
    }
    setPosicao(nova);
    window.dispatchEvent(new Event(EVENTO_POSICAO_DO_MENU));
  }, [uid]);

  return { posicao, noTopo: menuFicaNoTopo(posicao, largura), escolher };
};
