/*
 * FILIAIS (2026-10-06) -- ver docs/PLANO_FILIAIS.md e src/utils/filialDomain.ts.
 *
 * Toda escrita do grupo (`grupos/{grupoId}`), da `filialAtiva` do usuario e
 * da configuracao inicial de uma filial nova acontece aqui (Admin SDK): as
 * firestore.rules tratam `grupoId`, `filialCodigo` e `filialAtiva` como
 * campos que so' o servidor grava.
 *
 * Quem e' do grupo: o grupo vem da configuracao da filial "casa" do usuario
 * (`configuracoes/{usuarios/{uid}.tenantId}.grupoId`).
 */
const { db, admin } = require('../config/firebase');
const dominio = require('../domain/filialDomain');

class ErroFilial extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const agora = () => admin.firestore.FieldValue.serverTimestamp();
const apagar = () => admin.firestore.FieldValue.delete();

const lerUsuario = async (tx, uid) => {
  const snap = await tx.get(db.collection('usuarios').doc(uid));
  if (!snap.exists) throw new ErroFilial(404, 'Seu usuário não foi encontrado. Saia do sistema e entre de novo.');
  const dados = snap.data();
  return { ...dados, uid, tenantId: dados.tenantId || uid };
};

/** Configuracao da filial "casa" do usuario e o grupo dela (null se a empresa nao tem filiais). */
const lerGrupoDaCasa = async (tx, casaTenantId) => {
  const configSnap = await tx.get(db.collection('configuracoes').doc(casaTenantId));
  const config = configSnap.exists ? configSnap.data() : {};
  const grupoId = typeof config.grupoId === 'string' ? config.grupoId : '';
  if (!grupoId) return { config, grupo: null };
  const grupoSnap = await tx.get(db.collection('grupos').doc(grupoId));
  return { config, grupo: grupoSnap.exists ? dominio.lerGrupo(grupoSnap.id, grupoSnap.data()) : null };
};

const resumoParaTela = (grupo, usuario) => ({
  grupo: grupo ? { id: grupo.id, nome: grupo.nome, matrizTenantId: grupo.matrizTenantId } : null,
  casa: usuario.tenantId,
  filialAtiva: dominio.filialAtivaDoUsuario(usuario),
  filiais: dominio.filiaisDoUsuario(grupo, usuario),
  podeTrocar: dominio.podeUsarOutrasFiliais(grupo, usuario),
  gestor: dominio.ehGestorDoGrupo(grupo, usuario),
  // Lista completa (com as inativas) so' para quem administra as filiais.
  todasAsFiliais: dominio.ehGestorDoGrupo(grupo, usuario) ? grupo.filiais : [],
  modulosBloqueados: grupo ? grupo.modulosBloqueados : [],
  // Sem grupo, a empresa atual vira a matriz (10) e a primeira filial e' a 20.
  proximoCodigo: grupo ? dominio.proximoCodigoDeFilial(grupo) : '20',
});

/** Filiais em que o usuario pode entrar, a ativa e se ele pode trocar. */
const listarFiliais = async ({ user }) => db.runTransaction(async (tx) => {
  const usuario = await lerUsuario(tx, user.uid);
  const { grupo } = await lerGrupoDaCasa(tx, usuario.tenantId);
  return resumoParaTela(grupo, usuario);
});

/** Entra em outra filial: grava a filial ativa do usuario (ou apaga, ao voltar para a casa). */
const ativarFilial = async ({ user, destino }) => db.runTransaction(async (tx) => {
  const alvo = typeof destino === 'string' ? destino.trim() : '';
  if (!alvo) throw new ErroFilial(400, 'Escolha a filial para entrar.');
  const usuario = await lerUsuario(tx, user.uid);
  const { grupo } = await lerGrupoDaCasa(tx, usuario.tenantId);
  const erro = dominio.validarTrocaDeFilial(grupo, usuario, alvo);
  if (erro) throw new ErroFilial(403, erro);
  const valor = dominio.filialAtivaParaGravar(usuario, alvo);
  tx.update(db.collection('usuarios').doc(user.uid), { filialAtiva: valor === null ? apagar() : valor });
  return { filial: grupo.filiais.find((f) => f.tenantId === alvo) };
});

