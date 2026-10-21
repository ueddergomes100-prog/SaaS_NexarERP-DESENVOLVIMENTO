/*
 * BALANCO (INVENTARIO) PELO SERVIDOR (21/10/2026). Regra e decisoes do dono em
 * src/utils/balancoDomain.ts.
 *
 *  abrir:   le os itens do escopo (estoque ou materia-prima, com os lotes),
 *           divide entre quem conta e grava o balanco + um documento por item
 *           em `balancos/{id}/itens`. Com a trava, marca a empresa
 *           (configuracoes.balancoEmAndamento): venda/PDV/OS nao finalizam.
 *  contar:  so' quem recebeu o item conta; na primeira contagem guarda o saldo
 *           do sistema NAQUELE momento (o ajuste e' pela diferenca dali).
 *  fechar:  aplica os ajustes em lotes de itens (cada lote numa transacao, com
 *           o saldo de agora), grava cada movimento em `ajustes_estoque`
 *           (motivo "balanco") e tira a trava. Item ja' aplicado nao e'
 *           aplicado de novo (fechar de novo continua de onde parou).
 *
 * `balancos` e' colecao so' do servidor: as rules negam; as telas leem por aqui.
 */
const { admin, db } = require('../config/firebase');
const bd = require('../domain/balancoDomain');
const { resolveUnidadeMedidaProduto } = require('../domain/unidadeMedidaDomain');

class ErroBalanco extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const COLECAO = 'balancos';
const agora = () => admin.firestore.FieldValue.serverTimestamp();
const apagar = () => admin.firestore.FieldValue.delete();
const refBalanco = (id) => db.collection(COLECAO).doc(String(id || '-'));
const refItens = (id) => refBalanco(id).collection('itens');
const nomeDe = (u) => String((u && (u.nome || u.nomeResponsavel || u.email)) || 'Usuário');
/** Nome do cadastro de quem esta' logado (o token so' traz o e-mail). */
const nomeDoCadastro = async (user) => {
  if (user.nome) return String(user.nome);
  const s = await db.collection('usuarios').doc(String(user.uid || '-')).get();
  return s.exists ? nomeDe(s.data()) : nomeDe(user);
};
const ITENS_POR_LOTE_NO_FECHAMENTO = 60;
const TAMANHO_DO_BATCH = 400;

const lerBalanco = async (tenantId, id, tx) => {
  const snap = tx ? await tx.get(refBalanco(id)) : await refBalanco(id).get();
  if (!snap.exists || snap.data().tenantId !== tenantId) throw new ErroBalanco(404, 'Balanço não encontrado. Atualize a lista.');
  return { id: snap.id, ...snap.data() };
};

const exigirAberto = (b, { fechando = false } = {}) => {
  if (b.status === bd.STATUS_BALANCO.contando) return;
  if (fechando && b.status === bd.STATUS_BALANCO.fechando) return;
  if (b.status === bd.STATUS_BALANCO.fechando) {
    throw new ErroBalanco(409, `O balanço "${b.nome}" está sendo fechado: a contagem acabou.`);
  }
  throw new ErroBalanco(409, `O balanço "${b.nome}" já foi ${b.status === bd.STATUS_BALANCO.fechado ? 'fechado' : 'cancelado'}.`);
};

const gravarEmLotes = async (escritas) => {
  for (let i = 0; i < escritas.length; i += TAMANHO_DO_BATCH) {
    const lote = db.batch();
    escritas.slice(i, i + TAMANHO_DO_BATCH).forEach(([ref, dados]) => lote.set(ref, dados));
    // eslint-disable-next-line no-await-in-loop
    await lote.commit();
  }
};

// ===========================================================================
// ABRIR
// ===========================================================================

