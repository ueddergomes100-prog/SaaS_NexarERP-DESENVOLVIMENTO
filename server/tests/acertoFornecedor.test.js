const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

/*
 * Acerto com fornecedor (24/11/2026, Jomarly): o cliente paga direto o
 * fornecedor. As duas pontas baixam juntas, sem caixa nem banco; desfazer
 * volta as duas; conta invalida recusa antes de gravar; falha no meio nao
 * deixa nada pela metade.
 */

const carregar = (db) => {
  const servicos = carregarComBancoFalso(db, 'services/acertoFornecedor');
  return { baixa: servicos[0], acerto: servicos[3] };
};

const USER = { uid: 'u1', email: 'u1@loja', tenantId: 'loja', permissoes: ['financeiro.receber', 'financeiro.pagar', 'financeiro.estornar'] };
const HOJE = require('../domain/dateTime').getDateInputInTimeZone();

const base = (extra = {}) => ({
  // O cliente deve R$ 1.000 (duas contas); a loja deve R$ 500 a cada fornecedor.
  'transacoes/r1': { tenantId: 'loja', tipo: 'entrada', status: 'Pendente', descricao: 'Venda #100 - Pagamento a Prazo', valor: 600, valorCentavos: 60000, clienteId: 'c1', clienteNome: 'JOAO DA OBRA', formaPagamento: 'Pagamento a Prazo', naturezaFinanceira: 'contas_receber' },
  'transacoes/r2': { tenantId: 'loja', tipo: 'entrada', status: 'Pendente', descricao: 'Venda #101 - Pagamento a Prazo', valor: 700, valorCentavos: 70000, clienteId: 'c1', clienteNome: 'JOAO DA OBRA', formaPagamento: 'Pagamento a Prazo', naturezaFinanceira: 'contas_receber' },
  'transacoes/p1': { tenantId: 'loja', tipo: 'saida', status: 'Pendente', descricao: 'NF 555 CIMENTO', valor: 500, valorCentavos: 50000, fornecedorId: 'f1', fornecedorNome: 'CIMENTOS SA' },
  'transacoes/p2': { tenantId: 'loja', tipo: 'saida', status: 'Pendente', descricao: 'NF 777 AREIA', valor: 500, valorCentavos: 50000, fornecedorId: 'f2', fornecedorNome: 'AREAL DO ZE' },
  'bancos/b1': { tenantId: 'loja', nome: 'SICOOB', ativo: true, saldoCentavos: 123400 },
  ...extra,
});

const pedido = (extra = {}) => ({
  idAcerto: 'a1',
  receber: [{ transacaoId: 'r1', valorCentavos: 60000 }, { transacaoId: 'r2', valorCentavos: 40000 }],
  pagar: [{ transacaoId: 'p1', valorCentavos: 50000 }, { transacaoId: 'p2', valorCentavos: 50000 }],
  data: HOJE,
  observacao: 'Combinado por telefone',
  ...extra,
});

test('acerto: baixa as duas pontas sem banco; parcial deixa o resto em aberto; reenvio nao repete', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  const r = await s.acerto.registrar({ user: USER, tenantId: 'loja', corpo: pedido(), usuarioNome: 'ANA' });

  assert.equal(r.acerto.status, 'concluido');
  assert.equal(r.acerto.totalCentavos, 100000);
  assert.equal(r.acerto.clienteNome, 'JOAO DA OBRA');
  assert.deepEqual(r.acerto.fornecedores, ['CIMENTOS SA', 'AREAL DO ZE']);

  // Conta do cliente quitada por inteiro.
  const r1 = fake.ler('transacoes/r1');
  assert.equal(r1.status, 'Paga');
  assert.equal(r1.formaPagamento, 'Acerto com Fornecedor');
  assert.equal(r1.movimentaCaixaFisico, false);
  assert.equal(r1.bancoId, undefined);
  assert.equal(r1.acertoFornecedor.id, 'acerto_a1');
  assert.equal(r1.acertoFornecedor.texto, 'Pago direto a CIMENTOS SA, AREAL DO ZE');
  // Conta do cliente em parte: R$ 400 saem, R$ 300 ficam em aberto.
  const r2 = fake.ler('transacoes/r2');
  assert.equal(r2.status, 'Pendente');
  assert.equal(r2.valorCentavos, 30000);
  const parcial = fake.listar('transacoes/').find((t) => t.parcialDaTransacaoId === 'r2');
  assert.equal(parcial.status, 'Paga');
  assert.equal(parcial.valorCentavos, 40000);
  assert.equal(parcial.formaPagamento, 'Acerto com Fornecedor');
  assert.equal(parcial.acertoFornecedor.id, 'acerto_a1');
  // Fornecedores pagos, com o nome de quem pagou.
  const p1 = fake.ler('transacoes/p1');
  assert.equal(p1.status, 'Paga');
  assert.equal(p1.formaPagamento, 'Acerto com Fornecedor');
  assert.equal(p1.acertoFornecedor.texto, 'Pago por JOAO DA OBRA');
  assert.equal(p1.baixaManual.bancoId, undefined);
  assert.equal(fake.ler('transacoes/p2').status, 'Paga');
  // Nenhum banco mexeu.
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 123400);

  // Reenvio do mesmo acerto (a internet caiu): devolve o mesmo, sem baixar de novo.
  const de_novo = await s.acerto.registrar({ user: USER, tenantId: 'loja', corpo: pedido(), usuarioNome: 'ANA' });
  assert.equal(de_novo.repetido, true);
  assert.equal(fake.ler('transacoes/r2').valorCentavos, 30000);

  const lista = await s.acerto.listar({ tenantId: 'loja' });
  assert.equal(lista.length, 1);
  assert.equal(lista[0].receber[1].restanteCentavos, 30000);
});

