import { useCallback, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { TabsContext, TabIdContext } from '../contexts/TabsContext';

/**
 * Dispara window.print() e, terminada a impressao (aceita ou cancelada no
 * dialogo do navegador -- window.print() bloqueia ate la), fecha a propria
 * aba e volta pra aba anterior sozinho.
 *
 * Existe porque "Imprimir Recibo"/"Imprimir OS"/"Imprimir Orçamento" usam
 * `navigate()` pra chegar na tela de impressao, nao `openTab()` -- reaproveitam
 * a MESMA aba (ex: a de "Nova Venda (PDV)"). Sem fechar essa aba depois de
 * imprimir, ela nunca mais volta a ser reaproveitavel: a proxima venda abre
 * uma aba NOVA, e empresa que trabalha com identificacao de vendedor a cada
 * venda (Modulo de PIN) bate no limite de 8 abas depois de poucas vendas
 * seguidas, so de imprimir recibo. Ver TabsContext.tsx (MAX_TABS).
 *
 * `fallbackPath` so entra em jogo fora do sistema de abas (nao deveria
 * acontecer em uso normal, ja que estas telas so existem dentro de uma
 * TabPane, mas mantem a tela utilizavel se algum dia isso mudar).
 */
export const usePrintAndClose = (fallbackPath: string) => {
  const tabsCtx = useContext(TabsContext);
  const tabId = useContext(TabIdContext);
  const navigate = useNavigate();

  return useCallback(() => {
    window.print();
    if (tabsCtx && tabId) {
      tabsCtx.closeTab(tabId);
    } else {
      navigate(fallbackPath);
    }
  }, [tabsCtx, tabId, navigate, fallbackPath]);
};
