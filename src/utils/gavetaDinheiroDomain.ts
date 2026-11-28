/**
 * DINHEIRO DAS VENDAS NA GAVETA (pedido do dono, 23/11/2026, Embala Minas).
 *
 * Ate' aqui o CAIXA de Financeiro > Caixas e Transferencias so' somava saldo
 * inicial, transferencias e lancamentos a mao (decisao de 21/10): a venda em
 * dinheiro ficava so' no Fluxo de Caixa. O dono pediu a ligacao, com uma
 * chave por empresa:
 *
 *   "todas as vendas em dinheiro tem que contabilizar na gaveta da frente de
 *    caixa, e naquele extrato; na hora do fechamento tem que puxar tudo que
 *    e' dinheiro certinho para ele poder transferir para o cofre".
 *
 * Com a chave LIGADA (Configuracoes Gerais), o saldo e o extrato do CAIXA
 * passam a ser:
 *
 *   lancamentos do proprio caixa (saldo inicial, transferencias, a mao)
 *   + todo titulo PAGO EM DINHEIRO a partir da data em que a chave foi ligada
 *     (venda do PDV, pedido de venda, OS, conta recebida, conta paga, devolucao,
 *     lancamento do Fluxo de Caixa) -- e' o mesmo conjunto que o Fluxo de Caixa
 *     ja' mostra como caixa fisico
 *   - sangrias do PDV
 *   +- diferenca do fechamento do PDV (sobra/falta), quando o fechamento foi
 *     conferido contra a gaveta
 *
 * Nada e' gravado a mais na venda: o servidor MONTA a partir dos documentos
 * (como a Movimentacao de Produtos). Assim nenhum caminho de dinheiro fica de
 * fora -- sao mais de trinta pontos que gravam titulo em dinheiro.
 *
 * FECHAMENTO: com a chave ligada e um caixa so' aberto, o "saldo esperado" do
 * fechamento do PDV e' o saldo da gaveta (tudo que entrou e saiu em dinheiro,
 * no PDV ou fora dele). A diferenca contada vira sobra/falta no extrato, e o
 * saldo da gaveta passa a ser o dinheiro contado -- pronto para transferir ao
 * cofre. Com mais de um caixa aberto ao mesmo tempo nao da' para saber em qual
 * gaveta cada dinheiro esta': o fechamento segue a conta de sempre, por sessao,
 * e a diferenca fica so' na sessao.
 *
 * Regra pura: sem tela, sem Firestore. Compilada para o servidor.
 */
import { addDaysToDateInput, getDateInputInTimeZone } from './dateTime';
import { toCents, transactionMovesPhysicalCash } from './financeDomain';
import { CAIXAS_PADRAO, formatarReais } from './contasDinheiroDomain';

/** Campo em `configuracoes/{empresa}`. */
export const CAMPO_CONFIG_GAVETA = 'gavetaDinheiro';

export interface ConfigGavetaDinheiro {
  ativo: boolean;
  /** yyyy-mm-dd: dia em que a chave foi ligada pela primeira vez. Nada antes disso entra. */
  desde: string;
}

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Le o campo da configuracao. Sem data valida, a chave vale como desligada. */
export const lerConfigGaveta = (configuracao: unknown): ConfigGavetaDinheiro => {
  const doc = (configuracao && typeof configuracao === 'object' ? configuracao : {}) as Record<string, unknown>;
  const campo = (doc[CAMPO_CONFIG_GAVETA] && typeof doc[CAMPO_CONFIG_GAVETA] === 'object' ? doc[CAMPO_CONFIG_GAVETA] : {}) as Record<string, unknown>;
  const desde = typeof campo.desde === 'string' && DATA_ISO.test(campo.desde) ? campo.desde : '';
  return { ativo: campo.ativo === true && Boolean(desde), desde };
};

/**
 * O que gravar ao ligar/desligar. A data nasce no primeiro "ligar" e nunca
 * mais muda: desligar e ligar de novo nao apaga nem repete o que ja' contou.
 */
