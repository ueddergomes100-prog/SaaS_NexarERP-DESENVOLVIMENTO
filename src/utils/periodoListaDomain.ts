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
