/*
 * OS PELO SERVIDOR (item 8 da auditoria, fatia 3d -- 19/10/2026).
 *
 * Finalizar, reabrir e cancelar a Ordem de Servico gravavam pelo navegador o
 * estoque, os lotes, a comissao, os lancamentos e o SALDO DO BANCO. Com a chave
 * "Venda pelo servidor" ligada para a empresa (SuperAdmin), a tela grava so' os
 * dados da OS (cliente, veiculo, servicos, pecas, desconto) e chama aqui; o
 * dinheiro e o estoque saem desta transacao, com todas as leituras antes das
 * escritas.
 *
 * A regra mora em src/utils/osFechamentoDomain.ts (compilada para
 * server/domain): a tela com a chave desligada executa o MESMO plano. Decisoes
 * do dono de 19/10/2026 (valem nos dois caminhos): cancelar pede motivo e fica
 * bloqueado com nota fiscal autorizada; devolver as pecas e' opcional e devolve
 * o que saiu (gravado na OS); reabrir com parcela ja' recebida fica bloqueado;
 * a comissao fica "reaberta" e e' refeita ao finalizar de novo.
 *
 * Igual a venda (fatia 3a): o preco de cada item e o desconto (com a aprovacao
 * por senha) ainda vem da OS gravada pela tela -- o servidor refaz a conta, mas
 * nao reprecifica nem reconfere o limite de desconto.
 */
const { admin, db } = require('../config/firebase');
const fin = require('../domain/financeDomain');
const osf = require('../domain/osFechamentoDomain');
const credito = require('../domain/creditoDomain');
const { configFinanceiraDaEmpresa } = require('../domain/vendaFechamentoDomain');
const { parseParametrosVenda, bloqueioPorAtraso } = require('../domain/parametrosVendaDomain');
const { bloqueioParaRefazerParcelas } = require('../domain/alteracaoValorTituloDomain');
const { buildDocumentMetadata, buildDocumentUpdateMetadata } = require('../domain/documentMetadata');
const { getDateInputInTimeZone } = require('../domain/dateTime');
const { ErroVenda, situacaoDoCliente, lerColecaoDaEmpresa } = require('./vendaFechamento');

const agora = () => admin.firestore.FieldValue.serverTimestamp();
const incremento = (n) => admin.firestore.FieldValue.increment(n);

const refDaOs = (osId) => db.collection('ordens_de_servico').doc(osId);

const lerOs = (snap, tenantId) => {
  if (!snap.exists || snap.data().tenantId !== tenantId) throw new ErroVenda(404, 'Esta OS não existe mais. Atualize a lista de Ordens de Serviço.');
  return snap.data();
};

/** Lancamentos da OS: os dos pagamentos gravados + os que apontam para a OS (recebimento parcial). Consulta fora da transacao. */
const refsDosTitulos = async (tenantId, osId, pagamentos) => {
  const snap = await db.collection('transacoes').where('tenantId', '==', tenantId).where('osId', '==', osId).get();
  const ids = new Set([...osf.idsDosTitulosGravados(osId, pagamentos), ...snap.docs.map((d) => d.id)]);
  return [...ids].map((id) => db.collection('transacoes').doc(id));
};

const lerTitulos = async (tx, refs, tenantId) => {
  const snaps = refs.length ? await tx.getAll(...refs) : [];
  return snaps.filter((s) => s.exists && s.data().tenantId === tenantId).map((s) => ({ id: s.id, dados: s.data() }));
};

/** Saldo atual dos bancos que vao mudar (banco de outra empresa ou apagado fica de fora). */
const lerSaldos = async (tx, ids, tenantId) => {
  const saldos = new Map();
  for (const bancoId of ids) {
    const s = await tx.get(db.collection('bancos').doc(bancoId));
    if (s.exists && s.data().tenantId === tenantId) saldos.set(bancoId, Number(s.data().saldoCentavos || 0));
  }
  return saldos;
};

