import assert from 'node:assert/strict';
import { test } from 'node:test';
import { traduzirMensagemDaSpedy } from '../src/utils/spedyMensagemDomain';

test('validacao da Spedy em ingles vira portugues com o nome do campo', () => {
  assert.equal(
    traduzirMensagemDaSpedy('The field Number must be a string with a maximum length of 10.'),
    'o campo "Número do endereço (do cliente ou da transportadora)" aceita no máximo 10 caracteres.',
  );
  assert.equal(
    traduzirMensagemDaSpedy("The field Street must be a string or array type with a maximum length of '100'."),
    'o campo "Rua do endereço" aceita no máximo 100 caracteres.',
  );
  assert.equal(traduzirMensagemDaSpedy('The Name field is required.'), 'o campo "Nome" é obrigatório.');
  assert.equal(
    traduzirMensagemDaSpedy('The field Foo must be a string with a minimum length of 2.'),
    'o campo "Foo" precisa ter pelo menos 2 caracteres.',
  );
});

test('mensagem que nao e de validacao passa igual', () => {
  assert.equal(traduzirMensagemDaSpedy('Certificado vencido.'), 'Certificado vencido.');
  assert.equal(traduzirMensagemDaSpedy(''), '');
});
