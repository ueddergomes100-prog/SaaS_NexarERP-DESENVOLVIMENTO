const { admin, db } = require('../config/firebase');
const cd = require('../domain/contasDinheiroDomain');
const { buildDocumentMetadata, buildDocumentUpdateMetadata } = require('../domain/documentMetadata');
const { ErroBaixa, agora, lerBanco } = require('./baixaFinanceira');

/**
 * CAIXAS E TRANSFERENCIAS ENTRE CONTAS (21/10/2026) -- regra em
 * src/utils/contasDinheiroDomain.ts.
 *
 *   listar             -> caixas (cria CAIXA e COFRE na primeira vez) + bancos ativos
 *   salvar             -> cria/edita um caixa (saldo inicial vira o primeiro lancamento)
 *   lancar             -> entrada/saida a mao no caixa
 *   extrato            -> lancamentos do caixa
 *   transferir         -> caixa <-> banco, caixa <-> caixa, banco <-> banco: par de
 *                         lancamentos e os dois saldos numa transacao so'
 *   sangriaParaDeposito-> PDV: sangria "para deposito" credita o banco escolhido
 *
 * Colecoes `caixas` e `lancamentos_caixa` sao so' do servidor (sem regra no
 * Firestore). O lado banco usa `lancamentos_bancarios`, como a transferencia
 * entre bancos do cadastro de Bancos (services/movimentoBanco.js).
 */

const COLECAO_CAIXAS = 'caixas';
const COLECAO_LANCAMENTOS = 'lancamentos_caixa';

const TS = () => admin.firestore.FieldValue.serverTimestamp();

const idValido = (id, mensagem) => {
  const texto = String(id || '').trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(texto)) throw new ErroBaixa(400, mensagem);
  return texto;
};

const caixaPublico = (snap) => {
  const d = snap.data();
  return {
    id: snap.id,
    tipo: 'caixa',
    nome: String(d.nome || ''),
    descricao: String(d.descricao || ''),
    saldoCentavos: Number(d.saldoCentavos) || 0,
    saldoInicialCentavos: Number(d.saldoInicialCentavos) || 0,
    ativo: d.ativo !== false,
    padrao: d.padrao === true,
  };
};

/** Cria CAIXA e COFRE quando a empresa ainda nao tem caixa nenhum. */
const garantirPadrao = async (user, tenantId) => {
  const snap = await db.collection(COLECAO_CAIXAS).where('tenantId', '==', tenantId).limit(1).get();
  if (!snap.empty) return;
  const lote = db.batch();
  cd.CAIXAS_PADRAO.forEach((c, i) => {
    lote.set(db.collection(COLECAO_CAIXAS).doc(), {
      tenantId,
      nome: c.nome,
      descricao: c.descricao,
      saldoCentavos: 0,
      saldoInicialCentavos: 0,
      ativo: true,
      padrao: true,
      ordem: i,
      createdAt: TS(),
      ...buildDocumentMetadata(user.uid, TS()),
    });
  });
  await lote.commit();
};

