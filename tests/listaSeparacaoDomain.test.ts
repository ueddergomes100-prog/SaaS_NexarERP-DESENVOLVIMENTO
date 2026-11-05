import assert from 'node:assert/strict';
import { test } from 'node:test';
import { montarDocumentoListaSeparacao, pedidosDaFilaParaSeparar, somarItensParaSeparar } from '../src/utils/listaSeparacaoDomain';

const pedidos = [
  {
    id: 'a',
    rotulo: 'Pedido #0035',
    clienteNome: 'MARIA',
    itens: [
      { id: 'p2', nome: 'RETENTOR', codigo: '2', quantidade: 3, unidadeMedidaSigla: 'UN' },
      { id: 'p1', nome: 'FILTRO', codigo: '1', quantidade: 2, unidadeMedidaSigla: 'UN' },
    ],
  },
  {
    id: 'b',
    rotulo: 'Pedido #0036',
    clienteNome: 'JOAO',
    itens: [
      { id: 'p1', nome: 'FILTRO', codigo: '1', quantidade: 5, unidadeMedidaSigla: 'UN' },
      // A mesma linha duas vezes no pedido conta um pedido so'.
      { id: 'p1', nome: 'FILTRO', codigo: '1', quantidade: 1, unidadeMedidaSigla: 'UN' },
    ],
  },
];

test('soma os itens de todos os pedidos, em ordem de nome, contando em quantos pedidos aparece', () => {
  const soma = somarItensParaSeparar(pedidos);
  assert.deepEqual(soma.map((i) => [i.nome, i.quantidade, i.pedidos]), [['FILTRO', 8, 2], ['RETENTOR', 3, 1]]);
});

test('mesmo produto em saco e em KG sai em duas linhas; embalagem diferente tambem', () => {
  const soma = somarItensParaSeparar([{
    id: 'a',
    rotulo: 'P',
    itens: [
      { id: 'r', nome: 'RACAO', quantidade: 2, unidadeMedidaSigla: 'SC', embalagemId: 'saco20' },
      { id: 'r', nome: 'RACAO', quantidade: 2, unidadeMedidaSigla: 'SC', embalagemId: 'saco10' },
      { id: 'r', nome: 'RACAO', quantidade: 1.5, unidadeMedidaSigla: 'KG' },
    ],
  }]);
  assert.equal(soma.length, 3);
  assert.deepEqual(soma.map((i) => i.quantidade).sort(), [1.5, 2, 2]);
});

test('quantidade fracionada soma sem ruido; sem unidade sai UN; sem quantidade ou nome fica de fora', () => {
  const soma = somarItensParaSeparar([{
    id: 'a',
    rotulo: 'P',
    itens: [
      { id: 'k', nome: 'FUBA', quantidade: 0.1, unidadeMedidaSigla: 'KG' },
      { id: 'k', nome: 'FUBA', quantidade: 0.2, unidadeMedidaSigla: 'KG' },
      { id: 'u', nome: 'SEM UNIDADE', quantidade: 1 },
      { id: 'z', nome: 'ZERADO', quantidade: 0 },
      { id: 'n', quantidade: 2 },
    ],
  }]);
  assert.deepEqual(soma.map((i) => [i.nome, i.unidade, i.quantidade]), [['FUBA', 'KG', 0.3], ['SEM UNIDADE', 'UN', 1]]);
});

test('item avulso junta pelo nome; pedido sem itens nao quebra', () => {
  const soma = somarItensParaSeparar([
    { id: 'a', rotulo: 'P', itens: [{ id: 'avulso', nome: 'Parafuso', quantidade: 1 }, { nome: 'PARAFUSO', quantidade: 2 }] },
    { id: 'b', rotulo: 'Q' },
    { id: 'c', rotulo: 'R', itens: 'lixo' },
  ]);
  assert.equal(soma.length, 1);
  assert.equal(soma[0].quantidade, 3);
});

test('documento: soma e por pedido na ordem da rota, com aviso do que ficou de fora', () => {
  const doc = montarDocumentoListaSeparacao({ titulo: 'Lista', pedidos, semItens: ['Entrega futura #0040/1'], filtros: ['Rota 02'] });
  const [soma, porPedido] = doc.secoes;
  assert.equal(soma.linhas.length, 2);
  assert.equal(soma.opcional, undefined, 'a soma e o objetivo do relatorio: nao desliga');
  assert.deepEqual(porPedido.linhas.map((l: { pedidoId: string; nome: string }) => [l.pedidoId, l.nome]), [['a', 'FILTRO'], ['a', 'RETENTOR'], ['b', 'FILTRO'], ['b', 'FILTRO']]);
  assert.equal(porPedido.agruparPor?.rotulo(porPedido.linhas[0]), 'Pedido #0035 · MARIA');
  assert.deepEqual(doc.filtros, ['Rota 02', 'Sem os itens nesta lista (separe à parte): Entrega futura #0040/1']);
  assert.deepEqual(doc.indicadores?.map((i) => i.valor), ['2', '2']);
  // Quantidade de unidades diferentes nao se soma no total.
  const quantidade = soma.colunas.find((c) => c.id === 'quantidade');
  assert.equal(quantidade?.total, 'nenhum');
});

test('padrao do relatorio: so item, unidade e quantidade; o resto liga na caixinha', () => {
  const doc = montarDocumentoListaSeparacao({ titulo: 'Lista', pedidos });
  const [soma, porPedido] = doc.secoes;
  assert.deepEqual(soma.colunas.filter((c) => c.padrao !== false).map((c) => c.id), ['produto', 'unidade', 'quantidade']);
  assert.equal(porPedido.padrao, false);
});

test('fila: marcados valem, ate conferido; nada marcado = o que falta conferir', () => {
  const naTela = [
    { chave: 'a', statusConferencia: 'aguardando' },
    { chave: 'b', statusConferencia: 'conferido' },
    { chave: 'c', statusConferencia: 'divergente' },
  ];
  assert.deepEqual(pedidosDaFilaParaSeparar(naTela, new Set(['b'])).map((p) => p.chave), ['b']);
  assert.deepEqual(pedidosDaFilaParaSeparar(naTela, new Set()).map((p) => p.chave), ['a', 'c']);
  // Marcado que saiu da tela pelo filtro nao conta.
  assert.deepEqual(pedidosDaFilaParaSeparar(naTela, new Set(['x'])).map((p) => p.chave), ['a', 'c']);
});
