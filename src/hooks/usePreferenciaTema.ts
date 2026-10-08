import { useEffect, useState } from 'react';
import { EVENTO_TEMA, aparelhoEstaEscuro, lerPreferenciaSalva, salvarPreferenciaTema } from '../utils/tema';
import { temaEfetivo, type PreferenciaTema, type TemaEfetivo } from '../utils/temaDomain';

/**
 * Preferencia de tema para a tela que a mostra (TopBar do sistema, Perfil do
 * app). Duas telas abertas ficam em dia uma com a outra pelo evento que
 * salvarPreferenciaTema dispara; no automatico, o tema efetivo acompanha o
 * aparelho.
 */
export const usePreferenciaTema = (): {
  preferencia: PreferenciaTema;
  tema: TemaEfetivo;
  aparelhoEscuro: boolean;
  escolher: (preferencia: PreferenciaTema) => void;
} => {
  const [preferencia, setPreferencia] = useState<PreferenciaTema>(() => lerPreferenciaSalva());
  const [aparelhoEscuro, setAparelhoEscuro] = useState<boolean>(() => aparelhoEstaEscuro());

  useEffect(() => {
    const aoTrocar = () => setPreferencia(lerPreferenciaSalva());
    window.addEventListener(EVENTO_TEMA, aoTrocar);
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    const aoMudarAparelho = () => setAparelhoEscuro(aparelhoEstaEscuro());
    if (mq && typeof mq.addEventListener === 'function') mq.addEventListener('change', aoMudarAparelho);
    return () => {
      window.removeEventListener(EVENTO_TEMA, aoTrocar);
      if (mq && typeof mq.removeEventListener === 'function') mq.removeEventListener('change', aoMudarAparelho);
    };
  }, []);

  return {
    preferencia,
    tema: temaEfetivo(preferencia, aparelhoEscuro),
    aparelhoEscuro,
    escolher: salvarPreferenciaTema,
  };
};
