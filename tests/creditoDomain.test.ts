import test from 'node:test';
import assert from 'node:assert/strict';
import {
  campoDoClienteDoCredito,
  coberturaDoEstornoDoCredito,
  creditoEhDoCliente,
  creditoFoiAlteradoDurante,
  distribuirConsumoCredito,
  juntarCreditosSemRepetir,
  excedeLimiteCredito,
  MENSAGEM_CREDITO_CONCORRENTE,
  parseCreditoVersao,
  parseTrabalhaComLimiteCredito,
  somarCreditosCentavos,
} from '../src/utils/creditoDomain';

test('excedeLimiteCredito bloqueia por sem_limite quando o cliente nao tem limite cadastrado', () => {
  assert.deepEqual(excedeLimiteCredito(null, 0, 10000), { bloqueado: true, motivo: 'sem_limite' });
  assert.deepEqual(excedeLimiteCredito(0, 0, 10000), { bloqueado: true, motivo: 'sem_limite' });
  assert.deepEqual(excedeLimiteCredito(undefined, 0, 10000), { bloqueado: true, motivo: 'sem_limite' });
});

test('excedeLimiteCredito libera quando saldo em aberto + venda cabe no limite', () => {
  // Limite de R$500 (50000 centavos), sem saldo em aberto, venda de R$100.
  assert.deepEqual(excedeLimiteCredito(50000, 0, 10000), { bloqueado: false, motivo: null });
});

test('excedeLimiteCredito bloqueia por limite_excedido quando saldo + venda estoura o limite', () => {
  // Limite de R$500, ja com R$450 em aberto, venda de R$100 estoura.
  assert.deepEqual(excedeLimiteCredito(50000, 45000, 10000), { bloqueado: true, motivo: 'limite_excedido' });
});

test('excedeLimiteCredito no limite exato nao bloqueia', () => {
  assert.deepEqual(excedeLimiteCredito(50000, 40000, 10000), { bloqueado: false, motivo: null });
});

test('excedeLimiteCredito ignora saldo/venda negativos na soma', () => {
  assert.deepEqual(excedeLimiteCredito(50000, -1000, 10000), { bloqueado: false, motivo: null });
});

test('parseTrabalhaComLimiteCredito so aceita true literal', () => {
  assert.equal(parseTrabalhaComLimiteCredito(true), true);
  assert.equal(parseTrabalhaComLimiteCredito(false), false);
  assert.equal(parseTrabalhaComLimiteCredito(undefined), false);
  assert.equal(parseTrabalhaComLimiteCredito('true'), false);
});

test('somarCreditosCentavos soma so o que e saldo positivo', () => {
  assert.equal(somarCreditosCentavos([]), 0);
  assert.equal(somarCreditosCentavos([
    { id: 'a', saldoDisponivelCentavos: 5000 },
    { id: 'b', saldoDisponivelCentavos: 2500 },
  ]), 7500);
  // Saldo negativo/invalido nunca aumenta nem diminui o total.
  assert.equal(somarCreditosCentavos([
    { id: 'a', saldoDisponivelCentavos: 5000 },
    { id: 'b', saldoDisponivelCentavos: -1000 },
    { id: 'c', saldoDisponivelCentavos: Number.NaN },
  ]), 5000);
});

test('distribuirConsumoCredito consome do primeiro credito da lista (mais antigo) antes de ir pro proximo', () => {
  const creditos = [
    { id: 'antigo', saldoDisponivelCentavos: 3000 },
    { id: 'novo', saldoDisponivelCentavos: 5000 },
  ];
  assert.deepEqual(distribuirConsumoCredito(creditos, 2000), [
    { id: 'antigo', usadoCentavos: 2000, saldoRestanteCentavos: 1000 },
  ]);
});

test('distribuirConsumoCredito atravessa varios creditos quando um nao cobre sozinho', () => {
  const creditos = [
    { id: 'antigo', saldoDisponivelCentavos: 3000 },
    { id: 'novo', saldoDisponivelCentavos: 5000 },
  ];
  assert.deepEqual(distribuirConsumoCredito(creditos, 4500), [
    { id: 'antigo', usadoCentavos: 3000, saldoRestanteCentavos: 0 },
    { id: 'novo', usadoCentavos: 1500, saldoRestanteCentavos: 3500 },
  ]);
});

test('distribuirConsumoCredito zera exatamente quando o valor consome tudo', () => {
  const creditos = [
    { id: 'a', saldoDisponivelCentavos: 3000 },
    { id: 'b', saldoDisponivelCentavos: 2000 },
  ];
  assert.deepEqual(distribuirConsumoCredito(creditos, 5000), [
    { id: 'a', usadoCentavos: 3000, saldoRestanteCentavos: 0 },
    { id: 'b', usadoCentavos: 2000, saldoRestanteCentavos: 0 },
  ]);
});

