const { admin, db } = require('../config/firebase');
const { ErroRomaneio } = require('./romaneios');
const { erroDoPedidoParaRomaneio, montarEntregaDoPedido, tituloDoRomaneio } = require('../domain/romaneioDomain');
const {
  parseModoRotaPreVenda,
  perguntaRotaNaPreVenda,
  preVendaEntraNaRota,
  ordenarRotas,
  rotaSemPerguntar,
} = require('../domain/rotaPreVendaDomain');
const { STATUS_PRE_VENDA } = require('../domain/preVendaDomain');
const { buildDocumentUpdateMetadata } = require('../domain/documentMetadata');

/**
 * ROTA NA PRE-VENDA (21/10/2026) -- regra em src/utils/rotaPreVendaDomain.ts.
 *
 * Por que no servidor: quem grava a pre-venda (vendedor do balcao ou do
 * app) normalmente nao tem a permissao do Romaneio, e as firestore.rules
 * so' deixam quem a tem mexer em `romaneios`/`romaneio_pedidos`. Aqui o
 * pedido entra na rota com a mesma trava por pedido que a tela usa, numa
 * transacao so'.
 *
 *   rotasAbertas          -> rotas em montagem (pra tela perguntar)
 *   colocarPedidoNaRota   -> decide a rota (escolhida / unica / nenhuma) e
 *                            coloca o pedido, ou so' anota (modo "ao faturar")
 *   colocarAoFaturarSemFalhar -> o mesmo, chamado pelo fechamento da venda;
 *                            nunca derruba a venda
 */

const TS = () => admin.firestore.FieldValue.serverTimestamp();

const temPermissao = (user, permissao) => (
  Boolean(user.isPlatformAdmin || user.isTenantManager || (Array.isArray(user.permissoes) && user.permissoes.includes(permissao)))
);

// Quem grava pre-venda ou venda pode coloca'-la na rota; quem monta rota tambem.
const PERMISSOES_QUE_COLOCAM = ['operacoes.romaneios', 'vendas.pre_venda_criar', 'vendas.pedidos'];

const idValido = (id, oQue) => {
  const texto = String(id || '').trim();
  if (!texto || texto.includes('/') || texto.length > 128) throw new ErroRomaneio(400, `${oQue} inválido. Atualize a página e tente de novo.`);
  return texto;
};

const resumoDaRota = (snap) => {
  const r = snap.data();
  const pedidos = Array.isArray(r.pedidoIds) ? r.pedidoIds.length : (Array.isArray(r.entregas) ? r.entregas.length : 0);
  return { id: snap.id, titulo: tituloDoRomaneio(Number(r.numero), String(r.nome || '')), quantidadePedidos: pedidos };
};

const consultaDasAbertas = (tenantId) => db.collection('romaneios').where('tenantId', '==', tenantId).where('status', '==', 'montagem');

const rotasAbertas = async (tenantId) => {
  const snap = await consultaDasAbertas(tenantId).get();
  return ordenarRotas(snap.docs.map(resumoDaRota));
};

const lerModo = (configSnap) => parseModoRotaPreVenda(configSnap.exists ? configSnap.data().rotaNaPreVenda : undefined);

/** Nota autorizada do pedido (NF-e vale mais que cupom), lida na transacao. */
const notaDoPedido = async (tx, tenantId, pedidoId) => {
  const snap = await tx.get(db.collection('notas_fiscais').where('tenantId', '==', tenantId).where('pedidoId', '==', pedidoId));
  let nota = null;
  snap.docs.forEach((d) => {
    const n = d.data();
    if (n.status !== 'authorized' || !n.number) return;
    if (!nota || (n.tipo === 'NF-e' && nota.tipo !== 'NF-e')) nota = { numero: n.number, tipo: String(n.tipo || '') };
  });
  return nota;
};

