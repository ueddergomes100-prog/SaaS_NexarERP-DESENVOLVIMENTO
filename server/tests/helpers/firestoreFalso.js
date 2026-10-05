/*
 * Firestore FALSO em memoria para testar servicos que gravam numa transacao
 * (baixa, estorno, movimento de banco) sem tocar em banco de dados nenhum.
 * Cobre so' o que os servicos usam: collection().doc(), runTransaction,
 * tx.get/update/set, serverTimestamp e delete.
 */
const path = require('node:path');

const TS = { __timestamp: true };
const DEL = { __apagar: true };

let contador = 0;

const criarBancoFalso = (inicial) => {
  const dados = new Map(Object.entries(inicial).map(([k, v]) => [k, structuredClone(v)]));
  const colecaoEm = (caminho) => ({
    doc: (id) => ref(caminho, id || `auto${(contador += 1)}`),
    // Consulta nao e' simulada: quem chama precisa tratar o erro (ex.: piso da numeracao).
    where: () => { throw new Error('consulta nao simulada no Firestore falso'); },
  });
  const ref = (caminho, id) => ({
    chave: `${caminho}/${id}`,
    id,
    collection: (sub) => colecaoEm(`${caminho}/${id}/${sub}`),
  });
  const db = {
    collection: (colecao) => colecaoEm(colecao),
    runTransaction: async (fn) => {
      const escritas = [];
      const tx = {
        get: async (r) => ({ exists: dados.has(r.chave), id: r.id, data: () => structuredClone(dados.get(r.chave)) }),
        getAll: async (...refs) => Promise.all(refs.map((r) => tx.get(r))),
        update: (r, campos) => escritas.push([r, campos, false]),
        set: (r, campos, opcoes) => escritas.push([r, campos, !opcoes?.merge]),
      };
      const resultado = await fn(tx);
      for (const [r, campos, substitui] of escritas) {
        const atual = substitui ? {} : { ...(dados.get(r.chave) || {}) };
        for (const [campo, valor] of Object.entries(campos)) {
          if (valor === DEL) delete atual[campo];
          else atual[campo] = valor;
        }
        dados.set(r.chave, atual);
      }
      return resultado;
    },
  };
  return {
    db,
    ler: (chave) => dados.get(chave),
    listar: (prefixo) => [...dados.entries()].filter(([k]) => k.startsWith(prefixo)).map(([, v]) => v),
  };
};

/** Carrega um servico do servidor com o Firestore falso no lugar do real. */
const carregarComBancoFalso = (db, ...servicos) => {
  const base = path.join(__dirname, '..', '..');
  const firebase = require.resolve(path.join(base, 'config/firebase'));
  require.cache[firebase] = {
    id: firebase, filename: firebase, loaded: true,
    exports: { db, admin: { firestore: { FieldValue: { serverTimestamp: () => TS, delete: () => DEL } } } },
  };
  const caminhos = ['services/baixaFinanceira', 'services/movimentoBanco', 'services/condicionais', ...servicos]
    .map((s) => require.resolve(path.join(base, s)));
  caminhos.forEach((c) => { delete require.cache[c]; });
  return caminhos.map((c) => require(c));
};

module.exports = { criarBancoFalso, carregarComBancoFalso, TS, DEL };
