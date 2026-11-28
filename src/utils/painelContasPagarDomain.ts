/*
 * PAINEL DO CONTAS A PAGAR (28/11/2026, pedido do dono: "refazer o designer da
 * tela de contas a pagar... mais bonita, mais legivel, mais facil de entender").
 *
 * Cinco cartoes no topo, cada um tambem e' um atalho de filtro:
 *   Vencidas · Vencem hoje · Esta semana · Em aberto · Pago hoje
 * "Esta semana" usa a mesma semana do atalho da lista (segunda a domingo).
 */

import { intervaloDoAtalhoVencimento, tituloVencido } from './filtroListaDomain';

export interface TituloDoPainel {
  status?: string;
  /** Vencimento AAAA-MM-DD. */
  data?: string;
  valor?: number;
  dataPagamento?: string;
  /** Desconto da baixa (sai como lancamento proprio), em centavos. */
  descontoCentavos?: number;
}

export interface NumeroDoPainel {
  quantidade: number;
  centavos: number;
}

export interface PainelContasPagar {
  vencidas: NumeroDoPainel;
  hoje: NumeroDoPainel;
  semana: NumeroDoPainel;
  emAberto: NumeroDoPainel;
  pagoHoje: NumeroDoPainel;
}

const centavos = (v: unknown) => Math.round((Number(v) || 0) * 100);
const vazio = (): NumeroDoPainel => ({ quantidade: 0, centavos: 0 });
const somar = (n: NumeroDoPainel, c: number) => { n.quantidade += 1; n.centavos += c; };

export const painelDoContasAPagar = (titulos: TituloDoPainel[], hoje: string): PainelContasPagar => {
  const semana = intervaloDoAtalhoVencimento('semana', hoje);
  const painel: PainelContasPagar = { vencidas: vazio(), hoje: vazio(), semana: vazio(), emAberto: vazio(), pagoHoje: vazio() };
  for (const t of titulos) {
    const valor = centavos(t.valor);
    if (t.status === 'Pendente') {
      somar(painel.emAberto, valor);
      if (tituloVencido(t, hoje)) somar(painel.vencidas, valor);
      if (t.data === hoje) somar(painel.hoje, valor);
      if (t.data && t.data >= (semana.de || '') && t.data <= (semana.ate || '9999')) somar(painel.semana, valor);
    } else if (t.status === 'Paga' && t.dataPagamento === hoje) {
      somar(painel.pagoHoje, Math.max(0, valor - Math.round(t.descontoCentavos || 0)));
    }
  }
  return painel;
};
