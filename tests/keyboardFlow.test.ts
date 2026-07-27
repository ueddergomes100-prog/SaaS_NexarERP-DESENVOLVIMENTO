import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createEscapeStack,
  isEditableElement,
  isFunctionOrEscapeKey,
  matchShortcut,
} from '../src/utils/keyboardFlow';

test('isFunctionOrEscapeKey reconhece Escape e teclas de funcao', () => {
  assert.equal(isFunctionOrEscapeKey('Escape'), true);
  assert.equal(isFunctionOrEscapeKey('F1'), true);
  assert.equal(isFunctionOrEscapeKey('F12'), true);
  assert.equal(isFunctionOrEscapeKey('a'), false);
  assert.equal(isFunctionOrEscapeKey('Enter'), false);
  assert.equal(isFunctionOrEscapeKey('ArrowDown'), false);
});

test('isEditableElement identifica input, textarea e contentEditable', () => {
  assert.equal(isEditableElement({ tagName: 'INPUT' }), true);
  assert.equal(isEditableElement({ tagName: 'TEXTAREA' }), true);
  assert.equal(isEditableElement({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isEditableElement({ tagName: 'DIV', isContentEditable: false }), false);
  assert.equal(isEditableElement({ tagName: 'BUTTON' }), false);
  assert.equal(isEditableElement(null), false);
  assert.equal(isEditableElement(undefined), false);
});

test('matchShortcut encontra o binding pela tecla e respeita "when"', () => {
  const bindings = [
    { key: 'F2', when: true },
    { key: 'F3', when: false },
    { key: 'F4' },
  ];

  assert.equal(matchShortcut(bindings, 'F2'), bindings[0]);
  assert.equal(matchShortcut(bindings, 'F3'), undefined);
  assert.equal(matchShortcut(bindings, 'F4'), bindings[2]);
  assert.equal(matchShortcut(bindings, 'F5'), undefined);
});

test('createEscapeStack fecha somente o topo da pilha, nao tudo de uma vez', () => {
  const stack = createEscapeStack();
  const closed: string[] = [];

  stack.push(() => closed.push('primeiro'));
  stack.push(() => closed.push('segundo'));
  stack.push(() => closed.push('terceiro'));

  const result = stack.closeTop();

  assert.equal(result, true);
  assert.deepEqual(closed, ['terceiro']);
  assert.equal(stack.size(), 3, 'closeTop nao remove sozinho, quem remove e o consumidor');
});

test('createEscapeStack.remove tira uma camada especifica da pilha', () => {
  const stack = createEscapeStack();
  const closeA = () => {};
  const closeB = () => {};

  stack.push(closeA);
  stack.push(closeB);
  stack.remove(closeA);

  assert.equal(stack.size(), 1);
});

test('createEscapeStack.closeTop retorna false quando a pilha esta vazia', () => {
  const stack = createEscapeStack();
  assert.equal(stack.closeTop(), false);
});

test('createEscapeStack.clear esvazia a pilha', () => {
  const stack = createEscapeStack();
  stack.push(() => {});
  stack.push(() => {});
  stack.clear();
  assert.equal(stack.size(), 0);
});
