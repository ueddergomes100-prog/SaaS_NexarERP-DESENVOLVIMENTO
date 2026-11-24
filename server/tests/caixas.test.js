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

/*
 * Dinheiro das vendas na gaveta (23/11/2026, Embala Minas): com a chave da
 * empresa ligada, o CAIXA soma os titulos pagos em dinheiro, as sangrias e a
 * diferenca do fechamento do PDV -- montados dos documentos.
 */
const { getDateInputInTimeZone, addDaysToDateInput } = require('../domain/dateTime');

const baseDaGaveta = (extra = {}) => {
  const hoje = getDateInputInTimeZone();
  const ontem = addDaysToDateInput(hoje, -1);
  const antes = addDaysToDateInput(hoje, -3);
  return base({
    'configuracoes/loja': { tenantId: 'loja', gavetaDinheiro: { ativo: true, desde: ontem } },
    // Venda em dinheiro no PDV e no pedido de venda; conta paga em dinheiro; venda cancelada + estorno.
    'transacoes/pdv': { tenantId: 'loja', tipo: 'entrada', status: 'Paga', formaPagamento: 'Dinheiro', movimentaCaixaFisico: true, valorCentavos: 30000, descricao: 'Venda Direta #0031 - Dinheiro', dataPagamento: hoje, data: hoje, pdvSessionId: 's1' },
    'transacoes/pedido': { tenantId: 'loja', tipo: 'entrada', status: 'Paga', formaPagamento: 'Dinheiro', movimentaCaixaFisico: true, valorCentavos: 20000, descricao: 'Pedido #0032 - Dinheiro', dataPagamento: ontem, data: ontem },
    'transacoes/despesa': { tenantId: 'loja', tipo: 'saida', status: 'Paga', formaPagamento: 'Dinheiro', movimentaCaixaFisico: true, valorCentavos: 4000, descricao: 'Motoboy', dataPagamento: hoje, data: hoje },
    'transacoes/cancelada': { tenantId: 'loja', tipo: 'entrada', status: 'Paga', formaPagamento: 'Dinheiro', movimentaCaixaFisico: true, valorCentavos: 9000, descricao: 'Venda Direta #0033 - Dinheiro', dataPagamento: hoje, data: hoje, estornada: true },
    'transacoes/estorno': { tenantId: 'loja', tipo: 'saida', status: 'Paga', formaPagamento: 'Dinheiro', movimentaCaixaFisico: true, valorCentavos: 9000, descricao: 'Estorno da venda #0033', data: hoje },
    // Fora: pix, em aberto, antes de ligar a chave, outra empresa.
    'transacoes/pix': { tenantId: 'loja', tipo: 'entrada', status: 'Paga', formaPagamento: 'Pix', movimentaCaixaFisico: false, valorCentavos: 77700, dataPagamento: hoje, data: hoje },
    'transacoes/aberta': { tenantId: 'loja', tipo: 'entrada', status: 'Pendente', formaPagamento: 'Dinheiro', valorCentavos: 55500, data: hoje },
    'transacoes/antiga': { tenantId: 'loja', tipo: 'entrada', status: 'Paga', formaPagamento: 'Dinheiro', movimentaCaixaFisico: true, valorCentavos: 99900, dataPagamento: antes, data: antes },
    'transacoes/vizinha': { tenantId: 'outra', tipo: 'entrada', status: 'Paga', formaPagamento: 'Dinheiro', movimentaCaixaFisico: true, valorCentavos: 11100, dataPagamento: hoje, data: hoje },
    // Caixa aberto com sangria; caixa fechado agora ha pouco pela gaveta com falta de R$ 2,50.
    'caixas_pdv/s1': { tenantId: 'loja', status: 'aberto', operadorNome: 'CAIXA', terminalNome: 'Caixa 1', sangrias: [{ id: 'g1', valorCentavos: 5000, motivo: 'Troco', registradoEm: new Date().toISOString() }], totalSangriasCentavos: 5000 },
    'caixas_pdv/s0': { tenantId: 'loja', status: 'fechado', operadorNome: 'CAIXA', sangrias: [], diferencaCentavos: -250, fechamentoPelaGaveta: true, fechadoEm: new Date() },
    ...extra,
  });
};