const lerProdutos = async (tx, ids, tenantId) => {
  const refs = ids.map((id) => db.collection('estoque').doc(id));
  const produtos = {};
  (refs.length ? await tx.getAll(...refs) : []).forEach((s) => {
    if (!s.exists) return;
    if (s.data().tenantId !== tenantId) throw new ErroVenda(400, 'Uma das peças da OS não é desta empresa. Remova a peça e lance de novo.');
    produtos[s.id] = s.data();
  });
  return produtos;
};

/** Escritas de estoque com a conferencia de saldo e de reserva (regra em osFechamentoDomain). */
const escritasDeEstoque = (deltas, produtos, permitirSemEstoque) => deltas.flatMap((d) => {
  const saldo = osf.novoSaldoDoProduto(d, produtos[d.id], permitirSemEstoque);
  if (!saldo) return []; // produto apagado: a tela tambem pulava
  if ('erro' in saldo) throw new ErroVenda(409, saldo.erro);
  return [[d.id, { ...saldo, updatedAt: agora() }]];
});

const usuarioNome = (user) => user.nome || user.email || 'Usuário';

// ===========================================================================
// FINALIZAR
// ===========================================================================

const finalizarOs = async ({ user, tenantId, corpo }) => {
  const lido = osf.lerPedidoDeFinalizacaoDaOs(corpo);
  if ('erro' in lido) throw new ErroVenda(400, lido.erro);
  const pedido = lido.pedido;
  const osRef = refDaOs(pedido.osId);

  const antes = lerOs(await osRef.get(), tenantId);
  const numeroAntes = String(antes.numeroOS || '');
  // Mesmo envio repetido (a conexao caiu depois de gravar): nao finaliza duas vezes.
  if (antes.status === osf.STATUS_OS_FINALIZADA) {
    if (antes.fechadoPeloServidor === true) {
      return { jaEnviado: true, osId: osRef.id, numeroOS: numeroAntes, totalCentavos: Number(antes.valorTotalCentavos || 0), formaPagamento: String(antes.formaPagamento || '') };
    }
    throw new ErroVenda(409, `A OS #${numeroAntes} já está finalizada. Atualize a tela.`);
  }
  if (antes.status === osf.STATUS_OS_CANCELADA) throw new ErroVenda(409, osf.mensagemOsCanceladaNaoReabre(numeroAntes));

  const configSnap = await db.collection('configuracoes').doc(tenantId).get();
  const config = configSnap.exists ? configSnap.data() : {};
  const permitirSemEstoque = config.venderSemEstoque === true;

  // Pagamentos: a mesma conta da tela, sobre o total da OS GRAVADA.
  const totais = osf.totaisDaOs(antes);
  const financeiro = configFinanceiraDaEmpresa(config);
  const [bandeiras, bancosDaEmpresa] = await Promise.all([
    lerColecaoDaEmpresa('bandeiras_cartao', tenantId),
    lerColecaoDaEmpresa('bancos', tenantId),
  ]);
  let pagamentos;
  try {
    pagamentos = fin.normalizePayments(totais.valorTotalCentavos, pedido.pagamentos, {
      saleDate: pedido.dataSaida,
      operationLabel: 'OS',
      maxCreditInstallments: financeiro.maxCreditInstallments || undefined,
      creditFeePercentByInstallment: financeiro.creditFeePercentByInstallment,
      debitFeePercent: financeiro.debitFeePercent,
      creditSettlementDays: financeiro.creditSettlementDays,
      debitSettlementDays: financeiro.debitSettlementDays,
      cardFeeSchedulesByBrand: fin.buildCardFeeSchedulesByBrand(bandeiras),
      pagamentoCartaoSimplificadoAtivo: fin.parsePagamentoCartaoSimplificadoAtivo(config.pagamentoCartaoSimplificadoAtivo),
      bancoPadraoSimplificado: fin.resolveBancoPadraoSimplificado(bancosDaEmpresa.map((b) => ({ id: b.id, nome: String(b.nome || ''), ativo: b.ativo }))),
    });
  } catch (erro) {
    throw new ErroVenda(400, erro instanceof Error && erro.message ? erro.message : 'Revise os dados do pagamento.');
  }
  pagamentos = fin.explodeInstallmentPaymentRecords(pagamentos);
  const aPrazo = fin.summarizePayments(pagamentos).paymentCondition === 'aprazo';

  // Atraso e limite de credito (OS a prazo). Saldo lido FORA da transacao; a
  // versao do credito do cliente e' reconferida la dentro.
  const clienteId = antes.clienteId ? String(antes.clienteId) : '';
  const clienteNome = String(antes.clienteNome || '').trim().toUpperCase();
  const parametros = parseParametrosVenda(config.parametrosVenda);
  const comLimite = credito.parseTrabalhaComLimiteCredito(config.trabalhaComLimiteCredito) && aPrazo;
  let creditoVersaoNaChecagem = 0;
  if (aPrazo && clienteId && (parametros.bloqueioAtraso.ativo || comLimite)) {
    const situacao = await situacaoDoCliente({ user, tenantId, clienteId, noGrupo: Boolean(config.grupoId) });
    if (parametros.bloqueioAtraso.ativo) {
      const bloqueio = bloqueioPorAtraso(parametros, situacao.maiorAtrasoDias, clienteNome);
      if (bloqueio) throw new ErroVenda(409, bloqueio);
    }
    if (comLimite) {
      const clienteSnap = await db.collection('clientes').doc(clienteId).get();
      const cliente = clienteSnap.exists && clienteSnap.data().tenantId === tenantId ? clienteSnap.data() : null;
      const limite = cliente && cliente.limiteDeCredito != null ? Math.round(Number(cliente.limiteDeCredito) * 100) : null;
      creditoVersaoNaChecagem = credito.parseCreditoVersao(cliente ? cliente[credito.CAMPO_CREDITO_VERSAO] : 0);
      const checagem = credito.excedeLimiteCredito(limite, situacao.saldoCentavos, totais.valorTotalCentavos);
      if (checagem.bloqueado) {
        throw new ErroVenda(409, checagem.motivo === 'sem_limite'
          ? `O cliente "${clienteNome}" não tem limite de crédito cadastrado. Não é possível vender a prazo.`
          : 'Esta OS ultrapassaria o limite de crédito do cliente (saldo em aberto + valor desta OS).');
      }
    }
  } else if (comLimite) {
    throw new ErroVenda(409, `O cliente "${clienteNome}" não tem limite de crédito cadastrado. Não é possível vender a prazo.`);
  }

  // Comissao por servico: o percentual proprio do servico vem do cadastro (consulta).
  const idsServicos = [...new Set((Array.isArray(antes.servicos) ? antes.servicos : []).map((s) => String((s && s.id) || '')).filter(Boolean))];
  const percentuaisServicos = {};
  if (idsServicos.length) {
    (await db.getAll(...idsServicos.map((id) => db.collection('servicos').doc(id)))).forEach((s) => {
      if (s.exists && s.data().tenantId === tenantId && typeof s.data().comissaoPercentual === 'number') percentuaisServicos[s.id] = s.data().comissaoPercentual;
    });
  }

  const idsDosTitulos = [...new Set([
    ...osf.idsDosTitulosGravados(osRef.id, antes.pagamentos),
    ...pagamentos.map((_, indice) => osf.idDoTituloDaOs(osRef.id, indice)),
  ])];

  return db.runTransaction(async (tx) => {
    // ---------------- LEITURAS ----------------
    const os = lerOs(await tx.get(osRef), tenantId);
    const numeroOS = String(os.numeroOS || '');
    if (os.status === osf.STATUS_OS_FINALIZADA || os.status === osf.STATUS_OS_CANCELADA) {
      throw new ErroVenda(409, `A OS #${numeroOS} mudou de situação enquanto você finalizava (talvez por outra pessoa). Atualize a tela.`);
    }
    if (osf.totaisDaOs(os).valorTotalCentavos !== totais.valorTotalCentavos) {
      throw new ErroVenda(409, `O valor da OS #${numeroOS} mudou enquanto você finalizava. Atualize a tela e finalize de novo.`);
    }

    const mecanicoId = String(os.mecanicoId || '');
    let mecanico = null;
    if (mecanicoId) {
      const s = await tx.get(db.collection('usuarios').doc(mecanicoId));
      if (s.exists) {
        if (s.data().tenantId !== tenantId) throw new ErroVenda(400, 'O técnico escolhido não pertence à empresa ativa. Escolha outro técnico na OS.');
        mecanico = s.data();
      }
    }

    const pecas = Array.isArray(os.pecas) ? os.pecas : [];
    const idsProdutos = [...new Set(pecas.map((p) => String((p && p.id) || '')).filter((id) => id && id !== 'avulso'))];
    const produtos = await lerProdutos(tx, idsProdutos, tenantId);

    // Lotes: so' peca que controla lote; a soma tem de bater com a quantidade da linha.
    const lotesPorLinha = {};
    const usoPorLote = new Map();
    if (os.estoqueBaixado !== true) {
      pecas.forEach((peca, indice) => {
        const produto = produtos[peca && peca.id];
        if (!produto || produto.controlarLote !== true) return;
        const lotes = pedido.lotes[String(indice)] || [];
        const soma = lotes.reduce((t, l) => t + l.quantidade, 0);
        if (Math.abs(soma - Number(peca.quantidade || 0)) > 1e-6) {
          throw new ErroVenda(400, `${peca.nome || 'Peça'}: escolha de novo de qual lote sai (a quantidade dos lotes não bate com a da OS).`);
        }
        lotes.forEach((l) => {
          const atual = usoPorLote.get(l.loteId) || { quantidade: 0, produtoId: peca.id, nome: peca.nome, lote: l.lote };
          if (atual.produtoId !== peca.id) throw new ErroVenda(400, `${peca.nome || 'Peça'}: lote de outro produto. Escolha o lote de novo.`);
          atual.quantidade += l.quantidade;
          usoPorLote.set(l.loteId, atual);
        });
        lotesPorLinha[String(indice)] = lotes;
      });
    }
    const loteRefs = [...usoPorLote.keys()].map((id) => db.collection('estoque_lotes').doc(id));
    const lotesAtuais = {};
    (loteRefs.length ? await tx.getAll(...loteRefs) : []).forEach((s) => {
      const uso = usoPorLote.get(s.id);
      if (!s.exists || s.data().tenantId !== tenantId || s.data().produtoId !== uso.produtoId) {
        throw new ErroVenda(400, `${uso.nome || 'Peça'}: o lote ${uso.lote || ''} não existe mais. Escolha o lote de novo.`);
      }
      lotesAtuais[s.id] = Number(s.data().quantidade || 0);
    });

    // Parcela com valor alterado ou renegociada: refazer as parcelas apagaria isso.
    const titulos = await lerTitulos(tx, idsDosTitulos.map((id) => db.collection('transacoes').doc(id)), tenantId);
    const bloqueioDasParcelas = bloqueioParaRefazerParcelas(titulos.map((t) => t.dados), 'OS');
    if (bloqueioDasParcelas) throw new ErroVenda(409, bloqueioDasParcelas);

    // Guarda do limite de credito: outra venda/OS a prazo do mesmo cliente entrou no meio?
    const clienteCreditoRef = comLimite && clienteId ? db.collection('clientes').doc(clienteId) : null;
    let creditoVersaoAtual = 0;
    if (clienteCreditoRef) {
      const s = await tx.get(clienteCreditoRef);
      creditoVersaoAtual = credito.parseCreditoVersao(s.exists ? s.data()[credito.CAMPO_CREDITO_VERSAO] : 0);
      if (credito.creditoFoiAlteradoDurante(creditoVersaoNaChecagem, creditoVersaoAtual)) throw new ErroVenda(409, credito.MENSAGEM_CREDITO_CONCORRENTE);
    }

    const orcamentoRef = os.orcamentoId ? db.collection('orcamentos').doc(String(os.orcamentoId)) : null;
    const orcamentoSnap = orcamentoRef ? await tx.get(orcamentoRef) : null;
    const atualizarOrcamento = Boolean(orcamentoSnap && orcamentoSnap.exists && orcamentoSnap.data().tenantId === tenantId);

    // ---------------- PLANO ----------------
    const resultado = osf.planoDaFinalizacaoDaOs({
      osId: osRef.id,
      tenantId,
      usuarioId: user.uid,
      os,
      dataSaida: pedido.dataSaida,
      pagamentos,
      lotesPorLinha,
      mecanico,
      percentualDoServico: (id) => percentuaisServicos[id],
      percentualDaPeca: (id) => (produtos[id] && typeof produtos[id].comissaoPercentual === 'number' ? produtos[id].comissaoPercentual : undefined),
      comissaoPadraoServicos: typeof config.comissaoPadraoServicos === 'number' ? config.comissaoPadraoServicos : undefined,
      comissaoPadraoPecas: typeof config.comissaoPadraoPecas === 'number' ? config.comissaoPadraoPecas : undefined,
      agoraIso: new Date().toISOString(),
    });
    if ('erro' in resultado) throw new ErroVenda(409, resultado.erro);
    const plano = resultado.plano;

    const saldos = await lerSaldos(tx, [...plano.creditoPorBanco.keys()], tenantId);
    plano.creditoPorBanco.forEach((_, bancoId) => {
      if (!saldos.has(bancoId)) throw new ErroVenda(400, 'O banco de destino selecionado não foi encontrado.');
    });

    const estoque = escritasDeEstoque(plano.estoque, produtos, permitirSemEstoque);
    const escritasDeLote = plano.lotes.map((l) => {
      const disponivel = lotesAtuais[l.loteId];
      const uso = usoPorLote.get(l.loteId);
      if (!permitirSemEstoque && l.quantidade > disponivel + 1e-9) {
        throw new ErroVenda(409, `${(uso && uso.nome) || 'Peça'}: o lote ${l.lote || ''} tem só ${disponivel}. Escolha outro lote ou diminua a quantidade.`);
      }
      return [l.loteId, { quantidade: disponivel - l.quantidade, updatedAt: agora() }];
    });

    // ---------------- ESCRITAS ----------------
    tx.update(osRef, {
      ...plano.camposDaOs,
      fechadoPeloServidor: true,
      finalizadaPor: user.uid,
      finalizadaEm: agora(),
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), 'OS finalizada'),
    });
    estoque.forEach(([id, campos]) => tx.update(db.collection('estoque').doc(id), campos));
    escritasDeLote.forEach(([id, campos]) => tx.update(db.collection('estoque_lotes').doc(id), campos));
    if (clienteCreditoRef) tx.update(clienteCreditoRef, { [credito.CAMPO_CREDITO_VERSAO]: creditoVersaoAtual + 1, updatedAt: agora() });
    plano.creditoPorBanco.forEach((delta, bancoId) => {
      tx.update(db.collection('bancos').doc(bancoId), {
        saldoCentavos: saldos.get(bancoId) + delta,
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), `Crédito da OS #${numeroOS}`),
      });
    });
    const existentes = new Map(titulos.map((t) => [t.id, t.dados]));
    plano.titulos.forEach((t) => {
      const antigo = existentes.get(t.id);
      tx.set(db.collection('transacoes').doc(t.id), {
        ...t.campos,
        ...(antigo
          ? { createdAt: antigo.createdAt ?? agora(), updatedAt: agora(), ...buildDocumentUpdateMetadata(user.uid, agora(), 'Refeita ao finalizar a OS') }
          : { createdAt: agora(), ...buildDocumentMetadata(user.uid, agora()) }),
      });
    });
    osf.titulosQueSaemNaFinalizacao(titulos, plano.titulos.map((t) => t.id)).forEach((id) => {
      tx.update(db.collection('transacoes').doc(id), {
        status: 'Cancelada',
        movimentaCaixaFisico: false,
        substituidaEm: agora(),
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), 'Substituída por novo pagamento'),
      });
    });
    if (atualizarOrcamento) {
      tx.update(orcamentoRef, { status: 'Finalizado', ...buildDocumentUpdateMetadata(user.uid, agora(), `OS #${numeroOS} finalizada`) });
    }

    return {
      jaEnviado: false,
      osId: osRef.id,
      numeroOS,
      totalCentavos: plano.totais.valorTotalCentavos,
      formaPagamento: plano.formaPagamento,
      clienteNome,
      mecanicoId,
      mecanicoNome: String(os.mecanicoNome || ''),
    };
  });
};

