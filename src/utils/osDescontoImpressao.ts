import { fromCents } from './financeDomain';

/**
 * Desconto da OS pronto para a impressao.
 *
 * A impressao SEMPRE recalculou o total somando os itens, e por isso mostrava
 * o valor cheio: o desconto fica num campo separado (`desconto`, gravado por
 * OSForm.tsx) que os dois modelos ignoravam. O cliente recebia um papel com
 * total diferente do que ia pagar.
 *
 * A fonte do valor e' `valorAplicadoCentavos` -- o desconto que a tela de fato
 * aplicou no momento de salvar, ja resolvido em reais mesmo quando foi
 * digitado em percentual. Recalcular o percentual aqui daria numero diferente
 * se algum item tiver mudado depois, e o papel tem que dizer o que foi
 * cobrado, nao o que seria cobrado hoje.
 *
 * `rotulo` traz o percentual entre parenteses quando o desconto foi dado em %,
 * porque e' essa a forma que o cliente combinou no balcao ("dei 10%").
 */
export interface DescontoImpressaoOS {
  /** Quanto foi abatido, em reais. Zero quando nao houve desconto. */
  valor: number;
  /** true quando ha desconto a mostrar -- a impressao so cria as linhas ai. */
  temDesconto: boolean;
  /** "Desconto" ou "Desconto (10%)". */
  rotulo: string;
}

export const resolverDescontoImpressaoOS = (desconto: unknown): DescontoImpressaoOS => {
  const dados = (desconto || {}) as {
    tipo?: unknown;
    valorInformado?: unknown;
    valorAplicadoCentavos?: unknown;
  };

  const centavos = Number(dados.valorAplicadoCentavos);
  const valor = Number.isFinite(centavos) && centavos > 0 ? fromCents(centavos) : 0;

  const percentual = Number(dados.valorInformado);
  const mostrarPercentual = dados.tipo === 'percentual' && Number.isFinite(percentual) && percentual > 0;

  return {
    valor,
    temDesconto: valor > 0,
    rotulo: mostrarPercentual
      ? `Desconto (${String(percentual).replace('.', ',')}%)`
      : 'Desconto',
  };
};

/** Total depois do desconto, nunca negativo. */
export const totalComDescontoOS = (subtotal: number, desconto: DescontoImpressaoOS): number =>
  Math.max(0, subtotal - desconto.valor);
