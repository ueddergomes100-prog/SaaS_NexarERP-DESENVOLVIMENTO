import type { ColunaRelatorio } from './relatorioPdfDomain';
import {
  ROTULO_TIPO_PESSOA,
  dataBr,
  documentoNoRelatorio,
  enderecoCompleto,
  passaNosFiltrosExtras,
  periodoDoCadastro,
  resumoPorCidade,
  tipoPessoaDoCliente,
  type CidadeDoResumo,
  type DocumentoClientes,
  type FiltroExtraClientes,
} from './relatorioClientesDomain';

/*
 * RELATORIO DE FORNECEDORES (pedido do dono, 16/10/2026): mesmo padrao do de
 * Clientes -- "Mais opcoes › Relatorio", com o que esta filtrado na tela.
 * Os filtros de local, pessoa, bairro e cadastro sao os mesmos dos clientes;
 * o fornecedor tem a mais o "Tipo" do cadastro (Fornecedor, Transportadora...).
 *
 * Regra pura: sem tela, sem Firestore.
 */

export interface FornecedorDoRelatorio {
  id: string;
  codigo?: string;
  nome?: string;
  /** Fornecedor, Transportadora, Servicos ou Impostos (cadastro antigo sem o campo = Fornecedor). */
  tipo?: string;
  /** CNPJ ou CPF, so' digitos (o cadastro grava assim). */
  cnpj?: string;
  identidade?: string;
  telefone?: string;
  celular?: string;
  email?: string;
  endereco?: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  estado?: string;
  cep?: string;
  observacoes?: string;
  ativo?: boolean;
  /** AAAA-MM-DD (a tela converte o createdAt). */
  cadastradoEm?: string;
}

/** Os tipos do cadastro (FornecedorForm), na ordem da tela. */
export const TIPOS_DE_FORNECEDOR = ['Fornecedor', 'Transportadora', 'Serviços', 'Impostos'] as const;

export const tipoDoFornecedor = (f: Pick<FornecedorDoRelatorio, 'tipo'>): string => String(f.tipo || '').trim() || 'Fornecedor';

/** Tipo do cadastro ('' = todos) + os filtros comuns dos cadastros de pessoas. */
export const passaNosFiltrosDoFornecedor = (
  fornecedor: FornecedorDoRelatorio,
  tipoCadastro: string,
  filtro: FiltroExtraClientes,
): boolean => (
  (!tipoCadastro || tipoDoFornecedor(fornecedor) === tipoCadastro)
  && passaNosFiltrosExtras({ documento: fornecedor.cnpj, bairro: fornecedor.bairro, cadastradoEm: fornecedor.cadastradoEm }, filtro)
);