const exigirGestor = (grupo, usuario, acao) => {
  if (grupo) {
    if (!dominio.ehGestorDoGrupo(grupo, usuario)) {
      throw new ErroFilial(403, `Só o dono ou um administrador da empresa pode ${acao}.`);
    }
    return;
  }
  if (!['Master', 'Admin'].includes(usuario.role)) {
    throw new ErroFilial(403, `Só o dono ou um administrador da empresa pode ${acao}.`);
  }
};

/**
 * Cria uma filial. Na primeira, a empresa do usuario vira a matriz (codigo
 * 10) e o grupo nasce. A filial nova recebe a configuracao da matriz (sem a
 * identidade nem a Spedy) e o CNPJ dela fica reservado no sistema.
 */
const criarFilial = async ({ user, corpo }) => db.runTransaction(async (tx) => {
  const usuario = await lerUsuario(tx, user.uid);
  const casa = await lerGrupoDaCasa(tx, usuario.tenantId);
  exigirGestor(casa.grupo, usuario, 'cadastrar filiais');

  const matrizTenantId = casa.grupo ? casa.grupo.matrizTenantId : usuario.tenantId;
  const configMatriz = matrizTenantId === usuario.tenantId
    ? casa.config
    : ((await tx.get(db.collection('configuracoes').doc(matrizTenantId))).data() || {});
  const cnpjMatriz = String(configMatriz.cnpj || '').replace(/\D/g, '');
  const matriz = dominio.matrizAPartirDaConfiguracao(matrizTenantId, configMatriz);
  // Sem grupo ainda: valida contra a matriz que vai nascer (o codigo 10 ja' e' dela).
  const grupoParaValidar = casa.grupo || dominio.lerGrupo('novo', { filiais: [matriz] });

  const dados = dominio.lerDadosDaFilial(corpo);
  const erro = dominio.validarDadosDaFilial(dados, grupoParaValidar, cnpjMatriz);
  if (erro) throw new ErroFilial(400, erro);

  const cnpjRef = dados.tipo === 'cnpj_proprio' ? db.collection('cnpjs_cadastrados').doc(dados.cnpj) : null;
  if (cnpjRef) {
    const cnpjSnap = await tx.get(cnpjRef);
    if (cnpjSnap.exists) {
      throw new ErroFilial(409, 'Esse CNPJ já está cadastrado no sistema como outra empresa. Se ela for desta empresa, fale com o suporte para juntar.');
    }
  }

  const registroMatrizSnap = await tx.get(db.collection('usuarios').doc(matrizTenantId));
  const modulosBloqueados = registroMatrizSnap.exists && Array.isArray(registroMatrizSnap.data().modulosBloqueados)
    ? registroMatrizSnap.data().modulosBloqueados
    : [];

  const grupoRef = casa.grupo ? db.collection('grupos').doc(casa.grupo.id) : db.collection('grupos').doc();
  const novaRef = db.collection('configuracoes').doc();
  const tenantId = novaRef.id;
  const filial = dominio.filialParaGravar(tenantId, dados, cnpjMatriz, false);
  const razaoSocialMatriz = String(configMatriz.razaoSocial || configMatriz.nomeOficina || '');

  tx.set(novaRef, {
    ...dominio.configuracaoInicialDaFilial(configMatriz, dados, { tenantId, grupoId: grupoRef.id, cnpjMatriz, razaoSocialMatriz }),
    createdAt: agora(),
  });
  if (cnpjRef) {
    tx.set(cnpjRef, { cnpj: dados.cnpj, tenantId, grupoId: grupoRef.id, razaoSocial: dados.razaoSocial || dados.nome, createdAt: agora() });
  }
  if (casa.grupo) {
    tx.update(grupoRef, { filiais: [...casa.grupo.filiais, filial], modulosBloqueados, atualizadoEm: agora() });
  } else {
    tx.set(grupoRef, {
      nome: matriz.nome,
      donoUid: matrizTenantId,
      matrizTenantId,
      filiais: [matriz, filial],
      modulosBloqueados,
      criadoPor: user.uid,
      criadoEm: agora(),
      atualizadoEm: agora(),
    });
    tx.update(db.collection('configuracoes').doc(matrizTenantId), { grupoId: grupoRef.id, filialCodigo: matriz.codigo });
  }
  return { tenantId, grupoId: grupoRef.id, filial };
});

