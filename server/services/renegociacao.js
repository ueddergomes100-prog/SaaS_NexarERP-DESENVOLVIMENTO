/*
 * RENEGOCIACAO DE PARCELAS A RECEBER, NO SERVIDOR (15/10/2026).
 *
 * Criar: as parcelas antigas (em aberto, de um cliente so') viram
 * "Renegociada" e nascem as parcelas novas (1 ou mais), tudo numa transacao.
 * Desfazer: as novas sao canceladas -- as que ja' tinham sido recebidas tem o
 * recebimento estornado (banco e juros/multa voltam, como no Estornar) --, as
 * antigas voltam para em aberto e, se a renegociacao ja' estava paga, as
 * vendas/OS voltam a mostrar os pagamentos como pendentes.
 *
 * Regras e mensagens: src/utils/renegociacaoDomain.ts (compilado para
 * server/domain/). Ligacao com as vendas/OS: services/renegociacaoOrigem.js.
 */
const { db } = require('../config/firebase');
const { fromCents, financialNatureForPayment } = require('../domain/financeDomain');
const { planejarEstornoReceber } = require('../domain/baixaFinanceiraDomain');
const {
  STATUS_RENEGOCIADA,
  centavosDoTituloRenegociado,
  descricaoDaParcelaNova,
  origemDoTitulo,
  origensDaRenegociacao,
  validarFormaRenegociacao,
  validarMotivoRenegociacao,
  validarParcelasNovas,
  validarTitulosParaRenegociar,
  LIMITE_TITULOS_RENEGOCIACAO,
  LIMITE_PARCELAS_RENEGOCIACAO,
} = require('../domain/renegociacaoDomain');
const { buildDocumentMetadata, buildDocumentUpdateMetadata } = require('../domain/documentMetadata');
const { ErroBaixa, agora, apagar, lerTitulo, lerBanco } = require('./baixaFinanceira');
const { reabrirOrigens } = require('./renegociacaoOrigem');

const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;

/** Confere o pedido de renegociacao que veio do navegador. Puro. `{ erro }` ou `{ pedido }`. */
const validarPedidoDeRenegociacao = (corpo, hoje) => {
  const ids = Array.isArray(corpo?.transacaoIds) ? corpo.transacaoIds.map((id) => String(id || '').trim()) : [];
  if (ids.length === 0) return { erro: 'Selecione as parcelas em aberto que vão ser renegociadas.' };
  if (ids.length > LIMITE_TITULOS_RENEGOCIACAO) return { erro: `Renegocie no máximo ${LIMITE_TITULOS_RENEGOCIACAO} parcelas de uma vez.` };
  if (ids.some((id) => !ID_VALIDO.test(id))) return { erro: 'Parcela inválida. Atualize a tela e tente de novo.' };
  if (new Set(ids).size !== ids.length) return { erro: 'A mesma parcela apareceu duas vezes. Atualize a tela e selecione de novo.' };

  const brutas = Array.isArray(corpo?.parcelas) ? corpo.parcelas : [];
  if (brutas.length === 0) return { erro: 'Informe ao menos uma parcela nova.' };
  if (brutas.length > LIMITE_PARCELAS_RENEGOCIACAO) return { erro: `A renegociação pode ter no máximo ${LIMITE_PARCELAS_RENEGOCIACAO} parcelas.` };
  const parcelas = brutas.map((p) => ({ valorCentavos: Number(p?.valorCentavos), vencimento: String(p?.vencimento || '').trim() }));
  // O total das antigas so' e' conhecido no banco; aqui so' a forma das parcelas.
  const erroParcelas = validarParcelasNovas(parcelas, Number.MAX_SAFE_INTEGER / 4, hoje);
  if (erroParcelas) return { erro: erroParcelas };

  const erroForma = validarFormaRenegociacao(corpo?.formaPagamento);
  if (erroForma) return { erro: erroForma };
  const erroMotivo = validarMotivoRenegociacao(corpo?.motivo);
  if (erroMotivo) return { erro: erroMotivo };

  return {
    pedido: {
      transacaoIds: ids,
      parcelas,
      formaPagamento: String(corpo.formaPagamento),
      motivo: String(corpo.motivo).trim(),
    },
  };
};

