const { admin, db } = require('../config/firebase');
const {
  PERMISSAO_ROMANEIO_ENCERRADO,
  ROTULO_PERMISSAO_ROMANEIO_ENCERRADO,
  acertoParaGravar,
  alteracoesDesdeOFechamento,
  camposEditaveisDaRota,
  cancelamentoDesfazEntregas,
  contagemDoPlano,
  despesasDoAcerto,
  despesasJaLancadas,
  erroDoAcerto,
  erroDoMotivo,
  erroParaCancelar,
  erroParaFechar,
  erroParaReabrir,
  eventoDoHistorico,
  fotoDoFechamento,
  planoDeDespesas,
  planoDeReabertura,
  romaneioDoDocumento,
  situacaoDoPedidoAoEncerrar,
  tituloDoRomaneio,
  travaLivreOuDestaRota,
} = require('../domain/romaneioDomain');
const { CATEGORIA_DESPESA_ROTA, descricaoDaDespesaNoFinanceiro } = require('../domain/rotaDomain');
const { buildDocumentMetadata, buildDocumentUpdateMetadata } = require('../domain/documentMetadata');

/**
 * ROMANEIO DE ENTREGA no servidor (15/10/2026): fechar o acerto, REABRIR uma
 * rota fechada e CANCELAR (inclusive fechada). Regra em
 * src/utils/romaneioDomain.ts ("ROMANEIO JA' FECHADO").
 *
 * Por que no servidor: fechar mexe no Financeiro (lanca, corrige e cancela as
 * despesas da rota) e reabrir/cancelar rota fechada pede permissao propria.
 * As firestore.rules nao deixam a tela gravar romaneio fechado/cancelado nem
 * mudar a situacao para fechado/cancelado -- so' por aqui, com log.
 */

class ErroRomaneio extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Mesma lista das firestore.rules para gravar em `transacoes` -- lancar despesa
// no fechamento sempre pediu uma permissao do Financeiro.
const PERMISSOES_FINANCEIRO = [
  'financeiro.caixa', 'financeiro.banco', 'financeiro.cheques', 'financeiro.boletos', 'financeiro.receber',
  'financeiro.pagar', 'financeiro.estornar', 'vendas.pedidos', 'vendas.orcamentos', 'mecanica.os', 'estoque.nota_avulsa',
];

const TS = () => admin.firestore.FieldValue.serverTimestamp();
const APAGAR = () => admin.firestore.FieldValue.delete();

const temPermissao = (user, permissao) => (
  Boolean(user.isPlatformAdmin || user.isTenantManager || (Array.isArray(user.permissoes) && user.permissoes.includes(permissao)))
);

const exigirRomaneio = (user) => {
  if (!temPermissao(user, 'operacoes.romaneios')) {
    throw new ErroRomaneio(403, 'Seu usuário não tem permissão para o Romaneio de Entrega. Peça ao administrador para liberar "Romaneio de Entrega" no seu cadastro.');
  }
};

const exigirEncerrado = (user, acao) => {
  if (!temPermissao(user, PERMISSAO_ROMANEIO_ENCERRADO)) {
    throw new ErroRomaneio(403, `Para ${acao} um romaneio já fechado, é preciso a permissão "${ROTULO_PERMISSAO_ROMANEIO_ENCERRADO}". Peça ao administrador.`);
  }
};

const idValido = (id) => {
  const texto = String(id || '').trim();
  if (!texto || texto.includes('/') || texto.length > 128) throw new ErroRomaneio(400, 'Romaneio inválido. Atualize a página e tente de novo.');
  return texto;
};

const lerNaTransacao = async (tx, user, id) => {
  const ref = db.collection('romaneios').doc(id);
  const snap = await tx.get(ref);
  if (!snap.exists || snap.data().tenantId !== user.tenantId) {
    throw new ErroRomaneio(404, 'Este romaneio não existe mais ou é de outra empresa. Atualize a página.');
  }
  return { ref, dados: snap.data(), romaneio: romaneioDoDocumento(snap.data()) };
};

const lerTravas = async (tx, entregas) => {
  if (entregas.length === 0) return {};
  const snaps = await tx.getAll(...entregas.map((e) => db.collection('romaneio_pedidos').doc(e.pedidoId)));
  return Object.fromEntries(snaps.map((s, i) => [entregas[i].pedidoId, s.exists ? s.data() : null]));
};

