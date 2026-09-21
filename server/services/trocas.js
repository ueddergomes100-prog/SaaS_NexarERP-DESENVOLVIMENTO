/**
 * TROCA DE MERCADORIA PELO APP DO VENDEDOR (2026-09-21).
 *
 * Produto natural chega ao cliente rasgado ou com bicho; o cliente descarta e a
 * loja entrega outro igual, SEM COBRAR. Por isso a troca:
 *   - baixa o estoque UMA vez (a reposicao); o item estragado nao volta ao
 *     estoque -- ja saiu na venda original e o cliente joga fora;
 *   - NAO gera financeiro, credito, comissao nem entra em faturamento;
 *   - vive numa colecao propria (`trocas`), nunca dentro de `pedidos_venda`
 *     (mais de 18 telas leem pedidos e 30+ pontos comparam status na mao: uma
 *     troca de R$ 0,00 ali viraria "venda" em ticket medio, ranking e comissao).
 *
 * Plano completo e decisoes do dono: docs/PLANO_TROCAS_VENDEDOR.md.
 *
 * Este modulo e' so' regra PURA (sem Firestore, sem HTTP): validacao do pedido,
 * aviso de historico, maquina de estados e o calculo do que muda no estoque. Quem
 * le e grava e' routes/trocas.routes.js, que roda com o Admin SDK -- o app do
 * vendedor nunca escreve em `trocas` nem em `estoque` (regra do dono: nada pode
 * ser alterado pelo DevTools).
 */

const MOTIVOS_TROCA = [
  { value: 'embalagem_rasgada', label: 'Embalagem rasgada' },
  { value: 'com_bicho', label: 'Com bicho' },
  { value: 'vencido', label: 'Vencido ou vencendo' },
  { value: 'produto_errado', label: 'Produto errado' },
  { value: 'outro', label: 'Outro' },
];

const STATUS_TROCA = {
  SOLICITADA: 'Solicitada',
  APROVADA: 'Aprovada',
  RECUSADA: 'Recusada',
  ENTREGUE: 'Entregue',
  CANCELADA: 'Cancelada',
};

const TRANSICOES = {
  Solicitada: ['Aprovada', 'Recusada', 'Cancelada'],
  Aprovada: ['Entregue', 'Cancelada'],
  Recusada: [],
  Entregue: [],
  Cancelada: [],
};

const DIAS_HISTORICO_PADRAO = 60;
const OBSERVACAO_MAX = 200;
const DESCRICAO_MOTIVO_MAX = 120;
const MAX_ITENS = 50;
const PRECISAO_QUANTIDADE = 6;

const arredondar = (valor, casas) => {
  const fator = 10 ** casas;
  return Math.round((Number(valor) + Number.EPSILON) * fator) / fator;
};

const rotuloDoMotivo = (motivo) => MOTIVOS_TROCA.find((m) => m.value === motivo)?.label || String(motivo || '');

/** Tira quebra de linha e espaco repetido e corta no limite (a minuta imprime numa linha so'). */
const normalizarObservacao = (texto) => String(texto ?? '').replace(/\s+/g, ' ').trim().slice(0, OBSERVACAO_MAX);

// ---------------------------------------------------------------------------
// Maquina de estados
// ---------------------------------------------------------------------------

const podeTransitar = (de, para) => (TRANSICOES[de] || []).includes(para);

/** Mensagem em portugues de por que a troca nao pode ir pra esse estado, ou null se pode. */
const erroDeTransicao = (de, para) => {
  if (podeTransitar(de, para)) return null;
  const acao = {
    Aprovada: 'aprovada',
    Recusada: 'recusada',
    Entregue: 'entregue',
    Cancelada: 'cancelada',
  }[para] || 'alterada';
  const situacao = {
    Solicitada: 'ainda está aguardando aprovação',
    Aprovada: 'já foi aprovada',
    Recusada: 'já foi recusada',
    Entregue: 'já foi entregue',
    Cancelada: 'já foi cancelada',
  }[de] || `está como "${de}"`;
  if (para === 'Entregue' && de === 'Solicitada') return 'Esta troca ainda não foi aprovada. Aprove antes de confirmar a entrega.';
  // Mesmo estado (duplo clique, duas telas): so' informa, sem repetir "nao pode ser".
  if (de === para) return `Esta troca ${situacao}.`;
  return `Esta troca ${situacao} e não pode ser ${acao}.`;
};

