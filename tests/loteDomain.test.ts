import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  avisoDeLoteVencido,
  contarPorAba,
  diasParaVencer,
  escolherLotesFefo,
  ordenarLotesFefo,
  parseLoteAvisarVencido,
  parseLoteModoSaida,
  pertenceAAba,
  situacaoDoLote,
  type LoteSaldo,
} from '../src/utils/loteDomain';

const HOJE = '2026-09-25';
const lote = (id: string, validade: string | null, quantidade: number, nome = id): LoteSaldo => ({ id, lote: nome, validade, quantidade });

test('configuração: modo padrão é automático e aviso de vencido fica ligado', () => {
  assert.equal(parseLoteModoSaida(undefined), 'automatico');
  assert.equal(parseLoteModoSaida('informar'), 'informar');
  assert.equal(parseLoteModoSaida('qualquer'), 'automatico');
  assert.equal(parseLoteAvisarVencido(undefined), true);
  assert.equal(parseLoteAvisarVencido(false), false);
  assert.equal(parseLoteAvisarVencido('false'), true);
});

test('dias para vencer: hoje = 0, ontem = -1, virada de mês e ano, data inválida = null', () => {
  assert.equal(diasParaVencer('2026-09-25', HOJE), 0);
  assert.equal(diasParaVencer('2026-09-24', HOJE), -1);
  assert.equal(diasParaVencer('2026-10-10', HOJE), 15);
  assert.equal(diasParaVencer('2027-01-01', HOJE), 98);
  assert.equal(diasParaVencer(null, HOJE), null);
  assert.equal(diasParaVencer('25/09/2026', HOJE), null);
});

test('situação: vence hoje ainda é vendável; limites 15/30/45 são inclusivos', () => {
  assert.equal(situacaoDoLote('2026-09-24', HOJE), 'vencido');
  assert.equal(situacaoDoLote('2026-09-25', HOJE), 'vence_15');
  assert.equal(situacaoDoLote('2026-10-10', HOJE), 'vence_15');
  assert.equal(situacaoDoLote('2026-10-11', HOJE), 'vence_30');
  assert.equal(situacaoDoLote('2026-10-25', HOJE), 'vence_30');
  assert.equal(situacaoDoLote('2026-10-26', HOJE), 'vence_45');
  assert.equal(situacaoDoLote('2026-11-09', HOJE), 'vence_45');
  assert.equal(situacaoDoLote('2026-11-10', HOJE), 'ok');
  assert.equal(situacaoDoLote('', HOJE), 'sem_validade');
});

test('FEFO: validade mais próxima primeiro, sem validade por último, empate pelo nome do lote', () => {
  const ordem = ordenarLotesFefo([lote('a', null, 1, 'A'), lote('b', '2027-01-01', 1, 'B'), lote('c', '2026-11-01', 1, 'C10'), lote('d', '2026-11-01', 1, 'C2')]);
  assert.deepEqual(ordem.map((l) => l.id), ['d', 'c', 'b', 'a']);
});

test('automático: um lote só atende; divide entre lotes quando um não basta', () => {
  const lotes = [lote('l2', '2026-12-01', 5), lote('l1', '2026-11-01', 3)];
  const um = escolherLotesFefo(2, lotes, HOJE);
  assert.deepEqual(um.escolhas.map((e) => [e.loteId, e.quantidade]), [['l1', 2]]);
  assert.equal(um.faltante, 0);
  const dois = escolherLotesFefo(6, lotes, HOJE);
  assert.deepEqual(dois.escolhas.map((e) => [e.loteId, e.quantidade]), [['l1', 3], ['l2', 3]]);
  assert.equal(dois.usouVencido, false);
});

test('automático: pula lote vencido; só usa vencido (avisando) quando falta lote vigente', () => {
  const lotes = [lote('velho', '2026-08-01', 10), lote('novo', '2026-12-01', 4)];
  const normal = escolherLotesFefo(3, lotes, HOJE);
  assert.deepEqual(normal.escolhas.map((e) => e.loteId), ['novo']);
  assert.equal(normal.usouVencido, false);
  const faltando = escolherLotesFefo(6, lotes, HOJE);
  assert.deepEqual(faltando.escolhas.map((e) => [e.loteId, e.quantidade, e.vencido]), [['novo', 4, false], ['velho', 2, true]]);
  assert.equal(faltando.usouVencido, true);
});

