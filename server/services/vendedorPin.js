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
 *  (PIN_VENDEDOR_MIN_DIGITOS / PIN_VENDEDOR_MAX_DIGITOS / PIN_DIGITADO_MIN_DIGITOS):
 *  a tela avisa cedo, mas quem decide e' esta validacao.
 *
 * Seguranca, bloco B (25/11/2026, decisao do dono): PIN NOVO so' com 4 digitos
 * ou mais. O PIN curto de antes (2 ou 3 digitos) continua valendo SO' no balcao
 * e na liberacao de desconto, onde ja' ha' alguem logado; nas entradas sem
 * login (app Vendas, computador ativado) so' vale 4 ou mais. */
const PIN_MIN_DIGITOS = 2;
const PIN_MIN_DIGITOS_NOVO = 4;
const PIN_MAX_DIGITOS = 10;
const CODIGO_DIGITOS = 2;

/**
 * CANAIS (bloco B, 25/11/2026): cada canal conta as tentativas erradas
 * separado. Antes era um contador so': 5 erros pela internet (app, rota
 * publica) travavam o vendedor tambem no balcao -- qualquer um com o CNPJ da
 * loja tirava um vendedor do ar. `minimo` = menor PIN aceito ali.
 */
const CANAIS = {
  balcao: { minimo: PIN_MIN_DIGITOS, publico: false },
  desconto: { minimo: PIN_MIN_DIGITOS, publico: false },
  app: { minimo: PIN_MIN_DIGITOS_NOVO, publico: true },
  terminal: { minimo: PIN_MIN_DIGITOS_NOVO, publico: true },
};

/** Mensagem UNICA para codigo que nao existe, vendedor sem senha e senha errada
 *  (bloco B): a resposta nao ajuda a descobrir codigo nem quantas tentativas
 *  restam, e ainda diz o que fazer. */
const MENSAGEM_CODIGO_OU_SENHA = 'Código ou senha inválidos. Confira os dois; se esqueceu a senha ou ainda não tem uma, peça ao responsável para cadastrar em Usuários.';

/** Depois de 24 h sem errar, o bloqueio volta ao comeco (5 minutos). */
const ESQUECER_BLOQUEIOS_MS = 24 * 60 * 60 * 1000;

/** Tentativas erradas antes de bloquear, e por quanto tempo (o PRIMEIRO
 *  bloqueio; os seguintes dobram -- ver duracaoDoBloqueioMinutos). */
const MAX_TENTATIVAS = 5;
const BLOQUEIO_MINUTOS = 5;
const BLOQUEIO_MAXIMO_MINUTOS = 24 * 60;

