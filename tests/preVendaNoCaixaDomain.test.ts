import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  carregarPreVendaNoCaixa,
  corpoDoFaturamentoNoCaixa,
  descontoDaPreVendaParaOLimite,
  filtrarPreVendasDoCaixa,
  linhasDoCupomDaPreVenda,
  motivoParaNaoFaturarNoCaixa,
  podeFaturarPreVendaNoCaixa,
  preVendasDoCaixa,
  reprecificarPreVenda,
  totaisDaPreVenda,
  type PreVendaCarregada,
} from '../src/utils/preVendaNoCaixaDomain';
import { lerPedidoDeFechamento } from '../src/utils/vendaFechamentoDomain';

/*
 * Pre-venda faturada na Frente de Caixa (23/11/2026): o caixa lista, puxa,
 * recebe e fatura sobre a propria pre-venda -- e o vendedor continua o dela.
 */

// Pre-venda como o Pedido de Venda grava: vendedor BRUNO, cliente cadastrado, atacado num item.
const gravada = (extra: Record<string, unknown> = {}) => ({
  tenantId: 'loja',
  status: 'Pré-venda',
  origem: 'balcao',
  numeroPedido: '0154',
  clienteId: 'cli1',
  clienteNome: 'Padaria São José',
  vendedorId: 'vend_bruno',
  vendedorNome: 'BRUNO',
  usuarioResponsavelId: 'vend_bruno',
  dataVenda: '2026-11-21',
  observacao: 'entregar de manhã',
  estoqueReservado: true,
  statusConferencia: 'conferido',
  itens: [
    {
      id: 'p1', nome: 'SACOLA 30X40', codigo: '101', precoUnitario: 9, quantidade: 10, desconto: 5, subtotal: 85,
      unidadeMedidaSigla: 'PCT', unidadeMedidaCasasDecimais: 0, origemPreco: 'atacado',
      tabelaPreco: { venda: 10, vista: 9.5, atacado: [{ aPartirDe: 10, ate: null, preco: 9 }] },
    },
    {
      id: 'p2', nome: 'FITA ADESIVA', codigo: '202', precoUnitario: 4, quantidade: 3, desconto: 0, subtotal: 12,
      origemPreco: 'venda', tabelaPreco: { venda: 4, vista: 3.5 },
    },
  ],
  descontoGeral: { tipo: 'valor', valorInformado: 2, valorAplicadoCentavos: 200 },
  frete: 10,
  encargos: 0,
  valorTotal: 105,
  valorTotalCentavos: 10500,
  comNotaFiscal: true,
  ...extra,
});

const carregada = (extra: Record<string, unknown> = {}): PreVendaCarregada => {
  const r = carregarPreVendaNoCaixa('pv1', gravada(extra));
  assert.ok('preVenda' in r, 'erro' in r ? r.erro : '');
  return (r as { preVenda: PreVendaCarregada }).preVenda;
};

test('a opcao so\' aparece para a empresa com pre-venda e para quem pode transformar pre-venda em venda', () => {
  const caixa = { trabalhaComPreVenda: true, role: 'Funcionario', isOwner: false };
  assert.equal(podeFaturarPreVendaNoCaixa({ ...caixa, permissoes: ['vendas.so_caixa', 'vendas.pre_venda_finalizar'] }), true);
  assert.equal(podeFaturarPreVendaNoCaixa({ ...caixa, permissoes: ['vendas.so_caixa'] }), false, 'so\' operar o caixa nao basta');
  assert.equal(podeFaturarPreVendaNoCaixa({ ...caixa, permissoes: null }), false);
  assert.equal(podeFaturarPreVendaNoCaixa({ ...caixa, isOwner: true, permissoes: [] }), true, 'dono sempre');
  assert.equal(
    podeFaturarPreVendaNoCaixa({ ...caixa, trabalhaComPreVenda: false, permissoes: ['vendas.pre_venda_finalizar'] }),
    false,
    'empresa que nao trabalha com pre-venda nao ve a opcao',
  );
});

