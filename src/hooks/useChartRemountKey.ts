import { useContext } from 'react';
import { TabActiveContext } from '../contexts/TabsContext';

/**
 * O ResponsiveContainer do Recharts mede 0x0 (ou -1x-1) no instante em
 * que a aba volta a ficar visivel -- estava com display:none (Sistema
 * de Abas, F19), entao o grafico so acerta o tamanho depois de montado,
 * causando uma piscada visivel (mede errado, depois salta pro tamanho
 * certo). Usar esse valor como `key` no ResponsiveContainer forca ele a
 * desmontar/remontar exatamente quando a aba vira ativa -- nesse ponto
 * o container ja tem o tamanho real, entao a primeira medicao ja sai
 * certa, sem salto visivel. Fora do sistema de abas (ex: PDV), o
 * contexto default e `true` e a key nunca muda.
 */
export const useChartRemountKey = () => {
  const isTabActive = useContext(TabActiveContext);
  return isTabActive ? 'tab-active' : 'tab-inactive';
};
