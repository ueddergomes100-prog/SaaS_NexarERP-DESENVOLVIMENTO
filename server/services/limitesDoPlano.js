/*
 * LIMITES DO PLANO PELO SERVIDOR (19/10/2026, auditoria de seguranca "so' a
 * tela protege"; decisao do dono: o servidor confere).
 *
 * Criar login e ligar o app Vendas passavam so' pela tela: pelo DevTools dava
 * para criar logins alem do contratado e ligar o app para quantos quisesse.
 * Agora as duas coisas acontecem aqui, conferindo o limite do plano
 * (usuarios/{matriz}.limiteUsuarios / limiteAcessoMobile), e as
 * firestore.rules nao deixam o navegador fazer direto. Regra em
 * src/utils/limitesDoPlanoDomain.ts.
 */
const { admin, db } = require('../config/firebase');
const lim = require('../domain/limitesDoPlanoDomain');
const ident = require('../domain/loginIdentidadeDomain');
const { normalizarCodigo } = require('./vendedorPin');
const { buildDocumentMetadata, buildDocumentUpdateMetadata } = require('../domain/documentMetadata');
const permApp = require('../domain/permissoesAppDomain');
const { parseNivelAcesso } = require('../domain/visibilidadeVendasDomain');

class ErroLimite extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const agora = () => admin.firestore.FieldValue.serverTimestamp();

/** O plano e' do grupo: numa filial vale o da matriz. */
const matrizDaEmpresa = async (tenantId) => {
  const config = (await db.collection('configuracoes').doc(tenantId).get()).data() || {};
  const grupoId = typeof config.grupoId === 'string' ? config.grupoId : '';
  if (!grupoId) return tenantId;
  const grupo = await db.collection('grupos').doc(grupoId).get();
  const matriz = grupo.exists ? grupo.data().matrizTenantId : '';
  return typeof matriz === 'string' && matriz ? matriz : tenantId;
};

const limitesDaEmpresa = async (tenantId) => {
  const matriz = await matrizDaEmpresa(tenantId);
  const registro = (await db.collection('usuarios').doc(matriz).get()).data() || {};
  return {
    usuarios: lim.lerLimiteDoPlano(registro.limiteUsuarios, lim.LIMITE_USUARIOS_PADRAO),
    app: lim.lerLimiteDoPlano(registro.limiteAcessoMobile, lim.LIMITE_ACESSO_MOBILE_PADRAO),
  };
};

