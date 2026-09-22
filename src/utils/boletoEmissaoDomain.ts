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
 * RESSALVA (mesma logica de boletoCnabDomain.ts): estes codigos seguem a
 * tabela publica da FEBRABAN, mas este parser NUNCA foi conferido contra
 * um arquivo de retorno REAL do Sicoob -- so' temos o arquivo de REMESSA
 * real da Sol Life. Antes de confiar na baixa automatica em producao, e'
 * preciso testar com um arquivo de retorno de verdade (homologacao).
 */
const CODIGOS_OCORRENCIA_LIQUIDACAO = new Set(['06', '17']);

export interface LinhaRetornoLida {
  /** So' preenchido quando a linha e' um segmento de titulo (T). */
  nossoNumero?: string;
  codigoOcorrencia?: string;
  /** AAAA-MM-DD. */
  dataOcorrencia?: string;
  valorPagoCentavos?: number;
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
 * Le uma linha de 240 posicoes do arquivo de retorno CNAB240 Sicoob.
 * Devolve `liquidado: false` (com aviso) pra tudo que nao for claramente
 * reconhecido -- inclusive linha maltormada -- porque o risco de NAO dar
 * baixa num titulo pago e' so' um lembrete manual; o risco de dar baixa
 * errada e' dinheiro no lugar errado.
 */
export const parseLinhaRetornoSicoob = (linha: string): LinhaRetornoLida => {
  if (linha.length !== 240) {
    return { liquidado: false, aviso: `Linha com ${linha.length} posições (esperado 240) — ignorada.` };
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
  paraConferir: LinhaRetornoLida[];
}

/** Le o arquivo de retorno inteiro (texto bruto) e separa o que pode virar
 *  baixa automatica do que precisa de conferencia manual. */
export const lerArquivoRetornoSicoob = (conteudo: string): ResumoRetorno => {
  const linhas = conteudo.split(/\r?\n/).filter((l) => l.length > 0);
  const lidas = linhas.map(parseLinhaRetornoSicoob).filter((l) => l.nossoNumero || l.aviso);

  return {
    totalLinhas: linhas.length,
    liquidados: lidas.filter((l) => l.liquidado),
    paraConferir: lidas.filter((l) => !l.liquidado && l.nossoNumero),
  };
};