/** Le a venda/OS de cada parcela antiga: venda/OS cancelada nao entra em renegociacao. */
const conferirOrigensAtivas = async (tx, tenantId, origens) => {
  for (const origem of origens) {
    const snap = await tx.get(db.collection(origem.colecao).doc(origem.id));
    if (!snap.exists || snap.data().tenantId !== tenantId) continue;
    if (snap.data().status === 'Cancelada') {
      throw new ErroBaixa(400, origem.colecao === 'pedidos_venda'
        ? 'Uma das parcelas é de uma venda cancelada e não pode ser renegociada. Atualize a tela.'
        : 'Uma das parcelas é de uma OS cancelada e não pode ser renegociada. Atualize a tela.');
    }
  }
};

const criarRenegociacao = async ({ user, tenantId, pedido, hoje }) => {
  const renegociacaoId = `reneg_${db.collection('transacoes').doc().id}`;
  const idsNovos = pedido.parcelas.map((_, i) => `${renegociacaoId}_p${i + 1}`);
  const resumo = { renegociacaoId };

  await db.runTransaction(async (tx) => {
    // --- leituras ---
    const antigos = [];
    for (const transacaoId of pedido.transacaoIds) {
      const titulo = await lerTitulo(tx, tenantId, { transacaoId, tipo: 'entrada' });
      antigos.push({ id: transacaoId, ref: titulo.ref, dados: { ...titulo.dados, id: transacaoId } });
    }
    const erroTitulos = validarTitulosParaRenegociar(antigos.map((a) => a.dados));
    if (erroTitulos) throw new ErroBaixa(antigos.some((a) => a.dados.status === 'Paga') ? 409 : 400, erroTitulos);

    const titulosOrigem = antigos.map((a) => origemDoTitulo(a.id, a.dados));
    await conferirOrigensAtivas(tx, tenantId, origensDaRenegociacao(titulosOrigem));

    const totalOrigemCentavos = antigos.reduce((soma, a) => soma + centavosDoTituloRenegociado(a.dados), 0);
    const erroParcelas = validarParcelasNovas(pedido.parcelas, totalOrigemCentavos, hoje);
    if (erroParcelas) throw new ErroBaixa(400, erroParcelas);
    const totalNovoCentavos = pedido.parcelas.reduce((soma, p) => soma + p.valorCentavos, 0);

    const base = antigos[0].dados;
    const clienteId = base.clienteId || null;
    const clienteNome = base.clienteNome || null;
    resumo.clienteNome = clienteNome || 'cliente';
    resumo.quantidadeAntigas = antigos.length;
    resumo.totalOrigemCentavos = totalOrigemCentavos;
    resumo.totalNovoCentavos = totalNovoCentavos;
    resumo.quantidadeNovas = pedido.parcelas.length;

    const registroBase = {
      id: renegociacaoId,
      totalParcelas: pedido.parcelas.length,
      titulosOrigem,
      titulosNovos: idsNovos,
      totalOrigemCentavos,
      totalNovoCentavos,
      motivo: pedido.motivo,
      porUid: user.uid,
      ...(user.email ? { porEmail: user.email } : {}),
    };

    // --- escritas ---
    pedido.parcelas.forEach((parcela, i) => {
      tx.set(db.collection('transacoes').doc(idsNovos[i]), {
        tenantId,
        tipo: 'entrada',
        status: 'Pendente',
        descricao: descricaoDaParcelaNova(i + 1, pedido.parcelas.length),
        categoria: 'Renegociação',
        valor: fromCents(parcela.valorCentavos),
        valorCentavos: parcela.valorCentavos,
        valorBruto: fromCents(parcela.valorCentavos),
        valorBrutoCentavos: parcela.valorCentavos,
        valorTaxa: 0,
        valorTaxaCentavos: 0,
        valorLiquido: fromCents(parcela.valorCentavos),
        valorLiquidoCentavos: parcela.valorCentavos,
        formaPagamento: pedido.formaPagamento,
        condicaoPagamento: 'aprazo',
        naturezaFinanceira: financialNatureForPayment(pedido.formaPagamento),
        movimentaCaixaFisico: false,
        data: parcela.vencimento,
        dataVencimento: parcela.vencimento,
        dataPrevistaRecebimento: parcela.vencimento,
        clienteId,
        clienteNome,
        ...(base.vendedorId ? { vendedorId: base.vendedorId } : {}),
        renegociacao: { ...registroBase, parcela: i + 1, em: agora() },
        idempotencyKey: `renegociacao:${renegociacaoId}:parcela:${i + 1}`,
        createdAt: agora(),
        updatedAt: agora(),
        criadoPor: user.uid,
        ...buildDocumentMetadata(user.uid, agora()),
      });
    });
    antigos.forEach((a) => {
      tx.update(a.ref, {
        status: STATUS_RENEGOCIADA,
        renegociacaoId,
        renegociadaEm: agora(),
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), `Renegociada: ${pedido.motivo}`),
      });
    });
  });

  return resumo;
};

