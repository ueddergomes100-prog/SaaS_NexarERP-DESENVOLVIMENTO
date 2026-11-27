import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  brutoDaLinhaCentavos,
  configFinanceiraDaEmpresa,
  lerPedidoDeFechamento,
  subtotalDaLinha,
  totaisDoFechamento,
} from '../src/utils/vendaFechamentoDomain';
import { vendedorQueGravouAPreVenda } from '../src/utils/vendaFechamentoDomain';

const corpoBase = (extra: Record<string, unknown> = {}) => ({
  idDocumento: 'venda123',
  dataVenda: '2026-10-13',
  vendedorId: 'vend1',
  clienteId: 'cli1',
  clienteNome: 'joão da silva',
  itens: [{ id: 'p1', nome: 'RAÇÃO', precoUnitario: 10, quantidade: 3, desconto: 1, subtotal: 29, codigo: '12' }],
  descontoGeral: { tipo: 'valor', valorInformado: 0 },
  pagamentos: [{ id: 'pg1', forma: 'Dinheiro', valor: '29' }],
  ...extra,
});

test('configuracao financeira le a empresa como a tela de venda le', () => {
  const c = configFinanceiraDaEmpresa({ diasCrediario: '45, 30', maxParcelasCartao: 20, taxaCartaoDebitoPercentual: '1.5', prazoRecebimentoCartaoCreditoDias: '', prazoRecebimentoCartaoDebitoDias: 2 });
  assert.equal(c.defaultTermDays, 30);
  // Teto de 24x desde 27/11/2026 (era 12): 20 vale; acima do teto cai no teto.
  assert.equal(c.maxCreditInstallments, 20);
  assert.equal(configFinanceiraDaEmpresa({ maxParcelasCartao: 30 }).maxCreditInstallments, 24);
  assert.equal(configFinanceiraDaEmpresa({}).maxCreditInstallments, 12);
  assert.equal(c.debitFeePercent, 1.5);
  assert.equal(c.creditSettlementDays, 30);
  assert.equal(c.debitSettlementDays, 2);
  const vazio = configFinanceiraDaEmpresa(null);
  assert.equal(vazio.defaultTermDays, 30);
  assert.equal(vazio.debitSettlementDays, 1);
});

test('subtotal da linha: preco x quantidade - desconto, em centavos, nunca negativo', () => {
  assert.equal(subtotalDaLinha({ precoUnitario: 10.1, quantidade: 3, desconto: 0.3 }), 30);
  assert.equal(subtotalDaLinha({ precoUnitario: 1, quantidade: 1, desconto: 5 }), 0);
});

test('totais: desconto geral sobre o subtotal ja com desconto de item; frete e encargos somam', () => {
  const t = totaisDoFechamento({
    itens: [{ precoUnitario: 10, quantidade: 3, desconto: 1 }, { precoUnitario: 5, quantidade: 2, desconto: 0 }],
    descontoGeralTipo: 'percentual',
    descontoGeralValor: 10,
    frete: 7,
    encargos: 1.5,
  });
  assert.equal(t.valorTotalItens, 40);
  assert.equal(t.valorTotalDescontosItens, 1);
  assert.equal(t.descontoGeralCentavos, 390);
  assert.equal(t.valorTotalCentavos, 4360); // 40 - 1 - 3,90 + 7 + 1,50
  // Desconto em valor maior que a base fica limitado a base.
  const limitado = totaisDoFechamento({ itens: [{ precoUnitario: 10, quantidade: 1, desconto: 0 }], descontoGeralTipo: 'valor', descontoGeralValor: 50, frete: 0, encargos: 0 });
  assert.equal(limitado.descontoGeralCentavos, 1000);
  assert.equal(limitado.valorTotalCentavos, 0);
});

test('corpo valido vira pedido normalizado, com subtotal refeito no servidor', () => {
  const r = lerPedidoDeFechamento(corpoBase({ itens: [{ id: 'p1', nome: 'RAÇÃO', precoUnitario: '10', quantidade: 3, desconto: 1, subtotal: 999 }] }));
  assert.ok('pedido' in r);
  if (!('pedido' in r)) return;
  assert.equal(r.pedido.clienteNome, 'JOÃO DA SILVA');
  assert.equal(r.pedido.itens[0].subtotal, 29, 'subtotal mandado pela tela nao vale');
  assert.equal(r.pedido.itens[0].precoUnitario, 10);
  assert.equal(r.pedido.idDocumento, 'venda123');
  assert.equal(r.pedido.pedidoId, null);
  assert.equal('lotes' in r.pedido.itens[0], false);
  assert.equal(r.pedido.entregaFutura, false);
  assert.equal(r.pedido.previsaoEntrega, '');
  const ef = lerPedidoDeFechamento(corpoBase({ entregaFutura: true, previsaoEntrega: '2026-11-05' }));
  assert.ok('pedido' in ef && ef.pedido.entregaFutura === true && ef.pedido.previsaoEntrega === '2026-11-05');
  const efRuim = lerPedidoDeFechamento(corpoBase({ entregaFutura: 'sim', previsaoEntrega: '05/11/2026' }));
  assert.ok('pedido' in efRuim && efRuim.pedido.entregaFutura === false && efRuim.pedido.previsaoEntrega === '');
});

