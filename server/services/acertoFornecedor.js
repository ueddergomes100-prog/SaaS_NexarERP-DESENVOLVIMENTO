const { admin, db } = require('../config/firebase');
const ad = require('../domain/acertoFornecedorDomain');
const { bloqueioDoParcial } = require('../domain/baixaParcialDomain');
const { isCardPayment } = require('../domain/financeDomain');
const { ErroBaixa, registrarBaixa, registrarEstorno, hojeNoBrasil, centavosDoTitulo } = require('./baixaFinanceira');
const { registrarLog } = require('./auditoria');

/**
 * ACERTO COM FORNECEDOR (24/11/2026, pedido do dono para a Jomarly): o cliente
 * paga direto o fornecedor. Regra em src/utils/acertoFornecedorDomain.ts.
 *
 *   registrar -> confere tudo, grava o acerto e da' baixa nas duas pontas com a
 *                forma "Acerto com Fornecedor" (sem caixa, sem banco)
 *   desfazer  -> estorna as duas pontas juntas, com motivo
 *   listar    -> os ultimos acertos da empresa
 *
 * Cada conta e' baixada pela MESMA registrarBaixa de sempre (parcial, venda/OS
 * de origem, renegociacao, cashback), em sequencia, como a baixa em lote: uma
 * transacao por conta. Antes de gravar a primeira, todas sao lidas e
 * conferidas; se mesmo assim uma falhar no meio (outra pessoa mexeu na conta
 * naquele instante), as ja' baixadas sao estornadas e nada fica pela metade.
 *
 * Colecao `acertos_fornecedor`: so' do servidor (sem regra no Firestore).
 */

const COLECAO = 'acertos_fornecedor';
const LIMITE_DA_LISTA = 100;

const TS = () => admin.firestore.FieldValue.serverTimestamp();
const texto = (v) => String(v ?? '').trim();
const reais = ad.reaisDoAcerto;

/** Conta em cheque, boleto emitido ou cartao: tem caminho proprio e nao entra no acerto. */
const bloqueioDaConta = (dados, lado) => {
  if (dados.cheque || dados.formaPagamento === 'Cheque') {
    return lado === 'receber'
      ? 'ela está em cheque aguardando compensação (Financeiro › Cheques).'
      : 'ela foi paga com cheque emitido (Financeiro › Cheques).';
  }
  const boleto = dados.boleto && typeof dados.boleto === 'object' ? dados.boleto : null;
  if (lado === 'receber' && boleto && boleto.nossoNumero && boleto.status !== 'cancelado' && !boleto.baixaPorPrazo) {
    return 'ela tem boleto emitido. Desfaça a emissão em Financeiro › Boletos antes.';
  }
  if (lado === 'receber' && isCardPayment(dados.formaPagamento)) {
    return 'ela é de cartão e é conciliada na tela Banco.';
  }
  return '';
};

const chaveDoDevedor = (dados) => {
  if (dados.fornecedorId) return `fornecedor:${dados.fornecedorId}`;
  if (dados.clienteId) return `cliente:${dados.clienteId}`;
  return '';
};

const nomeDoDevedor = (dados) => texto(dados.fornecedorId ? dados.fornecedorNome : dados.clienteNome) || texto(dados.clienteNome) || texto(dados.fornecedorNome);

/** Le e confere um lado inteiro antes de qualquer gravacao. */
const lerLado = async (tenantId, lado, contas) => {
  const snaps = await db.getAll(...contas.map((c) => db.collection('transacoes').doc(c.transacaoId)));
  return contas.map((conta, i) => {
    const snap = snaps[i];
    const dados = snap.exists && snap.data().tenantId === tenantId ? snap.data() : null;
    const saldoCentavos = dados ? centavosDoTitulo(dados) : 0;
    const parcial = dados ? conta.valorCentavos < saldoCentavos : false;
    const bloqueio = dados ? (bloqueioDaConta(dados, lado) || (parcial ? bloqueioDoParcial(dados) : '')) : '';
    const erro = ad.erroDaContaNoAcerto(lado, {
      existe: Boolean(dados),
      tipo: dados?.tipo,
      status: dados?.status,
      saldoCentavos,
      descricao: dados?.descricao,
      bloqueio,
    }, conta.valorCentavos);
    if (erro) throw new ErroBaixa(dados && dados.status === 'Paga' ? 409 : 400, erro);
    return { ...conta, dados, saldoCentavos };
  });
};