export const montarConfigGaveta = (ligar: boolean, anterior: ConfigGavetaDinheiro, hoje: string): ConfigGavetaDinheiro => ({
  ativo: ligar,
  desde: anterior.desde || (ligar ? hoje : ''),
});

/** A gaveta e' o CAIXA que o sistema cria sozinho (o primeiro dos padroes). */
export const ehACaixaGaveta = (caixa: { nome?: unknown; padrao?: unknown; ativo?: unknown }): boolean => (
  caixa.padrao === true && caixa.ativo !== false && String(caixa.nome || '') === CAIXAS_PADRAO[0].nome
);

export type TipoMovimentoGaveta = 'dinheiro_entrada' | 'dinheiro_saida' | 'sangria_pdv' | 'suprimento_pdv' | 'diferenca_fechamento' | 'diferenca_abertura';

export const ROTULO_MOVIMENTO_GAVETA: Record<TipoMovimentoGaveta, string> = {
  dinheiro_entrada: 'Dinheiro recebido',
  dinheiro_saida: 'Dinheiro pago',
  sangria_pdv: 'Sangria do PDV',
  suprimento_pdv: 'Suprimento do PDV',
  diferenca_fechamento: 'Diferença no fechamento',
  diferenca_abertura: 'Diferença na abertura',
};

export interface MovimentoDaGaveta {
  id: string;
  tipo: TipoMovimentoGaveta;
  direcao: 'credito' | 'debito';
  valorCentavos: number;
  descricao: string;
  /** yyyy-mm-dd */
  data: string;
  criadoEmIso: string;
  /** Cliente do titulo, quando tem (relatorio do caixa, 24/11/2026). */
  clienteNome?: string;
  /**
   * Venda/OS cancelada depois (28/11/2026, pedido do dono: "a que eu cancelei
   * poderia ficar ali o registro mas escrito cancelada"). O dinheiro entrou e
   * saiu de novo no estorno (outra linha): a linha fica, com o selo.
   */
  cancelada?: true;
}

const dataIso = (v: unknown): string => (typeof v === 'string' && DATA_ISO.test(v.slice(0, 10)) ? v.slice(0, 10) : '');

const inteiro = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

/** Titulo (colecao `transacoes`) como chega do banco. */
export interface TituloParaGaveta {
  tipo?: unknown;
  status?: unknown;
  valor?: unknown;
  valorCentavos?: unknown;
  descricao?: unknown;
  data?: unknown;
  dataPagamento?: unknown;
  formaPagamento?: string;
  naturezaFinanceira?: string;
  movimentaCaixaFisico?: boolean;
  clienteNome?: unknown;
  /** Recebimento desfeito pelo cancelamento da venda/OS (cancelamentoVendaDomain). */
  estornada?: unknown;
  statusOperacional?: unknown;
}

/**
 * Titulo pago em dinheiro vira movimento da gaveta; o resto devolve null.
 * A venda cancelada continua "Paga" e ganha um titulo de saida (estorno): os
 * dois entram e se anulam, como no Fluxo de Caixa.
 */
export const movimentoDoTitulo = (id: string, t: TituloParaGaveta, criadoEmIso = ''): MovimentoDaGaveta | null => {
  if (t.status !== 'Paga') return null;
  if (t.tipo !== 'entrada' && t.tipo !== 'saida') return null;
  if (!transactionMovesPhysicalCash(t)) return null;
  const valorCentavos = t.valorCentavos !== undefined && t.valorCentavos !== null && Number.isFinite(Number(t.valorCentavos))
    ? inteiro(t.valorCentavos)
    : toCents(Number(t.valor || 0));
  if (valorCentavos <= 0) return null;
  const data = dataIso(t.dataPagamento) || dataIso(t.data);
  if (!data) return null;
  const entrada = t.tipo === 'entrada';
  const clienteNome = String(t.clienteNome || '').trim();
  return {
    id: `titulo:${id}`,
    tipo: entrada ? 'dinheiro_entrada' : 'dinheiro_saida',
    direcao: entrada ? 'credito' : 'debito',
    valorCentavos,
    descricao: String(t.descricao || (entrada ? 'Recebimento em dinheiro' : 'Pagamento em dinheiro')),
    data,
    criadoEmIso,
    ...(clienteNome ? { clienteNome } : {}),
    ...(t.estornada === true || t.statusOperacional === 'Cancelada' ? { cancelada: true as const } : {}),
  };
};

