/*
 * Firestore FALSO em memoria para testar servicos que gravam numa transacao
 * (baixa, estorno, movimento de banco) sem tocar em banco de dados nenhum.
 * Cobre so' o que os servicos usam: collection().doc(), runTransaction,
 * tx.get/update/set, serverTimestamp, delete e increment.
 */
const path = require('node:path');

const TS = { __timestamp: true };
const DEL = { __apagar: true };

let contador = 0;

const criarBancoFalso = (inicial, opcoes = {}) => {
  const dados = new Map(Object.entries(inicial).map(([k, v]) => [k, structuredClone(v)]));
  // Grava como o Firestore: "a.b" no update mexe no campo b dentro de a.
  // set com merge mescla mapas aninhados (e aceita delete() la' dentro), como o Firestore.
  const mapaSimples = (v) => v && typeof v === 'object' && !Array.isArray(v) && v !== DEL && v !== TS
    && !('__incremento' in v) && !('__uniao' in v) && !('__remover' in v);
  // arrayUnion/arrayRemove (tabelas fiscais, 20/10/2026), como o Firestore: sem repetir.
  const transformarLista = (atual, valor) => {
    const lista = Array.isArray(atual) ? [...atual] : [];
    if ('__uniao' in valor) {
      for (const item of valor.__uniao) if (!lista.includes(item)) lista.push(item);
      return lista;
    }
    return lista.filter((item) => !valor.__remover.includes(item));
  };
  const ehListaTransformada = (v) => v && typeof v === 'object' && ('__uniao' in v || '__remover' in v);
  const mesclar = (alvo, valor) => {
    for (const [k, v] of Object.entries(valor)) {
      if (v === DEL) delete alvo[k];
      else if (ehListaTransformada(v)) alvo[k] = transformarLista(alvo[k], v);
      else if (mapaSimples(v)) {
        if (!mapaSimples(alvo[k])) alvo[k] = {};
        mesclar(alvo[k], v);
      } else alvo[k] = v;
    }
  };
  const aplicar = (chave, campos, substitui, mesclaMapas = false) => {
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
      else if (valor && typeof valor === 'object' && '__incremento' in valor) alvo[ultimo] = Number(alvo[ultimo] || 0) + valor.__incremento;
      else if (ehListaTransformada(valor)) alvo[ultimo] = transformarLista(alvo[ultimo], valor);
      else if (mesclaMapas && mapaSimples(valor)) {
        if (!mapaSimples(alvo[ultimo])) alvo[ultimo] = {};
        mesclar(alvo[ultimo], valor);
      } else alvo[ultimo] = valor;
    }
    dados.set(chave, atual);
  };
  // Consulta simples (==, in, array-contains, >=, <=) so' quando o teste pede
  // (opcoes.consultas). Sem isso, where() falha como antes -- alguns
  // servicos tratam esse erro (ex.: piso da numeracao).
  const consulta = (caminho, filtros, limite = 0) => ({
    where: (campo, op, valor) => consulta(caminho, [...filtros, [campo, op, valor]], limite),
    // limit() corta; select() so' escolhe campos no Firestore real -- aqui devolve o documento inteiro.
    limit: (n) => consulta(caminho, filtros, n),
    select: () => consulta(caminho, filtros, limite),
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
        .map(([k, v]) => ({ id: k.slice(caminho.length + 1), exists: true, data: () => structuredClone(v), ref: ref(caminho, k.slice(caminho.length + 1)) }))
        .slice(0, limite > 0 ? limite : undefined);
      return { empty: docs.length === 0, size: docs.length, docs };
    },
  });
  const colecaoEm = (caminho) => ({
    doc: (id) => ref(caminho, id || `auto${(contador += 1)}`),
    // add() = doc() sem id + set (log de auditoria, por exemplo).
    add: async (campos) => {
      const novo = ref(caminho, `auto${(contador += 1)}`);
      await novo.set(campos);
      return novo;
    },
    // A colecao inteira (ex.: todos os grupos, na manutencao).
    get: () => consulta(caminho, []).get(),
    where: opcoes.consultas
      ? (campo, op, valor) => consulta(caminho, [[campo, op, valor]])
      : () => { throw new Error('consulta nao simulada no Firestore falso'); },
  });
  const ref = (caminho, id) => ({
    chave: `${caminho}/${id}`,
    id,
    // Como no Admin SDK: a colecao do documento (ref.parent.id = nome da colecao).
    parent: { id: caminho.split('/').pop(), path: caminho },
    collection: (sub) => colecaoEm(`${caminho}/${id}/${sub}`),
    get: async () => ({ exists: dados.has(`${caminho}/${id}`), id, data: () => structuredClone(dados.get(`${caminho}/${id}`)) }),
    // Gravacao direta (fora de transacao).
    set: async (campos, opcoesSet) => aplicar(`${caminho}/${id}`, campos, !opcoesSet?.merge, Boolean(opcoesSet?.merge)),
    update: async (campos) => {
      if (!dados.has(`${caminho}/${id}`)) throw new Error(`documento ${caminho}/${id} nao existe`);
      aplicar(`${caminho}/${id}`, campos, false);
    },
    delete: async () => { dados.delete(`${caminho}/${id}`); },
  });
  const db = {
    collection: (colecao) => colecaoEm(colecao),
    getAll: async (...refs) => Promise.all(refs.map((r) => r.get())),
    // batch(): as gravacoes so' acontecem no commit, como no Firestore.
    batch: () => {
      const escritas = [];
      const lote = {
        set: (r, campos, opcoes) => { escritas.push(() => aplicar(r.chave, campos, !opcoes?.merge, Boolean(opcoes?.merge))); return lote; },
        update: (r, campos) => { escritas.push(() => aplicar(r.chave, campos, false)); return lote; },
        delete: (r) => { escritas.push(() => dados.delete(r.chave)); return lote; },
        commit: async () => { escritas.forEach((gravar) => gravar()); },
      };
      return lote;
    },
    runTransaction: async (fn) => {
      const escritas = [];
      // Como o Firestore real: ler depois de gravar na mesma transacao e' erro.
      const lerAntes = () => { if (escritas.length) throw new Error('Firestore transactions require all reads to be executed before all writes.'); };
      const tx = {
        // tx.get aceita documento OU consulta (where), como no Admin SDK.
        get: async (r) => {
          lerAntes();
          if (!r.chave && typeof r.get === 'function') return r.get();
          return { exists: dados.has(r.chave), id: r.id, data: () => structuredClone(dados.get(r.chave)) };
        },
        getAll: async (...refs) => Promise.all(refs.map((r) => tx.get(r))),
        update: (r, campos) => escritas.push([r, campos, false]),
        set: (r, campos, opcoes) => escritas.push([r, campos, !opcoes?.merge]),
        delete: (r) => escritas.push([r, null, 'apagar']),
      };
      const resultado = await fn(tx);
      for (const [r, campos, substitui] of escritas) {
        if (substitui === 'apagar') dados.delete(r.chave);
        else aplicar(r.chave, campos, substitui);
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
  // Auth falso (criar conta pelo servidor, 19/10/2026): e-mail repetido falha como no Firebase.
  const contas = new Map();
  const authFalso = {
    createUser: async ({ email }) => {
      if (contas.has(email)) {
        const erro = new Error('email ja existe');
        erro.code = 'auth/email-already-exists';
        throw erro;
      }
      const uid = `conta${contas.size + 1}`;
      contas.set(email, uid);
      return { uid, email };
    },
    // Token falso "falso:<uid>:<auth_time em segundos>" (liberacao de desconto, 19/10/2026).
    verifyIdToken: async (token) => {
      const [marca, uid, authTime] = String(token).split(':');
      if (marca !== 'falso' || !uid) throw new Error('token invalido');
      return { uid, auth_time: Number(authTime) };
    },
  };
  require.cache[firebase] = {
    id: firebase, filename: firebase, loaded: true,
    exports: { db, admin: { auth: () => authFalso, firestore: { FieldValue: {
      serverTimestamp: () => TS,
      delete: () => DEL,
      increment: (n) => ({ __incremento: n }),
      arrayUnion: (...itens) => ({ __uniao: itens }),
      arrayRemove: (...itens) => ({ __remover: itens }),
    } } } },
  };
  const caminhos = ['services/baixaFinanceira', 'services/movimentoBanco', 'services/condicionais', ...servicos]
    .map((s) => require.resolve(path.join(base, s)));
  // Servicos usados por dentro de outros (guardam o `db` ao carregar): sempre com o banco novo.
  const sempreNovos = ['services/comprovantes', 'services/vendedorPin', 'services/cashback', 'services/configuracoesGerais']
    .map((s) => require.resolve(path.join(base, s)));
  [...sempreNovos, ...caminhos].forEach((c) => { delete require.cache[c]; });
  return caminhos.map((c) => require(c));
};

module.exports = { criarBancoFalso, carregarComBancoFalso, TS, DEL };
