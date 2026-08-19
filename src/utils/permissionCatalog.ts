/**
 * Catalogo de permissao GRANULAR do Funcionario (id no formato dominio.acao),
 * gravado em usuarios/{id}.permissoes e checado em firestore.rules +
 * routeAccess.ts (`routePermission`) + .includes() espalhados pelas telas.
 *
 * Deliberadamente um vocabulario DIFERENTE do MODULE_GROUPS de
 * src/utils/moduleCatalog.ts -- aquele controla o bloqueio de modulo por
 * plano SaaS (SuperAdmin, `routeModule`); este controla o que cada
 * funcionario pode fazer dentro da empresa.
 *
 * REGRA PERMANENTE: toda tela/permissao nova precisa entrar AQUI e em
 * MODULE_GROUPS, e ter uma branch correspondente em routeAccess.ts -- senao
 * a tela fica acessivel por URL direta mesmo sem a permissao (auditoria
 * 2026-08-05).
 *
 * Extraido de um literal embutido em Configuracoes.tsx em 2026-08-18, quando
 * a tela de Usuarios passou a definir permissoes tambem. Ter a lista em dois
 * componentes era garantia de divergencia com o tempo.
 */

export interface PermissionCatalogItem {
  id: string;
  label: string;
  color: string;
}

export interface PermissionCatalogGroup {
  grupo: string;
  itens: PermissionCatalogItem[];
}

/**
 * Agrupado por area para caber num popup sem virar uma parede de 41 toggles.
 * A ordem dos grupos segue o fluxo de uso do sistema (operacao -> apoio ->
 * administracao), nao a ordem alfabetica.
 */
