/**
 * ZERAR ESTOQUE E CUSTOS DE UMA EMPRESA MIGRADA (17/11/2026, pedido do dono
 * na virada da Jomarly: "zerar o estoque e remover todos os preços que
 * importamos -- manter só o preço de venda, o resto editável, mas zerado; e
 * um único registro 'Migração de sistema, importação de dados'").
 *
 * Roda pelo Painel da Plataforma > Manutenção (da maquina local nada roda
 * contra producao). Uma empresa por vez, sempre Simular antes de Aplicar.
 * Rodar de novo e' seguro: so' grava em produto que ainda tem algo a zerar.
 *
 * Em cada produto da empresa (colecao `estoque`, inclusive variacoes):
 *  - saldo 0 (`quantidade` e `estoqueConfig.quantidadeAtual`);
 *  - custo 0 (`precoCusto` e `precos.custo` -- numero que margem e lucro leem);
 *  - sem preco a vista/a prazo, custo medio e custo comercial (chave apagada:
 *    o cadastro mostra o campo vazio para preencher; custo medio 0 gravado
 *    faria a proxima entrada de nota tirar a media a partir de zero);
 *  - preco de venda NAO muda.
 * Nao gera ajuste de estoque por produto: quem chama grava UM registro no
 * historico da empresa.
 */

const TAMANHO_LOTE = 400;

const numero = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};

/** O que precisa mudar neste produto (vazio = nada a fazer). */
const mudancasDoProduto = (produto, apagar) => {
  const mudancas = {};
  const precos = produto.precos && typeof produto.precos === 'object' ? produto.precos : {};
  const estoqueConfig = produto.estoqueConfig && typeof produto.estoqueConfig === 'object' ? produto.estoqueConfig : {};
  if (numero(produto.quantidade) !== 0) mudancas.quantidade = 0;
  if ('quantidadeAtual' in estoqueConfig && numero(estoqueConfig.quantidadeAtual) !== 0) mudancas['estoqueConfig.quantidadeAtual'] = 0;
  if (numero(produto.precoCusto) !== 0 || produto.precoCusto === undefined) mudancas.precoCusto = 0;
  if ('custo' in precos && numero(precos.custo) !== 0) mudancas['precos.custo'] = 0;
  for (const campo of ['precoAVista', 'precoAPrazo', 'custoMedio', 'custoComercial']) {
    if (campo in produto) mudancas[campo] = apagar();
  }
  for (const campo of ['aVista', 'aPrazo']) {
    if (campo in precos) mudancas[`precos.${campo}`] = apagar();
  }
  return mudancas;
};

/**
 * @param {{ db: FirebaseFirestore.Firestore, apagar: () => unknown, agora: () => unknown, tenantId: string, aplicar: boolean, usuarioId: string }} opcoes
 */
async function zerarEstoqueECustosDaMigracao({ db, apagar, agora, tenantId, aplicar, usuarioId }) {
  // Nome e CNPJ da empresa ficam nas configuracoes dela (mesmo lugar que o backup le).
  const empresaSnap = await db.collection('configuracoes').doc(tenantId).get();
  if (!empresaSnap.exists) {
    const erro = new Error('Empresa não encontrada. Confira o código da empresa (tenant) e tente de novo.');
    erro.status = 404;
    throw erro;
  }
  const empresa = empresaSnap.data() || {};
  const [snap, vendas] = await Promise.all([
    db.collection('estoque').where('tenantId', '==', tenantId).get(),
    db.collection('pedidos_venda').where('tenantId', '==', tenantId).count().get(),
  ]);

  let somaSaldo = 0;
  let comSaldo = 0;
  let comCustos = 0;
  const paraGravar = [];
  snap.forEach((doc) => {
    const produto = doc.data();
    const q = numero(produto.quantidade);
    somaSaldo += q;
    if (q !== 0) comSaldo += 1;
    const mudancas = mudancasDoProduto(produto, apagar);
    const mexeEmCusto = Object.keys(mudancas).some((c) => c !== 'quantidade' && c !== 'estoqueConfig.quantidadeAtual');
    if (mexeEmCusto) comCustos += 1;
    if (Object.keys(mudancas).length > 0) paraGravar.push({ ref: doc.ref, mudancas });
  });

  if (aplicar) {
    for (let i = 0; i < paraGravar.length; i += TAMANHO_LOTE) {
      const lote = db.batch();
      paraGravar.slice(i, i + TAMANHO_LOTE).forEach(({ ref, mudancas }) => {
        lote.update(ref, { ...mudancas, alteradoPor: usuarioId, alteradoEm: agora(), updatedAt: agora() });
      });
      await lote.commit();
    }
  }

  return {
    tenantId,
    empresa: String(empresa.nomeOficina || empresa.razaoSocial || empresa.nome || tenantId),
    cnpj: String(empresa.cnpj || ''),
    produtos: snap.size,
    comSaldo,
    somaSaldo: Math.round(somaSaldo * 1000) / 1000,
    comCustos,
    alterados: paraGravar.length,
    pedidosDeVenda: vendas.data().count,
  };
}

module.exports = { zerarEstoqueECustosDaMigracao, mudancasDoProduto };
