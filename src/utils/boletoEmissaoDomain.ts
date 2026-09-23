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
    return 'Este banco não tem convênio de boleto configurado. Edite o banco em Financeiro → Bancos e preencha a Configuração de Boleto.';
  }
  const faltando: string[] = [];
  if (!convenio.cooperativa?.trim()) faltando.push('cooperativa/agência');
  if (!convenio.conta?.trim()) faltando.push('conta');
  if (faltando.length > 0) {
    return `Complete o convênio de boleto do banco antes de emitir: falta ${faltando.join(', ')}. Edite em Financeiro → Bancos.`;
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
 * RESSALVA: estes codigos (CNAB240) seguem a tabela publica da FEBRABAN e
 * NUNCA foram vistos num arquivo real -- o Sicoob devolve CNAB400, tratado
 * mais abaixo e ja' conferido contra um retorno real (2026-09-23).
 */
const CODIGOS_OCORRENCIA_LIQUIDACAO = new Set(['06', '17']);

export interface LinhaRetornoLida {
  /** So' preenchido quando a linha e' um segmento de titulo (T). */
  nossoNumero?: string;
  codigoOcorrencia?: string;
  /** AAAA-MM-DD. */
  dataOcorrencia?: string;
  valorPagoCentavos?: number;
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

const dataDdmmaaaaParaIso = (ddmmaaaa: string): string => {
  const d = apenasDigitos(ddmmaaaa);
  if (d.length !== 8) return '';
  return `${d.slice(4, 8)}-${d.slice(2, 4)}-${d.slice(0, 2)}`;
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
 * Ocorrencias vistas no arquivo real: 02 = entrada confirmada (149), 06 =
 * liquidacao (34), 11 = titulo em ser/pendente (9) e 04 (4) -- esta ultima
 * vem COM valor pago mas o significado nao esta confirmado, entao NAO da'
 * baixa sozinha: fica em "conferir".
 */
export const CODIGOS_LIQUIDACAO_CNAB400 = new Set(['06']);
const CODIGOS_INFORMATIVOS_CNAB400 = new Set(['02', '11']);

const dataDdmmaaParaIso = (ddmmaa: string): string => {
  const d = apenasDigitos(ddmmaa);
  if (d.length !== 6) return '';
  return `20${d.slice(4, 6)}-${d.slice(2, 4)}-${d.slice(0, 2)}`;
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
export const parseLinhaRetornoSicoob = (linha: string): LinhaRetornoLida => {
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
  const dataOcorrencia = dataDdmmaaaaParaIso(linha.slice(110, 118));
  const valorPagoCentavos = Number.parseInt(linha.slice(81, 96), 10) || 0;

  const reconhecido = CODIGOS_OCORRENCIA_LIQUIDACAO.has(codigoOcorrencia);

  return {
    nossoNumero,
    codigoOcorrencia,
    dataOcorrencia: dataOcorrencia || undefined,
    valorPagoCentavos,
    liquidado: reconhecido,
    ...(reconhecido ? {} : {
      aviso: `Nosso número ${nossoNumero || '(não lido)'}: ocorrência ${codigoOcorrencia || '??'} não é liquidação — confira manualmente antes de dar baixa.`,
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
  const lidas = linhas.map(parseLinhaRetornoSicoob).filter((l) => l.nossoNumero || l.aviso);

  return {
    totalLinhas: linhas.length,
    liquidados: lidas.filter((l) => l.liquidado),
    informativos: lidas.filter((l) => !l.liquidado && l.informativo),
    paraConferir: lidas.filter((l) => !l.liquidado && !l.informativo && l.nossoNumero),
  };
};
