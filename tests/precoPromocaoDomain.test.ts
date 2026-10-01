import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  condicaoDoPagamento,
  parseFormasAVista,
  precoAutomatico,
  reprecificarItens,
  tabelaDoProduto,
  type TabelaDePrecoDoItem,
} from '../src/utils/precoVendaDomain';
import {
  conflitosDaPromocao,
  diaDaSemana,
  errosDaPromocao,
  lerPromocao,
  margemDaPromocao,
  precoPromocionalDoItem,
  promocaoDoProduto,
  promocaoValeNoDia,
  quantidadeLiberadaNaPromocao,
  resumoDoPeriodo,
  statusDaPromocao,
  type PromocaoComId,
} from '../src/utils/promocaoDomain';

// --- a vista x a prazo -------------------------------------------------------

test('à vista: dinheiro, Pix, débito, crédito 1x e transferência; parcelou 2x vira a prazo', () => {
  assert.equal(condicaoDoPagamento([{ forma: 'Dinheiro' }]), 'vista');
  assert.equal(condicaoDoPagamento([{ forma: 'Pix' }, { forma: 'Cartão de Débito' }]), 'vista');
  assert.equal(condicaoDoPagamento([{ forma: 'Cartão de Crédito', parcelas: '1' }]), 'vista');
  assert.equal(condicaoDoPagamento([{ forma: 'Cartão de Crédito', parcelas: '2' }]), 'prazo');
  assert.equal(condicaoDoPagamento([{ forma: '' }]), 'vista');
});

test('boleto, crediário e cheque são a prazo mesmo em 1 parcela; uma parte a prazo vale para a venda toda', () => {
  assert.equal(condicaoDoPagamento([{ forma: 'Boleto', parcelasAPrazo: '1' }]), 'prazo');
  assert.equal(condicaoDoPagamento([{ forma: 'Pagamento a Prazo' }]), 'prazo');
  assert.equal(condicaoDoPagamento([{ forma: 'Cheque' }]), 'prazo');
  assert.equal(condicaoDoPagamento([{ forma: 'Pix' }, { forma: 'Boleto' }]), 'prazo');
});

test('empresa pode marcar boleto como à vista; mesmo assim 2+ parcelas é a prazo', () => {
  const formas = parseFormasAVista(['Dinheiro', 'Boleto', 'lixo']);
  assert.deepEqual(formas, ['Dinheiro', 'Boleto']);
  assert.equal(condicaoDoPagamento([{ forma: 'Boleto', parcelasAPrazo: '1' }], formas), 'vista');
  assert.equal(condicaoDoPagamento([{ forma: 'Boleto', parcelasAPrazo: '3' }], formas), 'prazo');
  assert.ok(parseFormasAVista(undefined).includes('Pix'));
});

const tabela = (mudanca: Partial<TabelaDePrecoDoItem> = {}): TabelaDePrecoDoItem => ({ venda: 110, vista: 95, promocao: null, ...mudanca });

test('preço automático: à vista usa o preço à vista; a prazo (e à vista sem preço à vista) usa o preço de venda', () => {
  assert.deepEqual(precoAutomatico(tabela(), 'vista'), { preco: 95, origem: 'vista' });
  assert.deepEqual(precoAutomatico(tabela(), 'prazo'), { preco: 110, origem: 'venda' });
  assert.deepEqual(precoAutomatico(tabela({ vista: 0 }), 'vista'), { preco: 110, origem: 'venda' });
});

test('promoção vence a tabela; "só à vista" sai quando parcelou', () => {
  const promo = { id: 'p1', nome: 'SEMANA', preco: 80, soAVista: true };
  assert.deepEqual(precoAutomatico(tabela({ promocao: promo }), 'vista'), { preco: 80, origem: 'promocao' });
  assert.deepEqual(precoAutomatico(tabela({ promocao: promo }), 'prazo'), { preco: 110, origem: 'venda' });
  assert.deepEqual(precoAutomatico(tabela({ promocao: { ...promo, soAVista: false } }), 'prazo'), { preco: 80, origem: 'promocao' });
});

