const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

/*
 * Item 15 da Embala Minas, fase 2 (25/11/2026): Contas a Pagar (lancar,
 * alterar, cancelar) e, no Receber, a baixa em cheque e o abatimento com
 * credito do cliente passam pelo servidor, cada um com a sua permissao. Quem
 * tem a permissao da tela e ainda nao teve as permissoes salvas com o pacote
 * 'financeiro-2' ja' tem as novas. Firestore falso em memoria.
 */
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');
const { getDateInputInTimeZone } = require('../domain/dateTime');

const MARCADORES = ['pacote.financeiro-1', 'pacote.financeiro-2'];
const USUARIO = { uid: 'u1', tenantId: 'loja', email: 'fin@loja', permissoes: ['financeiro.pagar', 'financeiro.receber'] };

const carregar = (db) => {
  const [, , , receber, pagar, chequeCredito] = carregarComBancoFalso(db, 'services/lancamentoReceber', 'services/lancamentoPagar', 'services/recebimentoChequeCredito');
  return { receber, pagar, chequeCredito };
};

const base = (extra = {}) => ({
  'usuarios/u1': { tenantId: 'loja', nome: 'MARIA DO FINANCEIRO' },
  'fornecedores/f1': { tenantId: 'loja', nome: 'Distribuidora Alfa' },
  'fornecedores/fora': { tenantId: 'outra', nome: 'DE OUTRA EMPRESA' },
  'fornecedores/inativo': { tenantId: 'loja', nome: 'ANTIGO', ativo: false },
  'frota/v1': { tenantId: 'loja', modelo: 'VW DELIVERY', placa: 'ABC1D23' },
  'motoristas/m1': { tenantId: 'loja', nome: 'JOAO MOTORISTA' },
  'bancos/b1': { tenantId: 'loja', nome: 'SICOOB', ativo: true, saldoCentavos: 0 },
  'bancos/bFora': { tenantId: 'outra', nome: 'OUTRO', ativo: true },
  ...extra,
});

const despesa = (extra = {}) => ({
  idLancamento: 'desp12345XYZ',
  descricao: 'aluguel novembro',
  categoria: 'Aluguel',
  forma: 'Boleto',
  totalCentavos: 150000,
  vencimento: '2026-12-10',
  ...extra,
});

const semIndefinido = (obj) => assert.ok(!Object.values(obj).includes(undefined), 'nenhum campo undefined');

// ---------------------------------------------------------------------------
// Contas a Pagar: servico
// ---------------------------------------------------------------------------

test('pagar: lanca despesa de uma parcela em aberto, com fornecedor, veiculo e motorista do cadastro', async () => {
  const fake = criarBancoFalso(base());
  const { pagar } = carregar(fake.db);
  const r = await pagar.lancarContaAPagar({ user: USUARIO, tenantId: 'loja', corpo: despesa({ fornecedorId: 'f1', veiculoId: 'v1', motoristaId: 'm1' }) });
  assert.deepEqual(r.ids, ['desp_desp12345XYZ']);
  assert.equal(r.jaLancado, false);
  const t = fake.ler('transacoes/desp_desp12345XYZ');
  assert.equal(t.tipo, 'saida');
  assert.equal(t.status, 'Pendente');
  assert.equal(t.descricao, 'ALUGUEL NOVEMBRO');
  assert.equal(t.categoria, 'ALUGUEL');
  assert.equal(t.data, '2026-12-10');
  assert.equal(t.valor, 1500);
  assert.equal(t.valorCentavos, 150000);
  assert.equal(t.formaPagamentoPrevista, 'Boleto');
  assert.equal(t.fornecedorId, 'f1');
  assert.equal(t.fornecedorNome, 'DISTRIBUIDORA ALFA', 'nome do cadastro');
  assert.equal(t.veiculoId, 'v1');
  assert.match(t.veiculoNome, /VW DELIVERY/);
  assert.equal(t.motoristaNome, 'JOAO MOTORISTA');
  assert.equal(t.lancadoPorNome, 'MARIA DO FINANCEIRO');
  assert.equal(t.tenantId, 'loja');
  assert.equal(t.parcela, undefined, 'uma parcela so: sem numero de parcela');
  semIndefinido(t);
});

