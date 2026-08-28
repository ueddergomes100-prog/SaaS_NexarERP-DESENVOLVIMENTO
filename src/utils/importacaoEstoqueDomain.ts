// Funcoes puras da importacao em massa de produtos (Estoque). Sem Firestore
// -- leitura de arquivo, upload e gravacao ficam em
// src/pages/Estoque/ImportarProdutos.tsx.
//
// Contexto: cliente novo manda a contagem fisica do estoque antigo numa
// planilha (CSV/XLSX) pra virar o cadastro inicial de produtos. Duas
// dificuldades reais, vistas na primeira planilha de verdade:
//
//  1. Quantidade contada a mao vem cheia de anotacao informal -- "35+2"
//     (soma na hora), "42,280" (decimal com virgula brasileira), "22 mil"
//     (por extenso), "?21.600" (numero com duvida do proprio contador,
//     ponto que pode ser milhar OU virgula decimal digitada errada -- as
//     duas leituras diferem em 1000x, entao NUNCA e resolvido sozinho).
//  2. O sistema antigo do cliente nao tinha embalagem: o mesmo produto
//     vendido solto e em saco virava DOIS cadastros ("RACAO X - KILO" e
//     "RACAO X - SACO"). O Hennder ERP ja resolve isso com um produto so
//     + embalagem (fator de conversao) -- a importacao detecta esses
//     pares pela descricao e sugere a mesclagem, nunca aplica sozinha.

import { normalizeEmbalagens, type Embalagem } from './embalagemDomain';
import { UNIDADE_MEDIDA_FALLBACK } from './unidadeMedidaDomain';

// ---------------------------------------------------------------------------
// Leitura de arquivo: encoding e delimitador
// ---------------------------------------------------------------------------

/** Conta ocorrencias do caractere de substituicao (�) -- sinal quase
 * certo de que o arquivo NAO estava em UTF-8 (foi assim que a primeira
 * planilha real, salva em Windows-1252, apareceu ao decodificar errado). */
const contarCaracteresInvalidos = (texto: string): number => {
  let count = 0;
  for (const ch of texto) if (ch === '�') count++;
  return count;
};

/** Decodifica o arquivo tentando UTF-8 primeiro; se aparecer caractere de
 * substituicao, tenta de novo como Windows-1252 (cp1252) -- cobre o caso
 * real de planilha exportada por Excel/Windows antigo, sem exigir que o
 * usuario saiba ou escolha o encoding na tela. */
export const decodificarArquivoTexto = (buffer: ArrayBuffer): string => {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  if (contarCaracteresInvalidos(utf8) === 0) return utf8;

  try {
    const cp1252 = new TextDecoder('windows-1252', { fatal: false }).decode(buffer);
    if (contarCaracteresInvalidos(cp1252) < contarCaracteresInvalidos(utf8)) return cp1252;
  } catch {
    // TextDecoder sem suporte a windows-1252 no ambiente -- fica com utf8.
  }
  return utf8;
};

/** Delimitador do CSV: testa `;` vs `,` na primeira linha. Planilha
 * brasileira geralmente usa `;` (a virgula ja e o separador decimal). */
export const detectarDelimitador = (primeiraLinha: string): ';' | ',' => {
  const pontoEVirgula = (primeiraLinha.match(/;/g) || []).length;
  const virgula = (primeiraLinha.match(/,/g) || []).length;
  return pontoEVirgula >= virgula ? ';' : ',';
};

/** Parser de CSV com suporte a campo entre aspas contendo o proprio
 * delimitador (ex: `"Longo; estria dos lados"`) e aspas duplicadas
 * escapando aspas (`""`). Testado contra uma planilha real de contagem. */
