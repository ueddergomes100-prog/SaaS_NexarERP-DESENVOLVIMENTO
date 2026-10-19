import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolverInscricaoEstadualDestinatario } from '../src/utils/destinatarioFiscalDomain';
import { destinatarioEConsumidorFinal } from '../src/utils/notaFiscalItemDomain';

const CNPJ = '07488550000140';
const CPF = '06859540648';

test('CNPJ com IE cadastrada: manda so os digitos', () => {
  assert.deepEqual(resolverInscricaoEstadualDestinatario({ documento: CNPJ, identidade: '062.307.904/0081' }), { valor: '0623079040081' });
  assert.deepEqual(resolverInscricaoEstadualDestinatario({ documento: CNPJ, identidade: ' 123456789 ' }), { valor: '123456789' });
});

test('CNPJ com IE em branco: bloqueia pedindo a IE ou ISENTO (cadastro mal feito nao passa calado)', () => {
  const r = resolverInscricaoEstadualDestinatario({ documento: CNPJ, identidade: '', clienteNome: 'NATUMAIS' });
  assert.equal(r.valor, undefined);
  assert.match(String(r.erro), /O cliente "NATUMAIS" é pessoa jurídica e está sem Inscrição Estadual no cadastro/);
  assert.match(String(r.erro), /Cadastros → Clientes/);
  assert.match(String(r.erro), /escreva ISENTO/);
});

test('CNPJ "ISENTO" (qualquer caixa): nao manda ISENTO (rejeicao 805 em varios estados), sai como nao contribuinte e avisa', () => {
  for (const identidade of ['isento', 'ISENTO', ' Isento ']) {
    const r = resolverInscricaoEstadualDestinatario({ documento: CNPJ, identidade, clienteNome: 'LUCINEIA' });
    assert.equal(r.valor, undefined);
    assert.equal(r.erro, undefined);
    assert.match(String(r.aviso), /O cliente "LUCINEIA" está como ISENTO de Inscrição Estadual: a nota sai como não contribuinte/);
    // e o indFinal acompanha: sem IE e' consumidor final
    assert.equal(destinatarioEConsumidorFinal({ documento: CNPJ, inscricaoEstadual: r.valor }), true);
  }
});

test('CNPJ com IE que nao parece valida: bloqueia citando o que esta la', () => {
  const r = resolverInscricaoEstadualDestinatario({ documento: CNPJ, identidade: 'abc', clienteNome: 'X' });
  assert.match(String(r.erro), /"abc"\) não parece válida/);
  assert.match(String(r.erro), /escreva ISENTO/);
  assert.match(String(resolverInscricaoEstadualDestinatario({ documento: CNPJ, identidade: '123' }).erro), /não parece válida/);
});

test('CPF: o campo e RG e nunca vai como IE', () => {
  assert.deepEqual(resolverInscricaoEstadualDestinatario({ documento: CPF, identidade: 'MG-12.345.678' }), {});
  assert.deepEqual(resolverInscricaoEstadualDestinatario({ documento: CPF, identidade: '' }), {});
});

test('documento formatado tambem conta como CNPJ', () => {
  assert.deepEqual(resolverInscricaoEstadualDestinatario({ documento: '07.488.550/0001-40', identidade: '123456789' }), { valor: '123456789' });
});
