import { addDaysToDateInput, parseDateInput } from './dateTime';

/**
 * PERÍODO DAS LISTAS DE HISTÓRICO — regra pura (otimização de leituras,
 * 2026-10-14).
 *
 * As listas (Pedidos de Venda, OS, notas...) liam o histórico inteiro da
 * empresa a cada abertura e filtravam o período no navegador. Agora o período
 * vai para a CONSULTA: o banco devolve só os dias pedidos.
 *
 * Decisão do dono (14/10): a lista abre no MÊS ATUAL; "Todas" continua
 * existindo e lê tudo (é pedido explícito de quem quer ver o histórico). O que
 * está PENDENTE (pré-venda, OS em andamento, título em aberto) não passa por
 * aqui — sai por status, de qualquer data.
 */

export type PresetPeriodoLista = '' | 'hoje' | 'ontem' | '7dias' | 'mes' | 'personalizado';

export const PERIODO_LISTA_PADRAO: PresetPeriodoLista = 'mes';

export interface DiasDoPeriodo {
  /** Primeiro dia, AAAA-MM-DD (inclusive). */
  de: string;
  /** Último dia, AAAA-MM-DD (inclusive). */
  ate: string;
}

/**
 * Dias que a consulta deve pedir ao banco para o filtro escolhido; null = todo
 * o período (sem corte). "Personalizado" com uma das datas em branco fica no
 * mês atual enquanto a pessoa preenche — não dispara uma leitura do histórico
 * inteiro só porque o campo ainda está vazio. Datas invertidas são trocadas.
 */
export const diasDoPeriodoLista = (
  preset: PresetPeriodoLista,
  hoje: string,
  inicioPersonalizado = '',
  fimPersonalizado = '',
): DiasDoPeriodo | null => {
  const inicioDoMes = `${hoje.slice(0, 7)}-01`;
  switch (preset) {
    case '':
      return null;
    case 'hoje':
      return { de: hoje, ate: hoje };
    case 'ontem': {
      const ontem = addDaysToDateInput(hoje, -1);
      return { de: ontem, ate: ontem };
    }
    case '7dias':
      return { de: addDaysToDateInput(hoje, -6), ate: hoje };
    case 'personalizado': {
      if (!parseDateInput(inicioPersonalizado) || !parseDateInput(fimPersonalizado)) return { de: inicioDoMes, ate: hoje };
      return inicioPersonalizado <= fimPersonalizado
        ? { de: inicioPersonalizado, ate: fimPersonalizado }
        : { de: fimPersonalizado, ate: inicioPersonalizado };
    }
    case 'mes':
    default:
      return { de: inicioDoMes, ate: hoje };
  }
};

/** Período da lista de notas fiscais (tela NF-e). Abre no mês atual. */
export type PeriodoNotas = 'mes' | 'mesPassado' | '90dias' | 'tudo';

export const PERIODO_NOTAS_PADRAO: PeriodoNotas = 'mes';

export const ROTULO_PERIODO_NOTAS: Record<PeriodoNotas, string> = {
  mes: 'Este mês',
  mesPassado: 'Mês passado',
  '90dias': 'Últimos 90 dias',
  tudo: 'Todo o período',
};

/** Dias (inclusive) do período da lista de notas; null = todo o período. */
export const janelaDoPeriodoNotas = (periodo: PeriodoNotas, hoje: string): DiasDoPeriodo | null => {
  const inicioDoMes = `${hoje.slice(0, 7)}-01`;
  switch (periodo) {
    case 'tudo':
      return null;
    case 'mesPassado': {
      const fimDoMesPassado = addDaysToDateInput(inicioDoMes, -1);
      return { de: `${fimDoMesPassado.slice(0, 7)}-01`, ate: fimDoMesPassado };
    }
    case '90dias':
      return { de: addDaysToDateInput(hoje, -89), ate: hoje };
    case 'mes':
    default:
      return { de: inicioDoMes, ate: hoje };
  }
};
