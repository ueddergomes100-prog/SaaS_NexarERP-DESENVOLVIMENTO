/*
 * CONDICIONAL no servidor (2026-10-05). Regras em server/domain/
 * condicionalDomain.js (o src/utils/condicionalDomain.ts compilado); aqui so'
 * a leitura e a gravacao, sempre numa transacao.
 *
 * Toda escrita em `condicionais` -- e todo movimento de estoque dela -- passa
 * por aqui: as firestore.rules deixam a colecao so' para leitura (nada muda
 * pelo DevTools). O que fica com o cliente vira pre-venda com a reserva
 * transferida, entao o estoque so' e' baixado uma vez, quando a pre-venda e'
 * finalizada (PedidoVendaForm, `computeReservationCommit`).
 */
const { admin, db } = require('../config/firebase');
const {
  MENSAGEM_CONDICIONAL_DESLIGADO,
  STATUS_DA_PRE_VENDA_GERADA,
  itensQueFicaram,
  montarItensDoCondicional,
  normalizarObservacao,
  parseTrabalhaComCondicional,
  planejarDevolucao,
  planoDeLiberacao,
  planoDeReserva,
  quantidadePendente,
  resumirCondicional,
  validarItensDoPedido,
  validarPrazoDevolucao,
} = require('../domain/condicionalDomain');
const { buildDocumentMetadata, buildDocumentUpdateMetadata } = require('../domain/documentMetadata');
const { toCents } = require('../domain/financeDomain');

class ErroCondicional extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const agora = () => admin.firestore.FieldValue.serverTimestamp();
const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;

const parseSequencia = (valor) => {
  const n = Number.parseInt(String(valor ?? '').replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
};

const refSequencia = (tenantId, chave) => db.collection('contadores').doc(tenantId).collection('sequencias').doc(chave);
const refSequenciaLegada = (tenantId) => db.collection('contadores').doc(tenantId);

/**
 * Maior numero de pedido ja' gravado (o "piso" da numeracao), lido FORA da
 * transacao -- mesma regra de getCurrentMaxSequence no front. Sem indice ou
 * sem acesso, vale 0 (as outras duas fontes seguram a numeracao).
 */
const maiorNumeroGravado = async (colecao, tenantId, campo) => {
  try {
    const snap = await db.collection(colecao).where('tenantId', '==', tenantId).orderBy(campo, 'desc').limit(1).get();
    return snap.empty ? 0 : parseSequencia(snap.docs[0].data()[campo]);
  } catch {
    return 0;
  }
};

/** Proximo numero: maior entre a sequencia nova, o campo legado e o piso (getNextTenantSequenceValue). */
const proximaSequencia = async (tx, tenantId, chave, piso = 0) => {
  const [atual, legado] = await Promise.all([tx.get(refSequencia(tenantId, chave)), tx.get(refSequenciaLegada(tenantId))]);
  const valorAtual = atual.exists ? parseSequencia(atual.data().valor) : 0;
  const valorLegado = legado.exists ? parseSequencia(legado.data()[chave]) : 0;
  return Math.max(valorAtual, valorLegado, piso) + 1;
};

const gravarSequencia = (tx, tenantId, chave, valor) => {
  tx.set(refSequencia(tenantId, chave), { tenantId, chave, valor, updatedAt: agora() }, { merge: true });
};

const lerConfiguracao = async (tx, tenantId) => {
  const snap = await tx.get(db.collection('configuracoes').doc(tenantId));
  return snap.exists ? snap.data() : {};
};

const exigirLigado = (config) => {
  if (!parseTrabalhaComCondicional(config.trabalhaComCondicional)) throw new ErroCondicional(400, MENSAGEM_CONDICIONAL_DESLIGADO);
};

const lerProdutos = async (tx, tenantId, ids) => {
  const unicos = [...new Set(ids)];
  const refs = unicos.map((id) => db.collection('estoque').doc(id));
  const snaps = refs.length ? await tx.getAll(...refs) : [];
  const produtosPorId = {};
  snaps.forEach((s) => { if (s.exists && s.data().tenantId === tenantId) produtosPorId[s.id] = s.data(); });
  return { produtosPorId, refs: Object.fromEntries(refs.map((r) => [r.id, r])) };
};

const lerCondicional = async (tx, tenantId, id) => {
  if (!ID_VALIDO.test(String(id || ''))) throw new ErroCondicional(404, 'Condicional não encontrado.');
  const ref = db.collection('condicionais').doc(String(id));
  const snap = await tx.get(ref);
  if (!snap.exists || snap.data().tenantId !== tenantId) throw new ErroCondicional(404, 'Condicional não encontrado.');
  return { ref, condicional: { id: snap.id, ...snap.data() } };
};

const exigirAberto = (condicional) => {
  if (condicional.status !== 'aberto') {
    throw new ErroCondicional(409, 'Este condicional já foi fechado ou cancelado (talvez por outra pessoa). Atualize a tela.');
  }
};

const nomeDoUsuario = (user) => String(user.nome || user.email || user.uid);

const entradaDeHistorico = (tipo, user, extra = {}) => ({
  tipo,
  em: new Date().toISOString(),
  por: user.uid,
  porNome: nomeDoUsuario(user),
  ...extra,
});

const aplicarReservas = (tx, refs, reservas, user, resumo) => {
  for (const r of reservas) {
    tx.update(refs[r.id], {
      quantidadeReservada: r.reservadaDepois,
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), resumo),
    });
  }
};

