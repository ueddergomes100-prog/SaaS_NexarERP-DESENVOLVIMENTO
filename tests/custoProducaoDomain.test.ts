import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  arredondarCusto,
  calcularCustoDaReceita,
  descricaoDoMotivo,
  entradaDeHistorico,
  htmlDoImpactoDeCusto,
  planejarRecalculoDeCustos,
  resumirImpacto,
  type ProdutoParaCusto,
  type ReceitaDoProduto,
} from '../src/utils/custoProducaoDomain';

const mp = (id: string) => `materia_prima:${id}`;
const est = (id: string) => `estoque:${id}`;

// Cha misto (P1) = 0,5 kg de capim (M1) + 0,25 kg de melissa (M2)
// Kit (P2) = 2 x Cha misto (P1, semiacabado em estoque) + 1 embalagem (M3)
const produtos: ProdutoParaCusto[] = [
  { id: 'P1', nome: 'CHA MISTO', precoCusto: 8, precoVenda: 12, produzidoInternamente: true },
  { id: 'P2', nome: 'KIT CHA', precoCusto: 17, precoVenda: 30, produzidoInternamente: true },
  { id: 'P3', nome: 'CAMISETA REVENDA', precoCusto: 20, precoVenda: 40, produzidoInternamente: false },
  { id: 'P4', nome: 'PRODUTO SEM RECEITA', precoCusto: 5, precoVenda: 9, produzidoInternamente: true },
];
const receitas: ReceitaDoProduto[] = [
  { produtoId: 'P1', itens: [
    { origem: 'materia_prima', componenteId: 'M1', quantidade: 0.5 },
    { origem: 'materia_prima', componenteId: 'M2', quantidade: 0.25 },
  ] },
  { produtoId: 'P2', itens: [
    { origem: 'estoque', componenteId: 'P1', quantidade: 2 },
    { origem: 'materia_prima', componenteId: 'M3', quantidade: 1 },
  ] },
  // P3 nao e produzido internamente: a receita (se existir) nao manda no custo
  { produtoId: 'P3', itens: [{ origem: 'materia_prima', componenteId: 'M1', quantidade: 9 }] },
];
const custosAtuais = () => new Map<string, number>([
  [mp('M1'), 10], [mp('M2'), 12], [mp('M3'), 1],
  [est('P1'), 8], [est('P2'), 17], [est('P3'), 20], [est('P4'), 5],
]);
const nomes = new Map<string, string>([[mp('M1'), 'CAPIM'], [mp('M2'), 'MELISSA'], [mp('M3'), 'EMBALAGEM']]);
// P1 = 0,5*10 + 0,25*12 = 8 ; P2 = 2*8 + 1 = 17 (bate com o gravado)

test('custo da receita: soma quantidade x custo e arredonda em 4 casas', () => {
  assert.equal(calcularCustoDaReceita(receitas[0].itens, (o, id) => (id === 'M1' ? 10 : 12)), 8);
  assert.equal(calcularCustoDaReceita([{ origem: 'materia_prima', componenteId: 'X', quantidade: 0.125 }], () => 10.5), 1.3125);
  assert.equal(calcularCustoDaReceita([], () => 5), 0);
  assert.equal(arredondarCusto(0.1 + 0.2), 0.3);
});

test('matéria-prima subiu: o produto que a usa muda, o que não usa fica de fora', () => {
  const r = planejarRecalculoDeCustos({
    mudancas: [{ origem: 'materia_prima', id: 'M1', nome: 'CAPIM', custoAnterior: 10, custoNovo: 14 }],
    receitas, produtos, custosAtuais: custosAtuais(), nomesDosComponentes: nomes,
  });
  const p1 = r.impactos.find((i) => i.produtoId === 'P1');
  assert.equal(p1?.custoAnterior, 8);
  assert.equal(p1?.custoNovo, 10); // 0,5*14 + 0,25*12
  assert.equal(p1?.variacaoPercentual, 25);
  assert.deepEqual(p1?.causas, [{ nome: 'CAPIM', custoAnterior: 10, custoNovo: 14 }]);
  assert.equal(r.impactos.some((i) => i.produtoId === 'P3'), false, 'revenda não recalcula pela receita');
  assert.equal(r.impactos.some((i) => i.produtoId === 'P4'), false);
});