test('distribuirConsumoCredito RECUSA valor acima do saldo -- e dinheiro, melhor falhar que abater a mais', () => {
  const creditos = [{ id: 'a', saldoDisponivelCentavos: 3000 }];
  assert.throws(() => distribuirConsumoCredito(creditos, 3001), /saldo de crédito/i);
  assert.throws(() => distribuirConsumoCredito([], 100), /saldo de crédito/i);
});

test('distribuirConsumoCredito com valor zero ou negativo nao toca em credito nenhum', () => {
  const creditos = [{ id: 'a', saldoDisponivelCentavos: 3000 }];
  assert.deepEqual(distribuirConsumoCredito(creditos, 0), []);
  assert.deepEqual(distribuirConsumoCredito(creditos, -500), []);
});

test('distribuirConsumoCredito pula credito ja zerado sem quebrar a distribuicao', () => {
  const creditos = [
    { id: 'zerado', saldoDisponivelCentavos: 0 },
    { id: 'bom', saldoDisponivelCentavos: 4000 },
  ];
  assert.deepEqual(distribuirConsumoCredito(creditos, 1500), [
    { id: 'bom', usadoCentavos: 1500, saldoRestanteCentavos: 2500 },
  ]);
});

// ---------------------------------------------------------------------------
// Guarda de concorrencia da venda a prazo
// ---------------------------------------------------------------------------

test('cliente sem o campo de versao comeca em zero', () => {
  assert.equal(parseCreditoVersao(undefined), 0);
  assert.equal(parseCreditoVersao(null), 0);
});

test('versao corrompida nao derruba a venda, cai em zero', () => {
  assert.equal(parseCreditoVersao('abc'), 0);
  assert.equal(parseCreditoVersao(-7), 0);
  assert.equal(parseCreditoVersao(Number.NaN), 0);
  assert.equal(parseCreditoVersao(Number.POSITIVE_INFINITY), 0);
});

test('versao valida e preservada, inclusive vinda como texto', () => {
  assert.equal(parseCreditoVersao(12), 12);
  assert.equal(parseCreditoVersao('12'), 12);
  assert.equal(parseCreditoVersao(12.9), 12);
});

test('versao igual libera a gravacao', () => {
  assert.equal(creditoFoiAlteradoDurante(4, 4), false);
  // Cliente antigo: os dois lados caem em 0 e a venda passa normalmente.
  assert.equal(creditoFoiAlteradoDurante(0, undefined as unknown as number), false);
});

test('versao diferente bloqueia: outra venda a prazo entrou no meio', () => {
  assert.equal(creditoFoiAlteradoDurante(4, 5), true);
  assert.equal(creditoFoiAlteradoDurante(0, 1), true);
});

// A guarda existe porque o saldo em aberto vem de CONSULTA, e o SDK cliente
// do Firestore nao aceita consulta dentro de transacao. Sem ela, dois
// vendedores no mesmo cliente leem o mesmo saldo e os dois passam.
test('cenario da corrida: segunda venda para o mesmo cliente e barrada', () => {
  const limiteCents = 100_000;
  const saldoLidoPelosDois = 60_000;
  const valorDeCadaVenda = 30_000;

  // Os dois passam na checagem, porque leram o mesmo saldo.
  assert.equal(excedeLimiteCredito(limiteCents, saldoLidoPelosDois, valorDeCadaVenda).bloqueado, false);

  // O primeiro grava e leva a versao de 7 para 8. O segundo, que leu 7,
  // encontra 8 na hora de gravar e para -- sem a guarda, o total gravado
  // seria 120.000 num limite de 100.000.
  assert.equal(creditoFoiAlteradoDurante(7, 8), true);
});

test('mensagem da corrida diz que nada foi gravado e o que fazer', () => {
  assert.match(MENSAGEM_CREDITO_CONCORRENTE, /Nada foi gravado/);
  assert.match(MENSAGEM_CREDITO_CONCORRENTE, /finalize novamente/i);
  assert.doesNotMatch(MENSAGEM_CREDITO_CONCORRENTE, /Transaction|undefined|Firestore/i);
});

test('credito de devolucao guarda o codigo do cliente; sem codigo a chave fica fora (nunca undefined)', () => {
  assert.deepEqual(campoDoClienteDoCredito('c779'), { clienteId: 'c779' });
  assert.deepEqual(campoDoClienteDoCredito(' c779 '), { clienteId: 'c779' });
  assert.deepEqual(campoDoClienteDoCredito(undefined), {});
  assert.deepEqual(campoDoClienteDoCredito(null), {});
  assert.deepEqual(campoDoClienteDoCredito(''), {});
  assert.equal('clienteId' in campoDoClienteDoCredito(undefined), false);
});

