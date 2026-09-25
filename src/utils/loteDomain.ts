/*
 * LOTE E VALIDADE (2026-09-25) -- regra pura, sem Firestore. Decisoes do dono
 * (docs/PLANO_LOTE_VALIDADE.md):
 *
 *  - Configuracao com 2 modos de saida: AUTOMATICO (o sistema escolhe o lote pelo
 *    FEFO -- vence primeiro, sai primeiro) ou INFORMAR (quem vende escolhe).
 *  - Lote VENCIDO so AVISA: nunca bloqueia a venda.
 *  - Tela de Lotes e Validades com vencimentos em 15 / 30 / 45 dias e vencidos.
 *
 * Datas sao sempre AAAA-MM-DD (o mesmo formato de `estoque_lotes.validade`).
 */

export type ModoSaidaLote = 'automatico' | 'informar';

export const DEFAULT_LOTE_MODO_SAIDA: ModoSaidaLote = 'automatico';
export const DEFAULT_LOTE_AVISAR_VENCIDO = true;

/** Le a chave gravada em `configuracoes/{tenantId}`; qualquer valor estranho cai no padrao. */
export const parseLoteModoSaida = (valor: unknown): ModoSaidaLote => (valor === 'informar' ? 'informar' : DEFAULT_LOTE_MODO_SAIDA);

/** Aviso de lote vencido fica LIGADO, salvo quando esta gravado `false` de proposito. */
export const parseLoteAvisarVencido = (valor: unknown): boolean => (valor === false ? false : DEFAULT_LOTE_AVISAR_VENCIDO);

export interface LoteSaldo {
  id: string;
  lote: string;
  /** AAAA-MM-DD; vazio/nulo = lote sem validade. */
  validade?: string | null;
  quantidade: number;
}

export type SituacaoDoLote = 'vencido' | 'vence_15' | 'vence_30' | 'vence_45' | 'ok' | 'sem_validade';

const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_POR_DIA = 24 * 60 * 60 * 1000;

const diaDaData = (iso: string): number | null => {
  const partes = DATA.exec(String(iso || '').trim());
  if (!partes) return null;
  const [, ano, mes, dia] = partes;
  const ms = Date.UTC(Number(ano), Number(mes) - 1, Number(dia));
  return Number.isFinite(ms) ? Math.round(ms / MS_POR_DIA) : null;
};

/** Dias ate a validade (negativo = ja venceu; 0 = vence hoje). null quando nao ha validade valida. */
export const diasParaVencer = (validade: string | null | undefined, hoje: string): number | null => {
  const alvo = diaDaData(validade ?? '');
  const base = diaDaData(hoje);
  if (alvo === null || base === null) return null;
  return alvo - base;
};

/**
 * Faixa do lote. Vence HOJE ainda e' vendavel, entao cai em "vence em 15 dias";
 * vencido e' so o que ja passou (dias < 0).
 */
export const situacaoDoLote = (validade: string | null | undefined, hoje: string): SituacaoDoLote => {
  const dias = diasParaVencer(validade, hoje);
  if (dias === null) return 'sem_validade';
  if (dias < 0) return 'vencido';
  if (dias <= 15) return 'vence_15';
  if (dias <= 30) return 'vence_30';
  if (dias <= 45) return 'vence_45';
  return 'ok';
};

export const ROTULO_SITUACAO_LOTE: Record<SituacaoDoLote, string> = {
  vencido: 'Vencido',
  vence_15: 'Vence em até 15 dias',
  vence_30: 'Vence em 16 a 30 dias',
  vence_45: 'Vence em 31 a 45 dias',
  ok: 'Dentro do prazo',
  sem_validade: 'Sem validade',
};

/** Ordem FEFO: validade mais proxima primeiro; sem validade por ultimo; empate pelo nome do lote. */
export const ordenarLotesFefo = <T extends LoteSaldo>(lotes: T[]): T[] => (
  [...lotes].sort((a, b) => {
    const va = diaDaData(a.validade ?? '');
    const vb = diaDaData(b.validade ?? '');
    if (va === null && vb !== null) return 1;
    if (va !== null && vb === null) return -1;
    if (va !== null && vb !== null && va !== vb) return va - vb;
    return String(a.lote).localeCompare(String(b.lote), 'pt-BR', { numeric: true });
  })
);

const arredondar = (n: number): number => Math.round(n * 10000) / 10000;

