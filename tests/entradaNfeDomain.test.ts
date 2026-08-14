import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildNotaFiscalEntradaRecord, buildInitialItemEntradaConfig, type NotaFiscalEntradaItemRecord } from '../src/utils/entradaNfeDomain';

const baseItens: NotaFiscalEntradaItemRecord[] = [
  { itemId: 'estoque-1', tipo: 'revenda', codigoXml: 'COD1', descricaoXml: 'PARAFUSO', quantidade: 10, valorUnitario: 2.5, novo: false },
  { itemId: 'estoque-2', tipo: 'revenda', codigoXml: 'COD2', descricaoXml: 'PORCA', quantidade: 20, valorUnitario: 1, novo: true },
];

test('buildNotaFiscalEntradaRecord sempre nasce com status ativa', () => {
  const result = buildNotaFiscalEntradaRecord({
    numeroNF: '12345',
    dataEmissao: '2026-08-14',
    valorTotal: 45,
    fornecedorId: 'fornecedor-1',
    fornecedorNome: 'FORNECEDOR X',
    fornecedorCnpj: '11222333000181',
    itens: baseItens,
    titulosPagarIds: ['transacao-1'],
  });

  assert.equal(result.status, 'ativa');
});

test('buildNotaFiscalEntradaRecord preserva itens e titulosPagarIds sem alterar', () => {
  const titulosPagarIds = ['transacao-1', 'transacao-2'];
  const result = buildNotaFiscalEntradaRecord({
    numeroNF: '999',
    dataEmissao: '2026-08-14',
    valorTotal: 100,
    fornecedorId: 'fornecedor-2',
    fornecedorNome: 'FORNECEDOR Y',
    fornecedorCnpj: '99888777000166',
    itens: baseItens,
    titulosPagarIds,
  });

  assert.deepEqual(result.itens, baseItens);
  assert.deepEqual(result.titulosPagarIds, titulosPagarIds);
});

test('buildNotaFiscalEntradaRecord repassa os dados de cabecalho sem transformar', () => {
  const result = buildNotaFiscalEntradaRecord({
    numeroNF: '42',
    dataEmissao: '2026-01-05',
    valorTotal: 321.5,
    fornecedorId: 'fornecedor-3',
    fornecedorNome: 'FORNECEDOR Z',
    fornecedorCnpj: '00111222000133',
    itens: [],
    titulosPagarIds: [],
  });

  assert.equal(result.numeroNF, '42');
  assert.equal(result.dataEmissao, '2026-01-05');
  assert.equal(result.valorTotal, 321.5);
  assert.equal(result.fornecedorId, 'fornecedor-3');
  assert.equal(result.fornecedorNome, 'FORNECEDOR Z');
  assert.equal(result.fornecedorCnpj, '00111222000133');
});

test('buildInitialItemEntradaConfig: produto existente herda preco de venda e tributacao ja cadastrados', () => {
  const result = buildInitialItemEntradaConfig(
    10,
    { id: 'estoque-1', precoVenda: 25.9, csosn: '101', aliquotaIcms: 18, reducaoBaseIcms: 0, cstPis: '01', aliquotaPis: 1.65, cstCofins: '01', aliquotaCofins: 7.6 },
    null,
    true,
  );

  assert.equal(result.classificacao, 'estoque');
  assert.equal(result.matchId, 'estoque-1');
  assert.equal(result.tipo, 'revenda');
  assert.equal(result.precoVenda, '25.9');
  assert.equal(result.csosn, '101');
  assert.equal(result.aliquotaIcms, '18');
  assert.equal(result.cstPis, '01');
});

test('buildInitialItemEntradaConfig: produto existente sem preco de venda cai na margem padrao de 50%', () => {
  const result = buildInitialItemEntradaConfig(10, { id: 'estoque-2' }, null, true);

  assert.equal(result.precoVenda, '15');
  assert.equal(result.csosn, '102');
});

test('buildInitialItemEntradaConfig: materia-prima existente nunca mostra precificacao', () => {
  const result = buildInitialItemEntradaConfig(10, null, 'mp-1', true);

  assert.equal(result.classificacao, 'materia_prima');
  assert.equal(result.matchId, 'mp-1');
  assert.equal(result.tipo, 'materia_prima');
  assert.equal(result.precoVenda, '');
  assert.equal(result.csosn, '');
});

test('buildInitialItemEntradaConfig: item novo nasce Revenda com margem padrao e CSOSN default do Simples Nacional', () => {
  const result = buildInitialItemEntradaConfig(10, null, null, true);

  assert.equal(result.classificacao, 'novo');
  assert.equal(result.matchId, null);
  assert.equal(result.tipo, 'revenda');
  assert.equal(result.precoVenda, '15');
  assert.equal(result.csosn, '102');
});

test('buildInitialItemEntradaConfig: item novo fora do Simples Nacional nasce sem CSOSN/CST chutado', () => {
  const result = buildInitialItemEntradaConfig(10, null, null, false);

  assert.equal(result.csosn, '');
  assert.equal(result.aliquotaIcms, '');
});
