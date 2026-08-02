import { lazy } from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';

// Paginas do "miolo" do app (tudo que renderiza dentro de AppLayout, uma
// aba por vez). Extraido de App.tsx no Sistema de Abas (F19, fase B):
// cada aba passou a montar essa mesma lista de rotas dentro do seu proprio
// MemoryRouter isolado, via useRoutes() -- ver TabPane.tsx.
const Dashboard = lazy(() => import('../pages/Dashboard/Dashboard'));
const Orcamentos = lazy(() => import('../pages/Orcamentos/Orcamentos'));
const OrcamentoForm = lazy(() => import('../pages/Orcamentos/OrcamentoForm'));
const OrcamentoPrint = lazy(() => import('../pages/Orcamentos/OrcamentoPrint'));
const PedidoVendas = lazy(() => import('../pages/Vendas/PedidoVendas'));
const RelatoriosVendas = lazy(() => import('../pages/Vendas/RelatoriosVendas'));
const DevolucoesVenda = lazy(() => import('../pages/Vendas/DevolucoesVenda'));
const OSList = lazy(() => import('../pages/OS/OSList'));
const RelatoriosMecanica = lazy(() => import('../pages/OS/RelatoriosMecanica'));
const OSForm = lazy(() => import('../pages/OS/OSForm'));
const OsPrint = lazy(() => import('../pages/OS/OsPrint'));
const PedidoVendaForm = lazy(() => import('../pages/Vendas/PedidoVendaForm'));
const PedidoPrint = lazy(() => import('../pages/Vendas/PedidoPrint'));
const PedidoPrintLote = lazy(() => import('../pages/Vendas/PedidoPrintLote'));
const EstoqueList = lazy(() => import('../pages/Estoque/EstoqueList'));
const EstoqueForm = lazy(() => import('../pages/Estoque/EstoqueForm'));
const LembretesList = lazy(() => import('../pages/Lembretes/LembretesList'));
const LembreteForm = lazy(() => import('../pages/Lembretes/LembreteForm'));
const Caixa = lazy(() => import('../pages/Financeiro/Caixa'));
const Banco = lazy(() => import('../pages/Financeiro/Banco'));
const Faturamento = lazy(() => import('../pages/Financeiro/Faturamento'));
const ContasReceber = lazy(() => import('../pages/Financeiro/ContasReceber'));
const ContasPagar = lazy(() => import('../pages/Financeiro/ContasPagar'));
const RelatorioComissoes = lazy(() => import('../pages/Financeiro/RelatorioComissoes'));
const ClientesList = lazy(() => import('../pages/Clientes/ClientesList'));
const ClienteForm = lazy(() => import('../pages/Clientes/ClienteForm'));
const UsuariosList = lazy(() => import('../pages/Usuarios/UsuariosList'));
const Configuracoes = lazy(() => import('../pages/Configuracoes/Configuracoes'));
const ServicosList = lazy(() => import('../pages/Servicos/ServicosList'));
const ServicoForm = lazy(() => import('../pages/Servicos/ServicoForm'));
const CategoriasList = lazy(() => import('../pages/Categorias/CategoriasList'));
const CategoriaForm = lazy(() => import('../pages/Categorias/CategoriaForm'));
const Agenda = lazy(() => import('../pages/CRM/Agenda'));
const NFE = lazy(() => import('../pages/Fiscal/NFE'));
const EntradaNFE = lazy(() => import('../pages/Fiscal/EntradaNFE'));
const UsuarioForm = lazy(() => import('../pages/Usuarios/UsuarioForm'));
const VeiculosList = lazy(() => import('../pages/Veiculos/VeiculosList'));
const VeiculoForm = lazy(() => import('../pages/Veiculos/VeiculoForm'));
const RelatoriosDiversos = lazy(() => import('../pages/RelatoriosDiversos/RelatoriosDiversos'));
const PrintRelatorioVeiculos = lazy(() => import('../pages/RelatoriosDiversos/PrintRelatorioVeiculos'));
const PrintRelatorioFinanceiro = lazy(() => import('../pages/RelatoriosDiversos/PrintRelatorioFinanceiro'));
const PrintRelatorioVendas = lazy(() => import('../pages/RelatoriosDiversos/PrintRelatorioVendas'));
const PrintRelatorioTaxasCartao = lazy(() => import('../pages/RelatoriosDiversos/PrintRelatorioTaxasCartao'));
const UnidadesMedidaList = lazy(() => import('../pages/UnidadesMedida/UnidadesMedidaList'));
const BandeirasCartaoList = lazy(() => import('../pages/BandeirasCartao/BandeirasCartaoList'));
const BancosList = lazy(() => import('../pages/Bancos/BancosList'));
const LogsSistema = lazy(() => import('../pages/Configuracoes/LogsSistema'));
const RoadmapModule = lazy(() => import('../pages/Roadmap/RoadmapModule'));
const FornecedoresList = lazy(() => import('../pages/Fornecedores/FornecedoresList'));
const FornecedorForm = lazy(() => import('../pages/Fornecedores/FornecedorForm'));

