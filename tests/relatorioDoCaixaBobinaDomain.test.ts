import test from 'node:test';
import assert from 'node:assert/strict';
import {
  htmlDoComprovanteDeRecebimento,
  htmlDoRelatorioDoCaixa,
  montarRelatorioDoCaixa,
  numeroDaVendaNoLancamento,
  resultadoNoPapel,
  totalDoComprovante,
  type DadosDoRelatorioDoCaixa,
  type LancamentoDoCaixa,
} from '../src/utils/relatorioDoCaixaBobinaDomain';

const h = (hh: number, mm = 0) => new Date(2026, 10, 26, hh, mm);

const lanc = (parcial: Partial<LancamentoDoCaixa>): LancamentoDoCaixa => ({
  id: 't', pedidoId: 'p', paymentIndex: 0, descricao: 'PDV #1 - Dinheiro', clienteNome: '', formaPagamento: 'Dinheiro',
  valorCentavos: 0, criadoEm: h(9), cancelado: false, dinheiro: false, ...parcial,
});

const base = (parcial: Partial<DadosDoRelatorioDoCaixa> = {}): DadosDoRelatorioDoCaixa => ({
  tipo: 'parcial',
  empresa: { nome: 'LOJA <TESTE>', cnpj: '12.345.678/0001-90' },
  operadorNome: 'MARIA',
  impressoPorNome: 'MARIA',
  abertoEm: h(8),
  emitidoEm: h(11, 41),
  saldoInicialCentavos: 10000,
  lancamentos: [
    lanc({ id: 'a', pedidoId: 'v1', descricao: 'PDV #101 - Dinheiro', valorCentavos: 5000, dinheiro: true, criadoEm: h(9) }),
    lanc({ id: 'b', pedidoId: 'v2', descricao: 'PDV #102 - Pix', formaPagamento: 'Pix', valorCentavos: 3000, criadoEm: h(10) }),
    // Cartao em 2 parcelas: 2 titulos, 1 pagamento.
    lanc({ id: 'c1', pedidoId: 'v3', descricao: 'PDV #103 - Cartão de Crédito (Parcela 1/2)', formaPagamento: 'Cartão de Crédito', valorCentavos: 4000, criadoEm: h(10, 30) }),
    lanc({ id: 'c2', pedidoId: 'v3', descricao: 'PDV #103 - Cartão de Crédito (Parcela 2/2)', formaPagamento: 'Cartão de Crédito', valorCentavos: 4000, criadoEm: h(10, 30) }),
    // A mesma venda paga em dinheiro + pix.
    lanc({ id: 'd1', pedidoId: 'v4', paymentIndex: 0, descricao: 'PDV #104 - Dinheiro', valorCentavos: 1000, dinheiro: true, criadoEm: h(11), clienteNome: 'JOAO' }),
    lanc({ id: 'd2', pedidoId: 'v4', paymentIndex: 1, descricao: 'PDV #104 - Pix', formaPagamento: 'Pix', valorCentavos: 500, criadoEm: h(11) }),
    // Cancelada: fora dos totais.
    lanc({ id: 'e', pedidoId: 'v5', descricao: 'PDV #105 - Dinheiro', valorCentavos: 9900, dinheiro: true, cancelado: true, criadoEm: h(9, 30) }),
  ],
  sangrias: [
    { valorCentavos: 2000, motivo: 'Para depósito', registradoEm: h(11, 10), registradoPorNome: 'MARIA', bancoNome: 'SICOOB' },
    { valorCentavos: 500, motivo: 'Pagamento a fornecedor', registradoEm: h(9, 50), registradoPorNome: 'MARIA', bancoNome: '' },
  ],
  esperado: { saldoEsperadoCentavos: 13500, modo: 'sessao', explicacao: 'Saldo inicial + vendas em dinheiro deste caixa − sangrias.' },
  fechamento: null,
  listarVendas: false,
  ...parcial,
});

test('numero da venda sai da descricao do titulo', () => {
  assert.equal(numeroDaVendaNoLancamento('PDV #1234 - Dinheiro'), '1234');
  assert.equal(numeroDaVendaNoLancamento('Venda Direta #A-12 - Pix'), 'A-12');
  assert.equal(numeroDaVendaNoLancamento('Recebimento avulso'), 'Recebimento avulso');
});