/** SAIDA: cria o condicional e reserva o estoque. Reenviar com o mesmo `idDocumento` nao duplica. */
const criarCondicional = async ({ user, tenantId, corpo, hoje }) => {
  const validacao = validarItensDoPedido(corpo?.itens);
  if (validacao.erros.length) throw new ErroCondicional(400, validacao.erros.join(' '));
  const erroPrazo = validarPrazoDevolucao(corpo?.prazoDevolucao, hoje);
  if (erroPrazo) throw new ErroCondicional(400, erroPrazo);
  const clienteId = String(corpo?.clienteId || '').trim();
  if (!ID_VALIDO.test(clienteId)) throw new ErroCondicional(400, 'Selecione o cliente do condicional.');
  const idDocumento = String(corpo?.idDocumento || '').trim();
  if (idDocumento && !ID_VALIDO.test(idDocumento)) throw new ErroCondicional(400, 'Identificador inválido. Atualize a tela.');
  const observacao = normalizarObservacao(corpo?.observacao);

  const resultado = {};
  await db.runTransaction(async (tx) => {
    const ref = idDocumento ? db.collection('condicionais').doc(idDocumento) : db.collection('condicionais').doc();
    if (idDocumento) {
      const existente = await tx.get(ref);
      if (existente.exists) {
        if (existente.data().tenantId !== tenantId) throw new ErroCondicional(409, 'Este rascunho já foi usado por outra empresa. Comece um novo condicional.');
        Object.assign(resultado, { id: ref.id, numeroCondicional: existente.data().numeroCondicional, jaEnviado: true, semUnidade: [] });
        return;
      }
    }
    const config = await lerConfiguracao(tx, tenantId);
    exigirLigado(config);

    const clienteSnap = await tx.get(db.collection('clientes').doc(clienteId));
    if (!clienteSnap.exists || clienteSnap.data().tenantId !== tenantId || clienteSnap.data().ativo === false) {
      throw new ErroCondicional(400, 'O cliente não foi encontrado (ou está inativo). Escolha o cliente de novo.');
    }
    const cliente = clienteSnap.data();

    const { produtosPorId, refs } = await lerProdutos(tx, tenantId, validacao.itens.map((i) => i.id));
    const montagem = montarItensDoCondicional({ itens: validacao.itens, produtosPorId });
    if (montagem.erros.length) throw new ErroCondicional(400, montagem.erros.join(' '));
    const reserva = planoDeReserva({ itens: montagem.itens, produtosPorId, permiteSemEstoque: config.venderSemEstoque === true });
    if (reserva.erros.length) throw new ErroCondicional(400, reserva.erros.join(' '));

    const numero = await proximaSequencia(tx, tenantId, 'condicionais');
    const numeroCondicional = String(numero).padStart(4, '0');

    aplicarReservas(tx, refs, reserva.reservas, user, `Reservado no condicional nº ${numeroCondicional}`);
    gravarSequencia(tx, tenantId, 'condicionais', numero);
    const resumo = resumirCondicional(montagem.itens);
    tx.set(ref, {
      numeroCondicional,
      tenantId,
      clienteId,
      clienteNome: String(cliente.nome || cliente.razaoSocial || 'Cliente'),
      clienteTelefone: String(cliente.telefone || cliente.celular || cliente.whatsapp || ''),
      itens: montagem.itens,
      prazoDevolucao: String(corpo.prazoDevolucao).trim(),
      dataSaida: hoje,
      status: 'aberto',
      observacao,
      valorLevado: resumo.valorLevado,
      valorLevadoCentavos: toCents(resumo.valorLevado),
      criadoPorNome: nomeDoUsuario(user),
      historico: [entradaDeHistorico('saida', user, { pecas: resumo.pecasLevadas })],
      createdAt: agora(),
      ...buildDocumentMetadata(user.uid, agora()),
    });
    Object.assign(resultado, { id: ref.id, numeroCondicional, jaEnviado: false, semUnidade: montagem.semUnidade });
  });
  return resultado;
};

