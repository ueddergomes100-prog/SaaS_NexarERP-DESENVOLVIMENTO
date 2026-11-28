/*
 * CONTAS A RECEBER EM ABAS (28/11/2026, pedido do dono): "tem que mostrar o
 * que ja' foi recebido do cliente, sem ter que tirar relatorio".
 *
 *  - Aba "Em aberto": o que falta receber (como sempre foi).
 *  - Aba "Geral": tudo o que esta' em aberto + o que foi RECEBIDO no periodo
 *    escolhido (este mes, mes passado, ultimos 90 dias ou outro), com o
 *    recebido e o em aberto de cada cliente lado a lado.
 *
 * O periodo da aba Geral vale para a data em que foi RECEBIDO; os em aberto
 * aparecem todos (divida nao some da tela porque venceu em outro mes).
 */

import { addDaysToDateInput } from './dateTime';
import { dentroDoPeriodo, type SituacaoTitulo } from './filtroListaDomain';

export type AbaReceber = 'abertos' | 'geral';

/** Vencidas sao parte do "Em aberto"; pagas e todas, do "Geral". */
export const abaDaSituacao = (situacao: SituacaoTitulo): AbaReceber => (
  situacao === 'abertas' || situacao === 'vencidas' ? 'abertos' : 'geral'
);

export type PeriodoRecebidos = 'mes' | 'mesPassado' | '90dias';

export const ROTULO_PERIODO_RECEBIDOS: Record<PeriodoRecebidos, string> = {
  mes: 'Este mês',
  mesPassado: 'Mês passado',
  '90dias': 'Últimos 90 dias',
};

/** De/ate (AAAA-MM-DD) do atalho, a partir de hoje. */
export const periodoDosRecebidos = (periodo: PeriodoRecebidos, hoje: string): { de: string; ate: string } => {
  const inicioDoMes = `${hoje.slice(0, 7)}-01`;
  if (periodo === 'mesPassado') {
    const fimDoPassado = addDaysToDateInput(inicioDoMes, -1);
    return { de: `${fimDoPassado.slice(0, 7)}-01`, ate: fimDoPassado };
  }
  if (periodo === '90dias') return { de: addDaysToDateInput(hoje, -89), ate: hoje };
  return { de: inicioDoMes, ate: hoje };
};

/**
 * Qual atalho esta' valendo. Sem datas = este mes (e' o que a tela le por
 * padrao). Datas que nao batem com nenhum atalho = null ("outro periodo").
 */
export const periodoRecebidosAtivo = (de: string, ate: string, hoje: string): PeriodoRecebidos | null => {
  if (!de && !ate) return 'mes';
  return (Object.keys(ROTULO_PERIODO_RECEBIDOS) as PeriodoRecebidos[])
    .find((p) => { const r = periodoDosRecebidos(p, hoje); return r.de === de && r.ate === ate; }) ?? null;
};

export interface TituloDaAba {
  status?: string;
  /** Vencimento, AAAA-MM-DD. */
  data?: string;
  dataPagamento?: string;
}

/** Aba Geral: todo em aberto + recebido dentro do periodo (pela data do recebimento). */
export const passaNaAbaGeral = (titulo: TituloDaAba, de: string, ate: string): boolean => {
  if (titulo.status === 'Pendente') return true;
  if (titulo.status !== 'Paga') return false;
  return dentroDoPeriodo(titulo.dataPagamento || titulo.data, de, ate);
};

export interface ValoresDoTitulo {
  status?: string;
  /** Liquido do titulo, em centavos. */
  liquidoCentavos: number;
  /** Desconto dado na baixa (sai como lancamento proprio), em centavos. */
  descontoCentavos?: number;
}

/** Em aberto e recebido de um cliente (centavos). Recebido = liquido - desconto da baixa. */
export const totaisDoCliente = (titulos: ValoresDoTitulo[]): { emAbertoCentavos: number; recebidoCentavos: number } => (
  titulos.reduce((acc, t) => {
    if (t.status === 'Pendente') acc.emAbertoCentavos += Math.round(t.liquidoCentavos || 0);
    else if (t.status === 'Paga') acc.recebidoCentavos += Math.max(0, Math.round(t.liquidoCentavos || 0) - Math.round(t.descontoCentavos || 0));
    return acc;
  }, { emAbertoCentavos: 0, recebidoCentavos: 0 })
);

/** Quanto do total do cliente (recebido + em aberto) ja' foi recebido, 0 a 100. */
export const percentualQuitado = (totais: { emAbertoCentavos: number; recebidoCentavos: number }): number => {
  const total = totais.emAbertoCentavos + totais.recebidoCentavos;
  return total > 0 ? Math.round((totais.recebidoCentavos / total) * 100) : 0;
};

const normalizar = (texto: unknown): string => String(texto ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('pt-BR').trim().replace(/\s+/g, ' ');

/**
 * BUSCA DO CONTAS A RECEBER (28/11/2026, pedido do dono: "nao da' para buscar
 * pelo cod"). Antes so' achava o codigo digitado EXATAMENTE igual ("457" nao
 * achava "0457"). Agora: nome em qualquer parte (sem ligar para acento e
 * maiuscula) ou codigo pelo comeco, sem ligar para os zeros a esquerda; "#"
 * na frente e' aceito, como nas outras buscas.
 */
export const clienteCasaComBusca = (nome: string, codigo: string, busca: string): boolean => {
  const termo = normalizar(busca).replace(/^#\s*/, '');
  if (!termo) return true;
  if (normalizar(nome).includes(termo)) return true;
  const cod = normalizar(codigo);
  if (!cod) return false;
  if (/^\d+$/.test(termo) && /^\d+$/.test(cod)) {
    const semZeros = (v: string) => v.replace(/^0+(?=\d)/, '');
    return semZeros(cod).startsWith(semZeros(termo));
  }
  return cod.startsWith(termo);
};