const publico = (id, d) => ({
  id,
  status: d.status,
  data: texto(d.data),
  totalCentavos: Number(d.totalCentavos) || 0,
  clienteNome: texto(d.clienteNome),
  fornecedores: Array.isArray(d.fornecedores) ? d.fornecedores.map(texto) : [],
  observacao: texto(d.observacao),
  receber: (Array.isArray(d.receber) ? d.receber : []).map((c) => ({ transacaoId: texto(c.transacaoId), descricao: texto(c.descricao), valorCentavos: Number(c.valorCentavos) || 0, restanteCentavos: Number(c.restanteCentavos) || 0 })),
  pagar: (Array.isArray(d.pagar) ? d.pagar : []).map((c) => ({ transacaoId: texto(c.transacaoId), descricao: texto(c.descricao), fornecedorNome: texto(c.fornecedorNome), valorCentavos: Number(c.valorCentavos) || 0, restanteCentavos: Number(c.restanteCentavos) || 0 })),
  criadoPorNome: texto(d.criadoPorNome),
  criadoEmIso: d.criadoEm && typeof d.criadoEm.toDate === 'function' ? d.criadoEm.toDate().toISOString() : (d.criadoEm instanceof Date ? d.criadoEm.toISOString() : ''),
  motivoDoEstorno: texto(d.motivoDoEstorno),
});