export const PERMISSION_GROUPS: PermissionCatalogGroup[] = [
  {
    grupo: 'Visão Geral',
    itens: [
      { id: 'dashboard.valores', label: 'Dashboard: Visão Financeira', color: '#10b981' },
    ],
  },
  {
    grupo: 'Vendas',
    itens: [
      { id: 'vendas.pedidos', label: 'Vendas: Pedidos de Venda', color: '#f59e0b' },
      { id: 'vendas.alterar', label: 'Vendas: Alterar Pedidos', color: '#f59e0b' },
      { id: 'vendas.excluir', label: 'Vendas: Excluir Pedidos', color: '#ef4444' },
      { id: 'vendas.devolucao', label: 'Vendas: Devolução de Venda', color: '#ef4444' },
      { id: 'vendas.orcamentos', label: 'Vendas: Orçamentos', color: '#f59e0b' },
      { id: 'vendas.orcamentos_alterar', label: 'Vendas: Alterar Orçamentos', color: '#f59e0b' },
      { id: 'vendas.orcamentos_excluir', label: 'Vendas: Excluir Orçamentos', color: '#ef4444' },
      { id: 'vendas.relatorios', label: 'Vendas: Relatórios', color: '#f59e0b' },
    ],
  },
  {
    grupo: 'Serviços',
    itens: [
      { id: 'mecanica.os', label: 'Serviços: Ordens de Serviço', color: '#3b82f6' },
      { id: 'mecanica.os_alterar', label: 'Serviços: Alterar OS', color: '#3b82f6' },
      { id: 'mecanica.os_excluir', label: 'Serviços: Excluir OS', color: '#ef4444' },
      { id: 'mecanica.relatorios', label: 'Serviços: Relatórios', color: '#3b82f6' },
    ],
  },
  {
    grupo: 'Cadastros',
    itens: [
      { id: 'cadastros.clientes', label: 'Cadastros: Clientes', color: '#8b5cf6' },
      { id: 'cadastros.estoque', label: 'Cadastros: Estoque / Produtos', color: '#8b5cf6' },
      { id: 'cadastros.servicos', label: 'Cadastros: Serviços', color: '#8b5cf6' },
      { id: 'cadastros.categorias', label: 'Cadastros: Categorias', color: '#8b5cf6' },
      { id: 'cadastros.unidades_medida', label: 'Cadastros: Unidades de Medida', color: '#8b5cf6' },
      { id: 'cadastros.bandeiras_cartao', label: 'Cadastros: Bandeiras de Cartão', color: '#8b5cf6' },
      { id: 'cadastros.bancos', label: 'Cadastros: Bancos', color: '#8b5cf6' },
      { id: 'cadastros.materia_prima', label: 'Cadastros: Matéria-Prima', color: '#8b5cf6' },
    ],
  },
  {
    grupo: 'Produção e Expedição',
    itens: [
      { id: 'operacoes.producao', label: 'Produção: Ordens de Produção', color: '#f97316' },
      { id: 'operacoes.expedicao', label: 'Expedição: Conferência de Mercadoria', color: '#14b8a6' },
    ],
  },
  {
    grupo: 'Financeiro',
    itens: [
      { id: 'financeiro.caixa', label: 'Financeiro: Fluxo de Caixa', color: '#10b981' },
      { id: 'financeiro.caixa_registros', label: 'Financeiro: Caixa (Sessões PDV)', color: '#10b981' },
      { id: 'financeiro.banco', label: 'Financeiro: Banco (Conciliação de Cartão)', color: '#10b981' },
      { id: 'financeiro.receber', label: 'Financeiro: Contas a Receber', color: '#10b981' },
      { id: 'financeiro.pagar', label: 'Financeiro: Contas a Pagar', color: '#10b981' },
      { id: 'financeiro.faturamento', label: 'Financeiro: Faturamento', color: '#10b981' },
      { id: 'financeiro.comissoes', label: 'Financeiro: Comissões', color: '#10b981' },
      { id: 'financeiro.estornar', label: 'Financeiro: Estornar Pagamento/Recebimento', color: '#10b981' },
    ],
  },
  {
    grupo: 'Fiscal e Utilitários',
    itens: [
      { id: 'fiscal.emitir', label: 'Fiscal: Emitir Nota Fiscal', color: '#f59e0b' },
      { id: 'fiscal.entrada', label: 'Fiscal: Entrada de XML', color: '#f59e0b' },
      { id: 'fiscal.excluir', label: 'Fiscal: Excluir/Cancelar Nota Fiscal', color: '#ef4444' },
      { id: 'utilitarios.sintegra', label: 'Utilitários: SINTEGRA', color: '#94a3b8' },
    ],
  },
  {
    grupo: 'Relacionamento',
    itens: [
      { id: 'crm.agenda', label: 'CRM: Agendamentos', color: '#ec4899' },
      { id: 'crm.alertas', label: 'CRM: Alertas de Retorno', color: '#ec4899' },
    ],
  },
  {
    grupo: 'Administrativo',
    itens: [
      { id: 'administrativo.config', label: 'Admin: Configurações', color: '#6b7280' },
      { id: 'administrativo.equipe', label: 'Admin: Equipe e Acessos', color: '#6b7280' },
      { id: 'administrativo.logs', label: 'Admin: Logs do Sistema', color: '#6b7280' },
      { id: 'administrativo.relatorios', label: 'Admin: Relatórios Diversos', color: '#6b7280' },
    ],
  },
  {
    // Modulos ainda em roadmap: as telas sao o mockup "Em breve"
    // (RoadmapModule). Antes de 2026-08-18 nao tinham permissao NEM branch em
    // routeAccess.ts -- ou seja, todo funcionario via esses itens no menu e
    // ninguem conseguia esconde-los. Agora a permissao existe e o gate e'
    // real: desmarcada, o item some do menu e a rota redireciona.
    grupo: 'Módulos em Breve',
    itens: [
      { id: 'compras.pedidos', label: 'Compras: Pedidos de Compra (em breve)', color: '#64748b' },
      { id: 'compras.cotacoes', label: 'Compras: Cotação de Compra (em breve)', color: '#64748b' },
      { id: 'integracoes.nuvemshop', label: 'E-commerce: Nuvemshop (em breve)', color: '#64748b' },
      { id: 'integracoes.marketplaces', label: 'E-commerce: Marketplaces (em breve)', color: '#64748b' },
      { id: 'integracoes.sincronizacoes', label: 'E-commerce: Sincronizações (em breve)', color: '#64748b' },
      { id: 'operacoes.lotes', label: 'Operações: Lotes e Validades (em breve)', color: '#64748b' },
    ],
  },
];

/** Lista plana, na ordem dos grupos. */
export const PERMISSION_CATALOG: PermissionCatalogItem[] = PERMISSION_GROUPS.flatMap(g => g.itens);

export const permissionLabelMap = PERMISSION_CATALOG.reduce<Record<string, string>>((acc, item) => {
  acc[item.id] = item.label;
  return acc;
}, {});
