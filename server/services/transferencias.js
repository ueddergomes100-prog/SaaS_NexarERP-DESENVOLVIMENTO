/*
 * TRANSFERENCIA DE ESTOQUE ENTRE FILIAIS (Filiais, fase 3 -- 2026-10-06).
 * Regras em src/utils/transferenciaDomain.ts (compilado em server/domain).
 *
 * Toda escrita em `transferencias` e no estoque das duas filiais acontece
 * aqui, numa transacao (as firestore.rules deixam a colecao so' para
 * leitura). Os lotes sao lidos FORA da transacao (consulta) e relidos DENTRO
 * dela por id, como na Troca: o saldo usado e' sempre o da hora de gravar.
 */
const { db, admin } = require('../config/firebase');
const filial = require('../domain/filialDomain');
const regras = require('../domain/transferenciaDomain');

class ErroTransferencia extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const agora = () => admin.firestore.FieldValue.serverTimestamp();
const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;
const r4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

/** Usuario, grupo (da filial casa) e a filial em que ele esta trabalhando. */
const contexto = async (user) => {
  const usuarioSnap = await db.collection('usuarios').doc(user.uid).get();
  if (!usuarioSnap.exists) throw new ErroTransferencia(404, 'Seu usuário não foi encontrado. Saia do sistema e entre de novo.');
  const dados = usuarioSnap.data();
  const usuario = { ...dados, uid: user.uid, tenantId: dados.tenantId || user.uid };
  const configCasa = await db.collection('configuracoes').doc(usuario.tenantId).get();
  const grupoId = configCasa.exists ? configCasa.data().grupoId : '';
  const grupoSnap = grupoId ? await db.collection('grupos').doc(grupoId).get() : null;
  const grupo = grupoSnap && grupoSnap.exists ? filial.lerGrupo(grupoSnap.id, grupoSnap.data()) : null;
  if (!grupo || !filial.pertenceAoGrupo(grupo, usuario)) throw new ErroTransferencia(404, 'Sua empresa não tem filiais cadastradas.');
  if (!filial.podeUsarOutrasFiliais(grupo, usuario)) {
    throw new ErroTransferencia(403, 'Transferência entre filiais precisa da permissão "Utiliza outras filiais". Peça ao responsável para liberar no seu usuário.');
  }
  const ativa = user.tenantId;
  const filialAtiva = grupo.filiais.find((f) => f.tenantId === ativa);
  if (!filialAtiva) throw new ErroTransferencia(403, 'A filial em que você está não faz parte do grupo.');
  return { usuario, grupo, filialAtiva };
};

const lotesDosProdutos = async (tenantId, produtoIds) => {
  const porProduto = {};
  for (const produtoId of produtoIds) {
    const snap = await db.collection('estoque_lotes').where('tenantId', '==', tenantId).where('produtoId', '==', produtoId).get();
    porProduto[produtoId] = snap.docs.map((d) => d.id);
  }
  return porProduto;
};

const lerProdutos = async (tx, ids) => {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return {};
  const snaps = await tx.getAll(...unicos.map((id) => db.collection('estoque').doc(id)));
  const produtos = {};
  snaps.forEach((s) => { if (s.exists) produtos[s.id] = { id: s.id, ...s.data() }; });
  return produtos;
};

const lerLotes = async (tx, idsPorProduto, tenantId) => {
  const todos = Object.values(idsPorProduto).flat();
  const lotes = {};
  if (todos.length === 0) return lotes;
  const snaps = await tx.getAll(...todos.map((id) => db.collection('estoque_lotes').doc(id)));
  snaps.forEach((s) => {
    if (!s.exists || s.data().tenantId !== tenantId) return;
    const d = s.data();
    (lotes[d.produtoId] = lotes[d.produtoId] || []).push({ id: s.id, produtoId: d.produtoId, lote: String(d.lote || ''), validade: d.validade || null, quantidade: Number(d.quantidade) || 0 });
  });
  return lotes;
};

const ajuste = (tenantId, user, nome, item, tipo, motivo, observacao, antes, depois) => ({
  tenantId,
  produtoId: item.produtoId,
  produtoNome: item.nome,
  ...(item.codigo ? { produtoCodigo: String(item.codigo) } : {}),
  tipo,
  quantidade: item.quantidade,
  motivo,
  observacao,
  quantidadeAntes: antes,
  quantidadeDepois: depois,
  usuarioId: user.uid,
  usuarioNome: nome,
  createdAt: agora(),
});

const nomeDoUsuario = (usuario, user) => String(usuario.nome || usuario.nomeResponsavel || user.email || user.uid);

