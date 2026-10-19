/*
 * PROTEGER OS SEGREDOS FISCAIS (19/10/2026, auditoria de seguranca "so' a tela
 * protege"; decisao do dono: area protegida).
 *
 * O CSC da NFC-e (e o Id do CSC) e, em empresas antigas, a chave da Spedy
 * ficavam em configuracoes/{empresa} -- documento que QUALQUER usuario logado
 * da empresa le. Daqui em diante:
 *  - o servidor grava o CSC em configuracoes_privadas/{empresa}.nfceCsc
 *    (le so' o administrador da empresa e o servidor);
 *  - esta tarefa (Painel da Plataforma › Manutencao) move o que ficou no
 *    documento publico das empresas antigas e apaga de la'.
 *
 * Sem "desfazer" de proposito: desfazer seria por o segredo de volta onde todos leem.
 * Rodar de novo e' seguro: so' mexe em quem ainda tem segredo no publico.
 */

/** O que o documento publico ainda guarda de segredo. */
const segredosNoPublico = (config) => {
  const c = config || {};
  const temChave = Object.prototype.hasOwnProperty.call(c, 'spedyApiKey');
  const chave = typeof c.spedyApiKey === 'string' ? c.spedyApiKey.trim() : '';
  const consumo = c.spedyNumeracao && typeof c.spedyNumeracao === 'object' ? c.spedyNumeracao.consumerInvoice : null;
  const temCsc = Boolean(consumo && typeof consumo === 'object' && (
    Object.prototype.hasOwnProperty.call(consumo, 'csc') || Object.prototype.hasOwnProperty.call(consumo, 'tokenId')
  ));
  return {
    temChave,
    chave,
    temCsc,
    csc: temCsc ? String(consumo.csc || '').trim() : '',
    tokenId: temCsc ? String(consumo.tokenId || '').trim() : '',
  };
};

/**
 * Separa o CSC do que a Spedy devolveu na numeracao: o publico fica sem ele
 * (e apaga o que estava gravado), o privado guarda.
 */
const separarCscDaNumeracao = (numeracao, apagar) => {
  const consumo = numeracao && numeracao.consumerInvoice && typeof numeracao.consumerInvoice === 'object'
    ? numeracao.consumerInvoice
    : null;
  if (!consumo) return { publico: numeracao, nfceCsc: null };
  const { csc, tokenId, ...resto } = consumo;
  return {
    publico: { ...numeracao, consumerInvoice: { ...resto, csc: apagar(), tokenId: apagar() } },
    nfceCsc: csc || tokenId ? { csc: String(csc || ''), tokenId: String(tokenId || '') } : null,
  };
};

const protegerSegredos = async ({ db, apagar, aplicar }) => {
  const snap = await db.collection('configuracoes').get();
  const empresas = [];
  for (const docSnap of snap.docs) {
    const config = docSnap.data() || {};
    const s = segredosNoPublico(config);
    if (!s.temChave && !s.temCsc) continue;
    empresas.push({
      tenantId: docSnap.id,
      nome: String(config.nomeOficina || config.razaoSocial || config.nomeFantasia || docSnap.id),
      chaveSpedy: s.temChave,
      csc: s.temCsc,
    });
    if (!aplicar) continue;

    // Primeiro guarda no privado (sem sobrescrever o que ja' esta' la'), depois apaga do publico.
    const privadoRef = db.collection('configuracoes_privadas').doc(docSnap.id);
    const privadoSnap = await privadoRef.get();
    const privado = privadoSnap.exists ? privadoSnap.data() || {} : {};
    const gravarNoPrivado = { tenantId: docSnap.id, updatedAt: new Date().toISOString() };
    if (s.chave && !privado.spedyApiKey) gravarNoPrivado.spedyApiKey = s.chave;
    if ((s.csc || s.tokenId) && !(privado.nfceCsc && privado.nfceCsc.csc)) gravarNoPrivado.nfceCsc = { csc: s.csc, tokenId: s.tokenId };
    await privadoRef.set(gravarNoPrivado, { merge: true });

    const limpar = {};
    if (s.temChave) limpar.spedyApiKey = apagar();
    if (s.temCsc) limpar.spedyNumeracao = { consumerInvoice: { csc: apagar(), tokenId: apagar() } };
    await docSnap.ref.set(limpar, { merge: true });
  }
  return { lidas: snap.size, empresas };
};

module.exports = { protegerSegredos, segredosNoPublico, separarCscDaNumeracao };
