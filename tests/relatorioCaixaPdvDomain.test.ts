import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  montarDocumentoCaixaPdv,
  resultadoDoFechamento,
  totaisPorForma,
  totalDoCaixaAberto,
  type LancamentoDoCaixaAberto,
  type SessaoCaixaDoRelatorio,
} from '../src/utils/relatorioCaixaPdvDomain';

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

// Caixa aberto ao vivo (23/11/2026): o relatorio mostra o que ja' passou pelo caixa sem esperar fechar.
test('caixa aberto ao vivo: esperado de agora, total por forma e lancamentos; cancelado fica fora dos totais', () => {
  const lancamento = (parcial: Partial<LancamentoDoCaixaAberto>): LancamentoDoCaixaAberto => ({
    id: 'l', descricao: 'Venda Direta #0004 - Dinheiro', clienteNome: 'CONSUMIDOR FINAL', formaPagamento: 'Dinheiro', valorCentavos: 7710,
    criadoEm: new Date('2026-11-23T15:00:00Z'), cancelado: false, pendente: false, ...parcial,
  });
  const lancamentos = [
    lancamento({ id: 'l1' }),
    lancamento({ id: 'l2', formaPagamento: 'Pix', valorCentavos: 20000, descricao: 'Venda Direta #0005 - Pix' }),
    lancamento({ id: 'l3', formaPagamento: 'Dinheiro', valorCentavos: 2290 }),
    lancamento({ id: 'l4', formaPagamento: 'Boleto', valorCentavos: 39996, pendente: true }),
    lancamento({ id: 'l5', formaPagamento: 'Dinheiro', valorCentavos: 99900, cancelado: true }),
  ];
  assert.deepEqual(totaisPorForma(lancamentos), [
    { formaPagamento: 'Boleto', quantidade: 1, valorCentavos: 39996 },
    { formaPagamento: 'Pix', quantidade: 1, valorCentavos: 20000 },
    { formaPagamento: 'Dinheiro', quantidade: 2, valorCentavos: 10000 },
  ]);
  assert.equal(totalDoCaixaAberto(lancamentos), 69996);

  const aberta = sessao({ id: 'x', operadorNome: 'CAIXA', status: 'aberto', fechadoEm: null, saldoEsperadoCentavos: null, saldoFinalInformadoCentavos: null, diferencaCentavos: null, esperadoAoVivoCentavos: 20000, lancamentos });
  const doc = montarDocumentoCaixaPdv([aberta, sessao({ id: 'f' })], { periodo: 'Hoje', filtrosAplicados: [] });
  const sessoes = doc.secoes.find((s) => s.id === 'sessoes')!;
  const coluna = (id: string) => sessoes.colunas.find((c) => c.id === id)!;
  assert.equal(coluna('esperado').valor(aberta), 20000, 'aberto: esperado de agora');
  assert.equal(coluna('esperado').valor(sessao({ id: 'f' })), 50000, 'fechado: o que ficou gravado');
  assert.equal(coluna('informado').valor(aberta), null);
  assert.equal(coluna('vendido').valor(aberta), 69996);

  const formas = doc.secoes.find((s) => s.id === 'formasAbertos')!;
  assert.equal(formas.padrao, true);
  assert.deepEqual(formas.linhas.map((f: { formaPagamento: string }) => f.formaPagamento), ['Boleto', 'Pix', 'Dinheiro']);
  const linhas = doc.secoes.find((s) => s.id === 'lancamentosAbertos')!;
  assert.equal(linhas.linhas.length, 5);
  const situacao = linhas.colunas.find((c) => c.id === 'situacao')!;
  assert.deepEqual(linhas.linhas.map((l: LancamentoDoCaixaAberto) => situacao.valor(l)), ['Recebido', 'Recebido', 'Recebido', 'A receber', 'Cancelado']);
  assert.match(String(doc.indicadores.find((i) => i.rotulo === 'Vendido nos caixas abertos')?.valor), /699,96/);

  // So' sessoes fechadas: as secoes novas existem, mas nao vem marcadas.
  const soFechadas = montarDocumentoCaixaPdv([sessao({ id: 'f' })], { periodo: 'Hoje', filtrosAplicados: [] });
  assert.equal(soFechadas.secoes.find((s) => s.id === 'lancamentosAbertos')!.padrao, false);
  assert.equal(soFechadas.indicadores.some((i) => i.rotulo === 'Vendido nos caixas abertos'), false);
});
