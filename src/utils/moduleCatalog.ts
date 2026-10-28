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
    { id: 'cadastros.veiculos', label: 'Veículos' },
    { id: 'cadastros.servicos', label: 'Cadastro de Serviços' }
  ]},
  { group: 'Estoque', items: [
    { id: 'cadastros.estoque', label: 'Estoque / Produtos' },
    { id: 'estoque.ajusteManual', label: 'Ajuste Manual de Estoque' },
    { id: 'estoque.balanco', label: 'Balanço (inventário)' },
    { id: 'estoque.relatorio', label: 'Relatório de Estoque' },
    { id: 'operacoes.lotes', label: 'Lotes e Validades' },
    { id: 'estoque.movimentacao', label: 'Movimentação de Produtos' },
    { id: 'estoque.relatorioAjustes', label: 'Relatório de Ajustes de Estoque' },
    { id: 'estoque.nota_avulsa', label: 'Nota Avulsa (Compra Manual)' },
    { id: 'estoque.precificacao', label: 'Precificação (preços em lote)' },
    { id: 'estoque.etiquetas', label: 'Etiquetas (gerar e imprimir)' }
  ]},
  { group: 'Cadastros Auxiliares', items: [
    { id: 'cadastros.categorias', label: 'Categorias' },
    { id: 'cadastros.marcas', label: 'Marcas' },
    { id: 'cadastros.unidades_medida', label: 'Unidades de Medida' },
    { id: 'cadastros.grades', label: 'Grades de produto (tamanho, cor)' },
    { id: 'cadastros.bandeiras_cartao', label: 'Bandeiras de Cartão' },
    { id: 'cadastros.bancos', label: 'Bancos' },
    { id: 'cadastros.fornecedores', label: 'Fornecedores' },
    { id: 'cadastros.materia_prima', label: 'Matéria-Prima' },
    { id: 'cadastros.vendedores', label: 'Vendedores (balcão)' }
  ]},
  { group: 'Comercial & Vendas', items: [
    { id: 'comercial.pedidos', label: 'Pedido de Vendas' },
    { id: 'comercial.promocoes', label: 'Promoções' },
    { id: 'comercial.cashback', label: 'Cashback' },
    { id: 'comercial.entregas_futuras', label: 'Entregas Futuras' },
    { id: 'comercial.orcamentos', label: 'Orçamentos' },
    { id: 'comercial.devolucoes', label: 'Devolução de Venda' },
    { id: 'comercial.trocas', label: 'Trocas de Mercadoria' },
    { id: 'comercial.condicional', label: 'Condicional' },
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
    { id: 'financeiro.cheques', label: 'Cheques (Compensação)' },
    { id: 'financeiro.boletos', label: 'Boletos (Emissão, Remessa e Retorno)' },
    { id: 'financeiro.receber', label: 'Contas a Receber' },
    { id: 'financeiro.pagar', label: 'Contas a Pagar' },
    { id: 'financeiro.faturamento', label: 'Painel de Faturamento' },
    { id: 'financeiro.custos', label: 'Custos e Formação de Preço' },
    { id: 'financeiro.comissoes', label: 'Controle de Comissões' }
  ]},
  { group: 'Fiscal', items: [
    { id: 'fiscal.nfe', label: 'Notas Fiscais' },
    { id: 'fiscal.relatorio_contador', label: 'Relatório do Contador' },
    { id: 'fiscal.entrada_nfe', label: 'Entrada de XML' }
  ]},
  { group: 'Utilitários', items: [
    { id: 'utilitarios.sintegra', label: 'SINTEGRA' }
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
    { id: 'operacoes.rotas', label: 'Rotas e Motoristas' },
    { id: 'operacoes.romaneios', label: 'Romaneio de Entrega' },
    { id: 'operacoes.frota', label: 'Frota e Custo por Veículo' }
  ]},
  { group: 'Administrativo & Logs', items: [
    { id: 'cadastros.usuarios', label: 'Usuários' },
    { id: 'admin.config', label: 'Configurações Gerais' },
    { id: 'admin.backup', label: 'Backup e Restauração' },
    { id: 'logs.relatorios_diversos', label: 'Relatórios Diversos' },
    { id: 'logs.sistema', label: 'Logs do Sistema' }
  ]}
];

/**
 * Modulos separados em 28/10/2026 (pedido do dono): antes iam junto do modulo
 * "pai" e nao dava para bloquear separado. Bloquear o pai bloqueia o filho
 * (quem ja tinha o pai bloqueado nao ganha tela nova); o filho bloqueia sozinho.
 */
export const MODULO_PAI: Record<string, string> = {
  'comercial.promocoes': 'comercial.pedidos',
  'comercial.cashback': 'comercial.pedidos',
  'comercial.entregas_futuras': 'comercial.pedidos',
  'estoque.balanco': 'estoque.ajusteManual',
  'operacoes.lotes': 'estoque.relatorio',
  'estoque.movimentacao': 'estoque.relatorio',
  'operacoes.romaneios': 'operacoes.rotas',
  'operacoes.frota': 'operacoes.rotas',
  'financeiro.custos': 'financeiro.faturamento',
  'fiscal.relatorio_contador': 'fiscal.nfe',
};

/** Bloqueios que valem de verdade: os gravados mais os filhos de pai bloqueado. */
export const modulosBloqueadosEfetivos = (bloqueados: readonly string[]): string[] => {
  const filhos = Object.keys(MODULO_PAI).filter((filho) => bloqueados.includes(MODULO_PAI[filho]) && !bloqueados.includes(filho));
  return filhos.length === 0 ? [...bloqueados] : [...bloqueados, ...filhos];
};

export const moduleLabelMap =MODULE_GROUPS.flatMap(group => group.items).reduce<Record<string, string>>((acc, item) => {
  acc[item.id] = item.label;
  return acc;
}, {});
