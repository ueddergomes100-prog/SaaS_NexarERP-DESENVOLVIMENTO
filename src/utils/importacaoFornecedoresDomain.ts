// Funcoes puras da importacao em massa de fornecedores. Sem Firestore --
// leitura de arquivo, upload e gravacao ficam em
// src/pages/Fornecedores/ImportarFornecedores.tsx.
//
// Interpretacao de documento (CPF/CNPJ) e do endereco TOTALMENTE empacotado
// ("RUA X, 123, BAIRRO - CIDADE") e' reaproveitada de
// importacaoClientesDomain.ts (funcoes puras, nada especifico de cliente).
//
// A planilha real de fornecedores (Sol Natus, 2026-09-14) tem um formato
// HIBRIDO, diferente dos dois ja vistos: bairro/cidade/UF/CEP vem cada um
// na sua propria coluna (como a planilha de clientes da Sol Natus), mas
// rua e numero vem GRUDADOS num campo so ("AMARAL FRANCO, 51") -- por
// isso o parser novo `separarRuaENumero`, mais simples que o de 4 partes.

import {
  interpretarDocumento,
  interpretarEndereco,
  type StatusClienteImportado,
} from './importacaoClientesDomain';

export type StatusFornecedorImportado = StatusClienteImportado;

const TIPOS_VALIDOS = ['Fornecedor', 'Transportadora', 'Serviços', 'Impostos'] as const;
export type TipoFornecedor = typeof TIPOS_VALIDOS[number];

const normalizarTextoComparacao = (valor: string): string => valor
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLowerCase()
  .trim();

// ---------------------------------------------------------------------------
// Mapeamento de colunas
// ---------------------------------------------------------------------------

export type CampoColunaFornecedor =
  | 'nome' | 'documento' | 'identidade'
  | 'telefone' | 'celular' | 'email'
  | 'endereco' | 'numero' | 'bairro' | 'cidade' | 'estado' | 'cep'
  | 'tipo' | 'ativo' | 'observacoes';

export interface MapeamentoColunasFornecedor {
  nome: number;
  documento: number | null;
  identidade: number | null;
  telefone: number | null;
  celular: number | null;
  email: number | null;
  endereco: number | null;
  numero: number | null;
  bairro: number | null;
  cidade: number | null;
  estado: number | null;
  cep: number | null;
  tipo: number | null;
  ativo: number | null;
  observacoes: number | null;
}

export const MAPEAMENTO_FORNECEDOR_VAZIO: MapeamentoColunasFornecedor = {
  nome: 0, documento: null, identidade: null,
  telefone: null, celular: null, email: null,
  endereco: null, numero: null, bairro: null, cidade: null, estado: null, cep: null,
  tipo: null, ativo: null, observacoes: null,
};

const SINONIMOS: Record<CampoColunaFornecedor, string[]> = {
  nome: ['nome', 'razao social', 'fornecedor', 'razão'],
  documento: ['cnpj/cpf', 'cnpj', 'cpf', 'documento'],
  identidade: ['i.e./c.i.', 'inscricao estadual', 'inscrição estadual', 'i.e.', 'c.i.'],
  telefone: ['fone', 'telefone'],
  celular: ['celular'],
  email: ['e-mail', 'email'],
  endereco: ['endereco', 'endereço', 'logradouro'],
  numero: ['numero', 'número'],
  bairro: ['bairro'],
  cidade: ['cidade'],
  estado: ['uf', 'estado'],
  cep: ['cep'],
  tipo: ['tipo'],
  ativo: ['ativo'],
  observacoes: ['obs.', 'obs', 'observacoes', 'observações', 'observacao'],
};

/** Correspondencia EXATA primeiro, so cai pro modo substring se nada bateu
 * exato -- mesma correcao aplicada em importacaoClientesDomain.ts depois
 * de um bug real (coluna generica roubando dado de uma coluna vizinha mais
 * especifica, tipo 'celular' capturando 'ddd_celular'). */
