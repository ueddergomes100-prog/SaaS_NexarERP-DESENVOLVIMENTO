const { admin, db } = require('../config/firebase');
const { registrarLog } = require('./auditoria');

/**
 * INTEGRIDADE DOS CADASTROS -- inativar, reativar e excluir (2026-09-19).
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO VIVE NO BACKEND
 * ---------------------------------------------------------------------------
 *
 * As regras de um ERP de verdade dependem de OUTROS documentos: "este cliente
 * tem titulo em aberto?", "este produto ja' foi vendido?", "esta materia-
 * prima esta' numa receita de produto ativo?". As firestore.rules so'
 * enxergam o documento que esta' sendo gravado -- nao conseguem fazer essas
 * perguntas. Se a checagem ficasse so' na tela, qualquer um com o DevTools
 * aberto gravaria `ativo: false` direto no banco e pularia tudo.
 *
 * Entao:
 *  - as firestore.rules PROIBEM a tela de mudar `ativo` desses cadastros e
 *    de apagar documento (ver firestore.rules, CADASTROS_COM_SITUACAO);
 *  - a unica porta e' este servico, que roda com o Admin SDK (ignora as
 *    rules), confere as pendencias e so' entao grava;
 *  - o tenant sai SEMPRE do token de quem chamou (middleware/auth.js),
 *    nunca do corpo da requisicao.
 *
 * ---------------------------------------------------------------------------
 * AS REGRAS
 * ---------------------------------------------------------------------------
 *
 * Inativar e' bloqueado quando existe algo EM ABERTO atrelado ao cadastro:
 * titulo pendente, pedido/OS/orcamento aberto, saldo de credito, uso numa
 * receita de produto ativo, producao em andamento. A mensagem diz o que e'
 * e onde resolver.
 *
 * Produto e materia-prima com saldo ZERAM junto com a inativacao (regra
 * pedida pelo usuario em 2026-09-15), registrando o ajuste -- saldo preso
 * em item fora de uso infla o estoque e nao fecha inventario.
 *
 * Excluir so' existe pra cliente, fornecedor, produto e materia-prima, e so'
 * quando o cadastro NUNCA teve movimentacao. Com historico, o caminho e'
 * inativar -- apagar sumiria com a referencia de vendas, notas e titulos.
 */

class ErroCadastro extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const TIMESTAMP = () => admin.firestore.FieldValue.serverTimestamp();

// ---------------------------------------------------------------------------
// Configuracao por colecao
// ---------------------------------------------------------------------------

/**
 * `permissoes`: basta UMA delas (alem de dono/admin da empresa). Sao as
 * permissoes de CADASTRO de cada tela -- mais estritas que as das
 * firestore.rules, que tambem liberam escrita pra quem so' vende.
 */
const CADASTROS = {
  clientes: { rotulo: 'cliente', plural: 'clientes', artigo: 'o', permissoes: ['cadastros.clientes'], excluivel: true },
  fornecedores: { rotulo: 'fornecedor', plural: 'fornecedores', artigo: 'o', permissoes: ['cadastros.fornecedores'], excluivel: true },
  estoque: { rotulo: 'produto', plural: 'produtos', artigo: 'o', permissoes: ['cadastros.estoque_alterar'], excluivel: true, temSaldo: true },
  materias_primas: { rotulo: 'matéria-prima', plural: 'matérias-primas', artigo: 'a', permissoes: ['cadastros.materia_prima'], excluivel: true, temSaldo: true },
  categorias: { rotulo: 'categoria', plural: 'categorias', artigo: 'a', permissoes: ['cadastros.categorias'] },
  marcas: { rotulo: 'marca', plural: 'marcas', artigo: 'a', permissoes: ['cadastros.marcas'] },
  servicos: { rotulo: 'serviço', plural: 'serviços', artigo: 'o', permissoes: ['cadastros.servicos'] },
  veiculos: { rotulo: 'veículo', plural: 'veículos', artigo: 'o', permissoes: ['cadastros.clientes', 'mecanica.os'] },
  unidades_medida: { rotulo: 'unidade de medida', plural: 'unidades de medida', artigo: 'a', permissoes: ['cadastros.unidades_medida'] },
  bancos: { rotulo: 'banco', plural: 'bancos', artigo: 'o', permissoes: ['cadastros.bancos'] },
  bandeiras_cartao: { rotulo: 'bandeira de cartão', plural: 'bandeiras de cartão', artigo: 'a', permissoes: ['cadastros.bandeiras_cartao'] },
};

