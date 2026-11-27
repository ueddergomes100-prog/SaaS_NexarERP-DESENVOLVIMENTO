import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularMovimentacao, montarDocumentoDaMovimentacao, type FontesDaMovimentacao } from '../src/utils/relatorioMovimentacaoDomain';
import type { VendaRelatorio } from '../src/utils/relatorioVendasDomain';
import type { TransacaoRelatorioFinanceiro } from '../src/utils/relatorioFinanceiroDomain';

const venda = (parcial: Partial<VendaRelatorio>): VendaRelatorio => ({
  id: 'v', date: new Date(2026, 10, 28, 10), sellerId: 's', sellerName: 'ANA',
  grossCents: 0, discountCents: 0, saleTotalCents: 0, returnedCents: 0, netCents: 0,
  receivedCents: 0, pendingCents: 0, payments: [], paymentMethods: [], paymentCondition: 'avista',
  cardFeeCents: 0, financialNetCents: 0, commissionCents: 0, commissionStatus: '', cancelled: false, itemsQuantity: 1,
  ...parcial,
});

const titulo = (parcial: Partial<TransacaoRelatorioFinanceiro>): TransacaoRelatorioFinanceiro => ({
  id: 't', tipo: 'entrada', status: 'Paga', data: '2026-11-28', dataPagamento: '2026-11-28', descricao: '', formaPagamento: 'Dinheiro',
  ...parcial,
});

const fontes = (): FontesDaMovimentacao => ({
  vendas: [
    venda({ id: 'v1', netCents: 10000, paymentCondition: 'avista', payments: [{ formaPagamento: 'Dinheiro', valorCentavos: 10000 }] }),
    venda({ id: 'v2', netCents: 30000, paymentCondition: 'aprazo', payments: [{ formaPagamento: 'A prazo', valorCentavos: 30000 }] }),
    venda({ id: 'v3', netCents: 99900, cancelled: true }),
  ],
  entradasPagas: [
    // Venda a vista recebida na hora (dinheiro no caixa).
    titulo({ id: 'e1', pedidoId: 'v1', descricao: 'PDV #1 - Dinheiro', valor: 100, movimentaCaixaFisico: true }),
    // Notinha recebida na Frente de Caixa.
    titulo({ id: 'e2', pedidoId: 'v0', descricao: 'Pedido #9', valor: 50, baixaManual: { em: 'x' }, recebidoNoCaixaId: 'cx1', movimentaCaixaFisico: true, clienteNome: 'JOAO' }),
    // Conta recebida no Financeiro, no banco.
    titulo({ id: 'e3', descricao: 'Pedido #8', formaPagamento: 'Pix', valor: 70, baixaManual: { em: 'x' }, bancoNome: 'SICOOB' }),
    // Fora do periodo.
    titulo({ id: 'e4', descricao: 'Ontem', valor: 999, data: '2026-11-27', dataPagamento: '2026-11-27' }),
  ],
  saidasPagas: [
    titulo({ id: 's1', tipo: 'saida', descricao: 'Luz', formaPagamento: 'Pix', valor: 40, fornecedorNome: 'CEMIG' }),
    // Estorno de venda cancelada: nao e' conta paga.
    titulo({ id: 'estorno_cancelamento_x', tipo: 'saida', descricao: 'Estorno', categoria: 'Cancelamento de Venda', sourceType: 'cancelamento_venda', valor: 20 }),
  ],
  sangrias: [
    { dia: '2026-11-28', hora: '11:00', operadorNome: 'MARIA', motivo: 'Depósito', bancoNome: 'SICOOB', valorCentavos: 5000 },
    { dia: '2026-11-27', hora: '18:00', operadorNome: 'MARIA', motivo: 'Ontem', bancoNome: '', valorCentavos: 900 },
  ],
});

const filtro = { inicio: '2026-11-28', fim: '2026-11-28' };

test('movimentacao: vendido, entrou, saiu e sangrias do periodo', () => {
  const r = calcularMovimentacao(fontes(), filtro);
  assert.equal(r.vendasValidas, 2);
  assert.equal(r.vendidoCentavos, 40000);
  assert.equal(r.vendidoAVistaCentavos, 10000);
  assert.equal(r.vendidoAPrazoCentavos, 30000);

  assert.equal(r.entrouCentavos, 10000 + 5000 + 7000);
  assert.equal(r.caixaCentavos, 15000);
  assert.equal(r.bancosCentavos, 7000);
  assert.equal(r.notinhasCentavos, 12000);
  const origem = Object.fromEntries(r.porOrigem.map((g) => [g.rotulo, g.valorCentavos]));
  assert.deepEqual(origem, {
    'Venda à vista': 10000,
    'Conta recebida no Financeiro': 7000,
    'Notinha recebida na Frente de Caixa': 5000,
  });

  assert.equal(r.pagamentos.length, 1, 'estorno de cancelamento fica fora das contas pagas');
  assert.equal(r.pagamentos[0].favorecido, 'CEMIG');
  assert.equal(r.pagoCentavos, 4000);
  assert.equal(r.sangrias.length, 1);
  assert.equal(r.sangriasCentavos, 5000);
  assert.equal(r.saldoCentavos, 22000 - 4000);
});