/** Confere o pedido de desfazer. Puro. */
const validarPedidoDeDesfazer = (corpo) => {
  const transacaoId = String(corpo?.transacaoId || '').trim();
  if (!ID_VALIDO.test(transacaoId)) return { erro: 'Parcela inválida. Atualize a tela e tente de novo.' };
  const erroMotivo = validarMotivoRenegociacao(corpo?.motivo, 'desfazer');
  if (erroMotivo) return { erro: erroMotivo };
  return { pedido: { transacaoId, motivo: String(corpo.motivo).trim() } };
};

/** Desfaz a renegociacao a partir de QUALQUER parcela nova dela. Tudo ou nada. */
const desfazerRenegociacao = async ({ user, tenantId, pedido }) => {
  const resumo = { estornadas: 0, retiradoDoBancoCentavos: 0 };

  await db.runTransaction(async (tx) => {
    // --- leituras ---
    const inicial = await lerTitulo(tx, tenantId, { transacaoId: pedido.transacaoId, tipo: 'entrada' });
    const registro = inicial.dados.renegociacao;
    if (!registro || !registro.id || !Array.isArray(registro.titulosNovos)) {
      throw new ErroBaixa(400, 'Esta parcela não é de uma renegociação.');
    }
    resumo.renegociacaoId = registro.id;

    const novos = [];
    for (const id of registro.titulosNovos) {
      const titulo = await lerTitulo(tx, tenantId, { transacaoId: String(id), tipo: 'entrada' });
      if (titulo.dados.status === 'Cancelada') {
        throw new ErroBaixa(409, 'Esta renegociação já foi desfeita (as parcelas novas estão canceladas). Atualize a tela.');
      }
      novos.push({ id: String(id), ...titulo });
    }

    // Parcela nova ja' recebida: o recebimento e' estornado junto (mesma regra do Estornar).
    const pagos = [];
    for (const novo of novos.filter((n) => n.dados.status === 'Paga')) {
      const plano = planejarEstornoReceber(novo.dados);
      if (!plano.permitido) {
        throw new ErroBaixa(400, `A parcela "${novo.dados.descricao || novo.id}" já foi recebida e o recebimento não pode ser desfeito por aqui: ${plano.bloqueio}`);
      }
      const acrescimoId = novo.dados.baixaManual && novo.dados.baixaManual.acrescimoTransacaoId ? String(novo.dados.baixaManual.acrescimoTransacaoId) : '';
      const acrescimoSnap = acrescimoId ? await tx.get(db.collection('transacoes').doc(acrescimoId)) : null;
      const acrescimo = acrescimoSnap && acrescimoSnap.exists && acrescimoSnap.data().tenantId === tenantId && acrescimoSnap.data().status !== 'Cancelada'
        ? { ref: db.collection('transacoes').doc(acrescimoId),centavos: Number(acrescimoSnap.data().valorCentavos) || 0, bancoId: acrescimoSnap.data().bancoId || null, pago: acrescimoSnap.data().status === 'Paga' }
        : null;
      pagos.push({ novo, plano, acrescimo });
    }

    // Saldo de cada banco mexido, lido uma vez so'.
    const ajustesPorBanco = new Map();
    pagos.forEach(({ plano, acrescimo }) => {
      if (plano.bancoId && plano.ajusteBancoCentavos !== 0) {
        ajustesPorBanco.set(plano.bancoId, (ajustesPorBanco.get(plano.bancoId) || 0) + plano.ajusteBancoCentavos);
        if (acrescimo && acrescimo.pago && acrescimo.bancoId === plano.bancoId) {
          ajustesPorBanco.set(plano.bancoId, ajustesPorBanco.get(plano.bancoId) - acrescimo.centavos);
        }
      }
    });
    const bancos = [];
    for (const [bancoId, ajuste] of ajustesPorBanco) {
      const banco = await lerBanco(tx, tenantId, String(bancoId), 'O banco de um recebimento desta renegociação não foi encontrado, então o saldo não pode ser corrigido.');
      bancos.push({ ...banco, ajuste });
    }

    const antigos = [];
    for (const origem of Array.isArray(registro.titulosOrigem) ? registro.titulosOrigem : []) {
      const titulo = await lerTitulo(tx, tenantId, { transacaoId: String(origem.id), tipo: 'entrada' });
      if (titulo.dados.status !== STATUS_RENEGOCIADA) {
        throw new ErroBaixa(409, `A parcela antiga "${titulo.dados.descricao || origem.id}" não está mais como renegociada. Atualize a tela e fale com o suporte se continuar.`);
      }
      antigos.push(titulo);
    }

    // As vendas/OS so' foram quitadas se TODAS as parcelas novas estavam recebidas.
    const estavaQuitada = novos.every((n) => n.dados.status === 'Paga');
    const origens = [];
    if (estavaQuitada) {
      for (const origem of origensDaRenegociacao(Array.isArray(registro.titulosOrigem) ? registro.titulosOrigem : [])) {
        const ref = db.collection(origem.colecao).doc(origem.id);
        const snap = await tx.get(ref);
        if (snap.exists && snap.data().tenantId === tenantId) origens.push({ ref, dados: snap.data(), titulos: origem.titulos });
      }
    }

    // --- escritas ---
    const motivoCancelamento = `Renegociação desfeita: ${pedido.motivo}`;
    novos.forEach((novo) => {
      const pago = pagos.find((p) => p.novo.id === novo.id);
      tx.update(novo.ref, {
        status: 'Cancelada',
        canceladaEm: agora(),
        motivoCancelamento,
        ...(pago ? {
          estornadaEm: agora(),
          ultimoEstorno: {
            motivo: motivoCancelamento,
            por: user.uid,
            dataPagamentoEstornada: novo.dados.dataPagamento || null,
            formaPagamentoEstornada: novo.dados.formaPagamento || null,
            valorCentavos: centavosDoTituloRenegociado(novo.dados),
          },
        } : {}),
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), motivoCancelamento),
      });
    });
    pagos.forEach(({ acrescimo }) => {
      if (!acrescimo) return;
      tx.update(acrescimo.ref, {
        status: 'Cancelada',
        motivoCancelamento: `Juros e multa de parcela da renegociação desfeita: ${pedido.motivo}`,
        canceladaEm: agora(),
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), 'Juros e multa estornados junto com a renegociação desfeita'),
      });
    });
    bancos.forEach((banco) => {
      tx.update(banco.ref, {
        saldoCentavos: Number(banco.dados.saldoCentavos || 0) + banco.ajuste,
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), `Estorno dos recebimentos da renegociação desfeita`),
      });
      resumo.retiradoDoBancoCentavos += -banco.ajuste;
    });
    antigos.forEach((antigo) => {
      tx.update(antigo.ref, {
        status: 'Pendente',
        renegociacaoId: apagar(),
        renegociadaEm: apagar(),
        renegociacaoDesfeita: { id: registro.id, motivo: pedido.motivo, por: user.uid, em: agora() },
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), `Voltou para em aberto: ${motivoCancelamento}`),
      });
    });
    if (estavaQuitada) reabrirOrigens(tx, user, origens, `Pagamento voltou a ficar pendente: ${motivoCancelamento}`);

    resumo.estornadas = pagos.length;
    resumo.quantidadeNovas = novos.length;
    resumo.quantidadeAntigas = antigos.length;
    resumo.clienteNome = inicial.dados.clienteNome || 'cliente';
  });

  return resumo;
};

module.exports = {
  validarPedidoDeRenegociacao,
  criarRenegociacao,
  validarPedidoDeDesfazer,
  desfazerRenegociacao,
};
