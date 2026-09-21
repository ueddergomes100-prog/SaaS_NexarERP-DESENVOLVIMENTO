import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  escolherIntegrationIdDoReenvio,
  rejeicaoPrendeConfiguracaoNaNota,
} from '../src/utils/reenvioNotaDomain';

const MSG_AMBIENTE_0 = 'Não foi possível encontrar as definições do serviço Serviço:Authorization Estado:MG Ambiente:0 Modelo:ProductInvoice';

test('"Ambiente:0" e "definicoes do servico" prendem a configuracao na nota', () => {
  assert.equal(rejeicaoPrendeConfiguracaoNaNota(MSG_AMBIENTE_0), true);
  assert.equal(rejeicaoPrendeConfiguracaoNaNota('Ambiente:0'), true);
  assert.equal(rejeicaoPrendeConfiguracaoNaNota('Não foi possível encontrar as definições do serviço X'), true);
});

test('rejeicao de dado (NCM, CFOP, endereco...) NAO gera nota nova', () => {
  assert.equal(rejeicaoPrendeConfiguracaoNaNota('Rejeição 778: NCM inexistente'), false);
  assert.equal(rejeicaoPrendeConfiguracaoNaNota('Ambiente:1 ok'), false);
  assert.equal(rejeicaoPrendeConfiguracaoNaNota(null), false);
  assert.equal(rejeicaoPrendeConfiguracaoNaNota(undefined), false);
});

test('rejeicao de dado reenvia com o MESMO id (Spedy atualiza a nota e reaproveita o numero)', () => {
  const r = escolherIntegrationIdDoReenvio({ docId: 'abc', tentativaAtual: undefined, mensagemRejeicao: 'Rejeição 778: NCM inexistente' });
  assert.deepEqual(r, { integrationId: 'abc', tentativa: 1, notaNova: false });
});

test('Ambiente:0 cria tentativa 2 com id novo', () => {
  const r = escolherIntegrationIdDoReenvio({ docId: 'abc', tentativaAtual: 1, mensagemRejeicao: MSG_AMBIENTE_0 });
  assert.deepEqual(r, { integrationId: 'abc-t2', tentativa: 2, notaNova: true });
});

test('depois da tentativa 2, correcao de dado continua na tentativa 2 (nao queima numero)', () => {
  const r = escolherIntegrationIdDoReenvio({ docId: 'abc', tentativaAtual: 2, mensagemRejeicao: 'Rejeição 778: NCM inexistente' });
  assert.deepEqual(r, { integrationId: 'abc-t2', tentativa: 2, notaNova: false });
});

test('se o envio caiu no meio (tentativa nao gravada), o proximo clique recalcula o MESMO id', () => {
  const primeiro = escolherIntegrationIdDoReenvio({ docId: 'abc', tentativaAtual: 1, mensagemRejeicao: MSG_AMBIENTE_0 });
  const segundo = escolherIntegrationIdDoReenvio({ docId: 'abc', tentativaAtual: 1, mensagemRejeicao: MSG_AMBIENTE_0 });
  assert.equal(primeiro.integrationId, segundo.integrationId);
});

test('tentativa invalida cai em 1', () => {
  assert.equal(escolherIntegrationIdDoReenvio({ docId: 'x', tentativaAtual: 0, mensagemRejeicao: '' }).tentativa, 1);
  assert.equal(escolherIntegrationIdDoReenvio({ docId: 'x', tentativaAtual: -3, mensagemRejeicao: '' }).tentativa, 1);
  assert.equal(escolherIntegrationIdDoReenvio({ docId: 'x', tentativaAtual: Number.NaN, mensagemRejeicao: '' }).tentativa, 1);
});