/** Itens do escopo, no formato do documento do balanco (sem o contador). */
const lerItensDoEscopo = async (tenantId, escopo) => {
  if (escopo.tipo === 'materias_primas') {
    const snap = await db.collection('materias_primas').where('tenantId', '==', tenantId).get();
    return snap.docs.filter((d) => d.data().ativo !== false).map((d) => {
      const p = d.data();
      const sigla = String(p.unidade || 'UN').toUpperCase();
      return {
        chave: `materias_primas__${d.id}`, colecao: 'materias_primas', produtoId: d.id,
        nome: String(p.nome || ''), codigo: String(p.codigo || ''), codigoBarras: '', grupo: bd.grupoDoItem(p),
        unidade: { sigla, fracionado: sigla !== 'UN', casas: sigla !== 'UN' ? 3 : 0 }, controlaLote: false, lotes: [],
      };
    });
  }
  const [produtosSnap, lotesSnap] = await Promise.all([
    db.collection('estoque').where('tenantId', '==', tenantId).get(),
    db.collection('estoque_lotes').where('tenantId', '==', tenantId).get(),
  ]);
  const lotesPorProduto = new Map();
  lotesSnap.docs.forEach((d) => {
    const l = d.data();
    if (!(Number(l.quantidade) > 0)) return;
    const lista = lotesPorProduto.get(l.produtoId) || [];
    lista.push({ loteId: d.id, lote: String(l.lote || ''), validade: String(l.validade || ''), contado: null, saldoNaContagem: null });
    lotesPorProduto.set(l.produtoId, lista);
  });
  return produtosSnap.docs.filter((d) => bd.produtoEntraNoEscopo(d.data(), escopo)).map((d) => {
    const p = d.data();
    const u = resolveUnidadeMedidaProduto(p);
    const controlaLote = p.controlarLote === true;
    return {
      chave: `estoque__${d.id}`, colecao: 'estoque', produtoId: d.id,
      nome: String(p.nome || ''), codigo: String(p.codigo || ''), codigoBarras: String(p.codigoBarras || ''), grupo: bd.grupoDoItem(p),
      unidade: { sigla: u.unidadeMedidaSigla || 'UN', fracionado: u.unidadeMedidaFracionado === true, casas: Number(u.unidadeMedidaCasasDecimais || 0) },
      controlaLote,
      lotes: controlaLote ? (lotesPorProduto.get(d.id) || []).sort((a, b) => a.validade.localeCompare(b.validade)) : [],
    };
  });
};

/** Grupos que os produtos ativos realmente tem (com quantos itens cada), para escolher o que contar. */
const gruposDisponiveis = async ({ tenantId }) => {
  const itens = await lerItensDoEscopo(tenantId, { tipo: 'todos', categorias: [] });
  const porGrupo = new Map();
  itens.forEach((i) => porGrupo.set(i.grupo, (porGrupo.get(i.grupo) || 0) + 1));
  return [...porGrupo.entries()].map(([nome, quantidade]) => ({ nome, itens: quantidade })).sort((a, b) => a.nome.localeCompare(b.nome));
};

const abrir = async ({ user, tenantId, corpo }) => {
  const lido = bd.lerPedidoDeAbertura(corpo);
  if ('erro' in lido) throw new ErroBalanco(400, lido.erro);
  const pedido = lido.pedido;

  const configRef = db.collection('configuracoes').doc(tenantId);
  const config = (await configRef.get()).data() || {};
  if (config.balancoEmAndamento && config.balancoEmAndamento.balancoId) {
    throw new ErroBalanco(409, `Já existe um balanço aberto ("${config.balancoEmAndamento.nome || ''}"). Feche ou cancele antes de abrir outro.`);
  }

  const snapsUsuarios = await db.getAll(...pedido.contadores.map((uid) => db.collection('usuarios').doc(uid)));
  const contadores = snapsUsuarios.map((s) => {
    if (!s.exists || s.data().tenantId !== tenantId || s.data().status === 'Inativo') {
      throw new ErroBalanco(400, 'Uma das pessoas escolhidas para contar não está ativa nesta empresa. Escolha de novo.');
    }
    return { uid: s.id, nome: nomeDe(s.data()), concluido: false };
  });

  const itens = await lerItensDoEscopo(tenantId, pedido.escopo);
  if (itens.length === 0) throw new ErroBalanco(400, 'Nenhum item ativo encontrado no que foi escolhido para contar.');
  const divisao = bd.dividirEmBlocos(itens.map((i) => ({ chave: i.chave, grupo: i.grupo, nome: i.nome })), contadores.map((c) => c.uid));

  const ref = db.collection(COLECAO).doc();
  const balanco = {
    tenantId,
    nome: pedido.nome,
    escopo: pedido.escopo,
    travaVendas: pedido.travaVendas,
    contadores,
    blocos: divisao.blocos,
    totalItens: itens.length,
    status: bd.STATUS_BALANCO.contando,
    abertoPor: user.uid,
    abertoPorNome: await nomeDoCadastro(user),
    createdAt: agora(),
    updatedAt: agora(),
  };
  await ref.set(balanco);
  await gravarEmLotes(itens.map((i) => [ref.collection('itens').doc(i.chave), {
    ...i,
    contadorUid: divisao.porItem[i.chave],
    contado: null,
    saldoNaContagem: null,
    contadoEm: null,
    contadoPorNome: null,
    aplicado: false,
  }]));
  await configRef.set({ balancoEmAndamento: { balancoId: ref.id, nome: pedido.nome, travaVendas: pedido.travaVendas, desde: agora() } }, { merge: true });
  return { id: ref.id, nome: pedido.nome, totalItens: itens.length, blocos: divisao.blocos, contadores };
};

