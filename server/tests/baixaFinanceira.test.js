const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validarPedidoDeBaixa,
  validarPedidoDeEstorno,
  temPermissao,
  exigeBanco,
} = require('../services/baixaFinanceiraRegras');

const HOJE = '2026-10-05';

// ---------------------------------------------------------------------------
// Validacao do pedido (puro)
// ---------------------------------------------------------------------------

test('baixa: pedido completo de Pagar com banco passa', () => {
  const { erro, pedido } = validarPedidoDeBaixa({ tipo: 'saida', transacaoId: 't1', formaPagamento: 'Pix', dataPagamento: HOJE, bancoId: 'b1' }, HOJE);
  assert.equal(erro, undefined);
  assert.deepEqual(pedido, { tipo: 'saida', transacaoId: 't1', formaPagamento: 'Pix', dataPagamento: HOJE, bancoId: 'b1' });
});

test('baixa: dinheiro nao leva banco, mesmo se o navegador mandar', () => {
  const { pedido } = validarPedidoDeBaixa({ tipo: 'saida', transacaoId: 't1', formaPagamento: 'Dinheiro', dataPagamento: HOJE, bancoId: 'b1' }, HOJE);
  assert.equal(pedido.bancoId, undefined);
});

test('baixa: forma que exige banco sem banco e\' recusada em portugues', () => {
  assert.equal(validarPedidoDeBaixa({ tipo: 'saida', transacaoId: 't1', formaPagamento: 'Boleto', dataPagamento: HOJE }, HOJE).erro, 'Escolha de qual banco saiu o pagamento.');
  assert.equal(validarPedidoDeBaixa({ tipo: 'entrada', transacaoId: 't1', formaPagamento: 'Pix', dataPagamento: HOJE }, HOJE).erro, 'Escolha em qual banco caiu o recebimento.');
});

test('baixa: Receber "Outros" nao exige banco (mesma regra da tela)', () => {
  assert.equal(exigeBanco('entrada', 'Outros'), false);
  assert.equal(exigeBanco('saida', 'Outros'), true);
});

test('baixa: cheque no Receber vai pelo fluxo de compensacao, nao por aqui', () => {
  assert.match(validarPedidoDeBaixa({ tipo: 'entrada', transacaoId: 't1', formaPagamento: 'Cheque', dataPagamento: HOJE, bancoId: 'b1' }, HOJE).erro, /compensação/);
});

test('baixa: data futura, inexistente ou ausente e\' recusada', () => {
  assert.match(validarPedidoDeBaixa({ tipo: 'saida', transacaoId: 't1', formaPagamento: 'Dinheiro', dataPagamento: '2026-10-06' }, HOJE).erro, /futuro/);
  assert.match(validarPedidoDeBaixa({ tipo: 'saida', transacaoId: 't1', formaPagamento: 'Dinheiro', dataPagamento: '2026-02-31' }, HOJE).erro, /não existe/);
  assert.match(validarPedidoDeBaixa({ tipo: 'saida', transacaoId: 't1', formaPagamento: 'Dinheiro' }, HOJE).erro, /data/);
});

test('baixa: tipo, id e forma invalidos', () => {
  assert.match(validarPedidoDeBaixa({ tipo: 'x', transacaoId: 't1' }, HOJE).erro, /Tipo/);
  assert.match(validarPedidoDeBaixa({ tipo: 'saida', transacaoId: '../bancos/x', formaPagamento: 'Dinheiro', dataPagamento: HOJE }, HOJE).erro, /Lançamento inválido/);
  assert.match(validarPedidoDeBaixa({ tipo: 'saida', transacaoId: 't1', formaPagamento: 'Bitcoin', dataPagamento: HOJE }, HOJE).erro, /Escolha como foi pago/);
});

test('estorno: motivo curto e\' recusado; motivo bom passa', () => {
  assert.match(validarPedidoDeEstorno({ tipo: 'saida', transacaoId: 't1', motivo: 'erro' }).erro, /motivo/);
  assert.deepEqual(validarPedidoDeEstorno({ tipo: 'entrada', transacaoId: 't1', motivo: '  baixa na data errada ' }).pedido, { tipo: 'entrada', transacaoId: 't1', motivo: 'baixa na data errada' });
});