export const montarDocumentoFornecedores = (
  fornecedores: FornecedorDoRelatorio[],
  opcoes: { filtrosAplicados: string[]; cadastradoDe?: string; cadastradoAte?: string },
): DocumentoClientes => {
  const ativos = fornecedores.filter((f) => f.ativo !== false).length;
  const pj = fornecedores.filter((f) => tipoPessoaDoCliente(f.cnpj) === 'pj').length;
  const pf = fornecedores.filter((f) => tipoPessoaDoCliente(f.cnpj) === 'pf').length;
  const porCidade = resumoPorCidade(fornecedores);
  const transportadoras = fornecedores.filter((f) => tipoDoFornecedor(f) === 'Transportadora').length;

  const colunas: ColunaRelatorio<FornecedorDoRelatorio>[] = [
    { id: 'codigo', titulo: 'Código', tipo: 'texto', largura: 14, valor: (f) => f.codigo || '' },
    { id: 'nome', titulo: 'Nome / Razão social', tipo: 'texto', largura: 58, valor: (f) => f.nome || '' },
    { id: 'tipo', titulo: 'Tipo', tipo: 'texto', largura: 24, valor: tipoDoFornecedor },
    { id: 'documento', titulo: 'CNPJ/CPF', tipo: 'texto', largura: 34, valor: (f) => documentoNoRelatorio(f.cnpj) },
    { id: 'pessoa', titulo: 'Pessoa', tipo: 'texto', largura: 22, padrao: false, valor: (f) => { const t = tipoPessoaDoCliente(f.cnpj); return t ? ROTULO_TIPO_PESSOA[t] : ''; } },
    { id: 'identidade', titulo: 'IE / C.I.', tipo: 'texto', largura: 26, padrao: false, valor: (f) => f.identidade || '' },
    { id: 'telefone', titulo: 'Telefone', tipo: 'texto', largura: 26, valor: (f) => f.telefone || '' },
    { id: 'celular', titulo: 'Celular', tipo: 'texto', largura: 26, padrao: false, valor: (f) => f.celular || '' },
    { id: 'email', titulo: 'E-mail', tipo: 'texto', largura: 46, padrao: false, valor: (f) => f.email || '' },
    { id: 'endereco', titulo: 'Endereço', tipo: 'texto', largura: 52, padrao: false, valor: enderecoCompleto },
    { id: 'bairro', titulo: 'Bairro', tipo: 'texto', largura: 30, padrao: false, valor: (f) => f.bairro || '' },
    { id: 'cidade', titulo: 'Cidade', tipo: 'texto', largura: 32, valor: (f) => f.cidade || '' },
    { id: 'uf', titulo: 'UF', tipo: 'texto', largura: 10, valor: (f) => String(f.estado || '').toUpperCase() },
    { id: 'cep', titulo: 'CEP', tipo: 'texto', largura: 18, padrao: false, valor: (f) => f.cep || '' },
    { id: 'observacoes', titulo: 'Observações', tipo: 'texto', largura: 60, padrao: false, valor: (f) => f.observacoes || '' },
    { id: 'cadastro', titulo: 'Cadastrado em', tipo: 'texto', largura: 20, padrao: false, valor: (f) => dataBr(f.cadastradoEm || '') },
    { id: 'situacao', titulo: 'Situação', tipo: 'texto', largura: 16, padrao: false, valor: (f) => (f.ativo === false ? 'Inativo' : 'Ativo') },
  ];

  const colunasCidade: ColunaRelatorio<CidadeDoResumo>[] = [
    { id: 'cidade', titulo: 'Cidade', tipo: 'texto', largura: 60, valor: (c) => c.cidade },
    { id: 'uf', titulo: 'UF', tipo: 'texto', largura: 10, valor: (c) => c.uf },
    { id: 'fornecedores', titulo: 'Fornecedores', tipo: 'inteiro', valor: (c) => c.clientes },
    { id: 'ativos', titulo: 'Ativos', tipo: 'inteiro', padrao: false, valor: (c) => c.ativos },
  ];

  return {
    titulo: 'Relatório de Fornecedores',
    periodo: periodoDoCadastro(opcoes.cadastradoDe, opcoes.cadastradoAte),
    filtros: opcoes.filtrosAplicados,
    indicadores: [
      { rotulo: 'Fornecedores', valor: String(fornecedores.length) },
      { rotulo: 'Ativos', valor: String(ativos) },
      { rotulo: 'Inativos', valor: String(fornecedores.length - ativos) },
      { rotulo: 'Pessoa jurídica', valor: String(pj) },
      { rotulo: 'Pessoa física', valor: String(pf) },
      { rotulo: 'Transportadoras', valor: String(transportadoras) },
    ],
    secoes: [
      {
        id: 'fornecedores', titulo: 'Fornecedores', colunas, linhas: fornecedores, opcional: true, padrao: true,
        unidade: ['fornecedor', 'fornecedores'], mensagemVazia: 'Nenhum fornecedor com esses filtros.',
      },
      {
        id: 'cidades', titulo: 'Fornecedores por cidade', colunas: colunasCidade, linhas: porCidade, opcional: true, padrao: false,
        unidade: ['cidade', 'cidades'], mensagemVazia: 'Nenhum fornecedor com esses filtros.',
      },
    ],
  };
};
