import { useEffect, useState } from 'react';

/**
 * O texto digitado na busca, so' depois que a pessoa para de digitar
 * (17/11/2026: "a barra de pesquisa esta travando quando busca"). O campo
 * continua respondendo na hora; o filtro da lista (que pode varrer milhares
 * de registros) roda uma vez por pausa, nao a cada tecla. Apagar tudo vale
 * na hora.
 */
export function useTermoAdiado(termo: string, esperaMs = 250): string {
  const [adiado, setAdiado] = useState(termo);
  useEffect(() => {
    if (termo.trim() === '') { setAdiado(termo); return undefined; }
    const espera = window.setTimeout(() => setAdiado(termo), esperaMs);
    return () => window.clearTimeout(espera);
  }, [termo, esperaMs]);
  return adiado;
}

/** Quantas linhas uma lista desenha de cada vez quando tem o cadastro inteiro. */
export const LINHAS_POR_VEZ = 100;
