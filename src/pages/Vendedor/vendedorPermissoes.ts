import { hasTenantFullAccess } from '../../utils/roles';
/**
 * Permissao que libera o Balanco (contagem de estoque) no app do vendedor.
 * O balanco corrige o SALDO do estoque, e a permissao que o cadastro do
 * funcionario ja tem pra isso e' o Ajuste Manual de Estoque. Sem ela o atalho
 * some e a rota /vendedor/balanco volta pro inicio.
 */
export const PERMISSAO_BALANCO = 'estoque.ajusteManual';

/**
 * Quem pode cadastrar cliente pelo app: as mesmas permissoes que as regras do
 * banco aceitam pra gravar em `clientes` no dia a dia de venda (firestore.rules,
 * canWriteTenantCollection). Sem nenhuma delas o botao nem aparece.
 */
const PERMISSOES_CADASTRO_CLIENTE = ['cadastros.clientes', 'vendas.pedidos', 'vendas.orcamentos'];

export const podeCadastrarClienteNoApp = (permissoes: string[]): boolean => (
  PERMISSOES_CADASTRO_CLIENTE.some((permissao) => permissoes.includes(permissao))
);

/**
 * Quem usa a parte de OS do app (consulta e atendimento): dono/gestor
 * sempre; funcionario com a permissao de Ordens de Servico do sistema
 * ('mecanica.os', continua valendo para nao quebrar ninguem) ou com uma das
 * permissoes so' do app (decisao do dono, 08/10/2026):
 *
 *  - 'mecanica.os_app'        ve e atende as OS que a loja abriu;
 *  - 'mecanica.os_app_abrir'  tambem abre OS nova no campo.
 *
 * O dono nao tem permissao listada no cadastro (ele tem tudo), por isso a
 * checagem so' por permissao escondia o modulo dele.
 */
export const PERMISSAO_OS_APP = 'mecanica.os_app';
export const PERMISSAO_OS_APP_ABRIR = 'mecanica.os_app_abrir';

export const podeUsarOsNoApp = (userRole: unknown, isOwner: boolean, permissoes: string[]): boolean => (
  hasTenantFullAccess(userRole, isOwner)
  || permissoes.includes('mecanica.os')
  || permissoes.includes(PERMISSAO_OS_APP)
  || permissoes.includes(PERMISSAO_OS_APP_ABRIR)
);

/** Abrir OS nova pelo celular: dono/gestor, quem tem a OS do sistema, ou a permissao de abrir do app. */
export const podeAbrirOsNoApp = (userRole: unknown, isOwner: boolean, permissoes: string[]): boolean => (
  hasTenantFullAccess(userRole, isOwner)
  || permissoes.includes('mecanica.os')
  || permissoes.includes(PERMISSAO_OS_APP_ABRIR)
);

/**
 * Entregas do romaneio no app do motorista (2026-10-08): permissao propria,
 * separada da tela de romaneio do sistema -- o motorista registra a entrega,
 * nao monta nem fecha rota. Dono/gestor sempre.
 */
export const PERMISSAO_ENTREGAS_APP = 'operacoes.entregas_app';

export const podeUsarEntregasNoApp = (userRole: unknown, isOwner: boolean, permissoes: string[]): boolean => (
  hasTenantFullAccess(userRole, isOwner) || permissoes.includes(PERMISSAO_ENTREGAS_APP)
);