// ---------------------------------------------------------------------------
// Funcoes puras (testadas em tests/cadastroIntegridade.test.js)
// ---------------------------------------------------------------------------

const temPermissao = (user, permissoes) => Boolean(
  user && (user.isPlatformAdmin || user.isTenantManager
    || (Array.isArray(user.permissoes) && permissoes.some((p) => user.permissoes.includes(p)))),
);

/** O mesmo criterio do selo de status de cada tela: Bancos e Bandeiras
 * tratam campo ausente como INATIVO; o resto, como ativo. Produto guarda
 * tambem `statusAtivo`. */
const estaAtivo = (colecao, dados) => {
  if (!dados) return false;
  if (colecao === 'bancos' || colecao === 'bandeiras_cartao') return dados.ativo === true;
  if (colecao === 'estoque') return dados.ativo !== false && dados.statusAtivo !== false;
  return dados.ativo !== false;
};

const nomeDoCadastro = (dados) => String(
  (dados && (dados.nome || dados.nomeResponsavel || dados.placa || dados.sigla || dados.descricao)) || '',
).trim() || 'este cadastro';

const formatarMoeda = (centavos) => (Number(centavos || 0) / 100)
  .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Componentes de uma receita, lendo o formato novo (componenteId/origem)
 * e o antigo (materiaPrimaId, sem origem = materia-prima). Espelha
 * normalizarComponente de src/utils/producaoDomain.ts. */
const componentesDaReceita = (itens) => (Array.isArray(itens) ? itens : []).map((item) => ({
  id: String((item && (item.componenteId || item.materiaPrimaId)) || ''),
  origem: item && item.origem === 'estoque' ? 'estoque' : 'materia_prima',
})).filter((c) => c.id);

const STATUS_OS_FECHADA = ['Finalizada', 'Cancelada'];
const STATUS_ORCAMENTO_FECHADO = ['Recusado', 'Convertido', 'Finalizado', 'Finalizada', 'Cancelado', 'Cancelada'];
const STATUS_PEDIDO_ABERTO = ['Pré-venda', 'Em Análise'];
const STATUS_OP_FECHADA = ['finalizada', 'cancelada', 'estornada'];

/** Junta os bloqueios numa mensagem so', em portugues, dizendo o que fazer. */
const mensagemBloqueioInativacao = (cfg, nome, bloqueios) => (
  `Não é possível inativar ${cfg.artigo} ${cfg.rotulo} "${nome}": ${bloqueios.join('; ')}. `
  + 'Resolva essas pendências e tente de novo.'
);

const mensagemBloqueioExclusao = (cfg, nome, movimentos) => (
  `Não é possível excluir ${cfg.artigo} ${cfg.rotulo} "${nome}" porque ${cfg.artigo === 'a' ? 'ela' : 'ele'} já tem movimentação (${movimentos.join(', ')}). `
  + `Cadastro com histórico não pode ser apagado — inative ${cfg.artigo} ${cfg.rotulo} em vez de excluir.`
);

// ---------------------------------------------------------------------------
// Consultas (Admin SDK)
// ---------------------------------------------------------------------------

const porTenant = (colecao, tenantId) => db.collection(colecao).where('tenantId', '==', tenantId);

/** Documentos do tenant em `colecao` com `campo == valor`. Igualdade pura:
 * nao precisa de indice composto. */
const buscar = async (colecao, tenantId, campo, valor, limite) => {
  let q = porTenant(colecao, tenantId).where(campo, '==', valor);
  if (limite) q = q.limit(limite);
  const snap = await q.get();
  return snap.docs;
};

const existe = async (colecao, tenantId, campo, valor) => (await buscar(colecao, tenantId, campo, valor, 1)).length > 0;

/** Produtos ATIVOS cuja receita usa o componente. */
const receitasAtivasQueUsam = async (tenantId, origem, componenteId) => {
  const snap = await porTenant('produtos_composicao', tenantId).get();
  const pais = snap.docs
    .filter((d) => componentesDaReceita(d.data().itens).some((c) => c.id === componenteId && c.origem === origem))
    .map((d) => d.id);
  if (pais.length === 0) return [];
  const refs = pais.map((id) => db.collection('estoque').doc(id));
  const docs = await db.getAll(...refs);
  return docs
    .filter((d) => d.exists && d.data().tenantId === tenantId && estaAtivo('estoque', d.data()))
    .map((d) => nomeDoCadastro(d.data()));
};

