/*
 * TRAVA DE EDICAO (15/10/2026) -- ver src/utils/travaEdicaoDomain.ts.
 *
 * Um documento `travas_edicao/{empresa__tipo__registro}` por documento aberto.
 * So' o servidor grava (as firestore.rules deixam as telas apenas lerem, para
 * pintar as listas); o tempo e' o do servidor, em milissegundos.
 */
const { db } = require('../config/firebase');
const dominio = require('../domain/travaEdicaoDomain');

class ErroTrava extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const refDaTrava = (tenantId, tipo, registroId) => db.collection('travas_edicao').doc(dominio.idDaTrava(tenantId, tipo, registroId));

const texto = (valor) => (typeof valor === 'string' ? valor.trim() : '');

/** Confere o que a tela mandou: tipo conhecido, registro e sessao com formato valido. */
const lerPedido = (corpo, { exigeSessao = true } = {}) => {
  const tipo = texto(corpo?.tipo);
  const registroId = texto(corpo?.registroId);
  const sessaoId = texto(corpo?.sessaoId);
  if (!dominio.ehTipoDeTrava(tipo)) throw new ErroTrava(400, 'Tipo de documento desconhecido para a trava de edição.');
  if (!registroId || registroId.length > 200 || registroId.includes('/')) throw new ErroTrava(400, 'Documento inválido para a trava de edição.');
  if (exigeSessao && (sessaoId.length < 8 || sessaoId.length > 80)) throw new ErroTrava(400, 'Sessão inválida. Recarregue a tela e tente de novo.');
  const aparelho = corpo?.aparelho === 'celular' ? 'celular' : 'computador';
  return { tipo, registroId, sessaoId, aparelho };
};

// FORA de transacao: usuarios/{uid} e' gravado a cada 30 s pelo sinal de
// sessao; ler dentro da transacao (que trava o documento lido) fazia os dois
// disputarem e o "pegar" chegou a levar 21 s (15/10/2026).
const nomeDoUsuario = async (uid, email) => {
  const snap = await db.collection('usuarios').doc(uid).get();
  const dados = snap.exists ? snap.data() : {};
  return texto(dados.nome) || texto(dados.nomeResponsavel) || texto(email) || 'Usuário';
};

/**
 * Grava so' se a trava nao mudou desde a leitura (sem transacao: o aviso de
 * 30 s e o soltar nao podem ficar presos esperando outra gravacao). Se mudou,
 * devolve false e quem chamou decide (le de novo ou desiste).
 */
const gravarSeNaoMudou = async (ref, snap, acao) => {
  const condicao = snap.updateTime ? { lastUpdateTime: snap.updateTime } : null;
  try {
    if (acao === 'apagar') await (condicao ? ref.delete(condicao) : ref.delete());
    else await (condicao ? ref.update(acao, condicao) : ref.update(acao));
    return true;
  } catch (erro) {
    // 9 = FAILED_PRECONDITION (mudou), 5 = NOT_FOUND (ja' apagada).
    if (erro && (erro.code === 9 || erro.code === 5)) return false;
    throw erro;
  }
};

/** Abrir o documento: pega a vez, ou recusa (409) dizendo quem esta com ele. */
const pegarTrava = async ({ user, corpo, agoraMs = Date.now() }) => {
  const { tipo, registroId, sessaoId, aparelho } = lerPedido(corpo);
  const ref = refDaTrava(user.tenantId, tipo, registroId);
  const usuarioNome = await nomeDoUsuario(user.uid, user.email);
  // Transacao so' com o documento da trava: dois "pegar" ao mesmo tempo, um ganha.
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const atual = snap.exists ? snap.data() : null;
    const avaliacao = dominio.avaliarPegar(atual, { usuarioId: user.uid, sessaoId }, agoraMs);
    if (avaliacao.tipo === 'de_outro') {
      throw new ErroTrava(409, dominio.mensagemDeBloqueio(tipo, avaliacao.trava), { trava: avaliacao.trava });
    }
    const trava = {
      tenantId: user.tenantId,
      tipo,
      registroId,
      usuarioId: user.uid,
      usuarioNome,
      aparelho,
      sessaoId,
      desdeMs: avaliacao.tipo === 'mesma_sessao' ? atual.desdeMs : agoraMs,
      ultimoSinalMs: agoraMs,
      ultimaAtividadeMs: agoraMs,
      validaAteMs: dominio.calcularValidade(agoraMs, agoraMs),
    };
    tx.set(ref, trava);
    return { trava, assumiuDeOutraTela: avaliacao.tipo === 'mesmo_usuario' };
  });
};