test('permissao: gestor e plataforma sempre; funcionario so\' com a permissao', () => {
  assert.equal(temPermissao({ isTenantManager: true }, 'financeiro.pagar'), true);
  assert.equal(temPermissao({ isPlatformAdmin: true }, 'financeiro.estornar'), true);
  assert.equal(temPermissao({ permissoes: ['financeiro.receber'] }, 'financeiro.receber'), true);
  assert.equal(temPermissao({ permissoes: ['financeiro.receber'] }, 'financeiro.pagar'), false);
  assert.equal(temPermissao({}, 'financeiro.pagar'), false);
});

// ---------------------------------------------------------------------------
// Baixa e estorno de ponta a ponta, num Firestore falso em memoria
// ---------------------------------------------------------------------------

const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

const carregarServico = (db) => carregarComBancoFalso(db)[0];

const USER = { uid: 'u1', email: 'u1@teste', tenantId: 'emp1', permissoes: [] };

test('Pagar: baixa com banco debita o saldo e grava a marca da baixa; estorno devolve', async () => {
  const fake = criarBancoFalso({
    'transacoes/t1': { tenantId: 'emp1', tipo: 'saida', status: 'Pendente', descricao: 'Aluguel', valor: 1500, valorCentavos: 150000 },
    'bancos/b1': { tenantId: 'emp1', nome: 'Sicoob', ativo: true, saldoCentavos: 500000 },
  });
  const s = carregarServico(fake.db);

  const pedido = s.validarPedidoDeBaixa({ tipo: 'saida', transacaoId: 't1', formaPagamento: 'Pix', dataPagamento: '2026-10-04', bancoId: 'b1' }, HOJE).pedido;
  const resumo = await s.registrarBaixa({ user: USER, tenantId: 'emp1', pedido });
  assert.equal(resumo.bancoNome, 'Sicoob');
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 350000);
  const titulo = fake.ler('transacoes/t1');
  assert.equal(titulo.status, 'Paga');
  assert.equal(titulo.dataPagamento, '2026-10-04');
  assert.equal(titulo.bancoNome, 'Sicoob');
  assert.equal(titulo.ultimaAlteracao, 'Pagamento confirmado');
  assert.deepEqual(titulo.baixaManual, { origem: 'contas_pagar', formaPagamento: 'Pix', dataPagamento: '2026-10-04', valorCentavos: 150000, bancoId: 'b1', movimentoBancoCentavos: -150000 });

  // Segundo clique nao debita de novo.
  await assert.rejects(() => s.registrarBaixa({ user: USER, tenantId: 'emp1', pedido }), (e) => e.status === 409);
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 350000);

  const estorno = s.validarPedidoDeEstorno({ tipo: 'saida', transacaoId: 't1', motivo: 'paguei na data errada' }).pedido;
  const r = await s.registrarEstorno({ user: USER, tenantId: 'emp1', pedido: estorno });
  assert.equal(r.ajusteBancoCentavos, 150000);
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 500000);
  const depois = fake.ler('transacoes/t1');
  assert.equal(depois.status, 'Pendente');
  assert.equal(depois.dataPagamento, undefined);
  assert.equal(depois.baixaManual, undefined);
  assert.equal(depois.ultimoEstorno.motivo, 'paguei na data errada');
});

test('Receber: baixa credita o banco e atualiza a venda; estorno desfaz os dois', async () => {
  const fake = criarBancoFalso({
    'transacoes/r1': { tenantId: 'emp1', tipo: 'entrada', status: 'Pendente', descricao: 'Pedido #10 - 1/1', valor: 200, valorCentavos: 20000, formaPagamento: 'Boleto', pedidoId: 'p10', paymentIndex: 0 },
    'bancos/b1': { tenantId: 'emp1', nome: 'Itaú', ativo: true, saldoCentavos: 0 },
    'pedidos_venda/p10': {
      tenantId: 'emp1', status: 'Finalizada',
      pagamentos: [{ method: 'Boleto', amountCents: 20000, status: 'pending', transactionId: 'r1' }],
    },
  });
  const s = carregarServico(fake.db);

  const pedido = s.validarPedidoDeBaixa({ tipo: 'entrada', transacaoId: 'r1', formaPagamento: 'Pix', dataPagamento: HOJE, bancoId: 'b1' }, HOJE).pedido;
  await s.registrarBaixa({ user: USER, tenantId: 'emp1', pedido });
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 20000);
  const titulo = fake.ler('transacoes/r1');
  assert.equal(titulo.status, 'Paga');
  assert.equal(titulo.formaPagamentoOriginal, 'Boleto');
  assert.equal(titulo.formaPagamento, 'Pix');
  assert.equal(titulo.ultimaAlteracao, 'Recebimento confirmado');
  const venda = fake.ler('pedidos_venda/p10');
  assert.equal(venda.totalPendenteCentavos, 0);
  assert.equal(venda.statusPagamento, 'Paga');

  const estorno = s.validarPedidoDeEstorno({ tipo: 'entrada', transacaoId: 'r1', motivo: 'cliente não pagou ainda' }).pedido;
  await s.registrarEstorno({ user: USER, tenantId: 'emp1', pedido: estorno });
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 0);
  const voltou = fake.ler('transacoes/r1');
  assert.equal(voltou.status, 'Pendente');
  assert.equal(voltou.formaPagamento, 'Boleto');
  assert.equal(fake.ler('pedidos_venda/p10').statusPagamento, 'Pendente');
});