test('pagar: cheques com banco do cadastro; reenviar nao duplica; banco de outra empresa e soma que nao fecha sao recusados', async () => {
  const fake = criarBancoFalso(base());
  const { pagar } = carregar(fake.db);
  const cheques = despesa({
    forma: 'Cheque',
    totalCentavos: 20000,
    parcelas: [
      { numero: '1', vencimento: '2026-12-10', valorCentavos: 10000, bancoId: 'b1', numeroCheque: '000101' },
      { numero: '2', vencimento: '2027-01-10', valorCentavos: 10000, bancoId: 'b1', numeroCheque: '000102' },
    ],
  });
  const r = await pagar.lancarContaAPagar({ user: USUARIO, tenantId: 'loja', corpo: cheques });
  assert.equal(r.quantidade, 2);
  const p2 = fake.ler('transacoes/desp_desp12345XYZ_p2');
  assert.equal(p2.formaPagamento, 'Cheque');
  assert.equal(p2.bancoNome, 'SICOOB');
  assert.equal(p2.cheque.numeroCheque, '000102');
  assert.equal(p2.descricao, 'ALUGUEL NOVEMBRO (Parcela 2/2)');
  assert.equal(p2.grupoParcelasId, 'desp12345XYZ');
  semIndefinido(p2);
  const deNovo = await pagar.lancarContaAPagar({ user: USUARIO, tenantId: 'loja', corpo: cheques });
  assert.equal(deNovo.jaLancado, true);
  assert.equal(fake.listar('transacoes/').length, 2);

  const lancar = (extra) => pagar.lancarContaAPagar({ user: USUARIO, tenantId: 'loja', corpo: despesa({ idLancamento: 'outro1234567', ...extra }) });
  await assert.rejects(() => lancar({ forma: 'Cheque', parcelas: [{ vencimento: '2026-12-10', valorCentavos: 150000, bancoId: 'bFora', numeroCheque: '1' }] }), (e) => e.status === 400 && /banco do cheque/.test(e.message));
  await assert.rejects(() => lancar({ parcelas: [{ vencimento: '2026-12-10', valorCentavos: 100000 }] }), (e) => e.status === 400 && /Conferi as parcelas/.test(e.message));
  const aceito = await lancar({ parcelas: [{ vencimento: '2026-12-10', valorCentavos: 100000 }], aceitarSomaDiferente: true });
  assert.equal(aceito.totalCentavos, 100000);
  await assert.rejects(() => lancar({ idLancamento: 'xyz123456789', fornecedorId: 'fora' }), (e) => e.status === 404);
  await assert.rejects(() => lancar({ idLancamento: 'xyz123456789', fornecedorId: 'inativo' }), (e) => e.status === 409 && /inativo/.test(e.message));
  await assert.rejects(() => lancar({ idLancamento: 'xyz123456789', forma: 'Cheque' }), (e) => e.status === 400 && /cada cheque/.test(e.message));
  await assert.rejects(() => lancar({ idLancamento: 'xyz123456789', categoria: ' ' }), (e) => e.status === 400 && /categoria/.test(e.message));
});