test('automático: saldo insuficiente devolve o faltante; lote zerado e quantidade fracionada', () => {
  const r = escolherLotesFefo(10, [lote('a', null, 0), lote('b', '2026-12-01', 2.5)], HOJE);
  assert.deepEqual(r.escolhas.map((e) => [e.loteId, e.quantidade]), [['b', 2.5]]);
  assert.equal(r.faltante, 7.5);
  assert.equal(escolherLotesFefo(0.1 + 0.2, [lote('a', null, 1)], HOJE).escolhas[0].quantidade, 0.3);
});

test('abas: 15/30/45 são acumuladas, vencidos separado, lote zerado só aparece em Todos', () => {
  const lotes = [
    lote('venc', '2026-09-01', 5),
    lote('d10', '2026-10-05', 5),
    lote('d25', '2026-10-20', 5),
    lote('d40', '2026-11-04', 5),
    lote('longe', '2027-06-01', 5),
    lote('semval', null, 5),
    lote('zerado', '2026-10-01', 0),
  ];
  assert.deepEqual(contarPorAba(lotes, HOJE), { vencidos: 1, vence_15: 1, vence_30: 2, vence_45: 3, todos: 7 });
  assert.equal(pertenceAAba(lotes[1], 'vence_45', HOJE), true);
  assert.equal(pertenceAAba(lotes[0], 'vence_45', HOJE), false);
  assert.equal(pertenceAAba(lotes[6], 'vence_15', HOJE), false);
});

test('aviso de vencido lista produto e lote, e some quando não há nada vencido', () => {
  assert.equal(avisoDeLoteVencido([]), null);
  const aviso = avisoDeLoteVencido([{ produto: 'ARROZ', lote: 'L1', validade: '2026-08-01' }]);
  assert.match(String(aviso), /ARROZ — lote L1 \(venceu em 01\/08\/2026\)/);
  assert.match(String(aviso), /segue normalmente/);
});

import { lotesDaTela, montarDocumentoLotes, rotuloDosDias, type LoteDoProduto } from '../src/utils/lotesRelatorioDomain';

const lp = (id: string, produtoNome: string, validade: string | null, quantidade: number, lote = id): LoteDoProduto => ({ id, lote, validade, quantidade, produtoId: `p-${id}`, produtoNome, produtoCodigo: `C-${id}` });

test('tela de lotes: aba, busca sem acento, ordem pelo que vence primeiro', () => {
  const todos = [lp('a', 'IOGURTE', '2026-10-20', 5), lp('b', 'ARROZ', '2026-10-01', 3), lp('c', 'FEIJÃO', '2026-08-01', 2), lp('d', 'LEITE', null, 9)];
  assert.deepEqual(lotesDaTela(todos, 'vence_30', '', HOJE).map((l) => l.id), ['b', 'a']);
  assert.deepEqual(lotesDaTela(todos, 'vencidos', '', HOJE).map((l) => l.id), ['c']);
  assert.deepEqual(lotesDaTela(todos, 'todos', '', HOJE).map((l) => l.id), ['c', 'b', 'a', 'd']);
  assert.deepEqual(lotesDaTela(todos, 'todos', 'feijao', HOJE).map((l) => l.id), ['c']);
  assert.deepEqual(lotesDaTela(todos, 'todos', 'c-b', HOJE).map((l) => l.id), ['b']);
});

