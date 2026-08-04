import { useContext, useEffect } from 'react';
import { TabIdContext, TabsContext } from '../contexts/TabsContext';

/**
 * Registra no TabsContext se a tela atual tem dados nao salvos, pra
 * fechar a aba (X na TabBar) perguntar antes em vez de descartar direto
 * (Sistema de Abas, F19). `onSave` deve devolver `true` se salvou com
 * sucesso -- em caso de `false`, a propria tela ja deve ter mostrado seu
 * erro (via showError), a aba so permanece aberta.
 *
 * No-op fora do sistema de abas (ex: PDV, que nao usa TabsProvider) --
 * usa useContext direto (nao o hook useTabs, que lanca erro fora do
 * provider de proposito) pra isso ser um no-op de verdade, nao um crash.
 */
export function useUnsavedChangesGuard(isDirty: boolean, onSave: () => Promise<boolean>): void {
  const tabId = useContext(TabIdContext);
  const tabsContext = useContext(TabsContext);

  useEffect(() => {
    if (!tabId || !tabsContext) return undefined;
    tabsContext.setTabDirty(tabId, isDirty, onSave);
    return () => tabsContext.setTabDirty(tabId, false);
  }, [tabId, tabsContext, isDirty, onSave]);
}