/**
 * Bloqueio progressivo (auditoria de 2026-09-29): cada bloqueio seguido DOBRA
 * o tempo -- 5, 10, 20, 40 minutos... ate 24 horas. Com o bloqueio fixo de 5
 * minutos, quem tentasse senhas no automatico pelo login do aplicativo (rota
 * publica, so' precisa do CNPJ e do codigo) acertava um PIN de 4 digitos em
 * poucos dias e um de 2 digitos em menos de 2 horas.
 *
 * Bloco B (25/11/2026): nas entradas SEM login (app e computador do caixa),
 * ACERTAR a senha zera so' os erros da rodada, NAO a escada de bloqueios --
 * antes o acerto do vendedor de verdade devolvia o bloqueio aos 5 minutos e o
 * atacante recomecava do zero. Ali a escada so' volta ao comeco depois de 24 h
 * sem nenhum erro, ou quando o responsavel cadastra uma senha nova. No balcao e
 * na liberacao de desconto (ja' ha' alguem logado), o acerto zera tudo, como
 * antes (revisao de 25/11: quem erra um pouco todo dia nao fica com bloqueios
 * cada vez maiores).
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

  // 24 h sem errar: a rodada e a escada de bloqueios recomecam.
  const ultimaFalhaMs = Number(dados?.ultimaFalhaMs || 0);
  const esquecer = ultimaFalhaMs > 0 && agoraMs - ultimaFalhaMs > ESQUECER_BLOQUEIOS_MS;
  const tentativa = (esquecer ? 0 : Number(dados?.tentativasFalhas || 0)) + 1;
  const bloqueiosSeguidos = esquecer ? 0 : Math.max(0, Math.floor(Number(dados?.bloqueiosSeguidos || 0)));
  if (tentativa >= MAX_TENTATIVAS) {
    const minutosDeBloqueio = duracaoDoBloqueioMinutos(bloqueiosSeguidos);
    return {
      permitida: true,
      tentativa,
      bloqueiaSeErrar: true,
      minutosDeBloqueio,
      seErrar: { tentativasFalhas: 0, bloqueadoAteMs: agoraMs + minutosDeBloqueio * 60 * 1000, bloqueiosSeguidos: bloqueiosSeguidos + 1, ultimaFalhaMs: agoraMs },
    };
  }
  return {
    permitida: true,
    tentativa,
    bloqueiaSeErrar: false,
    seErrar: { tentativasFalhas: tentativa, bloqueadoAteMs: null, bloqueiosSeguidos, ultimaFalhaMs: agoraMs },
  };
};

/** Como o registro do canal fica quando a senha CONFERE: zera a rodada, mantem a escada. */
const depoisDoAcerto = (dados) => ({
  tentativasFalhas: 0,
  bloqueadoAteMs: null,
  bloqueiosSeguidos: Math.max(0, Math.floor(Number(dados?.bloqueiosSeguidos || 0))),
  ultimaFalhaMs: Number(dados?.ultimaFalhaMs || 0) || null,
});

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
const isPinNovoValido = (valor) => new RegExp(`^\\d{${PIN_MIN_DIGITOS_NOVO},${PIN_MAX_DIGITOS}}$`).test(String(valor ?? ''));

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
async function definirPin({ tenantId, usuarioId, pin, autorId, restrito = false }) {
  if (!db) throw new ErroPin(503, 'Backend sem acesso ao banco de dados.');
  if (!isPinNovoValido(pin)) {
    throw new ErroPin(400, `A senha do vendedor deve ter de ${PIN_MIN_DIGITOS_NOVO} a ${PIN_MAX_DIGITOS} dígitos numéricos.`);
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
  // Sem ser dono/administrador (permissao "incluir e alterar vendedor"): so' vendedor de
  // balcao comum. Quem soubesse a senha de quem libera desconto ou entra no app
  // aprovaria o proprio desconto / entraria no app como ele.
  if (restrito && (
    usuario.tipoRegistro !== 'vendedor'
    || (Array.isArray(usuario.permissoes) && usuario.permissoes.length > 0)
    || usuario.acessoAppMobile === true
  )) {
    throw new ErroPin(403, 'Este cadastro libera desconto, usa o aplicativo ou é um login do sistema: só o dono ou o administrador da empresa define a senha.');
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
    // Zera qualquer bloqueio, em todos os canais: definir senha nova destrava o funcionario.
    canais: {},
    definidoPor: autorId || null,
    definidoEm: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Espelha no cadastro um carimbo de "ja tem senha" -- NAO a senha, nem o
  // hash dela. Sem isto a tela de Vendedores nao tem como saber quem ainda
  // esta sem senha (a colecao do PIN e' negada pra todo mundo nas rules), e
  // o vendedor so descobriria isso no balcao, com cliente na frente.
  await usuarioRef.update({
    pinDefinidoEm: admin.firestore.FieldValue.serverTimestamp(),
    // Senha nova tem 4 digitos ou mais: o aviso de "senha curta" sai.
    pinCurto: admin.firestore.FieldValue.delete(),
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
    pinCurto: admin.firestore.FieldValue.delete(),
  }).catch(() => {
    // Usuario ja excluido: o PIN sumiu, que era o que importava.
  });

  return { removido: true };
}

/** Registro de tentativas de UM canal, do jeito que reservarTentativa le. */
const lerCanal = (dadosPin, canal) => {
  const c = (dadosPin && dadosPin.canais && dadosPin.canais[canal]) || {};
  const ms = (v) => {
    if (v && typeof v.toMillis === 'function') return v.toMillis();
    if (v instanceof Date) return v.getTime();
    return Number(v || 0);
  };
  return {
    tentativasFalhas: c.tentativasFalhas,
    bloqueiosSeguidos: c.bloqueiosSeguidos,
    bloqueadoAteMs: ms(c.bloqueadoAte),
    ultimaFalhaMs: ms(c.ultimaFalhaEm),
  };
};

/** O registro do canal como vai para o banco (datas como Timestamp, nunca undefined). */
const gravarCanal = (registro) => ({
  tentativasFalhas: Number(registro.tentativasFalhas || 0),
  bloqueiosSeguidos: Number(registro.bloqueiosSeguidos || 0),
  bloqueadoAte: registro.bloqueadoAteMs ? admin.firestore.Timestamp.fromMillis(registro.bloqueadoAteMs) : null,
  ultimaFalhaEm: registro.ultimaFalhaMs ? admin.firestore.Timestamp.fromMillis(registro.ultimaFalhaMs) : null,
});

/** Senha digitada menor que o minimo do canal: diz o que fazer, sem tocar no banco. */
const mensagemSenhaCurta = (canal) => {
  const onde = canal === 'app' ? 'no aplicativo' : 'no computador do caixa';
  return `Senhas com menos de ${PIN_MIN_DIGITOS_NOVO} dígitos não valem ${onde}. Peça ao responsável uma senha nova de ${PIN_MIN_DIGITOS_NOVO} dígitos ou mais, em Usuários.`;
};

/**
 * Valida codigo + PIN e devolve quem e' o vendedor.
 *
 * O `tenantId` vem SEMPRE do token de quem chamou (a estacao logada), nunca
 * do corpo da requisicao -- assim uma estacao nao consegue validar vendedor
 * de outra empresa nem por engano nem de proposito.
 *
 * `canal` (bloco B, 25/11/2026): 'balcao' (identificar a venda, logado),
 * 'desconto' (liberar desconto, logado), 'app' (login do app Vendas, publico)
 * ou 'terminal' (computador ativado, publico). Cada canal tem o proprio
 * contador de erros e o proprio tamanho minimo de senha (CANAIS).
 */
async function validarPin({ tenantId, codigo, pin, canal = 'balcao' }) {
  if (!db) throw new ErroPin(503, 'Backend sem acesso ao banco de dados.');
  const regras = CANAIS[canal];
  if (!regras) throw new Error(`canal de PIN desconhecido: ${canal}`);

  const codigoNormalizado = normalizarCodigo(codigo);
  if (!codigoNormalizado || !isPinValido(pin)) {
    // Formato errado morre aqui, sem tocar no banco.
    throw new ErroPin(400, MENSAGEM_CODIGO_OU_SENHA);
  }
  if (String(pin).length < regras.minimo) {
    throw new ErroPin(400, mensagemSenhaCurta(canal));
  }

  // Duas igualdades: o Firestore resolve com os indices de campo unico, sem
  // precisar de indice composto. `limit(2)` e' pra detectar codigo duplicado.
  const consulta = await db.collection('usuarios')
    .where('tenantId', '==', tenantId)
    .where('codigoVendedor', '==', codigoNormalizado)
    .limit(2)
    .get();

  if (consulta.empty) {
    throw new ErroPin(401, MENSAGEM_CODIGO_OU_SENHA);
  }
  if (consulta.size > 1) {
    // Nao escolhe um "provavel": dois vendedores com o mesmo codigo
    // carimbariam venda e comissao na pessoa errada.
    throw new ErroPin(409, `Existe mais de um vendedor com o código ${codigoNormalizado}. Corrija o cadastro em Usuários antes de continuar.`);
  }

  const usuarioDoc = consulta.docs[0];
  const usuario = usuarioDoc.data();
  const pinRef = db.collection(COLECAO_PIN).doc(usuarioDoc.id);

  // Conta a tentativa (como se fosse errar) ANTES de conferir a senha -- ver
  // reservarTentativa. A transacao serializa tentativas simultaneas: cada uma
  // enxerga a contagem da anterior, entao nao passam mais de MAX_TENTATIVAS.
  const reserva = await db.runTransaction(async (tx) => {
    const pinSnap = await tx.get(pinRef);
    if (!pinSnap.exists) {
      // Sem senha cadastrada: mesma resposta de senha errada (bloco B). A
      // mensagem ja' diz para pedir a senha ao responsavel.
      throw new ErroPin(401, MENSAGEM_CODIGO_OU_SENHA);
    }

    const dadosPin = pinSnap.data();
    const registro = lerCanal(dadosPin, canal);
    const decisao = reservarTentativa(registro, Date.now());

    if (!decisao.permitida) {
      throw new ErroPin(429, `Muitas tentativas erradas. Este vendedor está bloqueado por mais ${formatarDuracao(decisao.faltamMinutos)}. O responsável pode cadastrar uma senha nova em Usuários para liberar na hora.`);
    }

    tx.update(pinRef, { [`canais.${canal}`]: gravarCanal(decisao.seErrar) });
    return { ...decisao, registro, pinHash: dadosPin.pinHash, pinSalt: dadosPin.pinSalt };
  });

  const hashInformado = await scrypt(String(pin), reserva.pinSalt);
  const confere = crypto.timingSafeEqual(
    Buffer.from(hashInformado, 'hex'),
    Buffer.from(String(reserva.pinHash), 'hex'),
  );

  if (!confere) {
    // O erro ja' ficou gravado na reserva -- aqui so' se explica. Sem dizer
    // quantas tentativas restam (bloco B).
    if (reserva.bloqueiaSeErrar) {
      throw new ErroPin(429, `Muitas tentativas erradas. Este vendedor ficou bloqueado por ${formatarDuracao(reserva.minutosDeBloqueio)}. O responsável pode cadastrar uma senha nova em Usuários para liberar na hora.`);
    }
    throw new ErroPin(401, MENSAGEM_CODIGO_OU_SENHA);
  }

  // Acertou: desfaz a tentativa reservada. Na entrada sem login a escada de
  // bloqueios fica (depoisDoAcerto); com alguem logado, zera tudo.
  const depois = regras.publico
    ? depoisDoAcerto(reserva.registro)
    : { tentativasFalhas: 0, bloqueadoAteMs: null, bloqueiosSeguidos: 0, ultimaFalhaMs: null };
  await pinRef.update({
    [`canais.${canal}`]: gravarCanal(depois),
    ultimaValidacaoEm: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Situacao so' depois da senha certa: quem nao sabe a senha nao descobre
  // que o cadastro existe e esta' inativo.
  if (usuario.status && usuario.status !== 'Ativo') {
    throw new ErroPin(403, 'Este vendedor está inativo e não pode registrar vendas.');
  }

  // Aviso na tela de Usuarios (bloco B): quem ainda usa senha de 2 ou 3 digitos
  // precisa de uma nova. So' o "sim/nao" vai para o cadastro, nunca a senha.
  const curto = String(pin).length < PIN_MIN_DIGITOS_NOVO;
  if (curto !== (usuario.pinCurto === true)) {
    await db.collection('usuarios').doc(usuarioDoc.id)
      .update({ pinCurto: curto ? true : admin.firestore.FieldValue.delete() })
      .catch((erro) => console.warn('[VendedorPin] nao foi possivel marcar a senha curta:', erro.message));
  }

  return {
    vendedorId: usuarioDoc.id,
    vendedorNome: usuario.nome || usuario.nomeResponsavel || usuario.email || 'Vendedor',
    codigo: codigoNormalizado,
    digitos: String(pin).length,
  };
}

module.exports = {
  definirPin,
  removerPin,
  validarPin,
  ErroPin,
  MAX_TENTATIVAS,
  BLOQUEIO_MINUTOS,
  PIN_MIN_DIGITOS_NOVO,
  MENSAGEM_CODIGO_OU_SENHA,
  CANAIS,
  // expostos pros testes
  reservarTentativa,
  depoisDoAcerto,
  duracaoDoBloqueioMinutos,
  formatarDuracao,
  normalizarCodigo,
};
