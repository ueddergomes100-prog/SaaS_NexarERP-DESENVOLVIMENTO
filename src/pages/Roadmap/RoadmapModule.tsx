import React from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  BarChart2,
  CheckCircle,
  ClipboardList,
  Database,
  Factory,
  Filter,
  Inbox,
  Link2,
  Package,
  Plus,
  Search,
  Settings,
  ShoppingCart,
  Store,
  Truck,
  Users
} from 'lucide-react';
import './RoadmapModule.css';

interface StatItem {
  label: string;
  tone: 'purple' | 'green' | 'blue' | 'yellow';
}

interface FlowItem {
  title: string;
  description: string;
}

interface ModuleConfig {
  title: string;
  subtitle: string;
  icon: React.ElementType;
  primaryAction: string;
  secondaryAction: string;
  searchPlaceholder: string;
  tableTitle: string;
  integrationTitle: string;
  emptyState: string;
  stats: StatItem[];
  flows: FlowItem[];
}

const moduleConfigs: Record<string, ModuleConfig> = {
  'pedidos-compra': {
    title: 'Pedidos de Compra',
    subtitle: 'Planejamento de compras integrado ao estoque, fornecedores e contas a pagar',
    icon: ClipboardList,
    primaryAction: 'Novo Pedido',
    secondaryAction: 'Importar Cotação',
    searchPlaceholder: 'Buscar pedido, fornecedor ou item...',
    tableTitle: 'Pedidos em acompanhamento',
    integrationTitle: 'Integrações previstas',
    emptyState: 'Nenhum pedido de compra cadastrado.',
    stats: [
      { label: 'Pedidos Abertos', tone: 'purple' },
      { label: 'Aguardando Entrega', tone: 'yellow' },
      { label: 'Recebidos no Mês', tone: 'green' }
    ],
    flows: [
      { title: 'Estoque', description: 'Sugere compra a partir de mínimo, giro e peças reservadas em OS.' },
      { title: 'Financeiro', description: 'Gera contas a pagar após aprovação ou entrada da NF-e.' },
      { title: 'Fiscal', description: 'Recebe XML e concilia itens comprados com produtos cadastrados.' }
    ]
  },
  fornecedores: {
    title: 'Fornecedores',
    subtitle: 'Cadastro comercial e fiscal para compras, XML de entrada e contas a pagar',
    icon: Users,
    primaryAction: 'Novo Fornecedor',
    secondaryAction: 'Revisar Dados',
    searchPlaceholder: 'Buscar fornecedor, CNPJ ou categoria...',
    tableTitle: 'Fornecedores cadastrados',
    integrationTitle: 'Dados conectados',
    emptyState: 'Nenhum fornecedor cadastrado.',
    stats: [
      { label: 'Ativos', tone: 'green' },
      { label: 'Com Pendência Fiscal', tone: 'yellow' },
      { label: 'Categorias', tone: 'blue' }
    ],
    flows: [
      { title: 'Compras', description: 'Alimenta pedidos de compra, cotações e histórico por fornecedor.' },
      { title: 'Fiscal', description: 'Valida CNPJ, endereço e dados para XML de entrada.' },
      { title: 'Financeiro', description: 'Padroniza prazos, categorias de despesa e contas a pagar.' }
    ]
  },
  cotacoes: {
    title: 'Cotação de Compra',
    subtitle: 'Comparação de fornecedores antes de gerar o pedido de compra',
    icon: Inbox,
    primaryAction: 'Nova Cotação',
    secondaryAction: 'Gerar Pedido',
    searchPlaceholder: 'Buscar cotação, item ou fornecedor...',
    tableTitle: 'Cotações recentes',
    integrationTitle: 'Fluxo de aprovação',
    emptyState: 'Nenhuma cotação de compra cadastrada.',
    stats: [
      { label: 'Em Aberto', tone: 'purple' },
      { label: 'Aprovadas', tone: 'green' },
      { label: 'Economia Média', tone: 'blue' }
    ],
    flows: [
      { title: 'Fornecedores', description: 'Agrupa preços, prazos e condições comerciais por fornecedor.' },
      { title: 'Estoque', description: 'Importa itens sugeridos por estoque mínimo ou venda futura.' },
      { title: 'Pedido de Compra', description: 'Transforma a cotação vencedora em pedido com um clique.' }
    ]
  },
  nuvemshop: {
    title: 'Nuvemshop',
    subtitle: 'Canal de venda integrado com produtos, estoque e pedidos do ERP',
    icon: Store,
    primaryAction: 'Conectar Loja',
    secondaryAction: 'Sincronizar Agora',
    searchPlaceholder: 'Buscar produto, SKU ou pedido externo...',
    tableTitle: 'Fila da Nuvemshop',
    integrationTitle: 'Sincronização do canal',
    emptyState: 'Nenhum registro sincronizado com a Nuvemshop.',
    stats: [
      { label: 'Produtos Vinculados', tone: 'green' },
      { label: 'Pedidos Pendentes', tone: 'yellow' },
      { label: 'Última Sincronia', tone: 'blue' }
    ],
    flows: [
      { title: 'Produtos', description: 'Relaciona SKUs da loja com produtos cadastrados no estoque.' },
      { title: 'Pedidos de Venda', description: 'Importa pedidos pagos como venda no ERP.' },
      { title: 'Fiscal', description: 'Prepara dados para emissão de nota após confirmação do pedido.' }
    ]
  },
  marketplaces: {
    title: 'Marketplaces',
    subtitle: 'Central para canais externos com regras de preço, estoque e pedido',
    icon: ShoppingCart,
    primaryAction: 'Novo Canal',
    secondaryAction: 'Ver Regras',
    searchPlaceholder: 'Buscar canal, anúncio ou SKU...',
    tableTitle: 'Canais e anúncios',
    integrationTitle: 'Regras por marketplace',
    emptyState: 'Nenhum marketplace cadastrado.',
    stats: [
      { label: 'Canais Ativos', tone: 'purple' },
      { label: 'Anúncios Vinculados', tone: 'green' },
      { label: 'Ajustes Pendentes', tone: 'yellow' }
    ],
    flows: [
      { title: 'Estoque', description: 'Reserva saldo por canal e evita venda sem disponibilidade.' },
      { title: 'Precificação', description: 'Aplica margem, comissão e frete por canal.' },
      { title: 'Pedidos', description: 'Centraliza pedidos externos em um fluxo único de venda.' }
    ]
  },
  sincronizacoes: {
    title: 'Sincronizações',
    subtitle: 'Painel de saúde das integrações de produtos, pedidos, estoque e fiscais',
    icon: Link2,
    primaryAction: 'Sincronizar Tudo',
    secondaryAction: 'Ver Logs',
    searchPlaceholder: 'Buscar evento, canal ou entidade...',
    tableTitle: 'Eventos de sincronização',
    integrationTitle: 'Monitoramento',
    emptyState: 'Nenhum evento de sincronização registrado.',
    stats: [
      { label: 'Eventos Hoje', tone: 'blue' },
      { label: 'Com Sucesso', tone: 'green' },
      { label: 'Atenção', tone: 'yellow' }
    ],
    flows: [
      { title: 'Produtos', description: 'Mantém cadastro e SKU alinhados entre ERP e canais externos.' },
      { title: 'Pedidos', description: 'Importa vendas e atualiza status de separação e entrega.' },
      { title: 'Auditoria', description: 'Registra falhas, reprocessamentos e usuários responsáveis.' }
    ]
  },
  producao: {
    title: 'Produção Interna',
    subtitle: 'Montagem de kits, consumo de insumos e entrada de produtos acabados',
    icon: Factory,
    primaryAction: 'Nova Produção',
    secondaryAction: 'Ver Fórmulas',
    searchPlaceholder: 'Buscar ordem, kit ou insumo...',
    tableTitle: 'Ordens de produção',
    integrationTitle: 'Movimentações automáticas',
    emptyState: 'Nenhuma ordem de produção cadastrada.',
    stats: [
      { label: 'Ordens Abertas', tone: 'purple' },
      { label: 'Kits Produzidos', tone: 'green' },
      { label: 'Insumos Críticos', tone: 'yellow' }
    ],
    flows: [
      { title: 'Estoque', description: 'Baixa insumos e dá entrada no produto produzido.' },
      { title: 'Vendas', description: 'Reserva kits para pedidos confirmados.' },
      { title: 'Custos', description: 'Calcula custo do produto acabado a partir dos componentes.' }
    ]
  },
  expedicao: {
    title: 'Expedição e Entregas',
    subtitle: 'Separação, conferência, envio e rastreio de pedidos vendidos',
    icon: Truck,
    primaryAction: 'Nova Expedição',
    secondaryAction: 'Conferir Pedidos',
    searchPlaceholder: 'Buscar pedido, cliente ou rastreio...',
    tableTitle: 'Pedidos em expedição',
    integrationTitle: 'Operação conectada',
    emptyState: 'Nenhuma expedição cadastrada.',
    stats: [
      { label: 'Para Separar', tone: 'yellow' },
      { label: 'Em Transporte', tone: 'blue' },
      { label: 'Entregues Hoje', tone: 'green' }
    ],
    flows: [
      { title: 'Pedidos de Venda', description: 'Recebe pedidos finalizados para separação e conferência.' },
      { title: 'Estoque', description: 'Confirma baixa física e trata divergências de separação.' },
      { title: 'Cliente', description: 'Atualiza status de entrega e histórico do atendimento.' }
    ]
  },
  'lotes-validades': {
    title: 'Lotes e Validades',
    subtitle: 'Rastreabilidade de produtos por lote, validade, entrada e saída',
    icon: Package,
    primaryAction: 'Novo Lote',
    secondaryAction: 'Auditar Saldos',
    searchPlaceholder: 'Buscar produto, lote ou validade...',
    tableTitle: 'Controle de lotes',
    integrationTitle: 'Rastreabilidade',
    emptyState: 'Nenhum lote cadastrado.',
    stats: [
      { label: 'Lotes Ativos', tone: 'green' },
      { label: 'Próx. Vencimento', tone: 'yellow' },
      { label: 'Bloqueados', tone: 'purple' }
    ],
    flows: [
      { title: 'Entrada NF-e', description: 'Cria lotes automaticamente ao importar XML de compra.' },
      { title: 'Estoque', description: 'Controla saldo por produto e por lote disponível.' },
      { title: 'Vendas e OS', description: 'Registra qual lote foi consumido em cada venda ou serviço.' }
    ]
  }
};

