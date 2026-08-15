export interface ModuleCatalogItem {
  id: string;
  label: string;
}

export interface ModuleCatalogGroup {
  group: string;
  items: ModuleCatalogItem[];
}

/**
 * Catalogo de MODULOS bloqueaveis pelo SuperAdmin por tenant (plano SaaS),
 * gravado em usuarios/{tenantOwnerId}.modulosBloqueados e comparado contra
 * `routeModule` em src/utils/routeAccess.ts (ver TabPane.tsx/Sidebar.tsx).
 * Vocabulario DIFERENTE, de proposito, da permissao granular do Funcionario
 * (ver o array embutido em src/pages/Configuracoes/Configuracoes.tsx, secao
 * "Modulos Permitidos") -- um controla o plano contratado da empresa, o
 * outro o que cada funcionario pode fazer dentro dela.
 * Toda vez que uma tela/modulo novo for implantado, adicionar tanto aqui
 * quanto no catalogo granular de Configuracoes.tsx -- e confirmar que existe
 * uma branch correspondente em routeAccess.ts (routeModule E routePermission),
 * senao o bloqueio/permissao nao tem efeito real na rota (auditoria 2026-08-05).
 */
export const MODULE_GROUPS: ModuleCatalogGroup[] = [
  { group: 'Visão Geral', items: [
    { id: 'dashboard.empresa', label: 'Dashboard da Empresa' }
  ]},
  { group: 'Cadastros', items: [
    { id: 'cadastros.clientes', label: 'Clientes' },
    { id: 'cadastros.usuarios', label: 'Usuários' },
    { id: 'cadastros.veiculos', label: 'Veículos' },
    { id: 'cadastros.estoque', label: 'Estoque / Produtos' },
    { id: 'cadastros.servicos', label: 'Cadastro de Serviços' },
    { id: 'cadastros.categorias', label: 'Categorias' },
    { id: 'cadastros.unidades_medida', label: 'Unidades de Medida' },
    { id: 'cadastros.bandeiras_cartao', label: 'Bandeiras de Cartão' },
    { id: 'cadastros.bancos', label: 'Bancos' },
    { id: 'cadastros.fornecedores', label: 'Fornecedores' },
    { id: 'cadastros.materia_prima', label: 'Matéria-Prima' }
  ]},
  { group: 'Comercial & Vendas', items: [
    { id: 'comercial.pedidos', label: 'Pedido de Vendas' },
    { id: 'comercial.orcamentos', label: 'Orçamentos' },
    { id: 'comercial.relatorios', label: 'Relatório de Vendas' }
  ]},
  { group: 'Serviços & Operações', items: [
    { id: 'mecanica.os', label: 'Ordens de Serviço' },
    { id: 'mecanica.relatorios', label: 'Relatório de Serviços' }
  ]},
  { group: 'CRM & Agenda', items: [
    { id: 'crm.agenda', label: 'Agendamentos' },
    { id: 'crm.lembretes', label: 'Alertas de Retorno' }
  ]},
  { group: 'Financeiro', items: [
    { id: 'financeiro.caixa', label: 'Fluxo de Caixa' },
    { id: 'financeiro.caixa_registros', label: 'Caixa (Sessões PDV)' },
    { id: 'financeiro.banco', label: 'Banco (Conciliação de Cartão)' },
    { id: 'financeiro.receber', label: 'Contas a Receber' },
    { id: 'financeiro.pagar', label: 'Contas a Pagar' },
    { id: 'financeiro.faturamento', label: 'Painel de Faturamento' },
    { id: 'financeiro.comissoes', label: 'Controle de Comissões' }
  ]},
  { group: 'Fiscal', items: [
    { id: 'fiscal.nfe', label: 'Notas Fiscais' },
    { id: 'fiscal.entrada_nfe', label: 'Entrada de XML' }
  ]},
  { group: 'Compras & Fornecedores', items: [
    { id: 'compras.pedidos', label: 'Pedidos de Compra' },
    { id: 'compras.cotacoes', label: 'Cotação de Compra' }
  ]},
  { group: 'E-commerce & Integrações', items: [
    { id: 'integracoes.nuvemshop', label: 'Nuvemshop' },
    { id: 'integracoes.marketplaces', label: 'Marketplaces' },
    { id: 'integracoes.sincronizacoes', label: 'Sincronizações' }
  ]},
  { group: 'Produção & Logística', items: [
    { id: 'operacoes.producao', label: 'Produção Interna' },
    { id: 'operacoes.expedicao', label: 'Expedição e Entregas' },
    { id: 'operacoes.lotes', label: 'Lotes e Validades' }
  ]},
  { group: 'Administrativo & Logs', items: [
    { id: 'admin.config', label: 'Configurações Gerais' },
    { id: 'admin.backup', label: 'Backup e Restauração' },
    { id: 'logs.relatorios_diversos', label: 'Relatórios Diversos' },
    { id: 'logs.sistema', label: 'Logs do Sistema' }
  ]}
];

export const moduleLabelMap = MODULE_GROUPS.flatMap(group => group.items).reduce<Record<string, string>>((acc, item) => {
  acc[item.id] = item.label;
  return acc;
}, {});
