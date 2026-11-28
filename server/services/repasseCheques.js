/*
 * CHEQUE DE CLIENTE PAGANDO A NOTA AVULSA (25/11/2026, Embala Minas, item 11).
 *
 * A loja recebe cheque do cliente (fica "Em carteira" em Financeiro > Cheques)
 * e passa esse mesmo cheque ao fornecedor para pagar uma compra lancada como
 * Nota Avulsa. Decisoes do dono (caixa de perguntas):
 *  - o cheque sai da carteira como "Repassado a <fornecedor>" e o titulo do
 *    cliente fica PAGO na data do repasse, sem entrar em banco;
 *  - os cheques nao podem passar do valor da nota (o que faltar se paga com
 *    outra forma).
 *
 * A nota (gravada pela tela, como sempre) guarda `pagamentoComCheques` com os
 * cheques escolhidos e o total; o repasse e' feito AQUI, numa transacao:
 * cheques pagos + venda/OS de origem com o recebimento + ganchos da
 * renegociacao + o titulo da nota pago com os cheques. Cancelar a nota desfaz
 * (os cheques voltam para a carteira e o titulo do cliente volta a ficar em aberto).
 * Rodar de novo e' seguro: nota ja' repassada nao repassa outra vez.
 */
const { db } = require('../config/firebase');
const { fromCents, reversePaymentReceipt, settledFinancialNatureForPayment } = require('../domain/financeDomain');
const { situacaoDoCheque } = require('../domain/contasDinheiroDomain');
const { STATUS_RENEGOCIADA } = require('../domain/renegociacaoDomain');
const { buildDocumentMetadata, buildDocumentUpdateMetadata } = require('../domain/documentMetadata');
const { ErroBaixa, agora, apagar, lerTitulo, lerOrigem, centavosDoTitulo, camposDoResumoDePagamentos, camposDaContaNoParcial, temPermissao } = require('./baixaFinanceira');
const { montarBaixaManual } = require('../domain/baixaFinanceiraDomain');
const { registrarRecebimentoNaOrigem } = require('./movimentoBanco');
const { lerRenegociacaoDoTitulo, quitarOrigensSeRenegociacaoPaga, reabrirOrigensSeRenegociacaoEstavaPaga } = require('./renegociacaoOrigem');
const { registrarLogNaTransacao } = require('./auditoria');
const cashback = require('./cashback');

const PERMISSAO = 'estoque.nota_avulsa_cheque_cliente';
const SEM_PERMISSAO = 'Você não tem permissão para pagar nota avulsa com cheque de cliente. Peça ao administrador para liberar "Nota Avulsa: pagar com cheque de cliente" em Usuários.';
const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;
const reais = (centavos) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((Number(centavos) || 0) / 100);
const idDoTituloDoRepasse = (notaId) => `repasse_cheques_${notaId}`;

const exigir = (user) => { if (!temPermissao(user, PERMISSAO)) throw new ErroBaixa(403, SEM_PERMISSAO); };

/** O cheque pode ser repassado? Mensagem em portugues, ou null. */
const erroDoChequeParaRepassar = (dados) => {
  const numero = (dados && dados.cheque && dados.cheque.numeroCheque) || '';
  const nome = `O cheque${numero ? ` nº ${numero}` : ''}${dados && dados.clienteNome ? ` de ${dados.clienteNome}` : ''}`;
  if (!dados || dados.tipo !== 'entrada' || (String(dados.formaPagamento || '') !== 'Cheque' && !dados.cheque)) return 'Um dos cheques escolhidos não é cheque recebido. Escolha de novo.';
  if (dados.status === STATUS_RENEGOCIADA) return `${nome} está numa renegociação: compense pelo Financeiro > Cheques.`;
  if (dados.renegociacao) return `${nome} é parcela de renegociação: compense pelo Financeiro > Cheques.`;
  if (dados.status !== 'Pendente') return `${nome} não está mais em aberto (talvez já tenha sido compensado ou repassado). Escolha de novo.`;
  const situacao = situacaoDoCheque(dados);
  if (situacao !== 'em_carteira') return `${nome} não está mais na carteira (${situacao === 'depositado' ? 'foi depositado' : 'foi devolvido'}). Escolha outro.`;
  return null;
};

