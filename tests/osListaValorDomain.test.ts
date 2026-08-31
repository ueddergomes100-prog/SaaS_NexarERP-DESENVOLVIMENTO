import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_MOSTRAR_VALOR_LISTA_OS,
  formatarValorListaOS,
  parseMostrarValorListaOS,
  resolverValorListaOS,
} from '../src/utils/osListaValorDomain';

test('a coluna vem ligada por padrao', () => {
  assert.equal(DEFAULT_MOSTRAR_VALOR_LISTA_OS, true);
});

test('so false explicito desliga a coluna', () => {
  assert.equal(parseMostrarValorListaOS(false), false);
  // Empresa que nunca abriu a configuracao nao tem o campo gravado.
  assert.equal(parseMostrarValorListaOS(undefined), true);
  assert.equal(parseMostrarValorListaOS(null), true);
  assert.equal(parseMostrarValorListaOS(true), true);
  // 'false' string vinda de formulario nao e' false.
  assert.equal(parseMostrarValorListaOS('false'), true);
});

test('centavos vencem reais -- e o mesmo numero, sem erro de ponto flutuante', () => {
  assert.equal(resolverValorListaOS({ valorTotalCentavos: 15050, valorTotal: 150.5 }), 150.5);
  assert.equal(resolverValorListaOS({ valorTotalCentavos: 1 }), 0.01);
});

test('OS antiga, gravada antes dos centavos, cai no valorTotal', () => {
  assert.equal(resolverValorListaOS({ valorTotal: 320 }), 320);
});

test('OS sem valor nenhum vale zero, sem quebrar', () => {
  assert.equal(resolverValorListaOS({}), 0);
  assert.equal(resolverValorListaOS(null), 0);
  assert.equal(resolverValorListaOS({ valorTotal: 'abc' }), 0);
  assert.equal(resolverValorListaOS({ valorTotalCentavos: -500 }), 0);
});

test('OS sem nada lancado mostra traco, nao R$ 0,00', () => {
  // Zero afirmaria que a OS nao vale nada; o traco diz que ainda nao ha o
  // que somar, que e' o caso do orcamento recem-aberto.
  assert.equal(formatarValorListaOS({}), '—');
  assert.equal(formatarValorListaOS({ valorTotal: 0 }), '—');
});

test('valor formatado em real brasileiro', () => {
  const texto = formatarValorListaOS({ valorTotalCentavos: 150050 });
  assert.match(texto, /1\.500,50/);
  assert.match(texto, /R\$/);
});