export const inferirMapeamentoColunasFornecedor = (cabecalho: string[]): MapeamentoColunasFornecedor => {
  const normalizados = cabecalho.map(normalizarTextoComparacao);
  const encontrar = (campo: CampoColunaFornecedor): number => {
    const sinonimos = SINONIMOS[campo];
    const exato = normalizados.findIndex((col) => sinonimos.includes(col));
    if (exato >= 0) return exato;
    return normalizados.findIndex((col) => sinonimos.some((sin) => col.includes(sin)));
  };

  const nome = encontrar('nome');

  return {
    ...MAPEAMENTO_FORNECEDOR_VAZIO,
    nome: nome >= 0 ? nome : 0,
    documento: encontrar('documento') >= 0 ? encontrar('documento') : null,
    identidade: encontrar('identidade') >= 0 ? encontrar('identidade') : null,
    telefone: encontrar('telefone') >= 0 ? encontrar('telefone') : null,
    celular: encontrar('celular') >= 0 ? encontrar('celular') : null,
    email: encontrar('email') >= 0 ? encontrar('email') : null,
    endereco: encontrar('endereco') >= 0 ? encontrar('endereco') : null,
    numero: encontrar('numero') >= 0 ? encontrar('numero') : null,
    bairro: encontrar('bairro') >= 0 ? encontrar('bairro') : null,
    cidade: encontrar('cidade') >= 0 ? encontrar('cidade') : null,
    estado: encontrar('estado') >= 0 ? encontrar('estado') : null,
    cep: encontrar('cep') >= 0 ? encontrar('cep') : null,
    tipo: encontrar('tipo') >= 0 ? encontrar('tipo') : null,
    ativo: encontrar('ativo') >= 0 ? encontrar('ativo') : null,
    observacoes: encontrar('observacoes') >= 0 ? encontrar('observacoes') : null,
  };
};

// ---------------------------------------------------------------------------
// Endereco: separa "RUA X, 123" em rua + numero (fallback leve -- so
// entra em acao quando bairro/cidade JA tem coluna propria mapeada, mas
// numero nao. Planilha real: numero pode ser digito ("51") ou "SN" (sem
// numero); as vezes vem sem virgula nenhuma (sem numero pra extrair).
// Uma minoria (~2%) tem virgula dupla ou repetida ("RUA X,, SN") -- o
// corte pela ULTIMA virgula ainda devolve algo aproveitavel, nunca trava
// a importacao por isso. */
export const separarRuaENumero = (enderecoBruto: string): { rua: string; numero: string } => {
  const bruto = (enderecoBruto || '').trim();
  if (!bruto) return { rua: '', numero: '' };
  const idx = bruto.lastIndexOf(',');
  if (idx === -1) return { rua: bruto, numero: '' };
  return { rua: bruto.slice(0, idx).trim(), numero: bruto.slice(idx + 1).trim() };
};

// ---------------------------------------------------------------------------
// Tipo / Ativo
// ---------------------------------------------------------------------------

/** Cai em 'Fornecedor' (o mais comum, e o valor que a tela ja usa como
 * default pro cadastro manual) quando a planilha nao tem a coluna ou o
 * texto nao bate com nenhum dos 4 tipos conhecidos. */
export const interpretarTipoFornecedor = (valorBruto: string): TipoFornecedor => {
  const normalizado = normalizarTextoComparacao(valorBruto);
  const encontrado = TIPOS_VALIDOS.find((tipo) => normalizarTextoComparacao(tipo) === normalizado);
  return encontrado || 'Fornecedor';
};

/** Documento em branco = ativo (default do sistema). So fica false quando
 * o texto e', apos normalizar, exatamente "nao ativo" -- qualquer outra
 * coisa (incluindo "ativo" ou lixo desconhecido) fica ativo, pra nunca
 * inativar por engano um fornecedor por causa de um valor inesperado. */
export const interpretarAtivoFornecedor = (valorBruto: string): boolean => (
  normalizarTextoComparacao(valorBruto) !== 'nao ativo'
);

// ---------------------------------------------------------------------------
// Linha da planilha processada
// ---------------------------------------------------------------------------

export interface FornecedorImportado {
  /** Identificador estavel da linha -- usado pra reconciliar edicoes do
   * usuario na tela sem depender do nome, que pode repetir. */
  linhaId: number;
  nome: string;
  documento: string;
  identidade: string;
  telefone: string;
  celular: string;
  email: string;
  enderecoOriginal: string;
  endereco: string;
  numero: string;
  bairro: string;
  cidade: string;
  estado: string;
  cep: string;
  tipo: TipoFornecedor;
  ativo: boolean;
  observacoes: string;
  status: StatusFornecedorImportado;
  motivo: string;
}

