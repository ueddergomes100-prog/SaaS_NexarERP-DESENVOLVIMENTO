"use strict";
// Visibilidade de vendas por usuario.
//
// Decisao de produto (2026-08-25): cada empresa escolhe se o funcionario
// enxerga as vendas dos colegas. Duas pecas, deliberadamente separadas:
//
// 1. `restringirVendasPorUsuario` -- chave por EMPRESA, em
//    configuracoes/{tenantId}. Default DESLIGADO: ligar por padrao mudaria
//    o que todo mundo ja ve hoje.
// 2. `nivelAcesso` -- campo por USUARIO, em usuarios/{uid}. Dois valores:
//    'funcionario' (default) e 'administracao'.
//
// A restricao so morde quem e' 'funcionario'. Quem e' 'administracao'
// continua vendo tudo, exatamente como hoje.
//
// Por que um campo novo em vez de reusar role='Admin': o papel Admin ja
// existe e significa "acesso total a TODOS os modulos", ignorando os
// toggles de Configuracoes > Permissao de Usuarios. Promover alguem a
// Admin so pra ele ver as vendas dos colegas abriria Financeiro, Fiscal e
// Estoque junto, sem ninguem pedir. `nivelAcesso` governa uma coisa so:
// visibilidade de venda. Quem ja tem acesso total pela role (dono, Master,
// Admin, SuperAdmin) segue vendo tudo -- ver `somenteVendasProprias`.
Object.defineProperty(exports, "__esModule", { value: true });
exports.filtrarLancamentosVisiveis = exports.lancamentoVeioDeVenda = exports.TITULO_VENDA_DE_OUTRO_USUARIO = exports.MENSAGEM_VENDA_DE_OUTRO_USUARIO = exports.filtrarVendasVisiveis = exports.isVendaDoUsuario = exports.vendedorDaVenda = exports.somenteVendasProprias = exports.parseRestringirVendasPorUsuario = exports.podeSerAlvoDePermissaoPorGerente = exports.podeCriarLoginDeEquipe = exports.PERMISSAO_EQUIPE = exports.podeGerenciarPermissoesDeEquipe = exports.podeVerVendasDeTodos = exports.parseNivelAcesso = exports.NIVEL_ACESSO_DESCRICOES = exports.NIVEL_ACESSO_LABELS = exports.DEFAULT_RESTRINGIR_VENDAS_POR_USUARIO = exports.DEFAULT_NIVEL_ACESSO = exports.NIVEIS_ACESSO = void 0;
const roles_1 = require("./roles");
exports.NIVEIS_ACESSO = ['funcionario', 'supervisor', 'gerente'];
exports.DEFAULT_NIVEL_ACESSO = 'funcionario';
exports.DEFAULT_RESTRINGIR_VENDAS_POR_USUARIO = false;
exports.NIVEL_ACESSO_LABELS = {
    funcionario: 'Funcionário',
    supervisor: 'Supervisor',
    gerente: 'Gerente',
};
/** Uma linha explicando cada cargo, pra ficha do usuario nao virar adivinhacao. */
exports.NIVEL_ACESSO_DESCRICOES = {
    funcionario: 'Vê apenas as próprias vendas quando a empresa liga a restrição.',
    supervisor: 'Vê as vendas de toda a equipe, sem precisar de outros acessos.',
    gerente: 'Vê as vendas de toda a equipe, sem precisar de outros acessos.',
};
const parseNivelAcesso = (raw) => {
    // Nome antigo do nivel de cima, gravado antes de 2026-09-01.
    if (raw === 'administracao')
        return 'gerente';
    return exports.NIVEIS_ACESSO.includes(raw) ? raw : exports.DEFAULT_NIVEL_ACESSO;
};
exports.parseNivelAcesso = parseNivelAcesso;
/**
 * ESTA PESSOA ENXERGA AS VENDAS DE TODO MUNDO?
 *
 * Resposta unica pras duas travas de visibilidade que o sistema tem -- a de
 * "so as proprias vendas" e a que esconde a lista geral no balcao
 * compartilhado. Antes cada uma decidia por conta propria, e por caminhos
 * diferentes: uma olhava o nivel de acesso, a outra so o papel (Master/Admin).
 * Resultado: marcar o gerente como nivel de cima nao devolvia a lista pra ele,
 * e nao havia tela nenhuma pra promover alguem a Admin.
 */
