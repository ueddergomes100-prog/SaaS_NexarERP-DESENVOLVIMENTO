const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

/*
 * Alterar o valor de uma parcela a receber (15/10/2026): nota com o valor da
 * venda, boleto com desconto. Firestore falso em memoria: nenhum banco e' tocado.
 */
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

const HOJE = '2026-10-15';
const USER = { uid: 'u1', email: 'u1@teste', tenantId: 'emp1', permissoes: ['financeiro.alterar_valor_documento'] };

const carregar = (db) => {
  const [baixa, , , alteracao] = carregarComBancoFalso(db, 'services/alteracaoValorTitulo');
  return { baixa, alteracao };
};

const vendaComBoleto = () => ({
  'transacoes/t1': {
    tenantId: 'emp1', tipo: 'entrada', status: 'Pendente', descricao: 'Venda Direta #12 - Boleto',
    valor: 100, valorCentavos: 10000, valorBruto: 100, valorBrutoCentavos: 10000, valorLiquido: 100, valorLiquidoCentavos: 10000,
    formaPagamento: 'Boleto', pedidoId: 'p12', paymentIndex: 1,
  },
  'pedidos_venda/p12': {
    tenantId: 'emp1', status: 'Finalizada',
    pagamentos: [{ id: 'p12', indice: 1, formaPagamento: 'Boleto', condicaoPagamento: 'aprazo', valorCentavos: 10000, valor: 100, status: 'pendente', naturezaFinanceira: 'boleto', movimentaCaixaFisico: false, transactionId: 't1' }],
  },
  'bancos/b1': { tenantId: 'emp1', nome: 'Sicoob', ativo: true, saldoCentavos: 0 },
});

test('pedido do navegador: parcela, valor em centavos e motivo', () => {
  const fake = criarBancoFalso({});
  const { alteracao } = carregar(fake.db);
  assert.deepEqual(alteracao.validarPedidoDeAlteracaoDeValor({ transacaoId: 't1', novoValorCentavos: 9000, motivo: ' desconto no boleto ' }).pedido, { transacaoId: 't1', novoValorCentavos: 9000, motivo: 'desconto no boleto' });
  assert.match(alteracao.validarPedidoDeAlteracaoDeValor({ transacaoId: '../x', novoValorCentavos: 9000, motivo: 'desconto' }).erro, /Parcela inválida/);
  assert.match(alteracao.validarPedidoDeAlteracaoDeValor({ transacaoId: 't1', novoValorCentavos: 90.5, motivo: 'desconto' }).erro, /maior que zero/);
  assert.match(alteracao.validarPedidoDeAlteracaoDeValor({ transacaoId: 't1', novoValorCentavos: 9000, motivo: 'ok' }).erro, /motivo/);
});

test('altera so\' o titulo, grava quem/por que; a baixa depois quita a venda inteira', async () => {
  const fake = criarBancoFalso(vendaComBoleto());
  const { baixa, alteracao } = carregar(fake.db);

  const pedido = alteracao.validarPedidoDeAlteracaoDeValor({ transacaoId: 't1', novoValorCentavos: 9000, motivo: 'desconto combinado no boleto' }).pedido;
  const resumo = await alteracao.alterarValorDoTitulo({ user: USER, tenantId: 'emp1', pedido });
  assert.deepEqual(resumo, { descricao: 'Venda Direta #12 - Boleto', deCentavos: 10000, paraCentavos: 9000 });

  const titulo = fake.ler('transacoes/t1');
  assert.equal(titulo.valorCentavos, 9000);
  assert.equal(titulo.valor, 90);
  assert.equal(titulo.valorBrutoCentavos, 10000, 'o bruto fica como nasceu');
  assert.equal(titulo.alteracaoValor.diferencaCentavos, -1000);
  assert.equal(titulo.alteracaoValor.motivo, 'desconto combinado no boleto');
  assert.equal(titulo.alteracaoValor.porUid, 'u1');
  assert.ok(titulo.alteracaoValor.em, 'data da alteracao gravada pelo servidor');
  assert.equal(fake.ler('pedidos_venda/p12').pagamentos[0].valorCentavos, 10000, 'a venda nao muda');

  const pedidoBaixa = baixa.validarPedidoDeBaixa({ tipo: 'entrada', transacaoId: 't1', formaPagamento: 'Pix', dataPagamento: HOJE, bancoId: 'b1' }, HOJE).pedido;
  await baixa.registrarBaixa({ user: USER, tenantId: 'emp1', pedido: pedidoBaixa });
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 9000, 'entra no banco o valor da parcela');
  const venda = fake.ler('pedidos_venda/p12');
  assert.equal(venda.statusPagamento, 'Paga', 'nada de venda "Parcial" para sempre');
  assert.equal(venda.totalPendenteCentavos, 0);
  assert.equal(venda.pagamentos.length, 1);

  // Estorno volta tudo para pendente, com o valor alterado mantido na parcela.
  const estorno = baixa.validarPedidoDeEstorno({ tipo: 'entrada', transacaoId: 't1', motivo: 'baixa no dia errado' }).pedido;
  await baixa.registrarEstorno({ user: USER, tenantId: 'emp1', pedido: estorno });
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 0);
  assert.equal(fake.ler('transacoes/t1').valorCentavos, 9000);
  assert.equal(fake.ler('pedidos_venda/p12').statusPagamento, 'Pendente');
});