/** Rota de despesas ainda valida (nao cancelada) e os lancamentos dela, lidos na transacao. */
const lerDespesasLancadas = async (tx, user, romaneio) => {
  if (!romaneio.despesasRotaId) return { rotaRef: null, rota: null, transacoes: new Map(), lancadas: [] };
  const rotaRef = db.collection('rotas').doc(romaneio.despesasRotaId);
  const rotaSnap = await tx.get(rotaRef);
  const rota = rotaSnap.exists && rotaSnap.data().tenantId === user.tenantId && !rotaSnap.data().cancelada ? rotaSnap.data() : null;
  const ids = rota && Array.isArray(rota.transacaoIds) ? rota.transacaoIds.map(String).filter(Boolean) : [];
  const snaps = ids.length ? await tx.getAll(...ids.map((t) => db.collection('transacoes').doc(t))) : [];
  const transacoes = new Map(snaps.filter((s) => s.exists && s.data().tenantId === user.tenantId).map((s) => [s.id, s.data()]));
  const lancadas = despesasJaLancadas(rota, (t) => transacoes.has(t) && transacoes.get(t).status !== 'Cancelada');
  return { rotaRef: rota ? rotaRef : null, rota, transacoes, lancadas };
};

const historicoCom = (romaneio, evento) => [...(romaneio.historico || []), evento];

// O que o lancamento da despesa diz sobre a rota -- muda quando o acerto e' refeito.
const CAMPOS_COMPARADOS = ['descricao', 'data', 'dataPagamento', 'valorCentavos', 'motoristaId', 'motoristaNome', 'tipoDespesaRota', 'veiculoId', 'veiculoNome', 'veiculoPlaca'];

const camposDaTransacao = (despesa, final, titulo) => ({
  descricao: `${descricaoDaDespesaNoFinanceiro(despesa, final.motoristaNome, final.dataSaida)} - ${titulo}`,
  data: final.dataSaida,
  dataPagamento: final.dataSaida,
  valor: despesa.valor,
  valorCentavos: Math.round(despesa.valor * 100),
  motoristaId: final.motoristaId,
  motoristaNome: final.motoristaNome,
  tipoDespesaRota: despesa.tipo,
  ...(final.veiculoId ? { veiculoId: final.veiculoId, veiculoNome: final.veiculoDescricao, veiculoPlaca: final.veiculoPlaca } : {}),
});

/** So' o que mudou; veiculo que saiu da rota sai do lancamento (sem gravar `undefined`). */
const mudancasNaTransacao = (gravada, desejada) => {
  const mudancas = {};
  CAMPOS_COMPARADOS.forEach((campo) => {
    const antes = gravada[campo] ?? '';
    const depois = desejada[campo] ?? '';
    if (String(antes) === String(depois)) return;
    mudancas[campo] = desejada[campo] === undefined ? APAGAR() : desejada[campo];
  });
  if (mudancas.valorCentavos !== undefined) mudancas.valor = desejada.valor;
  return mudancas;
};

/** Texto do corpo da tela vira o mesmo formato que a tela grava. */
const romaneioDoCorpo = (gravado, corpo) => {
  const r = corpo && typeof corpo === 'object' ? corpo : {};
  const texto = (v, padrao) => (typeof v === 'string' ? v : padrao);
  const km = (v, padrao) => (v === null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : padrao));
  const acerto = Array.isArray(r.acerto)
    ? r.acerto.filter((l) => l && typeof l === 'object').map((l) => ({
      tipo: texto(l.tipo, ''),
      natureza: ['adiantamento', 'despesa', 'informativo'].includes(l.natureza) ? l.natureza : 'informativo',
      descricao: texto(l.descricao, ''),
      valorCentavos: Number(l.valorCentavos) || 0,
    })).filter((l) => l.tipo)
    : gravado.acerto;
  return {
    ...gravado,
    nome: texto(r.nome, gravado.nome),
    dataSaida: texto(r.dataSaida, gravado.dataSaida),
    horarioSaida: texto(r.horarioSaida, gravado.horarioSaida),
    motoristaId: texto(r.motoristaId, gravado.motoristaId),
    motoristaNome: texto(r.motoristaNome, gravado.motoristaNome),
    veiculoId: texto(r.veiculoId, gravado.veiculoId),
    veiculoDescricao: texto(r.veiculoDescricao, gravado.veiculoDescricao),
    veiculoPlaca: texto(r.veiculoPlaca, gravado.veiculoPlaca),
    kmSaida: km(r.kmSaida, gravado.kmSaida),
    kmChegada: km(r.kmChegada, gravado.kmChegada),
    horarioChegada: texto(r.horarioChegada, gravado.horarioChegada),
    observacao: texto(r.observacao, gravado.observacao),
    observacaoAcerto: texto(r.observacaoAcerto, gravado.observacaoAcerto).trim(),
    acerto,
  };
};

