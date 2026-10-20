/*
 * GRADE DE PRODUTOS (lojas de roupa -- pedido do dono, 19/10/2026).
 *
 * Uma "grade" e' um cadastro auxiliar com nome e opcoes (TAMANHO: P, M, G;
 * COR: AZUL, PRETO). Um produto pode usar ate' DUAS grades; cada combinacao
 * ligada no quadro (P x AZUL, P x PRETO...) vira um PRODUTO FILHO na colecao
 * `estoque`, com estoque, codigo, codigo de barras e, se quiser, preco
 * proprios. O produto principal (pai) nao tem estoque: ele e' o cadastro
 * (nome, categoria, NCM, preco...) que os filhos herdam a cada salvamento.
 *
 * Por que filho = produto de verdade: toda a logica de estoque que ja'
 * existe (venda, reserva, devolucao, troca, condicional, transferencia,
 * NF-e, servidor) passa a valer para a variacao sem ser reescrita.
 *
 * Campos no documento de estoque (todos do GRUPO, ver CAMPOS_DO_PRODUTO_NO_GRUPO
 * em cadastroGrupoDomain.ts -- a copia de cada filial carrega o mesmo vinculo):
 *  - pai:   temGrade: true, gradeNomes: ['TAMANHO', 'COR']
 *  - filho: ehVariacao: true, produtoPaiChave (chave do pai no grupo),
 *           variacao: ['P', 'AZUL'] (na ordem de gradeNomes), variacaoRotulo: 'P / AZUL',
 *           precoProprio: boolean
 *
 * Codigo do filho: `<codigo do pai>.<numero>` (123.01, 123.02...) -- o numero
 * nunca e' reaproveitado, entao o codigo de barras gerado a partir dele
 * tambem nao se repete. Codigo de barras gerado: EAN-13 com prefixo 2 (uso
 * interno, como o GS1 reserva), trocavel pelo EAN do fornecedor.
 *
 * Este arquivo e' puro (sem Firestore): a tela usa para montar o quadro e
 * planejar o que gravar; o servidor usa para reconhecer pai e filho.
 */

export const LIMITE_DE_GRADES_POR_PRODUTO = 2;
export const LIMITE_DE_OPCOES_POR_GRADE = 60;
export const LIMITE_DO_NOME_DA_GRADE = 30;
export const LIMITE_DA_OPCAO = 30;
/** Numero da variacao vai de 1 a 9999 (4 digitos no codigo de barras gerado). */
const LIMITE_DE_VARIACOES = 9999;

export interface GradeCadastro {
  nome: string;
  opcoes: string[];
}

type Leitura<T> = { ok: true; valor: T } | { ok: false; erro: string };

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const semEspacosRepetidos = (v: string): string => v.replace(/\s+/g, ' ');
/** Comparacao: sem acento, caixa alta, espacos simples. */
export const normalizarOpcao = (v: unknown): string => (
  semEspacosRepetidos(texto(v)).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
);
const emCaixaAlta = (v: unknown): string => semEspacosRepetidos(texto(v)).toUpperCase();

/**
 * O que a tela de Grades digitou: "P, M, G" ou uma opcao por linha. Virgula,
 * ponto-e-virgula e quebra de linha separam; o que repete (sem acento e caixa)
 * fica uma vez so'.
 */
export const lerOpcoesDigitadas = (digitado: string): string[] => {
  const vistas = new Set<string>();
  const opcoes: string[] = [];
  for (const parte of String(digitado ?? '').split(/[\n,;]/)) {
    const opcao = emCaixaAlta(parte);
    if (!opcao) continue;
    const chave = normalizarOpcao(opcao);
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    opcoes.push(opcao);
  }
  return opcoes;
};

