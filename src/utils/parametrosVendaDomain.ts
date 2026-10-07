/**
 * PARAMETROS DE VENDA POR FILIAL (Configuracoes por filial, fase A --
 * 2026-10-07). Plano em docs/PLANO_CONFIGURACOES_POR_FILIAL.md.
 *
 * Tudo aqui e' CONFIGURAVEL e desligado por padrao: parametro em branco (ou
 * desmarcado) = o sistema se comporta exatamente como antes. Puro -- o
 * servidor usa `maiorAtrasoEmDias` (saldo do cliente no grupo) e as telas
 * usam o resto.
 *
 *  - validade do orcamento: dias sugeridos no orcamento novo (antes: 15 fixo);
 *  - bloqueio por atraso: venda a prazo barrada quando o cliente tem titulo
 *    vencido ha' mais de N dias (+ carencia), em qualquer filial do grupo;
 *  - juros e multa: sugeridos na baixa de um titulo em atraso (a pessoa
 *    ajusta ou tira); viram um lancamento proprio no financeiro;
 *  - prazo de devolucao: devolucao depois de N dias da venda avisa ou bloqueia.
 */
import { differenceInCalendarDays, parseDateInput } from './dateTime';

export type AcaoDevolucaoForaDoPrazo = 'avisar' | 'bloquear';

export interface ParametrosVenda {
  /** Dias de validade sugeridos no orcamento novo. null = o padrao de hoje. */
  validadeOrcamentoDias: number | null;
  bloqueioAtraso: {
    ativo: boolean;
    /** Titulo vencido ha' mais de tantos dias bloqueia a venda a prazo. */
    diasAtraso: number;
    /** Dias de tolerancia alem do atraso (ex.: 5 = so' bloqueia a partir do 6o dia). */
    carenciaDias: number;
  };
  juros: {
    /** Juros ao mes, em %, pro rata por dia de atraso. 0 = nao sugere. */
    aoMesPercentual: number;
    /** Multa fixa sobre o valor do titulo, em %. 0 = nao sugere. */
    multaPercentual: number;
  };
  devolucao: {
    /** Dias desde a venda para aceitar devolucao sem aviso. null = sem prazo. */
    prazoDias: number | null;
    acao: AcaoDevolucaoForaDoPrazo;
  };
}

export const VALIDADE_ORCAMENTO_PADRAO_DIAS = 15;

export const PARAMETROS_VENDA_PADRAO: ParametrosVenda = {
  validadeOrcamentoDias: null,
  bloqueioAtraso: { ativo: false, diasAtraso: 0, carenciaDias: 0 },
  juros: { aoMesPercentual: 0, multaPercentual: 0 },
  devolucao: { prazoDias: null, acao: 'avisar' },
};

/** Mesmas formas que ficam fora do saldo em aberto (cartao e' do banco, nao divida do cliente). */
const FORMAS_FORA_DO_ATRASO = ['Cartão de Crédito', 'Cartão de Débito'];

const inteiroOuNulo = (valor: unknown, minimo: number, maximo: number): number | null => {
  const n = Number(valor);
  if (!Number.isFinite(n)) return null;
  const inteiro = Math.floor(n);
  return inteiro >= minimo && inteiro <= maximo ? inteiro : null;
};

