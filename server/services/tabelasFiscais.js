/*
 * TABELAS FISCAIS (pedido do dono, 20/10/2026) -- ver src/utils/cfopDomain.ts
 * e src/utils/tabelaFiscalDomain.ts.
 *
 *  - CFOP: a tabela e' do sistema (codigo). A empresa so' ativa/desativa os que
 *    usa: `cfopsDesativados` na configuracao, gravado aqui em TODAS as filiais
 *    do grupo (mesma regra das Configuracoes Gerais: dono ou administrador).
 *  - NCM/CEST: base unica para todas as empresas (`tabela_ncm`, `tabela_cest`,
 *    id = codigo). So' este servidor grava; as firestore.rules deixam ler.
 *    "Registrar uso" (produto salvo, XML de entrada) cria so' o CODIGO que ainda
 *    nao existe -- nunca nome de produto. Cadastro a mao leva a descricao; ja'
 *    descrito, so' o suporte altera.
 */
const { db, admin } = require('../config/firebase');
const cfopDominio = require('../domain/cfopDomain');
const tabelaDominio = require('../domain/tabelaFiscalDomain');
const { lerGrupo, exigirPermissao, ErroConfiguracoesGerais } = require('./configuracoesGerais');

class ErroTabelasFiscais extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const agora = () => admin.firestore.FieldValue.serverTimestamp();

const PERMISSAO = 'fiscal.tabelas';
const podeUsarATela = (user) => user.isPlatformAdmin || user.isTenantManager || (user.permissoes || []).includes(PERMISSAO);

const exigirATela = (user) => {
  if (!podeUsarATela(user)) {
    throw new ErroTabelasFiscais(403, 'Você não tem a permissão "Fiscal: Tabelas Fiscais". Peça ao administrador da empresa.');
  }
};

/** Ativa ou desativa um CFOP na empresa (todas as filiais do grupo). */
const definirCfopAtivo = async ({ user, codigo, ativo }) => {
  const cfop = cfopDominio.cfopPorCodigo(codigo);
  if (!cfop) throw new ErroTabelasFiscais(400, 'Esse CFOP não está na tabela do sistema.');
  if (typeof ativo !== 'boolean') throw new ErroTabelasFiscais(400, 'Diga se o CFOP fica ativo ou desativado.');
  const base = user.tenantId;
  return db.runTransaction(async (tx) => {
    const usuarioSnap = await tx.get(db.collection('usuarios').doc(user.uid));
    const dadosUsuario = usuarioSnap.exists ? usuarioSnap.data() : {};
    const usuario = { ...dadosUsuario, uid: user.uid, tenantId: dadosUsuario.tenantId || user.uid, role: user.role };
    const grupo = await lerGrupo(tx, base);
    try {
      exigirPermissao(user, usuario, grupo);
    } catch (erro) {
      if (erro instanceof ErroConfiguracoesGerais) {
        throw new ErroTabelasFiscais(403, 'Ativar ou desativar CFOP vale para a empresa inteira: só o dono ou um administrador altera.');
      }
      throw erro;
    }
    const alvos = grupo ? grupo.filiais.map((f) => f.tenantId) : [base];
    const mudanca = ativo
      ? admin.firestore.FieldValue.arrayRemove(cfop.codigo)
      : admin.firestore.FieldValue.arrayUnion(cfop.codigo);
    for (const tenantId of alvos) {
      tx.set(db.collection('configuracoes').doc(tenantId), { cfopsDesativados: mudanca, tenantId, updatedAt: agora() }, { merge: true });
    }
    return { codigo: cfop.codigo, ativo, filiais: alvos.length };
  });
};

/**
 * Codigos que apareceram num produto ou XML: cria os que faltam (so' o codigo).
 * CEST guarda os NCMs com que apareceu. Idempotente.
 */
const registrarUso = async ({ itens }) => {
  const uso = tabelaDominio.codigosDoUso(itens);
  if (uso.ncms.length === 0 && uso.cests.length === 0) return { novosNcm: 0, novosCest: 0 };
  const refsNcm = uso.ncms.map((c) => db.collection('tabela_ncm').doc(c));
  const refsCest = uso.cests.map((c) => db.collection('tabela_cest').doc(c.codigo));
  const [snapsNcm, snapsCest] = await Promise.all([
    refsNcm.length ? db.getAll(...refsNcm) : [],
    refsCest.length ? db.getAll(...refsCest) : [],
  ]);
  // Gravacoes soltas (idempotentes): se uma falhar, a proxima chamada completa.
  const escritas = [];
  let novosNcm = 0;
  let novosCest = 0;
  snapsNcm.forEach((snap, i) => {
    if (snap.exists) return;
    novosNcm += 1;
    escritas.push(refsNcm[i].set({ codigo: uso.ncms[i], descricao: '', origem: 'uso', criadoEm: agora() }));
  });
  snapsCest.forEach((snap, i) => {
    const { codigo, ncms } = uso.cests[i];
    if (!snap.exists) {
      novosCest += 1;
      escritas.push(refsCest[i].set({ codigo, descricao: '', ncms, origem: 'uso', criadoEm: agora() }));
      return;
    }
    const conhecidos = Array.isArray(snap.data().ncms) ? snap.data().ncms : [];
    const faltam = ncms.filter((n) => !conhecidos.includes(n));
    if (faltam.length) escritas.push(refsCest[i].update({ ncms: admin.firestore.FieldValue.arrayUnion(...faltam) }));
  });
  if (escritas.length > 0) {
    await Promise.all(escritas);
    limparCache();
  }
  return { novosNcm, novosCest };
};

