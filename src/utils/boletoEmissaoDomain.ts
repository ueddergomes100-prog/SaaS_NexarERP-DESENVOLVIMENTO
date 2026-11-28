import type { BoletoDetails, StatusBoleto } from './financeDomain';
import { differenceInCalendarDays, getDateInputInTimeZone } from './dateTime';

/**
 * CICLO DE VIDA DO BOLETO DEPOIS DE EMITIDO (2026-09-22).
 *
 * O calculo (codigo de barras, linha digitavel, nosso numero) mora em
 * boletoDomain.ts/boletoCnabDomain.ts; o arquivo de remessa em
 * boletoRemessaSicoobDomain.ts. Aqui fica so' o que e' da TELA: status
 * calculado (vencido), validacao do convenio antes de deixar emitir, e a
 * leitura do arquivo de retorno do banco.
 */

// --- Numero do documento do boleto: a NOTA FISCAL da venda -----------------

/**
 * O BOLETO SAI COM O NUMERO DA NOTA FISCAL (12/11/2026).
 *
 * "Nº do documento" e "Ref. NF." saiam com o numero do PEDIDO (0397) -- e a
 * linha ainda dizia "Ref. NF.". O cliente de um cliente recusou o boleto
 * porque a nota era a 232 e o boleto nao citava a nota. Quem paga confere o
 * boleto pela nota fiscal, nao pelo numero interno do pedido.
 *
 * Regra: com nota de venda AUTORIZADA do pedido, o documento e a referencia
 * sao o numero dela (NF-e vale mais que cupom). Sem nota (venda sem nota, ou
 * boleto tirado antes de emitir a nota), fica o numero do pedido e a linha
 * diz "Ref. Pedido". Sem pedido, o nosso numero, como sempre foi.
 *
 * O codigo de barras e a linha digitavel NAO dependem disto (saem do nosso
 * numero): reimprimir um boleto ja' emitido so' troca o que esta' escrito.
 */
export interface NotaParaOBoleto {
  tipo?: string | null;
  status?: string | null;
  finalidade?: string | null;
  number?: number | string | null;
}

const FINALIDADES_QUE_NAO_SAO_A_VENDA = ['devolucao', 'devolucao_compra', 'remessa_entrega_futura', 'transferencia'];

/** Numero da nota de venda autorizada do pedido ('' = nao tem). */
export const numeroDaNotaParaOBoleto = (notas: NotaParaOBoleto[]): string => {
  const valendo = notas.filter((n) => (
    (n.tipo === 'NF-e' || n.tipo === 'NFC-e')
    && n.status === 'authorized'
    && !FINALIDADES_QUE_NAO_SAO_A_VENDA.includes(String(n.finalidade || ''))
    && Number(n.number) > 0
  ));
  if (valendo.length === 0) return '';
  // NF-e vale mais que cupom (e' ela que acompanha a mercadoria); entre iguais, a mais nova.
  const escolhida = valendo.sort((a, b) => (
    Number(b.tipo === 'NF-e') - Number(a.tipo === 'NF-e') || Number(b.number) - Number(a.number)
  ))[0];
  return String(Math.trunc(Number(escolhida.number)));
};

export interface DocumentoDoBoleto {
  /** Vai em "Nº do documento" e no arquivo de remessa. */
  numeroDocumento: string;
  /** Vai na linha "Ref." das instrucoes ('' = sem linha). */
  referencia: string;
  /** A referencia e' o numero do pedido (a venda nao tem nota autorizada). */
  referenciaEhPedido: boolean;
}

export const documentoDoBoleto = (a: { numeroNota?: string | null; numeroPedido?: string | null; nossoNumero: string | number }): DocumentoDoBoleto => {
  const nota = String(a.numeroNota || '').trim();
  const pedido = String(a.numeroPedido || '').trim();
  if (nota) return { numeroDocumento: nota, referencia: nota, referenciaEhPedido: false };
  if (pedido) return { numeroDocumento: pedido, referencia: pedido, referenciaEhPedido: true };
  return { numeroDocumento: String(a.nossoNumero), referencia: '', referenciaEhPedido: false };
};

