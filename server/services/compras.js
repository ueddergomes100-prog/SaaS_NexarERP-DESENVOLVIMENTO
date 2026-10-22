const crypto = require('crypto');
const { admin, db } = require('../config/firebase');
const cd = require('../domain/comprasDomain');
const { buildDocumentMetadata, buildDocumentUpdateMetadata } = require('../domain/documentMetadata');

/**
 * COMPRAS (22/10/2026) -- regra em src/utils/comprasDomain.ts.
 *
 *   Cotacao:  criar, editar (aberta), cancelar, fechar, gerar os pedidos das
 *             escolhas; e o LINK PUBLICO do fornecedor (abrir + responder),
 *             sem login, protegido por token + codigo de acesso.
 *   Pedido:   criar a mao, editar (aberto), mudar status.
 *
 * Toda escrita e' daqui (Admin SDK); as telas leem `cotacoes_compra` e
 * `pedidos_compra` pelo Firestore (regra de leitura por empresa ja' existia).
 * O fornecedor nunca toca o banco: so' o servidor, pelo token.
 */

const COTACOES = 'cotacoes_compra';
const PEDIDOS = 'pedidos_compra';

class ErroCompras extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const TS = () => admin.firestore.FieldValue.serverTimestamp();
const agoraIso = () => new Date().toISOString();

const idValido = (id, mensagem) => {
  const texto = String(id || '').trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(texto)) throw new ErroCompras(400, mensagem);
  return texto;
};

const refSequencia = (tenantId, chave) => db.collection('contadores').doc(tenantId).collection('sequencias').doc(chave);

/** Proximo numero da sequencia (le e grava na mesma transacao). */
const proximoNumero = async (tx, tenantId, chave) => {
  const snap = await tx.get(refSequencia(tenantId, chave));
  const atual = snap.exists ? Number(snap.data().valor) || 0 : 0;
  return atual + 1;
};
const gravarSequencia = (tx, tenantId, chave, valor) => tx.set(refSequencia(tenantId, chave), { tenantId, chave, valor, updatedAt: TS() }, { merge: true });

// Token curto (8 letras/numeros, pedido do dono 22/10: link simples de mandar
// pelo WhatsApp). 36^8 combinacoes + codigo de acesso + limite por IP e por
// link; sem letras ambiguas (0/O, 1/I/L).
const ALFABETO_DO_TOKEN = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const novoToken = () => Array.from({ length: 8 }, () => ALFABETO_DO_TOKEN[crypto.randomInt(0, ALFABETO_DO_TOKEN.length)]).join('');
const novoCodigo = () => String(crypto.randomInt(0, 1000000)).padStart(cd.CODIGO_ACESSO_TAMANHO, '0');

const fornecedorNovo = (f) => ({
  fornecedorId: f.fornecedorId,
  nome: f.nome,
  email: f.email,
  celular: f.celular,
  token: novoToken(),
  codigoAcesso: novoCodigo(),
  status: 'aguardando',
  respondidoEmIso: '',
  precos: {},
  prazoEntregaDias: null,
  condicaoPagamento: '',
  observacao: '',
});

const lerCotacao = async (tx, tenantId, id) => {
  const ref = db.collection(COTACOES).doc(idValido(id, 'Cotação inválida. Atualize a tela e tente de novo.'));
  const snap = await tx.get(ref);
  if (!snap.exists || snap.data().tenantId !== tenantId) throw new ErroCompras(404, 'Esta cotação não existe mais. Atualize a tela.');
  return { ref, dados: snap.data() };
};

const criarCotacao = async ({ user, tenantId, corpo }) => {
  const lido = cd.lerPedidoDeCotacao(corpo);
  if ('erro' in lido) throw new ErroCompras(400, lido.erro);
  const { pedido } = lido;
  const fornecedores = pedido.fornecedores.map(fornecedorNovo);
  const ref = db.collection(COTACOES).doc();
  let numero = 0;
  await db.runTransaction(async (tx) => {
    numero = await proximoNumero(tx, tenantId, COTACOES);
    gravarSequencia(tx, tenantId, COTACOES, numero);
    tx.set(ref, {
      tenantId,
      numero,
      titulo: pedido.titulo,
      status: 'aberta',
      itens: pedido.itens,
      fornecedores,
      // Lista so' dos tokens: e' por ela que o link publico acha a cotacao.
      tokens: fornecedores.map((f) => f.token),
      responderAte: pedido.responderAte,
      observacao: pedido.observacao,
      escolhas: {},
      pedidosGerados: [],
      criadoEmIso: agoraIso(),
      createdAt: TS(),
      ...buildDocumentMetadata(user.uid, TS()),
    });
  });
  return { id: ref.id, numero };
};

