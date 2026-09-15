/**
 * Regra de inativacao de produto (2026-09-15).
 *
 * Produto so' pode ser inativado com saldo ZERO. Se ainda tem saldo, o
 * sistema zera junto com a inativacao -- numa operacao so', avisando antes o
 * que vai acontecer.
 *
 * Por que zerar importa: produto inativo some das buscas de venda, mas
 * continua somando no valor do estoque e nos relatorios de posicao. Deixar
 * saldo preso num cadastro que ninguem mais enxerga produz inventario que
 * nao fecha e valor de estoque inflado, sem ninguem conseguir achar a
 * origem. Zerar na inativacao mantem a posicao de estoque igual ao que
 * existe de verdade na prateleira.
 *
 * Por que o zeramento vira ajuste: sumir com saldo sem deixar rastro e' pior
 * do que o problema que resolve. Cada zeramento grava em `ajustes_estoque` e
 * aparece no Relatorio de Ajustes, com quantidade antes/depois e o motivo.
 */

import type { TipoAjusteEstoque } from './ajusteEstoqueDomain';

/** Saldo diferente de zero (inclusive negativo) exige zeramento. Saldo
 * negativo tambem: e' posicao errada, e inativar congelaria o erro. */
export const precisaZerarParaInativar = (quantidade: number): boolean => (
  Number.isFinite(quantidade) && Number(quantidade) !== 0
);

/**
 * Ajuste que leva o saldo a zero. Saldo positivo sai do estoque; saldo
 * negativo entra (e' acerto de uma posicao que ja' estava furada).
 */
export const ajustePararZerar = (quantidade: number): { tipo: TipoAjusteEstoque; quantidade: number; motivo: string } => (
  quantidade > 0
    ? { tipo: 'saida', quantidade, motivo: 'correcao_inventario' }
    : { tipo: 'entrada', quantidade: Math.abs(quantidade), motivo: 'correcao_cadastro' }
);

const formatarQuantidade = (quantidade: number, unidade?: string): string => {
  const numero = Number.isInteger(quantidade) ? String(quantidade) : String(quantidade);
  return unidade ? `${numero} ${unidade}` : numero;
};

/**
 * Texto do aviso mostrado antes de inativar um produto que ainda tem saldo.
 * Diz o numero, diz o que o sistema vai fazer e diz onde isso fica
 * registrado -- o usuario precisa dos tres pra decidir.
 */
export const avisoInativacaoComSaldo = (
  nome: string,
  quantidade: number,
  unidade?: string,
): { title: string; text: string; confirmButtonText: string } => ({
  title: `Zerar e inativar "${nome}"?`,
  text: `Este produto ainda tem ${formatarQuantidade(quantidade, unidade)} em estoque. `
    + 'Produto inativo não pode ficar com saldo, então o sistema vai zerar o estoque e inativar o produto na mesma operação. '
    + 'O zeramento fica registrado no Relatório de Ajustes, com a quantidade anterior. '
    + 'Para inativar sem zerar, cancele e dê baixa do saldo antes.',
  confirmButtonText: 'Sim, zerar e inativar',
});

/** Aviso de inativacao de produto que ja' esta com saldo zero. */
export const avisoInativacaoSemSaldo = (nome: string): { title: string; text: string; confirmButtonText: string } => ({
  title: `Inativar "${nome}"?`,
  text: 'O produto some das buscas de venda, OS e orçamento, mas o histórico continua intacto. Pode ser reativado quando quiser.',
  confirmButtonText: 'Sim, inativar',
});