// --- Status efetivo (vencido e calculado, nunca gravado) -------------------

export type StatusBoletoEfetivo = StatusBoleto | 'vencido';

export const ROTULO_STATUS_BOLETO: Record<StatusBoletoEfetivo, string> = {
  emitido: 'Emitido',
  em_remessa: 'Em remessa',
  pago: 'Pago',
  vencido: 'Vencido',
};

/**
 * Aplica "vencido" por cima do status gravado -- nunca o contrario. Um
 * boleto pago nunca vira vencido so' porque a data passou; um "em_remessa"
 * cujo vencimento ja passou fica vencido ate' o retorno confirmar a baixa
 * ou alguem confirmar manualmente.
 */
export const statusBoletoEfetivo = (boleto: Pick<BoletoDetails, 'status' | 'vencimento'>, hoje = getDateInputInTimeZone()): StatusBoletoEfetivo => {
  if (boleto.status === 'pago') return 'pago';
  const dias = differenceInCalendarDays(hoje, boleto.vencimento);
  if (dias !== null && dias < 0) return 'vencido';
  return boleto.status;
};

// --- Convenio do banco -------------------------------------------------

/** Dados minimos que a tela de Bancos precisa ter preenchido pra deixar
 *  emitir um boleto Sicoob -- ver src/pages/Bancos/BancosList.tsx. */
export interface ConvenioBoletoCadastro {
  cooperativa?: string;
  conta?: string;
  contaDv?: string;
}

/**
 * Erro em portugues do que falta no cadastro do banco, ou null se esta
 * completo (regra 1 do CLAUDE.md: nao emite com cadastro incompleto,
 * bloqueia com mensagem clara dizendo o que falta).
 */
export const erroDoConvenioBoleto = (convenio: ConvenioBoletoCadastro | null | undefined): string | null => {
  if (!convenio) {
    return 'Este banco não tem convênio de boleto configurado. Edite o banco em Cadastros Auxiliares → Bancos e preencha a Configuração de Boleto.';
  }
  const faltando: string[] = [];
  if (!convenio.cooperativa?.trim()) faltando.push('cooperativa/agência');
  if (!convenio.conta?.trim()) faltando.push('conta');
  if (faltando.length > 0) {
    return `Complete o convênio de boleto do banco antes de emitir: falta ${faltando.join(', ')}. Edite em Cadastros Auxiliares → Bancos.`;
  }
  return null;
};

// --- Leitura do arquivo de retorno --------------------------------------

/**
 * Codigos de ocorrencia do retorno que representam LIQUIDACAO (o boleto foi
 * pago) -- os unicos que disparam baixa automatica. Qualquer outro codigo
 * (ex.: 02 entrada confirmada, 03 entrada rejeitada, 09 baixado, 26/27
 * rejeicoes) fica de fora de proposito: dar baixa no codigo errado
 * marcaria "pago" um titulo que so' foi confirmado ou ate' rejeitado.
 *
 * CNAB240 CONFERIDO COM ARQUIVO REAL (24/11/2026, Embala Minas, retorno
 * "3049_244244_580490_261124_C240_571"): cada titulo vem em DUAS linhas, o
 * Segmento T (nosso numero, ocorrencia, valor DO TITULO) e logo depois o
 * Segmento U (valor PAGO e datas). Posicoes (1-based):
 *
 *   T 16-17   codigo da ocorrencia (06 liquidacao, 09 baixa, 02 entrada)
 *   T 38-47   nosso numero com o DV (10 digitos; 48-57 = parcela, modalidade, formulario)
 *   T 74-81   vencimento (DDMMAAAA) | T 82-96 valor do titulo
 *   U 18-32   juros/multa | U 78-92 valor PAGO | U 93-107 valor liquido
 *   U 138-145 data da ocorrencia (o pagamento) | U 146-153 data do credito
 *
 * Antes desta conferencia o leitor pegava o valor e a data do Segmento T: a
 * data saia "0039-30-30" e o valor era o do titulo, nao o pago (boleto pago
 * com juros entraria a menos no banco). Agora o valor pago e a data vem do U;
 * T sem o U logo depois nao da' baixa (fica para conferir).
 */
