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
// Colunas opcionais da minuta de entrega (pedido da Sol Natus, 2026-09-21):
// cada empresa decide se quer Marca e Local no papel. Ligadas por padrao -- e'
// o que a folha do sistema antigo trazia.
export const DEFAULT_MINUTA_MOSTRAR_MARCA = true;
export const DEFAULT_MINUTA_MOSTRAR_LOCAL = true;

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

/**
 * FATURAR ANTES DE CONFERIR (2026-09-15).
 *
 * A conferencia NAO fatura o pedido -- ela fecha como 'conferido' ou
 * 'divergente' e para por ai (ver ConferenciaForm.tsx). Quem fatura e' o
 * pessoal de vendas, reabrindo a pre-venda. Isso e' de proposito: separar
 * mercadoria e reconhecer receita sao decisoes de setores diferentes.
 *
 * Mas o caminho de faturar sem esperar a conferencia precisa continuar
 * existindo -- cliente esperando no balcao, pedido que sai na hora, correcao
 * de um pedido que nunca vai ser separado. Entao nao e' bloqueio, e' aviso:
 * o sistema diz em que pe' esta a separacao e pergunta uma vez.
 */
export const conferenciaPendenteParaFaturar = (
  conferenciaAtiva: boolean,
  statusConferencia: StatusConferencia | string | null | undefined,
): boolean => {
  if (!conferenciaAtiva) return false;
  return String(statusConferencia ?? '') !== 'conferido';
};

/**
 * Aviso mostrado antes de faturar um pedido que a expedicao ainda nao
 * fechou como conferido. O texto muda conforme o estagio porque as tres
 * situacoes pedem decisoes diferentes: ninguem comecou, alguem esta
 * separando agora, ou a separacao achou diferenca.
 */
export const avisoFaturarSemConferencia = (
  statusConferencia: StatusConferencia | string | null | undefined,
): { title: string; text: string; confirmButtonText: string } => {
  const status = String(statusConferencia ?? '');

  if (status === 'em_conferencia') {
    return {
      title: 'A conferência está em andamento',
      text: 'Alguém da expedição está conferindo este pedido agora. Se você finalizar, a venda é faturada com as quantidades do pedido, não com o que foi separado — e a conferência continua aberta na fila.',
      confirmButtonText: 'Finalizar mesmo assim',
    };
  }

  if (status === 'divergente') {
    return {
      title: 'A conferência fechou com divergência',
      text: 'A expedição separou quantidade diferente da que está no pedido. Finalizar agora fatura os valores do pedido, não os conferidos. Confira as quantidades antes, ou finalize ciente da diferença.',
      confirmButtonText: 'Finalizar mesmo assim',
    };
  }

  return {
    title: 'Este pedido ainda não foi conferido',
    text: 'A mercadoria ainda não passou pela conferência da expedição. Você pode finalizar a venda assim mesmo — o estoque é baixado e o financeiro é lançado normalmente.',
    confirmButtonText: 'Sim, finalizar sem conferir',
  };
};

/**
 * QUANDO O SISTEMA OFERECE A MINUTA DE ENTREGA (2026-09-15).
 *
 * A minuta e' o papel da SEPARACAO: lista os itens sem valores pra quem vai
 * buscar a mercadoria na prateleira. Entao ela tem que sair ANTES de alguem
 * separar -- oferecer depois de faturar e' oferecer o mapa quando a viagem
 * ja' acabou.
 *
 * Ate aqui ela so' era oferecida ao FINALIZAR a venda, o que funcionava
 * porque a conferencia tambem so' comecava ali. Com a pre-venda entrando na
 * fila da expedicao ao ser gravada, o momento certo mudou junto.
 *
 * Quem NAO trabalha com pre-venda continua exatamente como antes: a venda
 * nasce faturada, a conferencia comeca ali, e a minuta e' oferecida ali.
 */
export const ofereceMinutaAoGravarPreVenda = (
  conferenciaAtiva: boolean,
  imprimirMinutaAtiva: boolean,
): boolean => conferenciaAtiva && imprimirMinutaAtiva;

/**
 * No fim da venda a minuta so' aparece pra pedido que NAO passou pela
 * pre-venda -- ali ela ja' foi oferecida, e perguntar de novo e' clique a
 * toa em cima de uma mercadoria que ja' foi separada e conferida.
 *
 * `minutaJaOferecidaNaPreVenda` e' passado pela tela, nao deduzido da config
 * do tenant, de proposito: existe quem tenha a pre-venda LIGADA na empresa e
 * mesmo assim fature direto (usuario sem a permissao de gravar pre-venda, e
 * pedido que chegou pelo agente de WhatsApp). Esses nunca viram a minuta, e
 * precisam ver.
 */
export const ofereceMinutaAoFinalizar = (
  conferenciaAtiva: boolean,
  imprimirMinutaAtiva: boolean,
  minutaJaOferecidaNaPreVenda: boolean,
): boolean => conferenciaAtiva && imprimirMinutaAtiva && !minutaJaOferecidaNaPreVenda;

/** Rotulo e cor do status de conferencia, iguais em todas as telas (pedido, troca, fila). */
export const ROTULO_CONFERENCIA: Record<StatusConferencia, string> = {
  aguardando: 'Aguardando Conferência',
  em_conferencia: 'Em Conferência',
  conferido: 'Conferido',
  divergente: 'Divergente',
};

export const COR_CONFERENCIA: Record<StatusConferencia, string> = {
  aguardando: '#f59e0b',
  em_conferencia: '#3b82f6',
  conferido: '#10b981',
  divergente: '#ef4444',
};

/**
 * ENTREGAR TROCA ANTES DE CONFERIR (2026-09-24). Mesma ideia do faturamento da
 * pre-venda: nao e' bloqueio (reposicao que sai na hora existe), e' aviso -- o
 * sistema diz em que pe' esta a separacao e pergunta uma vez. Devolve null
 * quando nao ha o que avisar (conferencia desligada ou ja conferida).
 */
export const avisoEntregarTrocaSemConferencia = (
  conferenciaAtiva: boolean,
  statusConferencia: StatusConferencia | string | null | undefined,
): { title: string; text: string; confirmButtonText: string } | null => {
  if (!conferenciaAtiva) return null;
  const status = String(statusConferencia ?? '');
  // Troca antiga (criada antes de a empresa ligar a conferencia) nao tem status: nada a avisar.
  if (!status || status === 'conferido') return null;

  if (status === 'em_conferencia') {
    return {
      title: 'A conferência está em andamento',
      text: 'Alguém da expedição está separando esta troca agora. Se você confirmar a entrega, o estoque é baixado com as quantidades da troca, não com o que foi separado.',
      confirmButtonText: 'Entregar mesmo assim',
    };
  }
  if (status === 'divergente') {
    return {
      title: 'A conferência fechou com divergência',
      text: 'A expedição separou quantidade diferente da que está na troca. Confirmar a entrega baixa o estoque com as quantidades da troca, não com as conferidas. Confira antes, ou entregue ciente da diferença.',
      confirmButtonText: 'Entregar mesmo assim',
    };
  }
  return {
    title: 'Esta troca ainda não foi conferida',
    text: 'A reposição ainda não passou pela conferência da expedição. Você pode confirmar a entrega assim mesmo — o estoque é baixado normalmente.',
    confirmButtonText: 'Sim, entregar sem conferir',
  };
};
