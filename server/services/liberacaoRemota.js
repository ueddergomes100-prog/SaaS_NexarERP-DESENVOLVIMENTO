const { admin, db } = require('../config/firebase');
const cd = require('../domain/conferenciaDescontoDomain');
const lr = require('../domain/liberacaoRemotaDomain');
const { validarPin } = require('./vendedorPin');
const { emitirComprovante, refDoComprovante } = require('./comprovantes');
const avisos = require('./notificacoesPush');

/**
 * LIBERACAO DE DESCONTO PELO CELULAR (21/10/2026) -- regra em
 * src/utils/liberacaoRemotaDomain.ts.
 *
 *   pedir      -> a estacao grava o pedido e quem pode liberar recebe o aviso
 *   consultar  -> a estacao acompanha (a cada 3 s) ate' a resposta
 *   cancelar   -> o vendedor desistiu
 *   pendentes  -> a tela Liberacoes do app (so' quem pode liberar)
 *   responder  -> o gerente aprova/recusa confirmando a propria senha ou PIN;
 *                 aprovado, nasce o comprovante PARA A ESTACAO, igual ao da
 *                 senha digitada ali (services/liberacaoDesconto.js)
 *
 * A colecao `liberacoes_desconto` e' so' do servidor (sem regra no Firestore).
 */

const COLECAO = 'liberacoes_desconto';

class ErroLiberacaoRemota extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const TS = () => admin.firestore.FieldValue.serverTimestamp();

const idValido = (id) => {
  const texto = String(id || '').trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(texto)) throw new ErroLiberacaoRemota(400, 'Pedido de liberação inválido. Peça a liberação de novo.');
  return texto;
};

const nomeDoUsuario = (dados, padrao) => String((dados && (dados.nome || dados.nomeResponsavel || dados.email)) || padrao);

const lerUsuario = async (uid, tenantId) => {
  const snap = await db.collection('usuarios').doc(uid).get();
  const dados = snap.exists ? snap.data() : null;
  return dados && dados.tenantId === tenantId ? dados : null;
};

/** Quem pode liberar desconto nesta empresa (ativos). */
const aprovadoresDoTenant = async (tenantId) => {
  const snap = await db.collection('usuarios').where('tenantId', '==', tenantId).get();
  return snap.docs
    .filter((d) => {
      const u = d.data();
      if (u.status && u.status !== 'Ativo') return false;
      return cd.podeLiberarDesconto(u, d.id, tenantId);
    })
    .map((d) => d.id);
};

const exigirAprovador = async (user, tenantId) => {
  const usuario = await lerUsuario(user.uid, tenantId);
  if (!usuario) throw new ErroLiberacaoRemota(403, 'Seu usuário não é desta empresa.');
  if (usuario.status && usuario.status !== 'Ativo') throw new ErroLiberacaoRemota(403, 'Seu usuário está inativo e não pode liberar desconto.');
  if (!cd.podeLiberarDesconto(usuario, user.uid, tenantId)) {
    throw new ErroLiberacaoRemota(403, 'Você não tem a permissão "Liberar desconto". Peça ao administrador para liberar no seu cadastro.');
  }
  return usuario;
};

const publico = (id, d, agoraMs, { paraEstacao = false } = {}) => ({
  id,
  status: lr.situacaoAtual(d, agoraMs),
  tela: d.tela,
  baseCentavos: Number(d.baseCentavos) || 0,
  descontoCentavos: Number(d.descontoCentavos) || 0,
  percentual: lr.percentualDoDesconto(Number(d.baseCentavos) || 0, Number(d.descontoCentavos) || 0),
  motivo: String(d.motivo || ''),
  documento: String(d.documento || ''),
  solicitanteId: String(d.solicitanteId || ''),
  solicitanteNome: String(d.solicitanteNome || ''),
  criadoEmIso: String(d.criadoEmIso || ''),
  expiraEmMs: Number(d.expiraEmMs) || 0,
  texto: lr.textoDoPedido(d),
  ...(d.aprovadorId ? { aprovadorId: String(d.aprovadorId), aprovadorNome: String(d.aprovadorNome || '') } : {}),
  ...(d.motivoRecusa ? { motivoRecusa: String(d.motivoRecusa) } : {}),
  ...(paraEstacao && d.comprovanteId ? { comprovanteId: String(d.comprovanteId), validoAteMs: Number(d.comprovanteValidoAteMs) || 0 } : {}),
});

