import { useAuth } from '../contexts/AuthContext';
import { hasTenantFullAccess } from '../utils/roles';

/**
 * Permissao por acao (item 15 da Embala Minas, 25/11/2026): dono e
 * administrador seguem liberados nesta fase; o funcionario pelas permissoes
 * efetivas (o AuthContext ja' entrega as dos pacotes -- permissoesNovasDomain.ts).
 * A tela so' esconde/trava; quem decide de verdade e' o servidor.
 */
export const usePodePermissao = (): ((permissao: string) => boolean) => {
  const { userRole, isOwner, userPermissions } = useAuth();
  return (permissao: string) => hasTenantFullAccess(userRole, isOwner) || userPermissions.includes(permissao);
};