// ---------------------------------------------------------------------------
// Pedido de troca (o que o vendedor manda)
// ---------------------------------------------------------------------------

/**
 * Confere o que veio do app. So' aceita `id`, `quantidade`, `motivo` e a
 * descricao do motivo: nome, unidade e demais dados do produto vem SEMPRE do
 * cadastro (montarItensDaTroca), nunca do que o app mandou.
 * @returns {{ itens: object[], erros: string[] }}
 */
const validarItensDoPedido = (itensBrutos) => {
  const erros = [];
  if (!Array.isArray(itensBrutos) || itensBrutos.length === 0) {
    return { itens: [], erros: ['Adicione pelo menos um item na troca.'] };
  }
  if (itensBrutos.length > MAX_ITENS) {
    return { itens: [], erros: [`Uma troca aceita no máximo ${MAX_ITENS} itens. Divida em duas trocas.`] };
  }

  const itens = [];
  itensBrutos.forEach((bruto, indice) => {
    const posicao = `Item ${indice + 1}`;
    const id = String(bruto?.id ?? '').trim();
    if (!id) { erros.push(`${posicao}: produto não informado.`); return; }

    const quantidade = arredondar(Number(bruto?.quantidade), PRECISAO_QUANTIDADE);
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      erros.push(`${posicao}: informe a quantidade (maior que zero).`);
      return;
    }
    if (quantidade > 100000) {
      erros.push(`${posicao}: a quantidade está grande demais. Confira o número digitado.`);
      return;
    }

    const motivo = String(bruto?.motivo ?? '').trim();
    if (!MOTIVOS_TROCA.some((m) => m.value === motivo)) {
      erros.push(`${posicao}: escolha o motivo da troca.`);
      return;
    }

    const descricao = String(bruto?.motivoDescricao ?? '').replace(/\s+/g, ' ').trim().slice(0, DESCRICAO_MOTIVO_MAX);
    if (motivo === 'outro' && descricao.length < 3) {
      erros.push(`${posicao}: descreva o motivo (escolheu "Outro").`);
      return;
    }

    itens.push({ id, quantidade, motivo, ...(descricao ? { motivoDescricao: descricao } : {}) });
  });

  return { itens, erros };
};

const quantidadeValidaParaUnidade = (quantidade, fracionado, casas) => {
  if (!fracionado) return Number.isInteger(quantidade);
  const permitidas = Number.isInteger(casas) && casas >= 0 ? casas : 0;
  return arredondar(quantidade, permitidas) === quantidade;
};

const produtoAtivo = (produto) => produto.ativo !== false && produto.statusAtivo !== false;

/**
 * Junta o que o vendedor pediu com o CADASTRO do produto (nome, unidade...).
 * @param {{ itens: object[], produtosPorId: Record<string, object> }} p
 * @returns {{ itens: object[], erros: string[] }}
 */
