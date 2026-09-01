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

import { hasTenantFullAccess } from './roles';

/**
 * Cargo da pessoa dentro da empresa, no que diz respeito a VENDAS.
 *
 * Tres niveis (2026-09-01, pedido do cliente): funcionario ve so as proprias
 * vendas; supervisor e gerente veem as de todo mundo. O DONO nao entra na
 * lista -- ele ja e' identificado por ser quem criou a empresa, e nao ha o que
 * escolher na ficha dele.
 *
 * Supervisor e gerente se comportam IGUAL aqui, e isso e' de proposito: o que
 * o cliente pediu foi poder chamar cada um pelo nome que a loja usa, nao dois
 * comportamentos diferentes. Se um dia precisarem divergir, o lugar de mudar
 * e' `podeVerVendasDeTodos` -- nao espalhado pelas telas.
 *
 * O valor antigo 'administracao' continua sendo aceito e vira 'gerente': as
 * empresas que ja marcaram alguem assim nao podem perder o acesso por causa da
 * troca de nome.
 */
export type NivelAcesso = 'funcionario' | 'supervisor' | 'gerente';

export const NIVEIS_ACESSO: NivelAcesso[] = ['funcionario', 'supervisor', 'gerente'];

export const DEFAULT_NIVEL_ACESSO: NivelAcesso = 'funcionario';

export const DEFAULT_RESTRINGIR_VENDAS_POR_USUARIO = false;

export const NIVEL_ACESSO_LABELS: Record<NivelAcesso, string> = {
  funcionario: 'Funcionário',
  supervisor: 'Supervisor',
  gerente: 'Gerente',
};

/** Uma linha explicando cada cargo, pra ficha do usuario nao virar adivinhacao. */
export const NIVEL_ACESSO_DESCRICOES: Record<NivelAcesso, string> = {
  funcionario: 'Vê apenas as próprias vendas quando a empresa liga a restrição.',
  supervisor: 'Vê as vendas de toda a equipe, sem precisar de outros acessos.',
  gerente: 'Vê as vendas de toda a equipe, sem precisar de outros acessos.',
};

export const parseNivelAcesso = (raw: unknown): NivelAcesso => {
  // Nome antigo do nivel de cima, gravado antes de 2026-09-01.
  if (raw === 'administracao') return 'gerente';
  return NIVEIS_ACESSO.includes(raw as NivelAcesso) ? raw as NivelAcesso : DEFAULT_NIVEL_ACESSO;
};

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
export const podeVerVendasDeTodos = (args: {
  nivelAcesso: NivelAcesso;
  role: unknown;
  isOwner: boolean;
}): boolean => (
  hasTenantFullAccess(args.role, args.isOwner) || args.nivelAcesso !== 'funcionario'
);

export const parseRestringirVendasPorUsuario = (raw: unknown): boolean => {
  return raw === true;
};

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
export const somenteVendasProprias = (args: {
  restricaoAtiva: boolean;
  nivelAcesso: NivelAcesso;
  role: unknown;
  isOwner: boolean;
  /** A empresa exige codigo + PIN do vendedor a cada venda? */
  identificacaoVendedorAtiva?: boolean;
}): boolean => {
  if (!args.restricaoAtiva) return false;
  if (args.identificacaoVendedorAtiva) return false;
  return !podeVerVendasDeTodos(args);
};

/** Campos onde a venda guarda "de quem ela e'", em ordem de confianca.
 *  `vendedorId` e' o escolhido no formulario; `usuarioResponsavelId` e' o
 *  nome antigo do mesmo campo; `criadoPor` e' o fallback de metadados. */
export interface VendaComVendedor {
  vendedorId?: string | null;
  usuarioResponsavelId?: string | null;
  criadoPor?: string | null;
}

export const vendedorDaVenda = (venda: VendaComVendedor | null | undefined): string => {
  if (!venda) return '';
  return venda.vendedorId || venda.usuarioResponsavelId || venda.criadoPor || '';
};

/**
 * A venda pertence a este usuario? Venda antiga sem nenhum dos tres campos
 * NAO e' de ninguem -- fica escondida do funcionario restrito em vez de
 * aparecer pra todos. Esconder de menos vaza dado que a empresa mandou
 * esconder; esconder de mais so obriga o administrador a olhar.
 */
export const isVendaDoUsuario = (
  venda: VendaComVendedor | null | undefined,
  usuarioId: string | null | undefined,
): boolean => {
  if (!usuarioId) return false;
  return vendedorDaVenda(venda) === usuarioId;
};

/**
 * Filtra uma lista de vendas pelo que o usuario pode ver.
 * `usuarioId` null/vazio = sem restricao (ve tudo) -- e' o valor que
 * `vendasVisiveisDeUsuarioId` do AuthContext entrega pra quem tem acesso
 * total, pra tela nao precisar repetir o `if`.
 */
export const filtrarVendasVisiveis = <T extends VendaComVendedor>(
  vendas: T[],
  usuarioId: string | null | undefined,
): T[] => {
  if (!usuarioId) return vendas;
  return vendas.filter((venda) => isVendaDoUsuario(venda, usuarioId));
};

/** Mensagem unica pra quando o funcionario tenta abrir/imprimir a venda de
 *  outro pelo link direto. Fica aqui pra as telas nao inventarem cada uma
 *  a sua. */
export const MENSAGEM_VENDA_DE_OUTRO_USUARIO =
  'Esta venda foi registrada por outro vendedor e sua empresa configurou o sistema para que cada vendedor veja apenas as próprias vendas. Se você precisa consultá-la, peça a um usuário com nível Administração.';

export const TITULO_VENDA_DE_OUTRO_USUARIO = 'Venda de outro vendedor';

/** Lancamento financeiro (transacoes) que PODE ter vindo de uma venda. */
export interface LancamentoComOrigem extends VendaComVendedor {
  sourceType?: string | null;
  pedidoId?: string | null;
}

/**
 * O lancamento veio de uma venda? So esses entram na regra de
 * visibilidade -- despesa, aporte, recebimento de OS e lancamento manual
 * nao pertencem a vendedor nenhum.
 */
export const lancamentoVeioDeVenda = (lancamento: LancamentoComOrigem | null | undefined): boolean => {
  if (!lancamento) return false;
  return lancamento.sourceType === 'pedido_venda' || Boolean(lancamento.pedidoId);
};

/**
 * Filtra lancamentos financeiros pelo que o usuario pode ver.
 *
 * Diferente de `filtrarVendasVisiveis`: aqui o que NAO veio de venda fica
 * na lista. Esconder a conta de luz do funcionario que tem acesso ao
 * Financeiro nao tem nada a ver com esta configuracao -- quem nao deve
 * abrir o Financeiro e' barrado pela permissao do modulo, nao por aqui.
 */
export const filtrarLancamentosVisiveis = <T extends LancamentoComOrigem>(
  lancamentos: T[],
  usuarioId: string | null | undefined,
): T[] => {
  if (!usuarioId) return lancamentos;
  return lancamentos.filter((lancamento) => (
    !lancamentoVeioDeVenda(lancamento) || isVendaDoUsuario(lancamento, usuarioId)
  ));
};