test('lista do caixa: so\' pre-venda do balcao, com numero, cliente, vendedor, valor e data; da mais nova para a mais antiga', () => {
  const linhas = preVendasDoCaixa([
    { id: 'a', ...gravada() },
    { id: 'b', ...gravada({ numeroPedido: '0160', status: 'Em Análise', origem: 'agente' }) },
    { id: 'c', ...gravada({ numeroPedido: '0161', clienteNome: 'MARIA', vendedorNome: '', vendedorId: 'vend_ana', valorTotalCentavos: 2000 }) },
    { id: 'd', ...gravada({ numeroPedido: '0162', tipoPedido: 'bonificacao' }) },
    { id: 'e', ...gravada({ numeroPedido: '0163', status: 'Finalizada' }) },
    { id: 'f', ...gravada({ numeroPedido: '0159', entregaFutura: true }) },
  ], { vend_ana: 'ANA' });

  assert.deepEqual(linhas.map((l) => l.numeroPedido), ['0161', '0159', '0154'], 'agente, bonificacao e faturada ficam fora');
  const [maria, futura, padaria] = linhas;
  assert.equal(maria.vendedorNome, 'ANA', 'pre-venda antiga sem o nome gravado acha o vendedor pelo cadastro');
  assert.equal(maria.totalCents, 2000);
  assert.equal(padaria.clienteNome, 'Padaria São José');
  assert.equal(padaria.vendedorNome, 'BRUNO');
  assert.equal(padaria.totalCents, 10500);
  assert.equal(padaria.itensCount, 2);
  assert.equal(padaria.data?.toISOString().slice(0, 10), '2026-11-21');
  assert.equal(padaria.soNoSistema, null);
  assert.match(String(futura.soNoSistema), /entrega futura.*Pré-vendas em Aberto/, 'aparece, mas diz por que nao puxa');
});

test('busca do caixa: pelo numero (com #, sem os zeros) ou pelo cliente, sem acento', () => {
  const linhas = preVendasDoCaixa([
    { id: 'a', ...gravada() },
    { id: 'c', ...gravada({ numeroPedido: '0161', clienteNome: 'MARIA 154 LTDA' }) },
    { id: 'g', ...gravada({ numeroPedido: '1540', clienteNome: 'JOÃO' }) },
  ]);
  const ids = (busca: string) => filtrarPreVendasDoCaixa(linhas, busca).map((l) => l.id).sort();
  assert.deepEqual(ids(''), ['a', 'c', 'g']);
  assert.deepEqual(ids('#'), ['a', 'c', 'g'], '# lista tudo');
  assert.deepEqual(ids('0161'), ['c']);
  assert.deepEqual(ids('#161'), ['c']);
  assert.deepEqual(ids('154'), ['a', 'c', 'g'], 'numero 0154, numero 1540 e o cliente com 154 no nome');
  assert.deepEqual(ids('sao jose'), ['a']);
  assert.deepEqual(ids('PADARIA'), ['a']);
  assert.deepEqual(ids('joao'), ['g']);
  assert.deepEqual(ids('bruno'), [], 'a busca do caixa e\' por numero ou cliente');
});

test('puxar a pre-venda: itens, cliente, descontos, frete e O VENDEDOR QUE GRAVOU', () => {
  const pv = carregada();
  assert.equal(pv.id, 'pv1');
  assert.equal(pv.numeroPedido, '0154');
  assert.equal(pv.vendedorId, 'vend_bruno');
  assert.equal(pv.vendedorNome, 'BRUNO');
  assert.equal(pv.clienteId, 'cli1');
  assert.equal(pv.clienteNome, 'PADARIA SÃO JOSÉ');
  assert.equal(pv.dataDaPreVenda, '2026-11-21');
  assert.equal(pv.estoqueReservado, true);
  assert.equal(pv.statusConferencia, 'conferido');
  assert.equal(pv.comNotaFiscal, true);
  assert.deepEqual(pv.descontoGeral, { tipo: 'valor', valorInformado: 2 });
  assert.equal(pv.frete, 10);
  assert.equal(pv.itens.length, 2);
  assert.equal(pv.itens[0].precoUnitario, 9, 'preco de atacado da pre-venda');
  assert.equal(pv.itens[0].origemPreco, 'atacado');
  assert.equal(pv.itens[0].desconto, 5);
  assert.equal(pv.itens[0].codigo, '101', 'os outros campos da linha ficam intactos');
  assert.deepEqual(pv.itens[0].tabelaPreco, { venda: 10, vista: 9.5, atacado: [{ aPartirDe: 10, ate: null, preco: 9 }] });
});

