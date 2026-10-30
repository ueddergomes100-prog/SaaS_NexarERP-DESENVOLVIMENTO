import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bonificarItem,
  cfopDaBonificacao,
  cobrarItem,
  normalizarItemBonificado,
  parseConfigBonificacao,
  resumoDaBonificacao,
  situacaoDaBonificacao,
  temItemBonificado,
  separarItensDaBonificacao,
  situacaoDoPedidoDeBonificacao,
  parseTributacaoBonificacao,
  idDoPedidoDeBonificacao,
  ehPedidoDeBonificacao,
  type ItemComBonificacao,
} from '../src/utils/bonificacaoDomain';

const item = (preco: number, qtd: number): ItemComBonificacao & { id: string; nome: string } => ({ id: 'p', nome: 'ARROZ', precoUnitario: preco, quantidade: qtd, desconto: 0, subtotal: Math.round(preco * qtd * 100) / 100 });

test('bonificar guarda o preco cheio e zera o que o cliente paga; cobrar devolve', () => {
  const b = bonificarItem(item(12.5, 3));
  assert.deepEqual({ ...b }, { id: 'p', nome: 'ARROZ', precoUnitario: 0, quantidade: 3, desconto: 0, subtotal: 0, bonificado: true, precoReferencia: 12.5 });
  // bonificar de novo nao perde o preco cheio
  assert.equal(bonificarItem(b).precoReferencia, 12.5);
  const c = cobrarItem(b);
  assert.deepEqual(c, { id: 'p', nome: 'ARROZ', precoUnitario: 12.5, quantidade: 3, desconto: 0, subtotal: 37.5 });
  assert.equal(cobrarItem(item(2, 1)).subtotal, 2);
});

test('normalizar: bonificado nunca leva preco nem desconto (o que vier da tela e corrigido)', () => {
  const malicioso = { ...bonificarItem(item(10, 1)), precoUnitario: 10, desconto: 1, subtotal: 9 };
  assert.deepEqual(normalizarItemBonificado(malicioso), { ...bonificarItem(item(10, 1)) });
  assert.deepEqual(normalizarItemBonificado(item(10, 1)), item(10, 1));
});

test('resumo e situacao: desligada, sem permissao, so bonificado, dentro e acima do limite', () => {
  const itens = [item(100, 1), bonificarItem(item(5, 2))];
  assert.deepEqual(resumoDaBonificacao(itens), { vendidoCentavos: 10000, bonificadoCentavos: 1000, percentual: 10, quantidadeDeItens: 1 });
  assert.equal(temItemBonificado(itens), true);

  const ligada = (limite: number) => parseConfigBonificacao({ ativa: true, limitePercentual: limite });
  assert.deepEqual(situacaoDaBonificacao({ itens: [item(1, 1)], config: parseConfigBonificacao(undefined), podeBonificar: false }), { ok: true, precisaLiberacao: false });
  assert.equal(situacaoDaBonificacao({ itens, config: parseConfigBonificacao(undefined), podeBonificar: true }).ok, false);
  assert.equal(situacaoDaBonificacao({ itens, config: ligada(10), podeBonificar: false }).ok, false);
  assert.equal(situacaoDaBonificacao({ itens: [bonificarItem(item(5, 1))], config: ligada(10), podeBonificar: true }).ok, false);
  assert.deepEqual(situacaoDaBonificacao({ itens, config: ligada(10), podeBonificar: true }), { ok: true, precisaLiberacao: false });
  const acima = situacaoDaBonificacao({ itens, config: ligada(5), podeBonificar: true });
  assert.equal(acima.ok && acima.precisaLiberacao, true);
});

test('config e CFOP', () => {
  assert.deepEqual(parseConfigBonificacao({ ativa: true, limitePercentual: '7,5' }), { ativa: true, limitePercentual: 0 });
  assert.deepEqual(parseConfigBonificacao({ ativa: true, limitePercentual: 7.5 }), { ativa: true, limitePercentual: 7.5 });
  assert.deepEqual(parseConfigBonificacao({ ativa: 'sim', limitePercentual: 500 }), { ativa: false, limitePercentual: 100 });
  assert.equal(cfopDaBonificacao(false), '5910');
  assert.equal(cfopDaBonificacao(true), '6910');
});

test('pedido de bonificacao: separa brindes, id ligado e situacao pelo limite da venda de origem', () => {
  const itens = [item(100, 1), bonificarItem(item(5, 2))];
  const { cobrados, brindes } = separarItensDaBonificacao(itens);
  assert.equal(cobrados.length, 1);
  assert.equal(brindes.length, 1);
  assert.equal(idDoPedidoDeBonificacao('abc'), 'abcb');
  assert.equal(ehPedidoDeBonificacao({ tipoPedido: 'bonificacao' }), true);
  assert.equal(ehPedidoDeBonificacao({}), false);
  const config = parseConfigBonificacao({ ativa: true, limitePercentual: 10 });
  assert.deepEqual(situacaoDoPedidoDeBonificacao({ itens: brindes, config, podeBonificar: true, vendaDeOrigemCentavos: 10000 }), { ok: true, precisaLiberacao: false });
  const acima = situacaoDoPedidoDeBonificacao({ itens: brindes, config, podeBonificar: true, vendaDeOrigemCentavos: 5000 });
  assert.equal(acima.ok && acima.precisaLiberacao, true);
  const semVenda = situacaoDoPedidoDeBonificacao({ itens: brindes, config, podeBonificar: true, vendaDeOrigemCentavos: 0 });
  assert.equal(semVenda.ok && semVenda.precisaLiberacao, true);
  assert.equal(situacaoDoPedidoDeBonificacao({ itens, config, podeBonificar: true, vendaDeOrigemCentavos: 10000 }).ok, false);
  assert.equal(situacaoDoPedidoDeBonificacao({ itens: [], config, podeBonificar: true, vendaDeOrigemCentavos: 10000 }).ok, false);
});

test('tributacao da bonificacao: padrao sem tributacao; codigo invalido volta ao padrao', () => {
  assert.deepEqual(parseTributacaoBonificacao(undefined), { csosn: '400', cstIcms: '40', cstPis: '08', cstCofins: '08' });
  assert.deepEqual(parseTributacaoBonificacao({ csosn: '102', cstIcms: '00', cstPis: '01', cstCofins: 'x' }), { csosn: '102', cstIcms: '00', cstPis: '01', cstCofins: '08' });
});