const cadastrar = async ({ user, colecao, leitura, rotulo, extra }) => {
  exigirATela(user);
  if (!leitura.ok) throw new ErroTabelasFiscais(400, leitura.erro);
  const { codigo, descricao } = leitura.valor;
  const ref = db.collection(colecao).doc(codigo);
  const resultado = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && !tabelaDominio.podeDescrever(snap.data().descricao, user.isPlatformAdmin)) {
      throw new ErroTabelasFiscais(409, `Esse ${rotulo} já está na base com a descrição "${snap.data().descricao}". Só o suporte da Hennder altera uma descrição já cadastrada.`);
    }
    const dados = { codigo, descricao, atualizadoEm: agora(), ...extra(snap) };
    if (snap.exists) tx.update(ref, dados);
    else tx.set(ref, { ...dados, origem: 'manual', criadoEm: agora() });
    return { codigo, descricao, novo: !snap.exists };
  });
  limparCache();
  return resultado;
};

const cadastrarNcm = ({ user, corpo }) => cadastrar({
  user,
  colecao: 'tabela_ncm',
  leitura: tabelaDominio.lerNovoNcm(corpo),
  rotulo: 'NCM',
  extra: () => ({}),
});

const cadastrarCest = ({ user, corpo }) => {
  const leitura = tabelaDominio.lerNovoCest(corpo);
  return cadastrar({
    user,
    colecao: 'tabela_cest',
    leitura,
    rotulo: 'CEST',
    extra: (snap) => {
      if (!leitura.ok || !leitura.valor.ncm) return snap.exists ? {} : { ncms: [] };
      return { ncms: admin.firestore.FieldValue.arrayUnion(leitura.valor.ncm) };
    },
  });
};

/*
 * LEITURA pela API (a tela nao le o banco direto: assim nao precisa de regra
 * nova no Firestore). A base inteira fica em memoria por alguns minutos -- e'
 * pequena (cresce com o uso) -- e qualquer gravacao daqui limpa a memoria.
 */
const VALIDADE_DO_CACHE_MS = 10 * 60 * 1000;
const LIMITE_DA_RESPOSTA = 200;
const cache = new Map();

const limparCache = () => cache.clear();

const lerTabela = async (colecao) => {
  const guardado = cache.get(colecao);
  if (guardado && Date.now() - guardado.em < VALIDADE_DO_CACHE_MS) return guardado.linhas;
  const snap = await db.collection(colecao).get();
  const linhas = snap.docs.map((d) => ({
    codigo: d.id,
    descricao: typeof d.data().descricao === 'string' ? d.data().descricao : '',
    ...(colecao === 'tabela_cest' ? { ncms: Array.isArray(d.data().ncms) ? d.data().ncms : [] } : {}),
  })).sort((a, b) => a.codigo.localeCompare(b.codigo));
  cache.set(colecao, { em: Date.now(), linhas });
  return linhas;
};

/** Busca na base: digitos pelo comeco do codigo, texto na descricao. CEST pode vir filtrado pelo NCM. */
const buscar = async ({ tipo, busca, ncm }) => {
  const colecao = tipo === 'cest' ? 'tabela_cest' : 'tabela_ncm';
  let linhas = tabelaDominio.filtrarTabela(await lerTabela(colecao), typeof busca === 'string' ? busca : '');
  const doNcm = tabelaDominio.normalizarNcm(ncm);
  if (colecao === 'tabela_cest' && doNcm) linhas = linhas.filter((l) => l.ncms.includes(doNcm));
  return { linhas: linhas.slice(0, LIMITE_DA_RESPOSTA), total: linhas.length };
};

module.exports = {
  ErroTabelasFiscais,
  definirCfopAtivo,
  registrarUso,
  cadastrarNcm,
  cadastrarCest,
  buscar,
  limparCache,
  PERMISSAO,
};
