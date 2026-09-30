const crypto = require('crypto');
const { admin, db } = require('../config/firebase');

/**
 * PIN do vendedor -- identificacao na hora da venda.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO VIVE NO BACKEND
 * ---------------------------------------------------------------------------
 *
 * O PIN e' curto (de 2 a 10 digitos -- 100 combinacoes no menor deles). Se o
 * hash fosse legivel pelo navegador, qualquer funcionario com o app aberto
 * quebraria o PIN de todos os colegas em milissegundos. Entao:
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
/** Faixa de tamanho do PIN. Tem que bater com src/utils/vendedorPinDomain.ts
 *  (PIN_VENDEDOR_MIN_DIGITOS / PIN_VENDEDOR_MAX_DIGITOS): a tela avisa cedo,
 *  mas quem decide e' esta validacao. */
const PIN_MIN_DIGITOS = 2;
const PIN_MAX_DIGITOS = 10;
const CODIGO_DIGITOS = 2;

/** Tentativas erradas antes de bloquear, e por quanto tempo (o PRIMEIRO
 *  bloqueio; os seguintes dobram -- ver duracaoDoBloqueioMinutos). */
const MAX_TENTATIVAS = 5;
const BLOQUEIO_MINUTOS = 5;
const BLOQUEIO_MAXIMO_MINUTOS = 24 * 60;

/**
 * Bloqueio progressivo (auditoria de 2026-09-29): cada bloqueio seguido, sem
 * um acerto no meio, DOBRA o tempo -- 5, 10, 20, 40 minutos... ate 24 horas.
 * Com o bloqueio fixo de 5 minutos, quem tentasse senhas no automatico pelo
 * login do aplicativo (rota publica, so' precisa do CNPJ e do codigo) acertava
 * um PIN de 4 digitos em poucos dias e um de 2 digitos em menos de 2 horas.
 * Acertar a senha, ou o responsavel cadastrar uma senha nova, zera a contagem.
 */
const duracaoDoBloqueioMinutos = (bloqueiosSeguidos) => Math.min(
  BLOQUEIO_MINUTOS * (2 ** Math.max(0, Math.floor(Number(bloqueiosSeguidos) || 0))),
  BLOQUEIO_MAXIMO_MINUTOS,
);

/** "5 minutos", "1 hora", "2h40min" -- pra mensagem de bloqueio. */
const formatarDuracao = (minutos) => {
  const total = Math.max(1, Math.ceil(Number(minutos) || 0));
  if (total < 60) return `${total} minuto${total === 1 ? '' : 's'}`;
  const horas = Math.floor(total / 60);
  const resto = total % 60;
  if (resto === 0) return `${horas} hora${horas === 1 ? '' : 's'}`;
  return `${horas}h${String(resto).padStart(2, '0')}min`;
};

/**
 * Decide, a partir do que esta' gravado no PIN, se a tentativa pode ser feita
 * e como o registro fica se ela ERRAR. Funcao pura (testada em
 * tests/vendedorPin.test.js).
 *
 * A tentativa e' contada ANTES de conferir a senha, dentro de uma transacao
 * (ver validarPin), e desfeita se acertar. Antes disto a conta era feita
 * DEPOIS de conferir: 100 pedidos simultaneos liam "0 erros" todos juntos e
 * testavam 100 senhas antes do primeiro bloqueio ser gravado.
 */
const reservarTentativa = (dados, agoraMs) => {
  const bloqueadoAteMs = Number(dados?.bloqueadoAteMs || 0);
  if (bloqueadoAteMs > agoraMs) {
    return { permitida: false, faltamMinutos: Math.ceil((bloqueadoAteMs - agoraMs) / 60000) };
  }

  const tentativa = Number(dados?.tentativasFalhas || 0) + 1;
  const bloqueiosSeguidos = Math.max(0, Math.floor(Number(dados?.bloqueiosSeguidos || 0)));
  if (tentativa >= MAX_TENTATIVAS) {
    const minutosDeBloqueio = duracaoDoBloqueioMinutos(bloqueiosSeguidos);
    return {
      permitida: true,
      tentativa,
      bloqueiaSeErrar: true,
      minutosDeBloqueio,
      seErrar: { tentativasFalhas: 0, bloqueadoAteMs: agoraMs + minutosDeBloqueio * 60 * 1000, bloqueiosSeguidos: bloqueiosSeguidos + 1 },
    };
  }
  return {
    permitida: true,
    tentativa,
    bloqueiaSeErrar: false,
    seErrar: { tentativasFalhas: tentativa, bloqueadoAteMs: null, bloqueiosSeguidos },
  };
};

/** Parametros do scrypt. Custo alto o suficiente pra tornar forca bruta cara
 *  mesmo com poucas combinacoes possiveis, e baixo o suficiente pra nao pesar
 *  numa venda de balcao (o popup roda a cada venda). */
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

