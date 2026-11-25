/*
 * TRAVA DE ROTINA ENTRE PROCESSOS (25/11/2026).
 *
 * O que aconteceu: o historico de backups de producao mostrava o MESMO backup
 * automatico duas vezes (mesmo arquivo, mesmo segundo) em varios dias. A tela
 * mostra uma linha por documento de `backups_historico`; eram dois documentos.
 * Dentro de um processo a ronda nao dispara duas vezes (ela marca quem esta'
 * em andamento e guarda o ultimo backup de cada empresa) -- mas essa marca e'
 * MEMORIA DO PROCESSO. Com dois processos do servidor no ar ao mesmo tempo (a
 * hospedagem sobe mais de um, e processo antigo pode sobreviver a um deploy),
 * cada um tem a sua memoria, o cron dos dois bate no mesmo segundo e os dois
 * fazem o backup.
 *
 * A trava mora no banco, que e' o unico lugar que os processos enxergam em
 * comum: um documento por rotina em `rotinas_travas`, reservado numa transacao
 * ANTES de rodar. Quem nao ganha a reserva nao roda.
 *
 * "Vez" e' o horario a que a execucao se refere (o horario previsto do backup,
 * a hora cheia da fila). Vez ja' concluida nao roda de novo, por nenhum
 * processo. A reserva tem validade: se o processo morre no meio (deploy), outro
 * assume depois que ela vence -- nenhuma rotina fica presa para sempre.
 *
 * So' o servidor (Admin SDK) le e grava esta colecao; as regras do Firestore
 * ja' negam tudo o que nao esta' liberado, entao ela nao precisa de regra.
 */
const os = require('os');
const crypto = require('crypto');
const { db } = require('../config/firebase');

const COLECAO = 'rotinas_travas';

/** Quem e' este processo (aparece na trava e no log, para conferir quantos estao no ar). */
const PROCESSO = `${os.hostname()}:${process.pid}:${crypto.randomBytes(2).toString('hex')}`;

const refDaTrava = (chave) => db.collection(COLECAO).doc(String(chave).replace(/[/\s]+/g, '_').slice(0, 300));

/** O Firestore recusa `undefined`: o resultado guardado na trava vai sem essas chaves. */
const semIndefinidos = (valor) => (valor === undefined || valor === null ? null : JSON.parse(JSON.stringify(valor)));

/**
 * Tenta reservar a vez. Devolve `{ ganhou, situacao, liberaEmMs, processo, resultado }`:
 * - ganhou: true  -> este processo roda (e depois chama concluirVez ou falharVez);
 * - 'concluida'   -> esta vez (ou uma mais nova) ja' foi feita; `resultado` e' o que quem fez guardou;
 * - 'rodando'     -> outro esta' fazendo agora; ate' `liberaEmMs` ninguem assume;
 * - 'falhou'      -> falhou ha' pouco; nova tentativa so' depois de `liberaEmMs`.
 */
const reservarVez = async (chave, vez, { validadeMs, agoraMs = Date.now() }) => {
  const ref = refDaTrava(chave);
  const vezPedida = Number(vez) || 0;
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const atual = snap.exists ? (snap.data() || {}) : null;
    if (atual) {
      const liberaEmMs = Number(atual.liberaEmMs) || 0;
      const processo = String(atual.processo || '');
      if (atual.situacao === 'concluida' && (Number(atual.vez) || 0) >= vezPedida) {
        return { ganhou: false, situacao: 'concluida', liberaEmMs: 0, processo, resultado: atual.resultado || null };
      }
      if ((atual.situacao === 'rodando' || atual.situacao === 'falhou') && liberaEmMs > agoraMs) {
        return { ganhou: false, situacao: atual.situacao, liberaEmMs, processo, resultado: null };
      }
    }
    const liberaEmMs = agoraMs + validadeMs;
    tx.set(ref, {
      chave: String(chave),
      vez: vezPedida,
      situacao: 'rodando',
      processo: PROCESSO,
      iniciadoEm: new Date(agoraMs).toISOString(),
      liberaEmMs,
    });
    return { ganhou: true, situacao: 'rodando', liberaEmMs, processo: PROCESSO, resultado: null };
  });
};

/** A vez foi feita: ninguem repete. `resultado` fica guardado para os outros processos. */
const concluirVez = async (chave, vez, resultado = null) => {
  const ref = refDaTrava(chave);
  const vezFeita = Number(vez) || 0;
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const atual = snap.exists ? (snap.data() || {}) : null;
    // Uma vez mais nova ja' esta' na trava: esta conclusao chegou atrasada e nao a apaga.
    if (atual && (Number(atual.vez) || 0) > vezFeita) return false;
    const agora = new Date().toISOString();
    tx.set(ref, {
      chave: String(chave),
      vez: vezFeita,
      situacao: 'concluida',
      processo: PROCESSO,
      iniciadoEm: (atual && atual.iniciadoEm) || agora,
      concluidoEm: agora,
      liberaEmMs: 0,
      resultado: semIndefinidos(resultado),
    });
    return true;
  });
};

/**
 * A vez falhou: solta a reserva, mas so' deixa tentar de novo depois de
 * `esperaMs` (vale para todos os processos). So' quem reservou pode marcar.
 */
const falharVez = async (chave, vez, { esperaMs = 0, motivo = '', agoraMs = Date.now() } = {}) => {
  const ref = refDaTrava(chave);
  const vezFalha = Number(vez) || 0;
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const atual = snap.exists ? (snap.data() || {}) : null;
    if (!atual || atual.processo !== PROCESSO || atual.situacao !== 'rodando' || (Number(atual.vez) || 0) !== vezFalha) return false;
    tx.update(ref, {
      situacao: 'falhou',
      liberaEmMs: agoraMs + esperaMs,
      falhouEm: new Date(agoraMs).toISOString(),
      erro: String(motivo || '').slice(0, 300),
    });
    return true;
  });
};

/**
 * Roda `fn` so' se este processo ganhar a vez. Devolve `{ rodou, valor, reserva }`.
 * Erro de `fn` solta a reserva (com a espera pedida) e sobe para quem chamou.
 */
const rodarNaVez = async (chave, vez, { validadeMs, esperaDepoisDeFalhaMs = 0, agoraMs = Date.now() }, fn) => {
  const reserva = await reservarVez(chave, vez, { validadeMs, agoraMs });
  if (!reserva.ganhou) return { rodou: false, valor: null, reserva };
  try {
    const valor = await fn();
    await concluirVez(chave, vez);
    return { rodou: true, valor, reserva };
  } catch (erro) {
    await falharVez(chave, vez, { esperaMs: esperaDepoisDeFalhaMs, motivo: erro && erro.message, agoraMs }).catch(() => {});
    throw erro;
  }
};

module.exports = {
  COLECAO,
  PROCESSO,
  reservarVez,
  concluirVez,
  falharVez,
  rodarNaVez,
};