test('embalagem sem preço próprio herda os dois preços × fator; com preço próprio fica só ele', () => {
  const produto = { precoVenda: 5.5, precoAVista: 4.5 };
  assert.deepEqual(tabelaDoProduto(produto, { fatorConversao: 20 }), { venda: 110, vista: 90, promocao: null });
  assert.deepEqual(tabelaDoProduto(produto, { fatorConversao: 20, precoProprio: 85 }), { venda: 85, vista: 0, promocao: null });
});

test('reprecificar: troca os automáticos, mantém o digitado e o desconto em R$', () => {
  const itens = [
    { nome: 'A', precoUnitario: 95, quantidade: 2, desconto: 10, subtotal: 180, tabelaPreco: tabela(), origemPreco: 'vista' as const },
    { nome: 'B', precoUnitario: 50, quantidade: 1, desconto: 0, subtotal: 50, tabelaPreco: tabela(), origemPreco: 'manual' as const },
    { nome: 'C', precoUnitario: 30, quantidade: 1, desconto: 0, subtotal: 30 },
  ];
  const r = reprecificarItens(itens, 'prazo');
  assert.equal(r.alterados, 1);
  assert.equal(r.diferencaCentavos, 3000);
  assert.equal(r.itens[0].precoUnitario, 110);
  assert.equal(r.itens[0].subtotal, 210);
  assert.equal(r.itens[1].precoUnitario, 50);
  assert.equal(r.itens[2], itens[2]);
});

// --- promocoes --------------------------------------------------------------

const promocao = (mudanca: Partial<PromocaoComId> = {}): PromocaoComId => ({
  id: 'promo1',
  nome: 'SEMANA DO PET',
  individual: false,
  dataInicio: '2026-10-01',
  dataFim: '2026-10-15',
  continua: false,
  inativa: false,
  diasSemana: [],
  formas: 'vista',
  limitePorVenda: null,
  observacao: '',
  itens: [{ produtoId: 'racao', codigo: '10', nome: 'RAÇÃO', tipo: 'valor', valor: 80, quota: 50 }],
  ...mudanca,
});

test('situação da promoção: agendada, valendo, encerrada, contínua e inativa', () => {
  assert.equal(statusDaPromocao(promocao(), '2026-09-30'), 'agendada');
  assert.equal(statusDaPromocao(promocao(), '2026-10-15'), 'vigente');
  assert.equal(statusDaPromocao(promocao(), '2026-10-16'), 'encerrada');
  assert.equal(statusDaPromocao(promocao({ continua: true, dataFim: '' }), '2030-01-01'), 'vigente');
  assert.equal(statusDaPromocao(promocao({ inativa: true }), '2026-10-05'), 'inativa');
});

test('dias da semana: só vale nos dias marcados', () => {
  assert.equal(diaDaSemana('2026-10-07'), 3); // quarta
  assert.equal(promocaoValeNoDia(promocao({ diasSemana: [3] }), '2026-10-07'), true);
  assert.equal(promocaoValeNoDia(promocao({ diasSemana: [3] }), '2026-10-08'), false);
});

test('preço promocional fixo ou %, e margem com aviso abaixo do custo', () => {
  assert.equal(precoPromocionalDoItem({ tipo: 'valor', valor: 79.9 }, 100), 79.9);
  assert.equal(precoPromocionalDoItem({ tipo: 'percentual', valor: 15 }, 100), 85);
  assert.deepEqual(margemDaPromocao(80, 64), { lucroPercentual: 25, abaixoDoCusto: false });
  assert.equal(margemDaPromocao(60, 64).abaixoDoCusto, true);
  assert.equal(margemDaPromocao(60, 0).lucroPercentual, null);
});

test('promoção do produto: só a que vale hoje; com duas, a de menor preço', () => {
  const outra = promocao({ id: 'promo2', nome: 'OUTRA', formas: 'todas', itens: [{ produtoId: 'racao', codigo: '10', nome: 'RAÇÃO', tipo: 'percentual', valor: 25, quota: null }] });
  const p = promocaoDoProduto([promocao(), outra], 'racao', { venda: 100, vista: 0 }, '2026-10-05');
  assert.equal(p?.promocaoId, 'promo2');
  assert.equal(p?.preco, 75);
  assert.equal(p?.soAVista, false);
  assert.equal(promocaoDoProduto([promocao()], 'racao', { venda: 100, vista: 0 }, '2026-11-01'), null);
  assert.equal(promocaoDoProduto([promocao()], 'outro', { venda: 100, vista: 0 }, '2026-10-05'), null);
});

