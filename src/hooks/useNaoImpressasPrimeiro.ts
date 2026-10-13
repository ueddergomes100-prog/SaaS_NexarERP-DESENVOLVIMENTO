import { useState } from 'react';
import { lerNaoImpressasPrimeiro } from '../utils/relatorioPreVendasDomain';

/**
 * "Nao impressas primeiro" (pedido do dono, 2026-10-13): nas listas de
 * pre-venda, o que ainda nao saiu no papel fica no topo. Ligado por padrao;
 * o botao alterna e a tela lembra a escolha (so' preferencia deste
 * navegador, como useOrdemNumero).
 */
export const useNaoImpressasPrimeiro = (chave: string): [boolean, () => void] => {
  const [ligado, setLigado] = useState<boolean>(() => {
    try { return lerNaoImpressasPrimeiro(localStorage.getItem(chave)); } catch { return true; }
  });
  const alternar = () => {
    const novo = !ligado;
    setLigado(novo);
    try { localStorage.setItem(chave, String(novo)); } catch { /* so' preferencia da tela */ }
  };
  return [ligado, alternar];
};
