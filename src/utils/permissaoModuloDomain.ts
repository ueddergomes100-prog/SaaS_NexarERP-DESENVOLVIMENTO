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
  // Modulos proprios desde 28/10/2026 (MODULO_PAI em moduleCatalog.ts).
  'vendas.promocoes': ['comercial.promocoes'],
  'vendas.cashback': ['comercial.cashback'],
  'operacoes.entregas_futuras': ['comercial.entregas_futuras'],
  'app.alterar_preco': ['comercial.pedidos'],
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
  'vendas.bonificar': ['comercial.pedidos'],
  'vendas.pre_venda_relatorio': ['comercial.relatorios'],
  'vendas.relatorios': ['comercial.relatorios'],
  'vendas.devolucao': ['comercial.devolucoes'],
  'vendas.troca_solicitar': ['comercial.trocas'],
  'vendas.troca_gerenciar': ['comercial.trocas'],
  'vendas.condicional': ['comercial.condicional'],
  'vendas.gerenciar_pin_vendedor': ['cadastros.vendedores'],
  'cadastros.vendedores_incluir': ['cadastros.vendedores'],
  'vendas.orcamentos': ['comercial.orcamentos'],
  'vendas.orcamentos_alterar': ['comercial.orcamentos'],
  'vendas.orcamentos_excluir': ['comercial.orcamentos'],
  // Item 15 (fase Vendas, 25/11/2026).
  'vendas.finalizar': ['comercial.pedidos'],
  'vendas.alterar_data': ['comercial.pedidos'],
  'vendas.alterar_vendedor': ['comercial.pedidos'],
  'vendas.alterar_preco': ['comercial.pedidos'],
  'vendas.desconto': ['comercial.pedidos'],
  'vendas.cancelar': ['comercial.pedidos'],
  'vendas.alterar_transporte': ['comercial.pedidos'],
  'vendas.alterar_nota_fiscal': ['comercial.pedidos'],
  'vendas.pedidos_pendentes_recusar': ['comercial.pedidos'],
  'vendas.imprimir': ['comercial.pedidos'],
  'vendas.documentos_cobranca': ['comercial.pedidos'],
  'vendas.importar': ['comercial.pedidos'],
  'vendas.pre_venda_relatorio_valores': ['comercial.relatorios'],
  'vendas.devolucao_estornar': ['comercial.devolucoes'],
  'vendas.orcamentos_recusar': ['comercial.orcamentos'],
  'vendas.orcamentos_converter': ['comercial.orcamentos'],
  'vendas.orcamentos_preco': ['comercial.orcamentos'],
  'vendas.orcamentos_enviar': ['comercial.orcamentos'],
  'vendas.condicional_saida': ['comercial.condicional'],
  'vendas.condicional_devolucao': ['comercial.condicional'],
  'vendas.condicional_fechar': ['comercial.condicional'],
  'vendas.condicional_cancelar': ['comercial.condicional'],
  'vendas.troca_aprovar': ['comercial.trocas'],
  'vendas.troca_entregar': ['comercial.trocas'],
  'vendas.troca_cancelar': ['comercial.trocas'],
  'vendas.promocoes_encerrar': ['comercial.promocoes'],
  'vendas.cashback_relatorio': ['comercial.cashback'],
  'operacoes.entregas_futuras_registrar': ['comercial.entregas_futuras'],

  'mecanica.os_alterar': ['mecanica.os'],
  'mecanica.os_app': ['mecanica.os'],
  'mecanica.os_app_abrir': ['mecanica.os'],
  'mecanica.os_excluir': ['mecanica.os'],

  'cadastros.estoque_alterar': ['cadastros.estoque'],
  'estoque.produto_avancado': ['cadastros.estoque'],

  'operacoes.producao_relatorios': ['operacoes.producao'],
  'operacoes.romaneios': ['operacoes.romaneios'],
  'operacoes.romaneios_reabrir': ['operacoes.romaneios'],
  'operacoes.entregas_app': ['operacoes.romaneios'],

  'financeiro.estornar': ['financeiro.receber', 'financeiro.pagar', 'financeiro.caixa'],
  'financeiro.alterar_valor_documento': ['financeiro.receber'],
  'financeiro.renegociar': ['financeiro.receber'],
  'financeiro.desconto_baixa': ['financeiro.receber', 'financeiro.pagar'],
  // Item 15 (25/11/2026): uma permissao por acao do Contas a Receber/Pagar.
  'financeiro.receber_baixar': ['financeiro.receber'],
  'financeiro.pagar_baixar': ['financeiro.pagar'],
  'financeiro.baixa_juros_multa': ['financeiro.receber', 'financeiro.pagar'],
  'financeiro.baixa_data_anterior': ['financeiro.receber', 'financeiro.pagar'],
  'financeiro.baixa_lote': ['financeiro.receber', 'financeiro.pagar'],
  'financeiro.receber_lancar': ['financeiro.receber'],
  'financeiro.receber_editar': ['financeiro.receber'],
  'financeiro.receber_cancelar': ['financeiro.receber'],
  'financeiro.categorias': ['financeiro.receber', 'financeiro.pagar'],
  'financeiro.acerto_fornecedor': ['financeiro.receber'],
  // Item 15, fase 2 (25/11/2026).
  'financeiro.pagar_lancar': ['financeiro.pagar'],
  'financeiro.pagar_editar': ['financeiro.pagar'],
  'financeiro.pagar_cancelar': ['financeiro.pagar'],
  'financeiro.baixa_credito_cliente': ['financeiro.receber'],
  'financeiro.recibo': ['financeiro.receber'],
  'financeiro.cobrar_whatsapp': ['financeiro.receber'],
  'financeiro.relatorios': ['financeiro.receber', 'financeiro.pagar', 'financeiro.caixa_registros', 'financeiro.banco', 'financeiro.cheques', 'financeiro.faturamento', 'financeiro.comissoes'],
  'financeiro.importar_titulos': ['financeiro.receber', 'financeiro.pagar'],
  // Caixas e transferencias (21/10/2026): parte do modulo do Fluxo de Caixa.
  'financeiro.caixas': ['financeiro.caixa'],

  'fiscal.emitir': ['fiscal.nfe'],
  'fiscal.excluir': ['fiscal.nfe'],
  'fiscal.relatorio_contador': ['fiscal.relatorio_contador'],
  'fiscal.tabelas': ['fiscal.nfe'],
  'fiscal.cce': ['fiscal.nfe'],
  'fiscal.inutilizar': ['fiscal.nfe'],
  'fiscal.devolucao': ['fiscal.nfe'],
  'fiscal.emitir_lote': ['fiscal.nfe'],
  'compras.gerar_pedido': ['compras.cotacoes'],
  'estoque.balanco_gerenciar': ['estoque.balanco'],
  'estoque.balanco_contar': ['estoque.balanco'],
  'fiscal.entrada': ['fiscal.entrada_nfe'],
  'fiscal.entrada_historico': ['fiscal.entrada_nfe'],

  'crm.alertas': ['crm.lembretes'],
  'crm.alertas_cancelar': ['crm.lembretes'],
  'crm.agenda_cancelar': ['crm.agenda'],
  'operacoes.expedicao_divergencia': ['operacoes.expedicao'],
  'operacoes.rotas_despesas': ['operacoes.rotas'],
  'operacoes.rotas_configurar': ['operacoes.rotas'],
  'operacoes.motoristas': ['operacoes.rotas'],
  'operacoes.rotas_relatorio': ['operacoes.rotas'],

  // Item 15 (fase Estoque e cadastros, 25/11/2026).
  'estoque.produto_incluir': ['cadastros.estoque'],
  'estoque.estoque_inicial': ['cadastros.estoque', 'cadastros.materia_prima'],
  'estoque.alterar_preco': ['cadastros.estoque', 'estoque.precificacao', 'fiscal.entrada_nfe'],
  'estoque.alterar_custo': ['cadastros.estoque', 'cadastros.materia_prima'],
  'estoque.ver_custo': ['cadastros.estoque', 'estoque.relatorio', 'estoque.precificacao'],
  'estoque.produto_inativar': ['cadastros.estoque'],
  'estoque.produto_excluir': ['cadastros.estoque'],
  'estoque.padronizar_nomes': ['cadastros.estoque'],
  'estoque.importar': ['cadastros.estoque'],
  'estoque.configurar_lista': ['cadastros.estoque'],
  'estoque.composicao': ['cadastros.estoque'],
  'estoque.comissao_desconto': ['cadastros.estoque'],
  'estoque.balanco_fechar': ['estoque.balanco'],
  'estoque.balanco_cancelar': ['estoque.balanco'],
  'estoque.etiquetas_modelo': ['estoque.etiquetas'],
  'estoque.nota_avulsa_cancelar': ['estoque.nota_avulsa'],
  'estoque.nota_avulsa_pagamento': ['estoque.nota_avulsa'],
  'fiscal.entrada_excluir': ['fiscal.entrada_nfe'],
  'operacoes.producao_finalizar': ['operacoes.producao'],
  'operacoes.producao_estornar': ['operacoes.producao'],
  'operacoes.producao_cancelar': ['operacoes.producao'],
  'mecanica.os_finalizar': ['mecanica.os'],
  'mecanica.os_reabrir': ['mecanica.os'],
  'mecanica.os_cancelar': ['mecanica.os'],
  'mecanica.os_alterar_preco': ['mecanica.os'],
  'mecanica.os_responsavel': ['mecanica.os'],
  'mecanica.os_fotos': ['mecanica.os'],
  'cadastros.clientes_alterar': ['cadastros.clientes'],
  'cadastros.clientes_inativar': ['cadastros.clientes'],
  'cadastros.clientes_importar': ['cadastros.clientes'],
  'cadastros.clientes_limite_credito': ['cadastros.clientes'],
  'cadastros.fornecedores_alterar': ['cadastros.fornecedores'],
  'cadastros.fornecedores_inativar': ['cadastros.fornecedores'],
  'cadastros.fornecedores_importar': ['cadastros.fornecedores'],
  'cadastros.servicos_alterar': ['cadastros.servicos'],
  'cadastros.servicos_inativar': ['cadastros.servicos'],
  'cadastros.servicos_preco': ['cadastros.servicos'],
  'cadastros.servicos_comissao': ['cadastros.servicos'],
  'cadastros.categorias_alterar': ['cadastros.categorias'],
  'cadastros.categorias_inativar': ['cadastros.categorias'],
  'cadastros.categorias_importar': ['cadastros.categorias'],
  'cadastros.marcas_alterar': ['cadastros.marcas'],
  'cadastros.marcas_inativar': ['cadastros.marcas'],
  'cadastros.unidades_medida_alterar': ['cadastros.unidades_medida'],
  'cadastros.unidades_medida_inativar': ['cadastros.unidades_medida'],
  'cadastros.grades_alterar': ['cadastros.grades'],
  'cadastros.grades_inativar': ['cadastros.grades'],
  'cadastros.veiculos_alterar': ['cadastros.veiculos'],
  'cadastros.veiculos_inativar': ['cadastros.veiculos'],
  'cadastros.materia_prima_inativar': ['cadastros.materia_prima'],
  'cadastros.materia_prima_custo': ['cadastros.materia_prima'],
  'cadastros.materia_prima_importar': ['cadastros.materia_prima'],
  'cadastros.relatorios': ['cadastros.clientes', 'cadastros.fornecedores', 'cadastros.servicos', 'cadastros.veiculos'],

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
