import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  acoesDoCondicional,
  estaVencido,
  itensQueFicaram,
  montarItensDoCondicional,
  parseTrabalhaComCondicional,
  planejarDevolucao,
  planoDeLiberacao,
  planoDeReserva,
  prazoPadrao,
  produtoPermiteCondicional,
  quantidadePendente,
  resumirCondicional,
  validarItensDoPedido,
  validarPrazoDevolucao,
  type ItemCondicional,
} from '../src/utils/condicionalDomain';

const HOJE = '2026-10-05';

const produto = (extra: Record<string, unknown> = {}) => ({
  nome: 'VESTIDO AZUL M',
  codigo: '1001',
  precoVenda: 120,
  ativo: true,
  permiteCondicional: true,
  quantidade: 5,
  quantidadeReservada: 0,
  unidadeMedidaSigla: 'UN',
  unidadeMedidaFracionado: false,
  unidadeMedidaCasasDecimais: 0,
  ...extra,
});

const item = (extra: Partial<ItemCondicional> = {}): ItemCondicional => ({
  id: 'p1',
  nome: 'VESTIDO AZUL M',
  codigo: '1001',
  quantidade: 3,
  quantidadeDevolvida: 0,
  precoUnitario: 120,
  unidadeMedidaSigla: 'UN',
  unidadeMedidaFracionado: false,
  unidadeMedidaCasasDecimais: 0,
  ...extra,
});

test('configuracao e produto: so\' liga com true de verdade', () => {
  assert.equal(parseTrabalhaComCondicional(true), true);
  assert.equal(parseTrabalhaComCondicional('true'), false);
  assert.equal(parseTrabalhaComCondicional(undefined), false);
  assert.equal(produtoPermiteCondicional({ permiteCondicional: true }), true);
  assert.equal(produtoPermiteCondicional({}), false);
  assert.equal(produtoPermiteCondicional(null), false);
});

test('prazo: padrao de 3 dias, passado/inexistente/longe demais recusados', () => {
  assert.equal(prazoPadrao(HOJE), '2026-10-08');
  assert.equal(validarPrazoDevolucao('2026-10-08', HOJE), '');
  assert.equal(validarPrazoDevolucao(HOJE, HOJE), '');
  assert.match(validarPrazoDevolucao('2026-10-04', HOJE), /passado/);
  assert.match(validarPrazoDevolucao('2026-02-31', HOJE), /não existe/);
  assert.match(validarPrazoDevolucao('2026-12-31', HOJE), /60 dias/);
  assert.match(validarPrazoDevolucao('', HOJE), /Informe/);
});

test('vencido: so\' condicional aberto com prazo antes de hoje', () => {
  assert.equal(estaVencido({ status: 'aberto', prazoDevolucao: '2026-10-04' }, HOJE), true);
  assert.equal(estaVencido({ status: 'aberto', prazoDevolucao: HOJE }, HOJE), false);
  assert.equal(estaVencido({ status: 'finalizado', prazoDevolucao: '2026-10-01' }, HOJE), false);
});

test('itens do pedido: junta repetidos e recusa vazio, id ruim e quantidade zero', () => {
  assert.deepEqual(validarItensDoPedido([{ id: 'p1', quantidade: 1 }, { id: 'p1', quantidade: 2 }]).itens, [{ id: 'p1', quantidade: 3 }]);
  assert.match(validarItensDoPedido([]).erros[0], /pelo menos um/);
  assert.match(validarItensDoPedido([{ id: '../x', quantidade: 1 }]).erros[0], /inválido/);
  assert.match(validarItensDoPedido([{ id: 'p1', quantidade: 0 }]).erros[0], /maior que zero/);
  assert.match(validarItensDoPedido(Array.from({ length: 101 }, (_, i) => ({ id: `p${i}`, quantidade: 1 }))).erros[0], /100 itens/);
});

test('montar itens: dados do cadastro, bloqueia produto sem "Permite condicional", inativo e fracao', () => {
  const ok = montarItensDoCondicional({ itens: [{ id: 'p1', quantidade: 2 }], produtosPorId: { p1: produto() } });
  assert.deepEqual(ok.erros, []);
  assert.equal(ok.itens[0].precoUnitario, 120);
  assert.equal(ok.itens[0].quantidadeDevolvida, 0);

  const semLiberar = montarItensDoCondicional({ itens: [{ id: 'p1', quantidade: 1 }], produtosPorId: { p1: produto({ permiteCondicional: false }) } });
  assert.match(semLiberar.erros[0], /Permite condicional/);

  const inativo = montarItensDoCondicional({ itens: [{ id: 'p1', quantidade: 1 }], produtosPorId: { p1: produto({ ativo: false }) } });
  assert.match(inativo.erros[0], /inativo/);

  const fracao = montarItensDoCondicional({ itens: [{ id: 'p1', quantidade: 1.5 }], produtosPorId: { p1: produto() } });
  assert.match(fracao.erros[0], /fracionada/);

  const sumiu = montarItensDoCondicional({ itens: [{ id: 'p9', quantidade: 1 }], produtosPorId: {} });
  assert.match(sumiu.erros[0], /não foi encontrado/);
});