/** "Continuo aqui" a cada 30 s. `mexeu` = a pessoa usou a tela desde o ultimo aviso. */
const renovarTrava = async ({ user, corpo, agoraMs = Date.now() }) => {
  const { tipo, registroId, sessaoId } = lerPedido(corpo);
  const ref = refDaTrava(user.tenantId, tipo, registroId);
  // Duas tentativas: se a trava mudou entre a leitura e a gravacao, le de novo.
  for (let tentativa = 0; tentativa < 2; tentativa += 1) {
    const snap = await ref.get();
    const atual = snap.exists ? snap.data() : null;
    const sinal = dominio.avaliarSinal(atual, sessaoId, agoraMs);
    if (sinal.tipo === 'perdeu') {
      return { estado: 'perdeu', mensagem: dominio.mensagemDeBloqueio(tipo, sinal.trava), trava: sinal.trava };
    }
    if (sinal.tipo === 'venceu') {
      // A propria trava vencida sai do banco (as listas ja' a tratavam como livre).
      if (atual && atual.sessaoId === sessaoId) await gravarSeNaoMudou(ref, snap, 'apagar');
      return { estado: 'venceu' };
    }
    const ultimaAtividadeMs = corpo?.mexeu === true ? agoraMs : atual.ultimaAtividadeMs;
    const validaAteMs = dominio.calcularValidade(agoraMs, ultimaAtividadeMs);
    if (validaAteMs <= agoraMs) {
      // Parada demais: a vez fica livre para os outros.
      await gravarSeNaoMudou(ref, snap, 'apagar');
      return { estado: 'venceu' };
    }
    if (await gravarSeNaoMudou(ref, snap, { ultimoSinalMs: agoraMs, ultimaAtividadeMs, validaAteMs })) {
      return { estado: 'ok', validaAteMs };
    }
  }
  return { estado: 'venceu' };
};

/** Fechou a tela: solta a vez (so' a propria sessao solta a propria trava). */
const soltarTrava = async ({ uid, tenantId, corpo }) => {
  const { tipo, registroId, sessaoId } = lerPedido(corpo);
  const empresa = texto(tenantId);
  if (!empresa) return { soltou: false };
  const ref = refDaTrava(empresa, tipo, registroId);
  const snap = await ref.get();
  if (!snap.exists) return { soltou: false };
  const atual = snap.data();
  if (atual.usuarioId !== uid || atual.sessaoId !== sessaoId) return { soltou: false };
  return { soltou: await gravarSeNaoMudou(ref, snap, 'apagar') };
};

/** Dono ou gerente libera na hora o documento que ficou preso com outra pessoa. */
const liberarTrava = async ({ user, corpo, podeLiberar, agoraMs = Date.now() }) => {
  const { tipo, registroId } = lerPedido(corpo, { exigeSessao: false });
  if (!podeLiberar) throw new ErroTrava(403, 'Só o dono, um administrador ou um gerente libera um documento que está com outra pessoa.');
  const ref = refDaTrava(user.tenantId, tipo, registroId);
  const snap = await ref.get();
  if (!snap.exists) return { liberou: false };
  const atual = snap.data();
  await ref.delete();
  return { liberou: dominio.travaAtiva(atual, agoraMs), de: atual.usuarioNome || '' };
};

module.exports = { ErroTrava, pegarTrava, renovarTrava, soltarTrava, liberarTrava };