/** Grava uma devolucao (parcial ou total) dentro da transacao. Devolve os itens novos. */
const registrarDevolucaoNaTransacao = async (tx, { user, tenantId, condicional, devolucoes }) => {
  const plano = planejarDevolucao(condicional.itens || [], devolucoes);
  if (plano.erros.length) throw new ErroCondicional(400, plano.erros.join(' '));
  const { produtosPorId, refs } = await lerProdutos(tx, tenantId, plano.liberar.map((l) => l.id));
  return { plano, liberacoes: planoDeLiberacao({ liberar: plano.liberar, produtosPorId }), refs };
};

const lerDevolucoes = (corpo) => (Array.isArray(corpo?.itens) ? corpo.itens : [])
  .map((d) => ({ id: String(d?.id || '').trim(), quantidade: Number(d?.quantidade) }))
  .filter((d) => d.id && Number.isFinite(d.quantidade) && d.quantidade > 0);

/** DEVOLUCAO: o que voltou tem a reserva liberada. Se voltou tudo, o condicional fecha como "Tudo devolvido". */
const devolverItens = async ({ user, tenantId, id, corpo }) => {
  const resultado = {};
  await db.runTransaction(async (tx) => {
    const { ref, condicional } = await lerCondicional(tx, tenantId, id);
    exigirAberto(condicional);
    const devolucoes = lerDevolucoes(corpo);
    const { plano, liberacoes, refs } = await registrarDevolucaoNaTransacao(tx, { user, tenantId, condicional, devolucoes });
    aplicarReservas(tx, refs, liberacoes, user, `Devolvido do condicional nº ${condicional.numeroCondicional}`);
    tx.update(ref, {
      itens: plano.itens,
      ...(plano.tudoDevolvido ? { status: 'devolvido', fechadoEm: agora() } : {}),
      historico: [...(condicional.historico || []), entradaDeHistorico('devolucao', user, { itens: plano.liberar })],
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), plano.tudoDevolvido ? 'Tudo devolvido' : 'Devolução registrada'),
    });
    Object.assign(resultado, {
      numeroCondicional: condicional.numeroCondicional,
      clienteNome: condicional.clienteNome,
      tudoDevolvido: plano.tudoDevolvido,
      pecasDevolvidas: plano.liberar.reduce((s, l) => s + l.quantidade, 0),
    });
  });
  return resultado;
};

/**
 * FECHAR: aplica a devolucao final (se vier) e transforma o que ficou com o
 * cliente numa PRE-VENDA com a reserva ja' feita. Nada ficou = "Tudo devolvido".
 */
