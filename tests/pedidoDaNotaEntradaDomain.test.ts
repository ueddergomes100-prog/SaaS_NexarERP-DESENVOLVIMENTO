import assert from 'node:assert/strict';
import { test } from 'node:test';
import { itensDaNotaParaVenda, notasDeEntradaParaEscolha, observacaoDoPedidoDaNota, rotuloDaNotaDeEntrada } from '../src/utils/pedidoDaNotaEntradaDomain';
import type { NotaFiscalEntradaItemRecord } from '../src/utils/entradaNfeDomain';

const item = (parte: Partial<NotaFiscalEntradaItemRecord>): NotaFiscalEntradaItemRecord => ({
  itemId: 'p1', tipo: 'revenda', codigoXml: '1', descricaoXml: 'FILTRO', quantidade: 2, valorUnitario: 100, novo: false, ...parte,
});

test('itens da nota: so revenda, na unidade do estoque, somando o mesmo produto', () => {
  const r = itensDaNotaParaVenda([
    item({ itemId: 'p1', quantidade: 2, fator: 20, quantidadeEstoque: 40, valorUnitario: 200 }),
    item({ itemId: 'p1', quantidade: 1, fator: 20, quantidadeEstoque: 20, valorUnitario: 200 }),
    item({ itemId: 'p2', descricaoXml: 'RETENTOR', quantidade: 3 }),
  ]);
  assert.deepEqual(r.linhas.map((l) => [l.produtoId, l.quantidade, l.valorUnitarioNota]), [['p1', 60, 10], ['p2', 3, 100]]);
  assert.deepEqual(r.deFora, []);
});

test('itens da nota: materia-prima, insumo, so registrado e sem quantidade ficam de fora com motivo', () => {
  const r = itensDaNotaParaVenda([
    item({ itemId: 'm1', tipo: 'materia_prima', descricaoXml: 'FUBA' }),
    item({ itemId: 'i1', tipo: 'insumo', descricaoXml: 'CAIXA' }),
    item({ itemId: 'r1', tipo: 'registro', descricaoXml: 'MAQUINA' }),
    item({ itemId: '', descricaoXml: 'SEM CADASTRO' }),
    item({ itemId: 'p9', descricaoXml: 'ZERADO', quantidade: 0 }),
    item({ itemId: 'p1', quantidade: 1 }),
  ]);
  assert.equal(r.linhas.length, 1);
  assert.equal(r.deFora.length, 5);
  assert.match(r.deFora[0], /FUBA.*matéria-prima/);
  assert.match(r.deFora[1], /CAIXA.*insumo/);
  assert.match(r.deFora[2], /MAQUINA.*só registrado/);
  assert.match(r.deFora[4], /ZERADO.*sem quantidade/);
});

test('itens da nota: nota antiga sem quantidadeEstoque usa quantidade x fator', () => {
  const r = itensDaNotaParaVenda([item({ quantidade: 3, fator: 10 })]);
  assert.equal(r.linhas[0].quantidade, 30);
  assert.equal(r.linhas[0].valorUnitarioNota, 10);
});

test('escolha da nota: so NF-e ativa com itens, mais recente primeiro, busca por numero ou fornecedor', () => {
  const notas = [
    { id: 'a', numeroNF: '100', fornecedorNome: 'ALFA', dataEmissao: '2026-11-01', dataEntrada: '2026-11-02', status: 'ativa', itens: [{}] },
    { id: 'b', numeroNF: '200', fornecedorNome: 'BETA', dataEmissao: '2026-11-05', status: 'ativa', itens: [{}] },
    { id: 'c', numeroNF: '300', fornecedorNome: 'GAMA', dataEmissao: '2026-11-06', status: 'excluida', itens: [{}] },
    { id: 'd', numeroNF: '400', fornecedorNome: 'DELTA', dataEmissao: '2026-11-07', status: 'ativa', tipoDocumento: 'nfse', itens: [] },
    { id: 'e', numeroNF: '500', fornecedorNome: 'EPSILON', dataEmissao: '2026-11-07', status: 'ativa', itens: [] },
  ];
  assert.deepEqual(notasDeEntradaParaEscolha(notas).map((n) => n.id), ['b', 'a']);
  assert.deepEqual(notasDeEntradaParaEscolha(notas, 'alf').map((n) => n.id), ['a']);
  assert.deepEqual(notasDeEntradaParaEscolha(notas, '200').map((n) => n.id), ['b']);
  const rotulo = rotuloDaNotaDeEntrada({ ...notas[0], valorTotal: 1234.5 });
  // O formato de moeda usa espaco fixo (U+00A0) entre R$ e o numero.
  assert.deepEqual({ ...rotulo, detalhe: rotulo.detalhe.replace(/\u00a0/g, ' ') }, { titulo: 'NF 100 · ALFA', detalhe: 'Entrada 02/11/2026 · 1 item(ns) · R$ 1.234,50' });
  assert.equal(observacaoDoPedidoDaNota(notas[1]), 'Montado a partir da NF-e de entrada nº 200 (BETA).');
});
