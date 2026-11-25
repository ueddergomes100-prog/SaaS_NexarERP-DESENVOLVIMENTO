const { auth, db } = require('../config/firebase');
const { conferirContaDoCadastro, ErroContaDoCadastro } = require('./contaDoCadastro');

/**
 * Senha de ACESSO (login no sistema) de um funcionario -- diferente da senha
 * do VENDEDOR (PIN de identificacao na venda, ver services/vendedorPin.js).
 * Sao dois segredos de coisas diferentes, guardados em lugares diferentes:
 *
 *  - senha de acesso: Firebase Auth (email sintetico + senha), controla
 *    quem entra no sistema;
 *  - senha do vendedor: hash proprio em `usuarios_pin/{uid}`, controla quem
 *    a estacao de balcao atribui a venda.
 *
 * So o Admin SDK consegue trocar a senha de OUTRO usuario no Firebase Auth
 * -- o SDK do cliente so troca a senha de quem esta logado agora mesmo. Por
 * isso isto vive no backend.
 */

class ErroSenhaAcesso extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

async function redefinirSenhaAcesso({ tenantId, usuarioId, novaSenha }) {
  if (!db || !auth) throw new ErroSenhaAcesso(503, 'Backend sem acesso ao banco de dados.');

  const senha = String(novaSenha || '');
  if (senha.length < 6) {
    throw new ErroSenhaAcesso(400, 'A senha de acesso deve ter pelo menos 6 caracteres.');
  }

  const usuarioRef = db.collection('usuarios').doc(String(usuarioId || ''));
  const usuarioSnap = await usuarioRef.get();
  if (!usuarioSnap.exists) {
    throw new ErroSenhaAcesso(404, 'Usuário não encontrado.');
  }

  const usuario = usuarioSnap.data();
  // Trava de tenant: um admin so mexe em usuario da propria empresa -- mesma
  // regra de server/services/vendedorPin.js.
  if (usuario.tenantId !== tenantId) {
    throw new ErroSenhaAcesso(403, 'Este usuário não pertence à sua empresa.');
  }

  // Vendedor de balcao nao tem login no sistema, mesmo que o cadastro traga um e-mail
  // (auditoria de 24/11/2026: o cadastro de vendedor nasce pela tela, com o id e os campos que quem cria quiser).
  if (usuario.tipoRegistro === 'vendedor') {
    throw new ErroSenhaAcesso(400, 'Este cadastro é de vendedor de balcão e não tem login no sistema. A senha dele é a de vendedor (código e senha), definida em Cadastros Auxiliares › Vendedores.');
  }

  if (!usuario.email) {
    throw new ErroSenhaAcesso(400, 'Este cadastro não tem login no sistema (é um vendedor sem acesso, cadastrado em Cadastros Auxiliares → Vendedores). Não há senha de acesso para redefinir.');
  }

  // A conta do Firebase com este id tem de ser mesmo deste cadastro (ver contaDoCadastro.js).
  try {
    await conferirContaDoCadastro({ id: usuarioRef.id, usuario });
  } catch (erro) {
    if (erro instanceof ErroContaDoCadastro) throw new ErroSenhaAcesso(erro.status, erro.message);
    throw erro;
  }

  try {
    await auth.updateUser(usuarioRef.id, { password: senha });
  } catch (erro) {
    if (erro.code === 'auth/user-not-found') {
      throw new ErroSenhaAcesso(404, 'O login deste usuário não existe mais no Firebase Auth. Fale com o suporte.');
    }
    throw erro;
  }

  return { usuarioId: usuarioRef.id };
}

module.exports = { redefinirSenhaAcesso, ErroSenhaAcesso };