/** Confere nome e opcoes de uma grade antes de gravar. Mensagem em portugues quando algo nao serve. */
export const lerGrade = (nome: unknown, opcoes: unknown): Leitura<GradeCadastro> => {
  const nomeLimpo = emCaixaAlta(nome);
  if (!nomeLimpo) return { ok: false, erro: 'Informe o nome da grade (por exemplo, TAMANHO ou COR).' };
  if (nomeLimpo.length > LIMITE_DO_NOME_DA_GRADE) {
    return { ok: false, erro: `O nome da grade passa de ${LIMITE_DO_NOME_DA_GRADE} letras. Use um nome mais curto.` };
  }
  const lista = Array.isArray(opcoes) ? opcoes : [];
  const vistas = new Set<string>();
  const limpas: string[] = [];
  for (const item of lista) {
    const opcao = emCaixaAlta(item);
    if (!opcao) continue;
    if (opcao.length > LIMITE_DA_OPCAO) {
      return { ok: false, erro: `A opção "${opcao}" passa de ${LIMITE_DA_OPCAO} letras. Use um nome mais curto.` };
    }
    const chave = normalizarOpcao(opcao);
    if (vistas.has(chave)) return { ok: false, erro: `A opção "${opcao}" está repetida. Cada opção entra uma vez só.` };
    vistas.add(chave);
    limpas.push(opcao);
  }
  if (limpas.length === 0) return { ok: false, erro: 'Informe pelo menos uma opção da grade (por exemplo, P, M e G).' };
  if (limpas.length > LIMITE_DE_OPCOES_POR_GRADE) {
    return { ok: false, erro: `A grade aceita até ${LIMITE_DE_OPCOES_POR_GRADE} opções. Divida em duas grades se precisar de mais.` };
  }
  return { ok: true, valor: { nome: nomeLimpo, opcoes: limpas } };
};

// ---------------------------------------------------------------------------
// Combinacoes e nomes
// ---------------------------------------------------------------------------

/** Todas as combinacoes, na ordem do quadro: a 1a grade manda, a 2a varia dentro dela. */
export const combinacoes = (grades: GradeCadastro[]): string[][] => {
  const usadas = grades.slice(0, LIMITE_DE_GRADES_POR_PRODUTO).filter((g) => g.opcoes.length > 0);
  if (usadas.length === 0) return [];
  return usadas.reduce<string[][]>(
    (acumulado, grade) => acumulado.flatMap((parcial) => grade.opcoes.map((opcao) => [...parcial, opcao])),
    [[]],
  );
};

export const mesmaVariacao = (a: readonly string[], b: readonly string[]): boolean => (
  a.length === b.length && a.every((opcao, i) => normalizarOpcao(opcao) === normalizarOpcao(b[i]))
);

export const rotuloDaVariacao = (opcoes: readonly string[]): string => opcoes.join(' / ');

/** "CAMISETA BASICA" + [P, AZUL] -> "CAMISETA BASICA P AZUL": e' o nome que sai na venda e na nota. */
export const nomeDaVariacao = (nomePai: string, opcoes: readonly string[]): string => (
  `${emCaixaAlta(nomePai)} ${opcoes.map(emCaixaAlta).join(' ')}`.trim()
);

const doisDigitos = (numero: number): string => String(numero).padStart(2, '0');

export const codigoDaVariacao = (codigoPai: string, numero: number): string => `${texto(codigoPai)}.${doisDigitos(numero)}`;

export const skuDaVariacao = (skuPai: string, numero: number): string => `${texto(skuPai)}-${doisDigitos(numero)}`;

/** Numero da variacao a partir do codigo do filho ("123.07" -> 7); null se nao segue o padrao. */
export const numeroDaVariacao = (codigoFilho: unknown, codigoPai: string): number | null => {
  const prefixo = `${texto(codigoPai)}.`;
  const codigo = texto(codigoFilho);
  if (!prefixo.slice(0, -1) || !codigo.startsWith(prefixo)) return null;
  const numero = Number(codigo.slice(prefixo.length));
  return Number.isInteger(numero) && numero > 0 ? numero : null;
};

/** Proximo numero livre: maior numero ja' usado + 1 (numero nunca e' reaproveitado). */
export const proximoNumeroDaVariacao = (filhos: ReadonlyArray<{ codigo?: unknown }>, codigoPai: string): number => (
  filhos.reduce((maior, filho) => Math.max(maior, numeroDaVariacao(filho.codigo, codigoPai) ?? 0), 0) + 1
);

// ---------------------------------------------------------------------------
// Codigo de barras gerado (EAN-13, prefixo 2 = uso interno)
// ---------------------------------------------------------------------------