test('acerto: a baixa so volta pelo acerto; desfazer devolve as duas pontas', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  await s.acerto.registrar({ user: USER, tenantId: 'loja', corpo: pedido(), usuarioNome: 'ANA' });

  // Estorno avulso de uma das pontas e' recusado, com o caminho certo.
  await assert.rejects(
    () => s.baixa.registrarEstorno({ user: USER, tenantId: 'loja', pedido: { tipo: 'saida', transacaoId: 'p1', motivo: 'estorno avulso de teste' } }),
    (e) => e.status === 400 && /acerto com fornecedor/.test(e.message) && /desfaça o acerto inteiro/.test(e.message),
  );
  assert.equal(fake.ler('transacoes/p1').status, 'Paga');

  await assert.rejects(() => s.acerto.desfazer({ user: USER, tenantId: 'loja', corpo: { acertoId: 'acerto_a1', motivo: 'curto' } }), (e) => e.status === 400);
  const r = await s.acerto.desfazer({ user: USER, tenantId: 'loja', corpo: { acertoId: 'acerto_a1', motivo: 'o cliente não pagou o fornecedor' } });
  assert.equal(r.acerto.status, 'estornado');

  const r1 = fake.ler('transacoes/r1');
  assert.equal(r1.status, 'Pendente');
  assert.equal(r1.acertoFornecedor, undefined);
  assert.equal(r1.formaPagamento, 'Pagamento a Prazo', 'volta a forma de antes');
  const r2 = fake.ler('transacoes/r2');
  assert.equal(r2.status, 'Pendente');
  assert.equal(r2.valorCentavos, 70000, 'o parcial voltou para a conta');
  assert.equal(fake.listar('transacoes/').find((t) => t.parcialDaTransacaoId === 'r2').status, 'Cancelada');
  for (const id of ['p1', 'p2']) {
    const p = fake.ler(`transacoes/${id}`);
    assert.equal(p.status, 'Pendente');
    assert.equal(p.acertoFornecedor, undefined);
    assert.equal(p.formaPagamento, undefined, 'a conta a pagar nao fica com a forma do acerto');
  }
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 123400);
  await assert.rejects(() => s.acerto.desfazer({ user: USER, tenantId: 'loja', corpo: { acertoId: 'acerto_a1', motivo: 'o cliente não pagou o fornecedor' } }), (e) => e.status === 409);
});

test('acerto: recusa antes de gravar (totais, conta paga, valor acima do saldo, clientes diferentes, cheque)', async () => {
  const recusar = async (banco, corpo, padrao) => {
    const fake = criarBancoFalso(banco, { consultas: true });
    const s = carregar(fake.db);
    await assert.rejects(() => s.acerto.registrar({ user: USER, tenantId: 'loja', corpo }), (e) => padrao.test(e.message));
    // Nada foi baixado nem ficou acerto gravado.
    assert.ok(fake.listar('transacoes/').every((t) => t.formaPagamento !== 'Acerto com Fornecedor'));
    assert.equal(fake.listar('acertos_fornecedor/').length, 0);
  };
  await recusar(base(), pedido({ pagar: [{ transacaoId: 'p1', valorCentavos: 50000 }] }), /precisam somar o mesmo valor/);
  await recusar(base({ 'transacoes/p2': { tenantId: 'loja', tipo: 'saida', status: 'Paga', descricao: 'NF 777 AREIA', valorCentavos: 50000, fornecedorNome: 'AREAL DO ZE' } }), pedido(), /"NF 777 AREIA" já foi paga/);
  await recusar(base(), pedido({ receber: [{ transacaoId: 'r1', valorCentavos: 100000 }] }), /tem R\$ 600,00 em aberto/);
  await recusar(base({ 'transacoes/r2': { tenantId: 'loja', tipo: 'entrada', status: 'Pendente', descricao: 'Venda #200', valorCentavos: 70000, clienteId: 'c2', clienteNome: 'MARIA' } }), pedido(), /clientes diferentes/);
  await recusar(base({ 'transacoes/r1': { tenantId: 'loja', tipo: 'entrada', status: 'Pendente', descricao: 'Venda #100 - Cheque', valorCentavos: 60000, clienteId: 'c1', clienteNome: 'JOAO DA OBRA', formaPagamento: 'Cheque', cheque: { numeroCheque: '1' } } }), pedido(), /cheque aguardando compensação/);
  await recusar(base({ 'transacoes/p1': { tenantId: 'outra', tipo: 'saida', status: 'Pendente', descricao: 'NF de outra empresa', valorCentavos: 50000 } }), pedido(), /não existe mais/);
});

test('acerto: mesma empresa cliente e fornecedor (ele deve e a loja deve a ele)', async () => {
  const fake = criarBancoFalso(base({
    'transacoes/rf': { tenantId: 'loja', tipo: 'entrada', status: 'Pendente', descricao: 'Devolução de mercadoria', valorCentavos: 50000, fornecedorId: 'f1', fornecedorNome: 'CIMENTOS SA' },
  }), { consultas: true });
  const s = carregar(fake.db);
  const r = await s.acerto.registrar({ user: USER, tenantId: 'loja', corpo: pedido({ receber: [{ transacaoId: 'rf', valorCentavos: 50000 }], pagar: [{ transacaoId: 'p1', valorCentavos: 50000 }] }) });
  assert.equal(r.acerto.clienteNome, 'CIMENTOS SA');
  assert.equal(fake.ler('transacoes/rf').status, 'Paga');
  assert.equal(fake.ler('transacoes/p1').status, 'Paga');
});
