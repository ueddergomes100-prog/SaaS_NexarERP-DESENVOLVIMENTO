import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LINHAS_POR_BLOCO,
  linhasDoBloco,
  linhasRestantes,
  ofereceMostrarTudo,
  proximoLimite,
  textoMostrarMais,
} from '../src/utils/linhasEmBlocosDomain';

const lista = (n: number) => Array.from({ length: n }, (_, i) => i);

test('lista que cabe no bloco volta a mesma, sem copia; a maior e cortada nas primeiras', () => {
  const pequena = lista(40);
  assert.equal(linhasDoBloco(pequena, LINHAS_POR_BLOCO), pequena);
  const exata = lista(100);
  assert.equal(linhasDoBloco(exata, 100), exata);
  const grande = lista(512);
  const naTela = linhasDoBloco(grande, 100);
  assert.equal(naTela.length, 100);
  assert.deepEqual([naTela[0], naTela[99]], [0, 99]);
  assert.equal(grande.length, 512, 'a lista inteira continua inteira para totais e selecao');
});

test('restantes e proximo limite', () => {
  assert.equal(linhasRestantes(512, 100), 412);
  assert.equal(linhasRestantes(80, 100), 0);
  assert.equal(linhasRestantes(512, Number.MAX_SAFE_INTEGER), 0);
  assert.equal(proximoLimite(100), 200);
  assert.equal(proximoLimite(200, 50), 250);
  assert.equal(linhasDoBloco(lista(512), proximoLimite(100)).length, 200);
});

test('limite invalido nunca quebra a lista', () => {
  assert.equal(linhasDoBloco(lista(5), -3).length, 0);
  assert.equal(linhasRestantes(5, -3), 5);
  assert.equal(proximoLimite(100, 0), 101);
});

test('textos do rodape em portugues', () => {
  assert.equal(textoMostrarMais(412), 'Mostrar mais (412 restantes)');
  assert.equal(textoMostrarMais(1), 'Mostrar mais (1 restante)');
  assert.equal(textoMostrarMais(1234), 'Mostrar mais (1.234 restantes)');
  assert.equal(ofereceMostrarTudo(412), true);
  assert.equal(ofereceMostrarTudo(100), false, 'um clique em Mostrar mais ja traz tudo');
});