test('movimentacao: documento traz os indicadores e as secoes por forma, origem, caixa/banco e sangrias', () => {
  const doc = montarDocumentoDaMovimentacao(fontes(), filtro);
  assert.equal(doc.titulo, 'Movimentação do Período');
  assert.equal(doc.periodo, 'Dia 28/11/2026');
  const indicador = (rotulo: string) => doc.indicadores.find((i) => i.rotulo === rotulo)?.valor.replace(/\s/g, ' ');
  assert.equal(indicador('Vendido no dia (2 vendas)'), 'R$ 400,00');
  assert.equal(indicador('Notinhas recebidas'), 'R$ 120,00');
  assert.equal(indicador('Saldo (entrou menos saiu)'), 'R$ 180,00');
  const ids = doc.secoes.map((s) => s.id);
  for (const id of ['vendasPorCondicao', 'entradasPorOrigem', 'entradasPorForma', 'entradasPorDestino', 'saidasPorForma', 'sangrias', 'entradas', 'pagamentos', 'vendas']) {
    assert.ok(ids.includes(id), `falta a secao ${id}`);
  }
  // Listas de cada lancamento ficam desmarcadas de inicio (o papel sai so' com os totais).
  assert.equal(doc.secoes.find((s) => s.id === 'entradas')?.padrao, false);
});

test('movimentacao: periodo sem nada', () => {
  const r = calcularMovimentacao({ vendas: [], entradasPagas: [], saidasPagas: [], sangrias: [] }, filtro);
  assert.equal(r.vendidoCentavos, 0);
  assert.equal(r.entrouCentavos, 0);
  assert.equal(r.saldoCentavos, 0);
  assert.deepEqual(r.porOrigem, []);
});

test('movimentacao: filtro de forma corta vendas, recebimentos e contas pagas; sangria so com Dinheiro', () => {
  const soPix = calcularMovimentacao(fontes(), { ...filtro, formas: ['Pix'] });
  assert.equal(soPix.vendidoCentavos, 0, 'nenhuma venda em Pix');
  assert.deepEqual(soPix.entradas.map((e) => e.id), ['e3']);
  assert.equal(soPix.entrouCentavos, 7000);
  assert.equal(soPix.caixaCentavos, 0);
  assert.equal(soPix.pagoCentavos, 4000, 'a luz paga em Pix');
  assert.equal(soPix.sangrias.length, 0);

  const soDinheiro = calcularMovimentacao(fontes(), { ...filtro, formas: ['Dinheiro'] });
  assert.equal(soDinheiro.vendidoCentavos, 10000);
  assert.deepEqual(soDinheiro.vendasPorForma.map((f) => f.forma), ['Dinheiro']);
  assert.equal(soDinheiro.entrouCentavos, 15000);
  assert.equal(soDinheiro.sangrias.length, 1);
});

test('movimentacao: turnos do caixa do periodo e a diferenca somada dos fechados', () => {
  const turnos = [
    { id: 'a', dia: '2026-11-28', abertura: '08:00', fechamento: '12:00', operadorNome: 'MARIA', aberto: false, saldoInicialCentavos: 10000, sangriasCentavos: 0, esperadoCentavos: 25000, contadoCentavos: 24500, diferencaCentavos: -500 },
    { id: 'b', dia: '2026-11-28', abertura: '12:05', fechamento: '', operadorNome: 'JOAO', aberto: true, saldoInicialCentavos: 24500, sangriasCentavos: 0, esperadoCentavos: null, contadoCentavos: null, diferencaCentavos: null },
    { id: 'c', dia: '2026-11-27', abertura: '08:00', fechamento: '18:00', operadorNome: 'ANA', aberto: false, saldoInicialCentavos: 0, sangriasCentavos: 0, esperadoCentavos: 0, contadoCentavos: 100, diferencaCentavos: 100 },
  ];
  const r = calcularMovimentacao({ ...fontes(), turnos }, filtro);
  assert.deepEqual(r.turnos.map((t) => t.id), ['a', 'b'], 'so do periodo, na ordem da abertura');
  assert.equal(r.diferencaDosTurnosCentavos, -500);
  const doc = montarDocumentoDaMovimentacao({ ...fontes(), turnos }, filtro);
  assert.ok(doc.secoes.some((s) => s.id === 'turnos'));
  assert.equal(doc.secoes[0].id, 'vendasPorForma', 'o papel comeca pelo vendido por forma');
  assert.equal(doc.indicadores.find((i) => i.rotulo.startsWith('Turnos do caixa'))?.valor.replace(/\s/g, ' '), 'Faltou R$ 5,00');
});
