/*
 * FRENTE DE CAIXA COMO APP SEPARADO (pedido do dono, 19/10/2026).
 *
 * O PDV (src/pages/PDV/PDV.tsx) passa a abrir tambem sozinho, em /caixa,
 * do mesmo jeito que o app do vendedor abre em /vendedor: entrada HTML
 * propria (caixa.html, instalavel), login proprio com o MESMO usuario e
 * senha do sistema e sem a seta de voltar -- o sistema completo fica em
 * outra aba, se precisar.
 *
 * Quem entra:
 *  - quem ja' usa o PDV dentro do sistema ("Vendas: Frente de Caixa (PDV)");
 *  - o funcionario caixa, com a permissao "Vendas: So' a Frente de Caixa":
 *    para ele o login (no sistema ou no app) cai DIRETO no caixa, e o resto
 *    do sistema nao aparece.
 * Dono, administrador e gestor da plataforma nunca ficam presos ao caixa.
 *
 * O app do caixa NAO entra no controle de sessao unica do sistema
 * (activeSessionId): o caixa fica aberto o dia inteiro e nao pode cair
 * quando a mesma pessoa abre o sistema em outra aba (AuthContext.tsx).
 *
 * Funcoes puras, compiladas para o servidor (scripts/build-server-domain.mjs):
 * server/routes/vendas.routes.js usa PERMISSOES_QUE_OPERAM_O_CAIXA.
 */
import { hasTenantFullAccess } from './roles';

/** Permissao de sempre do PDV dentro do sistema. */
export const PERMISSAO_PDV = 'vendas.pdv';
/** Funcionario caixa: entra direto no caixa e so' nele. */
export const PERMISSAO_SO_CAIXA = 'vendas.so_caixa';
/** Qualquer uma destas opera o caixa (abrir/fechar caixa, vender, receber). */
export const PERMISSOES_QUE_OPERAM_O_CAIXA: readonly string[] = [PERMISSAO_PDV, PERMISSAO_SO_CAIXA];
/** Modulo do plano que o caixa usa (bloqueio pelo SuperAdmin, ver moduleCatalog.ts). */
export const MODULO_DO_CAIXA = 'comercial.pedidos';

export const CAMINHO_APP_CAIXA = '/caixa';
export const CAMINHO_LOGIN_CAIXA = '/caixa/login';
/** Arquivo HTML real do app (manifest/icone proprios): start_url do manifest e pagina de instalacao. */
export const CAMINHO_INSTALACAO_CAIXA = '/caixa.html';

/** A pagina aberta e' o app do caixa (e nao o sistema ou o app do vendedor)? */
export const ehAppDoCaixa = (pathname: string): boolean => (
  pathname === CAMINHO_APP_CAIXA || pathname.startsWith(`${CAMINHO_APP_CAIXA}/`) || pathname === CAMINHO_INSTALACAO_CAIXA
);

export interface PerfilParaOCaixa {
  role?: unknown;
  isOwner?: boolean;
  permissoes?: readonly string[] | null;
}

const tem = (perfil: PerfilParaOCaixa, permissao: string): boolean => (
  Array.isArray(perfil.permissoes) && perfil.permissoes.includes(permissao)
);

/** Pode abrir a Frente de Caixa (no sistema ou no app)? */
export const podeUsarFrenteDeCaixa = (perfil: PerfilParaOCaixa): boolean => (
  hasTenantFullAccess(perfil.role, Boolean(perfil.isOwner))
  || PERMISSOES_QUE_OPERAM_O_CAIXA.some((permissao) => tem(perfil, permissao))
);

/** Funcionario caixa: o login cai direto no caixa e o sistema nao aparece. Nunca vale para dono/administrador. */
export const entraDiretoNoCaixa = (perfil: PerfilParaOCaixa): boolean => (
  !hasTenantFullAccess(perfil.role, Boolean(perfil.isOwner)) && tem(perfil, PERMISSAO_SO_CAIXA)
);

/** Para onde o login do sistema manda a pessoa. */
export const destinoAposLogin = (perfil: PerfilParaOCaixa, loginDaPlataforma: boolean): string => {
  if (loginDaPlataforma) return '/superadmin';
  return entraDiretoNoCaixa(perfil) ? CAMINHO_APP_CAIXA : '/dashboard';
};

export const MENSAGEM_SEM_ACESSO_AO_CAIXA = 'Este login não tem acesso à Frente de Caixa. Peça ao administrador para liberar "Vendas: Frente de Caixa (PDV)" ou "Vendas: Só a Frente de Caixa" no seu usuário.';
