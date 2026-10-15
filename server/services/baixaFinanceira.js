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
const { centavosParaAOrigem } = require('../domain/alteracaoValorTituloDomain');
const {
  CATEGORIA_DO_ACRESCIMO,
  CATEGORIA_DO_DESCONTO,
  PERMISSAO_DESCONTO_NA_BAIXA,
  acrescimoDosAjustes,
  descricaoDosAjustes,
  erroDosAjustes,
} = require('../domain/ajustesDaBaixaDomain');
const { buildDocumentUpdateMetadata } = require('../domain/documentMetadata');
const { getDateInputInTimeZone } = require('../domain/dateTime');
const regras = require('./baixaFinanceiraRegras');
const {
  recusarSeRenegociada,
  lerRenegociacaoDoTitulo,
  quitarOrigensSeRenegociacaoPaga,
  reabrirOrigensSeRenegociacaoEstavaPaga,
} = require('./renegociacaoOrigem');

const { ErroBaixa, camposDoResumoDePagamentos, temPermissao } = regras;

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
  // Juros, multa e desconto (15/10/2026): Receber e Pagar. `acrescimoCentavos`
  // (so' juros/multa juntos) vem de pedido antigo ja' convertido em juros.
  const centavos = (v) => Math.max(0, Math.round(Number(v) || 0));
  const ajustes = {
    jurosCentavos: centavos(pedido.jurosCentavos) + (pedido.jurosCentavos === undefined && pedido.multaCentavos === undefined ? centavos(pedido.acrescimoCentavos) : 0),
    multaCentavos: centavos(pedido.multaCentavos),
    descontoCentavos: centavos(pedido.descontoCentavos),
  };
  const acrescimoCentavos = acrescimoDosAjustes(ajustes);
  const descontoCentavos = ajustes.descontoCentavos;
  if (descontoCentavos > 0 && !temPermissao(user, PERMISSAO_DESCONTO_NA_BAIXA)) {
    throw new ErroBaixa(403, erroDosAjustes(1, ajustes, { podeDescontar: false }));
  }
  const resumo = { ajustes };

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
    recusarSeRenegociada(dados);

    const origem = tipo === 'entrada' ? await lerOrigem(tx, tenantId, dados, 'recebido') : { ref: null, dados: null };
    const banco = bancoId ? await lerBanco(tx, tenantId, bancoId, 'O banco selecionado não foi encontrado. Atualize a tela e escolha de novo.') : null;
    // Parcela nova de renegociacao (15/10/2026): a ultima recebida quita as vendas/OS antigas.
    const renegociacao = tipo === 'entrada' ? await lerRenegociacaoDoTitulo(tx, tenantId, pedido.transacaoId, dados) : null;
    if (banco && banco.dados.ativo === false) {
      throw new ErroBaixa(400, `O banco "${banco.dados.nome || 'selecionado'}" está inativo. Escolha outro banco ou reative-o em Cadastros > Bancos.`);
    }

    const valorCentavos = centavosDoTitulo(dados);
    const bancoNome = banco ? (String(banco.dados.nome || '').trim() || null) : null;
    resumo.descricao = String(dados.descricao || '');
    resumo.valorCentavos = valorCentavos;
    resumo.bancoNome = bancoNome;
    resumo.acrescimoCentavos = acrescimoCentavos;
    resumo.descontoCentavos = descontoCentavos;
    const erroAjustes = erroDosAjustes(valorCentavos, ajustes, { podeDescontar: true });
    if (erroAjustes) throw new ErroBaixa(400, erroAjustes);
    // Juros/multa e desconto viram lancamentos PROPRIOS (pagos no mesmo dia),
    // ligados ao titulo nos dois sentidos: o Fluxo de Caixa ve a receita/despesa
    // e o estorno do titulo desfaz tudo (fase A 2026-10-07; desconto e Pagar 15/10/2026).
    const acrescimoRef = acrescimoCentavos > 0 ? db.collection('transacoes').doc() : null;
    const descontoRef = descontoCentavos > 0 ? db.collection('transacoes').doc() : null;
    const origemDaBaixa = tipo === 'saida' ? 'contas_pagar' : 'contas_receber';
    // Sinal do dinheiro do titulo no banco: Receber entra (+), Pagar sai (-).
    const sinal = tipo === 'entrada' ? 1 : -1;
    const marcaDosAjustes = {
      ...(acrescimoRef ? {
        acrescimoCentavos,
        acrescimoTransacaoId: acrescimoRef.id,
        jurosCentavos: ajustes.jurosCentavos,
        multaCentavos: ajustes.multaCentavos,
      } : {}),
      ...(descontoRef ? { descontoCentavos, descontoTransacaoId: descontoRef.id } : {}),
    };
    const textoDosAjustes = descricaoDosAjustes(ajustes);

    /** Lancamento da baixa (juros/multa ou desconto): pago, mesma forma, data e banco do titulo. */
    const lancamentoDaBaixa = ({ tipoDoLancamento, categoria, descricao, valor, ligacao, motivo }) => {
      const sinalDoLancamento = tipoDoLancamento === 'entrada' ? 1 : -1;
      return {
        tenantId,
        tipo: tipoDoLancamento,
        status: 'Paga',
        descricao,
        categoria,
        valor: fromCents(valor),
        valorCentavos: valor,
        data: dataPagamento,
        dataVencimento: dataPagamento,
        dataPagamento,
        formaPagamento,
        naturezaFinanceira: settledFinancialNatureForPayment(formaPagamento),
        movimentaCaixaFisico: formaPagamento === 'Dinheiro',
        ...(banco ? { bancoId, bancoNome } : {}),
        ...(tipo === 'entrada'
          ? { clienteId: dados.clienteId || null, clienteNome: dados.clienteNome || null }
          : { fornecedorId: dados.fornecedorId || null, fornecedorNome: dados.fornecedorNome || null }),
        ...(dados.vendedorId ? { vendedorId: dados.vendedorId } : {}),
        ...ligacao,
        baixaManual: montarBaixaManual({
          origem: origemDaBaixa,
          formaPagamento,
          dataPagamento,
          valorCentavos: valor,
          ...(banco ? { bancoId, movimentoBancoCentavos: sinalDoLancamento * valor } : {}),
        }),
        createdAt: agora(),
        ...(tipoDoLancamento === 'entrada' ? { recebidoEm: agora() } : {}),
        updatedAt: agora(),
        criadoPor: user.uid,
        criadoEm: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), motivo),
      };
    };

    // --- escritas ---
    if (acrescimoRef) {
      tx.set(acrescimoRef, lancamentoDaBaixa({
        tipoDoLancamento: tipo,
        categoria: CATEGORIA_DO_ACRESCIMO[tipo],
        descricao: `Juros e multa — ${resumo.descricao}`,
        valor: acrescimoCentavos,
        ligacao: { acrescimoDaTransacaoId: titulo.ref.id, jurosCentavos: ajustes.jurosCentavos, multaCentavos: ajustes.multaCentavos },
        motivo: `Juros e multa ${tipo === 'saida' ? 'do pagamento' : 'do recebimento'} "${resumo.descricao}"`,
      }));
    }
    if (descontoRef) {
      tx.set(descontoRef, lancamentoDaBaixa({
        // Desconto e' o contrario do titulo: concedido no Receber (saida), obtido no Pagar (entrada).
        tipoDoLancamento: tipo === 'entrada' ? 'saida' : 'entrada',
        categoria: CATEGORIA_DO_DESCONTO[tipo],
        descricao: `${tipo === 'entrada' ? 'Desconto concedido' : 'Desconto obtido'} — ${resumo.descricao}`,
        valor: descontoCentavos,
        ligacao: { descontoDaTransacaoId: titulo.ref.id },
        motivo: `Desconto ${tipo === 'saida' ? 'no pagamento' : 'no recebimento'} "${resumo.descricao}"`,
      }));
    }
    if (banco) {
      tx.update(banco.ref, {
        saldoCentavos: Number(banco.dados.saldoCentavos || 0) + sinal * (valorCentavos + acrescimoCentavos - descontoCentavos),
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), tipo === 'saida'
          ? `Débito da despesa "${resumo.descricao}"${textoDosAjustes ? ` (${textoDosAjustes})` : ''}`
          : `Recebimento de "${resumo.descricao}"${textoDosAjustes ? ` (${textoDosAjustes})` : ''}`),
      });
    }

    if (tipo === 'saida') {
      tx.update(titulo.ref, {
        status: 'Paga',
        formaPagamento,
        dataPagamento,
        valorCentavos,
        ...(banco ? { bancoId, bancoNome } : {}),
        baixaManual: {
          ...montarBaixaManual({
            origem: 'contas_pagar',
            formaPagamento,
            dataPagamento,
            valorCentavos,
            ...(banco ? { bancoId, movimentoBancoCentavos: -valorCentavos } : {}),
          }),
          ...marcaDosAjustes,
        },
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), textoDosAjustes ? `Pagamento confirmado com ${textoDosAjustes}` : 'Pagamento confirmado'),
      });
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
      baixaManual: {
        ...montarBaixaManual({
          origem: 'contas_receber',
          formaPagamento,
          dataPagamento,
          valorCentavos,
          ...(banco ? { bancoId, movimentoBancoCentavos: valorCentavos } : {}),
        }),
        ...marcaDosAjustes,
      },
      recebidoEm: agora(),
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), textoDosAjustes ? `Recebimento confirmado com ${textoDosAjustes}` : 'Recebimento confirmado'),
    });

    if (origem.ref) {
      const pagamentos = Array.isArray(origem.dados.pagamentos) && origem.dados.pagamentos.length > 0
        ? origem.dados.pagamentos
        : [legacyPaymentForTransaction(pedido.transacaoId, dados)];
      const atualizados = applyPaymentReceipt(pagamentos, {
        transactionId: pedido.transacaoId,
        paymentIndex: dados.paymentIndex,
        // Parcela com valor alterado (boleto com desconto): quita o pagamento inteiro da venda.
        amountCents: centavosParaAOrigem(pagamentos, {
          transactionId: pedido.transacaoId,
          paymentIndex: dados.paymentIndex,
          titulo: dados,
          recebidoCentavos: valorCentavos,
          tituloQuitado: true,
        }),
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
    resumo.quitouRenegociacao = quitarOrigensSeRenegociacaoPaga(tx, user, renegociacao, dataPagamento);
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
    // Parcela nova de renegociacao ja' quitada: as vendas/OS antigas voltam a ficar pendentes.
    const renegociacao = tipo === 'entrada' ? await lerRenegociacaoDoTitulo(tx, tenantId, pedido.transacaoId, dados) : null;
    const banco = plano.bancoId && plano.ajusteBancoCentavos !== 0
      ? await lerBanco(tx, tenantId, plano.bancoId, 'O banco desta baixa não foi encontrado, então o saldo não pode ser corrigido.')
      : null;

    const valorCentavos = centavosDoTitulo(dados);
    resumo.descricao = String(dados.descricao || '');
    resumo.valorCentavos = valorCentavos;
    resumo.ajusteBancoCentavos = banco ? plano.ajusteBancoCentavos : 0;

    // Juros/multa e desconto gravados junto da baixa (lancamentos proprios): saem junto.
    // Cancela em qualquer situacao que nao 'Cancelada'; o banco so' volta o que
    // ainda estava la' (status 'Paga', mesmo banco).
    const lerLancamentoDaBaixa = async (campo) => {
      const id = dados.baixaManual && dados.baixaManual[campo] ? String(dados.baixaManual[campo]) : '';
      const snap = id ? await tx.get(db.collection('transacoes').doc(id)) : null;
      return snap && snap.exists && snap.data().tenantId === tenantId && snap.data().status !== 'Cancelada'
        ? { ref: db.collection('transacoes').doc(id), centavos: Number(snap.data().valorCentavos) || 0, bancoId: snap.data().bancoId || null, pago: snap.data().status === 'Paga' }
        : null;
    };
    const acrescimo = await lerLancamentoDaBaixa('acrescimoTransacaoId');
    const desconto = await lerLancamentoDaBaixa('descontoTransacaoId');
    const noBanco = (l) => (l && l.pago && banco && l.bancoId === banco.ref.id ? l.centavos : 0);
    const acrescimoNoBancoCentavos = noBanco(acrescimo);
    const descontoNoBancoCentavos = noBanco(desconto);
    resumo.acrescimoCentavos = acrescimo ? acrescimo.centavos : 0;
    resumo.descontoCentavos = desconto ? desconto.centavos : 0;

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

    const daBaixa = tipo === 'saida' ? 'do pagamento' : 'do recebimento';
    if (acrescimo) {
      tx.update(acrescimo.ref, {
        status: 'Cancelada',
        motivoCancelamento: `Estorno ${daBaixa} de origem: ${motivo}`,
        canceladaEm: agora(),
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), `Juros e multa estornados junto ${tipo === 'saida' ? 'com o pagamento' : 'com o recebimento'}`),
      });
    }
    if (desconto) {
      tx.update(desconto.ref, {
        status: 'Cancelada',
        motivoCancelamento: `Estorno ${daBaixa} de origem: ${motivo}`,
        canceladaEm: agora(),
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), `Desconto estornado junto ${tipo === 'saida' ? 'com o pagamento' : 'com o recebimento'}`),
      });
    }

    if (banco) {
      // Receber: juros tinham entrado e o desconto saido; Pagar, o contrario.
      const sinal = tipo === 'entrada' ? 1 : -1;
      tx.update(banco.ref, {
        saldoCentavos: Number(banco.dados.saldoCentavos || 0) + plano.ajusteBancoCentavos - sinal * acrescimoNoBancoCentavos + sinal * descontoNoBancoCentavos,
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
    reabrirOrigensSeRenegociacaoEstavaPaga(tx, user, renegociacao, motivo);
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
  apagar,
  lerTitulo,
  lerOrigem,
  lerBanco,
  centavosDoTitulo,
};
