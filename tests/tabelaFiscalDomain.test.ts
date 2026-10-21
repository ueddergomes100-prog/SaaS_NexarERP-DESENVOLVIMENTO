import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  codigosDoUso,
  filtrarTabela,
  formatarCest,
  formatarNcm,
  lerNovoCest,
  lerNovoNcm,
  normalizarCest,
  normalizarNcm,
  podeDescrever,
} from '../src/utils/tabelaFiscalDomain';

test('NCM e CEST: so digitos, tamanho certo e formato do contador', () => {
  assert.equal(normalizarNcm('2106.90.90'), '21069090');
  assert.equal(normalizarNcm('2106909'), '');
  assert.equal(normalizarNcm('00000000'), '');
  assert.equal(normalizarCest('17.001.00'), '1700100');
  assert.equal(normalizarCest('170010'), '');
  assert.equal(formatarNcm('21069090'), '2106.90.90');
  assert.equal(formatarCest('1700100'), '17.001.00');
});

test('cadastro a mao: codigo e descricao obrigatorios, mensagem em portugues', () => {
  assert.deepEqual(lerNovoNcm({ codigo: '2106.90.90', descricao: '  Preparações   alimentícias ' }), { ok: true, valor: { codigo: '21069090', descricao: 'Preparações alimentícias' } });
  const semCodigo = lerNovoNcm({ codigo: '12', descricao: 'x' });
  assert.ok(!semCodigo.ok && /8 números/.test(semCodigo.erro));
  const semDescricao = lerNovoNcm({ codigo: '21069090', descricao: ' ' });
  assert.ok(!semDescricao.ok && /descrição/.test(semDescricao.erro));
  const longa = lerNovoNcm({ codigo: '21069090', descricao: 'a'.repeat(301) });
  assert.ok(!longa.ok && /Resuma/.test(longa.erro));
  assert.deepEqual(lerNovoCest({ codigo: '1700100', descricao: 'Chocolate', ncm: '' }), { ok: true, valor: { codigo: '1700100', descricao: 'Chocolate', ncm: '' } });
  const ncmRuim = lerNovoCest({ codigo: '1700100', descricao: 'Chocolate', ncm: '123' });
  assert.ok(!ncmRuim.ok && /NCM ligado/.test(ncmRuim.erro));
  assert.ok(!lerNovoCest(null).ok);
});

test('uso: so codigos validos, sem repetir, CEST com os NCMs', () => {
  assert.deepEqual(codigosDoUso([
    { ncm: '21069090', cest: '1700100' },
    { ncm: '2106.90.90' },
    { ncm: '19059090', cest: '17.001.00' },
    { ncm: '1', cest: '2' },
    null,
  ]), { ncms: ['19059090', '21069090'], cests: [{ codigo: '1700100', ncms: ['19059090', '21069090'] }] });
  assert.deepEqual(codigosDoUso('x'), { ncms: [], cests: [] });
});

test('descricao: nova ou vazia qualquer um descreve; ja descrita so o suporte', () => {
  assert.equal(podeDescrever('', false), true);
  assert.equal(podeDescrever(undefined, false), true);
  assert.equal(podeDescrever('Preparações', false), false);
  assert.equal(podeDescrever('Preparações', true), true);
});

test('busca: digitos pelo comeco do codigo, texto na descricao', () => {
  const base = [{ codigo: '21069090', descricao: 'Preparações alimentícias' }, { codigo: '11041200', descricao: 'Grãos de aveia' }];
  assert.deepEqual(filtrarTabela(base, '2106.90').map((l) => l.codigo), ['21069090']);
  assert.deepEqual(filtrarTabela(base, 'AVEIA').map((l) => l.codigo), ['11041200']);
  assert.equal(filtrarTabela(base, '').length, 2);
  assert.equal(filtrarTabela(base, '9090').length, 0, 'codigo procura pelo comeco');
});
