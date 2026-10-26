import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chaveDoItem,
  extratoDoItem,
  FILTROS_DA_TELA_VAZIOS,
  filtrarMovimentos,
  lerFiltroDaConsulta,
  millisDoDia,
  movimentosDaDevolucaoCompra,
  movimentosDaDevolucaoVenda,
  movimentosDaEntregaFutura,
  movimentosDaNotaAvulsa,
  movimentosDaNotaEntrada,
  movimentosDaOS,
  movimentosDaProducao,
  movimentosDoAjuste,
  movimentosDoPedido,
  resumirMovimentos,
  tipoDoProdutoDoEstoque,
  type ItemDaMovimentacao,
  type MovimentoEstoque,
} from '../src/utils/movimentosEstoqueDomain';

const T1 = 1_790_000_000_000;
const T2 = T1 + 3_600_000;

test('venda: saida no dia da venda em unidade base; PDV; entrega futura e pre-venda nao mexem', () => {
  const p = { id: 'p1', numeroPedido: '0104', clienteNome: 'MARIA', status: 'Finalizada', dataVenda: '2026-10-23', itens: [
    { id: 'a', nome: 'RACAO', quantidade: 2, fatorConversao: 10 }, { id: 'avulso', quantidade: 1 }, { id: 'b', nome: 'COLEIRA', quantidade: 1 },
  ] };
  const linhas = movimentosDoPedido(p);
  assert.deepEqual(linhas.map((l) => [l.itemId, l.tipo, l.quantidade, l.origem]), [['a', 'saida', 20, 'venda'], ['b', 'saida', 1, 'venda']]);
  assert.equal(linhas[0].dataMillis, millisDoDia('2026-10-23'));
  assert.equal(linhas[0].documento, 'Pedido #0104');
  assert.equal(movimentosDoPedido({ ...p, origem: 'pdv' })[0].origem, 'pdv');
  assert.equal(movimentosDoPedido({ ...p, entregaFutura: true }).length, 0);
  assert.equal(movimentosDoPedido({ ...p, status: 'Pré-venda' }).length, 0);
});

test('venda cancelada: so a vendida (com canceladaEm) volta; pre-venda cancelada nao mexe', () => {
  const p = { id: 'p1', numeroPedido: '9', status: 'Cancelada', dataVenda: '2026-10-01', canceladaEmMillis: T2, itens: [{ id: 'a', quantidade: 3 }] };
  assert.deepEqual(movimentosDoPedido(p).map((l) => [l.tipo, l.origem, l.dataMillis]), [['saida', 'venda', millisDoDia('2026-10-01')], ['entrada', 'venda_cancelada', T2]]);
  assert.equal(movimentosDoPedido({ ...p, canceladaEmMillis: null }).length, 0);
});

test('devolucao de venda e estorno', () => {
  const d = { id: 'd1', numeroPedidoOriginal: '0104', status: 'estornada', createdAtMillis: T1, estornadaEmMillis: T2, itensDevolvidos: [{ id: 'a', quantidadeDevolvida: 1, fatorConversao: 5 }] };
  assert.deepEqual(movimentosDaDevolucaoVenda(d).map((l) => [l.tipo, l.quantidade, l.origem]), [['entrada', 5, 'devolucao_venda'], ['saida', 5, 'devolucao_venda_estornada']]);
});

test('OS: so com estoque baixado; usa pecasBaixadas e cai para pecas', () => {
  const o = { id: 'o1', numeroOS: '12', estoqueBaixado: true, finalizadaEmMillis: T1, pecas: [{ id: 'x', quantidade: 9 }], pecasBaixadas: [{ id: 'a', quantidade: 2 }] };
  assert.deepEqual(movimentosDaOS(o).map((l) => [l.itemId, l.quantidade, l.rota]), [['a', 2, '/os/editar/o1']]);
  assert.deepEqual(movimentosDaOS({ ...o, pecasBaixadas: [] }).map((l) => l.itemId), ['x']);
  assert.equal(movimentosDaOS({ ...o, estoqueBaixado: false }).length, 0);
  assert.equal(movimentosDaOS({ ...o, finalizadaEmMillis: null, dataSaida: '2026-10-02' })[0].dataMillis, millisDoDia('2026-10-02'));
});

test('entrega futura: saida pela quantidade base', () => {
  const e = { id: 'e1', numero: 1, pedidoNumero: '0107', createdAtMillis: T1, itens: [{ id: 'a', quantidade: 2, quantidadeBase: 20 }] };
  assert.deepEqual(movimentosDaEntregaFutura(e).map((l) => [l.tipo, l.quantidade, l.origem]), [['saida', 20, 'entrega_futura']]);
});

