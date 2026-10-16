import type { ColunaRelatorio, IndicadorRelatorio, SecaoRelatorio } from './relatorioPdfDomain';

/*
 * RELATORIO DE CLIENTES (pedido do dono, 16/10/2026): "Mais opcoes ›
 * Relatorio" na tela de Clientes, no padrao dos outros relatorios (PDF na
 * tela, colunas por caixa de marcar, Excel dentro da visualizacao). Sai
 * exatamente o que esta filtrado na tela: busca, situacao, cidade, estado,
 * tipo de pessoa, bairro e periodo de cadastro.
 *
 * Regra pura: sem tela, sem Firestore.
 */

export interface ClienteDoRelatorio {
  id: string;
  codigo?: string;
  nome?: string;
  fantasia?: string;
  documento?: string;
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
  referencia?: string;
  /** Em reais, como o cadastro grava (null = sem limite). */
  limiteDeCredito?: number | null;
  descontoPadraoPercentual?: number | string | null;
  ativo?: boolean;
  /** AAAA-MM-DD (a tela converte o createdAt). Vazio = cadastro antigo sem data. */
  cadastradoEm?: string;
}

export type TipoPessoa = 'pf' | 'pj';

const digitos = (texto: unknown): string => String(texto ?? '').replace(/\D/g, '');

/** CPF (11 digitos) = pessoa fisica; CNPJ (14) = juridica; outro = sem documento valido. */
export const tipoPessoaDoCliente = (documento: unknown): TipoPessoa | '' => {
  const d = digitos(documento);
  if (d.length === 11) return 'pf';
  if (d.length === 14) return 'pj';
  return '';
};

export const ROTULO_TIPO_PESSOA: Record<TipoPessoa, string> = { pf: 'Pessoa física', pj: 'Pessoa jurídica' };

export interface FiltroExtraClientes {
  /** '' = todos; 'sem' = sem CPF/CNPJ valido no cadastro. */
  tipoPessoa: TipoPessoa | 'sem' | '';
  /** Parte do nome do bairro (sem acento, maiusc/minusc tanto faz). */
  bairro: string;
  /** AAAA-MM-DD ou vazio. */
  cadastradoDe: string;
  cadastradoAte: string;
}

export const FILTRO_EXTRA_CLIENTES_VAZIO: FiltroExtraClientes = { tipoPessoa: '', bairro: '', cadastradoDe: '', cadastradoAte: '' };

const normal = (texto: unknown): string => String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export const quantosFiltrosExtras = (f: FiltroExtraClientes): number => (
  (f.tipoPessoa ? 1 : 0) + (f.bairro.trim() ? 1 : 0) + (f.cadastradoDe || f.cadastradoAte ? 1 : 0)
);

/** Os filtros que a tela de Clientes ganhou (16/10/2026). Cidade/estado usam passaNoFiltroLocal (clientSearch.ts). */
export const passaNosFiltrosExtras = (cliente: ClienteDoRelatorio, f: FiltroExtraClientes): boolean => {
  if (f.tipoPessoa) {
    const tipo = tipoPessoaDoCliente(cliente.documento);
    if (f.tipoPessoa === 'sem' ? tipo !== '' : tipo !== f.tipoPessoa) return false;
  }
  if (f.bairro.trim() && !normal(cliente.bairro).includes(normal(f.bairro))) return false;
  if (f.cadastradoDe || f.cadastradoAte) {
    const dia = String(cliente.cadastradoEm || '').slice(0, 10);
    // Sem data (cadastro antigo/importado) nao entra num filtro de periodo.
    if (!dia) return false;
    if (f.cadastradoDe && dia < f.cadastradoDe) return false;
    if (f.cadastradoAte && dia > f.cadastradoAte) return false;
  }
  return true;
};

const dataBr = (dia: string): string => (dia && /^\d{4}-\d{2}-\d{2}/.test(dia) ? dia.slice(0, 10).split('-').reverse().join('/') : '');

