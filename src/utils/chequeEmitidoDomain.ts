import { buildChequeDetails, type ChequeDetails } from './financeDomain';
import type { ParcelaDaEntrada } from './pagamentoEntradaDomain';

/*
 * CHEQUE EMITIDO PARA PAGAR DESPESA (pedido do dono, 2026-09-24).
 *
 * "Lancar cheque, selecionar o banco do cheque, os dados e os dias em que o
 * valor sai do banco, e parcelas do cheque." Regras que o dono confirmou:
 *  - a COMPENSACAO e' manual, na fila de Cheques (aba "Emitidos"): o cheque
 *    fica pendente ate alguem confirmar que compensou, e so' ai o banco e'
 *    debitado -- igual ao recebimento de cheque;
 *  - cada cheque tem a sua data (bom para), e um atalho gera as datas por
 *    prazo em dias (30/60/90...), editaveis uma a uma.
 *
 * A data de compensacao do cheque e' o VENCIMENTO do titulo (`data`): e' o dia
 * em que o dinheiro sai.
 *
 * Regra pura: sem tela, sem Firestore.
 */

export interface ParcelaComCheque extends ParcelaDaEntrada {
  /** Banco (conta da empresa) de onde o cheque sera descontado. */
  bancoId?: string;
  numeroCheque?: string;
}

export interface BancoDoCheque {
  id: string;
  nome: string;
}

/**
 * Numera os cheques em sequencia a partir do primeiro ("000123" -> "000123",
 * "000124"...), mantendo os zeros a esquerda. Numero nao numerico repete-se
 * com sufixo "-2", "-3"... para nao ficar tudo igual. Vazio -> todos vazios.
 */
export const numerarCheques = (primeiroNumero: string, quantidade: number): string[] => {
  const base = String(primeiroNumero ?? '').trim();
  const total = Math.max(0, Math.floor(quantidade));
  if (!base) return Array.from({ length: total }, () => '');
  if (/^\d+$/.test(base)) {
    const largura = base.length;
    const inicial = BigInt(base);
    return Array.from({ length: total }, (_, i) => (inicial + BigInt(i)).toString().padStart(largura, '0'));
  }
  return Array.from({ length: total }, (_, i) => (i === 0 ? base : `${base}-${i + 1}`));
};

/** Aplica numeracao e banco a todas as parcelas (o atalho "usar o mesmo banco / numerar a partir de"). */
export const aplicarChequesNasParcelas = (
  parcelas: ParcelaComCheque[],
  bancoId: string,
  primeiroNumero: string,
): ParcelaComCheque[] => {
  const numeros = numerarCheques(primeiroNumero, parcelas.length);
  return parcelas.map((parcela, indice) => ({
    ...parcela,
    ...(bancoId ? { bancoId } : {}),
    ...(numeros[indice] ? { numeroCheque: numeros[indice] } : {}),
  }));
};

export interface ChequeMontado {
  bancoId: string;
  bancoNome: string;
  cheque: ChequeDetails;
}

/**
 * Dados do cheque de UMA parcela, prontos para gravar no titulo. Erro em
 * portugues dizendo qual cheque e o que falta.
 */
export const montarChequeDaParcela = (parcela: ParcelaComCheque, bancos: BancoDoCheque[]): ChequeMontado => {
  const posicao = `cheque da parcela ${parcela.numero}`;
  const banco = bancos.find((b) => b.id === parcela.bancoId);
  if (!parcela.bancoId || !banco) throw new Error(`Escolha o banco do ${posicao}.`);
  const numero = String(parcela.numeroCheque ?? '').trim();
  if (!numero) throw new Error(`Informe o número do ${posicao}.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parcela.vencimento)) throw new Error(`Informe a data de compensação do ${posicao}.`);
  return {
    bancoId: banco.id,
    bancoNome: banco.nome,
    cheque: buildChequeDetails({ bancoEmissor: banco.nome, numeroCheque: numero, dataCompensacao: parcela.vencimento }),
  };
};

/**
 * Primeiro problema dos cheques (banco, numero, data, numero repetido no mesmo
 * banco), em portugues, ou null se estiverem todos bons.
 */
export const erroDosCheques = (parcelas: ParcelaComCheque[], bancos: BancoDoCheque[]): string | null => {
  const vistos = new Set<string>();
  for (const parcela of parcelas) {
    try {
      const montado = montarChequeDaParcela(parcela, bancos);
      const chave = `${montado.bancoId}|${montado.cheque.numeroCheque}`;
      if (vistos.has(chave)) {
        return `O cheque nº ${montado.cheque.numeroCheque} do banco ${montado.bancoNome} aparece mais de uma vez. Cada cheque precisa de um número diferente.`;
      }
      vistos.add(chave);
    } catch (erro) {
      return (erro as Error).message;
    }
  }
  return null;
};

/** Campos do titulo (transacao de saida) de uma parcela paga em cheque. */
export const camposDoTituloEmCheque = (parcela: ParcelaComCheque, bancos: BancoDoCheque[]) => {
  const montado = montarChequeDaParcela(parcela, bancos);
  return {
    // 'Cheque' na forma faz o titulo aparecer na fila de Cheques (aba Emitidos)
    // e nao poder ser baixado direto: so' compensa la, debitando o banco.
    formaPagamento: 'Cheque' as const,
    bancoId: montado.bancoId,
    bancoNome: montado.bancoNome,
    cheque: montado.cheque,
    dataPrevistaRecebimento: montado.cheque.dataCompensacao,
  };
};
