import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatarQuantidade,
  montarDocumentoProducao,
  ordensNoPeriodo,
  resumirProducao,
  type OrdemDoRelatorio,
} from '../src/utils/relatorioProducaoDomain';

// Datas no horario local, como o filtro da tela (startOfDay/endOfDay).
const dia = (d: number, h = 10) => new Date(2026, 8, d, h, 0, 0);
const periodo = { inicio: new Date(2026, 8, 1, 0, 0, 0), fim: new Date(2026, 8, 30, 23, 59, 59, 999) };

const ordem = (extra: Partial<OrdemDoRelatorio>): OrdemDoRelatorio => ({
  id: Math.random().toString(36).slice(2), produtoNome: 'PÃO', quantidadePlanejada: 10, quantidadeProduzida: null, status: 'criada',
  responsavelNome: 'ANA', criadoEm: dia(10), ...extra,
});

const base: OrdemDoRelatorio[] = [
  ordem({
    id: 'a', status: 'finalizada', quantidadeProduzida: 9.5,
    itensConsumidos: [
      { materiaPrimaId: 'farinha', materiaPrimaNome: 'FARINHA', unidade: 'KG', perdaExtra: 0.25, sobra: 0 },
      { materiaPrimaId: 'sal', materiaPrimaNome: 'SAL', unidade: 'KG', perdaExtra: 0, sobra: 0.1 },
    ],
  }),
  ordem({
    id: 'b', status: 'finalizada', produtoNome: 'BOLO', quantidadePlanejada: 20, quantidadeProduzida: 20, responsavelNome: '', criadoEm: dia(12),
    itensConsumidos: [{ materiaPrimaId: 'farinha', materiaPrimaNome: 'FARINHA', unidade: 'KG', perdaExtra: 1, sobra: 0.5 }],
  }),
  ordem({ id: 'c', status: 'finalizada', quantidadeProduzida: 10, criadoEm: dia(12) }),
  ordem({ id: 'd', status: 'em_producao', criadoEm: dia(15) }),
  ordem({ id: 'e', status: 'pausada', criadoEm: dia(15) }),
  ordem({ id: 'f', status: 'cancelada', criadoEm: dia(2) }),
  ordem({ id: 'g', status: 'estornada', quantidadeProduzida: 10, criadoEm: dia(3) }),
  ordem({ id: 'h', status: 'finalizada', criadoEm: new Date(2026, 9, 1, 0, 0, 0) }),
  ordem({ id: 'i', status: 'finalizada', criadoEm: null }),
];

test('período: só ordens criadas dentro do intervalo, sem data fica de fora', () => {
  assert.deepEqual(ordensNoPeriodo(base, periodo).map((o) => o.id), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
});

test('contagens por situação e eficiência = produzido das finalizadas / planejado de todas', () => {
  const r = resumirProducao(ordensNoPeriodo(base, periodo));
  assert.equal(r.qtdTotal, 7);
  assert.equal(r.qtdFinalizadas, 3);
  assert.equal(r.qtdEmAndamento, 2);
  assert.equal(r.qtdCanceladas, 1);
  assert.equal(r.qtdEstornadas, 1);
  assert.equal(r.planejadoTotal, 80);
  assert.equal(r.produzidoTotal, 39.5);
  assert.equal(r.eficiencia, (39.5 / 80) * 100);
  assert.deepEqual(r.porStatus.map((s) => [s.status, s.qtd]), [['Finalizada', 3], ['Em Produção', 1], ['Pausada', 1], ['Cancelada', 1], ['Estornada', 1]]);
  assert.deepEqual(r.porDia.map((d) => [d.rotulo, d.qtd]), [['02/09', 1], ['03/09', 1], ['10/09', 1], ['12/09', 2], ['15/09', 2]]);
});

test('produto e responsável somam só finalizadas, do maior para o menor', () => {
  const r = resumirProducao(ordensNoPeriodo(base, periodo));
  assert.deepEqual(r.porProduto.map((p) => [p.nome, p.ordens, p.produzido]), [['BOLO', 1, 20], ['PÃO', 2, 19.5]]);
  assert.deepEqual(r.porResponsavel.map((p) => [p.nome, p.ordens, p.produzido]), [['Sem responsável', 1, 20], ['ANA', 2, 19.5]]);
});

test('perda e sobra por matéria-prima (só valores acima de zero)', () => {
  const r = resumirProducao(ordensNoPeriodo(base, periodo));
  assert.deepEqual(r.perdas.map((m) => [m.nome, m.quantidade, m.unidade]), [['FARINHA', 1.25, 'KG']]);
  assert.deepEqual(r.sobras.map((m) => [m.nome, m.quantidade]), [['FARINHA', 0.5], ['SAL', 0.1]]);
});

test('quantidade fracionada em pt-BR', () => {
  assert.equal(formatarQuantidade(1234.5), '1.234,5');
  assert.equal(formatarQuantidade(0.1 + 0.2), '0,3');
  assert.equal(formatarQuantidade(20), '20');
});

test('documento: período dd/mm/aaaa, indicadores e seções', () => {
  const doc = montarDocumentoProducao(base, periodo);
  assert.equal(doc.titulo, 'Relatório de Produção');
  assert.equal(doc.periodo, 'Período: 01/09/2026 a 30/09/2026');
  assert.deepEqual(doc.indicadores.slice(0, 6).map((i) => [i.rotulo, i.valor]), [
    ['Total de Ordens', '7'], ['Finalizadas', '3'], ['Em Andamento', '2'], ['Canceladas', '1'], ['Estornadas', '1'], ['Eficiência de Produção', '49,4%'],
  ]);
  assert.deepEqual(doc.secoes.map((s) => [s.id, s.padrao !== false]), [
    ['por-produto', true], ['por-responsavel', true], ['perdas', true], ['sobras', true], ['por-dia', false], ['por-status', false],
  ]);
  const produto = doc.secoes[0];
  const colunaQtd = produto.colunas.find((c) => c.id === 'produzido');
  assert.equal(colunaQtd?.valor(produto.linhas[1]), '19,5');
  assert.equal(colunaQtd?.total, 'nenhum');
  const perdas = doc.secoes[2];
  assert.equal(perdas.colunas[1].valor(perdas.linhas[0]), '1,25 KG');
});

test('sem ordens: documento vazio não quebra', () => {
  const doc = montarDocumentoProducao([], periodo);
  assert.equal(doc.indicadores[5].valor, '0,0%');
  assert.ok(doc.secoes.every((s) => s.linhas.length === 0));
});