const percentual = (valor: unknown): number => {
  const n = Number(String(valor ?? '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) / 100 : 0;
};

/** Le o que esta gravado em `configuracoes.parametrosVenda` (qualquer coisa estranha vira o padrao). */
export const parseParametrosVenda = (raw: unknown): ParametrosVenda => {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const bloqueio = (r.bloqueioAtraso && typeof r.bloqueioAtraso === 'object' ? r.bloqueioAtraso : {}) as Record<string, unknown>;
  const juros = (r.juros && typeof r.juros === 'object' ? r.juros : {}) as Record<string, unknown>;
  const devolucao = (r.devolucao && typeof r.devolucao === 'object' ? r.devolucao : {}) as Record<string, unknown>;
  return {
    validadeOrcamentoDias: inteiroOuNulo(r.validadeOrcamentoDias, 1, 365),
    bloqueioAtraso: {
      ativo: bloqueio.ativo === true,
      diasAtraso: inteiroOuNulo(bloqueio.diasAtraso, 0, 3650) ?? 0,
      carenciaDias: inteiroOuNulo(bloqueio.carenciaDias, 0, 3650) ?? 0,
    },
    juros: {
      aoMesPercentual: percentual(juros.aoMesPercentual),
      multaPercentual: percentual(juros.multaPercentual),
    },
    devolucao: {
      prazoDias: inteiroOuNulo(devolucao.prazoDias, 1, 3650),
      acao: devolucao.acao === 'bloquear' ? 'bloquear' : 'avisar',
    },
  };
};

// ---------------------------------------------------------------------------
// Formulario (Configuracoes): texto <-> parametros, com validacao em portugues
// ---------------------------------------------------------------------------

export interface ParametrosVendaForm {
  validadeOrcamentoDias: string;
  bloqueioAtrasoAtivo: boolean;
  diasAtraso: string;
  carenciaDias: string;
  jurosAoMes: string;
  multa: string;
  prazoDevolucaoDias: string;
  acaoDevolucao: AcaoDevolucaoForaDoPrazo;
}

export const parametrosVendaParaForm = (p: ParametrosVenda): ParametrosVendaForm => ({
  validadeOrcamentoDias: p.validadeOrcamentoDias === null ? '' : String(p.validadeOrcamentoDias),
  bloqueioAtrasoAtivo: p.bloqueioAtraso.ativo,
  diasAtraso: p.bloqueioAtraso.ativo || p.bloqueioAtraso.diasAtraso > 0 ? String(p.bloqueioAtraso.diasAtraso) : '',
  carenciaDias: p.bloqueioAtraso.carenciaDias > 0 ? String(p.bloqueioAtraso.carenciaDias) : '',
  jurosAoMes: p.juros.aoMesPercentual > 0 ? String(p.juros.aoMesPercentual).replace('.', ',') : '',
  multa: p.juros.multaPercentual > 0 ? String(p.juros.multaPercentual).replace('.', ',') : '',
  prazoDevolucaoDias: p.devolucao.prazoDias === null ? '' : String(p.devolucao.prazoDias),
  acaoDevolucao: p.devolucao.acao,
});

const numeroDoTexto = (texto: string): number | null => {
  const limpo = texto.trim().replace(',', '.');
  if (limpo === '') return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : NaN;
};

/** Valida o formulario. Em branco = padrao; erro em portugues dizendo o campo. */
export const parametrosVendaDoForm = (f: ParametrosVendaForm): { ok: true; parametros: ParametrosVenda } | { ok: false; erro: string } => {
  const validade = numeroDoTexto(f.validadeOrcamentoDias);
  if (validade !== null && (Number.isNaN(validade) || !Number.isInteger(validade) || validade < 1 || validade > 365)) {
    return { ok: false, erro: 'Validade do orçamento: informe um número inteiro de dias entre 1 e 365, ou deixe em branco para usar 15 dias.' };
  }
  const diasAtraso = numeroDoTexto(f.diasAtraso);
  const carencia = numeroDoTexto(f.carenciaDias);
  if (f.bloqueioAtrasoAtivo && (diasAtraso === null || Number.isNaN(diasAtraso) || !Number.isInteger(diasAtraso) || diasAtraso < 0)) {
    return { ok: false, erro: 'Bloqueio por atraso: informe depois de quantos dias de atraso a venda a prazo é barrada (0 = qualquer título vencido).' };
  }
  if (carencia !== null && (Number.isNaN(carencia) || !Number.isInteger(carencia) || carencia < 0)) {
    return { ok: false, erro: 'Bloqueio por atraso: a carência precisa ser um número inteiro de dias (ou em branco).' };
  }
  const juros = numeroDoTexto(f.jurosAoMes);
  if (juros !== null && (Number.isNaN(juros) || juros < 0 || juros > 100)) {
    return { ok: false, erro: 'Juros ao mês: informe um percentual entre 0 e 100 (ex.: 2 ou 1,5), ou deixe em branco.' };
  }
  const multa = numeroDoTexto(f.multa);
  if (multa !== null && (Number.isNaN(multa) || multa < 0 || multa > 100)) {
    return { ok: false, erro: 'Multa por atraso: informe um percentual entre 0 e 100 (ex.: 2), ou deixe em branco.' };
  }
  const prazo = numeroDoTexto(f.prazoDevolucaoDias);
  if (prazo !== null && (Number.isNaN(prazo) || !Number.isInteger(prazo) || prazo < 1 || prazo > 3650)) {
    return { ok: false, erro: 'Prazo para devolução: informe um número inteiro de dias (1 ou mais), ou deixe em branco para não controlar.' };
  }
  return {
    ok: true,
    parametros: {
      validadeOrcamentoDias: validade,
      bloqueioAtraso: { ativo: f.bloqueioAtrasoAtivo, diasAtraso: diasAtraso ?? 0, carenciaDias: carencia ?? 0 },
      juros: { aoMesPercentual: Math.round((juros ?? 0) * 100) / 100, multaPercentual: Math.round((multa ?? 0) * 100) / 100 },
      devolucao: { prazoDias: prazo, acao: f.acaoDevolucao === 'bloquear' ? 'bloquear' : 'avisar' },
    },
  };
};

// ---------------------------------------------------------------------------
// Regras
// ---------------------------------------------------------------------------

export const validadeOrcamentoPadrao = (p: ParametrosVenda): number => p.validadeOrcamentoDias ?? VALIDADE_ORCAMENTO_PADRAO_DIAS;

/** Dias corridos de atraso de um vencimento ('AAAA-MM-DD') em relacao a hoje; 0 se nao venceu ou data invalida. */
export const diasDeAtraso = (dataVencimento: unknown, hoje: string): number => {
  const vencimento = typeof dataVencimento === 'string' ? dataVencimento.slice(0, 10) : '';
  if (!parseDateInput(vencimento) || !parseDateInput(hoje)) return 0;
  return Math.max(0, differenceInCalendarDays(vencimento, hoje) ?? 0);
};

/** Maior atraso entre os titulos pendentes de um cliente (cartao fica fora, como no saldo em aberto). */
export const maiorAtrasoEmDias = (
  titulos: Array<{ status?: unknown; dataVencimento?: unknown; formaPagamento?: unknown }>,
  hoje: string,
): number => titulos.reduce((maior, t) => {
  if (t.status !== 'Pendente') return maior;
  if (FORMAS_FORA_DO_ATRASO.includes(String(t.formaPagamento ?? ''))) return maior;
  return Math.max(maior, diasDeAtraso(t.dataVencimento, hoje));
}, 0);

/** Mensagem que barra a venda a prazo, ou null. */
export const bloqueioPorAtraso = (p: ParametrosVenda, maiorAtrasoDias: number, clienteNome: string): string | null => {
  if (!p.bloqueioAtraso.ativo) return null;
  const limite = p.bloqueioAtraso.diasAtraso + p.bloqueioAtraso.carenciaDias;
  if (maiorAtrasoDias <= 0 || maiorAtrasoDias <= limite) return null;
  const nome = clienteNome.trim() || 'O cliente';
  return `${nome} tem título vencido há ${maiorAtrasoDias} dia${maiorAtrasoDias === 1 ? '' : 's'} e a venda a prazo está bloqueada a partir de ${limite} dia${limite === 1 ? '' : 's'} de atraso (Configurações → Parâmetros de venda). Receba o que está em aberto em Contas a Receber ou venda à vista.`;
};

export interface AcrescimoPorAtraso {
  diasAtraso: number;
  multaCentavos: number;
  jurosCentavos: number;
  totalCentavos: number;
}

/** Juros (pro rata ao dia, sobre o mes de 30 dias) e multa do titulo em atraso; null = nada a sugerir. */
export const acrescimoPorAtraso = (p: ParametrosVenda, valorCentavos: number, dataVencimento: unknown, dataPagamento: string): AcrescimoPorAtraso | null => {
  const valor = Math.max(0, Math.round(Number(valorCentavos) || 0));
  const dias = diasDeAtraso(dataVencimento, dataPagamento);
  if (valor === 0 || dias === 0) return null;
  if (p.juros.aoMesPercentual <= 0 && p.juros.multaPercentual <= 0) return null;
  const multaCentavos = Math.round(valor * p.juros.multaPercentual / 100);
  const jurosCentavos = Math.round(valor * (p.juros.aoMesPercentual / 100) * (dias / 30));
  const totalCentavos = multaCentavos + jurosCentavos;
  return totalCentavos > 0 ? { diasAtraso: dias, multaCentavos, jurosCentavos, totalCentavos } : null;
};

const reais = (centavos: number) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const descricaoDoAcrescimo = (a: AcrescimoPorAtraso): string => {
  const partes: string[] = [];
  if (a.multaCentavos > 0) partes.push(`multa ${reais(a.multaCentavos)}`);
  if (a.jurosCentavos > 0) partes.push(`juros ${reais(a.jurosCentavos)}`);
  return `${a.diasAtraso} dia${a.diasAtraso === 1 ? '' : 's'} de atraso: ${partes.join(' + ')}`;
};

export interface ChecagemPrazoDevolucao {
  diasDesdeAVenda: number;
  foraDoPrazo: boolean;
  acao: AcaoDevolucaoForaDoPrazo;
  mensagem: string;
}

/** Devolucao depois do prazo: avisa ou bloqueia, conforme a filial. Sem prazo ou sem data da venda = dentro do prazo. */
export const checarPrazoDevolucao = (p: ParametrosVenda, dataVenda: unknown, hoje: string): ChecagemPrazoDevolucao => {
  const dentro: ChecagemPrazoDevolucao = { diasDesdeAVenda: 0, foraDoPrazo: false, acao: p.devolucao.acao, mensagem: '' };
  if (p.devolucao.prazoDias === null) return dentro;
  const venda = typeof dataVenda === 'string' ? dataVenda.slice(0, 10) : '';
  if (!parseDateInput(venda) || !parseDateInput(hoje)) return dentro;
  const dias = Math.max(0, differenceInCalendarDays(venda, hoje) ?? 0);
  if (dias <= p.devolucao.prazoDias) return { ...dentro, diasDesdeAVenda: dias };
  const base = `Esta venda foi feita há ${dias} dias e o prazo de devolução da filial é de ${p.devolucao.prazoDias} dia${p.devolucao.prazoDias === 1 ? '' : 's'} (Configurações → Parâmetros de venda).`;
  return {
    diasDesdeAVenda: dias,
    foraDoPrazo: true,
    acao: p.devolucao.acao,
    mensagem: p.devolucao.acao === 'bloquear'
      ? `${base} A devolução não pode ser registrada. Se for um caso especial, o responsável pode aumentar o prazo ou trocar para "avisar" nas Configurações.`
      : `${base} Deseja registrar a devolução mesmo assim?`,
  };
};