/** Digito verificador do EAN-13 a partir dos 12 primeiros digitos. */
export const digitoVerificadorEan13 = (dozeDigitos: string): string => {
  const soma = dozeDigitos.split('').reduce((total, d, i) => total + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return String((10 - (soma % 10)) % 10);
};

/**
 * 2 + 7 digitos do codigo do pai + 4 digitos do numero da variacao + DV.
 * Deterministico: o mesmo pai e numero sempre dao o mesmo codigo. Quem grava
 * confere se ja' esta em uso (codigo do pai com letras pode coincidir).
 */
export const codigoDeBarrasGerado = (codigoPai: string, numero: number): string => {
  const digitosDoPai = texto(codigoPai).replace(/\D/g, '').slice(-7).padStart(7, '0');
  const doze = `2${digitosDoPai}${String(Math.min(Math.max(numero, 1), LIMITE_DE_VARIACOES)).padStart(4, '0')}`;
  return `${doze}${digitoVerificadorEan13(doze)}`;
};

// ---------------------------------------------------------------------------
// Reconhecer pai e filho num documento de estoque
// ---------------------------------------------------------------------------

export const ehProdutoComGrade = (dados: Record<string, unknown> | null | undefined): boolean => dados?.temGrade === true;
export const ehVariacao = (dados: Record<string, unknown> | null | undefined): boolean => dados?.ehVariacao === true;

export interface FilhoExistente {
  id: string;
  variacao: string[];
  codigo: string;
  codigoBarras: string;
  precoProprio: boolean;
  precoVenda: number;
  quantidade: number;
  quantidadeReservada: number;
  ativo: boolean;
}

/** Le um documento de estoque que e' variacao (ehVariacao) no formato que o quadro usa. */
export const lerFilho = (id: string, dados: Record<string, unknown>): FilhoExistente => {
  const precos = dados.precos && typeof dados.precos === 'object' ? dados.precos as Record<string, unknown> : {};
  return {
    id,
    variacao: Array.isArray(dados.variacao) ? dados.variacao.map((o) => emCaixaAlta(o)) : [],
    codigo: texto(dados.codigo),
    codigoBarras: texto(dados.codigoBarras),
    precoProprio: dados.precoProprio === true,
    precoVenda: Number(dados.precoVenda ?? precos.venda ?? 0) || 0,
    quantidade: Number(dados.quantidade ?? 0) || 0,
    quantidadeReservada: Number(dados.quantidadeReservada ?? 0) || 0,
    ativo: dados.ativo !== false && dados.statusAtivo !== false,
  };
};

// ---------------------------------------------------------------------------
// O quadro de combinacoes (tela do produto)
// ---------------------------------------------------------------------------

export interface LinhaDaGrade {
  opcoes: string[];
  rotulo: string;
  /** Combinacao em uso: cria o filho que falta / mantem o existente ativo. */
  ligada: boolean;
  /** Filho ja' gravado para esta combinacao (null = ainda nao existe). */
  filhoId: string | null;
  filhoAtivo: boolean;
  codigo: string;
  codigoBarras: string;
  precoProprio: boolean;
  /** Texto do campo de preco (so' vale com precoProprio). */
  precoVenda: string;
  /** Texto do campo "estoque inicial" (so' para linha que ainda vai ser criada). */
  quantidadeInicial: string;
  quantidade: number;
  quantidadeReservada: number;
  /** Filho cuja combinacao saiu da grade (opcao removida): continua existindo, so' nao e' mais oferecido. */
  foraDaGrade: boolean;
}

const linhaDoFilho = (opcoes: string[], filho: FilhoExistente | undefined, foraDaGrade: boolean): LinhaDaGrade => ({
  opcoes,
  rotulo: rotuloDaVariacao(opcoes),
  ligada: filho ? filho.ativo : false,
  filhoId: filho ? filho.id : null,
  filhoAtivo: filho ? filho.ativo : false,
  codigo: filho ? filho.codigo : '',
  codigoBarras: filho ? filho.codigoBarras : '',
  precoProprio: filho ? filho.precoProprio : false,
  precoVenda: filho && filho.precoProprio && filho.precoVenda > 0 ? filho.precoVenda.toFixed(2) : '',
  quantidadeInicial: '',
  quantidade: filho ? filho.quantidade : 0,
  quantidadeReservada: filho ? filho.quantidadeReservada : 0,
  foraDaGrade,
});

/**
 * Quadro: uma linha por combinacao das grades escolhidas, casada com o filho
 * que ja' existe (pela variacao). Filho que nao casa com nenhuma combinacao
 * (a opcao saiu da grade) entra no fim, marcado -- nada some da tela.
 */
export const montarLinhasDaGrade = (grades: GradeCadastro[], filhos: FilhoExistente[]): LinhaDaGrade[] => {
  const usados = new Set<string>();
  const linhas = combinacoes(grades).map((opcoes) => {
    const filho = filhos.find((f) => !usados.has(f.id) && mesmaVariacao(f.variacao, opcoes));
    if (filho) usados.add(filho.id);
    return linhaDoFilho(opcoes, filho, false);
  });
  const sobras = filhos.filter((f) => !usados.has(f.id)).map((f) => linhaDoFilho(f.variacao, f, true));
  return [...linhas, ...sobras];
};

/** Quantas linhas estao ligadas (filho ativo ou a criar). */
export const totalLigadas = (linhas: readonly LinhaDaGrade[]): number => linhas.filter((l) => l.ligada).length;

// ---------------------------------------------------------------------------
// Planejar o que gravar quando o produto e' salvo
// ---------------------------------------------------------------------------

export interface VariacaoACriar {
  opcoes: string[];
  rotulo: string;
  numero: number;
  codigo: string;
  sku: string;
  nome: string;
  codigoBarras: string;
  precoProprio: boolean;
  precoVenda: number;
  quantidadeInicial: number;
}

export interface VariacaoAAtualizar {
  id: string;
  opcoes: string[];
  rotulo: string;
  nome: string;
  codigoBarras: string;
  precoProprio: boolean;
  precoVenda: number;
}

export interface PlanoDasVariacoes {
  criar: VariacaoACriar[];
  atualizar: VariacaoAAtualizar[];
  /** Filhos ativos cuja linha foi desligada: inativar pelo servidor (confere reserva, zera saldo). */
  inativar: Array<{ id: string; rotulo: string }>;
  /** Filhos inativos cuja linha foi ligada de novo: reativar pelo servidor. */
  reativar: Array<{ id: string; rotulo: string }>;
}

export interface PedidoDePlano {
  linhas: readonly LinhaDaGrade[];
  filhos: readonly FilhoExistente[];
  codigoPai: string;
  skuPai: string;
  nomePai: string;
  /** Codigo de barras -> id do produto que o usa, no catalogo inteiro desta empresa. */
  codigosDeBarrasEmUso: ReadonlyMap<string, string>;
  /** Unidade do pai aceita fracao? Decide se o estoque inicial pode ter decimais. */
  unidadeFracionada: boolean;
}

const lerDecimal = (valor: string): number => Number(String(valor ?? '').trim().replace(',', '.'));

/**
 * Confere o quadro e devolve o que gravar. Erro com mensagem em portugues
 * quando algo nao serve (nada e' gravado pela metade: a tela so' grava com
 * o plano inteiro pronto).
 */
export const planejarVariacoes = (pedido: PedidoDePlano): { ok: true; plano: PlanoDasVariacoes } | { ok: false; erro: string } => {
  const { linhas, filhos, codigoPai, skuPai, nomePai, codigosDeBarrasEmUso, unidadeFracionada } = pedido;
  if (!texto(codigoPai)) return { ok: false, erro: 'O produto principal precisa de código interno antes de ganhar variações.' };
  if (totalLigadas(linhas) === 0 && filhos.length === 0) {
    return { ok: false, erro: 'Ligue pelo menos uma combinação da grade (por exemplo, P / AZUL) para o produto ter variações.' };
  }

  const barrasNoQuadro = new Map<string, string>();
  const plano: PlanoDasVariacoes = { criar: [], atualizar: [], inativar: [], reativar: [] };
  let numero = proximoNumeroDaVariacao(filhos, codigoPai);

  for (const linha of linhas) {
    if (!linha.ligada && !linha.filhoId) continue;
    const precoVenda = linha.precoProprio ? lerDecimal(linha.precoVenda) : 0;
    if (linha.precoProprio && !(precoVenda > 0)) {
      return { ok: false, erro: `Informe o preço próprio da variação ${linha.rotulo} ou desmarque "Preço próprio" nela.` };
    }
    const codigoBarras = texto(linha.codigoBarras);
    if (codigoBarras) {
      const outraLinha = barrasNoQuadro.get(codigoBarras);
      if (outraLinha && outraLinha !== linha.rotulo) {
        return { ok: false, erro: `O código de barras ${codigoBarras} está repetido nas variações ${outraLinha} e ${linha.rotulo}. Cada variação precisa de um código de barras próprio.` };
      }
      barrasNoQuadro.set(codigoBarras, linha.rotulo);
      const donoNoCatalogo = codigosDeBarrasEmUso.get(codigoBarras);
      if (donoNoCatalogo && donoNoCatalogo !== linha.filhoId) {
        return { ok: false, erro: `O código de barras ${codigoBarras} (variação ${linha.rotulo}) já está em outro produto. Confira o cadastro ou deixe em branco para o sistema gerar um.` };
      }
    }

    if (linha.filhoId) {
      if (linha.ligada && !linha.filhoAtivo) plano.reativar.push({ id: linha.filhoId, rotulo: linha.rotulo });
      if (!linha.ligada && linha.filhoAtivo) plano.inativar.push({ id: linha.filhoId, rotulo: linha.rotulo });
      plano.atualizar.push({
        id: linha.filhoId,
        opcoes: linha.opcoes,
        rotulo: linha.rotulo,
        nome: nomeDaVariacao(nomePai, linha.opcoes),
        codigoBarras,
        precoProprio: linha.precoProprio,
        precoVenda,
      });
      continue;
    }

    const quantidadeInicial = texto(linha.quantidadeInicial) ? lerDecimal(linha.quantidadeInicial) : 0;
    if (!Number.isFinite(quantidadeInicial) || quantidadeInicial < 0) {
      return { ok: false, erro: `O estoque inicial da variação ${linha.rotulo} precisa ser um número maior ou igual a zero.` };
    }
    if (!unidadeFracionada && !Number.isInteger(quantidadeInicial)) {
      return { ok: false, erro: `O estoque inicial da variação ${linha.rotulo} não pode ter fração: a unidade do produto não é fracionada.` };
    }
    if (numero > LIMITE_DE_VARIACOES) {
      return { ok: false, erro: `Este produto já passou de ${LIMITE_DE_VARIACOES} variações. Cadastre outro produto principal.` };
    }
    let barras = codigoBarras;
    if (!barras) {
      // Gerado a partir do numero; se por coincidencia ja' existe no catalogo
      // (ou em outra linha do quadro), pula o numero -- nunca repete.
      barras = codigoDeBarrasGerado(codigoPai, numero);
      while (codigosDeBarrasEmUso.has(barras) || barrasNoQuadro.has(barras)) {
        numero += 1;
        if (numero > LIMITE_DE_VARIACOES) {
          return { ok: false, erro: 'Não foi possível gerar um código de barras livre para a variação. Informe o código de barras à mão.' };
        }
        barras = codigoDeBarrasGerado(codigoPai, numero);
      }
      barrasNoQuadro.set(barras, linha.rotulo);
    }
    plano.criar.push({
      opcoes: linha.opcoes,
      rotulo: linha.rotulo,
      numero,
      codigo: codigoDaVariacao(codigoPai, numero),
      sku: skuDaVariacao(skuPai, numero),
      nome: nomeDaVariacao(nomePai, linha.opcoes),
      codigoBarras: barras,
      precoProprio: linha.precoProprio,
      precoVenda,
      quantidadeInicial,
    });
    numero += 1;
  }
  return { ok: true, plano };
};

// ---------------------------------------------------------------------------
// Os campos do filho a partir do cadastro do pai
// ---------------------------------------------------------------------------

/**
 * O que NUNCA desce do pai para o filho: o que identifica cada um, o que e'
 * movimento (saldo, reserva, situacao), o historico de preco e os campos de
 * controle (data, autor, espelho das filiais).
 */
const CAMPOS_SO_DO_PAI = new Set([
  'id', 'tenantId', 'temGrade', 'gradeNomes',
  'nome', 'codigo', 'skuSistema', 'slugUrl', 'codigoBarras',
  'quantidade', 'quantidadeReservada', 'ativo', 'statusAtivo',
  'historicoPrecos', 'ultimaAlteracaoPreco', 'custoNaUltimaPrecificacao',
  'createdAt', 'updatedAt', 'criadoEm', 'criadoPor', 'alteradoEm', 'alteradoPor', 'ultimaAlteracao',
  'createdBy', 'updatedBy', 'createdByName', 'updatedByName',
  'grupoChave', 'filialOrigem', 'cadastroHash',
]);

export interface IdentidadeDaVariacao {
  nome: string;
  codigo: string;
  sku: string;
  codigoBarras: string;
  opcoes: readonly string[];
  rotulo: string;
  produtoPaiChave: string;
  precoProprio: boolean;
  /** Preco de venda proprio (so' com precoProprio). */
  precoVenda: number;
}

const slug = (valor: string): string => valor.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const objeto = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});

