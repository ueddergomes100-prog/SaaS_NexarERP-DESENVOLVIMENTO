/**
 * MENSALIDADES DAS EMPRESAS CLIENTES (24/11/2026, pedido do dono).
 *
 * O dono da plataforma cobra cada empresa que usa o Hennder. O boleto e' gerado
 * a mao no PicPay PJ e anexado aqui (PDF, linha digitavel, link, Pix). Regras
 * decididas pelo dono em 24/11:
 *
 *  - Uma mensalidade por EMPRESA (matriz + filiais juntas). O valor e' o da
 *    matriz somado as filiais (mensalidadeComFiliais, como o SuperAdmin ja'
 *    calculava). Atrasou, o aviso e o bloqueio valem para o grupo todo.
 *  - A mensalidade de cada mes nasce sozinha (rotina diaria do servidor),
 *    `ANTECEDENCIA_DE_GERACAO_DIAS` antes do vencimento; o dono so' anexa o boleto.
 *  - Prazos padrao: lembrete 3 dias antes do vencimento, aviso forte com 5 dias
 *    de atraso, bloqueio no 10o dia de atraso. Padrao geral no SuperAdmin, com
 *    excecao por empresa.
 *  - Avisos so' para dono e administrador da empresa. O bloqueio e' tela
 *    inteira, automatico, em todos os apps (sistema, Frente de Caixa, app
 *    Vendas/tecnico/motorista). O SuperAdmin nunca e' bloqueado.
 *  - Marcar "Pago" (com a data) libera na hora. "Liberar ate dd/mm" adia o
 *    bloqueio sem pagamento; se nao pagar, bloqueia de novo no dia seguinte.
 *
 * ONDE MORA A TRAVA: o servidor grava em TODO perfil da empresa
 * (usuarios/{uid}) o resumo `cobrancaEmpresa` e o instante `cobrancaBloqueioEm`.
 * As firestore.rules (perfilAtivo) e o middleware do servidor (authenticate)
 * recusam tudo a partir desse instante -- sem leitura extra, porque os dois ja'
 * leem o perfil. Esses campos so' o servidor grava (platformManagedFields).
 * A tela so' mostra o aviso e a tela de bloqueio.
 *
 * Datas sao texto "AAAA-MM-DD" no horario de Brasilia (UTC-3, sem horario de
 * verao desde 2019). Este arquivo e' puro: roda na tela e no servidor
 * (server/domain e' gerado dele por scripts/build-server-domain.mjs).
 */

export type SituacaoMensalidade = 'aberta' | 'paga' | 'cancelada';

export interface BoletoDaMensalidade {
  /** Link (com token) do PDF guardado no Storage, em cobranca/{empresa}/... */
  pdfUrl?: string;
  /** Caminho do PDF no Storage (para trocar o arquivo depois). */
  pdfCaminho?: string;
  /** So' os digitos (47 ou 48). */
  linhaDigitavel?: string;
  /** Link de pagamento do PicPay (https). */
  link?: string;
  pixCopiaECola?: string;
}

export interface PrazosCobranca {
  /** Lembrete quantos dias ANTES do vencimento (0 = so' no dia). */
  diasLembreteAntes: number;
  /** Aviso forte a partir de quantos dias de atraso. */
  diasAvisoForte: number;
  /** Bloqueio no N-esimo dia de atraso. */
  diasBloqueio: number;
}

export const PRAZOS_PADRAO: PrazosCobranca = { diasLembreteAntes: 3, diasAvisoForte: 5, diasBloqueio: 10 };

/** A mensalidade do mes nasce 10 dias antes do vencimento (tempo de anexar o boleto antes do lembrete). */
export const ANTECEDENCIA_DE_GERACAO_DIAS = 10;

/** Liberar sem pagamento: no maximo 30 dias para a frente. */
export const LIBERACAO_MAXIMA_DIAS = 30;