test('puxar a pre-venda: sem vendedorId vale quem gravou; sem nenhum dos dois, trava dizendo o que fazer', () => {
  const semVendedorId = carregada({ vendedorId: '', vendedorNome: '' });
  assert.equal(semVendedorId.vendedorId, 'vend_bruno', 'cai em usuarioResponsavelId');
  const comNomeDoCadastro = carregarPreVendaNoCaixa('pv1', gravada({ vendedorId: '', vendedorNome: '' }), { vend_bruno: 'BRUNO SILVA' });
  assert.equal('preVenda' in comNomeDoCadastro && comNomeDoCadastro.preVenda.vendedorNome, 'BRUNO SILVA');

  const semNinguem = carregarPreVendaNoCaixa('pv1', gravada({ vendedorId: '', usuarioResponsavelId: '' }));
  assert.ok('erro' in semNinguem);
  assert.match((semNinguem as { erro: string }).erro, /sem vendedor.*escolha o vendedor e grave de novo/);
});

test('o que nao e\' do caixa nao e\' puxado, com mensagem em portugues e o que fazer', () => {
  assert.equal(motivoParaNaoFaturarNoCaixa(gravada()), null);
  assert.match(String(motivoParaNaoFaturarNoCaixa(null)), /não existe mais/);
  assert.match(String(motivoParaNaoFaturarNoCaixa(gravada({ status: 'Finalizada' }))), /não está mais em aberto/);
  assert.match(String(motivoParaNaoFaturarNoCaixa(gravada({ status: 'Em Análise' }))), /não está mais em aberto/);
  assert.match(String(motivoParaNaoFaturarNoCaixa(gravada({ tipoPedido: 'bonificacao' }))), /bonificação/);
  assert.match(String(motivoParaNaoFaturarNoCaixa(gravada({ entregaFutura: true }))), /entrega futura/);
  assert.match(String(motivoParaNaoFaturarNoCaixa(gravada({ itens: [] }))), /sem itens/);
  assert.match(
    String(motivoParaNaoFaturarNoCaixa(gravada({ itens: [{ id: 'p1', nome: 'BRINDE', precoUnitario: 0, quantidade: 1, bonificado: true }] }))),
    /item bonificado.*grave de novo/,
  );
});

test('totais do caixa = a conta do servidor: desconto do item, desconto geral e frete da pre-venda', () => {
  const t = totaisDaPreVenda(carregada());
  assert.equal(t.subtotalCentavos, 10200, '10 x 9,00 + 3 x 4,00');
  assert.equal(t.itensDescontoCentavos, 500);
  assert.equal(t.vendaDescontoCentavos, 200);
  assert.equal(t.descontoTotalCentavos, 700);
  assert.equal(t.acrescimosCentavos, 1000);
  assert.equal(t.totalCentavos, 10500, '102,00 - 7,00 + 10,00 de frete');
  assert.equal(t.itemCount, 2);
  assert.equal(t.volumeCount, 13);

  const percentual = totaisDaPreVenda(carregada({ descontoGeral: { tipo: 'percentual', valorInformado: 10 }, frete: 0 }));
  assert.equal(percentual.vendaDescontoCentavos, 970, '10% sobre 97,00 (ja\' sem o desconto do item)');
  assert.equal(percentual.totalCentavos, 8730);
});

test('cupom do caixa: uma linha por item da pre-venda, com a foto e o codigo do cadastro', () => {
  const linhas = linhasDoCupomDaPreVenda(carregada().itens, { p1: { codigo: '101', imagemProduto: 'foto.png', quantidade: 40, categoria: 'SACOLAS' } });
  assert.equal(linhas.length, 2);
  assert.deepEqual(linhas.map((l) => l.id), ['pre-venda:0', 'pre-venda:1']);
  assert.equal(linhas[0].productId, 'p1');
  assert.equal(linhas[0].precoUnitarioCentavos, 900);
  assert.equal(linhas[0].descontoCentavos, 500);
  assert.equal(linhas[0].quantidade, 10);
  assert.equal(linhas[0].unidadeMedidaSigla, 'PCT');
  assert.equal(linhas[0].imagemProduto, 'foto.png');
  assert.equal(linhas[0].estoqueDisponivel, 40);
  assert.equal(linhas[1].unidadeMedidaSigla, 'UN', 'item sem unidade mostra a padrao');
  assert.equal(linhas[1].imagemProduto, '', 'produto fora do catalogo do caixa nao quebra o cupom');

  const mesmoProdutoDuasVezes = linhasDoCupomDaPreVenda([...carregada().itens, carregada().itens[0]]);
  assert.equal(new Set(mesmoProdutoDuasVezes.map((l) => l.id)).size, 3, 'o mesmo produto em duas linhas nao repete o id');
});

