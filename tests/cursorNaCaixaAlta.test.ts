import test from 'node:test';
import assert from 'node:assert/strict';
import { posicaoParaRestaurar } from '../src/utils/cursorNaCaixaAlta';

/*
 * Cursor no lugar quando o campo troca a caixa da letra (18/11/2026).
 * "antes" = o campo logo depois da tecla; "depois" = depois que a tela
 * reescreveu o valor (e o navegador jogou o cursor para o fim).
 */

test('letra minuscula no meio do texto: o cursor volta para onde a pessoa estava', () => {
  // "CANETA AZUL", cursor na posicao 6, digita "x": o navegador deixa "CANETAx AZUL" com o cursor em 7.
  const antes = { valor: 'CANETAx AZUL', inicio: 7, fim: 7 };
  const depois = { valor: 'CANETAX AZUL', inicio: 12, fim: 12 };
  assert.deepEqual(posicaoParaRestaurar(antes, depois), { inicio: 7, fim: 7 });
  // Campo que grava em minuscula (o caminho inverso) tem o mesmo defeito e a mesma correcao.
  assert.deepEqual(
    posicaoParaRestaurar({ valor: 'joAo silva', inicio: 3, fim: 3 }, { valor: 'joao silva', inicio: 10, fim: 10 }),
    { inicio: 3, fim: 3 },
  );
});

test('nao mexe quando nao e o defeito', () => {
  // Digitando no fim: nao ha o que devolver.
  assert.equal(posicaoParaRestaurar({ valor: 'CANETAx', inicio: 7, fim: 7 }, { valor: 'CANETAX', inicio: 7, fim: 7 }), null);
  // Caps Lock ligado: a tela nao reescreveu nada.
  assert.equal(posicaoParaRestaurar({ valor: 'CANETAX AZUL', inicio: 7, fim: 7 }, { valor: 'CANETAX AZUL', inicio: 7, fim: 7 }), null);
  // Mascara (CPF, telefone, valor): o texto mudou mais do que a caixa; a mascara cuida do cursor.
  assert.equal(posicaoParaRestaurar({ valor: '1234567', inicio: 3, fim: 3 }, { valor: '123.456-7', inicio: 9, fim: 9 }), null);
  assert.equal(posicaoParaRestaurar({ valor: '12a45', inicio: 3, fim: 3 }, { valor: '12045', inicio: 5, fim: 5 }), null);
  // Mudou de tamanho ("ß" vira "SS"): a posicao antiga nao vale mais.
  assert.equal(posicaoParaRestaurar({ valor: 'straße x', inicio: 3, fim: 3 }, { valor: 'STRASSE X', inicio: 9, fim: 9 }), null);
  // A tela ja deixou o cursor em outro lugar que nao o fim: respeita.
  assert.equal(posicaoParaRestaurar({ valor: 'CANETAx AZUL', inicio: 7, fim: 7 }, { valor: 'CANETAX AZUL', inicio: 7, fim: 7 }), null);
  assert.equal(posicaoParaRestaurar({ valor: 'CANETAx AZUL', inicio: 7, fim: 7 }, { valor: 'CANETAX AZUL', inicio: 2, fim: 2 }), null);
  // Campo sem selecao de texto (numero, e-mail, data).
  assert.equal(posicaoParaRestaurar({ valor: 'abc', inicio: null, fim: null }, { valor: 'ABC', inicio: null, fim: null }), null);
});