/** Sessao do PDV (colecao `caixas_pdv`) com as datas ja' convertidas. */
export interface SessaoParaGaveta {
  status?: unknown;
  operadorNome?: unknown;
  terminalNome?: unknown;
  sangrias?: unknown;
  /** Suprimentos (27/11/2026): dinheiro colocado na gaveta sem ser venda. */
  suprimentos?: unknown;
  diferencaCentavos?: unknown;
  /** Gravado no fechamento quando o esperado foi o saldo da gaveta. */
  fechamentoPelaGaveta?: unknown;
  fechadoEm?: Date | null;
  /**
   * Abertura conferida contra a gaveta (24/11/2026): o operador contou um valor
   * diferente do saldo da gaveta; a diferenca entra no extrato e o esperado
   * parte do que ele contou.
   */
  aberturaPelaGaveta?: unknown;
  diferencaAberturaCentavos?: unknown;
  abertoEm?: Date | null;
}

const nomeDoCaixaDaSessao = (s: SessaoParaGaveta): string => (
  [String(s.terminalNome || '').trim(), String(s.operadorNome || '').trim()].filter(Boolean).join(' — ')
);

/**
 * Sangrias (sempre saem da gaveta) e a diferenca do fechamento (so' quando o
 * fechamento foi conferido contra a gaveta).
 */
export const movimentosDaSessao = (id: string, s: SessaoParaGaveta): MovimentoDaGaveta[] => {
  const movimentos: MovimentoDaGaveta[] = [];
  const caixa = nomeDoCaixaDaSessao(s);
  const sufixo = caixa ? ` (${caixa})` : '';
  const naAbertura = inteiro(s.diferencaAberturaCentavos);
  if (s.aberturaPelaGaveta === true && naAbertura !== 0 && s.abertoEm instanceof Date && !Number.isNaN(s.abertoEm.getTime())) {
    movimentos.push({
      id: `abertura:${id}`,
      tipo: 'diferenca_abertura',
      direcao: naAbertura > 0 ? 'credito' : 'debito',
      valorCentavos: Math.abs(naAbertura),
      descricao: `${naAbertura > 0 ? 'Sobra' : 'Falta'} na abertura do caixa${sufixo}`,
      data: getDateInputInTimeZone(s.abertoEm),
      criadoEmIso: s.abertoEm.toISOString(),
    });
  }
  (Array.isArray(s.sangrias) ? s.sangrias : []).forEach((bruta, indice) => {
    const g = (bruta && typeof bruta === 'object' ? bruta : {}) as Record<string, unknown>;
    const valorCentavos = inteiro(g.valorCentavos);
    const registradoEm = typeof g.registradoEm === 'string' ? new Date(g.registradoEm) : null;
    if (valorCentavos <= 0 || !registradoEm || Number.isNaN(registradoEm.getTime())) return;
    const motivo = String(g.motivo || '').trim();
    movimentos.push({
      id: `sangria:${id}:${String(g.id || indice)}`,
      tipo: 'sangria_pdv',
      direcao: 'debito',
      valorCentavos,
      descricao: `Sangria do PDV${motivo ? `: ${motivo}` : ''}${sufixo}`,
      data: getDateInputInTimeZone(registradoEm),
      criadoEmIso: registradoEm.toISOString(),
    });
  });
  // Suprimento (27/11/2026): o contrario da sangria -- entra na gaveta.
  (Array.isArray(s.suprimentos) ? s.suprimentos : []).forEach((bruto, indice) => {
    const g = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
    const valorCentavos = inteiro(g.valorCentavos);
    const registradoEm = typeof g.registradoEm === 'string' ? new Date(g.registradoEm) : null;
    if (valorCentavos <= 0 || !registradoEm || Number.isNaN(registradoEm.getTime())) return;
    const motivo = String(g.motivo || '').trim();
    movimentos.push({
      id: `suprimento:${id}:${String(g.id || indice)}`,
      tipo: 'suprimento_pdv',
      direcao: 'credito',
      valorCentavos,
      descricao: `Suprimento do PDV${motivo ? `: ${motivo}` : ''}${sufixo}`,
      data: getDateInputInTimeZone(registradoEm),
      criadoEmIso: registradoEm.toISOString(),
    });
  });
  const diferenca = inteiro(s.diferencaCentavos);
  if (s.status === 'fechado' && s.fechamentoPelaGaveta === true && diferenca !== 0 && s.fechadoEm instanceof Date && !Number.isNaN(s.fechadoEm.getTime())) {
    movimentos.push({
      id: `fechamento:${id}`,
      tipo: 'diferenca_fechamento',
      direcao: diferenca > 0 ? 'credito' : 'debito',
      valorCentavos: Math.abs(diferenca),
      descricao: `${diferenca > 0 ? 'Sobra' : 'Falta'} no fechamento do caixa${sufixo}`,
      data: getDateInputInTimeZone(s.fechadoEm),
      criadoEmIso: s.fechadoEm.toISOString(),
    });
  }
  return movimentos;
};

