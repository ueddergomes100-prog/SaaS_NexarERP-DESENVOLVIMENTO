const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

/*
 * Caixas e transferencias (21/10/2026): CAIXA e COFRE nascem sozinhos; caixa
 * nunca fica negativo; transferencia grava os dois lados e os dois saldos;
 * sangria do PDV para deposito credita o banco; cheque depositar/devolver.
 */

const carregar = (db) => {
  const [, , , caixas, cheque] = carregarComBancoFalso(db, 'services/caixas', 'services/chequeSituacao');
  return { caixas, cheque };
};

const USER = { uid: 'u1', email: 'u1@loja', tenantId: 'loja', permissoes: ['financeiro.caixas'] };
const HOJE = '2026-10-21';

const base = (extra = {}) => ({
  'bancos/b1': { tenantId: 'loja', nome: 'SICOOB', ativo: true, saldoCentavos: 100000 },
  'bancos/b2': { tenantId: 'loja', nome: 'BB', ativo: true, saldoCentavos: 0 },
  'usuarios/u1': { tenantId: 'loja', nome: 'UEDDER' },
  ...extra,
});

test('listar cria CAIXA e COFRE uma vez so; criar caixa com saldo inicial grava o primeiro lancamento', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  const r1 = await s.caixas.listar({ user: USER, tenantId: 'loja' });
  assert.deepEqual(r1.caixas.map((c) => c.nome), ['CAIXA', 'COFRE']);
  assert.deepEqual(r1.bancos.map((b) => b.nome), ['BB', 'SICOOB']);
  const r2 = await s.caixas.listar({ user: USER, tenantId: 'loja' });
  assert.equal(r2.caixas.length, 2, 'nao duplica');

  const novo = await s.caixas.salvar({ user: USER, tenantId: 'loja', corpo: { nome: 'caixa 2', saldoInicialCentavos: 5000 } });
  assert.equal(novo.nome, 'CAIXA 2');
  assert.equal(fake.ler(`caixas/${novo.id}`).saldoCentavos, 5000);
  assert.equal(fake.listar('lancamentos_caixa/').filter((l) => l.caixaId === novo.id)[0].tipo, 'saldo_inicial');
  await assert.rejects(() => s.caixas.salvar({ user: USER, tenantId: 'loja', corpo: { nome: 'cofre' } }), (e) => e.status === 409);
});

test('lancar a mao e transferir: caixa nunca negativo; par de lancamentos e saldos dos dois lados', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  const { caixas } = await s.caixas.listar({ user: USER, tenantId: 'loja' });
  const caixa = caixas.find((c) => c.nome === 'CAIXA');
  const cofre = caixas.find((c) => c.nome === 'COFRE');

  await assert.rejects(() => s.caixas.lancar({ user: USER, tenantId: 'loja', caixaId: caixa.id, corpo: { direcao: 'debito', valorCentavos: 100, descricao: 'x', data: HOJE } }), (e) => e.status === 409 && /CAIXA tem R\$ 0,00/.test(e.message));
  await s.caixas.lancar({ user: USER, tenantId: 'loja', caixaId: caixa.id, corpo: { direcao: 'credito', valorCentavos: 30000, descricao: 'Troco inicial', data: HOJE } });
  assert.equal(fake.ler(`caixas/${caixa.id}`).saldoCentavos, 30000);

  // Caixa -> banco (deposito).
  const t = await s.caixas.transferir({ user: USER, tenantId: 'loja', corpo: { origem: { tipo: 'caixa', id: caixa.id }, destino: { tipo: 'banco', id: 'b1' }, valorCentavos: 20000, data: HOJE, descricao: '' } });
  assert.equal(t.nomeOrigem, 'CAIXA');
  assert.equal(t.nomeDestino, 'SICOOB');
  assert.equal(fake.ler(`caixas/${caixa.id}`).saldoCentavos, 10000);
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 120000);
  const saida = fake.listar('lancamentos_caixa/').find((l) => l.tipo === 'transferencia_saida');
  const entrada = fake.listar('lancamentos_bancarios/').find((l) => l.tipo === 'transferencia_entrada');
  assert.equal(saida.descricao, 'Transferência para SICOOB');
  assert.equal(entrada.descricao, 'Transferência de CAIXA');
  assert.equal(entrada.bancoId, 'b1');

  // Banco -> caixa (suprimento) e caixa -> cofre.
  await s.caixas.transferir({ user: USER, tenantId: 'loja', corpo: { origem: { tipo: 'banco', id: 'b1' }, destino: { tipo: 'caixa', id: cofre.id }, valorCentavos: 50000, data: HOJE } });
  assert.equal(fake.ler(`caixas/${cofre.id}`).saldoCentavos, 50000);
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 70000);
  await assert.rejects(() => s.caixas.transferir({ user: USER, tenantId: 'loja', corpo: { origem: { tipo: 'caixa', id: caixa.id }, destino: { tipo: 'caixa', id: cofre.id }, valorCentavos: 10001, data: HOJE } }), (e) => e.status === 409);
  await s.caixas.transferir({ user: USER, tenantId: 'loja', corpo: { origem: { tipo: 'caixa', id: caixa.id }, destino: { tipo: 'caixa', id: cofre.id }, valorCentavos: 10000, data: HOJE } });
  assert.equal(fake.ler(`caixas/${caixa.id}`).saldoCentavos, 0);
  assert.equal(fake.ler(`caixas/${cofre.id}`).saldoCentavos, 60000);

  const extrato = await s.caixas.extrato({ tenantId: 'loja', caixaId: caixa.id });
  assert.equal(extrato.length, 3);
});