/** Cheques recebidos que estao na carteira (para a tela escolher). */
const chequesNaCarteira = async ({ user, tenantId }) => {
  exigir(user);
  const snap = await db.collection('transacoes')
    .where('tenantId', '==', tenantId).where('tipo', '==', 'entrada').where('status', '==', 'Pendente').where('formaPagamento', '==', 'Cheque')
    .get();
  return snap.docs
    .filter((d) => !erroDoChequeParaRepassar(d.data()))
    .map((d) => {
      const t = d.data();
      const c = t.cheque || {};
      return {
        id: d.id,
        numeroCheque: String(c.numeroCheque || ''),
        bancoEmissor: String(c.bancoEmissor || c.banco || ''),
        clienteNome: String(t.clienteNome || ''),
        descricao: String(t.descricao || ''),
        bomPara: String(c.dataCompensacao || t.dataPrevistaRecebimento || t.dataVencimento || t.data || ''),
        centavos: centavosDoTitulo(t),
      };
    })
    .sort((a, b) => a.bomPara.localeCompare(b.bomPara));
};

const lerNota = async (tx, tenantId, notaId) => {
  const id = String(notaId || '').trim();
  if (!ID_VALIDO.test(id)) throw new ErroBaixa(400, 'Nota avulsa inválida. Atualize a tela.');
  const ref = db.collection('notas_avulsas').doc(id);
  const snap = await tx.get(ref);
  if (!snap.exists || snap.data().tenantId !== tenantId) throw new ErroBaixa(404, 'Nota avulsa não encontrada. Atualize a tela.');
  return { ref, dados: snap.data() };
};

