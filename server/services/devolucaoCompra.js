/*
 * DEVOLUCAO DE COMPRA AO FORNECEDOR PELO SERVIDOR (21/10/2026).
 * Regra em src/utils/devolucaoCompraDomain.ts (decisoes do dono la').
 *
 * registrar: numa transacao so', com todas as leituras antes das escritas --
 *   tira do estoque (e dos lotes que a entrada criou), abate as parcelas em
 *   aberto da nota, cria a conta a receber do fornecedor pelo que ja' estava
 *   pago, marca o quanto de cada item foi devolvido na nota de entrada e grava
 *   a devolucao (`devolucoes_compra`, colecao so' do servidor).
 * emitir: monta a NF-e de devolucao a partir do que esta' GRAVADO (devolucao,
 *   nota de entrada e o XML dela, cadastro do fornecedor), reserva a devolucao
 *   (uma nota por vez), manda a Spedy e grava a nota em `notas_fiscais`.
 *
 * Nada vem do corpo alem de qual nota/itens/quantidades/motivo: valor, CFOP,
 * impostos e destinatario sao lidos do banco.
 */
const { admin, db } = require('../config/firebase');
const { loadSpedyConfig } = require('./spedyAcesso');
const { fetchComTimeout, PERFIS } = require('../utils/fetchComTimeout');
const dc = require('../domain/devolucaoCompraDomain');
const { parseNfeXml } = require('../domain/nfeXmlDomain');
const { descompactarXml } = require('../domain/xmlCompactoDomain');
const { usesCsosn, DEFAULT_REGIME_TRIBUTARIO } = require('../domain/fiscalDomain');
const { buildDocumentMetadata, buildDocumentUpdateMetadata } = require('../domain/documentMetadata');
const { getDateInputInTimeZone } = require('../domain/dateTime');

class ErroDevolucaoCompra extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const COLECAO = 'devolucoes_compra';
const agora = () => admin.firestore.FieldValue.serverTimestamp();
const reais = (centavos) => `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`;

const lerNota = (snap, tenantId) => {
  if (!snap.exists || snap.data().tenantId !== tenantId) throw new ErroDevolucaoCompra(404, 'Nota de entrada não encontrada. Atualize a lista.');
  const nota = snap.data();
  if (nota.status === 'excluida') throw new ErroDevolucaoCompra(409, 'Esta nota de entrada foi excluída: não há o que devolver.');
  return nota;
};

// ===========================================================================
// REGISTRAR
// ===========================================================================