export interface EscolhaDeLote {
  loteId: string;
  lote: string;
  validade: string | null;
  quantidade: number;
  vencido: boolean;
}

export interface ResultadoFefo {
  escolhas: EscolhaDeLote[];
  /** Quanto NAO coube nos lotes (saldo insuficiente); 0 quando tudo foi atendido. */
  faltante: number;
  /** Verdadeiro se algum lote escolhido ja estava vencido (a tela avisa, nao bloqueia). */
  usouVencido: boolean;
}

/**
 * Modo AUTOMATICO: distribui a quantidade pelos lotes seguindo o FEFO, dividindo
 * entre lotes quando um so' nao basta. Lote vencido so' e' usado quando os lotes
 * dentro do prazo nao cobrem a quantidade -- e nesse caso `usouVencido` avisa.
 * Ignora lote sem saldo (<= 0).
 */
export const escolherLotesFefo = (quantidade: number, lotes: LoteSaldo[], hoje: string): ResultadoFefo => {
  let restante = arredondar(Number(quantidade) || 0);
  const comSaldo = lotes.filter((l) => Number(l.quantidade) > 0);
  const fefo = ordenarLotesFefo(comSaldo);
  const vigentes = fefo.filter((l) => situacaoDoLote(l.validade, hoje) !== 'vencido');
  const vencidos = fefo.filter((l) => situacaoDoLote(l.validade, hoje) === 'vencido');

  const escolhas: EscolhaDeLote[] = [];
  for (const lote of [...vigentes, ...vencidos]) {
    if (restante <= 0) break;
    const usar = arredondar(Math.min(restante, Number(lote.quantidade)));
    if (usar <= 0) continue;
    escolhas.push({ loteId: lote.id, lote: lote.lote, validade: lote.validade ? String(lote.validade) : null, quantidade: usar, vencido: situacaoDoLote(lote.validade, hoje) === 'vencido' });
    restante = arredondar(restante - usar);
  }
  return { escolhas, faltante: restante > 0 ? restante : 0, usouVencido: escolhas.some((e) => e.vencido) };
};

export type AbaDeLotes = 'vencidos' | 'vence_15' | 'vence_30' | 'vence_45' | 'todos';

export const ROTULO_ABA_LOTES: Record<AbaDeLotes, string> = {
  vencidos: 'Vencidos',
  vence_15: 'Vencem em 15 dias',
  vence_30: 'Vencem em 30 dias',
  vence_45: 'Vencem em 45 dias',
  todos: 'Todos',
};

/**
 * As abas de 15/30/45 dias sao ACUMULADAS (quem vence em 15 dias tambem vence em
 * 30 e em 45): e' como o dono pensa "o que vence nos proximos N dias". Lote sem
 * saldo nao entra em aba de vencimento -- so' em "Todos".
 */
export const pertenceAAba = (lote: LoteSaldo, aba: AbaDeLotes, hoje: string): boolean => {
  if (aba === 'todos') return true;
  if (Number(lote.quantidade) <= 0) return false;
  const dias = diasParaVencer(lote.validade, hoje);
  if (dias === null) return false;
  if (aba === 'vencidos') return dias < 0;
  const limite = aba === 'vence_15' ? 15 : (aba === 'vence_30' ? 30 : 45);
  return dias >= 0 && dias <= limite;
};

export const contarPorAba = (lotes: LoteSaldo[], hoje: string): Record<AbaDeLotes, number> => ({
  vencidos: lotes.filter((l) => pertenceAAba(l, 'vencidos', hoje)).length,
  vence_15: lotes.filter((l) => pertenceAAba(l, 'vence_15', hoje)).length,
  vence_30: lotes.filter((l) => pertenceAAba(l, 'vence_30', hoje)).length,
  vence_45: lotes.filter((l) => pertenceAAba(l, 'vence_45', hoje)).length,
  todos: lotes.length,
});

/** Aviso (nao bloqueio) para quando a venda usa lote vencido. Devolve null quando nada vencido. */
export const avisoDeLoteVencido = (usados: Array<{ produto: string; lote: string; validade: string | null }>): string | null => {
  if (usados.length === 0) return null;
  const linhas = usados.map((u) => `• ${u.produto} — lote ${u.lote}${u.validade ? ` (venceu em ${u.validade.split('-').reverse().join('/')})` : ''}`);
  return `Atenção: esta venda usa lote vencido:\n${linhas.join('\n')}\nA venda segue normalmente. Confira o produto antes de entregar.`;
};
