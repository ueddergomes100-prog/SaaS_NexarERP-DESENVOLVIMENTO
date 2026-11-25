/*
 * CONTAS A PAGAR PELO SERVIDOR (item 15 da Embala Minas, fase 2, 25/11/2026).
 * Regra em src/utils/lancamentoPagarDomain.ts (compilada em server/domain),
 * que usa a mesma montagem de titulos da tela (despesaParceladaDomain.ts).
 *
 * Lancar (uma, parcelada ou em cheques), alterar (valor, vencimento e dados)
 * e cancelar despesa passam por aqui. Fornecedor, veiculo, motorista e banco
 * do cheque sao lidos do cadastro da empresa; a despesa nasce em aberto e so'
 * o "Dar Baixa" mexe em caixa/banco.
 */
const { admin, db } = require('../config/firebase');
const dom = require('../domain/lancamentoPagarDomain');
const { avisoDeSoma, erroDaDespesa } = require('../domain/despesaParceladaDomain');
const { rotuloDoVeiculo } = require('../domain/frotaDomain');
const { buildDocumentMetadata, buildDocumentUpdateMetadata } = require('../domain/documentMetadata');
const { fromCents } = require('../domain/financeDomain');
const { ErroBaixa } = require('./baixaFinanceira');
const { lerDevedor } = require('./lancamentoReceber');
const auditoria = require('./auditoria');

const agora = () => admin.firestore.FieldValue.serverTimestamp();

/** Documento da empresa, ativo. `quem` = "veículo"/"motorista" na mensagem. */
const lerDaEmpresa = async (tenantId, colecao, id, quem, ondeCadastra) => {
  const snap = await db.collection(colecao).doc(id).get();
  const dados = snap.exists ? snap.data() : null;
  if (!dados || dados.tenantId !== tenantId) {
    throw new ErroBaixa(404, `O ${quem} escolhido não foi encontrado nesta empresa. Escolha de novo na lista.`);
  }
  if (dados.ativo === false) throw new ErroBaixa(409, `O ${quem} escolhido está inativo. Reative em ${ondeCadastra} ou escolha outro.`);
  return dados;
};

const lerVeiculo = async (tenantId, id) => {
  const v = await lerDaEmpresa(tenantId, 'frota', id, 'veículo', 'Expedição › Frota');
  return { id, nome: rotuloDoVeiculo(v), ...(v.placa ? { placa: String(v.placa) } : {}) };
};

const lerMotorista = async (tenantId, id) => {
  const m = await lerDaEmpresa(tenantId, 'motoristas', id, 'motorista', 'Expedição › Motoristas');
  return { id, nome: String(m.nome || '').trim() };
};

/** Bancos da empresa escolhidos nos cheques (nome do cadastro). Banco de fora ou inativo fica de fora (erroDosCheques acusa). */
const lerBancosDosCheques = async (tenantId, parcelas) => {
  const ids = [...new Set(parcelas.map((p) => p.bancoId).filter(Boolean))];
  const bancos = [];
  for (const id of ids) {
    const snap = await db.collection('bancos').doc(id).get();
    const dados = snap.exists ? snap.data() : null;
    if (dados && dados.tenantId === tenantId && dados.ativo !== false) bancos.push({ id, nome: String(dados.nome || '') });
  }
  return bancos;
};

const nomeDoUsuario = async (user) => {
  const snap = await db.collection('usuarios').doc(user.uid).get();
  const u = snap.exists ? snap.data() : {};
  return String(u.nome || u.nomeResponsavel || user.nome || user.email || 'Usuário').trim();
};

/** Le os cadastros escolhidos. Os que nao mudaram (edicao) ficam como estao e nao sao lidos. */
const lerCadastros = async (tenantId, pedido, atual = null) => {
  const mudou = (campo) => !atual || pedido[campo] !== String(atual[campo] || '').trim();
  const cadastros = {};
  if (pedido.fornecedorId && mudou('fornecedorId')) {
    cadastros.fornecedor = { id: pedido.fornecedorId, nome: await lerDevedor(tenantId, { tipo: 'fornecedor', id: pedido.fornecedorId }) };
  }
  if (pedido.veiculoId && mudou('veiculoId')) cadastros.veiculo = await lerVeiculo(tenantId, pedido.veiculoId);
  if (pedido.motoristaId && mudou('motoristaId')) cadastros.motorista = await lerMotorista(tenantId, pedido.motoristaId);
  return cadastros;
};