const pedir = async ({ user, tenantId, corpo }) => {
  const lido = lr.lerPedidoRemoto(corpo);
  if ('erro' in lido) throw new ErroLiberacaoRemota(400, lido.erro);
  const aprovadores = await aprovadoresDoTenant(tenantId);
  if (aprovadores.length === 0) {
    throw new ErroLiberacaoRemota(409, 'Ninguém nesta empresa tem a permissão "Liberar desconto". Peça ao administrador para dar a permissão a um responsável.');
  }
  const solicitante = await lerUsuario(user.uid, tenantId);
  const agoraMs = Date.now();
  const registro = {
    tenantId,
    status: 'pendente',
    ...lido.pedido,
    percentual: lr.percentualDoDesconto(lido.pedido.baseCentavos, lido.pedido.descontoCentavos),
    solicitanteId: user.uid,
    solicitanteNome: nomeDoUsuario(solicitante, user.email || 'Vendedor'),
    estacaoUid: user.uid,
    criadoEmIso: new Date(agoraMs).toISOString(),
    expiraEmMs: agoraMs + lr.VALIDADE_DO_PEDIDO_MS,
    criadoEm: TS(),
  };
  const ref = db.collection(COLECAO).doc();
  await ref.set(registro);
  const aviso = lr.notificacaoDoPedido(registro);
  const envio = await avisos.enviarParaUsuarios({
    tenantId,
    uids: aprovadores,
    titulo: aviso.titulo,
    corpo: aviso.corpo,
    link: '/vendedor/liberacoes',
    dados: { tipo: 'liberacao_desconto', liberacaoId: ref.id, tag: `liberacao-${ref.id}` },
  });
  return { id: ref.id, expiraEmMs: registro.expiraEmMs, aprovadores: aprovadores.length, aparelhosAvisados: envio.aparelhos || 0, avisosDesligados: Boolean(envio.desligado) };
};

const lerRegistro = async (id, tenantId) => {
  const ref = db.collection(COLECAO).doc(idValido(id));
  const snap = await ref.get();
  if (!snap.exists || snap.data().tenantId !== tenantId) throw new ErroLiberacaoRemota(404, 'Este pedido de liberação não existe mais. Peça a liberação de novo.');
  return { ref, dados: snap.data() };
};

const consultar = async ({ user, tenantId, id }) => {
  const { dados } = await lerRegistro(id, tenantId);
  const ehEstacao = dados.estacaoUid === user.uid;
  if (!ehEstacao) await exigirAprovador(user, tenantId);
  return publico(idValido(id), dados, Date.now(), { paraEstacao: ehEstacao });
};

const cancelar = async ({ user, tenantId, id }) => {
  const { ref, dados } = await lerRegistro(id, tenantId);
  if (dados.estacaoUid !== user.uid) throw new ErroLiberacaoRemota(403, 'Só quem pediu a liberação pode cancelá-la.');
  if (lr.situacaoAtual(dados, Date.now()) !== 'pendente') return publico(idValido(id), dados, Date.now(), { paraEstacao: true });
  await ref.update({ status: 'cancelada', respondidoEmIso: new Date().toISOString(), updatedAt: TS() });
  return { ...publico(idValido(id), dados, Date.now(), { paraEstacao: true }), status: 'cancelada' };
};

const pendentes = async ({ user, tenantId }) => {
  await exigirAprovador(user, tenantId);
  const agoraMs = Date.now();
  const snap = await db.collection(COLECAO).where('tenantId', '==', tenantId).where('status', '==', 'pendente').get();
  return snap.docs
    .filter((d) => lr.situacaoAtual(d.data(), agoraMs) === 'pendente')
    .map((d) => publico(d.id, d.data(), agoraMs))
    .sort((a, b) => a.criadoEmIso.localeCompare(b.criadoEmIso));
};

