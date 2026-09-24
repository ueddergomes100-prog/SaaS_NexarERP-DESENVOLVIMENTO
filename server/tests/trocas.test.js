const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MOTIVOS_TROCA,
  OBSERVACAO_MAX,
  MAX_ITENS,
  normalizarObservacao,
  rotuloDoMotivo,
  podeTransitar,
  erroDeTransicao,
  validarItensDoPedido,
  montarItensDaTroca,
  avisosDeHistorico,
  somarPorProduto,
  configPermiteSemEstoque,
  planoDeReserva,
  planoDeLiberacao,
  planoDeEntrega,
} = require('../services/trocas');

const AGORA = new Date('2026-09-21T15:00:00.000Z');
const dias = (n) => new Date(AGORA.getTime() - n * 24 * 3600 * 1000).toISOString().slice(0, 10);

const produto = (extra = {}) => ({ nome: 'GRANOLA 1KG', codigo: '1019', unidadeMedidaSigla: 'UN', unidadeMedidaFracionado: false, unidadeMedidaCasasDecimais: 0, quantidade: 10, quantidadeReservada: 0, precoCusto: 12.5, ...extra });
const item = (extra = {}) => ({ id: 'p1', nome: 'GRANOLA 1KG', quantidade: 2, motivo: 'com_bicho', ...extra });

// ---------------------------------------------------------------------------
// motivos, observacao, estados
// ---------------------------------------------------------------------------

test('motivos: os cinco combinados e rotulo em portugues', () => {
  assert.deepEqual(MOTIVOS_TROCA.map((m) => m.value), ['embalagem_rasgada', 'com_bicho', 'vencido', 'produto_errado', 'outro']);
  assert.equal(rotuloDoMotivo('com_bicho'), 'Com bicho');
  assert.equal(rotuloDoMotivo('desconhecido'), 'desconhecido');
});

test('observacao: espaco e quebra de linha viram um espaco e corta no limite', () => {
  assert.equal(normalizarObservacao('  Levar\n\n amanha  '), 'Levar amanha');
  assert.equal(normalizarObservacao(null), '');
  assert.equal(normalizarObservacao('x'.repeat(OBSERVACAO_MAX + 30)).length, OBSERVACAO_MAX);
});

test('estados: so as transicoes combinadas', () => {
  assert.equal(podeTransitar('Solicitada', 'Aprovada'), true);
  assert.equal(podeTransitar('Solicitada', 'Recusada'), true);
  assert.equal(podeTransitar('Solicitada', 'Cancelada'), true);
  assert.equal(podeTransitar('Aprovada', 'Entregue'), true);
  assert.equal(podeTransitar('Aprovada', 'Cancelada'), true);
  assert.equal(podeTransitar('Solicitada', 'Entregue'), false); // sem aprovar nao entrega
  assert.equal(podeTransitar('Aprovada', 'Recusada'), false);
  for (const final of ['Recusada', 'Entregue', 'Cancelada']) {
    for (const alvo of ['Solicitada', 'Aprovada', 'Recusada', 'Entregue', 'Cancelada']) assert.equal(podeTransitar(final, alvo), false, `${final}->${alvo}`);
  }
});

test('estados: mensagem em portugues diz por que nao pode', () => {
  assert.equal(erroDeTransicao('Solicitada', 'Aprovada'), null);
  assert.match(erroDeTransicao('Solicitada', 'Entregue'), /Aprove antes/);
  assert.match(erroDeTransicao('Entregue', 'Cancelada'), /já foi entregue e não pode ser cancelada/);
  assert.equal(erroDeTransicao('Entregue', 'Entregue'), 'Esta troca já foi entregue.');
  assert.equal(erroDeTransicao('Aprovada', 'Aprovada'), 'Esta troca já foi aprovada.');
  assert.match(erroDeTransicao('Recusada', 'Aprovada'), /já foi recusada e não pode ser aprovada/);
  assert.match(erroDeTransicao('Cancelada', 'Entregue'), /já foi cancelada/);
});

