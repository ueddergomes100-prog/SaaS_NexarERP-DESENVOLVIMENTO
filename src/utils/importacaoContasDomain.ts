// Funcoes puras da importacao em massa de Contas a Receber / Contas a
// Pagar. Sem Firestore -- leitura de arquivo, upload, busca de
// cliente/fornecedor e gravacao ficam no componente compartilhado
// src/components/financeiro/ImportarContasBase.tsx.
//
// As duas telas gravam no MESMO formato que o resto do sistema grava em
// `transacoes` pra titulo pendente avulso (ver NotaAvulsaForm.tsx, ramo
// "a_prazo" -- saida pendente sem pagamentos.formaPagamento/naturezaFinanceira
// ainda, que so entram quando o titulo e baixado em Contas a Receber/Pagar):
// descricao, categoria, valor(Centavos), tipo, status, data (usada como
// vencimento -- transactionDueDateInput cai pra "data" quando nao ha
// dataVencimento separado), cliente/fornecedorId+Nome.
//
// Decisao (2026-09-09, implantacao Sol Life): a planilha do sistema antigo
// normalmente so lista titulos EM ABERTO (e' pra isso que se importa saldo
// financeiro de uma migracao) -- por isso o default de status e' sempre
// "Pendente" quando a coluna de situacao nao veio ou nao da pra reconhecer
// o texto, nunca "Paga" por acaso.

import { parseValorMonetario } from './importacaoEstoqueDomain';

export type StatusContaImportada = 'OK' | 'REVISAR';
export type StatusPagamentoConta = 'Pendente' | 'Paga';

// ---------------------------------------------------------------------------
// Mapeamento de colunas
// ---------------------------------------------------------------------------

export type CampoColunaConta = 'descricao' | 'valor' | 'vencimento' | 'categoria' | 'parte' | 'documentoParte' | 'status' | 'dataPagamento' | 'chave';

export interface MapeamentoColunasConta {
  descricao: number;
  valor: number;
  vencimento: number;
  categoria: number | null;
  /** Nome do cliente (Contas a Receber) ou fornecedor (Contas a Pagar). */
  parte: number | null;
  /** CPF/CNPJ do cliente/fornecedor. Quando existe, e' ELE que vincula o
   * titulo ao cadastro -- ver resolverVinculoParte. */
  documentoParte: number | null;
  status: number | null;
  dataPagamento: number | null;
  /** Identificador do titulo no sistema de origem. Quando existe, rodar a
   * importacao de novo nao duplica nada -- ver sementeIdImportacao. */
  chave: number | null;
}

const SINONIMOS: Record<CampoColunaConta, string[]> = {
  descricao: ['descricao', 'descr', 'historico', 'titulo', 'documento'],
  valor: ['valor', 'total'],
  vencimento: ['vencimento', 'venc'],
  categoria: ['categoria', 'grupo', 'natureza'],
  parte: ['cliente', 'fornecedor', 'razao social', 'razão'],
  documentoParte: ['cpf', 'cnpj'],
  status: ['situacao', 'situação', 'status'],
  dataPagamento: ['data pagamento', 'pago em', 'quitacao', 'quitação'],
  chave: ['chave'],
};

const normalizarTextoComparacao = (valor: string): string => valor
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLowerCase()
  .trim();

export const inferirMapeamentoColunasConta = (cabecalho: string[]): MapeamentoColunasConta => {
  const normalizados = cabecalho.map(normalizarTextoComparacao);
  const encontrar = (campo: CampoColunaConta, evitar: number[] = []): number => normalizados.findIndex(
    (col, idx) => !evitar.includes(idx) && SINONIMOS[campo].some((sin) => col.includes(sin)),
  );

  const vencimento = encontrar('vencimento');
  const dataPagamento = encontrar('dataPagamento', vencimento >= 0 ? [vencimento] : []);
  const categoria = encontrar('categoria');
  const documentoParte = encontrar('documentoParte');
  const chave = encontrar('chave');
  // "CPF/CNPJ do cliente" contem "cliente": a coluna do documento nunca pode
  // ser tomada como a do nome.
  const parte = encontrar('parte', documentoParte >= 0 ? [documentoParte] : []);
  const status = encontrar('status');
  const valor = encontrar('valor');
  // "documento" e' sinonimo de descricao; a coluna de CPF/CNPJ e a de chave
  // nunca sao a descricao.
  const descricao = encontrar('descricao', [documentoParte, chave].filter((i) => i >= 0));

  return {
    descricao: descricao >= 0 ? descricao : 0,
    valor: valor >= 0 ? valor : 1,
    vencimento: vencimento >= 0 ? vencimento : 2,
    categoria: categoria >= 0 ? categoria : null,
    parte: parte >= 0 ? parte : null,
    documentoParte: documentoParte >= 0 ? documentoParte : null,
    status: status >= 0 ? status : null,
    dataPagamento: dataPagamento >= 0 ? dataPagamento : null,
    chave: chave >= 0 ? chave : null,
  };
};

