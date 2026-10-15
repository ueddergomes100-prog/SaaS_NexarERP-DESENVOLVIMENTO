import assert from 'node:assert/strict';
import { test } from 'node:test';
import { centavosDoValorDigitado, descontoParaOTotalDigitado } from '../src/utils/totalDigitadoDomain';

test('valor digitado em reais vira centavos (850, 850,5, 1.000,00, R$, ponto decimal)', () => {
  assert.equal(centavosDoValorDigitado('850'), 85000);
  assert.equal(centavosDoValorDigitado('850,5'), 85050);
  assert.equal(centavosDoValorDigitado('1.000,00'), 100000);
  assert.equal(centavosDoValorDigitado('R$ 1.234,56'), 123456);
  assert.equal(centavosDoValorDigitado('1000.50'), 100050);
  assert.equal(centavosDoValorDigitado('1.000'), 100000, 'ponto de milhar sem virgula');
  assert.equal(centavosDoValorDigitado('12.500'), 1250000);
  assert.equal(centavosDoValorDigitado('850.5'), 85050);
  assert.equal(centavosDoValorDigitado('0'), 0);
  assert.ok(Number.isNaN(centavosDoValorDigitado('')));
  assert.ok(Number.isNaN(centavosDoValorDigitado('abc')));
  assert.ok(Number.isNaN(centavosDoValorDigitado('10,999')));
  assert.ok(Number.isNaN(centavosDoValorDigitado('-5')));
});

test('venda de 1.000 com total digitado de 850: desconto geral de 150 (o exemplo do cliente)', () => {
  assert.deepEqual(
    descontoParaOTotalDigitado({ subtotalCents: 100000, acrescimosCents: 0, totalDigitadoCents: 85000 }),
    { ok: true, descontoCents: 15000 },
  );
});

test('frete e encargos ficam fora do desconto', () => {
  // Itens 1.000 + frete 50 = 1.050; digitou 950 -> desconto 100 nos itens.
  assert.deepEqual(
    descontoParaOTotalDigitado({ subtotalCents: 100000, acrescimosCents: 5000, totalDigitadoCents: 95000 }),
    { ok: true, descontoCents: 10000 },
  );
  const abaixo = descontoParaOTotalDigitado({ subtotalCents: 100000, acrescimosCents: 5000, totalDigitadoCents: 4000 });
  assert.equal(abaixo.ok, false);
  assert.match(!abaixo.ok ? abaixo.erro : '', /abaixo de R\$\s?50,00/);
});

test('total igual ao cheio zera o desconto; maior que o cheio e recusado', () => {
  assert.deepEqual(descontoParaOTotalDigitado({ subtotalCents: 100000, acrescimosCents: 0, totalDigitadoCents: 100000 }), { ok: true, descontoCents: 0 });
  const maior = descontoParaOTotalDigitado({ subtotalCents: 100000, acrescimosCents: 0, totalDigitadoCents: 100001 });
  assert.equal(maior.ok, false);
  assert.match(!maior.ok ? maior.erro : '', /maior que o total sem desconto/);
});

test('total zero so com itens: desconto do valor todo dos itens; valor invalido e recusado', () => {
  assert.deepEqual(descontoParaOTotalDigitado({ subtotalCents: 2000, acrescimosCents: 0, totalDigitadoCents: 0 }), { ok: true, descontoCents: 2000 });
  assert.equal(descontoParaOTotalDigitado({ subtotalCents: 2000, acrescimosCents: 0, totalDigitadoCents: Number.NaN }).ok, false);
});
