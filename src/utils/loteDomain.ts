import { quantidadeNoEstoque } from './custoEntradaDomain';

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

/** Chave para comparar nome de lote sem depender de caixa ou espaco nas pontas. */
export const chaveDoLote = (lote: string): string => String(lote ?? '').trim().toUpperCase();

export interface LoteDoXml {
  numero: string;
  validade: string;
  quantidade: number;
}

export interface LoteParaEntrada {
  lote: string;
  /** AAAA-MM-DD. */
  validade: string;
  /** Ja convertida para a unidade de ESTOQUE. */
  quantidade: number;
}

/**
 * ENTRADA DE NF-E (Fase 3): produto que controla lote EXIGE lote e validade.
 * Prioridade: o que a pessoa digitou na tela; senao o `rastro` do XML. Se o XML
 * trouxer varios lotes para o item, a quantidade se divide entre eles -- mas so'
 * quando a soma bate com a quantidade da nota (senao pede para informar a mao).
 * Nunca inventa lote nem validade: falta dado = erro em portugues.
 */
export const lotesDaEntrada = (params: {
  produto: string;
  loteDigitado: string;
  validadeDigitada: string;
  lotesDoXml: LoteDoXml[];
  quantidadeNota: number;
  fator: unknown;
}): { lotes: LoteParaEntrada[]; erro: string | null } => {
  const { produto, lotesDoXml, quantidadeNota, fator } = params;
  const loteDigitado = params.loteDigitado.trim();
  const validadeDigitada = params.validadeDigitada.trim();
  const falta = (mensagem: string) => ({ lotes: [] as LoteParaEntrada[], erro: mensagem });
  const validadeOk = (v: string) => diaDaData(v) !== null;
  const orientacao = 'Preencha o lote e a validade do item na tela (a validade fica na embalagem do produto).';

  if (validadeDigitada && !validadeOk(validadeDigitada)) return falta(`A validade informada para "${produto}" não é uma data válida. ${orientacao}`);

  if (loteDigitado) {
    const doXml = lotesDoXml.find((l) => chaveDoLote(l.numero) === chaveDoLote(loteDigitado));
    const validade = validadeDigitada || (doXml && validadeOk(doXml.validade) ? doXml.validade : '');
    if (!validade) return falta(`Informe a validade do lote "${loteDigitado}" de "${produto}". ${orientacao}`);
    return { lotes: [{ lote: loteDigitado, validade, quantidade: quantidadeNoEstoque(quantidadeNota, fator) }], erro: null };
  }

  const comNumero = lotesDoXml.filter((l) => l.numero.trim());
  if (comNumero.length === 0) {
    return falta(`"${produto}" controla lote, mas a nota não trouxe o lote. Informe o lote e a validade do item na tela antes de confirmar.`);
  }
  if (comNumero.length === 1) {
    const unico = comNumero[0];
    const validade = validadeDigitada || (validadeOk(unico.validade) ? unico.validade : '');
    if (!validade) return falta(`A nota trouxe o lote "${unico.numero}" de "${produto}" sem validade. Informe a validade do item na tela antes de confirmar.`);
    return { lotes: [{ lote: unico.numero.trim(), validade, quantidade: quantidadeNoEstoque(quantidadeNota, fator) }], erro: null };
  }

  const soma = comNumero.reduce((total, l) => total + Number(l.quantidade || 0), 0);
  if (Math.abs(soma - Number(quantidadeNota)) > 0.0005) {
    return falta(`A nota traz ${comNumero.length} lotes de "${produto}" e a soma deles (${soma}) não fecha com a quantidade da nota (${quantidadeNota}). Informe o lote e a validade do item na tela.`);
  }
  const semValidade = comNumero.find((l) => !validadeOk(l.validade));
  if (semValidade) return falta(`O lote "${semValidade.numero}" de "${produto}" veio sem validade na nota. Informe o lote e a validade do item na tela antes de confirmar.`);
  return {
    lotes: comNumero.map((l) => ({ lote: l.numero.trim(), validade: l.validade, quantidade: quantidadeNoEstoque(l.quantidade, fator) })),
    erro: null,
  };
};

/** Junta linhas do mesmo lote (o mesmo produto pode aparecer em 2 itens da nota) somando a quantidade. */
export const somarLotesIguais = (lotes: LoteParaEntrada[]): LoteParaEntrada[] => {
  const mapa = new Map<string, LoteParaEntrada>();
  lotes.forEach((l) => {
    const chave = chaveDoLote(l.lote);
    const atual = mapa.get(chave);
    mapa.set(chave, atual ? { ...atual, quantidade: Math.round((atual.quantidade + l.quantidade) * 1e6) / 1e6 } : { ...l });
  });
  return [...mapa.values()];
};

/* ------------------------------------------------------------------------------------------------
 * FASE 4 -- BAIXA POR LOTE NAS VENDAS (2026-09-25)
 *
 * Regra do dono: SO' o produto marcado "Controlar lote" entra nisto; os demais seguem so' com o
 * estoque normal. O que a venda tira de lote e' um PEDACO do estoque: `estoque.quantidade` continua
 * sendo o total, e o que nao cabe nos lotes sai do "saldo sem lote" (estoque anterior a ligar o
 * controle). Nada trava por causa do saldo sem lote.
 * ---------------------------------------------------------------------------------------------- */

export interface LinhaParaLote {
  /** Identifica a linha da venda (indice ou id); a resposta vem indexada por ela. */
  chave: string;
  produtoId: string;
  nome: string;
  /** Sempre na unidade BASE do estoque (ja convertida pelo fator de embalagem). */
  quantidade: number;
}

