/*
 * ABAS SALVAS NO NAVEGADOR TEM DONO (11/11/2026).
 *
 * As abas abertas ficam guardadas no navegador para voltarem depois de um F5.
 * Elas eram guardadas sem dizer de quem eram, e so' eram apagadas no "Sair".
 * Quando a pessoa trocava de conta sem passar pelo Sair (sessao derrubada,
 * sessao vencida, conta nova criada no mesmo navegador), a conta seguinte
 * abria o sistema com as abas da empresa anterior ("Pedido 0044", "Notas
 * Fiscais"...) -- o dono viu isso ao criar uma conta nova.
 *
 * Agora as abas sao gravadas com o dono (usuario + empresa) e so' voltam para
 * o mesmo dono. Abas gravadas antes desta regra nao tem dono e nao voltam.
 *
 * Regra pura: sem navegador, sem React.
 */

/** Quem e' o dono das abas: o usuario logado na empresa ativa. */
export const donoDasAbas = (uid: unknown, tenantId: unknown): string => `${String(uid || '')}|${String(tenantId || '')}`;

export interface AbasSalvas<T> {
  tabs: T[];
  activeTabId: string;
}

/**
 * Le o que estava guardado. null = nada para restaurar: nao tem nada salvo, o
 * conteudo esta' quebrado, ou as abas sao de outro usuario/empresa.
 */
export const lerAbasSalvas = <T>(raw: string | null | undefined, dono: string): AbasSalvas<T> | null => {
  if (!raw) return null;
  try {
    const lido = JSON.parse(raw) as { tabs?: unknown; activeTabId?: unknown; dono?: unknown } | null;
    if (!lido || typeof lido !== 'object') return null;
    if (typeof lido.dono !== 'string' || lido.dono !== dono) return null;
    if (!Array.isArray(lido.tabs) || lido.tabs.length === 0) return null;
    return { tabs: lido.tabs as T[], activeTabId: String(lido.activeTabId || '') };
  } catch {
    return null;
  }
};

/** O que vai para o navegador: as abas e de quem elas sao. */
export const abasParaSalvar = <T>(estado: AbasSalvas<T>, dono: string): string => (
  JSON.stringify({ tabs: estado.tabs, activeTabId: estado.activeTabId, dono })
);
