import { isCpfValido, isCnpjValido, tipoDocumento } from './documentoValidacao';

// Funcoes puras da importacao em massa de clientes. Sem Firestore -- leitura
// de arquivo, upload e gravacao ficam em src/pages/Clientes/ImportarClientes.tsx.
// Leitura de arquivo (encoding/delimitador/parser CSV) e' compartilhada com a
// importacao de produtos, ver src/utils/importacaoEstoqueDomain.ts.
//
// Contexto: cliente novo manda um relatorio exportado do sistema antigo com
// o cadastro de clientes. Duas planilhas reais ja vistas, com formatos bem
// diferentes:
//
//  1. Shopping Rural (2026-08-29): rua/numero/bairro/cidade vem tudo
//     EMPACOTADO num unico campo de endereco ("RUA X, 123, BAIRRO - CIDADE"),
//     nome as vezes com o codigo sequencial do sistema antigo colado no
//     inicio ("5254 CONDOMINIO IMPERIAALLEE"). So 4 colunas ao todo.
//  2. Sol Natus (2026-09-14): cada pedaco do endereco JA vem na sua propria
//     coluna (endereco/numero/bairro/cidade/estado/cep separados -- nao
//     precisa desempacotar nada), e traz muito mais colunas: fantasia,
//     inscricao estadual/RG ("identidade"), telefone fixo e celular em
//     pares DDD+numero separados, e-mail e e-mail pra nota fiscal, e ATE
//     DOIS enderecos extras (cobranca e entrega), cada um completo.
//
// Por isso o mapeamento de colunas cobre bem mais campos do que so
// nome/documento/endereco/telefone -- mas o parser do endereco empacotado
// (interpretarEndereco) continua existindo como FALLBACK: so entra em acao
// quando numero/bairro/cidade NAO tem coluna propria mapeada.

export type StatusClienteImportado = 'OK' | 'REVISAR';

// ---------------------------------------------------------------------------
// Mapeamento de colunas
// ---------------------------------------------------------------------------

/** Nomes que aparecem na UI/estado -- nem todos tem coluna own na planilha
 * (telefone/celular podem vir combinados em DDD+numero, ver
 * MapeamentoColunasCliente.telefoneDdd/celularDdd). */
export type CampoColunaCliente =
  | 'nome' | 'documento' | 'fantasia' | 'identidade'
  | 'telefone' | 'celular' | 'email' | 'emailNfe'
  | 'endereco' | 'numero' | 'bairro' | 'cidade' | 'estado' | 'cep' | 'referencia'
  | 'enderecoCobranca' | 'numeroCobranca' | 'bairroCobranca' | 'cidadeCobranca' | 'estadoCobranca' | 'cepCobranca'
  | 'enderecoEntrega' | 'numeroEntrega' | 'bairroEntrega' | 'cidadeEntrega' | 'estadoEntrega' | 'cepEntrega' | 'referenciaEntrega'
  | 'dtUltimaCompra';

export interface MapeamentoColunasCliente {
  nome: number;
  documento: number | null;
  fantasia: number | null;
  identidade: number | null;
  /** DDD do telefone fixo, quando vem em coluna separada (planilha Sol
   * Natus). Ausente na planilha antiga (Shopping Rural) -- ali `telefone`
   * ja vem completo numa coluna so. */
  telefoneDdd: number | null;
  telefone: number | null;
  celularDdd: number | null;
  celular: number | null;
  email: number | null;
  emailNfe: number | null;
  endereco: number | null;
  numero: number | null;
  bairro: number | null;
  cidade: number | null;
  estado: number | null;
  cep: number | null;
  referencia: number | null;
  enderecoCobranca: number | null;
  numeroCobranca: number | null;
  bairroCobranca: number | null;
  cidadeCobranca: number | null;
  estadoCobranca: number | null;
  cepCobranca: number | null;
  enderecoEntrega: number | null;
  numeroEntrega: number | null;
  bairroEntrega: number | null;
  cidadeEntrega: number | null;
  estadoEntrega: number | null;
  cepEntrega: number | null;
  referenciaEntrega: number | null;
  dtUltimaCompra: number | null;
}

/** Sinonimos de cabecalho por campo -- cobre tanto a planilha antiga
 * (Shopping Rural, cabecalhos livres tipo "Endereço") quanto a nova (Sol
 * Natus, cabecalhos tecnicos tipo "endereco_cob"). */
