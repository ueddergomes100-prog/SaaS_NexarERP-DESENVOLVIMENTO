import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aplicarCaixaAltaCadastro, mantemCaixaDigitada } from '../src/utils/textoCadastroDomain';

test('campo de texto comum vira caixa alta', () => {
  assert.equal(aplicarCaixaAltaCadastro({ tagName: 'INPUT', type: 'text', name: 'nome' }, 'joao silva'), 'JOAO SILVA');
  assert.equal(aplicarCaixaAltaCadastro({ tagName: 'INPUT', type: 'text', name: 'marca' }, 'Fiat'), 'FIAT');
});

test('acento sobrevive a caixa alta', () => {
  assert.equal(aplicarCaixaAltaCadastro({ tagName: 'INPUT', name: 'nome' }, 'joão inácio'), 'JOÃO INÁCIO');
});

test('textarea mantem o que foi escrito -- texto longo se le em minusculo', () => {
  const texto = 'Cliente relatou barulho na suspensão dianteira.';
  assert.equal(mantemCaixaDigitada({ tagName: 'TEXTAREA', name: 'defeitoRelatado' }), true);
  assert.equal(aplicarCaixaAltaCadastro({ tagName: 'TEXTAREA', name: 'defeitoRelatado' }, texto), texto);
});

test('e-mail, senha e URL ficam intocados -- ali a caixa E o valor', () => {
  assert.equal(aplicarCaixaAltaCadastro({ tagName: 'INPUT', type: 'email', name: 'email' }, 'joao@x.com'), 'joao@x.com');
  assert.equal(aplicarCaixaAltaCadastro({ tagName: 'INPUT', type: 'password', name: 'senha' }, 'aB3xY'), 'aB3xY');
  assert.equal(aplicarCaixaAltaCadastro({ tagName: 'INPUT', type: 'url', name: 'site' }, 'https://x.com/a'), 'https://x.com/a');
});

test('chave de integracao fica intocada mesmo declarada como texto', () => {
  // A tela mostra a chave num input comum quando o olho esta aberto; caixa
  // alta ali nao e feio, e quebrado -- a chave e sensivel a caixa.
  assert.equal(aplicarCaixaAltaCadastro({ tagName: 'INPUT', type: 'text', name: 'spedyApiKey' }, 'sk_Ab12'), 'sk_Ab12');
  assert.equal(aplicarCaixaAltaCadastro({ tagName: 'INPUT', type: 'text', name: 'email' }, 'a@B.com'), 'a@B.com');
});

test('select passa intocado -- o valor e codigo, nao texto digitado', () => {
  // 'FINALIZADA' quebraria toda comparacao de status, filtro de lista e regra
  // de negocio que le esse campo. O rotulo da opcao aparece em caixa alta por
  // CSS; o valor gravado tem que continuar sendo o codigo.
  assert.equal(mantemCaixaDigitada({ tagName: 'SELECT', name: 'status' }), true);
  assert.equal(aplicarCaixaAltaCadastro({ tagName: 'SELECT', name: 'status' }, 'Finalizada'), 'Finalizada');
  assert.equal(aplicarCaixaAltaCadastro({ tagName: 'SELECT', name: 'buscaProdutoModo' }, 'exata'), 'exata');
});

test('campo que nao e texto passa direto', () => {
  assert.equal(mantemCaixaDigitada({ tagName: 'INPUT', type: 'number', name: 'preco' }), true);
  assert.equal(mantemCaixaDigitada({ tagName: 'INPUT', type: 'date', name: 'dataEntrada' }), true);
});

test('nao corta espaco enquanto a pessoa digita', () => {
  // Cortar aqui impediria de escrever "JOAO " antes do sobrenome.
  assert.equal(aplicarCaixaAltaCadastro({ tagName: 'INPUT', name: 'nome' }, 'joao '), 'JOAO ');
});

test('valor vazio ou ausente nao quebra', () => {
  assert.equal(aplicarCaixaAltaCadastro({ tagName: 'INPUT', name: 'nome' }, ''), '');
  assert.equal(aplicarCaixaAltaCadastro({}, 'abc'), 'ABC');
});
