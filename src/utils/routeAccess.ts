export interface RouteAccess {
  routeModule: string;
  routePermission: string;
}

/**
 * Deriva o modulo/permissao exigidos por uma rota a partir do path, pelo
 * mesmo mapeamento por prefixo que ja existia embutido em AppLayout.tsx.
 * Extraido pra funcao pura (Sistema de Abas, F19 fase B) porque agora
 * cada aba resolve isso a partir da SUA PROPRIA localizacao interna (um
 * MemoryRouter por aba), nao da localizacao real do navegador.
 */
export const resolveRouteAccess = (pathname: string): RouteAccess => {
  const path = pathname.toLowerCase();

  let routeModule = '';
  if (path.startsWith('/clientes')) routeModule = 'cadastros.clientes';
  else if (path.startsWith('/usuarios')) routeModule = 'cadastros.usuarios';
  else if (path.startsWith('/veiculos')) routeModule = 'cadastros.veiculos';
  else if (path.startsWith('/estoque')) routeModule = 'cadastros.estoque';
  else if (path.startsWith('/servicos')) routeModule = 'cadastros.servicos';
  else if (path.startsWith('/categorias')) routeModule = 'cadastros.categorias';
  else if (path.startsWith('/unidades-medida')) routeModule = 'cadastros.unidades_medida';
  else if (path.startsWith('/fornecedores')) routeModule = 'cadastros.fornecedores';
  else if (path.startsWith('/pedidos-venda')) routeModule = 'comercial.pedidos';
  else if (path.startsWith('/orcamentos')) routeModule = 'comercial.orcamentos';
  else if (path.startsWith('/vendas/devolucoes') || path.startsWith('/vendas')) routeModule = 'comercial.devolucoes';
  else if (path.startsWith('/relatorios-vendas')) routeModule = 'comercial.relatorios';
  else if (path.startsWith('/os')) routeModule = 'mecanica.os';
  else if (path.startsWith('/relatorios-mecanica')) routeModule = 'mecanica.relatorios';
  else if (path.startsWith('/crm/agenda')) routeModule = 'crm.agenda';
  else if (path.startsWith('/crm/lembretes') || path.startsWith('/crm')) routeModule = 'crm.lembretes';
  else if (path.startsWith('/financeiro/caixa')) routeModule = 'financeiro.caixa';
  else if (path.startsWith('/financeiro/contas-receber')) routeModule = 'financeiro.receber';
  else if (path.startsWith('/financeiro/contas-pagar')) routeModule = 'financeiro.pagar';
  else if (path.startsWith('/financeiro/faturamento')) routeModule = 'financeiro.faturamento';
  else if (path.startsWith('/financeiro/comissoes') || path.startsWith('/financeiro')) routeModule = 'financeiro.comissoes';
  else if (path.startsWith('/fiscal/nfe')) routeModule = 'fiscal.nfe';
  else if (path.startsWith('/fiscal/entrada-nfe') || path.startsWith('/fiscal')) routeModule = 'fiscal.entrada_nfe';
  else if (path.startsWith('/relatorios-diversos')) routeModule = 'logs.relatorios_diversos';
  else if (path.startsWith('/logs-sistema')) routeModule = 'logs.sistema';
  else if (path.startsWith('/configuracoes')) routeModule = 'admin.config';

  let routePermission = '';
  if (path.startsWith('/clientes') || path.startsWith('/veiculos')) routePermission = 'cadastros.clientes';
  else if (path.startsWith('/usuarios')) routePermission = 'administrativo.equipe';
  else if (path.startsWith('/estoque')) routePermission = 'cadastros.estoque';
  else if (path.startsWith('/servicos')) routePermission = 'cadastros.servicos';
  else if (path.startsWith('/categorias')) routePermission = 'cadastros.categorias';
  else if (path.startsWith('/unidades-medida')) routePermission = 'cadastros.unidades_medida';
  else if (path.startsWith('/fornecedores')) routePermission = 'cadastros.estoque';
  else if (path.startsWith('/pedidos-venda')) routePermission = 'vendas.pedidos';
  else if (path.startsWith('/orcamentos')) routePermission = 'vendas.orcamentos';
  else if (path.startsWith('/vendas/devolucoes') || path.startsWith('/vendas')) routePermission = 'vendas.devolucao';
  else if (path.startsWith('/relatorios-vendas')) routePermission = 'vendas.relatorios';
  else if (path.startsWith('/os')) routePermission = 'mecanica.os';
  else if (path.startsWith('/relatorios-mecanica')) routePermission = 'mecanica.relatorios';
  else if (path.startsWith('/crm/agenda')) routePermission = 'crm.agenda';
  else if (path.startsWith('/crm/lembretes') || path.startsWith('/crm')) routePermission = 'crm.alertas';
  else if (path.startsWith('/financeiro/caixa')) routePermission = 'financeiro.caixa';
  else if (path.startsWith('/financeiro/contas-receber')) routePermission = 'financeiro.receber';
  else if (path.startsWith('/financeiro/contas-pagar')) routePermission = 'financeiro.pagar';
  else if (path.startsWith('/financeiro/faturamento')) routePermission = 'financeiro.faturamento';
  else if (path.startsWith('/financeiro/comissoes') || path.startsWith('/financeiro')) routePermission = 'financeiro.comissoes';
  else if (path.startsWith('/fiscal/nfe')) routePermission = 'fiscal.emitir';
  else if (path.startsWith('/fiscal/entrada-nfe') || path.startsWith('/fiscal')) routePermission = 'fiscal.entrada';
  else if (path.startsWith('/logs-sistema')) routePermission = 'administrativo.logs';
  else if (path.startsWith('/configuracoes')) routePermission = 'administrativo.config';

  return { routeModule, routePermission };
};