// 300,00 + 200,00 - 40,00 + (90,00 - 90,00) - 50,00 de sangria - 2,50 de falta.
const MONTADO = 30000 + 20000 - 4000 - 5000 - 250;

test('gaveta ligada: o CAIXA soma dinheiro das vendas, sangria e diferenca; COFRE nao muda', async () => {
  const fake = criarBancoFalso(baseDaGaveta(), { consultas: true });
  const s = carregar(fake.db);
  const r = await s.caixas.listar({ user: USER, tenantId: 'loja' });
  const caixa = r.caixas.find((c) => c.nome === 'CAIXA');
  const cofre = r.caixas.find((c) => c.nome === 'COFRE');
  assert.equal(r.gaveta.ativo, true);
  assert.equal(caixa.saldoCentavos, MONTADO);
  assert.equal(caixa.recebeDinheiroDasVendas, true);
  assert.equal(cofre.saldoCentavos, 0);
  assert.equal(cofre.recebeDinheiroDasVendas, undefined);
  assert.equal(fake.ler(`caixas/${caixa.id}`).saldoCentavos, 0, 'nada e gravado no caixa: e montado dos documentos');

  const extrato = await s.caixas.extrato({ tenantId: 'loja', caixaId: caixa.id });
  const tipos = extrato.map((l) => l.tipo);
  assert.equal(tipos.filter((t) => t === 'dinheiro_entrada').length, 3);
  assert.equal(tipos.filter((t) => t === 'dinheiro_saida').length, 2);
  assert.equal(tipos.filter((t) => t === 'sangria_pdv').length, 1);
  assert.equal(tipos.filter((t) => t === 'diferenca_fechamento').length, 1);
  assert.ok(!extrato.some((l) => /antiga|vizinha/.test(l.id)), 'antes da chave e outra empresa ficam fora');
  assert.deepEqual(await s.caixas.extrato({ tenantId: 'loja', caixaId: cofre.id }), [], 'o extrato do COFRE nao recebe as vendas');
});

test('gaveta ligada: transferir para o cofre usa o dinheiro das vendas; alem do saldo e recusado', async () => {
  const fake = criarBancoFalso(baseDaGaveta({ 'caixas_pdv/s0': { tenantId: 'loja', status: 'fechado', sangrias: [], diferencaCentavos: 0, fechamentoPelaGaveta: true, fechadoEm: new Date() } }), { consultas: true });
  const s = carregar(fake.db);
  const { caixas } = await s.caixas.listar({ user: USER, tenantId: 'loja' });
  const caixa = caixas.find((c) => c.nome === 'CAIXA');
  const cofre = caixas.find((c) => c.nome === 'COFRE');
  const disponivel = 30000 + 20000 - 4000 - 5000;
  assert.equal(caixa.saldoCentavos, disponivel);
  const hoje = getDateInputInTimeZone();

  await assert.rejects(
    () => s.caixas.transferir({ user: USER, tenantId: 'loja', corpo: { origem: { tipo: 'caixa', id: caixa.id }, destino: { tipo: 'caixa', id: cofre.id }, valorCentavos: disponivel + 1, data: hoje } }),
    (e) => e.status === 409 && /CAIXA tem R\$ 410,00/.test(e.message),
  );
  await s.caixas.transferir({ user: USER, tenantId: 'loja', corpo: { origem: { tipo: 'caixa', id: caixa.id }, destino: { tipo: 'caixa', id: cofre.id }, valorCentavos: 40000, data: hoje } });
  assert.equal(fake.ler(`caixas/${cofre.id}`).saldoCentavos, 40000);
  const depois = await s.caixas.listar({ user: USER, tenantId: 'loja' });
  assert.equal(depois.caixas.find((c) => c.nome === 'CAIXA').saldoCentavos, disponivel - 40000);
  assert.equal(depois.caixas.find((c) => c.nome === 'COFRE').saldoCentavos, 40000);
  // Lancamento de saida a mao tambem enxerga o dinheiro das vendas.
  await s.caixas.lancar({ user: USER, tenantId: 'loja', caixaId: caixa.id, corpo: { direcao: 'debito', valorCentavos: 1000, descricao: 'Acerto', data: hoje } });
  await assert.rejects(() => s.caixas.lancar({ user: USER, tenantId: 'loja', caixaId: caixa.id, corpo: { direcao: 'debito', valorCentavos: 1, descricao: 'Acerto', data: hoje } }), (e) => e.status === 409);

  const resumo = await s.caixas.resumoDaGaveta({ user: USER, tenantId: 'loja' });
  assert.deepEqual([resumo.ativo, resumo.caixaNome, resumo.saldoCentavos, resumo.caixasAbertos], [true, 'CAIXA', 0, 1]);
});

