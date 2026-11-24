import { chamarServidor } from './apiServidor';
import type { ContaRef } from '../utils/contasDinheiroDomain';
import type { ComposicaoDaGaveta } from '../utils/gavetaDinheiroDomain';

/**
 * CAIXAS E TRANSFERENCIAS (21/10/2026) -- cliente HTTP de server/services/caixas.js
 * e das situacoes do cheque (server/services/chequeSituacao.js). Regra em
 * src/utils/contasDinheiroDomain.ts.
 */

export interface CaixaResumo {
  id: string;
  tipo: 'caixa';
  nome: string;
  descricao: string;
  saldoCentavos: number;
  saldoInicialCentavos: number;
  ativo: boolean;
  padrao: boolean;
  /** Chave "dinheiro das vendas na gaveta" ligada: o saldo ja' soma vendas, sangrias e fechamento. */
  recebeDinheiroDasVendas?: boolean;
}

/** Saldo da gaveta para conferir o fechamento do PDV (utils/gavetaDinheiroDomain.ts). */
export interface ResumoDaGaveta {
  ativo: boolean;
  desde: string;
  caixaId: string;
  caixaNome: string;
  saldoCentavos: number | null;
  caixasAbertos: number;
  /** Dia pedido em `?ate=` (vazio = agora). */
  ate?: string;
}

/** O que compoe o saldo da gaveta, dia a dia (24/11/2026). */
export type ComposicaoDaGavetaApi = { ativo: false } | ({ ativo: true; caixaNome: string; desde: string } & ComposicaoDaGaveta);

export interface BancoResumo {
  id: string;
  tipo: 'banco';
  nome: string;
  saldoCentavos: number;
}

export interface LancamentoDoCaixa {
  id: string;
  tipo: string;
  direcao: 'credito' | 'debito';
  valorCentavos: number;
  descricao: string;
  data: string;
  criadoEmIso: string;
}

export const listarCaixasEBancos = () => (
  chamarServidor<{ caixas: CaixaResumo[]; bancos: BancoResumo[]; gaveta?: { ativo: boolean; desde: string } }>('GET', 'caixas')
);

/** `ate` (yyyy-mm-dd, antes de hoje): o saldo no fim daquele dia. */
export const resumoDaGaveta = (ate = '') => chamarServidor<ResumoDaGaveta>('GET', ate ? `caixas/gaveta?ate=${encodeURIComponent(ate)}` : 'caixas/gaveta', undefined, {
  falhou: 'Não foi possível consultar o saldo da gaveta para conferir o fechamento. Confira a internet e tente de novo.',
});

export const composicaoDaGaveta = () => chamarServidor<ComposicaoDaGavetaApi>('GET', 'caixas/gaveta/composicao', undefined, {
  falhou: 'Não foi possível montar o que compõe o saldo da gaveta. Confira a internet e tente de novo.',
});

/** Fechamento: o contado menos o troco vai para o COFRE (uma vez so' por caixa). */
export const mandarAoCofreNoFechamento = (corpo: { sessaoId: string; trocoCentavos: number }) => (
  chamarServidor<{ ok: true; jaFeito: boolean; valorCentavos: number; trocoCentavos: number; cofreNome: string }>('POST', 'caixas/gaveta/cofre', { ...corpo })
);

/** "Fechar o caixa de ontem": conta o que ficou de um dia que ja' passou. */
export const acertarDiaDaGaveta = (corpo: { data: string; contadoCentavos: number; trocoCentavos: number }) => (
  chamarServidor<{
    ok: true; data: string; saldoDoSistemaCentavos: number; contadoCentavos: number; trocoCentavos: number;
    diferencaCentavos: number; paraCofreCentavos: number; caixaNome: string; cofreNome: string;
  }>('POST', 'caixas/gaveta/acerto', { ...corpo })
);

export const salvarCaixa = (corpo: { nome: string; descricao: string; saldoInicialCentavos?: number; ativo: boolean }, id?: string) => (
  chamarServidor<{ ok: true; id: string; nome: string }>('POST', id ? `caixas/${encodeURIComponent(id)}` : 'caixas', { ...corpo })
);

/** `dias`: quantos dias de dinheiro das vendas trazer (so' vale no CAIXA com a chave ligada). */
export const extratoDoCaixa = async (id: string, dias = 30) => (
  (await chamarServidor<{ lancamentos: LancamentoDoCaixa[] }>('GET', `caixas/${encodeURIComponent(id)}/extrato?dias=${dias}`)).lancamentos
);

export const lancarNoCaixa = (id: string, corpo: { direcao: 'credito' | 'debito'; valorCentavos: number; descricao: string; data: string }) => (
  chamarServidor<{ ok: true }>('POST', `caixas/${encodeURIComponent(id)}/lancamento`, { ...corpo })
);

export const transferirEntreContas = (corpo: { origem: ContaRef; destino: ContaRef; valorCentavos: number; data: string; descricao: string }) => (
  chamarServidor<{ ok: true; nomeOrigem: string; nomeDestino: string; valorCentavos: number }>('POST', 'caixas/transferir', { ...corpo })
);

/** PDV: sangria "para deposito" credita o banco escolhido na hora. */
export const sangriaParaDeposito = (corpo: { bancoId: string; valorCentavos: number; sessaoId: string; data: string }) => (
  chamarServidor<{ ok: true; bancoNome: string; bancoId: string; valorCentavos: number }>('POST', 'caixas/sangria-deposito', { ...corpo })
);

// Cheque recebido, antes de compensar (rotas do Financeiro).
export const depositarCheque = (transacaoId: string, bancoId: string) => (
  chamarServidor<{ ok: true; bancoNome: string }>('POST', 'financeiro/cheque/depositar', { transacaoId, bancoId })
);
export const devolverCheque = (transacaoId: string, motivo: string) => (
  chamarServidor<{ ok: true }>('POST', 'financeiro/cheque/devolver', { transacaoId, motivo })
);
export const voltarChequeParaCarteira = (transacaoId: string) => (
  chamarServidor<{ ok: true }>('POST', 'financeiro/cheque/voltar-carteira', { transacaoId })
);
