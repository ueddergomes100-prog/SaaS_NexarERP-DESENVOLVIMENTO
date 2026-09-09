// Funcoes puras da importacao em massa de fornecedores. Sem Firestore --
// leitura de arquivo, upload e gravacao ficam em
// src/pages/Fornecedores/ImportarFornecedores.tsx.
//
// Interpretacao de documento (CPF/CNPJ) e de endereco empacotado
// ("RUA X, 123, BAIRRO - CIDADE") e' EXATAMENTE a mesma logica da
// importacao de clientes -- reaproveitada direto de
// importacaoClientesDomain.ts (as duas funcoes sao puras e nao tem nada de
// especifico de cliente, so o nome do arquivo), pra nao duplicar as regras
// de validacao de CPF/CNPJ (11/14 digitos) e o parser de endereco.

import {
  interpretarDocumento,
  interpretarEndereco,
  type StatusClienteImportado,
} from './importacaoClientesDomain';

export type StatusFornecedorImportado = StatusClienteImportado;

// ---------------------------------------------------------------------------
// Mapeamento de colunas
// ---------------------------------------------------------------------------

export type CampoColunaFornecedor = 'nome' | 'documento' | 'endereco' | 'telefone' | 'email';

export interface MapeamentoColunasFornecedor {
  nome: number;
  documento: number | null;
  endereco: number | null;
  telefone: number | null;
  email: number | null;
}

const SINONIMOS: Record<CampoColunaFornecedor, string[]> = {
  nome: ['nome', 'razao social', 'fornecedor', 'razão'],
  documento: ['cnpj', 'cpf', 'documento'],
  endereco: ['endereco', 'endereço', 'logradouro'],
  telefone: ['telefone', 'fone', 'celular', 'contato'],
  email: ['email', 'e-mail'],
};

const normalizarTextoComparacao = (valor: string): string => valor
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLowerCase()
  .trim();

export const inferirMapeamentoColunasFornecedor = (cabecalho: string[]): MapeamentoColunasFornecedor => {
  const normalizados = cabecalho.map(normalizarTextoComparacao);
  const encontrar = (campo: CampoColunaFornecedor): number => normalizados.findIndex(
    (col) => SINONIMOS[campo].some((sin) => col.includes(sin)),
  );

  const nome = encontrar('nome');
  const documento = encontrar('documento');
  const endereco = encontrar('endereco');
  const telefone = encontrar('telefone');
  const email = encontrar('email');

  return {
    nome: nome >= 0 ? nome : 0,
    documento: documento >= 0 ? documento : null,
    endereco: endereco >= 0 ? endereco : null,
    telefone: telefone >= 0 ? telefone : null,
    email: email >= 0 ? email : null,
  };
};

// ---------------------------------------------------------------------------
// Linha da planilha processada
// ---------------------------------------------------------------------------

export interface FornecedorImportado {
  /** Identificador estavel da linha -- usado pra reconciliar edicoes do
   * usuario na tela sem depender do nome, que pode repetir. */
  linhaId: number;
  nome: string;
  documento: string;
  telefone: string;
  email: string;
  enderecoOriginal: string;
  endereco: string;
  numero: string;
  bairro: string;
  cidade: string;
  status: StatusFornecedorImportado;
  motivo: string;
}

export const processarLinhasFornecedores = (
  linhas: string[][],
  mapeamento: MapeamentoColunasFornecedor,
): FornecedorImportado[] => linhas
  .filter((linha) => linha.some((celula) => celula && celula.trim()))
  .map((linha, index) => {
    const nome = (linha[mapeamento.nome] || '').trim().toUpperCase();
    const documentoBruto = mapeamento.documento !== null ? (linha[mapeamento.documento] || '').trim() : '';
    const telefone = mapeamento.telefone !== null ? (linha[mapeamento.telefone] || '').trim() : '';
    const email = mapeamento.email !== null ? (linha[mapeamento.email] || '').trim() : '';
    const enderecoOriginal = mapeamento.endereco !== null ? (linha[mapeamento.endereco] || '').trim() : '';

    const docInterpretado = interpretarDocumento(documentoBruto);
    const end = interpretarEndereco(enderecoOriginal);

    const status: StatusFornecedorImportado = (docInterpretado.status === 'REVISAR' || end.status === 'REVISAR') ? 'REVISAR' : 'OK';
    const motivo = [docInterpretado.motivo, end.motivo].filter(Boolean).join(' ');

    return {
      linhaId: index,
      nome,
      documento: docInterpretado.documentoLimpo,
      telefone,
      email,
      enderecoOriginal,
      endereco: end.rua,
      numero: end.numero,
      bairro: end.bairro,
      cidade: end.cidade,
      status,
      motivo,
    };
  })
  .filter((item) => item.nome);

// ---------------------------------------------------------------------------
// Montagem do fornecedor final (mesma forma que FornecedorForm.tsx grava)
// ---------------------------------------------------------------------------

export interface FornecedorParaImportar {
  codigo: string;
  nome: string;
  telefone: string;
  email: string;
  documento: string;
  endereco: string;
  numero: string;
  bairro: string;
  cidade: string;
}

export const montarFornecedorImportado = (
  fornecedor: FornecedorParaImportar,
  tenantId: string,
  userId: string,
  timestamp: unknown,
): Record<string, unknown> => ({
  codigo: fornecedor.codigo,
  nome: fornecedor.nome.toUpperCase().trim(),
  telefone: fornecedor.telefone,
  email: fornecedor.email,
  cnpj: fornecedor.documento,
  endereco: fornecedor.endereco,
  numero: fornecedor.numero,
  bairro: fornecedor.bairro,
  cidade: fornecedor.cidade,
  tenantId,
  createdAt: timestamp,
  criadoPor: userId,
  criadoEm: timestamp,
  alteradoPor: userId,
  alteradoEm: timestamp,
  origemImportacao: 'migracao_cadastro',
});