// ===========================================================================
// CONTAR
// ===========================================================================

const lerPedidoDeContagem = (corpo) => {
  const c = corpo && typeof corpo === 'object' ? corpo : {};
  const chave = String(c.chave || '');
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(chave)) return { erro: 'Item inválido. Atualize a lista.' };
  const quantidade = Number(String(c.quantidade ?? '').replace(',', '.'));
  if (String(c.quantidade ?? '').trim() === '' || !Number.isFinite(quantidade)) return { erro: 'Informe a quantidade contada.' };
  const modo = c.modo === 'definir' ? 'definir' : 'somar';
  const loteIndice = c.loteIndice === undefined || c.loteIndice === null ? null : Number(c.loteIndice);
  const loteNovo = c.loteNovo && typeof c.loteNovo === 'object'
    ? { lote: String(c.loteNovo.lote || '').trim().toUpperCase().slice(0, 40), validade: String(c.loteNovo.validade || '').slice(0, 10) }
    : null;
  if (loteNovo && !loteNovo.lote) return { erro: 'Informe o número do lote novo.' };
  if (loteNovo && loteNovo.validade && !/^\d{4}-\d{2}-\d{2}$/.test(loteNovo.validade)) return { erro: 'Validade do lote inválida.' };
  return { chave, quantidade, modo, loteIndice, loteNovo };
};

const contar = async ({ user, tenantId, balancoId, corpo }) => {
  const p = lerPedidoDeContagem(corpo);
  if (p.erro) throw new ErroBalanco(400, p.erro);
  return db.runTransaction(async (tx) => {
    const balanco = await lerBalanco(tenantId, balancoId, tx);
    exigirAberto(balanco);
    const itemRef = refItens(balancoId).doc(p.chave);
    const itemSnap = await tx.get(itemRef);
    if (!itemSnap.exists) throw new ErroBalanco(404, 'Este item não faz parte do balanço. Atualize a lista.');
    const item = itemSnap.data();
    if (item.contadorUid !== user.uid) throw new ErroBalanco(403, `${item.nome} está na lista de outra pessoa. Conte só os itens da sua lista.`);
    const erroQtd = bd.erroDaQuantidade(p.quantidade, item.unidade, item.nome);
    if (erroQtd) throw new ErroBalanco(400, erroQtd);

    // Saldo do sistema no momento da PRIMEIRA contagem (contagem cega: nao volta para a tela).
    const produtoRef = db.collection(item.colecao).doc(item.produtoId);
    const lotes = Array.isArray(item.lotes) ? item.lotes.map((l) => ({ ...l })) : [];
    let loteRef = null;
    if (item.controlaLote && !p.loteNovo) {
      const l = lotes[p.loteIndice];
      if (!l) throw new ErroBalanco(400, `Escolha de qual lote de ${item.nome} é a quantidade.`);
      if (l.loteId && l.saldoNaContagem === null) loteRef = db.collection('estoque_lotes').doc(l.loteId);
    }
    const [produtoSnap, loteSnap] = await Promise.all([
      item.saldoNaContagem === null ? tx.get(produtoRef) : Promise.resolve(null),
      loteRef ? tx.get(loteRef) : Promise.resolve(null),
    ]);
    const eu = (balanco.contadores || []).find((c) => c.uid === user.uid);
    const atualizacao = { contadoEm: agora(), contadoPorNome: eu ? eu.nome : nomeDe(user) };
    if (produtoSnap) atualizacao.saldoNaContagem = produtoSnap.exists ? Number(produtoSnap.data().quantidade || 0) : 0;

    if (!item.controlaLote) {
      atualizacao.contado = bd.novoTotalContado(item.contado, p.quantidade, p.modo);
    } else if (p.loteNovo) {
      if (lotes.some((l) => l.lote === p.loteNovo.lote)) throw new ErroBalanco(409, `O lote ${p.loteNovo.lote} já está na lista de ${item.nome}: lance nele.`);
      lotes.push({ loteId: null, lote: p.loteNovo.lote, validade: p.loteNovo.validade, contado: p.quantidade, saldoNaContagem: 0 });
      atualizacao.lotes = lotes;
    } else {
      const l = lotes[p.loteIndice];
      if (loteSnap) l.saldoNaContagem = loteSnap.exists ? Number(loteSnap.data().quantidade || 0) : 0;
      l.contado = bd.novoTotalContado(l.contado, p.quantidade, p.modo);
      atualizacao.lotes = lotes;
    }
    tx.update(itemRef, atualizacao);
    const depois = { ...item, ...atualizacao };
    return { chave: p.chave, contado: item.controlaLote ? bd.totalContado(depois) : atualizacao.contado, lotes: (depois.lotes || []).map((l) => ({ lote: l.lote, validade: l.validade, contado: l.contado })) };
  });
};