// ===========================================================================
// REABRIR
// ===========================================================================

const reabrirOs = async ({ user, tenantId, corpo }) => {
  const lido = osf.lerPedidoDeReaberturaDaOs(corpo);
  if ('erro' in lido) throw new ErroVenda(400, lido.erro);
  const osRef = refDaOs(lido.osId);
  const antes = lerOs(await osRef.get(), tenantId);
  const refsTitulos = await refsDosTitulos(tenantId, osRef.id, antes.pagamentos);

  return db.runTransaction(async (tx) => {
    // ---------------- LEITURAS ----------------
    const os = lerOs(await tx.get(osRef), tenantId);
    const numeroOS = String(os.numeroOS || '');
    const titulos = await lerTitulos(tx, refsTitulos, tenantId);
    const resultado = osf.planoDaReaberturaDaOs({ os, titulos, status: lido.status, agoraIso: new Date().toISOString() });
    if ('erro' in resultado) throw new ErroVenda(409, resultado.erro);
    const plano = resultado.plano;

    const saldos = await lerSaldos(tx, [...plano.debitoPorBanco.keys()], tenantId);
    const produtos = await lerProdutos(tx, plano.estoque.map((d) => d.id), tenantId);
    const loteRefs = plano.lotes.map((l) => db.collection('estoque_lotes').doc(l.loteId));
    const lotesExistentes = new Set((loteRefs.length ? await tx.getAll(...loteRefs) : [])
      .filter((s) => s.exists && s.data().tenantId === tenantId).map((s) => s.id));

    // ---------------- ESCRITAS ----------------
    tx.update(osRef, {
      ...plano.camposDaOs,
      reabertaPor: user.uid,
      reabertaPorNome: usuarioNome(user),
      reabertaEm: agora(),
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), 'OS reaberta'),
    });
    plano.debitoPorBanco.forEach((delta, bancoId) => {
      if (!saldos.has(bancoId)) return;
      tx.update(db.collection('bancos').doc(bancoId), {
        saldoCentavos: saldos.get(bancoId) - delta,
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), `Estorno do crédito da OS #${numeroOS} (reaberta)`),
      });
    });
    plano.titulosCancelados.forEach((id) => {
      tx.update(db.collection('transacoes').doc(id), {
        status: 'Cancelada',
        movimentaCaixaFisico: false,
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), 'Cancelada pela reabertura da OS'),
      });
    });
    escritasDeEstoque(plano.estoque, produtos, true).forEach(([id, campos]) => tx.update(db.collection('estoque').doc(id), campos));
    plano.lotes.forEach((l) => {
      if (!lotesExistentes.has(l.loteId)) return;
      tx.update(db.collection('estoque_lotes').doc(l.loteId), { quantidade: incremento(l.quantidade), updatedAt: agora() });
    });

    return {
      osId: osRef.id,
      numeroOS,
      status: lido.status,
      mecanicoId: String(os.mecanicoId || ''),
      mecanicoNome: String(os.mecanicoNome || ''),
      totalCentavos: Number(os.valorTotalCentavos || 0),
      pecasDevolvidas: plano.estoque.length > 0,
    };
  });
};