export interface ContatoDaCobranca {
  nome?: string;
  whatsapp?: string;
  email?: string;
}

/** Configuracao da cobranca de UMA empresa, em usuarios/{matriz}.planoCobranca (so' o servidor grava). */
export interface PlanoCobranca {
  ativa: boolean;
  diaVencimento: number | null;
  /** Primeira competencia cobrada ("AAAA-MM"): a rotina nunca gera mes anterior a ela. */
  inicioCompetencia: string | null;
  /** Excecao desta empresa; sem ela, o padrao geral. */
  prazos: PrazosCobranca | null;
  /** "Liberar ate" sem pagamento (AAAA-MM-DD). */
  liberadoAte: string | null;
}

export interface MensalidadeLida {
  id: string;
  tenantId: string;
  competencia: string;
  vencimento: string;
  valor: number;
  situacao: SituacaoMensalidade;
  pagoEm: string | null;
  boleto: BoletoDaMensalidade;
}

/** O que vai para cada perfil da empresa (usuarios/{uid}.cobrancaEmpresa). */
export interface ResumoDaCobranca {
  matrizId: string;
  mensalidadeId: string;
  competencia: string;
  vencimento: string;
  /** Soma das mensalidades em aberto. */
  valorEmAberto: number;
  quantidadeEmAberto: number;
  lembreteDesde: string;
  avisoForteDesde: string;
  /** Primeiro dia bloqueado (AAAA-MM-DD). O instante e' 00h00 de Brasilia desse dia. */
  bloqueioEm: string;
  liberadoAte?: string;
  boleto?: BoletoDaMensalidade;
  contato?: ContatoDaCobranca;
}

export type EtapaDaCobranca = 'em_dia' | 'lembrete' | 'vence_hoje' | 'atrasada' | 'aviso_forte' | 'liberada' | 'bloqueada';

export interface SituacaoDaCobranca {
  etapa: EtapaDaCobranca;
  /** Dias desde o vencimento (0 se nao venceu). */
  diasDeAtraso: number;
  /** Dias ate' vencer (0 se ja' venceu). */
  diasParaVencer: number;
  /** Dias ate' o bloqueio (0 se ja' bloqueou). */
  diasParaBloqueio: number;
}

// ---------------------------------------------------------------- datas

const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const COMPETENCIA = /^(\d{4})-(\d{2})$/;

const dataUtc = (iso: string): Date | null => {
  const m = DATA.exec(iso);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === iso ? d : null;
};

export const dataValida = (valor: unknown): valor is string => typeof valor === 'string' && dataUtc(valor) !== null;

export const competenciaValida = (valor: unknown): valor is string => {
  if (typeof valor !== 'string') return false;
  const m = COMPETENCIA.exec(valor);
  return Boolean(m) && Number(m![2]) >= 1 && Number(m![2]) <= 12;
};