/**
 * Documento do filho: o cadastro do pai (categoria, unidade, fiscal, custo,
 * embalagens...) mais a identidade da variacao. Preco: igual ao do pai, ou o
 * proprio -- nesse caso os precos a vista/a prazo do pai NAO descem (a venda
 * cai no preco de venda proprio) e o promocional zera. Sem `quantidade`,
 * `ativo` e `historicoPrecos`: quem cria o filho acrescenta o saldo inicial e
 * a situacao; quem atualiza nunca mexe neles.
 */
export const camposDaVariacao = (pai: Record<string, unknown>, variacao: IdentidadeDaVariacao): Record<string, unknown> => {
  const campos: Record<string, unknown> = {};
  for (const [campo, valor] of Object.entries(pai)) {
    if (CAMPOS_SO_DO_PAI.has(campo) || valor === undefined) continue;
    campos[campo] = valor;
  }
  const precoCusto = Number(pai.precoCusto ?? objeto(pai.precos).custo ?? 0) || 0;
  const precoVenda = variacao.precoProprio ? variacao.precoVenda : Number(pai.precoVenda ?? objeto(pai.precos).venda ?? 0) || 0;
  const precosDoPai = objeto(pai.precos);
  const margemLucro = precoCusto > 0 ? ((precoVenda - precoCusto) / precoCusto) * 100 : 0;
  const lucroEstimado = precoVenda - precoCusto;

  if (variacao.precoProprio) {
    delete campos.precoAVista;
    delete campos.precoAPrazo;
    const { aVista: _aVista, aPrazo: _aPrazo, ...precosProprios } = precosDoPai;
    campos.precoPromocional = 0;
    campos.precos = { ...precosProprios, venda: precoVenda, promocional: 0, margemLucro, lucroEstimado };
  } else if (pai.precos !== undefined) {
    campos.precos = { ...precosDoPai };
  }
  campos.precoVenda = precoVenda;
  campos.margemLucro = margemLucro;
  campos.lucroEstimado = lucroEstimado;

  // Embalagens descem sem o codigo de barras: o EAN do saco do pai nao pode
  // apontar para todas as variacoes ao mesmo tempo.
  if (Array.isArray(pai.embalagens)) {
    campos.embalagens = pai.embalagens.map((e) => ({ ...objeto(e), codigoBarras: '' }));
  }
  if (pai.ecommerce !== undefined) {
    campos.ecommerce = { ...objeto(pai.ecommerce), skuSistema: variacao.sku, slugUrl: slug(variacao.nome) };
  }

  return {
    ...campos,
    nome: variacao.nome,
    codigo: variacao.codigo,
    skuSistema: variacao.sku,
    slugUrl: slug(variacao.nome),
    codigoBarras: variacao.codigoBarras,
    ehVariacao: true,
    produtoPaiChave: variacao.produtoPaiChave,
    variacao: [...variacao.opcoes],
    variacaoRotulo: variacao.rotulo,
    precoProprio: variacao.precoProprio,
  };
};