test('rótulo dos dias e documento do PDF', () => {
  assert.equal(rotuloDosDias('2026-09-25', HOJE), 'vence hoje');
  assert.equal(rotuloDosDias('2026-09-26', HOJE), '1 dia');
  assert.equal(rotuloDosDias('2026-09-20', HOJE), 'venceu há 5 dias');
  assert.equal(rotuloDosDias(null, HOJE), '');
  const doc = montarDocumentoLotes([lp('c', 'FEIJÃO', '2026-08-01', 2), lp('b', 'ARROZ', '2026-10-01', 3)], 'vencidos', '', HOJE);
  assert.equal(doc.titulo, 'Lotes e Validades');
  assert.equal(doc.periodo, 'Posição em 25/09/2026');
  assert.deepEqual(doc.indicadores.map((i) => i.valor), ['1', '1', '1', '1', '1']);
  assert.equal(doc.secoes[0].linhas.length, 1);
});

import { chaveDoLote, lotesDaEntrada, somarLotesIguais } from '../src/utils/loteDomain';

const baseEntrada = { produto: 'IOGURTE', loteDigitado: '', validadeDigitada: '', lotesDoXml: [], quantidadeNota: 10, fator: 1 };

test('entrada: sem lote na nota nem na tela, pede o lote em português (não inventa)', () => {
  const r = lotesDaEntrada(baseEntrada);
  assert.deepEqual(r.lotes, []);
  assert.match(String(r.erro), /controla lote, mas a nota não trouxe o lote/);
});

test('entrada: lote digitado sem validade pede a validade; com a do XML aproveita', () => {
  assert.match(String(lotesDaEntrada({ ...baseEntrada, loteDigitado: 'L1' }).erro), /Informe a validade do lote "L1"/);
  const r = lotesDaEntrada({ ...baseEntrada, loteDigitado: ' l1 ', lotesDoXml: [{ numero: 'L1', validade: '2027-01-31', quantidade: 10 }] });
  assert.equal(r.erro, null);
  assert.deepEqual(r.lotes, [{ lote: 'l1', validade: '2027-01-31', quantidade: 10 }]);
});

test('entrada: um lote no XML vira o lote, e a quantidade vai convertida para a unidade de estoque', () => {
  const r = lotesDaEntrada({ ...baseEntrada, quantidadeNota: 3, fator: 12, lotesDoXml: [{ numero: 'A9', validade: '2027-05-01', quantidade: 3 }] });
  assert.equal(r.erro, null);
  assert.deepEqual(r.lotes, [{ lote: 'A9', validade: '2027-05-01', quantidade: 36 }]);
  assert.equal(lotesDaEntrada({ ...baseEntrada, validadeDigitada: '2027-06-01', lotesDoXml: [{ numero: 'A9', validade: '', quantidade: 10 }] }).lotes[0].validade, '2027-06-01');
  assert.match(String(lotesDaEntrada({ ...baseEntrada, lotesDoXml: [{ numero: 'A9', validade: '', quantidade: 10 }] }).erro), /sem validade/);
});

test('entrada: vários lotes no XML dividem a quantidade só quando a soma fecha', () => {
  const xml = [{ numero: 'A', validade: '2027-01-01', quantidade: 4 }, { numero: 'B', validade: '2027-02-01', quantidade: 6 }];
  const ok = lotesDaEntrada({ ...baseEntrada, lotesDoXml: xml });
  assert.equal(ok.erro, null);
  assert.deepEqual(ok.lotes.map((l) => [l.lote, l.quantidade]), [['A', 4], ['B', 6]]);
  assert.match(String(lotesDaEntrada({ ...baseEntrada, quantidadeNota: 11, lotesDoXml: xml }).erro), /não fecha/);
  assert.match(String(lotesDaEntrada({ ...baseEntrada, lotesDoXml: [xml[0], { numero: 'B', validade: '', quantidade: 6 }] }).erro), /veio sem validade/);
});

test('entrada: validade digitada inválida é recusada; lotes iguais se somam', () => {
  assert.match(String(lotesDaEntrada({ ...baseEntrada, loteDigitado: 'L', validadeDigitada: '31/12/2027' }).erro), /não é uma data válida/);
  assert.equal(chaveDoLote(' ab-1 '), 'AB-1');
  assert.deepEqual(somarLotesIguais([{ lote: 'A', validade: '2027-01-01', quantidade: 2 }, { lote: ' a ', validade: '2027-01-01', quantidade: 3 }]), [{ lote: 'A', validade: '2027-01-01', quantidade: 5 }]);
});
