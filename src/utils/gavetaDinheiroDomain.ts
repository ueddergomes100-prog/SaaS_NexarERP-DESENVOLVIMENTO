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
import { getDateInputInTimeZone } from './dateTime';
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

export type TipoMovimentoGaveta = 'dinheiro_entrada' | 'dinheiro_saida' | 'sangria_pdv' | 'diferenca_fechamento';

export const ROTULO_MOVIMENTO_GAVETA: Record<TipoMovimentoGaveta, string> = {
  dinheiro_entrada: 'Dinheiro recebido',
  dinheiro_saida: 'Dinheiro pago',
  sangria_pdv: 'Sangria do PDV',
  diferenca_fechamento: 'Diferença no fechamento',
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
  return {
    id: `titulo:${id}`,
    tipo: entrada ? 'dinheiro_entrada' : 'dinheiro_saida',
    direcao: entrada ? 'credito' : 'debito',
    valorCentavos,
    descricao: String(t.descricao || (entrada ? 'Recebimento em dinheiro' : 'Pagamento em dinheiro')),
    data,
    criadoEmIso,
  };
};

/** Sessao do PDV (colecao `caixas_pdv`) com as datas ja' convertidas. */
export interface SessaoParaGaveta {
  status?: unknown;
  operadorNome?: unknown;
  terminalNome?: unknown;
  sangrias?: unknown;
  diferencaCentavos?: unknown;
  /** Gravado no fechamento quando o esperado foi o saldo da gaveta. */
  fechamentoPelaGaveta?: unknown;
  fechadoEm?: Date | null;
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
}): EsperadoNoFechamento => {
  const porSessao = inteiro(args.saldoInicialCentavos) + inteiro(args.dinheiroDaSessaoCentavos) - inteiro(args.totalSangriasCentavos);
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
      ? 'Há mais de um caixa aberto: a conta é só deste caixa (saldo inicial + vendas em dinheiro deste caixa − sangrias).'
      : 'Saldo inicial + vendas em dinheiro deste caixa − sangrias.',
  };
};

/** "Conferido", "Sobrou R$ X" ou "Faltou R$ X". */
export const resultadoDaContagem = (diferencaCentavos: number): string => {
  if (diferencaCentavos === 0) return 'Conferido: o valor contado bate com o esperado.';
  return diferencaCentavos > 0
    ? `Sobrou ${formatarReais(diferencaCentavos)} em relação ao esperado.`
    : `Faltou ${formatarReais(Math.abs(diferencaCentavos))} em relação ao esperado.`;
};