const SINONIMOS: Record<Exclude<CampoColunaCliente, 'telefone' | 'celular'> | 'telefoneDdd' | 'celularDdd' | 'telefoneNumero' | 'celularNumero', string[]> = {
  nome: ['nome', 'razao social', 'razão', 'cliente'],
  documento: ['cpf', 'cnpj', 'documento'],
  fantasia: ['fantasia'],
  identidade: ['identidade', 'inscricao estadual', 'inscrição estadual', 'rg'],
  // 'ddd' sozinho e' ambiguo entre telefone fixo e celular -- resolvido em
  // inferirMapeamentoColunasCliente, que so aceita esta coluna pro fixo
  // quando ela NAO for a mesma que bateu em celularDdd.
  telefoneDdd: ['ddd'],
  telefoneNumero: ['fone', 'telefone'],
  celularDdd: ['ddd_celular', 'ddd celular'],
  celularNumero: ['celular'],
  email: ['e_mail', 'e-mail', 'email'],
  emailNfe: ['e_mail_nfe', 'email nfe', 'e-mail nfe', 'e-mail nf'],
  endereco: ['endereco', 'endereço', 'logradouro'],
  numero: ['numero', 'número'],
  bairro: ['bairro'],
  cidade: ['cidade'],
  estado: ['estado', 'uf'],
  cep: ['cep'],
  referencia: ['referencia', 'referência'],
  enderecoCobranca: ['endereco_cob', 'endereço cobranca', 'endereco cobranca'],
  numeroCobranca: ['numero_cob', 'número cob'],
  bairroCobranca: ['bairro_cob'],
  cidadeCobranca: ['cidade_cob'],
  estadoCobranca: ['estado_cob', 'uf_cob'],
  cepCobranca: ['cep_cob'],
  enderecoEntrega: ['endereco_entrega', 'endereço entrega', 'endereco entrega'],
  numeroEntrega: ['numero_entrega', 'número entrega'],
  bairroEntrega: ['bairro_entrega'],
  cidadeEntrega: ['cidade_entrega'],
  estadoEntrega: ['uf_entrega', 'estado_entrega'],
  cepEntrega: ['cep_entrega'],
  referenciaEntrega: ['referencia_entrega', 'referência entrega'],
  dtUltimaCompra: ['dtultcompra', 'ultima compra', 'última compra'],
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
 * praticamente toda linha (diferente dos demais, que legitimamente ficam
 * em branco pra muitos clientes do sistema antigo -- "vazio" ali e' dado
 * real, nao teria como diferenciar erro de mapeamento). */
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

export const MAPEAMENTO_CLIENTE_VAZIO: MapeamentoColunasCliente = {
  nome: 0, documento: null, fantasia: null, identidade: null,
  telefoneDdd: null, telefone: null, celularDdd: null, celular: null,
  email: null, emailNfe: null,
  endereco: null, numero: null, bairro: null, cidade: null, estado: null, cep: null, referencia: null,
  enderecoCobranca: null, numeroCobranca: null, bairroCobranca: null, cidadeCobranca: null, estadoCobranca: null, cepCobranca: null,
  enderecoEntrega: null, numeroEntrega: null, bairroEntrega: null, cidadeEntrega: null, estadoEntrega: null, cepEntrega: null, referenciaEntrega: null,
  dtUltimaCompra: null,
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
  // Correspondencia EXATA primeiro (cabecalho normalizado === sinonimo) --
  // so cai pro modo "contem" (substring) se nada bateu exato. Sem isso,
  // 'celular' batia por substring dentro de 'ddd_celular' (que CONTEM a
  // palavra "celular"), roubando a coluna errada -- bug real, achado
  // rodando contra a planilha verdadeira da Sol Natus (2026-09-14), onde
  // 'ddd_celular' e 'celular' sao colunas vizinhas e distintas. Mesmo
  // risco existia (por sorte de ordem de coluna) em numero/numero_cob,
  // bairro/bairro_cob, cidade/cidade_cob etc.
  const encontrar = (sinonimos: string[]): number => {
    const exato = normalizados.findIndex((col) => sinonimos.includes(col));
    if (exato >= 0) return exato;
    return normalizados.findIndex((col) => sinonimos.some((sin) => col.includes(sin)));
  };

  const nome = encontrar(SINONIMOS.nome);
  const ddDCelular = encontrar(SINONIMOS.celularDdd);
  // 'ddd' generico so pode ser aceito pro telefone FIXO se nao for a mesma
  // coluna ja usada pelo ddd do celular (senao os dois campos colam na
  // mesma coluna quando so existe 'ddd_celular' no cabecalho).
  const ddDFixoBruto = encontrar(SINONIMOS.telefoneDdd);
  const ddDFixo = ddDFixoBruto === ddDCelular ? -1 : ddDFixoBruto;

  return {
    ...MAPEAMENTO_CLIENTE_VAZIO,
    nome: nome >= 0 ? corrigirColunaNomeVazia(nome, linhasAmostra) : 0,
    documento: encontrar(SINONIMOS.documento) >= 0 ? encontrar(SINONIMOS.documento) : null,
    fantasia: encontrar(SINONIMOS.fantasia) >= 0 ? encontrar(SINONIMOS.fantasia) : null,
    identidade: encontrar(SINONIMOS.identidade) >= 0 ? encontrar(SINONIMOS.identidade) : null,
    telefoneDdd: ddDFixo >= 0 ? ddDFixo : null,
    telefone: encontrar(SINONIMOS.telefoneNumero) >= 0 ? encontrar(SINONIMOS.telefoneNumero) : null,
    celularDdd: ddDCelular >= 0 ? ddDCelular : null,
    celular: encontrar(SINONIMOS.celularNumero) >= 0 ? encontrar(SINONIMOS.celularNumero) : null,
    email: encontrar(SINONIMOS.email) >= 0 ? encontrar(SINONIMOS.email) : null,
    emailNfe: encontrar(SINONIMOS.emailNfe) >= 0 ? encontrar(SINONIMOS.emailNfe) : null,
    endereco: encontrar(SINONIMOS.endereco) >= 0 ? encontrar(SINONIMOS.endereco) : null,
    numero: encontrar(SINONIMOS.numero) >= 0 ? encontrar(SINONIMOS.numero) : null,
    bairro: encontrar(SINONIMOS.bairro) >= 0 ? encontrar(SINONIMOS.bairro) : null,
    cidade: encontrar(SINONIMOS.cidade) >= 0 ? encontrar(SINONIMOS.cidade) : null,
    estado: encontrar(SINONIMOS.estado) >= 0 ? encontrar(SINONIMOS.estado) : null,
    cep: encontrar(SINONIMOS.cep) >= 0 ? encontrar(SINONIMOS.cep) : null,
    referencia: encontrar(SINONIMOS.referencia) >= 0 ? encontrar(SINONIMOS.referencia) : null,
    enderecoCobranca: encontrar(SINONIMOS.enderecoCobranca) >= 0 ? encontrar(SINONIMOS.enderecoCobranca) : null,
    numeroCobranca: encontrar(SINONIMOS.numeroCobranca) >= 0 ? encontrar(SINONIMOS.numeroCobranca) : null,
    bairroCobranca: encontrar(SINONIMOS.bairroCobranca) >= 0 ? encontrar(SINONIMOS.bairroCobranca) : null,
    cidadeCobranca: encontrar(SINONIMOS.cidadeCobranca) >= 0 ? encontrar(SINONIMOS.cidadeCobranca) : null,
    estadoCobranca: encontrar(SINONIMOS.estadoCobranca) >= 0 ? encontrar(SINONIMOS.estadoCobranca) : null,
    cepCobranca: encontrar(SINONIMOS.cepCobranca) >= 0 ? encontrar(SINONIMOS.cepCobranca) : null,
    enderecoEntrega: encontrar(SINONIMOS.enderecoEntrega) >= 0 ? encontrar(SINONIMOS.enderecoEntrega) : null,
    numeroEntrega: encontrar(SINONIMOS.numeroEntrega) >= 0 ? encontrar(SINONIMOS.numeroEntrega) : null,
    bairroEntrega: encontrar(SINONIMOS.bairroEntrega) >= 0 ? encontrar(SINONIMOS.bairroEntrega) : null,
    cidadeEntrega: encontrar(SINONIMOS.cidadeEntrega) >= 0 ? encontrar(SINONIMOS.cidadeEntrega) : null,
    estadoEntrega: encontrar(SINONIMOS.estadoEntrega) >= 0 ? encontrar(SINONIMOS.estadoEntrega) : null,
    cepEntrega: encontrar(SINONIMOS.cepEntrega) >= 0 ? encontrar(SINONIMOS.cepEntrega) : null,
    referenciaEntrega: encontrar(SINONIMOS.referenciaEntrega) >= 0 ? encontrar(SINONIMOS.referenciaEntrega) : null,
    dtUltimaCompra: encontrar(SINONIMOS.dtUltimaCompra) >= 0 ? encontrar(SINONIMOS.dtUltimaCompra) : null,
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

const TODOS_DIGITOS_IGUAIS = /^(\d)\1+$/;

/** Documento em branco e' normal (nem todo cliente antigo tinha CPF/CNPJ
 * cadastrado). Documento "00000000000"/"00000000000000" (todos os
 * digitos iguais) e' um PLACEHOLDER classico de sistema antigo pra "sem
 * documento" -- nunca e' um CPF/CNPJ de verdade (o proprio digito
 * verificador de ambos rejeita matematicamente essa sequencia), entao
 * vira documento vazio direto, sem marcar REVISAR (nao e' um erro do
 * cliente, e' a planilha dizendo "nao tem"). Passou no tamanho mas o
 * digito verificador nao bate (mesma validacao do ClienteForm.tsx) -> ai
 * sim REVISAR, porque pode ser erro de digitacao recuperavel. */
export const interpretarDocumento = (documentoBruto: string): DocumentoInterpretado => {
  const digitos = (documentoBruto || '').replace(/\D/g, '');
  if (!digitos) return { documentoLimpo: '', status: 'OK', motivo: '' };
  if (TODOS_DIGITOS_IGUAIS.test(digitos)) return { documentoLimpo: '', status: 'OK', motivo: '' };

  const tipo = tipoDocumento(digitos);
  if (!tipo) {
    return {
      documentoLimpo: digitos,
      status: 'REVISAR',
      motivo: `CPF/CNPJ com ${digitos.length} dígito(s) -- não é um CPF (11) nem CNPJ (14) válido. Corrija ou apague.`,
    };
  }

  const valido = tipo === 'CPF' ? isCpfValido(digitos) : isCnpjValido(digitos);
  if (!valido) {
    return {
      documentoLimpo: digitos,
      status: 'REVISAR',
      motivo: `${tipo} com dígito verificador que não confere. Confira o número.`,
    };
  }

  return { documentoLimpo: digitos, status: 'OK', motivo: '' };
};

// ---------------------------------------------------------------------------
// Endereco: separa "RUA, NUMERO, BAIRRO - CIDADE" em campos (fallback --
// so usado quando a planilha NAO tem numero/bairro/cidade em colunas
// proprias, ver processarLinhasClientes)
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
// Telefone: junta DDD + numero quando vem em colunas separadas
// ---------------------------------------------------------------------------

/** "(DDD) NUMERO" quando o DDD veio numa coluna separada; so o numero
 * quando nao ha DDD mapeado (planilha antiga, telefone ja vem inteiro
 * numa unica coluna). Nunca inventa mascara/traco -- fixo e celular tem
 * tamanhos diferentes (8 x 9 digitos) e nem sempre batem com o padrao. */
const combinarDddNumero = (ddd: string, numero: string): string => {
  const dddLimpo = (ddd || '').trim();
  const numeroLimpo = (numero || '').trim();
  if (!numeroLimpo) return '';
  return dddLimpo ? `(${dddLimpo}) ${numeroLimpo}` : numeroLimpo;
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
  fantasia: string;
  identidade: string;
  telefone: string;
  celular: string;
  email: string;
  emailNfe: string;
  enderecoOriginal: string;
  endereco: string;
  numero: string;
  bairro: string;
  cidade: string;
  estado: string;
  cep: string;
  referencia: string;
  enderecoCobranca: string;
  numeroCobranca: string;
  bairroCobranca: string;
  cidadeCobranca: string;
  estadoCobranca: string;
  cepCobranca: string;
  enderecoEntrega: string;
  numeroEntrega: string;
  bairroEntrega: string;
  cidadeEntrega: string;
  estadoEntrega: string;
  cepEntrega: string;
  referenciaEntrega: string;
  dtUltimaCompra: string;
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
    const col = (indice: number | null): string => (indice !== null ? (linha[indice] || '').trim() : '');

    const nomeOriginal = col(mapeamento.nome) || (linha[mapeamento.nome] || '').trim();
    const { nomeLimpo, prefixoRemovido } = removerPrefixoCodigoAntigo(nomeOriginal);

    const doc = interpretarDocumento(col(mapeamento.documento));

    // Endereco principal: usa colunas separadas quando existem (Sol Natus);
    // cai no parser do campo empacotado só quando NÃO há numero/bairro/cidade
    // mapeados de propósito (Shopping Rural).
    const temEnderecoSeparado = mapeamento.numero !== null || mapeamento.bairro !== null || mapeamento.cidade !== null;
    const enderecoOriginal = col(mapeamento.endereco);
    let endereco = '';
    let numero = '';
    let bairro = '';
    let cidade = '';
    let statusEndereco: StatusClienteImportado = 'OK';
    let motivoEndereco = '';
    if (temEnderecoSeparado) {
      endereco = enderecoOriginal;
      numero = col(mapeamento.numero);
      bairro = col(mapeamento.bairro);
      cidade = col(mapeamento.cidade);
    } else {
      const end = interpretarEndereco(enderecoOriginal);
      endereco = end.rua;
      numero = end.numero;
      bairro = end.bairro;
      cidade = end.cidade;
      statusEndereco = end.status;
      motivoEndereco = end.motivo;
    }

    const status: StatusClienteImportado = (doc.status === 'REVISAR' || statusEndereco === 'REVISAR') ? 'REVISAR' : 'OK';
    const motivo = [doc.motivo, motivoEndereco].filter(Boolean).join(' ');

    return {
      linhaId: index,
      nomeOriginal,
      nome: nomeLimpo,
      prefixoCodigoRemovido: prefixoRemovido,
      documento: doc.documentoLimpo,
      fantasia: col(mapeamento.fantasia),
      identidade: col(mapeamento.identidade),
      telefone: combinarDddNumero(col(mapeamento.telefoneDdd), col(mapeamento.telefone)),
      celular: combinarDddNumero(col(mapeamento.celularDdd), col(mapeamento.celular)),
      email: col(mapeamento.email),
      emailNfe: col(mapeamento.emailNfe),
      enderecoOriginal,
      endereco,
      numero,
      bairro,
      cidade,
      estado: col(mapeamento.estado),
      cep: col(mapeamento.cep).replace(/\D/g, ''),
      referencia: col(mapeamento.referencia),
      enderecoCobranca: col(mapeamento.enderecoCobranca),
      numeroCobranca: col(mapeamento.numeroCobranca),
      bairroCobranca: col(mapeamento.bairroCobranca),
      cidadeCobranca: col(mapeamento.cidadeCobranca),
      estadoCobranca: col(mapeamento.estadoCobranca),
      cepCobranca: col(mapeamento.cepCobranca).replace(/\D/g, ''),
      enderecoEntrega: col(mapeamento.enderecoEntrega),
      numeroEntrega: col(mapeamento.numeroEntrega),
      bairroEntrega: col(mapeamento.bairroEntrega),
      cidadeEntrega: col(mapeamento.cidadeEntrega),
      estadoEntrega: col(mapeamento.estadoEntrega),
      cepEntrega: col(mapeamento.cepEntrega).replace(/\D/g, ''),
      referenciaEntrega: col(mapeamento.referenciaEntrega),
      dtUltimaCompra: col(mapeamento.dtUltimaCompra),
      status,
      motivo,
    };
  })
  .filter((item) => item.nome && !ehConsumidorFinal(item.nome));

// ---------------------------------------------------------------------------
// Montagem do cliente final (mesma forma que ClienteForm.tsx grava)
// ---------------------------------------------------------------------------

export type ClienteParaImportar = Omit<ClienteImportado, 'linhaId' | 'nomeOriginal' | 'prefixoCodigoRemovido' | 'enderecoOriginal' | 'status' | 'motivo'> & {
  codigo: string;
  /** Resolvido a parte (consulta por CEP), so pro endereco principal --
   * ver ImportarClientes.tsx. */
  codigoIbge: string;
};

export const montarClienteImportado = (
  cliente: ClienteParaImportar,
  tenantId: string,
  userId: string,
  timestamp: unknown,
): Record<string, unknown> => ({
  codigo: cliente.codigo,
  nome: cliente.nome.toUpperCase().trim(),
  fantasia: cliente.fantasia,
  identidade: cliente.identidade,
  telefone: cliente.telefone,
  celular: cliente.celular,
  email: cliente.email,
  emailNfe: cliente.emailNfe,
  documento: cliente.documento,
  endereco: cliente.endereco,
  numero: cliente.numero,
  bairro: cliente.bairro,
  cidade: cliente.cidade,
  estado: cliente.estado,
  cep: cliente.cep,
  codigoIbge: cliente.codigoIbge,
  referencia: cliente.referencia,
  enderecoCobranca: cliente.enderecoCobranca,
  numeroCobranca: cliente.numeroCobranca,
  bairroCobranca: cliente.bairroCobranca,
  cidadeCobranca: cliente.cidadeCobranca,
  estadoCobranca: cliente.estadoCobranca,
  cepCobranca: cliente.cepCobranca,
  enderecoEntrega: cliente.enderecoEntrega,
  numeroEntrega: cliente.numeroEntrega,
  bairroEntrega: cliente.bairroEntrega,
  cidadeEntrega: cliente.cidadeEntrega,
  estadoEntrega: cliente.estadoEntrega,
  cepEntrega: cliente.cepEntrega,
  referenciaEntrega: cliente.referenciaEntrega,
  dtUltimaCompraSistemaAntigo: cliente.dtUltimaCompra,
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
