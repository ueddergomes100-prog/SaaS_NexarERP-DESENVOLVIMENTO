import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calcularRelatorioFinanceiro,
  dataReferenciaFinanceiro,
  idRelatorioFinanceiro,
  montarDocumentoFinanceiro,
  tituloRelatorioFinanceiro,
  type TransacaoRelatorioFinanceiro,
} from '../src/utils/relatorioFinanceiroDomain';
import { somarColuna } from '../src/utils/relatorioPdfDomain';

const entrada = (extra: Partial<TransacaoRelatorioFinanceiro>): TransacaoRelatorioFinanceiro => ({
  id: Math.random().toString(36).slice(2), tipo: 'entrada', status: 'Paga', descricao: 'VENDA', categoria: 'Venda', valor: 100, ...extra,
});

const recebidos: TransacaoRelatorioFinanceiro[] = [
  entrada({ id: 'r1', valor: 100, dataPagamento: '2026-09-05', data: '2026-08-01', clienteNome: 'Ana', formaPagamento: 'Pix' }),
  entrada({ id: 'r2', valor: 50.25, data: '2026-09-10' }),
  // so' createdAt: 2026-09-15 12:00 em Sao Paulo
  entrada({ id: 'r3', valor: 30, createdAt: { seconds: Date.UTC(2026, 8, 15, 15, 0, 0) / 1000 } }),
  entrada({ id: 'r4', valor: 999, dataPagamento: '2026-10-01' }),
  entrada({ id: 'r5', valor: 10 }),
];

const saidas: TransacaoRelatorioFinanceiro[] = [
  // estorno que casa com r2 -> linha marcada
  { id: 'estorno_cancelamento_r2', tipo: 'saida', status: 'Paga', categoria: 'Cancelamento de Venda', valor: 50.25, dataPagamento: '2026-09-12' },
  // devolucao (nao casa) -> abatimento solto
  { id: 'dev1', tipo: 'saida', status: 'Paga', categoria: 'Devolução de Venda', valor: 20, data: '2026-09-20' },
  // estorno fora do periodo -> ignorado
  { id: 'estorno_cancelamento_r1', tipo: 'saida', status: 'Paga', categoria: 'Cancelamento de OS', valor: 100, dataPagamento: '2026-10-02' },
  // despesa comum -> ignorada
  { id: 'luz', tipo: 'saida', status: 'Paga', categoria: 'Energia', valor: 300, dataPagamento: '2026-09-10' },
];

const filtroRecebidos = { tipo: 'entrada' as const, status: 'Paga' as const, inicio: '2026-09-01', fim: '2026-09-30' };

test('data de referência: Pendente usa vencimento; Paga usa pagamento, vencimento e criação', () => {
  assert.equal(dataReferenciaFinanceiro({ id: 'x', data: '2026-09-01', dataPagamento: '2026-09-09' }, 'Pendente'), '2026-09-01');
  assert.equal(dataReferenciaFinanceiro({ id: 'x', data: '2026-09-01', dataPagamento: '2026-09-09' }, 'Paga'), '2026-09-09');
  assert.equal(dataReferenciaFinanceiro({ id: 'x', data: '2026-09-01' }, 'Paga'), '2026-09-01');
  assert.equal(dataReferenciaFinanceiro(recebidos[2], 'Paga'), '2026-09-15');
  assert.equal(dataReferenciaFinanceiro({ id: 'x' }, 'Paga'), '');
});

test('recebidos: estorno casado marca a linha, devolução abate solta, total = subtotal - estornos', () => {
  const r = calcularRelatorioFinanceiro(recebidos, filtroRecebidos, saidas);
  assert.deepEqual(r.linhas.map((l) => [l.id, l.data, l.estornado]), [
    ['r1', '2026-09-05', false],
    ['r2', '2026-09-10', true],
    ['r3', '2026-09-15', false],
  ]);
  assert.equal(r.subtotalCentavos, 18025);
  assert.equal(r.estornadoListadoCentavos, 5025);
  assert.equal(r.outrosEstornosCentavos, 2000);
  assert.equal(r.totalEstornosCentavos, 7025);
  assert.equal(r.totalCentavos, 11000);
});