const lancarContaAPagar = async ({ user, tenantId, corpo }) => {
  const lido = dom.lerPedidoDeDespesa(corpo);
  if ('erro' in lido) throw new ErroBaixa(400, lido.erro);
  const pedido = lido.pedido;
  const cadastros = await lerCadastros(tenantId, pedido);
  const bancos = pedido.forma === 'Cheque' ? await lerBancosDosCheques(tenantId, pedido.parcelas) : [];

  // Mesmas conferencias da tela (despesaParceladaDomain): o que impede e a soma que nao fecha.
  const total = fromCents(pedido.totalCentavos);
  const problema = erroDaDespesa(dom.dadosDaDespesa(pedido, cadastros), pedido.parcelas, total, bancos);
  if (problema) throw new ErroBaixa(400, problema);
  const aviso = avisoDeSoma(pedido.parcelas, total);
  if (aviso && !pedido.aceitarSomaDiferente) {
    throw new ErroBaixa(400, `${aviso} Ajuste os valores ou marque "Conferi as parcelas e quero lançar assim".`);
  }

  const usuarioNome = await nomeDoUsuario(user);
  const titulos = dom.titulosDaDespesaParaGravar(pedido, cadastros, bancos, { uid: user.uid, nome: usuarioNome, ...(user.email ? { email: user.email } : {}) });

  let jaLancado = false;
  await db.runTransaction(async (tx) => {
    const primeiro = await tx.get(db.collection('transacoes').doc(titulos[0].id));
    if (primeiro.exists) {
      // Mesmo envio repetido (a internet caiu depois de gravar): nao lanca de novo.
      if (primeiro.data().tenantId === tenantId) { jaLancado = true; return; }
      throw new ErroBaixa(409, 'Este lançamento já existe em outra empresa. Feche a janela e lance de novo.');
    }
    titulos.forEach((titulo) => {
      tx.set(db.collection('transacoes').doc(titulo.id), {
        ...titulo.campos,
        tenantId,
        lancadoEm: agora(),
        createdAt: agora(),
        updatedAt: agora(),
        criadoPor: user.uid,
        ...buildDocumentMetadata(user.uid, agora()),
      });
    });
  });

  return {
    ids: titulos.map((t) => t.id),
    jaLancado,
    totalCentavos: titulos.reduce((soma, t) => soma + (Number(t.campos.valorCentavos) || 0), 0),
    quantidade: titulos.length,
    descricao: pedido.descricao.toUpperCase(),
    forma: pedido.forma,
    fornecedorNome: cadastros.fornecedor ? cadastros.fornecedor.nome : '',
    usuarioNome,
  };
};

/** Le a despesa para alterar/cancelar, conferindo empresa e o que bloqueia. */
const lerDespesa = async (tx, tenantId, transacaoId, acao) => {
  const ref = db.collection('transacoes').doc(transacaoId);
  const snap = await tx.get(ref);
  const dados = snap.exists ? snap.data() : null;
  if (!dados || dados.tenantId !== tenantId) throw new ErroBaixa(404, 'Esta conta não existe mais. Atualize a tela.');
  const bloqueio = dom.bloqueioParaMexerNaDespesa(dados, acao);
  if (bloqueio) throw new ErroBaixa(409, bloqueio);
  return { ref, dados };
};

const editarContaAPagar = async ({ user, tenantId, corpo }) => {
  const lido = dom.lerPedidoDeEdicaoDespesa(corpo);
  if ('erro' in lido) throw new ErroBaixa(400, lido.erro);
  const pedido = lido.pedido;
  // Cadastro novo escolhido e' lido antes da transacao (como no Receber).
  const antes = await db.collection('transacoes').doc(pedido.transacaoId).get();
  const cadastros = await lerCadastros(tenantId, pedido, antes.exists ? antes.data() : null);

  let resumo = null;
  await db.runTransaction(async (tx) => {
    const { ref, dados } = await lerDespesa(tx, tenantId, pedido.transacaoId, 'editar');
    const { campos, remover, alteracoes } = dom.mudancasDaEdicaoDespesa(dados, pedido, cadastros);
    resumo = { descricao: String(campos.descricao || dados.descricao || ''), alteracoes };
    if (alteracoes.length === 0) return;
    const apagar = admin.firestore.FieldValue.delete();
    tx.update(ref, {
      ...campos,
      ...Object.fromEntries(remover.map((k) => [k, apagar])),
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), 'Conta a pagar alterada'),
    });
  });
  return resumo;
};

const cancelarContaAPagar = async ({ user, tenantId, corpo }) => {
  const lido = dom.lerPedidoDeCancelamentoDespesa(corpo);
  if ('erro' in lido) throw new ErroBaixa(400, lido.erro);
  const pedido = lido.pedido;
  let resumo = null;
  await db.runTransaction(async (tx) => {
    const { ref, dados } = await lerDespesa(tx, tenantId, pedido.transacaoId, 'cancelar');
    resumo = { descricao: String(dados.descricao || ''), valorCentavos: dom.centavosDaDespesa(dados) };
    tx.update(ref, {
      status: 'Cancelada',
      cancelamento: { motivo: pedido.motivo, porUid: user.uid, ...(user.email ? { porEmail: user.email } : {}), em: agora() },
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), `Lançamento cancelado: ${pedido.motivo}`),
    });
    // Historico de alteracoes: na MESMA transacao do cancelamento (ultima escrita).
    auditoria.registrarLogNaTransacao(tx, { ...user, tenantId }, {
      modulo: 'financeiro',
      acao: 'cancelamento',
      descricao: `Despesa "${resumo.descricao}"${dados.fornecedorNome ? ` de ${dados.fornecedorNome}` : ''} (R$ ${fromCents(resumo.valorCentavos).toFixed(2).replace('.', ',')}) cancelada. Motivo: ${pedido.motivo}`,
      registroId: pedido.transacaoId,
      documentoTipo: 'conta_pagar',
      documentoNumero: `Conta a pagar ${resumo.descricao || pedido.transacaoId}`,
      motivo: pedido.motivo,
      alteracoes: [{ campo: 'Situação', valorAnterior: String(dados.status || 'Pendente'), valorNovo: 'Cancelada' }],
      critico: true,
      snapshotExcluido: dados,
    });
  });
  return { ...resumo, motivo: pedido.motivo };
};

module.exports = { lancarContaAPagar, editarContaAPagar, cancelarContaAPagar };