export interface LoteUsado {
  loteId: string;
  lote: string;
  validade: string | null;
  /** Unidade base do estoque. */
  quantidade: number;
}

export interface PlanoDeLotes {
  /** Lotes tirados por linha (so' linhas de produto que controla lote). */
  porLinha: Record<string, LoteUsado[]>;
  /** Parte de cada linha que saiu do saldo SEM lote. */
  semLote: Record<string, number>;
  /** Lotes vencidos usados: a tela so' AVISA (decisao do dono), nunca bloqueia. */
  vencidosUsados: Array<{ produto: string; lote: string; validade: string | null }>;
}

/**
 * Reparte cada linha pelos lotes do produto, na ordem das linhas, gastando o saldo de um lote antes
 * de a linha seguinte olhar para ele. `preferidos` (modo "informar o lote") diz de que lote a linha
 * quer sair PRIMEIRO; o que sobrar segue o FEFO. Lote vencido so' entra quando os vigentes nao
 * cobrem a quantidade -- ou quando foi escolhido a mao (e ai so' avisa).
 */
export const planejarBaixaPorLotes = (
  linhas: LinhaParaLote[],
  lotesPorProduto: Record<string, LoteSaldo[]>,
  hoje: string,
  preferidos: Record<string, string> = {},
): PlanoDeLotes => {
  const saldo = new Map<string, number>();
  Object.values(lotesPorProduto).forEach((lista) => lista.forEach((l) => saldo.set(l.id, Number(l.quantidade) || 0)));
  const plano: PlanoDeLotes = { porLinha: {}, semLote: {}, vencidosUsados: [] };
  const avisados = new Set<string>();

  const retirar = (linha: LinhaParaLote, lote: LoteSaldo, quantidade: number, usados: LoteUsado[]): number => {
    const disponivel = saldo.get(lote.id) || 0;
    const usar = Math.round(Math.min(quantidade, disponivel) * 10000) / 10000;
    if (usar <= 0) return 0;
    saldo.set(lote.id, Math.round((disponivel - usar) * 10000) / 10000);
    const existente = usados.find((u) => u.loteId === lote.id);
    if (existente) existente.quantidade = Math.round((existente.quantidade + usar) * 10000) / 10000;
    else usados.push({ loteId: lote.id, lote: lote.lote, validade: lote.validade ? String(lote.validade) : null, quantidade: usar });
    if (situacaoDoLote(lote.validade, hoje) === 'vencido' && !avisados.has(`${linha.chave}|${lote.id}`)) {
      avisados.add(`${linha.chave}|${lote.id}`);
      plano.vencidosUsados.push({ produto: linha.nome, lote: lote.lote, validade: lote.validade ? String(lote.validade) : null });
    }
    return usar;
  };

  for (const linha of linhas) {
    const lotes = lotesPorProduto[linha.produtoId];
    if (!lotes) continue;
    let restante = Math.round((Number(linha.quantidade) || 0) * 10000) / 10000;
    const usados: LoteUsado[] = [];

    const escolhido = preferidos[linha.chave] ? lotes.find((l) => l.id === preferidos[linha.chave]) : undefined;
    if (escolhido) restante = Math.round((restante - retirar(linha, escolhido, restante, usados)) * 10000) / 10000;

    const fefo = ordenarLotesFefo(lotes.filter((l) => l.id !== escolhido?.id));
    const vigentes = fefo.filter((l) => situacaoDoLote(l.validade, hoje) !== 'vencido');
    const vencidos = fefo.filter((l) => situacaoDoLote(l.validade, hoje) === 'vencido');
    for (const lote of [...vigentes, ...vencidos]) {
      if (restante <= 0) break;
      restante = Math.round((restante - retirar(linha, lote, restante, usados)) * 10000) / 10000;
    }

    plano.porLinha[linha.chave] = usados;
    if (restante > 0) plano.semLote[linha.chave] = restante;
  }
  return plano;
};

/**
 * Devolucao/estorno: devolve ao MESMO lote de onde a venda tirou. Considera as `jaDevolvida`
 * unidades que ja voltaram (na ordem em que foram tiradas) e devolve `quantidade` a partir dali.
 * A parte que a venda tirou do saldo sem lote volta para o saldo sem lote (fica so' no estoque).
 */
export const distribuirRetornoAosLotes = (lotesDoItem: LoteUsado[], jaDevolvida: number, quantidade: number): LoteUsado[] => {
  let pular = Math.max(0, Number(jaDevolvida) || 0);
  let devolver = Math.max(0, Number(quantidade) || 0);
  const saida: LoteUsado[] = [];
  for (const lote of lotesDoItem) {
    if (devolver <= 0) break;
    let disponivel = Number(lote.quantidade) || 0;
    if (pular > 0) {
      const descartado = Math.min(pular, disponivel);
      pular = Math.round((pular - descartado) * 10000) / 10000;
      disponivel = Math.round((disponivel - descartado) * 10000) / 10000;
    }
    if (disponivel <= 0) continue;
    const volta = Math.round(Math.min(devolver, disponivel) * 10000) / 10000;
    devolver = Math.round((devolver - volta) * 10000) / 10000;
    saida.push({ ...lote, quantidade: volta });
  }
  return saida;
};

/** Soma o que varias linhas tiraram do MESMO lote (uma escrita por lote na transacao). */
export const somarLotesUsados = (listas: LoteUsado[][]): LoteUsado[] => {
  const mapa = new Map<string, LoteUsado>();
  listas.flat().forEach((l) => {
    const atual = mapa.get(l.loteId);
    mapa.set(l.loteId, atual ? { ...atual, quantidade: Math.round((atual.quantidade + l.quantidade) * 10000) / 10000 } : { ...l });
  });
  return [...mapa.values()];
};