const CODIGOS_OCORRENCIA_LIQUIDACAO = new Set(['06', '17']);
/** CNAB240: entrada confirmada so' informa (vem uma por boleto de cada remessa). */
const CODIGOS_INFORMATIVOS_CNAB240 = new Set(['02']);

/** O que o arquivo do banco diz sobre o pagamento de UM boleto (centavos). */
export interface DetalheRetornoBoleto {
  jurosMultaCentavos?: number;
  descontoCentavos?: number;
  tarifaCentavos?: number;
  valorLiquidoCentavos?: number;
}

/**
 * Detalhe do boleto RECEBIDO para a tela (28/11/2026, pedido do dono: "mostrar o
 * valor de fato recebido do boleto, com os juros, multa etc, valor liquido").
 * Usa o que o arquivo do banco trouxe; boleto baixado antes disso (ou CNAB400)
 * usa a diferenca entre o pago e o valor do boleto, e o liquido = pago.
 */
export const detalheDoRecebimentoBoleto = (t: { valorCentavos: number; valorPagoCentavos?: number; retornoDoBanco?: DetalheRetornoBoleto }) => {
  const valorBoleto = Math.max(0, Math.round(Number(t.valorCentavos) || 0));
  const pago = Math.max(0, Math.round(Number(t.valorPagoCentavos) || 0)) || valorBoleto;
  const r = t.retornoDoBanco || {};
  const jurosMulta = r.jurosMultaCentavos ?? Math.max(0, pago - valorBoleto);
  const desconto = r.descontoCentavos ?? Math.max(0, valorBoleto - pago);
  // Tarifa (conferido no retorno real do Sicoob, 28/11/2026): o Sicoob manda a
  // tarifa no Segmento T e o "liquido" IGUAL ao pago (credita cheio e cobra a
  // tarifa a parte na conta). Outro banco pode mandar o liquido ja' sem a tarifa.
  // Vale a maior das duas leituras, e o liquido e' sempre pago - tarifa -- o
  // mesmo que a baixa faz no saldo do banco (movimentoBanco.js).
  const tarifaDoArquivo = Math.max(0, r.tarifaCentavos ?? 0);
  const tarifaPeloLiquido = r.valorLiquidoCentavos !== undefined ? Math.max(0, pago - r.valorLiquidoCentavos) : 0;
  const tarifa = Math.min(pago, Math.max(tarifaDoArquivo, tarifaPeloLiquido));
  const liquido = Math.max(0, pago - tarifa);
  return { valorBoleto, jurosMulta, desconto, pago, tarifa, liquido, veioDoBanco: r.valorLiquidoCentavos !== undefined || r.tarifaCentavos !== undefined };
};

export interface LinhaRetornoLida {
  /** So' preenchido quando a linha e' um segmento de titulo (T). */
  nossoNumero?: string;
  codigoOcorrencia?: string;
  /** AAAA-MM-DD. */
  dataOcorrencia?: string;
  valorPagoCentavos?: number;
  /**
   * Detalhe do recebimento (28/11/2026, so' CNAB240): juros/multa e desconto do
   * Segmento U, tarifa do banco (T 199-213) e o valor liquido creditado (U 93-107).
   */
  detalhe?: DetalheRetornoBoleto;
  /** "Seu numero" que a remessa mandou (so' no CNAB400). */
  seuNumero?: string;
  /** AAAA-MM-DD (so' no CNAB400). */
  vencimento?: string;
  /** true pra ocorrencia que so' informa (entrada confirmada, titulo em ser). */
  informativo?: boolean;
  /** true so' pros codigos de liquidacao reconhecidos -- ver a ressalva acima. */
  liquidado: boolean;
  /** Mensagem em portugues quando a linha nao pode ser aplicada automatico. */
  aviso?: string;
}

