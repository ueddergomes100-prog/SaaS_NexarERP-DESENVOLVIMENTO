const express = require('express');
const { authenticate } = require('../middleware/auth');
const { admin, db } = require('../config/firebase');
const { canUseFiscal, resolveTenantId, loadSpedyConfig } = require('../services/spedyAcesso');
const {
  CFOPS_DEVOLUCAO_PERMITIDOS,
  montarPayloadDevolucao,
  notaVigenteDaDevolucao,
  prepararDevolucao,
} = require('../services/devolucaoNfe');

const router = express.Router();
router.use(authenticate);

/**
 * NF-e DE DEVOLUCAO DE VENDA -- ver services/devolucaoNfe.js.
 *
 * A tela manda so' QUAL devolucao (e, se preciso, qual nota original e o CFOP
 * escolhido). Tudo o mais -- itens, quantidades, valores, impostos, chave da
 * nota original, destinatario -- e' lido do banco aqui, nunca do corpo da
 * requisicao: assim nao da' pra emitir devolucao de item que nao foi vendido,
 * com valor inflado ou referenciando nota de outra empresa.
 */

class ErroDevolucao extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const responderErro = (res, erro, operacao) => {
  if (erro instanceof ErroDevolucao) return res.status(erro.status).json({ error: erro.message });
  console.error(`[Devolucao NF-e] ${operacao}:`, erro);
  return res.status(erro.status || 500).json({
    error: erro.message || 'Não foi possível concluir a operação. Tente novamente em instantes.'
  });
};

const carregarCliente = async (tenantId, pedido) => {
  if (pedido.clienteId) {
    const snap = await db.collection('clientes').doc(pedido.clienteId).get();
    if (snap.exists && snap.data().tenantId === tenantId) return { id: snap.id, ...snap.data() };
  }
  if (pedido.clienteNome) {
    const porNome = await db.collection('clientes')
      .where('tenantId', '==', tenantId)
      .where('nome', '==', String(pedido.clienteNome).toUpperCase())
      .limit(1)
      .get();
    if (!porNome.empty) return { id: porNome.docs[0].id, ...porNome.docs[0].data() };
  }
  return null;
};

/** Le tudo o que a devolucao precisa e devolve o resultado de prepararDevolucao. */
const carregarEPreparar = async (req) => {
  if (!canUseFiscal(req.user, 'emit')) throw new ErroDevolucao(403, 'Acesso negado ao módulo fiscal.');

  const devolucaoId = String(req.body?.devolucaoId || '').trim();
  if (!devolucaoId) throw new ErroDevolucao(400, 'Informe qual devolução deve gerar a nota.');
  const tenantId = resolveTenantId(req);

  const devolucaoSnap = await db.collection('devolucoes_venda').doc(devolucaoId).get();
  if (!devolucaoSnap.exists || devolucaoSnap.data().tenantId !== tenantId) {
    throw new ErroDevolucao(404, 'Devolução não encontrada.');
  }
  const devolucao = { id: devolucaoSnap.id, ...devolucaoSnap.data() };
  if (devolucao.status && devolucao.status !== 'concluida') {
    throw new ErroDevolucao(400, 'Só uma devolução concluída pode gerar nota fiscal.');
  }

  const pedidoSnap = await db.collection('pedidos_venda').doc(devolucao.pedidoVendaId).get();
  if (!pedidoSnap.exists || pedidoSnap.data().tenantId !== tenantId) {
    throw new ErroDevolucao(404, 'O pedido desta devolução não foi encontrado.');
  }
  const pedido = { id: pedidoSnap.id, ...pedidoSnap.data() };

  const notasSnap = await db.collection('notas_fiscais')
    .where('tenantId', '==', tenantId)
    .where('pedidoId', '==', pedido.id)
    .get();
  const notas = notasSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  // Notas de DEVOLUCAO ficam ligadas por `devolucaoId` (nao por `pedidoId`, que as
  // telas de venda leem como "a nota deste pedido").
  const notasDevolucaoSnap = await db.collection('notas_fiscais')
    .where('tenantId', '==', tenantId)
    .where('devolucaoId', '==', devolucao.id)
    .get();
  const notasDevolucao = notasDevolucaoSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const cliente = await carregarCliente(tenantId, pedido);

  const cfopEscolhido = {};
  for (const [itemNumber, cfop] of Object.entries(req.body?.cfopEscolhido || {})) {
    cfopEscolhido[Number(itemNumber)] = Number(cfop);
  }

  const preparo = prepararDevolucao({
    devolucao,
    pedido,
    notas,
    cliente,
    notaOriginalId: req.body?.notaOriginalId || null,
    cfopEscolhido,
  });
  return { tenantId, devolucao, pedido, cliente, preparo, notasDevolucao };
};

