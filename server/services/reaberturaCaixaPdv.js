const { admin, db } = require('../config/firebase');
const { getDateInputInTimeZone } = require('../domain/dateTime');
const { registrarLogNaTransacao } = require('./auditoria');
const { podeEmVendas } = require('./permissoesVendas');
const { PERMISSAO_VENDAS: PV } = require('../domain/permissoesNovasDomain');

/*
 * REABRIR O CAIXA (27/11/2026, pedido do dono): "so' funciona no dia -- virou o
 * outro dia abre o caixa normal". Quem fechou o caixa por engano (ou precisa
 * vender mais) reabre o MESMO caixa e fecha de novo depois; o fechamento
 * desfeito fica guardado em `reaberturas` e no Historico de alteracoes.
 *
 * Regras (conferidas aqui, nao so' na tela):
 *  - permissao "Frente de Caixa -- reabrir o caixa fechado hoje";
 *  - o caixa e' da propria pessoa (o dono reabre o de qualquer um);
 *  - fechado HOJE (fechamento com data de um dia anterior nao reabre);
 *  - a pessoa nao tem outro caixa aberto.
 * Com a gaveta ligada, a diferenca do fechamento some do extrato sozinha (ela
 * so' conta com o caixa fechado); o que ja' foi para o COFRE continua la'.
 */

class ErroReabertura extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;
const paraData = (v) => {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const reais = (c) => `R$ ${(Number(c || 0) / 100).toFixed(2).replace('.', ',')}`;

const reabrirCaixaPdv = async ({ user, tenantId, sessaoId }) => {
  if (!podeEmVendas(user, PV.pdvReabrirCaixa)) {
    throw new ErroReabertura(403, 'Você não tem permissão para reabrir o caixa. Peça ao dono liberar "Vendas: Frente de Caixa — reabrir o caixa fechado hoje" no seu cadastro de funcionário.');
  }
  const id = String(sessaoId || '');
  if (!ID_VALIDO.test(id)) throw new ErroReabertura(400, 'Caixa inválido. Atualize a tela e tente de novo.');
  const ref = db.collection('caixas_pdv').doc(id);
  const antes = await ref.get();
  const caixa = antes.exists ? antes.data() : null;
  if (!caixa || caixa.tenantId !== tenantId) throw new ErroReabertura(404, 'Este caixa não foi encontrado. Atualize a tela.');
  const ehDono = Boolean(user.dono || user.isPlatformAdmin);
  if (caixa.operadorId && caixa.operadorId !== user.uid && !ehDono) {
    throw new ErroReabertura(403, 'Só quem abriu este caixa (ou o dono) pode reabrir.');
  }
  // Um caixa aberto por pessoa: com outro aberto, reabrir dividiria as vendas.
  const abertos = await db.collection('caixas_pdv')
    .where('tenantId', '==', tenantId)
    .where('operadorId', '==', caixa.operadorId || user.uid)
    .where('status', '==', 'aberto')
    .limit(1)
    .get();
  if (!abertos.empty && abertos.docs[0].id !== id) {
    throw new ErroReabertura(409, 'Já existe um caixa aberto desta pessoa. Feche esse caixa antes de reabrir o outro.');
  }

  const hoje = getDateInputInTimeZone();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const c = snap.exists ? snap.data() : null;
    if (!c || c.tenantId !== tenantId) throw new ErroReabertura(404, 'Este caixa não foi encontrado. Atualize a tela.');
    if (c.status !== 'fechado') throw new ErroReabertura(409, 'Este caixa já está aberto.');
    const fechadoEm = paraData(c.fechadoEm);
    if (!fechadoEm || c.fechadoComDataDe || getDateInputInTimeZone(fechadoEm) !== hoje) {
      throw new ErroReabertura(409, 'Só dá para reabrir o caixa no mesmo dia em que ele foi fechado. Abra um caixa novo.');
    }
    const agora = new Date();
    const desfeito = {
      reabertoEm: agora.toISOString(),
      reabertoPorId: user.uid,
      reabertoPorNome: String(user.nome || user.email || ''),
      fechadoEm: fechadoEm.toISOString(),
      esperadoCentavos: Number(c.saldoEsperadoCentavos || 0),
      contadoCentavos: Number(c.saldoFinalInformadoCentavos || 0),
      diferencaCentavos: Number(c.diferencaCentavos || 0),
    };
    const apagar = admin.firestore.FieldValue.delete();
    tx.update(ref, {
      status: 'aberto',
      fechadoEm: null,
      saldoFinalInformadoCentavos: null,
      saldoEsperadoCentavos: null,
      diferencaCentavos: null,
      fechamentoPelaGaveta: apagar,
      fechadoPorId: apagar,
      fechadoPorNome: apagar,
      fechadoForaDoPdv: apagar,
      reaberturas: admin.firestore.FieldValue.arrayUnion(desfeito),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    registrarLogNaTransacao(tx, { ...user, tenantId }, {
      modulo: 'financeiro',
      acao: 'reabrir_caixa',
      descricao: `Caixa de ${c.operadorNome || 'operador'} reaberto no mesmo dia. Fechamento desfeito: esperado ${reais(desfeito.esperadoCentavos)}, contado ${reais(desfeito.contadoCentavos)}, diferença ${reais(desfeito.diferencaCentavos)}.`,
      registroId: id,
      alteracoes: [{ campo: 'Situação do caixa', valorAnterior: 'Fechado', valorNovo: 'Aberto' }],
    });
    return { sessaoId: id, ...c, status: 'aberto', fechadoEm: null, saldoFinalInformadoCentavos: null, saldoEsperadoCentavos: null, diferencaCentavos: null };
  });
};

module.exports = { ErroReabertura, reabrirCaixaPdv };
