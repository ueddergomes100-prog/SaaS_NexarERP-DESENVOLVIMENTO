const crypto = require('crypto');
const { admin, db } = require('../config/firebase');

/**
 * PIN do vendedor -- identificacao na hora da venda.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO VIVE NO BACKEND
 * ---------------------------------------------------------------------------
 *
 * O PIN tem 4 digitos: 10.000 combinacoes. Se o hash fosse legivel pelo
 * navegador, qualquer funcionario com o app aberto quebraria o PIN de todos
 * os colegas em milissegundos. Entao:
 *
 *  - o hash mora em `usuarios_pin/{uid}`, uma colecao que as firestore.rules
 *    negam PARA TODO MUNDO (`allow read, write: if false`). So o Admin SDK,
 *    que ignora as rules, alcanca isso -- ou seja, so este backend;
 *  - a comparacao acontece aqui, com o contador de tentativas do lado de ca,
 *    onde o cliente nao tem como zerar.
 *
 * O codigo do vendedor (2 digitos) NAO e' segredo -- fica em
 * `usuarios/{uid}.codigoVendedor`, visivel na tela de usuarios. Toda a
 * seguranca esta no PIN + no bloqueio por tentativas.
 */

const COLECAO_PIN = 'usuarios_pin';
const PIN_DIGITOS = 4;
const CODIGO_DIGITOS = 2;

/** Tentativas erradas antes de bloquear, e por quanto tempo. */
const MAX_TENTATIVAS = 5;
const BLOQUEIO_MINUTOS = 5;

/** Parametros do scrypt. Custo alto o suficiente pra tornar forca bruta cara
 *  mesmo com 10.000 combinacoes, e baixo o suficiente pra nao pesar numa
 *  venda de balcao (o popup roda a cada venda). */
const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };

const scrypt = (pin, salt) => new Promise((resolve, reject) => {
  crypto.scrypt(pin, salt, SCRYPT_KEYLEN, SCRYPT_OPTS, (err, chave) => {
    if (err) reject(err);
    else resolve(chave.toString('hex'));
  });
});

const normalizarCodigo = (valor) => {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  if (!digitos || digitos.length > CODIGO_DIGITOS) return '';
  return digitos.padStart(CODIGO_DIGITOS, '0');
};

const isPinValido = (valor) => new RegExp(`^\\d{${PIN_DIGITOS}}$`).test(String(valor ?? ''));

/** Erro com status HTTP, pra rota so repassar. */
class ErroPin extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

/**
 * Grava (ou substitui) o PIN de um usuario. Usado tanto pra definir a
 * primeira vez quanto pra RESETAR quando o funcionario esquece -- que hoje
 * nao tem solucao nenhuma no sistema: sem isto, quem esquece a senha fica
 * travado pra sempre, porque nao existe reset e recriar o usuario esbarra na
 * conta orfa que sobra no Firebase Auth.
 */