test('NF-e de entrada: colecao pelo tipo, registro e transferencia ficam fora, exclusao sai', () => {
  const n = { id: 'n1', numeroNF: '512', status: 'excluida', createdAtMillis: T1, alteradoEmMillis: T2, itens: [
    { itemId: 'a', tipo: 'revenda', quantidade: 2, quantidadeEstoque: 24 },
    { itemId: 'mp', tipo: 'materia_prima', quantidade: 5 },
    { itemId: 'i', tipo: 'insumo', quantidade: 1 },
    { itemId: 'r', tipo: 'registro', quantidade: 3 },
  ] };
  const linhas = movimentosDaNotaEntrada(n);
  assert.deepEqual(linhas.map((l) => [l.colecao, l.tipo, l.quantidade, l.origem]), [
    ['estoque', 'entrada', 24, 'compra'], ['estoque', 'saida', 24, 'compra_excluida'],
    ['materias_primas', 'entrada', 5, 'compra'], ['materias_primas', 'saida', 5, 'compra_excluida'],
    ['insumos', 'entrada', 1, 'compra'], ['insumos', 'saida', 1, 'compra_excluida'],
  ]);
  assert.equal(movimentosDaNotaEntrada({ ...n, transferenciaId: 't1' }).length, 0);
});

test('nota avulsa (com cancelamento) e devolucao de compra', () => {
  const na = { id: 'n', numero: '7', status: 'cancelada', createdAtMillis: T1, canceladoEmMillis: T2, itens: [{ produtoId: 'a', quantidade: 2, quantidadeBase: 12 }] };
  assert.deepEqual(movimentosDaNotaAvulsa(na).map((l) => [l.tipo, l.quantidade]), [['entrada', 12], ['saida', 12]]);
  const dc = { id: 'd', notaNumero: '512', createdAtMillis: T1, itens: [{ itemId: 'mp', tipo: 'materia_prima', quantidade: 1, quantidadeEstoque: 50 }] };
  assert.deepEqual(movimentosDaDevolucaoCompra(dc).map((l) => [l.colecao, l.tipo, l.quantidade, l.origem]), [['materias_primas', 'saida', 50, 'devolucao_compra']]);
});

test('producao: componentes saem e produto entra; estorno faz o contrario; origem estoque = semiacabado', () => {
  const op = { id: 'op1', numero: '3', produtoId: 'pa', status: 'estornada', quantidadeProduzida: 10, dataFimMillis: T1, dataEstornoMillis: T2, itensConsumidos: [
    { componenteId: 'mp', quantidadeConsumida: 4 }, { componenteId: 'semi', origem: 'estoque', quantidadeConsumida: 1 },
  ] };
  assert.deepEqual(movimentosDaProducao(op).map((l) => [l.colecao, l.itemId, l.tipo, l.origem]), [
    ['materias_primas', 'mp', 'saida', 'producao_consumo'], ['estoque', 'semi', 'saida', 'producao_consumo'], ['estoque', 'pa', 'entrada', 'producao_entrada'],
    ['materias_primas', 'mp', 'entrada', 'producao_estorno'], ['estoque', 'semi', 'entrada', 'producao_estorno'], ['estoque', 'pa', 'saida', 'producao_estorno'],
  ]);
  assert.equal(movimentosDaProducao({ ...op, status: 'em_producao' }).length, 0);
});

test('ajustes: manual, balanco, transferencia (numero da observacao), troca e colecao pela origem', () => {
  const base = { id: 'a1', produtoId: 'x', quantidade: 3, createdAtMillis: T1 };
  assert.equal(movimentosDoAjuste({ ...base, tipo: 'saida', motivo: 'perda' })[0].origem, 'ajuste');
  assert.equal(movimentosDoAjuste({ ...base, tipo: 'entrada', motivo: 'balanco' })[0].origem, 'balanco');
  const t = movimentosDoAjuste({ ...base, tipo: 'saida', motivo: 'transferencia_saida', observacao: 'Transferência nº 0004 para a filial 2' })[0];
  assert.deepEqual([t.origem, t.documento], ['transferencia', 'Transferência nº 0004']);
  assert.equal(movimentosDoAjuste({ ...base, tipo: 'saida', motivo: 'troca_cliente', numeroTroca: '0002' })[0].documento, 'Troca 0002');
  assert.equal(movimentosDoAjuste({ ...base, tipo: 'entrada', origem: 'materia_prima' })[0].colecao, 'materias_primas');
  assert.equal(movimentosDoAjuste({ ...base, tipo: 'entrada', origem: 'insumo' })[0].colecao, 'insumos');
});

test('tipo do produto: uso interno, acabado (receita ou producao) e revenda', () => {
  assert.equal(tipoDoProdutoDoEstoque({ avancado: { produtoRevenda: false } }, true), 'semiacabado');
  assert.equal(tipoDoProdutoDoEstoque({}, true), 'acabado');
  assert.equal(tipoDoProdutoDoEstoque({ ultimaProducaoData: '2026-10-01' }, false), 'acabado');
  assert.equal(tipoDoProdutoDoEstoque({}, false), 'revenda');
  assert.equal(tipoDoProdutoDoEstoque({}, false, true), 'acabado', 'saiu de ordem de producao no periodo');
});