/**
 * Fecha o acerto (primeira vez ou depois de reabrir). Entregue fica preso a
 * esta rota; nao entregue volta a ficar livre. As despesas do acerto viram
 * lancamentos PAGOS em "DESPESAS DE ROTA"; se a rota ja' tinha lancamentos,
 * eles ACOMPANHAM o acerto (corrige, lanca o que faltou, cancela o que saiu).
 * A baixa dos titulos dos clientes continua em Contas a Receber.
 */
const fecharRomaneio = async ({ user, id: idBruto, corpo, usuarioNome, agoraIso }) => {
  exigirRomaneio(user);
  const id = idValido(idBruto);

  return db.runTransaction(async (tx) => {
    const { ref, dados, romaneio: gravado } = await lerNaTransacao(tx, user, id);
    const enviado = romaneioDoCorpo(gravado, corpo?.romaneio);
    const erroAcerto = erroDoAcerto(enviado.acerto);
    if (erroAcerto) throw new ErroRomaneio(400, erroAcerto);
    const acerto = acertoParaGravar(enviado.acerto);
    const final = { ...enviado, ...camposEditaveisDaRota(enviado), acerto };
    const erro = erroParaFechar(final);
    if (erro) throw new ErroRomaneio(409, erro);

    const travas = await lerTravas(tx, final.entregas);
    const { rotaRef: rotaExistente, rota, transacoes, lancadas } = await lerDespesasLancadas(tx, user, gravado);

    const titulo = tituloDoRomaneio(final.numero, final.nome);
    // Lancamento que ja' existe acompanha o acerto, mesmo com a caixa desmarcada.
    const lancar = Boolean(corpo?.lancarDespesas) || lancadas.some((l) => l.ativa);
    const plano = planoDeDespesas(lancar ? despesasDoAcerto(acerto) : [], lancadas);
    const contagem = contagemDoPlano(plano);
    const atualizacoes = plano.linhas
      .filter((l) => l.transacaoId)
      .map((l) => ({ transacaoId: l.transacaoId, mudancas: mudancasNaTransacao(transacoes.get(l.transacaoId) || {}, camposDaTransacao(l.despesa, final, titulo)) }))
      .filter((a) => Object.keys(a.mudancas).length > 0);
    const mexeNoFinanceiro = contagem.novas > 0 || atualizacoes.length > 0 || plano.cancelar.length > 0;
    if (mexeNoFinanceiro && !temPermissao(user, PERMISSAO_ROMANEIO_ENCERRADO) && !PERMISSOES_FINANCEIRO.some((p) => temPermissao(user, p))) {
      throw new ErroRomaneio(403, 'Para lançar as despesas da rota no financeiro, seu usuário precisa de uma permissão do Financeiro (ex.: Contas a Pagar). Peça ao administrador, ou desmarque "Lançar as despesas".');
    }

    const agora = TS();
    final.entregas.forEach((e) => {
      if (!travaLivreOuDestaRota(id, travas[e.pedidoId])) return;
      tx.set(db.collection('romaneio_pedidos').doc(e.pedidoId), {
        tenantId: user.tenantId,
        romaneioId: id,
        romaneioTitulo: titulo,
        situacao: situacaoDoPedidoAoEncerrar(e, false),
        updatedAt: agora,
        ...buildDocumentUpdateMetadata(user.uid, agora, `Acerto da ${titulo}`),
      }, { merge: true });
    });

    // Rota de despesas: a mesma, atualizada; nova quando ainda nao havia; cancelada quando nao sobrou despesa.
    let despesasRotaId = rotaExistente ? rotaExistente.id : '';
    if (plano.linhas.length > 0) {
      const rotaRef = rotaExistente || db.collection('rotas').doc();
      despesasRotaId = rotaRef.id;
      const transacaoIds = plano.linhas.map((linha) => {
        if (linha.transacaoId) return linha.transacaoId;
        const nova = db.collection('transacoes').doc();
        tx.set(nova, {
          ...camposDaTransacao(linha.despesa, final, titulo),
          categoria: CATEGORIA_DESPESA_ROTA,
          // Mesmo desenho da tela Rotas e Despesas: o motorista ja' pagou na estrada, nao saiu do caixa.
          status: 'Paga',
          tipo: 'saida',
          movimentaCaixaFisico: false,
          rotaId: rotaRef.id,
          romaneioId: id,
          tenantId: user.tenantId,
          createdAt: agora,
          ...buildDocumentMetadata(user.uid, agora),
        });
        return nova.id;
      });
      const despesas = plano.linhas.map((l) => l.despesa);
      const totalCentavos = despesas.reduce((t, d) => t + Math.round(d.valor * 100), 0);
      const dadosDaRota = {
        motoristaId: final.motoristaId,
        motoristaNome: final.motoristaNome,
        veiculo: final.veiculoDescricao,
        data: final.dataSaida,
        observacao: `Lançada pelo acerto da ${titulo}`,
        despesas,
        totalCentavos,
        total: totalCentavos / 100,
        transacaoIds,
        romaneioId: id,
        tenantId: user.tenantId,
      };
      if (rotaExistente) tx.update(rotaRef, { ...dadosDaRota, updatedAt: agora, ...buildDocumentUpdateMetadata(user.uid, agora, `Acerto da ${titulo} refeito`) });
      else tx.set(rotaRef, { ...dadosDaRota, createdAt: agora, ...buildDocumentMetadata(user.uid, agora) });
    } else if (rotaExistente && rota) {
      tx.update(rotaExistente, {
        cancelada: true,
        canceladaEm: agora,
        motivoCancelamento: `Despesas retiradas do acerto da ${titulo}`,
        updatedAt: agora,
        ...buildDocumentUpdateMetadata(user.uid, agora, `Despesas retiradas do acerto da ${titulo}`),
      });
      despesasRotaId = '';
    }
    atualizacoes.forEach((a) => {
      tx.update(db.collection('transacoes').doc(a.transacaoId), { ...a.mudancas, ...buildDocumentUpdateMetadata(user.uid, agora, `Acerto da ${titulo} refeito`) });
    });
    plano.cancelar.forEach((transacaoId) => {
      tx.update(db.collection('transacoes').doc(transacaoId), {
        status: 'Cancelada',
        ...buildDocumentUpdateMetadata(user.uid, agora, `Despesa retirada do acerto da ${titulo}`),
      });
    });

    const reabertura = dados.fechamentoAnterior && typeof dados.fechamentoAnterior === 'object' ? dados.fechamentoAnterior : null;
    tx.update(ref, {
      ...camposEditaveisDaRota(final),
      kmChegada: final.kmChegada,
      horarioChegada: final.horarioChegada,
      acerto,
      observacaoAcerto: final.observacaoAcerto,
      status: 'fechado',
      fechadoEm: agora,
      fechadoPor: user.uid,
      despesasRotaId,
      historico: historicoCom(gravado, eventoDoHistorico('fechado', usuarioNome, agoraIso)),
      ...(reabertura ? { fechamentoAnterior: APAGAR() } : {}),
      updatedAt: agora,
      ...buildDocumentUpdateMetadata(user.uid, agora, reabertura ? 'Acerto fechado de novo, depois de reaberto' : 'Acerto fechado'),
    });

    return {
      titulo,
      despesasLancadas: contagem.novas,
      contagem: { ...contagem, alteradas: atualizacoes.length },
      refechamento: Boolean(reabertura),
      alteracoes: reabertura ? alteracoesDesdeOFechamento(reabertura, final) : [],
    };
  });
};

