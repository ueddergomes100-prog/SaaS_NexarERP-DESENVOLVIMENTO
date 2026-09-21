import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  avisosClienteMobile,
  emailValido,
  formularioClienteVazio,
  mascaraCep,
  mascaraDocumento,
  mascaraTelefone,
  montarClienteParaGravar,
  tipoPessoaDoDocumento,
  validarClienteMobile,
  type FormularioClienteMobile,
} from '../src/utils/clienteCadastroMobileDomain';

const CPF_OK = '52998224725';
const CNPJ_OK = '11222333000181';

const completoPF = (): FormularioClienteMobile => ({
  ...formularioClienteVazio(),
  documento: mascaraDocumento(CPF_OK), nome: 'joao da silva', cep: '36940-000', endereco: 'rua x', numero: '10',
  bairro: 'centro', cidade: 'manhuacu', estado: 'mg', codigoIbge: '3139409',
});

const completoPJ = (): FormularioClienteMobile => ({
  ...completoPF(), documento: mascaraDocumento(CNPJ_OK), nome: 'empresa ltda', identidade: '0623079040081',
});

test('mascara de CPF vai se formando enquanto digita', () => {
  assert.equal(mascaraDocumento('5'), '5');
  assert.equal(mascaraDocumento('5299'), '529.9');
  assert.equal(mascaraDocumento('529982'), '529.982'); // sem ponto sobrando no fim
  assert.equal(mascaraDocumento('52998224'), '529.982.24');
  assert.equal(mascaraDocumento('52998224725'), '529.982.247-25');
});

test('do 12o digito em diante vira CNPJ, com ponto, barra e traco', () => {
  assert.equal(mascaraDocumento('112223330001'), '11.222.333/0001');
  assert.equal(mascaraDocumento('11222333000181'), '11.222.333/0001-81');
  assert.equal(mascaraDocumento('112223330001819999'), '11.222.333/0001-81'); // passou de 14: corta
});

test('mascara ignora letras e pontuacao ja digitada', () => {
  assert.equal(mascaraDocumento('529.982.247-25'), '529.982.247-25');
  assert.equal(mascaraDocumento('abc'), '');
});

test('CEP e telefone', () => {
  assert.equal(mascaraCep('36940000'), '36940-000');
  assert.equal(mascaraCep('3694'), '3694');
  assert.equal(mascaraTelefone('3333333333'), '(33) 3333-3333');
  assert.equal(mascaraTelefone('33984145675'), '(33) 98414-5675');
  assert.equal(mascaraTelefone('33'), '(33');
  assert.equal(mascaraTelefone(''), '');
});

test('tipo de pessoa pelo documento', () => {
  assert.equal(tipoPessoaDoDocumento('529.982.247-25'), 'PF');
  assert.equal(tipoPessoaDoDocumento('11.222.333/0001-81'), 'PJ');
  assert.equal(tipoPessoaDoDocumento('123'), null);
});

test('cadastro completo de pessoa fisica passa', () => {
  assert.deepEqual(validarClienteMobile(completoPF()), []);
});

test('cadastro completo de pessoa juridica com IE passa; sem IE pede a IE (ou ISENTO)', () => {
  assert.deepEqual(validarClienteMobile(completoPJ()), []);
  const semIe = validarClienteMobile({ ...completoPJ(), identidade: '' });
  assert.equal(semIe.length, 1);
  assert.match(semIe[0], /Inscrição Estadual.*ISENTO/);
  assert.deepEqual(validarClienteMobile({ ...completoPJ(), identidade: 'isento' }), []);
});

test('CPF e RG: RG e opcional em pessoa fisica', () => {
  assert.deepEqual(validarClienteMobile({ ...completoPF(), identidade: '' }), []);
});

test('documento vazio, incompleto ou com digito errado nao passa', () => {
  assert.match(validarClienteMobile({ ...completoPF(), documento: '' })[0], /CPF ou o CNPJ/);
  assert.match(validarClienteMobile({ ...completoPF(), documento: '529.982' })[0], /dígito\(s\)/);
  assert.match(validarClienteMobile({ ...completoPF(), documento: '529.982.247-26' })[0], /CPF inválido/);
});

test('faltando endereco: uma mensagem por item, em portugues', () => {
  const erros = validarClienteMobile({ ...completoPF(), cep: '', endereco: '', numero: '', bairro: '', cidade: '', estado: '' });
  assert.equal(erros.length, 5);
  assert.match(erros.join(' | '), /CEP/);
  assert.match(erros.join(' | '), /endereço \(rua\)/);
  assert.match(erros.join(' | '), /número do endereço/);
  assert.match(erros.join(' | '), /bairro/);
  assert.match(erros.join(' | '), /cidade e o estado/);
});

test('e-mail e opcional, mas se vier tem que parecer e-mail', () => {
  assert.deepEqual(validarClienteMobile({ ...completoPF(), email: '' }), []);
  assert.deepEqual(validarClienteMobile({ ...completoPF(), email: 'a@b.com' }), []);
  assert.match(validarClienteMobile({ ...completoPF(), email: 'joao@' })[0], /e-mail/);
  assert.equal(emailValido('nfe@empresa.com.br'), true);
  assert.equal(emailValido('sem-arroba.com'), false);
});

test('telefone opcional, mas incompleto avisa', () => {
  assert.deepEqual(validarClienteMobile({ ...completoPF(), telefone: '' }), []);
  assert.match(validarClienteMobile({ ...completoPF(), telefone: '(33) 9' })[0], /DDD/);
});

test('sem codigo IBGE avisa (nao impede)', () => {
  assert.deepEqual(avisosClienteMobile(completoPF()), []);
  assert.match(avisosClienteMobile({ ...completoPF(), codigoIbge: '' })[0], /IBGE/);
});

test('o que vai pro banco: caixa alta, so digitos, ISENTO padronizado, sem undefined', () => {
  const doc = montarClienteParaGravar({ ...completoPJ(), identidade: 'isento', email: ' NFE@Empresa.com ', telefone: '(33) 3333-3333' }, { codigo: '77', tenantId: 't1', vendedorId: 'v1' });
  assert.equal(doc.documento, '11222333000181');
  assert.equal(doc.nome, 'EMPRESA LTDA');
  assert.equal(doc.identidade, 'ISENTO');
  assert.equal(doc.cep, '36940000');
  assert.equal(doc.telefone, '3333333333');
  assert.equal(doc.email, 'nfe@empresa.com');
  assert.equal(doc.estado, 'MG');
  assert.equal(doc.codigo, '77');
  assert.equal(doc.origemCadastro, 'app_vendedor');
  assert.equal(doc.limiteDeCredito, null);
  assert.equal(Object.values(doc).some((v) => v === undefined), false);
});