/** Os campos do filho que a atualizacao compara: mudou algum, regrava; senao, nada. */
export const variacaoPrecisaAtualizar = (atual: Record<string, unknown>, novos: Record<string, unknown>): boolean => (
  Object.entries(novos).some(([campo, valor]) => JSON.stringify(atual[campo] ?? null) !== JSON.stringify(valor ?? null))
);

// ---------------------------------------------------------------------------
// Ligar e desligar a grade num produto
// ---------------------------------------------------------------------------

/** Produto com saldo ou reserva nao vira pai: o estoque passa a ser dos filhos. */
export const bloqueioParaLigarGrade = (produto: { quantidade?: unknown; quantidadeReservada?: unknown }): string | null => {
  const saldo = Number(produto.quantidade ?? 0) || 0;
  const reservada = Number(produto.quantidadeReservada ?? 0) || 0;
  if (saldo !== 0) {
    return `Este produto tem ${saldo} em estoque. Com grade, o estoque fica em cada variação: zere o saldo pelo Ajuste Manual de Estoque antes de ligar a grade.`;
  }
  if (reservada > 0) {
    return `Este produto tem ${reservada} reservado em pré-venda, condicional, OS ou troca. Resolva a reserva antes de ligar a grade.`;
  }
  return null;
};

/** Pai com filhos nao volta a ser produto simples: as variacoes ficariam soltas. */
export const bloqueioParaDesligarGrade = (temFilhos: boolean): string | null => (
  temFilhos
    ? 'Este produto já tem variações cadastradas e não volta a ser produto simples. Inative as variações que não usa mais no quadro da grade.'
    : null
);