/** Repassa os cheques que a nota guardou: cheques pagos e o titulo da nota pago com eles. */
const repassarNaNotaAvulsa = async ({ user, tenantId, notaAvulsaId, hoje }) => {
  exigir(user);
  const resumo = { jaRepassado: false, vendas: new Set() };
  await db.runTransaction(async (tx) => {
    // ---------------- LEITURAS ----------------
    const nota = await lerNota(tx, tenantId, notaAvulsaId);
    const pagamento = nota.dados.pagamentoComCheques;
    if (!pagamento || !Array.isArray(pagamento.chequeIds) || pagamento.chequeIds.length === 0) throw new ErroBaixa(400, 'Esta nota não foi paga com cheques de clientes.');
    if (pagamento.situacao === 'repassado') { resumo.jaRepassado = true; return; }
    if (nota.dados.status !== 'ativa') throw new ErroBaixa(409, 'Esta nota avulsa está cancelada: os cheques não são repassados.');
    const cheques = [];
    for (const id of pagamento.chequeIds) {
      const titulo = await lerTitulo(tx, tenantId, { transacaoId: String(id), tipo: 'entrada' });
      const erro = erroDoChequeParaRepassar(titulo.dados);
      if (erro) throw new ErroBaixa(409, `${erro} A nota foi gravada sem os cheques: cancele-a e lance de novo, escolhendo outros cheques.`);
      const origem = await lerOrigem(tx, tenantId, titulo.dados, 'repassado');
      const renegociacao = await lerRenegociacaoDoTitulo(tx, tenantId, String(id), titulo.dados);
      cheques.push({ id: String(id), ...titulo, origem, renegociacao });
    }
    const totalCentavos = cheques.reduce((s, c) => s + centavosDoTitulo(c.dados), 0);
    if (totalCentavos !== Number(pagamento.totalCentavos)) {
      throw new ErroBaixa(409, `Os cheques somam ${reais(totalCentavos)}, mas a nota guardou ${reais(pagamento.totalCentavos)}. Algum cheque mudou de valor: cancele a nota e lance de novo.`);
    }

    // ---------------- ESCRITAS ----------------
    const fornecedor = { fornecedorId: String(nota.dados.fornecedorId || ''), fornecedorNome: String(nota.dados.fornecedorNome || '') };
    const numero = String(nota.dados.numero || '');
    const natureza = settledFinancialNatureForPayment('Cheque');
    cheques.forEach((c) => {
      tx.update(c.ref, {
        status: 'Paga',
        dataPagamento: hoje,
        naturezaFinanceira: natureza,
        movimentaCaixaFisico: false,
        recebidoEm: agora(),
        cheque: {
          ...(c.dados.cheque || {}),
          situacao: 'repassado',
          repassadoEm: hoje,
          repassadoA: { ...fornecedor, notaAvulsaId: nota.ref.id, numeroNota: numero },
          // O desfazer (cancelar a nota) devolve o titulo como estava.
          antesDoRepasse: { naturezaFinanceira: c.dados.naturezaFinanceira || null },
        },
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), `Cheque repassado a ${fornecedor.fornecedorNome} (Nota Avulsa #${numero})`),
      });
      registrarRecebimentoNaOrigem(tx, user, c.origem, c.id, c.dados, { amountCents: centavosDoTitulo(c.dados), method: 'Cheque', receivedAt: hoje }, 'Cheque repassado ao fornecedor');
      if (c.dados.pedidoId) resumo.vendas.add(String(c.dados.pedidoId));
    });
    const tituloRef = db.collection('transacoes').doc(idDoTituloDoRepasse(nota.ref.id));
    tx.set(tituloRef, {
      descricao: `Nota Avulsa #${numero} - ${fornecedor.fornecedorNome} (cheques de clientes)`,
      categoria: 'FORNECEDORES DE PEÇAS',
      tipo: 'saida',
      status: 'Paga',
      valor: fromCents(totalCentavos),
      valorCentavos: totalCentavos,
      data: hoje,
      dataVencimento: hoje,
      dataPagamento: hoje,
      formaPagamento: 'Cheque',
      naturezaFinanceira: natureza,
      movimentaCaixaFisico: false,
      ...fornecedor,
      notaAvulsaId: nota.ref.id,
      chequesRepassados: cheques.map((c) => ({
        transacaoId: c.id,
        numeroCheque: String((c.dados.cheque && c.dados.cheque.numeroCheque) || ''),
        clienteNome: String(c.dados.clienteNome || ''),
        centavos: centavosDoTitulo(c.dados),
      })),
      tenantId,
      createdAt: agora(),
      ...buildDocumentMetadata(user.uid, agora()),
    });
    tx.update(nota.ref, {
      pagamentoComCheques: { ...pagamento, situacao: 'repassado', transacaoId: tituloRef.id, repassadoEm: hoje },
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), 'Cheques de clientes repassados ao fornecedor'),
    });
    const quitados = new Set(cheques.map((c) => c.id));
    cheques.forEach((c) => {
      if (!c.renegociacao) return;
      const leitura = { ...c.renegociacao, outras: c.renegociacao.outras.map((o) => (quitados.has(o.id) ? { ...o, status: 'Paga' } : o)) };
      if (quitarOrigensSeRenegociacaoPaga(tx, user, leitura, hoje)) leitura.origens.forEach((o) => { if (o.ref.parent.id === 'pedidos_venda') resumo.vendas.add(o.ref.id); });
    });
    registrarLogNaTransacao(tx, { ...user, tenantId }, {
      modulo: 'estoque',
      acao: 'edicao',
      descricao: `Nota Avulsa #${numero} paga com ${cheques.length} cheque(s) de cliente repassado(s) a ${fornecedor.fornecedorNome}: ${reais(totalCentavos)} (${cheques.map((c) => `nº ${(c.dados.cheque && c.dados.cheque.numeroCheque) || '-'} de ${c.dados.clienteNome || '-'}`).join(', ')}).`,
      registroId: nota.ref.id,
      documentosRelacionados: cheques.map((c) => c.id),
      documentoTipo: 'nota_avulsa',
      documentoNumero: `Nota Avulsa ${numero}`,
    });
    resumo.totalCentavos = totalCentavos;
    resumo.quantidade = cheques.length;
  });
  for (const pedidoId of resumo.vendas) await cashback.gerarSeDevidoSemFalhar({ user, tenantId, pedidoId });
  return { jaRepassado: resumo.jaRepassado, totalCentavos: resumo.totalCentavos || 0, quantidade: resumo.quantidade || 0 };
};

