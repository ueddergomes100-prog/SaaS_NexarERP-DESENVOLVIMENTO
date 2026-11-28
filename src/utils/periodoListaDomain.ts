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

/*
 * Periodo lembrado por usuario (28/11/2026, pedido do dono): "salvar o ultimo
 * filtro que o usuario escolher ... tem gente que gosta que vem as do dia".
 * So' os periodos que andam com o calendario sao lembrados (Hoje, Ontem,
 * 7 dias, Este mes): eles nunca deixam a lista "presa" num dia antigo.
 * "Todo o periodo" e "Personalizado" NAO sao lembrados -- uma faixa de datas
 * esquecida faria parecer que pedido sumiu (o susto do #0154) e o historico
 * inteiro a cada abertura pesa nas leituras. Os outros filtros de coluna
 * (vendedor, forma, impressao) continuam zerando ao sair da tela.
 */
const PERIODOS_LEMBRADOS: readonly PresetPeriodoLista[] = ['hoje', 'ontem', '7dias', 'mes'];

export const periodoPodeSerLembrado = (preset: PresetPeriodoLista): boolean => PERIODOS_LEMBRADOS.includes(preset);

/** Le o periodo guardado; qualquer coisa estranha volta ao padrao (mes atual). */
export const lerPeriodoLembrado = (salvo: string | null | undefined): PresetPeriodoLista => (
  PERIODOS_LEMBRADOS.find((p) => p === salvo) ?? PERIODO_LISTA_PADRAO
);

export const chavePeriodoLembrado = (tela: string, uid: string): string => `${tela}.periodo.${uid}`;

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

/**
 * Período da lista de notas fiscais (tela NF-e). Abre no mês atual.
 * Hoje, Esta semana e Data personalizada: pedido do cliente de 15/10/2026
 * ("notas emitidas no dia, na semana, data personalizada").
 */
export type PeriodoNotas = 'hoje' | 'semana' | 'mes' | 'mesPassado' | '90dias' | 'tudo' | 'personalizado';

export const PERIODO_NOTAS_PADRAO: PeriodoNotas = 'mes';

/** A ordem das chaves é a ordem do menu. */
export const ROTULO_PERIODO_NOTAS: Record<PeriodoNotas, string> = {
  hoje: 'Hoje',
  semana: 'Esta semana',
  mes: 'Este mês',
  mesPassado: 'Mês passado',
  '90dias': 'Últimos 90 dias',
  tudo: 'Todo o período',
  personalizado: 'Data personalizada',
};

/** Segunda-feira da semana do dia (AAAA-MM-DD): a semana vai de segunda a domingo. */
export const segundaDaSemana = (dia: string): string => {
  const data = parseDateInput(dia);
  if (!data) return dia;
  const diaDaSemana = new Date(`${dia}T12:00:00Z`).getUTCDay(); // 0 = domingo
  return addDaysToDateInput(dia, -((diaDaSemana + 6) % 7));
};

/**
 * Dias (inclusive) do período da lista de notas; null = todo o período.
 * "Data personalizada" segue a mesma regra das outras listas: com uma das
 * datas em branco fica no mês atual; datas invertidas são trocadas.
 */
export const janelaDoPeriodoNotas = (
  periodo: PeriodoNotas,
  hoje: string,
  inicioPersonalizado = '',
  fimPersonalizado = '',
): DiasDoPeriodo | null => {
  const inicioDoMes = `${hoje.slice(0, 7)}-01`;
  switch (periodo) {
    case 'tudo':
      return null;
    case 'hoje':
      return { de: hoje, ate: hoje };
    case 'semana':
      return { de: segundaDaSemana(hoje), ate: hoje };
    case 'personalizado':
      return diasDoPeriodoLista('personalizado', hoje, inicioPersonalizado, fimPersonalizado);
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