const registrosDaEmpresa = async (tenantId) => {
  const snap = await db.collection('usuarios').where('tenantId', '==', tenantId).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

const ehVendedorSemLogin = (r) => r && r.tipoRegistro === 'vendedor';

/** Entregas do romaneio no app do motorista (src/pages/Vendedor/vendedorPermissoes.ts). */
const PERMISSAO_ENTREGAS_APP = 'operacoes.entregas_app';

// ===========================================================================
// CRIAR LOGIN (Equipe & Acessos › Adicionar Funcionario)
// ===========================================================================

const criarLogin = async ({ user, tenantId, corpo }) => {
  const c = corpo || {};
  const nome = String(c.nome ?? '').trim().slice(0, 120);
  if (!nome) throw new ErroLimite(400, 'Informe o nome do funcionário.');
  const checagemUsuario = ident.checarUsername(c.usuario);
  if (!checagemUsuario.ok) throw new ErroLimite(400, checagemUsuario.motivo);
  const senha = String(c.senha ?? '');
  if (senha.length < 6) throw new ErroLimite(400, 'A senha deve ter pelo menos 6 caracteres.');
  const codigoBruto = String(c.codigoVendedor ?? '').trim();
  const codigoVendedor = codigoBruto ? normalizarCodigo(codigoBruto) : '';
  if (codigoBruto && !codigoVendedor) throw new ErroLimite(400, 'Código de vendedor inválido. Use 2 dígitos, de 01 a 99.');

  const config = (await db.collection('configuracoes').doc(tenantId).get()).data() || {};
  const checagemCnpj = ident.checarPrefixoDaEmpresa(config.cnpj);
  if (!checagemCnpj.ok) throw new ErroLimite(400, checagemCnpj.motivo);

  // Limite: so' conta quem tem LOGIN (vendedor de balcao nao entra no sistema).
  const registros = await registrosDaEmpresa(tenantId);
  const { usuarios: limite } = await limitesDaEmpresa(tenantId);
  const comLogin = registros.filter((r) => !ehVendedorSemLogin(r)).length;
  if (comLogin >= limite) throw new ErroLimite(409, lim.mensagemLimiteDeUsuarios(limite));
  if (codigoVendedor && registros.some((r) => r.codigoVendedor === codigoVendedor)) {
    throw new ErroLimite(409, `Outro funcionário desta empresa já usa o código ${codigoVendedor}. Escolha um código diferente.`);
  }

  // "Este funcionario e' motorista" (26/10/2026, pedido do dono): o servidor ja'
  // cria o motorista vinculado (motoristas/{uid} -> aparece na rota), da' a
  // permissao de entregas no app e liga o app se o plano tiver vaga. Antes a
  // tela gravava o motorista depois, e quem nao tinha a permissao de Rotas
  // (ex.: o gerente) ficava com o usuario sem o motorista.
  const motorista = c.motorista && typeof c.motorista === 'object' ? {
    telefone: String(c.motorista.telefone ?? '').trim().slice(0, 40),
    cnh: String(c.motorista.cnh ?? '').trim().slice(0, 40),
  } : null;
  let appLiberado = false;
  let limiteApp = 0;
  if (motorista) {
    ({ app: limiteApp } = await limitesDaEmpresa(tenantId));
    appLiberado = registros.filter((r) => r.acessoAppMobile === true).length < limiteApp;
  }

  const chave = ident.montarChaveUsername(checagemCnpj.cnpj, checagemUsuario.username);
  const email = ident.montarEmailSintetico(chave);
  let novo;
  try {
    novo = await admin.auth().createUser({ email, password: senha, displayName: nome });
  } catch (erro) {
    if (erro && (erro.code === 'auth/email-already-exists' || erro.code === 'auth/email-already-in-use')) {
      throw new ErroLimite(409, 'Este nome de usuário já está em uso. Escolha outro.');
    }
    throw erro;
  }

  await db.collection('usuarios').doc(novo.uid).set({
    nome,
    username: chave,
    email,
    ...(codigoVendedor ? { codigoVendedor } : {}),
    role: 'Funcionario',
    nivelAcesso: 'funcionario',
    permissoes: motorista ? [PERMISSAO_ENTREGAS_APP] : [],
    ...(appLiberado ? { acessoAppMobile: true, acessoAppMobileEm: new Date().toISOString() } : {}),
    tenantId,
    createdAt: agora(),
    createdBy: user.uid,
    status: 'Ativo',
    ...buildDocumentMetadata(user.uid, agora()),
  });
  await db.collection('usernames').doc(chave).set({ email, tenantId });
  if (motorista) {
    await db.collection('motoristas').doc(novo.uid).set({
      nome: nome.toUpperCase(),
      telefone: motorista.telefone,
      cnh: motorista.cnh,
      observacao: '',
      usuarioId: novo.uid,
      tenantId,
      ativo: true,
      createdAt: agora(),
      ...buildDocumentMetadata(user.uid, agora()),
    });
  }
  return {
    uid: novo.uid, nome, usuario: checagemUsuario.username, limite, emUso: comLogin + 1,
    ...(motorista ? { motorista: true, appLiberado, limiteApp } : {}),
  };
};

// ===========================================================================
// LIGAR / DESLIGAR O APP VENDAS
// ===========================================================================

const alterarAcessoApp = async ({ user, tenantId, corpo }) => {
  const c = corpo || {};
  const usuarioId = String(c.usuarioId ?? '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(usuarioId)) throw new ErroLimite(400, 'Cadastro inválido. Atualize a tela e tente de novo.');
  const ligar = c.ligar === true;

  const ref = db.collection('usuarios').doc(usuarioId);
  const snap = await ref.get();
  const alvo = snap.exists ? snap.data() : null;
  if (!alvo || alvo.tenantId !== tenantId) throw new ErroLimite(404, 'Este cadastro não existe mais. Atualize a tela.');
  if (alvo.role !== 'Funcionario') throw new ErroLimite(403, 'O aplicativo mobile é liberado só para funcionários e vendedores.');

  const config = (await db.collection('configuracoes').doc(tenantId).get()).data() || {};
  const vendedor = ehVendedorSemLogin(alvo);
  const codigo = String(alvo.codigoVendedor ?? '').trim();
  const cnpj = String(config.cnpj || '').replace(/\D/g, '');
  const chaveIndice = vendedor && codigo && cnpj.length === 14 ? `${cnpj}-${codigo}` : '';

  if (ligar && alvo.acessoAppMobile !== true) {
    if (vendedor && !chaveIndice) {
      throw new ErroLimite(400, 'Para o vendedor entrar no app, a empresa precisa do CNPJ cadastrado (Configurações) e o vendedor de um código. Confira e tente de novo.');
    }
    const { app: limite } = await limitesDaEmpresa(tenantId);
    const usados = (await registrosDaEmpresa(tenantId)).filter((r) => r.acessoAppMobile === true).length;
    if (usados >= limite) throw new ErroLimite(409, lim.mensagemLimiteDoApp(limite));
  }

  await ref.update({
    acessoAppMobile: ligar,
    ...(ligar && alvo.acessoAppMobile !== true ? { acessoAppMobileEm: new Date().toISOString() } : {}),
    updatedAt: agora(),
    ...buildDocumentUpdateMetadata(user.uid, agora(), ligar ? 'Aplicativo mobile liberado' : 'Aplicativo mobile desligado'),
  });
  // Indice do login pelo codigo (so' vendedor de balcao): o app procura por ele.
  if (chaveIndice) {
    const indice = db.collection('vendedores_mobile_login').doc(chaveIndice);
    if (ligar) await indice.set({ tenantId, vendedorId: usuarioId });
    else {
      const atual = await indice.get();
      if (atual.exists && atual.data().vendedorId === usuarioId) await indice.delete();
    }
  }
  return { usuarioId, nome: String(alvo.nome || ''), ligado: ligar };
};

/** Login do app pelo codigo: este vendedor esta' dentro do limite contratado? */
const vagaNoApp = async (tenantId, vendedorId) => {
  const { app: limite } = await limitesDaEmpresa(tenantId);
  const dentro = lim.idsDentroDoLimiteDoApp(await registrosDaEmpresa(tenantId), limite);
  return dentro.has(vendedorId) ? null : lim.mensagemSemVagaNoApp(limite);
};

// ===========================================================================
// VINCULAR MOTORISTA JA' CADASTRADO A UM USUARIO (26/10/2026, pedido do dono)
// ===========================================================================
// O motorista criado em Operacoes > Motoristas tem id proprio, e rotas,
// despesas e contas a pagar ja' apontam para ele: o id NAO muda. O vinculo e'
// motoristas/{id}.usuarioId + usuarios/{uid}.motoristaId; o app reconhece as
// rotas pelos dois (VendedorEntregas). Junto: permissao de entregas no app e o
// app ligado, se o plano tiver vaga -- igual a criar o login ja' como motorista.

const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;

const vincularMotorista = async ({ user, tenantId, corpo }) => {
  const c = corpo || {};
  const usuarioId = String(c.usuarioId ?? '');
  const motoristaId = String(c.motoristaId ?? '');
  if (!ID_VALIDO.test(usuarioId) || !ID_VALIDO.test(motoristaId)) throw new ErroLimite(400, 'Cadastro inválido. Atualize a tela e tente de novo.');

  const refUsuario = db.collection('usuarios').doc(usuarioId);
  const refMotorista = db.collection('motoristas').doc(motoristaId);
  const [snapUsuario, snapMotorista, snapProprio, jaVinculados] = await Promise.all([
    refUsuario.get(),
    refMotorista.get(),
    db.collection('motoristas').doc(usuarioId).get(),
    db.collection('motoristas').where('tenantId', '==', tenantId).where('usuarioId', '==', usuarioId).get(),
  ]);
  const alvo = snapUsuario.exists ? snapUsuario.data() : null;
  const motorista = snapMotorista.exists ? snapMotorista.data() : null;
  if (!alvo || alvo.tenantId !== tenantId) throw new ErroLimite(404, 'Este usuário não existe mais. Atualize a tela.');
  if (!motorista || motorista.tenantId !== tenantId) throw new ErroLimite(404, 'Este motorista não existe mais. Atualize a lista de motoristas.');
  if (alvo.role !== 'Funcionario' || ehVendedorSemLogin(alvo)) throw new ErroLimite(400, 'Só funcionário com login pode ser vinculado a um motorista.');
  if (motorista.usuarioId && motorista.usuarioId !== usuarioId) throw new ErroLimite(409, `O motorista ${motorista.nome || ''} já está vinculado a outro usuário.`);
  const outro = (snapProprio.exists && snapProprio.data().tenantId === tenantId && snapProprio.id !== motoristaId)
    || jaVinculados.docs.some((d) => d.id !== motoristaId)
    || (alvo.motoristaId && alvo.motoristaId !== motoristaId);
  if (outro) throw new ErroLimite(409, `${alvo.nome || 'Este usuário'} já está vinculado a outro motorista. Confira em Operações → Motoristas.`);
  if (motorista.ativo === false) throw new ErroLimite(400, `O motorista ${motorista.nome || ''} está inativo. Reative em Operações → Motoristas antes de vincular.`);

  let appLiberado = alvo.acessoAppMobile === true;
  let limiteApp = 0;
  if (!appLiberado) {
    ({ app: limiteApp } = await limitesDaEmpresa(tenantId));
    appLiberado = (await registrosDaEmpresa(tenantId)).filter((r) => r.acessoAppMobile === true).length < limiteApp;
  }
  const permissoes = Array.isArray(alvo.permissoes) ? alvo.permissoes : [];

  const lote = db.batch();
  lote.update(refMotorista, { usuarioId, ...buildDocumentUpdateMetadata(user.uid, agora(), 'Vinculado ao usuário') });
  lote.update(refUsuario, {
    motoristaId,
    ...(permissoes.includes(PERMISSAO_ENTREGAS_APP) ? {} : { permissoes: [...permissoes, PERMISSAO_ENTREGAS_APP] }),
    ...(appLiberado && alvo.acessoAppMobile !== true ? { acessoAppMobile: true, acessoAppMobileEm: new Date().toISOString() } : {}),
    updatedAt: agora(),
    ...buildDocumentUpdateMetadata(user.uid, agora(), 'Vinculado ao motorista'),
  });
  await lote.commit();
  return { usuarioId, motoristaId, nome: alvo.nome || '', motoristaNome: motorista.nome || '', appLiberado, limiteApp };
};

// ===========================================================================
// FICHA E SITUACAO DO FUNCIONARIO (26/10/2026, pedido do dono: o gerente tambem edita)
// ===========================================================================
// Antes a tela gravava direto (so' dono/administrador passavam nas rules). Agora
// e' tudo pelo servidor, para todos: quem pode e' decidido na rota
// (middleware/gestaoEquipe.js). Aqui so' a trava de empresa e os dados.

const lerFuncionario = async (tenantId, usuarioId) => {
  if (!ID_VALIDO.test(String(usuarioId ?? ''))) throw new ErroLimite(400, 'Cadastro inválido. Atualize a tela e tente de novo.');
  const ref = db.collection('usuarios').doc(String(usuarioId));
  const snap = await ref.get();
  const alvo = snap.exists ? snap.data() : null;
  if (!alvo || alvo.tenantId !== tenantId) throw new ErroLimite(404, 'Este usuário não existe mais. Atualize a tela.');
  return { ref, alvo };
};

/** Nome, codigo de vendedor e "e' motorista" (cria o motorista vinculado, como no criar login). */
const editarFicha = async ({ user, tenantId, corpo }) => {
  const c = corpo || {};
  const { ref, alvo } = await lerFuncionario(tenantId, c.usuarioId);
  const nome = String(c.nome ?? '').trim().slice(0, 120);
  if (!nome) throw new ErroLimite(400, 'Informe o nome do funcionário.');
  const codigoBruto = String(c.codigoVendedor ?? '').trim();
  const codigoVendedor = codigoBruto ? normalizarCodigo(codigoBruto) : '';
  if (codigoBruto && !codigoVendedor) throw new ErroLimite(400, 'Código de vendedor inválido. Use 2 dígitos, de 01 a 99.');
  if (codigoVendedor) {
    const mesmos = await db.collection('usuarios').where('tenantId', '==', tenantId).where('codigoVendedor', '==', codigoVendedor).get();
    if (mesmos.docs.some((d) => d.id !== ref.id)) throw new ErroLimite(409, `Outro funcionário desta empresa já usa o código ${codigoVendedor}. Escolha um código diferente.`);
  }

  const atualizacao = {
    nome,
    // Codigo em branco mantem o que ja' havia (como a tela fazia); nunca grava undefined.
    ...(codigoVendedor ? { codigoVendedor } : {}),
    updatedAt: agora(),
    ...buildDocumentUpdateMetadata(user.uid, agora(), 'Ficha do funcionário alterada'),
  };

  const motorista = c.motorista && typeof c.motorista === 'object' ? {
    telefone: String(c.motorista.telefone ?? '').trim().slice(0, 40),
    cnh: String(c.motorista.cnh ?? '').trim().slice(0, 40),
  } : null;
  let resultadoMotorista = null;
  if (motorista) {
    // Ja' vinculado: motoristas/{uid} (criado aqui) ou o motorista vinculado depois.
    const idMotorista = String(alvo.motoristaId || ref.id);
    const refMotorista = db.collection('motoristas').doc(idMotorista);
    const snapMotorista = await refMotorista.get();
    if (snapMotorista.exists && snapMotorista.data().tenantId === tenantId) {
      await refMotorista.update({ nome: nome.toUpperCase(), telefone: motorista.telefone, cnh: motorista.cnh, ...buildDocumentUpdateMetadata(user.uid, agora()) });
      resultadoMotorista = { novo: false, appLiberado: alvo.acessoAppMobile === true, limiteApp: 0 };
    } else {
      let appLiberado = alvo.acessoAppMobile === true;
      let limiteApp = 0;
      if (!appLiberado) {
        ({ app: limiteApp } = await limitesDaEmpresa(tenantId));
        appLiberado = (await registrosDaEmpresa(tenantId)).filter((r) => r.acessoAppMobile === true).length < limiteApp;
      }
      const permissoes = Array.isArray(alvo.permissoes) ? alvo.permissoes : [];
      if (!permissoes.includes(PERMISSAO_ENTREGAS_APP)) atualizacao.permissoes = [...permissoes, PERMISSAO_ENTREGAS_APP];
      if (appLiberado && alvo.acessoAppMobile !== true) Object.assign(atualizacao, { acessoAppMobile: true, acessoAppMobileEm: new Date().toISOString() });
      await db.collection('motoristas').doc(ref.id).set({
        nome: nome.toUpperCase(), telefone: motorista.telefone, cnh: motorista.cnh, observacao: '',
        usuarioId: ref.id, tenantId, ativo: true, createdAt: agora(),
        ...buildDocumentMetadata(user.uid, agora()),
      });
      resultadoMotorista = { novo: true, appLiberado, limiteApp };
    }
  }

  await ref.update(atualizacao);
  return { usuarioId: ref.id, nome, ...(resultadoMotorista ? { motorista: resultadoMotorista } : {}) };
};

/** Inativar / reativar. Inativo e' desconectado (o servidor e as rules recusam perfil inativo). */
const alterarSituacao = async ({ user, tenantId, corpo }) => {
  const c = corpo || {};
  const { ref, alvo } = await lerFuncionario(tenantId, c.usuarioId);
  if (ref.id === tenantId) throw new ErroLimite(400, 'O dono da empresa não pode ser inativado.');
  const ativo = c.ativo === true;
  await ref.update({
    status: ativo ? 'Ativo' : 'Inativo',
    ...buildDocumentUpdateMetadata(user.uid, agora(), ativo ? 'Usuário reativado' : 'Usuário inativado'),
  });
  return { usuarioId: ref.id, nome: alvo.nome || '', ativo };
};

/**
 * Permissoes do funcionario (26/10/2026: pelo servidor). Grava com o marcador do
 * app (permissoesAppDomain): dai' em diante as chaves do app valem como marcadas.
 * Gerente: so' da'/tira o que ELE MESMO tem (contando as chaves implicitas do
 * app) e nunca muda o nivel de acesso.
 */
const salvarPermissoes = async ({ user, tenantId, corpo, gerente }) => {
  const c = corpo || {};
  const { ref, alvo } = await lerFuncionario(tenantId, c.usuarioId);
  if (alvo.role !== 'Funcionario') throw new ErroLimite(400, 'Só funcionário tem permissões por módulo; administrador e dono já têm acesso a tudo.');
  if (!Array.isArray(c.permissoes)) throw new ErroLimite(400, 'Lista de permissões inválida. Atualize a tela e tente de novo.');
  const novas = c.permissoes.filter(permApp.permissaoValida);
  if (gerente) {
    const semTer = permApp.mexidasSemTer({ antes: alvo.permissoes, depois: novas, doGerente: user.permissoes });
    if (semTer.length > 0) {
      throw new ErroLimite(403, `Você só pode liberar ou retirar as permissões que você mesmo tem. Fora do seu alcance: ${semTer.join(', ')}. Peça ao dono ou a um administrador.`);
    }
  }
  const nivel = !gerente && c.nivelAcesso !== undefined ? parseNivelAcesso(c.nivelAcesso) : null;
  await ref.update({
    permissoes: permApp.permissoesParaGravar(novas),
    ...(nivel ? { nivelAcesso: nivel } : {}),
    ...buildDocumentUpdateMetadata(user.uid, agora(), 'Permissões atualizadas'),
  });
  return { usuarioId: ref.id, nome: alvo.nome || '' };
};

module.exports = { ErroLimite, criarLogin, alterarAcessoApp, vagaNoApp, limitesDaEmpresa, vincularMotorista, editarFicha, alterarSituacao, salvarPermissoes };