// ---------------------------------------------------------------------------
// Lista de Estoque: principais com as variacoes embaixo
// ---------------------------------------------------------------------------

export interface ItemAgrupavel {
  id: string;
  temGrade?: boolean;
  ehVariacao?: boolean;
  produtoPaiChave?: string;
  quantidade?: number;
  quantidadeReservada?: number;
  ativo?: boolean;
}

export interface GrupoDaLista<T extends ItemAgrupavel> {
  principais: T[];
  /** chave do pai -> variacoes (na ordem em que vieram). */
  variacoesPorPai: Map<string, T[]>;
}

/**
 * Separa a lista em principais (produto comum ou pai) e variacoes agrupadas
 * pela chave do pai. Variacao cujo pai nao esta na lista (filtro de filial,
 * por exemplo) volta para o nivel de cima -- nunca some.
 */
export const agruparVariacoes = <T extends ItemAgrupavel>(itens: readonly T[], chaveDe: (item: T) => string): GrupoDaLista<T> => {
  const chavesDosPais = new Set(itens.filter((i) => i.temGrade === true).map(chaveDe));
  const principais: T[] = [];
  const variacoesPorPai = new Map<string, T[]>();
  for (const item of itens) {
    const pai = item.ehVariacao === true ? texto(item.produtoPaiChave) : '';
    if (pai && chavesDosPais.has(pai)) {
      if (!variacoesPorPai.has(pai)) variacoesPorPai.set(pai, []);
      variacoesPorPai.get(pai)!.push(item);
    } else {
      principais.push(item);
    }
  }
  return { principais, variacoesPorPai };
};

