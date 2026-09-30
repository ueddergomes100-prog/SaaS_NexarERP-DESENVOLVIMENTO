const express = require('express');
const { admin, db } = require('../config/firebase');
const { onlyDigits } = require('../utils/cnpjLookup');
const { validarPin } = require('../services/vendedorPin');
const { limitadorPublico, limitadorPorChave } = require('../middleware/rateLimit');

const router = express.Router();

/**
 * Login do vendedor de balcao no aplicativo mobile do vendedor externo, com
 * o MESMO codigo + PIN que ele ja usa no balcao -- sem e-mail, sem conta
 * nova (decisao de produto: o vendedor de balcao nao tem login por design,
 * ver src/utils/vendedorCadastroDomain.ts).
 *
 * Rota PUBLICA (sem `authenticate`, diferente de vendedorPin.routes.js):
 * ninguem esta logado ainda quando isto e' chamado. A seguranca fica no
 * proprio `validarPin` (hash scrypt + bloqueio por tentativas, reaproveitado
 * sem alteracao) e nos dois limites abaixo (middleware/rateLimit.js): por IP
 * -- o IP real, resolvido pelo Express com `trust proxy`, nao o cabecalho
 * que o cliente escreve -- e por vendedor (CNPJ + codigo), que vale mesmo
 * que as tentativas venham de muitos IPs.
 *
 * O tenant e' resolvido pelo indice `vendedores_mobile_login/{cnpj}-{codigo}`
 * (Firestore, so' o Admin SDK le -- ver firestore.rules), escrito pelo
 * frontend quando o admin liga "Usa o aplicativo mobile" em VendedoresList.tsx.
 * Isto substitui o token de autenticacao que a rota /validar normal usa pra
 * saber o tenantId de quem chamou.
 */

/** Mesma normalizacao de src/utils/vendedorPinDomain.ts (normalizarCodigoVendedor):
 *  "7" e "07" sao o mesmo vendedor. Precisa bater com a chave que o frontend
 *  grava em vendedores_mobile_login, senao o login nunca acha o indice. */
const CODIGO_DIGITOS = 2;
const normalizarCodigo = (valor) => {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  if (!digitos || digitos.length > CODIGO_DIGITOS) return '';
  return digitos.padStart(CODIGO_DIGITOS, '0');
};

const limitePorIp = limitadorPublico('mobile-login-ip', { limite: 20 });
const limitePorVendedor = limitadorPorChave(
  'mobile-login-vendedor',
  (req) => `${onlyDigits(req.body?.cnpj)}-${normalizarCodigo(req.body?.codigo)}`,
  { limite: 10, mensagem: 'Muitas tentativas de entrar com este vendedor. Aguarde alguns minutos e tente de novo.' },
);

const responderErro = (res, erro, contexto) => {
  if (erro && typeof erro.status === 'number') {
    return res.status(erro.status).json({ error: erro.message });
  }
  console.error(`[VendedorMobileAuth] ${contexto}:`, erro);
  return res.status(500).json({ error: 'Não foi possível concluir a operação. Tente novamente.' });
};

router.post('/mobile-login', limitePorIp, limitePorVendedor, async (req, res) => {
  try {
    if (!db || !admin) {
      const erro = new Error('Backend sem acesso ao Firebase.');
      erro.status = 503;
      throw erro;
    }

    const cnpj = onlyDigits(req.body?.cnpj);
    const codigo = normalizarCodigo(req.body?.codigo);
    if (!cnpj || !codigo) {
      const erro = new Error('Informe o CNPJ da empresa e o código do vendedor.');
      erro.status = 400;
      throw erro;
    }

    const chave = `${cnpj}-${codigo}`;
    const indiceSnap = await db.collection('vendedores_mobile_login').doc(chave).get();
    if (!indiceSnap.exists) {
      const erro = new Error('Empresa ou código não encontrados, ou este vendedor não tem o aplicativo mobile liberado. Confira os dados ou peça pro administrador liberar em Vendedores.');
      erro.status = 404;
      throw erro;
    }

    const { tenantId } = indiceSnap.data();

    // O indice e' gravado pela tela (firestore.rules), entao a chave pode ter
    // sido criada com o CNPJ de OUTRA empresa. Confere que o CNPJ da chave e'
    // o da empresa pra onde ela aponta -- senao responde igual a "nao existe".
    const configSnap = tenantId ? await db.collection('configuracoes').doc(String(tenantId)).get() : null;
    if (!configSnap || !configSnap.exists || onlyDigits(configSnap.data().cnpj) !== cnpj) {
      const erro = new Error('Empresa ou código não encontrados, ou este vendedor não tem o aplicativo mobile liberado. Confira os dados ou peça pro administrador liberar em Vendedores.');
      erro.status = 404;
      throw erro;
    }

    // validarPin ja confere hash, status Ativo e bloqueio por tentativas --
    // reaproveitado sem nenhuma alteracao.
    const identificado = await validarPin({ tenantId, codigo, pin: req.body?.pin });

    // Defesa extra: confere no proprio cadastro que o acesso mobile
    // continua ligado, caso o indice esteja desatualizado.
    const usuarioSnap = await db.collection('usuarios').doc(identificado.vendedorId).get();
    if (!usuarioSnap.exists || usuarioSnap.data().acessoAppMobile !== true) {
      const erro = new Error('Este vendedor não tem o aplicativo mobile liberado. Peça pro administrador liberar em Vendedores.');
      erro.status = 403;
      throw erro;
    }

    // O PIN e' curto (a partir de 2 digitos): nunca pode abrir a conta do
    // dono, de um Admin ou da equipe da plataforma -- so' de funcionario.
    const papel = usuarioSnap.data().role || 'Funcionario';
    if (papel !== 'Funcionario') {
      const erro = new Error('Este cadastro é de administrador e não pode entrar no aplicativo pelo código e senha de vendedor. Entre pelo login normal do sistema.');
      erro.status = 403;
      throw erro;
    }

    const token = await admin.auth().createCustomToken(identificado.vendedorId, { isVendedorBalcao: true });
    return res.json({ token, vendedorNome: identificado.vendedorNome });
  } catch (erro) {
    return responderErro(res, erro, 'mobile-login');
  }
});

module.exports = router;
