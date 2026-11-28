import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  categoriaDaVenda,
  categoriaDoEvento,
  categoriaNaBaixa,
  categoriasDeVenda,
  conferirVinculos,
  ehCategoriaDeVenda,
  lerVinculos,
  planoEfetivo,
  situacoesDaCategoria,
} from '../src/utils/vinculosPlanoContasDomain.js';

test('venda: uma categoria por forma, com o vinculo da empresa valendo sobre o padrao', () => {
  assert.equal(categoriaDaVenda({}, 'Pix'), 'Venda no Pix');
  assert.equal(categoriaDaVenda({}, 'Cartão de Crédito'), 'Venda no Cartão de Crédito');
  assert.equal(categoriaDaVenda({}, 'Pagamento a Prazo'), 'Venda a Prazo');
  assert.equal(categoriaDaVenda({}, 'FORMA NOVA'), 'Venda em Outras Formas');
  const config = { vinculosPlanoContas: { 'venda:Pix': 'Recebido no Pix' } };
  assert.equal(categoriaDaVenda(config, 'pix'), 'Recebido no Pix');
  assert.equal(categoriaDoEvento(config, 'tarifa_bancaria'), 'Tarifas bancárias');
  assert.equal(categoriaDoEvento({}, 'compra_mercadoria'), 'Fornecedores de Peças');
});

test('lerVinculos ignora situacao desconhecida e nome vazio', () => {
  assert.deepEqual(lerVinculos({ 'venda:Pix': '  Pix  ', bobagem: 'x', os: '' }), { 'venda:Pix': 'Pix' });
  assert.deepEqual(lerVinculos(null), {});
  assert.deepEqual(lerVinculos(['x']), {});
});

test('baixa: titulo de venda troca para a forma paga; o que nao e venda fica como esta', () => {
  assert.equal(categoriaNaBaixa({}, 'Venda a Prazo', 'Pix'), 'Venda no Pix');
  assert.equal(categoriaNaBaixa({}, 'Venda no Boleto', 'Dinheiro'), 'Venda em Dinheiro');
  assert.equal(categoriaNaBaixa({}, 'venda de peças', 'Cartão de Débito'), 'Venda no Cartão de Débito', 'nome antigo tambem e venda');
  assert.equal(categoriaNaBaixa({}, 'Aluguel', 'Pix'), 'Aluguel');
  assert.equal(categoriaNaBaixa({}, 'Serviços', 'Pix'), 'Serviços');
  assert.equal(categoriaNaBaixa({}, '', 'Pix'), null);
  assert.equal(categoriaNaBaixa({}, 'Venda no Boleto', ''), 'Venda no Boleto');
});

test('categorias de venda da empresa incluem o nome antigo e os vinculos trocados', () => {
  const config = { vinculosPlanoContas: { 'venda:Dinheiro': 'Balcão' } };
  const nomes = categoriasDeVenda(config);
  assert.ok(nomes.includes('Venda de Peças'));
  assert.ok(nomes.includes('Balcão'));
  assert.ok(!nomes.includes('Venda em Dinheiro'));
  assert.equal(ehCategoriaDeVenda(config, 'BALCÃO'), true);
  assert.equal(ehCategoriaDeVenda(config, 'Aluguel'), false);
});

test('plano efetivo: o salvo mais as pre-definidas que faltam, sem repetir e sem as formas escondidas', () => {
  const plano = planoEfetivo({
    planoContasReceitas: ['Serviços', 'Outras Receitas'],
    planoContasDespesas: ['Aluguel', 'tarifas bancárias'],
    formasPagamentoOcultas: ['Cashback', 'Cheque'],
  });
  assert.deepEqual(plano.receitas.slice(0, 2), ['Serviços', 'Outras Receitas'], 'o que a empresa criou vem primeiro');
  assert.ok(plano.receitas.includes('Venda no Pix'));
  assert.ok(!plano.receitas.includes('Venda com Cashback'), 'forma escondida na filial nao entra');
  assert.ok(!plano.receitas.includes('Venda no Cheque'));
  assert.equal(plano.receitas.filter((c) => c === 'Serviços').length, 1);
  assert.ok(plano.despesas.includes('Fretes'));
  assert.equal(plano.despesas.filter((c) => c.toLowerCase() === 'tarifas bancárias').length, 1, 'nao repete com outra caixa');
});

test('conferirVinculos: receita nao vai para despesa e grava so o que difere do padrao', () => {
  const plano = { receitas: ['Venda no Pix', 'Recebido no Pix'], despesas: ['Aluguel', 'Tarifas bancárias'] };
  const ok = conferirVinculos({ 'venda:Pix': 'Recebido no Pix', 'venda:Dinheiro': 'Venda em Dinheiro' }, plano);
  assert.ok(ok.ok);
  assert.deepEqual(ok.ok ? ok.vinculos : null, { 'venda:Pix': 'Recebido no Pix' });
  const errado = conferirVinculos({ 'venda:Pix': 'Aluguel' }, plano);
  assert.equal(errado.ok, false);
  assert.match(errado.ok ? '' : errado.erro, /categoria de receita/);
  const despesaErrada = conferirVinculos({ tarifa_bancaria: 'Recebido no Pix' }, plano);
  assert.equal(despesaErrada.ok, false);
});

test('situacoesDaCategoria diz onde a categoria esta ligada', () => {
  assert.deepEqual(situacoesDaCategoria({}, 'venda no pix'), ['Venda em Pix']);
  assert.deepEqual(situacoesDaCategoria({}, 'Aluguel'), []);
});