// ---------------------------------------------------------------------------
// Interpretacao de data (dd/mm/aaaa do export antigo -> aaaa-mm-dd do sistema)
// ---------------------------------------------------------------------------

export interface DataInterpretada {
  data: string;
  status: StatusContaImportada;
  motivo: string;
}

/** Aceita "dd/mm/aaaa", "dd-mm-aaaa" e "aaaa-mm-dd" (planilha ja no
 * formato do sistema, ou export de outro pais). Nunca inverte dia/mes
 * sozinho quando ambos os numeros sao <= 12 (data ambigua de verdade) --
 * fica REVISAR pro usuario decidir. */
export const interpretarDataConta = (dataBruta: string): DataInterpretada => {
  const bruto = (dataBruta || '').trim();
  if (!bruto) return { data: '', status: 'REVISAR', motivo: 'Data em branco.' };

  const isoMatch = bruto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return { data: bruto, status: 'OK', motivo: '' };

  const brMatch = bruto.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (brMatch) {
    const dia = Number(brMatch[1]);
    const mes = Number(brMatch[2]);
    const ano = Number(brMatch[3]);
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) {
      return { data: '', status: 'REVISAR', motivo: `Data "${bruto}" não é válida (dia ou mês fora do intervalo).` };
    }
    const data = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    return { data, status: 'OK', motivo: '' };
  }

  return { data: '', status: 'REVISAR', motivo: `Não foi possível interpretar a data "${bruto}" -- use o formato dd/mm/aaaa.` };
};

// ---------------------------------------------------------------------------
// Interpretacao da situacao (Paga / Pendente)
// ---------------------------------------------------------------------------

const TERMOS_PAGA = ['pago', 'paga', 'quitado', 'quitada', 'recebido', 'recebida', 'liquidado', 'liquidada'];

/** So reconhece "Paga" quando o texto bate um termo conhecido -- qualquer
 * outra coisa (em branco, "aberto", "pendente", texto nao reconhecido) cai
 * em Pendente, que e' o caso normal de uma migracao de saldo. */
export const resolverStatusConta = (textoBruto: string): StatusPagamentoConta => {
  const texto = normalizarTextoComparacao(textoBruto);
  if (!texto) return 'Pendente';
  return TERMOS_PAGA.some((termo) => texto.includes(termo)) ? 'Paga' : 'Pendente';
};

// ---------------------------------------------------------------------------
// Linha da planilha processada
// ---------------------------------------------------------------------------

export interface ContaImportada {
  /** Identificador estavel da linha -- usado pra reconciliar edicoes do
   * usuario na tela sem depender da descricao, que pode repetir. */
  linhaId: number;
  descricao: string;
  valor: number | null;
  valorBruto: string;
  vencimento: string;
  vencimentoBruto: string;
  categoria: string;
  parteNomeBruto: string;
  /** CPF/CNPJ da parte, so digitos ('' quando a planilha nao trouxe). */
  documentoParte: string;
  /** Identificador do titulo na origem ('' quando a planilha nao trouxe). */
  chave: string;
  /** Preenchido pelo componente (precisa da lista de clientes/fornecedores
   * do tenant, que e' Firestore) via resolverVinculoParte -- aqui fica
   * so o texto original da planilha. */
  parteId: string | null;
  parteNome: string;
  vinculo: SituacaoVinculo;
  /** Cadastros que servem pra este titulo quando `vinculo` e' 'ambiguo'. */
  candidatos: ParteCadastrada[];
  avisoVinculo: string;
  statusPagamento: StatusPagamentoConta;
  dataPagamento: string;
  status: StatusContaImportada;
  motivo: string;
}

