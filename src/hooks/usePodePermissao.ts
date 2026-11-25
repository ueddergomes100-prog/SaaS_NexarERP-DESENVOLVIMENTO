import { useAuth } from '../contexts/AuthContext';
import { hasTenantFullAccess } from '../utils/roles';
import { permissionLabelMap } from '../utils/permissionCatalog';
import { showError } from '../utils/alerts';

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

/**
 * Frase para quem nao tem a permissao (fase Estoque e cadastros, 25/11/2026):
 * o que nao pode, o rotulo que o dono ve no cadastro do funcionario e o que
 * fazer. `dica` (opcional) diz o caminho sem a permissao.
 */
export const mensagemSemPermissaoNaTela = (permissao: string, acao: string, dica = ''): string => (
  `Você não tem permissão para ${acao}. Peça a um responsável liberar "${permissionLabelMap[permissao] || permissao}" no seu cadastro de funcionário.${dica ? ` ${dica}` : ''}`
);

/** Mostra o aviso (modal) de falta de permissao. */
export const avisarSemPermissao = (permissao: string, acao: string, dica = ''): void => {
  showError('Sem permissão', mensagemSemPermissaoNaTela(permissao, acao, dica));
};
