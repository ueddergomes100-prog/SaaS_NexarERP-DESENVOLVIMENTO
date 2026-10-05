/*
 * BAIXA E ESTORNO DE TITULOS NO SERVIDOR (item 8 da auditoria de infra,
 * fatia 1 -- 2026-10-05).
 *
 * Antes, Contas a Pagar / Contas a Receber gravavam a baixa direto do
 * navegador: titulo, saldo do banco e venda/OS de origem. As regras do
 * Firestore precisavam deixar quem tem "financeiro.pagar/receber" escrever
 * `bancos.saldoCentavos` -- qualquer valor, pelo DevTools. Agora o navegador
 * so' diz O QUE quer (este titulo, esta forma, esta data, este banco) e a
 * conta e' feita aqui, com o dado lido do banco de dados.
 *
 * As regras de dinheiro NAO sao reescritas: vem de server/domain/, que e' o
 * proprio src/utils/*Domain.ts compilado (scripts/build-server-domain.mjs).
 * As gravacoes sao as mesmas que as telas faziam, campo a campo -- inclusive
 * `ultimaAlteracao` 'Pagamento confirmado' / 'Recebimento confirmado', que o
 * estorno usa para reconhecer baixa antiga (baixaFinanceiraDomain).
 *
 * Diferencas de proposito em relacao a tela antiga:
 *  - titulo, banco e venda/OS precisam ser da MESMA empresa de quem chama;
 *  - conta ja' paga nao e' baixada de novo (a tela de Pagar debitava o banco
 *    de novo num segundo clique);
 *  - o nome do banco vem do cadastro, nao do navegador;
 *  - a baixa tambem vai para o log de auditoria (antes so' o estorno ia).
 */
const { admin, db } = require('../config/firebase');
const {
  applyPaymentReceipt,
  fromCents,
  legacyPaymentForTransaction,
  reversePaymentReceipt,
  settledFinancialNatureForPayment,
  toCents,
} = require('../domain/financeDomain');
const {
  montarBaixaManual,
  planejarEstornoPagar,
  planejarEstornoReceber,
} = require('../domain/baixaFinanceiraDomain');
const { buildDocumentUpdateMetadata } = require('../domain/documentMetadata');
const { getDateInputInTimeZone } = require('../domain/dateTime');
const regras = require('./baixaFinanceiraRegras');

const { ErroBaixa, camposDoResumoDePagamentos } = regras;

const agora = () => admin.firestore.FieldValue.serverTimestamp();
const apagar = () => admin.firestore.FieldValue.delete();
const centavosDoTitulo = (dados) => Number(dados.valorCentavos ?? toCents(dados.valor));

/** Le o titulo dentro da transacao e confere empresa e tipo. */
const lerTitulo = async (tx, tenantId, pedido) => {
  const ref = db.collection('transacoes').doc(pedido.transacaoId);
  const snap = await tx.get(ref);
  if (!snap.exists || snap.data().tenantId !== tenantId) {
    throw new ErroBaixa(404, 'Lançamento não encontrado. Atualize a tela.');
  }
  const dados = snap.data();
  if (dados.tipo && dados.tipo !== pedido.tipo) {
    throw new ErroBaixa(400, pedido.tipo === 'saida'
      ? 'Este lançamento não é uma conta a pagar. Atualize a tela.'
      : 'Este lançamento não é uma conta a receber. Atualize a tela.');
  }
  return { ref, dados };
};

/** Venda ou OS de onde o titulo de Receber nasceu (se houver). */
const lerOrigem = async (tx, tenantId, dados, acao) => {
  const vendaId = dados.pedidoId;
  const osId = dados.osId;
  if (!vendaId && !osId) return { ref: null, dados: null };
  const ref = vendaId
    ? db.collection('pedidos_venda').doc(String(vendaId))
    : db.collection('ordens_de_servico').doc(String(osId));
  const snap = await tx.get(ref);
  if (!snap.exists || snap.data().tenantId !== tenantId) return { ref: null, dados: null };
  if (snap.data().status === 'Cancelada') {
    throw new ErroBaixa(400, vendaId
      ? `A venda vinculada está cancelada, então o recebimento não pode ser ${acao}.`
      : `A OS vinculada está cancelada, então o recebimento não pode ser ${acao}.`);
  }
  return { ref, dados: snap.data() };
};

const lerBanco = async (tx, tenantId, bancoId, mensagemSemBanco) => {
  const ref = db.collection('bancos').doc(bancoId);
  const snap = await tx.get(ref);
  if (!snap.exists || snap.data().tenantId !== tenantId) throw new ErroBaixa(404, mensagemSemBanco);
  return { ref, dados: snap.data() };
};