const listarNomes = (nomes, max = 3) => (
  nomes.length <= max ? nomes.map((n) => `"${n}"`).join(', ')
    : `${nomes.slice(0, max).map((n) => `"${n}"`).join(', ')} e mais ${nomes.length - max}`
);

// ---------------------------------------------------------------------------
// Pendencias que impedem INATIVAR
// ---------------------------------------------------------------------------

const PENDENCIAS_INATIVACAO = {
  async clientes(tenantId, id, dados) {
    const bloqueios = [];
    const titulos = (await buscar('transacoes', tenantId, 'clienteId', id))
      .map((d) => d.data()).filter((t) => t.status === 'Pendente');
    if (titulos.length) {
      const total = titulos.reduce((s, t) => s + Number(t.valorCentavos ?? Math.round(Number(t.valor || 0) * 100)), 0);
      bloqueios.push(`tem ${titulos.length} título(s) em aberto no Contas a Receber (${formatarMoeda(total)})`);
    }
    const pedidos = (await buscar('pedidos_venda', tenantId, 'clienteId', id))
      .filter((d) => STATUS_PEDIDO_ABERTO.includes(d.data().status));
    if (pedidos.length) bloqueios.push(`tem ${pedidos.length} pré-venda(s) ou pedido(s) em aberto`);
    const os = (await buscar('ordens_de_servico', tenantId, 'clienteId', id))
      .filter((d) => !STATUS_OS_FECHADA.includes(d.data().status));
    if (os.length) bloqueios.push(`tem ${os.length} ordem(ns) de serviço em aberto`);
    const orcamentos = (await buscar('orcamentos', tenantId, 'clienteId', id))
      .filter((d) => !STATUS_ORCAMENTO_FECHADO.includes(d.data().status));
    if (orcamentos.length) bloqueios.push(`tem ${orcamentos.length} orçamento(s) em aberto`);
    const creditos = [
      ...(await buscar('creditos_cliente', tenantId, 'clienteId', id)),
      ...(dados.nome ? await buscar('creditos_cliente', tenantId, 'clienteNome', dados.nome) : []),
    ];
    const vistos = new Set();
    const saldoCredito = creditos
      .filter((d) => (vistos.has(d.id) ? false : vistos.add(d.id)))
      .reduce((s, d) => s + Math.max(0, Number(d.data().saldoDisponivelCentavos || 0)), 0);
    if (saldoCredito > 0) bloqueios.push(`tem ${formatarMoeda(saldoCredito)} de crédito disponível a usar`);
    return bloqueios;
  },

  async fornecedores(tenantId, id) {
    const titulos = (await buscar('transacoes', tenantId, 'fornecedorId', id))
      .map((d) => d.data()).filter((t) => t.status === 'Pendente');
    if (!titulos.length) return [];
    const total = titulos.reduce((s, t) => s + Number(t.valorCentavos ?? Math.round(Number(t.valor || 0) * 100)), 0);
    return [`tem ${titulos.length} título(s) em aberto no Contas a Pagar (${formatarMoeda(total)})`];
  },

  async estoque(tenantId, id, dados) {
    const bloqueios = [];
    if (Number(dados.quantidadeReservada || 0) > 0) {
      bloqueios.push(`tem ${dados.quantidadeReservada} reservado(s) em pré-venda aberta`);
    }
    const receitas = await receitasAtivasQueUsam(tenantId, 'estoque', id);
    if (receitas.length) bloqueios.push(`é componente da receita de ${listarNomes(receitas)}`);
    const producao = (await buscar('ordens_producao', tenantId, 'produtoId', id))
      .filter((d) => !STATUS_OP_FECHADA.includes(d.data().status));
    if (producao.length) bloqueios.push(`tem ${producao.length} ordem(ns) de produção em aberto`);
    return bloqueios;
  },

  async materias_primas(tenantId, id) {
    const receitas = await receitasAtivasQueUsam(tenantId, 'materia_prima', id);
    return receitas.length ? [`é componente da receita de ${listarNomes(receitas)}`] : [];
  },

  async veiculos(tenantId, id, dados) {
    if (!dados.placa) return [];
    const os = (await buscar('ordens_de_servico', tenantId, 'placa', dados.placa))
      .filter((d) => !STATUS_OS_FECHADA.includes(d.data().status));
    return os.length ? [`tem ${os.length} ordem(ns) de serviço em aberto`] : [];
  },

  async unidades_medida(tenantId, id, dados) {
    const produtos = (await buscar('estoque', tenantId, 'unidadeMedidaId', id))
      .filter((d) => estaAtivo('estoque', d.data())).map((d) => nomeDoCadastro(d.data()));
    const materias = dados.sigla
      ? (await buscar('materias_primas', tenantId, 'unidade', String(dados.sigla).toUpperCase()))
        .filter((d) => estaAtivo('materias_primas', d.data())).map((d) => nomeDoCadastro(d.data()))
      : [];
    const bloqueios = [];
    if (produtos.length) bloqueios.push(`está em uso por ${produtos.length} produto(s) ativo(s), como ${listarNomes(produtos, 2)}`);
    if (materias.length) bloqueios.push(`está em uso por ${materias.length} matéria(s)-prima(s) ativa(s), como ${listarNomes(materias, 2)}`);
    return bloqueios;
  },

  async bancos(tenantId, id, dados) {
    const bloqueios = [];
    const saldo = Number(dados.saldoCentavos || 0);
    if (saldo !== 0) bloqueios.push(`está com saldo de ${formatarMoeda(saldo)} (zere o saldo antes, transferindo para outro banco)`);
    const pendentes = (await buscar('transacoes', tenantId, 'bancoId', id))
      .filter((d) => d.data().status === 'Pendente');
    if (pendentes.length) bloqueios.push(`tem ${pendentes.length} lançamento(s) pendente(s) previstos para cair nele`);
    return bloqueios;
  },
};

