import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AVISO_PRE_VENDA_NAO_E_FATURAMENTO,
  filtrarPreVendas,
  linhaDePreVenda,
  montarDocumentoPreVendas,
  resumirPreVendasPorVendedor,
  totaisPreVendas,
  type FiltroPreVendas,
  type PreVendaDoRelatorio,
} from '../src/utils/relatorioPreVendasDomain';

const hoje = new Date('2026-10-02T15:00:00Z');
const semFiltro: FiltroPreVendas = { busca: '', origem: '', de: '', ate: '' };

const l = (extra: Partial<PreVendaDoRelatorio>): PreVendaDoRelatorio => ({
  id: Math.random().toString(36).slice(2), numeroPedido: '0100', clienteNome: 'JOÃO', vendedorNome: 'ANA', origem: 'balcao',
  status: 'Pré-venda', data: new Date('2026-09-30T13:00:00Z'), diasEmAberto: 2, totalCents: 10000, itensCount: 1,
  reservaEstoque: true, comNotaFiscal: null, ...extra,
});

const base: PreVendaDoRelatorio[] = [
  l({ id: 'a', numeroPedido: '0154', clienteNome: 'SHOPPING RURAL', totalCents: 15050, diasEmAberto: 9, data: new Date('2026-09-23T17:00:00Z'), comNotaFiscal: true }),
  l({ id: 'b', numeroPedido: '0160', vendedorNome: 'BRUNO', origem: 'agente', status: 'Em Análise', totalCents: 4990, reservaEstoque: false, itensCount: 3 }),
  l({ id: 'c', numeroPedido: '0161', clienteNome: 'MARIA', totalCents: 20000, data: new Date('2026-10-01T02:30:00Z'), diasEmAberto: 1, comNotaFiscal: false }),
];

test('linha do pedido: nome do vendedor pelo cadastro, origem, centavos, dias em aberto e padrões', () => {
  const linha = linhaDePreVenda(
    { id: 'p1', numeroPedido: '0154', status: 'Em Análise', vendedorId: 'u1', valorTotal: 150.5, dataVenda: '2026-09-25', itens: [{}, {}], estoqueReservado: true, comNotaFiscal: true },
    { u1: { nome: 'ANA' } },
    hoje,
  );
  assert.equal(linha.vendedorNome, 'ANA');
  assert.equal(linha.clienteNome, 'Não informado');
  assert.equal(linha.origem, 'agente', '"Em Análise" sem origem gravada veio do agente');
  assert.equal(linha.totalCents, 15050);
  assert.equal(linha.itensCount, 2);
  assert.equal(linha.diasEmAberto, 7);
  assert.equal(linha.comNotaFiscal, true);

  const semNada = linhaDePreVenda({ id: 'p2', valorTotalCentavos: 990, createdAt: { seconds: hoje.getTime() / 1000 } }, {}, hoje);
  assert.equal(semNada.vendedorNome, 'Não identificado');
  assert.equal(semNada.status, 'Pré-venda');
  assert.equal(semNada.totalCents, 990);
  assert.equal(semNada.diasEmAberto, 0);
  assert.equal(semNada.comNotaFiscal, null);
  assert.equal(semNada.reservaEstoque, false);
});

test('filtros da tela: origem, busca (cliente, número, vendedor) e período inclusivo no dia final', () => {
  assert.deepEqual(filtrarPreVendas(base, { ...semFiltro, origem: 'agente' }).map((x) => x.id), ['b']);
  assert.deepEqual(filtrarPreVendas(base, { ...semFiltro, busca: 'rural' }).map((x) => x.id), ['a']);
  assert.deepEqual(filtrarPreVendas(base, { ...semFiltro, busca: '0161' }).map((x) => x.id), ['c']);
  assert.deepEqual(filtrarPreVendas(base, { ...semFiltro, busca: 'bruno' }).map((x) => x.id), ['b']);
  // 01/10 02:30 UTC = 30/09 23:30 em Brasília: entra no "até 30/09".
  assert.deepEqual(filtrarPreVendas(base, { ...semFiltro, de: '2026-09-30', ate: '2026-09-30' }).map((x) => x.id), ['b', 'c']);
  assert.deepEqual(filtrarPreVendas(base, { ...semFiltro, de: '2026-10-01' }).map((x) => x.id), []);
  assert.equal(filtrarPreVendas([l({ data: null })], { ...semFiltro, de: '2026-09-01' }).length, 0, 'sem data não entra quando há período');
});