/** Lista de quem conta: so' os itens dele e SEM o saldo do sistema (contagem cega). */
const minhaLista = async ({ user, tenantId, balancoId }) => {
  const balanco = await lerBalanco(tenantId, balancoId);
  const snap = await refItens(balancoId).where('contadorUid', '==', user.uid).get();
  const eu = (balanco.contadores || []).find((c) => c.uid === user.uid);
  if (!eu) throw new ErroBalanco(403, 'Você não está entre as pessoas que contam este balanço.');
  return {
    balanco: { id: balanco.id, nome: balanco.nome, status: balanco.status, concluido: eu.concluido === true },
    itens: snap.docs.map((d) => {
      const i = d.data();
      return {
        chave: d.id, nome: i.nome, codigo: i.codigo, codigoBarras: i.codigoBarras, grupo: i.grupo, unidade: i.unidade,
        controlaLote: i.controlaLote === true,
        contado: i.controlaLote ? bd.totalContado(i) : i.contado,
        lotes: (i.lotes || []).map((l) => ({ lote: l.lote, validade: l.validade, contado: l.contado })),
      };
    }).sort((a, b) => a.grupo.localeCompare(b.grupo) || a.nome.localeCompare(b.nome)),
  };
};

/** Balancos abertos em que a pessoa conta (tela "Contar" do app e do computador). */
const paraContar = async ({ user, tenantId }) => {
  const snap = await db.collection(COLECAO).where('tenantId', '==', tenantId).where('status', '==', bd.STATUS_BALANCO.contando).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((b) => (b.contadores || []).some((c) => c.uid === user.uid))
    .map((b) => ({ id: b.id, nome: b.nome, itens: ((b.blocos || []).find((x) => x.contadorUid === user.uid) || {}).itens || 0 }));
};

const concluirMinhaParte = async ({ user, tenantId, balancoId }) => db.runTransaction(async (tx) => {
  const b = await lerBalanco(tenantId, balancoId, tx);
  exigirAberto(b);
  if (!(b.contadores || []).some((c) => c.uid === user.uid)) throw new ErroBalanco(403, 'Você não está entre as pessoas que contam este balanço.');
  tx.update(refBalanco(balancoId), { contadores: b.contadores.map((c) => (c.uid === user.uid ? { ...c, concluido: true } : c)), updatedAt: agora() });
  return { ok: true };
});

// ===========================================================================
// GESTOR: lista, conferencia, trocar quem conta, fechar, cancelar
// ===========================================================================

const listar = async ({ tenantId }) => {
  const snap = await db.collection(COLECAO).where('tenantId', '==', tenantId).get();
  const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : 0);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt))
    .slice(0, 50)
    .map((b) => ({
      id: b.id, nome: b.nome, status: b.status, escopo: b.escopo, travaVendas: b.travaVendas === true, totalItens: b.totalItens || 0,
      contadores: (b.contadores || []).map((c) => ({ uid: c.uid, nome: c.nome, concluido: c.concluido === true })),
      abertoPorNome: b.abertoPorNome || '', criadoEmMs: ms(b.createdAt), fechadoEmMs: ms(b.fechadoEm), resumo: b.resumo || null, regraNegativo: b.regraNegativo || null,
    }));
};

