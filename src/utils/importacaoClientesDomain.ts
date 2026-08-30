// Funcoes puras da importacao em massa de clientes. Sem Firestore -- leitura
// de arquivo, upload e gravacao ficam em src/pages/Clientes/ImportarClientes.tsx.
// Leitura de arquivo (encoding/delimitador/parser CSV) e' compartilhada com a
// importacao de produtos, ver src/utils/importacaoEstoqueDomain.ts.
//
// Contexto: cliente novo (Shopping Rural, 2026-08-29) manda um relatorio
// exportado do sistema antigo (eSistemLoja) com o cadastro de clientes.
// Duas particularidades reais, vistas na primeira planilha:
//
//  1. O relatorio empacota rua, numero, bairro e cidade num UNICO campo de
//     endereco ("RUA X, 123, BAIRRO - CIDADE"). Precisa separar pra virar
//     os campos que o cadastro de cliente usa (endereco/numero/bairro/cidade).
//  2. Muitos nomes vem com o codigo sequencial do sistema antigo colado no
//     inicio do proprio texto ("5254 CONDOMINIO IMPERIAALLEE"), nao numa
//     coluna separada. Decisao do dono do produto (2026-08-29): o cliente
//     sempre entra com o codigo NOVO sequencial do Hennder (getProximoCodigoCliente),
//     entao esse prefixo e' so lixo do sistema antigo -- removido do nome,
//     nunca usado como codigo.

export type StatusClienteImportado = 'OK' | 'REVISAR';

// ---------------------------------------------------------------------------
// Mapeamento de colunas
// ---------------------------------------------------------------------------

export type CampoColunaCliente = 'nome' | 'documento' | 'endereco' | 'telefone';

export interface MapeamentoColunasCliente {
  nome: number;
  documento: number | null;
  endereco: number | null;
  telefone: number | null;
}

const SINONIMOS: Record<CampoColunaCliente, string[]> = {
  nome: ['nome', 'razao social', 'cliente', 'razão'],
  documento: ['cpf', 'cnpj', 'documento'],
  endereco: ['endereco', 'endereço', 'logradouro'],
  telefone: ['telefone', 'fone', 'celular', 'contato'],
};

const normalizarTextoComparacao = (valor: string): string => valor
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLowerCase()
  .trim();

/** Taxa de linhas (0 a 1) em que a coluna `indice` vem preenchida, entre as
 * `linhas` de amostra. */
const taxaPreenchimento = (indice: number, linhas: string[][]): number => {
  if (indice < 0 || linhas.length === 0) return 0;
  const preenchidas = linhas.filter((linha) => (linha[indice] || '').trim()).length;
  return preenchidas / linhas.length;
};

/** Corrige o caso real (visto na planilha do Shopping Rural, 2026-08-29):
 * celula mesclada no Excel original faz o TEXTO do cabecalho ficar numa
 * coluna, mas o DADO de cada linha fica na coluna vizinha -- entao o
 * palpite por sinonimo de cabecalho acerta a coluna errada, sempre vazia.
 * So se aplica ao Nome: e' o unico campo que deveria vir preenchido em
 * praticamente toda linha (diferente de documento/endereco/telefone, que
 * legitimamente ficam em branco pra muitos clientes do sistema antigo --
 * "vazio" ali e' dado real, nao teria como diferenciar erro de mapeamento). */
const corrigirColunaNomeVazia = (indice: number, linhas: string[][]): number => {
  if (indice < 0 || taxaPreenchimento(indice, linhas) >= 0.5) return indice;

  let melhorIndice = indice;
  let melhorTaxa = taxaPreenchimento(indice, linhas);
  [indice + 1, indice - 1].forEach((candidato) => {
    const taxa = taxaPreenchimento(candidato, linhas);
    if (taxa > melhorTaxa) {
      melhorIndice = candidato;
      melhorTaxa = taxa;
    }
  });
  return melhorIndice;
};

/** Chuta qual coluna e qual campo comparando o cabecalho com os sinonimos.
 * `linhasAmostra` (opcional) e' usado so pra corrigir a coluna do Nome
 * quando o palpite por cabecalho aponta pra uma coluna sistematicamente
 * vazia (ver corrigirColunaNomeVazia) -- mesmo assim, a tela de
 * mapeamento sempre mostra o palpite pro usuario confirmar/corrigir,
 * nunca aplica sozinho sem chance de revisao. */
