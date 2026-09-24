import { ratearValorPorPesos } from './notaAvulsaDomain';
import { arredondarCusto } from './custoProducaoDomain';
import type { ItemDaNota, TotaisDaNota } from './nfeXmlDomain';
import type { RegimeTributario } from './fiscalDomain';

/*
 * CUSTO REAL DA ENTRADA DE NOTA (pedido do dono, 2026-09-24).
 *
 * "Precisamos importar tudo corretamente da nota, ainda mais campos de
 * impostos." O custo que ia para o estoque era so' valor unitario + frete
 * rateado: desconto, seguro, despesas acessorias, IPI e ICMS-ST da nota
 * ficavam de fora, e o custo saia diferente do que a empresa de fato pagou.
 *
 *   custo do item = produto + frete rateado + seguro + outras despesas
 *                   + IPI + ICMS-ST - desconto - ICMS desonerado
 *                   - impostos recuperaveis (so' se a empresa os aproveita)
 *
 * Impostos recuperaveis dependem do regime da EMPRESA que compra:
 *  - Simples Nacional: nao aproveita credito -> nada e' descontado.
 *  - Lucro Presumido: aproveita ICMS (nao cumulativo), nao PIS/COFINS.
 *  - Lucro Real: aproveita ICMS, PIS e COFINS.
 * A tela mostra os dois como escolha (o contador pode ter outra orientacao).
 *
 * Regra pura: sem tela, sem Firestore.
 */

export interface OpcoesDeCustoDeEntrada {
  /** Descontar o ICMS destacado da nota (credito). */
  creditarIcms: boolean;
  /** Descontar PIS e COFINS destacados (credito). */
  creditarPisCofins: boolean;
}

export const opcoesDeCustoPorRegime = (regime: RegimeTributario): OpcoesDeCustoDeEntrada => {
  if (regime === 'lucro_real') return { creditarIcms: true, creditarPisCofins: true };
  if (regime === 'lucro_presumido') return { creditarIcms: true, creditarPisCofins: false };
  return { creditarIcms: false, creditarPisCofins: false };
};

export type ItemParaCustoDeEntrada = Pick<ItemDaNota, 'quantidade' | 'valorProduto' | 'frete' | 'seguro' | 'desconto' | 'outrasDespesas' | 'icms' | 'ipi' | 'pis' | 'cofins'>;

export interface CustoDoItemDeEntrada {
  valorProduto: number;
  frete: number;
  seguro: number;
  outrasDespesas: number;
  ipi: number;
  icmsSt: number;
  desconto: number;
  icmsDesonerado: number;
  creditos: { icms: number; pisCofins: number };
  /** Valor total que este item custou, em reais. */
  custoTotal: number;
  /** Custo por unidade da NOTA (PCT, CX...). */
  custoUnitarioNota: number;
}

const centavos = (valor: number): number => Math.round((valor + Number.EPSILON) * 100) / 100;

/**
 * Valor de cada item + o que a nota trouxe so' no total (emissor que nao abre
 * por item): o RESTANTE e' rateado pelo valor de cada produto.
 */
const distribuirComRestante = (porItem: number[], totalDaNota: number, pesos: number[]): number[] => {
  const somaItens = porItem.reduce((soma, valor) => soma + valor, 0);
  const restante = centavos(totalDaNota - somaItens);
  if (restante <= 0.004) return porItem;
  const partes = ratearValorPorPesos(restante, pesos);
  return porItem.map((valor, indice) => centavos(valor + (partes[indice] || 0)));
};

/**
 * Custo de cada item da nota. `freteTotal` e' o campo de frete DA TELA (ja
 * vem preenchido com o frete do XML e a pessoa pode somar o do CT-e), por isso
 * o frete por item do XML nao entra separado: seria contado duas vezes.
 */
export const calcularCustoDaEntrada = (
  itens: ItemParaCustoDeEntrada[],
  totais: Pick<TotaisDaNota, 'seguro' | 'desconto' | 'outrasDespesas' | 'ipi' | 'st' | 'icmsDesonerado'>,
  freteTotal: number,
  opcoes: OpcoesDeCustoDeEntrada,
): CustoDoItemDeEntrada[] => {
  const pesos = itens.map((item) => Math.max(0, Number(item.valorProduto) || 0));
  const fretePorItem = ratearValorPorPesos(Math.max(0, Number(freteTotal) || 0), pesos);
  const seguro = distribuirComRestante(itens.map((i) => Number(i.seguro) || 0), totais.seguro, pesos);
  const outras = distribuirComRestante(itens.map((i) => Number(i.outrasDespesas) || 0), totais.outrasDespesas, pesos);
  const desconto = distribuirComRestante(itens.map((i) => Number(i.desconto) || 0), totais.desconto, pesos);
  const ipi = distribuirComRestante(itens.map((i) => Number(i.ipi.valor) || 0), totais.ipi, pesos);
  const icmsSt = distribuirComRestante(itens.map((i) => Number(i.icms.valorSt) || 0), totais.st, pesos);
  const desonerado = distribuirComRestante(itens.map((i) => Number(i.icms.valorDesonerado) || 0), totais.icmsDesonerado, pesos);

  return itens.map((item, indice) => {
    const creditoIcms = opcoes.creditarIcms ? Number(item.icms.valor) || 0 : 0;
    const creditoPisCofins = opcoes.creditarPisCofins ? (Number(item.pis.valor) || 0) + (Number(item.cofins.valor) || 0) : 0;
    const custoTotal = centavos(
      (Number(item.valorProduto) || 0)
      + (fretePorItem[indice] || 0)
      + seguro[indice]
      + outras[indice]
      + ipi[indice]
      + icmsSt[indice]
      - desconto[indice]
      - desonerado[indice]
      - creditoIcms
      - creditoPisCofins,
    );
    const quantidade = Number(item.quantidade) || 0;
    return {
      valorProduto: Number(item.valorProduto) || 0,
      frete: fretePorItem[indice] || 0,
      seguro: seguro[indice],
      outrasDespesas: outras[indice],
      ipi: ipi[indice],
      icmsSt: icmsSt[indice],
      desconto: desconto[indice],
      icmsDesonerado: desonerado[indice],
      creditos: { icms: creditoIcms, pisCofins: creditoPisCofins },
      custoTotal,
      custoUnitarioNota: quantidade > 0 ? arredondarCusto(custoTotal / quantidade) : 0,
    };
  });
};