/** Cancelar a nota: os cheques voltam para a carteira e o titulo do cliente volta a ficar em aberto. */
const desfazerRepasseDaNotaAvulsa = async ({ user, tenantId, notaAvulsaId }) => {
  exigir(user);
  const resumo = { desfeito: false };
  await db.runTransaction(async (tx) => {
    const nota = await lerNota(tx, tenantId, notaAvulsaId);
    const pagamento = nota.dados.pagamentoComCheques;
    if (!pagamento || pagamento.situacao !== 'repassado') return;
    const cheques = [];
    for (const id of pagamento.chequeIds || []) {
      const titulo = await lerTitulo(tx, tenantId, { transacaoId: String(id), tipo: 'entrada' });
      const c = titulo.dados.cheque || {};
      if (titulo.dados.status !== 'Paga' || c.situacao !== 'repassado' || !c.repassadoA || c.repassadoA.notaAvulsaId !== nota.ref.id) {
        throw new ErroBaixa(409, `O cheque nº ${c.numeroCheque || '-'} de ${titulo.dados.clienteNome || '-'} foi mexido depois do repasse. Confira em Financeiro > Cheques antes de cancelar a nota.`);
      }
      const origem = await lerOrigem(tx, tenantId, { ...titulo.dados, status: 'Pendente' }, 'estornado');
      const renegociacao = await lerRenegociacaoDoTitulo(tx, tenantId, String(id), titulo.dados);
      cheques.push({ id: String(id), ...titulo, origem, renegociacao });
    }
    const tituloRef = db.collection('transacoes').doc(String(pagamento.transacaoId || idDoTituloDoRepasse(nota.ref.id)));
    const tituloSnap = await tx.get(tituloRef);

    cheques.forEach((c) => devolverChequeACarteira(tx, user, c, `Nota Avulsa #${nota.dados.numero || ''} cancelada`));
    if (tituloSnap.exists && tituloSnap.data().tenantId === tenantId) {
      tx.update(tituloRef, { status: 'Cancelada', updatedAt: agora(), ...buildDocumentUpdateMetadata(user.uid, agora(), `Nota Avulsa #${nota.dados.numero || ''} cancelada`) });
    }
    tx.update(nota.ref, {
      pagamentoComCheques: { ...pagamento, situacao: 'desfeito' },
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), 'Repasse dos cheques desfeito'),
    });
    registrarLogNaTransacao(tx, { ...user, tenantId }, {
      modulo: 'estoque',
      acao: 'edicao',
      descricao: `Repasse dos cheques da Nota Avulsa #${nota.dados.numero || ''} desfeito: ${cheques.length} cheque(s) de volta na carteira.`,
      registroId: nota.ref.id,
      documentosRelacionados: cheques.map((c) => c.id),
      documentoTipo: 'nota_avulsa',
      documentoNumero: `Nota Avulsa ${nota.dados.numero || ''}`,
    });
    resumo.desfeito = true;
  });
  return resumo;
};

/**
 * Devolve um cheque repassado a' carteira (escritas, dentro da transacao):
 * titulo do cliente volta a ficar em aberto, venda/OS e renegociacao voltam
 * junto. `c` = { id, ref, dados, origem, renegociacao } lido antes das escritas.
 */
const devolverChequeACarteira = (tx, user, c, porque) => {
  const { situacao, repassadoEm, repassadoA, antesDoRepasse, ...chequeOriginal } = c.dados.cheque || {};
  tx.update(c.ref, {
    status: 'Pendente',
    dataPagamento: apagar(),
    recebidoEm: apagar(),
    naturezaFinanceira: (antesDoRepasse && antesDoRepasse.naturezaFinanceira) || 'contas_receber',
    cheque: { ...chequeOriginal, situacao: 'em_carteira' },
    updatedAt: agora(),
    ...buildDocumentUpdateMetadata(user.uid, agora(), `Repasse desfeito (${porque}); cheque de volta na carteira`),
  });
  if (c.origem.ref) {
    const pagamentos = Array.isArray(c.origem.dados.pagamentos) ? c.origem.dados.pagamentos : [];
    if (pagamentos.length > 0) {
      tx.update(c.origem.ref, {
        ...camposDoResumoDePagamentos(reversePaymentReceipt(pagamentos, { transactionId: c.id, paymentIndex: c.dados.paymentIndex })),
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), `Repasse de cheque desfeito (${porque})`),
      });
    }
  }
  reabrirOrigensSeRenegociacaoEstavaPaga(tx, user, c.renegociacao, 'repasse de cheque desfeito');
};

