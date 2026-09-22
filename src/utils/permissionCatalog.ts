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
      // Acesso a TELA (bloqueia /dashboard inteiro sem ela -- ver
      // routeAccess.ts). Deliberadamente separada de dashboard.valores,
      // que so controla os numeros financeiros DENTRO da tela: um
      // funcionario pode ter acesso ao dashboard operacional sem ver
      // dinheiro, mas sem esta aqui ele nao abre a tela de jeito nenhum.
      { id: 'dashboard.acesso', label: 'Dashboard: Acesso à Tela', color: '#10b981' },
      { id: 'dashboard.valores', label: 'Dashboard: Visão Financeira', color: '#10b981' },
    ],
  },
  {
    grupo: 'Vendas',
    itens: [
      { id: 'vendas.pedidos', label: 'Vendas: Pedidos de Venda', color: '#f59e0b' },
      // Separadas de vendas.pedidos em 2026-08-27: as 3 telas dividiam o
      // mesmo id (marcar Pedidos de Venda liberava PDV e Minhas Vendas
      // tambem, sem controle independente -- achado pelo usuario).
      { id: 'vendas.minhas_vendas', label: 'Vendas: Minhas Vendas', color: '#f59e0b' },
      { id: 'vendas.pdv', label: 'Vendas: Frente de Caixa (PDV)', color: '#f59e0b' },
      { id: 'vendas.alterar', label: 'Vendas: Alterar Pedidos', color: '#f59e0b' },
      { id: 'vendas.excluir', label: 'Vendas: Excluir Pedidos', color: '#ef4444' },
      { id: 'vendas.devolucao', label: 'Vendas: Devolução de Venda', color: '#ef4444' },
      // Trocas (reposicao sem cobranca de produto estragado). Duas permissoes de
      // proposito: quem PEDE a troca (vendedor no aplicativo) nao e' quem APROVA e
      // baixa o estoque (a loja). Ver docs/PLANO_TROCAS_VENDEDOR.md.
      { id: 'vendas.troca_solicitar', label: 'Vendas: Trocas — Pedir troca (aplicativo)', color: '#f59e0b' },
      { id: 'vendas.troca_gerenciar', label: 'Vendas: Trocas — Aprovar, entregar e ver relatório', color: '#ef4444' },
      { id: 'vendas.pedidos_pendentes_editar', label: 'Vendas: Editar/Finalizar Pedido Pendente (agente)', color: '#f59e0b' },
      { id: 'vendas.pedidos_pendentes_editar_cliente', label: 'Vendas: Pendente — Editar Cliente', color: '#f59e0b' },
      { id: 'vendas.pedidos_pendentes_alterar_qtd', label: 'Vendas: Pendente — Alterar Quantidade', color: '#f59e0b' },
      { id: 'vendas.pedidos_pendentes_adicionar_item', label: 'Vendas: Pendente — Adicionar Produto', color: '#f59e0b' },
      { id: 'vendas.pedidos_pendentes_excluir_item', label: 'Vendas: Pendente — Excluir Item', color: '#ef4444' },
      // Pre-venda (balcao). Deliberadamente SEPARADO das permissoes de
      // "Pendente" acima, que valem so pro pedido vindo do agente de
      // WhatsApp: quem mexe na pre-venda do balcao nao deve ganhar acesso
      // ao pedido que chegou pelo WhatsApp de brinde, nem o contrario.
      // So valem se "Trabalha com pré-venda" estiver ligado nas
      // Configurações do sistema -- config libera pra empresa, permissao
      // decide quem.
      { id: 'vendas.pre_venda_criar', label: 'Vendas: Pré-venda — Gravar', color: '#f59e0b' },
      { id: 'vendas.pre_venda_editar', label: 'Vendas: Pré-venda — Editar em Aberto', color: '#f59e0b' },
      { id: 'vendas.pre_venda_finalizar', label: 'Vendas: Pré-venda — Transformar em venda (finalizar)', color: '#ef4444' },
      { id: 'vendas.pre_venda_cancelar', label: 'Vendas: Pré-venda — Cancelar', color: '#ef4444' },
      { id: 'vendas.pre_venda_relatorio', label: 'Vendas: Relatório de Pré-vendas em Aberto', color: '#f59e0b' },
      // Idem: so vale com "Permitir alterar a forma de pagamento de venda
      // já finalizada" ligado nas Configurações.
      { id: 'vendas.alterar_pagamento_finalizada', label: 'Vendas: Alterar Pagamento de Venda Finalizada', color: '#ef4444' },
      // Gerenciar codigo e senha de vendedor (identificacao na venda). Quem
      // tem isto pode cadastrar a senha de OUTRA pessoa -- e portanto vender
      // no nome dela. Tratada como permissao vermelha por isso.
      { id: 'vendas.gerenciar_pin_vendedor', label: 'Vendas: Gerenciar Código/Senha de Vendedor', color: '#ef4444' },
      { id: 'vendas.orcamentos', label: 'Vendas: Orçamentos', color: '#f59e0b' },
      { id: 'vendas.orcamentos_alterar', label: 'Vendas: Alterar Orçamentos', color: '#f59e0b' },
      { id: 'vendas.orcamentos_excluir', label: 'Vendas: Excluir Orçamentos', color: '#ef4444' },
      { id: 'vendas.relatorios', label: 'Vendas: Relatórios', color: '#f59e0b' },
      { id: 'vendas.liberar_desconto', label: 'Vendas: Aprovar Desconto Acima do Limite', color: '#ef4444' },
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
      // Separada de cadastros.clientes em 2026-08-27: marcar Clientes
      // liberava Veiculos junto, sem controle independente.
      { id: 'cadastros.veiculos', label: 'Cadastros: Veículos', color: '#8b5cf6' },
      { id: 'cadastros.servicos', label: 'Cadastros: Serviços', color: '#8b5cf6' },
      { id: 'cadastros.categorias', label: 'Cadastros: Categorias', color: '#8b5cf6' },
      { id: 'cadastros.marcas', label: 'Cadastros: Marcas', color: '#8b5cf6' },
      { id: 'cadastros.unidades_medida', label: 'Cadastros: Unidades de Medida', color: '#8b5cf6' },
      { id: 'cadastros.bandeiras_cartao', label: 'Cadastros: Bandeiras de Cartão', color: '#8b5cf6' },
      { id: 'cadastros.bancos', label: 'Cadastros: Bancos', color: '#8b5cf6' },
      { id: 'cadastros.fornecedores', label: 'Cadastros: Fornecedores', color: '#8b5cf6' },
      { id: 'cadastros.materia_prima', label: 'Cadastros: Matéria-Prima', color: '#8b5cf6' },
      { id: 'cadastros.vendedores', label: 'Cadastros: Vendedores (balcão)', color: '#8b5cf6' },
    ],
  },
  {
    grupo: 'Estoque',
    itens: [
      { id: 'cadastros.estoque', label: 'Estoque: Ver Lista de Produtos', color: '#0ea5e9' },
      // Separada de cadastros.estoque em 2026-08-28: marcar "Ver Lista"
      // liberava abrir/criar/excluir o cadastro inteiro do produto (custo,
      // margem, fornecedor) sem controle independente -- achado pelo usuario.
      { id: 'cadastros.estoque_alterar', label: 'Estoque: Abrir Cadastro de Produto', color: '#0ea5e9' },
      { id: 'estoque.ajusteManual', label: 'Estoque: Ajuste Manual', color: '#0ea5e9' },
      { id: 'estoque.relatorio', label: 'Estoque: Relatório de Estoque', color: '#0ea5e9' },
      { id: 'estoque.relatorioAjustes', label: 'Estoque: Relatório de Ajustes', color: '#0ea5e9' },
      { id: 'estoque.nota_avulsa', label: 'Estoque: Nota Avulsa (Compra Manual)', color: '#0ea5e9' },
      { id: 'estoque.precificacao', label: 'Estoque: Precificação (preços em lote)', color: '#0ea5e9' },
      { id: 'estoque.etiquetas', label: 'Estoque: Etiquetas (gerar e imprimir)', color: '#0ea5e9' },
    ],
  },
  {
    grupo: 'Produção e Expedição',
    itens: [
      { id: 'operacoes.producao', label: 'Produção: Ordens de Produção', color: '#f97316' },
      // Separada de operacoes.producao em 2026-08-27: marcar Ordens de
      // Producao liberava o Relatorio junto, sem controle independente.
      { id: 'operacoes.producao_relatorios', label: 'Produção: Relatório de Produção', color: '#f97316' },
      { id: 'operacoes.expedicao', label: 'Expedição: Conferência de Mercadoria', color: '#14b8a6' },
      // Controle de rota: motoristas e as despesas da viagem. Uma permissao
      // so' para as duas telas -- quem lanca a despesa e' quem cadastra o
      // motorista (a loja), nao faz sentido separar.
      { id: 'operacoes.rotas', label: 'Rotas: Motoristas e Despesas de Viagem', color: '#14b8a6' },
    ],
  },
  {
    grupo: 'Financeiro',
    itens: [
      { id: 'financeiro.caixa', label: 'Financeiro: Fluxo de Caixa', color: '#10b981' },
      { id: 'financeiro.caixa_registros', label: 'Financeiro: Caixa (Sessões PDV)', color: '#10b981' },
      { id: 'financeiro.banco', label: 'Financeiro: Banco (Conciliação de Cartão)', color: '#10b981' },
      { id: 'financeiro.cheques', label: 'Financeiro: Cheques (Compensação)', color: '#10b981' },
      { id: 'financeiro.boletos', label: 'Financeiro: Boletos (Emissão, Remessa e Retorno)', color: '#10b981' },
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
      // Separada de fiscal.entrada em 2026-08-27: marcar Entrada de XML
      // liberava o Historico de Entradas junto, sem controle independente.
      { id: 'fiscal.entrada_historico', label: 'Fiscal: Histórico de Entradas', color: '#f59e0b' },
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

/**
 * Id da permissao de liberar desconto acima do limite.
 *
 * Vale pros DOIS tipos de aprovador: usuario com login (confirma com a senha)
 * e vendedor de balcao sem login (confirma com o proprio PIN). E' de proposito
 * a mesma permissao -- o que muda e como a pessoa prova quem e', nao o que ela
 * pode fazer.
 */
export const PERMISSAO_LIBERAR_DESCONTO = 'vendas.liberar_desconto';

/**
 * MARCAR/DESMARCAR TODAS AS PERMISSOES DE UMA VEZ.
 *
 * Pedido do dono (2026-09-21): "so botou um seletor que ativa todas as
 * permissoes, ai faz o inverso, ai vem desmarcando qual nao quer". Ligar 40+
 * toggles na mao pra depois tirar 3 e' trabalho a toa.
 *
 * As funcoes recebem a lista de ids VISIVEIS na tela, nao o catalogo inteiro:
 * com a busca preenchida ("estoque"), marcar todas tem que marcar so o que a
 * pessoa esta vendo. Mexer no que esta filtrado FORA da tela seria alterar o
 * que ninguem viu -- o jeito mais facil de tirar um acesso sem querer.
 *
 * "Marcar todas" NAO e' o mesmo que dar acesso total: e' uma foto do catalogo
 * de hoje. Permissao criada depois nao entra sozinha em quem foi marcado
 * assim. Quem precisa de "tudo, sempre" usa o nivel de acesso total, que ja
 * existe e nao depende desta lista.
 */

/** Acrescenta os ids visiveis ao que ja estava marcado, sem duplicar e sem
 *  mexer no que esta fora da tela. */
export const marcarPermissoes = (atuais: string[], idsVisiveis: string[]): string[] => {
  const juntas = new Set(atuais);
  idsVisiveis.forEach((id) => juntas.add(id));
  return Array.from(juntas);
};

/** Tira os ids visiveis, preservando o que esta fora da tela (filtrado pela
 *  busca) exatamente como estava. */
export const desmarcarPermissoes = (atuais: string[], idsVisiveis: string[]): string[] => {
  const remover = new Set(idsVisiveis);
  return atuais.filter((id) => !remover.has(id));
};

/**
 * Estado do seletor "todas": `todas`, `nenhuma` ou `parcial`.
 *
 * Lista vazia (busca sem resultado) devolve 'nenhuma' -- nao existe "todas as
 * zero permissoes marcadas", e um seletor ligado sobre uma lista vazia so
 * confundiria.
 */
export const estadoDaSelecao = (atuais: string[], idsVisiveis: string[]): 'todas' | 'nenhuma' | 'parcial' => {
  if (idsVisiveis.length === 0) return 'nenhuma';
  const marcadas = new Set(atuais);
  const quantas = idsVisiveis.filter((id) => marcadas.has(id)).length;
  if (quantas === 0) return 'nenhuma';
  return quantas === idsVisiveis.length ? 'todas' : 'parcial';
};
