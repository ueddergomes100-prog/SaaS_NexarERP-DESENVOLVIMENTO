import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  filtrarRotas,
  montarDocumentoRotas,
  resumirRotas,
  resumirRotasPorMotorista,
  resumirRotasPorTipo,
  totalDaRotaDoRelatorioCentavos,
  type FiltroRotas,
  type RotaDoRelatorio,
} from '../src/utils/relatorioRotasDomain';

const semFiltro: FiltroRotas = { busca: '', motoristaId: '', de: '', ate: '' };

const rotas: RotaDoRelatorio[] = [
  {
    id: 'r1', motoristaId: 'm1', motoristaNome: 'CARLOS', veiculo: 'FIORINO ABC-1D23', data: '2026-09-10', observacao: 'Entrega Uberlândia',
    despesas: [
      { tipo: 'combustivel', descricao: '', valor: 200, comprovante: '1' },
      { tipo: 'alimentacao', descricao: '', valor: 35.5, comprovante: '' },
      { tipo: 'pedagio', descricao: '', valor: 0, comprovante: '' },
    ],
    totalCentavos: 23550,
  },
  {
    id: 'r2', motoristaId: 'm2', motoristaNome: 'DIEGO', veiculo: 'DELIVERY', data: '2026-09-15',
    despesas: [{ tipo: 'LAVAGEM', descricao: '', valor: 40, comprovante: '' }, { tipo: 'combustivel', descricao: '', valor: 100, comprovante: '' }],
    totalCentavos: 14000,
  },
  // Rota antiga: so' tem `total` em reais.
  {
    id: 'r3', motoristaId: 'm1', motoristaNome: 'CARLOS', veiculo: 'FIORINO ABC-1D23', data: '2026-09-20',
    despesas: [{ tipo: 'hospedagem', descricao: '', valor: 120.1, comprovante: '9' }],
    total: 120.1,
  },
  { id: 'r4', motoristaId: 'm2', motoristaNome: 'DIEGO', data: '2026-08-31', despesas: [{ tipo: 'outros', descricao: 'Chave', valor: 15, comprovante: '' }], totalCentavos: 1500 },
];

test('filtros da tela: motorista, período, busca e data mais recente primeiro', () => {
  assert.deepEqual(filtrarRotas(rotas, semFiltro).map((r) => r.id), ['r3', 'r2', 'r1', 'r4']);
  assert.deepEqual(filtrarRotas(rotas, { ...semFiltro, motoristaId: 'm1' }).map((r) => r.id), ['r3', 'r1']);
  assert.deepEqual(filtrarRotas(rotas, { ...semFiltro, de: '2026-09-01', ate: '2026-09-15' }).map((r) => r.id), ['r2', 'r1']);
  assert.deepEqual(filtrarRotas(rotas, { ...semFiltro, busca: 'uberl' }).map((r) => r.id), ['r1']);
  assert.deepEqual(filtrarRotas(rotas, { ...semFiltro, busca: 'delivery' }).map((r) => r.id), ['r2']);
});

test('total da rota em centavos, inclusive rota antiga só com total em reais', () => {
  assert.equal(totalDaRotaDoRelatorioCentavos(rotas[0]), 23550);
  assert.equal(totalDaRotaDoRelatorioCentavos(rotas[2]), 12010);
  assert.equal(totalDaRotaDoRelatorioCentavos({ id: 'x' }), 0);
});

test('resumo do topo, por motorista e por tipo (mesma ordem da tela)', () => {
  const resumo = resumirRotas(rotas);
  assert.equal(resumo.totalCentavos, 51060);
  assert.deepEqual(resumo.porTipo.map((t) => [t.label, t.totalCentavos]), [
    ['Combustível', 30000], ['Alimentação', 3550], ['Hospedagem', 12010], ['LAVAGEM', 4000], ['Outros', 1500],
  ]);
  assert.deepEqual(resumirRotasPorMotorista(rotas).map((m) => [m.nome, m.rotas, m.despesas, m.totalCentavos]), [
    ['CARLOS', 2, 3, 35560],
    ['DIEGO', 2, 3, 15500],
  ]);
  assert.deepEqual(resumirRotasPorTipo(rotas).map((t) => [t.label, t.despesas, t.totalCentavos]), [
    ['Combustível', 2, 30000], ['Alimentação', 1, 3550], ['Hospedagem', 1, 12010], ['LAVAGEM', 1, 4000], ['Outros', 1, 1500],
  ]);
});

test('documento: período, filtros, indicadores e as 3 seções com rotas agrupadas por motorista', () => {
  const filtro = { ...semFiltro, motoristaId: 'm1', de: '2026-09-01', ate: '2026-09-30', busca: ' fiorino ' };
  const doc = montarDocumentoRotas(filtrarRotas(rotas, filtro), filtro, 'CARLOS');
  assert.equal(doc.titulo, 'Rotas e Despesas de Viagem');
  assert.equal(doc.periodo, 'Data da rota de 01/09/2026 a 30/09/2026');
  assert.deepEqual(doc.filtros, ['Motorista: CARLOS', 'Busca: "fiorino"']);
  assert.deepEqual(doc.indicadores.map((i) => i.rotulo), ['Total gasto', 'Rotas', 'Combustível', 'Alimentação', 'Hospedagem']);
  assert.match(doc.indicadores[0].valor, /355,60/);
  assert.equal(doc.indicadores[1].valor, '2');

  assert.deepEqual(doc.secoes.map((s) => [s.id, s.padrao]), [['motoristas', true], ['rotas', true], ['tipos', false]]);
  const secaoRotas = doc.secoes[1];
  assert.deepEqual(secaoRotas.colunas.map((c) => c.id), ['data', 'motorista', 'veiculo', 'despesas', 'qtd', 'observacao', 'total']);
  assert.deepEqual(secaoRotas.colunas.filter((c) => c.padrao === false).map((c) => c.id), ['motorista', 'qtd', 'observacao']);
  const col = (id: string) => secaoRotas.colunas.find((c) => c.id === id)!;
  const r1 = secaoRotas.linhas.find((r: RotaDoRelatorio) => r.id === 'r1');
  assert.equal(col('data').valor(r1), '10/09/2026');
  assert.equal(col('despesas').valor(r1), 'Combustível, Alimentação');
  assert.equal(col('qtd').valor(r1), 2, 'despesa zerada não conta');
  assert.equal(col('total').valor(r1), 23550);
  assert.equal(secaoRotas.agruparPor?.chave(r1), 'm1');
  assert.equal(secaoRotas.agruparPor?.rotulo(r1), 'CARLOS');
});

test('sem rotas: documento vazio não quebra e diz "Todas as datas"', () => {
  const doc = montarDocumentoRotas([], semFiltro);
  assert.equal(doc.periodo, 'Todas as datas');
  assert.deepEqual(doc.filtros, []);
  assert.equal(doc.indicadores[0].valor.replace(/\s/g, ''), 'R$0,00');
  assert.equal(doc.indicadores.length, 2);
  assert.ok(doc.secoes.every((s) => s.linhas.length === 0));
});
