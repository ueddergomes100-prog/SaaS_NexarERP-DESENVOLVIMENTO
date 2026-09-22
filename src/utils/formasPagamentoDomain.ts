import { MAX_PARCELAS_A_PRAZO, type ParcelaAPrazo, type PaymentMethod } from './financeDomain';

/**
 * ORDEM DAS FORMAS DE PAGAMENTO E PARCELAS AUTOMATICAS A PRAZO (2026-09-21).
 *
 * Dois pedidos do dono que moram no mesmo lugar da tela:
 *
 * 1. "Tem cliente que usa muito cartao, ai vem pre-definido o cartao como a
 *    principal. Ah, mas o cliente fecha muito a venda a prazo, entao vem a
 *    prazo primeiro." A lista sempre foi fixa no codigo, na ordem que alguem
 *    escreveu um dia. Quem fecha tudo a prazo trocava o seletor em TODA venda.
 *
 * 2. "Fechou a prazo, colocou tres parcelas, ele ja joga 30, 60, 90
 *    automatico. Mas se o cliente joga 15 dias, ele ja joga 15, 30, 45." Hoje
 *    o pagamento a prazo e' UMA linha com um vencimento so'; montar 30/60/90
 *    exigia somar tres linhas na mao, uma a uma, digitando cada data.
 *
 * Tudo aqui e' regra pura -- sem tela, sem Firestore.
 */

// ---------------------------------------------------------------------------
// ORDEM E VISIBILIDADE DAS FORMAS
// ---------------------------------------------------------------------------

/**
 * Ordena as formas disponiveis segundo a preferencia da empresa.
 *
 * Forma que a empresa nunca ordenou (porque e' NOVA no sistema) vai pro fim,
 * na ordem original -- nunca some. Este e' o ponto sensivel: se a ausencia na
 * configuracao escondesse a forma, lancar uma forma de pagamento nova a
 * deixaria invisivel em toda empresa que ja tinha mexido nesta tela.
 *
 * Nome guardado que nao existe mais e' ignorado sem barulho (forma removida
 * numa versao futura).
 */
export const ordenarFormasPagamento = (
  disponiveis: PaymentMethod[],
  ordemConfigurada: string[] | null | undefined,
): PaymentMethod[] => {
  const ordem = Array.isArray(ordemConfigurada) ? ordemConfigurada : [];
  const posicao = new Map<string, number>();
  ordem.forEach((forma, indice) => {
    if (!posicao.has(forma)) posicao.set(forma, indice);
  });

  return [...disponiveis].sort((a, b) => {
    const pa = posicao.has(a) ? (posicao.get(a) as number) : Number.MAX_SAFE_INTEGER;
    const pb = posicao.has(b) ? (posicao.get(b) as number) : Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    // Empate = as duas sao novas: mantem a ordem em que chegaram.
    return disponiveis.indexOf(a) - disponiveis.indexOf(b);
  });
};

/**
 * Tira da lista o que a empresa escondeu.
 *
 * NUNCA devolve lista vazia: esconder tudo deixaria a venda sem forma de
 * pagamento nenhuma, impossivel de fechar. Se a configuracao escondeu todas,
 * ela e' ignorada -- e' claramente engano, e travar a venda seria pior.
 */
export const formasVisiveis = (
  disponiveis: PaymentMethod[],
  ocultas: string[] | null | undefined,
): PaymentMethod[] => {
  const esconder = new Set(Array.isArray(ocultas) ? ocultas : []);
  const visiveis = disponiveis.filter((forma) => !esconder.has(forma));
  return visiveis.length > 0 ? visiveis : disponiveis;
};

/** Le a ordem gravada em `configuracoes/{tenantId}`. Formato defensivo: so'
 *  texto nao vazio entra, sem repetir. */
export const parseOrdemFormasPagamento = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  const limpo = raw
    .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    .map((item) => item.trim());
  return Array.from(new Set(limpo));
};

/** Mesma leitura defensiva da lista de formas escondidas. */
export const parseFormasOcultas = parseOrdemFormasPagamento;

/**
 * A venda pode ser dividida em mais de uma forma de pagamento?
 *
 * Decisao do dono (2026-09-21): o botao "+ Dividir pagamento" nao some, vira
 * opcional. Quem nao trabalha com pagamento misto (parte no Pix, parte no
 * cartao) desliga e a tela fica limpa.
 *
 * So' `false` explicito desliga: empresa que nunca abriu a configuracao nao
 * tem o campo gravado, e sumir com um botao que ela ja usa seria pior. Mesmo
 * criterio de `parsePermitirDescontoPorItem`.
 *
 * Desligar NAO mexe em venda gravada: venda antiga com duas formas continua
 * abrindo, imprimindo e recebendo baixa igual. A opcao decide o que a tela
 * OFERECE daqui pra frente.
 */
export const DEFAULT_PERMITIR_DIVIDIR_PAGAMENTO = true;

export const parsePermitirDividirPagamento = (raw: unknown): boolean => raw !== false;

// ---------------------------------------------------------------------------
// PARCELAS A PRAZO: O QUE E' SO' DA TELA
// ---------------------------------------------------------------------------
//
// A REGRA (quais datas, quais valores) mora em financeDomain.ts, junto de
// splitCents e do resto do financeiro -- e' de la que sai o titulo de verdade.
// Aqui ficam so' o texto do erro e o resumo que a tela escreve, que nao teriam
// o que fazer no dominio financeiro.

/**
 * Erro em portugues do que foi digitado, ou `null` quando esta tudo certo.
 * A tela mostra isto ao lado do campo -- o objetivo e' a pessoa se resolver
 * sozinha (regra 2 do CLAUDE.md).
 */
export const erroDasParcelasAPrazo = (quantidade: number, intervaloDias: number): string | null => {
  const partes = Math.floor(Number(quantidade));
  const intervalo = Math.floor(Number(intervaloDias));
  if (!Number.isInteger(partes) || partes < 1) return 'Informe em quantas parcelas a venda foi dividida (mínimo 1).';
  if (partes > MAX_PARCELAS_A_PRAZO) return `São muitas parcelas. O máximo é ${MAX_PARCELAS_A_PRAZO}.`;
  if (!Number.isInteger(intervalo) || intervalo < 1) return 'Informe de quantos em quantos dias cada parcela vence (ex.: 30).';
  return null;
};

/** "3x de 30 em 30 dias (30/60/90)" -- o resumo que a tela mostra pra pessoa
 *  conferir antes de fechar a venda. Acima de 4 parcelas abrevia, senao a
 *  linha nao cabe. */
export const resumoDasParcelas = (parcelas: ParcelaAPrazo[], intervaloDias: number): string => {
  if (parcelas.length === 0) return '';
  if (parcelas.length === 1) return `1x em ${intervaloDias} dias`;
  const dias = parcelas.map((_, indice) => intervaloDias * (indice + 1));
  const lista = dias.length <= 4 ? dias.join('/') : `${dias.slice(0, 3).join('/')}...${dias[dias.length - 1]}`;
  return `${parcelas.length}x de ${intervaloDias} em ${intervaloDias} dias (${lista})`;
};