test('pagar: alterar valor grava valor e valorCentavos; tirar fornecedor apaga as chaves; paga e de OS nao mudam', async () => {
  const fake = criarBancoFalso(base({
    'transacoes/d1': { tenantId: 'loja', tipo: 'saida', status: 'Pendente', descricao: 'LUZ', categoria: 'ÁGUA/LUZ', data: '2026-12-01', valor: 100, valorCentavos: 10000, fornecedorId: 'f1', fornecedorNome: 'DISTRIBUIDORA ALFA' },
    'transacoes/paga': { tenantId: 'loja', tipo: 'saida', status: 'Paga', descricao: 'X', categoria: 'X', data: '2026-12-01', valor: 1 },
    'transacoes/daOs': { tenantId: 'loja', tipo: 'saida', status: 'Pendente', descricao: 'X', categoria: 'X', data: '2026-12-01', valor: 1, osId: 'os1' },
    'transacoes/deFora': { tenantId: 'outra', tipo: 'saida', status: 'Pendente', descricao: 'X', categoria: 'X', data: '2026-12-01', valor: 1 },
  }));
  const { pagar } = carregar(fake.db);
  const editar = (extra) => pagar.editarContaAPagar({ user: USUARIO, tenantId: 'loja', corpo: { transacaoId: 'd1', descricao: 'luz', categoria: 'Água/Luz', valorCentavos: 10000, vencimento: '2026-12-01', fornecedorId: 'f1', veiculoId: '', motoristaId: '', ...extra } });
  const nada = await editar({});
  assert.equal(nada.alteracoes.length, 0, 'maiuscula/minuscula nao e mudanca');
  const r = await editar({ valorCentavos: 12345, vencimento: '2026-12-15', fornecedorId: '' });
  assert.deepEqual(r.alteracoes.map((a) => a.campo).sort(), ['Fornecedor', 'Valor', 'Vencimento']);
  assert.deepEqual(r.alteracoes.find((a) => a.campo === 'Valor'), { campo: 'Valor', valorAnterior: 'R$ 100,00', valorNovo: 'R$ 123,45' });
  const t = fake.ler('transacoes/d1');
  assert.equal(t.valor, 123.45);
  assert.equal(t.valorCentavos, 12345, 'a baixa le valorCentavos: tem de acompanhar o valor');
  assert.equal(t.data, '2026-12-15');
  assert.equal(t.fornecedorId, undefined);
  assert.equal(t.fornecedorNome, undefined);

  const comId = (transacaoId) => pagar.editarContaAPagar({ user: USUARIO, tenantId: 'loja', corpo: { transacaoId, descricao: 'X', categoria: 'X', valorCentavos: 100, vencimento: '2026-12-01' } });
  await assert.rejects(() => comId('paga'), (e) => e.status === 409 && /estorne o pagamento/.test(e.message));
  await assert.rejects(() => comId('daOs'), (e) => e.status === 409 && /OS/.test(e.message));
  await assert.rejects(() => comId('deFora'), (e) => e.status === 404);
});

test('pagar: cancelar com motivo; ja cancelada e paga sao recusadas', async () => {
  const fake = criarBancoFalso(base({
    'transacoes/d1': { tenantId: 'loja', tipo: 'saida', status: 'Pendente', descricao: 'LUZ', categoria: 'X', data: '2026-12-01', valor: 100 },
  }));
  const { pagar } = carregar(fake.db);
  await assert.rejects(() => pagar.cancelarContaAPagar({ user: USUARIO, tenantId: 'loja', corpo: { transacaoId: 'd1', motivo: 'curto' } }), (e) => e.status === 400 && /motivo/.test(e.message));
  await pagar.cancelarContaAPagar({ user: USUARIO, tenantId: 'loja', corpo: { transacaoId: 'd1', motivo: 'lancada em duplicidade' } });
  const t = fake.ler('transacoes/d1');
  assert.equal(t.status, 'Cancelada');
  assert.equal(t.cancelamento.motivo, 'lancada em duplicidade');
  await assert.rejects(() => pagar.cancelarContaAPagar({ user: USUARIO, tenantId: 'loja', corpo: { transacaoId: 'd1', motivo: 'lancada em duplicidade' } }), (e) => e.status === 409 && /já está cancelada/.test(e.message));
});

// ---------------------------------------------------------------------------
// Contas a Receber: cheque e credito
// ---------------------------------------------------------------------------

const contaDeVenda = (extra = {}) => base({
  'transacoes/t1': {
    tenantId: 'loja', tipo: 'entrada', status: 'Pendente', descricao: 'Venda #12', valor: 100, valorCentavos: 10000,
    formaPagamento: 'Boleto', pedidoId: 'p12', paymentIndex: 1, clienteId: 'c1', clienteNome: 'JOSE',
  },
  'pedidos_venda/p12': {
    tenantId: 'loja', status: 'Finalizada',
    pagamentos: [{ id: 'p12', indice: 1, formaPagamento: 'Boleto', condicaoPagamento: 'aprazo', valorCentavos: 10000, valor: 100, status: 'pendente', naturezaFinanceira: 'boleto', movimentaCaixaFisico: false, transactionId: 't1' }],
  },
  ...extra,
});