test('cadeia: semiacabado muda e leva junto o produto que o usa', () => {
  const r = planejarRecalculoDeCustos({
    mudancas: [{ origem: 'materia_prima', id: 'M1', nome: 'CAPIM', custoAnterior: 10, custoNovo: 14 }],
    receitas, produtos, custosAtuais: custosAtuais(), nomesDosComponentes: nomes,
  });
  const kit = r.impactos.find((i) => i.produtoId === 'P2');
  assert.equal(kit?.custoAnterior, 17);
  assert.equal(kit?.custoNovo, 21); // 2*10 + 1
  assert.equal(kit?.causas[0].nome, 'CHA MISTO');
  assert.equal(kit?.causas[0].custoAnterior, 8);
  assert.equal(kit?.causas[0].custoNovo, 10);
});

test('cadeia funciona mesmo quando o produto final vem antes do semiacabado na lista', () => {
  const r = planejarRecalculoDeCustos({
    mudancas: [{ origem: 'materia_prima', id: 'M1', nome: 'CAPIM', custoAnterior: 10, custoNovo: 14 }],
    receitas: [receitas[1], receitas[0], receitas[2]], produtos, custosAtuais: custosAtuais(), nomesDosComponentes: nomes,
  });
  assert.equal(r.impactos.find((i) => i.produtoId === 'P2')?.custoNovo, 21);
});

test('margem: mesmo preço de venda, custo novo; abaixo do custo é sinalizado e vem primeiro', () => {
  const r = planejarRecalculoDeCustos({
    mudancas: [{ origem: 'materia_prima', id: 'M1', nome: 'CAPIM', custoAnterior: 10, custoNovo: 30 }],
    receitas, produtos, custosAtuais: custosAtuais(), nomesDosComponentes: nomes,
  });
  const p1 = r.impactos.find((i) => i.produtoId === 'P1');
  assert.equal(p1?.custoNovo, 18); // 15 + 3
  assert.equal(p1?.precoVenda, 12);
  assert.equal(p1?.margemAntes, 50); // (12-8)/8
  assert.equal(p1?.margemDepois, -33.33333333333333);
  assert.equal(p1?.vendeAbaixoDoCusto, true);
  assert.equal(r.impactos[0].vendeAbaixoDoCusto, true);
  assert.equal(resumirImpacto(r).abaixoDoCusto, 2); // P1 e o kit (custo 2*18+1=37 > 30)
});

test('mudança dentro da tolerância não gera impacto; sem mudança de custo não faz nada', () => {
  const r = planejarRecalculoDeCustos({
    mudancas: [{ origem: 'materia_prima', id: 'M1', nome: 'CAPIM', custoAnterior: 10, custoNovo: 10.00001 }],
    receitas, produtos, custosAtuais: custosAtuais(), nomesDosComponentes: nomes,
  });
  assert.deepEqual(r.impactos, []);
});

test('conferir tudo (importação/botão) acha custo gravado desatualizado', () => {
  const custos = custosAtuais();
  custos.set(mp('M1'), 20); // matéria-prima já mudou no cadastro, produto ficou com custo velho
  const r = planejarRecalculoDeCustos({ mudancas: [], todos: true, receitas, produtos, custosAtuais: custos, nomesDosComponentes: nomes });
  assert.equal(r.impactos.find((i) => i.produtoId === 'P1')?.custoNovo, 13); // 10 + 3
  assert.equal(r.impactos.find((i) => i.produtoId === 'P2')?.custoNovo, 27); // 2*13 + 1
  assert.equal(r.produtosConferidos, 2);
});

test('receita salva: recalcula o produto mesmo sem mudança de custo de componente', () => {
  const novaReceita: ReceitaDoProduto[] = [
    { produtoId: 'P1', itens: [{ origem: 'materia_prima', componenteId: 'M1', quantidade: 1 }] },
    receitas[1],
  ];
  const r = planejarRecalculoDeCustos({ mudancas: [], receitasAlteradas: ['P1'], receitas: novaReceita, produtos, custosAtuais: custosAtuais(), nomesDosComponentes: nomes });
  assert.equal(r.impactos.find((i) => i.produtoId === 'P1')?.custoNovo, 10);
  assert.equal(r.impactos.find((i) => i.produtoId === 'P2')?.custoNovo, 21);
});