/*
 * CHEQUE DE CLIENTE PAGANDO UMA CONTA A PAGAR (28/11/2026, pedido do dono):
 * ao compensar, em vez do banco, a pessoa escolhe uma conta a pagar de
 * fornecedor e passa o cheque para ele. Mesmas regras do repasse na Nota Avulsa:
 *  - o titulo do cliente fica PAGO na data, sem entrar em banco ("Repassado a ...");
 *  - o cheque nao paga mais que a conta; cheque menor paga a conta EM PARTE
 *    (pagamento parcial: o resto fica em aberto, para outra forma);
 *  - estornar o pagamento da conta devolve o cheque a' carteira (baixaFinanceira.registrarEstorno).
 */
const PERMISSAO_CONTA = 'financeiro.cheque_pagar_conta';
const SEM_PERMISSAO_CONTA = 'Você não tem permissão para pagar conta a pagar com cheque de cliente. Peça ao responsável liberar "Financeiro: Cheques — pagar conta a pagar com cheque de cliente" no seu cadastro de funcionário.';
const exigirConta = (user) => { if (!temPermissao(user, PERMISSAO_CONTA)) throw new ErroBaixa(403, SEM_PERMISSAO_CONTA); };

/** A conta a pagar pode receber o cheque? Mensagem em portugues, ou null. */
const erroDaContaParaRepasse = (dados) => {
  const nome = `A conta "${(dados && dados.descricao) || 'sem descrição'}"`;
  if (!dados || dados.tipo !== 'saida') return 'A conta escolhida não é uma conta a pagar. Escolha de novo.';
  if (dados.status === STATUS_RENEGOCIADA) return `${nome} foi renegociada: escolha outra.`;
  if (dados.status !== 'Pendente') return `${nome} não está mais em aberto (talvez já tenha sido paga). Escolha outra.`;
  if (dados.cheque) return `${nome} já tem um cheque emitido esperando compensar: escolha outra conta.`;
  if (centavosDoTitulo(dados) <= 0) return `${nome} está sem valor: corrija o valor no Contas a Pagar.`;
  return null;
};

/** Contas a pagar em aberto que podem receber o cheque (para a tela escolher). */
const contasAPagarParaRepasse = async ({ user, tenantId }) => {
  exigirConta(user);
  const snap = await db.collection('transacoes')
    .where('tenantId', '==', tenantId).where('tipo', '==', 'saida').where('status', '==', 'Pendente')
    .get();
  return {
    contas: snap.docs
      .filter((d) => !erroDaContaParaRepasse(d.data()))
      .map((d) => {
        const t = d.data();
        return {
          id: d.id,
          descricao: String(t.descricao || ''),
          fornecedorNome: String(t.fornecedorNome || ''),
          categoria: String(t.categoria || ''),
          vencimento: String(t.dataVencimento || t.data || ''),
          centavos: centavosDoTitulo(t),
        };
      })
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.descricao.localeCompare(b.descricao)),
  };
};

