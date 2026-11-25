const { admin, db } = require('../config/firebase');
const ident = require('../domain/loginIdentidadeDomain');
const { conferirContaDoCadastro, ErroContaDoCadastro } = require('./contaDoCadastro');

/*
 * LOGINS DE FUNCIONARIO PARA O DOMINIO DO DONO (25/11/2026, auditoria de
 * seguranca, item 1.3). Painel da Plataforma › Manutencao.
 *
 * Todo login de funcionario era `{cnpj}-{usuario}@<dominio antigo>`, e esse dominio e'
 * de TERCEIRO: quem tem a caixa de e-mail dele pode pedir "esqueci a senha" ao
 * Firebase e entrar como qualquer funcionario. Esta tarefa troca o e-mail para
 * `{cnpj}-{usuario}@login.nexarcompany.com.br` (subdominio do dono sem caixa de
 * entrada) nos TRES lugares:
 *   1. a conta do Firebase Auth (`auth.updateUser`) -- o que de fato protege;
 *   2. o indice `usernames/{cnpj-usuario}` -- de onde o login le o e-mail
 *      (sistema, Frente de Caixa e app Vendas: nenhum monta o e-mail sozinho),
 *      por isso o funcionario entra com o mesmo CNPJ, usuario e senha;
 *   3. o campo `email` da ficha `usuarios/{uid}`.
 *
 * Fonte da verdade: a LISTA DE CONTAS do Auth (toda conta no dominio antigo,
 * tenha ficha ou nao -- conta orfa tambem e' porta aberta), mais as fichas e os
 * indices que ainda citam o dominio antigo (troca que parou no meio, backup
 * restaurado).
 *
 * - Idempotente e retomavel: cada execucao parte do que esta' gravado agora.
 *   Parou no meio? Rodar de novo termina o que falta.
 * - Ordem por login: conta -> indice -> ficha. Se a conta trocou e o indice
 *   nao, o login daquele funcionario fica fora ate' rodar de novo (a proxima
 *   execucao ve "conta ja' no dominio novo" e so' acerta indice e ficha).
 * - Em LOTES: o Firebase limita as alteracoes de conta por minuto; cada
 *   Aplicar troca no maximo `lote` contas, com pausa entre elas, e diz quantas
 *   faltam.
 * - Conta da plataforma ou id que nao bate com a ficha (contaDoCadastro.js):
 *   nao mexe, lista como falha.
 *
 * Trocar o e-mail pelo Admin SDK NAO manda e-mail para o endereco antigo
 * (documentacao do Firebase: "sem enviar links para reverter"). Trocar o
 * e-mail e' "mudanca grande na conta": o funcionario migrado pode precisar
 * entrar de novo (mesmo usuario e senha).
 */

const LOTE_PADRAO = 100;
const LOTE_MAXIMO = 300;
// ~240 trocas por minuto, abaixo do limite de alteracoes de conta do Auth.
const PAUSA_ENTRE_CONTAS_MS = 250;
const MAX_FALHAS_LISTADAS = 50;

const SEM_EMPRESA = '';

const esperar = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const minusculo = (v) => String(v ?? '').trim().toLowerCase();

const parteLocal = (email) => {
  const e = minusculo(email);
  const arroba = e.lastIndexOf('@');
  return arroba > 0 ? e.slice(0, arroba) : '';
};

const motivoDoErroDoAuth = (erro, emailNovo) => {
  const codigo = erro && erro.code;
  if (codigo === 'auth/email-already-exists') {
    return `Já existe outra conta com o endereço novo (${emailNovo}). Verifique se o funcionário tem dois logins com o mesmo usuário; inative o que sobra e rode de novo.`;
  }
  if (codigo === 'auth/invalid-email') return 'O endereço novo ficou inválido. Avise o suporte.';
  if (codigo === 'auth/too-many-requests' || codigo === 'auth/quota-exceeded') {
    return 'O Firebase pediu para esperar (muitas alterações seguidas). Aguarde alguns minutos e rode Aplicar de novo.';
  }
  return `O Firebase recusou a troca${codigo ? ` (${codigo})` : ''}. Rode Aplicar de novo; se repetir, avise o suporte.`;
};

/** Todas as contas do Auth com e-mail no dominio antigo (paginas de 1000). */
const contasNoDominioAntigo = async (auth) => {
  const contas = new Map();
  let pagina;
  do {
    const resultado = await auth.listUsers(1000, pagina);
    for (const conta of resultado.users || []) {
      if (ident.ehEmailDoDominioAntigo(conta.email)) contas.set(conta.uid, conta);
    }
    pagina = resultado.pageToken;
  } while (pagina);
  return contas;
};

