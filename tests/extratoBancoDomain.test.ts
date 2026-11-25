import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agruparExtratoPorBanco,
  chaveDoBanco,
  corDoBanco,
  COR_SEM_BANCO,
  dataDoExtrato,
  formatarDataDoExtrato,
  NOME_SEM_BANCO,
  pertenceAoFiltro,
  SEM_BANCO,
  TODOS_OS_BANCOS,
  type LinhaDoExtrato,
} from '../src/utils/extratoBancoDomain';

const BANCOS = [
  { id: 'santo', nome: 'SICOOB SANTO ANTONIO' },
  { id: 'infinite', nome: 'INFINITEPAY' },
  { id: 'saude', nome: 'SICOOB SAUDE' },
];

const linha = (dados: Partial<LinhaDoExtrato> & { id: string }): LinhaDoExtrato => ({
  tipo: 'entrada', centavos: 100, ...dados,
});

test('data do extrato e a do pagamento; sem ela, a do lancamento; lixo vira vazio', () => {
  // Boleto vencendo dia 27 e pago dia 23 aparece no dia 23 (antes aparecia no 27).
  assert.equal(dataDoExtrato({ data: '2026-11-27', dataPagamento: '2026-11-23' }), '2026-11-23');
  assert.equal(dataDoExtrato({ data: '2026-11-27' }), '2026-11-27');
  assert.equal(dataDoExtrato({ data: '2026-11-27T10:00:00Z' }), '2026-11-27');
  assert.equal(dataDoExtrato({ data: 'ontem', dataPagamento: '' }), '');
  assert.equal(formatarDataDoExtrato('2026-11-23'), '23/11/2026');
  assert.equal(formatarDataDoExtrato(''), '-');
});

test('grupo do lancamento: id do cadastro, senao o nome, senao "sem banco"', () => {
  assert.equal(chaveDoBanco({ bancoId: 'saude' }, BANCOS), 'saude');
  assert.equal(chaveDoBanco({ bancoNome: ' sicoob santo antonio ' }, BANCOS), 'santo');
  assert.equal(chaveDoBanco({}, BANCOS), SEM_BANCO);
  // Banco que saiu do cadastro continua no grupo dele (pelo id), nao some no "sem banco".
  assert.equal(chaveDoBanco({ bancoId: 'antigo', bancoNome: 'CAIXA ECONOMICA' }, BANCOS), 'antigo');
});

test('extrato separado por banco: ordem do cadastro, sem banco no fim, totais e resultado de cada um', () => {
  const grupos = agruparExtratoPorBanco([
    linha({ id: 'a', bancoId: 'saude', tipo: 'saida', centavos: 491181, data: '2026-11-24' }),
    linha({ id: 'b', bancoId: 'santo', tipo: 'entrada', centavos: 425000, data: '2026-11-21', dataPagamento: '2026-11-23' }),
    linha({ id: 'c', tipo: 'entrada', centavos: 5000, data: '2026-11-20' }),
    linha({ id: 'd', bancoId: 'santo', tipo: 'saida', centavos: 300317, data: '2026-11-25' }),
    linha({ id: 'e', bancoNome: 'SICOOB SANTO ANTONIO', tipo: 'entrada', centavos: 9699, data: '2026-11-18' }),
  ], BANCOS);
  assert.deepEqual(grupos.map((g) => g.chave), ['santo', 'saude', SEM_BANCO]);
  const santo = grupos[0];
  assert.equal(santo.nome, 'SICOOB SANTO ANTONIO');
  assert.deepEqual(santo.linhas.map((l) => l.id), ['d', 'b', 'e'], 'mais recente primeiro, pela data do pagamento');
  assert.equal(santo.entradasCentavos, 434699);
  assert.equal(santo.saidasCentavos, 300317);
  assert.equal(santo.resultadoCentavos, 134382);
  assert.equal(grupos[1].resultadoCentavos, -491181, 'banco so com saida fica negativo');
  assert.equal(grupos[2].nome, NOME_SEM_BANCO);
  // INFINITEPAY nao teve lancamento no periodo: nao vira grupo vazio.
  assert.ok(!grupos.some((g) => g.chave === 'infinite'));
});

test('mesmo dia: o lancamento gravado por ultimo vem primeiro; valor torto nao entra negativo', () => {
  const [grupo] = agruparExtratoPorBanco([
    linha({ id: 'cedo', bancoId: 'santo', data: '2026-11-25', criadoEmMs: 1000 }),
    linha({ id: 'tarde', bancoId: 'santo', data: '2026-11-25', criadoEmMs: 2000 }),
    linha({ id: 'torto', bancoId: 'santo', data: '2026-11-25', centavos: -50 }),
  ], BANCOS);
  assert.deepEqual(grupo.linhas.map((l) => l.id), ['tarde', 'cedo', 'torto']);
  assert.equal(grupo.entradasCentavos, 200);
});

test('banco fora do cadastro vem depois dos cadastrados, pelo nome gravado', () => {
  const grupos = agruparExtratoPorBanco([
    linha({ id: 'x', bancoId: 'antigo', bancoNome: 'CAIXA ECONOMICA' }),
    linha({ id: 'y', bancoId: 'infinite' }),
  ], BANCOS);
  assert.deepEqual(grupos.map((g) => g.nome), ['INFINITEPAY', 'CAIXA ECONOMICA']);
});

test('filtro por banco e cor de cada banco', () => {
  assert.equal(pertenceAoFiltro({ bancoId: 'saude' }, TODOS_OS_BANCOS, BANCOS), true);
  assert.equal(pertenceAoFiltro({ bancoId: 'saude' }, 'santo', BANCOS), false);
  assert.equal(pertenceAoFiltro({ bancoNome: 'SICOOB SANTO ANTONIO' }, 'santo', BANCOS), true);
  assert.equal(pertenceAoFiltro({}, SEM_BANCO, BANCOS), true);
  assert.notEqual(corDoBanco('santo', BANCOS), corDoBanco('infinite', BANCOS));
  assert.equal(corDoBanco('santo', BANCOS), corDoBanco('santo', BANCOS));
  assert.equal(corDoBanco(SEM_BANCO, BANCOS), COR_SEM_BANCO);
});