test('cheque: a conta continua em aberto com os dados do cheque; a venda marca aguardando compensacao', async () => {
  const fake = criarBancoFalso(contaDeVenda());
  const { chequeCredito } = carregar(fake.db);
  const r = await chequeCredito.registrarChequeNaBaixa({
    user: USUARIO,
    tenantId: 'loja',
    corpo: { transacaoId: 't1', dataCompensacao: '2026-12-20', bancoId: 'b1', cheque: { bancoEmissor: 'Banco do Brasil', numeroCheque: '850001', titular: '' } },
  });
  assert.equal(r.jaPaga, false);
  assert.equal(r.bancoNome, 'SICOOB', 'nome do cadastro');
  const t = fake.ler('transacoes/t1');
  assert.equal(t.status, 'Pendente', 'cheque nao da baixa');
  assert.equal(t.valorCentavos, 10000, 'valor inteiro, sem juros nem multa');
  assert.equal(t.formaPagamento, 'Cheque');
  assert.equal(t.formaPagamentoOriginal, 'Boleto');
  assert.equal(t.dataPrevistaRecebimento, '2026-12-20');
  assert.equal(t.cheque.numeroCheque, '850001');
  assert.equal(t.cheque.titular, undefined, 'campo vazio nao vira chave');
  semIndefinido(t.cheque);
  const pagamento = fake.ler('pedidos_venda/p12').pagamentos[0];
  assert.equal(pagamento.formaPagamento, 'Cheque');
  assert.equal(pagamento.dataPrevistaRecebimento, '2026-12-20');
  assert.equal(pagamento.bancoNome, 'SICOOB');
});

test('cheque sem os dados: so com o pagamento simplificado da filial', async () => {
  const semConfig = criarBancoFalso(contaDeVenda());
  await assert.rejects(
    () => carregar(semConfig.db).chequeCredito.registrarChequeNaBaixa({ user: USUARIO, tenantId: 'loja', corpo: { transacaoId: 't1', dataCompensacao: '2026-12-20' } }),
    (e) => e.status === 400 && /dados do cheque/.test(e.message),
  );
  const simplificado = criarBancoFalso(contaDeVenda({ 'configuracoes/loja': { pagamentoCartaoSimplificadoAtivo: true } }));
  const r = await carregar(simplificado.db).chequeCredito.registrarChequeNaBaixa({ user: USUARIO, tenantId: 'loja', corpo: { transacaoId: 't1', dataCompensacao: '2026-12-20' } });
  assert.equal(r.jaPaga, false);
  assert.equal(simplificado.ler('transacoes/t1').cheque, undefined);
});

const creditos = {
  'creditos_cliente/cr1': { tenantId: 'loja', clienteId: 'c1', clienteNome: 'JOSE', status: 'disponivel', saldoDisponivel: 30, saldoDisponivelCentavos: 3000 },
  'creditos_cliente/cr2': { tenantId: 'loja', clienteNome: 'JOSE', status: 'usado_parcial', saldoDisponivel: 100, saldoDisponivelCentavos: 10000 },
  // Mesmo nome, mas de outro cliente (codigo diferente): nao entra.
  'creditos_cliente/crOutro': { tenantId: 'loja', clienteId: 'c9', clienteNome: 'JOSE', status: 'disponivel', saldoDisponivel: 500, saldoDisponivelCentavos: 50000 },
};