export const processarLinhasContas = (
  linhas: string[][],
  mapeamento: MapeamentoColunasConta,
): ContaImportada[] => linhas
  .filter((linha) => linha.some((celula) => celula && celula.trim()))
  .map((linha, index) => {
    const descricao = (linha[mapeamento.descricao] || '').trim();
    const valorBruto = (linha[mapeamento.valor] || '').trim();
    const vencimentoBruto = (linha[mapeamento.vencimento] || '').trim();
    const categoria = mapeamento.categoria !== null ? (linha[mapeamento.categoria] || '').trim() : '';
    const parteNomeBruto = mapeamento.parte !== null ? (linha[mapeamento.parte] || '').trim() : '';
    const statusBruto = mapeamento.status !== null ? (linha[mapeamento.status] || '').trim() : '';
    const dataPagamentoBruta = mapeamento.dataPagamento !== null ? (linha[mapeamento.dataPagamento] || '').trim() : '';
    const documentoParte = mapeamento.documentoParte !== null ? normalizarDocumentoParte(linha[mapeamento.documentoParte] || '') : '';
    const chave = mapeamento.chave !== null ? (linha[mapeamento.chave] || '').trim() : '';

    const valor = parseValorMonetario(valorBruto);
    const dataInterpretada = interpretarDataConta(vencimentoBruto);
    const statusPagamento = resolverStatusConta(statusBruto);
    const dataPagamentoInterpretada = statusPagamento === 'Paga'
      ? (dataPagamentoBruta ? interpretarDataConta(dataPagamentoBruta) : dataInterpretada)
      : { data: '', status: 'OK' as StatusContaImportada, motivo: '' };

    const problemas: string[] = [];
    if (!descricao) problemas.push('Descrição em branco.');
    if (valor === null || valor <= 0) problemas.push(`Valor "${valorBruto}" inválido -- precisa ser maior que zero.`);
    if (dataInterpretada.status === 'REVISAR') problemas.push(dataInterpretada.motivo);
    if (statusPagamento === 'Paga' && dataPagamentoInterpretada.status === 'REVISAR') problemas.push(`Data de pagamento: ${dataPagamentoInterpretada.motivo}`);
    const status: StatusContaImportada = problemas.length > 0 ? 'REVISAR' : 'OK';

    return {
      linhaId: index,
      descricao,
      valor,
      valorBruto,
      vencimento: dataInterpretada.data,
      vencimentoBruto,
      categoria,
      parteNomeBruto,
      documentoParte,
      chave,
      parteId: null,
      parteNome: parteNomeBruto.toUpperCase(),
      vinculo: 'sem_parte' as SituacaoVinculo,
      candidatos: [],
      avisoVinculo: '',
      statusPagamento,
      dataPagamento: dataPagamentoInterpretada.data,
      status,
      motivo: problemas.join(' '),
    };
  })
  .filter((item) => item.descricao || item.valorBruto);

// ---------------------------------------------------------------------------
// Vinculo com cliente/fornecedor ja cadastrado
// ---------------------------------------------------------------------------

export interface ParteCadastrada {
  id: string;
  nome: string;
  /** CPF/CNPJ so digitos ('' quando o cadastro nao tem). */
  documento: string;
  codigo: string;
  cidade: string;
  ativo: boolean;
}

/**
 * CPF/CNPJ so digitos, com o zero a esquerda de volta (planilha aberta no
 * Excel perde o zero de CNPJ que comeca com 0). Documento todo zerado e'
 * como o sistema antigo marcava "sem documento" -- vira vazio.
 */
export const normalizarDocumentoParte = (bruto: string): string => {
  const digitos = String(bruto || '').replace(/\D/g, '');
  if (!digitos || /^0+$/.test(digitos)) return '';
  if (digitos.length <= 11) return digitos.padStart(11, '0');
  return digitos.padStart(14, '0');
};

/**
 * vinculado    -> um cadastro so', o titulo vai pra ele
 * ambiguo      -> mais de um cadastro serve; alguem precisa escolher
 * sem_cadastro -> nenhum cadastro serve; o titulo NAO entra
 * sem_parte    -> a planilha nao disse de quem e' o titulo
 */
