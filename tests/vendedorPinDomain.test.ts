import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCodigoVendedorValido,
  isPinVendedorFraco,
  isPinVendedorValido,
  MAX_VENDEDORES_COM_CODIGO,
  normalizarCodigoVendedor,
  parseExigirIdentificacaoVendedor,
} from '../src/utils/vendedorPinDomain';
import {
  checarPrefixoDaEmpresa,
  checarUsername,
  montarChaveUsername,
  montarEmailSintetico,
  normalizarCnpj,
  normalizarUsername,
} from '../src/utils/loginIdentidadeDomain';

// --- Codigo do vendedor ----------------------------------------------------

test('normalizarCodigoVendedor completa com zero a esquerda', () => {
  // "7" e "07" tem que ser o MESMO vendedor: dois cadastros distintos seriam
  // uma armadilha pra quem digita rapido no balcao.
  assert.equal(normalizarCodigoVendedor('7'), '07');
  assert.equal(normalizarCodigoVendedor('07'), '07');
  assert.equal(normalizarCodigoVendedor(7), '07');
  assert.equal(normalizarCodigoVendedor('99'), '99');
  assert.equal(normalizarCodigoVendedor('00'), '00');
});

test('normalizarCodigoVendedor ignora o que nao e digito', () => {
  assert.equal(normalizarCodigoVendedor(' 7 '), '07');
  assert.equal(normalizarCodigoVendedor('a7'), '07');
});

test('normalizarCodigoVendedor recusa codigo longo demais ou vazio', () => {
  assert.equal(normalizarCodigoVendedor('123'), '');
  assert.equal(normalizarCodigoVendedor(''), '');
  assert.equal(normalizarCodigoVendedor('abc'), '');
  assert.equal(normalizarCodigoVendedor(null), '');
  assert.equal(normalizarCodigoVendedor(undefined), '');
});

test('isCodigoVendedorValido acompanha a normalizacao', () => {
  assert.equal(isCodigoVendedorValido('7'), true);
  assert.equal(isCodigoVendedorValido('123'), false);
  assert.equal(isCodigoVendedorValido(''), false);
});

test('o teto de codigos e 100 (00 a 99)', () => {
  assert.equal(MAX_VENDEDORES_COM_CODIGO, 100);
});

// --- PIN -------------------------------------------------------------------

test('isPinVendedorValido exige exatamente 4 digitos', () => {
  assert.equal(isPinVendedorValido('1357'), true);
  assert.equal(isPinVendedorValido('0042'), true);
  assert.equal(isPinVendedorValido('135'), false);
  assert.equal(isPinVendedorValido('13570'), false);
  assert.equal(isPinVendedorValido('12a4'), false);
  assert.equal(isPinVendedorValido(''), false);
  assert.equal(isPinVendedorValido(undefined), false);
});

test('isPinVendedorValido nao aceita espaco nem sinal', () => {
  assert.equal(isPinVendedorValido(' 1234'), false);
  assert.equal(isPinVendedorValido('+123'), false);
});

test('isPinVendedorFraco pega repetido e sequencia, nos dois sentidos', () => {
  assert.equal(isPinVendedorFraco('0000'), true);
  assert.equal(isPinVendedorFraco('7777'), true);
  assert.equal(isPinVendedorFraco('1234'), true);
  assert.equal(isPinVendedorFraco('4321'), true);
  assert.equal(isPinVendedorFraco('6789'), true);
});

test('isPinVendedorFraco deixa passar PIN comum', () => {
  assert.equal(isPinVendedorFraco('1357'), false);
  assert.equal(isPinVendedorFraco('2846'), false);
});

test('isPinVendedorFraco so opina sobre PIN de formato valido', () => {
  assert.equal(isPinVendedorFraco('111'), false);
  assert.equal(isPinVendedorFraco('abcd'), false);
});

test('a config de exigir identificacao so liga com true explicito', () => {
  assert.equal(parseExigirIdentificacaoVendedor(true), true);
  assert.equal(parseExigirIdentificacaoVendedor('true'), false);
  assert.equal(parseExigirIdentificacaoVendedor(1), false);
  assert.equal(parseExigirIdentificacaoVendedor(undefined), false);
});

// --- Identidade de login (fatia 0) -----------------------------------------

test('montarChaveUsername gera a MESMA chave que o login procura', () => {
  // Este teste e' o bug inteiro: criacao e login precisam produzir a mesma
  // string, com ou sem mascara no CNPJ.
  const comMascara = montarChaveUsername('12.345.678/0001-99', 'Joao Silva');
  const semMascara = montarChaveUsername('12345678000199', 'joaosilva');
  assert.equal(comMascara, semMascara);
  assert.equal(comMascara, '12345678000199-joaosilva');
});

test('normalizarCnpj e normalizarUsername tiram mascara, espaco e caixa', () => {
  assert.equal(normalizarCnpj('12.345.678/0001-99'), '12345678000199');
  assert.equal(normalizarUsername('  Joao  Silva '), 'joaosilva');
  assert.equal(normalizarUsername('MARIA'), 'maria');
});

test('montarChaveUsername devolve vazio sem CNPJ ou sem usuario', () => {
  assert.equal(montarChaveUsername('', 'joao'), '');
  assert.equal(montarChaveUsername('12345678000199', ''), '');
  assert.equal(montarChaveUsername(null, null), '');
});

test('montarEmailSintetico usa a chave completa', () => {
  assert.equal(montarEmailSintetico('12345678000199-joao'), '12345678000199-joao@nexar.app');
});

test('checarPrefixoDaEmpresa BLOQUEIA empresa sem CNPJ, em vez de inventar prefixo', () => {
  // O comportamento antigo caia num slug do nome ou no tenantId, criando um
  // funcionario que nunca conseguia entrar.
  const semCnpj = checarPrefixoDaEmpresa('');
  assert.equal(semCnpj.ok, false);
  assert.match(semCnpj.motivo, /CNPJ/);
  assert.match(semCnpj.motivo, /Configurações/);

  assert.equal(checarPrefixoDaEmpresa(null).ok, false);
  assert.equal(checarPrefixoDaEmpresa(undefined).ok, false);
});

test('checarPrefixoDaEmpresa recusa CNPJ incompleto', () => {
  const curto = checarPrefixoDaEmpresa('123456');
  assert.equal(curto.ok, false);
  assert.match(curto.motivo, /14/);
});

test('checarPrefixoDaEmpresa aceita CNPJ valido, com ou sem mascara', () => {
  const comMascara = checarPrefixoDaEmpresa('12.345.678/0001-99');
  assert.equal(comMascara.ok, true);
  assert.equal(comMascara.cnpj, '12345678000199');
  assert.equal(comMascara.motivo, '');
});

test('checarUsername exige 3 letras e devolve o valor normalizado', () => {
  assert.equal(checarUsername('jo').ok, false);
  const ok = checarUsername('  Joao Silva ');
  assert.equal(ok.ok, true);
  assert.equal(ok.username, 'joaosilva');
});