/** Dentro de [de, ate] (yyyy-mm-dd; vazio = sem limite daquele lado). */
export const movimentoNoPeriodo = (m: { data: string }, de: string, ate = ''): boolean => (
  (!de || m.data >= de) && (!ate || m.data <= ate)
);

/** Entradas menos saidas. */
export const saldoDosMovimentos = (movimentos: ReadonlyArray<{ direcao: 'credito' | 'debito'; valorCentavos: number }>): number => (
  movimentos.reduce((soma, m) => soma + (m.direcao === 'credito' ? m.valorCentavos : -m.valorCentavos), 0)
);

// ---------------------------------------------------------------------------
// FECHAMENTO DO CAIXA DO PDV
// ---------------------------------------------------------------------------

export type ModoDoFechamento = 'gaveta' | 'sessao';

export interface EsperadoNoFechamento {
  modo: ModoDoFechamento;
  saldoEsperadoCentavos: number;
  /** Frase que explica de onde veio o esperado (vai no dialogo de fechamento). */
  explicacao: string;
}

/**
 * Saldo esperado em dinheiro no fechamento.
 *  - chave ligada e so' este caixa aberto: o saldo da gaveta (tudo em dinheiro,
 *    no PDV ou fora dele);
 *  - senao: a conta por sessao de sempre (saldo inicial + dinheiro das vendas
 *    desta sessao - sangrias).
 */
export const esperadoNoFechamento = (args: {
  gavetaAtiva: boolean;
  saldoDaGavetaCentavos: number | null;
  caixasAbertos: number;
  saldoInicialCentavos: number;
  dinheiroDaSessaoCentavos: number;
  totalSangriasCentavos: number;
  /** Suprimentos da sessao (27/11/2026); ausente = 0. */
  totalSuprimentosCentavos?: number;
}): EsperadoNoFechamento => {
  const suprimentos = inteiro(args.totalSuprimentosCentavos || 0);
  const porSessao = inteiro(args.saldoInicialCentavos) + inteiro(args.dinheiroDaSessaoCentavos) + suprimentos - inteiro(args.totalSangriasCentavos);
  const textoSuprimento = suprimentos > 0 ? ' + suprimentos' : '';
  if (args.gavetaAtiva && args.saldoDaGavetaCentavos !== null && args.caixasAbertos <= 1) {
    return {
      modo: 'gaveta',
      saldoEsperadoCentavos: inteiro(args.saldoDaGavetaCentavos),
      explicacao: 'É o saldo da gaveta: todo o dinheiro que entrou e saiu, no caixa e nos pedidos de venda, menos sangrias e transferências.',
    };
  }
  return {
    modo: 'sessao',
    saldoEsperadoCentavos: porSessao,
    explicacao: args.gavetaAtiva && args.caixasAbertos > 1
      ? `Há mais de um caixa aberto: a conta é só deste caixa (saldo inicial + vendas em dinheiro deste caixa${textoSuprimento} − sangrias).`
      : `Saldo inicial + vendas em dinheiro deste caixa${textoSuprimento} − sangrias.`,
  };
};