test('componente sem custo cadastrado é avisado (custo subestimado)', () => {
  const custos = custosAtuais();
  custos.set(mp('M3'), 0);
  const r = planejarRecalculoDeCustos({
    mudancas: [{ origem: 'materia_prima', id: 'M1', nome: 'CAPIM', custoAnterior: 10, custoNovo: 14 }],
    receitas, produtos, custosAtuais: custos, nomesDosComponentes: nomes,
  });
  assert.deepEqual(r.impactos.find((i) => i.produtoId === 'P2')?.componentesSemCusto, ['EMBALAGEM']);
});

test('receita que se refere a si mesma não trava e não grava custo dos envolvidos', () => {
  const ciclo: ReceitaDoProduto[] = [
    { produtoId: 'P1', itens: [{ origem: 'estoque', componenteId: 'P2', quantidade: 1 }] },
    { produtoId: 'P2', itens: [{ origem: 'estoque', componenteId: 'P1', quantidade: 1 }, { origem: 'materia_prima', componenteId: 'M1', quantidade: 1 }] },
  ];
  const r = planejarRecalculoDeCustos({
    mudancas: [{ origem: 'materia_prima', id: 'M1', nome: 'CAPIM', custoAnterior: 10, custoNovo: 14 }],
    receitas: ciclo, produtos, custosAtuais: custosAtuais(), nomesDosComponentes: nomes,
  });
  assert.ok(r.idsEmCiclo.length > 0);
  assert.equal(r.impactos.some((i) => r.idsEmCiclo.includes(i.produtoId)), false);
});

test('histórico: preço de venda igual antes e depois, só o custo se move, com motivo em português', () => {
  const r = planejarRecalculoDeCustos({
    mudancas: [{ origem: 'materia_prima', id: 'M1', nome: 'CAPIM', custoAnterior: 10, custoNovo: 14 }],
    receitas, produtos, custosAtuais: custosAtuais(), nomesDosComponentes: nomes,
  });
  const p1 = r.impactos.find((i) => i.produtoId === 'P1');
  assert.ok(p1);
  const h = entradaDeHistorico(p1, 'Entrada de NF 99', 'u1', new Date('2026-09-24T12:00:00Z'));
  assert.equal(h.precoAnterior, 12);
  assert.equal(h.precoNovo, 12);
  assert.equal(h.custoAnterior, 8);
  assert.equal(h.custoNovo, 10);
  assert.equal(h.usuarioId, 'u1');
  assert.match(h.motivo, /CAPIM/);
  assert.match(h.motivo, /Entrada de NF 99/);
  assert.equal('usuarioId' in entradaDeHistorico(p1, 'x', undefined), false, 'nunca grava undefined');
  assert.match(descricaoDoMotivo([], 'importação'), /composição/);
});

test('aviso ao usuário: mostra custo, margem, a regra do preço e escapa texto do cadastro', () => {
  const r = planejarRecalculoDeCustos({
    mudancas: [{ origem: 'materia_prima', id: 'M1', nome: '<b>CAPIM</b>', custoAnterior: 10, custoNovo: 30 }],
    receitas, produtos, custosAtuais: custosAtuais(), nomesDosComponentes: nomes,
  });
  const html = htmlDoImpactoDeCusto(r);
  assert.match(html, /2<\/strong> produto\(s\) acabado\(s\)/);
  assert.match(html, /abaixo do custo/);
  assert.match(html, /preço de venda não foi alterado/);
  assert.equal(html.includes('<b>CAPIM</b>'), false);
  assert.match(html, /&lt;b&gt;CAPIM&lt;\/b&gt;/);
  assert.equal(htmlDoImpactoDeCusto({ impactos: [], emCiclo: [], idsEmCiclo: [], produtosConferidos: 3, comReceitaSemMarcacao: [] }), '');
});

test('conferência geral lista produto com composição que não está marcado como produzido internamente', () => {
  const r = planejarRecalculoDeCustos({ mudancas: [], todos: true, receitas, produtos, custosAtuais: custosAtuais(), nomesDosComponentes: nomes });
  assert.deepEqual(r.comReceitaSemMarcacao, [{ id: 'P3', nome: 'CAMISETA REVENDA' }]);
  assert.match(htmlDoImpactoDeCusto(r), /Produzido internamente/);
  assert.match(htmlDoImpactoDeCusto(r), /custo de todos já está correto/);
});