test('gaveta desligada: tudo como antes (venda em dinheiro nao entra no CAIXA)', async () => {
  const fake = criarBancoFalso(baseDaGaveta({ 'configuracoes/loja': { tenantId: 'loja' } }), { consultas: true });
  const s = carregar(fake.db);
  const r = await s.caixas.listar({ user: USER, tenantId: 'loja' });
  const caixa = r.caixas.find((c) => c.nome === 'CAIXA');
  assert.equal(r.gaveta.ativo, false);
  assert.equal(caixa.saldoCentavos, 0);
  assert.deepEqual(await s.caixas.extrato({ tenantId: 'loja', caixaId: caixa.id }), []);
  const resumo = await s.caixas.resumoDaGaveta({ user: USER, tenantId: 'loja' });
  assert.deepEqual([resumo.ativo, resumo.saldoCentavos], [false, null]);
  await assert.rejects(() => s.caixas.transferir({ user: USER, tenantId: 'loja', corpo: { origem: { tipo: 'caixa', id: caixa.id }, destino: { tipo: 'banco', id: 'b1' }, valorCentavos: 100, data: getDateInputInTimeZone() } }), (e) => e.status === 409);
});

/*
 * O que compoe o "Esperado agora", acerto de um dia anterior, troco e COFRE no
 * fechamento, diferenca na abertura (pedido do dono, 24/11/2026, Embala Minas).
 */
const semFechamentoDeHoje = (extra = {}) => baseDaGaveta({ 'caixas_pdv/s0': { tenantId: 'loja', status: 'fechado', sangrias: [], diferencaCentavos: 0, fechadoEm: new Date(Date.now() - 40 * 86400000) }, ...extra });

test('composicao: separa por dia e a soma bate com o saldo da gaveta', async () => {
  const hoje = getDateInputInTimeZone();
  const ontem = addDaysToDateInput(hoje, -1);
  const fake = criarBancoFalso(semFechamentoDeHoje(), { consultas: true });
  const s = carregar(fake.db);
  const c = await s.caixas.composicaoDaGaveta({ user: USER, tenantId: 'loja' });
  assert.equal(c.ativo, true);
  assert.equal(c.inicio, ontem, 'sem conferencia, comeca no dia em que a chave foi ligada');
  assert.deepEqual(c.dias.map((d) => d.data), [ontem, hoje]);
  assert.equal(c.saldoAnteriorCentavos, 0);
  assert.equal(c.dias[0].liquidoCentavos, 20000);
  assert.equal(c.dias[1].saldoNoFimCentavos, c.saldoCentavos);
  assert.equal(c.saldoCentavos, 30000 + 20000 - 4000 - 5000);
  assert.equal(c.saldoAnteriorCentavos + c.dias.reduce((soma, d) => soma + d.liquidoCentavos, 0), c.saldoCentavos);

  // Fechamento pela gaveta hoje: os dias anteriores viram uma linha so'.
  const fake2 = criarBancoFalso(baseDaGaveta(), { consultas: true });
  const c2 = await carregar(fake2.db).caixas.composicaoDaGaveta({ user: USER, tenantId: 'loja' });
  assert.equal(c2.inicio, hoje);
  assert.equal(c2.saldoAnteriorCentavos, 20000);
  assert.deepEqual(c2.dias.map((d) => d.data), [hoje]);
  assert.equal(c2.saldoCentavos, MONTADO);

  const desligada = criarBancoFalso(baseDaGaveta({ 'configuracoes/loja': { tenantId: 'loja' } }), { consultas: true });
  assert.deepEqual(await carregar(desligada.db).caixas.composicaoDaGaveta({ user: USER, tenantId: 'loja' }), { ativo: false });
});