test('credito: abate parte (nasce o recebimento em credito) e depois quita; credito de outro cliente com o mesmo nome nao entra', async () => {
  const fake = criarBancoFalso(contaDeVenda(creditos), { consultas: true });
  const { chequeCredito } = carregar(fake.db);
  const hoje = getDateInputInTimeZone();
  const parte = await chequeCredito.abaterComCredito({ user: USUARIO, tenantId: 'loja', hoje, corpo: { transacaoId: 't1', valorCentavos: 4000, dataPagamento: hoje, valorEsperadoCentavos: 10000 } });
  assert.equal(parte.quitou, false);
  assert.equal(parte.restanteCentavos, 6000);
  assert.equal(fake.ler('transacoes/t1').valorCentavos, 6000);
  assert.equal(fake.ler('transacoes/t1').status, 'Pendente');
  const recebimento = fake.ler(`transacoes/${parte.pagamentoId}`);
  assert.equal(recebimento.status, 'Paga');
  assert.equal(recebimento.formaPagamento, 'Crédito de Devolução');
  assert.equal(recebimento.valorCentavos, 4000);
  assert.equal(fake.ler('creditos_cliente/cr1').status, 'esgotado');
  assert.equal(fake.ler('creditos_cliente/cr2').saldoDisponivelCentavos, 9000);
  assert.equal(fake.ler('creditos_cliente/crOutro').saldoDisponivelCentavos, 50000, 'credito de outro cliente intacto');

  await assert.rejects(
    () => chequeCredito.abaterComCredito({ user: USUARIO, tenantId: 'loja', hoje, corpo: { transacaoId: 't1', valorCentavos: 6000, dataPagamento: hoje, valorEsperadoCentavos: 10000 } }),
    (e) => e.status === 409 && /valor da conta foi alterado/.test(e.message),
  );
  const tudo = await chequeCredito.abaterComCredito({ user: USUARIO, tenantId: 'loja', hoje, corpo: { transacaoId: 't1', valorCentavos: 6000, dataPagamento: hoje } });
  assert.equal(tudo.quitou, true);
  const t = fake.ler('transacoes/t1');
  assert.equal(t.status, 'Paga');
  assert.equal(t.formaPagamento, 'Crédito de Devolução');
  assert.equal(fake.ler('pedidos_venda/p12').statusPagamento, 'Paga');

  await assert.rejects(
    () => chequeCredito.abaterComCredito({ user: USUARIO, tenantId: 'loja', hoje, corpo: { transacaoId: 't1', valorCentavos: 100, dataPagamento: hoje } }),
    (e) => e.status === 409,
  );
});

test('credito: mais que o saldo ou que a conta e recusado sem gravar nada', async () => {
  const fake = criarBancoFalso(contaDeVenda({ 'creditos_cliente/cr1': creditos['creditos_cliente/cr1'] }), { consultas: true });
  const { chequeCredito } = carregar(fake.db);
  const hoje = getDateInputInTimeZone();
  await assert.rejects(
    () => chequeCredito.abaterComCredito({ user: USUARIO, tenantId: 'loja', hoje, corpo: { transacaoId: 't1', valorCentavos: 5000, dataPagamento: hoje } }),
    (e) => e.status === 409 && /saldo de crédito/.test(e.message),
  );
  await assert.rejects(
    () => chequeCredito.abaterComCredito({ user: USUARIO, tenantId: 'loja', hoje, corpo: { transacaoId: 't1', valorCentavos: 20000, dataPagamento: hoje } }),
    (e) => e.status === 400 && /não pode passar do valor da conta/.test(e.message),
  );
  assert.equal(fake.ler('transacoes/t1').valorCentavos, 10000);
  assert.equal(fake.ler('creditos_cliente/cr1').saldoDisponivelCentavos, 3000);
});

// ---------------------------------------------------------------------------
// Rotas: permissao de cada acao (ja' vem marcada para quem usa a tela)
// ---------------------------------------------------------------------------

const montarApp = (fake, rotas) => {
  carregarComBancoFalso(fake.db, 'services/lancamentoReceber', 'services/lancamentoPagar', 'services/recebimentoChequeCredito');
  const pasta = path.join(__dirname, '..');
  const substituir = (modulo, exportado) => {
    const caminho = require.resolve(path.join(pasta, modulo));
    require.cache[caminho] = { id: caminho, filename: caminho, loaded: true, exports: exportado };
  };
  substituir('middleware/auth', {
    authenticate: (req, res, next) => { req.user = JSON.parse(req.headers['x-usuario-teste'] || '{}'); next(); },
  });
  substituir('services/auditoria', { registrarLog: () => {}, registrarLogNaTransacao: () => {} });
  const app = express();
  app.use(express.json());
  for (const [prefixo, modulo] of rotas) {
    const caminho = require.resolve(path.join(pasta, modulo));
    delete require.cache[caminho];
    app.use(prefixo, require(caminho));
  }
  return app;
};