test('acrescimo tambem: parcela maior que a venda quita a venda sem estourar', async () => {
  const fake = criarBancoFalso(vendaComBoleto());
  const { baixa, alteracao } = carregar(fake.db);
  await alteracao.alterarValorDoTitulo({ user: USER, tenantId: 'emp1', pedido: { transacaoId: 't1', novoValorCentavos: 10500, motivo: 'frete cobrado no boleto' } });
  const pedidoBaixa = baixa.validarPedidoDeBaixa({ tipo: 'entrada', transacaoId: 't1', formaPagamento: 'Pix', dataPagamento: HOJE, bancoId: 'b1' }, HOJE).pedido;
  await baixa.registrarBaixa({ user: USER, tenantId: 'emp1', pedido: pedidoBaixa });
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 10500);
  assert.equal(fake.ler('pedidos_venda/p12').statusPagamento, 'Paga');
});

test('bloqueios: boleto emitido, recebida, venda cancelada, outra empresa -- sem gravar nada', async () => {
  const base = vendaComBoleto();
  const fake = criarBancoFalso({
    ...base,
    'transacoes/comBoleto': { ...base['transacoes/t1'], boleto: { status: 'emitido', nossoNumero: '0000042' } },
    'transacoes/paga': { ...base['transacoes/t1'], status: 'Paga' },
    'transacoes/daCancelada': { ...base['transacoes/t1'], pedidoId: 'p99' },
    'pedidos_venda/p99': { tenantId: 'emp1', status: 'Cancelada', pagamentos: [] },
    'transacoes/deOutra': { ...base['transacoes/t1'], tenantId: 'emp2' },
  });
  const { alteracao } = carregar(fake.db);
  const alterar = (transacaoId) => alteracao.alterarValorDoTitulo({ user: USER, tenantId: 'emp1', pedido: { transacaoId, novoValorCentavos: 9000, motivo: 'desconto no boleto' } });

  await assert.rejects(() => alterar('comBoleto'), (e) => e.status === 400 && /desfaça a emissão/.test(e.message));
  await assert.rejects(() => alterar('paga'), (e) => e.status === 409 && /estorne/.test(e.message));
  await assert.rejects(() => alterar('daCancelada'), (e) => e.status === 400 && /venda desta parcela está cancelada/.test(e.message));
  await assert.rejects(() => alterar('deOutra'), (e) => e.status === 404);
  await assert.rejects(
    () => alteracao.alterarValorDoTitulo({ user: USER, tenantId: 'emp1', pedido: { transacaoId: 't1', novoValorCentavos: 10000, motivo: 'mesmo valor' } }),
    (e) => e.status === 400 && /igual ao valor atual/.test(e.message),
  );
  for (const id of ['comBoleto', 'paga', 'daCancelada', 'deOutra', 't1']) {
    assert.equal(fake.ler(`transacoes/${id}`).valorCentavos, 10000, `${id} nao mudou`);
    assert.equal(fake.ler(`transacoes/${id}`).alteracaoValor, undefined);
  }
});

// ---------------------------------------------------------------------------
// Rota: permissao do cadastro do usuario
// ---------------------------------------------------------------------------

test('rota: sem a permissao recebe 403 em portugues; com ela, altera e registra no log', async () => {
  const fake = criarBancoFalso(vendaComBoleto());
  carregarComBancoFalso(fake.db, 'services/alteracaoValorTitulo');
  const base = path.join(__dirname, '..');
  const substituir = (modulo, exportado) => {
    const caminho = require.resolve(path.join(base, modulo));
    require.cache[caminho] = { id: caminho, filename: caminho, loaded: true, exports: exportado };
  };
  const logs = [];
  substituir('middleware/auth', {
    authenticate: (req, res, next) => { req.user = JSON.parse(req.headers['x-usuario-teste'] || '{}'); next(); },
  });
  substituir('services/auditoria', { registrarLog: (usuario, dados) => logs.push(dados) });
  const rotaCaminho = require.resolve(path.join(base, 'routes/financeiro.routes'));
  delete require.cache[rotaCaminho];
  const app = express();
  app.use(express.json());
  app.use('/api/financeiro', require(rotaCaminho));

  const servidor = app.listen(0);
  try {
    const { port } = servidor.address();
    const chamar = (usuario, corpo) => fetch(`http://127.0.0.1:${port}/api/financeiro/alterar-valor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-usuario-teste': JSON.stringify(usuario) },
      body: JSON.stringify(corpo),
    });
    const corpo = { transacaoId: 't1', novoValorCentavos: 9000, motivo: 'desconto combinado no boleto' };

    const semPermissao = await chamar({ uid: 'v1', tenantId: 'emp1', permissoes: ['financeiro.receber'] }, corpo);
    assert.equal(semPermissao.status, 403);
    assert.match((await semPermissao.json()).error, /Alterar Valor de Documentos/);
    assert.equal(fake.ler('transacoes/t1').valorCentavos, 10000);

    const semMotivo = await chamar(USER, { ...corpo, motivo: '' });
    assert.equal(semMotivo.status, 400);

    const gerente = await chamar({ uid: 'g1', tenantId: 'emp1', permissoes: [], isTenantManager: true }, corpo);
    assert.equal(gerente.status, 200);
    assert.equal(fake.ler('transacoes/t1').valorCentavos, 9000);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].critico, true);
    assert.match(logs[0].descricao, /alterado de R\$ 100,00 para R\$ 90,00\. Motivo: desconto combinado no boleto/);
  } finally {
    servidor.close();
  }
});