test('preco acompanha a forma de pagamento: a vista troca o preco automatico; atacado e preco digitado ficam', () => {
  const pv = carregada({
    itens: [
      ...gravada().itens as object[],
      { id: 'p3', nome: 'BOBINA', precoUnitario: 50, quantidade: 1, desconto: 0, subtotal: 50, origemPreco: 'manual', tabelaPreco: { venda: 60, vista: 55 } },
    ],
  });
  const aVista = reprecificarPreVenda(pv.itens, 'vista');
  assert.equal(aVista.alterados, 1, 'so\' a fita muda');
  assert.equal(aVista.diferencaCentavos, -150, '3 x (3,50 - 4,00)');
  assert.equal(aVista.itens[0].precoUnitario, 9, 'atacado (9,00) continua menor que o a vista (9,50)');
  assert.equal(aVista.itens[1].precoUnitario, 3.5);
  assert.equal(aVista.itens[1].origemPreco, 'vista');
  assert.equal(aVista.itens[1].subtotal, 10.5);
  assert.equal(aVista.itens[2].precoUnitario, 50, 'preco digitado pelo vendedor nao muda');

  const aPrazo = reprecificarPreVenda(pv.itens, 'prazo');
  assert.equal(aPrazo.alterados, 0, 'a pre-venda nasce no preco a prazo: nada muda');
  assert.deepEqual(aPrazo.itens, pv.itens);
});

test('preco acompanha a forma de pagamento: promocao so\' a vista sai (e leva a marca) quando o caixa recebe a prazo', () => {
  const tabela = { venda: 10, vista: 0, promocao: { id: 'promo1', nome: 'SEMANA DA SACOLA', preco: 8, soAVista: true } };
  const itens = carregada({
    itens: [{ id: 'p1', nome: 'SACOLA', precoUnitario: 8, quantidade: 2, desconto: 0, subtotal: 16, origemPreco: 'promocao', promocaoId: 'promo1', promocaoNome: 'SEMANA DA SACOLA', tabelaPreco: tabela }],
  }).itens;
  const aPrazo = reprecificarPreVenda(itens, 'prazo');
  assert.equal(aPrazo.alterados, 1);
  assert.equal(aPrazo.diferencaCentavos, 400);
  assert.equal(aPrazo.itens[0].precoUnitario, 10);
  assert.equal(aPrazo.itens[0].promocaoId, undefined);
  assert.equal('promocaoId' in aPrazo.itens[0], false, 'a chave some: nunca vai undefined para o banco');
  const deVolta = reprecificarPreVenda(aPrazo.itens, 'vista');
  assert.equal(deVolta.itens[0].precoUnitario, 8);
  assert.equal(deVolta.itens[0].promocaoId, 'promo1');
});

test('desconto para o limite: descontos da pre-venda + o que o item esta\' abaixo do preco do sistema', () => {
  const pv = carregada({ frete: 0 });
  const produtos = {
    p1: { precoVenda: 10, precoAVista: 9.5, atacado: { ativo: true, faixas: [{ quantidadeInicial: 10, ilimitado: true, preco: 9 }] } },
    p2: { precoVenda: 5, precoAVista: 0 },
  };
  const r = descontoDaPreVendaParaOLimite({ preVenda: pv, produtos, promocoes: [], hoje: '2026-11-23', condicao: 'prazo' });
  // A fita subiu para 5,00 depois da pre-venda: 3 x 1,00 contam como desconto. A sacola esta' no atacado (9,00): nao conta.
  assert.equal(r.baseCentavos, 10200 + 300);
  assert.equal(r.descontoCentavos, 700 + 300);

  const semCadastro = descontoDaPreVendaParaOLimite({ preVenda: pv, produtos: {}, promocoes: [], hoje: '2026-11-23', condicao: 'prazo' });
  assert.deepEqual(semCadastro, { baseCentavos: 10200, descontoCentavos: 700 });
});

