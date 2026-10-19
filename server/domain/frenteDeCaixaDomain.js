"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MENSAGEM_SEM_ACESSO_AO_CAIXA = exports.destinoAposLogin = exports.entraDiretoNoCaixa = exports.podeUsarFrenteDeCaixa = exports.ehAppDoCaixa = exports.CAMINHO_INSTALACAO_CAIXA = exports.CAMINHO_LOGIN_CAIXA = exports.CAMINHO_APP_CAIXA = exports.MODULO_DO_CAIXA = exports.PERMISSOES_QUE_OPERAM_O_CAIXA = exports.PERMISSAO_SO_CAIXA = exports.PERMISSAO_PDV = void 0;
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
const roles_1 = require("./roles");
/** Permissao de sempre do PDV dentro do sistema. */
exports.PERMISSAO_PDV = 'vendas.pdv';
/** Funcionario caixa: entra direto no caixa e so' nele. */
exports.PERMISSAO_SO_CAIXA = 'vendas.so_caixa';
/** Qualquer uma destas opera o caixa (abrir/fechar caixa, vender, receber). */
exports.PERMISSOES_QUE_OPERAM_O_CAIXA = [exports.PERMISSAO_PDV, exports.PERMISSAO_SO_CAIXA];
/** Modulo do plano que o caixa usa (bloqueio pelo SuperAdmin, ver moduleCatalog.ts). */
exports.MODULO_DO_CAIXA = 'comercial.pedidos';
exports.CAMINHO_APP_CAIXA = '/caixa';
exports.CAMINHO_LOGIN_CAIXA = '/caixa/login';
/** Arquivo HTML real do app (manifest/icone proprios): start_url do manifest e pagina de instalacao. */
exports.CAMINHO_INSTALACAO_CAIXA = '/caixa.html';
/** A pagina aberta e' o app do caixa (e nao o sistema ou o app do vendedor)? */
const ehAppDoCaixa = (pathname) => (pathname === exports.CAMINHO_APP_CAIXA || pathname.startsWith(`${exports.CAMINHO_APP_CAIXA}/`) || pathname === exports.CAMINHO_INSTALACAO_CAIXA);
exports.ehAppDoCaixa = ehAppDoCaixa;
const tem = (perfil, permissao) => (Array.isArray(perfil.permissoes) && perfil.permissoes.includes(permissao));
/** Pode abrir a Frente de Caixa (no sistema ou no app)? */
const podeUsarFrenteDeCaixa = (perfil) => ((0, roles_1.hasTenantFullAccess)(perfil.role, Boolean(perfil.isOwner))
    || exports.PERMISSOES_QUE_OPERAM_O_CAIXA.some((permissao) => tem(perfil, permissao)));
exports.podeUsarFrenteDeCaixa = podeUsarFrenteDeCaixa;
/** Funcionario caixa: o login cai direto no caixa e o sistema nao aparece. Nunca vale para dono/administrador. */
const entraDiretoNoCaixa = (perfil) => (!(0, roles_1.hasTenantFullAccess)(perfil.role, Boolean(perfil.isOwner)) && tem(perfil, exports.PERMISSAO_SO_CAIXA));
exports.entraDiretoNoCaixa = entraDiretoNoCaixa;
/** Para onde o login do sistema manda a pessoa. */
const destinoAposLogin = (perfil, loginDaPlataforma) => {
    if (loginDaPlataforma)
        return '/superadmin';
    return (0, exports.entraDiretoNoCaixa)(perfil) ? exports.CAMINHO_APP_CAIXA : '/dashboard';
};
exports.destinoAposLogin = destinoAposLogin;
exports.MENSAGEM_SEM_ACESSO_AO_CAIXA = 'Este login não tem acesso à Frente de Caixa. Peça ao administrador para liberar "Vendas: Frente de Caixa (PDV)" ou "Vendas: Só a Frente de Caixa" no seu usuário.';
