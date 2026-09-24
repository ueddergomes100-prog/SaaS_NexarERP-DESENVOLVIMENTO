/*
 * ESTORNO DE BAIXA -- UM SO' CAMINHO PARA O SISTEMA INTEIRO.
 *
 * Contas a Pagar, Contas a Receber e Fluxo de Caixa estornam por aqui. Antes
 * o Fluxo de Caixa tinha um estorno proprio que so' trocava o status para
 * Pendente: nao devolvia o saldo do banco, nao mexia na venda/OS de origem e
 * aparecia ate' em recebimento do balcao. Tres caminhos diferentes para a
 * mesma pergunta e' exatamente como o saldo do banco fica errado sem ninguem
 * ver.
 *
 * Regras de QUEM pode ser estornado: baixaFinanceiraDomain (puras, testadas).
 * Aqui mora a gravacao: numa transacao so', desfaz tudo que a baixa fez.
 */
import { deleteField, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { showError, showSuccess } from '../utils/alerts';
import { buildDocumentUpdateMetadata } from '../utils/documentMetadata';
import {
  fromCents,
  legacyPaymentForTransaction,
  reversePaymentReceipt,
  summarizePayments,
  toCents,
  transactionNetAmount,
  type PaymentRecord,
} from '../utils/financeDomain';
import {
  dataBrasileira,
  planejarEstornoPagar,
  planejarEstornoReceber,
  type PlanoEstorno,
  type TituloParaEstorno,
} from '../utils/baixaFinanceiraDomain';
import { pedirMotivoEstorno } from '../utils/baixaFinanceiraUi';

export type TipoLancamento = 'entrada' | 'saida';

/** O que qualquer tela precisa entregar para estornar um lancamento. */
export interface TituloEstornavel extends TituloParaEstorno {
  id: string;
  descricao: string;
  valor: number;
  tipo?: TipoLancamento | string;
  bancoNome?: string;
  pedidoId?: string;
  osId?: string;
}

export interface UsuarioEstorno {
  uid: string;
  email?: string | null;
}

/** Plano de estorno conforme o tipo: saida = Contas a Pagar, entrada = Contas a Receber. */
export const planejarEstornoPorTipo = (titulo: TituloParaEstorno, tipo: TipoLancamento | string | undefined): PlanoEstorno => (
  tipo === 'saida' ? planejarEstornoPagar(titulo) : planejarEstornoReceber(titulo)
);

/**
 * Desfaz a baixa, tudo ou nada:
 *  - o titulo volta a Pendente (e, no recebimento, com a forma de antes);
 *  - o saldo do banco que a baixa mexeu e' corrigido;
 *  - a venda/OS de origem volta a mostrar o pagamento como pendente.
 * Confere as regras de novo com o dado de AGORA, dentro da transacao: alguem
 * pode ter estornado ou alterado o titulo depois que a tela carregou.
 */
export const executarEstorno = async (args: {
  titulo: TituloEstornavel;
  tipo: TipoLancamento;
  motivo: string;
  tenantId: string;
  usuario: UsuarioEstorno;
}): Promise<void> => {
  const { titulo, tipo, motivo, tenantId, usuario } = args;
  const transactionRef = doc(db, 'transacoes', titulo.id);

  await runTransaction(db, async (transaction) => {
    const transactionSnap = await transaction.get(transactionRef);
    if (!transactionSnap.exists()) throw new Error('Lançamento não encontrado.');
    const dados = transactionSnap.data();
    const plano = planejarEstornoPorTipo(dados as TituloParaEstorno, tipo);
    if (!plano.permitido) {
      throw new Error(dados.status !== 'Paga' ? 'Este lançamento já não está mais pago. Atualize a tela.' : plano.bloqueio);
    }

    // --- leituras (todas antes de qualquer escrita) ---
    const saleId = tipo === 'entrada' ? (dados.pedidoId || titulo.pedidoId) : undefined;
    const serviceOrderId = tipo === 'entrada' ? (dados.osId || titulo.osId) : undefined;
    const sourceRef = saleId
      ? doc(db, 'pedidos_venda', saleId)
      : serviceOrderId
        ? doc(db, 'ordens_de_servico', serviceOrderId)
        : null;
    const sourceSnap = sourceRef ? await transaction.get(sourceRef) : null;
    if (sourceSnap?.exists() && sourceSnap.data().status === 'Cancelada') {
      throw new Error(saleId
        ? 'A venda vinculada está cancelada, então o recebimento não pode ser estornado.'
        : 'A OS vinculada está cancelada, então o recebimento não pode ser estornado.');
    }

    const bancoRef = plano.bancoId && plano.ajusteBancoCentavos !== 0 ? doc(db, 'bancos', plano.bancoId) : null;
    let saldoAtualCentavos = 0;
    if (bancoRef) {
      const bancoSnap = await transaction.get(bancoRef);
      if (!bancoSnap.exists()) {
        throw new Error('O banco desta baixa não foi encontrado, então o saldo não pode ser corrigido.');
      }
      saldoAtualCentavos = Number(bancoSnap.data().saldoCentavos || 0);
    }

    const valorCentavos = Number(dados.valorCentavos ?? toCents(dados.valor));
    const registroDoEstorno = {
      estornadaEm: serverTimestamp(),
      ultimoEstorno: {
        motivo,
        por: usuario.uid,
        dataPagamentoEstornada: dados.dataPagamento || null,
        formaPagamentoEstornada: dados.formaPagamento || null,
        valorCentavos,
      },
      updatedAt: serverTimestamp(),
    };

    // --- escritas ---
    if (tipo === 'saida') {
      transaction.update(transactionRef, {
        status: 'Pendente',
        dataPagamento: deleteField(),
        bancoId: deleteField(),
        bancoNome: deleteField(),
        baixaManual: deleteField(),
        ...registroDoEstorno,
        ...buildDocumentUpdateMetadata(usuario.uid, serverTimestamp(), `Pagamento estornado: ${motivo}`),
      });
    } else {
      transaction.update(transactionRef, {
        status: 'Pendente',
        // Sem forma antes da baixa (titulo importado): apaga a que a baixa
        // gravou, em vez de deixar "Pix" num titulo que ainda nao foi pago.
        formaPagamento: plano.formaAnterior ? plano.formaAnterior : deleteField(),
        naturezaFinanceira: plano.naturezaAnterior,
        movimentaCaixaFisico: false,
        dataPagamento: deleteField(),
        recebidoEm: deleteField(),
        baixaManual: deleteField(),
        ...registroDoEstorno,
        ...buildDocumentUpdateMetadata(usuario.uid, serverTimestamp(), `Recebimento estornado: ${motivo}`),
      });
    }

    if (bancoRef) {
      transaction.update(bancoRef, {
        saldoCentavos: saldoAtualCentavos + plano.ajusteBancoCentavos,
        updatedAt: serverTimestamp(),
        ...buildDocumentUpdateMetadata(
          usuario.uid,
          serverTimestamp(),
          `Estorno ${tipo === 'saida' ? 'do pagamento' : 'do recebimento'} "${titulo.descricao}"`,
        ),
      });
    }

    if (sourceRef && sourceSnap?.exists()) {
      const sourceData = sourceSnap.data();
      const payments: PaymentRecord[] = Array.isArray(sourceData.pagamentos) && sourceData.pagamentos.length > 0
        ? sourceData.pagamentos
        : [legacyPaymentForTransaction(titulo.id, dados)];
      const updatedPayments = reversePaymentReceipt(payments, {
        transactionId: titulo.id,
        paymentIndex: dados.paymentIndex,
      });
      const summary = summarizePayments(updatedPayments);
      transaction.update(sourceRef, {
        pagamentos: updatedPayments,
        totalRecebidoCentavos: summary.receivedCents,
        totalRecebido: summary.received,
        totalPendenteCentavos: summary.pendingCents,
        totalPendente: summary.pending,
        totalTaxasPagamentoCentavos: summary.cardFeeCents,
        totalTaxasPagamento: summary.cardFee,
        totalLiquidoFinanceiroCentavos: summary.financialNetCents,
        totalLiquidoFinanceiro: summary.financialNet,
        statusPagamento: summary.pendingCents === 0
          ? 'Paga'
          : summary.receivedCents > 0
            ? 'Parcial'
            : 'Pendente',
        updatedAt: serverTimestamp(),
        ...buildDocumentUpdateMetadata(usuario.uid, serverTimestamp(), 'Recebimento estornado em Contas a Receber'),
      });
    }
  });

  try {
    const { createAuditLog } = await import('./logService');
    createAuditLog({
      tenantId,
      usuarioId: usuario.uid,
      usuarioEmail: usuario.email || usuario.uid,
      modulo: 'financeiro',
      acao: 'edicao',
      descricao: `${tipo === 'saida' ? 'Pagamento' : 'Recebimento'} "${titulo.descricao}" de R$ ${Number(titulo.valor).toFixed(2)} estornado para Pendente. Motivo: ${motivo}`,
      registroRelacionadoId: titulo.id,
      status: 'sucesso',
      critical: true,
    });
  } catch (logError) {
    console.error('Erro ao registrar auditoria do estorno:', logError);
  }
};

/**
 * O fluxo completo que as telas usam no clique de "Estornar": permissao,
 * regra, confirmacao com motivo, gravacao e aviso. Devolve true se estornou.
 */
export const estornarBaixaComConfirmacao = async (args: {
  titulo: TituloEstornavel;
  tipo: TipoLancamento;
  podeEstornar: boolean;
  tenantId: string | null;
  usuario: UsuarioEstorno | null;
}): Promise<boolean> => {
  const { titulo, tipo, podeEstornar, tenantId, usuario } = args;
  if (!usuario || !tenantId) return false;
  const nomeAcao = tipo === 'saida' ? 'pagamentos' : 'recebimentos';

  if (!podeEstornar) {
    showError('Sem permissão', `Você não tem permissão para estornar ${nomeAcao}. Peça a um responsável liberar "Financeiro: Estornar Pagamento/Recebimento" no seu usuário.`);
    return false;
  }
  const plano = planejarEstornoPorTipo(titulo, tipo);
  if (!plano.permitido) {
    showError('Não é possível estornar', plano.bloqueio);
    return false;
  }

  const quando = titulo.dataPagamento ? `${tipo === 'saida' ? 'paga' : 'recebido'} em ${dataBrasileira(titulo.dataPagamento)}` : '';
  const forma = titulo.formaPagamento ? `(${titulo.formaPagamento})` : '';
  const valor = tipo === 'saida' ? Number(titulo.valor) : transactionNetAmount(titulo);
  const noBanco = plano.bancoId && plano.ajusteBancoCentavos !== 0
    ? (plano.ajusteBancoCentavos > 0
      ? ` R$ ${fromCents(plano.ajusteBancoCentavos).toFixed(2)} voltam para o saldo do banco${titulo.bancoNome ? ` ${titulo.bancoNome}` : ''}.`
      : ` R$ ${fromCents(-plano.ajusteBancoCentavos).toFixed(2)} saem do saldo do banco.`)
    : '';
  const daVenda = tipo === 'entrada' && (titulo.pedidoId || titulo.osId)
    ? ' A venda (ou OS) de origem passa a mostrar esse valor como a receber.'
    : '';

  const motivo = await pedirMotivoEstorno({
    titulo: tipo === 'saida' ? 'Estornar pagamento?' : 'Estornar recebimento?',
    texto: `${tipo === 'saida' ? 'A conta' : 'O recebimento'} "${titulo.descricao}" de R$ ${valor.toFixed(2)}, ${quando} ${forma}, volta para Pendente.${daVenda}${noBanco} Depois é só dar baixa de novo com a data certa.`
      .replace(/\s+,/g, ',').replace(/\s{2,}/g, ' '),
  });
  if (!motivo) return false;

  try {
    await executarEstorno({ titulo, tipo, motivo, tenantId, usuario });
    showSuccess(tipo === 'saida' ? 'Pagamento estornado! A conta voltou para Pendente.' : 'Recebimento estornado! A conta voltou para Pendente.');
    return true;
  } catch (erro) {
    console.error('Erro ao estornar:', erro);
    showError('Não foi possível estornar', erro instanceof Error ? erro.message : 'Tente novamente.');
    return false;
  }
};
