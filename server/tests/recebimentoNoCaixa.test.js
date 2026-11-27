const test = require('node:test');
const assert = require('node:assert/strict');

const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

/*
 * Receber notinha na Frente de Caixa (28/11/2026): a permissao propria, o caixa
 * aberto do proprio operador, o que pode ser recebido e a marca do caixa no
 * titulo (o fechamento e os relatorios do caixa contam por ela).
 */

const PERMISSAO = 'vendas.pdv_receber_contas';
const OPERADOR = { uid: 'op1', email: 'op1@teste', tenantId: 'emp1', permissoes: [PERMISSAO] };
const SEM_PERMISSAO = { ...OPERADOR, permissoes: ['vendas.pedidos'] };
const FUTURO = '2099-12-31';

const pendente = (extra) => ({
  tenantId: 'emp1', tipo: 'entrada', status: 'Pendente', clienteId: 'c1', clienteNome: 'JOAO',
  descricao: 'Pedido #10', valor: 50, valorCentavos: 5000, formaPagamento: 'Pagamento a Prazo',
  data: FUTURO, dataVencimento: FUTURO, ...extra,
});

const montar = () => {
  const fake = criarBancoFalso({
    'caixas_pdv/cx1': { tenantId: 'emp1', status: 'aberto', operadorId: 'op1' },
    'caixas_pdv/cx2': { tenantId: 'emp1', status: 'fechado', operadorId: 'op1' },
    'caixas_pdv/cx3': { tenantId: 'emp1', status: 'aberto', operadorId: 'outro' },
    'transacoes/r1': pendente({ descricao: 'Pedido #10' }),
    'transacoes/r2': pendente({ descricao: 'Pedido #11', valor: 30, valorCentavos: 3000 }),
    'transacoes/cheque': pendente({ formaPagamento: 'Cheque' }),
    'transacoes/cartao': pendente({ formaPagamento: 'Cartão de Crédito' }),
    'transacoes/boletoEmitido': pendente({ formaPagamento: 'Boleto', boleto: { nossoNumero: '123', status: 'registrado' } }),
    'transacoes/boletoCancelado': pendente({ formaPagamento: 'Boleto', boleto: { nossoNumero: '124', status: 'cancelado' } }),
    'transacoes/outroCliente': pendente({ clienteId: 'c2' }),
    'transacoes/paga': { ...pendente({}), status: 'Paga' },
    'transacoes/outraEmpresa': pendente({ tenantId: 'emp2' }),
    'bancos/b1': { tenantId: 'emp1', nome: 'Itaú', ativo: true, saldoCentavos: 0 },
  }, { consultas: true });
  const [, , , servico] = carregarComBancoFalso(fake.db, 'services/recebimentoNoCaixa');
  return { fake, s: servico };
};

test('caixa: sem a permissao propria nao lista nem recebe', async () => {
  const { s } = montar();
  await assert.rejects(s.listarAbertasDoCliente({ user: SEM_PERMISSAO, tenantId: 'emp1', corpo: { clienteId: 'c1' } }), (e) => e.status === 403 && /Frente de Caixa/.test(e.message));
  await assert.rejects(s.receberNoCaixa({ user: SEM_PERMISSAO, tenantId: 'emp1', corpo: { sessaoId: 'cx1', formaPagamento: 'Dinheiro', titulos: [{ transacaoId: 'r1' }] } }), (e) => e.status === 403);
});

test('caixa: lista so\' as contas em aberto do cliente que o caixa pode receber', async () => {
  const { s } = montar();
  const contas = await s.listarAbertasDoCliente({ user: OPERADOR, tenantId: 'emp1', corpo: { clienteId: 'c1' } });
  assert.deepEqual(contas.map((c) => c.transacaoId).sort(), ['boletoCancelado', 'r1', 'r2']);
  const r1 = contas.find((c) => c.transacaoId === 'r1');
  assert.equal(r1.valorCentavos, 5000);
  assert.equal(r1.totalCentavos, 5000, 'sem atraso, sem juros');
});

test('caixa: recebe em dinheiro, quita a conta e grava em qual caixa entrou', async () => {
  const { fake, s } = montar();
  const r = await s.receberNoCaixa({
    user: OPERADOR, tenantId: 'emp1',
    corpo: { sessaoId: 'cx1', formaPagamento: 'Dinheiro', titulos: [{ transacaoId: 'r1' }, { transacaoId: 'r2' }] },
  });
  assert.deepEqual(r.resultados.map((x) => x.ok), [true, true]);
  const titulo = fake.ler('transacoes/r1');
  assert.equal(titulo.status, 'Paga');
  assert.equal(titulo.formaPagamento, 'Dinheiro');
  assert.equal(titulo.recebidoNoCaixaId, 'cx1');
  assert.equal(fake.ler('transacoes/r2').recebidoNoCaixaId, 'cx1');
  assert.equal(fake.ler('transacoes/r1').baixaManual?.descontoCentavos ?? 0, 0, 'sem desconto marcado, a conta sai cheia');
});