const editarCotacao = async ({ user, tenantId, id, corpo }) => {
  const lido = cd.lerPedidoDeCotacao(corpo);
  if ('erro' in lido) throw new ErroCompras(400, lido.erro);
  const { pedido } = lido;
  let numero = 0;
  await db.runTransaction(async (tx) => {
    const { ref, dados } = await lerCotacao(tx, tenantId, id);
    if (dados.status !== 'aberta') throw new ErroCompras(409, 'Só uma cotação aberta pode ser alterada.');
    const atuais = Array.isArray(dados.fornecedores) ? dados.fornecedores : [];
    const jaRespondeu = atuais.some((f) => f.status === 'respondida');
    if (jaRespondeu) {
      const mesmosItens = JSON.stringify((dados.itens || []).map((i) => [i.produtoId, i.quantidade])) === JSON.stringify(pedido.itens.map((i) => [i.produtoId, i.quantidade]));
      if (!mesmosItens) throw new ErroCompras(409, 'Um fornecedor já respondeu: os itens e as quantidades não mudam mais. Cancele esta cotação e abra outra.');
    }
    // Fornecedor que ja' esta' na cotacao mantem o link e a resposta; novo ganha link novo.
    const fornecedores = pedido.fornecedores.map((f) => {
      const atual = atuais.find((a) => a.fornecedorId === f.fornecedorId);
      return atual ? { ...atual, nome: f.nome, email: f.email, celular: f.celular } : fornecedorNovo(f);
    });
    numero = Number(dados.numero) || 0;
    tx.update(ref, {
      titulo: pedido.titulo,
      itens: pedido.itens,
      fornecedores,
      tokens: fornecedores.map((f) => f.token),
      responderAte: pedido.responderAte,
      observacao: pedido.observacao,
      updatedAt: TS(),
      ...buildDocumentUpdateMetadata(user.uid, TS(), 'Cotação alterada'),
    });
  });
  return { id, numero };
};

const mudarStatusCotacao = async ({ user, tenantId, id, status }) => {
  if (status !== 'cancelada' && status !== 'fechada') throw new ErroCompras(400, 'Situação inválida.');
  let numero = 0;
  await db.runTransaction(async (tx) => {
    const { ref, dados } = await lerCotacao(tx, tenantId, id);
    if (dados.status !== 'aberta') throw new ErroCompras(409, `Esta cotação já está ${cd.ROTULO_STATUS_COTACAO[dados.status] || dados.status}.`);
    numero = Number(dados.numero) || 0;
    tx.update(ref, { status, updatedAt: TS(), ...buildDocumentUpdateMetadata(user.uid, TS(), status === 'cancelada' ? 'Cotação cancelada' : 'Cotação fechada') });
  });
  return { id, numero, status };
};

/** Gera um pedido de compra por fornecedor vencedor e fecha a cotacao. */
const gerarPedidosDaCotacao = async ({ user, tenantId, id, corpo }) => {
  const gerados = [];
  let numeroCotacao = 0;
  await db.runTransaction(async (tx) => {
    const { ref, dados } = await lerCotacao(tx, tenantId, id);
    if (dados.status !== 'aberta') throw new ErroCompras(409, 'Esta cotação já foi fechada ou cancelada.');
    const cotacao = { itens: dados.itens || [], fornecedores: dados.fornecedores || [] };
    const lidas = cd.lerEscolhas(corpo, cotacao);
    if ('erro' in lidas) throw new ErroCompras(400, lidas.erro);
    const pedidos = cd.pedidosDasEscolhas(cotacao, lidas.escolhas);
    if (pedidos.length === 0) throw new ErroCompras(400, 'Nenhum item com fornecedor escolhido.');
    numeroCotacao = Number(dados.numero) || 0;
    let numero = await proximoNumero(tx, tenantId, PEDIDOS) - 1;
    for (const pedido of pedidos) {
      numero += 1;
      const pedidoRef = db.collection(PEDIDOS).doc();
      tx.set(pedidoRef, {
        tenantId,
        numero,
        status: 'aberto',
        ...pedido,
        cotacaoId: ref.id,
        cotacaoNumero: numeroCotacao,
        criadoEmIso: agoraIso(),
        enviadoEmIso: '',
        recebidoEmIso: '',
        canceladoEmIso: '',
        createdAt: TS(),
        ...buildDocumentMetadata(user.uid, TS()),
      });
      gerados.push({ pedidoId: pedidoRef.id, fornecedorId: pedido.fornecedorId, fornecedorNome: pedido.fornecedorNome, numero, totalCentavos: pedido.totalCentavos });
    }
    gravarSequencia(tx, tenantId, PEDIDOS, numero);
    tx.update(ref, {
      status: 'fechada',
      escolhas: lidas.escolhas,
      pedidosGerados: gerados.map((g) => ({ pedidoId: g.pedidoId, fornecedorId: g.fornecedorId, numero: g.numero })),
      updatedAt: TS(),
      ...buildDocumentUpdateMetadata(user.uid, TS(), `${gerados.length} pedido(s) de compra gerado(s)`),
    });
  });
  return { id, numeroCotacao, pedidos: gerados };
};