export const parseDelimitedText = (texto: string, delimitador: string): string[][] => {
  const linhas: string[][] = [];
  let linhaAtual: string[] = [];
  let campo = '';
  let entreAspas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; }
        else entreAspas = false;
      } else campo += c;
    } else if (c === '"') {
      entreAspas = true;
    } else if (c === delimitador) {
      linhaAtual.push(campo);
      campo = '';
    } else if (c === '\r') {
      // ignora -- quebra real vem do \n
    } else if (c === '\n') {
      linhaAtual.push(campo);
      linhas.push(linhaAtual);
      linhaAtual = [];
      campo = '';
    } else {
      campo += c;
    }
  }
  if (campo.length || linhaAtual.length) {
    linhaAtual.push(campo);
    linhas.push(linhaAtual);
  }
  return linhas;
};

// ---------------------------------------------------------------------------
// Mapeamento de colunas
// ---------------------------------------------------------------------------

export type CampoColuna = 'codigo' | 'descricao' | 'quantidade' | 'observacao';

export interface MapeamentoColunas {
  codigo: number;
  descricao: number;
  quantidade: number;
  observacao: number | null;
}

/** Sinonimos de cabecalho pra pre-preencher o mapeamento -- planilha de
 * outro cliente nao vai ter exatamente "Cód.;Descrição;Quantidade
 * contada;Observação", entao a tela sempre mostra o mapeamento pro
 * usuario confirmar, isto aqui e so um chute inicial razoavel. */
const SINONIMOS: Record<CampoColuna, string[]> = {
  codigo: ['cod', 'codigo', 'referencia', 'ref'],
  descricao: ['descricao', 'descr', 'produto', 'nome', 'item'],
  quantidade: ['quantidade', 'quant', 'qtd', 'qtde', 'contada', 'contagem'],
  observacao: ['observacao', 'observ', 'obs', 'nota'],
};

const normalizarTextoComparacao = (valor: string): string => valor
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '') // remove acento
  .toLowerCase()
  .trim();

/** Chuta qual coluna e qual campo comparando o cabecalho com os sinonimos.
 * Sempre devolve um palpite pra codigo/descricao/quantidade (mesmo que
 * errado) e null pra observacao quando nao acha nenhuma candidata --
 * observacao e o unico campo realmente opcional. */
export const inferirMapeamentoColunas = (cabecalho: string[]): MapeamentoColunas => {
  const normalizados = cabecalho.map(normalizarTextoComparacao);

  const encontrar = (campo: CampoColuna): number => normalizados.findIndex(
    (col) => SINONIMOS[campo].some((sin) => col.includes(sin)),
  );

  const codigo = encontrar('codigo');
  const descricao = encontrar('descricao');
  const quantidade = encontrar('quantidade');
  const observacao = encontrar('observacao');

  return {
    codigo: codigo >= 0 ? codigo : 0,
    descricao: descricao >= 0 ? descricao : 1,
    quantidade: quantidade >= 0 ? quantidade : 2,
    observacao: observacao >= 0 ? observacao : (cabecalho.length > 3 ? 3 : null),
  };
};

// ---------------------------------------------------------------------------
// Interpretacao da quantidade contada
// ---------------------------------------------------------------------------

export type StatusItemImportado = 'OK' | 'REVISAR';

export interface QuantidadeInterpretada {
  valor: number | null;
  /** Unidade sugerida pelo sufixo da propria anotacao (kg, sc, ...) --
   * so um palpite pro usuario confirmar no mapeamento de unidade, nunca
   * gravado sozinho. */
  unidadeSugerida: string;
  status: StatusItemImportado;
  motivo: string;
}

const MARCACOES_NAO_NUMERICAS = ['variados', 'cancelar'];

interface TermoInterpretado {
  valor: number;
  unidade: string | null;
  ambiguo: boolean;
  candidatos?: [number, number];
}

/** Interpreta UM termo numerico isolado (sem "+"), com sufixo de unidade
 * colado ou separado por espaco. Devolve null quando nao da pra confiar
 * no numero sem ambiguidade -- nunca inventa uma leitura. */