test('pre-venda: o id do pedido manda, o idDocumento e\' ignorado', () => {
  const r = lerPedidoDeFechamento(corpoBase({ pedidoId: 'pv1' }));
  assert.ok('pedido' in r && r.pedido.pedidoId === 'pv1' && r.pedido.idDocumento === null);
});

test('corpo invalido devolve a primeira coisa errada, em portugues', () => {
  const erro = (extra: Record<string, unknown>) => {
    const r = lerPedidoDeFechamento(corpoBase(extra));
    return 'erro' in r ? r.erro : '';
  };
  assert.match(erro({ idDocumento: '', pedidoId: '' }), /sem identificação/);
  assert.match(erro({ idDocumento: '../x' }), /Venda inválida/);
  assert.match(erro({ dataVenda: '13/10/2026' }), /data da venda/);
  assert.match(erro({ itens: [] }), /pelo menos um item/);
  assert.match(erro({ itens: [{ id: 'p1', nome: 'X', precoUnitario: 10, quantidade: 0 }] }), /X: a quantidade/);
  assert.match(erro({ itens: [{ id: 'p1', nome: 'X', precoUnitario: -1, quantidade: 1 }] }), /X: preço inválido/);
  assert.match(erro({ itens: [{ id: 'p1', nome: 'X', precoUnitario: 10, quantidade: 1, desconto: 11 }] }), /maior que o valor do item/);
  assert.match(erro({ itens: [{ id: 'p1', nome: 'X', precoUnitario: 10, quantidade: 1, lotes: [{ loteId: 'l/1', quantidade: 1 }] }] }), /lote inválido/);
  assert.match(erro({ pagamentos: [] }), /forma de pagamento/);
  assert.match(erro({ frete: -1 }), /Frete inválido/);
  assert.match(erro({ vendedorId: 'a b' }), /Vendedor inválido/);
});

test('lotes do item passam validados', () => {
  const r = lerPedidoDeFechamento(corpoBase({ itens: [{ id: 'p1', nome: 'X', precoUnitario: 10, quantidade: 2, lotes: [{ loteId: 'L1', lote: 'A1', validade: '2027-01-01', quantidade: 2 }] }] }));
  assert.ok('pedido' in r);
  if ('pedido' in r) assert.deepEqual(r.pedido.itens[0].lotes, [{ loteId: 'L1', lote: 'A1', validade: '2027-01-01', quantidade: 2 }]);
});

test('fatia 3c: bruto arredondado por linha, igual ao PDV e a NF-e', () => {
  assert.equal(brutoDaLinhaCentavos({ precoUnitario: 12.9, quantidade: 0.355 }), 458);
  assert.equal(brutoDaLinhaCentavos({ precoUnitario: 1, quantidade: 0.005 }), 1);
  const t = totaisDoFechamento({
    itens: [1, 2, 3].map(() => ({ precoUnitario: 1, quantidade: 0.005, desconto: 0 })),
    descontoGeralTipo: 'valor', descontoGeralValor: 0, frete: 0, encargos: 0,
  });
  assert.equal(t.valorTotalCentavos, 3, 'três linhas de R$ 0,01 dão R$ 0,03 (antes dava R$ 0,02)');
  assert.equal(subtotalDaLinha({ precoUnitario: 12.9, quantidade: 0.355, desconto: 0.08 }), 4.5);
});

test('fatia 3c: o PDV manda a sessão do caixa; com pedidoId é pré-venda faturada no caixa (23/11)', () => {
  const base = { idDocumento: 'v1', dataVenda: '2026-10-19', itens: [{ id: 'p1', nome: 'X', precoUnitario: 1, quantidade: 1 }], pagamentos: [{ forma: 'Dinheiro' }] };
  const ok = lerPedidoDeFechamento({ ...base, pdvSessionId: 'cx_1' });
  assert.ok('pedido' in ok && ok.pedido.pdvSessionId === 'cx_1');
  const semPdv = lerPedidoDeFechamento(base);
  assert.ok('pedido' in semPdv && semPdv.pedido.pdvSessionId === null);
  assert.match(String((lerPedidoDeFechamento({ ...base, pdvSessionId: '../x' }) as { erro: string }).erro), /Caixa do PDV inválido/);
  const preVenda = lerPedidoDeFechamento({ ...base, idDocumento: undefined, pedidoId: 'pv1', pdvSessionId: 'cx_1' });
  assert.ok('pedido' in preVenda && preVenda.pedido.pedidoId === 'pv1' && preVenda.pedido.pdvSessionId === 'cx_1' && preVenda.pedido.idDocumento === null);
});