const isPinValido = (valor) => new RegExp(`^\\d{${PIN_MIN_DIGITOS},${PIN_MAX_DIGITOS}}$`).test(String(valor ?? ''));

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
    throw new ErroPin(400, `A senha do vendedor deve ter de ${PIN_MIN_DIGITOS} a ${PIN_MAX_DIGITOS} dígitos numéricos.`);
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
    bloqueiosSeguidos: 0,
    definidoPor: autorId || null,
    definidoEm: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Espelha no cadastro um carimbo de "ja tem senha" -- NAO a senha, nem o
  // hash dela. Sem isto a tela de Vendedores nao tem como saber quem ainda
  // esta sem senha (a colecao do PIN e' negada pra todo mundo nas rules), e
  // o vendedor so descobriria isso no balcao, com cliente na frente.
  await usuarioRef.update({
    pinDefinidoEm: admin.firestore.FieldValue.serverTimestamp(),
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

  // Tira o carimbo junto -- deixar "senha cadastrada" numa pessoa que nao
  // tem mais senha e' pior que nao mostrar nada.
  await db.collection('usuarios').doc(String(usuarioId)).update({
    pinDefinidoEm: admin.firestore.FieldValue.delete(),
  }).catch(() => {
    // Usuario ja excluido: o PIN sumiu, que era o que importava.
  });

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

  // Conta a tentativa (como se fosse errar) ANTES de conferir a senha -- ver
  // reservarTentativa. A transacao serializa tentativas simultaneas: cada uma
  // enxerga a contagem da anterior, entao nao passam mais de MAX_TENTATIVAS.
  const reserva = await db.runTransaction(async (tx) => {
    const pinSnap = await tx.get(pinRef);
    if (!pinSnap.exists) {
      // Mensagem distinta de propósito: o codigo do vendedor e' publico (todo
      // mundo ve o do colega), entao nao ha segredo a proteger aqui -- e sem
      // essa distincao o balcao ficaria travado sem saber o que fazer.
      throw new ErroPin(409, 'Este vendedor ainda não tem senha cadastrada. Peça ao responsável para cadastrar em Usuários.');
    }

    const dadosPin = pinSnap.data();
    const decisao = reservarTentativa({
      tentativasFalhas: dadosPin.tentativasFalhas,
      bloqueiosSeguidos: dadosPin.bloqueiosSeguidos,
      bloqueadoAteMs: dadosPin.bloqueadoAte ? dadosPin.bloqueadoAte.toMillis() : 0,
    }, Date.now());

    if (!decisao.permitida) {
      throw new ErroPin(429, `Muitas tentativas erradas. Este vendedor está bloqueado por mais ${formatarDuracao(decisao.faltamMinutos)}. O responsável pode cadastrar uma senha nova em Usuários para liberar na hora.`);
    }

    tx.update(pinRef, {
      tentativasFalhas: decisao.seErrar.tentativasFalhas,
      bloqueadoAte: decisao.seErrar.bloqueadoAteMs
        ? admin.firestore.Timestamp.fromMillis(decisao.seErrar.bloqueadoAteMs)
        : null,
      bloqueiosSeguidos: decisao.seErrar.bloqueiosSeguidos,
    });
    return { ...decisao, pinHash: dadosPin.pinHash, pinSalt: dadosPin.pinSalt };
  });

  const hashInformado = await scrypt(String(pin), reserva.pinSalt);
  const confere = crypto.timingSafeEqual(
    Buffer.from(hashInformado, 'hex'),
    Buffer.from(String(reserva.pinHash), 'hex'),
  );

  if (!confere) {
    // O erro ja' ficou gravado na reserva -- aqui so' se explica.
    if (reserva.bloqueiaSeErrar) {
      throw new ErroPin(429, `Senha incorreta ${MAX_TENTATIVAS} vezes. Este vendedor ficou bloqueado por ${formatarDuracao(reserva.minutosDeBloqueio)}. O responsável pode cadastrar uma senha nova em Usuários para liberar na hora.`);
    }

    const restantes = MAX_TENTATIVAS - reserva.tentativa;
    throw new ErroPin(401, `Código ou senha inválidos. Mais ${restantes} tentativa(s) antes de bloquear este vendedor.`);
  }

  // Acertou: desfaz a tentativa reservada (e qualquer bloqueio que ela armou).
  await pinRef.update({
    tentativasFalhas: 0,
    bloqueadoAte: null,
    bloqueiosSeguidos: 0,
    ultimaValidacaoEm: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    vendedorId: usuarioDoc.id,
    vendedorNome: usuario.nome || usuario.nomeResponsavel || usuario.email || 'Vendedor',
    codigo: codigoNormalizado,
  };
}

module.exports = {
  definirPin,
  removerPin,
  validarPin,
  ErroPin,
  MAX_TENTATIVAS,
  BLOQUEIO_MINUTOS,
  // expostos pros testes
  reservarTentativa,
  duracaoDoBloqueioMinutos,
  formatarDuracao,
};