test('sangria do PDV para deposito credita o banco (caixa aberto)', async () => {
  const fake = criarBancoFalso(base({ 'caixas_pdv/s1': { tenantId: 'loja', status: 'aberto' }, 'caixas_pdv/s2': { tenantId: 'loja', status: 'fechado' } }), { consultas: true });
  const s = carregar(fake.db);
  const r = await s.caixas.sangriaParaDeposito({ user: USER, tenantId: 'loja', corpo: { bancoId: 'b2', valorCentavos: 25000, sessaoId: 's1', data: HOJE }, operadorNome: 'UEDDER' });
  assert.equal(r.bancoNome, 'BB');
  assert.equal(fake.ler('bancos/b2').saldoCentavos, 25000);
  const l = fake.listar('lancamentos_bancarios/')[0];
  assert.equal(l.tipo, 'deposito');
  assert.equal(l.descricao, 'Sangria do PDV para depósito — UEDDER');
  await assert.rejects(() => s.caixas.sangriaParaDeposito({ user: USER, tenantId: 'loja', corpo: { bancoId: 'b2', valorCentavos: 100, sessaoId: 's2', data: HOJE } }), (e) => e.status === 409);
});

test('cheque recebido: depositar escolhe o banco e marca; devolvido; voltar para a carteira; emitido nao', async () => {
  const fake = criarBancoFalso(base({
    'transacoes/ch1': { tenantId: 'loja', tipo: 'entrada', status: 'Pendente', descricao: 'Pedido #10 - Cheque', formaPagamento: 'Cheque', valorCentavos: 50000, cheque: { numeroCheque: '123', bancoEmissor: 'ITAU' } },
    'transacoes/ch2': { tenantId: 'loja', tipo: 'saida', status: 'Pendente', descricao: 'Fornecedor', formaPagamento: 'Cheque', valorCentavos: 100, cheque: { numeroCheque: '9' } },
  }), { consultas: true });
  const s = carregar(fake.db);
  await assert.rejects(() => s.cheque.depositarCheque({ user: USER, tenantId: 'loja', corpo: { transacaoId: 'ch1' }, hoje: HOJE }), (e) => e.status === 409 && /banco/.test(e.message));
  const r = await s.cheque.depositarCheque({ user: USER, tenantId: 'loja', corpo: { transacaoId: 'ch1', bancoId: 'b1' }, hoje: HOJE });
  assert.equal(r.bancoNome, 'SICOOB');
  const t = fake.ler('transacoes/ch1');
  assert.equal(t.cheque.situacao, 'depositado');
  assert.equal(t.cheque.depositadoEm, HOJE);
  assert.equal(t.bancoId, 'b1');
  assert.equal(t.status, 'Pendente', 'deposito nao compensa');
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 100000, 'deposito nao mexe no saldo');
  await assert.rejects(() => s.cheque.depositarCheque({ user: USER, tenantId: 'loja', corpo: { transacaoId: 'ch1', bancoId: 'b1' }, hoje: HOJE }), (e) => e.status === 409);
  await s.cheque.devolverCheque({ user: USER, tenantId: 'loja', corpo: { transacaoId: 'ch1', motivo: 'Sem fundos' }, hoje: HOJE });
  assert.equal(fake.ler('transacoes/ch1').cheque.situacao, 'devolvido');
  assert.equal(fake.ler('transacoes/ch1').cheque.motivoDevolucao, 'Sem fundos');
  await s.cheque.voltarChequeParaCarteira({ user: USER, tenantId: 'loja', corpo: { transacaoId: 'ch1' } });
  assert.equal(fake.ler('transacoes/ch1').cheque.situacao, 'em_carteira');
  // Cheque emitido (conta a pagar) nao passa nem pela leitura do titulo de entrada.
  await assert.rejects(() => s.cheque.depositarCheque({ user: USER, tenantId: 'loja', corpo: { transacaoId: 'ch2', bancoId: 'b1' }, hoje: HOJE }), (e) => e.status === 400);
});