/** Previa: monta tudo e mostra, sem emitir nem gravar nada. */
router.post('/previa', async (req, res) => {
  try {
    const { devolucao, preparo, notasDevolucao } = await carregarEPreparar(req);
    const vigente = notaVigenteDaDevolucao(devolucao, notasDevolucao);
    if (vigente) {
      return res.json({
        ok: false,
        jaEmitida: vigente,
        erros: ['Esta devolução já tem uma NF-e de devolução em andamento ou autorizada. Confira em Notas Fiscais.'],
        avisos: [],
        candidatas: [],
        precisaCfop: [],
        cfopsPermitidos: CFOPS_DEVOLUCAO_PERMITIDOS,
      });
    }
    // Nao devolve a nota original inteira nem o receiver completo: so' o que a tela mostra.
    return res.json({
      ok: preparo.ok,
      erros: preparo.erros,
      avisos: preparo.avisos,
      candidatas: preparo.candidatas,
      notaOriginal: preparo.notaOriginal ?? null,
      precisaCfop: preparo.precisaCfop ?? [],
      cfopsPermitidos: CFOPS_DEVOLUCAO_PERMITIDOS,
      valorTotal: preparo.valorTotal ?? null,
      destinatario: preparo.receiver ? { nome: preparo.receiver.name, documento: preparo.receiver.federalTaxNumber } : null,
      itens: (preparo.itens || []).map((i) => ({
        itemNumber: i.sourceDocument.itemNumber,
        descricao: i.description,
        quantidade: i.quantity,
        unidade: i.unit,
        valorUnitario: i.unitAmount,
        valorTotal: i.totalAmount,
        cfop: i.cfop,
        icmsValor: i.taxes?.icms?.amount ?? null,
      })),
    });
  } catch (erro) {
    return responderErro(res, erro, 'previa');
  }
});