const apenasDigitos = (valor: string): string => String(valor || '').replace(/\D/g, '');

/** AAAA-MM-DD so' se for uma data de verdade (dia/mes/ano validos); senao ''. */
const dataValidaOuVazia = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return '';
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return ano >= 2000 && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia ? iso : '';
};

const dataDdmmaaaaParaIso = (ddmmaaaa: string): string => {
  const d = apenasDigitos(ddmmaaaa);
  if (d.length !== 8) return '';
  return dataValidaOuVazia(`${d.slice(4, 8)}-${d.slice(2, 4)}-${d.slice(0, 2)}`);
};

/**
 * RETORNO CNAB400 DO SICOOB -- LAYOUT CONFIRMADO COM ARQUIVO REAL (2026-09-23).
 *
 * O banco devolve o retorno em CNAB400 (arquivo "3049_..._C400_00"), mesmo a
 * remessa sendo CNAB240. Posicoes (1-based) conferidas contra 196 titulos
 * reais, cada um com o nosso numero + DV calculado pelo proprio banco:
 *
 *   1        tipo do registro (0 header, 1 detalhe, 9 trailer)
 *   38-62    "seu numero" que a remessa mandou (P 196-213)
 *   63-73    nosso numero (11 digitos) | 74 = DV do nosso numero
 *   109-110  codigo da ocorrencia
 *   111-116  data da ocorrencia (DDMMAA)  -- em liquidacao, o dia do pagamento
 *   117-126  numero do documento
 *   147-152  vencimento (DDMMAA)
 *   153-165  valor do titulo (centavos)
 *   254-266  valor pago (centavos)
 *
 * Ocorrencias vistas em arquivos reais: 02 = entrada confirmada, 06 =
 * liquidacao, 11 = titulo em ser/pendente, 04 = transferencia de carteira
 * (entrada) e 48 = confirmacao da instrucao de transferencia de carteira /
 * modalidade de cobranca (tabela do Sicoob, a mesma do CNAB240 FEBRABAN,
 * conferida no ACBrBancoSicoob em 03/11/2026). 04 e 48 vem COM o valor do
 * titulo no campo "valor pago" mas NAO sao pagamento: sao so' informativos
 * (num retorno real de 03/11/2026 vieram 116 linhas 48 -- o banco mudou a
 * modalidade da carteira -- e a tela assustava com "122 com outra
 * ocorrencia"). 09 = baixa do titulo no banco: nao e' pagamento, fica em
 * "conferir" de proposito.
 */
export const CODIGOS_LIQUIDACAO_CNAB400 = new Set(['06']);
const CODIGOS_INFORMATIVOS_CNAB400 = new Set(['02', '11', '04', '48']);

const dataDdmmaaParaIso = (ddmmaa: string): string => {
  const d = apenasDigitos(ddmmaa);
  if (d.length !== 6) return '';
  return dataValidaOuVazia(`20${d.slice(4, 6)}-${d.slice(2, 4)}-${d.slice(0, 2)}`);
};