/** "Conferido", "Sobrou R$ X" ou "Faltou R$ X". */
export const resultadoDaContagem = (diferencaCentavos: number): string => {
  if (diferencaCentavos === 0) return 'Conferido: o valor contado bate com o esperado.';
  return diferencaCentavos > 0
    ? `Sobrou ${formatarReais(diferencaCentavos)} em relação ao esperado.`
    : `Faltou ${formatarReais(Math.abs(diferencaCentavos))} em relação ao esperado.`;
};

// ---------------------------------------------------------------------------
// O QUE COMPOE O "ESPERADO AGORA" (pedido do dono, 24/11/2026, Embala Minas)
// ---------------------------------------------------------------------------
//
// "Eu to perdido, nao sei as vendas que compoem esse valor": o esperado de
// R$ 1.245,63 era R$ 1.060,68 em dinheiro de 23/11 (que ninguem mandou para o
// COFRE) + R$ 184,95 de 24/11. Decisao do dono: separar por dia; cada dia abre
// venda por venda, sangrias e transferencias, e a soma bate com o esperado.

/** Movimento da composicao: os montados e os lancamentos do proprio CAIXA. */
export interface MovimentoDaComposicao {
  id: string;
  tipo: string;
  direcao: 'credito' | 'debito';
  valorCentavos: number;
  descricao: string;
  data: string;
  criadoEmIso: string;
  clienteNome?: string;
}

export interface DiaDaComposicao {
  data: string;
  entradasCentavos: number;
  saidasCentavos: number;
  /** Entradas - saidas do dia. */
  liquidoCentavos: number;
  /** Saldo da gaveta no fim do dia. */
  saldoNoFimCentavos: number;
  movimentos: MovimentoDaComposicao[];
}

export interface ComposicaoDaGaveta {
  /** yyyy-mm-dd: primeiro dia listado; o que veio antes sai numa linha so'. */
  inicio: string;
  saldoAnteriorCentavos: number;
  dias: DiaDaComposicao[];
  saldoCentavos: number;
}

/** Ate' quantos dias para tras a composicao abre venda por venda. */
export const DIAS_DA_COMPOSICAO = 31;

/**
 * Primeiro dia da composicao: o dia da ultima conferencia da gaveta (fechamento
 * pela gaveta ou acerto de um dia), senao o dia em que a chave foi ligada --
 * nunca mais de DIAS_DA_COMPOSICAO para tras.
 */
export const inicioDaComposicao = (args: { desde: string; hoje: string; ultimaConferencia: string }): string => {
  const limite = addDaysToDateInput(args.hoje, -DIAS_DA_COMPOSICAO);
  return [args.desde, limite, DATA_ISO.test(args.ultimaConferencia) ? args.ultimaConferencia : '']
    .filter(Boolean)
    .reduce((maior, d) => (d > maior ? d : maior), '');
};

/**
 * Agrupa por dia (mais antigo primeiro). Os movimentos de antes de `inicio`
 * viram o "saldo anterior" = saldo - soma do que foi listado, entao a soma das
 * linhas sempre bate com o saldo.
 */
