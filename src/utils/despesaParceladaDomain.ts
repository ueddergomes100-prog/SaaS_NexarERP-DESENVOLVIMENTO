import { fromCents, toCents } from './financeDomain';
import { camposDoTituloEmCheque, erroDosCheques, type BancoDoCheque, type ParcelaComCheque } from './chequeEmitidoDomain';
import { conferirParcelas } from './pagamentoEntradaDomain';

/*
 * DESPESA PARCELADA (pedido do dono, 2026-09-24): lancar uma despesa em varias
 * parcelas -- boleto, PIX, transferencia ou CHEQUES -- de uma vez, cada parcela
 * um titulo proprio no Contas a Pagar, com vencimento proprio.
 *
 * Regra pura: recebe o formulario e devolve os titulos prontos para gravar
 * (sem tenantId/metadados, que a tela acrescenta). Nunca `undefined`.
 */

export interface DadosDaDespesa {
  descricao: string;
  categoria: string;
  fornecedorId?: string;
  fornecedorNome?: string;
  /** Forma em que sera paga (Boleto, PIX, Transferencia, Dinheiro, Cheque, Cartao, Outros). */
  forma: string;
  /** Veiculo da frota a que a despesa pertence (opcional). */
  veiculoId?: string;
  veiculoNome?: string;
  veiculoPlaca?: string;
  motoristaId?: string;
  motoristaNome?: string;
}

export interface TituloDaDespesa {
  descricao: string;
  data: string;
  valor: number;
  valorCentavos: number;
  categoria: string;
  status: 'Pendente';
  tipo: 'saida';
  formaPagamentoPrevista: string;
  parcela?: number;
  totalParcelas?: number;
  grupoParcelasId?: string;
  fornecedorId?: string;
  fornecedorNome?: string;
  veiculoId?: string;
  veiculoNome?: string;
  veiculoPlaca?: string;
  motoristaId?: string;
  motoristaNome?: string;
  // So' cheque:
  formaPagamento?: 'Cheque';
  bancoId?: string;
  bancoNome?: string;
  cheque?: ReturnType<typeof camposDoTituloEmCheque>['cheque'];
  dataPrevistaRecebimento?: string;
}

const FORMA_CHEQUE = 'Cheque';

/** Problema que IMPEDE lancar (em portugues, dizendo o que fazer), ou null. A soma que nao fecha e' tratada a parte. */
export const erroDaDespesa = (
  dados: DadosDaDespesa,
  parcelas: ParcelaComCheque[],
  totalDaDespesa: number,
  bancos: BancoDoCheque[],
): string | null => {
  if (!dados.descricao.trim()) return 'Informe a descrição da despesa.';
  if (!dados.categoria.trim()) return 'Escolha a categoria da despesa.';
  if (!(toCents(totalDaDespesa) > 0)) return 'Informe o valor da despesa (maior que zero).';
  const conferencia = conferirParcelas(parcelas, totalDaDespesa);
  if (conferencia.erro) return conferencia.erro;
  if (dados.forma === FORMA_CHEQUE) return erroDosCheques(parcelas, bancos);
  return null;
};

/** A soma das parcelas nao fecha com o total? (aviso, a tela pede confirmacao) */
export const avisoDeSoma = (parcelas: ParcelaComCheque[], totalDaDespesa: number): string | null => (
  conferirParcelas(parcelas, totalDaDespesa).aviso
);

/**
 * Titulos da despesa, um por parcela. Com mais de uma parcela, a descricao ganha
 * "(Parcela i/n)" e todas levam o mesmo `grupoParcelasId` (para achar o
 * parcelamento inteiro depois).
 */
export const montarTitulosDaDespesa = (
  dados: DadosDaDespesa,
  parcelas: ParcelaComCheque[],
  bancos: BancoDoCheque[],
  grupoParcelasId: string,
): TituloDaDespesa[] => {
  const total = parcelas.length;
  const descricaoBase = dados.descricao.toUpperCase().trim();
  const categoria = dados.categoria.toUpperCase().trim();
  return parcelas.map((parcela, indice) => {
    const cheque = dados.forma === FORMA_CHEQUE ? camposDoTituloEmCheque(parcela, bancos) : null;
    const centavos = toCents(parcela.valor);
    return {
      descricao: total > 1 ? `${descricaoBase} (Parcela ${indice + 1}/${total})` : descricaoBase,
      data: cheque ? cheque.cheque.dataCompensacao : parcela.vencimento,
      valor: fromCents(centavos),
      valorCentavos: centavos,
      categoria,
      status: 'Pendente' as const,
      tipo: 'saida' as const,
      formaPagamentoPrevista: dados.forma,
      ...(total > 1 ? { parcela: indice + 1, totalParcelas: total, grupoParcelasId } : {}),
      ...(dados.fornecedorId && dados.fornecedorNome ? { fornecedorId: dados.fornecedorId, fornecedorNome: dados.fornecedorNome } : {}),
      ...(dados.veiculoId ? { veiculoId: dados.veiculoId, veiculoNome: dados.veiculoNome || '', ...(dados.veiculoPlaca ? { veiculoPlaca: dados.veiculoPlaca } : {}) } : {}),
      ...(dados.motoristaId ? { motoristaId: dados.motoristaId, motoristaNome: dados.motoristaNome || '' } : {}),
      ...(cheque || {}),
    };
  });
};