test('totais e resumo por vendedor', () => {
  assert.deepEqual(totaisPreVendas(base), { quantidade: 3, valorCents: 40040, comReserva: 2, maisAntiga: 9 });
  assert.deepEqual(resumirPreVendasPorVendedor(base).map((v) => [v.vendedorNome, v.quantidade, v.valorCents]), [
    ['ANA', 2, 35050],
    ['BRUNO', 1, 4990],
  ]);
});

test('documento com acesso total: aviso sempre, indicadores, seção por vendedor e valor somado', () => {
  const doc = montarDocumentoPreVendas(base, { ...semFiltro, origem: 'balcao', busca: ' ana ' }, true, hoje);
  assert.equal(doc.titulo, 'Pré-vendas em Aberto');
  assert.equal(doc.periodo, 'Em aberto em 02/10/2026');
  assert.deepEqual(doc.filtros, [AVISO_PRE_VENDA_NAO_E_FATURAMENTO, 'Origem: Balcão (pré-venda)', 'Busca: "ana"']);
  assert.deepEqual(doc.indicadores.map((i) => i.rotulo), ['Pré-vendas em aberto', 'Valor comprometido (não é receita)', 'Com estoque reservado', 'Mais antiga em aberto']);
  assert.match(doc.indicadores[1].valor, /400,40/);
  assert.equal(doc.indicadores[3].valor, '9 dia(s)');
  assert.deepEqual(doc.secoes.map((s) => s.id), ['pre-vendas', 'vendedores']);
  assert.equal(doc.secoes[1].opcional, true);
  assert.equal(doc.secoes[1].padrao, false);

  const secao = doc.secoes[0];
  assert.deepEqual(secao.colunas.map((c) => c.id), ['numero', 'data', 'dias', 'cliente', 'vendedor', 'origem', 'estoque', 'nota', 'status', 'itens', 'valor']);
  assert.deepEqual(secao.colunas.filter((c) => c.padrao === false).map((c) => c.id), ['status', 'itens']);
  const col = (id: string) => secao.colunas.find((c) => c.id === id)!;
  assert.equal(col('valor').valor(base[0]), 15050);
  assert.equal(col('valor').total, undefined);
  assert.equal(col('dias').total, 'nenhum');
  assert.equal(col('origem').valor(base[1]), 'Agente (WhatsApp)');
  assert.equal(col('estoque').valor(base[1]), 'Sem reserva');
  assert.equal(col('nota').valor(base[0]), 'COM NOTA FISCAL');
  assert.equal(col('nota').valor(base[2]), 'SEM NOTA FISCAL');
  assert.equal(col('nota').valor(base[1]), '');
  assert.deepEqual(secao.linhas.map((x: PreVendaDoRelatorio) => x.id), ['a', 'b', 'c'], 'mantém a ordem da tela');
});

test('documento sem acesso total: sem indicadores, sem resumo por vendedor e sem soma de valor', () => {
  const doc = montarDocumentoPreVendas(base, { ...semFiltro, de: '2026-09-01', ate: '2026-09-30' }, false, hoje);
  assert.equal(doc.periodo, 'Data de 01/09/2026 a 30/09/2026');
  assert.deepEqual(doc.filtros, [AVISO_PRE_VENDA_NAO_E_FATURAMENTO]);
  assert.deepEqual(doc.indicadores, []);
  assert.deepEqual(doc.secoes.map((s) => s.id), ['pre-vendas']);
  const valor = doc.secoes[0].colunas.find((c) => c.id === 'valor')!;
  assert.equal(valor.total, 'nenhum');
  assert.equal(valor.valor(base[0]), 15050, 'o valor de cada linha continua, como na tela');
});

test('sem pré-vendas: documento vazio não quebra', () => {
  const doc = montarDocumentoPreVendas([], semFiltro, true, hoje);
  assert.equal(doc.indicadores[0].valor, '0');
  assert.equal(doc.indicadores[1].valor.replace(/\s/g, ''), 'R$0,00');
  assert.equal(doc.secoes[0].linhas.length, 0);
});