const lerConta = async (auth, uid) => {
  try {
    return await auth.getUser(uid);
  } catch (erro) {
    if (erro && erro.code === 'auth/user-not-found') return null;
    throw erro;
  }
};

const mapaDaColecao = async (nome) => {
  const snap = await db.collection(nome).get();
  const mapa = new Map();
  snap.docs.forEach((d) => mapa.set(d.id, d.data() || {}));
  return mapa;
};

/**
 * @param {object} opcoes
 * @param {boolean} opcoes.aplicar  false = so' simula (nada e' gravado)
 * @param {number} [opcoes.lote]    maximo de logins trocados nesta execucao
 * @param {number} [opcoes.pausaMs] pausa entre trocas de conta (teste usa 0)
 */
async function migrarDominioDosLogins({ aplicar = false, lote = LOTE_PADRAO, pausaMs = PAUSA_ENTRE_CONTAS_MS } = {}) {
  const auth = admin.auth();
  const limiteDoLote = Math.max(1, Math.min(LOTE_MAXIMO, Number(lote) || LOTE_PADRAO));

  const [contas, fichas, indices] = await Promise.all([
    contasNoDominioAntigo(auth),
    mapaDaColecao('usuarios'),
    mapaDaColecao('usernames'),
  ]);

  // Casos por uid: contas no dominio antigo + fichas que ainda citam o dominio antigo.
  const uids = new Set(contas.keys());
  for (const [uid, ficha] of fichas) if (ident.ehEmailDoDominioAntigo(ficha.email)) uids.add(uid);

  // Por empresa, para o relatorio.
  const empresas = new Map();
  const daEmpresa = (tenantId) => {
    const id = tenantId || SEM_EMPRESA;
    if (!empresas.has(id)) {
      empresas.set(id, { tenantId: id, nome: '', jaNoDominioNovo: 0, trocados: 0, soCadastro: 0, semConta: 0, pendentes: 0, falhas: [] });
    }
    return empresas.get(id);
  };
  for (const ficha of fichas.values()) {
    if (minusculo(ficha.email).endsWith(`@${ident.DOMINIO_DO_LOGIN}`)) daEmpresa(ficha.tenantId).jaNoDominioNovo += 1;
  }

  const ordenados = [...uids].map((uid) => {
    const ficha = fichas.get(uid) || null;
    const conta = contas.get(uid);
    const emailAntigo = minusculo(conta ? conta.email : ficha.email);
    const chave = parteLocal(emailAntigo);
    const indice = chave ? indices.get(chave) || null : null;
    return { uid, ficha, conta, emailAntigo, chave, indice, tenantId: (ficha && ficha.tenantId) || (indice && indice.tenantId) || SEM_EMPRESA };
  }).sort((a, b) => a.tenantId.localeCompare(b.tenantId) || a.chave.localeCompare(b.chave) || a.uid.localeCompare(b.uid));

  const indicesTratados = new Set();
  let usados = 0;
  let contasTrocadas = 0;

  const falhar = (caso, motivo) => {
    daEmpresa(caso.tenantId).falhas.push({
      uid: caso.uid,
      nome: String((caso.ficha && caso.ficha.nome) || (caso.conta && caso.conta.displayName) || ''),
      usuario: caso.chave,
      motivo,
    });
  };

  for (const caso of ordenados) {
    const empresa = daEmpresa(caso.tenantId);
    if (caso.chave) indicesTratados.add(caso.chave);
    const emailNovo = ident.emailNoDominioDoLogin(caso.emailAntigo);
    if (!emailNovo) {
      falhar(caso, 'O e-mail de login está fora do padrão (sem usuário antes do "@"). Corrija o cadastro deste funcionário em Usuários.');
      continue;
    }

    // Conta que nao veio da lista do dominio antigo: ja' trocada, de outro e-mail ou inexistente.
    const conta = caso.conta || await lerConta(auth, caso.uid);
    const contaNoAntigo = Boolean(conta && ident.ehEmailDoDominioAntigo(conta.email));
    const contaNoNovo = Boolean(conta && minusculo(conta.email) === emailNovo);
    if (conta && !contaNoAntigo && !contaNoNovo) {
      falhar(caso, `A ficha diz ${caso.emailAntigo}, mas o login deste funcionário usa outro e-mail (${minusculo(conta.email) || 'sem e-mail'}). Nada foi alterado; avise o suporte.`);
      continue;
    }

    if (contaNoAntigo) {
      try {
        await conferirContaDoCadastro({ id: caso.uid, usuario: caso.ficha || {} });
      } catch (erro) {
        if (erro instanceof ErroContaDoCadastro) {
          falhar(caso, 'Esta conta é da equipe da plataforma ou o identificador dela pertence a uma empresa. Não foi alterada; troque o e-mail dela à mão no console do Firebase.');
          continue;
        }
        throw erro;
      }
    }

    if (!aplicar) {
      if (contaNoAntigo) empresa.trocados += 1;
      else if (conta) empresa.soCadastro += 1;
      else empresa.semConta += 1;
      continue;
    }
    if (usados >= limiteDoLote) {
      empresa.pendentes += 1;
      continue;
    }
    usados += 1;

    if (contaNoAntigo) {
      try {
        if (contasTrocadas > 0 && pausaMs > 0) await esperar(pausaMs);
        await auth.updateUser(caso.uid, { email: emailNovo });
        contasTrocadas += 1;
      } catch (erro) {
        if (erro && erro.code === 'auth/user-not-found') {
          // Sumiu entre a lista e a troca: segue so' com indice e ficha.
        } else {
          falhar(caso, motivoDoErroDoAuth(erro, emailNovo));
          continue;
        }
      }
    }

    // Indice: so' se ainda aponta para o endereco antigo DESTE login.
    if (caso.indice && minusculo(caso.indice.email) === caso.emailAntigo) {
      await db.collection('usernames').doc(caso.chave).set({ email: emailNovo }, { merge: true });
    }
    if (caso.ficha && ident.ehEmailDoDominioAntigo(caso.ficha.email)) {
      await db.collection('usuarios').doc(caso.uid).update({ email: emailNovo });
    }

    if (contaNoAntigo) empresa.trocados += 1;
    else if (conta) empresa.soCadastro += 1;
    else empresa.semConta += 1;
  }

  // Indices no dominio antigo sem conta nem ficha nessa situacao (funcionario
  // excluido, ou troca que parou entre a conta e o indice): apontam para o novo.
  let indicesSoltos = 0;
  for (const [chave, indice] of indices) {
    if (indicesTratados.has(chave) || !ident.ehEmailDoDominioAntigo(indice.email)) continue;
    const empresa = daEmpresa(indice.tenantId);
    if (aplicar && usados >= limiteDoLote) {
      empresa.pendentes += 1;
      continue;
    }
    indicesSoltos += 1;
    empresa.soCadastro += 1;
    if (!aplicar) continue;
    usados += 1;
    await db.collection('usernames').doc(chave).set({ email: ident.emailNoDominioDoLogin(indice.email) }, { merge: true });
  }

  // Nome de cada empresa com algo a mostrar.
  const lista = [...empresas.values()].filter((e) => e.trocados + e.soCadastro + e.semConta + e.pendentes + e.falhas.length > 0 || e.jaNoDominioNovo > 0);
  const configs = await Promise.all(lista.map((e) => (e.tenantId ? db.collection('configuracoes').doc(e.tenantId).get() : null)));
  lista.forEach((e, i) => {
    const c = configs[i] && configs[i].exists ? configs[i].data() || {} : {};
    e.nome = String(c.nomeOficina || c.razaoSocial || c.nomeFantasia || (e.tenantId ? e.tenantId : 'Sem empresa no cadastro'));
  });
  lista.sort((a, b) => (b.falhas.length - a.falhas.length) || a.nome.localeCompare(b.nome));

  const soma = (campo) => lista.reduce((t, e) => t + e[campo], 0);
  const totalFalhas = lista.reduce((t, e) => t + e.falhas.length, 0);
  // Relatorio enxuto: falhas listadas ate' um limite (o total sempre vem).
  let restantes = MAX_FALHAS_LISTADAS;
  lista.forEach((e) => {
    e.totalFalhas = e.falhas.length;
    e.falhas = e.falhas.slice(0, Math.max(0, restantes));
    restantes -= e.falhas.length;
  });

  return {
    dominioNovo: ident.DOMINIO_DO_LOGIN,
    dominioAntigo: ident.DOMINIO_DO_LOGIN_ANTIGO,
    aplicar,
    lote: limiteDoLote,
    contasNoDominioAntigo: contas.size,
    totais: {
      trocados: soma('trocados'),
      soCadastro: soma('soCadastro'),
      semConta: soma('semConta'),
      jaNoDominioNovo: soma('jaNoDominioNovo'),
      pendentes: soma('pendentes'),
      falhas: totalFalhas,
      indicesSoltos,
    },
    empresas: lista,
  };
}

module.exports = { migrarDominioDosLogins, LOTE_PADRAO, LOTE_MAXIMO, PAUSA_ENTRE_CONTAS_MS };
