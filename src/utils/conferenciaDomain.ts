// Funcoes puras do Modulo 12 (Conferencia de mercadoria). Nao dependem do
// Firestore -- a leitura/escrita fica nas telas que vao consumir isto nas
// fatias seguintes (Expedicao/ConferenciaForm.tsx etc).
// Ver docs/PLANO_EVOLUCAO_NEXAR.md, Secao 5, Modulo 12, para as decisoes de
// arquitetura por tras de cada funcao abaixo.

export type StatusConferencia = 'aguardando' | 'em_conferencia' | 'conferido' | 'divergente';

// Chave-mestra do modulo. Default DESLIGADO e obrigatorio -- ligar por
// padrao criaria status pendente em todo tenant que nao usa separacao.
export const DEFAULT_CONFERENCIA_MERCADORIA = false;
export const DEFAULT_IMPRIMIR_MINUTA_APOS_VENDA = true;
export const DEFAULT_EXIGIR_BIPAGEM = true;
export const DEFAULT_BLOQUEAR_EXCEDENTE = true;
export const DEFAULT_ORDENAR_MINUTA_POR_LOCAL = true;

// Maquina de estados explicita. aguardando so abre pra em_conferencia;
// conferido/divergente sao desfechos legitimos (nao erros) e podem ser
// reabertos -- decisao 7 do plano.
const TRANSICOES_VALIDAS: Record<StatusConferencia, StatusConferencia[]> = {
  aguardando: ['em_conferencia'],
  em_conferencia: ['conferido', 'divergente'],
  conferido: ['em_conferencia'],
  divergente: ['em_conferencia'],
};

export const canTransition = (de: StatusConferencia, para: StatusConferencia): boolean =>
  TRANSICOES_VALIDAS[de]?.includes(para) ?? false;

export interface ConferenciaItem {
  produtoId: string;
  codigo?: string;
  /** EAN a ser bipado. Quando o item foi vendido em embalagem, e o EAN da
   * EMBALAGEM (o que esta impresso no saco), nao o da unidade. */
  codigoBarras?: string;
  nome: string;
  localizacaoEstoque?: string;
  /** Na unidade em que o item foi vendido -- 2 sacos sao 2, nao 40 quilos. */
  quantidadePedida: number;
  quantidadeConferida: number;
  /** Sigla da unidade vendida, so para exibicao na tela/minuta. */
  unidadeMedidaSigla?: string;
}

export type BipagemResultado = 'ok' | 'nao_encontrado' | 'excedente' | 'bloqueado_manual';

export interface AplicarBipagemOptions {
  bloquearExcedente: boolean;
  exigirBipagem: boolean;
  // true = lancamento manual (digitado direto na linha, sem ser por EAN);
  // false/undefined = leitura por EAN, bipada ou digitada no mesmo campo.
  manual?: boolean;
}

export interface AplicarBipagemResult {
  itens: ConferenciaItem[];
  resultado: BipagemResultado;
  produtoId?: string;
}

// Decisao 6 do plano: exigirBipagem so bloqueia lancamento manual em
// produto que TEM codigoBarras cadastrado. Produto sem EAN sempre aceita
// manual, senao o separador fica preso num item que tem na mao.
export const podeLancarManual = (
  item: Pick<ConferenciaItem, 'codigoBarras'>,
  exigirBipagem: boolean,
): boolean => {
  if (!exigirBipagem) return true;
  return !item.codigoBarras || !item.codigoBarras.trim();
};

// Aplica uma leitura (bipada ou digitada) de EAN, ou um lancamento manual,
// contra a lista de itens da conferencia. Nunca muta o array recebido.
// Decisao 5: multiplicador e sempre digitado ANTES da leitura e zera a cada
// leitura -- essa funcao so aplica o valor recebido, nao acumula estado.
export const aplicarBipagem = (
  itens: ConferenciaItem[],
  codigo: string,
  multiplicador: number,
  opts: AplicarBipagemOptions,
): AplicarBipagemResult => {
  const codigoNormalizado = (codigo || '').trim();
  if (!codigoNormalizado) return { itens, resultado: 'nao_encontrado' };

  const index = itens.findIndex((item) => (
    (Boolean(item.codigoBarras) && item.codigoBarras!.trim() === codigoNormalizado) ||
    item.produtoId === codigoNormalizado
  ));
  if (index === -1) return { itens, resultado: 'nao_encontrado' };

  const item = itens[index];

  if (opts.manual && !podeLancarManual(item, opts.exigirBipagem)) {
    return { itens, resultado: 'bloqueado_manual' };
  }

  const quantidade = Number.isFinite(multiplicador) && multiplicador > 0 ? multiplicador : 1;
  const novaQuantidadeConferida = item.quantidadeConferida + quantidade;

  if (opts.bloquearExcedente && novaQuantidadeConferida > item.quantidadePedida) {
    return { itens, resultado: 'excedente' };
  }

  const novosItens = itens.slice();
  novosItens[index] = { ...item, quantidadeConferida: novaQuantidadeConferida };
  return { itens: novosItens, resultado: 'ok', produtoId: item.produtoId };
};

// 'conferido' so quando TODO item bateu exatamente pedido == conferido.
// Falta ou sobra (pra mais ou pra menos) fecha como 'divergente' -- desfecho
// legitimo, nao erro (decisao 7).
export const computeStatusFinal = (itens: ConferenciaItem[]): 'conferido' | 'divergente' =>
  itens.every((item) => item.quantidadeConferida === item.quantidadePedida) ? 'conferido' : 'divergente';

// Ordena a minuta/tela por localizacaoEstoque (vira rota de separacao).
// Itens sem localizacao cadastrada vao pro FIM, nao pro comeco -- senao um
// produto sem local cadastrado empurraria toda a rota real pra depois dele.
// Nao muta o array recebido. Generico (nao preso a ConferenciaItem) porque
// a minuta (Fatia 2) usa um shape de item mais enxuto que a tela de
// conferencia (Fatia 4) -- os dois so precisam do campo localizacaoEstoque.
export const ordenarPorLocalizacao = <T extends { localizacaoEstoque?: string }>(itens: T[]): T[] => {
  const comLocal: T[] = [];
  const semLocal: T[] = [];

  for (const item of itens) {
    if (item.localizacaoEstoque && item.localizacaoEstoque.trim()) comLocal.push(item);
    else semLocal.push(item);
  }

  comLocal.sort((a, b) => a.localizacaoEstoque!.localeCompare(b.localizacaoEstoque!));
  return [...comLocal, ...semLocal];
};