// ---------------------------------------------------------------------------
// LINK PUBLICO DO FORNECEDOR
// ---------------------------------------------------------------------------

// 8 (novo) ou mais (links antigos de 32).
const tokenValido = (token) => typeof token === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(token);

const acharPelaChave = async (token, codigo) => {
  if (!tokenValido(token)) throw new ErroCompras(404, 'Este link de cotação não é válido.');
  if (!cd.codigoAcessoValido(codigo)) throw new ErroCompras(400, 'Informe o código de acesso de 6 números que a empresa enviou.');
  const snap = await db.collection(COTACOES).where('tokens', 'array-contains', token).limit(1).get();
  if (snap.empty) throw new ErroCompras(404, 'Este link de cotação não existe mais.');
  const doc = snap.docs[0];
  const dados = doc.data();
  const fornecedor = (dados.fornecedores || []).find((f) => f.token === token);
  if (!fornecedor || fornecedor.codigoAcesso !== String(codigo).trim()) throw new ErroCompras(403, 'Código de acesso incorreto. Confira o código que a empresa enviou.');
  return { ref: doc.ref, dados, fornecedor };
};

const nomeDaEmpresa = async (tenantId) => {
  try {
    const snap = await db.collection('configuracoes').doc(tenantId).get();
    const c = snap.exists ? snap.data() : {};
    return String(c.nomeOficina || c.razaoSocial || '').trim() || 'A empresa';
  } catch {
    return 'A empresa';
  }
};

const abrirPublica = async ({ token, codigo, hoje }) => {
  const { dados, fornecedor } = await acharPelaChave(token, codigo);
  const bloqueio = cd.erroParaResponder({ status: dados.status, responderAte: String(dados.responderAte || '') }, hoje);
  return {
    empresa: await nomeDaEmpresa(dados.tenantId),
    titulo: String(dados.titulo || ''),
    numero: Number(dados.numero) || 0,
    fornecedorNome: String(fornecedor.nome || ''),
    responderAte: String(dados.responderAte || ''),
    observacao: String(dados.observacao || ''),
    itens: (dados.itens || []).map((i) => ({ produtoId: i.produtoId, codigo: i.codigo, nome: i.nome, unidade: i.unidade, quantidade: i.quantidade, observacao: i.observacao || '' })),
    respostaAnterior: fornecedor.status === 'respondida'
      ? { precos: fornecedor.precos || {}, prazoEntregaDias: fornecedor.prazoEntregaDias, condicaoPagamento: fornecedor.condicaoPagamento || '', observacao: fornecedor.observacao || '', respondidoEmIso: fornecedor.respondidoEmIso || '' }
      : null,
    bloqueio,
  };
};

const responderPublica = async ({ token, codigo, corpo, hoje }) => {
  const achada = await acharPelaChave(token, codigo);
  const resumo = {};
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(achada.ref);
    const dados = snap.data();
    const bloqueio = cd.erroParaResponder({ status: dados.status, responderAte: String(dados.responderAte || '') }, hoje);
    if (bloqueio) throw new ErroCompras(409, bloqueio);
    const lida = cd.lerRespostaDoFornecedor(corpo, dados.itens || []);
    if ('erro' in lida) throw new ErroCompras(400, lida.erro);
    const fornecedores = (dados.fornecedores || []).map((f) => (f.token === token
      ? { ...f, ...lida.resposta, status: 'respondida', respondidoEmIso: agoraIso() }
      : f));
    resumo.itensCotados = Object.keys(lida.resposta.precos).length;
    tx.update(achada.ref, { fornecedores, updatedAt: TS() });
  });
  return { ok: true, ...resumo, empresa: await nomeDaEmpresa(achada.dados.tenantId) };
};

