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
// FORMA QUE O PAGAMENTO JA' TRAZ AO ABRIR A TELA
// ---------------------------------------------------------------------------

/** Lista padrao de formas da venda/OS, antes da ordem e das escondidas da empresa. */
export const FORMAS_PAGAMENTO_PADRAO: PaymentMethod[] = [
  'Dinheiro', 'Pix', 'Cartão de Crédito', 'Cartão de Débito', 'Transferência', 'Cheque', 'Boleto', 'Pagamento a Prazo', 'Outros',
];

/** Formas na ordem da empresa, sem as que ela escondeu (Configuracoes). */
export const formasDaEmpresa = (
  ordemConfigurada: string[] | null | undefined,
  ocultas: string[] | null | undefined,
): PaymentMethod[] => formasVisiveis(ordenarFormasPagamento(FORMAS_PAGAMENTO_PADRAO, ordemConfigurada), ocultas);

/**
 * Formas oferecidas ao RECEBER uma conta (Contas a Receber, 16/10/2026,
 * pedido do dono): as mesmas marcadas como "Usa" na filial, na ordem da
 * filial -- nao adianta esconder uma forma da venda e ela aparecer na hora de
 * receber. Fica so' o que a tela de recebimento aceita ("Pagamento a Prazo"
 * nao e' forma de receber). Vazio = a filial nao usa nenhuma: a tela avisa.
 */
export const formasDeRecebimento = (
  aceitas: readonly string[],
  ordemConfigurada: string[] | null | undefined,
  ocultas: string[] | null | undefined,
): string[] => formasDaEmpresa(ordemConfigurada, ocultas).filter((forma) => aceitas.includes(forma));

/** Frase da tela quando a filial nao usa nenhuma forma de receber. */
export const MENSAGEM_SEM_FORMA_DE_RECEBIMENTO = 'Nenhuma forma de recebimento está marcada como "Usa" nesta filial. Marque ao menos uma (Dinheiro, Pix, Cartão, Transferência, Cheque, Boleto ou Outros) em Configurações da filial › Formas de Pagamento.';

/**
 * Forma com que um pagamento NOVO ja' nasce na tela (2026-09-30).
 *
 * - "Exigir escolha" ligado: vazio -- o usuario escolhe, ninguem escolhe por ele.
 * - Desligado: a PRIMEIRA forma da sequencia configurada, ja' sem as escondidas.
 *
 * Antes cada tela resolvia isso por conta propria e a pre-venda reaberta pra
 * faturar caia em "Outros", uma forma que a empresa nem oferecia.
 */
export const formaInicialConfigurada = (
  exigirEscolha: boolean,
  formasOferecidas: PaymentMethod[],
): PaymentMethod | '' => (exigirEscolha ? '' : (formasOferecidas[0] ?? 'Dinheiro'));

/**
 * Forma do pagamento de um documento gravado SEM o array `pagamentos` (a
 * pre-venda e a OS em aberto gravam assim: a forma so' e' decidida ao faturar).
 * Sem forma gravada, vale a forma inicial da empresa; com forma gravada
 * (venda antiga), ela e' mantida -- reabrir nao pode reescrever a venda.
 */
export const formaDoDocumentoSemPagamentos = (
  formaGravada: unknown,
  formaInicial: PaymentMethod | '',
): PaymentMethod | '' => {
  const texto = typeof formaGravada === 'string' ? formaGravada.trim() : '';
  return texto ? (texto as PaymentMethod) : formaInicial;
};

// ---------------------------------------------------------------------------
// BANCO QUE O PAGAMENTO JA' TRAZ (26/10/2026, pedido do dono)
// ---------------------------------------------------------------------------
//
// Cliente que vende quase tudo no boleto escolhia o banco (Sicoob) em toda venda.
// Duas opcoes da filial, ambas desligadas por padrao (quem nao usa nao ve diferenca):
// - "Banco padrao do boleto": escolheu Boleto, o banco ja' vem;
// - "Lembrar o banco do dia": o banco escolhido na 1a venda do dia (por forma de
//   pagamento) vem preenchido nas outras vendas daquele dia, para aquele usuario.
// O banco do dia vence o padrao. Sempre da' para trocar na venda.

export interface ConfigBancoPadrao {
  /** Banco que o Boleto ja' traz ('' = nenhum). */
  bancoBoletoId: string;
  lembrarDoDia: boolean;
}

export const parseConfigBancoPadrao = (config: { bancoPadraoBoletoId?: unknown; lembrarBancoDoDia?: unknown } | null | undefined): ConfigBancoPadrao => ({
  bancoBoletoId: typeof config?.bancoPadraoBoletoId === 'string' ? config.bancoPadraoBoletoId.trim() : '',
  lembrarDoDia: config?.lembrarBancoDoDia === true,
});

/** O que fica guardado no navegador: o banco escolhido e em que dia. */
export interface BancoDoDia {
  data: string;
  bancoId: string;
}

/** Chave por empresa, usuario e forma (o Pix pode ir para um banco e o boleto para outro). */
export const chaveBancoDoDia = (tenantId: string, usuarioId: string, forma: string): string => (
  `hennder:bancoDoDia:${tenantId}:${usuarioId}:${forma}`
);

export const lerBancoDoDia = (raw: unknown): BancoDoDia | null => {
  if (!raw || typeof raw !== 'object') return null;
  const { data, bancoId } = raw as Record<string, unknown>;
  return typeof data === 'string' && typeof bancoId === 'string' && data && bancoId ? { data, bancoId } : null;
};

/**
 * Banco sugerido para um pagamento sem banco: o do dia (se a filial lembra e for
 * de hoje), senao o padrao do boleto. So' banco ATIVO; nada valido = '' (a
 * pessoa escolhe, como sempre).
 */
export const bancoSugerido = (args: {
  forma: string;
  config: ConfigBancoPadrao;
  doDia: BancoDoDia | null;
  hoje: string;
  bancosAtivosIds: string[];
}): string => {
  const { forma, config, doDia, hoje, bancosAtivosIds } = args;
  if (config.lembrarDoDia && doDia && doDia.data === hoje && bancosAtivosIds.includes(doDia.bancoId)) return doDia.bancoId;
  if (forma === 'Boleto' && config.bancoBoletoId && bancosAtivosIds.includes(config.bancoBoletoId)) return config.bancoBoletoId;
  return '';
};

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
