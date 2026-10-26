import { hasTenantFullAccess } from '../../utils/roles';
import { podeNoApp } from '../../utils/permissoesAppDomain';

/**
 * Bloco "Aplicativo mobile" das permissoes (26/10/2026): cada tela do app tem a
 * sua chave (PERMISSAO_APP em permissoesAppDomain.ts). Dono/gestor sempre; quem
 * nunca teve o app gravado conta com todas (o AuthContext ja' entrega assim).
 */
export { PERMISSAO_APP } from '../../utils/permissoesAppDomain';
export const podeTelaDoApp = (chave: string, userRole: unknown, isOwner: boolean, permissoes: string[]): boolean => (
  podeNoApp(chave, { role: userRole, isOwner, permissoes })
);

/** Liberacao de desconto pelo celular (21/10/2026): quem ve a tela Liberacoes. Regra em liberacaoRemotaDomain.ts. */
export { podeLiberarDescontoNoApp } from '../../utils/liberacaoRemotaDomain';
/**
 * Balanco (contagem de estoque) no app (21/10/2026): permissao propria de
 * CONTAR ("Estoque: Balanco -- contar"); quem fecha e ajusta o estoque e' o
 * gestor, no computador. Dono/gestor sempre. Sem ela o atalho some e a rota
 * /vendedor/balanco volta pro inicio.
 */
export const PERMISSAO_BALANCO = 'estoque.balanco_contar';

export const podeContarBalancoNoApp = (userRole: unknown, isOwner: boolean, permissoes: string[]): boolean => (
  hasTenantFullAccess(userRole, isOwner) || permissoes.includes(PERMISSAO_BALANCO)
);

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
