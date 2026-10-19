/*
 * CONTA A RECEBER LANCADA A MAO (19/10/2026). Regra em
 * src/utils/lancamentoReceberDomain.ts (compilada em server/domain).
 *
 * Lancar, editar e cancelar passam por aqui: o nome de quem deve vem do
 * cadastro (cliente ou fornecedor da empresa), nunca do que a tela mandou; a
 * conta nasce em aberto e so' o "Dar baixa" mexe em caixa/banco. Cada
 * operacao vai para Logs do Sistema com quem fez.
 */
const { admin, db } = require('../config/firebase');
const dom = require('../domain/lancamentoReceberDomain');
const { buildDocumentMetadata, buildDocumentUpdateMetadata } = require('../domain/documentMetadata');
const { ErroBaixa } = require('./baixaFinanceira');

const agora = () => admin.firestore.FieldValue.serverTimestamp();

/** Cliente ou fornecedor da empresa, ativo. Devolve o nome do cadastro. */
const lerDevedor = async (tenantId, devedor) => {
  const colecao = devedor.tipo === 'cliente' ? 'clientes' : 'fornecedores';
  const quem = devedor.tipo === 'cliente' ? 'cliente' : 'fornecedor';
  const snap = await db.collection(colecao).doc(devedor.id).get();
  const dados = snap.exists ? snap.data() : null;
  if (!dados || dados.tenantId !== tenantId) {
    throw new ErroBaixa(404, `O ${quem} escolhido não foi encontrado nesta empresa. Busque de novo e selecione na lista.`);
  }
  const nome = String(dados.nome || dados.razaoSocial || '').trim().toUpperCase();
  if (!nome) throw new ErroBaixa(409, `O ${quem} escolhido está sem nome no cadastro. Complete em ${devedor.tipo === 'cliente' ? 'Clientes' : 'Fornecedores'} e lance de novo.`);
  if (dados.ativo === false) {
    throw new ErroBaixa(409, `O ${quem} ${nome} está inativo. Reative em ${devedor.tipo === 'cliente' ? 'Clientes' : 'Fornecedores'} para lançar uma conta para ele.`);
  }
  return nome;
};

const nomeDoUsuario = async (user) => {
  const snap = await db.collection('usuarios').doc(user.uid).get();
  const u = snap.exists ? snap.data() : {};
  return String(u.nome || u.nomeResponsavel || user.nome || user.email || 'Usuário').trim();
};

const lancarContaAReceber = async ({ user, tenantId, corpo }) => {
  const lido = dom.lerPedidoDeLancamento(corpo);
  if ('erro' in lido) throw new ErroBaixa(400, lido.erro);
  const pedido = lido.pedido;
  const devedorNome = await lerDevedor(tenantId, pedido.devedor);
  const usuarioNome = await nomeDoUsuario(user);
  const titulos = dom.titulosDoLancamento(pedido, devedorNome, { uid: user.uid, nome: usuarioNome, ...(user.email ? { email: user.email } : {}) });
  const totalCentavos = pedido.parcelas.reduce((soma, p) => soma + p.valorCentavos, 0);

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
    totalCentavos,
    quantidade: titulos.length,
    devedorNome,
    devedorTipo: pedido.devedor.tipo,
    descricao: pedido.descricao.toUpperCase(),
    formaPrevista: pedido.formaPrevista,
    usuarioNome,
  };
};

/** Le a conta para editar/cancelar, conferindo empresa e o que bloqueia. */
const lerContaAvulsa = async (tx, tenantId, transacaoId, acao) => {
  const ref = db.collection('transacoes').doc(transacaoId);
  const snap = await tx.get(ref);
  const dados = snap.exists ? snap.data() : null;
  if (!dados || dados.tenantId !== tenantId) throw new ErroBaixa(404, 'Esta conta não existe mais. Atualize a tela.');
  const bloqueio = dom.bloqueioParaMexerNaConta(dados, acao);
  if (bloqueio) throw new ErroBaixa(409, bloqueio);
  return { ref, dados };
};

const editarContaAReceber = async ({ user, tenantId, corpo }) => {
  const lido = dom.lerPedidoDeEdicao(corpo);
  if ('erro' in lido) throw new ErroBaixa(400, lido.erro);
  const pedido = lido.pedido;
  const devedorNome = await lerDevedor(tenantId, pedido.devedor);

  let resumo = null;
  await db.runTransaction(async (tx) => {
    const { ref, dados } = await lerContaAvulsa(tx, tenantId, pedido.transacaoId, 'editar');
    const { campos, remover, alteracoes } = dom.mudancasDaEdicao(dados, pedido, devedorNome);
    resumo = { descricao: String(campos.descricao || dados.descricao || ''), alteracoes };
    if (alteracoes.length === 0) return;
    const apagar = admin.firestore.FieldValue.delete();
    tx.update(ref, {
      ...campos,
      ...Object.fromEntries(remover.map((k) => [k, apagar])),
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), 'Conta a receber editada'),
    });
  });
  return resumo;
};

const cancelarContaAReceber = async ({ user, tenantId, corpo }) => {
  const lido = dom.lerPedidoDeCancelamento(corpo);
  if ('erro' in lido) throw new ErroBaixa(400, lido.erro);
  const pedido = lido.pedido;
  let resumo = null;
  await db.runTransaction(async (tx) => {
    const { ref, dados } = await lerContaAvulsa(tx, tenantId, pedido.transacaoId, 'cancelar');
    resumo = {
      descricao: String(dados.descricao || ''),
      valorCentavos: Number(dados.valorCentavos ?? Math.round(Number(dados.valor || 0) * 100)) || 0,
      devedorNome: dom.nomeDoDevedor(dados),
      snapshot: dados,
    };
    tx.update(ref, {
      status: 'Cancelada',
      cancelamento: { motivo: pedido.motivo, porUid: user.uid, ...(user.email ? { porEmail: user.email } : {}), em: agora() },
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), `Conta a receber cancelada: ${pedido.motivo}`),
    });
  });
  return { ...resumo, motivo: pedido.motivo };
};

module.exports = { lancarContaAReceber, editarContaAReceber, cancelarContaAReceber, lerDevedor };