const fecharCondicional = async ({ user, tenantId, id, corpo, hoje }) => {
  const resultado = {};
  const pisoPedido = await maiorNumeroGravado('pedidos_venda', tenantId, 'numeroPedido');
  await db.runTransaction(async (tx) => {
    const { ref, condicional } = await lerCondicional(tx, tenantId, id);
    exigirAberto(condicional);
    const config = await lerConfiguracao(tx, tenantId);

    let itens = condicional.itens || [];
    let liberacoes = [];
    let refs = {};
    let devolvidosAgora = [];
    const devolucoes = lerDevolucoes(corpo);
    if (devolucoes.length) {
      const devolucao = await registrarDevolucaoNaTransacao(tx, { user, tenantId, condicional, devolucoes });
      itens = devolucao.plano.itens;
      liberacoes = devolucao.liberacoes;
      refs = devolucao.refs;
      devolvidosAgora = devolucao.plano.liberar;
    }

    const ficaram = itensQueFicaram(itens);
    const pedidoRef = db.collection('pedidos_venda').doc();
    let numeroPedido = '';
    let proximoPedido = 0;
    if (ficaram.length) proximoPedido = await proximaSequencia(tx, tenantId, 'pedidos_venda', pisoPedido);

    // --- escritas ---
    aplicarReservas(tx, refs, liberacoes, user, `Devolvido do condicional nº ${condicional.numeroCondicional}`);
    const historico = [...(condicional.historico || [])];
    if (devolvidosAgora.length) historico.push(entradaDeHistorico('devolucao', user, { itens: devolvidosAgora }));

    if (ficaram.length) {
      numeroPedido = String(proximoPedido).padStart(4, '0');
      gravarSequencia(tx, tenantId, 'pedidos_venda', proximoPedido);
      const total = ficaram.reduce((s, i) => s + i.subtotal, 0);
      // Mesmo formato da pre-venda do app Vendas (criarPreVendaExterna): a
      // loja abre em Pedidos de Venda e finaliza com o pagamento.
      tx.set(pedidoRef, {
        numeroPedido,
        clienteId: condicional.clienteId,
        clienteNome: condicional.clienteNome,
        itens: ficaram,
        valorTotalItens: total,
        valorTotalItensCentavos: toCents(total),
        valorTotalDescontos: 0,
        valorTotalDescontosCentavos: 0,
        descontoGeral: { tipo: 'valor', valorInformado: 0, valorAplicadoCentavos: 0, excedeuLimite: false },
        frete: 0,
        encargos: 0,
        valorTotal: total,
        valorTotalCentavos: toCents(total),
        dataVenda: hoje,
        status: STATUS_DA_PRE_VENDA_GERADA,
        origem: 'balcao',
        estoqueReservado: true,
        ...(config.conferenciaMercadoria === true ? { statusConferencia: 'aguardando' } : {}),
        observacao: `Gerada do condicional nº ${condicional.numeroCondicional}.${condicional.observacao ? ` ${condicional.observacao}` : ''}`.slice(0, 500),
        condicionalId: ref.id,
        numeroCondicional: condicional.numeroCondicional,
        tenantId,
        usuarioResponsavelId: user.uid,
        createdAt: agora(),
        ...buildDocumentMetadata(user.uid, agora()),
      });
      historico.push(entradaDeHistorico('fechamento', user, { pedidoId: pedidoRef.id, numeroPedido }));
    } else {
      historico.push(entradaDeHistorico('fechamento', user, { semVenda: true }));
    }

    tx.update(ref, {
      itens,
      status: ficaram.length ? 'finalizado' : 'devolvido',
      fechadoEm: agora(),
      ...(ficaram.length ? { pedidoId: pedidoRef.id, numeroPedido } : {}),
      historico,
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), ficaram.length ? `Fechado: virou a pré-venda nº ${numeroPedido}` : 'Fechado: tudo devolvido'),
    });
    Object.assign(resultado, {
      numeroCondicional: condicional.numeroCondicional,
      clienteNome: condicional.clienteNome,
      pedidoId: ficaram.length ? pedidoRef.id : null,
      numeroPedido: numeroPedido || null,
      pecasVendidas: ficaram.reduce((s, i) => s + i.quantidade, 0),
    });
  });
  return resultado;
};

/** CANCELAR: devolve a reserva de tudo que ainda estava com o cliente. */
const cancelarCondicional = async ({ user, tenantId, id, corpo }) => {
  const motivo = normalizarObservacao(corpo?.motivo);
  if (motivo.length < 5) throw new ErroCondicional(400, 'Explique o motivo do cancelamento (mínimo 5 letras).');
  const resultado = {};
  await db.runTransaction(async (tx) => {
    const { ref, condicional } = await lerCondicional(tx, tenantId, id);
    exigirAberto(condicional);
    const pendentes = (condicional.itens || [])
      .map((item) => ({ id: item.id, quantidade: quantidadePendente(item) }))
      .filter((p) => p.quantidade > 0);
    const { produtosPorId, refs } = await lerProdutos(tx, tenantId, pendentes.map((p) => p.id));
    const liberacoes = planoDeLiberacao({ liberar: pendentes, produtosPorId });
    aplicarReservas(tx, refs, liberacoes, user, `Condicional nº ${condicional.numeroCondicional} cancelado`);
    tx.update(ref, {
      status: 'cancelado',
      motivoCancelamento: motivo,
      fechadoEm: agora(),
      historico: [...(condicional.historico || []), entradaDeHistorico('cancelamento', user, { motivo })],
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), `Cancelado: ${motivo}`),
    });
    Object.assign(resultado, { numeroCondicional: condicional.numeroCondicional, clienteNome: condicional.clienteNome, motivo });
  });
  return resultado;
};

module.exports = {
  ErroCondicional,
  criarCondicional,
  devolverItens,
  fecharCondicional,
  cancelarCondicional,
};