test('outra empresa: titulo e banco de outro tenant nao sao encontrados', async () => {
  const fake = criarBancoFalso({
    'transacoes/t1': { tenantId: 'emp2', tipo: 'saida', status: 'Pendente', descricao: 'X', valorCentavos: 100 },
    'transacoes/t2': { tenantId: 'emp1', tipo: 'saida', status: 'Pendente', descricao: 'Y', valorCentavos: 100 },
    'bancos/b2': { tenantId: 'emp2', nome: 'Outro', saldoCentavos: 0 },
  });
  const s = carregarServico(fake.db);
  const base = { tipo: 'saida', formaPagamento: 'Pix', dataPagamento: HOJE, bancoId: 'b2' };
  await assert.rejects(
    () => s.registrarBaixa({ user: USER, tenantId: 'emp1', pedido: s.validarPedidoDeBaixa({ ...base, transacaoId: 't1' }, HOJE).pedido }),
    (e) => e.status === 404,
  );
  await assert.rejects(
    () => s.registrarBaixa({ user: USER, tenantId: 'emp1', pedido: s.validarPedidoDeBaixa({ ...base, transacaoId: 't2' }, HOJE).pedido }),
    (e) => e.status === 404 && /banco/.test(e.message),
  );
  assert.equal(fake.ler('bancos/b2').saldoCentavos, 0);
  assert.equal(fake.ler('transacoes/t2').status, 'Pendente');
});

test('banco inativo e conta cancelada sao recusados sem gravar nada', async () => {
  const fake = criarBancoFalso({
    'transacoes/t1': { tenantId: 'emp1', tipo: 'saida', status: 'Pendente', descricao: 'X', valorCentavos: 100 },
    'transacoes/t3': { tenantId: 'emp1', tipo: 'saida', status: 'Cancelada', descricao: 'Z', valorCentavos: 100 },
    'bancos/b1': { tenantId: 'emp1', nome: 'Velho', ativo: false, saldoCentavos: 0 },
  });
  const s = carregarServico(fake.db);
  await assert.rejects(
    () => s.registrarBaixa({ user: USER, tenantId: 'emp1', pedido: s.validarPedidoDeBaixa({ tipo: 'saida', transacaoId: 't1', formaPagamento: 'Pix', dataPagamento: HOJE, bancoId: 'b1' }, HOJE).pedido }),
    (e) => e.status === 400 && /inativo/.test(e.message),
  );
  await assert.rejects(
    () => s.registrarBaixa({ user: USER, tenantId: 'emp1', pedido: s.validarPedidoDeBaixa({ tipo: 'saida', transacaoId: 't3', formaPagamento: 'Dinheiro', dataPagamento: HOJE }, HOJE).pedido }),
    (e) => e.status === 400 && /cancelada/.test(e.message),
  );
  assert.equal(fake.ler('transacoes/t1').status, 'Pendente');
});