const comApp = async (app, corpoDoTeste) => {
  const servidor = app.listen(0);
  try {
    const { port } = servidor.address();
    const chamar = async (rota, usuario, corpo) => {
      const resposta = await fetch(`http://127.0.0.1:${port}${rota}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-usuario-teste': JSON.stringify({ tenantId: 'loja', ...usuario }) },
        body: JSON.stringify(corpo),
      });
      return { status: resposta.status, corpo: await resposta.json() };
    };
    await corpoDoTeste(chamar);
  } finally {
    servidor.close();
  }
};

test('rotas /pagar/*: a permissao de cada uma; quem so tem Contas a Pagar (sem o pacote 2) continua fazendo', async () => {
  const fake = criarBancoFalso(base({
    'transacoes/d1': { tenantId: 'loja', tipo: 'saida', status: 'Pendente', descricao: 'LUZ', categoria: 'X', data: '2026-12-01', valor: 100 },
  }));
  await comApp(montarApp(fake, [['/api/financeiro', 'routes/financeiro.routes']]), async (chamar) => {
    const salvoSoComTela = { uid: 'f1', permissoes: ['financeiro.pagar', ...MARCADORES] };
    const casos = [
      ['/api/financeiro/pagar/lancar', 'financeiro.pagar_lancar', /lançar despesas no Contas a Pagar/],
      ['/api/financeiro/pagar/editar', 'financeiro.pagar_editar', /alterar despesas do Contas a Pagar/],
      ['/api/financeiro/pagar/cancelar', 'financeiro.pagar_cancelar', /cancelar despesas do Contas a Pagar/],
    ];
    for (const [rota, permissao, frase] of casos) {
      const barrado = await chamar(rota, salvoSoComTela, {});
      assert.equal(barrado.status, 403, rota);
      assert.match(barrado.corpo.error, frase);
      assert.match(barrado.corpo.error, /cadastro de funcionário/);
      const comEla = await chamar(rota, { uid: 'f2', permissoes: [permissao, ...MARCADORES] }, {});
      assert.equal(comEla.status, 400, `${rota}: passa da permissao e cai na validacao`);
      // Salvo so' com o pacote 1 (antes da fase 2): as novas vem com Contas a Pagar.
      const soPacote1 = await chamar(rota, { uid: 'f3', permissoes: ['financeiro.pagar', 'pacote.financeiro-1'] }, {});
      assert.equal(soPacote1.status, 400, `${rota} implicita`);
      const soReceber = await chamar(rota, { uid: 'f4', permissoes: ['financeiro.receber'] }, {});
      assert.equal(soReceber.status, 403, `${rota}: quem so tem Contas a Receber nao mexe no Pagar`);
    }
    const lancou = await chamar('/api/financeiro/pagar/lancar', { uid: 'u1', permissoes: ['financeiro.pagar'] }, despesa());
    assert.equal(lancou.status, 200, JSON.stringify(lancou.corpo));
    assert.equal(fake.ler('transacoes/desp_desp12345XYZ').status, 'Pendente');
    const cancelou = await chamar('/api/financeiro/pagar/cancelar', { uid: 'a1', permissoes: [], dono: true }, { transacaoId: 'd1', motivo: 'lancada em duplicidade' });
    assert.equal(cancelou.status, 200, 'administrador continua liberado nesta fase');
  });
});

test('rotas /receber/cheque e /receber/credito: dar baixa + credito do cliente; data anterior pede a sua', async () => {
  const fake = criarBancoFalso(contaDeVenda(creditos), { consultas: true });
  const hoje = getDateInputInTimeZone();
  const ontem = (() => { const d = new Date(`${hoje}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();
  await comApp(montarApp(fake, [['/api/financeiro', 'routes/financeiro.routes']]), async (chamar) => {
    const semCredito = { uid: 'f5', permissoes: ['financeiro.receber_baixar', ...MARCADORES] };
    const credito = await chamar('/api/financeiro/receber/credito', semCredito, { transacaoId: 't1', valorCentavos: 1000, dataPagamento: hoje });
    assert.equal(credito.status, 403);
    assert.match(credito.corpo.error, /abater contas com crédito do cliente/);
    assert.match(credito.corpo.error, /receba sem usar o crédito/);

    const semBaixa = { uid: 'f6', permissoes: ['financeiro.receber', ...MARCADORES] };
    const cheque = await chamar('/api/financeiro/receber/cheque', semBaixa, { transacaoId: 't1', dataCompensacao: hoje, cheque: { bancoEmissor: 'BB', numeroCheque: '1' } });
    assert.equal(cheque.status, 403);
    assert.match(cheque.corpo.error, /dar baixa em contas a receber/);

    const soTela = { uid: 'f7', permissoes: ['financeiro.receber'] };
    const anterior = await chamar('/api/financeiro/receber/credito', { uid: 'f8', permissoes: ['financeiro.receber_baixar', 'financeiro.baixa_credito_cliente', ...MARCADORES] }, { transacaoId: 't1', valorCentavos: 1000, dataPagamento: ontem });
    assert.equal(anterior.status, 403);
    assert.match(anterior.corpo.error, /data anterior a hoje/);

    const ok = await chamar('/api/financeiro/receber/credito', soTela, { transacaoId: 't1', valorCentavos: 1000, dataPagamento: hoje });
    assert.equal(ok.status, 200, JSON.stringify(ok.corpo));
    assert.equal(ok.corpo.restanteCentavos, 9000);
    const chequeOk = await chamar('/api/financeiro/receber/cheque', soTela, { transacaoId: 't1', dataCompensacao: hoje, cheque: { bancoEmissor: 'BB', numeroCheque: '77' } });
    assert.equal(chequeOk.status, 200, JSON.stringify(chequeOk.corpo));
    assert.equal(fake.ler('transacoes/t1').formaPagamento, 'Cheque');
  });
});

test('fiscal e compras: inutilizar e gerar pedido pedem a propria; quem emite nota / faz cotacao ja tem', async () => {
  const fake = criarBancoFalso(base());
  const app = montarApp(fake, [['/api/inutilizacoes', 'routes/inutilizacao.routes'], ['/api/compras', 'routes/compras.routes']]);
  await comApp(app, async (chamar) => {
    const salvoSemInutilizar = { uid: 'f9', permissoes: ['fiscal.emitir', ...MARCADORES] };
    const barrado = await chamar('/api/inutilizacoes', salvoSemInutilizar, {});
    assert.equal(barrado.status, 403);
    assert.match(barrado.corpo.error, /inutilizar numeração de notas/);
    assert.match(barrado.corpo.error, /"Fiscal: Inutilizar numeração"/);
    const implicita = await chamar('/api/inutilizacoes', { uid: 'f10', permissoes: ['fiscal.emitir', 'pacote.financeiro-1'] }, {});
    assert.notEqual(implicita.status, 403, 'quem emite nota e nao foi salvo de novo continua inutilizando');

    const salvoSemGerar = { uid: 'f11', permissoes: ['compras.cotacoes', ...MARCADORES] };
    const semGerar = await chamar('/api/compras/cotacoes/cot1/gerar-pedidos', salvoSemGerar, {});
    assert.equal(semGerar.status, 403);
    assert.match(semGerar.corpo.error, /gerar pedido de compra da cotação/);
    const gerarSemCotacao = await chamar('/api/compras/cotacoes/cot1/gerar-pedidos', { uid: 'f12', permissoes: ['compras.gerar_pedido', ...MARCADORES] }, {});
    assert.equal(gerarSemCotacao.status, 403, 'continua pedindo a da cotacao');
    const comAs2 = await chamar('/api/compras/cotacoes/cot1/gerar-pedidos', { uid: 'f13', permissoes: ['compras.cotacoes'] }, {});
    assert.notEqual(comAs2.status, 403, 'quem faz cotacao (sem o pacote 2) continua gerando');
  });
});