/**
 * Reabre uma rota fechada: volta inteira para "Em rota". O pedido nao
 * entregue que ja' saiu em outra rota fica de fora. As despesas lancadas
 * ficam como estao ate' o acerto ser fechado de novo (ou a rota cancelada).
 */
const reabrirRomaneio = async ({ user, id: idBruto, motivo, usuarioNome, agoraIso }) => {
  exigirEncerrado(user, 'reabrir');
  const id = idValido(idBruto);
  const erroMotivo = erroDoMotivo(motivo);
  if (erroMotivo) throw new ErroRomaneio(400, erroMotivo);

  return db.runTransaction(async (tx) => {
    const { ref, romaneio } = await lerNaTransacao(tx, user, id);
    const erro = erroParaReabrir(romaneio);
    if (erro) throw new ErroRomaneio(409, erro);
    const travas = await lerTravas(tx, romaneio.entregas);
    const { ficam, saem } = planoDeReabertura(id, romaneio.entregas, travas);
    const titulo = tituloDoRomaneio(romaneio.numero, romaneio.nome);
    const agora = TS();

    ficam.forEach((e) => {
      tx.set(db.collection('romaneio_pedidos').doc(e.pedidoId), {
        tenantId: user.tenantId,
        romaneioId: id,
        romaneioTitulo: titulo,
        situacao: 'em_romaneio',
        updatedAt: agora,
        ...buildDocumentUpdateMetadata(user.uid, agora, `${titulo} reaberta`),
      }, { merge: true });
    });
    const registrosQueSaem = Object.fromEntries(saem.map((s) => [`registros.${s.entrega.pedidoId}`, APAGAR()]));
    tx.update(ref, {
      status: 'em_rota',
      entregas: ficam,
      ...registrosQueSaem,
      fechamentoAnterior: fotoDoFechamento(romaneio),
      reabertoEm: agora,
      reabertoPor: user.uid,
      motivoReabertura: String(motivo).trim(),
      historico: historicoCom(romaneio, eventoDoHistorico('reaberto', usuarioNome, agoraIso, motivo)),
      updatedAt: agora,
      ...buildDocumentUpdateMetadata(user.uid, agora, `Romaneio reaberto: ${String(motivo).trim()}`),
    });
    return {
      titulo,
      saem: saem.map((s) => ({ pedidoId: s.entrega.pedidoId, numeroPedido: s.entrega.numeroPedido, outraRota: s.outraRota })),
    };
  });
};

