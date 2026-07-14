import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/layout/ProtectedRoute';
import AppLayout from './components/layout/AppLayout';
import PageLoader from './components/layout/PageLoader';

// Lazy imports for pages
const Login = lazy(() => import('./pages/Auth/Login'));
const Register = lazy(() => import('./pages/Auth/Register'));
const Dashboard = lazy(() => import('./pages/Dashboard/Dashboard'));
const Orcamentos = lazy(() => import('./pages/Orcamentos/Orcamentos'));
const OrcamentoForm = lazy(() => import('./pages/Orcamentos/OrcamentoForm'));
const OrcamentoPrint = lazy(() => import('./pages/Orcamentos/OrcamentoPrint'));
const PedidoVendas = lazy(() => import('./pages/Vendas/PedidoVendas'));
const RelatoriosVendas = lazy(() => import('./pages/Vendas/RelatoriosVendas'));
const DevolucoesVenda = lazy(() => import('./pages/Vendas/DevolucoesVenda'));
const OSList = lazy(() => import('./pages/OS/OSList'));
const RelatoriosMecanica = lazy(() => import('./pages/OS/RelatoriosMecanica'));
const OSForm = lazy(() => import('./pages/OS/OSForm'));
const OsPrint = lazy(() => import('./pages/OS/OsPrint'));
const PedidoVendaForm = lazy(() => import('./pages/Vendas/PedidoVendaForm'));
const PedidoPrint = lazy(() => import('./pages/Vendas/PedidoPrint'));
const EstoqueList = lazy(() => import('./pages/Estoque/EstoqueList'));
const EstoqueForm = lazy(() => import('./pages/Estoque/EstoqueForm'));
const LembretesList = lazy(() => import('./pages/Lembretes/LembretesList'));
const LembreteForm = lazy(() => import('./pages/Lembretes/LembreteForm'));
const Caixa = lazy(() => import('./pages/Financeiro/Caixa'));
const Faturamento = lazy(() => import('./pages/Financeiro/Faturamento'));
const ContasReceber = lazy(() => import('./pages/Financeiro/ContasReceber'));
const ContasPagar = lazy(() => import('./pages/Financeiro/ContasPagar'));
const RelatorioComissoes = lazy(() => import('./pages/Financeiro/RelatorioComissoes'));
const ClientesList = lazy(() => import('./pages/Clientes/ClientesList'));
const ClienteForm = lazy(() => import('./pages/Clientes/ClienteForm'));
const UsuariosList = lazy(() => import('./pages/Usuarios/UsuariosList'));
const Configuracoes = lazy(() => import('./pages/Configuracoes/Configuracoes'));
const ServicosList = lazy(() => import('./pages/Servicos/ServicosList'));
const ServicoForm = lazy(() => import('./pages/Servicos/ServicoForm'));
const CategoriasList = lazy(() => import('./pages/Categorias/CategoriasList'));
const CategoriaForm = lazy(() => import('./pages/Categorias/CategoriaForm'));
const Agenda = lazy(() => import('./pages/CRM/Agenda'));
const NFE = lazy(() => import('./pages/Fiscal/NFE'));
const EntradaNFE = lazy(() => import('./pages/Fiscal/EntradaNFE'));
const UsuarioForm = lazy(() => import('./pages/Usuarios/UsuarioForm'));
const VeiculosList = lazy(() => import('./pages/Veiculos/VeiculosList'));
const VeiculoForm = lazy(() => import('./pages/Veiculos/VeiculoForm'));
const RelatoriosDiversos = lazy(() => import('./pages/RelatoriosDiversos/RelatoriosDiversos'));
const PrintRelatorioVeiculos = lazy(() => import('./pages/RelatoriosDiversos/PrintRelatorioVeiculos'));
const PrintRelatorioFinanceiro = lazy(() => import('./pages/RelatoriosDiversos/PrintRelatorioFinanceiro'));
const PrintRelatorioVendas = lazy(() => import('./pages/RelatoriosDiversos/PrintRelatorioVendas'));
const UnidadesMedidaList = lazy(() => import('./pages/UnidadesMedida/UnidadesMedidaList'));
const LogsSistema = lazy(() => import('./pages/Configuracoes/LogsSistema'));
const RoadmapModule = lazy(() => import('./pages/Roadmap/RoadmapModule'));