export type SituacaoVinculo = 'vinculado' | 'ambiguo' | 'sem_cadastro' | 'sem_parte';

export interface VinculoParte {
  situacao: SituacaoVinculo;
  id: string | null;
  nome: string;
  candidatos: ParteCadastrada[];
  aviso: string;
}

const chaveNomeComparacao = (valor: string): string => normalizarTextoComparacao(valor).replace(/\s+/g, ' ');

/** CPF/CNPJ com pontuacao, pra mensagem que o usuario le. */
export const formatarDocumentoParte = (documento: string): string => {
  if (documento.length === 11) return documento.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (documento.length === 14) return documento.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return documento;
};

/**
 * LIGA O TITULO AO CADASTRO SEM ADIVINHAR (2026-09-17, migracao Sol Natus).
 *
 * Antes, o vinculo era so' por nome exato e pegava o PRIMEIRO cadastro com
 * aquele nome. Dois problemas, os dois silenciosos:
 *   - nome de MEI e' limpo na importacao de clientes ("21.145.317 ROSANA"
 *     vira "ROSANA"), entao o nome do relatorio do sistema antigo nao batia
 *     e o titulo entrava solto;
 *   - com dois cadastros de mesmo nome, o titulo ia pro primeiro -- e
 *     ninguem ficava sabendo que podia ser o outro.
 *
 * Agora:
 *   1. Com CPF/CNPJ na planilha, e' ELE que manda. Sem cadastro com aquele
 *      documento, o titulo fica de fora -- mesmo que exista um cadastro com
 *      o mesmo nome. Nome igual com documento diferente (ou sem documento)
 *      nao prova que e' a mesma pessoa; so' vira aviso pra completar o
 *      cadastro.
 *   2. Sem documento na planilha (fornecedor generico do sistema antigo,
 *      tipo IMPOSTOS), vale o nome -- e so' quando ele e' UNICO.
 *   3. Mais de um cadastro servindo = 'ambiguo'. A tela pergunta.
 *
 * Cadastro inativo nao recebe titulo novo. Se ele for o unico com aquele
 * documento, o aviso diz pra reativar.
 */
export const resolverVinculoParte = (
  documentoBruto: string,
  nomeBruto: string,
  partes: ParteCadastrada[],
): VinculoParte => {
  const documento = normalizarDocumentoParte(documentoBruto);
  const nome = String(nomeBruto || '').trim().toUpperCase();
  const chaveNome = chaveNomeComparacao(nome);
  const mesmoNome = (p: ParteCadastrada) => chaveNomeComparacao(p.nome) === chaveNome;

  if (!documento && !nome) {
    return { situacao: 'sem_parte', id: null, nome: '', candidatos: [], aviso: '' };
  }

  if (documento) {
    const porDocumento = partes.filter((p) => p.documento === documento);
    const ativos = porDocumento.filter((p) => p.ativo);
    if (ativos.length === 1) {
      return { situacao: 'vinculado', id: ativos[0].id, nome: ativos[0].nome, candidatos: [], aviso: '' };
    }
    if (ativos.length > 1) {
      return {
        situacao: 'ambiguo', id: null, nome, candidatos: ativos,
        aviso: `${ativos.length} cadastros ativos com o CPF/CNPJ ${formatarDocumentoParte(documento)}. Escolha qual recebe o título.`,
      };
    }
    if (porDocumento.length > 0) {
      return {
        situacao: 'sem_cadastro', id: null, nome, candidatos: [],
        aviso: `O cadastro com o CPF/CNPJ ${formatarDocumentoParte(documento)} (${porDocumento[0].nome}) está inativo. Reative-o e importe de novo.`,
      };
    }
    const homonimo = nome ? partes.find(mesmoNome) : undefined;
    const detalheHomonimo = homonimo
      ? ` Existe "${homonimo.nome}" ${homonimo.documento ? `com outro CPF/CNPJ (${formatarDocumentoParte(homonimo.documento)})` : 'sem CPF/CNPJ'}: se for a mesma pessoa, corrija o documento no cadastro e importe de novo.`
      : ' Cadastre e importe de novo.';
    return {
      situacao: 'sem_cadastro', id: null, nome, candidatos: [],
      aviso: `Nenhum cadastro com o CPF/CNPJ ${formatarDocumentoParte(documento)}.${detalheHomonimo}`,
    };
  }

  const porNome = partes.filter((p) => p.ativo && mesmoNome(p));
  if (porNome.length === 1) {
    return { situacao: 'vinculado', id: porNome[0].id, nome: porNome[0].nome, candidatos: [], aviso: '' };
  }
  if (porNome.length > 1) {
    return {
      situacao: 'ambiguo', id: null, nome, candidatos: porNome,
      aviso: `${porNome.length} cadastros ativos chamados "${nome}" e a planilha não traz CPF/CNPJ. Escolha qual recebe os títulos.`,
    };
  }
  return {
    situacao: 'sem_cadastro', id: null, nome, candidatos: [],
    aviso: `Nenhum cadastro ativo chamado "${nome}". Cadastre e importe de novo.`,
  };
};