/** Emite a NF-e de devolucao na Spedy e guarda a nota local + o vinculo na devolucao. */
router.post('/emitir', async (req, res) => {
  let reservou = false;
  let devolucaoRef = null;
  try {
    const { tenantId, devolucao, pedido, cliente, preparo, notasDevolucao } = await carregarEPreparar(req);
    if (notaVigenteDaDevolucao(devolucao, notasDevolucao)) {
      throw new ErroDevolucao(409, 'Esta devolução já tem uma NF-e de devolução em andamento ou autorizada. Confira em Notas Fiscais.');
    }
    if (!preparo.ok) {
      const motivo = preparo.erros[0]
        || (preparo.precisaCfop?.length ? 'Escolha o CFOP da devolução dos itens indicados antes de emitir.' : 'A devolução não pode ser emitida.');
      throw new ErroDevolucao(422, motivo);
    }
    const { apiKey, baseUrl } = await loadSpedyConfig(tenantId);

    devolucaoRef = db.collection('devolucoes_venda').doc(devolucao.id);
    // Reserva a devolucao (uma nota por vez): duplo clique ou duas telas nao geram nota dupla.
    const tentativa = await db.runTransaction(async (tx) => {
      const snap = await tx.get(devolucaoRef);
      const atual = snap.data();
      const ultima = atual.notaFiscalDevolucao;
      // Outra requisicao pode ter reservado/emitido entre a leitura la' em cima e aqui.
      let notaAnterior = null;
      if (ultima?.notaId) {
        const notaSnap = await tx.get(db.collection('notas_fiscais').doc(ultima.notaId));
        if (notaSnap.exists) notaAnterior = { id: notaSnap.id, ...notaSnap.data() };
      }
      const vigente = notaVigenteDaDevolucao({ id: devolucaoRef.id, ...atual }, notaAnterior ? [notaAnterior] : []);
      if (vigente) throw new ErroDevolucao(409, 'Esta devolução já tem uma NF-e de devolução em andamento ou autorizada. Confira em Notas Fiscais.');
      const proxima = Number(atual.tentativasNotaFiscal || 0) + 1;
      tx.update(devolucaoRef, {
        notaFiscalDevolucao: { status: 'reservada', tentativa: proxima, reservadoPor: req.user.uid, reservadoEmMs: Date.now() },
        tentativasNotaFiscal: proxima,
      });
      return proxima;
    });
    reservou = true;

    const integrationId = tentativa === 1 ? `dev-${devolucao.id}` : `dev-${devolucao.id}-t${tentativa}`;
    const payload = montarPayloadDevolucao({
      integrationId,
      receiver: preparo.receiver,
      itens: preparo.itens,
      notaOriginal: preparo.notaOriginalCompleta,
    });

    const response = await fetch(`${baseUrl}/product-invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify(payload)
    });
    const notaSpedy = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ErroDevolucao(response.status, notaSpedy.errors?.[0]?.message || notaSpedy.error || 'A Spedy recusou a nota de devolução.');
    }

    // A partir daqui a nota EXISTE na Spedy: falha ao gravar nao pode virar "nao emitida".
    try {
      const agora = admin.firestore.FieldValue.serverTimestamp();
      const nova = db.collection('notas_fiscais').doc();
      await nova.set({
        spedyId: notaSpedy.id,
        number: notaSpedy.number ?? null,
        accessKey: notaSpedy.accessKey || null,
        tipo: 'NF-e',
        finalidade: 'devolucao',
        // NAO grava `pedidoId`: as telas de venda leem esse campo como "a nota do pedido".
        pedidoOrigemId: pedido.id,
        devolucaoId: devolucao.id,
        notaOriginalId: preparo.notaOriginal.id,
        notaOriginalChave: preparo.notaOriginal.chave,
        notaOriginalNumero: preparo.notaOriginal.numero,
        clienteNome: preparo.receiver.name,
        clienteId: cliente?.id || null,
        valor: preparo.valorTotal,
        itensFiscais: preparo.itens,
        status: notaSpedy.status || 'enqueued',
        processingMessage: notaSpedy.processingDetail?.message || null,
        processingCode: notaSpedy.processingDetail?.code || null,
        tentativaEmissao: tentativa,
        tenantId,
        createdAt: agora,
        data: new Date().toISOString(),
        criadoPor: req.user.uid,
        criadoEm: agora,
        alteradoPor: req.user.uid,
        alteradoEm: agora,
      });
      await devolucaoRef.update({
        notaFiscalDevolucao: {
          notaId: nova.id,
          spedyId: notaSpedy.id,
          status: notaSpedy.status || 'enqueued',
          tentativa,
        },
        alteradoPor: req.user.uid,
        alteradoEm: agora,
      });
      reservou = false;
      return res.json({
        ok: true,
        notaId: nova.id,
        nota: {
          id: notaSpedy.id,
          status: notaSpedy.status || 'enqueued',
          number: notaSpedy.number ?? null,
          accessKey: notaSpedy.accessKey || null,
          processingDetail: notaSpedy.processingDetail || null,
        },
      });
    } catch (erroGravacao) {
      console.error('[Devolucao NF-e] nota enviada, mas falhou ao gravar:', erroGravacao);
      reservou = false; // a reserva fica: nao ha como emitir de novo sem duplicar
      throw new ErroDevolucao(500, 'A Spedy recebeu a nota de devolução, mas o sistema não conseguiu guardá-la na lista. Não emita de novo: avise o suporte para conferirmos a nota no painel da Spedy.');
    }
  } catch (erro) {
    if (reservou && devolucaoRef) {
      // Falhou ANTES da Spedy aceitar: libera a devolucao pra uma nova tentativa.
      await devolucaoRef.update({ notaFiscalDevolucao: admin.firestore.FieldValue.delete() }).catch((e) => console.error('[Devolucao NF-e] nao liberou a reserva:', e.message));
    }
    return responderErro(res, erro, 'emitir');
  }
});

module.exports = router;