/** Saldo de agora dos produtos e lotes dos itens (consulta, fora de transacao). */
const saldosDeAgora = async (itens) => {
  const refs = new Map();
  const lotes = new Map();
  itens.forEach((i) => {
    refs.set(`${i.colecao}/${i.produtoId}`, db.collection(i.colecao).doc(i.produtoId));
    (i.lotes || []).forEach((l) => { if (l.loteId) lotes.set(l.loteId, db.collection('estoque_lotes').doc(l.loteId)); });
  });
  const produtos = {};
  const saldoLotes = {};
  const listaRefs = [...refs.entries()];
  for (let k = 0; k < listaRefs.length; k += 300) {
    // eslint-disable-next-line no-await-in-loop
    (await db.getAll(...listaRefs.slice(k, k + 300).map(([, r]) => r))).forEach((s, j) => {
      produtos[listaRefs[k + j][0]] = s.exists ? Number(s.data().quantidade || 0) : 0;
    });
  }
  const listaLotes = [...lotes.entries()];
  for (let k = 0; k < listaLotes.length; k += 300) {
    // eslint-disable-next-line no-await-in-loop
    (await db.getAll(...listaLotes.slice(k, k + 300).map(([, r]) => r))).forEach((s, j) => {
      saldoLotes[listaLotes[k + j][0]] = s.exists ? Number(s.data().quantidade || 0) : 0;
    });
  }
  return { produtos, saldoLotes };
};

/** Conferencia do gestor: cada item com o saldo, o contado e como fica nas duas regras. */
const conferencia = async ({ tenantId, balancoId }) => {
  const balanco = await lerBalanco(tenantId, balancoId);
  const itens = (await refItens(balancoId).get()).docs.map((d) => ({ chave: d.id, ...d.data() }));
  const { produtos, saldoLotes } = await saldosDeAgora(itens);
  const linhas = itens.map((i) => {
    const agoraSaldo = produtos[`${i.colecao}/${i.produtoId}`] ?? 0;
    const contado = bd.ajusteDoItem(i, agoraSaldo, saldoLotes, 'contado');
    const descontar = bd.ajusteDoItem(i, agoraSaldo, saldoLotes, 'descontar');
    return {
      chave: i.chave, nome: i.nome, codigo: i.codigo, grupo: i.grupo, unidade: i.unidade, contadorUid: i.contadorUid,
      contadoPorNome: i.contadoPorNome || null, saldoNaContagem: i.saldoNaContagem, saldoAgora: agoraSaldo,
      contado: bd.totalContado(i), naoContado: contado.naoContado, controlaLote: i.controlaLote === true,
      lotes: contado.lotes, depoisContado: contado.depois, depoisDescontar: descontar.depois, aplicado: i.aplicado === true,
    };
  }).sort((a, b) => a.grupo.localeCompare(b.grupo) || a.nome.localeCompare(b.nome));
  const progresso = (balanco.contadores || []).map((c) => {
    const meus = linhas.filter((l) => l.contadorUid === c.uid);
    return { uid: c.uid, nome: c.nome, concluido: c.concluido === true, total: meus.length, contados: meus.filter((l) => !l.naoContado).length };
  });
  return {
    balanco: { id: balanco.id, nome: balanco.nome, status: balanco.status, travaVendas: balanco.travaVendas === true, escopo: balanco.escopo, regraNegativo: balanco.regraNegativo || null, resumo: balanco.resumo || null },
    progresso,
    linhas,
  };
};