const formatarReais = (centavos: number): string => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const parseLinhaRetornoSicoob400 = (linha: string): LinhaRetornoLida => {
  if (linha[0] !== '1') return { liquidado: false };

  // Mesma chave de nossoNumeroSicoobComDv(): 9 digitos + DV (10 posicoes).
  const nossoNumero = `${linha.slice(64, 73)}${linha[73] ?? ''}`;
  const codigoOcorrencia = linha.slice(108, 110);
  const dataOcorrencia = dataDdmmaaParaIso(linha.slice(110, 116));
  const valorPagoCentavos = Number.parseInt(linha.slice(253, 266), 10) || 0;
  const vencimento = dataDdmmaaParaIso(linha.slice(146, 152));
  const seuNumero = linha.slice(37, 62).trim();

  const liquidado = CODIGOS_LIQUIDACAO_CNAB400.has(codigoOcorrencia) && valorPagoCentavos > 0;
  const informativo = CODIGOS_INFORMATIVOS_CNAB400.has(codigoOcorrencia);

  return {
    nossoNumero,
    seuNumero,
    codigoOcorrencia,
    dataOcorrencia: dataOcorrencia || undefined,
    vencimento: vencimento || undefined,
    valorPagoCentavos,
    liquidado,
    informativo,
    ...(liquidado || informativo ? {} : {
      aviso: `Nosso número ${nossoNumero}: ocorrência ${codigoOcorrencia || '??'}${valorPagoCentavos > 0 ? ` com valor pago de ${formatarReais(valorPagoCentavos)}` : ''} — confira no banco antes de dar baixa.`,
    }),
  };
};

/**
 * Le uma linha do arquivo de retorno do Sicoob (400 posicoes = CNAB400, o
 * que o banco realmente manda; 240 = CNAB240, layout pelo manual publico).
 * Devolve `liquidado: false` (com aviso) pra tudo que nao for claramente
 * reconhecido -- inclusive linha maltormada -- porque o risco de NAO dar
 * baixa num titulo pago e' so' um lembrete manual; o risco de dar baixa
 * errada e' dinheiro no lugar errado.
 */
/** Segmento U do CNAB240 (a linha logo depois do T): valor pago e datas. null se nao for U. */
const lerSegmentoU240 = (linha: string | undefined) => {
  if (!linha || linha.length !== 240 || linha[13] !== 'U') return null;
  const centavos = (de: number, ate: number) => Number.parseInt(linha.slice(de, ate), 10) || 0;
  return {
    valorPagoCentavos: centavos(77, 92),
    dataOcorrencia: dataDdmmaaaaParaIso(linha.slice(137, 145)),
    jurosMultaCentavos: centavos(17, 32),
    descontoCentavos: centavos(32, 47),
    valorLiquidoCentavos: centavos(92, 107),
  };
};

/**
 * `proxima` = a linha seguinte do arquivo; no CNAB240 e' o Segmento U do mesmo
 * titulo (valor pago e data do pagamento). No CNAB400 e' ignorada.
 */
export const parseLinhaRetornoSicoob = (linha: string, proxima?: string): LinhaRetornoLida => {
  if (linha.length === 400) return parseLinhaRetornoSicoob400(linha);
  if (linha.length !== 240) {
    return { liquidado: false, aviso: `Linha com ${linha.length} posições (esperado 400 ou 240) — ignorada.` };
  }
  const segmento = linha[13];
  if (segmento !== 'T') {
    // Header/trailer/Segmento U -- nao e' erro, so' nao tem titulo pra ler aqui.
    return { liquidado: false };
  }

  const nossoNumero = apenasDigitos(linha.slice(37, 47));
  const codigoOcorrencia = linha.slice(15, 17);
  const u = lerSegmentoU240(proxima);
  const valorPagoCentavos = u ? u.valorPagoCentavos : 0;
  const dataOcorrencia = u ? u.dataOcorrencia : '';

  const ehLiquidacao = CODIGOS_OCORRENCIA_LIQUIDACAO.has(codigoOcorrencia);
  const liquidado = ehLiquidacao && valorPagoCentavos > 0;
  const informativo = CODIGOS_INFORMATIVOS_CNAB240.has(codigoOcorrencia);
  // Liquido zerado no arquivo = banco nao informou: nao inventa tarifa do tamanho do pago.
  const detalhe: DetalheRetornoBoleto | undefined = liquidado && u ? {
    jurosMultaCentavos: u.jurosMultaCentavos,
    descontoCentavos: u.descontoCentavos,
    tarifaCentavos: Number.parseInt(linha.slice(198, 213), 10) || 0,
    ...(u.valorLiquidoCentavos > 0 ? { valorLiquidoCentavos: u.valorLiquidoCentavos } : {}),
  } : undefined;

  return {
    nossoNumero,
    codigoOcorrencia,
    dataOcorrencia: dataOcorrencia || undefined,
    valorPagoCentavos,
    ...(detalhe ? { detalhe } : {}),
    liquidado,
    informativo,
    ...(liquidado || informativo ? {} : {
      aviso: ehLiquidacao
        ? `Nosso número ${nossoNumero || '(não lido)'}: pago, mas o arquivo não trouxe o valor pago (segmento U) — confira no banco antes de dar baixa.`
        : `Nosso número ${nossoNumero || '(não lido)'}: ocorrência ${codigoOcorrencia || '??'} não é liquidação — confira manualmente antes de dar baixa.`,
    }),
  };
};