/** Devolve itens a' origem (estoque + lotes) dentro da transacao. Le antes de gravar. */
const prepararRetorno = async (tx, transferencia, retornos) => {
  const produtos = await lerProdutos(tx, retornos.map((r) => r.produtoId));
  const idsLotes = [...new Set(retornos.flatMap((r) => r.lotes.map((l) => l.loteIdOrigem)))];
  const lotesSnaps = idsLotes.length ? await tx.getAll(...idsLotes.map((id) => db.collection('estoque_lotes').doc(id))) : [];
  const lotesExistentes = {};
  lotesSnaps.forEach((s) => { if (s.exists && s.data().tenantId === transferencia.tenantOrigem) lotesExistentes[s.id] = Number(s.data().quantidade) || 0; });
  return { produtos, lotesExistentes };
};

const gravarRetorno = (tx, transferencia, retornos, preparado, user, nome, descricao) => {
  const saldo = {};
  for (const r of retornos) {
    const produto = preparado.produtos[r.produtoId];
    if (!produto) continue;
    const antes = saldo[r.produtoId] ?? (Number(produto.quantidade) || 0);
    const depois = r4(antes + r.quantidade);
    saldo[r.produtoId] = depois;
    tx.update(db.collection('estoque').doc(r.produtoId), { quantidade: depois, updatedAt: agora() });
    tx.set(db.collection('ajustes_estoque').doc(), ajuste(transferencia.tenantOrigem, user, nome, r, 'entrada', regras.MOTIVO_TRANSFERENCIA_RETORNO, descricao, antes, depois));
    for (const lote of r.lotes) {
      if (preparado.lotesExistentes[lote.loteIdOrigem] !== undefined) {
        preparado.lotesExistentes[lote.loteIdOrigem] = r4(preparado.lotesExistentes[lote.loteIdOrigem] + lote.quantidade);
        tx.update(db.collection('estoque_lotes').doc(lote.loteIdOrigem), { quantidade: preparado.lotesExistentes[lote.loteIdOrigem], updatedAt: agora() });
      } else {
        tx.set(db.collection('estoque_lotes').doc(), {
          tenantId: transferencia.tenantOrigem, produtoId: r.produtoId, lote: lote.lote, validade: lote.validade || null,
          quantidade: lote.quantidade, createdAt: agora(), updatedAt: agora(),
        });
      }
    }
  }
};

// ---------------------------------------------------------------------------

