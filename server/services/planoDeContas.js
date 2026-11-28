/**
 * Plano de contas dos lancamentos automaticos (28/11/2026): a categoria de cada
 * situacao vem do vinculo da filial (vinculosPlanoContasDomain). Para quem grava
 * fora de uma transacao que ja' leu a configuracao. Categoria e' nome de
 * classificacao: ler fora da transacao nao muda dinheiro nem saldo.
 */
const { db } = require('../config/firebase');
const vpc = require('../domain/vinculosPlanoContasDomain');

const configDaFilial = async (tenantId) => {
  if (!tenantId) return {};
  const snap = await db.collection('configuracoes').doc(String(tenantId)).get();
  return snap.exists ? (snap.data() || {}) : {};
};

/** Categoria da situacao na filial; sem conseguir ler a configuracao, o padrao. */
const categoriaDoEventoDaFilial = async (tenantId, evento) => {
  try {
    return vpc.categoriaDoEvento(await configDaFilial(tenantId), evento);
  } catch (erro) {
    console.error('[PlanoDeContas] nao leu a configuracao:', erro && erro.message);
    return vpc.categoriaDoEvento({}, evento);
  }
};

module.exports = { configDaFilial, categoriaDoEventoDaFilial };