export const comporPorDia = (saldoCentavos: number, movimentos: ReadonlyArray<MovimentoDaComposicao>, inicio: string): ComposicaoDaGaveta => {
  const listados = movimentos
    .filter((m) => m.data >= inicio)
    .slice()
    .sort((a, b) => a.data.localeCompare(b.data) || a.criadoEmIso.localeCompare(b.criadoEmIso));
  const saldoAnteriorCentavos = inteiro(saldoCentavos) - saldoDosMovimentos(listados);
  const porDia = new Map<string, MovimentoDaComposicao[]>();
  listados.forEach((m) => porDia.set(m.data, [...(porDia.get(m.data) || []), m]));
  let acumulado = saldoAnteriorCentavos;
  const dias: DiaDaComposicao[] = [...porDia.entries()].map(([data, lista]) => {
    const entradasCentavos = lista.filter((m) => m.direcao === 'credito').reduce((s, m) => s + m.valorCentavos, 0);
    const saidasCentavos = lista.filter((m) => m.direcao === 'debito').reduce((s, m) => s + m.valorCentavos, 0);
    acumulado += entradasCentavos - saidasCentavos;
    return { data, entradasCentavos, saidasCentavos, liquidoCentavos: entradasCentavos - saidasCentavos, saldoNoFimCentavos: acumulado, movimentos: lista };
  });
  return { inicio, saldoAnteriorCentavos, dias, saldoCentavos: inteiro(saldoCentavos) };
};

/**
 * Caixa conferido POR SESSAO (chave desligada ou mais de um caixa aberto): o
 * esperado e' saldo inicial + vendas em dinheiro do caixa - sangrias. Mesmo
 * formato da composicao da gaveta, para a tela e o relatorio mostrarem igual.
 */
export const composicaoDaSessao = (args: {
  abertoEm: Date | null;
  saldoInicialCentavos: number;
  lancamentosEmDinheiro: ReadonlyArray<{ id: string; descricao: string; clienteNome?: string; valorCentavos: number; criadoEm: Date | null }>;
  sangrias: ReadonlyArray<{ id?: string; valorCentavos: number; motivo?: string; registradoEm?: string }>;
  /** Suprimentos (27/11/2026). */
  suprimentos?: ReadonlyArray<{ id?: string; valorCentavos: number; motivo?: string; registradoEm?: string }>;
}): ComposicaoDaGaveta => {
  const valida = (d: Date | null): d is Date => d instanceof Date && !Number.isNaN(d.getTime());
  const abertura = valida(args.abertoEm) ? args.abertoEm : new Date();
  const movimentos: MovimentoDaComposicao[] = [];
  if (inteiro(args.saldoInicialCentavos) !== 0) {
    movimentos.push({
      id: 'saldo_inicial', tipo: 'saldo_inicial', direcao: 'credito', valorCentavos: inteiro(args.saldoInicialCentavos),
      descricao: 'Saldo inicial (contado na abertura)', data: getDateInputInTimeZone(abertura), criadoEmIso: abertura.toISOString(),
    });
  }
  args.lancamentosEmDinheiro.forEach((l) => {
    const quando = valida(l.criadoEm) ? l.criadoEm : abertura;
    const clienteNome = String(l.clienteNome || '').trim();
    movimentos.push({
      id: `titulo:${l.id}`, tipo: 'dinheiro_entrada', direcao: 'credito', valorCentavos: inteiro(l.valorCentavos),
      descricao: l.descricao || 'Venda em dinheiro', data: getDateInputInTimeZone(quando), criadoEmIso: quando.toISOString(),
      ...(clienteNome ? { clienteNome } : {}),
    });
  });
  args.sangrias.forEach((g, i) => {
    const quando = g.registradoEm ? new Date(g.registradoEm) : null;
    const certo = valida(quando) ? quando : abertura;
    const motivo = String(g.motivo || '').trim();
    movimentos.push({
      id: `sangria:${g.id || i}`, tipo: 'sangria_pdv', direcao: 'debito', valorCentavos: inteiro(g.valorCentavos),
      descricao: `Sangria${motivo ? `: ${motivo}` : ''}`, data: getDateInputInTimeZone(certo), criadoEmIso: certo.toISOString(),
    });
  });
  (args.suprimentos || []).forEach((g, i) => {
    const quando = g.registradoEm ? new Date(g.registradoEm) : null;
    const certo = valida(quando) ? quando : abertura;
    const motivo = String(g.motivo || '').trim();
    movimentos.push({
      id: `suprimento:${g.id || i}`, tipo: 'suprimento_pdv', direcao: 'credito', valorCentavos: inteiro(g.valorCentavos),
      descricao: `Suprimento${motivo ? `: ${motivo}` : ''}`, data: getDateInputInTimeZone(certo), criadoEmIso: certo.toISOString(),
    });
  });
  return comporPorDia(saldoDosMovimentos(movimentos), movimentos, getDateInputInTimeZone(abertura));
};