export interface ResumoRetorno {
  totalLinhas: number;
  liquidados: LinhaRetornoLida[];
  /** Entrada confirmada / titulo em ser: informativo, nao pede nenhuma acao. */
  informativos: LinhaRetornoLida[];
  paraConferir: LinhaRetornoLida[];
}

/** Le o arquivo de retorno inteiro (texto bruto) e separa o que pode virar
 *  baixa automatica do que so' informa e do que precisa de conferencia. */
export const lerArquivoRetornoSicoob = (conteudo: string): ResumoRetorno => {
  const linhas = conteudo.split(/\r?\n/).filter((l) => l.length > 0);
  const lidas = linhas.map((l, i) => parseLinhaRetornoSicoob(l, linhas[i + 1])).filter((l) => l.nossoNumero || l.aviso);

  return {
    totalLinhas: linhas.length,
    liquidados: lidas.filter((l) => l.liquidado),
    informativos: lidas.filter((l) => !l.liquidado && l.informativo),
    paraConferir: lidas.filter((l) => !l.liquidado && !l.informativo && l.nossoNumero),
  };
};

// ---------------------------------------------------------------------------
// FILTRO "FATURADOS" (2026-10-01, pedido do cliente)
// ---------------------------------------------------------------------------
//
// "Coloca um filtro pra eu ver os ultimos faturados": a lista ordena pelo nosso
// numero/numero da venda, e a venda de hoje se perdia no meio das antigas.
// Filtra pela data em que o titulo nasceu (o faturamento da venda/OS).

export type PeriodoFaturamento = 'todos' | 'hoje' | '3dias' | '7dias' | '30dias' | 'periodo';

export const ROTULO_PERIODO_FATURAMENTO: Record<PeriodoFaturamento, string> = {
  todos: 'Todos',
  hoje: 'Hoje',
  '3dias': 'Últimos 3 dias',
  '7dias': 'Últimos 7 dias',
  '30dias': 'Últimos 30 dias',
  periodo: 'Período...',
};

const DIAS_DO_PERIODO: Partial<Record<PeriodoFaturamento, number>> = { hoje: 0, '3dias': 2, '7dias': 6, '30dias': 29 };

/**
 * O titulo faturado em `faturadoEm` (AAAA-MM-DD) entra no filtro escolhido?
 * Titulo sem data de faturamento (lancamento antigo) so' aparece em "Todos" --
 * nao da' pra dizer que foi faturado nos ultimos dias.
 */
export const faturadoNoPeriodo = (
  faturadoEm: string | undefined,
  periodo: PeriodoFaturamento,
  intervalo: { de?: string; ate?: string } = {},
  hoje = getDateInputInTimeZone(),
): boolean => {
  if (periodo === 'todos') return true;
  if (!faturadoEm) return false;
  if (periodo === 'periodo') {
    if (intervalo.de && faturadoEm < intervalo.de) return false;
    if (intervalo.ate && faturadoEm > intervalo.ate) return false;
    return true;
  }
  const dias = DIAS_DO_PERIODO[periodo] ?? 0;
  const diferenca = differenceInCalendarDays(faturadoEm, hoje);
  return diferenca !== null && diferenca >= 0 && diferenca <= dias;
};

