const { admin, db } = require('../config/firebase');

/*
 * A CONTA DO FIREBASE COM ESTE ID E' MESMO DESTE CADASTRO? (auditoria de
 * seguranca, 24/11/2026)
 *
 * O dono/administrador de uma empresa cria pela tela o cadastro de vendedor de
 * balcao em `usuarios/{id}`, e as regras nao limitam o `id`. Quem trocasse a
 * senha ou emitisse o login "do cadastro" agia, na verdade, sobre a CONTA do
 * Firebase Auth com aquele id -- que pode ser de outra pessoa:
 *
 *  - a conta de um administrador da PLATAFORMA que nao tem ficha em `usuarios`
 *    (o papel dele vem do token): dava para trocar a senha dele ou entrar
 *    como ele, com acesso a todas as empresas;
 *  - o id de uma FILIAL (id de `configuracoes`, sem ficha em `usuarios`): as
 *    regras do Storage liberavam os arquivos dela para quem tivesse esse uid.
 *
 * Chame isto ANTES de `auth.updateUser(id)` ou `createCustomToken(id)` sempre
 * que o id vier de um documento de `usuarios`. Devolve a conta (ou null se
 * ainda nao existe: vendedor de balcao so' ganha conta no primeiro login por
 * codigo) ou lanca ErroContaDoCadastro.
 */

class ErroContaDoCadastro extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

const PAPEIS_DA_PLATAFORMA = ['NexarAdmin', 'SuperAdmin'];

const MENSAGEM_CADASTRO_RECUSADO = 'Este cadastro não pode ser usado para entrar nem para trocar senha: o identificador dele pertence a outra conta. '
  + 'Inative este cadastro e crie o vendedor de novo em Cadastros Auxiliares › Vendedores. Se continuar, fale com o suporte.';

/** A conta tem papel de plataforma gravado nela (vale em qualquer login daquela conta)? */
const ehContaDaPlataforma = (conta) => {
  const marcas = (conta && conta.customClaims) || {};
  return marcas.nexarAdmin === true || marcas.superAdmin === true || PAPEIS_DA_PLATAFORMA.includes(marcas.role);
};

const lerConta = async (uid) => {
  try {
    return await admin.auth().getUser(uid);
  } catch (erro) {
    if (erro && erro.code === 'auth/user-not-found') return null;
    throw erro;
  }
};

async function conferirContaDoCadastro({ id, usuario }) {
  const uid = String(id || '');
  const dados = usuario || {};

  // Id de empresa ou de filial: so' o DONO dela tem esse uid (cadastro cuja empresa e' o proprio id).
  if (dados.tenantId !== uid) {
    const empresa = await db.collection('configuracoes').doc(uid).get();
    if (empresa.exists) throw new ErroContaDoCadastro(403, MENSAGEM_CADASTRO_RECUSADO);
  }

  const conta = await lerConta(uid);
  if (conta && ehContaDaPlataforma(conta)) throw new ErroContaDoCadastro(403, MENSAGEM_CADASTRO_RECUSADO);
  return conta;
}

module.exports = { conferirContaDoCadastro, ehContaDaPlataforma, ErroContaDoCadastro, MENSAGEM_CADASTRO_RECUSADO };