const registrar = async ({ user, tenantId, corpo }) => {
  const lido = dc.lerPedidoDeDevolucaoCompra(corpo);
  if ('erro' in lido) throw new ErroDevolucaoCompra(400, lido.erro);
  const pedido = lido.pedido;
  const notaRef = db.collection('notas_fiscais_entrada').doc(pedido.notaEntradaId);
  const devolucaoRef = db.collection(COLECAO).doc();
  const hoje = getDateInputInTimeZone();

  return db.runTransaction(async (tx) => {
    // ---------------- LEITURAS ----------------
    const nota = lerNota(await tx.get(notaRef), tenantId);
    const itensEntrada = Array.isArray(nota.itens) ? nota.itens : [];
    const plano = dc.planejarItensDaDevolucao({ itens: itensEntrada, pedido: pedido.itens, jaDevolvido: nota.devolvidoPorItem || {} });
    if ('erro' in plano) throw new ErroDevolucaoCompra(409, plano.erro);

    // Estoque de cada item (estoque, materias_primas ou insumos).
    const refsDoEstoque = plano.itens.map((i) => db.collection(dc.COLECAO_DO_TIPO[i.tipo]).doc(i.itemId || '-'));
    const snapsDoEstoque = refsDoEstoque.length ? await tx.getAll(...refsDoEstoque) : [];
    // Lotes que a entrada criou (so' produto que controla lote).
    const idsDosLotes = [...new Set(plano.itens.flatMap((i) => (itensEntrada[i.indice].lotes || []).map((l) => l.loteId)).filter(Boolean))];
    const snapsDosLotes = idsDosLotes.length ? await tx.getAll(...idsDosLotes.map((id) => db.collection('estoque_lotes').doc(id))) : [];
    // Parcelas da nota.
    const idsDosTitulos = Array.isArray(nota.titulosPagarIds) ? nota.titulosPagarIds.filter(Boolean) : [];
    const snapsDosTitulos = idsDosTitulos.length ? await tx.getAll(...idsDosTitulos.map((id) => db.collection('transacoes').doc(id))) : [];

    // ---------------- CONTAS ----------------
    const escritasDeEstoque = [];
    plano.itens.forEach((item, k) => {
      const snap = snapsDoEstoque[k];
      if (!snap.exists || snap.data().tenantId !== tenantId) {
        throw new ErroDevolucaoCompra(409, `${item.nome}: o cadastro deste item não existe mais no estoque. Não dá para devolver o que não está cadastrado.`);
      }
      const atual = Number(snap.data().quantidade || 0);
      if (atual + 1e-9 < item.quantidadeEstoque) {
        throw new ErroDevolucaoCompra(409, `${item.nome} tem só ${atual} em estoque; a devolução tira ${item.quantidadeEstoque}. Ajuste a quantidade a devolver.`);
      }
      escritasDeEstoque.push([refsDoEstoque[k], Number((atual - item.quantidadeEstoque).toFixed(6))]);
    });

    const saldoDosLotes = {};
    snapsDosLotes.forEach((s) => {
      if (s.exists && s.data().tenantId === tenantId) saldoDosLotes[s.id] = Number(s.data().quantidade || 0);
    });
    const escritasDeLote = new Map();
    for (const item of plano.itens) {
      const saida = dc.saidaDosLotes(itensEntrada[item.indice].lotes, item.quantidadeEstoque, saldoDosLotes, item.nome);
      if ('erro' in saida) throw new ErroDevolucaoCompra(409, saida.erro);
      saida.usos.forEach((u) => {
        saldoDosLotes[u.loteId] = Number((saldoDosLotes[u.loteId] - u.quantidade).toFixed(6));
        escritasDeLote.set(u.loteId, saldoDosLotes[u.loteId]);
      });
    }

    const titulos = snapsDosTitulos.filter((s) => s.exists && s.data().tenantId === tenantId).map((s) => ({ id: s.id, ...s.data() }));
    const financeiro = dc.planoFinanceiroDaDevolucao(titulos, plano.totalCentavos);

    const devolvidoPorItem = { ...(nota.devolvidoPorItem || {}) };
    plano.itens.forEach((i) => {
      devolvidoPorItem[String(i.indice)] = Number((Number(devolvidoPorItem[String(i.indice)] || 0) + i.quantidade).toFixed(6));
    });

    const descricaoNota = `NF ${nota.numeroNF || ''} - ${String(nota.fornecedorNome || '').toUpperCase()}`;
    const contaReceberRef = financeiro.aReceberCentavos > 0 ? db.collection('transacoes').doc(`devolucao_compra_${devolucaoRef.id}`) : null;

    // ---------------- ESCRITAS ----------------
    escritasDeEstoque.forEach(([ref, quantidade]) => tx.update(ref, {
      quantidade,
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), `Devolução de compra ao fornecedor (${descricaoNota})`),
    }));
    escritasDeLote.forEach((quantidade, loteId) => tx.update(db.collection('estoque_lotes').doc(loteId), { quantidade, updatedAt: agora() }));
    financeiro.abatimentos.forEach((a) => {
      const motivo = `Devolução de compra ao fornecedor: ${reais(a.antesCentavos - a.depoisCentavos)} abatidos`;
      tx.update(db.collection('transacoes').doc(a.id), {
        ...(a.cancelar
          ? { status: 'Cancelada', motivoCancelamento: `${motivo} (devolução de toda a parcela)`, canceladaEm: agora() }
          : { valorCentavos: a.depoisCentavos, valor: a.depoisCentavos / 100 }),
        devolucoesCompra: admin.firestore.FieldValue.arrayUnion({ devolucaoId: devolucaoRef.id, abatidoCentavos: a.antesCentavos - a.depoisCentavos, valorAnteriorCentavos: a.antesCentavos }),
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), motivo),
      });
    });
    if (contaReceberRef) {
      tx.set(contaReceberRef, {
        descricao: `DEVOLUÇÃO DE COMPRA ${descricaoNota}`,
        categoria: 'Devolução de Compra',
        tipo: 'entrada',
        status: 'Pendente',
        valor: financeiro.aReceberCentavos / 100,
        valorCentavos: financeiro.aReceberCentavos,
        data: hoje,
        dataVencimento: hoje,
        formaPagamento: 'Outros',
        // O Contas a Receber mostra pelo nome do cliente; aqui quem deve e' o fornecedor.
        clienteNome: String(nota.fornecedorNome || '').toUpperCase(),
        fornecedorId: nota.fornecedorId || null,
        fornecedorNome: nota.fornecedorNome || null,
        devolucaoCompraId: devolucaoRef.id,
        notaEntradaId: notaRef.id,
        origemLancamento: 'devolucao_compra',
        tenantId,
        createdAt: agora(),
        ...buildDocumentMetadata(user.uid, agora()),
      });
    }
    tx.update(notaRef, {
      devolvidoPorItem,
      devolucoesCompraIds: admin.firestore.FieldValue.arrayUnion(devolucaoRef.id),
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), 'Devolução ao fornecedor registrada'),
    });
    const registro = {
      tenantId,
      notaEntradaId: notaRef.id,
      notaNumero: String(nota.numeroNF || ''),
      notaChave: String(nota.chaveAcesso || ''),
      fornecedorId: nota.fornecedorId || null,
      fornecedorNome: String(nota.fornecedorNome || ''),
      itens: plano.itens,
      totalCentavos: plano.totalCentavos,
      abatidoCentavos: plano.totalCentavos - financeiro.aReceberCentavos,
      aReceberCentavos: financeiro.aReceberCentavos,
      titulosAbatidos: financeiro.abatimentos,
      contaReceberId: contaReceberRef ? contaReceberRef.id : null,
      motivo: pedido.motivo,
      status: dc.STATUS_DEVOLUCAO_COMPRA,
      notaFiscal: null,
      tentativasNotaFiscal: 0,
      data: hoje,
      registradoPor: user.uid,
      registradoPorNome: user.nome || user.email || '',
      createdAt: agora(),
      ...buildDocumentMetadata(user.uid, agora()),
    };
    tx.set(devolucaoRef, registro);
    return { id: devolucaoRef.id, ...registro, createdAt: null, criadoEm: null, alteradoEm: null };
  });
};

