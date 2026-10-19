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
    permissoes: [],
    tenantId,
    createdAt: agora(),
    createdBy: user.uid,
    status: 'Ativo',
    ...buildDocumentMetadata(user.uid, agora()),
  });
  await db.collection('usernames').doc(chave).set({ email, tenantId });
  return { uid: novo.uid, nome, usuario: checagemUsuario.username, limite, emUso: comLogin + 1 };
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

module.exports = { ErroLimite, criarLogin, alterarAcessoApp, vagaNoApp, limitesDaEmpresa };