const registrar = async ({ user, tenantId, corpo, usuarioNome = '' }) => {
  const lido = ad.lerPedidoDeAcerto(corpo, hojeNoBrasil());
  if ('erro' in lido) throw new ErroBaixa(400, lido.erro);
  const { pedido } = lido;
  const ref = db.collection(COLECAO).doc(`acerto_${pedido.idAcerto}`);

  // Reenvio do mesmo acerto (a internet caiu depois de gravar): devolve o que ja' existe.
  const existente = await ref.get();
  if (existente.exists) {
    if (existente.data().tenantId !== tenantId) throw new ErroBaixa(400, 'Acerto inválido. Atualize a tela e tente de novo.');
    if (existente.data().status === 'concluido') return { acerto: publico(ref.id, existente.data()), repetido: true };
    throw new ErroBaixa(409, 'Este acerto já foi enviado e não foi concluído. Atualize a tela, confira as contas e comece um acerto novo.');
  }

  // --- confere tudo antes de gravar ---
  const receber = await lerLado(tenantId, 'receber', pedido.receber);
  const pagar = await lerLado(tenantId, 'pagar', pedido.pagar);
  const erroDevedor = ad.erroDeDevedoresDiferentes(receber.map((c) => chaveDoDevedor(c.dados)));
  if (erroDevedor) throw new ErroBaixa(400, erroDevedor);

  const clienteNome = nomeDoDevedor(receber[0].dados);
  const fornecedores = [...new Set(pagar.map((c) => texto(c.dados.fornecedorNome) || texto(c.dados.descricao)).filter(Boolean))];
  const totalCentavos = ad.totalDoLado(pedido.receber);
  const linha = (c, lado) => ({
    transacaoId: c.transacaoId,
    descricao: texto(c.dados.descricao),
    valorCentavos: c.valorCentavos,
    restanteCentavos: c.saldoCentavos - c.valorCentavos,
    ...(lado === 'pagar' ? { fornecedorNome: texto(c.dados.fornecedorNome) } : {}),
  });
  const base = {
    tenantId,
    idAcerto: pedido.idAcerto,
    status: 'em_andamento',
    data: pedido.data,
    totalCentavos,
    clienteNome,
    clienteId: receber[0].dados.clienteId || null,
    fornecedores,
    observacao: pedido.observacao,
    receber: receber.map((c) => linha(c, 'receber')),
    pagar: pagar.map((c) => linha(c, 'pagar')),
    criadoPor: user.uid,
    criadoPorNome: usuarioNome,
    criadoEm: TS(),
  };
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) throw new ErroBaixa(409, 'Este acerto já está sendo gravado. Aguarde e atualize a tela.');
    tx.set(ref, base);
  });

  // --- baixa das duas pontas, uma conta por vez ---
  const feitas = [];
  const baixar = async (lado, conta) => {
    const tipo = lado === 'receber' ? 'entrada' : 'saida';
    const resumo = await registrarBaixa({
      user,
      tenantId,
      pedido: {
        tipo,
        transacaoId: conta.transacaoId,
        formaPagamento: ad.FORMA_ACERTO_FORNECEDOR,
        dataPagamento: pedido.data,
        valorRecebidoCentavos: conta.valorCentavos,
        acertoFornecedor: { id: ref.id, texto: ad.textoDoAcertoNaConta(lado, { cliente: clienteNome, fornecedores }) },
      },
    });
    feitas.push({ lado, tipo, transacaoId: conta.transacaoId, baixaId: resumo.parcial ? resumo.parcial.transacaoId : conta.transacaoId });
  };
  try {
    for (const conta of receber) await baixar('receber', conta);
    for (const conta of pagar) await baixar('pagar', conta);
  } catch (erro) {
    // Volta o que ja' tinha sido baixado: o acerto nao fica pela metade.
    const naoVoltaram = [];
    for (const feita of [...feitas].reverse()) {
      try {
        await registrarEstorno({ user, tenantId, pedido: { tipo: feita.tipo, transacaoId: feita.baixaId, motivo: 'Acerto com fornecedor não concluído: baixa desfeita automaticamente', peloAcerto: true } });
      } catch (erroDoEstorno) {
        console.error('[Acerto com fornecedor] não foi possível desfazer a baixa', feita.baixaId, erroDoEstorno);
        naoVoltaram.push(feita.baixaId);
      }
    }
    const motivo = erro instanceof ErroBaixa ? erro.message : 'erro inesperado ao dar baixa';
    await ref.update({ status: 'falhou', erro: motivo, baixasQueNaoVoltaram: naoVoltaram, atualizadoEm: TS() }).catch(() => {});
    if (!(erro instanceof ErroBaixa)) console.error('[Acerto com fornecedor] erro ao dar baixa:', erro);
    if (naoVoltaram.length > 0) {
      throw new ErroBaixa(409, `O acerto não foi concluído (${motivo}) e ${naoVoltaram.length} conta(s) ficaram baixadas. Confira as contas deste cliente e dos fornecedores e estorne as que aparecerem como "Acerto com Fornecedor", ou chame o suporte.`);
    }
    throw new ErroBaixa(erro instanceof ErroBaixa ? erro.status : 500, `O acerto não foi feito: ${motivo} Nada foi alterado.`);
  }

  const baixaDe = (transacaoId) => feitas.find((f) => f.transacaoId === transacaoId)?.baixaId || transacaoId;
  const final = {
    status: 'concluido',
    receber: base.receber.map((c) => ({ ...c, baixaId: baixaDe(c.transacaoId) })),
    pagar: base.pagar.map((c) => ({ ...c, baixaId: baixaDe(c.transacaoId) })),
    concluidoEm: TS(),
  };
  await ref.update(final);

  registrarLog({ ...user, tenantId }, {
    modulo: 'financeiro',
    acao: 'acerto_fornecedor',
    descricao: `Acerto com fornecedor de ${reais(totalCentavos)}: ${clienteNome || 'cliente'} pagou direto ${fornecedores.join(', ') || 'fornecedor'} em ${pedido.data.split('-').reverse().join('/')}. `
      + `Contas do cliente: ${base.receber.map((c) => `"${c.descricao}" ${reais(c.valorCentavos)}`).join('; ')}. `
      + `Contas pagas: ${base.pagar.map((c) => `"${c.descricao}" ${reais(c.valorCentavos)}`).join('; ')}. Não movimentou caixa nem banco.`
      + (pedido.observacao ? ` Obs.: ${pedido.observacao}` : ''),
    registroId: ref.id,
    documentosRelacionados: [...pedido.receber, ...pedido.pagar].map((c) => c.transacaoId),
    documentoTipo: 'conta_receber',
    documentoNumero: `Acerto com fornecedor de ${clienteNome || 'cliente'}`,
    critico: true,
  });

  return { acerto: publico(ref.id, { ...base, ...final, criadoEm: new Date() }), repetido: false };
};