test('montar itens: produto sem unidade entra como UN e volta no aviso (regra 4 do CLAUDE.md)', () => {
  const r = montarItensDoCondicional({
    itens: [{ id: 'p1', quantidade: 1 }],
    produtosPorId: { p1: produto({ unidadeMedidaSigla: undefined, unidadeMedidaFracionado: undefined, unidadeMedidaCasasDecimais: undefined }) },
  });
  assert.equal(r.itens[0].unidadeMedidaSigla, 'UN');
  assert.equal(r.itens[0].unidadeMedidaFracionado, false);
  assert.deepEqual(r.semUnidade, ['VESTIDO AZUL M']);
  // Nada de undefined no item (o Firestore recusaria).
  assert.ok(Object.values(r.itens[0]).every((v) => v !== undefined));
});

test('reserva: confere disponivel (quantidade - reservada) e libera com "vender sem estoque"', () => {
  const produtos = { p1: produto({ quantidade: 5, quantidadeReservada: 3 }) };
  const falta = planoDeReserva({ itens: [item({ quantidade: 3 })], produtosPorId: produtos, permiteSemEstoque: false });
  assert.match(falta.erros[0], /disponível 2/);
  const ok = planoDeReserva({ itens: [item({ quantidade: 2 })], produtosPorId: produtos, permiteSemEstoque: false });
  assert.deepEqual(ok.reservas, [{ id: 'p1', reservadaDepois: 5 }]);
  const liberado = planoDeReserva({ itens: [item({ quantidade: 9 })], produtosPorId: produtos, permiteSemEstoque: true });
  assert.deepEqual(liberado.reservas, [{ id: 'p1', reservadaDepois: 12 }]);
  const negativoNoProduto = planoDeReserva({ itens: [item({ quantidade: 9 })], produtosPorId: { p1: produto({ quantidade: 0, permitirEstoqueNegativo: true }) }, permiteSemEstoque: false });
  assert.equal(negativoNoProduto.erros.length, 0);
});

test('liberacao: nunca deixa a reserva negativa e ignora produto que sumiu', () => {
  assert.deepEqual(
    planoDeLiberacao({ liberar: [{ id: 'p1', quantidade: 2 }, { id: 'p9', quantidade: 1 }], produtosPorId: { p1: produto({ quantidadeReservada: 1 }) } }),
    [{ id: 'p1', reservadaDepois: 0 }],
  );
});

test('devolucao parcial e total; nao devolve mais do que esta com o cliente', () => {
  const itens = [item({ id: 'p1', quantidade: 3 }), item({ id: 'p2', nome: 'BLUSA', quantidade: 1 })];
  const parcial = planejarDevolucao(itens, [{ id: 'p1', quantidade: 2 }]);
  assert.deepEqual(parcial.erros, []);
  assert.equal(parcial.itens[0].quantidadeDevolvida, 2);
  assert.equal(quantidadePendente(parcial.itens[0]), 1);
  assert.deepEqual(parcial.liberar, [{ id: 'p1', quantidade: 2 }]);
  assert.equal(parcial.tudoDevolvido, false);

  const resto = planejarDevolucao(parcial.itens, [{ id: 'p1', quantidade: 1 }, { id: 'p2', quantidade: 1 }]);
  assert.equal(resto.tudoDevolvido, true);

  const demais = planejarDevolucao(itens, [{ id: 'p1', quantidade: 4 }]);
  assert.match(demais.erros[0], /só 3 está com o cliente/);
  assert.deepEqual(demais.liberar, []);
  assert.equal(demais.itens[0].quantidadeDevolvida, 0);

  assert.match(planejarDevolucao(itens, []).erros[0], /pelo menos um item/);
  assert.match(planejarDevolucao(itens, [{ id: 'px', quantidade: 1 }]).erros[0], /não faz parte/);
});

test('fechamento: so\' o que ficou vira item da pre-venda, com subtotal', () => {
  const itens = [item({ id: 'p1', quantidade: 3, quantidadeDevolvida: 1 }), item({ id: 'p2', quantidade: 1, quantidadeDevolvida: 1 })];
  const ficaram = itensQueFicaram(itens);
  assert.equal(ficaram.length, 1);
  assert.deepEqual(ficaram[0], {
    id: 'p1', nome: 'VESTIDO AZUL M', codigo: '1001', precoUnitario: 120, quantidade: 2, desconto: 0, subtotal: 240,
    unidadeMedidaSigla: 'UN', unidadeMedidaFracionado: false, unidadeMedidaCasasDecimais: 0,
  });
});

test('resumo e acoes', () => {
  const r = resumirCondicional([item({ quantidade: 3, quantidadeDevolvida: 1 }), item({ id: 'p2', quantidade: 1, precoUnitario: 50 })]);
  assert.deepEqual(r, { pecasLevadas: 4, pecasDevolvidas: 1, pecasComCliente: 3, valorLevado: 410, valorComCliente: 290 });
  assert.deepEqual(acoesDoCondicional('aberto'), { devolver: true, fechar: true, cancelar: true });
  assert.deepEqual(acoesDoCondicional('finalizado'), { devolver: false, fechar: false, cancelar: false });
});
