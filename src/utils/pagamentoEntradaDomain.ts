import { addDaysToDateInput } from './dateTime';
import { fromCents, splitCents, toCents } from './financeDomain';

/*
 * FORMA DE PAGAMENTO DA ENTRADA DE NOTA (pedido do dono, 2026-09-24).
 *
 * Antes: so' valia a duplicata do XML (sem duplicata, uma parcela fixa de 30
 * dias), nao dava para mudar vencimento nem valor, e o titulo nascia sempre
 * pendente. Agora a pessoa ve as parcelas, edita, divide em N vezes ou marca
 * que a nota foi PAGA na hora (caixa ou banco).
 *
 * Regra pura: sem tela, sem Firestore.
 */

export type ModoDePagamento = 'prazo' | 'avista';
export type DestinoDoPagamento = 'caixa' | 'banco';

export interface ParcelaDaEntrada {
  numero: string;
  /** AAAA-MM-DD */
  vencimento: string;
  valor: number;
}

export const PRAZO_PADRAO_DIAS = 30;

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Parcelas que a tela mostra ao abrir a nota: as duplicatas do XML, ou uma so' (emissao + 30 dias). */
export const parcelasIniciais = (
  duplicatas: { numero: string; vencimento: string; valor: number }[],
  dataEmissao: string,
  totalDaNota: number,
): ParcelaDaEntrada[] => {
  const validas = duplicatas.filter((d) => d.valor > 0);
  if (validas.length > 0) {
    return validas.map((d, indice) => ({
      numero: d.numero || String(indice + 1),
      vencimento: DATA_ISO.test(d.vencimento) ? d.vencimento : dataEmissao,
      valor: fromCents(toCents(d.valor)),
    }));
  }
  return [{ numero: '1', vencimento: addDaysToDateInput(dataEmissao, PRAZO_PADRAO_DIAS), valor: fromCents(toCents(totalDaNota)) }];
};

/**
 * Divide o total em N parcelas iguais (centavo que sobra vai para as primeiras),
 * a primeira vencendo em `primeiroVencimento` e as outras a cada `intervaloDias`.
 */
export const dividirEmParcelas = (
  totalDaNota: number,
  quantidade: number,
  primeiroVencimento: string,
  intervaloDias = 30,
): ParcelaDaEntrada[] => {
  const n = Math.max(1, Math.min(60, Math.floor(quantidade) || 1));
  const valores = splitCents(toCents(totalDaNota), n);
  return valores.map((centavos, indice) => ({
    numero: String(indice + 1),
    vencimento: addDaysToDateInput(primeiroVencimento, indice * intervaloDias) || primeiroVencimento,
    valor: fromCents(centavos),
  }));
};

export interface ConferenciaDasParcelas {
  soma: number;
  diferenca: number;
  ok: boolean;
  /** Erro que IMPEDE lancar (parcela sem data, valor zero...). */
  erro: string | null;
  /** A soma nao fecha com o total da nota: pede confirmacao, nao impede. */
  aviso: string | null;
}

const formatar = (valor: number): string => valor.toFixed(2).replace('.', ',');

export const conferirParcelas = (parcelas: ParcelaDaEntrada[], totalDaNota: number): ConferenciaDasParcelas => {
  const soma = fromCents(parcelas.reduce((total, p) => total + toCents(p.valor), 0));
  const diferenca = fromCents(toCents(soma) - toCents(totalDaNota));
  let erro: string | null = null;
  if (parcelas.length === 0) erro = 'Informe ao menos uma parcela.';
  else {
    const invalida = parcelas.findIndex((p) => !DATA_ISO.test(p.vencimento));
    if (invalida >= 0) erro = `A parcela ${invalida + 1} está sem data de vencimento válida.`;
    else {
      const semValor = parcelas.findIndex((p) => !(toCents(p.valor) > 0));
      if (semValor >= 0) erro = `A parcela ${semValor + 1} precisa ter valor maior que zero.`;
    }
  }
  const aviso = !erro && diferenca !== 0
    ? `As parcelas somam R$ ${formatar(soma)}, mas a nota é de R$ ${formatar(totalDaNota)} (${diferenca > 0 ? 'sobram' : 'faltam'} R$ ${formatar(Math.abs(diferenca))}). Confira antes de lançar.`
    : null;
  return { soma, diferenca, ok: !erro && diferenca === 0, erro, aviso };
};

/** Dias entre a emissao da nota e o vencimento (para mostrar "30 dias"). */
export const diasAteVencer = (emissao: string, vencimento: string): number | null => {
  if (!DATA_ISO.test(emissao) || !DATA_ISO.test(vencimento)) return null;
  const dias = Math.round((Date.parse(`${vencimento}T00:00:00Z`) - Date.parse(`${emissao}T00:00:00Z`)) / 86400000);
  return Number.isFinite(dias) ? dias : null;
};

export const FORMAS_DE_PAGAMENTO = ['Boleto', 'Transferência', 'PIX', 'Dinheiro', 'Cheque', 'Cartão', 'Outros'] as const;

/** Categorias de despesa oferecidas na entrada. A primeira e' a que sempre foi usada. */
export const CATEGORIAS_DE_COMPRA = ['FORNECEDORES DE PEÇAS', 'MATÉRIA-PRIMA', 'MERCADORIA PARA REVENDA', 'MATERIAL DE CONSUMO', 'OUTROS'] as const;

export interface DadosDoPagamentoAVista {
  destino: DestinoDoPagamento;
  bancoId: string;
}

/** Erro em portugues de pagamento a vista sem banco escolhido, ou null. */
export const erroDoPagamentoAVista = (dados: DadosDoPagamentoAVista): string | null => (
  dados.destino === 'banco' && !dados.bancoId.trim()
    ? 'Escolha de qual banco saiu o pagamento, ou marque "Caixa" se foi em dinheiro.'
    : null
);