const filialDoGrupoDoGestor = async (tx, user, tenantId, acao) => {
  const usuario = await lerUsuario(tx, user.uid);
  const { grupo } = await lerGrupoDaCasa(tx, usuario.tenantId);
  if (!grupo) throw new ErroFilial(404, 'Sua empresa não tem filiais cadastradas.');
  exigirGestor(grupo, usuario, acao);
  const atual = grupo.filiais.find((f) => f.tenantId === tenantId);
  if (!atual) throw new ErroFilial(404, 'Essa filial não faz parte da sua empresa.');
  return { usuario, grupo, atual };
};

/** Cadastro completo de uma filial, para abrir a edicao (o dono pode estar em outra filial). */
const lerCadastroDaFilial = async ({ user, tenantId }) => db.runTransaction(async (tx) => {
  const { atual } = await filialDoGrupoDoGestor(tx, user, tenantId, 'ver o cadastro das filiais');
  const configSnap = await tx.get(db.collection('configuracoes').doc(tenantId));
  return { filial: atual, dados: dominio.dadosDaFilialNaConfiguracao(atual, configSnap.exists ? configSnap.data() : {}) };
});

/**
 * Muda o cadastro de uma filial: nome resumido, codigo, razao social,
 * IE/IM, endereco, contato e situacao. CNPJ e tipo (proprio ou mesmo CNPJ)
 * nao mudam aqui -- trocar CNPJ mexe na Spedy e no registro de CNPJs.
 */
const editarFilial = async ({ user, tenantId, corpo }) => db.runTransaction(async (tx) => {
  const { usuario, grupo, atual } = await filialDoGrupoDoGestor(tx, user, tenantId, 'alterar filiais');
  const configRef = db.collection('configuracoes').doc(tenantId);
  const configSnap = await tx.get(configRef);
  const config = configSnap.exists ? configSnap.data() : {};

  const corpoSeguro = corpo || {};
  const ativa = typeof corpoSeguro.ativa === 'boolean' ? corpoSeguro.ativa : atual.ativa;
  if (!ativa && atual.matriz) throw new ErroFilial(400, 'A matriz não pode ser inativada.');
  if (!ativa && atual.ativa && dominio.filialAtivaDoUsuario(usuario) === tenantId) {
    throw new ErroFilial(400, 'Você está trabalhando nesta filial. Entre em outra antes de inativá-la.');
  }

  const anteriores = dominio.dadosDaFilialNaConfiguracao(atual, config);
  const dados = dominio.lerDadosDaFilial({ ...anteriores, ...corpoSeguro, cnpj: anteriores.cnpj, tipo: anteriores.tipo });
  const erro = dominio.validarEdicaoDaFilial(dados, grupo, tenantId);
  if (erro) throw new ErroFilial(400, erro);

  const filial = { ...atual, nome: dados.nome, codigo: dados.codigo, uf: dados.uf, cidade: dados.cidade, ativa };
  const filiais = grupo.filiais.map((f) => (f.tenantId === tenantId ? filial : f));
  tx.update(db.collection('grupos').doc(grupo.id), { filiais, atualizadoEm: agora() });
  tx.update(configRef, {
    ...dominio.identidadeParaConfiguracao(dados),
    ...(dados.tipo === 'cnpj_proprio' && dados.razaoSocial ? { razaoSocial: dados.razaoSocial } : {}),
  });
  return { filial, antes: atual };
});

module.exports = { ErroFilial, listarFiliais, ativarFilial, criarFilial, editarFilial, lerCadastroDaFilial };