const enderecoCompleto = (c: ClienteDoRelatorio): string => [String(c.endereco || '').trim(), String(c.numero || '').trim()].filter(Boolean).join(', ');

const centavos = (reais: unknown): number | null => {
  if (reais === null || reais === undefined || reais === '') return null;
  const n = Number(reais);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

const formatarDocumento = (documento: unknown): string => {
  const d = digitos(documento);
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return String(documento || '').trim();
};

interface CidadeDoResumo {
  cidade: string;
  uf: string;
  clientes: number;
  ativos: number;
}

/** Quantos clientes em cada cidade (secao opcional do relatorio). */
export const resumoPorCidade = (clientes: ClienteDoRelatorio[]): CidadeDoResumo[] => {
  const mapa = new Map<string, CidadeDoResumo>();
  clientes.forEach((c) => {
    const cidade = String(c.cidade || '').trim().replace(/\s+/g, ' ').toUpperCase() || 'SEM CIDADE NO CADASTRO';
    const uf = String(c.estado || '').trim().toUpperCase();
    const chave = `${normal(cidade)}|${uf}`;
    const atual = mapa.get(chave) || { cidade, uf, clientes: 0, ativos: 0 };
    atual.clientes += 1;
    if (c.ativo !== false) atual.ativos += 1;
    mapa.set(chave, atual);
  });
  return [...mapa.values()].sort((a, b) => b.clientes - a.clientes || a.cidade.localeCompare(b.cidade, 'pt-BR'));
};

export interface DocumentoClientes {
  titulo: string;
  periodo: string;
  filtros: string[];
  indicadores: IndicadorRelatorio[];
  secoes: SecaoRelatorio[];
}

/**
 * O relatorio. `filtrosAplicados` sao as frases dos filtros da tela (a tela
 * monta, porque so' ela sabe o nome da cidade escolhida etc.).
 */
export const montarDocumentoClientes = (
  clientes: ClienteDoRelatorio[],
  opcoes: { filtrosAplicados: string[]; cadastradoDe?: string; cadastradoAte?: string },
): DocumentoClientes => {
  const ativos = clientes.filter((c) => c.ativo !== false).length;
  const pf = clientes.filter((c) => tipoPessoaDoCliente(c.documento) === 'pf').length;
  const pj = clientes.filter((c) => tipoPessoaDoCliente(c.documento) === 'pj').length;
  const porCidade = resumoPorCidade(clientes);

  const colunas: ColunaRelatorio<ClienteDoRelatorio>[] = [
    { id: 'codigo', titulo: 'Código', tipo: 'texto', largura: 14, valor: (c) => c.codigo || '' },
    { id: 'nome', titulo: 'Nome', tipo: 'texto', largura: 58, valor: (c) => c.nome || '' },
    { id: 'fantasia', titulo: 'Nome fantasia', tipo: 'texto', largura: 44, padrao: false, valor: (c) => c.fantasia || '' },
    { id: 'documento', titulo: 'CPF/CNPJ', tipo: 'texto', largura: 34, valor: (c) => formatarDocumento(c.documento) },
    { id: 'tipo', titulo: 'Tipo', tipo: 'texto', largura: 22, padrao: false, valor: (c) => { const t = tipoPessoaDoCliente(c.documento); return t ? ROTULO_TIPO_PESSOA[t] : ''; } },
    { id: 'identidade', titulo: 'IE / RG', tipo: 'texto', largura: 26, padrao: false, valor: (c) => c.identidade || '' },
    { id: 'telefone', titulo: 'Telefone', tipo: 'texto', largura: 26, valor: (c) => c.telefone || '' },
    { id: 'celular', titulo: 'Celular', tipo: 'texto', largura: 26, padrao: false, valor: (c) => c.celular || '' },
    { id: 'email', titulo: 'E-mail', tipo: 'texto', largura: 46, padrao: false, valor: (c) => c.email || '' },
    { id: 'endereco', titulo: 'Endereço', tipo: 'texto', largura: 52, padrao: false, valor: enderecoCompleto },
    { id: 'bairro', titulo: 'Bairro', tipo: 'texto', largura: 30, padrao: false, valor: (c) => c.bairro || '' },
    { id: 'cidade', titulo: 'Cidade', tipo: 'texto', largura: 32, valor: (c) => c.cidade || '' },
    { id: 'uf', titulo: 'UF', tipo: 'texto', largura: 10, valor: (c) => String(c.estado || '').toUpperCase() },
    { id: 'cep', titulo: 'CEP', tipo: 'texto', largura: 18, padrao: false, valor: (c) => c.cep || '' },
    { id: 'referencia', titulo: 'Referência', tipo: 'texto', largura: 40, padrao: false, valor: (c) => c.referencia || '' },
    { id: 'limite', titulo: 'Limite de crédito', tipo: 'moeda', largura: 26, padrao: false, total: 'nenhum', valor: (c) => centavos(c.limiteDeCredito) },
    {
      id: 'desconto', titulo: 'Desconto padrão', tipo: 'texto', largura: 18, padrao: false,
      valor: (c) => (Number(c.descontoPadraoPercentual) > 0 ? `${String(c.descontoPadraoPercentual).replace('.', ',')}%` : ''),
    },
    { id: 'cadastro', titulo: 'Cadastrado em', tipo: 'texto', largura: 20, padrao: false, valor: (c) => dataBr(c.cadastradoEm || '') },
    { id: 'situacao', titulo: 'Situação', tipo: 'texto', largura: 16, padrao: false, valor: (c) => (c.ativo === false ? 'Inativo' : 'Ativo') },
  ];

  const colunasCidade: ColunaRelatorio<CidadeDoResumo>[] = [
    { id: 'cidade', titulo: 'Cidade', tipo: 'texto', largura: 60, valor: (c) => c.cidade },
    { id: 'uf', titulo: 'UF', tipo: 'texto', largura: 10, valor: (c) => c.uf },
    { id: 'clientes', titulo: 'Clientes', tipo: 'inteiro', valor: (c) => c.clientes },
    { id: 'ativos', titulo: 'Ativos', tipo: 'inteiro', padrao: false, valor: (c) => c.ativos },
  ];

  const periodo = opcoes.cadastradoDe || opcoes.cadastradoAte
    ? `Cadastrados de ${dataBr(opcoes.cadastradoDe || '') || '—'} a ${dataBr(opcoes.cadastradoAte || '') || '—'}`
    : 'Todos os cadastros';

  return {
    titulo: 'Relatório de Clientes',
    periodo,
    filtros: opcoes.filtrosAplicados,
    indicadores: [
      { rotulo: 'Clientes', valor: String(clientes.length) },
      { rotulo: 'Ativos', valor: String(ativos) },
      { rotulo: 'Inativos', valor: String(clientes.length - ativos) },
      { rotulo: 'Pessoa física', valor: String(pf) },
      { rotulo: 'Pessoa jurídica', valor: String(pj) },
      { rotulo: 'Cidades', valor: String(porCidade.filter((c) => c.cidade !== 'SEM CIDADE NO CADASTRO').length) },
    ],
    secoes: [
      {
        id: 'clientes', titulo: 'Clientes', colunas, linhas: clientes, opcional: true, padrao: true,
        unidade: ['cliente', 'clientes'], mensagemVazia: 'Nenhum cliente com esses filtros.',
      } as SecaoRelatorio,
      {
        id: 'cidades', titulo: 'Clientes por cidade', colunas: colunasCidade, linhas: porCidade, opcional: true, padrao: false,
        unidade: ['cidade', 'cidades'], mensagemVazia: 'Nenhum cliente com esses filtros.',
      } as SecaoRelatorio,
    ],
  };
};
