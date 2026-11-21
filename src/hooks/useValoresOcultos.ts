import { useCallback, useSyncExternalStore } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  MASCARA_MOEDA,
  chaveDosValoresOcultos,
  lerValoresOcultos,
  valorNaTela,
} from '../utils/valoresOcultosDomain';

/**
 * O "olhinho" que esconde os totais e resultados de TODAS as telas de uma vez
 * (decisao do dono, 21/11/2026; regra em valoresOcultosDomain.ts). Toda tela
 * que mostra resumo usa este hook: fechar o olho numa tela fecha nas outras,
 * inclusive nas abas do sistema ja' abertas e em outra janela do navegador.
 */

const EVENTO = 'hennder:valores-ocultos';

// Navegador que recusa armazenamento (aba anonima bloqueada): a escolha vale
// so' ate' recarregar a pagina, mas o olho funciona.
const memoria = new Map<string, string>();

const lerDoNavegador = (chave: string): string | null => {
  try {
    const salvo = window.localStorage.getItem(chave);
    if (salvo !== null) return salvo;
  } catch {
    // cai na memoria
  }
  return memoria.get(chave) ?? null;
};

const assinar = (avisar: () => void) => {
  window.addEventListener(EVENTO, avisar);
  window.addEventListener('storage', avisar);
  return () => {
    window.removeEventListener(EVENTO, avisar);
    window.removeEventListener('storage', avisar);
  };
};

export const useValoresOcultos = (): {
  ocultos: boolean;
  alternar: () => void;
  /** Texto pronto para a tela: o valor, ou a mascara com o olho fechado. */
  mostrar: (texto: string, mascara?: string) => string;
} => {
  const { currentUser } = useAuth();
  const usuarioId = currentUser?.uid ?? null;
  const ocultos = useSyncExternalStore(
    assinar,
    () => lerValoresOcultos(lerDoNavegador, usuarioId),
    () => false,
  );

  const alternar = useCallback(() => {
    const novo = !lerValoresOcultos(lerDoNavegador, usuarioId);
    const chave = chaveDosValoresOcultos(usuarioId);
    memoria.set(chave, String(novo));
    try {
      window.localStorage.setItem(chave, String(novo));
    } catch {
      // fica so' na memoria
    }
    window.dispatchEvent(new Event(EVENTO));
  }, [usuarioId]);

  const mostrar = useCallback(
    (texto: string, mascara: string = MASCARA_MOEDA) => valorNaTela(ocultos, texto, mascara),
    [ocultos],
  );

  return { ocultos, alternar, mostrar };
};