const montarItensDaTroca = ({ itens, produtosPorId }) => {
  const erros = [];
  const montados = [];
  itens.forEach((item, indice) => {
    const produto = produtosPorId[item.id];
    if (!produto) {
      erros.push(`Item ${indice + 1}: o produto não foi encontrado no cadastro da empresa.`);
      return;
    }
    const nome = String(produto.nome || 'produto sem nome');
    if (!produtoAtivo(produto)) {
      erros.push(`"${nome}" está inativo e não pode ser trocado.`);
      return;
    }
    const fracionado = produto.unidadeMedidaFracionado === true;
    const casas = Number.isInteger(produto.unidadeMedidaCasasDecimais) ? produto.unidadeMedidaCasasDecimais : 0;
    if (!quantidadeValidaParaUnidade(item.quantidade, fracionado, casas)) {
      erros.push(fracionado
        ? `A quantidade de "${nome}" aceita no máximo ${casas} casa(s) decimal(is).`
        : `"${nome}" é contado em ${produto.unidadeMedidaSigla || 'UN'}, que não aceita quantidade fracionada. Use um número inteiro.`);
      return;
    }
    montados.push({
      id: item.id,
      nome,
      ...(produto.codigo ? { codigo: String(produto.codigo) } : {}),
      quantidade: item.quantidade,
      unidadeMedidaSigla: String(produto.unidadeMedidaSigla || 'UN'),
      unidadeMedidaFracionado: fracionado,
      unidadeMedidaCasasDecimais: casas,
      motivo: item.motivo,
      ...(item.motivoDescricao ? { motivoDescricao: item.motivoDescricao } : {}),
    });
  });
  return { itens: montados, erros };
};

// ---------------------------------------------------------------------------
// Aviso anti-abuso (so' avisa; nao bloqueia)
// ---------------------------------------------------------------------------

/** Data em que o pedido vale, em ms (dataVenda, e createdAt como reserva); null se nao da' pra saber. */
const dataDoPedidoMs = (pedido) => {
  if (pedido?.dataVenda) {
    const t = new Date(`${String(pedido.dataVenda).slice(0, 10)}T12:00:00`).getTime();
    if (Number.isFinite(t)) return t;
  }
  const c = pedido?.createdAt;
  if (c && typeof c.toMillis === 'function') return c.toMillis();
  if (c && typeof c.seconds === 'number') return c.seconds * 1000;
  return null;
};

/**
 * O cliente comprou o produto nos ultimos `dias`? Conta pedido em aberto
 * (pre-venda) tambem -- a entrega pode acontecer antes do faturamento -- e so'
 * ignora o cancelado.
 * @returns {{ produtoId: string, produtoNome: string, mensagem: string }[]}
 */
const avisosDeHistorico = ({ itens, pedidosDoCliente, agora = new Date(), dias = DIAS_HISTORICO_PADRAO }) => {
  const limite = agora.getTime() - dias * 24 * 60 * 60 * 1000;
  const comprados = new Set();
  for (const pedido of pedidosDoCliente || []) {
    if (String(pedido.status || '').trim() === 'Cancelada') continue;
    const quando = dataDoPedidoMs(pedido);
    if (quando === null || quando < limite) continue;
    for (const it of Array.isArray(pedido.itens) ? pedido.itens : []) comprados.add(String(it.id));
  }
  const avisos = [];
  const jaAvisados = new Set();
  for (const item of itens) {
    if (comprados.has(item.id) || jaAvisados.has(item.id)) continue;
    jaAvisados.add(item.id);
    avisos.push({
      produtoId: item.id,
      produtoNome: item.nome,
      mensagem: `O cliente não comprou "${item.nome}" nos últimos ${dias} dias.`,
    });
  }
  return avisos;
};

// ---------------------------------------------------------------------------
// Estoque
// ---------------------------------------------------------------------------

/** Soma por produto (varios itens do mesmo produto viram uma linha so'). */
const somarPorProduto = (itens) => {
  const mapa = new Map();
  for (const item of itens) {
    const atual = mapa.get(item.id);
    mapa.set(item.id, { id: item.id, nome: atual?.nome || item.nome, quantidade: arredondar((atual?.quantidade || 0) + item.quantidade, PRECISAO_QUANTIDADE) });
  }
  return [...mapa.values()];
};

const numero = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * APROVAR: reserva o estoque da reposicao. So' mexe em `quantidadeReservada`.
 * Falta de estoque volta como erro em portugues, a menos que a empresa (ou o
 * produto) permita vender sem estoque.
 * @returns {{ ok: boolean, erros: string[], reservas: { id: string, nome: string, reservadaDepois: number }[] }}
 */