test('de quem e o credito: com codigo vale o codigo; sem codigo vale o nome (caso do cliente renomeado)', () => {
  const cliente = { id: 'c779', nome: 'Algerico Alcides Concas' };
  // Caso real: credito gravado antes da renomeacao, ja com o codigo.
  assert.equal(creditoEhDoCliente({ clienteId: 'c779', clienteNome: 'ALGERICO CONCAS' }, cliente), true);
  // Outro cliente com o mesmo nome nao divide credito.
  assert.equal(creditoEhDoCliente({ clienteId: 'c999', clienteNome: 'ALGERICO ALCIDES CONCAS' }, cliente), false);
  // Credito antigo sem codigo: pelo nome, como sempre foi.
  assert.equal(creditoEhDoCliente({ clienteNome: 'ALGERICO ALCIDES CONCAS' }, cliente), true);
  assert.equal(creditoEhDoCliente({ clienteNome: 'ALGERICO CONCAS' }, cliente), false);
  // Cliente digitado sem cadastro: so' o nome.
  assert.equal(creditoEhDoCliente({ clienteNome: 'JOAO' }, { nome: 'joao' }), true);
  assert.equal(creditoEhDoCliente({ clienteId: 'c1', clienteNome: 'JOAO' }, { nome: 'JOAO' }), false);
  assert.equal(creditoEhDoCliente({ clienteNome: '' }, { nome: '' }), false);
});

test('estorno da devolucao: credito intacto nao precisa de cobertura', () => {
  const r = coberturaDoEstornoDoCredito({ valorEstornoCentavos: 10800, saldoDisponivelCentavos: 10800 }, [{ id: 'cancelamento_p180', saldoDisponivelCentavos: 10800 }]);
  assert.deepEqual(r, { doProprioCentavos: 10800, usadoCentavos: 0, cobertura: [], faltaCentavos: 0 });
});

test('estorno por quantidade (caso Jomarly: 1 de 4 clipes, R$ 27): sai do saldo proprio e, se nao houver, do cancelamento', () => {
  // Credito da devolucao gasto no #0180 (saldo 0); #0180 cancelado devolveu R$ 108.
  const r = coberturaDoEstornoDoCredito({ valorEstornoCentavos: 2700, saldoDisponivelCentavos: 0 }, [{ id: 'cancelamento_p180', saldoDisponivelCentavos: 10800 }]);
  assert.equal(r.doProprioCentavos, 0);
  assert.deepEqual(r.cobertura, [{ id: 'cancelamento_p180', usadoCentavos: 2700, saldoRestanteCentavos: 8100 }]);
  // Credito ainda com saldo: sai dele, sem tocar no cancelamento.
  const s = coberturaDoEstornoDoCredito({ valorEstornoCentavos: 2700, saldoDisponivelCentavos: 5000 }, [{ id: 'c', saldoDisponivelCentavos: 10800 }]);
  assert.deepEqual(s, { doProprioCentavos: 2700, usadoCentavos: 0, cobertura: [], faltaCentavos: 0 });
});

test('estorno da devolucao: credito usado numa venda cancelada sai do credito do cancelamento (caso Jomarly)', () => {
  const r = coberturaDoEstornoDoCredito({ valorEstornoCentavos: 10800, saldoDisponivelCentavos: 0 }, [{ id: 'cancelamento_p180', saldoDisponivelCentavos: 10800 }]);
  assert.equal(r.usadoCentavos, 10800);
  assert.equal(r.faltaCentavos, 0);
  assert.deepEqual(r.cobertura, [{ id: 'cancelamento_p180', usadoCentavos: 10800, saldoRestanteCentavos: 0 }]);
});

test('estorno da devolucao: parte usada coberta por mais de um cancelamento, o mais antigo primeiro; sobra fica com o cliente', () => {
  const r = coberturaDoEstornoDoCredito(
    { valorEstornoCentavos: 10000, saldoDisponivelCentavos: 4000 },
    [{ id: 'a', saldoDisponivelCentavos: 2500 }, { id: 'b', saldoDisponivelCentavos: 0 }, { id: 'c', saldoDisponivelCentavos: 5000 }],
  );
  assert.equal(r.usadoCentavos, 6000);
  assert.equal(r.faltaCentavos, 0);
  assert.deepEqual(r.cobertura, [
    { id: 'a', usadoCentavos: 2500, saldoRestanteCentavos: 0 },
    { id: 'c', usadoCentavos: 3500, saldoRestanteCentavos: 1500 },
  ]);
});

test('estorno da devolucao: cliente ja gastou o credito de volta -> falta e o estorno nao segue', () => {
  const r = coberturaDoEstornoDoCredito({ valorEstornoCentavos: 10800, saldoDisponivelCentavos: 0 }, [{ id: 'x', saldoDisponivelCentavos: 3000 }]);
  assert.equal(r.faltaCentavos, 7800);
  assert.equal(coberturaDoEstornoDoCredito({ valorEstornoCentavos: 10800, saldoDisponivelCentavos: 0 }, []).faltaCentavos, 10800);
});

test('as duas buscas (codigo e nome) se juntam sem repetir o credito', () => {
  const juntos = juntarCreditosSemRepetir([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }]);
  assert.deepEqual(juntos.map((c) => c.id), ['a', 'b', 'c']);
  assert.deepEqual(juntarCreditosSemRepetir(), []);
});