async function definirPin({ tenantId, usuarioId, pin, autorId }) {
  if (!db) throw new ErroPin(503, 'Backend sem acesso ao banco de dados.');
  if (!isPinValido(pin)) {
    throw new ErroPin(400, `A senha do vendedor deve ter ${PIN_DIGITOS} dígitos numéricos.`);
  }

  const usuarioRef = db.collection('usuarios').doc(String(usuarioId || ''));
  const usuarioSnap = await usuarioRef.get();
  if (!usuarioSnap.exists) {
    throw new ErroPin(404, 'Usuário não encontrado.');
  }

  const usuario = usuarioSnap.data();
  // Trava de tenant: um admin so mexe em usuario da propria empresa.
  if (usuario.tenantId !== tenantId) {
    throw new ErroPin(403, 'Este usuário não pertence à sua empresa.');
  }

  const codigo = normalizarCodigo(usuario.codigoVendedor);
  if (!codigo) {
    throw new ErroPin(400, 'Este usuário ainda não tem código de vendedor. Cadastre o código antes de definir a senha.');
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const pinHash = await scrypt(String(pin), salt);

  await db.collection(COLECAO_PIN).doc(usuarioRef.id).set({
    tenantId,
    pinHash,
    pinSalt: salt,
    // Zera qualquer bloqueio: definir senha nova destrava o funcionario.
    tentativasFalhas: 0,
    bloqueadoAte: null,
    definidoPor: autorId || null,
    definidoEm: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { usuarioId: usuarioRef.id, codigo };
}

async function removerPin({ tenantId, usuarioId }) {
  if (!db) throw new ErroPin(503, 'Backend sem acesso ao banco de dados.');

  const pinRef = db.collection(COLECAO_PIN).doc(String(usuarioId || ''));
  const snap = await pinRef.get();
  if (!snap.exists) return { removido: false };
  if (snap.data().tenantId !== tenantId) {
    throw new ErroPin(403, 'Este usuário não pertence à sua empresa.');
  }

  await pinRef.delete();
  return { removido: true };
}

/**
 * Valida codigo + PIN e devolve quem e' o vendedor.
 *
 * O `tenantId` vem SEMPRE do token de quem chamou (a estacao logada), nunca
 * do corpo da requisicao -- assim uma estacao nao consegue validar vendedor
 * de outra empresa nem por engano nem de proposito.
 */
async function validarPin({ tenantId, codigo, pin }) {
  if (!db) throw new ErroPin(503, 'Backend sem acesso ao banco de dados.');

  const codigoNormalizado = normalizarCodigo(codigo);
  if (!codigoNormalizado || !isPinValido(pin)) {
    // Formato errado morre aqui, sem tocar no banco.
    throw new ErroPin(400, 'Código ou senha inválidos.');
  }

  // Duas igualdades: o Firestore resolve com os indices de campo unico, sem
  // precisar de indice composto. `limit(2)` e' pra detectar codigo duplicado.
  const consulta = await db.collection('usuarios')
    .where('tenantId', '==', tenantId)
    .where('codigoVendedor', '==', codigoNormalizado)
    .limit(2)
    .get();

  if (consulta.empty) {
    throw new ErroPin(401, 'Código ou senha inválidos.');
  }
  if (consulta.size > 1) {
    // Nao escolhe um "provavel": dois vendedores com o mesmo codigo
    // carimbariam venda e comissao na pessoa errada.
    throw new ErroPin(409, `Existe mais de um vendedor com o código ${codigoNormalizado}. Corrija o cadastro em Usuários antes de continuar.`);
  }

  const usuarioDoc = consulta.docs[0];
  const usuario = usuarioDoc.data();

  if (usuario.status && usuario.status !== 'Ativo') {
    throw new ErroPin(403, 'Este vendedor está inativo e não pode registrar vendas.');
  }

  const pinRef = db.collection(COLECAO_PIN).doc(usuarioDoc.id);
  const pinSnap = await pinRef.get();
  if (!pinSnap.exists) {
    // Mensagem distinta de propósito: o codigo do vendedor e' publico (todo
    // mundo ve o do colega), entao nao ha segredo a proteger aqui -- e sem
    // essa distincao o balcao ficaria travado sem saber o que fazer.
    throw new ErroPin(409, 'Este vendedor ainda não tem senha cadastrada. Peça ao responsável para cadastrar em Usuários.');
  }

  const dadosPin = pinSnap.data();
  const agora = Date.now();
  const bloqueadoAte = dadosPin.bloqueadoAte ? dadosPin.bloqueadoAte.toMillis() : 0;

  if (bloqueadoAte > agora) {
    const faltamSegundos = Math.ceil((bloqueadoAte - agora) / 1000);
    const faltamMinutos = Math.ceil(faltamSegundos / 60);
    throw new ErroPin(429, `Muitas tentativas erradas. Este vendedor está bloqueado por mais ${faltamMinutos} minuto(s). O responsável pode cadastrar uma senha nova em Usuários para liberar na hora.`);
  }

  const hashInformado = await scrypt(String(pin), dadosPin.pinSalt);
  const confere = crypto.timingSafeEqual(
    Buffer.from(hashInformado, 'hex'),
    Buffer.from(String(dadosPin.pinHash), 'hex'),
  );

  if (!confere) {
    const tentativas = Number(dadosPin.tentativasFalhas || 0) + 1;
    const vaiBloquear = tentativas >= MAX_TENTATIVAS;
    await pinRef.update({
      tentativasFalhas: vaiBloquear ? 0 : tentativas,
      bloqueadoAte: vaiBloquear
        ? admin.firestore.Timestamp.fromMillis(agora + BLOQUEIO_MINUTOS * 60 * 1000)
        : null,
    });

    if (vaiBloquear) {
      throw new ErroPin(429, `Senha incorreta ${MAX_TENTATIVAS} vezes. Este vendedor ficou bloqueado por ${BLOQUEIO_MINUTOS} minutos. O responsável pode cadastrar uma senha nova em Usuários para liberar na hora.`);
    }

    const restantes = MAX_TENTATIVAS - tentativas;
    throw new ErroPin(401, `Código ou senha inválidos. Mais ${restantes} tentativa(s) antes de bloquear este vendedor.`);
  }

  await pinRef.update({
    tentativasFalhas: 0,
    bloqueadoAte: null,
    ultimaValidacaoEm: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    vendedorId: usuarioDoc.id,
    vendedorNome: usuario.nome || usuario.nomeResponsavel || usuario.email || 'Vendedor',
    codigo: codigoNormalizado,
  };
}

module.exports = { definirPin, removerPin, validarPin, ErroPin, MAX_TENTATIVAS, BLOQUEIO_MINUTOS };