// ===========================================================================
// EMITIR A NF-e
// ===========================================================================

const prepararNota = async ({ tenantId, devolucao }) => {
  const notaSnap = await db.collection('notas_fiscais_entrada').doc(devolucao.notaEntradaId).get();
  if (!notaSnap.exists || notaSnap.data().tenantId !== tenantId) throw new ErroDevolucaoCompra(404, 'A nota de entrada desta devolução não foi encontrada.');
  const nota = notaSnap.data();
  if (String(nota.chaveAcesso || '').replace(/\D/g, '').length !== 44) {
    throw new ErroDevolucaoCompra(422, `A nota de entrada nº ${nota.numeroNF || ''} não tem a chave de acesso gravada. A NF-e de devolução precisa referenciar a nota do fornecedor.`);
  }
  if (!nota.xmlGzipBase64) {
    throw new ErroDevolucaoCompra(422, `A nota de entrada nº ${nota.numeroNF || ''} não tem o XML guardado (era grande demais ou é de antes deste recurso). Sem ele não dá para referenciar cada item da nota do fornecedor.`);
  }
  let xml;
  try {
    xml = parseNfeXml(await descompactarXml(nota.xmlGzipBase64));
  } catch (erro) {
    throw new ErroDevolucaoCompra(422, `O XML guardado da nota de entrada nº ${nota.numeroNF || ''} não pôde ser lido: ${erro.message}`);
  }
  let fornecedor = null;
  if (nota.fornecedorId) {
    const s = await db.collection('fornecedores').doc(String(nota.fornecedorId)).get();
    if (s.exists && s.data().tenantId === tenantId) fornecedor = s.data();
  }
  const destino = dc.destinatarioDaDevolucao(xml.emitente, fornecedor);
  if ('erro' in destino) throw new ErroDevolucaoCompra(422, destino.erro);
  const configSnap = await db.collection('configuracoes').doc(tenantId).get();
  const regime = (configSnap.exists && configSnap.data().regimeTributario) || DEFAULT_REGIME_TRIBUTARIO;
  const itens = dc.montarItensDaNotaDeDevolucao({
    itens: devolucao.itens || [],
    itensEntrada: Array.isArray(nota.itens) ? nota.itens : [],
    itensXml: xml.itens,
    chaveAcesso: String(nota.chaveAcesso).replace(/\D/g, ''),
    simples: usesCsosn(regime),
  });
  if ('erro' in itens) throw new ErroDevolucaoCompra(422, itens.erro);
  return { nota, receiver: destino.receiver, itens: itens.itens };
};

