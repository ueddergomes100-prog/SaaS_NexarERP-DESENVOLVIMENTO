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

const criarBancoFalso = (inicial, opcoes = {}) => {
  const dados = new Map(Object.entries(inicial).map(([k, v]) => [k, structuredClone(v)]));
  // Grava como o Firestore: "a.b" no update mexe no campo b dentro de a.
  const aplicar = (chave, campos, substitui) => {
    const atual = substitui ? {} : structuredClone(dados.get(chave) || {});
    for (const [campo, valor] of Object.entries(campos)) {
      const partes = substitui ? [campo] : campo.split('.');
      let alvo = atual;
      for (const parte of partes.slice(0, -1)) {
        if (!alvo[parte] || typeof alvo[parte] !== 'object') alvo[parte] = {};
        alvo = alvo[parte];
      }
      const ultimo = partes[partes.length - 1];
      if (valor === DEL) delete alvo[ultimo];
      else alvo[ultimo] = valor;
    }
    dados.set(chave, atual);
  };
  // Consulta simples (==, in, array-contains, >=, <=) so' quando o teste pede
  // (opcoes.consultas). Sem isso, where() falha como antes -- alguns
  // servicos tratam esse erro (ex.: piso da numeracao).
  const consulta = (caminho, filtros) => ({
    where: (campo, op, valor) => consulta(caminho, [...filtros, [campo, op, valor]]),
    get: async () => {
      const docs = [...dados.entries()]
        .filter(([k]) => k.startsWith(`${caminho}/`) && !k.slice(caminho.length + 1).includes('/'))
        .filter(([, v]) => filtros.every(([campo, op, valor]) => (
          op === '==' ? v[campo] === valor
            : op === 'in' ? valor.includes(v[campo])
              : op === 'array-contains' ? Array.isArray(v[campo]) && v[campo].includes(valor)
                : op === '>=' ? v[campo] !== undefined && v[campo] >= valor
                  : op === '<=' ? v[campo] !== undefined && v[campo] <= valor
                : false
        )))
        .map(([k, v]) => ({ id: k.slice(caminho.length + 1), exists: true, data: () => structuredClone(v), ref: ref(caminho, k.slice(caminho.length + 1)) }));
      return { empty: docs.length === 0, size: docs.length, docs };
    },
  });
  const colecaoEm = (caminho) => ({
    doc: (id) => ref(caminho, id || `auto${(contador += 1)}`),
    where: opcoes.consultas
      ? (campo, op, valor) => consulta(caminho, [[campo, op, valor]])
      : () => { throw new Error('consulta nao simulada no Firestore falso'); },
  });
  const ref = (caminho, id) => ({
    chave: `${caminho}/${id}`,
    id,
    collection: (sub) => colecaoEm(`${caminho}/${id}/${sub}`),
    get: async () => ({ exists: dados.has(`${caminho}/${id}`), id, data: () => structuredClone(dados.get(`${caminho}/${id}`)) }),
    // Gravacao direta (fora de transacao).
    set: async (campos, opcoesSet) => aplicar(`${caminho}/${id}`, campos, !opcoesSet?.merge),
    update: async (campos) => {
      if (!dados.has(`${caminho}/${id}`)) throw new Error(`documento ${caminho}/${id} nao existe`);
      aplicar(`${caminho}/${id}`, campos, false);
    },
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
      for (const [r, campos, substitui] of escritas) aplicar(r.chave, campos, substitui);
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