// ---------------------------------------------------------------------------
// pedido do vendedor
// ---------------------------------------------------------------------------

test('pedido: lista vazia ou grande demais e recusada', () => {
  assert.match(validarItensDoPedido([]).erros[0], /pelo menos um item/);
  assert.match(validarItensDoPedido(undefined).erros[0], /pelo menos um item/);
  const muitos = Array.from({ length: MAX_ITENS + 1 }, () => ({ id: 'p', quantidade: 1, motivo: 'vencido' }));
  assert.match(validarItensDoPedido(muitos).erros[0], /no máximo 50 itens/);
});

test('pedido: item valido passa e so guarda id, quantidade, motivo e descricao (ignora preco e nome do app)', () => {
  const r = validarItensDoPedido([{ id: ' p1 ', quantidade: '3', motivo: 'com_bicho', nome: 'NOME FALSO', precoUnitario: 999, subtotal: 999 }]);
  assert.deepEqual(r.erros, []);
  assert.deepEqual(r.itens, [{ id: 'p1', quantidade: 3, motivo: 'com_bicho' }]);
});

test('pedido: erros em portugues com a posicao do item', () => {
  const r = validarItensDoPedido([
    { id: '', quantidade: 1, motivo: 'vencido' },
    { id: 'p1', quantidade: 0, motivo: 'vencido' },
    { id: 'p1', quantidade: -2, motivo: 'vencido' },
    { id: 'p1', quantidade: 'abc', motivo: 'vencido' },
    { id: 'p1', quantidade: 1, motivo: 'inventado' },
    { id: 'p1', quantidade: 1 },
    { id: 'p1', quantidade: 1, motivo: 'outro' },
    { id: 'p1', quantidade: 1, motivo: 'outro', motivoDescricao: 'ab' },
  ]);
  assert.equal(r.itens.length, 0);
  assert.match(r.erros[0], /^Item 1: produto não informado/);
  assert.match(r.erros[1], /^Item 2: informe a quantidade/);
  assert.match(r.erros[2], /^Item 3: informe a quantidade/);
  assert.match(r.erros[3], /^Item 4: informe a quantidade/);
  assert.match(r.erros[4], /^Item 5: escolha o motivo/);
  assert.match(r.erros[5], /^Item 6: escolha o motivo/);
  assert.match(r.erros[6], /^Item 7: descreva o motivo/);
  assert.match(r.erros[7], /^Item 8: descreva o motivo/);
});

test('pedido: "Outro" com descricao passa; descricao limpa e cortada', () => {
  const r = validarItensDoPedido([{ id: 'p1', quantidade: 1, motivo: 'outro', motivoDescricao: '  Cheiro   estranho\n no  saco ' }]);
  assert.deepEqual(r.erros, []);
  assert.equal(r.itens[0].motivoDescricao, 'Cheiro estranho no saco');
});

test('pedido: quantidade absurda e recusada', () => {
  assert.match(validarItensDoPedido([{ id: 'p1', quantidade: 100001, motivo: 'vencido' }]).erros[0], /grande demais/);
});

// ---------------------------------------------------------------------------
// junta com o cadastro do produto
// ---------------------------------------------------------------------------

test('cadastro: nome, codigo e unidade vem do PRODUTO, nao do app', () => {
  const r = montarItensDaTroca({ itens: [{ id: 'p1', quantidade: 2, motivo: 'com_bicho' }], produtosPorId: { p1: produto() } });
  assert.deepEqual(r.erros, []);
  assert.deepEqual(r.itens[0], {
    id: 'p1', nome: 'GRANOLA 1KG', codigo: '1019', quantidade: 2, unidadeMedidaSigla: 'UN', unidadeMedidaFracionado: false, unidadeMedidaCasasDecimais: 0, motivo: 'com_bicho',
  });
});

