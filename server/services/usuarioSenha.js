const { auth, db } = require('../config/firebase');

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

  if (!usuario.email) {
    throw new ErroSenhaAcesso(400, 'Este cadastro não tem login no sistema (é um vendedor sem acesso, cadastrado em Cadastros Auxiliares → Vendedores). Não há senha de acesso para redefinir.');
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
