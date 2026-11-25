import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calcularRecebimentos,
  DESTINO_ACERTO,
  DESTINO_CAIXA,
  DESTINO_CREDITO,
  DESTINO_SEM_BANCO,
  destinoDoRecebimento,
  montarDocumentoDeRecebimentos,
  origemDoRecebimento,
} from '../src/utils/relatorioRecebimentosDomain';
import type { TransacaoRelatorioFinanceiro } from '../src/utils/relatorioFinanceiroDomain';

/*
 * Recebimentos do periodo (24/11/2026, Jomarly): tudo que foi recebido no dia,
 * com forma, onde caiu e de onde veio; acerto com fornecedor e credito do
 * cliente aparecem, mas nao contam como dinheiro que entrou.
 */

const DIA = '2026-11-24';
const t = (parcial: Partial<TransacaoRelatorioFinanceiro> & { id: string }): TransacaoRelatorioFinanceiro => ({
  tipo: 'entrada', status: 'Paga', data: DIA, dataPagamento: DIA, descricao: 'Venda #1', clienteNome: 'CLIENTE', valor: 100, valorCentavos: 10000, ...parcial,
});

const ENTRADAS: TransacaoRelatorioFinanceiro[] = [
  t({ id: 'dinheiro', formaPagamento: 'Dinheiro', movimentaCaixaFisico: true, pedidoId: 'v1', valorCentavos: 5000, valor: 50 }),
  t({ id: 'pix', formaPagamento: 'Pix', bancoNome: 'SICOOB', baixaManual: { origem: 'contas_receber' }, valorCentavos: 30000, valor: 300, descricao: 'Venda #9 - Pagamento a Prazo' }),
  t({ id: 'parcial', formaPagamento: 'Pix', bancoNome: 'SICOOB', parcialDaTransacaoId: 'x', valorCentavos: 10000 }),
  t({ id: 'transf', formaPagamento: 'Transferência', bancoNome: 'INFINITEPAY', osId: 'os1', valorCentavos: 20000, valor: 200 }),
  t({ id: 'acerto', formaPagamento: 'Acerto com Fornecedor', baixaManual: { origem: 'contas_receber' }, valorCentavos: 100000, valor: 1000 }),
  t({ id: 'credito', formaPagamento: 'Crédito de Devolução', pedidoId: 'v2', valorCentavos: 4000, valor: 40 }),
  t({ id: 'outros', formaPagamento: 'Outros', valorCentavos: 1500, valor: 15, descricao: 'Lançamento manual' }),
  t({ id: 'desfeito', formaPagamento: 'Dinheiro', movimentaCaixaFisico: true, pedidoId: 'v3', estornada: true, valorCentavos: 9900, valor: 99 }),
  t({ id: 'ontem', formaPagamento: 'Pix', bancoNome: 'SICOOB', dataPagamento: '2026-11-23', data: '2026-11-23' }),
];

test('destino e origem de cada recebimento', () => {
  const por = Object.fromEntries(ENTRADAS.map((e) => [e.id, e]));
  assert.equal(destinoDoRecebimento(por.dinheiro), DESTINO_CAIXA);
  assert.equal(destinoDoRecebimento(por.pix), 'SICOOB');
  assert.equal(destinoDoRecebimento(por.acerto), DESTINO_ACERTO);
  assert.equal(destinoDoRecebimento(por.credito), DESTINO_CREDITO);
  assert.equal(destinoDoRecebimento(por.outros), DESTINO_SEM_BANCO);
  assert.equal(origemDoRecebimento(por.dinheiro), 'Venda à vista');
  assert.equal(origemDoRecebimento(por.pix), 'Conta recebida');
  assert.equal(origemDoRecebimento(por.parcial), 'Conta recebida');
  assert.equal(origemDoRecebimento(por.transf), 'OS à vista');
  assert.equal(origemDoRecebimento(por.outros), 'Lançamento');
  assert.equal(origemDoRecebimento(t({ id: 'b', formaPagamento: 'Boleto', pedidoId: 'v' })), 'Conta recebida');
});

test('recebimentos do dia: totais, por forma e por destino; estornado e outro dia ficam fora', () => {
  const r = calcularRecebimentos(ENTRADAS, { inicio: DIA, fim: DIA, somenteContas: false });
  assert.equal(r.linhas.length, 8, 'o de ontem nao entra; o desfeito fica na lista');
  assert.equal(r.totalCentavos, 5000 + 30000 + 10000 + 20000 + 100000 + 4000 + 1500);
  assert.equal(r.caixaCentavos, 5000);
  assert.equal(r.semDinheiroCentavos, 104000);
  assert.equal(r.entrouCentavos, 66500);
  assert.equal(r.bancosCentavos, 61500);
  assert.equal(r.estornadoCentavos, 9900);
  assert.deepEqual(r.porForma.map((g) => [g.rotulo, g.quantidade, g.valorCentavos]), [
    ['Acerto com Fornecedor', 1, 100000],
    ['Pix', 2, 40000],
    ['Transferência', 1, 20000],
    ['Dinheiro', 1, 5000],
    ['Crédito de Devolução', 1, 4000],
    ['Outros', 1, 1500],
  ]);
  assert.deepEqual(r.porDestino.map((g) => [g.rotulo, g.valorCentavos]), [
    [DESTINO_ACERTO, 100000],
    ['SICOOB', 40000],
    ['INFINITEPAY', 20000],
    [DESTINO_CAIXA, 5000],
    [DESTINO_CREDITO, 4000],
    [DESTINO_SEM_BANCO, 1500],
  ]);
});