/** Envia: baixa na origem (filial em que o usuario esta) e a mercadoria fica em transito. */
const enviarTransferencia = async ({ user, corpo, hoje }) => {
  const { usuario, grupo, filialAtiva } = await contexto(user);
  const destino = grupo.filiais.find((f) => f.tenantId === String(corpo?.destino || ''));
  if (!destino) throw new ErroTransferencia(400, 'Escolha a filial de destino.');
  if (destino.tenantId === filialAtiva.tenantId) throw new ErroTransferencia(400, 'A filial de destino precisa ser outra, não a que você está.');
  if (!destino.ativa) throw new ErroTransferencia(400, `A filial ${filial.rotuloFilial(destino)} está inativa.`);

  const comNota = corpo?.comNota === true;
  if (comNota) throw new ErroTransferencia(400, 'A transferência com nota fiscal é emitida pela tela de Transferências com nota (fase 4).');
  const configOrigem = await db.collection('configuracoes').doc(filialAtiva.tenantId).get();
  if (!regras.parseTransferenciaSemNota(configOrigem.exists ? configOrigem.data().transferenciaSemNota : undefined)) {
    throw new ErroTransferencia(400, 'A transferência sem nota está desligada nesta filial. Ligue em Configurações ("Permitir transferência sem nota") ou use a transferência com nota.');
  }
  if (!regras.podeTransferirSemNota(usuario)) throw new ErroTransferencia(403, 'Só o dono ou um gerente faz transferência sem nota.');

  const pedidos = (Array.isArray(corpo?.itens) ? corpo.itens : [])
    .map((i) => ({ produtoId: String(i?.produtoId || ''), quantidade: Number(i?.quantidade) }))
    .filter((i) => i.produtoId);
  if (pedidos.length === 0) throw new ErroTransferencia(400, 'Escolha ao menos um produto para transferir.');

  const idDocumento = typeof corpo?.idDocumento === 'string' && ID_VALIDO.test(corpo.idDocumento) ? corpo.idDocumento : null;
  const ref = idDocumento ? db.collection('transferencias').doc(idDocumento) : db.collection('transferencias').doc();

  // Produtos que controlam lote: quais lotes existem (consulta fora da transacao).
  const previa = await Promise.all([...new Set(pedidos.map((p) => p.produtoId))].map((id) => db.collection('estoque').doc(id).get()));
  const comLote = previa.filter((s) => s.exists && s.data().controlarLote === true && s.data().tenantId === filialAtiva.tenantId).map((s) => s.id);
  const idsLotes = await lotesDosProdutos(filialAtiva.tenantId, comLote);
  const nome = nomeDoUsuario(usuario, user);

  return db.runTransaction(async (tx) => {
    const existente = await tx.get(ref);
    if (existente.exists) {
      if (existente.data().tenantOrigem !== filialAtiva.tenantId) throw new ErroTransferencia(409, 'Este envio já foi registrado por outra filial. Atualize a tela.');
      return { id: ref.id, numeroTransferencia: existente.data().numeroTransferencia, jaEnviada: true };
    }
    const produtos = await lerProdutos(tx, pedidos.map((p) => p.produtoId));
    const lotesPorProduto = await lerLotes(tx, idsLotes, filialAtiva.tenantId);
    const seqRef = db.collection('contadores').doc(filialAtiva.tenantId).collection('sequencias').doc('transferencias');
    const seqSnap = await tx.get(seqRef);

    const plano = regras.planejarEnvio({ origem: filialAtiva.tenantId, destino: destino.tenantId, pedidos, produtos, lotesPorProduto, hoje });
    if (!plano.ok) throw new ErroTransferencia(409, plano.erros.join(' '));

    const numero = (seqSnap.exists ? Number(seqSnap.data().valor) || 0 : 0) + 1;
    const numeroTransferencia = String(numero).padStart(4, '0');
    const descricao = `Transferência nº ${numeroTransferencia} para a filial ${filial.rotuloFilial(destino)}`;

    plano.baixas.forEach((b) => {
      tx.update(db.collection('estoque').doc(b.produtoId), { quantidade: b.quantidadeDepois, updatedAt: agora() });
      tx.set(db.collection('ajustes_estoque').doc(), ajuste(filialAtiva.tenantId, user, nome, b, 'saida', regras.MOTIVO_TRANSFERENCIA_SAIDA, descricao, b.quantidadeAntes, b.quantidadeDepois));
    });
    plano.lotes.forEach((l) => tx.update(db.collection('estoque_lotes').doc(l.id), { quantidade: l.quantidadeDepois, updatedAt: agora() }));
    tx.set(seqRef, { valor: numero, atualizadoEm: agora() }, { merge: true });
    tx.set(ref, {
      tenantOrigem: filialAtiva.tenantId,
      tenantDestino: destino.tenantId,
      // Para as duas filiais listarem a mesma transferencia (array-contains).
      tenantIds: [filialAtiva.tenantId, destino.tenantId],
      grupoId: grupo.id,
      origemCodigo: filialAtiva.codigo,
      origemNome: filialAtiva.nome,
      destinoCodigo: destino.codigo,
      destinoNome: destino.nome,
      numeroTransferencia,
      status: 'em_transito',
      comNota: false,
      itens: plano.itens,
      valorCentavos: plano.valorCentavos,
      observacao: String(corpo?.observacao || '').trim().slice(0, 500),
      enviadoPor: user.uid,
      enviadoPorNome: nome,
      enviadoEm: agora(),
      historico: [{ acao: 'enviada', em: new Date().toISOString(), por: nome }],
    });
    return { id: ref.id, numeroTransferencia, jaEnviada: false };
  });
};

const lerTransferencia = async (tx, id) => {
  const ref = db.collection('transferencias').doc(String(id || ''));
  const snap = await tx.get(ref);
  if (!snap.exists) throw new ErroTransferencia(404, 'Transferência não encontrada.');
  return { ref, transferencia: { id: snap.id, ...snap.data() } };
};