/**
 * Da' baixa num titulo: Pagar (despesa paga, debita o banco) ou Receber
 * (recebimento confirmado, credita o banco e atualiza a venda/OS). Tudo ou nada.
 */
const registrarBaixa = async ({ user, tenantId, pedido }) => {
  const { tipo, formaPagamento, dataPagamento, bancoId } = pedido;
  const resumo = {};

  await db.runTransaction(async (tx) => {
    // --- leituras (todas antes de qualquer escrita) ---
    const titulo = await lerTitulo(tx, tenantId, pedido);
    const dados = titulo.dados;
    if (dados.status === 'Paga') {
      throw new ErroBaixa(409, tipo === 'saida'
        ? 'Esta conta já está paga (talvez por outra pessoa). Atualize a tela.'
        : 'Este recebimento já foi confirmado (talvez por outra pessoa). Atualize a tela.');
    }
    if (dados.status === 'Cancelada') {
      throw new ErroBaixa(400, tipo === 'saida'
        ? 'Uma conta cancelada não pode ser paga.'
        : 'Uma conta cancelada não pode ser recebida.');
    }

    const origem = tipo === 'entrada' ? await lerOrigem(tx, tenantId, dados, 'recebido') : { ref: null, dados: null };
    const banco = bancoId ? await lerBanco(tx, tenantId, bancoId, 'O banco selecionado não foi encontrado. Atualize a tela e escolha de novo.') : null;
    if (banco && banco.dados.ativo === false) {
      throw new ErroBaixa(400, `O banco "${banco.dados.nome || 'selecionado'}" está inativo. Escolha outro banco ou reative-o em Cadastros > Bancos.`);
    }

    const valorCentavos = centavosDoTitulo(dados);
    const bancoNome = banco ? (String(banco.dados.nome || '').trim() || null) : null;
    resumo.descricao = String(dados.descricao || '');
    resumo.valorCentavos = valorCentavos;
    resumo.bancoNome = bancoNome;

    // --- escritas ---
    if (tipo === 'saida') {
      tx.update(titulo.ref, {
        status: 'Paga',
        formaPagamento,
        dataPagamento,
        valorCentavos,
        ...(banco ? { bancoId, bancoNome } : {}),
        baixaManual: montarBaixaManual({
          origem: 'contas_pagar',
          formaPagamento,
          dataPagamento,
          valorCentavos,
          ...(banco ? { bancoId, movimentoBancoCentavos: -valorCentavos } : {}),
        }),
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), 'Pagamento confirmado'),
      });
      if (banco) {
        tx.update(banco.ref, {
          saldoCentavos: Number(banco.dados.saldoCentavos || 0) - valorCentavos,
          updatedAt: agora(),
          ...buildDocumentUpdateMetadata(user.uid, agora(), `Débito da despesa "${resumo.descricao}"`),
        });
      }
      return;
    }

    tx.update(titulo.ref, {
      status: 'Paga',
      formaPagamentoOriginal: dados.formaPagamentoOriginal || dados.formaPagamento || null,
      formaPagamento,
      valorCentavos,
      valor: fromCents(valorCentavos),
      dataPagamento,
      naturezaFinanceira: settledFinancialNatureForPayment(formaPagamento),
      movimentaCaixaFisico: formaPagamento === 'Dinheiro',
      ...(banco ? { bancoId, bancoNome } : {}),
      baixaManual: montarBaixaManual({
        origem: 'contas_receber',
        formaPagamento,
        dataPagamento,
        valorCentavos,
        ...(banco ? { bancoId, movimentoBancoCentavos: valorCentavos } : {}),
      }),
      recebidoEm: agora(),
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), 'Recebimento confirmado'),
    });

    if (banco) {
      tx.update(banco.ref, {
        saldoCentavos: Number(banco.dados.saldoCentavos || 0) + valorCentavos,
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), `Recebimento de "${resumo.descricao}"`),
      });
    }

    if (origem.ref) {
      const pagamentos = Array.isArray(origem.dados.pagamentos) && origem.dados.pagamentos.length > 0
        ? origem.dados.pagamentos
        : [legacyPaymentForTransaction(pedido.transacaoId, dados)];
      const atualizados = applyPaymentReceipt(pagamentos, {
        transactionId: pedido.transacaoId,
        paymentIndex: dados.paymentIndex,
        amountCents: valorCentavos,
        method: formaPagamento,
        receiptId: pedido.transacaoId,
        receivedAt: dataPagamento,
      });
      tx.update(origem.ref, {
        ...camposDoResumoDePagamentos(atualizados),
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), 'Recebimento confirmado em Contas a Receber'),
      });
    }
  });

  return resumo;
};

