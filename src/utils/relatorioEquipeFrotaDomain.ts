import type { ColunaRelatorio, SecaoRelatorio } from './relatorioPdfDomain';
import type { DocumentoRelatorioDeCadastro } from './relatorioCadastrosFinanceirosDomain';
import { NIVEL_ACESSO_LABELS, parseNivelAcesso } from './visibilidadeVendasDomain';
import { formatarPlaca } from './frotaDomain';

/*
 * RELATORIOS DE CADASTRO: EQUIPE (USUARIOS), VENDEDORES, MOTORISTAS E FROTA
 * (19/10/2026, levantamento de 16/10 -- "Relatorios que faltam").
 *
 * "Mais opcoes › Relatorio" na lista: sai o que a lista mostra (busca e
 * situacao ja aplicadas pela tela), no padrao PDF com colunas por caixa de
 * marcar. Senha e PIN nunca saem no papel -- so' se estao cadastrados.
 */

const situacao = (ativo: boolean): string => (ativo ? 'Ativo' : 'Inativo');

/** "Produtos 5% · Servicos padrao" / "Nao recebe" -- mesmo texto das telas. */
export const textoDaComissao = (p: {
  recebeComissaoPecas?: boolean;
  comissaoPercentualPecas?: number | null;
  recebeComissaoServicos?: boolean;
  comissaoPercentualServicos?: number | null;
}): string => {
  const partes: string[] = [];
  if (p.recebeComissaoPecas === true) {
    partes.push(`Produtos ${p.comissaoPercentualPecas != null ? `${String(p.comissaoPercentualPecas).replace('.', ',')}%` : 'padrão'}`);
  }
  if (p.recebeComissaoServicos === true) {
    partes.push(`Serviços ${p.comissaoPercentualServicos != null ? `${String(p.comissaoPercentualServicos).replace('.', ',')}%` : 'padrão'}`);
  }
  return partes.length ? partes.join(' · ') : 'Não recebe';
};

// ---------------------------------------------------------------------------
// EQUIPE & ACESSOS (usuarios com login)
// ---------------------------------------------------------------------------

export interface UsuarioDoRelatorio {
  id: string;
  nome?: string;
  nomeResponsavel?: string;
  username?: string;
  email?: string;
  role?: string;
  status?: string;
  nivelAcesso?: string;
  permissoes?: string[];
  recebeComissaoPecas?: boolean;
  comissaoPercentualPecas?: number | null;
  recebeComissaoServicos?: boolean;
  comissaoPercentualServicos?: number | null;
}

const ROTULO_PERFIL: Record<string, string> = {
  Master: 'Dono / Master',
  Admin: 'Administrador',
  Funcionario: 'Funcionário',
  Mecanico: 'Mecânico (legado)',
  Vendedor: 'Vendedor / Recepção (legado)',
};

const ehGestor = (role: unknown): boolean => role === 'Master' || role === 'Admin';

/** Login como a tela mostra: sem o prefixo da empresa. */
export const loginDoUsuario = (u: Pick<UsuarioDoRelatorio, 'username' | 'email'>): string => {
  const username = String(u.username || '');
  if (username) return username.includes('-') ? username.split('-').slice(1).join('-') : username;
  return String(u.email || '');
};