test('so contas recebidas: tira venda e OS recebidas na hora', () => {
  const r = calcularRecebimentos(ENTRADAS, { inicio: DIA, fim: DIA, somenteContas: true });
  assert.deepEqual(r.linhas.map((l) => l.id), ['pix', 'parcial', 'acerto']);
  assert.equal(r.totalCentavos, 140000);
  assert.equal(r.entrouCentavos, 40000);
});

test('documento: abre no dia, com as tres secoes e o indicador do acerto', () => {
  const doc = montarDocumentoDeRecebimentos(ENTRADAS, { inicio: DIA, fim: DIA, somenteContas: false });
  assert.equal(doc.titulo, 'Recebimentos');
  assert.equal(doc.periodo, 'Dia 24/11/2026');
  assert.deepEqual(doc.secoes.map((s) => s.id), ['porForma', 'porDestino', 'recebimentos']);
  const ind = Object.fromEntries(doc.indicadores.map((i) => [i.rotulo, i.valor]));
  assert.match(ind['Recebido no dia'], /1\.705,00/);
  assert.match(ind['Em dinheiro (caixa)'], /50,00/);
  assert.match(ind['Em banco'], /615,00/);
  assert.match(ind['Baixado sem entrar dinheiro (acerto/crédito)'], /1\.040,00/);
  assert.match(ind['Estornado (fora do total)'], /99,00/);
  const lista = doc.secoes[2];
  const valor = lista.colunas.find((c) => c.id === 'valor')!;
  assert.equal(valor.totalCalculado!(lista.linhas), 170500, 'o estornado nao soma');
  assert.equal(lista.colunas.find((c) => c.id === 'data')!.padrao, false, 'num dia so, a coluna de data vem desmarcada');

  const periodo = montarDocumentoDeRecebimentos(ENTRADAS, { inicio: '2026-11-23', fim: DIA, somenteContas: true });
  assert.equal(periodo.titulo, 'Contas Recebidas');
  assert.equal(periodo.periodo, 'Período: 23/11/2026 a 24/11/2026');
  assert.equal(periodo.secoes[2].linhas.length, 3, 'o pix de ontem nao era conta baixada');
});

test('desconto dado na baixa sai do recebido e aparece em coluna propria (25/11/2026, Jomarly)', () => {
  const entradas = [
    t({ id: 'com-desconto', formaPagamento: 'Pix', bancoNome: 'CRESOL', baixaManual: { origem: 'contas_receber', descontoCentavos: 60 }, valorCentavos: 17060, valor: 170.6 }),
    t({ id: 'sem-desconto', formaPagamento: 'Dinheiro', movimentaCaixaFisico: true, baixaManual: { origem: 'contas_receber' }, valorCentavos: 2650, valor: 26.5 }),
  ];
  const r = calcularRecebimentos(entradas, { inicio: DIA, fim: DIA, somenteContas: true });
  const linha = r.linhas.find((l) => l.id === 'com-desconto')!;
  assert.equal(linha.valorContaCentavos, 17060);
  assert.equal(linha.descontoCentavos, 60);
  assert.equal(linha.valorCentavos, 17000);
  assert.equal(r.totalCentavos, 17000 + 2650);
  assert.equal(r.descontoCentavos, 60);
  assert.equal(r.porForma.find((g) => g.rotulo === 'Pix')!.valorCentavos, 17000);

  const doc = montarDocumentoDeRecebimentos(entradas, { inicio: DIA, fim: DIA, somenteContas: true });
  const colunas = (doc.secoes.find((s) => s.id === 'recebimentos')!.colunas as Array<{ id: string; titulo: string; padrao?: boolean }>);
  assert.equal(colunas.find((c) => c.id === 'desconto')!.padrao, true);
  assert.equal(colunas.find((c) => c.id === 'valor')!.titulo, 'Recebido');
  assert.ok(doc.indicadores.some((i) => i.rotulo === 'Descontos dados na baixa' && i.valor.includes('0,60')));
});

test('desconto nunca passa do valor da conta e conta sem desconto fica igual', () => {
  const entradas = [t({ id: 'x', formaPagamento: 'Pix', baixaManual: { descontoCentavos: 999999 }, valorCentavos: 500, valor: 5 })];
  const r = calcularRecebimentos(entradas, { inicio: DIA, fim: DIA, somenteContas: false });
  assert.equal(r.linhas[0].valorCentavos, 0);
  const sem = calcularRecebimentos([t({ id: 'y', formaPagamento: 'Pix', valorCentavos: 500, valor: 5 })], { inicio: DIA, fim: DIA, somenteContas: false });
  assert.equal(sem.linhas[0].valorCentavos, 500);
  assert.equal(sem.descontoCentavos, 0);
});
