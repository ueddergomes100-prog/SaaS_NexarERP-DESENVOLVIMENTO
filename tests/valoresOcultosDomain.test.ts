import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAVE_ANTIGA_DASHBOARD,
  MASCARA_MOEDA,
  MASCARA_NUMERO,
  chaveDosValoresOcultos,
  lerValoresOcultos,
  tituloDoOlho,
  valorNaTela,
} from '../src/utils/valoresOcultosDomain';

const navegador = (dados: Record<string, string>) => (chave: string) => (chave in dados ? dados[chave] : null);

test('a escolha do olho e por usuario', () => {
  assert.equal(chaveDosValoresOcultos('u1'), 'hennder_valores_ocultos_u1');
  assert.notEqual(chaveDosValoresOcultos('u1'), chaveDosValoresOcultos('u2'));
  assert.equal(chaveDosValoresOcultos(null), 'hennder_valores_ocultos_anonimo');
});

test('le a escolha do usuario; sem ela, herda o olho antigo do Dashboard', () => {
  assert.equal(lerValoresOcultos(navegador({}), 'u1'), false, 'comeca mostrando');
  assert.equal(lerValoresOcultos(navegador({ [CHAVE_ANTIGA_DASHBOARD]: 'true' }), 'u1'), true);
  assert.equal(lerValoresOcultos(navegador({ [CHAVE_ANTIGA_DASHBOARD]: 'true', hennder_valores_ocultos_u1: 'false' }), 'u1'), false, 'a escolha nova manda');
  assert.equal(lerValoresOcultos(navegador({ hennder_valores_ocultos_u2: 'true' }), 'u1'), false, 'a do outro usuario nao vale');
});

test('com o olho fechado a tela mostra a mascara; aberto, o valor', () => {
  assert.equal(valorNaTela(false, 'R$ 424,00'), 'R$ 424,00');
  assert.equal(valorNaTela(true, 'R$ 424,00'), MASCARA_MOEDA);
  assert.equal(valorNaTela(true, '12', MASCARA_NUMERO), MASCARA_NUMERO);
  assert.match(tituloDoOlho(false), /^Esconder/);
  assert.match(tituloDoOlho(true), /^Mostrar/);
});
