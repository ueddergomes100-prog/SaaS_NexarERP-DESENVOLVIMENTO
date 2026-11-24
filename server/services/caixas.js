const { admin, db } = require('../config/firebase');
const cd = require('../domain/contasDinheiroDomain');
const gd = require('../domain/gavetaDinheiroDomain');
const { addDaysToDateInput, dateInputToUtcStart, getDateInputInTimeZone } = require('../domain/dateTime');
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
 *   gaveta             -> dinheiro das vendas na gaveta (23/11/2026): com a chave da
 *                         empresa ligada, o saldo e o extrato do CAIXA somam os titulos
 *                         pagos em dinheiro, as sangrias e a diferenca do fechamento do
 *                         PDV -- MONTADOS dos documentos (domain/gavetaDinheiroDomain)
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

// ---------------------------------------------------------------------------
// DINHEIRO DAS VENDAS NA GAVETA (montado dos documentos)
// ---------------------------------------------------------------------------

const paraData = (v) => {
  if (v instanceof Date) return v;
  return v && typeof v.toDate === 'function' ? v.toDate() : null;
};
const paraIso = (v) => {
  const d = paraData(v);
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : '';
};

const lerConfigDaGaveta = async (tenantId) => {
  const snap = await db.collection('configuracoes').doc(tenantId).get();
  return gd.lerConfigGaveta(snap.exists ? snap.data() : null);
};

/**
 * Movimentos em dinheiro de [de, ate] (yyyy-mm-dd; ate vazio = ate' hoje).
 * Titulos: pela data do pagamento e, nos que nao tem (estorno de venda
 * cancelada grava so' `data`), pela data. Sessoes do PDV: as abertas e as
 * fechadas desde `de` (sangria e diferenca do fechamento).
 */
const movimentosMontados = async (tenantId, de, ate = '') => {
  const titulos = db.collection('transacoes').where('tenantId', '==', tenantId).where('formaPagamento', '==', 'Dinheiro').where('status', '==', 'Paga');
  let porPagamento = titulos.where('dataPagamento', '>=', de);
  let porData = titulos.where('data', '>=', de);
  if (ate) {
    porPagamento = porPagamento.where('dataPagamento', '<=', ate);
    // `data` antiga pode ter hora ("2026-11-23T10:00"): o limite cobre o dia inteiro.
    porData = porData.where('data', '<=', `${ate}\uf8ff`);
  }
  const sessoes = db.collection('caixas_pdv').where('tenantId', '==', tenantId);
  const [snapPagamento, snapData, snapAbertas, snapFechadas] = await Promise.all([
    porPagamento.get(),
    porData.get(),
    sessoes.where('status', '==', 'aberto').get(),
    sessoes.where('fechadoEm', '>=', dateInputToUtcStart(de)).get(),
  ]);
  const movimentos = [];
  const vistos = new Set();
  const somarTitulo = (docSnap) => {
    if (vistos.has(docSnap.id)) return;
    vistos.add(docSnap.id);
    const m = gd.movimentoDoTitulo(docSnap.id, docSnap.data(), paraIso(docSnap.data().createdAt));
    if (m) movimentos.push(m);
  };
  snapPagamento.docs.forEach(somarTitulo);
  // Da consulta por `data` so' entra quem nao tem data de pagamento (os outros ja' vieram acima, ou sao de outro periodo).
  snapData.docs.filter((d) => !d.data().dataPagamento).forEach(somarTitulo);
  [...snapAbertas.docs, ...snapFechadas.docs].forEach((docSnap) => {
    if (vistos.has(`sessao:${docSnap.id}`)) return;
    vistos.add(`sessao:${docSnap.id}`);
    const s = docSnap.data();
    movimentos.push(...gd.movimentosDaSessao(docSnap.id, { ...s, fechadoEm: paraData(s.fechadoEm), abertoEm: paraData(s.createdAt) }));
  });
  return movimentos.filter((m) => gd.movimentoNoPeriodo(m, de, ate));
};

// O que ja' passou de DIAS_AO_VIVO quase nao muda: a soma fica guardada por
// algumas horas (por processo) para a tela nao reler meses de titulos a cada
// abertura. Lancamento com data antiga feito depois entra na proxima releitura.
const DIAS_AO_VIVO = 7;
const VALIDADE_DA_SOMA_ANTIGA_MS = 6 * 60 * 60 * 1000;
const somaAntigaPorEmpresa = new Map();