// ---------------------------------------------------------------------------
// FILTROS DE VENCIMENTO, EMISSAO, BANCO E VALOR (2026-10-23, lista do dono)
// ---------------------------------------------------------------------------
//
// "Filtro por data de emissao e vencimento e outros": junto do "Faturados".
// Emissao = o dia em que o boleto foi gerado (boleto.dataEmissao); titulo ainda
// sem boleto so' aparece com "Todos". Vencimento = o do boleto ou, sem boleto, o do titulo.

export type PeriodoVencimento = 'todos' | 'hoje' | '7dias' | 'mes' | 'vencidos' | 'periodo';

export const ROTULO_PERIODO_VENCIMENTO: Record<PeriodoVencimento, string> = {
  todos: 'Todos',
  hoje: 'Vencem hoje',
  '7dias': 'Próximos 7 dias',
  mes: 'Este mês',
  vencidos: 'Já vencidos',
  periodo: 'Período...',
};

/** O vencimento (AAAA-MM-DD) entra no filtro? Sem vencimento so' em "Todos". */
export const vencimentoNoPeriodo = (
  vencimento: string | undefined,
  periodo: PeriodoVencimento,
  intervalo: { de?: string; ate?: string } = {},
  hoje = getDateInputInTimeZone(),
): boolean => {
  if (periodo === 'todos') return true;
  if (!vencimento) return false;
  if (periodo === 'periodo') {
    if (intervalo.de && vencimento < intervalo.de) return false;
    if (intervalo.ate && vencimento > intervalo.ate) return false;
    return true;
  }
  if (periodo === 'hoje') return vencimento === hoje;
  if (periodo === 'mes') return vencimento.slice(0, 7) === hoje.slice(0, 7);
  if (periodo === 'vencidos') return vencimento < hoje;
  const dias = differenceInCalendarDays(hoje, vencimento);
  return dias !== null && dias >= 0 && dias <= 6;
};

