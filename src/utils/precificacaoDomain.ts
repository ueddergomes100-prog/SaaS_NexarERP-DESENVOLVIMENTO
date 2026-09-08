// Precificacao: comparar a margem de HOJE com a margem do dia em que o
// preco de venda foi definido.
//
// REGRA DE PRODUTO (decisao do dono, 2026-09-08): o sistema NUNCA reajusta
// preco sozinho. Comprou mais caro? O preco de venda fica exatamente onde
// esta -- o sistema so AVISA que a margem mudou, e quem decide aumentar (ou
// aceitar a margem menor) e' a pessoa. Por isso este arquivo so calcula e
// compara; nao existe nenhuma funcao aqui que "corrija" preco.
//
// A base da comparacao e' um FATO gravado no produto
// (`custoNaUltimaPrecificacao`): quanto custava a mercadoria no dia em que
// aquele preco de venda foi definido. Guardar o custo, e nao a margem
// pretendida, deixa a mensagem concreta e conferivel: "quando voce definiu
// R$ 79,20, o custo era R$ 44,00".

/** A tela de Precificacao nasce desligada: chave nova sempre comeca com o
 * comportamento de hoje (a tela nao existia). Cada empresa liga a sua em
 * Configuracoes. */
export const DEFAULT_HABILITAR_TELA_PRECIFICACAO = false;

export type DirecaoMargem = 'subiu' | 'caiu' | 'manteve';

export interface ComparacaoMargem {
  /** Markup % que o preco tinha no dia em que foi definido. */
  margemAnterior: number;
  /** Markup % que o mesmo preco tem com o custo de hoje. */
  margemAtual: number;
  direcao: DirecaoMargem;
  /** margemAtual - margemAnterior, em PONTOS percentuais. */
  diferencaPontos: number;
}

/** Margem no formato que o sistema ja usava no cadastro do produto: markup
 * sobre o CUSTO (80% = custo x 1,80), nao margem sobre a venda. */
export const margemMarkup = (precoVenda: number, custo: number): number => (
  custo > 0 ? ((precoVenda - custo) / custo) * 100 : 0
);

/** Preco que devolve uma margem desejada, dado o custo atual. Existe pro
 * botao "voltar para a margem de X%" -- acao que a PESSOA clica, nunca
 * aplicada automaticamente. */
export const precoParaMargem = (custo: number, margemPercentual: number): number => (
  custo * (1 + margemPercentual / 100)
);

// ---------------------------------------------------------------------------
// Gravacao em lote (tela de Precificacao)
// ---------------------------------------------------------------------------

/** Uma linha da grade de precificacao. Os campos de dinheiro sao STRING de
 * proposito -- e o mesmo padrao de ImportarProdutos.tsx: deixa a pessoa
 * digitar virgula e deixar o campo vazio sem o valor "pular" enquanto ela
 * digita. A conversao acontece so aqui, na hora de montar a gravacao. */
export interface LinhaPrecificacao {
  produtoId: string;
  produtoNome: string;
  /** Custo atual do cadastro. Nunca editavel na tela: vem da compra (CMV da
   * nota avulsa, entrada de XML) ou da composicao. */
  custoAtual: number;
  custoNaUltimaPrecificacao?: number | null;
  precoVenda: string;
  precoAVista: string;
  precoAPrazo: string;
  precoPromocional: string;
}

/** Precos que ja estao gravados no produto, pra saber o que de fato mudou. */
export interface PrecosProdutoOriginal {
  precoVenda: number;
  precoPromocional: number;
  precoAVista?: number | null;
  precoAPrazo?: number | null;
}

export interface AtualizacaoPreco {
  /** Campos prontos pro `batch.update()`. As chaves com ponto (`precos.venda`)
   * atualizam so aquele campo do objeto legado `precos`, sem apagar o resto
   * dele (comissao, desconto maximo...). */
  campos: Record<string, number | string | null>;
  mudouPrecoVenda: boolean;
  /** Nada mudou em relacao ao gravado -- a tela usa pra nao mandar o produto
   * pro batch a toa. */
  semMudanca: boolean;
}

const toNumeroObrigatorio = (valor: string): number => {
  const limpo = valor.trim().replace(',', '.');
  if (!limpo) return 0;
  const numero = Number(limpo);
  return Number.isFinite(numero) ? numero : 0;
};

