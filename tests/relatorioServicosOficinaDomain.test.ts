import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatarPercentual,
  montarDocumentoServicosOficina,
  osNoPeriodo,
  resumirServicosOficina,
  valoresDaOs,
  type OsDoRelatorio,
} from '../src/utils/relatorioServicosOficinaDomain';

// Datas no horario local, como o filtro da tela (startOfDay/endOfDay).
const dia = (d: number, h = 10) => new Date(2026, 8, d, h, 0, 0);
const periodo = { inicio: new Date(2026, 8, 1, 0, 0, 0), fim: new Date(2026, 8, 30, 23, 59, 59, 999) };

const os = (extra: Partial<OsDoRelatorio>): OsDoRelatorio => ({ id: Math.random().toString(36).slice(2), status: 'Finalizada', criadoEm: dia(10), ...extra });

const base: OsDoRelatorio[] = [
  // 2h x 100 + 1 peça de 50,25 (qtd vazia conta 1); taxa em centavos 1000 -> liquido 240,25
  os({ id: 'a', mecanicoId: 'm1', servicos: [{ preco: 100, tempoHoras: 2 }], pecas: [{ preco: 50.25 }], totalTaxasPagamentoCentavos: 1000 }),
  // sem tempoHoras: usa quantidade (3 x 30); taxa antiga em reais
  os({ id: 'b', mecanicoId: 'm2', mecanicoNome: 'JOÃO', servicos: [{ preco: 30, quantidade: 3 }], pecas: [{ preco: 10, quantidade: 2 }], totalTaxasPagamento: 5.5, criadoEm: dia(12) }),
  // taxa maior que o bruto: liquido nunca negativo
  os({ id: 'c', mecanicoId: 'm1', servicos: [{ preco: 10, tempoHoras: 1 }], totalTaxasPagamentoCentavos: 5000, criadoEm: dia(12) }),
  os({ id: 'd', status: 'Em andamento', servicos: [{ preco: 500, tempoHoras: 1 }], criadoEm: dia(15) }),
  os({ id: 'e', status: undefined, criadoEm: dia(15) }),
  os({ id: 'f', status: 'Cancelada', servicos: [{ preco: 70, tempoHoras: 1 }], criadoEm: dia(2) }),
  os({ id: 'g', criadoEm: new Date(2026, 7, 31, 23, 0, 0) }),
  os({ id: 'h', criadoEm: null }),
];
const usuarios = { m1: { nome: 'CARLOS' } };

test('valores da OS em centavos: horas x preço, peça sem quantidade conta 1, taxa em centavos ou reais', () => {
  assert.deepEqual(valoresDaOs(base[0]), { servicosCentavos: 20000, pecasCentavos: 5025, brutoCentavos: 25025, taxaCentavos: 1000, liquidoCentavos: 24025 });
  assert.equal(valoresDaOs(base[1]).taxaCentavos, 550);
  assert.equal(valoresDaOs(base[2]).liquidoCentavos, 0);
});

test('período: só OS criadas dentro do intervalo, sem data fica de fora', () => {
  assert.deepEqual(osNoPeriodo(base, periodo).map((o) => o.id), ['a', 'b', 'c', 'd', 'e', 'f']);
});

test('resumo: só finalizada fatura; cancelada à parte; resto em aberto', () => {
  const r = resumirServicosOficina(osNoPeriodo(base, periodo), usuarios);
  assert.equal(r.qtdTotal, 6);
  assert.equal(r.qtdConcluidas, 3);
  assert.equal(r.qtdAbertas, 2);
  assert.equal(r.qtdCanceladas, 1);
  assert.equal(r.servicosCentavos, 20000 + 9000 + 1000);
  assert.equal(r.pecasCentavos, 5025 + 2000);
  assert.equal(r.brutoCentavos, 37025);
  assert.equal(r.taxasCentavos, 1000 + 550 + 5000);
  assert.equal(r.liquidoCentavos, 24025 + 10450 + 0);
  assert.equal(r.mediaPorOsCentavos, Math.round(37025 / 3));
  assert.equal(formatarPercentual(r.participacaoServicos), '81,0%');
  assert.equal(formatarPercentual(r.eficienciaConclusao, 0), '50%');
});

test('técnicos: total gerado é o líquido, nome vem da OS, do usuário ou ADMINISTRADOR', () => {
  const r = resumirServicosOficina(osNoPeriodo(base, periodo), usuarios);
  assert.deepEqual(r.porTecnico.map((t) => [t.nome, t.qtd, t.servicosCentavos, t.pecasCentavos, t.totalCentavos]), [
    ['CARLOS', 2, 21000, 5025, 24025],
    ['JOÃO', 1, 9000, 2000, 10450],
  ]);
  const semTecnico = resumirServicosOficina([os({ servicos: [{ preco: 1, tempoHoras: 1 }] })]);
  assert.equal(semTecnico.porTecnico[0].nome, 'ADMINISTRADOR');
});

test('por dia em ordem de data, contando toda OS do período; por situação', () => {
  const r = resumirServicosOficina(osNoPeriodo(base, periodo), usuarios);
  assert.deepEqual(r.porDia.map((d) => [d.rotulo, d.qtd]), [['02/09', 1], ['10/09', 1], ['12/09', 2], ['15/09', 2]]);
  assert.equal(r.porDia[3].valorCentavos, 50000);
  assert.deepEqual(r.porStatus.map((s) => [s.status, s.qtd]), [['Finalizada', 3], ['Cancelada', 1], ['Em andamento', 1], ['Pendente', 1]]);
});

test('documento: período dd/mm/aaaa, indicadores, técnicos e seções opcionais desligadas', () => {
  const doc = montarDocumentoServicosOficina(base, usuarios, periodo);
  assert.equal(doc.titulo, 'Relatório de Serviços');
  assert.equal(doc.periodo, 'Período: 01/09/2026 a 30/09/2026');
  assert.deepEqual(doc.indicadores.map((i) => i.rotulo), [
    'Faturamento Bruto', 'Taxas de Cartão', 'Receita Líquida', 'Faturamento só Serviços', 'OS Finalizadas', 'OS em Aberto',
    'Volume Total', 'Média de Valor por OS', 'Participação de Serviços', 'Participação de Peças', 'Eficiência de Conclusão',
  ]);
  assert.match(doc.indicadores[0].valor, /370,25/);
  assert.deepEqual(doc.secoes.map((s) => [s.id, s.opcional === true, s.padrao !== false]), [
    ['tecnicos', false, true], ['servicos-pecas', true, false], ['por-dia', true, false], ['por-status', true, false],
  ]);
  const tecnicos = doc.secoes[0];
  assert.equal(tecnicos.colunas.find((c) => c.id === 'total')?.valor(tecnicos.linhas[0]), 24025);
  assert.equal(tecnicos.colunas.find((c) => c.id === 'taxas')?.padrao, false);
  const partes = doc.secoes[1];
  assert.equal(partes.colunas.find((c) => c.id === 'participacao')?.valor(partes.linhas[1]), '19,0%');
  assert.equal(doc.secoes[2].colunas[0].valor(doc.secoes[2].linhas[0]), '02/09/2026');
});

test('sem OS: documento vazio não quebra', () => {
  const doc = montarDocumentoServicosOficina([], {}, periodo);
  assert.equal(doc.indicadores[0].valor.replace(/\s/g, ''), 'R$0,00');
  assert.equal(doc.indicadores[10].valor, '0%');
  assert.equal(doc.secoes[0].linhas.length, 0);
});