test('parcial: vendas, formas, dinheiro e sangrias; cancelada fora dos totais', () => {
  const r = montarRelatorioDoCaixa(base());
  assert.equal(r.titulo, 'RELATÓRIO PARCIAL DO CAIXA');
  assert.equal(r.vendas, 4);
  assert.equal(r.totalVendidoCentavos, 5000 + 3000 + 8000 + 1500);
  assert.equal(r.canceladas, 1);
  assert.equal(r.totalCanceladoCentavos, 9900);
  assert.deepEqual(r.porForma, [
    { forma: 'Cartão de Crédito', pagamentos: 1, valorCentavos: 8000 },
    { forma: 'Dinheiro', pagamentos: 2, valorCentavos: 6000 },
    { forma: 'Pix', pagamentos: 2, valorCentavos: 3500 },
  ]);
  assert.deepEqual(r.dinheiro, { saldoInicialCentavos: 10000, vendasCentavos: 6000, recebimentosCentavos: 0, suprimentosCentavos: 0, sangriasCentavos: 2500, contaDoCaixaCentavos: 13500 });
  // Sangrias na ordem do horario.
  assert.deepEqual(r.sangrias.map((s) => s.valorCentavos), [500, 2000]);
  // Parcial sem pedir a lista: nao lista cada venda.
  assert.equal(r.listaDeVendas.length, 0);
  assert.equal(r.fechamento, null);
});

test('lista de vendas: agrupa por venda, ordem do horario, cancelada marcada', () => {
  const r = montarRelatorioDoCaixa(base({ listarVendas: true }));
  assert.deepEqual(r.listaDeVendas.map((v) => [v.numero, v.totalCentavos, v.cancelada]), [
    ['101', 5000, false],
    ['105', 9900, true],
    ['102', 3000, false],
    ['103', 8000, false],
    ['104', 1500, false],
  ]);
  assert.equal(r.listaDeVendas[4].formas, 'Dinheiro, Pix');
  assert.equal(r.listaDeVendas[4].clienteNome, 'JOAO');
});

test('fechamento: sempre lista cada venda e leva a conferencia', () => {
  const fechamento = { fechadoEm: h(18), contadoCentavos: 13000, diferencaCentavos: -500, trocoCentavos: 10000, paraCofreCentavos: 3000 };
  const r = montarRelatorioDoCaixa(base({ tipo: 'fechamento', fechamento }));
  assert.equal(r.titulo, 'FECHAMENTO DO CAIXA');
  assert.equal(r.listaDeVendas.length, 5);
  assert.deepEqual(r.fechamento, fechamento);
  const html = htmlDoRelatorioDoCaixa(r);
  assert.match(html, /CONFERÊNCIA/);
  assert.match(html, /Faltou R\$ 5,00/);
  assert.match(html, /Foi para o COFRE/);
  assert.match(html, /Conferido por \(administrador\)/);
  assert.doesNotMatch(html, /continua aberto/);
});

test('papel: escapa o que vem do banco, mostra a gaveta quando o esperado vem dela', () => {
  const parcial = htmlDoRelatorioDoCaixa(montarRelatorioDoCaixa(base()));
  assert.match(parcial, /LOJA &lt;TESTE&gt;/);
  assert.match(parcial, /O caixa continua aberto/);
  assert.match(parcial, /TOTAL VENDIDO R\$<\/span><span>175,00/);
  assert.match(parcial, /Depósito em SICOOB/);
  assert.doesNotMatch(parcial, /Esperado na gaveta/);
  assert.doesNotMatch(parcial, /CONFERÊNCIA/);
  const gaveta = htmlDoRelatorioDoCaixa(montarRelatorioDoCaixa(base({ esperado: { saldoEsperadoCentavos: 25000, modo: 'gaveta', explicacao: 'É o saldo da gaveta.' } })), 58);
  assert.match(gaveta, /Esperado na gaveta<\/span><span>250,00/);
  assert.match(gaveta, /size: 58mm/);
  // Mesmo dia: so' a hora. Caixa aberto num dia e tirado em outro: dia e hora em cada linha.
  assert.match(parcial, />11:10 Para dep/);
  const outroDia = htmlDoRelatorioDoCaixa(montarRelatorioDoCaixa(base({ abertoEm: new Date(2026, 10, 25, 8), listarVendas: true })));
  assert.ok(outroDia.includes('>26/11 11:10 Para dep'));
  assert.ok(outroDia.includes('>26/11 09:00 Nº 101'));
});

test('caixa sem movimento e resultado do papel', () => {
  const r = montarRelatorioDoCaixa(base({ lancamentos: [], sangrias: [], esperado: null }));
  assert.equal(r.vendas, 0);
  assert.equal(r.dinheiro.contaDoCaixaCentavos, 10000);
  const html = htmlDoRelatorioDoCaixa(r);
  assert.match(html, /Nenhuma venda ainda/);
  assert.match(html, /Nenhuma sangria/);
  assert.equal(resultadoNoPapel(0), 'Conferido (sem diferença)');
  assert.equal(resultadoNoPapel(1250), 'Sobrou R$ 12,50');
});