test('o que vai para o servidor: fatura sobre a pre-venda, no caixa aberto, COM O VENDEDOR DA PRE-VENDA', () => {
  const pv = carregada();
  const pagamentos = [{ id: 'pg1', forma: 'Dinheiro', valor: '105.00', parcelas: '1' }];
  const corpo = corpoDoFaturamentoNoCaixa({
    preVenda: pv,
    pdvSessionId: 'cx1',
    dataVenda: '2026-11-23',
    pagamentos,
    observacao: '  entregar de manhã  ',
    lotesDoItem: (indice) => (indice === 0 ? { lotes: [{ loteId: 'L1', lote: 'A1', validade: null, quantidade: 10 }] } : {}),
  });

  assert.equal(corpo.pedidoId, 'pv1', 'nao cria pedido novo');
  assert.equal('idDocumento' in corpo, false);
  assert.equal(corpo.pdvSessionId, 'cx1');
  assert.equal(corpo.vendedorId, 'vend_bruno', 'nunca o operador do caixa');
  assert.equal(corpo.dataVenda, '2026-11-23', 'vale o dia do faturamento');
  assert.equal(corpo.clienteId, 'cli1');
  assert.equal(corpo.clienteNome, 'PADARIA SÃO JOSÉ');
  assert.equal(corpo.observacao, 'entregar de manhã');
  assert.equal(corpo.frete, 10);
  assert.equal(corpo.comNotaFiscal, true);
  assert.deepEqual(corpo.descontoGeral, { tipo: 'valor', valorInformado: 2, excedeuLimite: false });
  assert.deepEqual(corpo.pagamentos, pagamentos);
  const itens = corpo.itens as Array<Record<string, unknown>>;
  assert.equal(itens.length, 2);
  assert.equal(itens[0].precoUnitario, 9);
  assert.equal(itens[0].origemPreco, 'atacado');
  assert.deepEqual(itens[0].lotes, [{ loteId: 'L1', lote: 'A1', validade: null, quantidade: 10 }]);
  assert.equal('lotes' in itens[1], false);
  assert.equal(JSON.stringify(corpo).includes('undefined'), false);

  // O servidor aceita o corpo e enxerga a pre-venda, o caixa e o vendedor dela.
  const lido = lerPedidoDeFechamento(JSON.parse(JSON.stringify(corpo)));
  assert.ok('pedido' in lido, 'erro' in lido ? lido.erro : '');
  if ('pedido' in lido) {
    assert.equal(lido.pedido.pedidoId, 'pv1');
    assert.equal(lido.pedido.pdvSessionId, 'cx1');
    assert.equal(lido.pedido.vendedorId, 'vend_bruno');
    assert.equal(lido.pedido.itens[0].subtotal, 85);
  }
});

test('o que vai para o servidor: liberacao so\' quando o desconto passou do limite; sem nota e transporte seguem a pre-venda', () => {
  const pv = carregada({ comNotaFiscal: undefined, transporte: { modalidade: '9' }, orcamentoId: 'orc1' });
  const base = { preVenda: pv, pdvSessionId: 'cx1', dataVenda: '2026-11-23', pagamentos: [{ forma: 'Pix' }], observacao: '' };

  const semExcesso = corpoDoFaturamentoNoCaixa({ ...base, aprovacao: { comprovanteId: 'c1' } });
  assert.deepEqual(semExcesso.descontoGeral, { tipo: 'valor', valorInformado: 2, excedeuLimite: false }, 'aprovacao sem excesso nao vai');
  assert.equal('comNotaFiscal' in semExcesso, false, 'nao informado na pre-venda: o servidor mantem o gravado');
  assert.deepEqual(semExcesso.transporte, { modalidade: '9' });
  assert.equal(semExcesso.orcamentoId, 'orc1');

  const comLiberacao = corpoDoFaturamentoNoCaixa({ ...base, excedeuLimite: true, aprovacao: { comprovanteId: 'c1' } });
  assert.deepEqual(comLiberacao.descontoGeral, { tipo: 'valor', valorInformado: 2, excedeuLimite: true, aprovacao: { comprovanteId: 'c1' } });
});
