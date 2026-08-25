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

export type NivelAcesso = 'funcionario' | 'administracao';

export const NIVEIS_ACESSO: NivelAcesso[] = ['funcionario', 'administracao'];

export const DEFAULT_NIVEL_ACESSO: NivelAcesso = 'funcionario';

export const DEFAULT_RESTRINGIR_VENDAS_POR_USUARIO = false;

export const NIVEL_ACESSO_LABELS: Record<NivelAcesso, string> = {
  funcionario: 'Funcionário',
  administracao: 'Administração',
};

export const parseNivelAcesso = (raw: unknown): NivelAcesso => {
  return NIVEIS_ACESSO.includes(raw as NivelAcesso) ? raw as NivelAcesso : DEFAULT_NIVEL_ACESSO;
};

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
 */
export const somenteVendasProprias = (args: {
  restricaoAtiva: boolean;
  nivelAcesso: NivelAcesso;
  role: unknown;
  isOwner: boolean;
}): boolean => {
  if (!args.restricaoAtiva) return false;
  if (hasTenantFullAccess(args.role, args.isOwner)) return false;
  return args.nivelAcesso === 'funcionario';
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