test('cadastro: produto inexistente ou inativo e recusado', () => {
  assert.match(montarItensDaTroca({ itens: [{ id: 'x', quantidade: 1, motivo: 'vencido' }], produtosPorId: {} }).erros[0], /não foi encontrado/);
  assert.match(montarItensDaTroca({ itens: [item()], produtosPorId: { p1: produto({ ativo: false }) } }).erros[0], /inativo/);
  assert.match(montarItensDaTroca({ itens: [item()], produtosPorId: { p1: produto({ statusAtivo: false }) } }).erros[0], /inativo/);
});

test('cadastro: unidade inteira nao aceita fracao; fracionada respeita as casas', () => {
  const inteiro = montarItensDaTroca({ itens: [item({ quantidade: 1.5 })], produtosPorId: { p1: produto() } });
  assert.match(inteiro.erros[0], /não aceita quantidade fracionada/);
  const kg = produto({ unidadeMedidaSigla: 'KG', unidadeMedidaFracionado: true, unidadeMedidaCasasDecimais: 2 });
  assert.deepEqual(montarItensDaTroca({ itens: [item({ quantidade: 1.25 })], produtosPorId: { p1: kg } }).erros, []);
  assert.match(montarItensDaTroca({ itens: [item({ quantidade: 1.255 })], produtosPorId: { p1: kg } }).erros[0], /no máximo 2 casa/);
});

// ---------------------------------------------------------------------------
// aviso de historico
// ---------------------------------------------------------------------------

const pedido = (status, dataVenda, ids) => ({ status, dataVenda, itens: ids.map((id) => ({ id })) });

test('aviso: cliente que comprou o produto recentemente nao recebe aviso', () => {
  const avisos = avisosDeHistorico({ itens: [item()], pedidosDoCliente: [pedido('Finalizada', dias(10), ['p1'])], agora: AGORA });
  assert.deepEqual(avisos, []);
});

test('aviso: sem compra nos ultimos 60 dias avisa (compra antiga nao vale)', () => {
  const avisos = avisosDeHistorico({ itens: [item()], pedidosDoCliente: [pedido('Finalizada', dias(61), ['p1'])], agora: AGORA });
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].produtoId, 'p1');
  assert.match(avisos[0].mensagem, /não comprou "GRANOLA 1KG" nos últimos 60 dias/);
});

test('aviso: o limite de 60 dias e inclusivo e a janela e configuravel', () => {
  assert.deepEqual(avisosDeHistorico({ itens: [item()], pedidosDoCliente: [pedido('Finalizada', dias(59), ['p1'])], agora: AGORA }), []);
  assert.equal(avisosDeHistorico({ itens: [item()], pedidosDoCliente: [pedido('Finalizada', dias(40), ['p1'])], agora: AGORA, dias: 30 }).length, 1);
});

test('aviso: pedido cancelado nao conta; pre-venda em aberto conta', () => {
  assert.equal(avisosDeHistorico({ itens: [item()], pedidosDoCliente: [pedido('Cancelada', dias(5), ['p1'])], agora: AGORA }).length, 1);
  assert.deepEqual(avisosDeHistorico({ itens: [item()], pedidosDoCliente: [pedido('Pré-venda', dias(5), ['p1'])], agora: AGORA }), []);
});

test('aviso: cliente sem nenhum pedido avisa; produto repetido avisa uma vez so', () => {
  const dois = avisosDeHistorico({ itens: [item(), item({ quantidade: 5 })], pedidosDoCliente: [], agora: AGORA });
  assert.equal(dois.length, 1);
});

test('aviso: sem dataVenda usa o createdAt do Firestore', () => {
  const recente = { status: 'Finalizada', itens: [{ id: 'p1' }], createdAt: { seconds: Math.floor(AGORA.getTime() / 1000) - 5 * 86400 } };
  assert.deepEqual(avisosDeHistorico({ itens: [item()], pedidosDoCliente: [recente], agora: AGORA }), []);
  const semData = { status: 'Finalizada', itens: [{ id: 'p1' }] };
  assert.equal(avisosDeHistorico({ itens: [item()], pedidosDoCliente: [semData], agora: AGORA }).length, 1); // sem data nao da' pra provar que e' recente
});