test('quantidade liberada: menor entre o que sobra da quota e o limite por venda', () => {
  assert.equal(quantidadeLiberadaNaPromocao({ quota: 50, limitePorVenda: null }, 45, 2), 3);
  assert.equal(quantidadeLiberadaNaPromocao({ quota: 50, limitePorVenda: 5 }, 0, 1), 4);
  assert.equal(quantidadeLiberadaNaPromocao({ quota: null, limitePorVenda: null }, 999, 0), null);
  assert.equal(quantidadeLiberadaNaPromocao({ quota: 10, limitePorVenda: null }, 12, 0), 0);
});

test('erros da promoção em português, todos de uma vez', () => {
  const erros = errosDaPromocao(promocao({ nome: 'x', dataFim: '2026-09-01', itens: [{ produtoId: 'r', codigo: '', nome: 'RAÇÃO', tipo: 'valor', valor: 120, quota: null }] }), { r: 100 });
  assert.equal(erros.length, 3);
  assert.ok(erros.some((e) => /nome/.test(e)));
  assert.ok(erros.some((e) => /antes da data de início/.test(e)));
  assert.ok(erros.some((e) => /não é menor que o preço atual/.test(e)));
  assert.deepEqual(errosDaPromocao(promocao()), []);
});

test('leitura defensiva e resumo do período', () => {
  const p = lerPromocao({ nome: ' a ', itens: [{ produtoId: 'x', valor: '5', quota: '' }, { valor: 1 }], diasSemana: [3, 9, 'a'] });
  assert.equal(p.itens.length, 1);
  assert.equal(p.itens[0].quota, null);
  assert.deepEqual(p.diasSemana, [3]);
  assert.equal(resumoDoPeriodo(promocao({ diasSemana: [3, 6] })), '01/10/2026 a 15/10/2026 · só qua, sáb');
  assert.equal(resumoDoPeriodo(promocao({ continua: true })), 'a partir de 01/10/2026');
});

test('um produto, uma promoção por vez: individual barra a da tela e vice-versa; período que não cruza passa', () => {
  const individual = promocao({ id: 'ind', nome: 'RAÇÃO', individual: true });
  const daTela = promocao({ id: 'nova', nome: 'SEMANA', dataInicio: '2026-10-10', dataFim: '2026-10-20' });
  const conflitos = conflitosDaPromocao(daTela, [individual], '2026-10-05');
  assert.equal(conflitos.length, 1);
  assert.match(conflitos[0], /RAÇÃO já está em promoção individual, no cadastro do produto/);
  assert.match(conflitosDaPromocao({ ...individual, id: 'outra-ind' }, [daTela], '2026-10-05')[0], /na promoção "SEMANA" \(tela Promoções\)/);
  assert.deepEqual(conflitosDaPromocao({ ...daTela, dataInicio: '2026-10-16' }, [individual], '2026-10-05'), []);
  assert.deepEqual(conflitosDaPromocao(daTela, [{ ...individual, inativa: true }], '2026-10-05'), []);
  assert.deepEqual(conflitosDaPromocao(daTela, [daTela], '2026-10-05'), []);
});
test('% "só à vista" desconta do preço à vista; "todas as formas", do preço de venda', () => {
  const pct = (formas: 'vista' | 'todas') => promocao({ formas, itens: [{ produtoId: 'r', codigo: '', nome: 'R', tipo: 'percentual', valor: 10, quota: null }] });
  assert.equal(promocaoDoProduto([pct('vista')], 'r', { venda: 110, vista: 100 }, '2026-10-05')?.preco, 90);
  assert.equal(promocaoDoProduto([pct('todas')], 'r', { venda: 110, vista: 100 }, '2026-10-05')?.preco, 99);
  assert.equal(promocaoDoProduto([pct('vista')], 'r', { venda: 110, vista: 0 }, '2026-10-05')?.preco, 99);
});