// ---------------------------------------------------------------------------
// PEDIDO DE COMPRA
// ---------------------------------------------------------------------------

const lerPedido = async (tx, tenantId, id) => {
  const ref = db.collection(PEDIDOS).doc(idValido(id, 'Pedido de compra inválido. Atualize a tela e tente de novo.'));
  const snap = await tx.get(ref);
  if (!snap.exists || snap.data().tenantId !== tenantId) throw new ErroCompras(404, 'Este pedido de compra não existe mais. Atualize a tela.');
  return { ref, dados: snap.data() };
};

const criarPedido = async ({ user, tenantId, corpo }) => {
  const lido = cd.lerPedidoDeCompra(corpo);
  if ('erro' in lido) throw new ErroCompras(400, lido.erro);
  const ref = db.collection(PEDIDOS).doc();
  let numero = 0;
  await db.runTransaction(async (tx) => {
    numero = await proximoNumero(tx, tenantId, PEDIDOS);
    gravarSequencia(tx, tenantId, PEDIDOS, numero);
    tx.set(ref, {
      tenantId,
      numero,
      status: 'aberto',
      ...lido.pedido,
      cotacaoId: '',
      cotacaoNumero: null,
      criadoEmIso: agoraIso(),
      enviadoEmIso: '',
      recebidoEmIso: '',
      canceladoEmIso: '',
      createdAt: TS(),
      ...buildDocumentMetadata(user.uid, TS()),
    });
  });
  return { id: ref.id, numero, totalCentavos: lido.pedido.totalCentavos };
};

const editarPedido = async ({ user, tenantId, id, corpo }) => {
  const lido = cd.lerPedidoDeCompra(corpo);
  if ('erro' in lido) throw new ErroCompras(400, lido.erro);
  let numero = 0;
  await db.runTransaction(async (tx) => {
    const { ref, dados } = await lerPedido(tx, tenantId, id);
    if (!cd.podeEditarPedido(dados.status)) throw new ErroCompras(409, 'Só um pedido Aberto pode ser alterado.');
    numero = Number(dados.numero) || 0;
    tx.update(ref, { ...lido.pedido, updatedAt: TS(), ...buildDocumentUpdateMetadata(user.uid, TS(), 'Pedido de compra alterado') });
  });
  return { id, numero, totalCentavos: lido.pedido.totalCentavos };
};

const mudarStatusPedido = async ({ user, tenantId, id, status }) => {
  if (!['enviado', 'recebido', 'cancelado'].includes(status)) throw new ErroCompras(400, 'Situação inválida.');
  let numero = 0;
  await db.runTransaction(async (tx) => {
    const { ref, dados } = await lerPedido(tx, tenantId, id);
    const erro = cd.erroParaMudarStatus(dados.status, status);
    if (erro) throw new ErroCompras(409, erro);
    numero = Number(dados.numero) || 0;
    const marca = status === 'enviado' ? { enviadoEmIso: agraIsoOuVazio(dados.enviadoEmIso) } : status === 'recebido' ? { recebidoEmIso: agoraIso() } : { canceladoEmIso: agoraIso() };
    tx.update(ref, { status, ...marca, updatedAt: TS(), ...buildDocumentUpdateMetadata(user.uid, TS(), `Pedido de compra ${cd.ROTULO_STATUS_PEDIDO_COMPRA[status].toLowerCase()}`) });
  });
  return { id, numero, status };
};

// Marcar "enviado" de novo (reenvio do PDF) mantem a primeira data.
const agraIsoOuVazio = (anterior) => (anterior ? anterior : agoraIso());

module.exports = {
  COTACOES,
  PEDIDOS,
  ErroCompras,
  criarCotacao,
  editarCotacao,
  mudarStatusCotacao,
  gerarPedidosDaCotacao,
  abrirPublica,
  responderPublica,
  criarPedido,
  editarPedido,
  mudarStatusPedido,
};