export const inferirMapeamentoColunasCliente = (
  cabecalho: string[],
  linhasAmostra: string[][] = [],
): MapeamentoColunasCliente => {
  const normalizados = cabecalho.map(normalizarTextoComparacao);
  const encontrar = (campo: CampoColunaCliente): number => normalizados.findIndex(
    (col) => SINONIMOS[campo].some((sin) => col.includes(sin)),
  );

  const nome = encontrar('nome');
  const documento = encontrar('documento');
  const endereco = encontrar('endereco');
  const telefone = encontrar('telefone');

  return {
    nome: nome >= 0 ? corrigirColunaNomeVazia(nome, linhasAmostra) : 0,
    documento: documento >= 0 ? documento : null,
    endereco: endereco >= 0 ? endereco : null,
    telefone: telefone >= 0 ? telefone : null,
  };
};

// ---------------------------------------------------------------------------
// Nome: remove prefixo de codigo do sistema antigo
// ---------------------------------------------------------------------------

export interface NomeInterpretado {
  nomeLimpo: string;
  prefixoRemovido: string | null;
}

/** Remove um numero solto no INICIO do nome ("5254 CONDOMINIO..." ->
 * "CONDOMINIO..."), que e' o codigo do sistema antigo colado no proprio
 * texto do nome, nunca uma coluna separada. So mexe no comeco da string
 * -- numero em qualquer outra posicao ("AGROPECAS 3 IRMAOS") faz parte
 * do nome de verdade e fica intacto. */
export const removerPrefixoCodigoAntigo = (nomeBruto: string): NomeInterpretado => {
  const nome = nomeBruto.trim();
  const match = nome.match(/^(\d+)\s+(.+)$/);
  if (!match) return { nomeLimpo: nome, prefixoRemovido: null };
  return { nomeLimpo: match[2].trim(), prefixoRemovido: match[1] };
};

// ---------------------------------------------------------------------------
// Documento (CPF/CNPJ)
// ---------------------------------------------------------------------------

export interface DocumentoInterpretado {
  documentoLimpo: string;
  status: StatusClienteImportado;
  motivo: string;
}

/** Documento em branco e' normal (nem todo cliente antigo tinha CPF/CNPJ
 * cadastrado) -- so vira REVISAR quando tem algo digitado mas a
 * quantidade de digitos nao bate com CPF (11) nem CNPJ (14), mesma regra
 * que ClienteForm.tsx aplica ao salvar. */
export const interpretarDocumento = (documentoBruto: string): DocumentoInterpretado => {
  const digitos = (documentoBruto || '').replace(/\D/g, '');
  if (!digitos) return { documentoLimpo: '', status: 'OK', motivo: '' };
  if (digitos.length === 11 || digitos.length === 14) {
    return { documentoLimpo: digitos, status: 'OK', motivo: '' };
  }
  return {
    documentoLimpo: digitos,
    status: 'REVISAR',
    motivo: `CPF/CNPJ com ${digitos.length} dígito(s) -- não é um CPF (11) nem CNPJ (14) válido. Corrija ou apague.`,
  };
};

// ---------------------------------------------------------------------------
// Endereco: separa "RUA, NUMERO, BAIRRO - CIDADE" em campos
// ---------------------------------------------------------------------------

export interface EnderecoInterpretado {
  rua: string;
  numero: string;
  bairro: string;
  cidade: string;
  status: StatusClienteImportado;
  motivo: string;
}

/** Separa o endereco empacotado do relatorio antigo em rua/numero/bairro/
 * cidade. Formato esperado: "RUA X, NUMERO, BAIRRO - CIDADE" (visto na
 * planilha real do Shopping Rural). Nunca inventa um valor que nao da pra
 * confiar -- quando o formato foge do esperado, devolve REVISAR com os
 * pedacos que conseguiu identificar, pro usuario terminar a mao na tela
 * de confirmacao. */