const podeVerVendasDeTodos = (args) => ((0, roles_1.hasTenantFullAccess)(args.role, args.isOwner) || args.nivelAcesso !== 'funcionario');
exports.podeVerVendasDeTodos = podeVerVendasDeTodos;
/**
 * ESTA PESSOA PODE MEXER NA PERMISSAO DE ACESSO DE OUTRO FUNCIONARIO?
 *
 * Decisao de produto (2026-09-23, pedido do dono): quem e' nivel 'gerente'
 * passa a poder marcar/desmarcar os modulos liberados dos Funcionarios da
 * equipe, sem precisar virar Admin/Master (que abriria TODO o sistema,
 * inclusive Financeiro/Fiscal, sem ninguem pedir -- mesmo raciocinio do
 * comentario no topo deste arquivo sobre nao reusar role='Admin').
 *
 * De proposito NAO cobre: inativar usuario, trocar senha de acesso (isso
 * continua so' Admin/Master/Dono, ver isTenantManagerRole; criar login o
 * gerente pode desde 26/10/2026, ver podeCriarLoginDeEquipe), e o
 * proprio ALVO tem que ser um Funcionario comum -- ver
 * podeSerAlvoDePermissaoPorGerente, que fecha quem o gerente pode editar.
 */
const podeGerenciarPermissoesDeEquipe = (args) => (0, roles_1.hasTenantFullAccess)(args.role, args.isOwner) || args.nivelAcesso === 'gerente';
exports.podeGerenciarPermissoesDeEquipe = podeGerenciarPermissoesDeEquipe;
/** Permissao da tela Equipe e Acessos (permissionCatalog.ts). */
exports.PERMISSAO_EQUIPE = 'administrativo.equipe';
/**
 * ESTA PESSOA PODE CRIAR LOGIN DE FUNCIONARIO? (26/10/2026, pedido urgente do dono)
 *
 * Alem de Admin/Master/Dono, o nivel 'gerente' que tem a tela Equipe e Acessos
 * liberada. Seguro porque o login nasce SEMPRE Funcionario comum, nivel
 * funcionario e sem permissao nenhuma (server/services/limitesDoPlano.js), e o
 * limite de usuarios do plano continua valendo. Inativar usuario, trocar senha
 * de acesso e liberar o app continuam so' Admin/Master/Dono.
 */
const podeCriarLoginDeEquipe = (args) => ((0, roles_1.hasTenantFullAccess)(args.role, args.isOwner)
    || (args.nivelAcesso === 'gerente' && Array.isArray(args.permissoes) && args.permissoes.includes(exports.PERMISSAO_EQUIPE)));
exports.podeCriarLoginDeEquipe = podeCriarLoginDeEquipe;
/**
 * O ALVO pode ter a permissao mexida por um Gerente (nao-Admin/Master)?
 *
 * Um Gerente nunca edita outro Gerente, Admin/Master ou o Dono, nem a si
 * mesmo -- so' quem e' Funcionario comum (nivel funcionario/supervisor). Sem
 * essa trava um Gerente poderia se auto-promover ou promover um colega a
 * Gerente e destravar tudo. Admin/Master/Dono nao passam por aqui: eles ja'
 * tem via `podeGerenciarPermissoesDeEquipe` acesso total, sem essa segunda
 * checagem (ver uso em UsuariosList.tsx).
 */
const podeSerAlvoDePermissaoPorGerente = (args) => (args.targetRole === 'Funcionario' &&
    args.targetNivelAcesso !== 'gerente' &&
    args.targetUserId !== args.actorUserId);
exports.podeSerAlvoDePermissaoPorGerente = podeSerAlvoDePermissaoPorGerente;
const parseRestringirVendasPorUsuario = (raw) => {
    return raw === true;
};
exports.parseRestringirVendasPorUsuario = parseRestringirVendasPorUsuario;
/**
 * O usuario atual esta limitado as proprias vendas?
 *
 * Precisa das QUATRO coisas ao mesmo tempo: a empresa ligou a restricao, o
 * usuario e' nivel 'funcionario', ele nao e' o dono da empresa e a role
 * dele nao ja da acesso total (Master/Admin/SuperAdmin/NexarAdmin). A
 * checagem por role e' de proposito redundante com o nivel: quem hoje e'
 * Admin nao pode perder visibilidade so porque o campo novo ainda nao foi
 * preenchido no documento dele.
 *
 * ---------------------------------------------------------------------------
 * A EXCECAO DO BALCAO COMPARTILHADO (2026-08-31)
 * ---------------------------------------------------------------------------
 *
 * Quando a empresa exige identificacao do vendedor a cada venda, quem esta
 * logado NAO e' uma pessoa -- e' a estacao (`balcao01`, `balcao02`...). A
 * venda fica gravada no nome do vendedor que digitou o PIN, que nunca e' o
 * uid da estacao.
 *
 * Filtrar por "minhas vendas = vendas do uid logado" nesse modo nao esconde
 * nada de ninguem: esconde TUDO da estacao, inclusive a venda que ela acabou
 * de fazer. Era esse o bug relatado -- finalizava a venda, clicava em
 * imprimir e o sistema respondia "venda de outro vendedor".
 *
 * Neste modo a separacao por pessoa continua existindo, mas por outro
 * caminho: a lista geral some pra quem nao e' gestor (ver
 * listaGeralDeVendasEscondidaParaFuncionario, em vendedorPinDomain.ts) e o
 * vendedor usa "Minhas Vendas", que se identifica pelo mesmo PIN. Quem
 * responde "de quem e' esta venda" e' o PIN, nao o login.
 */