export const montarDocumentoEquipe = (
  usuarios: UsuarioDoRelatorio[],
  opcoes: { filtrosAplicados: string[]; donoId: string },
): DocumentoRelatorioDeCadastro => {
  const ativos = usuarios.filter((u) => (u.status || 'Ativo') === 'Ativo').length;
  const nivel = (u: UsuarioDoRelatorio): string => NIVEL_ACESSO_LABELS[
    u.id === opcoes.donoId || ehGestor(u.role) ? 'gerente' : parseNivelAcesso(u.nivelAcesso)
  ];

  const colunas: ColunaRelatorio<UsuarioDoRelatorio>[] = [
    { id: 'nome', titulo: 'Nome', tipo: 'texto', largura: 44, valor: (u) => u.nome || u.nomeResponsavel || 'S/N' },
    { id: 'login', titulo: 'Login', tipo: 'texto', largura: 36, valor: loginDoUsuario },
    { id: 'perfil', titulo: 'Perfil', tipo: 'texto', largura: 30, valor: (u) => ROTULO_PERFIL[String(u.role || '')] || String(u.role || '') },
    { id: 'nivel', titulo: 'Vê vendas como', tipo: 'texto', largura: 22, valor: nivel },
    // Gestor (dono/administrador) tem acesso a tudo: as permissoes marcadas nao contam.
    { id: 'permissoes', titulo: 'Permissões', tipo: 'texto', largura: 22, padrao: false, valor: (u) => (ehGestor(u.role) ? 'Todas' : String((u.permissoes || []).length)) },
    { id: 'comissao', titulo: 'Comissão', tipo: 'texto', largura: 40, padrao: false, valor: textoDaComissao },
    { id: 'situacao', titulo: 'Situação', tipo: 'texto', largura: 16, valor: (u) => situacao((u.status || 'Ativo') === 'Ativo') },
  ];

  return {
    titulo: 'Equipe e Acessos',
    periodo: 'Cadastro atual',
    filtros: opcoes.filtrosAplicados,
    indicadores: [
      { rotulo: 'Usuários', valor: String(usuarios.length) },
      { rotulo: 'Ativos', valor: String(ativos) },
      { rotulo: 'Inativos', valor: String(usuarios.length - ativos) },
    ],
    secoes: [{
      id: 'equipe',
      titulo: 'Usuários com login',
      colunas,
      linhas: usuarios,
      unidade: ['usuário', 'usuários'],
      mensagemVazia: 'Nenhum usuário com esses filtros.',
    } as SecaoRelatorio],
  };
};

// ---------------------------------------------------------------------------
// VENDEDORES (balcao, sem login)
// ---------------------------------------------------------------------------

export interface VendedorDoRelatorio {
  id: string;
  nome: string;
  codigoVendedor?: string;
  status?: string;
  pinDefinidoEm?: unknown;
  acessoAppMobile?: boolean;
  recebeComissaoPecas?: boolean;
  comissaoPercentualPecas?: number | null;
  recebeComissaoServicos?: boolean;
  comissaoPercentualServicos?: number | null;
}

export const montarDocumentoVendedores = (
  vendedores: VendedorDoRelatorio[],
  opcoes: { filtrosAplicados: string[] },
): DocumentoRelatorioDeCadastro => {
  const ativos = vendedores.filter((v) => (v.status || 'Ativo') === 'Ativo').length;
  const semSenha = vendedores.filter((v) => !v.pinDefinidoEm).length;

  const colunas: ColunaRelatorio<VendedorDoRelatorio>[] = [
    { id: 'codigo', titulo: 'Código', tipo: 'texto', largura: 14, valor: (v) => v.codigoVendedor || '--' },
    { id: 'nome', titulo: 'Nome', tipo: 'texto', largura: 50, valor: (v) => v.nome || '' },
    { id: 'senha', titulo: 'Senha', tipo: 'texto', largura: 28, valor: (v) => (v.pinDefinidoEm ? 'Cadastrada' : 'Sem senha — não vende') },
    { id: 'comissao', titulo: 'Comissão', tipo: 'texto', largura: 40, valor: textoDaComissao },
    { id: 'app', titulo: 'App Vendas', tipo: 'texto', largura: 16, padrao: false, valor: (v) => (v.acessoAppMobile === true ? 'Sim' : 'Não') },
    { id: 'situacao', titulo: 'Situação', tipo: 'texto', largura: 16, valor: (v) => situacao((v.status || 'Ativo') === 'Ativo') },
  ];

  return {
    titulo: 'Vendedores',
    periodo: 'Cadastro atual',
    filtros: opcoes.filtrosAplicados,
    indicadores: [
      { rotulo: 'Vendedores', valor: String(vendedores.length) },
      { rotulo: 'Ativos', valor: String(ativos) },
      { rotulo: 'Sem senha', valor: String(semSenha) },
    ],
    secoes: [{
      id: 'vendedores',
      titulo: 'Vendedores de balcão',
      colunas,
      linhas: vendedores,
      unidade: ['vendedor', 'vendedores'],
      mensagemVazia: 'Nenhum vendedor com esses filtros.',
    } as SecaoRelatorio],
  };
};

// ---------------------------------------------------------------------------
// MOTORISTAS
// ---------------------------------------------------------------------------

export interface MotoristaDoRelatorio {
  id: string;
  nome: string;
  telefone?: string;
  cnh?: string;
  observacao?: string;
  ativo?: boolean;
}

