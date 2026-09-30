import { useState } from 'react';

export type OrdemNumero = 'asc' | 'desc';

/**
 * Ordem das listas pelo NUMERO (pedido, pre-venda, nota) -- pedido do dono
 * (2026-09-30): crescente por padrao; clicar no titulo da coluna inverte e a
 * tela lembra a escolha (so' preferencia deste navegador).
 */
export const useOrdemNumero = (chave: string): [OrdemNumero, () => void] => {
  const [ordem, setOrdem] = useState<OrdemNumero>(() => {
    try { return localStorage.getItem(chave) === 'desc' ? 'desc' : 'asc'; } catch { return 'asc'; }
  });
  const inverter = () => {
    const nova: OrdemNumero = ordem === 'asc' ? 'desc' : 'asc';
    setOrdem(nova);
    try { localStorage.setItem(chave, nova); } catch { /* so' preferencia da tela */ }
  };
  return [ordem, inverter];
};

/** Compara pelo numero ("0154" = 154); sem numero vai pro fim. */
export const compararPorNumero = (a: unknown, b: unknown, ordem: OrdemNumero): number => {
  const na = Number(String(a ?? '').replace(/\D/g, '')) || 0;
  const nb = Number(String(b ?? '').replace(/\D/g, '')) || 0;
  if (!na || !nb) return (na ? 0 : 1) - (nb ? 0 : 1);
  return ordem === 'asc' ? na - nb : nb - na;
};