test('notinhas recebidas no caixa: fora das vendas, dentro das formas e do dinheiro', () => {
  const dados = base();
  const r = montarRelatorioDoCaixa({
    ...dados,
    lancamentos: [
      ...dados.lancamentos,
      lanc({ id: 'n1', pedidoId: '', paymentIndex: null, descricao: 'Pedido #90 - Parcela 1/2', clienteNome: 'ANA', valorCentavos: 2500, dinheiro: true, criadoEm: h(10, 45), recebimento: true }),
      lanc({ id: 'n2', pedidoId: '', paymentIndex: null, descricao: 'Pedido #91', clienteNome: 'ANA', formaPagamento: 'Pix', valorCentavos: 1200, criadoEm: h(10, 50), recebimento: true }),
      // Estornada depois: some de tudo.
      lanc({ id: 'n3', pedidoId: '', paymentIndex: null, descricao: 'Pedido #92', clienteNome: 'ANA', valorCentavos: 800, dinheiro: true, cancelado: true, criadoEm: h(10, 55), recebimento: true }),
    ],
  });
  assert.equal(r.vendas, 4, 'notinha nao e venda');
  assert.equal(r.totalVendidoCentavos, 17500);
  assert.equal(r.recebimentos.length, 2);
  assert.equal(r.totalRecebidoCentavos, 3700);
  assert.equal(r.porForma.find((f) => f.forma === 'Pix')?.valorCentavos, 3000 + 500 + 1200);
  assert.equal(r.dinheiro.recebimentosCentavos, 2500);
  assert.equal(r.dinheiro.contaDoCaixaCentavos, 10000 + 6000 + 2500 - 2500);
  const html = htmlDoRelatorioDoCaixa(r);
  assert.match(html, /NOTINHAS RECEBIDAS \(2\)/);
  assert.match(html, /Notinhas recebidas em dinheiro/);
  assert.doesNotMatch(html, /Pedido #92/);
});

test('comprovante de recebimento: total com juros, troco no dinheiro e texto escapado', () => {
  const c = {
    empresa: { nome: 'LOJA <X>', cnpj: '' },
    clienteNome: 'JOSE & FILHOS',
    operadorNome: 'MARIA',
    emitidoEm: h(15),
    forma: 'Dinheiro',
    itens: [
      { descricao: 'Pedido #10', vencimento: '2026-11-01', valorCentavos: 10000, acrescimoCentavos: 350 },
      { descricao: 'Pedido #11', vencimento: '2026-12-01', valorCentavos: 5000, acrescimoCentavos: 0 },
    ],
    entregueCentavos: 20000,
  };
  assert.equal(totalDoComprovante(c), 15350);
  const html = htmlDoComprovanteDeRecebimento(c);
  assert.match(html, /COMPROVANTE DE RECEBIMENTO/);
  assert.match(html, /JOSE &amp; FILHOS/);
  assert.doesNotMatch(html, /<X>/);
  assert.match(html, /01\/11\/2026/);
  assert.match(html, /46,50/, 'troco de 200,00 - 153,50');
  assert.match(html, /DOCUMENTO SEM VALOR FISCAL/);
  const semTroco = htmlDoComprovanteDeRecebimento({ ...c, forma: 'Pix' });
  assert.doesNotMatch(semTroco, /Troco/i);
});

test('comprovante de recebimento: desconto geral abate do total e sai na linha da conta (27/11/2026)', () => {
  const c = {
    empresa: { nome: 'LOJA', cnpj: '' },
    clienteNome: 'JOSE',
    operadorNome: 'MARIA',
    emitidoEm: h(15),
    forma: 'Dinheiro',
    itens: [
      { descricao: 'Pedido #10', vencimento: '2026-11-01', valorCentavos: 10000, acrescimoCentavos: 0, descontoCentavos: 1000 },
      { descricao: 'Pedido #11', vencimento: '2026-12-01', valorCentavos: 5000, acrescimoCentavos: 0 },
    ],
    entregueCentavos: 0,
  };
  assert.equal(totalDoComprovante(c), 14000);
  const html = htmlDoComprovanteDeRecebimento(c);
  assert.match(html, /desconto de 10,00/);
  assert.match(html, /90,00/);
});

test('suprimentos no papel do caixa: somam no dinheiro deste caixa e saem listados', () => {
  const dados = base({ suprimentos: [{ valorCentavos: 3000, motivo: 'Reforço de troco', registradoEm: h(9, 15), registradoPorNome: 'MARIA', bancoNome: '' }] });
  const r = montarRelatorioDoCaixa(dados);
  assert.equal(r.dinheiro.suprimentosCentavos, 3000);
  assert.equal(r.dinheiro.contaDoCaixaCentavos, 10000 + 6000 + 3000 - 2500);
  const html = htmlDoRelatorioDoCaixa(r);
  assert.match(html, /\+ Suprimentos/);
  assert.match(html, /SUPRIMENTOS \(1\)/);
  const sem = montarRelatorioDoCaixa(base());
  assert.equal(sem.dinheiro.suprimentosCentavos, 0);
  assert.doesNotMatch(htmlDoRelatorioDoCaixa(sem), /SUPRIMENTOS/);
});