const desfazer = async ({ user, tenantId, corpo }) => {
  const lido = ad.lerPedidoDeDesfazerAcerto(corpo);
  if ('erro' in lido) throw new ErroBaixa(400, lido.erro);
  const { acertoId, motivo } = lido.pedido;
  const ref = db.collection(COLECAO).doc(acertoId);
  const snap = await ref.get();
  if (!snap.exists || snap.data().tenantId !== tenantId) throw new ErroBaixa(404, 'Este acerto não existe mais. Atualize a tela.');
  const acerto = snap.data();
  if (acerto.status === 'estornado') throw new ErroBaixa(409, 'Este acerto já foi desfeito. Atualize a tela.');
  if (acerto.status !== 'concluido') throw new ErroBaixa(400, 'Este acerto não foi concluído, então não há o que desfazer.');

  // Primeiro os fornecedores, depois o cliente; o que ja' voltou (tentativa anterior) e' pulado.
  const itens = [
    ...(acerto.pagar || []).map((c) => ({ tipo: 'saida', ...c })),
    ...(acerto.receber || []).map((c) => ({ tipo: 'entrada', ...c })),
  ].filter((c) => c.baixaId);
  const snaps = itens.length > 0 ? await db.getAll(...itens.map((c) => db.collection('transacoes').doc(c.baixaId))) : [];
  const aDesfazer = itens.filter((c, i) => snaps[i].exists && snaps[i].data().tenantId === tenantId && snaps[i].data().status === 'Paga');

  for (const item of aDesfazer) {
    try {
      await registrarEstorno({ user, tenantId, pedido: { tipo: item.tipo, transacaoId: item.baixaId, motivo: `Acerto com fornecedor desfeito: ${motivo}`, peloAcerto: true } });
    } catch (erro) {
      const frase = erro instanceof ErroBaixa ? erro.message : 'erro inesperado';
      if (!(erro instanceof ErroBaixa)) console.error('[Acerto com fornecedor] erro ao desfazer:', erro);
      throw new ErroBaixa(409, `Não foi possível desfazer a conta "${item.descricao}": ${frase} As contas que já tinham voltado continuam em aberto; resolva esta e clique em Desfazer de novo.`);
    }
  }

  await ref.update({ status: 'estornado', motivoDoEstorno: motivo, estornadoPor: user.uid, estornadoEm: TS() });
  registrarLog({ ...user, tenantId }, {
    modulo: 'financeiro',
    acao: 'estorno',
    descricao: `Acerto com fornecedor de ${reais(Number(acerto.totalCentavos) || 0)} (${texto(acerto.clienteNome) || 'cliente'} → ${(acerto.fornecedores || []).join(', ') || 'fornecedor'}) desfeito: as contas do cliente e dos fornecedores voltaram a ficar em aberto. Motivo: ${motivo}`,
    registroId: ref.id,
    documentosRelacionados: itens.map((c) => c.transacaoId),
    documentoTipo: 'conta_receber',
    documentoNumero: `Acerto com fornecedor de ${texto(acerto.clienteNome) || 'cliente'}`,
    motivo,
    critico: true,
  });
  return { acerto: publico(ref.id, { ...acerto, status: 'estornado', motivoDoEstorno: motivo }) };
};

const listar = async ({ tenantId }) => {
  const snap = await db.collection(COLECAO).where('tenantId', '==', tenantId).get();
  return snap.docs
    .map((d) => publico(d.id, d.data()))
    .filter((a) => a.status === 'concluido' || a.status === 'estornado')
    .sort((a, b) => b.data.localeCompare(a.data) || b.criadoEmIso.localeCompare(a.criadoEmIso))
    .slice(0, LIMITE_DA_LISTA);
};

module.exports = { COLECAO, registrar, desfazer, listar };