const listar = async ({ user, tenantId }) => {
  await garantirPadrao(user, tenantId);
  const [caixasSnap, bancosSnap] = await Promise.all([
    db.collection(COLECAO_CAIXAS).where('tenantId', '==', tenantId).get(),
    db.collection('bancos').where('tenantId', '==', tenantId).get(),
  ]);
  const caixas = caixasSnap.docs.map(caixaPublico).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const bancos = bancosSnap.docs
    .filter((d) => d.data().ativo !== false)
    .map((d) => ({ id: d.id, tipo: 'banco', nome: String(d.data().nome || ''), saldoCentavos: Number(d.data().saldoCentavos) || 0 }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return { caixas, bancos };
};

const lerCaixa = async (tx, tenantId, id) => {
  const ref = db.collection(COLECAO_CAIXAS).doc(idValido(id, 'Caixa inválido. Atualize a tela e tente de novo.'));
  const snap = await tx.get(ref);
  if (!snap.exists || snap.data().tenantId !== tenantId) throw new ErroBaixa(404, 'Este caixa não existe mais. Atualize a tela.');
  return { ref, dados: snap.data() };
};

const salvar = async ({ user, tenantId, id, corpo }) => {
  const lido = cd.lerCadastroDeCaixa(corpo);
  if ('erro' in lido) throw new ErroBaixa(400, lido.erro);
  const { caixa } = lido;
  const repetido = await db.collection(COLECAO_CAIXAS).where('tenantId', '==', tenantId).where('nome', '==', caixa.nome).get();
  if (repetido.docs.some((d) => d.id !== id)) throw new ErroBaixa(409, `Já existe um caixa chamado ${caixa.nome}. Escolha outro nome.`);

  if (id) {
    await db.runTransaction(async (tx) => {
      const { ref } = await lerCaixa(tx, tenantId, id);
      tx.update(ref, { nome: caixa.nome, descricao: caixa.descricao, ativo: caixa.ativo, updatedAt: TS(), ...buildDocumentUpdateMetadata(user.uid, TS(), 'Caixa alterado') });
    });
    return { id, nome: caixa.nome };
  }
  const ref = db.collection(COLECAO_CAIXAS).doc();
  const lote = db.batch();
  lote.set(ref, {
    tenantId,
    nome: caixa.nome,
    descricao: caixa.descricao,
    saldoCentavos: caixa.saldoInicialCentavos,
    saldoInicialCentavos: caixa.saldoInicialCentavos,
    ativo: caixa.ativo,
    padrao: false,
    createdAt: TS(),
    ...buildDocumentMetadata(user.uid, TS()),
  });
  if (caixa.saldoInicialCentavos > 0) {
    lote.set(db.collection(COLECAO_LANCAMENTOS).doc(), {
      tenantId,
      caixaId: ref.id,
      caixaNome: caixa.nome,
      tipo: 'saldo_inicial',
      direcao: 'credito',
      valorCentavos: caixa.saldoInicialCentavos,
      descricao: 'Saldo inicial',
      data: new Date().toISOString().slice(0, 10),
      createdBy: user.uid,
      createdAt: TS(),
    });
  }
  await lote.commit();
  return { id: ref.id, nome: caixa.nome };
};

const lancar = async ({ user, tenantId, caixaId, corpo }) => {
  const lido = cd.lerLancamentoDeCaixa(corpo);
  if ('erro' in lido) throw new ErroBaixa(400, lido.erro);
  const { lancamento } = lido;
  const resumo = {};
  await db.runTransaction(async (tx) => {
    const caixa = await lerCaixa(tx, tenantId, caixaId);
    const nome = String(caixa.dados.nome || '');
    const saldo = Number(caixa.dados.saldoCentavos) || 0;
    if (lancamento.direcao === 'debito') {
      const erro = cd.erroDeSaldoDoCaixa(nome, saldo, lancamento.valorCentavos);
      if (erro) throw new ErroBaixa(409, erro);
    }
    resumo.caixaNome = nome;
    tx.set(db.collection(COLECAO_LANCAMENTOS).doc(), {
      tenantId,
      caixaId: caixa.ref.id,
      caixaNome: nome,
      tipo: 'ajuste',
      direcao: lancamento.direcao,
      valorCentavos: lancamento.valorCentavos,
      descricao: lancamento.descricao,
      data: lancamento.data,
      createdBy: user.uid,
      createdAt: TS(),
    });
    tx.update(caixa.ref, {
      saldoCentavos: saldo + (lancamento.direcao === 'credito' ? lancamento.valorCentavos : -lancamento.valorCentavos),
      updatedAt: TS(),
      ...buildDocumentUpdateMetadata(user.uid, TS(), 'Lançamento manual no caixa'),
    });
  });
  return { ...resumo, ...lancamento };
};

const extrato = async ({ tenantId, caixaId }) => {
  const id = idValido(caixaId, 'Caixa inválido. Atualize a tela e tente de novo.');
  const snap = await db.collection(COLECAO_LANCAMENTOS).where('tenantId', '==', tenantId).where('caixaId', '==', id).get();
  return snap.docs
    .map((d) => {
      const l = d.data();
      return {
        id: d.id,
        tipo: String(l.tipo || ''),
        direcao: l.direcao === 'debito' ? 'debito' : 'credito',
        valorCentavos: Number(l.valorCentavos) || 0,
        descricao: String(l.descricao || ''),
        data: String(l.data || ''),
        criadoEmIso: l.createdAt && typeof l.createdAt.toDate === 'function' ? l.createdAt.toDate().toISOString() : '',
      };
    })
    .sort((a, b) => b.data.localeCompare(a.data) || b.criadoEmIso.localeCompare(a.criadoEmIso))
    .slice(0, cd.EXTRATO_LIMITE);
};

/** Le a conta (caixa ou banco) na transacao, no formato comum. */
const lerConta = async (tx, tenantId, conta) => {
  if (conta.tipo === 'caixa') {
    const c = await lerCaixa(tx, tenantId, conta.id);
    return { tipo: 'caixa', ref: c.ref, nome: String(c.dados.nome || ''), saldoCentavos: Number(c.dados.saldoCentavos) || 0 };
  }
  const b = await lerBanco(tx, tenantId, conta.id, 'Banco não encontrado. Atualize a tela e escolha de novo.');
  return { tipo: 'banco', ref: b.ref, nome: String(b.dados.nome || ''), saldoCentavos: Number(b.dados.saldoCentavos || 0) };
};

/** Lancamento de um lado da transferencia, na colecao certa para o tipo da conta. */
const lancamentoDoLado = (tx, { tenantId, conta, direcao, valorCentavos, descricao, data, parId, uid }, ref) => {
  const comum = { tenantId, direcao, valorCentavos, descricao, data, transferenciaParId: parId, createdBy: uid, createdAt: TS() };
  if (conta.tipo === 'caixa') {
    tx.set(ref, { ...comum, caixaId: conta.ref.id, caixaNome: conta.nome, tipo: direcao === 'debito' ? 'transferencia_saida' : 'transferencia_entrada' });
  } else {
    tx.set(ref, { ...comum, bancoId: conta.ref.id, bancoNome: conta.nome, tipo: direcao === 'debito' ? 'transferencia_saida' : 'transferencia_entrada' });
  }
};

const colecaoDoLado = (tipo) => (tipo === 'caixa' ? COLECAO_LANCAMENTOS : 'lancamentos_bancarios');

const transferir = async ({ user, tenantId, corpo }) => {
  const lido = cd.lerPedidoDeTransferencia(corpo);
  if ('erro' in lido) throw new ErroBaixa(400, lido.erro);
  const { pedido } = lido;
  const resumo = {};
  await db.runTransaction(async (tx) => {
    const origem = await lerConta(tx, tenantId, pedido.origem);
    const destino = await lerConta(tx, tenantId, pedido.destino);
    if (origem.tipo === 'caixa') {
      const erro = cd.erroDeSaldoDoCaixa(origem.nome, origem.saldoCentavos, pedido.valorCentavos);
      if (erro) throw new ErroBaixa(409, erro);
    }
    const textos = cd.descricoesDaTransferencia(origem.nome, destino.nome, pedido.descricao);
    const saidaRef = db.collection(colecaoDoLado(origem.tipo)).doc();
    const entradaRef = db.collection(colecaoDoLado(destino.tipo)).doc();
    lancamentoDoLado(tx, { tenantId, conta: origem, direcao: 'debito', valorCentavos: pedido.valorCentavos, descricao: textos.saida, data: pedido.data, parId: entradaRef.id, uid: user.uid }, saidaRef);
    lancamentoDoLado(tx, { tenantId, conta: destino, direcao: 'credito', valorCentavos: pedido.valorCentavos, descricao: textos.entrada, data: pedido.data, parId: saidaRef.id, uid: user.uid }, entradaRef);
    tx.update(origem.ref, { saldoCentavos: origem.saldoCentavos - pedido.valorCentavos, updatedAt: TS(), ...buildDocumentUpdateMetadata(user.uid, TS(), `Transferência para ${destino.nome}`) });
    tx.update(destino.ref, { saldoCentavos: destino.saldoCentavos + pedido.valorCentavos, updatedAt: TS(), ...buildDocumentUpdateMetadata(user.uid, TS(), `Transferência de ${origem.nome}`) });
    resumo.nomeOrigem = origem.nome;
    resumo.nomeDestino = destino.nome;
  });
  return { ...resumo, valorCentavos: pedido.valorCentavos, data: pedido.data };
};

/**
 * Sangria do PDV "para deposito" (decisao do dono): o banco escolhido e'
 * creditado na hora. O dinheiro da gaveta e' acompanhado pela sessao do PDV
 * (saldo esperado), nao pelo cadastro de caixas -- por isso nenhum caixa e'
 * debitado aqui.
 */
const sangriaParaDeposito = async ({ user, tenantId, corpo, operadorNome }) => {
  const lido = cd.lerSangriaParaDeposito(corpo);
  if ('erro' in lido) throw new ErroBaixa(400, lido.erro);
  const { sangria } = lido;
  const resumo = {};
  await db.runTransaction(async (tx) => {
    const sessaoRef = db.collection('caixas_pdv').doc(sangria.sessaoId);
    const sessao = await tx.get(sessaoRef);
    if (!sessao.exists || sessao.data().tenantId !== tenantId || sessao.data().status !== 'aberto') {
      throw new ErroBaixa(409, 'O caixa do PDV não está aberto. Abra o caixa antes de fazer a sangria.');
    }
    const banco = await lerBanco(tx, tenantId, sangria.bancoId, 'Banco não encontrado. Atualize a tela e escolha de novo.');
    const nome = String(banco.dados.nome || '');
    resumo.bancoNome = nome;
    tx.set(db.collection('lancamentos_bancarios').doc(), {
      tenantId,
      bancoId: banco.ref.id,
      bancoNome: nome,
      tipo: 'deposito',
      direcao: 'credito',
      valorCentavos: sangria.valorCentavos,
      descricao: `Sangria do PDV para depósito${operadorNome ? ` — ${operadorNome}` : ''}`,
      data: sangria.data,
      pdvSessionId: sangria.sessaoId,
      createdBy: user.uid,
      createdAt: TS(),
    });
    tx.update(banco.ref, {
      saldoCentavos: Number(banco.dados.saldoCentavos || 0) + sangria.valorCentavos,
      updatedAt: TS(),
      ...buildDocumentUpdateMetadata(user.uid, TS(), 'Depósito da sangria do PDV'),
    });
  });
  return { ...resumo, bancoId: sangria.bancoId, valorCentavos: sangria.valorCentavos };
};

module.exports = { COLECAO_CAIXAS, COLECAO_LANCAMENTOS, listar, salvar, lancar, extrato, transferir, sangriaParaDeposito };