/** Paga a conta a pagar (toda ou em parte) com o cheque recebido. Tudo numa transacao. */
const repassarParaContaAPagar = async ({ user, tenantId, corpo, hoje }) => {
  exigirConta(user);
  const chequeId = String((corpo && corpo.transacaoId) || '').trim();
  const contaId = String((corpo && corpo.contaPagarId) || '').trim();
  if (!ID_VALIDO.test(chequeId) || !ID_VALIDO.test(contaId)) throw new ErroBaixa(400, 'Cheque ou conta inválida. Atualize a tela e escolha de novo.');
  const resumo = { vendas: new Set() };
  await db.runTransaction(async (tx) => {
    // ---------------- LEITURAS ----------------
    const cheque = await lerTitulo(tx, tenantId, { transacaoId: chequeId, tipo: 'entrada' });
    const erroCheque = erroDoChequeParaRepassar(cheque.dados);
    if (erroCheque) throw new ErroBaixa(409, erroCheque);
    const conta = await lerTitulo(tx, tenantId, { transacaoId: contaId, tipo: 'saida' });
    const erroConta = erroDaContaParaRepasse(conta.dados);
    if (erroConta) throw new ErroBaixa(409, erroConta);
    const origem = await lerOrigem(tx, tenantId, cheque.dados, 'repassado');
    const renegociacao = await lerRenegociacaoDoTitulo(tx, tenantId, chequeId, cheque.dados);

    const chequeCentavos = centavosDoTitulo(cheque.dados);
    const contaCentavos = centavosDoTitulo(conta.dados);
    const descricaoConta = String(conta.dados.descricao || 'sem descrição');
    if (chequeCentavos <= 0) throw new ErroBaixa(400, 'Este cheque está sem valor. Confira o cheque em Financeiro > Cheques.');
    if (chequeCentavos > contaCentavos) {
      throw new ErroBaixa(409, `O cheque (${reais(chequeCentavos)}) é maior que a conta "${descricaoConta}" (${reais(contaCentavos)}). O cheque não pode pagar mais que a conta: escolha uma conta de valor igual ou maior, ou compense o cheque no banco.`);
    }

    // ---------------- ESCRITAS ----------------
    const parcial = chequeCentavos < contaCentavos;
    const numeroCheque = String((cheque.dados.cheque && cheque.dados.cheque.numeroCheque) || '');
    const clienteNome = String(cheque.dados.clienteNome || '');
    const fornecedor = { fornecedorId: String(conta.dados.fornecedorId || ''), fornecedorNome: String(conta.dados.fornecedorNome || '') };
    const pagoA = fornecedor.fornecedorNome || descricaoConta;
    const pagamentoRef = parcial ? db.collection('transacoes').doc() : conta.ref;
    const natureza = settledFinancialNatureForPayment('Cheque');
    const marcaDoCheque = { transacaoId: chequeId, numeroCheque, clienteNome, centavos: chequeCentavos };
    const baixaManual = montarBaixaManual({ origem: 'contas_pagar', formaPagamento: 'Cheque', dataPagamento: hoje, valorCentavos: chequeCentavos });
    const textoDoCheque = `cheque${numeroCheque ? ` nº ${numeroCheque}` : ''}${clienteNome ? ` de ${clienteNome}` : ''}`;

    tx.update(cheque.ref, {
      status: 'Paga',
      dataPagamento: hoje,
      naturezaFinanceira: natureza,
      movimentaCaixaFisico: false,
      recebidoEm: agora(),
      cheque: {
        ...(cheque.dados.cheque || {}),
        situacao: 'repassado',
        repassadoEm: hoje,
        repassadoA: { ...fornecedor, contaPagarId: conta.ref.id, pagamentoTransacaoId: pagamentoRef.id, descricaoConta },
        antesDoRepasse: { naturezaFinanceira: cheque.dados.naturezaFinanceira || null },
      },
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), `Cheque repassado a ${pagoA} (conta a pagar "${descricaoConta}")`),
    });
    registrarRecebimentoNaOrigem(tx, user, origem, chequeId, cheque.dados, { amountCents: chequeCentavos, method: 'Cheque', receivedAt: hoje }, 'Cheque repassado ao fornecedor');
    if (cheque.dados.pedidoId) resumo.vendas.add(String(cheque.dados.pedidoId));

    if (parcial) {
      const restanteCentavos = contaCentavos - chequeCentavos;
      tx.set(pagamentoRef, {
        tenantId,
        tipo: 'saida',
        status: 'Paga',
        descricao: `${descricaoConta} — pagamento parcial com ${textoDoCheque}`,
        ...camposDaContaNoParcial(conta.dados),
        valor: fromCents(chequeCentavos),
        valorCentavos: chequeCentavos,
        data: hoje,
        dataVencimento: conta.dados.dataVencimento || hoje,
        dataPagamento: hoje,
        formaPagamento: 'Cheque',
        naturezaFinanceira: natureza,
        movimentaCaixaFisico: false,
        parcialDaTransacaoId: conta.ref.id,
        chequeRecebidoRepassado: marcaDoCheque,
        baixaManual,
        createdAt: agora(),
        updatedAt: agora(),
        criadoPor: user.uid,
        criadoEm: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), `Pagamento parcial de "${descricaoConta}" com ${textoDoCheque}`),
      });
      tx.update(conta.ref, {
        valorCentavos: restanteCentavos,
        valor: fromCents(restanteCentavos),
        valorAntesDoParcialCentavos: Number(conta.dados.valorAntesDoParcialCentavos) > 0 ? Number(conta.dados.valorAntesDoParcialCentavos) : contaCentavos,
        pagoParcialCentavos: (Number(conta.dados.pagoParcialCentavos) || 0) + chequeCentavos,
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), `Pagamento parcial de ${reais(chequeCentavos)} com ${textoDoCheque}; fica em aberto ${reais(restanteCentavos)}`),
      });
      resumo.restanteCentavos = restanteCentavos;
    } else {
      tx.update(conta.ref, {
        status: 'Paga',
        dataPagamento: hoje,
        formaPagamento: 'Cheque',
        naturezaFinanceira: natureza,
        movimentaCaixaFisico: false,
        chequeRecebidoRepassado: marcaDoCheque,
        antesDoRepasse: {
          formaPagamento: conta.dados.formaPagamento || null,
          naturezaFinanceira: conta.dados.naturezaFinanceira || null,
        },
        baixaManual,
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), `Paga com ${textoDoCheque}`),
      });
      resumo.restanteCentavos = 0;
    }

    if (renegociacao) {
      const leitura = { ...renegociacao, outras: renegociacao.outras.map((o) => (o.id === chequeId ? { ...o, status: 'Paga' } : o)) };
      if (quitarOrigensSeRenegociacaoPaga(tx, user, leitura, hoje)) leitura.origens.forEach((o) => { if (o.ref.parent.id === 'pedidos_venda') resumo.vendas.add(o.ref.id); });
    }
    registrarLogNaTransacao(tx, { ...user, tenantId }, {
      modulo: 'financeiro',
      acao: 'edicao',
      descricao: `Conta a pagar "${descricaoConta}"${fornecedor.fornecedorNome ? ` (${fornecedor.fornecedorNome})` : ''} ${parcial ? 'paga em parte' : 'paga'} com ${textoDoCheque}: ${reais(chequeCentavos)}${parcial ? `; fica em aberto ${reais(contaCentavos - chequeCentavos)}` : ''}.`,
      registroId: conta.ref.id,
      documentosRelacionados: [chequeId, pagamentoRef.id].filter((id) => id !== conta.ref.id),
      documentoTipo: 'conta_pagar',
      documentoNumero: `Conta a pagar ${descricaoConta}`,
    });
    resumo.descricao = descricaoConta;
    resumo.fornecedorNome = fornecedor.fornecedorNome;
    resumo.valorCentavos = chequeCentavos;
    resumo.parcial = parcial;
  });
  for (const pedidoId of resumo.vendas) await cashback.gerarSeDevidoSemFalhar({ user, tenantId, pedidoId });
  return {
    descricao: resumo.descricao,
    fornecedorNome: resumo.fornecedorNome,
    valorCentavos: resumo.valorCentavos,
    parcial: resumo.parcial,
    restanteCentavos: resumo.restanteCentavos,
  };
};

