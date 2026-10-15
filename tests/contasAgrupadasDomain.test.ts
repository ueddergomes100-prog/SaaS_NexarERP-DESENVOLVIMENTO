import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agruparContasPorNome, nomeDoGrupo } from '../src/utils/contasAgrupadasDomain';

const HOJE = '2026-10-15';
const conta = (id: string, nome: string, vencimento: string, valor: number, descricao = `Venda ${id}`) => ({ id, nome, descricao, vencimento, valor });

test('o cliente que deve 3 notas vira uma linha so\', com quantidade, total e a mais antiga', () => {
  const grupos = agruparContasPorNome([
    conta('3', 'MARIA', '2026-11-10', 100.1),
    conta('1', 'maria ', '2026-10-01', 100.1),
    conta('9', 'JOSÉ', '2026-10-20', 50),
    conta('2', 'Maria', '2026-10-20', 100.1),
  ], HOJE);
  assert.deepEqual(grupos.map((g) => [g.nome, g.quantidade]), [['maria', 3], ['JOSÉ', 1]]);
  const maria = grupos[0];
  assert.equal(maria.total, 300.3, 'soma em centavos, sem erro de arredondamento');
  assert.equal(maria.vencimentoMaisAntigo, '2026-10-01');
  assert.equal(maria.vencidas, 1);
  assert.deepEqual(maria.contas.map((c) => c.id), ['1', '2', '3'], 'notas da mais antiga a mais nova');
});

test('acento e espaco de digitacao nao separam o mesmo nome', () => {
  const grupos = agruparContasPorNome([conta('1', 'JOSE  DA SILVA', HOJE, 10), conta('2', 'José da Silva', HOJE, 10)], HOJE);
  assert.equal(grupos.length, 1);
  assert.equal(grupos[0].quantidade, 2);
});

test('conta sem cliente/fornecedor agrupa pela descricao', () => {
  assert.equal(nomeDoGrupo({ nome: '  ', descricao: 'ALUGUEL' }), 'ALUGUEL');
  assert.equal(nomeDoGrupo({ nome: '', descricao: '' }), 'Sem descrição');
  const grupos = agruparContasPorNome([
    conta('1', '', '2026-10-05', 1500, 'ALUGUEL'),
    conta('2', '', '2026-11-05', 1500, 'ALUGUEL'),
  ], HOJE);
  assert.deepEqual(grupos.map((g) => [g.nome, g.quantidade, g.total]), [['ALUGUEL', 2, 3000]]);
});

test('os grupos vem do mais urgente (conta mais antiga) ao mais novo; sem vencimento por ultimo', () => {
  const grupos = agruparContasPorNome([
    conta('1', 'B', '2026-12-01', 1),
    conta('2', 'C', '', 1),
    conta('3', 'A', '2026-12-01', 1),
    conta('4', 'D', '2026-09-01', 1),
  ], HOJE);
  assert.deepEqual(grupos.map((g) => g.nome), ['D', 'A', 'B', 'C']);
});