test('aviso: so avisa dos produtos que nao comprou', () => {
  const avisos = avisosDeHistorico({
    itens: [item({ id: 'p1' }), item({ id: 'p2', nome: 'BARRA 30G' })],
    pedidosDoCliente: [pedido('Finalizada', dias(3), ['p1'])],
    agora: AGORA,
  });
  assert.deepEqual(avisos.map((a) => a.produtoId), ['p2']);
});

// ---------------------------------------------------------------------------
// estoque: reservar (aprovar)
// ---------------------------------------------------------------------------

test('soma por produto junta itens repetidos', () => {
  assert.deepEqual(somarPorProduto([item({ quantidade: 2 }), item({ quantidade: 3, motivo: 'vencido' })]), [{ id: 'p1', nome: 'GRANOLA 1KG', quantidade: 5 }]);
});

test('reserva: com estoque disponivel reserva e soma a reserva ja existente', () => {
  const r = planoDeReserva({ itens: [item({ quantidade: 3 })], produtosPorId: { p1: produto({ quantidade: 10, quantidadeReservada: 4 }) } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.reservas, [{ id: 'p1', nome: 'GRANOLA 1KG', reservadaDepois: 7 }]);
});

test('reserva: falta de estoque diz quanto pede e quanto ha disponivel (descontada a reserva)', () => {
  const r = planoDeReserva({ itens: [item({ quantidade: 5 })], produtosPorId: { p1: produto({ quantidade: 10, quantidadeReservada: 7 }) } });
  assert.equal(r.ok, false);
  assert.match(r.erros[0], /Estoque insuficiente para "GRANOLA 1KG": a troca pede 5, disponível 3/);
});

test('reserva: soma os itens do mesmo produto antes de conferir', () => {
  const r = planoDeReserva({ itens: [item({ quantidade: 6 }), item({ quantidade: 6, motivo: 'vencido' })], produtosPorId: { p1: produto({ quantidade: 10 }) } });
  assert.equal(r.ok, false);
  assert.match(r.erros[0], /pede 12, disponível 10/);
});

test('reserva: empresa ou produto que vende sem estoque libera; produto inativo bloqueia', () => {
  const sem = { itens: [item({ quantidade: 50 })], produtosPorId: { p1: produto({ quantidade: 1 }) } };
  assert.equal(planoDeReserva({ ...sem, permiteSemEstoque: true }).ok, true);
  assert.equal(planoDeReserva({ itens: sem.itens, produtosPorId: { p1: produto({ quantidade: 1, permitirEstoqueNegativo: true }) } }).ok, true);
  assert.match(planoDeReserva({ itens: [item()], produtosPorId: { p1: produto({ ativo: false }) } }).erros[0], /inativo/);
});

test('liberar: devolve a reserva sem deixar negativa', () => {
  assert.deepEqual(planoDeLiberacao({ itens: [item({ quantidade: 3 })], produtosPorId: { p1: produto({ quantidadeReservada: 5 }) } }), [{ id: 'p1', reservadaDepois: 2 }]);
  assert.deepEqual(planoDeLiberacao({ itens: [item({ quantidade: 3 })], produtosPorId: { p1: produto({ quantidadeReservada: 1 }) } }), [{ id: 'p1', reservadaDepois: 0 }]);
  assert.deepEqual(planoDeLiberacao({ itens: [item()], produtosPorId: {} }), []); // produto sumiu: nada a liberar
});

// ---------------------------------------------------------------------------
// estoque: entregar (baixa)
// ---------------------------------------------------------------------------

const CONTEXTO = { tenantId: 't1', trocaId: 'tr1', numeroTroca: '0007', clienteNome: 'MERCEARIA DO JOAO', usuarioId: 'u1', usuarioNome: 'Loja' };

test('entrega: baixa a quantidade e consome a reserva, com ajuste de saida "troca_cliente" e custo', () => {
  const r = planoDeEntrega({ itens: [item({ quantidade: 3 })], produtosPorId: { p1: produto({ quantidade: 10, quantidadeReservada: 5 }) }, estavaReservado: true, contexto: CONTEXTO });
  assert.equal(r.ok, true);
  assert.deepEqual(r.produtos, [{ id: 'p1', quantidadeDepois: 7, reservadaDepois: 2 }]);
  assert.equal(r.ajustes.length, 1);
  const a = r.ajustes[0];
  assert.equal(a.tipo, 'saida');
  assert.equal(a.motivo, 'troca_cliente');
  assert.equal(a.quantidade, 3);
  assert.equal(a.quantidadeAntes, 10);
  assert.equal(a.quantidadeDepois, 7);
  assert.equal(a.trocaId, 'tr1');
  assert.match(a.observacao, /Troca #0007 — MERCEARIA DO JOAO — Com bicho/);
  assert.equal(Object.values(a).some((v) => v === undefined), false);
  assert.equal(r.itensFinais[0].custoUnitarioCentavos, 1250);
  assert.equal(r.custoTotalCentavos, 3750);
});

test('entrega: sem reserva nao mexe na reserva', () => {
  const r = planoDeEntrega({ itens: [item({ quantidade: 2 })], produtosPorId: { p1: produto({ quantidade: 10, quantidadeReservada: 5 }) }, estavaReservado: false, contexto: CONTEXTO });
  assert.deepEqual(r.produtos, [{ id: 'p1', quantidadeDepois: 8, reservadaDepois: 5 }]);
});

test('entrega: dois itens do mesmo produto baixam em sequencia (antes/depois encadeados)', () => {
  const r = planoDeEntrega({ itens: [item({ quantidade: 2 }), item({ quantidade: 3, motivo: 'vencido' })], produtosPorId: { p1: produto({ quantidade: 10, quantidadeReservada: 5 }) }, estavaReservado: true, contexto: CONTEXTO });
  assert.equal(r.ok, true);
  assert.deepEqual(r.ajustes.map((a) => [a.quantidadeAntes, a.quantidadeDepois]), [[10, 8], [8, 5]]);
  assert.deepEqual(r.produtos, [{ id: 'p1', quantidadeDepois: 5, reservadaDepois: 0 }]);
});

test('entrega: sem estoque recusa em portugues; produto ou empresa que permite negativo passa', () => {
  const base = { itens: [item({ quantidade: 5 })], estavaReservado: false };
  const sem = planoDeEntrega({ ...base, produtosPorId: { p1: produto({ quantidade: 2 }) }, contexto: CONTEXTO });
  assert.equal(sem.ok, false);
  assert.match(sem.erros[0], /Estoque insuficiente para "GRANOLA 1KG": a troca pede 5, há 2 no estoque/);
  assert.equal(planoDeEntrega({ ...base, produtosPorId: { p1: produto({ quantidade: 2, permitirEstoqueNegativo: true }) }, contexto: CONTEXTO }).ok, true);
  assert.equal(planoDeEntrega({ ...base, produtosPorId: { p1: produto({ quantidade: 2 }) }, contexto: { ...CONTEXTO, permiteSemEstoque: true } }).ok, true);
});

test('entrega: produto que controla lote exige o lote, do mesmo produto e da mesma empresa, com saldo', () => {
  const produtos = { p1: produto({ quantidade: 10, controlarLote: true }) };
  const lotes = { L1: { produtoId: 'p1', tenantId: 't1', lote: 'A123', validade: '2027-01-01', quantidade: 4 }, L2: { produtoId: 'p9', tenantId: 't1', lote: 'X', quantidade: 9 }, L3: { produtoId: 'p1', tenantId: 'outra', lote: 'Y', quantidade: 9 } };
  const args = { itens: [item({ quantidade: 3 })], produtosPorId: produtos, lotesPorId: lotes, estavaReservado: false, contexto: CONTEXTO };

  assert.match(planoDeEntrega({ ...args }).erros[0], /controla lote e validade: escolha de qual lote/);
  assert.match(planoDeEntrega({ ...args, lotesEscolhidos: { 0: 'L2' } }).erros[0], /escolha de qual lote/); // lote de outro produto
  assert.match(planoDeEntrega({ ...args, lotesEscolhidos: { 0: 'L3' } }).erros[0], /escolha de qual lote/); // lote de outra empresa
  assert.match(planoDeEntrega({ ...args, itens: [item({ quantidade: 5 })], lotesEscolhidos: { 0: 'L1' } }).erros[0], /lote "A123".*tem só 4/);

  const ok = planoDeEntrega({ ...args, lotesEscolhidos: { 0: 'L1' } });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.lotes, [{ id: 'L1', saldoDepois: 1 }]);
  assert.equal(ok.ajustes[0].loteId, 'L1');
  assert.equal(ok.ajustes[0].lote, 'A123');
  assert.equal(ok.ajustes[0].validade, '2027-01-01');
  assert.equal(ok.itensFinais[0].lote, 'A123');
});

test('entrega: dois itens no mesmo lote somam o consumo do lote', () => {
  const produtos = { p1: produto({ quantidade: 10, controlarLote: true }) };
  const lotes = { L1: { produtoId: 'p1', tenantId: 't1', lote: 'A123', quantidade: 4 } };
  const r = planoDeEntrega({ itens: [item({ quantidade: 3 }), item({ quantidade: 3, motivo: 'vencido' })], produtosPorId: produtos, lotesPorId: lotes, lotesEscolhidos: { 0: 'L1', 1: 'L1' }, estavaReservado: false, contexto: CONTEXTO });
  assert.equal(r.ok, false);
  assert.match(r.erros[0], /tem só 1/);
});

test('entrega: produto sem controle de lote ignora lote', () => {
  const r = planoDeEntrega({ itens: [item()], produtosPorId: { p1: produto() }, lotesEscolhidos: { 0: 'qualquer' }, estavaReservado: false, contexto: CONTEXTO });
  assert.equal(r.ok, true);
  assert.equal(r.ajustes[0].loteId, undefined);
  assert.deepEqual(r.lotes, []);
});

test('entrega: produto que sumiu do cadastro e erro', () => {
  const r = planoDeEntrega({ itens: [item()], produtosPorId: {}, estavaReservado: false, contexto: CONTEXTO });
  assert.equal(r.ok, false);
  assert.match(r.erros[0], /não foi encontrado/);
});

test('vender sem estoque: le o campo que a tela grava (venderSemEstoque), nao um nome que ninguem grava', () => {
  assert.equal(configPermiteSemEstoque({ venderSemEstoque: true }), true);
  assert.equal(configPermiteSemEstoque({ venderSemEstoque: false }), false);
  assert.equal(configPermiteSemEstoque({}), false);
  assert.equal(configPermiteSemEstoque(undefined), false);
  // O nome antigo (errado) nao libera nada.
  assert.equal(configPermiteSemEstoque({ permiteVendaSemEstoque: true }), false);
});

test('estoque insuficiente diz o que fazer para aprovar mesmo assim', () => {
  const r = planoDeReserva({
    itens: [{ id: 'p1', nome: 'GRANOLA 1KG', quantidade: 5 }],
    produtosPorId: { p1: { quantidade: 0, quantidadeReservada: 0, ativo: true } },
  });
  assert.equal(r.ok, false);
  assert.match(r.erros[0], /Permitir venda sem estoque/);
});