function App() {
  return (
    <>
      <ErrorBoundary>
        <AuthProvider>
          <BrowserRouter>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                {/* Rotas Públicas */}
                <Route path="/login" element={<Login />} />
                <Route path="/cadastro" element={<Register />} />

                {/* Rotas Protegidas (Exigem Login) */}
                <Route element={<ProtectedRoute />}>
                  <Route path="/" element={<AppLayout />}>
                    <Route index element={<Navigate to="/dashboard" replace />} />
                    <Route path="dashboard" element={<Dashboard />} />
                    
                    <Route path="orcamentos" element={<Orcamentos />} />
                    <Route path="orcamentos/novo" element={<OrcamentoForm />} />
                    <Route path="orcamentos/editar/:id" element={<OrcamentoForm />} />
                    <Route path="orcamentos/print/:id" element={<OrcamentoPrint />} />
                    <Route path="pedidos-venda" element={<PedidoVendas />} />
                    <Route path="pedidos-venda/novo" element={<PedidoVendaForm />} />
                    <Route path="pedidos-venda/visualizar/:id" element={<PedidoVendaForm />} />
                    <Route path="pedidos-venda/print/:id" element={<PedidoPrint />} />
                    <Route path="vendas/devolucoes" element={<DevolucoesVenda />} />
                    <Route path="relatorios-vendas" element={<RelatoriosVendas />} />
                  
                    <Route path="os" element={<OSList />} />
                    <Route path="os/nova" element={<OSForm />} />
                    <Route path="os/editar/:id" element={<OSForm />} />
                    <Route path="os/print/:id" element={<OsPrint />} />
                    <Route path="relatorios-mecanica" element={<RelatoriosMecanica />} />
                    
                    <Route path="estoque" element={<EstoqueList />} />
                    <Route path="estoque/nova" element={<EstoqueForm />} />
                    <Route path="estoque/editar/:id" element={<EstoqueForm />} />
                    
                    <Route path="servicos" element={<ServicosList />} />
                    <Route path="servicos/novo" element={<ServicoForm />} />
                    <Route path="servicos/editar/:id" element={<ServicoForm />} />
                    
                    <Route path="crm/lembretes" element={<LembretesList />} />
                    <Route path="crm/lembretes/novo" element={<LembreteForm />} />
                    <Route path="crm/lembretes/editar/:id" element={<LembreteForm />} />
                    <Route path="crm/agenda" element={<Agenda />} />
                    
                    <Route path="financeiro/caixa" element={<Caixa />} />
                    <Route path="financeiro/contas-receber" element={<ContasReceber />} />
                    <Route path="financeiro/contas-pagar" element={<ContasPagar />} />
                    <Route path="financeiro/faturamento" element={<Faturamento />} />
                    <Route path="financeiro/comissoes" element={<RelatorioComissoes />} />
                    
                    <Route path="fiscal/nfe" element={<NFE />} />
                    <Route path="fiscal/entrada-nfe" element={<EntradaNFE />} />
                    
                    <Route path="clientes" element={<ClientesList />} />
                    <Route path="clientes/novo" element={<ClienteForm />} />
                    <Route path="clientes/editar/:id" element={<ClienteForm />} />
                    
                    <Route path="veiculos" element={<VeiculosList />} />
                    <Route path="veiculos/novo" element={<VeiculoForm />} />
                    <Route path="veiculos/editar/:id" element={<VeiculoForm />} />
                    
                    <Route path="usuarios" element={<UsuariosList />} />
                    <Route path="usuarios/novo" element={<UsuarioForm />} />
                    <Route path="usuarios/editar/:id" element={<UsuarioForm />} />
                    
                    <Route path="categorias" element={<CategoriasList />} />
                    <Route path="categorias/nova" element={<CategoriaForm />} />
                    <Route path="categorias/editar/:id" element={<CategoriaForm />} />
                    
                    <Route path="unidades-medida" element={<UnidadesMedidaList />} />
                    
                    <Route path="configuracoes" element={<Configuracoes />} />
                    <Route path="logs-sistema" element={<LogsSistema />} />

                    <Route path="compras/:moduleId" element={<RoadmapModule />} />
                    <Route path="integracoes/:moduleId" element={<RoadmapModule />} />
                    <Route path="operacoes/:moduleId" element={<RoadmapModule />} />
                    
                    <Route path="relatorios-diversos" element={<RelatoriosDiversos />} />
                    <Route path="relatorios-diversos/print/veiculos" element={<PrintRelatorioVeiculos />} />
                    <Route path="relatorios-diversos/print/financeiro" element={<PrintRelatorioFinanceiro />} />
                    <Route path="relatorios-diversos/print/vendas" element={<PrintRelatorioVendas />} />
                  </Route>
                </Route>
                
                {/* Rota coringa de fallback */}
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </AuthProvider>
      </ErrorBoundary>
    </>
  );
}

export default App;