/** Campo em branco significa "nao preenchido ainda", NAO "de graca" -- mesma
 * distincao que parseComissaoPercentualInput faz no cadastro. Devolve
 * `undefined` pra chave ser OMITIDA da gravacao (o Firestore recusa
 * `undefined`, e gravar 0 mudaria o significado). */
const toNumeroOpcional = (valor: string): number | undefined => {
  const limpo = valor.trim();
  if (!limpo) return undefined;
  const numero = Number(limpo.replace(',', '.'));
  return Number.isFinite(numero) ? numero : undefined;
};

/**
 * Monta os campos que a gravacao em lote escreve num produto, com as MESMAS
 * regras do cadastro individual (EstoqueForm.tsx). A que mais importa:
 * `custoNaUltimaPrecificacao` so e reescrito quando o PRECO DE VENDA muda --
 * e' isso que faz o aviso "a margem caiu" continuar funcionando depois de uma
 * compra que mexeu so no custo.
 *
 * `agoraIso` entra por parametro (em vez de `new Date()` aqui dentro) pra
 * funcao continuar pura e testavel.
 */
export const montarAtualizacaoPreco = (
  linha: LinhaPrecificacao,
  original: PrecosProdutoOriginal,
  agoraIso: string,
): AtualizacaoPreco => {
  const precoVenda = toNumeroObrigatorio(linha.precoVenda);
  const precoPromocional = toNumeroObrigatorio(linha.precoPromocional);
  const precoAVista = toNumeroOpcional(linha.precoAVista);
  const precoAPrazo = toNumeroOpcional(linha.precoAPrazo);

  const margemLucro = margemMarkup(precoVenda, linha.custoAtual);
  const lucroEstimado = precoVenda - linha.custoAtual;
  const mudouPrecoVenda = precoVenda !== original.precoVenda;

  const semMudanca = !mudouPrecoVenda
    && precoPromocional === original.precoPromocional
    && (precoAVista ?? null) === (original.precoAVista ?? null)
    && (precoAPrazo ?? null) === (original.precoAPrazo ?? null);

  const campos: Record<string, number | string | null> = {
    precoVenda,
    precoPromocional,
    margemLucro,
    lucroEstimado,
    'precos.venda': precoVenda,
    'precos.promocional': precoPromocional,
    'precos.margemLucro': margemLucro,
    'precos.lucroEstimado': lucroEstimado,
  };

  if (precoAVista !== undefined) {
    campos.precoAVista = precoAVista;
    campos['precos.aVista'] = precoAVista;
  }
  if (precoAPrazo !== undefined) {
    campos.precoAPrazo = precoAPrazo;
    campos['precos.aPrazo'] = precoAPrazo;
  }
  if (mudouPrecoVenda) {
    campos.custoNaUltimaPrecificacao = linha.custoAtual;
    campos.ultimaAlteracaoPreco = agoraIso;
    campos['precos.ultimaAlteracaoPreco'] = agoraIso;
  }

  return { campos, mudouPrecoVenda, semMudanca };
};

/** Tolerancia pra nao acusar "margem mudou" por diferenca de arredondamento
 * de centavo (ex: custo 44,00 -> 44,004). */
const TOLERANCIA_PONTOS = 0.05;

/**
 * Compara a margem de hoje com a do dia da precificacao. Devolve `null`
 * quando a comparacao nao faz sentido -- produto sem preco, sem custo, ou
 * precificado antes deste recurso existir (sem base gravada). Nesse caso a
 * tela simplesmente nao mostra aviso nenhum, em vez de inventar um numero.
 */
export const compararMargem = (
  precoVenda: number,
  custoNaUltimaPrecificacao: number | null | undefined,
  custoAtual: number,
): ComparacaoMargem | null => {
  const custoBase = Number(custoNaUltimaPrecificacao);
  if (!(custoBase > 0) || !(custoAtual > 0) || !(precoVenda > 0)) return null;

  const margemAnterior = margemMarkup(precoVenda, custoBase);
  const margemAtual = margemMarkup(precoVenda, custoAtual);
  const diferencaPontos = margemAtual - margemAnterior;
  const direcao: DirecaoMargem = Math.abs(diferencaPontos) < TOLERANCIA_PONTOS
    ? 'manteve'
    : (diferencaPontos > 0 ? 'subiu' : 'caiu');

  return { margemAnterior, margemAtual, direcao, diferencaPontos };
};
