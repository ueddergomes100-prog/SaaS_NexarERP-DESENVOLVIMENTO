/*
 * COMPROVANTES DO SERVIDOR (19/10/2026): liberacao de desconto e
 * identificacao do vendedor.
 *
 * Quando o servidor confere uma senha (do aprovador) ou um PIN (do vendedor),
 * ele grava aqui um comprovante que vale pouco tempo, para a sessao que pediu.
 * O Finalizar (venda, PDV, OS) le o comprovante na mesma transacao que grava a
 * venda e o apaga -- cada comprovante vale para uma venda so'. A colecao nao
 * tem regra nas firestore.rules: so' o servidor le e grava (o navegador cai no
 * "nega tudo" do fim do arquivo). Regra em src/utils/conferenciaDescontoDomain.ts.
 */
const { admin, db } = require('../config/firebase');
const cd = require('../domain/conferenciaDescontoDomain');

const COLECAO = 'comprovantes_servidor';

const refDoComprovante = (id) => db.collection(COLECAO).doc(id);

/** Apaga os comprovantes vencidos desta sessao (liberacao ou identificacao que ninguem usou). */
const faxina = async (tenantId, emitidoPara, agoraMs) => {
  try {
    const snap = await db.collection(COLECAO)
      .where('tenantId', '==', tenantId)
      .where('emitidoPara', '==', emitidoPara)
      .get();
    const vencidos = snap.docs.filter((d) => !(Number(d.data().expiraEmMs) > agoraMs));
    await Promise.all(vencidos.map((d) => d.ref.delete()));
  } catch (erro) {
    // Faxina e' cortesia: nao pode derrubar a liberacao.
    console.warn('[Comprovantes] faxina falhou:', erro && erro.message);
  }
};

/**
 * Grava um comprovante e devolve o id. `dados` = campos do tipo (tela e
 * valores da liberacao). Nada `undefined` chega ao Firestore.
 */
const emitirComprovante = async ({ tenantId, emitidoPara, tipo, pessoaId, pessoaNome, dados = {} }) => {
  const agoraMs = Date.now();
  await faxina(tenantId, emitidoPara, agoraMs);
  const ref = db.collection(COLECAO).doc();
  const limpos = Object.fromEntries(Object.entries(dados).filter(([, v]) => v !== undefined));
  await ref.set({
    tenantId,
    emitidoPara,
    tipo,
    pessoaId,
    pessoaNome: String(pessoaNome || ''),
    criadoEmIso: new Date(agoraMs).toISOString(),
    expiraEmMs: agoraMs + cd.VALIDADE_DO_COMPROVANTE_MS,
    criadoEm: admin.firestore.FieldValue.serverTimestamp(),
    ...limpos,
  });
  return { comprovanteId: ref.id, validoAteMs: agoraMs + cd.VALIDADE_DO_COMPROVANTE_MS };
};

/** Le um comprovante dentro da transacao (id invalido = null). */
const lerNaTransacao = async (tx, id) => {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return { ref: null, dados: null };
  const ref = refDoComprovante(id);
  const snap = await tx.get(ref);
  return { ref, dados: snap.exists ? snap.data() : null };
};

module.exports = { COLECAO, emitirComprovante, lerNaTransacao, refDoComprovante };