/** Recebe no destino (a filial em que o usuario esta), com conferencia: a falta volta para a origem. */
const receberTransferencia = async ({ user, id, corpo }) => {
  const { usuario } = await contexto(user);
  const nome = nomeDoUsuario(usuario, user);
  const recebidas = {};
  for (const [indice, valor] of Object.entries(corpo?.recebidas || {})) {
    if (Number.isInteger(Number(indice))) recebidas[Number(indice)] = Number(valor);
  }

  // Lotes do destino (consulta fora da transacao) para somar no mesmo lote.
  const previa = await db.collection('transferencias').doc(String(id || '')).get();
  if (!previa.exists) throw new ErroTransferencia(404, 'Transferência não encontrada.');
  const idsDestino = [...new Set((previa.data().itens || []).map((i) => i.produtoIdDestino))];
  const idsLotesDestino = await lotesDosProdutos(previa.data().tenantDestino, idsDestino);

  return db.runTransaction(async (tx) => {
    const { ref, transferencia } = await lerTransferencia(tx, id);
    if (transferencia.tenantDestino !== user.tenantId) throw new ErroTransferencia(403, 'Só a filial de destino recebe a transferência. Entre nela pelo seletor do topo.');
    const erroStatus = regras.proximoStatusPermitido(transferencia.status, 'recebida');
    if (erroStatus) throw new ErroTransferencia(409, erroStatus);

    const produtosDestino = await lerProdutos(tx, transferencia.itens.map((i) => i.produtoIdDestino));
    const lotesDestino = await lerLotes(tx, idsLotesDestino, transferencia.tenantDestino);
    const plano = regras.planejarRecebimento({ itens: transferencia.itens, recebidas, produtosDestino, lotesDestino });
    if (!plano.ok) throw new ErroTransferencia(409, plano.erros.join(' '));
    const preparado = await prepararRetorno(tx, transferencia, plano.retornos);

    const descricao = `Transferência nº ${transferencia.numeroTransferencia} da filial ${transferencia.origemCodigo} · ${transferencia.origemNome}`;
    plano.entradas.forEach((e) => {
      tx.update(db.collection('estoque').doc(e.produtoId), { quantidade: e.quantidadeDepois, precoCusto: e.precoCustoDepois, updatedAt: agora() });
      tx.set(db.collection('ajustes_estoque').doc(), ajuste(transferencia.tenantDestino, user, nome, e, 'entrada', regras.MOTIVO_TRANSFERENCIA_ENTRADA, descricao, e.quantidadeAntes, e.quantidadeDepois));
    });
    plano.lotesSomar.forEach((l) => tx.update(db.collection('estoque_lotes').doc(l.id), { quantidade: l.quantidadeDepois, updatedAt: agora() }));
    plano.lotesCriar.forEach((l) => tx.set(db.collection('estoque_lotes').doc(), {
      tenantId: transferencia.tenantDestino, produtoId: l.produtoId, lote: l.lote, validade: l.validade || null, quantidade: l.quantidade,
      origemTransferencia: transferencia.numeroTransferencia, createdAt: agora(), updatedAt: agora(),
    }));
    gravarRetorno(tx, transferencia, plano.retornos, preparado, user, nome, `Faltou na conferência da transferência nº ${transferencia.numeroTransferencia}`);
    tx.update(ref, {
      status: 'recebida',
      itens: plano.itensFinais,
      divergente: plano.divergente,
      recebidoPor: user.uid,
      recebidoPorNome: nome,
      recebidoEm: agora(),
      historico: [...(transferencia.historico || []), { acao: plano.divergente ? 'recebida com falta' : 'recebida', em: new Date().toISOString(), por: nome }],
    });
    return { ok: true, divergente: plano.divergente, numeroTransferencia: transferencia.numeroTransferencia, transferencia };
  });
};

/** Recusa (destino) ou cancela (origem): tudo volta para a origem. Motivo obrigatorio. */
const desfazerTransferencia = async ({ user, id, corpo, acao }) => {
  const { usuario } = await contexto(user);
  const nome = nomeDoUsuario(usuario, user);
  const motivo = String(corpo?.motivo || '').trim();
  if (motivo.length < 5) throw new ErroTransferencia(400, 'Escreva o motivo (pelo menos 5 letras).');
  const status = acao === 'recusar' ? 'recusada' : 'cancelada';

  return db.runTransaction(async (tx) => {
    const { ref, transferencia } = await lerTransferencia(tx, id);
    if (acao === 'recusar' && transferencia.tenantDestino !== user.tenantId) throw new ErroTransferencia(403, 'Só a filial de destino recusa a transferência.');
    if (acao === 'cancelar' && transferencia.tenantOrigem !== user.tenantId) throw new ErroTransferencia(403, 'Só a filial que enviou cancela a transferência.');
    const erroStatus = regras.proximoStatusPermitido(transferencia.status, status);
    if (erroStatus) throw new ErroTransferencia(409, erroStatus);
    const retornos = regras.retornoCompleto(transferencia.itens);
    const preparado = await prepararRetorno(tx, transferencia, retornos);
    gravarRetorno(tx, transferencia, retornos, preparado, user, nome, `Transferência nº ${transferencia.numeroTransferencia} ${status}: ${motivo}`);
    tx.update(ref, {
      status,
      motivo: motivo.slice(0, 300),
      [`${status === 'recusada' ? 'recusada' : 'cancelada'}Por`]: user.uid,
      [`${status === 'recusada' ? 'recusada' : 'cancelada'}PorNome`]: nome,
      [`${status === 'recusada' ? 'recusada' : 'cancelada'}Em`]: agora(),
      historico: [...(transferencia.historico || []), { acao: status, em: new Date().toISOString(), por: nome, motivo: motivo.slice(0, 300) }],
    });
    return { ok: true, numeroTransferencia: transferencia.numeroTransferencia, transferencia };
  });
};

module.exports = { ErroTransferencia, enviarTransferencia, receberTransferencia, desfazerTransferencia };