/**
 * Estorno do pagamento de uma conta paga com cheque de cliente: le o cheque
 * (leituras, antes das escritas do estorno). Cheque mexido depois = 409.
 */
const lerChequeDoRepasse = async (tx, tenantId, pagamentoId, dadosDoPagamento) => {
  const id = String((dadosDoPagamento.chequeRecebidoRepassado && dadosDoPagamento.chequeRecebidoRepassado.transacaoId) || '');
  if (!ID_VALIDO.test(id)) return null;
  const titulo = await lerTitulo(tx, tenantId, { transacaoId: id, tipo: 'entrada' });
  const c = titulo.dados.cheque || {};
  if (titulo.dados.status !== 'Paga' || c.situacao !== 'repassado' || !c.repassadoA || c.repassadoA.pagamentoTransacaoId !== pagamentoId) {
    throw new ErroBaixa(409, `O cheque nº ${c.numeroCheque || '-'} de ${titulo.dados.clienteNome || '-'} foi mexido depois de pagar esta conta. Confira em Financeiro > Cheques antes de estornar.`);
  }
  const origem = await lerOrigem(tx, tenantId, { ...titulo.dados, status: 'Pendente' }, 'estornado');
  const renegociacao = await lerRenegociacaoDoTitulo(tx, tenantId, id, titulo.dados);
  return { id, ...titulo, origem, renegociacao };
};

module.exports = {
  PERMISSAO,
  PERMISSAO_CONTA,
  chequesNaCarteira,
  repassarNaNotaAvulsa,
  desfazerRepasseDaNotaAvulsa,
  erroDoChequeParaRepassar,
  erroDaContaParaRepasse,
  contasAPagarParaRepasse,
  repassarParaContaAPagar,
  lerChequeDoRepasse,
  devolverChequeACarteira,
};
