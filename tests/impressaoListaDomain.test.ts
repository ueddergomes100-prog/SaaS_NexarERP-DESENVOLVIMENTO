import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  foiImpresso,
  OPCOES_FILTRO_IMPRESSAO,
  passaNoFiltroDeImpressao,
  rotuloDoFiltroDeImpressao,
} from '../src/utils/impressaoListaDomain';
import { lerNaoImpressasPrimeiro } from '../src/utils/relatorioPreVendasDomain';

test('impresso = recibo/pre-venda OU minuta (decisao de 15/10)', () => {
  assert.equal(foiImpresso({ impresso: true }), true);
  assert.equal(foiImpresso({ minutaImpressa: true }), true);
  assert.equal(foiImpresso({ impresso: true, minutaImpressa: true }), true);
  assert.equal(foiImpresso({}), false);
  assert.equal(foiImpresso({ impresso: 'true', minutaImpressa: 1 }), false, 'so o booleano verdadeiro conta');
});

test('filtro Todos / Impressos / Nao impressos', () => {
  assert.equal(passaNoFiltroDeImpressao(true, ''), true);
  assert.equal(passaNoFiltroDeImpressao(false, ''), true);
  assert.equal(passaNoFiltroDeImpressao(true, 'impressos'), true);
  assert.equal(passaNoFiltroDeImpressao(false, 'impressos'), false);
  assert.equal(passaNoFiltroDeImpressao(false, 'nao_impressos'), true);
  assert.equal(passaNoFiltroDeImpressao(true, 'nao_impressos'), false);
  assert.deepEqual(OPCOES_FILTRO_IMPRESSAO.map(rotuloDoFiltroDeImpressao), ['Impressos', 'Não impressos']);
});

test('"nao impressas primeiro": ausente usa o padrao de cada lista; escolha guardada vale', () => {
  assert.equal(lerNaoImpressasPrimeiro(null), true, 'pre-vendas: ligado por padrao');
  assert.equal(lerNaoImpressasPrimeiro(null, false), false, 'outras abas: desligado por padrao (mantem a ordem por numero)');
  assert.equal(lerNaoImpressasPrimeiro('true', false), true);
  assert.equal(lerNaoImpressasPrimeiro('false', true), false);
});
