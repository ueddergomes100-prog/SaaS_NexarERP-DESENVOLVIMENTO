import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  avisoDaSituacao,
  camposDaReceita,
  formatarCep,
  formatarTelefone,
  preenchimentoPelaReceita,
  regimeSugerido,
  soOsVazios,
  type CamposDaEmpresa,
} from '../src/utils/cnpjPreenchimentoDomain';

const receita = {
  encontrado: true,
  razaoSocial: 'Loja de Testes Hennder Ltda',
  nomeFantasia: 'Loja de Testes',
  situacao: 'ATIVA',
  ativo: true,
  logradouro: 'Rua das Flores',
  numero: '120',
  bairro: 'Centro',
  cep: '36900000',
  municipio: 'Manhuaçu',
  uf: 'MG',
  telefone: '3333334444 / 31999998888',
  email: 'CONTATO@LOJA.COM.BR',
  simplesNacional: true,
};

const vazio: CamposDaEmpresa = { razaoSocial: '', nomeOficina: '', rua: '', numero: '', bairro: '', cep: '', telefone: '', email: '' };

test('campos da Receita: caixa alta, CEP e telefone formatados, e-mail minusculo', () => {
  assert.deepEqual(camposDaReceita(receita), {
    razaoSocial: 'LOJA DE TESTES HENNDER LTDA',
    nomeOficina: 'LOJA DE TESTES',
    rua: 'RUA DAS FLORES',
    numero: '120',
    bairro: 'CENTRO',
    cep: '36900-000',
    telefone: '(33) 3333-4444',
    email: 'contato@loja.com.br',
  });
  assert.equal(formatarCep('369'), '369');
  assert.equal(formatarTelefone('31999998888'), '(31) 99999-8888');
  assert.equal(formatarTelefone(''), '');
});

test('sem nome fantasia na Receita, o nome fantasia vira a razao social; campo vazio nao entra', () => {
  const novos = camposDaReceita({ razaoSocial: 'EMPRESA X', nomeFantasia: '', logradouro: '', cep: '' });
  assert.deepEqual(novos, { razaoSocial: 'EMPRESA X', nomeOficina: 'EMPRESA X' });
});

test('preenchimento: tela vazia nao sobrescreve nada; valor diferente pede confirmacao; igual nao', () => {
  assert.deepEqual(preenchimentoPelaReceita(vazio, receita).sobrescritos, []);
  const atual: CamposDaEmpresa = { ...vazio, razaoSocial: 'loja de testes hennder ltda', rua: 'AV BRASIL', numero: '120' };
  const r = preenchimentoPelaReceita(atual, receita);
  assert.deepEqual(r.sobrescritos.map((s) => [s.campo, s.de, s.para]), [['rua', 'AV BRASIL', 'RUA DAS FLORES']]);
  assert.deepEqual(soOsVazios(atual, r.novos), { nomeOficina: 'LOJA DE TESTES', bairro: 'CENTRO', cep: '36900-000', telefone: '(33) 3333-4444', email: 'contato@loja.com.br' });
});

test('situacao nao ativa avisa; Simples Nacional sugere o regime', () => {
  assert.equal(avisoDaSituacao(receita), null);
  assert.match(avisoDaSituacao({ ...receita, ativo: false, situacao: 'BAIXADA' }) || '', /BAIXADA/);
  assert.equal(regimeSugerido(receita), 'simples_nacional');
  assert.equal(regimeSugerido({ ...receita, simplesNacional: false }), null);
  assert.equal(regimeSugerido({ ...receita, simplesNacional: null }), null);
});
