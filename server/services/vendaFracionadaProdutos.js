/**
 * VENDA FRACIONADA NOS PRODUTOS DE UMA EMPRESA (21/11/2026).
 *
 * Caso real: na Jomarly (migrada em 17/11) a AREIA METRO, na unidade M3
 * marcada como "Fracionada", recusava 0,5 m3 na venda. O produto guarda uma
 * copia da configuracao da unidade, e essa copia estava "nao fracionado".
 * A tela de Unidades passou a levar a mudanca para os produtos (front,
 * unidadeProdutosService.ts); esta tarefa conserta o que ja' estava gravado.
 *
 * Decisao do dono (21/11/2026): todo produto ATIVO numa unidade fracionada
 * passa a vender fracionado, como era no sistema antigo -- marca "Produto
 * fracionado" e acerta a copia da unidade (fracionado e casas decimais).
 *
 * Roda pelo Painel da Plataforma > Manutencao (da maquina local nada roda
 * contra producao). Uma empresa por vez, Simular antes de Aplicar. Rodar de
 * novo e' seguro: so' grava em produto que ainda precisa mudar.
 */

const TAMANHO_LOTE = 400;
const EXEMPLOS = 40;

const sigla = (valor) => String(valor ?? '').trim().toUpperCase();

const casasDaUnidade = (unidade) => {
  const n = Math.trunc(Number(unidade.casasDecimais));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 6) : 0;
};

const produtoAtivo = (p) => p.ativo !== false && p.statusAtivo !== false;

/** A unidade do produto: pelo id gravado; cadastro antigo sem id, pela sigla. */
const unidadeDoProduto = (produto, porId, porSigla) => {
  const id = String(produto.unidadeMedidaId ?? '').trim();
  if (id && porId.has(id)) return porId.get(id);
  return porSigla.get(sigla(produto.unidadeMedidaSigla)) || null;
};

/** O que muda no produto (vazio = nada). `travado` = hoje recusa quantidade quebrada. */
const mudancasDoProduto = (produto, unidade) => {
  const mudancas = {};
  if (!unidade || unidade.permiteFracionado !== true) return { mudancas, travado: false };
  const config = produto.estoqueConfig && typeof produto.estoqueConfig === 'object' ? produto.estoqueConfig : {};
  if (produto.unidadeMedidaFracionado !== true) mudancas.unidadeMedidaFracionado = true;
  if (produto.produtoFracionado !== true) mudancas.produtoFracionado = true;
  if (config.fracionado !== true) mudancas['estoqueConfig.fracionado'] = true;
  const casas = casasDaUnidade(unidade);
  if (casas > 0 && Number(produto.unidadeMedidaCasasDecimais) !== casas) mudancas.unidadeMedidaCasasDecimais = casas;
  return { mudancas, travado: produto.unidadeMedidaFracionado !== true };
};

/**
 * @param {{ db: FirebaseFirestore.Firestore, agora: () => unknown, tenantId: string, aplicar: boolean, usuarioId: string }} opcoes
 */
async function corrigirVendaFracionada({ db, agora, tenantId, aplicar, usuarioId }) {
  const empresaSnap = await db.collection('configuracoes').doc(tenantId).get();
  if (!empresaSnap.exists) {
    const erro = new Error('Empresa não encontrada. Confira o código da empresa (tenant) e tente de novo.');
    erro.status = 404;
    throw erro;
  }
  const empresa = empresaSnap.data() || {};
  const [unidadesSnap, produtosSnap] = await Promise.all([
    db.collection('unidades_medida').where('tenantId', '==', tenantId).get(),
    db.collection('estoque').where('tenantId', '==', tenantId).get(),
  ]);

  const porId = new Map();
  const porSigla = new Map();
  unidadesSnap.docs.forEach((d) => {
    const u = { id: d.id, ...d.data() };
    porId.set(d.id, u);
    // Sigla repetida: vale a ativa.
    const chave = sigla(u.sigla);
    if (!porSigla.has(chave) || porSigla.get(chave).ativo === false) porSigla.set(chave, u);
  });

  const unidadesFracionadas = [...porSigla.values()].filter((u) => u.permiteFracionado === true && u.ativo !== false).map((u) => sigla(u.sigla)).sort();
  const porSiglaResumo = new Map();
  const exemplos = [];
  const paraGravar = [];
  let naUnidadeFracionada = 0;
  let travados = 0;

  produtosSnap.docs.forEach((d) => {
    const produto = d.data();
    if (!produtoAtivo(produto)) return;
    const unidade = unidadeDoProduto(produto, porId, porSigla);
    if (!unidade || unidade.permiteFracionado !== true) return;
    naUnidadeFracionada += 1;
    const chave = sigla(unidade.sigla);
    const resumo = porSiglaResumo.get(chave) || { sigla: chave, produtos: 0, travados: 0, alterados: 0 };
    resumo.produtos += 1;
    const { mudancas, travado } = mudancasDoProduto(produto, unidade);
    if (travado) {
      travados += 1;
      resumo.travados += 1;
      if (exemplos.length < EXEMPLOS) exemplos.push({ codigo: String(produto.codigo ?? ''), nome: String(produto.nome ?? ''), sigla: chave });
    }
    if (Object.keys(mudancas).length > 0) {
      resumo.alterados += 1;
      paraGravar.push({ ref: d.ref, mudancas });
    }
    porSiglaResumo.set(chave, resumo);
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
    produtos: produtosSnap.size,
    unidadesFracionadas,
    naUnidadeFracionada,
    travados,
    alterados: paraGravar.length,
    porSigla: [...porSiglaResumo.values()].sort((a, b) => a.sigla.localeCompare(b.sigla)),
    exemplos: exemplos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
  };
}

module.exports = { corrigirVendaFracionada, mudancasDoProduto, unidadeDoProduto };