/** Prova de que e' o proprio gerente respondendo: a senha agora (sessao nova) ou o PIN dele. */
const confirmarGerente = async (user, tenantId, usuario, credencial) => {
  if (credencial.tipo === 'login') {
    let token;
    try {
      token = await admin.auth().verifyIdToken(credencial.idToken);
    } catch {
      throw new ErroLiberacaoRemota(401, 'Não foi possível confirmar a sua senha. Digite de novo.');
    }
    if (token.uid !== user.uid) throw new ErroLiberacaoRemota(403, 'A senha digitada não é a do seu usuário.');
    const idade = Math.floor(Date.now() / 1000) - Number(token.auth_time || 0);
    if (!(idade >= -60 && idade <= cd.IDADE_MAXIMA_DO_LOGIN_DO_APROVADOR_S)) {
      throw new ErroLiberacaoRemota(401, 'A senha precisa ser digitada agora. Digite de novo.');
    }
    return;
  }
  const codigo = String(usuario.codigoVendedor || '').trim();
  if (!codigo) throw new ErroLiberacaoRemota(400, 'Seu cadastro não tem código de vendedor com PIN. Use a senha do seu login.');
  const { vendedorId } = await validarPin({ tenantId, codigo, pin: credencial.pin });
  if (vendedorId !== user.uid) throw new ErroLiberacaoRemota(403, 'O PIN digitado não é o do seu usuário.');
};

const responder = async ({ user, tenantId, id, corpo }) => {
  const lido = lr.lerResposta(corpo);
  if ('erro' in lido) throw new ErroLiberacaoRemota(400, lido.erro);
  const { decisao, motivoRecusa, credencial } = lido.resposta;
  const usuario = await exigirAprovador(user, tenantId);
  const nome = nomeDoUsuario(usuario, user.email || 'Responsável');
  const { ref, dados } = await lerRegistro(id, tenantId);
  const erroAntes = lr.erroParaResponder(dados, Date.now());
  if (erroAntes) throw new ErroLiberacaoRemota(409, erroAntes);

  await confirmarGerente(user, tenantId, usuario, credencial);

  // Comprovante antes de "reclamar" o pedido: se outro gerente respondeu no
  // meio do caminho, o comprovante e' apagado e nada sobra. Orcamento nao
  // fecha pelo servidor: nao tem comprovante.
  let comprovante = null;
  if (decisao === 'aprovar' && dados.tela !== 'orcamento') {
    comprovante = await emitirComprovante({
      tenantId,
      emitidoPara: dados.estacaoUid,
      tipo: cd.TIPO_LIBERACAO,
      pessoaId: user.uid,
      pessoaNome: nome,
      dados: { tela: dados.tela, baseCentavos: Number(dados.baseCentavos), descontoCentavos: Number(dados.descontoCentavos) },
    });
  }

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const atual = snap.exists ? snap.data() : null;
      const erro = atual ? lr.erroParaResponder(atual, Date.now()) : 'Este pedido de liberação não existe mais.';
      if (erro) throw new ErroLiberacaoRemota(409, erro);
      tx.update(ref, {
        status: decisao === 'aprovar' ? 'aprovada' : 'recusada',
        aprovadorId: user.uid,
        aprovadorNome: nome,
        respondidoEmIso: new Date().toISOString(),
        ...(comprovante ? { comprovanteId: comprovante.comprovanteId, comprovanteValidoAteMs: comprovante.validoAteMs } : {}),
        ...(decisao === 'recusar' && motivoRecusa ? { motivoRecusa } : {}),
        updatedAt: TS(),
      });
    });
  } catch (erro) {
    if (comprovante) await refDoComprovante(comprovante.comprovanteId).delete().catch(() => undefined);
    throw erro;
  }

  return { ok: true, id: idValido(id), decisao, aprovadorNome: nome, texto: lr.textoDoPedido(dados), tela: dados.tela, baseCentavos: Number(dados.baseCentavos), descontoCentavos: Number(dados.descontoCentavos), solicitanteNome: String(dados.solicitanteNome || '') };
};

module.exports = { COLECAO, ErroLiberacaoRemota, pedir, consultar, cancelar, pendentes, responder, aprovadoresDoTenant };
