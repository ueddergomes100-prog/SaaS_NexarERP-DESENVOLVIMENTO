/**
 * LIGAR OS CREDITOS DE DEVOLUCAO AO CLIENTE (21/11/2026).
 *
 * Caso real (Jomarly): a venda #0180 foi cancelada e os R$ 108 de credito
 * usados nela voltaram como credito de "ALGERICO CONCAS". Meia hora depois o
 * cadastro foi renomeado para "ALGERICO ALCIDES CONCAS" e o credito sumiu do
 * Pedido de Venda e do Contas a Receber: o credito so' guardava o NOME, e a
 * busca era pelo nome exato do cadastro.
 *
 * Desde 21/11 o credito novo guarda o codigo do cliente (`clienteId`) e a
 * busca junta codigo e nome (src/utils/creditoDomain.ts). Esta tarefa grava o
 * codigo nos creditos antigos, pelo cliente do pedido de origem
 * (`pedidoOrigemId`). Nao mexe em saldo, status nem no nome gravado.
 *
 * Roda pelo Painel da Plataforma > Manutencao (da maquina local nada roda
 * contra producao). Uma empresa por vez, Simular antes de Aplicar. Rodar de
 * novo e' seguro: credito que ja' tem codigo fica como esta'.
 */

const { buildDocumentUpdateMetadata } = require('../domain/documentMetadata');

const TAMANHO_LOTE = 400;
const LEITURA_POR_VEZ = 100;
const EXEMPLOS = 40;
const STATUS_EM_ABERTO = ['disponivel', 'usado_parcial'];

const texto = (valor) => String(valor ?? '').trim();
const nomeMaiusculo = (valor) => texto(valor).toUpperCase();

const centavosDoCredito = (c) => {
  const n = Number(c.saldoDisponivelCentavos ?? Math.round(Number(c.saldoDisponivel || 0) * 100));
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
};

/** Le documentos por id, em blocos, devolvendo um Map id -> dados (so' os que existem). */
async function lerPorId(db, colecao, ids) {
  const mapa = new Map();
  for (let i = 0; i < ids.length; i += LEITURA_POR_VEZ) {
    const refs = ids.slice(i, i + LEITURA_POR_VEZ).map((id) => db.collection(colecao).doc(id));
    const snaps = refs.length ? await db.getAll(...refs) : [];
    snaps.forEach((s) => { if (s.exists) mapa.set(s.id, s.data()); });
  }
  return mapa;
}

/**
 * O cliente dono do credito, pelo pedido de origem. `null` = nao da' para
 * ligar com seguranca (sem pedido, pedido de outra empresa, venda sem cliente
 * cadastrado ou no cliente padrao "Consumidor Final"): o credito continua
 * valendo pelo nome, como antes.
 */
const clienteDoCredito = (credito, tenantId, pedidos, clientes) => {
  const pedido = pedidos.get(texto(credito.pedidoOrigemId));
  if (!pedido || pedido.tenantId !== tenantId) return { cliente: null, motivo: 'o pedido de origem não existe mais' };
  const clienteId = texto(pedido.clienteId);
  if (!clienteId) return { cliente: null, motivo: 'a venda foi sem cliente cadastrado' };
  const cliente = clientes.get(clienteId);
  if (!cliente || cliente.tenantId !== tenantId) return { cliente: null, motivo: 'o cliente da venda não existe mais' };
  if (cliente.isPadrao === true || nomeMaiusculo(cliente.nome) === 'CONSUMIDOR FINAL') {
    return { cliente: null, motivo: 'a venda foi no Consumidor Final' };
  }
  return { cliente: { id: clienteId, nome: nomeMaiusculo(cliente.nome) }, motivo: '' };
};

/**
 * @param {{ db: FirebaseFirestore.Firestore, agora: () => unknown, tenantId: string, aplicar: boolean, usuarioId: string }} opcoes
 */
async function ligarCreditosAoCliente({ db, agora, tenantId, aplicar, usuarioId }) {
  const empresaSnap = await db.collection('configuracoes').doc(tenantId).get();
  if (!empresaSnap.exists) {
    const erro = new Error('Empresa não encontrada. Confira o código da empresa (tenant) e tente de novo.');
    erro.status = 404;
    throw erro;
  }
  const empresa = empresaSnap.data() || {};
  const creditosSnap = await db.collection('creditos_cliente').where('tenantId', '==', tenantId).get();
  const semCodigo = creditosSnap.docs.filter((d) => !texto(d.data().clienteId));

  const idsPedidos = [...new Set(semCodigo.map((d) => texto(d.data().pedidoOrigemId)).filter(Boolean))];
  const pedidos = await lerPorId(db, 'pedidos_venda', idsPedidos);
  const idsClientes = [...new Set([...pedidos.values()].filter((p) => p.tenantId === tenantId).map((p) => texto(p.clienteId)).filter(Boolean))];
  const clientes = await lerPorId(db, 'clientes', idsClientes);

  const paraGravar = [];
  const exemplos = [];
  const semComoLigar = [];
  let escondidos = 0;
  let escondidosCentavos = 0;

  semCodigo.forEach((d) => {
    const credito = d.data();
    const { cliente, motivo } = clienteDoCredito(credito, tenantId, pedidos, clientes);
    const emAberto = STATUS_EM_ABERTO.includes(credito.status) && centavosDoCredito(credito) > 0;
    const numeroPedido = texto(credito.numeroPedidoOriginal);
    if (!cliente) {
      if (emAberto && semComoLigar.length < EXEMPLOS) {
        semComoLigar.push({ numeroPedido, nomeNoCredito: nomeMaiusculo(credito.clienteNome), saldoCentavos: centavosDoCredito(credito), motivo });
      }
      return;
    }
    paraGravar.push({ ref: d.ref, clienteId: cliente.id });
    // Escondido = em aberto e com nome diferente do cadastro de hoje: hoje
    // nao aparece para o cliente. E' o que a tarefa devolve.
    const escondido = emAberto && cliente.nome !== nomeMaiusculo(credito.clienteNome);
    if (escondido) {
      escondidos += 1;
      escondidosCentavos += centavosDoCredito(credito);
    }
    if (emAberto && exemplos.length < EXEMPLOS) {
      exemplos.push({ numeroPedido, nomeNoCredito: nomeMaiusculo(credito.clienteNome), nomeNoCadastro: cliente.nome, saldoCentavos: centavosDoCredito(credito), escondido });
    }
  });

  if (aplicar) {
    for (let i = 0; i < paraGravar.length; i += TAMANHO_LOTE) {
      const lote = db.batch();
      paraGravar.slice(i, i + TAMANHO_LOTE).forEach(({ ref, clienteId }) => {
        lote.update(ref, {
          clienteId,
          updatedAt: agora(),
          ...buildDocumentUpdateMetadata(usuarioId, agora(), 'Crédito ligado ao cadastro do cliente pela Manutenção'),
        });
      });
      await lote.commit();
    }
  }

  return {
    tenantId,
    empresa: texto(empresa.nomeOficina || empresa.razaoSocial || empresa.nome || tenantId),
    cnpj: texto(empresa.cnpj),
    creditos: creditosSnap.size,
    semCodigo: semCodigo.length,
    ligados: paraGravar.length,
    escondidos,
    escondidosCentavos,
    exemplos: exemplos.sort((a, b) => Number(b.escondido) - Number(a.escondido) || a.nomeNoCadastro.localeCompare(b.nomeNoCadastro, 'pt-BR')),
    semComoLigar,
  };
}

module.exports = { ligarCreditosAoCliente, clienteDoCredito };