export const processarLinhasFornecedores = (
  linhas: string[][],
  mapeamento: MapeamentoColunasFornecedor,
): FornecedorImportado[] => linhas
  .filter((linha) => linha.some((celula) => celula && celula.trim()))
  .map((linha, index) => {
    const col = (indice: number | null): string => (indice !== null ? (linha[indice] || '').trim() : '');

    const nome = col(mapeamento.nome).toUpperCase();
    const documentoBruto = col(mapeamento.documento);
    const enderecoOriginal = col(mapeamento.endereco);

    const docInterpretado = interpretarDocumento(documentoBruto);

    // Bairro/cidade em coluna propria (planilha Sol Natus) -- so cai no
    // parser de 4 partes (Shopping Rural, endereco 100% empacotado)
    // quando NENHUM dos dois tem coluna mapeada.
    const temEnderecoSeparado = mapeamento.bairro !== null || mapeamento.cidade !== null;
    let endereco = '';
    let numero = '';
    let bairro = '';
    let cidade = '';
    let statusEndereco: StatusFornecedorImportado = 'OK';
    let motivoEndereco = '';

    if (temEnderecoSeparado) {
      bairro = col(mapeamento.bairro);
      cidade = col(mapeamento.cidade);
      if (mapeamento.numero !== null) {
        endereco = enderecoOriginal;
        numero = col(mapeamento.numero);
      } else {
        const separado = separarRuaENumero(enderecoOriginal);
        endereco = separado.rua;
        numero = separado.numero;
      }
    } else {
      const end = interpretarEndereco(enderecoOriginal);
      endereco = end.rua;
      numero = end.numero;
      bairro = end.bairro;
      cidade = end.cidade;
      statusEndereco = end.status;
      motivoEndereco = end.motivo;
    }

    const status: StatusFornecedorImportado = (docInterpretado.status === 'REVISAR' || statusEndereco === 'REVISAR') ? 'REVISAR' : 'OK';
    const motivo = [docInterpretado.motivo, motivoEndereco].filter(Boolean).join(' ');

    return {
      linhaId: index,
      nome,
      documento: docInterpretado.documentoLimpo,
      identidade: col(mapeamento.identidade),
      telefone: col(mapeamento.telefone),
      celular: col(mapeamento.celular),
      email: col(mapeamento.email),
      enderecoOriginal,
      endereco,
      numero,
      bairro,
      cidade,
      estado: col(mapeamento.estado).toUpperCase(),
      cep: col(mapeamento.cep).replace(/\D/g, ''),
      tipo: interpretarTipoFornecedor(col(mapeamento.tipo)),
      ativo: interpretarAtivoFornecedor(col(mapeamento.ativo)),
      observacoes: col(mapeamento.observacoes),
      status,
      motivo,
    };
  })
  .filter((item) => item.nome);

// ---------------------------------------------------------------------------
// Montagem do fornecedor final (mesma forma que FornecedorForm.tsx grava)
// ---------------------------------------------------------------------------

export type FornecedorParaImportar = Omit<FornecedorImportado, 'linhaId' | 'enderecoOriginal' | 'status' | 'motivo'> & {
  codigo: string;
};

export const montarFornecedorImportado = (
  fornecedor: FornecedorParaImportar,
  tenantId: string,
  userId: string,
  timestamp: unknown,
): Record<string, unknown> => ({
  codigo: fornecedor.codigo,
  nome: fornecedor.nome.toUpperCase().trim(),
  identidade: fornecedor.identidade,
  telefone: fornecedor.telefone,
  celular: fornecedor.celular,
  email: fornecedor.email,
  cnpj: fornecedor.documento,
  endereco: fornecedor.endereco,
  numero: fornecedor.numero,
  bairro: fornecedor.bairro,
  cidade: fornecedor.cidade,
  estado: fornecedor.estado,
  cep: fornecedor.cep,
  tipo: fornecedor.tipo,
  ativo: fornecedor.ativo,
  observacoes: fornecedor.observacoes,
  tenantId,
  createdAt: timestamp,
  criadoPor: userId,
  criadoEm: timestamp,
  alteradoPor: userId,
  alteradoEm: timestamp,
  origemImportacao: 'migracao_cadastro',
});