/** Saldo da gaveta no fim de `dia`: o de agora menos o que entrou/saiu depois. */
export const saldoNoFimDoDia = (saldoAgoraCentavos: number, movimentosDepois: ReadonlyArray<{ data: string; direcao: 'credito' | 'debito'; valorCentavos: number }>, dia: string): number => (
  inteiro(saldoAgoraCentavos) - saldoDosMovimentos(movimentosDepois.filter((m) => m.data > dia))
);

/** "R$ 1.060,68" (com ponto de milhar) para as mensagens do fechamento e da abertura. */
const reais = (centavos: number): string => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Math.round(Number(centavos) || 0) / 100);

// ---------------------------------------------------------------------------
// TROCO E COFRE NO FECHAMENTO; ACERTO DE UM DIA ANTERIOR (24/11/2026)
// ---------------------------------------------------------------------------
//
// Decisoes do dono: ao fechar, pergunta quanto fica de troco na gaveta e o
// resto vai para o COFRE na hora (transferencia CAIXA -> COFRE). Para o dia que
// ja' passou sem isso ("fechar o caixa de ontem"), o acerto conta o que ficou
// daquele dia: sobra/falta e a ida ao COFRE entram COM A DATA daquele dia.

const centavosNaoNegativos = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

/** O troco nao passa do que foi contado; o resto vai ao COFRE. */
export const erroDoTroco = (contadoCentavos: number, trocoCentavos: number): string => {
  if (!Number.isInteger(trocoCentavos) || trocoCentavos < 0) return 'Informe quanto fica de troco na gaveta (zero se for tudo para o COFRE).';
  if (trocoCentavos > contadoCentavos) return `O troco (${reais(trocoCentavos)}) não pode ser maior que o dinheiro contado (${reais(contadoCentavos)}).`;
  return '';
};

export interface PedidoDeCofreNoFechamento {
  sessaoId: string;
  trocoCentavos: number;
}

const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;

export const lerPedidoDeCofreNoFechamento = (corpo: unknown): { pedido: PedidoDeCofreNoFechamento } | { erro: string } => {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  const sessaoId = typeof c.sessaoId === 'string' && ID_VALIDO.test(c.sessaoId) ? c.sessaoId : '';
  if (!sessaoId) return { erro: 'Caixa inválido. Atualize a tela e tente de novo.' };
  const trocoCentavos = centavosNaoNegativos(c.trocoCentavos);
  if (trocoCentavos === null) return { erro: 'Informe quanto fica de troco na gaveta (zero se for tudo para o COFRE).' };
  return { pedido: { sessaoId, trocoCentavos } };
};

export interface PedidoDeAcerto {
  /** yyyy-mm-dd: o dia que esta' sendo acertado (antes de hoje). */
  data: string;
  contadoCentavos: number;
  trocoCentavos: number;
}

export const lerPedidoDeAcerto = (corpo: unknown, hoje: string, desde: string): { pedido: PedidoDeAcerto } | { erro: string } => {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  const data = typeof c.data === 'string' && DATA_ISO.test(c.data) ? c.data : '';
  if (!data) return { erro: 'Escolha o dia que vai acertar.' };
  if (data >= hoje) return { erro: 'O acerto é de um dia que já passou. O dinheiro de hoje se confere no fechamento do caixa.' };
  if (desde && data < desde) return { erro: `A gaveta só soma as vendas desde ${desde.split('-').reverse().join('/')}. Escolha um dia a partir dessa data.` };
  const contadoCentavos = centavosNaoNegativos(c.contadoCentavos);
  if (contadoCentavos === null) return { erro: 'Informe quanto dinheiro havia na gaveta no fim daquele dia (zero se estava vazia).' };
  const trocoCentavos = centavosNaoNegativos(c.trocoCentavos);
  if (trocoCentavos === null) return { erro: 'Informe quanto ficou de troco na gaveta (zero se foi tudo para o COFRE).' };
  const erro = erroDoTroco(contadoCentavos, trocoCentavos);
  if (erro) return { erro };
  return { pedido: { data, contadoCentavos, trocoCentavos } };
};