/**
 * Cancela a rota. Sem entrega registrada: como sempre foi. Fechada ou com
 * entrega: precisa da permissao propria e de motivo, e DESFAZ tudo -- os
 * pedidos ficam livres e os lancamentos de despesa sao cancelados.
 */
const cancelarRomaneio = async ({ user, id: idBruto, motivo, usuarioNome, agoraIso }) => {
  exigirRomaneio(user);
  const id = idValido(idBruto);
  const podeDesfazer = temPermissao(user, PERMISSAO_ROMANEIO_ENCERRADO);

  return db.runTransaction(async (tx) => {
    const { ref, dados, romaneio } = await lerNaTransacao(tx, user, id);
    const erro = erroParaCancelar(romaneio, { podeDesfazer });
    if (erro) throw new ErroRomaneio(romaneio.status === 'cancelado' ? 409 : 403, erro);
    const desfaz = cancelamentoDesfazEntregas(romaneio);
    if (desfaz) {
      const erroMotivo = erroDoMotivo(motivo);
      if (erroMotivo) throw new ErroRomaneio(400, erroMotivo);
    }
    const travas = await lerTravas(tx, romaneio.entregas);
    const { rotaRef, lancadas } = await lerDespesasLancadas(tx, user, romaneio);
    const titulo = tituloDoRomaneio(romaneio.numero, romaneio.nome);
    const motivoLimpo = String(motivo || '').trim();
    const agora = TS();

    let liberados = 0;
    romaneio.entregas.forEach((e) => {
      const trava = travas[e.pedidoId];
      // Trava que ja' e' de outra rota (ou livre) nao e' desta rota para mexer.
      if (trava && trava.romaneioId && trava.romaneioId !== id) return;
      liberados += 1;
      tx.set(db.collection('romaneio_pedidos').doc(e.pedidoId), {
        tenantId: user.tenantId,
        situacao: situacaoDoPedidoAoEncerrar(e, true),
        updatedAt: agora,
        ...buildDocumentUpdateMetadata(user.uid, agora, `${titulo} cancelada`),
      }, { merge: true });
    });
    const ativas = lancadas.filter((l) => l.ativa);
    ativas.forEach((l) => {
      tx.update(db.collection('transacoes').doc(l.transacaoId), {
        status: 'Cancelada',
        ...buildDocumentUpdateMetadata(user.uid, agora, `${titulo} cancelada${motivoLimpo ? `: ${motivoLimpo}` : ''}`),
      });
    });
    if (rotaRef) {
      tx.update(rotaRef, {
        cancelada: true,
        canceladaEm: agora,
        motivoCancelamento: `${titulo} cancelada${motivoLimpo ? `: ${motivoLimpo}` : ''}`,
        updatedAt: agora,
        ...buildDocumentUpdateMetadata(user.uid, agora, `${titulo} cancelada`),
      });
    }
    tx.update(ref, {
      status: 'cancelado',
      canceladoEm: agora,
      canceladoPor: user.uid,
      ...(motivoLimpo ? { motivoCancelamento: motivoLimpo } : {}),
      ...(dados.fechamentoAnterior ? { fechamentoAnterior: APAGAR() } : {}),
      historico: historicoCom(romaneio, eventoDoHistorico('cancelado', usuarioNome, agoraIso, motivoLimpo)),
      updatedAt: agora,
      ...buildDocumentUpdateMetadata(user.uid, agora, motivoLimpo ? `Romaneio cancelado: ${motivoLimpo}` : 'Romaneio cancelado'),
    });
    return { titulo, desfez: desfaz, statusAnterior: romaneio.status, liberados, despesasCanceladas: ativas.length };
  });
};

module.exports = { ErroRomaneio, fecharRomaneio, reabrirRomaneio, cancelarRomaneio, PERMISSOES_FINANCEIRO };