// ===========================================================================
// CANCELAR
// ===========================================================================

const cancelarOs = async ({ user, tenantId, corpo }) => {
  const lido = osf.lerPedidoDeCancelamentoDaOs(corpo);
  if ('erro' in lido) throw new ErroVenda(400, lido.erro);
  const osRef = refDaOs(lido.osId);
  const antes = lerOs(await osRef.get(), tenantId);

  const notasSnap = await db.collection('notas_fiscais').where('tenantId', '==', tenantId).where('osId', '==', osRef.id).get();
  const erroNota = osf.erroDasNotasParaCancelarOs(notasSnap.docs.map((d) => ({ id: d.id, ...d.data() })), String(antes.numeroOS || ''));
  if (erroNota) throw new ErroVenda(409, erroNota);

  const refsTitulos = await refsDosTitulos(tenantId, osRef.id, antes.pagamentos);
  const hoje = getDateInputInTimeZone();

  return db.runTransaction(async (tx) => {
    // ---------------- LEITURAS ----------------
    const os = lerOs(await tx.get(osRef), tenantId);
    const numeroOS = String(os.numeroOS || '');
    const titulos = await lerTitulos(tx, refsTitulos, tenantId);
    const resultado = osf.planoDoCancelamentoDaOs({
      osId: osRef.id,
      os,
      titulos,
      motivo: lido.motivo,
      devolverEstoque: lido.devolverEstoque,
      usuarioId: user.uid,
      usuarioNome: usuarioNome(user),
      tenantId,
      hoje,
      agoraIso: new Date().toISOString(),
    });
    if ('erro' in resultado) throw new ErroVenda(409, resultado.erro);
    const plano = resultado.plano;

    const saldos = await lerSaldos(tx, [...plano.debitoPorBanco.keys()], tenantId);
    const produtos = await lerProdutos(tx, plano.estoque.map((d) => d.id), tenantId);
    const loteRefs = plano.lotes.map((l) => db.collection('estoque_lotes').doc(l.loteId));
    const lotesExistentes = new Set((loteRefs.length ? await tx.getAll(...loteRefs) : [])
      .filter((s) => s.exists && s.data().tenantId === tenantId).map((s) => s.id));
    const orcamentoRef = os.orcamentoId ? db.collection('orcamentos').doc(String(os.orcamentoId)) : null;
    const orcamentoSnap = orcamentoRef ? await tx.get(orcamentoRef) : null;
    const reabrirOrcamento = Boolean(orcamentoSnap && orcamentoSnap.exists && orcamentoSnap.data().tenantId === tenantId);

    // ---------------- ESCRITAS ----------------
    tx.update(osRef, {
      ...plano.camposDaOs,
      canceladaEm: agora(),
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), 'OS cancelada'),
    });
    plano.debitoPorBanco.forEach((delta, bancoId) => {
      if (!saldos.has(bancoId)) return;
      tx.update(db.collection('bancos').doc(bancoId), {
        saldoCentavos: saldos.get(bancoId) - delta,
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), `Estorno do crédito da OS #${numeroOS}`),
      });
    });
    plano.titulos.atualizar.forEach((a) => {
      tx.update(db.collection('transacoes').doc(a.id), {
        ...a.campos,
        estornadaEm: agora(),
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), a.nota),
      });
    });
    plano.titulos.criar.forEach((c) => {
      tx.set(db.collection('transacoes').doc(c.id), { ...c.campos, createdAt: agora(), ...buildDocumentMetadata(user.uid, agora()) }, { merge: true });
    });
    escritasDeEstoque(plano.estoque, produtos, true).forEach(([id, campos]) => tx.update(db.collection('estoque').doc(id), campos));
    plano.lotes.forEach((l) => {
      if (!lotesExistentes.has(l.loteId)) return;
      tx.update(db.collection('estoque_lotes').doc(l.loteId), { quantidade: incremento(l.quantidade), updatedAt: agora() });
    });
    if (reabrirOrcamento) {
      tx.update(orcamentoRef, { status: 'Pendente', ...buildDocumentUpdateMetadata(user.uid, agora(), `OS #${numeroOS} cancelada`) });
    }

    return {
      osId: osRef.id,
      numeroOS,
      devolveuEstoque: plano.devolveuEstoque,
      totalCentavos: Number(os.valorTotalCentavos || 0),
      mecanicoId: String(os.mecanicoId || ''),
      mecanicoNome: String(os.mecanicoNome || ''),
      snapshot: os,
    };
  });
};

module.exports = { finalizarOs, reabrirOs, cancelarOs };