// ---------------------------------------------------------------------------
// Movimentacao que impede EXCLUIR
// ---------------------------------------------------------------------------

/** Algum documento do tenant em `colecao` tem, na lista `campoLista`, um
 * item com `campoId == id`? Le so' o campo necessario (select). Exclusao e'
 * rara; ler a colecao inteira do tenant aqui e' aceitavel. */
const existeEmLista = async (colecao, tenantId, campoLista, campoId, id) => {
  const snap = await porTenant(colecao, tenantId).select(campoLista).get();
  return snap.docs.some((d) => (Array.isArray(d.data()[campoLista]) ? d.data()[campoLista] : [])
    .some((item) => item && String(item[campoId] || '') === id));
};

const MOVIMENTOS_EXCLUSAO = {
  async clientes(tenantId, id, dados) {
    const checagens = [
      ['pedidos_venda', 'vendas'], ['ordens_de_servico', 'ordens de serviço'], ['orcamentos', 'orçamentos'],
      ['transacoes', 'lançamentos financeiros'], ['creditos_cliente', 'créditos'], ['devolucoes_venda', 'devoluções'],
      ['notas_fiscais', 'notas fiscais'], ['veiculos', 'veículos cadastrados'],
    ];
    const achados = [];
    for (const [colecao, rotulo] of checagens) {
      if (await existe(colecao, tenantId, 'clienteId', id)) achados.push(rotulo);
    }
    return achados;
  },

  async fornecedores(tenantId, id) {
    const achados = [];
    if (await existe('transacoes', tenantId, 'fornecedorId', id)) achados.push('lançamentos financeiros');
    if (await existe('notas_fiscais_entrada', tenantId, 'fornecedorId', id)) achados.push('notas de entrada');
    return achados;
  },

  async estoque(tenantId, id, dados) {
    const achados = [];
    if (Number(dados.quantidade || 0) !== 0) achados.push(`saldo de ${dados.quantidade} em estoque`);
    if (await existe('ajustes_estoque', tenantId, 'produtoId', id)) achados.push('ajustes de estoque');
    if (await existe('ordens_producao', tenantId, 'produtoId', id)) achados.push('ordens de produção');
    if (await existe('estoque_lotes', tenantId, 'produtoId', id)) achados.push('lotes');
    if (await existeEmLista('pedidos_venda', tenantId, 'itens', 'id', id)) achados.push('vendas');
    if (await existeEmLista('orcamentos', tenantId, 'itens', 'id', id)) achados.push('orçamentos');
    if (await existeEmLista('ordens_de_servico', tenantId, 'pecas', 'id', id)) achados.push('ordens de serviço');
    if (await existeEmLista('notas_avulsas', tenantId, 'itens', 'produtoId', id)) achados.push('notas avulsas');
    if (await existeEmLista('notas_fiscais_entrada', tenantId, 'itens', 'itemId', id)) achados.push('notas de entrada');
    if ((await receitasQueUsamTodas(tenantId, 'estoque', id)).length) achados.push('receitas de outros produtos');
    return achados;
  },

  async materias_primas(tenantId, id, dados) {
    const achados = [];
    if (Number(dados.quantidade || 0) !== 0) achados.push(`saldo de ${dados.quantidade} em estoque`);
    if (await existe('ajustes_estoque', tenantId, 'produtoId', id)) achados.push('ajustes de estoque');
    if (await existeEmLista('notas_fiscais_entrada', tenantId, 'itens', 'itemId', id)) achados.push('notas de entrada');
    const ops = await porTenant('ordens_producao', tenantId).select('itensConsumidos').get();
    const consumida = ops.docs.some((d) => componentesDaReceita(d.data().itensConsumidos)
      .some((c) => c.id === id && c.origem === 'materia_prima'));
    if (consumida) achados.push('ordens de produção');
    if ((await receitasQueUsamTodas(tenantId, 'materia_prima', id)).length) achados.push('receitas de produtos');
    return achados;
  },
};