/**
 * Unidade da nota -> unidade do estoque. `fator` = quantas unidades de estoque
 * cabem em 1 unidade da nota (1 PCT = 1 KG -> 1; 1 CX = 12 UN -> 12).
 * Sem fator valido, vale 1 (nota e estoque na mesma unidade).
 */
export const fatorValido = (fator: unknown): number => {
  const numero = Number(fator);
  return Number.isFinite(numero) && numero > 0 ? numero : 1;
};

export const quantidadeNoEstoque = (quantidadeDaNota: number, fator: unknown): number => (
  Math.round((Number(quantidadeDaNota) * fatorValido(fator) + Number.EPSILON) * 1e6) / 1e6
);

/** Custo por unidade de ESTOQUE: o total pago dividido pela quantidade ja convertida. */
export const custoUnitarioNoEstoque = (custoTotal: number, quantidadeDaNota: number, fator: unknown): number => {
  const quantidade = quantidadeNoEstoque(quantidadeDaNota, fator);
  return quantidade > 0 ? arredondarCusto(custoTotal / quantidade) : 0;
};

/**
 * Custo medio ponderado depois da entrada. Estoque zerado ou NEGATIVO nao
 * pesa: o custo medio passa a ser o da entrada (saldo negativo e' erro de
 * lancamento, nao mercadoria que "custa" algo).
 */
export const custoMedioPonderado = (
  quantidadeAtual: number,
  custoAtual: number,
  quantidadeEntrada: number,
  custoEntrada: number,
): number => {
  const qtdAtual = Number(quantidadeAtual) || 0;
  const qtdEntrada = Number(quantidadeEntrada) || 0;
  if (qtdEntrada <= 0) return arredondarCusto(Number(custoAtual) || 0);
  if (qtdAtual <= 0) return arredondarCusto(custoEntrada);
  return arredondarCusto((qtdAtual * (Number(custoAtual) || 0) + qtdEntrada * custoEntrada) / (qtdAtual + qtdEntrada));
};

export interface ConferenciaDaNota {
  somaDosItens: number;
  totalDeProdutosDaNota: number;
  /** Total que a formula da NF-e da: produtos + frete + seguro + outras + II + IPI + ST + FCP-ST - desconto - ICMS desonerado. */
  totalCalculado: number;
  totalDaNota: number;
  diferenca: number;
  ok: boolean;
  avisos: string[];
}

export const TOLERANCIA_DA_CONFERENCIA = 0.05;

/**
 * Confere a nota contra ela mesma: a soma dos itens fecha com o total de
 * produtos e o total da formula fecha com o valor da nota (vNF). Divergencia
 * quase sempre e' arquivo alterado ou leitura errada -- a tela pede
 * confirmacao antes de lancar.
 */
export const conferirNota = (itens: Pick<ItemDaNota, 'valorProduto'>[], totais: TotaisDaNota): ConferenciaDaNota => {
  const somaDosItens = centavos(itens.reduce((soma, item) => soma + (Number(item.valorProduto) || 0), 0));
  const totalCalculado = centavos(
    totais.produtos + totais.frete + totais.seguro + totais.outrasDespesas + totais.impostoImportacao
    + totais.ipi + totais.st + totais.fcpSt + totais.ipiDevolvido - totais.desconto - totais.icmsDesonerado,
  );
  const diferenca = centavos(totalCalculado - totais.total);
  const avisos: string[] = [];
  if (Math.abs(somaDosItens - totais.produtos) > TOLERANCIA_DA_CONFERENCIA) {
    avisos.push(`A soma dos itens (${somaDosItens.toFixed(2).replace('.', ',')}) não bate com o total de produtos da nota (${totais.produtos.toFixed(2).replace('.', ',')}).`);
  }
  if (Math.abs(diferenca) > TOLERANCIA_DA_CONFERENCIA) {
    avisos.push(`Os valores da nota somam ${totalCalculado.toFixed(2).replace('.', ',')}, mas o total informado é ${totais.total.toFixed(2).replace('.', ',')} (diferença de ${Math.abs(diferenca).toFixed(2).replace('.', ',')}).`);
  }
  return {
    somaDosItens,
    totalDeProdutosDaNota: totais.produtos,
    totalCalculado,
    totalDaNota: totais.total,
    diferenca,
    ok: avisos.length === 0,
    avisos,
  };
};
