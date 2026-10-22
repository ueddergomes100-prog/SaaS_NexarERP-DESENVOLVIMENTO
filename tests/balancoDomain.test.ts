import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ajusteDoItem,
  bloqueioPorBalanco,
  dividirEmBlocos,
  erroDaQuantidade,
  itensNegativos,
  lerPedidoDeAbertura,
  moverItemEntreBlocos,
  novoTotalContado,
  produtoEntraNoEscopo,
  resumoDoFechamento,
  totalContado,
  type ItemDoBalanco,
} from '../src/utils/balancoDomain';

test('abertura: nome, o que contar, quem conta, trava', () => {
  const ok = lerPedidoDeAbertura({ nome: ' balanço outubro ', escopo: { tipo: 'grupos', categorias: ['ração', 'RAÇÃO', ' pet '] }, contadores: ['u1', 'u2', 'u1'], travaVendas: true });
  assert.deepEqual(ok, { pedido: { nome: 'BALANÇO OUTUBRO', escopo: { tipo: 'grupos', categorias: ['RAÇÃO', 'PET'] }, contadores: ['u1', 'u2'], travaVendas: true } });
  const erro = (c: unknown) => (lerPedidoDeAbertura(c) as { erro: string }).erro;
  assert.match(erro({ nome: 'x', escopo: { tipo: 'todos' }, contadores: ['u1'] }), /nome/);
  assert.match(erro({ nome: 'BAL', escopo: { tipo: 'grupos', categorias: [] }, contadores: ['u1'] }), /pelo menos um grupo/);
  assert.match(erro({ nome: 'BAL', escopo: { tipo: 'todos' }, contadores: [] }), /quem vai contar/);
  assert.equal((lerPedidoDeAbertura({ nome: 'BAL', escopo: { tipo: 'todos', categorias: ['X'] }, contadores: ['u1'] }) as { pedido: { escopo: { categorias: string[] }; travaVendas: boolean } }).pedido.escopo.categorias.length, 0);
});

test('escopo: grade, inativo, grupo e produto acabado', () => {
  const todos = { tipo: 'todos' as const, categorias: [] };
  assert.equal(produtoEntraNoEscopo({ categoria: 'RAÇÃO' }, todos), true);
  assert.equal(produtoEntraNoEscopo({ temGrade: true }, todos), false, 'principal de grade nao tem estoque');
  assert.equal(produtoEntraNoEscopo({ statusAtivo: false }, todos), false);
  assert.equal(produtoEntraNoEscopo({ categoria: 'ração' }, { tipo: 'grupos', categorias: ['RAÇÃO'] }), true);
  assert.equal(produtoEntraNoEscopo({ categoria: '' }, { tipo: 'grupos', categorias: ['SEM GRUPO'] }), true);
  // Acabados e revenda: produzido OU comprado para revender; uso interno fica de fora.
  const acabados = { tipo: 'acabados' as const, categorias: [] };
  assert.equal(produtoEntraNoEscopo({ produzidoInternamente: true }, acabados), true, 'produzido');
  assert.equal(produtoEntraNoEscopo({}, acabados), true, 'revenda (cadastro sem o campo)');
  assert.equal(produtoEntraNoEscopo({ produtoRevenda: true }, acabados), true);
  assert.equal(produtoEntraNoEscopo({ produtoRevenda: false }, acabados), false, 'uso interno / semiacabado');
  assert.equal(produtoEntraNoEscopo({ avancado: { produtoRevenda: false } }, acabados), false, 'cadastro antigo');
});

test('divisao: partes quase iguais, mesmo grupo junto, grupo grande cortado, sempre igual', () => {
  const itens = [
    ...Array.from({ length: 6 }, (_, i) => ({ chave: `r${i}`, grupo: 'RAÇÃO', nome: `RACAO ${i}` })),
    ...Array.from({ length: 3 }, (_, i) => ({ chave: `m${i}`, grupo: 'MEDICAMENTO', nome: `MED ${i}` })),
    ...Array.from({ length: 3 }, (_, i) => ({ chave: `p${i}`, grupo: 'PET', nome: `PET ${i}` })),
  ];
  const r = dividirEmBlocos(itens, ['ana', 'bia', 'caio']);
  const cargas = r.blocos.map((b) => b.itens);
  assert.equal(cargas.reduce((s, n) => s + n, 0), 12);
  assert.ok(Math.max(...cargas) - Math.min(...cargas) <= 2, `equilibrado: ${cargas}`);
  // Medicamento e Pet nao sao partidos.
  assert.equal(new Set(['m0', 'm1', 'm2'].map((k) => r.porItem[k])).size, 1);
  assert.equal(new Set(['p0', 'p1', 'p2'].map((k) => r.porItem[k])).size, 1);
  assert.deepEqual(dividirEmBlocos(itens, ['ana', 'bia', 'caio']), r);
  assert.equal(Object.keys(dividirEmBlocos(itens, ['so']).porItem).length, 12);
});