const interpretarTermo = (termoBruto: string): TermoInterpretado | null => {
  let termo = termoBruto.trim();
  if (!termo) return null;

  let unidade: string | null = null;
  const comSufixo = termo.match(/^([\d.,]+)\s*(kg|k\.|k|sc|mil|mtr\.?)$/i);
  if (comSufixo) {
    termo = comSufixo[1];
    unidade = comSufixo[2].toLowerCase().replace('.', '');
    if (unidade === 'k') unidade = 'kg';
    if (unidade === 'mil') {
      const n = parseFloat(termo.replace(',', '.'));
      if (!Number.isFinite(n)) return null;
      return { valor: n * 1000, unidade: null, ambiguo: false };
    }
  }

  if (/^\d+$/.test(termo)) {
    return { valor: parseInt(termo, 10), unidade, ambiguo: false };
  }
  if (/^\d+,\d{1,3}$/.test(termo)) {
    // Decimal brasileiro (virgula) -- confiavel. Sem unidade explicita,
    // decimal quase sempre significa peso fracionado (kg).
    return { valor: parseFloat(termo.replace(',', '.')), unidade: unidade || 'kg', ambiguo: false };
  }
  if (/^\d{1,3}(\.\d{3})+$/.test(termo)) {
    // Ponto como separador de milhar -- AMBIGUO de proposito. Pode ser
    // milhar de verdade ou virgula decimal digitada errado (42.280 vs
    // 42,280 sao leituras 1000x diferentes). Nunca resolvido sozinho.
    const comoMilhar = parseInt(termo.replace(/\./g, ''), 10);
    const comoDecimal = Number(`${termo.split('.')[0]}.${termo.split('.').slice(1).join('')}`);
    return { valor: NaN, unidade, ambiguo: true, candidatos: [comoMilhar, comoDecimal] };
  }
  return null;
};

/**
 * Interpreta a quantidade contada de UMA linha da planilha. Sempre devolve
 * status REVISAR (nunca resolve sozinho) para: valor em branco, marcacao
 * nao numerica ("Variados", "Cancelar"), traco solto, numero com ponto
 * ambiguo (milhar vs decimal mal digitado), soma com unidades diferentes
 * entre os termos, numero prefixado com "?" (duvida do proprio contador),
 * anotacao incompleta (termina em "+"), ou contradicao entre a quantidade
 * e a observacao ("sem quantidade anotada" mas tem numero).
 */