test('consulta: datas, um ano no maximo e extrato pede o cadastro', () => {
  assert.ok('erro' in lerFiltroDaConsulta({ de: '2026-10-10', ate: '2026-10-01' }));
  assert.ok('erro' in lerFiltroDaConsulta({ de: '2025-01-01', ate: '2026-10-01' }));
  assert.ok('erro' in lerFiltroDaConsulta({ de: '2026-10-01', ate: '2026-10-31', itemId: 'x' }));
  assert.deepEqual(lerFiltroDaConsulta({ de: '2026-10-01', ate: '2026-10-31', itemId: 'x', colecao: 'insumos' }), { filtro: { de: '2026-10-01', ate: '2026-10-31', itemId: 'x', colecao: 'insumos' } });
});

const mov = (id: string, colecao: MovimentoEstoque['colecao'], itemId: string, tipo: MovimentoEstoque['tipo'], quantidade: number, dataMillis: number, origem: MovimentoEstoque['origem'] = 'venda'): MovimentoEstoque => (
  { id, colecao, itemId, tipo, quantidade, dataMillis, origem, itemNome: itemId.toUpperCase(), documento: 'Doc' }
);

test('filtros da tela: tipo do item, entrada/saida, grupo de origem, categoria e busca', () => {
  const itens: Record<string, ItemDaMovimentacao> = {
    [chaveDoItem('estoque', 'pa')]: { chave: 'estoque:pa', colecao: 'estoque', id: 'pa', nome: 'PAO DE QUEIJO', codigo: '10', unidade: 'UN', categoria: 'CONGELADOS', tipo: 'acabado', casasDecimais: 0, saldoAtual: 0 },
    [chaveDoItem('materias_primas', 'mp')]: { chave: 'materias_primas:mp', colecao: 'materias_primas', id: 'mp', nome: 'POLVILHO', codigo: '1', unidade: 'KG', categoria: 'FARINACEOS', tipo: 'materia_prima', casasDecimais: 3, saldoAtual: 0 },
  };
  const movs = [mov('1', 'estoque', 'pa', 'entrada', 10, T1, 'producao_entrada'), mov('2', 'materias_primas', 'mp', 'saida', 4, T1, 'producao_consumo'), mov('3', 'estoque', 'pa', 'saida', 2, T2, 'venda')];
  const f = FILTROS_DA_TELA_VAZIOS;
  assert.deepEqual(filtrarMovimentos(movs, itens, { ...f, tiposDoItem: ['materia_prima'] }).map((m) => m.id), ['2']);
  assert.deepEqual(filtrarMovimentos(movs, itens, { ...f, tiposDoItem: ['acabado'], tipoMovimento: 'saida' }).map((m) => m.id), ['3']);
  assert.deepEqual(filtrarMovimentos(movs, itens, { ...f, grupos: ['producao'] }).map((m) => m.id), ['1', '2']);
  assert.deepEqual(filtrarMovimentos(movs, itens, { ...f, categoria: 'FARINACEOS' }).map((m) => m.id), ['2']);
  assert.deepEqual(filtrarMovimentos(movs, itens, { ...f, busca: 'pao queijo' }).map((m) => m.id), []);
  assert.deepEqual(filtrarMovimentos(movs, itens, { ...f, busca: 'pao+queijo' }).map((m) => m.id), ['1', '3']);
  assert.deepEqual(resumirMovimentos(movs), { total: 3, entradas: 1, saidas: 2, itens: 2 });
});

test('extrato: saldo de tras para frente a partir do saldo atual; o que passou do fim entra so na conta', () => {
  const movs = [
    mov('a', 'estoque', 'x', 'entrada', 10, T1),
    mov('b', 'estoque', 'x', 'saida', 3, T2),
    mov('c', 'estoque', 'x', 'saida', 2, T2 + 10_000_000), // depois do fim do periodo
  ];
  // saldo atual 7 = inicial + 10 - 3 - 2  => inicial 2
  const e = extratoDoItem(movs, 7, T2 + 1);
  assert.equal(e.saldoInicial, 2);
  assert.deepEqual(e.linhas.map((l) => [l.id, l.saldoAntes, l.saldoDepois]), [['a', 2, 12], ['b', 12, 9]]);
  assert.equal(e.saldoFinal, 9);
  assert.deepEqual([e.totalEntradas, e.totalSaidas], [10, 3]);
  const vazio = extratoDoItem([], 5, T2);
  assert.deepEqual([vazio.saldoInicial, vazio.saldoFinal, vazio.linhas.length], [5, 5, 0]);
});