/** "1.234,56" / "1234.56" / "" -> centavos (null = vazio ou invalido). */
export const centavosDoFiltroDeValor = (texto: string): number | null => {
  const limpo = String(texto || '').trim().replace(/\s|R\$/g, '');
  if (!limpo) return null;
  const normal = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
  const n = Number(normal);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

/** Valor do titulo dentro da faixa "de/ate" (campo vazio nao limita). */
export const valorNaFaixa = (valorCentavos: number, de: string, ate: string): boolean => {
  const minimo = centavosDoFiltroDeValor(de);
  const maximo = centavosDoFiltroDeValor(ate);
  if (minimo !== null && valorCentavos < minimo) return false;
  if (maximo !== null && valorCentavos > maximo) return false;
  return true;
};

export interface FiltrosExtrasBoleto {
  vencimento: PeriodoVencimento;
  vencimentoDe: string;
  vencimentoAte: string;
  emissao: PeriodoFaturamento;
  emissaoDe: string;
  emissaoAte: string;
  bancoId: string;
  valorDe: string;
  valorAte: string;
}

export const FILTROS_EXTRAS_VAZIOS: FiltrosExtrasBoleto = {
  vencimento: 'todos', vencimentoDe: '', vencimentoAte: '',
  emissao: 'todos', emissaoDe: '', emissaoAte: '',
  bancoId: '', valorDe: '', valorAte: '',
};

/** Quantos dos filtros extras estao valendo (para o selo "Mais filtros (2)"). */
export const contarFiltrosExtras = (f: FiltrosExtrasBoleto): number => [
  f.vencimento !== 'todos',
  f.emissao !== 'todos',
  Boolean(f.bancoId),
  centavosDoFiltroDeValor(f.valorDe) !== null || centavosDoFiltroDeValor(f.valorAte) !== null,
].filter(Boolean).length;

/** O titulo passa nos filtros extras? */
export const tituloPassaNosFiltrosExtras = (
  titulo: {
    dataVencimento?: string;
    dataPrevistaRecebimento?: string;
    valorCentavos: number;
    bancoId?: string;
    boleto?: { dataEmissao?: string; vencimento?: string } | null;
  },
  f: FiltrosExtrasBoleto,
  hoje = getDateInputInTimeZone(),
): boolean => {
  const vencimento = titulo.boleto?.vencimento || titulo.dataVencimento || titulo.dataPrevistaRecebimento || '';
  if (!vencimentoNoPeriodo(vencimento, f.vencimento, { de: f.vencimentoDe, ate: f.vencimentoAte }, hoje)) return false;
  if (!faturadoNoPeriodo(titulo.boleto?.dataEmissao || '', f.emissao, { de: f.emissaoDe, ate: f.emissaoAte }, hoje)) return false;
  if (f.bancoId && titulo.bancoId !== f.bancoId) return false;
  return valorNaFaixa(titulo.valorCentavos, f.valorDe, f.valorAte);
};

// ---------------------------------------------------------------------------
// BOLETO EMITIDO NA HORA, NA TELA DA VENDA (24/11/2026, pedido do dono).
// "Emitir agora" no fim da venda/OS levava para Financeiro > Boletos e a pessoa
// tinha de clicar em emitir de novo. Agora emite ali mesmo: estas funcoes dizem
// QUAIS titulos do documento entram (regra pura; a gravacao e o PDF ficam em
// services/boletoEmissaoService.ts, o mesmo caminho da tela de Boletos).
// ---------------------------------------------------------------------------

export interface TituloDoDocumentoParaBoleto {
  id: string;
  tipo?: unknown;
  formaPagamento?: unknown;
  status?: unknown;
  /** Preenchido = boleto ja' emitido (vai so' para a impressao). */
  boleto?: unknown;
  dataVencimento?: string | null;
  dataPrevistaRecebimento?: string | null;
  paymentIndex?: unknown;
}

/**
 * Dos titulos de uma venda (ou OS), os que sao boleto a receber e ainda estao
 * em aberto: `paraEmitir` (sem boleto) e `jaEmitidos` (so' reimprime). Pago,
 * cancelado, outra forma e conta a pagar ficam de fora. Ordem: vencimento,
 * depois a ordem das parcelas na venda.
 */
export const separarTitulosDeBoletoDoDocumento = <T extends TituloDoDocumentoParaBoleto>(titulos: readonly T[]): { paraEmitir: T[]; jaEmitidos: T[] } => {
  const vencimento = (t: T) => String(t.dataVencimento || t.dataPrevistaRecebimento || '');
  const ordem = (t: T) => (typeof t.paymentIndex === 'number' && Number.isFinite(t.paymentIndex) ? t.paymentIndex : 0);
  const deBoleto = titulos
    .filter((t) => t.formaPagamento === 'Boleto' && t.status === 'Pendente' && (t.tipo === undefined || t.tipo === 'entrada'))
    .sort((a, b) => vencimento(a).localeCompare(vencimento(b)) || ordem(a) - ordem(b) || a.id.localeCompare(b.id));
  return {
    paraEmitir: deBoleto.filter((t) => !t.boleto),
    jaEmitidos: deBoleto.filter((t) => Boolean(t.boleto)),
  };
};

/** Frase do resultado: "Boleto emitido." / "3 boletos emitidos." / "2 de 3 boletos emitidos." */
export const resumoDaEmissaoNaHora = (emitidos: number, pedidos: number): string => {
  if (pedidos <= 0) return 'Os boletos desta venda já estavam emitidos.';
  if (emitidos === pedidos) return pedidos === 1 ? 'Boleto emitido.' : `${pedidos} boletos emitidos.`;
  if (emitidos === 0) return pedidos === 1 ? 'O boleto não foi emitido.' : 'Nenhum boleto foi emitido.';
  return `${emitidos} de ${pedidos} boletos emitidos.`;
};
