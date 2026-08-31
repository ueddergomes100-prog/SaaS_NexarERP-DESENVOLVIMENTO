import test from 'node:test';
import assert from 'node:assert/strict';
import {
  creditoFoiAlteradoDurante,
  distribuirConsumoCredito,
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