/**
 * Desfaz a baixa, tudo ou nada: titulo volta a Pendente, saldo do banco e'
 * corrigido e a venda/OS volta a mostrar o pagamento como pendente. Quem pode
 * ser estornado e' decidido por baixaFinanceiraDomain, com o dado de AGORA.
 */
const registrarEstorno = async ({ user, tenantId, pedido }) => {
  const { tipo, motivo } = pedido;
  const resumo = {};

  await db.runTransaction(async (tx) => {
    // --- leituras ---
    const titulo = await lerTitulo(tx, tenantId, pedido);
    const dados = titulo.dados;
    const plano = tipo === 'saida' ? planejarEstornoPagar(dados) : planejarEstornoReceber(dados);
    if (!plano.permitido) {
      throw new ErroBaixa(dados.status !== 'Paga' ? 409 : 400, dados.status !== 'Paga'
        ? 'Este lançamento já não está mais pago. Atualize a tela.'
        : plano.bloqueio);
    }

    const origem = tipo === 'entrada' ? await lerOrigem(tx, tenantId, dados, 'estornado') : { ref: null, dados: null };
    const banco = plano.bancoId && plano.ajusteBancoCentavos !== 0
      ? await lerBanco(tx, tenantId, plano.bancoId, 'O banco desta baixa não foi encontrado, então o saldo não pode ser corrigido.')
      : null;

    const valorCentavos = centavosDoTitulo(dados);
    resumo.descricao = String(dados.descricao || '');
    resumo.valorCentavos = valorCentavos;
    resumo.ajusteBancoCentavos = banco ? plano.ajusteBancoCentavos : 0;

    const registroDoEstorno = {
      estornadaEm: agora(),
      ultimoEstorno: {
        motivo,
        por: user.uid,
        dataPagamentoEstornada: dados.dataPagamento || null,
        formaPagamentoEstornada: dados.formaPagamento || null,
        valorCentavos,
      },
      updatedAt: agora(),
    };

    // --- escritas ---
    if (tipo === 'saida') {
      tx.update(titulo.ref, {
        status: 'Pendente',
        dataPagamento: apagar(),
        bancoId: apagar(),
        bancoNome: apagar(),
        baixaManual: apagar(),
        ...registroDoEstorno,
        ...buildDocumentUpdateMetadata(user.uid, agora(), `Pagamento estornado: ${motivo}`),
      });
    } else {
      tx.update(titulo.ref, {
        status: 'Pendente',
        // Sem forma antes da baixa (titulo importado): apaga a que a baixa
        // gravou, em vez de deixar "Pix" num titulo que ainda nao foi pago.
        formaPagamento: plano.formaAnterior ? plano.formaAnterior : apagar(),
        naturezaFinanceira: plano.naturezaAnterior,
        movimentaCaixaFisico: false,
        dataPagamento: apagar(),
        recebidoEm: apagar(),
        baixaManual: apagar(),
        ...registroDoEstorno,
        ...buildDocumentUpdateMetadata(user.uid, agora(), `Recebimento estornado: ${motivo}`),
      });
    }

    if (banco) {
      tx.update(banco.ref, {
        saldoCentavos: Number(banco.dados.saldoCentavos || 0) + plano.ajusteBancoCentavos,
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(
          user.uid,
          agora(),
          `Estorno ${tipo === 'saida' ? 'do pagamento' : 'do recebimento'} "${resumo.descricao}"`,
        ),
      });
    }

    if (origem.ref) {
      const pagamentos = Array.isArray(origem.dados.pagamentos) && origem.dados.pagamentos.length > 0
        ? origem.dados.pagamentos
        : [legacyPaymentForTransaction(pedido.transacaoId, dados)];
      const atualizados = reversePaymentReceipt(pagamentos, {
        transactionId: pedido.transacaoId,
        paymentIndex: dados.paymentIndex,
      });
      tx.update(origem.ref, {
        ...camposDoResumoDePagamentos(atualizados),
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), 'Recebimento estornado em Contas a Receber'),
      });
    }
  });

  return resumo;
};

const hojeNoBrasil = () => getDateInputInTimeZone();

module.exports = {
  ...regras,
  registrarBaixa,
  registrarEstorno,
  hojeNoBrasil,
  // Usados tambem por services/movimentoBanco.js (cartao, cheque, boleto, banco).
  agora,
  lerTitulo,
  lerOrigem,
  lerBanco,
  centavosDoTitulo,
};
