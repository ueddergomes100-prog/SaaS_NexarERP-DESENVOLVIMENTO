import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  diasDeAtrasoDoCheque,
  montarDocumentoCheques,
  resumoPorPessoaCheques,
  situacaoDoCheque,
  type ChequeDoRelatorio,
} from '../src/utils/relatorioChequesDomain';

const HOJE = '2026-10-16';
const base = { tipo: 'entrada' as const, descricao: 'Venda', valorCentavos: 10000 };
const CHEQUES: ChequeDoRelatorio[] = [
  { ...base, id: 'a', status: 'Pendente', pessoa: 'Maria', bomPara: '2026-10-20', numero: '000123', bancoEmissor: 'Sicoob' },
  { ...base, id: 'b', status: 'Pendente', pessoa: 'maria', bomPara: '2026-10-15', valorCentavos: 5000 },
  { ...base, id: 'c', status: 'Paga', pessoa: 'João', bomPara: '2026-10-01', dataPagamento: '2026-10-02', bancoDestino: 'Sicredi' },
];

test('situacao: a compensar, vencido com dias e compensado', () => {
  assert.equal(situacaoDoCheque(CHEQUES[0], HOJE), 'A compensar');
  assert.equal(situacaoDoCheque(CHEQUES[1], HOJE), 'Vencido há 1 dia');
  assert.equal(situacaoDoCheque(CHEQUES[2], HOJE), 'Compensado');
  assert.equal(diasDeAtrasoDoCheque(CHEQUES[2], HOJE), 0);
  assert.equal(situacaoDoCheque({ ...CHEQUES[1], bomPara: '2026-10-10' }, HOJE), 'Vencido há 6 dias');
});

test('resumo por pessoa junta maiuscula/minuscula', () => {
  const resumo = resumoPorPessoaCheques(CHEQUES);
  assert.equal(resumo[0].cheques, 2);
  assert.equal(resumo[0].valorCentavos, 15000);
});

test('relatorio de recebidos: ordem por bom para, indicadores e cheque sem dados', () => {
  const doc = montarDocumentoCheques(CHEQUES, { emitidos: false, filtrosAplicados: [], periodo: 'A compensar', dataHoje: HOJE });
  assert.equal(doc.titulo, 'Cheques Recebidos');
  const secao = doc.secoes.find((s) => s.id === 'cheques')!;
  assert.deepEqual(secao.linhas.map((c: ChequeDoRelatorio) => c.id), ['c', 'b', 'a']);
  const ind = Object.fromEntries(doc.indicadores.map((i) => [i.rotulo, i.valor]));
  assert.equal(ind.Cheques, '3');
  assert.match(ind['Valor total'], /250,00/);
  assert.match(ind['A compensar'], /150,00/);
  assert.match(ind.Vencidos, /^1 \(/);
  const coluna = (id: string) => secao.colunas.find((c) => c.id === id)!;
  // Cheque do pagamento simplificado: sem numero/banco, celula vazia (nunca "undefined").
  assert.equal(coluna('numero').valor(CHEQUES[1]), '');
  assert.equal(coluna('destino').valor(CHEQUES[1]), 'Escolhido ao compensar');
  assert.equal(coluna('compensado').valor(CHEQUES[2]), '02/10/2026');
  CHEQUES.forEach((c) => secao.colunas.forEach((col) => assert.notEqual(col.valor(c), undefined, col.id)));
});

test('relatorio de emitidos: titulo e colunas de fornecedor/banco da empresa', () => {
  const doc = montarDocumentoCheques([{ ...CHEQUES[0], tipo: 'saida', bancoDestino: 'Caixa' }], { emitidos: true, filtrosAplicados: [], periodo: '', dataHoje: HOJE });
  assert.equal(doc.titulo, 'Cheques Emitidos');
  const secao = doc.secoes[0];
  assert.equal(secao.colunas.find((c) => c.id === 'pessoa')!.titulo, 'Fornecedor');
  assert.equal(secao.colunas.find((c) => c.id === 'banco')!.valor(secao.linhas[0]), 'Caixa');
  assert.equal(secao.colunas.some((c) => c.id === 'destino'), false);
});