const toneClass = {
  purple: 'purple-bg',
  green: 'green-bg',
  blue: 'blue-bg',
  yellow: 'yellow-bg'
};

const RoadmapModule: React.FC = () => {
  const { moduleId } = useParams();
  const config = moduleConfigs[moduleId || 'pedidos-compra'] || moduleConfigs['pedidos-compra'];
  const Icon = config.icon;

  return (
    <div className="roadmap-page">
      <div className="roadmap-header page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Icon size={28} color="var(--accent-purple)" />
            {config.title}
          </h1>
          <p className="page-subtitle">{config.subtitle}</p>
        </div>
        <div className="roadmap-header-actions">
          <button className="btn-secondary">
            <Settings size={18} />
            {config.secondaryAction}
          </button>
          <button className="btn-primary">
            <Plus size={18} />
            {config.primaryAction}
          </button>
        </div>
      </div>

      <div className="roadmap-grid">
        {config.stats.map((stat) => (
          <div className="card stat-card" style={{ padding: '20px' }} key={stat.label}>
            <div className="stat-header">
              <div className={`stat-icon ${toneClass[stat.tone]}`}>
                <BarChart2 size={24} />
              </div>
              <span className="stat-trend positive">Previsto</span>
            </div>
            <div className="stat-info">
              <h3>0</h3>
              <p>{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="roadmap-main-grid">
        <div className="roadmap-card">
          <div className="roadmap-card-header">
            <div className="roadmap-card-title">
              <Database size={20} color="var(--accent-purple)" />
              <h3>{config.tableTitle}</h3>
            </div>
            <button className="btn-secondary">
              <Filter size={18} />
              Filtros
            </button>
          </div>
          <div className="roadmap-card-body">
            <div className="roadmap-filter-row">
              <div className="search-box">
                <Search size={18} className="search-icon" />
                <input type="text" placeholder={config.searchPlaceholder} />
              </div>
            </div>

            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Descrição</th>
                    <th>Origem</th>
                    <th>Status</th>
                    <th>Resumo</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '36px 20px', color: 'var(--text-muted)' }}>
                      {config.emptyState}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="roadmap-card">
          <div className="roadmap-card-header">
            <div className="roadmap-card-title">
              <Link2 size={20} color="var(--accent-purple)" />
              <h3>{config.integrationTitle}</h3>
            </div>
          </div>
          <div className="roadmap-card-body">
            <div className="roadmap-flow-list">
              {config.flows.map((flow) => (
                <div className="roadmap-flow-item" key={flow.title}>
                  <div className="roadmap-flow-icon">
                    <ArrowRight size={18} />
                  </div>
                  <div>
                    <strong>{flow.title}</strong>
                    <span>{flow.description}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="roadmap-card">
        <div className="roadmap-card-header">
          <div className="roadmap-card-title">
            <CheckCircle size={20} color="#10b981" />
            <h3>Próximos pontos de implementação</h3>
          </div>
        </div>
        <div className="roadmap-card-body">
          <div className="roadmap-flow-list">
            <div className="roadmap-flow-item">
              <div className="roadmap-flow-icon">
                <AlertCircle size={18} />
              </div>
              <div>
                <strong>Validações e permissões</strong>
                <span>Definir quais perfis podem criar, aprovar, sincronizar, cancelar ou auditar registros deste módulo.</span>
              </div>
            </div>
            <div className="roadmap-flow-item">
              <div className="roadmap-flow-icon">
                <Database size={18} />
              </div>
              <div>
                <strong>Modelo de dados</strong>
                <span>Conectar a tela ao Firestore mantendo tenantId, auditoria e integração com relatórios.</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RoadmapModule;