export const interpretarQuantidade = (
  quantidadeBruta: string,
  observacao?: string,
): QuantidadeInterpretada => {
  const obs = (observacao || '').trim();
  let q = (quantidadeBruta || '').trim();

  if (!q) {
    return {
      valor: null, unidadeSugerida: '', status: 'REVISAR',
      motivo: obs ? `Quantidade em branco -- ${obs}` : 'Quantidade em branco',
    };
  }

  const qLower = q.toLowerCase();
  if (MARCACOES_NAO_NUMERICAS.includes(qLower)) {
    return { valor: null, unidadeSugerida: '', status: 'REVISAR', motivo: `Marcação não numérica na contagem ("${q}")` };
  }
  if (q === '-') {
    return { valor: null, unidadeSugerida: '', status: 'REVISAR', motivo: 'Traço anotado na contagem (quantidade não registrada)' };
  }

  let incerto = false;
  if (q.startsWith('?')) { incerto = true; q = q.slice(1).trim(); }

  let comTracoNaFrente = false;
  if (/^-\s*\d/.test(q)) { comTracoNaFrente = true; q = q.replace(/^-\s*/, ''); }

  let incompleta = false;
  if (/\+\s*$/.test(q)) { incompleta = true; q = q.replace(/\+\s*$/, '').trim(); }

  const termos = q.split('+').map((t) => t.trim()).filter(Boolean);
  if (termos.length === 0) {
    return { valor: null, unidadeSugerida: '', status: 'REVISAR', motivo: 'Não foi possível interpretar a quantidade' };
  }

  const interpretados = termos.map(interpretarTermo);
  if (interpretados.some((t) => t === null)) {
    return { valor: null, unidadeSugerida: '', status: 'REVISAR', motivo: `Não foi possível interpretar "${quantidadeBruta}"` };
  }
  const validos = interpretados as TermoInterpretado[];

  const ambiguo = validos.find((t) => t.ambiguo);
  if (ambiguo) {
    return {
      valor: null, unidadeSugerida: '', status: 'REVISAR',
      motivo: `Número com ponto poderia ser milhar (${ambiguo.candidatos![0]}) ou decimal mal digitado (${ambiguo.candidatos![1]}) -- confirmar com quem contou`,
    };
  }

  const total = validos.reduce((soma, t) => soma + t.valor, 0);
  const unidadeSugerida = validos.find((t) => t.unidade)?.unidade || '';

  if (incerto) {
    return { valor: total, unidadeSugerida, status: 'REVISAR', motivo: `Número prefixado com "?" na folha original (incerteza do contador) -- valor lido: ${total}` };
  }
  if (comTracoNaFrente) {
    return { valor: total, unidadeSugerida, status: 'REVISAR', motivo: `Tinha um "-" antes do número na folha -- confirmar se ${total}${unidadeSugerida ? ' ' + unidadeSugerida : ''} está certo` };
  }
  if (incompleta) {
    return { valor: total, unidadeSugerida, status: 'REVISAR', motivo: `Anotação termina em "+" (contagem incompleta) -- pelo menos ${total}${unidadeSugerida ? ' ' + unidadeSugerida : ''}` };
  }
  if (termos.length > 1 && new Set(validos.map((t) => t.unidade || '')).size > 1) {
    return { valor: total, unidadeSugerida, status: 'REVISAR', motivo: `Soma com unidades possivelmente diferentes entre os termos (${quantidadeBruta}) -- soma deu ${total}, conferir` };
  }
  if (/sem quantidade anotada/i.test(obs)) {
    return { valor: total, unidadeSugerida, status: 'REVISAR', motivo: `Observação diz "sem quantidade anotada" mas a planilha traz ${total} -- contradição, conferir` };
  }

  return { valor: total, unidadeSugerida, status: 'OK', motivo: '' };
};

// ---------------------------------------------------------------------------
// Linha da planilha processada
// ---------------------------------------------------------------------------

export interface ItemImportado {
  /** Identificador estavel da linha (indice) -- usado pra reconciliar
   * edicoes do usuario na tela sem depender do "codigo" do cliente, que
   * pode repetir ou faltar. */
  linhaId: number;
  codigoOriginal: string;
  descricao: string;
  quantidadeBruta: string;
  quantidadeCalculada: number | null;
  unidadeSugerida: string;
  status: StatusItemImportado;
  motivo: string;
  observacao: string;
}

export const processarLinhas = (
  linhas: string[][],
  mapeamento: MapeamentoColunas,
): ItemImportado[] => linhas
  .filter((linha) => linha.some((celula) => celula && celula.trim()))
  .map((linha, index) => {
    const descricao = (linha[mapeamento.descricao] || '').trim();
    const quantidadeBruta = (linha[mapeamento.quantidade] || '').trim();
    const observacao = mapeamento.observacao !== null ? (linha[mapeamento.observacao] || '').trim() : '';
    const interpretada = interpretarQuantidade(quantidadeBruta, observacao);

    return {
      linhaId: index,
      codigoOriginal: (linha[mapeamento.codigo] || '').trim(),
      descricao,
      quantidadeBruta,
      quantidadeCalculada: interpretada.valor,
      unidadeSugerida: interpretada.unidadeSugerida,
      status: interpretada.status,
      motivo: interpretada.motivo,
      observacao,
    };
  })
  .filter((item) => item.descricao);

// ---------------------------------------------------------------------------
// Deteccao de pares "mesmo produto, unidade diferente" (embalagem)
// ---------------------------------------------------------------------------

/** Remove palavras de unidade da descricao pra comparar produtos que so
 * diferem na forma de venda (kg solto vs saco, metro vs rolo). Ex:
 * "ADUBO UREIA 45-00-00 50KG SACO" e "ADUBO UREIA 45-00-00 50KG QUILO"
 * viram a mesma base "ADUBO UREIA 45 00 00". */
