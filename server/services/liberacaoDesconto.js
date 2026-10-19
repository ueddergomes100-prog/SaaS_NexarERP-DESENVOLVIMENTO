/*
 * LIBERACAO DE DESCONTO PELO SERVIDOR (19/10/2026, decisao do dono: o
 * servidor confere tudo).
 *
 * Desconto acima do limite no modo "senha": a tela pede a senha (ou o PIN) de
 * quem pode liberar e manda aqui. O servidor confere:
 *  - login: a sessao do aprovador, aberta AGORA com a senha dele (o token do
 *    Firebase so' existe com a senha certa; sessao com mais de 5 minutos nao vale);
 *  - vendedor de balcao: codigo + PIN, com o mesmo limite de tentativas da
 *    identificacao (services/vendedorPin.js);
 *  - que o aprovador e' desta empresa, esta ativo e pode liberar desconto.
 * Devolve um comprovante que vale 30 minutos, para esta tela e este valor;
 * o Finalizar (venda, PDV, OS) gasta o comprovante. Ver
 * src/utils/conferenciaDescontoDomain.ts.
 */
const { admin, db } = require('../config/firebase');
const cd = require('../domain/conferenciaDescontoDomain');
const { validarPin } = require('./vendedorPin');
const { emitirComprovante } = require('./comprovantes');

class ErroLiberacao extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const liberarDesconto = async ({ user, tenantId, corpo }) => {
  const lido = cd.lerPedidoDeLiberacao(corpo);
  if ('erro' in lido) throw new ErroLiberacao(400, lido.erro);
  const { tela, baseCentavos, descontoCentavos, aprovador } = lido.pedido;

  let aprovadorId;
  if (aprovador.tipo === 'login') {
    let token;
    try {
      token = await admin.auth().verifyIdToken(aprovador.idToken);
    } catch {
      throw new ErroLiberacao(401, 'Não foi possível confirmar a senha do aprovador. Digite a senha de novo.');
    }
    const idadeDoLogin = Math.floor(Date.now() / 1000) - Number(token.auth_time || 0);
    if (!(idadeDoLogin >= -60 && idadeDoLogin <= cd.IDADE_MAXIMA_DO_LOGIN_DO_APROVADOR_S)) {
      throw new ErroLiberacao(401, 'A senha do aprovador precisa ser digitada agora. Digite a senha de novo.');
    }
    aprovadorId = token.uid;
  } else {
    // Erra o PIN = conta tentativa e pode bloquear, como na identificacao.
    aprovadorId = (await validarPin({ tenantId, codigo: aprovador.codigo, pin: aprovador.pin })).vendedorId;
  }

  const snap = await db.collection('usuarios').doc(aprovadorId).get();
  const registro = snap.exists ? snap.data() : null;
  if (!registro || registro.tenantId !== tenantId) {
    throw new ErroLiberacao(403, 'Este aprovador não é desta empresa. Escolha outro responsável.');
  }
  const nome = String(registro.nome || registro.nomeResponsavel || registro.email || 'Responsável');
  if (registro.status && registro.status !== 'Ativo') {
    throw new ErroLiberacao(403, `${nome} está inativo e não pode liberar desconto. Escolha outro responsável.`);
  }
  if (!cd.podeLiberarDesconto(registro, aprovadorId, tenantId)) {
    throw new ErroLiberacao(403, `${nome} não tem a permissão "Liberar desconto". Escolha outro responsável ou peça ao administrador para dar essa permissão.`);
  }

  const comprovante = await emitirComprovante({
    tenantId,
    emitidoPara: user.uid,
    tipo: cd.TIPO_LIBERACAO,
    pessoaId: aprovadorId,
    pessoaNome: nome,
    dados: { tela, baseCentavos, descontoCentavos },
  });
  return { ...comprovante, aprovadoPorId: aprovadorId, aprovadoPorNome: nome, tela };
};

module.exports = { ErroLiberacao, liberarDesconto };