/** O que o acerto grava: a diferenca (sobra/falta) e quanto vai ao COFRE. */
export const planejarAcerto = (saldoDoSistemaCentavos: number, contadoCentavos: number, trocoCentavos: number): { diferencaCentavos: number; paraCofreCentavos: number } => ({
  diferencaCentavos: contadoCentavos - inteiro(saldoDoSistemaCentavos),
  paraCofreCentavos: contadoCentavos - trocoCentavos,
});

// ---------------------------------------------------------------------------
// FECHAR COM A DATA DE UM DIA ANTERIOR (caixa esquecido aberto, 24/11/2026)
// ---------------------------------------------------------------------------

/** Ate' quantos dias para tras o caixa esquecido aberto pode ser fechado. */
export const DIAS_PARA_FECHAR_ATRASADO = 7;

/**
 * Dias que podem ser a data do fechamento: do dia em que o caixa abriu ate'
 * hoje (no maximo DIAS_PARA_FECHAR_ATRASADO para tras). Caixa aberto hoje: so' hoje.
 */
export const diasParaFechar = (diaDaAbertura: string, hoje: string): string[] => {
  const primeiro = [diaDaAbertura, addDaysToDateInput(hoje, -DIAS_PARA_FECHAR_ATRASADO)].filter((d) => DATA_ISO.test(d)).reduce((maior, d) => (d > maior ? d : maior), '');
  if (!primeiro || primeiro >= hoje) return [hoje];
  const dias: string[] = [];
  for (let d = primeiro; d <= hoje && dias.length <= DIAS_PARA_FECHAR_ATRASADO; d = addDaysToDateInput(d, 1)) dias.push(d);
  return dias;
};

/** Titulo da sessao entra no esperado de um fechamento com data `ate`? (pela data do pagamento). */
export const tituloAteODia = (t: { dataPagamento?: unknown; data?: unknown }, ate: string): boolean => {
  const data = dataIso(t.dataPagamento) || dataIso(t.data);
  return !ate || !data || data <= ate;
};

// ---------------------------------------------------------------------------
// ABERTURA CONFERIDA CONTRA A GAVETA (24/11/2026)
// ---------------------------------------------------------------------------
//
// A Embala abriu com R$ 77,10 contados enquanto a gaveta dizia R$ 1.060,68.
// Decisao do dono: avisar e lancar a diferenca (sobra/falta no extrato do CAIXA,
// com o nome do operador); o esperado parte do valor contado.

/** Vale conferir a abertura contra a gaveta? (chave ligada e nenhum outro caixa aberto) */
export const aberturaConfereComAGaveta = (gaveta: { ativo: boolean; saldoCentavos: number | null; caixasAbertos: number } | null): boolean => (
  Boolean(gaveta && gaveta.ativo && gaveta.saldoCentavos !== null && gaveta.caixasAbertos === 0)
);

/** Texto do aviso quando o contado nao bate com a gaveta; vazio quando bate. */
export const avisoDaAbertura = (saldoDaGavetaCentavos: number, contadoCentavos: number): string => {
  const diferenca = contadoCentavos - saldoDaGavetaCentavos;
  if (diferenca === 0) return '';
  return `Pelo sistema, a gaveta tem ${reais(saldoDaGavetaCentavos)} e você contou ${reais(contadoCentavos)}: `
    + `${diferenca > 0 ? 'sobram' : 'faltam'} ${reais(Math.abs(diferenca))}. `
    + 'A diferença vai para o extrato do CAIXA em seu nome, e o caixa abre com o valor que você contou.';
};