/** Titulos que pedem a MESMA escolha (mesmo documento, ou mesmo nome sem
 * documento) sao decididos uma vez so' -- 48 parcelas de IMPOSTOS nao
 * podem virar 48 perguntas. */
export const chaveGrupoVinculo = (conta: Pick<ContaImportada, 'documentoParte' | 'parteNomeBruto'>): string => (
  conta.documentoParte
    ? `doc:${conta.documentoParte}`
    : `nome:${chaveNomeComparacao(conta.parteNomeBruto)}`
);

/**
 * Texto que vira o id do documento do titulo em `transacoes` (o componente
 * tira o hash). Com id fixo por titulo, importar a mesma planilha duas
 * vezes encontra o titulo ja' gravado e pula -- em vez de duplicar o
 * contas a receber inteiro, que era exatamente o risco da mensagem de erro
 * antiga ("tente novamente").
 *
 * O tenant entra na semente porque o id e' global na colecao: duas empresas
 * migrando do mesmo sistema podem ter a mesma chave de titulo.
 */
export const sementeIdImportacao = (tenantId: string, tipo: 'entrada' | 'saida', chave: string): string => (
  `importacao-contas|${tenantId}|${tipo}|${chave.trim()}`
);

// ---------------------------------------------------------------------------
// Montagem da transacao final (mesmo formato que NotaAvulsaForm.tsx grava
// pra titulo pendente avulso, ver cabecalho do arquivo)
// ---------------------------------------------------------------------------

export interface ContaParaImportar {
  descricao: string;
  categoria: string;
  valor: number;
  vencimento: string;
  statusPagamento: StatusPagamentoConta;
  dataPagamento: string;
  parteId: string | null;
  parteNome: string;
  chave?: string;
}

const CATEGORIA_PADRAO: Record<'entrada' | 'saida', string> = {
  entrada: 'VENDAS',
  saida: 'OUTROS',
};

export const montarContaImportada = (
  conta: ContaParaImportar,
  tipo: 'entrada' | 'saida',
  tenantId: string,
  userId: string,
  timestamp: unknown,
): Record<string, unknown> => {
  const valorCentavos = Math.round(conta.valor * 100);
  const campoParteId = tipo === 'entrada' ? 'clienteId' : 'fornecedorId';
  const campoParteNome = tipo === 'entrada' ? 'clienteNome' : 'fornecedorNome';

  return {
    descricao: conta.descricao.trim(),
    categoria: (conta.categoria || CATEGORIA_PADRAO[tipo]).trim().toUpperCase(),
    valor: conta.valor,
    valorCentavos,
    tipo,
    status: conta.statusPagamento,
    data: conta.statusPagamento === 'Paga' ? (conta.dataPagamento || conta.vencimento) : conta.vencimento,
    ...(conta.statusPagamento === 'Paga' ? {
      dataPagamento: conta.dataPagamento || conta.vencimento,
      formaPagamento: 'Outros',
      naturezaFinanceira: 'bancario_digital',
      movimentaCaixaFisico: false,
    } : {}),
    [campoParteId]: conta.parteId,
    ...(conta.parteNome ? { [campoParteNome]: conta.parteNome } : {}),
    tenantId,
    createdAt: timestamp,
    criadoPor: userId,
    criadoEm: timestamp,
    alteradoPor: userId,
    alteradoEm: timestamp,
    origemImportacao: 'migracao_cadastro',
    ...(conta.chave && conta.chave.trim() ? { chaveImportacao: conta.chave.trim() } : {}),
  };
};