test('documento de recebidos: coluna ESTORNADO, total do PDF igual ao da página antiga', () => {
  const doc = montarDocumentoFinanceiro(recebidos, filtroRecebidos, saidas);
  assert.equal(doc.titulo, 'Relatório de Recebimentos (Pagos)');
  assert.equal(doc.periodo, 'Período: 01/09/2026 a 30/09/2026');
  const secao = doc.secoes[0];
  assert.deepEqual(secao.colunas.map((c) => c.titulo), ['Data Pgto', 'Descrição / Origem', 'Situação', 'Categoria', 'Cliente', 'Forma Pgto', 'Valor Líquido']);
  assert.equal(secao.rotuloTotal, 'Total pago/recebido');
  const situacao = secao.colunas.find((c) => c.id === 'estorno')!;
  assert.deepEqual(secao.linhas.map((l) => situacao.valor(l)), ['', 'ESTORNADO', '']);
  const valor = secao.colunas.find((c) => c.id === 'valor')!;
  assert.equal(somarColuna(valor, secao.linhas), 11000);
  assert.deepEqual(doc.indicadores.map((i) => i.rotulo), [
    'Total de registros', 'Subtotal listado', '(-) Estornado (cancelamentos e devoluções)', 'Total pago/recebido',
  ]);
  assert.equal(doc.indicadores[0].valor, '3');
  assert.match(doc.indicadores[1].valor, /180,25/);
  assert.match(doc.indicadores[2].valor, /70,25/);
  assert.match(doc.indicadores[3].valor, /110,00/);
});

test('a pagar pendente: sem estornos, sem Cliente/Forma, vencimento no período', () => {
  const pendentes: TransacaoRelatorioFinanceiro[] = [
    { id: 'p1', tipo: 'saida', status: 'Pendente', descricao: 'ALUGUEL', data: '2026-09-20', valor: 1500 },
    { id: 'p2', tipo: 'saida', status: 'Pendente', descricao: 'LUZ', data: '2026-09-02', dataPagamento: '2026-10-05', valor: 200.1 },
    { id: 'p3', tipo: 'saida', status: 'Pendente', descricao: 'FORA', data: '2026-10-02', valor: 50 },
  ];
  const filtro = { tipo: 'saida' as const, status: 'Pendente' as const, inicio: '2026-09-01', fim: '2026-09-30' };
  // saidas pagas so' contam nos recebidos
  const doc = montarDocumentoFinanceiro(pendentes, filtro, saidas);
  assert.equal(doc.titulo, 'Relatório de Contas a Pagar (Pendentes)');
  const secao = doc.secoes[0];
  assert.deepEqual(secao.colunas.map((c) => c.titulo), ['Vencimento', 'Descrição / Origem', 'Categoria', 'Valor']);
  assert.deepEqual(secao.linhas.map((l: any) => l.id), ['p2', 'p1']);
  assert.equal(secao.rotuloTotal, 'Total em aberto');
  assert.equal(somarColuna(secao.colunas.find((c) => c.id === 'valor')!, secao.linhas), 170010);
  assert.deepEqual(doc.indicadores.map((i) => i.rotulo), ['Total de registros', 'Total em aberto']);
});

test('títulos e chaves dos 4 relatórios', () => {
  assert.equal(tituloRelatorioFinanceiro('entrada', 'Pendente'), 'Relatório de Débitos de Clientes (A Receber)');
  assert.equal(tituloRelatorioFinanceiro('saida', 'Paga'), 'Relatório de Pagamentos (Despesas Pagas)');
  assert.deepEqual(
    [idRelatorioFinanceiro('entrada', 'Pendente'), idRelatorioFinanceiro('entrada', 'Paga'), idRelatorioFinanceiro('saida', 'Pendente'), idRelatorioFinanceiro('saida', 'Paga')],
    ['financeiro-a-receber', 'financeiro-recebidos', 'financeiro-a-pagar', 'financeiro-pagos'],
  );
});
