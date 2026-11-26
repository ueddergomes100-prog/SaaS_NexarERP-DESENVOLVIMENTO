import test from 'node:test';
import assert from 'node:assert/strict';
import { candidatosDoCabecalho, marcasDoCabecalho, type ElementoDaTela } from '../src/utils/cabecalhoDaTelaDomain';

/** Monta um elemento falso: el('DIV', el('H1'), el('P')). */
const el = (tagName: string, ...filhos: ElementoDaTela[]): ElementoDaTela => ({ tagName, firstElementChild: filhos[0] || null, children: filhos });

test('titulo: o primeiro filho e um h1 (:has(> h1:first-child))', () => {
  assert.deepEqual(marcasDoCabecalho(el('DIV', el('H1'), el('P'))), { bloco: false, titulo: true });
  assert.deepEqual(marcasDoCabecalho(el('DIV', el('P'), el('H1'))), { bloco: false, titulo: false }, 'h1 que nao e o primeiro nao conta');
});

test('bloco: alguma div filha comeca com h1 (:has(> div > h1:first-child))', () => {
  assert.deepEqual(marcasDoCabecalho(el('DIV', el('DIV', el('H1'), el('P')), el('BUTTON'))), { bloco: true, titulo: false });
  assert.deepEqual(marcasDoCabecalho(el('DIV', el('BUTTON'), el('DIV', el('H1')))), { bloco: true, titulo: false }, 'a div com o h1 nao precisa ser a primeira');
  assert.deepEqual(marcasDoCabecalho(el('DIV', el('DIV', el('SPAN'), el('H1')))), { bloco: false, titulo: false }, 'h1 que nao abre a div nao conta');
  assert.deepEqual(marcasDoCabecalho(el('DIV', el('SECTION', el('H1')))), { bloco: false, titulo: false }, 'so div');
});

test('as duas marcas juntas quando o elemento cabe nas duas regras', () => {
  assert.deepEqual(marcasDoCabecalho(el('DIV', el('H1'), el('DIV', el('H1')))), { bloco: true, titulo: true });
});

test('candidatos: o primeiro filho (div) de cada div do .page-transition', () => {
  const cabecalho = el('DIV', el('H1'));
  const outraTela = el('DIV', el('DIV', el('H1')));
  const pageTransition = el('DIV', el('DIV', cabecalho, el('TABLE')), el('SECTION', el('DIV')), el('DIV', el('P')), outraTela);
  const lista = candidatosDoCabecalho(pageTransition);
  assert.equal(lista.length, 2);
  assert.equal(lista[0], cabecalho);
  assert.equal(lista[1], outraTela.firstElementChild);
});