test('saldo da gaveta no fim de um dia anterior', async () => {
  const ontem = addDaysToDateInput(getDateInputInTimeZone(), -1);
  const fake = criarBancoFalso(baseDaGaveta(), { consultas: true });
  const s = carregar(fake.db);
  const r = await s.caixas.resumoDaGaveta({ user: USER, tenantId: 'loja', ate: ontem });
  assert.deepEqual([r.ate, r.saldoCentavos], [ontem, 20000]);
  const agora = await s.caixas.resumoDaGaveta({ user: USER, tenantId: 'loja', ate: getDateInputInTimeZone() });
  assert.deepEqual([agora.ate, agora.saldoCentavos], ['', MONTADO], 'hoje = saldo de agora');
});

test('acerto de ontem: falta com a data de ontem, resto ao COFRE, hoje parte do troco', async () => {
  const hoje = getDateInputInTimeZone();
  const ontem = addDaysToDateInput(hoje, -1);
  const fake = criarBancoFalso(semFechamentoDeHoje(), { consultas: true });
  const s = carregar(fake.db);
  await assert.rejects(() => s.caixas.acertarDiaDaGaveta({ user: USER, tenantId: 'loja', corpo: { data: hoje, contadoCentavos: 0, trocoCentavos: 0 } }), (e) => e.status === 400);
  await assert.rejects(() => s.caixas.acertarDiaDaGaveta({ user: USER, tenantId: 'loja', corpo: { data: ontem, contadoCentavos: 100, trocoCentavos: 200 } }), (e) => e.status === 400 && /troco/.test(e.message));
  await assert.rejects(() => s.caixas.acertarDiaDaGaveta({ user: USER, tenantId: 'loja', corpo: { data: addDaysToDateInput(hoje, -5), contadoCentavos: 0, trocoCentavos: 0 } }), (e) => e.status === 400, 'antes de ligar a chave');

  // Sistema: R$ 200,00 no fim de ontem. Contou R$ 190,00, deixou R$ 50,00 de troco.
  const r = await s.caixas.acertarDiaDaGaveta({ user: USER, tenantId: 'loja', corpo: { data: ontem, contadoCentavos: 19000, trocoCentavos: 5000 } });
  assert.deepEqual([r.saldoDoSistemaCentavos, r.diferencaCentavos, r.paraCofreCentavos, r.cofreNome], [20000, -1000, 14000, 'COFRE']);
  const lancamentos = fake.listar('lancamentos_caixa/');
  const falta = lancamentos.find((l) => l.tipo === 'acerto_gaveta');
  assert.deepEqual([falta.direcao, falta.valorCentavos, falta.data], ['debito', 1000, ontem]);
  assert.ok(lancamentos.some((l) => l.tipo === 'transferencia_saida' && l.valorCentavos === 14000 && l.data === ontem));

  const { caixas } = await s.caixas.listar({ user: USER, tenantId: 'loja' });
  assert.equal(caixas.find((c) => c.nome === 'COFRE').saldoCentavos, 14000);
  const noFimDeOntem = await s.caixas.resumoDaGaveta({ user: USER, tenantId: 'loja', ate: ontem });
  assert.equal(noFimDeOntem.saldoCentavos, 5000, 'ontem fechou com o troco');
  const c = await s.caixas.composicaoDaGaveta({ user: USER, tenantId: 'loja' });
  assert.equal(c.inicio, ontem);
  assert.equal(c.dias[0].saldoNoFimCentavos, 5000);
  assert.equal(c.saldoCentavos, 5000 + 30000 - 4000 - 5000);
});