test('contagem: unidade sem fracao, casas decimais, somar e definir', () => {
  assert.match(erroDaQuantidade(1.5, { fracionado: false, casas: 0, sigla: 'UN' }, 'COLEIRA') || '', /sem fração/);
  assert.equal(erroDaQuantidade(1.25, { fracionado: true, casas: 3, sigla: 'KG' }, 'RACAO'), null);
  assert.match(erroDaQuantidade(1.2345, { fracionado: true, casas: 3, sigla: 'KG' }, 'RACAO') || '', /3 casa/);
  assert.match(erroDaQuantidade(-1, { fracionado: false, casas: 0, sigla: 'UN' }, 'X') || '', /de zero para cima/);
  assert.equal(novoTotalContado(10, 5, 'somar'), 15);
  assert.equal(novoTotalContado(10, 5, 'definir'), 5);
  assert.equal(novoTotalContado(null, 0.1, 'somar'), 0.1);
});

const item = (extra: Partial<ItemDoBalanco> = {}): ItemDoBalanco => ({
  chave: 'estoque_p1', colecao: 'estoque', produtoId: 'p1', nome: 'RACAO', controlaLote: false, contado: 100, saldoNaContagem: -10, lotes: [], ...extra,
});

test('fechamento: exemplo do dono (sistema -10, contou 100) -> 100 ou 90', () => {
  assert.equal(ajusteDoItem(item(), -10, {}, 'contado').depois, 100);
  assert.equal(ajusteDoItem(item(), -10, {}, 'descontar').depois, 90);
  // Positivo: a regra nao muda nada.
  assert.equal(ajusteDoItem(item({ saldoNaContagem: 40 }), 40, {}, 'descontar').depois, 100);
});

test('fechamento sem trava: venda depois da contagem continua valendo', () => {
  // Contou 100 com o sistema em 80; depois vendeu 2 (agora 78): fica 98.
  const a = ajusteDoItem(item({ saldoNaContagem: 80 }), 78, {}, 'contado');
  assert.equal(a.delta, 20);
  assert.equal(a.depois, 98);
});

test('fechamento: nao contado zera; reserva nao entra na conta', () => {
  const a = ajusteDoItem(item({ contado: null, saldoNaContagem: null }), 37, {}, 'contado');
  assert.equal(a.naoContado, true);
  assert.equal(a.depois, 0);
  assert.equal(a.delta, -37);
});

test('fechamento por lote: cada lote no seu contado; lote nao contado zera; lote novo entra', () => {
  const comLote = item({
    controlaLote: true, contado: null, saldoNaContagem: 30,
    lotes: [
      { loteId: 'l1', lote: 'A', validade: '2027-01-01', contado: 12, saldoNaContagem: 10 },
      { loteId: 'l2', lote: 'B', validade: '2027-02-01', contado: null, saldoNaContagem: null },
      { loteId: null, lote: 'C', validade: '2027-03-01', contado: 5, saldoNaContagem: 0 },
    ],
  });
  assert.equal(totalContado(comLote), 17);
  const a = ajusteDoItem(comLote, 30, { l1: 10, l2: 20 }, 'contado');
  assert.equal(a.depois, 17);
  assert.deepEqual(a.lotes.map((l) => [l.lote, l.depois]), [['A', 12], ['B', 0], ['C', 5]]);
  assert.equal(totalContado({ controlaLote: true, contado: null, lotes: [] }), null);
});

test('resumo, negativos e trava', () => {
  const ajustes = [
    ajusteDoItem(item(), -10, {}, 'contado'),
    ajusteDoItem(item({ chave: 'b', contado: 5, saldoNaContagem: 5 }), 5, {}, 'contado'),
    ajusteDoItem(item({ chave: 'c', contado: null, saldoNaContagem: null }), 3, {}, 'contado'),
  ];
  assert.deepEqual(resumoDoFechamento(ajustes), { itens: 3, naoContados: 1, comDiferenca: 2, sobras: 1, faltas: 1 });
  assert.equal(itensNegativos([item(), item({ saldoNaContagem: 3 }), item({ contado: null })]).length, 1);
  assert.equal(bloqueioPorBalanco(null, 'finalizar a venda'), null);
  assert.equal(bloqueioPorBalanco({ travaVendas: false, nome: 'X' }, 'finalizar a venda'), null);
  assert.match(bloqueioPorBalanco({ travaVendas: true, nome: 'BALANÇO OUTUBRO' }, 'finalizar a venda') || '', /BALANÇO OUTUBRO.*finalizar a venda.*Pré-venda continua liberada/);
});

test('item bipado por outra pessoa: passa de bloco (22/10)', () => {
  const blocos = [
    { contadorUid: 'ana', itens: 3, grupos: [{ nome: 'PET', itens: 2 }, { nome: 'RAÇÃO', itens: 1 }] },
    { contadorUid: 'bia', itens: 1, grupos: [{ nome: 'PET', itens: 1 }] },
  ];
  const depois = moverItemEntreBlocos(blocos, 'ana', 'bia', 'RAÇÃO');
  assert.deepEqual(depois, [
    { contadorUid: 'ana', itens: 2, grupos: [{ nome: 'PET', itens: 2 }] },
    { contadorUid: 'bia', itens: 2, grupos: [{ nome: 'PET', itens: 1 }, { nome: 'RAÇÃO', itens: 1 }] },
  ]);
  assert.equal(blocos[0].itens, 3, 'nao mexe no original');
  assert.equal(moverItemEntreBlocos(blocos, 'ana', 'ana', 'PET'), blocos);
  const novo = moverItemEntreBlocos(blocos, 'ana', 'caio', 'PET');
  assert.deepEqual(novo[2], { contadorUid: 'caio', itens: 1, grupos: [{ nome: 'PET', itens: 1 }] });
});
