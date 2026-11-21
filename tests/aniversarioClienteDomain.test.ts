import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aniversariantesDoDia,
  camposDeNascimentoParaGravar,
  chaveDoAniversario,
  chavesDeAniversarioNoDia,
  deveAbrirJanelaDeAniversario,
  erroDaDataDeNascimento,
  fraseDaIdade,
  idadeQueCompleta,
  nomeComApelido,
} from '../src/utils/aniversarioClienteDomain';

test('chave do aniversario: mes e dia da data; data invalida fica vazia', () => {
  assert.equal(chaveDoAniversario('1990-11-21'), '11-21');
  assert.equal(chaveDoAniversario('2000-02-29'), '02-29');
  assert.equal(chaveDoAniversario('2001-02-29'), '', '29/02 de ano que nao e bissexto nao existe');
  assert.equal(chaveDoAniversario('1990-13-01'), '');
  assert.equal(chaveDoAniversario('21/11/1990'), '');
  assert.equal(chaveDoAniversario(undefined), '');
});

test('conferencia da data: em branco vale; incompleta, futura ou ano absurdo nao', () => {
  const hoje = '2026-11-21';
  assert.equal(erroDaDataDeNascimento('', hoje), null);
  assert.equal(erroDaDataDeNascimento(undefined, hoje), null);
  assert.equal(erroDaDataDeNascimento('1990-11-21', hoje), null);
  assert.equal(erroDaDataDeNascimento('2026-11-21', hoje), null, 'nasceu hoje');
  assert.match(erroDaDataDeNascimento('2026-11-22', hoje) || '', /depois de hoje/);
  assert.match(erroDaDataDeNascimento('0990-11-21', hoje) || '', /0990/);
  assert.match(erroDaDataDeNascimento('1990-02-30', hoje) || '', /não existe/);
});

test('o que vai para o banco: data e chave, ou os dois vazios (nunca undefined)', () => {
  assert.deepEqual(camposDeNascimentoParaGravar('1990-11-21'), { dataNascimento: '1990-11-21', aniversario: '11-21' });
  assert.deepEqual(camposDeNascimentoParaGravar(''), { dataNascimento: '', aniversario: '' });
  assert.deepEqual(camposDeNascimentoParaGravar(undefined), { dataNascimento: '', aniversario: '' });
  assert.deepEqual(camposDeNascimentoParaGravar('lixo'), { dataNascimento: '', aniversario: '' });
});

test('chaves do dia: 29 de fevereiro aparece no dia 28 em ano nao bissexto', () => {
  assert.deepEqual(chavesDeAniversarioNoDia('2026-11-21'), ['11-21']);
  assert.deepEqual(chavesDeAniversarioNoDia('2026-02-28'), ['02-28', '02-29']);
  assert.deepEqual(chavesDeAniversarioNoDia('2028-02-28'), ['02-28'], '2028 e bissexto: quem nasceu em 29 tem o proprio dia');
  assert.deepEqual(chavesDeAniversarioNoDia('2028-02-29'), ['02-29']);
  assert.deepEqual(chavesDeAniversarioNoDia(''), []);
});

test('idade que completa e a frase', () => {
  assert.equal(idadeQueCompleta('1990-11-21', '2026-11-21'), 36);
  assert.equal(idadeQueCompleta('2026-11-21', '2026-11-21'), null, 'nasceu hoje: nada de "faz 0 anos"');
  assert.equal(idadeQueCompleta('', '2026-11-21'), null);
  assert.equal(fraseDaIdade(36), 'faz 36 anos');
  assert.equal(fraseDaIdade(1), 'faz 1 ano');
  assert.equal(fraseDaIdade(null), '');
});

test('nome com apelido: so quando existe e nao repete o nome', () => {
  assert.equal(nomeComApelido({ nome: 'FABIANO BERNARDO', apelido: 'FABINHO' }), 'FABIANO BERNARDO (FABINHO)');
  assert.equal(nomeComApelido({ nome: 'FABIANO BERNARDO', apelido: '' }), 'FABIANO BERNARDO');
  assert.equal(nomeComApelido({ nome: 'FABIANO', apelido: 'fabiano' }), 'FABIANO');
  assert.equal(nomeComApelido({ nome: '', apelido: 'FABINHO' }), 'FABINHO');
});

test('aniversariantes do dia: so os ativos do dia, em ordem alfabetica, com idade e telefone', () => {
  const clientes = [
    { id: '1', codigo: '10', nome: 'ZULMIRA', dataNascimento: '1950-11-21', aniversario: '11-21', celular: '(33) 98888-7777' },
    { id: '2', codigo: '11', nome: 'ANTONIO', apelido: 'TONINHO', dataNascimento: '1980-11-21', aniversario: '11-21', telefone: '(33) 3331-0000' },
    { id: '3', codigo: '12', nome: 'BRUNO', dataNascimento: '1980-11-22', aniversario: '11-22' },
    { id: '4', codigo: '13', nome: 'CARLA', dataNascimento: '1980-11-21', aniversario: '11-21', ativo: false },
    { id: '5', codigo: '14', nome: 'DIEGO', dataNascimento: '1980-11-21' },
  ];
  const lista = aniversariantesDoDia(clientes, '2026-11-21');
  assert.deepEqual(lista.map((a) => a.rotulo), ['ANTONIO (TONINHO)', 'DIEGO', 'ZULMIRA']);
  assert.deepEqual(lista[0], { id: '2', codigo: '11', rotulo: 'ANTONIO (TONINHO)', telefone: '(33) 3331-0000', idade: 46 });
  assert.equal(lista[2].telefone, '(33) 98888-7777', 'celular vem antes do telefone');

  const fevereiro = aniversariantesDoDia([{ id: '9', nome: 'LEAP', dataNascimento: '2000-02-29', aniversario: '02-29' }], '2027-02-28');
  assert.deepEqual(fevereiro.map((a) => a.id), ['9']);
});

test('janela do dia: abre uma vez por dia e so quando ha aniversariante', () => {
  assert.equal(deveAbrirJanelaDeAniversario('', '2026-11-21', 2), true);
  assert.equal(deveAbrirJanelaDeAniversario('2026-11-20', '2026-11-21', 1), true);
  assert.equal(deveAbrirJanelaDeAniversario('2026-11-21', '2026-11-21', 3), false);
  assert.equal(deveAbrirJanelaDeAniversario('', '2026-11-21', 0), false);
});
