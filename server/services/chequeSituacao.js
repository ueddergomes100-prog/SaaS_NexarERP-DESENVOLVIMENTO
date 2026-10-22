const { db } = require('../config/firebase');
const cd = require('../domain/contasDinheiroDomain');
const { buildDocumentUpdateMetadata } = require('../domain/documentMetadata');
const { ErroBaixa, agora, lerTitulo, lerBanco } = require('./baixaFinanceira');

/**
 * SITUACAO DO CHEQUE RECEBIDO (21/10/2026, decisao do dono): antes de
 * compensar, o cheque pode ser DEPOSITADO (escolhe o banco e fica
 * "aguardando compensacao") ou marcado DEVOLVIDO; os dois podem voltar para
 * a carteira. Nada aqui mexe em saldo: o banco so' recebe na compensacao
 * (services/movimentoBanco.js, que passa a usar o banco do deposito).
 * Regra em src/utils/contasDinheiroDomain.ts.
 */

const idValido = (id) => {
  const texto = String(id || '').trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(texto)) throw new ErroBaixa(400, 'Cheque inválido. Atualize a tela e tente de novo.');
  return texto;
};

const mudar = async ({ user, tenantId, transacaoId, conferir, campos, resumoDaAlteracao, bancoId }) => {
  const id = idValido(transacaoId);
  const resumo = {};
  await db.runTransaction(async (tx) => {
    const titulo = await lerTitulo(tx, tenantId, { transacaoId: id, tipo: 'entrada' });
    const dados = titulo.dados;
    if (String(dados.formaPagamento || '') !== 'Cheque' && !dados.cheque) throw new ErroBaixa(400, 'Este título não é um cheque.');
    const erro = conferir(dados);
    if (erro) throw new ErroBaixa(409, erro);
    let banco = null;
    if (bancoId) banco = await lerBanco(tx, tenantId, bancoId, 'Banco não encontrado. Atualize a tela e escolha de novo.');
    resumo.descricao = String(dados.descricao || '');
    resumo.numeroCheque = String((dados.cheque && dados.cheque.numeroCheque) || '');
    resumo.bancoNome = banco ? String(banco.dados.nome || '') : '';
    tx.update(titulo.ref, {
      cheque: { ...(dados.cheque || {}), ...campos },
      ...(banco ? { bancoId: banco.ref.id, bancoNome: resumo.bancoNome } : {}),
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), resumoDaAlteracao),
    });
  });
  return resumo;
};

/** Cheques > Depositar: escolhe o banco; o titulo fica "depositado, aguardando compensacao". */
const depositarCheque = ({ user, tenantId, corpo, hoje }) => mudar({
  user,
  tenantId,
  transacaoId: corpo?.transacaoId,
  bancoId: corpo?.bancoId ? String(corpo.bancoId).trim() : '',
  conferir: (dados) => (!corpo?.bancoId ? 'Escolha em qual banco o cheque foi depositado.' : cd.erroParaDepositarCheque(dados)),
  campos: { situacao: 'depositado', depositadoEm: hoje },
  resumoDaAlteracao: 'Cheque depositado (aguardando compensação)',
});

/** Cheques > Devolvido: o banco devolveu o cheque; o titulo continua em aberto (o cliente deve). */
const devolverCheque = ({ user, tenantId, corpo, hoje }) => mudar({
  user,
  tenantId,
  transacaoId: corpo?.transacaoId,
  conferir: cd.erroParaDevolverCheque,
  campos: { situacao: 'devolvido', devolvidoEm: hoje, motivoDevolucao: String(corpo?.motivo || '').trim().slice(0, 200) },
  resumoDaAlteracao: 'Cheque devolvido pelo banco',
});

/** Cheques > Voltar para a carteira (desfaz o deposito ou a devolucao). */
const voltarChequeParaCarteira = ({ user, tenantId, corpo }) => mudar({
  user,
  tenantId,
  transacaoId: corpo?.transacaoId,
  conferir: cd.erroParaVoltarChequeParaCarteira,
  campos: { situacao: 'em_carteira' },
  resumoDaAlteracao: 'Cheque de volta à carteira',
});

module.exports = { depositarCheque, devolverCheque, voltarChequeParaCarteira };