/** Receitas (de produto ativo OU inativo) que usam o componente -- pra
 * exclusao, qualquer receita conta: apagar deixaria a receita apontando
 * pro nada. */
const receitasQueUsamTodas = async (tenantId, origem, componenteId) => {
  const snap = await porTenant('produtos_composicao', tenantId).get();
  return snap.docs.filter((d) => componentesDaReceita(d.data().itens)
    .some((c) => c.id === componenteId && c.origem === origem));
};

// ---------------------------------------------------------------------------
// Operacoes
// ---------------------------------------------------------------------------

const carregar = async (user, colecao, id) => {
  const cfg = CADASTROS[colecao];
  if (!cfg) throw new ErroCadastro(400, 'Tipo de cadastro inválido.');
  if (!id || typeof id !== 'string') throw new ErroCadastro(400, 'Cadastro não informado.');
  if (!temPermissao(user, cfg.permissoes)) {
    throw new ErroCadastro(403, `Você não tem permissão para alterar ${cfg.plural}. Peça ao administrador da empresa.`);
  }
  const ref = db.collection(colecao).doc(id);
  const snap = await ref.get();
  // Documento de outra empresa responde igual a inexistente: nao confirma
  // que o id existe.
  if (!snap.exists || snap.data().tenantId !== user.tenantId) {
    throw new ErroCadastro(404, `${cfg.rotulo.charAt(0).toUpperCase()}${cfg.rotulo.slice(1)} não encontrad${cfg.artigo}. Atualize a tela e tente de novo.`);
  }
  return { cfg, ref, dados: snap.data() };
};


/**
 * Ativa ou inativa um cadastro. Devolve { ativo, saldoZerado } --
 * saldoZerado e' a quantidade que estava no estoque quando a inativacao
 * zerou o saldo (0 quando nao havia saldo).
 */