export const normalizarDescricaoBase = (descricao: string): string => descricao
  .toUpperCase()
  .normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .replace(/\b\d+\s*KG\b/g, '')
  .replace(/\bQUILOS?\b/g, '')
  .replace(/\bKILOS?\b/g, '')
  .replace(/\bSACOS?\b/g, '')
  .replace(/\bSC\b/g, '')
  .replace(/\bROLOS?\b/g, '')
  .replace(/\bMETROS?\b/g, '')
  .replace(/\bMC\b/g, '')
  .replace(/[-/(),.]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export interface GrupoCandidatoEmbalagem {
  descricaoBase: string;
  itens: ItemImportado[];
  /** Fator de conversao sugerido (unidades base por embalagem), quando a
   * propria descricao ou observacao ja informam o peso do saco/pacote
   * (ex: "50KG SACO" -> 50). Null = usuario precisa digitar, nunca
   * inventado. */
  fatorConversaoSugerido: number | null;
}

/** Agrupa itens que parecem ser o MESMO produto em unidades diferentes.
 * So devolve grupos com 2+ itens -- produto sem par fica de fora. */
export const detectarGruposEmbalagem = (itens: ItemImportado[]): GrupoCandidatoEmbalagem[] => {
  const porBase = new Map<string, ItemImportado[]>();
  itens.forEach((item) => {
    const base = normalizarDescricaoBase(item.descricao);
    if (!base) return;
    if (!porBase.has(base)) porBase.set(base, []);
    porBase.get(base)!.push(item);
  });

  const grupos: GrupoCandidatoEmbalagem[] = [];
  porBase.forEach((itensDoGrupo, base) => {
    if (itensDoGrupo.length < 2) return;
    grupos.push({
      descricaoBase: base,
      itens: itensDoGrupo,
      fatorConversaoSugerido: inferirFatorConversao(itensDoGrupo),
    });
  });
  return grupos;
};

/** Procura um peso explicito ("50KG", "25KG") na descricao ou observacao
 * de qualquer item do grupo -- e o fator de conversao mais comum neste
 * tipo de planilha (peso do saco/pacote). Devolve null se nenhum item
 * trouxer essa informacao, forcando o usuario a digitar. */
const inferirFatorConversao = (itens: ItemImportado[]): number | null => {
  for (const item of itens) {
    const fonte = `${item.descricao} ${item.observacao}`;
    const match = fonte.match(/(\d+)\s*KG/i);
    if (match) {
      const fator = parseInt(match[1], 10);
      if (Number.isFinite(fator) && fator > 0) return fator;
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// Montagem do produto final (mesma forma que EstoqueForm.tsx grava)
// ---------------------------------------------------------------------------

/** Mesmo perfil fiscal "Revenda Simples Nacional" que EstoqueForm.tsx usa
 * de default pro cadastro rapido -- duplicado aqui de proposito (e um
 * literal de 5 campos, nao vale extrair um arquivo compartilhado so por
 * isso). NCM fica de fora: nao da pra inventar por produto. */
const PERFIL_FISCAL_PADRAO = {
  cfop: '5102',
  csosn: '102',
  origem: '0',
};

export interface UnidadeMedidaRef {
  id: string;
  sigla: string;
  casasDecimais: number;
  fracionado: boolean;
}

export interface EmbalagemImportada {
  unidade: UnidadeMedidaRef;
  fatorConversao: number;
  quantidadeNaEmbalagem: number;
}

export interface ProdutoParaImportar {
  codigo: string;
  nome: string;
  categoria: string;
  unidadeBase: UnidadeMedidaRef;
  /** Quantidade final na unidade BASE -- se houver embalagem mesclada, ja
   * inclui a conversao (toBaseQuantity), o estoque nunca fica na unidade
   * da embalagem. */
  quantidade: number;
  precoVenda: number;
  embalagem?: EmbalagemImportada;
}

/** Monta o documento final pra gravar em `estoque`, no MESMO formato
 * (campos planos + sub-objetos precos/estoqueConfig/fiscal/etc.) que
 * EstoqueForm.tsx grava -- pra nao criar um segundo formato de produto
 * que o resto do sistema (Pedido de Venda, OS, PDV) nao espera ler. */
export const montarProdutoImportado = (
  produto: ProdutoParaImportar,
  tenantId: string,
  userId: string,
  timestamp: unknown,
): Record<string, unknown> => {
  const embalagens: Embalagem[] = produto.embalagem ? normalizeEmbalagens([{
    id: `emb-${produto.codigo}`,
    unidadeMedidaId: produto.embalagem.unidade.id,
    unidadeMedidaSigla: produto.embalagem.unidade.sigla,
    unidadeMedidaCasasDecimais: produto.embalagem.unidade.casasDecimais,
    unidadeMedidaFracionado: produto.embalagem.unidade.fracionado,
    descricao: produto.embalagem.unidade.sigla,
    fatorConversao: produto.embalagem.fatorConversao,
    precoVenda: 0,
    codigoBarras: '',
    ativo: true,
  }]) : [];

  const unidadeSigla = produto.unidadeBase.sigla || UNIDADE_MEDIDA_FALLBACK.unidadeMedidaSigla;
  const unidadeCasasDecimais = produto.unidadeBase.casasDecimais ?? UNIDADE_MEDIDA_FALLBACK.unidadeMedidaCasasDecimais;
  const unidadeFracionado = produto.unidadeBase.fracionado ?? UNIDADE_MEDIDA_FALLBACK.unidadeMedidaFracionado;

  return {
    codigo: produto.codigo,
    codigoAutomatico: true,
    nome: produto.nome.toUpperCase().trim(),
    categoria: produto.categoria.trim(),
    statusAtivo: true,
    ativo: true,
    permitirEstoqueNegativo: false,
    quantidade: produto.quantidade,
    precoVenda: produto.precoVenda,
    precoCusto: 0,
    margemLucro: 0,
    lucroEstimado: 0,
    descontoMaximoPercentual: 0,
    unidadeMedidaId: produto.unidadeBase.id,
    unidadeMedidaSigla: unidadeSigla,
    unidadeMedidaCasasDecimais: unidadeCasasDecimais,
    unidadeMedidaFracionado: unidadeFracionado,
    embalagens,
    ncm: '',
    cfop: PERFIL_FISCAL_PADRAO.cfop,
    csosn: PERFIL_FISCAL_PADRAO.csosn,
    origem: PERFIL_FISCAL_PADRAO.origem,
    perfilFiscal: 'revenda_simples',
    precos: {
      venda: produto.precoVenda,
      promocional: 0,
      custo: 0,
      margemLucro: 0,
      lucroEstimado: 0,
      descontoMaximoPercentual: 0,
      impedirVendaAbaixoCusto: false,
    },
    estoqueConfig: {
      controlarEstoque: true,
      quantidadeAtual: produto.quantidade,
      minimo: 0,
      maximo: 0,
      permitirNegativo: false,
      reservarEmOrcamento: true,
      fracionado: unidadeFracionado,
    },
    fiscal: {
      perfilFiscal: 'revenda_simples',
      ncm: '',
      cfopPadraoSaida: PERFIL_FISCAL_PADRAO.cfop,
      origem: PERFIL_FISCAL_PADRAO.origem,
      csosnCst: PERFIL_FISCAL_PADRAO.csosn,
    },
    tenantId,
    createdAt: timestamp,
    updatedAt: timestamp,
    criadoPor: userId,
    criadoEm: timestamp,
    alteradoPor: userId,
    alteradoEm: timestamp,
    // Sinaliza pendencia fiscal sem bloquear a venda -- NCM nao pode ser
    // inventado por produto. A lista de produtos importados sem NCM fica
    // disponivel pro usuario completar depois em Estoque.
    ncmPendente: true,
    origemImportacao: 'contagem_estoque',
  };
};