// Campos do retrato do pedido na rota que mudam quando a pre-venda e' faturada
// (valor, desconto, pagamento). O registro da entrega nao e' tocado.
const CAMPOS_DO_RETRATO = ['numeroPedido', 'dataVenda', 'notaNumero', 'notaTipo', 'clienteNome', 'vendedorNome', 'formaPagamento', 'valorTotalCentavos', 'valorDescontoCentavos'];

const retratoAtualizado = (gravada, nova) => {
  const copia = { ...gravada };
  CAMPOS_DO_RETRATO.forEach((campo) => { copia[campo] = nova[campo]; });
  return copia;
};

/**
 * Coloca o pedido na rota (ou anota a rota nele). `romaneioId` = a rota que a
 * pessoa escolheu (pode ja' ter sido liberada: ai' cai na regra "sem
 * perguntar"). `aoFaturar` = chamado pelo fechamento da venda: pedido que ja'
 * estava na rota tem o retrato atualizado.
 */
const colocarPedidoNaRota = async ({ user, tenantId, pedidoId, romaneioId, aoFaturar = false, semConferirPermissao = false }) => {
  if (!semConferirPermissao && !PERMISSOES_QUE_COLOCAM.some((p) => temPermissao(user, p))) {
    throw new ErroRomaneio(403, 'Seu usuário não tem permissão para colocar pedido na rota de entrega. Peça ao administrador para liberar "Vendas: Pré-venda — Gravar" ou "Romaneio de Entrega" no seu cadastro.');
  }
  const idPedido = idValido(pedidoId, 'Pedido');
  const idEscolhido = romaneioId ? idValido(romaneioId, 'Romaneio') : '';
  const pedidoRef = db.collection('pedidos_venda').doc(idPedido);
  const travaRef = db.collection('romaneio_pedidos').doc(idPedido);
  const configRef = db.collection('configuracoes').doc(tenantId);

  return db.runTransaction(async (tx) => {
    const [configSnap, pedidoSnap, travaSnap] = await tx.getAll(configRef, pedidoRef, travaRef);
    const modo = lerModo(configSnap);
    if (!perguntaRotaNaPreVenda(modo)) return { acao: 'desligado' };
    if (!pedidoSnap.exists || pedidoSnap.data().tenantId !== tenantId) {
      throw new ErroRomaneio(404, 'Este pedido não existe mais ou é de outra empresa. Atualize a página.');
    }
    const pedido = { id: idPedido, ...pedidoSnap.data() };
    const numero = String(pedido.numeroPedido || '?');
    const trava = travaSnap.exists ? travaSnap.data() : null;

    if (trava && trava.situacao === 'em_romaneio' && trava.romaneioId) {
      const rota = { id: String(trava.romaneioId), titulo: String(trava.romaneioTitulo || '') };
      if (aoFaturar) {
        // A pre-venda entrou na rota e agora foi faturada: o retrato dela na
        // rota (valor, pagamento) acompanha. Rota liberada nao muda mais.
        const romaneioRef = db.collection('romaneios').doc(rota.id);
        const [romaneioSnap, clienteSnap] = await Promise.all([
          tx.get(romaneioRef),
          pedido.clienteId ? tx.get(db.collection('clientes').doc(String(pedido.clienteId))) : Promise.resolve(null),
        ]);
        const nota = await notaDoPedido(tx, tenantId, idPedido);
        if (romaneioSnap.exists && romaneioSnap.data().status === 'montagem') {
          const nova = montarEntregaDoPedido(pedido, clienteSnap && clienteSnap.exists ? clienteSnap.data() : null, nota);
          const entregas = (romaneioSnap.data().entregas || []).map((e) => (e.pedidoId === idPedido ? retratoAtualizado(e, nova) : e));
          tx.update(romaneioRef, { entregas, updatedAt: TS(), ...buildDocumentUpdateMetadata(user.uid, TS(), `Pedido #${numero} faturado`) });
        }
      }
      return { acao: 'ja_estava', rota };
    }

    const abertasSnap = await tx.get(consultaDasAbertas(tenantId));
    const abertas = ordenarRotas(abertasSnap.docs.map(resumoDaRota));
    const anotada = pedido.romaneioDestino && typeof pedido.romaneioDestino === 'object' ? String(pedido.romaneioDestino.id || '') : '';
    const rota = rotaSemPerguntar(abertas, idEscolhido || anotada);
    const meta = (texto) => buildDocumentUpdateMetadata(user.uid, TS(), texto);

    if (!rota) {
      if (anotada) tx.update(pedidoRef, { romaneioDestino: null, updatedAt: TS(), ...meta('Rota anotada não existe mais (sem rota em montagem)') });
      return { acao: 'sem_rota' };
    }

    const status = String(pedido.status || '');
    const entraAgora = status === 'Finalizada' || (preVendaEntraNaRota(modo) && status === STATUS_PRE_VENDA);
    if (!entraAgora) {
      const erro = erroDoPedidoParaRomaneio(pedido, true);
      if (erro) throw new ErroRomaneio(409, erro);
      // Modo "ao faturar": fica anotado; entra quando a venda fechar.
      tx.update(pedidoRef, { romaneioDestino: { id: rota.id, titulo: rota.titulo }, updatedAt: TS(), ...meta(`Rota anotada: ${rota.titulo}`) });
      return { acao: 'anotada', rota: { id: rota.id, titulo: rota.titulo } };
    }

    // Entra agora. Leituras que faltam antes de qualquer escrita.
    const romaneioRef = db.collection('romaneios').doc(rota.id);
    const romaneioSnap = abertasSnap.docs.find((d) => d.id === rota.id);
    const clienteSnap = pedido.clienteId ? await tx.get(db.collection('clientes').doc(String(pedido.clienteId))) : null;
    const nota = status === 'Finalizada' ? await notaDoPedido(tx, tenantId, idPedido) : null;
    const entrega = montarEntregaDoPedido(pedido, clienteSnap && clienteSnap.exists ? clienteSnap.data() : null, nota);
    const dados = romaneioSnap.data();
    const entregasAtuais = Array.isArray(dados.entregas) ? dados.entregas : [];
    const pedidoIds = Array.isArray(dados.pedidoIds) ? dados.pedidoIds : entregasAtuais.map((e) => e.pedidoId);
    if (!pedidoIds.includes(idPedido)) {
      tx.update(romaneioRef, {
        entregas: [...entregasAtuais, entrega],
        pedidoIds: [...pedidoIds, idPedido],
        updatedAt: TS(),
        ...meta(`Pedido #${numero} colocado pela ${status === 'Finalizada' ? 'venda' : 'pré-venda'}`),
      });
    }
    tx.set(travaRef, {
      tenantId,
      romaneioId: rota.id,
      romaneioTitulo: rota.titulo,
      pedidoNumero: entrega.numeroPedido,
      situacao: 'em_romaneio',
      updatedAt: TS(),
      ...meta(`Pedido colocado na ${rota.titulo}`),
    });
    tx.update(pedidoRef, { romaneioDestino: { id: rota.id, titulo: rota.titulo }, updatedAt: TS(), ...meta(`Colocado na ${rota.titulo}`) });
    return { acao: 'colocado', rota: { id: rota.id, titulo: rota.titulo } };
  });
};

/**
 * Chamado pelo fechamento da venda (servidor) e pela tela depois de faturar:
 * a venda ja' esta' gravada, entao a rota nunca derruba nada -- falhou, a
 * tela avisa e a loja coloca pelo Romaneio.
 */
const colocarAoFaturarSemFalhar = async ({ user, tenantId, pedidoId }) => {
  try {
    return await colocarPedidoNaRota({ user, tenantId, pedidoId, aoFaturar: true, semConferirPermissao: true });
  } catch (erro) {
    console.error('[Rota na pré-venda] não foi possível colocar o pedido na rota ao faturar:', erro);
    return { acao: 'falhou', erro: erro instanceof ErroRomaneio ? erro.message : '' };
  }
};

module.exports = { rotasAbertas, colocarPedidoNaRota, colocarAoFaturarSemFalhar };