const planoDeReserva = ({ itens, produtosPorId, permiteSemEstoque = false }) => {
  const erros = [];
  const reservas = [];
  for (const linha of somarPorProduto(itens)) {
    const produto = produtosPorId[linha.id];
    if (!produto) { erros.push(`O produto "${linha.nome}" não foi encontrado no cadastro.`); continue; }
    if (!produtoAtivo(produto)) { erros.push(`"${linha.nome}" está inativo e não pode ser trocado.`); continue; }
    const quantidade = numero(produto.quantidade);
    const reservada = numero(produto.quantidadeReservada);
    const disponivel = arredondar(quantidade - reservada, PRECISAO_QUANTIDADE);
    const liberado = permiteSemEstoque || produto.permitirEstoqueNegativo === true;
    if (!liberado && disponivel < linha.quantidade) {
      erros.push(`Estoque insuficiente para "${linha.nome}": a troca pede ${linha.quantidade}, disponível ${Math.max(0, disponivel)}.`);
      continue;
    }
    reservas.push({ id: linha.id, nome: linha.nome, reservadaDepois: arredondar(reservada + linha.quantidade, PRECISAO_QUANTIDADE) });
  }
  return { ok: erros.length === 0, erros, reservas };
};

/** CANCELAR uma troca aprovada: devolve a reserva. */
const planoDeLiberacao = ({ itens, produtosPorId }) => {
  const liberacoes = [];
  for (const linha of somarPorProduto(itens)) {
    const produto = produtosPorId[linha.id];
    if (!produto) continue; // produto sumiu: nao ha o que liberar
    liberacoes.push({ id: linha.id, reservadaDepois: Math.max(0, arredondar(numero(produto.quantidadeReservada) - linha.quantidade, PRECISAO_QUANTIDADE)) });
  }
  return liberacoes;
};

const custoCentavos = (produto) => Math.max(0, Math.round(numero(produto?.precoCusto) * 100));

/**
 * ENTREGAR: baixa o estoque (quantidade e reserva) e monta o que precisa ser
 * gravado: um ajuste de saida por item (aparece no Relatorio de Ajustes como
 * "Troca de cliente"), os saldos de produto e de lote, e o custo de cada item.
 *
 * Produto que controla lote exige que a loja diga de QUAL lote a reposicao saiu
 * (`lotesEscolhidos[indiceDoItem]`), e o lote precisa ter saldo.
 *
 * @param {object} p
 * @param {object[]} p.itens itens da troca
 * @param {Record<string, object>} p.produtosPorId
 * @param {Record<number, string>} [p.lotesEscolhidos] indice do item -> id do lote
 * @param {Record<string, object>} [p.lotesPorId]
 * @param {boolean} p.estavaReservado a troca foi aprovada com reserva de estoque?
 * @param {{ tenantId: string, trocaId?: string, numeroTroca: string, clienteNome: string, usuarioId: string, usuarioNome: string, permiteSemEstoque?: boolean }} p.contexto
 */