const emitir = async ({ user, tenantId, corpo }) => {
  const devolucaoId = String((corpo && corpo.devolucaoId) || '').trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(devolucaoId)) throw new ErroDevolucaoCompra(400, 'Informe qual devolução deve gerar a nota.');
  const devolucaoRef = db.collection(COLECAO).doc(devolucaoId);
  const snap = await devolucaoRef.get();
  if (!snap.exists || snap.data().tenantId !== tenantId) throw new ErroDevolucaoCompra(404, 'Devolução não encontrada. Atualize a lista.');
  const devolucao = snap.data();
  if (dc.notaVigenteDaDevolucaoDeCompra(devolucao.notaFiscal, Date.now())) {
    throw new ErroDevolucaoCompra(409, 'Esta devolução já tem uma NF-e em andamento ou autorizada. Confira em Notas Fiscais.');
  }
  const { nota, receiver, itens } = await prepararNota({ tenantId, devolucao });
  const { apiKey, baseUrl } = await loadSpedyConfig(tenantId);

  // Reserva (uma nota por vez): duplo clique ou duas telas nao geram nota dupla.
  const tentativa = await db.runTransaction(async (tx) => {
    const atual = (await tx.get(devolucaoRef)).data();
    if (dc.notaVigenteDaDevolucaoDeCompra(atual.notaFiscal, Date.now())) {
      throw new ErroDevolucaoCompra(409, 'Esta devolução já tem uma NF-e em andamento ou autorizada. Confira em Notas Fiscais.');
    }
    const proxima = Number(atual.tentativasNotaFiscal || 0) + 1;
    tx.update(devolucaoRef, { notaFiscal: { status: 'reservada', tentativa: proxima, reservadoEmMs: Date.now(), reservadoPor: user.uid }, tentativasNotaFiscal: proxima });
    return proxima;
  });

  let reservou = true;
  try {
    const integrationId = tentativa === 1 ? `dc-${devolucaoId}` : `dc-${devolucaoId}-t${tentativa}`;
    const payload = dc.montarPayloadDaDevolucaoDeCompra({ integrationId, receiver, itens, notaEntrada: nota, motivo: devolucao.motivo || '' });
    const resposta = await fetchComTimeout(`${baseUrl}/product-invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify(payload),
    }, PERFIS.spedyEmissao);
    const notaSpedy = await resposta.json().catch(() => ({}));
    if (!resposta.ok) {
      throw new ErroDevolucaoCompra(resposta.status === 429 ? 429 : 400, (notaSpedy.errors && notaSpedy.errors[0] && notaSpedy.errors[0].message) || notaSpedy.error || 'A Spedy recusou a nota de devolução.');
    }

    // A partir daqui a nota EXISTE na Spedy: falha ao gravar nao pode virar "nao emitida".
    reservou = false;
    try {
      const nova = db.collection('notas_fiscais').doc();
      await nova.set({
        spedyId: notaSpedy.id,
        number: notaSpedy.number ?? null,
        accessKey: notaSpedy.accessKey || null,
        tipo: 'NF-e',
        finalidade: dc.FINALIDADE_NOTA_DEVOLUCAO_COMPRA,
        devolucaoCompraId: devolucaoId,
        notaEntradaId: devolucao.notaEntradaId,
        notaOriginalChave: String(nota.chaveAcesso || ''),
        notaOriginalNumero: String(nota.numeroNF || ''),
        clienteNome: String(receiver.name || ''),
        fornecedorId: devolucao.fornecedorId || null,
        valor: payload.total.invoiceAmount,
        itensFiscais: itens,
        status: notaSpedy.status || 'enqueued',
        processingMessage: (notaSpedy.processingDetail && notaSpedy.processingDetail.message) || null,
        processingCode: (notaSpedy.processingDetail && notaSpedy.processingDetail.code) || null,
        tentativaEmissao: tentativa,
        integrationId,
        tenantId,
        createdAt: agora(),
        data: new Date().toISOString(),
        ...buildDocumentMetadata(user.uid, agora()),
      });
      await devolucaoRef.update({
        notaFiscal: { notaId: nova.id, spedyId: notaSpedy.id, status: notaSpedy.status || 'enqueued', numero: notaSpedy.number ?? null, tentativa },
        updatedAt: agora(),
      });
      return { notaId: nova.id, status: notaSpedy.status || 'enqueued', numero: notaSpedy.number ?? null, mensagem: (notaSpedy.processingDetail && notaSpedy.processingDetail.message) || null };
    } catch (erroGravacao) {
      console.error('[Devolucao compra] nota enviada, mas falhou ao gravar:', erroGravacao);
      throw new ErroDevolucaoCompra(500, 'A Spedy recebeu a nota de devolução, mas o sistema não conseguiu guardá-la na lista. Não emita de novo: avise o suporte para conferirmos a nota no painel da Spedy.');
    }
  } finally {
    if (reservou) {
      // Falhou ANTES da Spedy aceitar: libera para uma nova tentativa.
      await devolucaoRef.update({ notaFiscal: null }).catch((e) => console.error('[Devolucao compra] nao liberou a reserva:', e.message));
    }
  }
};

// ===========================================================================
// LISTAR (as devolucoes de uma nota, com a situacao da NF-e)
// ===========================================================================

const listar = async ({ tenantId, notaEntradaId }) => {
  const snap = await db.collection(COLECAO).where('tenantId', '==', tenantId).where('notaEntradaId', '==', String(notaEntradaId || '')).get();
  const lista = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const idsDasNotas = lista.map((d) => d.notaFiscal && d.notaFiscal.notaId).filter(Boolean);
  const notas = {};
  if (idsDasNotas.length) {
    (await db.getAll(...idsDasNotas.map((id) => db.collection('notas_fiscais').doc(id)))).forEach((s) => {
      if (s.exists && s.data().tenantId === tenantId) notas[s.id] = s.data();
    });
  }
  const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : 0);
  return lista
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt))
    .map((d) => {
      const n = d.notaFiscal && d.notaFiscal.notaId ? notas[d.notaFiscal.notaId] : null;
      return {
        id: d.id,
        data: d.data,
        itens: (d.itens || []).map((i) => ({ indice: i.indice, nome: i.nome, quantidade: i.quantidade, unidade: i.unidade, totalCentavos: i.totalCentavos })),
        totalCentavos: d.totalCentavos,
        abatidoCentavos: d.abatidoCentavos,
        aReceberCentavos: d.aReceberCentavos,
        motivo: d.motivo,
        registradoPorNome: d.registradoPorNome || '',
        notaFiscal: n
          ? { status: n.status, numero: n.number ?? null, mensagem: n.processingMessage || null, codigo: n.processingCode || null }
          : (d.notaFiscal && d.notaFiscal.status === 'reservada' ? { status: 'reservada', numero: null, mensagem: null, codigo: null } : null),
      };
    });
};

module.exports = { ErroDevolucaoCompra, registrar, emitir, listar, prepararNota };