const saldoMontado = async (tenantId, config) => {
  const corte = addDaysToDateInput(getDateInputInTimeZone(), -DIAS_AO_VIVO);
  let antigoCentavos = 0;
  let de = config.desde;
  if (config.desde < corte) {
    const chave = `${config.desde}|${corte}`;
    const guardado = somaAntigaPorEmpresa.get(tenantId);
    if (guardado && guardado.chave === chave && guardado.expira > Date.now()) {
      antigoCentavos = guardado.somaCentavos;
    } else {
      antigoCentavos = gd.saldoDosMovimentos(await movimentosMontados(tenantId, config.desde, addDaysToDateInput(corte, -1)));
      somaAntigaPorEmpresa.set(tenantId, { chave, somaCentavos: antigoCentavos, expira: Date.now() + VALIDADE_DA_SOMA_ANTIGA_MS });
    }
    de = corte;
  }
  return antigoCentavos + gd.saldoDosMovimentos(await movimentosMontados(tenantId, de));
};

/** { ativo, desde, montadoCentavos }: o que os documentos somam ao CAIXA. */
const gavetaDaEmpresa = async (tenantId) => {
  const config = await lerConfigDaGaveta(tenantId);
  if (!config.ativo) return { ativo: false, desde: config.desde, montadoCentavos: 0 };
  return { ativo: true, desde: config.desde, montadoCentavos: await saldoMontado(tenantId, config) };
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
  const gaveta = await gavetaDaEmpresa(tenantId);
  const caixas = caixasSnap.docs
    .map((snap) => {
      const caixa = caixaPublico(snap);
      // Chave ligada: o CAIXA soma o dinheiro das vendas, as sangrias e a diferenca do fechamento.
      if (!gaveta.ativo || !gd.ehACaixaGaveta(snap.data())) return caixa;
      return { ...caixa, saldoCentavos: caixa.saldoCentavos + gaveta.montadoCentavos, recebeDinheiroDasVendas: true };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const bancos = bancosSnap.docs
    .filter((d) => d.data().ativo !== false)
    .map((d) => ({ id: d.id, tipo: 'banco', nome: String(d.data().nome || ''), saldoCentavos: Number(d.data().saldoCentavos) || 0 }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return { caixas, bancos, gaveta: { ativo: gaveta.ativo, desde: gaveta.desde } };
};

/** Lancamentos gravados de um caixa (saldo inicial, transferencias, a mao, acerto), no formato do extrato. */
const lancamentosDoCaixa = async (tenantId, caixaId) => {
  const snap = await db.collection(COLECAO_LANCAMENTOS).where('tenantId', '==', tenantId).where('caixaId', '==', caixaId).get();
  return snap.docs.map((d) => {
    const l = d.data();
    return {
      id: d.id,
      tipo: String(l.tipo || ''),
      direcao: l.direcao === 'debito' ? 'debito' : 'credito',
      valorCentavos: Number(l.valorCentavos) || 0,
      descricao: String(l.descricao || ''),
      data: String(l.data || ''),
      criadoEmIso: paraIso(l.createdAt),
    };
  });
};

const ehOCofre = (dados) => dados.padrao === true && dados.ativo !== false && String(dados.nome || '') === cd.CAIXAS_PADRAO[1].nome;

/** CAIXA (a gaveta) e COFRE padrao da empresa; null quando nao existe/ativo. */
const caixasPadraoDaEmpresa = async (tenantId) => {
  const snap = await db.collection(COLECAO_CAIXAS).where('tenantId', '==', tenantId).get();
  return {
    gaveta: snap.docs.find((d) => gd.ehACaixaGaveta(d.data())) || null,
    cofre: snap.docs.find((d) => ehOCofre(d.data())) || null,
  };
};

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * PDV e Caixa (Sessoes PDV): o saldo da gaveta para conferir o fechamento, e
 * quantos caixas estao abertos (com mais de um, o fechamento e' por sessao).
 * `ate` (yyyy-mm-dd, antes de hoje): o saldo no FIM daquele dia -- caixa
 * esquecido aberto fechado com a data de ontem, acerto de um dia (24/11/2026).
 */
const resumoDaGaveta = async ({ user, tenantId, ate = '' }) => {
  const gaveta = await gavetaDaEmpresa(tenantId);
  if (!gaveta.ativo) return { ativo: false, desde: gaveta.desde, caixaId: '', caixaNome: '', saldoCentavos: null, caixasAbertos: 0, ate: '' };
  await garantirPadrao(user, tenantId);
  const [{ gaveta: doc }, abertasSnap] = await Promise.all([
    caixasPadraoDaEmpresa(tenantId),
    db.collection('caixas_pdv').where('tenantId', '==', tenantId).where('status', '==', 'aberto').get(),
  ]);
  // Sem o CAIXA padrao ativo nao ha' gaveta para conferir: o fechamento segue por sessao.
  let saldoCentavos = doc ? (Number(doc.data().saldoCentavos) || 0) + gaveta.montadoCentavos : null;
  const hoje = getDateInputInTimeZone();
  const dia = typeof ate === 'string' && DATA_ISO.test(ate) && ate < hoje ? ate : '';
  if (doc && dia) {
    const depoisDoDia = addDaysToDateInput(dia, 1);
    const [lancados, montados] = await Promise.all([
      lancamentosDoCaixa(tenantId, doc.id),
      movimentosMontados(tenantId, depoisDoDia > gaveta.desde ? depoisDoDia : gaveta.desde),
    ]);
    saldoCentavos = gd.saldoNoFimDoDia(saldoCentavos, [...lancados, ...montados], dia);
  }
  return {
    ativo: true,
    desde: gaveta.desde,
    caixaId: doc ? doc.id : '',
    caixaNome: doc ? String(doc.data().nome || '') : '',
    saldoCentavos,
    caixasAbertos: abertasSnap.size,
    ate: dia,
  };
};

/**
 * O que compoe o saldo da gaveta (o "Esperado agora"), dia a dia (pedido do
 * dono, 24/11/2026): do dia da ultima conferencia (fechamento pela gaveta ou
 * acerto) ate' hoje, venda por venda; o que veio antes sai numa linha so'.
 */
const composicaoDaGaveta = async ({ user, tenantId }) => {
  const config = await lerConfigDaGaveta(tenantId);
  if (!config.ativo) return { ativo: false };
  await garantirPadrao(user, tenantId);
  const hoje = getDateInputInTimeZone();
  const [{ gaveta: doc }, recentes] = await Promise.all([
    caixasPadraoDaEmpresa(tenantId),
    db.collection('caixas_pdv').where('tenantId', '==', tenantId)
      .where('fechadoEm', '>=', dateInputToUtcStart(addDaysToDateInput(hoje, -gd.DIAS_DA_COMPOSICAO))).get(),
  ]);
  if (!doc) return { ativo: false };
  const maior = (a, b) => (b > a ? b : a);
  const ultimoFechamento = recentes.docs
    .filter((d) => d.data().fechamentoPelaGaveta === true)
    .map((d) => paraData(d.data().fechadoEm))
    .filter((d) => d && !Number.isNaN(d.getTime()))
    .map((d) => getDateInputInTimeZone(d))
    .reduce(maior, '');
  const conferidaAte = typeof doc.data().gavetaConferidaAte === 'string' ? doc.data().gavetaConferidaAte : '';
  const inicio = gd.inicioDaComposicao({ desde: config.desde, hoje, ultimaConferencia: maior(ultimoFechamento, conferidaAte) });
  const [lancados, montados, montadoTotal] = await Promise.all([
    lancamentosDoCaixa(tenantId, doc.id),
    movimentosMontados(tenantId, inicio),
    saldoMontado(tenantId, config),
  ]);
  const saldoCentavos = (Number(doc.data().saldoCentavos) || 0) + montadoTotal;
  return {
    ativo: true,
    caixaNome: String(doc.data().nome || ''),
    desde: config.desde,
    ...gd.comporPorDia(saldoCentavos, [...lancados, ...montados], inicio),
  };
};

const lerCaixa = async (tx, tenantId, id) => {
  const ref = db.collection(COLECAO_CAIXAS).doc(idValido(id, 'Caixa inválido. Atualize a tela e tente de novo.'));
  const snap = await tx.get(ref);
  if (!snap.exists || snap.data().tenantId !== tenantId) throw new ErroBaixa(404, 'Este caixa não existe mais. Atualize a tela.');
  return { ref, dados: snap.data() };
};

/** Quanto os documentos somam a ESTE caixa (so' o CAIXA padrao, com a chave ligada). */
const montadoNoCaixa = (gaveta, dadosDoCaixa) => (gaveta && gaveta.ativo && gd.ehACaixaGaveta(dadosDoCaixa) ? gaveta.montadoCentavos : 0);

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
  // Saida: o que da' para tirar inclui o dinheiro das vendas (lido antes da transacao).
  const gaveta = lancamento.direcao === 'debito' ? await gavetaDaEmpresa(tenantId) : null;
  await db.runTransaction(async (tx) => {
    const caixa = await lerCaixa(tx, tenantId, caixaId);
    const nome = String(caixa.dados.nome || '');
    const saldo = Number(caixa.dados.saldoCentavos) || 0;
    if (lancamento.direcao === 'debito') {
      const erro = cd.erroDeSaldoDoCaixa(nome, saldo + montadoNoCaixa(gaveta, caixa.dados), lancamento.valorCentavos);
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

const DIAS_DO_EXTRATO_PADRAO = 30;
const DIAS_DO_EXTRATO_MAXIMO = 366;

const extrato = async ({ tenantId, caixaId, dias }) => {
  const id = idValido(caixaId, 'Caixa inválido. Atualize a tela e tente de novo.');
  const [lancados, caixaSnap, config] = await Promise.all([
    lancamentosDoCaixa(tenantId, id),
    db.collection(COLECAO_CAIXAS).doc(id).get(),
    lerConfigDaGaveta(tenantId),
  ]);
  // Chave ligada, no CAIXA: junta o dinheiro das vendas, sangrias e diferenca de
  // fechamento do periodo pedido (padrao: ultimos 30 dias; nunca antes da data em que ligou).
  let montados = [];
  const ehAGaveta = caixaSnap.exists && caixaSnap.data().tenantId === tenantId && gd.ehACaixaGaveta(caixaSnap.data());
  if (config.ativo && ehAGaveta) {
    const pedido = Number(dias);
    const janela = Number.isInteger(pedido) && pedido > 0 ? Math.min(pedido, DIAS_DO_EXTRATO_MAXIMO) : DIAS_DO_EXTRATO_PADRAO;
    const desdeAJanela = addDaysToDateInput(getDateInputInTimeZone(), -janela);
    montados = await movimentosMontados(tenantId, desdeAJanela > config.desde ? desdeAJanela : config.desde);
  }
  return [...lancados, ...montados]
    .sort((a, b) => b.data.localeCompare(a.data) || b.criadoEmIso.localeCompare(a.criadoEmIso))
    .slice(0, cd.EXTRATO_LIMITE);
};

/** Le a conta (caixa ou banco) na transacao, no formato comum. */
const lerConta = async (tx, tenantId, conta, gaveta) => {
  if (conta.tipo === 'caixa') {
    const c = await lerCaixa(tx, tenantId, conta.id);
    const saldoCentavos = Number(c.dados.saldoCentavos) || 0;
    // `disponivelCentavos` = o que da' para tirar (com o dinheiro das vendas); `saldoCentavos` = o que esta' gravado no caixa.
    return { tipo: 'caixa', ref: c.ref, nome: String(c.dados.nome || ''), saldoCentavos, disponivelCentavos: saldoCentavos + montadoNoCaixa(gaveta, c.dados) };
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
  // Saindo de um caixa: o que da' para tirar inclui o dinheiro das vendas (lido antes da transacao).
  const gaveta = pedido.origem.tipo === 'caixa' ? await gavetaDaEmpresa(tenantId) : null;
  await db.runTransaction(async (tx) => {
    const origem = await lerConta(tx, tenantId, pedido.origem, gaveta);
    const destino = await lerConta(tx, tenantId, pedido.destino, null);
    if (origem.tipo === 'caixa') {
      const erro = cd.erroDeSaldoDoCaixa(origem.nome, origem.disponivelCentavos, pedido.valorCentavos);
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

const dataBr = (iso) => String(iso || '').split('-').reverse().join('/');

/** Par de lancamentos CAIXA -> COFRE (dentro da transacao, depois das leituras). */
const mandarAoCofre = (tx, { tenantId, caixa, cofre, valorCentavos, data, descricao, uid }) => {
  const saidaRef = db.collection(COLECAO_LANCAMENTOS).doc();
  const entradaRef = db.collection(COLECAO_LANCAMENTOS).doc();
  const textos = cd.descricoesDaTransferencia(caixa.nome, cofre.nome, descricao);
  const comum = { tenantId, valorCentavos, data, createdBy: uid, createdAt: TS() };
  tx.set(saidaRef, { ...comum, caixaId: caixa.ref.id, caixaNome: caixa.nome, tipo: 'transferencia_saida', direcao: 'debito', descricao: textos.saida, transferenciaParId: entradaRef.id });
  tx.set(entradaRef, { ...comum, caixaId: cofre.ref.id, caixaNome: cofre.nome, tipo: 'transferencia_entrada', direcao: 'credito', descricao: textos.entrada, transferenciaParId: saidaRef.id });
};

const lerCaixaPadrao = async (tx, tenantId, doc) => {
  const c = await lerCaixa(tx, tenantId, doc.id);
  return { ref: c.ref, dados: c.dados, nome: String(c.dados.nome || ''), saldoCentavos: Number(c.dados.saldoCentavos) || 0 };
};

/**
 * "Fechar o caixa de ontem" (decisao do dono, 24/11/2026): conta o dinheiro que
 * ficou de um dia que ja' passou. A sobra/falta e a ida ao COFRE entram com a
 * data daquele dia; o saldo da gaveta de hoje passa a partir do troco.
 */
const acertarDiaDaGaveta = async ({ user, tenantId, corpo }) => {
  const config = await lerConfigDaGaveta(tenantId);
  if (!config.ativo) throw new ErroBaixa(409, 'Ligue "Dinheiro das vendas na gaveta" nas Configurações para acertar a gaveta.');
  const hoje = getDateInputInTimeZone();
  const lido = gd.lerPedidoDeAcerto(corpo, hoje, config.desde);
  if ('erro' in lido) throw new ErroBaixa(400, lido.erro);
  const { pedido } = lido;
  await garantirPadrao(user, tenantId);
  const padrao = await caixasPadraoDaEmpresa(tenantId);
  if (!padrao.gaveta) throw new ErroBaixa(409, 'O CAIXA não está ativo em Caixas e Transferências. Ative o CAIXA para acertar a gaveta.');
  const { saldoCentavos: saldoDoSistemaCentavos } = await resumoDaGaveta({ user, tenantId, ate: pedido.data });
  const plano = gd.planejarAcerto(saldoDoSistemaCentavos || 0, pedido.contadoCentavos, pedido.trocoCentavos);
  if (plano.paraCofreCentavos > 0 && !padrao.cofre) {
    throw new ErroBaixa(409, 'Não há COFRE ativo em Caixas e Transferências para receber o dinheiro. Ative o COFRE ou informe todo o valor como troco.');
  }
  const resumo = { ...pedido, saldoDoSistemaCentavos: saldoDoSistemaCentavos || 0, ...plano, caixaNome: '', cofreNome: '' };
  await db.runTransaction(async (tx) => {
    const caixa = await lerCaixaPadrao(tx, tenantId, padrao.gaveta);
    const cofre = plano.paraCofreCentavos > 0 ? await lerCaixaPadrao(tx, tenantId, padrao.cofre) : null;
    resumo.caixaNome = caixa.nome;
    resumo.cofreNome = cofre ? cofre.nome : '';
    if (plano.diferencaCentavos !== 0) {
      tx.set(db.collection(COLECAO_LANCAMENTOS).doc(), {
        tenantId,
        caixaId: caixa.ref.id,
        caixaNome: caixa.nome,
        tipo: 'acerto_gaveta',
        direcao: plano.diferencaCentavos > 0 ? 'credito' : 'debito',
        valorCentavos: Math.abs(plano.diferencaCentavos),
        descricao: `${plano.diferencaCentavos > 0 ? 'Sobra' : 'Falta'} na conferência da gaveta de ${dataBr(pedido.data)}`,
        data: pedido.data,
        createdBy: user.uid,
        createdAt: TS(),
      });
    }
    if (cofre) {
      mandarAoCofre(tx, { tenantId, caixa, cofre, valorCentavos: plano.paraCofreCentavos, data: pedido.data, descricao: `Dinheiro da gaveta de ${dataBr(pedido.data)} para o ${cofre.nome}`, uid: user.uid });
      tx.update(cofre.ref, { saldoCentavos: cofre.saldoCentavos + plano.paraCofreCentavos, updatedAt: TS(), ...buildDocumentUpdateMetadata(user.uid, TS(), `Dinheiro da gaveta de ${dataBr(pedido.data)}`) });
    }
    const anterior = typeof caixa.dados.gavetaConferidaAte === 'string' ? caixa.dados.gavetaConferidaAte : '';
    tx.update(caixa.ref, {
      saldoCentavos: caixa.saldoCentavos + plano.diferencaCentavos - plano.paraCofreCentavos,
      gavetaConferidaAte: anterior > pedido.data ? anterior : pedido.data,
      updatedAt: TS(),
      ...buildDocumentUpdateMetadata(user.uid, TS(), `Acerto da gaveta de ${dataBr(pedido.data)}`),
    });
  });
  return resumo;
};

/**
 * Troco e COFRE no fechamento do caixa (decisao do dono, 24/11/2026): o que foi
 * contado menos o troco vai para o COFRE, com a data do fechamento. Uma vez so'
 * por sessao (repetir devolve o que ja' foi feito).
 */
const cofreNoFechamento = async ({ user, tenantId, corpo }) => {
  const lido = gd.lerPedidoDeCofreNoFechamento(corpo);
  if ('erro' in lido) throw new ErroBaixa(400, lido.erro);
  const { pedido } = lido;
  const config = await lerConfigDaGaveta(tenantId);
  if (!config.ativo) throw new ErroBaixa(409, 'Ligue "Dinheiro das vendas na gaveta" nas Configurações para mandar o dinheiro ao COFRE no fechamento.');
  await garantirPadrao(user, tenantId);
  const padrao = await caixasPadraoDaEmpresa(tenantId);
  const resumo = { jaFeito: false, valorCentavos: 0, trocoCentavos: pedido.trocoCentavos, cofreNome: '' };
  await db.runTransaction(async (tx) => {
    const sessaoRef = db.collection('caixas_pdv').doc(pedido.sessaoId);
    const sessao = await tx.get(sessaoRef);
    if (!sessao.exists || sessao.data().tenantId !== tenantId) throw new ErroBaixa(404, 'Este caixa não foi encontrado. Atualize a tela.');
    const s = sessao.data();
    if (s.status !== 'fechado') throw new ErroBaixa(409, 'Feche o caixa antes de mandar o dinheiro para o COFRE.');
    if (s.cofreNoFechamento && typeof s.cofreNoFechamento === 'object') {
      Object.assign(resumo, {
        jaFeito: true,
        valorCentavos: Number(s.cofreNoFechamento.valorCentavos) || 0,
        trocoCentavos: Number(s.cofreNoFechamento.trocoCentavos) || 0,
        cofreNome: String(s.cofreNoFechamento.cofreNome || ''),
      });
      return;
    }
    const contado = Number(s.saldoFinalInformadoCentavos) || 0;
    const erro = gd.erroDoTroco(contado, pedido.trocoCentavos);
    if (erro) throw new ErroBaixa(400, erro);
    const valorCentavos = contado - pedido.trocoCentavos;
    const fechadoEm = paraData(s.fechadoEm);
    const data = fechadoEm && !Number.isNaN(fechadoEm.getTime()) ? getDateInputInTimeZone(fechadoEm) : getDateInputInTimeZone();
    let cofreNome = '';
    if (valorCentavos > 0) {
      if (!padrao.gaveta || !padrao.cofre) {
        throw new ErroBaixa(409, 'Não há CAIXA e COFRE ativos em Caixas e Transferências. O dinheiro ficou no caixa; ative o COFRE e faça a transferência por lá.');
      }
      const caixa = await lerCaixaPadrao(tx, tenantId, padrao.gaveta);
      const cofre = await lerCaixaPadrao(tx, tenantId, padrao.cofre);
      cofreNome = cofre.nome;
      const quem = String(s.terminalNome || s.operadorNome || '').trim();
      mandarAoCofre(tx, { tenantId, caixa, cofre, valorCentavos, data, descricao: `Fechamento do caixa${quem ? ` (${quem})` : ''}: dinheiro para o ${cofre.nome}`, uid: user.uid });
      tx.update(caixa.ref, { saldoCentavos: caixa.saldoCentavos - valorCentavos, updatedAt: TS(), ...buildDocumentUpdateMetadata(user.uid, TS(), `Fechamento do caixa: dinheiro para o ${cofre.nome}`) });
      tx.update(cofre.ref, { saldoCentavos: cofre.saldoCentavos + valorCentavos, updatedAt: TS(), ...buildDocumentUpdateMetadata(user.uid, TS(), 'Fechamento do caixa') });
    }
    tx.update(sessaoRef, {
      cofreNoFechamento: { valorCentavos, trocoCentavos: pedido.trocoCentavos, cofreNome, data, registradoPorId: user.uid, registradoEm: TS() },
      updatedAt: TS(),
    });
    Object.assign(resumo, { valorCentavos, cofreNome });
  });
  return resumo;
};

module.exports = { COLECAO_CAIXAS, COLECAO_LANCAMENTOS, listar, salvar, lancar, extrato, transferir, sangriaParaDeposito, resumoDaGaveta, composicaoDaGaveta, acertarDiaDaGaveta, cofreNoFechamento };