/** Passa os itens de uma pessoa (ou so' de um grupo dela) para outra. Item ja' contado vai junto com a contagem. */
const trocarContador = async ({ tenantId, balancoId, corpo }) => {
  const de = String((corpo && corpo.de) || '');
  const para = String((corpo && corpo.para) || '');
  const grupo = corpo && corpo.grupo ? String(corpo.grupo) : null;
  const balanco = await lerBalanco(tenantId, balancoId);
  exigirAberto(balanco);
  if (!de || !para || de === para) throw new ErroBalanco(400, 'Escolha de quem e para quem passar os itens.');
  let contadores = balanco.contadores || [];
  if (!contadores.some((c) => c.uid === de)) throw new ErroBalanco(400, 'A pessoa de origem não conta este balanço.');
  if (!contadores.some((c) => c.uid === para)) {
    const s = await db.collection('usuarios').doc(para).get();
    if (!s.exists || s.data().tenantId !== tenantId || s.data().status === 'Inativo') throw new ErroBalanco(400, 'A pessoa escolhida não está ativa nesta empresa.');
    contadores = [...contadores, { uid: para, nome: nomeDe(s.data()), concluido: false }];
  }
  const snap = await refItens(balancoId).where('contadorUid', '==', de).get();
  const docs = snap.docs.filter((d) => !grupo || d.data().grupo === grupo);
  for (let i = 0; i < docs.length; i += TAMANHO_DO_BATCH) {
    const lote = db.batch();
    docs.slice(i, i + TAMANHO_DO_BATCH).forEach((d) => lote.update(d.ref, { contadorUid: para }));
    // eslint-disable-next-line no-await-in-loop
    await lote.commit();
  }
  const todos = (await refItens(balancoId).get()).docs.map((d) => ({ chave: d.id, grupo: d.data().grupo, contadorUid: d.data().contadorUid }));
  const blocos = contadores.map((c) => {
    const meus = todos.filter((t) => t.contadorUid === c.uid);
    const grupos = new Map();
    meus.forEach((t) => grupos.set(t.grupo, (grupos.get(t.grupo) || 0) + 1));
    return { contadorUid: c.uid, itens: meus.length, grupos: [...grupos.entries()].map(([nome, itens]) => ({ nome, itens })).sort((a, b) => a.nome.localeCompare(b.nome)) };
  });
  await refBalanco(balancoId).update({ contadores: contadores.map((c) => (c.uid === para ? { ...c, concluido: false } : c)), blocos, updatedAt: agora() });
  return { movidos: docs.length };
};

const tirarTrava = async (tenantId, balancoId) => {
  const configRef = db.collection('configuracoes').doc(tenantId);
  const config = (await configRef.get()).data() || {};
  if (config.balancoEmAndamento && config.balancoEmAndamento.balancoId === balancoId) {
    await configRef.update({ balancoEmAndamento: apagar() });
  }
};