test('caixa: conta que nao pode ser recebida falha sozinha, sem desfazer as outras', async () => {
  const { fake, s } = montar();
  const r = await s.receberNoCaixa({
    user: OPERADOR, tenantId: 'emp1',
    corpo: { sessaoId: 'cx1', formaPagamento: 'Dinheiro', titulos: [{ transacaoId: 'r1' }, { transacaoId: 'paga' }, { transacaoId: 'outraEmpresa' }] },
  });
  assert.deepEqual(r.resultados.map((x) => x.ok), [true, false, false]);
  r.resultados.filter((x) => !x.ok).forEach((x) => assert.ok(x.erro && !/undefined|TypeError/.test(x.erro), x.erro));
  assert.equal(fake.ler('transacoes/r1').status, 'Paga');
  assert.equal(fake.ler('transacoes/outraEmpresa').status, 'Pendente');
});

test('caixa: fechado, de outro operador, forma invalida ou sem conta marcada sao recusados', async () => {
  const { fake, s } = montar();
  const receber = (corpo) => s.receberNoCaixa({ user: OPERADOR, tenantId: 'emp1', corpo: { formaPagamento: 'Dinheiro', titulos: [{ transacaoId: 'r1' }], ...corpo } });
  await assert.rejects(receber({ sessaoId: 'cx2' }), /já foi fechado/);
  await assert.rejects(receber({ sessaoId: 'cx3' }), /outro operador/);
  await assert.rejects(receber({ sessaoId: 'naoExiste' }), /não foi encontrado/);
  await assert.rejects(receber({ sessaoId: 'cx1', formaPagamento: 'Boleto' }), /dinheiro, Pix ou cartão/);
  await assert.rejects(receber({ sessaoId: 'cx1', titulos: [] }), /Marque pelo menos uma conta/);
  assert.equal(fake.ler('transacoes/r1').status, 'Pendente');
});

test('caixa: Pix exige o banco; com banco, credita o banco', async () => {
  const { fake, s } = montar();
  const semBanco = await s.receberNoCaixa({ user: OPERADOR, tenantId: 'emp1', corpo: { sessaoId: 'cx1', formaPagamento: 'Pix', titulos: [{ transacaoId: 'r1' }] } });
  assert.equal(semBanco.resultados[0].ok, false);
  assert.match(semBanco.resultados[0].erro, /banco/);
  const comBanco = await s.receberNoCaixa({ user: OPERADOR, tenantId: 'emp1', corpo: { sessaoId: 'cx1', formaPagamento: 'Pix', bancoId: 'b1', titulos: [{ transacaoId: 'r1' }] } });
  assert.equal(comBanco.resultados[0].ok, true);
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 5000);
});

test('caixa: estorno da notinha tira a marca do caixa', async () => {
  const { fake, s } = montar();
  await s.receberNoCaixa({ user: OPERADOR, tenantId: 'emp1', corpo: { sessaoId: 'cx1', formaPagamento: 'Dinheiro', titulos: [{ transacaoId: 'r1' }] } });
  const [baixa] = carregarComBancoFalso(fake.db);
  const estorno = baixa.validarPedidoDeEstorno({ tipo: 'entrada', transacaoId: 'r1', motivo: 'recebido no cliente errado' }).pedido;
  await baixa.registrarEstorno({ user: { ...OPERADOR, dono: true }, tenantId: 'emp1', pedido: estorno });
  const voltou = fake.ler('transacoes/r1');
  assert.equal(voltou.status, 'Pendente');
  assert.equal(voltou.recebidoNoCaixaId, undefined);
});

test('caixa: boleto emitido no banco nao e recebido no caixa, mesmo se o navegador mandar', async () => {
  const { fake, s } = montar();
  const r = await s.receberNoCaixa({ user: OPERADOR, tenantId: 'emp1', corpo: { sessaoId: 'cx1', formaPagamento: 'Dinheiro', titulos: [{ transacaoId: 'boletoEmitido' }] } });
  assert.equal(r.resultados[0].ok, false);
  assert.match(r.resultados[0].erro, /boleto emitido/);
  assert.equal(fake.ler('transacoes/boletoEmitido').status, 'Pendente');
});

test('caixa: desconto geral (27/11/2026) abate da conta com a permissao de desconto na baixa', async () => {
  const { fake, s } = montar();
  const r = await s.receberNoCaixa({
    user: { ...OPERADOR, permissoes: [PERMISSAO, 'financeiro.desconto_baixa'] }, tenantId: 'emp1',
    corpo: { sessaoId: 'cx1', formaPagamento: 'Dinheiro', titulos: [{ transacaoId: 'r1', descontoCentavos: 500 }, { transacaoId: 'r2', descontoCentavos: 300 }] },
  });
  assert.deepEqual(r.resultados.map((x) => x.ok), [true, true]);
  assert.deepEqual(r.resultados.map((x) => x.descontoCentavos), [500, 300]);
  assert.equal(fake.ler('transacoes/r1').status, 'Paga');
  assert.equal(fake.ler('transacoes/r1').baixaManual.descontoCentavos, 500);
});

test('caixa: desconto sem a permissao de desconto na baixa nao passa, mesmo se o navegador mandar', async () => {
  const { fake, s } = montar();
  const r = await s.receberNoCaixa({
    user: OPERADOR, tenantId: 'emp1',
    corpo: { sessaoId: 'cx1', formaPagamento: 'Dinheiro', titulos: [{ transacaoId: 'r1', descontoCentavos: 500 }] },
  });
  assert.equal(r.resultados[0].ok, false);
  assert.match(r.resultados[0].erro, /desconto/i);
  assert.equal(fake.ler('transacoes/r1').status, 'Pendente');
});