async function alterarSituacao({ user, colecao, id, ativo }) {
  if (typeof ativo !== 'boolean') throw new ErroCadastro(400, 'Situação inválida.');
  const { cfg, ref, dados } = await carregar(user, colecao, id);
  const nome = nomeDoCadastro(dados);

  if (ativo) {
    await ref.update({
      ativo: true,
      ...(colecao === 'estoque' ? { statusAtivo: true } : {}),
      updatedAt: TIMESTAMP(),
      alteradoPor: user.uid,
      alteradoEm: TIMESTAMP(),
      ultimaAlteracao: `${cfg.rotulo.charAt(0).toUpperCase()}${cfg.rotulo.slice(1)} reativad${cfg.artigo}`,
    });
    registrarLog(user, { modulo: colecao, acao: 'ativacao', descricao: `${nome} reativad${cfg.artigo}.`, registroId: id,
      alteracoes: [{ campo: 'ativo', valorAnterior: false, valorNovo: true }] });
    return { ativo: true, saldoZerado: 0 };
  }

  const checar = PENDENCIAS_INATIVACAO[colecao];
  const bloqueios = checar ? await checar(user.tenantId, id, dados) : [];
  if (bloqueios.length) throw new ErroCadastro(409, mensagemBloqueioInativacao(cfg, nome, bloqueios));

  let saldoZerado = 0;
  await db.runTransaction(async (tx) => {
    const atual = await tx.get(ref);
    const d = atual.data();
    // Saldo relido aqui dentro: entre a checagem e agora uma venda pode ter
    // mexido no estoque. O que zera e' o saldo deste instante.
    const quantidadeAntes = cfg.temSaldo ? Number(d.quantidade || 0) : 0;
    const zerar = cfg.temSaldo && Number.isFinite(quantidadeAntes) && quantidadeAntes !== 0;
    tx.update(ref, {
      ativo: false,
      ...(colecao === 'estoque' ? { statusAtivo: false } : {}),
      ...(zerar ? { quantidade: 0 } : {}),
      updatedAt: TIMESTAMP(),
      alteradoPor: user.uid,
      alteradoEm: TIMESTAMP(),
      ultimaAlteracao: zerar
        ? `${cfg.rotulo.charAt(0).toUpperCase()}${cfg.rotulo.slice(1)} inativad${cfg.artigo} (estoque zerado de ${quantidadeAntes})`
        : `${cfg.rotulo.charAt(0).toUpperCase()}${cfg.rotulo.slice(1)} inativad${cfg.artigo}`,
    });
    if (zerar) {
      saldoZerado = quantidadeAntes;
      tx.set(db.collection('ajustes_estoque').doc(), {
        tenantId: user.tenantId,
        produtoId: id,
        produtoNome: nome,
        ...(d.codigo ? { produtoCodigo: String(d.codigo) } : {}),
        tipo: quantidadeAntes > 0 ? 'saida' : 'entrada',
        quantidade: Math.abs(quantidadeAntes),
        motivo: quantidadeAntes > 0 ? 'correcao_inventario' : 'correcao_cadastro',
        observacao: `Estoque zerado automaticamente na inativação ${cfg.artigo === 'a' ? 'da' : 'do'} ${cfg.rotulo}.`,
        quantidadeAntes,
        quantidadeDepois: 0,
        usuarioId: user.uid,
        usuarioNome: user.email || user.uid,
        ...(colecao === 'materias_primas' ? { origem: 'materia_prima' } : {}),
        createdAt: TIMESTAMP(),
      });
    }
  });

  registrarLog(user, {
    modulo: colecao,
    acao: 'inativacao',
    descricao: `${nome} inativad${cfg.artigo}${saldoZerado ? ` (estoque zerado de ${saldoZerado})` : ''}.`,
    registroId: id,
    alteracoes: [
      { campo: 'ativo', valorAnterior: true, valorNovo: false },
      ...(saldoZerado ? [{ campo: 'quantidade', valorAnterior: saldoZerado, valorNovo: 0 }] : []),
    ],
  });
  return { ativo: false, saldoZerado };
}

/** Exclui um cadastro que nunca teve movimentacao. */
async function excluirCadastro({ user, colecao, id }) {
  const { cfg, ref, dados } = await carregar(user, colecao, id);
  if (!cfg.excluivel) throw new ErroCadastro(400, `${cfg.rotulo.charAt(0).toUpperCase()}${cfg.rotulo.slice(1)} não pode ser excluíd${cfg.artigo} — apenas inativad${cfg.artigo}.`);
  const nome = nomeDoCadastro(dados);
  if (dados.isPadrao) throw new ErroCadastro(409, `"${nome}" é um cadastro padrão do sistema e não pode ser excluído.`);
  const movimentos = await MOVIMENTOS_EXCLUSAO[colecao](user.tenantId, id, dados);
  if (movimentos.length) throw new ErroCadastro(409, mensagemBloqueioExclusao(cfg, nome, movimentos));

  const lote = db.batch();
  lote.delete(ref);
  // A receita do proprio produto e' parte do cadastro dele: vai junto.
  if (colecao === 'estoque') lote.delete(db.collection('produtos_composicao').doc(id));
  await lote.commit();

  registrarLog(user, { modulo: colecao, acao: 'exclusao', descricao: `${nome} excluíd${cfg.artigo} (sem movimentação).`, registroId: id });
  return { excluido: true };
}

module.exports = {
  ErroCadastro,
  alterarSituacao,
  excluirCadastro,
  // expostos pros testes
  CADASTROS,
  temPermissao,
  estaAtivo,
  componentesDaReceita,
  mensagemBloqueioInativacao,
  mensagemBloqueioExclusao,
  listarNomes,
};
