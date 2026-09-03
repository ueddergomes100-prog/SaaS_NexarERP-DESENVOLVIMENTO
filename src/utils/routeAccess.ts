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
  if (path.startsWith('/dashboard')) routeModule = 'dashboard.empresa';
  else if (path.startsWith('/clientes')) routeModule = 'cadastros.clientes';
  else if (path.startsWith('/usuarios')) routeModule = 'cadastros.usuarios';
  else if (path.startsWith('/veiculos')) routeModule = 'cadastros.veiculos';
  // As 3 sub-telas do Ajuste Manual de Estoque precisam vir ANTES do
  // generico '/estoque' logo abaixo (mais especifico primeiro, senao nunca
  // seriam alcancadas) -- e 'relatorio-ajustes' antes de 'relatorio' pelo
  // mesmo motivo (prefixo mais longo primeiro).
  else if (path.startsWith('/estoque/ajuste')) routeModule = 'estoque.ajusteManual';
  else if (path.startsWith('/estoque/relatorio-ajustes')) routeModule = 'estoque.relatorioAjustes';
  else if (path.startsWith('/estoque/relatorio')) routeModule = 'estoque.relatorio';
  else if (path.startsWith('/estoque/notas-avulsas')) routeModule = 'estoque.nota_avulsa';
  else if (path.startsWith('/estoque')) routeModule = 'cadastros.estoque';
  else if (path.startsWith('/servicos')) routeModule = 'cadastros.servicos';
  else if (path.startsWith('/categorias')) routeModule = 'cadastros.categorias';
  else if (path.startsWith('/unidades-medida')) routeModule = 'cadastros.unidades_medida';
  else if (path.startsWith('/bandeiras-cartao')) routeModule = 'cadastros.bandeiras_cartao';
  else if (path.startsWith('/bancos')) routeModule = 'cadastros.bancos';
  else if (path.startsWith('/fornecedores')) routeModule = 'cadastros.fornecedores';
  else if (path.startsWith('/materias-primas')) routeModule = 'cadastros.materia_prima';
  else if (path.startsWith('/vendedores')) routeModule = 'cadastros.vendedores';
  else if (path.startsWith('/producao/ordens') || path.startsWith('/producao/relatorios')) routeModule = 'operacoes.producao';
  else if (path.startsWith('/operacoes/expedicao') || path.startsWith('/operacoes/conferencia')) routeModule = 'operacoes.expedicao';
  else if (path.startsWith('/pedidos-venda')) routeModule = 'comercial.pedidos';
  else if (path.startsWith('/minhas-vendas')) routeModule = 'comercial.pedidos';
  else if (path.startsWith('/orcamentos')) routeModule = 'comercial.orcamentos';
  else if (path.startsWith('/vendas/devolucoes')) routeModule = 'comercial.devolucoes';
  else if (path.startsWith('/pre-vendas')) routeModule = 'comercial.relatorios';
  else if (path.startsWith('/relatorios-vendas')) routeModule = 'comercial.relatorios';
  else if (path.startsWith('/os')) routeModule = 'mecanica.os';
  else if (path.startsWith('/relatorios-mecanica')) routeModule = 'mecanica.relatorios';
  else if (path.startsWith('/crm/agenda')) routeModule = 'crm.agenda';
  else if (path.startsWith('/crm/lembretes') || path.startsWith('/crm')) routeModule = 'crm.lembretes';
  else if (path.startsWith('/financeiro/caixa-registros')) routeModule = 'financeiro.caixa_registros';
  else if (path.startsWith('/financeiro/caixa')) routeModule = 'financeiro.caixa';
  else if (path.startsWith('/financeiro/banco')) routeModule = 'financeiro.banco';
  else if (path.startsWith('/financeiro/contas-receber')) routeModule = 'financeiro.receber';
  else if (path.startsWith('/financeiro/contas-pagar')) routeModule = 'financeiro.pagar';
  else if (path.startsWith('/financeiro/faturamento')) routeModule = 'financeiro.faturamento';
  else if (path.startsWith('/financeiro/comissoes') || path.startsWith('/financeiro')) routeModule = 'financeiro.comissoes';
  else if (path.startsWith('/fiscal/nfe')) routeModule = 'fiscal.nfe';
  else if (path.startsWith('/fiscal/entrada-nfe') || path.startsWith('/fiscal')) routeModule = 'fiscal.entrada_nfe';
  else if (path.startsWith('/utilitarios/sintegra')) routeModule = 'utilitarios.sintegra';
  else if (path.startsWith('/relatorios-diversos')) routeModule = 'logs.relatorios_diversos';
  else if (path.startsWith('/logs-sistema')) routeModule = 'logs.sistema';
  else if (path.startsWith('/configuracoes')) routeModule = 'admin.config';
  // Modulos de roadmap (telas ainda no mockup RoadmapModule). Precisam vir
  // DEPOIS das rotas reais de /operacoes -- /operacoes/expedicao ja foi
  // resolvido acima; aqui sobra so /operacoes/lotes-validades.
  else if (path.startsWith('/compras/pedidos-compra')) routeModule = 'compras.pedidos';
  else if (path.startsWith('/compras/cotacoes')) routeModule = 'compras.cotacoes';
  else if (path.startsWith('/integracoes/nuvemshop')) routeModule = 'integracoes.nuvemshop';
  else if (path.startsWith('/integracoes/marketplaces')) routeModule = 'integracoes.marketplaces';
  else if (path.startsWith('/integracoes/sincronizacoes')) routeModule = 'integracoes.sincronizacoes';
  else if (path.startsWith('/operacoes/lotes-validades')) routeModule = 'operacoes.lotes';

  let routePermission = '';
  if (path.startsWith('/dashboard')) routePermission = 'dashboard.acesso';
  else if (path.startsWith('/clientes')) routePermission = 'cadastros.clientes';
  // Separada de cadastros.clientes em 2026-08-27 -- as duas telas
  // dividiam o mesmo id, sem controle independente.
  else if (path.startsWith('/veiculos')) routePermission = 'cadastros.veiculos';
  else if (path.startsWith('/usuarios')) routePermission = 'administrativo.equipe';
  else if (path.startsWith('/estoque/ajuste')) routePermission = 'estoque.ajusteManual';
  else if (path.startsWith('/estoque/relatorio-ajustes')) routePermission = 'estoque.relatorioAjustes';
  else if (path.startsWith('/estoque/relatorio')) routePermission = 'estoque.relatorio';
  else if (path.startsWith('/estoque/notas-avulsas')) routePermission = 'estoque.nota_avulsa';
  else if (path.startsWith('/estoque')) routePermission = 'cadastros.estoque';
  else if (path.startsWith('/servicos')) routePermission = 'cadastros.servicos';
  else if (path.startsWith('/categorias')) routePermission = 'cadastros.categorias';
  else if (path.startsWith('/unidades-medida')) routePermission = 'cadastros.unidades_medida';
  else if (path.startsWith('/bandeiras-cartao')) routePermission = 'cadastros.bandeiras_cartao';
  else if (path.startsWith('/bancos')) routePermission = 'cadastros.bancos';
  // Fornecedores ganhou permissao propria em 2026-08-18 (antes usava
  // cadastros.estoque emprestado). Decisao consciente do usuario: quem hoje
  // acessa via Estoque perde o acesso ate receber a permissao nova.
  else if (path.startsWith('/fornecedores')) routePermission = 'cadastros.fornecedores';
  else if (path.startsWith('/materias-primas')) routePermission = 'cadastros.materia_prima';
  else if (path.startsWith('/vendedores')) routePermission = 'cadastros.vendedores';
  else if (path.startsWith('/producao/ordens')) routePermission = 'operacoes.producao';
  // Separada de operacoes.producao em 2026-08-27 -- as duas telas
  // dividiam o mesmo id, sem controle independente.
  else if (path.startsWith('/producao/relatorios')) routePermission = 'operacoes.producao_relatorios';
  else if (path.startsWith('/operacoes/expedicao') || path.startsWith('/operacoes/conferencia')) routePermission = 'operacoes.expedicao';
  else if (path.startsWith('/pedidos-venda')) routePermission = 'vendas.pedidos';
  // Separada de vendas.pedidos em 2026-08-27 -- Minhas Vendas e o PDV
  // (este ultimo fora do sistema de rotas, ver PDV.tsx) dividiam o mesmo
  // id de Pedidos de Venda, sem controle independente.
  else if (path.startsWith('/minhas-vendas')) routePermission = 'vendas.minhas_vendas';
  else if (path.startsWith('/orcamentos')) routePermission = 'vendas.orcamentos';
  else if (path.startsWith('/vendas/devolucoes')) routePermission = 'vendas.devolucao';
  else if (path.startsWith('/pre-vendas')) routePermission = 'vendas.pre_venda_relatorio';
  else if (path.startsWith('/relatorios-vendas')) routePermission = 'vendas.relatorios';
  else if (path.startsWith('/os')) routePermission = 'mecanica.os';
  else if (path.startsWith('/relatorios-mecanica')) routePermission = 'mecanica.relatorios';
  else if (path.startsWith('/crm/agenda')) routePermission = 'crm.agenda';
  else if (path.startsWith('/crm/lembretes') || path.startsWith('/crm')) routePermission = 'crm.alertas';
  else if (path.startsWith('/financeiro/caixa-registros')) routePermission = 'financeiro.caixa_registros';
  else if (path.startsWith('/financeiro/caixa')) routePermission = 'financeiro.caixa';
  else if (path.startsWith('/financeiro/banco')) routePermission = 'financeiro.banco';
  else if (path.startsWith('/financeiro/contas-receber')) routePermission = 'financeiro.receber';
  else if (path.startsWith('/financeiro/contas-pagar')) routePermission = 'financeiro.pagar';
  else if (path.startsWith('/financeiro/faturamento')) routePermission = 'financeiro.faturamento';
  else if (path.startsWith('/financeiro/comissoes') || path.startsWith('/financeiro')) routePermission = 'financeiro.comissoes';
  else if (path.startsWith('/fiscal/nfe')) routePermission = 'fiscal.emitir';
  // Precisa vir ANTES do branch generico de /fiscal/entrada-nfe logo
  // abaixo (senao esta subrota nunca seria alcancada) -- separada em
  // 2026-08-27 porque as duas telas dividiam o mesmo id, sem controle
  // independente.
  else if (path.startsWith('/fiscal/entrada-nfe/historico')) routePermission = 'fiscal.entrada_historico';
  else if (path.startsWith('/fiscal/entrada-nfe') || path.startsWith('/fiscal')) routePermission = 'fiscal.entrada';
  else if (path.startsWith('/utilitarios/sintegra')) routePermission = 'utilitarios.sintegra';
  else if (path.startsWith('/relatorios-diversos')) routePermission = 'administrativo.relatorios';
  else if (path.startsWith('/logs-sistema')) routePermission = 'administrativo.logs';
  else if (path.startsWith('/configuracoes')) routePermission = 'administrativo.config';
  // Roadmap: mesma permissao do modulo, pra o toggle da tela de permissoes
  // ter efeito real em vez de ser decorativo.
  else if (path.startsWith('/compras/pedidos-compra')) routePermission = 'compras.pedidos';
  else if (path.startsWith('/compras/cotacoes')) routePermission = 'compras.cotacoes';
  else if (path.startsWith('/integracoes/nuvemshop')) routePermission = 'integracoes.nuvemshop';
  else if (path.startsWith('/integracoes/marketplaces')) routePermission = 'integracoes.marketplaces';
  else if (path.startsWith('/integracoes/sincronizacoes')) routePermission = 'integracoes.sincronizacoes';
  else if (path.startsWith('/operacoes/lotes-validades')) routePermission = 'operacoes.lotes';

  return { routeModule, routePermission };
};
