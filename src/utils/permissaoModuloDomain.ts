/*
 * PERMISSAO x MODULO DO PLANO (19/10/2026, achado do dono).
 *
 * O SuperAdmin bloqueia MODULOS por empresa (moduleCatalog.ts, gravado em
 * `modulosBloqueados`); cada funcionario recebe PERMISSOES (permissionCatalog.ts).
 * Sao vocabularios diferentes de proposito -- mas a tela de permissoes deixava
 * ligar a permissao de um modulo que a empresa nem tem (ex.: Servicos
 * bloqueado e "Servicos: Ordens de Servico" ainda ligavel). Aqui fica a
 * ligacao: a permissao de um modulo bloqueado aparece apagada e nao liga.
 *
 * Mesma correspondencia de routeAccess.ts (routeModule x routePermission).
 * Permissao sem modulo (ex.: filiais.utilizar) nunca e' bloqueada pelo plano.
 */
import { moduleLabelMap } from './moduleCatalog';

/** Modulo(s) de cada permissao. Com mais de um, so' bloqueia quando TODOS estao bloqueados. */
const MODULOS_DA_PERMISSAO: Record<string, string[]> = {
  'dashboard.acesso': ['dashboard.empresa'],
  'dashboard.valores': ['dashboard.empresa'],

  'vendas.pedidos': ['comercial.pedidos'],
  'vendas.minhas_vendas': ['comercial.pedidos'],
  'vendas.pdv': ['comercial.pedidos'],
  'vendas.so_caixa': ['comercial.pedidos'],
  'vendas.alterar': ['comercial.pedidos'],
  'vendas.excluir': ['comercial.pedidos'],
  'vendas.promocoes': ['comercial.pedidos'],
  'vendas.pedidos_pendentes_editar': ['comercial.pedidos'],
  'vendas.pedidos_pendentes_editar_cliente': ['comercial.pedidos'],
  'vendas.pedidos_pendentes_alterar_qtd': ['comercial.pedidos'],
  'vendas.pedidos_pendentes_adicionar_item': ['comercial.pedidos'],
  'vendas.pedidos_pendentes_excluir_item': ['comercial.pedidos'],
  'vendas.pre_venda_criar': ['comercial.pedidos'],
  'vendas.pre_venda_editar': ['comercial.pedidos'],
  'vendas.pre_venda_finalizar': ['comercial.pedidos'],
  'vendas.pre_venda_cancelar': ['comercial.pedidos'],
  'vendas.alterar_pagamento_finalizada': ['comercial.pedidos'],
  'vendas.liberar_desconto': ['comercial.pedidos'],
  'vendas.pre_venda_relatorio': ['comercial.relatorios'],
  'vendas.relatorios': ['comercial.relatorios'],
  'vendas.devolucao': ['comercial.devolucoes'],
  'vendas.troca_solicitar': ['comercial.trocas'],
  'vendas.troca_gerenciar': ['comercial.trocas'],
  'vendas.condicional': ['comercial.condicional'],
  'vendas.gerenciar_pin_vendedor': ['cadastros.vendedores'],
  'vendas.orcamentos': ['comercial.orcamentos'],
  'vendas.orcamentos_alterar': ['comercial.orcamentos'],
  'vendas.orcamentos_excluir': ['comercial.orcamentos'],

  'mecanica.os_alterar': ['mecanica.os'],
  'mecanica.os_app': ['mecanica.os'],
  'mecanica.os_app_abrir': ['mecanica.os'],
  'mecanica.os_excluir': ['mecanica.os'],

  'cadastros.estoque_alterar': ['cadastros.estoque'],

  'operacoes.producao_relatorios': ['operacoes.producao'],
  'operacoes.romaneios': ['operacoes.rotas'],
  'operacoes.romaneios_reabrir': ['operacoes.rotas'],
  'operacoes.entregas_app': ['operacoes.rotas'],

  'financeiro.estornar': ['financeiro.receber', 'financeiro.pagar', 'financeiro.caixa'],
  'financeiro.alterar_valor_documento': ['financeiro.receber'],
  'financeiro.renegociar': ['financeiro.receber'],
  'financeiro.desconto_baixa': ['financeiro.receber', 'financeiro.pagar'],

  'fiscal.emitir': ['fiscal.nfe'],
  'fiscal.excluir': ['fiscal.nfe'],
  'fiscal.entrada': ['fiscal.entrada_nfe'],
  'fiscal.entrada_historico': ['fiscal.entrada_nfe'],

  'crm.alertas': ['crm.lembretes'],

  'administrativo.config': ['admin.config'],
  'administrativo.equipe': ['cadastros.usuarios'],
  'administrativo.logs': ['logs.sistema'],
  'administrativo.relatorios': ['logs.relatorios_diversos'],
};

/** Modulos de que a permissao depende. Mesmo id do modulo (ex.: financeiro.receber) vale direto. */
export const modulosDaPermissao = (permissao: string): string[] => (
  MODULOS_DA_PERMISSAO[permissao] || (moduleLabelMap[permissao] ? [permissao] : [])
);

/** A empresa nao tem o modulo desta permissao (bloqueado pelo SuperAdmin)? */
export const permissaoForaDoPlano = (permissao: string, modulosBloqueados: readonly string[] | null | undefined): boolean => {
  const modulos = modulosDaPermissao(permissao);
  if (modulos.length === 0 || !modulosBloqueados || modulosBloqueados.length === 0) return false;
  return modulos.every((m) => modulosBloqueados.includes(m));
};

export const MENSAGEM_FORA_DO_PLANO = 'Este módulo não está liberado para a sua empresa. Para usar, fale com o suporte.';