test('estorno de recebimento do balcao (nao veio de "Dar Baixa") e\' bloqueado', async () => {
  const fake = criarBancoFalso({
    'transacoes/r9': { tenantId: 'emp1', tipo: 'entrada', status: 'Paga', descricao: 'Venda balcão', valorCentavos: 5000, formaPagamento: 'Dinheiro' },
  });
  const s = carregarServico(fake.db);
  await assert.rejects(
    () => s.registrarEstorno({ user: USER, tenantId: 'emp1', pedido: { tipo: 'entrada', transacaoId: 'r9', motivo: 'teste de bloqueio' } }),
    (e) => e.status === 400 && /Dar Baixa/.test(e.message),
  );
  assert.equal(fake.ler('transacoes/r9').status, 'Paga');
});

test('Receber com juros e multa: lancamento proprio, banco credita os dois, estorno desfaz os dois', async () => {
  const fake = criarBancoFalso({
    'transacoes/t3': { tenantId: 'emp1', tipo: 'entrada', status: 'Pendente', descricao: 'Parcela 2/3 - Venda 0101', valor: 100, valorCentavos: 10000, dataVencimento: '2026-09-22', clienteId: 'c1', clienteNome: 'MARIA' },
    'bancos/b1': { tenantId: 'emp1', nome: 'Sicoob', ativo: true, saldoCentavos: 500000 },
  });
  const s = carregarServico(fake.db);
  const valid = s.validarPedidoDeBaixa({ tipo: 'entrada', transacaoId: 't3', formaPagamento: 'Pix', dataPagamento: HOJE, bancoId: 'b1', acrescimoCentavos: 350 }, HOJE);
  assert.equal(valid.erro, undefined, valid.erro);
  assert.equal(valid.pedido.acrescimoCentavos, 350);
  assert.match(String(s.validarPedidoDeBaixa({ tipo: 'saida', transacaoId: 't3', formaPagamento: 'Pix', dataPagamento: HOJE, bancoId: 'b1', acrescimoCentavos: 350 }, HOJE).erro), /só se aplicam a recebimentos/);
  assert.match(String(s.validarPedidoDeBaixa({ tipo: 'entrada', transacaoId: 't3', formaPagamento: 'Pix', dataPagamento: HOJE, bancoId: 'b1', acrescimoCentavos: 3.5 }, HOJE).erro), /maior ou igual a zero/);

  const resumo = await s.registrarBaixa({ user: USER, tenantId: 'emp1', pedido: valid.pedido });
  assert.equal(resumo.acrescimoCentavos, 350);
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 510350);
  const titulo = fake.ler('transacoes/t3');
  assert.equal(titulo.status, 'Paga');
  assert.equal(titulo.valorCentavos, 10000, 'o titulo continua valendo o que o cliente devia');
  assert.equal(titulo.baixaManual.acrescimoCentavos, 350);
  const jurosId = titulo.baixaManual.acrescimoTransacaoId;
  const juros = fake.ler(`transacoes/${jurosId}`);
  assert.equal(juros.status, 'Paga');
  assert.equal(juros.valorCentavos, 350);
  assert.equal(juros.categoria, 'Juros e multa recebidos');
  assert.equal(juros.acrescimoDaTransacaoId, 't3');
  assert.equal(juros.clienteNome, 'MARIA');
  assert.deepEqual(juros.baixaManual, { origem: 'contas_receber', formaPagamento: 'Pix', dataPagamento: HOJE, valorCentavos: 350, bancoId: 'b1', movimentoBancoCentavos: 350 });

  // Acima do razoavel: barra antes de gravar.
  const fake2 = criarBancoFalso({ 'transacoes/t4': { tenantId: 'emp1', tipo: 'entrada', status: 'Pendente', descricao: 'X', valor: 10, valorCentavos: 1000 } });
  await assert.rejects(() => carregarServico(fake2.db).registrarBaixa({ user: USER, tenantId: 'emp1', pedido: { tipo: 'entrada', transacaoId: 't4', formaPagamento: 'Dinheiro', dataPagamento: HOJE, acrescimoCentavos: 500000 } }), /muito acima do título/);

  const estorno = s.validarPedidoDeEstorno({ tipo: 'entrada', transacaoId: 't3', motivo: 'recebi do cliente errado' }).pedido;
  const r = await s.registrarEstorno({ user: USER, tenantId: 'emp1', pedido: estorno });
  assert.equal(r.acrescimoCentavos, 350);
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 500000, 'banco volta ao que era: titulo e juros');
  assert.equal(fake.ler('transacoes/t3').status, 'Pendente');
  assert.equal(fake.ler(`transacoes/${jurosId}`).status, 'Cancelada');
});