const fechar = async ({ user, tenantId, balancoId, corpo }) => {
  const balanco = await lerBalanco(tenantId, balancoId);
  exigirAberto(balanco, { fechando: true });
  // Fechar de novo (caiu no meio) continua com a MESMA regra: os itens ja' aplicados usaram ela.
  const regra = balanco.status === bd.STATUS_BALANCO.fechando && balanco.regraNegativo
    ? balanco.regraNegativo
    : (corpo && corpo.regraNegativo === 'descontar' ? 'descontar' : 'contado');
  // Daqui em diante ninguem conta mais.
  await refBalanco(balancoId).update({ status: bd.STATUS_BALANCO.fechando, regraNegativo: regra, updatedAt: agora() });
  const pendentes = (await refItens(balancoId).get()).docs.filter((d) => d.data().aplicado !== true).map((d) => d.ref);
  const usuarioNome = await nomeDoCadastro(user);
  const resumo = { ...(balanco.resumoParcial || {}) };

  for (let k = 0; k < pendentes.length; k += ITENS_POR_LOTE_NO_FECHAMENTO) {
    const fatia = pendentes.slice(k, k + ITENS_POR_LOTE_NO_FECHAMENTO);
    // Contagem da fatia: a transacao pode rodar mais de uma vez, entao so' soma depois do commit.
    let parcial = {};
    const somar = (chave, n = 1) => { parcial[chave] = (parcial[chave] || 0) + n; };
    // eslint-disable-next-line no-await-in-loop
    await db.runTransaction(async (tx) => {
      parcial = {};
      // ---- leituras ----
      const itens = (await tx.getAll(...fatia))
        .map((s, j) => ({ s, ref: fatia[j] }))
        .filter(({ s }) => s.exists && s.data().aplicado !== true)
        .map(({ s, ref }) => ({ ref, chave: s.id, ...s.data() }));
      const produtoRefs = itens.map((i) => db.collection(i.colecao).doc(i.produtoId));
      const produtoSnaps = produtoRefs.length ? await tx.getAll(...produtoRefs) : [];
      const loteRefs = itens.flatMap((i) => (i.lotes || []).filter((l) => l.loteId).map((l) => db.collection('estoque_lotes').doc(l.loteId)));
      const loteSnaps = loteRefs.length ? await tx.getAll(...loteRefs) : [];
      const saldoLotes = {};
      loteSnaps.forEach((s) => { saldoLotes[s.id] = s.exists ? Number(s.data().quantidade || 0) : 0; });

      // ---- escritas ----
      itens.forEach((item, j) => {
        const snap = produtoSnaps[j];
        if (!snap.exists || snap.data().tenantId !== tenantId) {
          tx.update(item.ref, { aplicado: true, ajuste: { ignorado: 'produto não existe mais' } });
          somar('ignorados');
          return;
        }
        const produto = snap.data();
        const ajuste = bd.ajusteDoItem(item, Number(produto.quantidade || 0), saldoLotes, regra);
        const base = {
          tenantId, produtoId: item.produtoId, produtoNome: item.nome, ...(item.codigo ? { produtoCodigo: item.codigo } : {}),
          motivo: 'balanco', observacao: `Balanço "${balanco.nome}"${ajuste.naoContado ? ' (não contado: zerado)' : ''}`,
          usuarioId: user.uid, usuarioNome, balancoId, ...(item.colecao === 'materias_primas' ? { origem: 'materia_prima' } : {}),
          createdAt: agora(),
        };
        if (Math.abs(ajuste.delta) > 1e-9) {
          tx.update(db.collection(item.colecao).doc(item.produtoId), { quantidade: ajuste.depois, updatedAt: agora() });
          tx.set(db.collection('ajustes_estoque').doc(), {
            ...base, tipo: ajuste.delta > 0 ? 'entrada' : 'saida', quantidade: Math.abs(ajuste.delta), quantidadeAntes: ajuste.antes, quantidadeDepois: ajuste.depois,
          });
          somar(ajuste.delta > 0 ? 'sobras' : 'faltas');
        }
        ajuste.lotes.forEach((l) => {
          if (Math.abs(l.delta) < 1e-9) return;
          if (l.loteId) {
            tx.update(db.collection('estoque_lotes').doc(l.loteId), { quantidade: l.depois, updatedAt: agora() });
          } else if (l.depois > 0) {
            tx.set(db.collection('estoque_lotes').doc(), {
              tenantId, produtoId: item.produtoId, lote: l.lote, validade: l.validade || '', quantidade: l.depois, origemBalanco: balancoId, createdAt: agora(), updatedAt: agora(),
            });
          }
        });
        somar('itens');
        if (ajuste.naoContado) somar('naoContados');
        tx.update(item.ref, { aplicado: true, ajuste: { antes: ajuste.antes, depois: ajuste.depois, delta: ajuste.delta, naoContado: ajuste.naoContado } });
      });
    });
    Object.entries(parcial).forEach(([chave, n]) => { resumo[chave] = (resumo[chave] || 0) + n; });
    // eslint-disable-next-line no-await-in-loop
    await refBalanco(balancoId).update({ resumoParcial: resumo });
  }

  await refBalanco(balancoId).update({
    status: bd.STATUS_BALANCO.fechado, regraNegativo: regra, resumo, fechadoEm: agora(), fechadoPor: user.uid, fechadoPorNome: usuarioNome, updatedAt: agora(),
  });
  await tirarTrava(tenantId, balancoId);
  return { nome: balanco.nome, resumo, regraNegativo: regra };
};

const cancelar = async ({ user, tenantId, balancoId, corpo }) => {
  const motivo = String((corpo && corpo.motivo) || '').replace(/\s+/g, ' ').trim();
  if (motivo.length < 5) throw new ErroBalanco(400, 'Escreva o motivo do cancelamento (mínimo 5 letras).');
  const balanco = await lerBalanco(tenantId, balancoId);
  if (balanco.status === bd.STATUS_BALANCO.fechando) throw new ErroBalanco(409, 'Este balanço começou a ser fechado e já ajustou parte do estoque: termine o fechamento.');
  exigirAberto(balanco);
  await refBalanco(balancoId).update({ status: bd.STATUS_BALANCO.cancelado, motivoCancelamento: motivo, canceladoPor: user.uid, canceladoEm: agora(), updatedAt: agora() });
  await tirarTrava(tenantId, balancoId);
  return { nome: balanco.nome };
};

module.exports = {
  ErroBalanco, gruposDisponiveis, abrir, contar, minhaLista, paraContar, concluirMinhaParte, listar, conferencia, trocarContador, fechar, cancelar,
};
