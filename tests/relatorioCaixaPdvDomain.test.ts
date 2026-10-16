import assert from 'node:assert/strict';
import { test } from 'node:test';
import { montarDocumentoCaixaPdv, resultadoDoFechamento, type SessaoCaixaDoRelatorio } from '../src/utils/relatorioCaixaPdvDomain';

const sessao = (parcial: Partial<SessaoCaixaDoRelatorio>): SessaoCaixaDoRelatorio => ({
  id: 's', operadorNome: 'Ana', status: 'fechado', abertoEm: new Date('2026-10-15T11:00:00Z'), fechadoEm: new Date('2026-10-15T21:00:00Z'),
  saldoInicialCentavos: 10000, totalSangriasCentavos: 0, saldoEsperadoCentavos: 50000, saldoFinalInformadoCentavos: 50000,
  diferencaCentavos: 0, sangrias: [], ...parcial,
});

const SESSOES = [
  sessao({ id: 'b', abertoEm: new Date('2026-10-16T11:00:00Z'), diferencaCentavos: -1500, totalSangriasCentavos: 20000, sangrias: [{ valorCentavos: 20000, motivo: 'Depósito', registradoEm: '2026-10-16T15:00:00Z', registradoPorNome: 'Gerente' }] }),
  sessao({ id: 'a', diferencaCentavos: 0 }),
  sessao({ id: 'c', operadorNome: 'Bia', status: 'aberto', fechadoEm: null, abertoEm: new Date('2026-10-16T12:00:00Z'), saldoEsperadoCentavos: null, saldoFinalInformadoCentavos: null, diferencaCentavos: null }),
];

test('resultado do fechamento: conferido, sobrou, faltou, aberto', () => {
  assert.equal(resultadoDoFechamento(sessao({ diferencaCentavos: 0 })), 'Conferido');
  assert.match(resultadoDoFechamento(sessao({ diferencaCentavos: 250 })), /^Sobrou R\$\s2,50$/);
  assert.match(resultadoDoFechamento(sessao({ diferencaCentavos: -1500 })), /^Faltou R\$\s15,00$/);
  assert.equal(resultadoDoFechamento(sessao({ status: 'aberto' })), 'Aberto');
});

test('relatorio: ordem por abertura, indicadores e sangrias', () => {
  const doc = montarDocumentoCaixaPdv(SESSOES, { periodo: 'Últimos 30 dias', filtrosAplicados: [] });
  const secao = doc.secoes.find((s) => s.id === 'sessoes')!;
  assert.deepEqual(secao.linhas.map((s: SessaoCaixaDoRelatorio) => s.id), ['a', 'b', 'c']);
  const ind = Object.fromEntries(doc.indicadores.map((i) => [i.rotulo, i.valor]));
  assert.equal(ind['Sessões'], '3');
  assert.equal(ind['Abertas agora'], '1');
  assert.match(ind.Sangrias, /200,00/);
  assert.match(ind['Diferença no fechamento'], /-R\$\s15,00|R\$\s-15,00/);
  assert.equal(ind['Fechamentos com diferença'], '1');

  const coluna = (id: string) => secao.colunas.find((c) => c.id === id)!;
  // Caixa aberto: fechamento, esperado e diferenca em branco (nao zero).
  assert.equal(coluna('fechamento').valor(SESSOES[2]), null);
  assert.equal(coluna('diferenca').valor(SESSOES[2]), null);
  assert.equal(coluna('inicial').total, 'nenhum');

  const sangrias = doc.secoes.find((s) => s.id === 'sangrias')!;
  assert.equal(sangrias.linhas.length, 1);
  assert.equal(sangrias.linhas[0].operadorNome, 'Ana');
  assert.equal(sangrias.padrao, false);
});