test('a prazo na Frente de Caixa: so com a caixa da filial e com cliente identificado (25/11/2026, Jomarly)', async () => {
  const { erroDoAPrazoNoCaixa, parseAPrazoNaFrenteDeCaixa, FORMA_A_PRAZO } = await import('../src/utils/vendaFechamentoDomain');
  assert.equal(parseAPrazoNaFrenteDeCaixa(true), true);
  assert.equal(parseAPrazoNaFrenteDeCaixa('true'), false);
  assert.equal(parseAPrazoNaFrenteDeCaixa(undefined), false);
  // sem a prazo: nada a conferir
  assert.equal(erroDoAPrazoNoCaixa(['Dinheiro', 'Pix'], { ativo: false, clienteId: '' }), null);
  // a prazo com a caixa desligada
  assert.match(erroDoAPrazoNoCaixa([FORMA_A_PRAZO], { ativo: false, clienteId: 'c1' }) || '', /Configurações da Filial/);
  // a prazo sem cliente ou com o consumidor final
  assert.match(erroDoAPrazoNoCaixa([FORMA_A_PRAZO], { ativo: true, clienteId: '' }) || '', /cliente identificado/);
  assert.match(erroDoAPrazoNoCaixa([FORMA_A_PRAZO], { ativo: true, clienteId: 'cf', clienteEhPadrao: true }) || '', /F2/);
  assert.equal(erroDoAPrazoNoCaixa(['Dinheiro', FORMA_A_PRAZO], { ativo: true, clienteId: 'c1' }), null);
});

test('forma escolhida pelo vendedor no app: trocar so com permissao; credito e cashback so abatem (25/11/2026)', async () => {
  const { erroDaFormaDoVendedor, formaDoVendedor, CAMPO_FORMA_DO_VENDEDOR } = await import('../src/utils/vendaFechamentoDomain');
  assert.equal(formaDoVendedor({ [CAMPO_FORMA_DO_VENDEDOR]: ' Boleto ' }), 'Boleto');
  assert.equal(formaDoVendedor({}), '');
  assert.equal(formaDoVendedor(null), '');
  const base = { formaDoVendedor: 'Boleto', numeroPedido: '0122' };
  assert.equal(erroDaFormaDoVendedor({ ...base, formasDaVenda: ['Boleto', 'Boleto'], podeTrocar: false }), null);
  assert.equal(erroDaFormaDoVendedor({ ...base, formasDaVenda: ['Boleto', 'Crédito de Devolução', 'Cashback'], podeTrocar: false }), null);
  const erro = erroDaFormaDoVendedor({ ...base, formasDaVenda: ['Pix'], podeTrocar: false });
  assert.match(String(erro), /escolheu "Boleto" na pré-venda #0122/);
  assert.match(String(erro), /Trocar a forma de pagamento escolhida pelo vendedor/);
  assert.equal(erroDaFormaDoVendedor({ ...base, formasDaVenda: ['Pix'], podeTrocar: true }), null, 'com permissao troca');
  assert.equal(erroDaFormaDoVendedor({ formaDoVendedor: '', formasDaVenda: ['Pix'], podeTrocar: false }), null, 'pedido sem forma do vendedor: como antes');
});

test('parcelas do boleto escolhidas no app (26/11/2026): 1 a 12; o resto e nao informado', async () => {
  const { parcelasDoBoleto, MAX_PARCELAS_DO_BOLETO_NO_APP, CAMPO_PARCELAS_DO_BOLETO } = await import('../src/utils/vendaFechamentoDomain');
  assert.equal(CAMPO_PARCELAS_DO_BOLETO, 'parcelasBoleto');
  assert.equal(parcelasDoBoleto(3), 3);
  assert.equal(parcelasDoBoleto('4'), 4);
  assert.equal(parcelasDoBoleto(MAX_PARCELAS_DO_BOLETO_NO_APP), 12);
  for (const invalido of [0, -1, 13, 2.5, 'x', '', null, undefined]) assert.equal(parcelasDoBoleto(invalido), 0, String(invalido));
});

test('pre-venda gravada pelo login do proprio vendedor (app) dispensa a senha no Finalizar', () => {
  assert.equal(vendedorQueGravouAPreVenda({ status: 'Pré-venda', vendedorId: 'v1', criadoPor: 'v1' }), 'v1');
  assert.equal(vendedorQueGravouAPreVenda({ status: 'Pré-venda', vendedorId: 'v1', criadoPor: 'balcao01' }), '');
  assert.equal(vendedorQueGravouAPreVenda({ status: 'Finalizada', vendedorId: 'v1', criadoPor: 'v1' }), '');
  assert.equal(vendedorQueGravouAPreVenda({ status: 'Pré-venda', criadoPor: 'v1' }), '');
  assert.equal(vendedorQueGravouAPreVenda(null), '');
});