const somenteVendasProprias = (args) => {
    if (!args.restricaoAtiva)
        return false;
    if (args.identificacaoVendedorAtiva)
        return false;
    return !(0, exports.podeVerVendasDeTodos)(args);
};
exports.somenteVendasProprias = somenteVendasProprias;
const vendedorDaVenda = (venda) => {
    if (!venda)
        return '';
    return venda.vendedorId || venda.usuarioResponsavelId || venda.criadoPor || '';
};
exports.vendedorDaVenda = vendedorDaVenda;
/**
 * A venda pertence a este usuario? Venda antiga sem nenhum dos tres campos
 * NAO e' de ninguem -- fica escondida do funcionario restrito em vez de
 * aparecer pra todos. Esconder de menos vaza dado que a empresa mandou
 * esconder; esconder de mais so obriga o administrador a olhar.
 */
const isVendaDoUsuario = (venda, usuarioId) => {
    if (!usuarioId)
        return false;
    return (0, exports.vendedorDaVenda)(venda) === usuarioId;
};
exports.isVendaDoUsuario = isVendaDoUsuario;
/**
 * Filtra uma lista de vendas pelo que o usuario pode ver.
 * `usuarioId` null/vazio = sem restricao (ve tudo) -- e' o valor que
 * `vendasVisiveisDeUsuarioId` do AuthContext entrega pra quem tem acesso
 * total, pra tela nao precisar repetir o `if`.
 */
const filtrarVendasVisiveis = (vendas, usuarioId) => {
    if (!usuarioId)
        return vendas;
    return vendas.filter((venda) => (0, exports.isVendaDoUsuario)(venda, usuarioId));
};
exports.filtrarVendasVisiveis = filtrarVendasVisiveis;
/** Mensagem unica pra quando o funcionario tenta abrir/imprimir a venda de
 *  outro pelo link direto. Fica aqui pra as telas nao inventarem cada uma
 *  a sua. */
exports.MENSAGEM_VENDA_DE_OUTRO_USUARIO = 'Esta venda foi registrada por outro vendedor e sua empresa configurou o sistema para que cada vendedor veja apenas as próprias vendas. Se você precisa consultá-la, peça a um usuário com nível Administração.';
exports.TITULO_VENDA_DE_OUTRO_USUARIO = 'Venda de outro vendedor';
/**
 * O lancamento veio de uma venda? So esses entram na regra de
 * visibilidade -- despesa, aporte, recebimento de OS e lancamento manual
 * nao pertencem a vendedor nenhum.
 */
const lancamentoVeioDeVenda = (lancamento) => {
    if (!lancamento)
        return false;
    return lancamento.sourceType === 'pedido_venda' || Boolean(lancamento.pedidoId);
};
exports.lancamentoVeioDeVenda = lancamentoVeioDeVenda;
/**
 * Filtra lancamentos financeiros pelo que o usuario pode ver.
 *
 * Diferente de `filtrarVendasVisiveis`: aqui o que NAO veio de venda fica
 * na lista. Esconder a conta de luz do funcionario que tem acesso ao
 * Financeiro nao tem nada a ver com esta configuracao -- quem nao deve
 * abrir o Financeiro e' barrado pela permissao do modulo, nao por aqui.
 */
const filtrarLancamentosVisiveis = (lancamentos, usuarioId) => {
    if (!usuarioId)
        return lancamentos;
    return lancamentos.filter((lancamento) => (!(0, exports.lancamentoVeioDeVenda)(lancamento) || (0, exports.isVendaDoUsuario)(lancamento, usuarioId)));
};
exports.filtrarLancamentosVisiveis = filtrarLancamentosVisiveis;