export const appRoutesConfig: RouteObject[] = [
  { index: true, element: <Navigate to="/dashboard" replace /> },
  { path: 'dashboard', element: <Dashboard /> },

  { path: 'orcamentos', element: <Orcamentos /> },
  { path: 'orcamentos/novo', element: <OrcamentoForm /> },
  { path: 'orcamentos/editar/:id', element: <OrcamentoForm /> },
  { path: 'orcamentos/print/:id', element: <OrcamentoPrint /> },
  { path: 'pedidos-venda', element: <PedidoVendas /> },
  { path: 'pedidos-venda/novo', element: <PedidoVendaForm /> },
  { path: 'pedidos-venda/visualizar/:id', element: <PedidoVendaForm /> },
  { path: 'pedidos-venda/print/:id', element: <PedidoPrint /> },
  { path: 'pedidos-venda/print-lote', element: <PedidoPrintLote /> },
  { path: 'vendas/devolucoes', element: <DevolucoesVenda /> },
  { path: 'relatorios-vendas', element: <RelatoriosVendas /> },

  { path: 'os', element: <OSList /> },
  { path: 'os/nova', element: <OSForm /> },
  { path: 'os/editar/:id', element: <OSForm /> },
  { path: 'os/print/:id', element: <OsPrint /> },
  { path: 'relatorios-mecanica', element: <RelatoriosMecanica /> },

  { path: 'estoque', element: <EstoqueList /> },
  { path: 'estoque/nova', element: <EstoqueForm /> },
  { path: 'estoque/editar/:id', element: <EstoqueForm /> },

  { path: 'servicos', element: <ServicosList /> },
  { path: 'servicos/novo', element: <ServicoForm /> },
  { path: 'servicos/editar/:id', element: <ServicoForm /> },

  { path: 'crm/lembretes', element: <LembretesList /> },
  { path: 'crm/lembretes/novo', element: <LembreteForm /> },
  { path: 'crm/lembretes/editar/:id', element: <LembreteForm /> },
  { path: 'crm/agenda', element: <Agenda /> },

  { path: 'financeiro/caixa', element: <Caixa /> },
  { path: 'financeiro/banco', element: <Banco /> },
  { path: 'financeiro/contas-receber', element: <ContasReceber /> },
  { path: 'financeiro/contas-pagar', element: <ContasPagar /> },
  { path: 'financeiro/faturamento', element: <Faturamento /> },
  { path: 'financeiro/comissoes', element: <RelatorioComissoes /> },

  { path: 'fiscal/nfe', element: <NFE /> },
  { path: 'fiscal/entrada-nfe', element: <EntradaNFE /> },

  { path: 'clientes', element: <ClientesList /> },
  { path: 'clientes/novo', element: <ClienteForm /> },
  { path: 'clientes/editar/:id', element: <ClienteForm /> },

  { path: 'veiculos', element: <VeiculosList /> },
  { path: 'veiculos/novo', element: <VeiculoForm /> },
  { path: 'veiculos/editar/:id', element: <VeiculoForm /> },

  { path: 'usuarios', element: <UsuariosList /> },
  { path: 'usuarios/novo', element: <UsuarioForm /> },
  { path: 'usuarios/editar/:id', element: <UsuarioForm /> },

  { path: 'categorias', element: <CategoriasList /> },
  { path: 'categorias/nova', element: <CategoriaForm /> },
  { path: 'categorias/editar/:id', element: <CategoriaForm /> },

  { path: 'unidades-medida', element: <UnidadesMedidaList /> },
  { path: 'bandeiras-cartao', element: <BandeirasCartaoList /> },
  { path: 'bancos', element: <BancosList /> },
  { path: 'fornecedores', element: <FornecedoresList /> },
  { path: 'fornecedores/novo', element: <FornecedorForm /> },
  { path: 'fornecedores/editar/:id', element: <FornecedorForm /> },

  { path: 'configuracoes', element: <Configuracoes /> },
  { path: 'logs-sistema', element: <LogsSistema /> },

  { path: 'compras/:moduleId', element: <RoadmapModule /> },
  { path: 'integracoes/:moduleId', element: <RoadmapModule /> },
  { path: 'operacoes/:moduleId', element: <RoadmapModule /> },

  { path: 'relatorios-diversos', element: <RelatoriosDiversos /> },
  { path: 'relatorios-diversos/print/veiculos', element: <PrintRelatorioVeiculos /> },
  { path: 'relatorios-diversos/print/financeiro', element: <PrintRelatorioFinanceiro /> },
  { path: 'relatorios-diversos/print/vendas', element: <PrintRelatorioVendas /> },
  { path: 'relatorios-diversos/print/taxas-cartao', element: <PrintRelatorioTaxasCartao /> },

  { path: '*', element: <Navigate to="/dashboard" replace /> },
];