export const interpretarEndereco = (enderecoBruto: string): EnderecoInterpretado => {
  const bruto = (enderecoBruto || '').trim();
  if (!bruto) return { rua: '', numero: '', bairro: '', cidade: '', status: 'OK', motivo: '' };

  // Filtra segmentos vazios -- planilha real tem virgula repetida solta
  // ("RUA X,,, 40, BAIRRO - CIDADE"), sobra de formatacao da fonte
  // original, nao um campo a mais de verdade.
  const partes = bruto.split(',').map((p) => p.trim()).filter(Boolean);

  if (partes.length !== 3) {
    return {
      rua: partes[0] || '',
      numero: partes[1] || '',
      bairro: partes[2] || '',
      cidade: '',
      status: 'REVISAR',
      motivo: `Endereço "${bruto}" não veio no formato esperado (rua, número, bairro - cidade) -- confira os campos.`,
    };
  }

  const [rua, numero, bairroCidade] = partes;
  const segmentosBairroCidade = bairroCidade.split(' - ').map((s) => s.trim()).filter(Boolean);

  if (segmentosBairroCidade.length !== 2) {
    return {
      rua,
      numero,
      bairro: bairroCidade,
      cidade: '',
      status: 'REVISAR',
      motivo: `Não encontramos "bairro - cidade" em "${bairroCidade}" -- confira bairro e cidade.`,
    };
  }

  const [bairro, cidade] = segmentosBairroCidade;
  return { rua, numero, bairro, cidade, status: 'OK', motivo: '' };
};

// ---------------------------------------------------------------------------
// Linha da planilha processada
// ---------------------------------------------------------------------------

export interface ClienteImportado {
  /** Identificador estavel da linha -- usado pra reconciliar edicoes do
   * usuario na tela sem depender do nome, que pode repetir. */
  linhaId: number;
  nomeOriginal: string;
  nome: string;
  prefixoCodigoRemovido: string | null;
  documento: string;
  telefone: string;
  enderecoOriginal: string;
  endereco: string;
  numero: string;
  bairro: string;
  cidade: string;
  status: StatusClienteImportado;
  motivo: string;
}

/** "CONSUMIDOR FINAL" e' um registro padrao do proprio Hennder ERP
 * (isPadrao=true, ja existe em todo tenant) -- nunca deve virar um
 * cliente novo importado, senao duplica. */
export const ehConsumidorFinal = (nome: string): boolean => (
  normalizarTextoComparacao(nome) === 'consumidor final'
);

export const processarLinhasClientes = (
  linhas: string[][],
  mapeamento: MapeamentoColunasCliente,
): ClienteImportado[] => linhas
  .filter((linha) => linha.some((celula) => celula && celula.trim()))
  .map((linha, index) => {
    const nomeOriginal = (linha[mapeamento.nome] || '').trim();
    const { nomeLimpo, prefixoRemovido } = removerPrefixoCodigoAntigo(nomeOriginal);
    const documentoBruto = mapeamento.documento !== null ? (linha[mapeamento.documento] || '').trim() : '';
    const telefone = mapeamento.telefone !== null ? (linha[mapeamento.telefone] || '').trim() : '';
    const enderecoOriginal = mapeamento.endereco !== null ? (linha[mapeamento.endereco] || '').trim() : '';

    const doc = interpretarDocumento(documentoBruto);
    const end = interpretarEndereco(enderecoOriginal);

    const status: StatusClienteImportado = (doc.status === 'REVISAR' || end.status === 'REVISAR') ? 'REVISAR' : 'OK';
    const motivo = [doc.motivo, end.motivo].filter(Boolean).join(' ');

    return {
      linhaId: index,
      nomeOriginal,
      nome: nomeLimpo,
      prefixoCodigoRemovido: prefixoRemovido,
      documento: doc.documentoLimpo,
      telefone,
      enderecoOriginal,
      endereco: end.rua,
      numero: end.numero,
      bairro: end.bairro,
      cidade: end.cidade,
      status,
      motivo,
    };
  })
  .filter((item) => item.nome && !ehConsumidorFinal(item.nome));

// ---------------------------------------------------------------------------
// Montagem do cliente final (mesma forma que ClienteForm.tsx grava)
// ---------------------------------------------------------------------------

export interface ClienteParaImportar {
  codigo: string;
  nome: string;
  telefone: string;
  documento: string;
  endereco: string;
  numero: string;
  bairro: string;
  cidade: string;
}

export const montarClienteImportado = (
  cliente: ClienteParaImportar,
  tenantId: string,
  userId: string,
  timestamp: unknown,
): Record<string, unknown> => ({
  codigo: cliente.codigo,
  nome: cliente.nome.toUpperCase().trim(),
  telefone: cliente.telefone,
  email: '',
  documento: cliente.documento,
  endereco: cliente.endereco,
  numero: cliente.numero,
  bairro: cliente.bairro,
  cidade: cliente.cidade,
  limiteDeCredito: null,
  tenantId,
  createdAt: timestamp,
  updatedAt: timestamp,
  criadoPor: userId,
  criadoEm: timestamp,
  alteradoPor: userId,
  alteradoEm: timestamp,
  origemImportacao: 'migracao_cadastro',
});