export const montarDocumentoMotoristas = (
  motoristas: MotoristaDoRelatorio[],
  opcoes: { filtrosAplicados: string[] },
): DocumentoRelatorioDeCadastro => {
  const ativos = motoristas.filter((m) => m.ativo !== false).length;
  const colunas: ColunaRelatorio<MotoristaDoRelatorio>[] = [
    { id: 'nome', titulo: 'Nome', tipo: 'texto', largura: 50, valor: (m) => m.nome || '' },
    { id: 'telefone', titulo: 'Telefone', tipo: 'texto', largura: 28, valor: (m) => m.telefone || '' },
    { id: 'cnh', titulo: 'CNH', tipo: 'texto', largura: 26, valor: (m) => m.cnh || '' },
    { id: 'observacao', titulo: 'Observação', tipo: 'texto', largura: 50, padrao: false, valor: (m) => m.observacao || '' },
    { id: 'situacao', titulo: 'Situação', tipo: 'texto', largura: 16, valor: (m) => situacao(m.ativo !== false) },
  ];
  return {
    titulo: 'Motoristas',
    periodo: 'Cadastro atual',
    filtros: opcoes.filtrosAplicados,
    indicadores: [
      { rotulo: 'Motoristas', valor: String(motoristas.length) },
      { rotulo: 'Ativos', valor: String(ativos) },
      { rotulo: 'Inativos', valor: String(motoristas.length - ativos) },
    ],
    secoes: [{
      id: 'motoristas',
      titulo: 'Motoristas',
      colunas,
      linhas: motoristas,
      unidade: ['motorista', 'motoristas'],
      mensagemVazia: 'Nenhum motorista com esses filtros.',
    } as SecaoRelatorio],
  };
};

// ---------------------------------------------------------------------------
// FROTA DA EMPRESA
// ---------------------------------------------------------------------------

export interface VeiculoDaFrotaDoRelatorio {
  id: string;
  placa: string;
  modelo: string;
  marca?: string;
  ano?: number | string;
  tipo?: string;
  motoristaPadraoNome?: string;
  kmAtual?: number;
  observacao?: string;
  ativo?: boolean;
}

export const montarDocumentoFrota = (
  veiculos: VeiculoDaFrotaDoRelatorio[],
  opcoes: { filtrosAplicados: string[] },
): DocumentoRelatorioDeCadastro => {
  const ativos = veiculos.filter((v) => v.ativo !== false).length;
  const colunas: ColunaRelatorio<VeiculoDaFrotaDoRelatorio>[] = [
    { id: 'veiculo', titulo: 'Veículo', tipo: 'texto', largura: 44, valor: (v) => `${v.marca ? `${v.marca} ` : ''}${v.modelo || ''}` },
    { id: 'placa', titulo: 'Placa', tipo: 'texto', largura: 20, valor: (v) => formatarPlaca(v.placa || '') },
    { id: 'ano', titulo: 'Ano', tipo: 'texto', largura: 12, padrao: false, valor: (v) => (v.ano ? String(v.ano) : '') },
    { id: 'tipo', titulo: 'Tipo', tipo: 'texto', largura: 20, valor: (v) => v.tipo || '' },
    { id: 'motorista', titulo: 'Motorista padrão', tipo: 'texto', largura: 40, valor: (v) => v.motoristaPadraoNome || '' },
    // KM nao se soma entre veiculos: sem total.
    { id: 'km', titulo: 'KM atual', tipo: 'inteiro', total: 'nenhum', largura: 20, valor: (v) => (Number(v.kmAtual) > 0 ? Number(v.kmAtual) : null) },
    { id: 'observacao', titulo: 'Observação', tipo: 'texto', largura: 50, padrao: false, valor: (v) => v.observacao || '' },
    { id: 'situacao', titulo: 'Situação', tipo: 'texto', largura: 16, padrao: false, valor: (v) => situacao(v.ativo !== false) },
  ];
  return {
    titulo: 'Frota da Empresa',
    periodo: 'Cadastro atual',
    filtros: opcoes.filtrosAplicados,
    indicadores: [
      { rotulo: 'Veículos', valor: String(veiculos.length) },
      { rotulo: 'Ativos', valor: String(ativos) },
      { rotulo: 'Inativos', valor: String(veiculos.length - ativos) },
    ],
    secoes: [{
      id: 'frota',
      titulo: 'Veículos da empresa',
      colunas,
      linhas: veiculos,
      unidade: ['veículo', 'veículos'],
      mensagemVazia: 'Nenhum veículo com esses filtros.',
    } as SecaoRelatorio],
  };
};