test('fechamento: troco fica, o resto vai ao COFRE com a data do fechamento; uma vez so', async () => {
  const ontem = addDaysToDateInput(getDateInputInTimeZone(), -1);
  const fechadoOntem = new Date(`${ontem}T22:00:00-03:00`);
  const fake = criarBancoFalso(semFechamentoDeHoje({
    'caixas_pdv/s9': { tenantId: 'loja', status: 'fechado', operadorNome: 'CAIXA', terminalNome: 'Caixa 1', sangrias: [], saldoFinalInformadoCentavos: 20000, diferencaCentavos: 0, fechamentoPelaGaveta: true, fechadoEm: fechadoOntem },
  }), { consultas: true });
  const s = carregar(fake.db);
  await assert.rejects(() => s.caixas.cofreNoFechamento({ user: USER, tenantId: 'loja', corpo: { sessaoId: 's1', trocoCentavos: 0 } }), (e) => e.status === 409, 'caixa aberto');
  await assert.rejects(() => s.caixas.cofreNoFechamento({ user: USER, tenantId: 'loja', corpo: { sessaoId: 's9', trocoCentavos: 20001 } }), (e) => e.status === 400);

  const r = await s.caixas.cofreNoFechamento({ user: USER, tenantId: 'loja', corpo: { sessaoId: 's9', trocoCentavos: 5000 } });
  assert.deepEqual([r.jaFeito, r.valorCentavos, r.cofreNome], [false, 15000, 'COFRE']);
  const saida = fake.listar('lancamentos_caixa/').find((l) => l.tipo === 'transferencia_saida');
  assert.deepEqual([saida.valorCentavos, saida.data], [15000, ontem]);
  assert.match(saida.descricao, /Fechamento do caixa \(Caixa 1\)/);
  assert.equal(fake.ler('caixas_pdv/s9').cofreNoFechamento.trocoCentavos, 5000);

  const repetido = await s.caixas.cofreNoFechamento({ user: USER, tenantId: 'loja', corpo: { sessaoId: 's9', trocoCentavos: 0 } });
  assert.deepEqual([repetido.jaFeito, repetido.valorCentavos], [true, 15000]);
  assert.equal(fake.listar('lancamentos_caixa/').filter((l) => l.tipo === 'transferencia_saida').length, 1, 'nao manda duas vezes');
});

test('abertura conferida contra a gaveta: a diferenca entra no saldo', async () => {
  const fake = criarBancoFalso(baseDaGaveta({
    'caixas_pdv/s1': { tenantId: 'loja', status: 'aberto', operadorNome: 'CAIXA', sangrias: [], totalSangriasCentavos: 0, aberturaPelaGaveta: true, diferencaAberturaCentavos: -3000, createdAt: new Date() },
  }), { consultas: true });
  const s = carregar(fake.db);
  const resumo = await s.caixas.resumoDaGaveta({ user: USER, tenantId: 'loja' });
  assert.equal(resumo.saldoCentavos, 30000 + 20000 - 4000 - 250 - 3000);
  const extrato = await s.caixas.extrato({ tenantId: 'loja', caixaId: resumo.caixaId });
  const abertura = extrato.find((l) => l.tipo === 'diferenca_abertura');
  assert.equal(abertura.direcao, 'debito');
  assert.match(abertura.descricao, /Falta na abertura do caixa/);
});