const planoDeEntrega = ({ itens, produtosPorId, lotesEscolhidos = {}, lotesPorId = {}, estavaReservado, contexto }) => {
  const erros = [];
  const saldoProduto = {}; // id -> { quantidade, reservada } evoluindo item a item
  const saldoLote = {}; // id -> saldo evoluindo
  const ajustes = [];
  const itensFinais = [];

  itens.forEach((item, indice) => {
    const produto = produtosPorId[item.id];
    if (!produto) { erros.push(`O produto "${item.nome}" não foi encontrado no cadastro.`); return; }

    if (!saldoProduto[item.id]) {
      saldoProduto[item.id] = { quantidade: numero(produto.quantidade), reservada: numero(produto.quantidadeReservada), nome: item.nome };
    }
    const atual = saldoProduto[item.id];
    const antes = atual.quantidade;
    const depois = arredondar(antes - item.quantidade, PRECISAO_QUANTIDADE);
    if (depois < 0 && produto.permitirEstoqueNegativo !== true && contexto.permiteSemEstoque !== true) {
      erros.push(`Estoque insuficiente para "${item.nome}": a troca pede ${item.quantidade}, há ${Math.max(0, antes)} no estoque.`);
      return;
    }

    let lote = null;
    if (produto.controlarLote === true) {
      const loteId = lotesEscolhidos[indice];
      const doc = loteId ? lotesPorId[loteId] : null;
      if (!loteId || !doc || doc.produtoId !== item.id || doc.tenantId !== contexto.tenantId) {
        erros.push(`"${item.nome}" controla lote e validade: escolha de qual lote a reposição saiu.`);
        return;
      }
      if (saldoLote[loteId] === undefined) saldoLote[loteId] = numero(doc.quantidade);
      const saldoDepois = arredondar(saldoLote[loteId] - item.quantidade, PRECISAO_QUANTIDADE);
      if (saldoDepois < 0) {
        erros.push(`O lote "${doc.lote}" de "${item.nome}" tem só ${Math.max(0, saldoLote[loteId])}; a troca pede ${item.quantidade}. Escolha outro lote.`);
        return;
      }
      saldoLote[loteId] = saldoDepois;
      lote = { id: loteId, codigo: doc.lote, validade: doc.validade || null };
    }

    atual.quantidade = depois;
    // Aprovada reservou este estoque: a baixa consome a reserva junto com a quantidade.
    if (estavaReservado) atual.reservada = Math.max(0, arredondar(atual.reservada - item.quantidade, PRECISAO_QUANTIDADE));

    const custoUnitarioCentavos = custoCentavos(produto);
    ajustes.push({
      tenantId: contexto.tenantId,
      produtoId: item.id,
      produtoNome: item.nome,
      ...(item.codigo ? { produtoCodigo: item.codigo } : {}),
      tipo: 'saida',
      quantidade: item.quantidade,
      motivo: 'troca_cliente',
      observacao: `Troca #${contexto.numeroTroca} — ${contexto.clienteNome} — ${rotuloDoMotivo(item.motivo)}${item.motivoDescricao ? ` (${item.motivoDescricao})` : ''}`,
      ...(lote ? { loteId: lote.id, lote: lote.codigo, ...(lote.validade ? { validade: lote.validade } : {}) } : {}),
      quantidadeAntes: antes,
      quantidadeDepois: depois,
      usuarioId: contexto.usuarioId,
      usuarioNome: contexto.usuarioNome,
      ...(contexto.trocaId ? { trocaId: contexto.trocaId } : {}),
      numeroTroca: contexto.numeroTroca,
    });
    itensFinais.push({
      ...item,
      custoUnitarioCentavos,
      ...(lote ? { loteId: lote.id, lote: lote.codigo } : {}),
    });
  });

  const produtos = Object.entries(saldoProduto).map(([id, s]) => ({ id, quantidadeDepois: s.quantidade, reservadaDepois: s.reservada }));
  const lotes = Object.entries(saldoLote).map(([id, saldo]) => ({ id, saldoDepois: saldo }));
  const custoTotalCentavos = itensFinais.reduce((soma, i) => soma + Math.round(i.custoUnitarioCentavos * i.quantidade), 0);
  return { ok: erros.length === 0, erros, produtos, lotes, ajustes, itensFinais, custoTotalCentavos };
};

module.exports = {
  MOTIVOS_TROCA,
  STATUS_TROCA,
  DIAS_HISTORICO_PADRAO,
  OBSERVACAO_MAX,
  MAX_ITENS,
  rotuloDoMotivo,
  normalizarObservacao,
  podeTransitar,
  erroDeTransicao,
  validarItensDoPedido,
  montarItensDaTroca,
  avisosDeHistorico,
  somarPorProduto,
  planoDeReserva,
  planoDeLiberacao,
  planoDeEntrega,
};
