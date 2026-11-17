import { useCallback, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { TabsContext, TabIdContext } from '../contexts/TabsContext';

/**
 * Dispara window.print() e, terminada a impressao (aceita ou cancelada no
 * dialogo do navegador -- window.print() bloqueia ate la), fecha a propria
 * aba e volta para a tela de onde a impressao veio.
 *
 * Existe porque "Imprimir Recibo"/"Imprimir OS"/"Imprimir Orçamento" usam
 * `navigate()` pra chegar na tela de impressao, nao `openTab()` -- reaproveitam
 * a MESMA aba (ex: a de "Nova Venda (PDV)"). Sem fechar essa aba depois de
 * imprimir, ela nunca mais volta a ser reaproveitavel: a proxima venda abre
 * uma aba NOVA, e empresa que trabalha com identificacao de vendedor a cada
 * venda (Modulo de PIN) bate no limite de 8 abas depois de poucas vendas
 * seguidas, so de imprimir recibo. Ver TabsContext.tsx (MAX_TABS).
 *
 * Para onde volta (17/11/2026, dono: "quando imprime um pedido, o sistema
 * esta voltando direto pra Dashboard"): fechar a aba ativava a vizinha da
 * esquerda, que quase sempre e' o Dashboard. Agora volta para a aba que abriu
 * esta (a lista, quando a impressao foi aberta dela) ou, sem ela, para a
 * lista do modulo (`fallbackPath`, que reaproveita a aba se ja estiver aberta).
 */
export const usePrintAndClose = (fallbackPath: string) => {
  const tabsCtx = useContext(TabsContext);
  const tabId = useContext(TabIdContext);
  const navigate = useNavigate();

  return useCallback(() => {
    window.print();
    if (tabsCtx && tabId) {
      const aba = tabsCtx.tabs.find((tab) => tab.id === tabId);
      const abaDeOrigem = aba?.parentTabId && tabsCtx.tabs.some((tab) => tab.id === aba.parentTabId)
        ? aba.parentTabId
        : null;
      tabsCtx.closeTab(tabId);
      if (abaDeOrigem) tabsCtx.activateTab(abaDeOrigem);
      else void tabsCtx.openTab(fallbackPath);
    } else {
      navigate(fallbackPath);
    }
  }, [tabsCtx, tabId, navigate, fallbackPath]);
};
