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
const { ErroBaixa, agora, apagar, lerTitulo, lerOrigem, centavosDoTitulo, camposDoResumoDePagamentos, temPermissao } = require('./baixaFinanceira');
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

    cheques.forEach((c) => {
      const { situacao, repassadoEm, repassadoA, antesDoRepasse, ...chequeOriginal } = c.dados.cheque || {};
      tx.update(c.ref, {
        status: 'Pendente',
        dataPagamento: apagar(),
        recebidoEm: apagar(),
        naturezaFinanceira: (antesDoRepasse && antesDoRepasse.naturezaFinanceira) || 'contas_receber',
        cheque: { ...chequeOriginal, situacao: 'em_carteira' },
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), `Repasse desfeito: Nota Avulsa #${nota.dados.numero || ''} cancelada; cheque de volta na carteira`),
      });
      if (c.origem.ref) {
        const pagamentos = Array.isArray(c.origem.dados.pagamentos) ? c.origem.dados.pagamentos : [];
        if (pagamentos.length > 0) {
          tx.update(c.origem.ref, {
            ...camposDoResumoDePagamentos(reversePaymentReceipt(pagamentos, { transactionId: c.id, paymentIndex: c.dados.paymentIndex })),
            updatedAt: agora(),
            ...buildDocumentUpdateMetadata(user.uid, agora(), 'Repasse de cheque desfeito (nota avulsa cancelada)'),
          });
        }
      }
      reabrirOrigensSeRenegociacaoEstavaPaga(tx, user, c.renegociacao, 'repasse de cheque desfeito');
    });
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

module.exports = { PERMISSAO, chequesNaCarteira, repassarNaNotaAvulsa, desfazerRepasseDaNotaAvulsa, erroDoChequeParaRepassar };