/** Saldo e reserva do pai na lista = soma das variacoes ativas. */
export const somaDasVariacoes = (variacoes: readonly ItemAgrupavel[]): { quantidade: number; quantidadeReservada: number } => (
  variacoes.filter((v) => v.ativo !== false).reduce((total, v) => ({
    quantidade: total.quantidade + (Number(v.quantidade ?? 0) || 0),
    quantidadeReservada: total.quantidadeReservada + (Number(v.quantidadeReservada ?? 0) || 0),
  }), { quantidade: 0, quantidadeReservada: 0 })
);

// ---------------------------------------------------------------------------
// Cadastro de Grades: o que ja' esta em uso nao se altera
// ---------------------------------------------------------------------------

export interface PaiDaGrade {
  chave: string;
  gradeNomes: readonly string[];
}

export interface FilhoDaGrade {
  produtoPaiChave: string;
  variacao: readonly string[];
}

/**
 * Opcoes desta grade que alguma variacao ja' usa (normalizadas): renomear ou
 * tirar uma delas deixaria a variacao apontando para uma opcao que nao
 * existe. O nome da grade em uso por algum produto tambem nao muda.
 */
export const opcoesEmUso = (nomeDaGrade: string, pais: readonly PaiDaGrade[], filhos: readonly FilhoDaGrade[]): Set<string> => {
  const nome = normalizarOpcao(nomeDaGrade);
  const usadas = new Set<string>();
  for (const pai of pais) {
    const posicao = pai.gradeNomes.findIndex((g) => normalizarOpcao(g) === nome);
    if (posicao < 0) continue;
    for (const filho of filhos) {
      if (filho.produtoPaiChave !== pai.chave) continue;
      const opcao = normalizarOpcao(filho.variacao[posicao]);
      if (opcao) usadas.add(opcao);
    }
  }
  return usadas;
};

export const gradeEmUso = (nomeDaGrade: string, pais: readonly PaiDaGrade[]): boolean => {
  const nome = normalizarOpcao(nomeDaGrade);
  return pais.some((pai) => pai.gradeNomes.some((g) => normalizarOpcao(g) === nome));
};