/** Hoje em Brasilia, AAAA-MM-DD. */
export const hojeEmBrasilia = (agora: Date = new Date()): string => (
  new Date(agora.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
);

export const somarDias = (iso: string, dias: number): string => {
  const d = dataUtc(iso);
  if (!d) return iso;
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

/** b - a, em dias. */
export const diasEntre = (a: string, b: string): number => {
  const da = dataUtc(a);
  const db = dataUtc(b);
  if (!da || !db) return 0;
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
};

/** 00h00 de Brasilia do dia (03h00 UTC). E' o instante gravado em cobrancaBloqueioEm. */
export const inicioDoDiaEmBrasilia = (iso: string): Date => new Date(`${iso}T03:00:00.000Z`);

export const competenciaDaData = (iso: string): string => iso.slice(0, 7);

export const competenciaSeguinte = (competencia: string): string => {
  const [ano, mes] = competencia.split('-').map(Number);
  return mes === 12 ? `${ano + 1}-01` : `${ano}-${String(mes + 1).padStart(2, '0')}`;
};

/** Vencimento do mes: o dia escolhido, ou o ultimo dia quando o mes e' mais curto (31 em fevereiro = 28/29). */
export const vencimentoDaCompetencia = (competencia: string, dia: number): string => {
  const [ano, mes] = competencia.split('-').map(Number);
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${competencia}-${String(Math.min(Math.max(1, Math.trunc(dia)), ultimo)).padStart(2, '0')}`;
};

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export const rotuloCompetencia = (competencia: string): string => {
  if (!competenciaValida(competencia)) return competencia;
  const [ano, mes] = competencia.split('-').map(Number);
  return `${MESES[mes - 1]}/${ano}`;
};

export const formatarData = (iso: string | null | undefined): string => {
  if (!iso || !dataValida(iso)) return '';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
};

export const formatarDiaMes = (iso: string | null | undefined): string => formatarData(iso).slice(0, 5);

export const formatarMoeda = (valor: number): string => (
  `R$ ${(Math.round((Number(valor) || 0) * 100) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
);

export const idDaMensalidade = (tenantId: string, competencia: string): string => `${tenantId}_${competencia}`;

// ---------------------------------------------------------------- leitura

const texto = (v: unknown, max = 500): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const inteiro = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isInteger(n) ? n : null;
};

/** Dia de vencimento 1..31, ou null. */
export const lerDiaVencimento = (valor: unknown): number | null => {
  const n = inteiro(valor);
  return n !== null && n >= 1 && n <= 31 ? n : null;
};

/** Confere os prazos. Devolve a mensagem em portugues, ou null quando estao certos. */
export const validarPrazos = (p: PrazosCobranca): string | null => {
  if (!Number.isInteger(p.diasLembreteAntes) || p.diasLembreteAntes < 0 || p.diasLembreteAntes > 15) {
    return 'O lembrete antes do vencimento vai de 0 a 15 dias.';
  }
  if (!Number.isInteger(p.diasAvisoForte) || p.diasAvisoForte < 1 || p.diasAvisoForte > 60) {
    return 'O aviso forte vai de 1 a 60 dias de atraso.';
  }
  if (!Number.isInteger(p.diasBloqueio) || p.diasBloqueio < 1 || p.diasBloqueio > 90) {
    return 'O bloqueio vai de 1 a 90 dias de atraso.';
  }
  if (p.diasAvisoForte > p.diasBloqueio) {
    return 'O aviso forte precisa vir antes do bloqueio (ou no mesmo dia).';
  }
  return null;
};

/** Prazos gravados; o que faltar ou vier errado cai no padrao informado. */
export const lerPrazos = (valor: unknown, padrao: PrazosCobranca = PRAZOS_PADRAO): PrazosCobranca => {
  const v = (valor && typeof valor === 'object' ? valor : {}) as Record<string, unknown>;
  const p: PrazosCobranca = {
    diasLembreteAntes: inteiro(v.diasLembreteAntes) ?? padrao.diasLembreteAntes,
    diasAvisoForte: inteiro(v.diasAvisoForte) ?? padrao.diasAvisoForte,
    diasBloqueio: inteiro(v.diasBloqueio) ?? padrao.diasBloqueio,
  };
  return validarPrazos(p) ? { ...padrao } : p;
};

export const lerPlanoCobranca = (valor: unknown): PlanoCobranca => {
  const v = (valor && typeof valor === 'object' ? valor : {}) as Record<string, unknown>;
  const prazos = v.prazos && typeof v.prazos === 'object' ? lerPrazos(v.prazos) : null;
  return {
    ativa: v.ativa === true,
    diaVencimento: lerDiaVencimento(v.diaVencimento),
    inicioCompetencia: competenciaValida(v.inicioCompetencia) ? v.inicioCompetencia : null,
    prazos,
    liberadoAte: dataValida(v.liberadoAte) ? v.liberadoAte : null,
  };
};

export const lerContato = (valor: unknown): ContatoDaCobranca => {
  const v = (valor && typeof valor === 'object' ? valor : {}) as Record<string, unknown>;
  const contato: ContatoDaCobranca = {};
  const nome = texto(v.nome, 80);
  const whatsapp = texto(v.whatsapp, 30).replace(/\D/g, '');
  const email = texto(v.email, 120).toLowerCase();
  if (nome) contato.nome = nome;
  if (whatsapp.length >= 10) contato.whatsapp = whatsapp;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) contato.email = email;
  return contato;
};

/** So' as chaves preenchidas (nunca undefined no Firestore). */
export const lerBoleto = (valor: unknown): BoletoDaMensalidade => {
  const v = (valor && typeof valor === 'object' ? valor : {}) as Record<string, unknown>;
  const boleto: BoletoDaMensalidade = {};
  const pdfUrl = texto(v.pdfUrl, 2000);
  const pdfCaminho = texto(v.pdfCaminho, 500);
  const linha = normalizarLinhaDigitavel(v.linhaDigitavel);
  const link = texto(v.link, 1000);
  const pix = texto(v.pixCopiaECola, 1000);
  if (/^https:\/\//.test(pdfUrl)) boleto.pdfUrl = pdfUrl;
  if (pdfCaminho) boleto.pdfCaminho = pdfCaminho;
  if (linha) boleto.linhaDigitavel = linha;
  if (/^https:\/\//.test(link)) boleto.link = link;
  if (pix) boleto.pixCopiaECola = pix;
  return boleto;
};

export const temBoleto = (b: BoletoDaMensalidade | null | undefined): boolean => Boolean(
  b && (b.pdfUrl || b.linhaDigitavel || b.link || b.pixCopiaECola),
);

export const lerMensalidade = (id: string, dados: unknown): MensalidadeLida => {
  const v = (dados && typeof dados === 'object' ? dados : {}) as Record<string, unknown>;
  const situacao = v.situacao === 'paga' || v.situacao === 'cancelada' ? v.situacao : 'aberta';
  return {
    id,
    tenantId: texto(v.tenantId, 200),
    competencia: competenciaValida(v.competencia) ? v.competencia : '',
    vencimento: dataValida(v.vencimento) ? v.vencimento : '',
    valor: Math.round((Number(v.valor) || 0) * 100) / 100,
    situacao,
    pagoEm: dataValida(v.pagoEm) ? v.pagoEm : null,
    boleto: lerBoleto(v.boleto),
  };
};

// ---------------------------------------------------------------- boleto

/** So' os digitos; aceita linha de boleto (47) ou de concessionaria (48). Outra quantidade = ''. */
export function normalizarLinhaDigitavel(valor: unknown): string {
  const digitos = typeof valor === 'string' ? valor.replace(/\D/g, '') : '';
  return digitos.length === 47 || digitos.length === 48 ? digitos : '';
}

/** 47 digitos no formato do banco: 00000.00000 00000.000000 00000.000000 0 00000000000000. */
export const formatarLinhaDigitavel = (digitos: string): string => {
  if (digitos.length !== 47) return digitos;
  return `${digitos.slice(0, 5)}.${digitos.slice(5, 10)} ${digitos.slice(10, 15)}.${digitos.slice(15, 21)} `
    + `${digitos.slice(21, 26)}.${digitos.slice(26, 32)} ${digitos.slice(32, 33)} ${digitos.slice(33)}`;
};

export interface BoletoDigitado {
  pdfUrl?: string;
  pdfCaminho?: string;
  linhaDigitavel?: string;
  link?: string;
  pixCopiaECola?: string;
}

/** Confere o que o dono anexou. Basta um (PDF, linha, link ou Pix). */
export const validarBoletoDigitado = (b: BoletoDigitado): { boleto: BoletoDaMensalidade } | { erro: string } => {
  const linhaBruta = (b.linhaDigitavel || '').replace(/\D/g, '');
  if (linhaBruta && !normalizarLinhaDigitavel(linhaBruta)) {
    return { erro: `A linha digitável tem ${linhaBruta.length} números; o boleto tem 47. Copie de novo do PicPay.` };
  }
  const link = (b.link || '').trim();
  if (link && !/^https:\/\//.test(link)) {
    return { erro: 'O link de pagamento precisa começar com https://. Copie o link inteiro do PicPay.' };
  }
  const boleto = lerBoleto(b);
  if (!temBoleto(boleto)) {
    return { erro: 'Anexe o PDF do boleto ou cole a linha digitável (o link e o Pix são opcionais).' };
  }
  return { boleto };
};

// ---------------------------------------------------------------- geracao do mes

/**
 * Competencias que a rotina deve criar hoje: a partir do inicio da cobranca,
 * cada mes cujo vencimento ja' esta' a ANTECEDENCIA_DE_GERACAO_DIAS (ou menos)
 * e que ainda nao existe. No maximo 3 por vez (nunca despeja um ano de atraso).
 */
export const competenciasParaGerar = (params: {
  hoje: string;
  plano: PlanoCobranca;
  existentes: string[];
}): string[] => {
  const { hoje, plano, existentes } = params;
  if (!plano.ativa || !plano.diaVencimento || !plano.inicioCompetencia || !dataValida(hoje)) return [];
  const limite = somarDias(hoje, ANTECEDENCIA_DE_GERACAO_DIAS);
  const lista: string[] = [];
  let competencia = plano.inicioCompetencia;
  for (let i = 0; i < 120 && lista.length < 3; i += 1) {
    const vencimento = vencimentoDaCompetencia(competencia, plano.diaVencimento);
    if (vencimento > limite) break;
    if (!existentes.includes(competencia)) lista.push(competencia);
    competencia = competenciaSeguinte(competencia);
  }
  return lista;
};

/** Primeira competencia ao ligar a cobranca: o proximo vencimento a partir de hoje. */
export const primeiraCompetencia = (hoje: string, diaVencimento: number): string => {
  const doMes = competenciaDaData(hoje);
  return vencimentoDaCompetencia(doMes, diaVencimento) >= hoje ? doMes : competenciaSeguinte(doMes);
};

// ---------------------------------------------------------------- resumo e etapa

/**
 * Resumo gravado nos perfis da empresa. A data que manda e' a da mensalidade
 * aberta MAIS ANTIGA. Sem mensalidade aberta, null (os campos saem do perfil).
 */
export const montarResumoDaCobranca = (params: {
  matrizId: string;
  abertas: MensalidadeLida[];
  prazos: PrazosCobranca;
  liberadoAte: string | null;
  contato?: ContatoDaCobranca;
}): ResumoDaCobranca | null => {
  const abertas = params.abertas
    .filter((m) => m.situacao === 'aberta' && dataValida(m.vencimento))
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  if (!abertas.length) return null;
  const maisAntiga = abertas[0];
  const { prazos } = params;
  const bloqueioNormal = somarDias(maisAntiga.vencimento, prazos.diasBloqueio);
  const liberadoAte = params.liberadoAte && params.liberadoAte >= bloqueioNormal ? params.liberadoAte : null;
  const resumo: ResumoDaCobranca = {
    matrizId: params.matrizId,
    mensalidadeId: maisAntiga.id,
    competencia: maisAntiga.competencia,
    vencimento: maisAntiga.vencimento,
    valorEmAberto: Math.round(abertas.reduce((s, m) => s + m.valor, 0) * 100) / 100,
    quantidadeEmAberto: abertas.length,
    lembreteDesde: somarDias(maisAntiga.vencimento, -prazos.diasLembreteAntes),
    avisoForteDesde: somarDias(maisAntiga.vencimento, prazos.diasAvisoForte),
    bloqueioEm: liberadoAte ? somarDias(liberadoAte, 1) : bloqueioNormal,
  };
  if (liberadoAte) resumo.liberadoAte = liberadoAte;
  if (temBoleto(maisAntiga.boleto)) {
    // O caminho no Storage nao interessa a empresa.
    const semCaminho: BoletoDaMensalidade = { ...maisAntiga.boleto };
    delete semCaminho.pdfCaminho;
    resumo.boleto = semCaminho;
  }
  if (params.contato && Object.keys(params.contato).length) resumo.contato = params.contato;
  return resumo;
};

/** Le o resumo gravado no perfil (tela). Qualquer coisa fora do formato = sem cobranca pendente. */
export const lerResumoDaCobranca = (valor: unknown): ResumoDaCobranca | null => {
  const v = (valor && typeof valor === 'object' ? valor : null) as Record<string, unknown> | null;
  if (!v) return null;
  const campos = ['vencimento', 'lembreteDesde', 'avisoForteDesde', 'bloqueioEm'] as const;
  if (!campos.every((c) => dataValida(v[c]))) return null;
  const resumo: ResumoDaCobranca = {
    matrizId: texto(v.matrizId, 200),
    mensalidadeId: texto(v.mensalidadeId, 300),
    competencia: competenciaValida(v.competencia) ? v.competencia : '',
    vencimento: v.vencimento as string,
    valorEmAberto: Math.round((Number(v.valorEmAberto) || 0) * 100) / 100,
    quantidadeEmAberto: Math.max(1, inteiro(v.quantidadeEmAberto) ?? 1),
    lembreteDesde: v.lembreteDesde as string,
    avisoForteDesde: v.avisoForteDesde as string,
    bloqueioEm: v.bloqueioEm as string,
  };
  if (dataValida(v.liberadoAte)) resumo.liberadoAte = v.liberadoAte;
  const boleto = lerBoleto(v.boleto);
  if (temBoleto(boleto)) resumo.boleto = boleto;
  const contato = lerContato(v.contato);
  if (Object.keys(contato).length) resumo.contato = contato;
  return resumo;
};

export const situacaoDaCobranca = (resumo: ResumoDaCobranca | null, hoje: string): SituacaoDaCobranca => {
  if (!resumo) return { etapa: 'em_dia', diasDeAtraso: 0, diasParaVencer: 0, diasParaBloqueio: 0 };
  const diasDeAtraso = Math.max(0, diasEntre(resumo.vencimento, hoje));
  const diasParaVencer = Math.max(0, diasEntre(hoje, resumo.vencimento));
  const diasParaBloqueio = Math.max(0, diasEntre(hoje, resumo.bloqueioEm));
  const base = { diasDeAtraso, diasParaVencer, diasParaBloqueio };
  if (hoje >= resumo.bloqueioEm) return { etapa: 'bloqueada', ...base };
  if (resumo.liberadoAte && hoje > resumo.vencimento) return { etapa: 'liberada', ...base };
  if (hoje >= resumo.avisoForteDesde && hoje > resumo.vencimento) return { etapa: 'aviso_forte', ...base };
  if (hoje > resumo.vencimento) return { etapa: 'atrasada', ...base };
  if (hoje === resumo.vencimento) return { etapa: 'vence_hoje', ...base };
  if (hoje >= resumo.lembreteDesde) return { etapa: 'lembrete', ...base };
  return { etapa: 'em_dia', ...base };
};

/** So' dono e administrador da empresa veem o aviso antes do bloqueio (decisao de 24/11). */
export const veAvisoDeCobranca = (role: string | null | undefined): boolean => role === 'Master' || role === 'Admin';

export const etapaComAviso = (etapa: EtapaDaCobranca): boolean => etapa !== 'em_dia' && etapa !== 'bloqueada';

/** Janela 1x por dia (como a de aniversario): so' com aviso e se ainda nao abriu hoje. */
export const deveAbrirJanelaDeCobranca = (ultimoDiaAvisado: string, hoje: string, etapa: EtapaDaCobranca): boolean => (
  etapaComAviso(etapa) && etapa !== 'em_dia' && ultimoDiaAvisado !== hoje
);

export type TomDoAviso = 'info' | 'alerta' | 'perigo';

export interface TextoDoAviso {
  titulo: string;
  texto: string;
  tom: TomDoAviso;
}

const emDias = (n: number): string => (n === 1 ? 'amanhã' : `em ${n} dias`);
const haDias = (n: number): string => (n === 1 ? 'há 1 dia' : `há ${n} dias`);

/** O que fazer, conforme o que o suporte anexou (nunca manda imprimir sem PDF). */
export const comoPagarOBoleto = (boleto: BoletoDaMensalidade | undefined): string => {
  if (!boleto || !temBoleto(boleto)) return 'O boleto ainda não foi anexado: fale com o suporte para recebê-lo.';
  const jeitos = [
    boleto.pdfUrl && 'imprima o boleto',
    boleto.linhaDigitavel && 'copie a linha digitável',
    boleto.link && 'pague pelo link',
    boleto.pixCopiaECola && 'pague pelo Pix',
  ].filter(Boolean) as string[];
  const frase = jeitos.length > 1 ? `${jeitos.slice(0, -1).join(', ')} ou ${jeitos[jeitos.length - 1]}` : jeitos[0];
  return `${frase.charAt(0).toUpperCase()}${frase.slice(1)}.`;
};

/** Texto do aviso, para quem paga (dono/administrador). */
export const textoDoAviso = (resumo: ResumoDaCobranca, s: SituacaoDaCobranca): TextoDoAviso => {
  const valor = formatarMoeda(resumo.valorEmAberto);
  const venc = formatarData(resumo.vencimento);
  const bloqueio = formatarData(resumo.bloqueioEm);
  const comoPagar = comoPagarOBoleto(resumo.boleto);
  const maisDeUma = resumo.quantidadeEmAberto > 1 ? ` (${resumo.quantidadeEmAberto} mensalidades em aberto)` : '';
  switch (s.etapa) {
    case 'lembrete':
      return { tom: 'info', titulo: 'Mensalidade vencendo', texto: `Sua mensalidade de ${valor} vence ${emDias(s.diasParaVencer)}, em ${venc}. ${comoPagar}` };
    case 'vence_hoje':
      return { tom: 'alerta', titulo: 'Mensalidade vence hoje', texto: `Sua mensalidade de ${valor} vence hoje (${venc}). ${comoPagar}` };
    case 'atrasada':
      return { tom: 'alerta', titulo: 'Mensalidade em atraso', texto: `Sua mensalidade de ${valor}${maisDeUma} venceu em ${venc} (${haDias(s.diasDeAtraso)}). Pague para evitar o bloqueio do sistema em ${bloqueio}. ${comoPagar}` };
    case 'aviso_forte':
      return { tom: 'perigo', titulo: 'O sistema será bloqueado', texto: `Sua mensalidade de ${valor}${maisDeUma} está em atraso ${haDias(s.diasDeAtraso)}. O sistema será bloqueado ${emDias(s.diasParaBloqueio)}, em ${bloqueio}, se o pagamento não for registrado. ${comoPagar}` };
    case 'liberada':
      return { tom: 'perigo', titulo: 'Acesso liberado por prazo', texto: `Seu acesso foi liberado até ${formatarData(resumo.liberadoAte)}. A mensalidade de ${valor} venceu em ${venc}: pague antes de ${bloqueio} para o sistema não bloquear. ${comoPagar}` };
    case 'bloqueada':
      return { tom: 'perigo', titulo: 'Sistema bloqueado', texto: `O sistema foi bloqueado porque a mensalidade de ${valor}${maisDeUma}, vencida em ${venc}, não foi paga. Pague pelo boleto abaixo e envie o comprovante ao suporte para liberar.` };
    default:
      return { tom: 'info', titulo: 'Mensalidade em dia', texto: 'Não há mensalidade em aberto.' };
  }
};

/** Texto da tela de bloqueio para quem NAO paga (funcionario, vendedor, caixa). */
export const TEXTO_BLOQUEIO_FUNCIONARIO = 'O sistema desta empresa está bloqueado por mensalidade em atraso. Avise o dono ou o administrador da empresa: assim que o pagamento for registrado, o acesso volta.';

/** Mensagem do servidor/rules ao recusar (mesmo texto nos dois lados). */
export const MENSAGEM_SERVIDOR_BLOQUEADO = 'O sistema desta empresa está bloqueado por mensalidade em atraso. O dono ou o administrador vê o boleto ao entrar no sistema; depois do pagamento, fale com o suporte para liberar.';

/** Texto da cobranca (WhatsApp e corpo do e-mail), em nome do Hennder ERP. */
export const textoDaCobranca = (params: {
  empresa: string;
  competencia: string;
  vencimento: string;
  valor: number;
  boleto: BoletoDaMensalidade;
}): { assunto: string; texto: string } => {
  const { empresa, competencia, vencimento, valor, boleto } = params;
  const linhas = [
    `Olá${empresa ? `, ${empresa}` : ''}!`,
    `Segue a mensalidade do Hennder ERP de ${rotuloCompetencia(competencia)}: ${formatarMoeda(valor)}, vencimento em ${formatarData(vencimento)}.`,
  ];
  if (boleto.pdfUrl) linhas.push(`Boleto (PDF): ${boleto.pdfUrl}`);
  if (boleto.linhaDigitavel) linhas.push(`Linha digitável: ${formatarLinhaDigitavel(boleto.linhaDigitavel)}`);
  if (boleto.link) linhas.push(`Pagar pelo link: ${boleto.link}`);
  if (boleto.pixCopiaECola) linhas.push(`Pix copia e cola: ${boleto.pixCopiaECola}`);
  linhas.push('O boleto também fica no sistema, para o dono e o administrador imprimirem. Se já pagou, desconsidere esta mensagem.');
  return {
    assunto: `Mensalidade Hennder ERP - ${rotuloCompetencia(competencia)} - vence ${formatarData(vencimento)}`,
    texto: linhas.join('\n'),
  };
};

/** Data do pagamento: valida e nao pode ser futura. */
export const validarDataDoPagamento = (pagoEm: unknown, hoje: string): string | null => {
  if (!dataValida(pagoEm)) return 'Informe a data do pagamento.';
  if (pagoEm > hoje) return 'A data do pagamento não pode ser depois de hoje.';
  return null;
};

/** "Liberar ate": de hoje ate' LIBERACAO_MAXIMA_DIAS. */
export const validarLiberacao = (ate: unknown, hoje: string): string | null => {
  if (!dataValida(ate)) return 'Informe até que dia o acesso fica liberado.';
  if (ate < hoje) return 'A data da liberação não pode ser antes de hoje.';
  if (ate > somarDias(hoje, LIBERACAO_MAXIMA_DIAS)) return `A liberação vai no máximo até ${LIBERACAO_MAXIMA_DIAS} dias a partir de hoje.`;
  return null;
};

/** Rotulo curto da situacao, para a lista do SuperAdmin. */
export const rotuloDaEtapa = (s: SituacaoDaCobranca): string => {
  switch (s.etapa) {
    case 'lembrete': return `Vence ${emDias(s.diasParaVencer)}`;
    case 'vence_hoje': return 'Vence hoje';
    case 'atrasada': return `Atrasada ${haDias(s.diasDeAtraso)}`;
    case 'aviso_forte': return `Atrasada ${haDias(s.diasDeAtraso)}, bloqueia ${emDias(s.diasParaBloqueio)}`;
    case 'liberada': return `Liberada (atrasada ${haDias(s.diasDeAtraso)})`;
    case 'bloqueada': return 'Bloqueada';
    default: return 'Em dia';
  }
};
