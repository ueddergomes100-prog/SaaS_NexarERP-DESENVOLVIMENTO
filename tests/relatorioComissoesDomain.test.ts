import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  entradaComissaoDaOS,
  entradaComissaoDaVenda,
  filtrarComissoes,
  montarDocumentoComissoes,
  montarEntradasComissao,
  resumirComissoesPorVendedor,
  totalizarComissoes,
  type EntradaComissao,
} from '../src/utils/relatorioComissoesDomain';
import { linhaTotalSecao } from '../src/utils/relatorioPdfDomain';

const usuarios: Record<string, any> = {
  leo: { id: 'leo', nome: 'Leo', recebeComissaoPecas: true, comissaoPercentualPecas: 5 },
  ana: { id: 'ana', nome: 'Ana', recebeComissaoServicos: true, comissaoPercentualServicos: 10, recebeComissaoPecas: true, comissaoPercentualPecas: 2 },
};

const snapshot = (extra: Record<string, any>) => ({
  regraVersion: 1, vendedorNome: 'Leo', percentual: 3, baseAtualCentavos: 100000, valorAtualCentavos: 3000, status: 'gerada', geradaEm: '2026-09-10T15:00:00.000Z', ...extra,
});

const vendas = [
  // Historica valida: 3% de R$ 1.000,00.
  { id: 'v1', dados: { vendedorId: 'leo', numeroPedido: '0101', comissao: snapshot({}) } },
  // Legada: sem snapshot, estimativa pela regra atual (5% de R$ 200,00).
  { id: 'v2', dados: { vendedorId: 'leo', numeroPedido: '0102', itens: [{ subtotal: 150 }, { subtotal: 50 }], createdAt: '2026-09-12' } },
  // Cancelada: nunca entra no a pagar, mesmo com snapshot gerada.
  { id: 'v3', dados: { vendedorId: 'leo', numeroPedido: '0103', status: 'Cancelada', comissao: snapshot({ geradaEm: '2026-09-11T12:00:00.000Z' }) } },
  // Nao aplicavel.
  { id: 'v4', dados: { vendedorId: 'ana', numeroPedido: '0104', comissao: snapshot({ vendedorNome: 'Ana', percentual: 0, valorAtualCentavos: 0, status: 'nao_aplicavel', baseAtualCentavos: 50000, geradaEm: '2026-09-13T12:00:00.000Z' }) } },
  // Fora do periodo.
  { id: 'v5', dados: { vendedorId: 'leo', numeroPedido: '0105', comissao: snapshot({ geradaEm: '2026-08-20T12:00:00.000Z' }) } },
];

const ordens = [
  // OS legada da Ana: 10% de servico (R$ 300) + 2% de pecas (R$ 100).
  { id: 'os1', dados: { status: 'Finalizada', mecanicoId: 'ana', numeroOS: '55', servicos: [{ preco: 150, quantidade: 2 }], pecas: [{ preco: 50, quantidade: 2 }], updatedAt: '2026-09-14' } },
  // OS aberta nao gera linha.
  { id: 'os2', dados: { status: 'Em andamento', mecanicoId: 'ana', numeroOS: '56' } },
];

const filtro = { de: '2026-09-01', ate: '2026-09-30' };

const todas = (): EntradaComissao[] => montarEntradasComissao({ usuarios, vendas, ordensDeServico: ordens });

test('linha da venda: snapshot historico, estimativa legada e cancelada zerada', () => {
  const historica = entradaComissaoDaVenda('v1', vendas[0].dados, usuarios);
  assert.equal(historica.historical, true);
  assert.equal(historica.valueCents, 3000);
  assert.equal(historica.status, 'gerada');
  const legada = entradaComissaoDaVenda('v2', vendas[1].dados, usuarios);
  assert.equal(legada.status, 'estimativa_legada');
  assert.equal(legada.baseCents, 20000);
  assert.equal(legada.valueCents, 1000);
  const cancelada = entradaComissaoDaVenda('v3', vendas[2].dados, usuarios);
  assert.equal(cancelada.status, 'cancelada');
  assert.equal(cancelada.valueCents, 0);
});

test('linha da OS: só Finalizada/Cancelada, legado soma serviço e peças pelos percentuais do cadastro', () => {
  const os = entradaComissaoDaOS('os1', ordens[0].dados, usuarios);
  assert.equal(os?.valueCents, 3000 + 200);
  assert.equal(os?.baseCents, 40000);
  assert.equal(os?.sellerName, 'Ana');
  assert.equal(entradaComissaoDaOS('os2', ordens[1].dados, usuarios), null);
});

test('visibilidade: quem só vê as próprias vendas só vê a própria comissão', () => {
  const doLeo = montarEntradasComissao({ usuarios, vendas, ordensDeServico: ordens, vendasVisiveisDeUsuarioId: 'leo' });
  assert.ok(doLeo.length > 0);
  assert.ok(doLeo.every((e) => e.sellerId === 'leo'));
  assert.equal(todas().length, 6);
});

test('filtro por período, vendedor, status e busca; mais recente primeiro', () => {
  const lista = filtrarComissoes(todas(), filtro);
  assert.deepEqual(lista.map((e) => e.originNumber), ['55', '0104', '0102', '0103', '0101']);
  assert.deepEqual(filtrarComissoes(todas(), { ...filtro, vendedorId: 'ana' }).map((e) => e.originNumber), ['55', '0104']);
  assert.deepEqual(filtrarComissoes(todas(), { ...filtro, status: 'estimativa_legada' }).map((e) => e.originNumber), ['55', '0102']);
  assert.deepEqual(filtrarComissoes(todas(), { ...filtro, busca: '0101' }).map((e) => e.originNumber), ['0101']);
  assert.equal(filtrarComissoes(todas(), { de: '', ate: '' }).length, 0, 'sem período válido não mostra nada (igual a tela)');
});

test('indicadores: válida só snapshot gerada; legado separado; cancelada fora', () => {
  const totais = totalizarComissoes(filtrarComissoes(todas(), filtro));
  assert.equal(totais.validaCentavos, 3000);
  assert.equal(totais.estimativaLegadaCentavos, 1000 + 3200);
  assert.equal(totais.origens, 5);
});

test('resumo por vendedor: base sem cancelada, a pagar = válida + estimativa', () => {
  const resumo = resumirComissoesPorVendedor(filtrarComissoes(todas(), filtro));
  assert.deepEqual(resumo.map((r) => [r.vendedor, r.origens, r.canceladas, r.baseCentavos, r.validaCentavos, r.estimativaLegadaCentavos, r.aPagarCentavos]), [
    ['Leo', 3, 1, 120000, 3000, 1000, 4000],
    ['Ana', 2, 0, 90000, 0, 3200, 3200],
  ]);
});

test('documento: indicadores da tela, duas seções e total que não soma cancelada', () => {
  const doc = montarDocumentoComissoes(todas(), { ...filtro, status: '', busca: '  ' }, undefined);
  assert.equal(doc.titulo, 'Comissões a Pagar');
  assert.equal(doc.periodo, 'Geração de 01/09/2026 a 30/09/2026');
  assert.deepEqual(doc.filtros, []);
  assert.deepEqual(doc.indicadores.map((i) => i.rotulo), ['Comissão histórica válida', 'Estimativa de registros legados', 'Origens no filtro']);
  assert.match(doc.indicadores[0].valor, /30,00/);
  assert.match(doc.indicadores[1].valor, /42,00/);
  assert.equal(doc.indicadores[2].valor, '5');
  assert.deepEqual(doc.secoes.map((s) => s.id), ['resumo-vendedor', 'origens']);
  assert.equal(doc.secoes[0].opcional, true);

  const detalhe = doc.secoes[1];
  const ids = detalhe.colunas.map((c) => c.id);
  assert.deepEqual(ids, ['origem', 'tipo', 'numero', 'vendedor', 'base', 'percentual', 'comissao', 'status', 'geracao', 'pagamento']);
  const linhaTotal = linhaTotalSecao(detalhe.colunas, detalhe.linhas, 'Total');
  // Comissao: 30 + 10 + 32 (a cancelada nao entra); base: 1.000 + 200 + 500 + 400.
  assert.match(linhaTotal[ids.indexOf('comissao')], /72,00/);
  assert.match(linhaTotal[ids.indexOf('base')], /2\.100,00/);
  assert.equal(linhaTotal[ids.indexOf('percentual')], '');

  const percentual = detalhe.colunas.find((c) => c.id === 'percentual')!;
  const v1 = detalhe.linhas.find((e: EntradaComissao) => e.originNumber === '0101');
  const v2 = detalhe.linhas.find((e: EntradaComissao) => e.originNumber === '0102');
  assert.equal(percentual.valor(v1), '3,00%');
  assert.equal(percentual.valor(v2), 'Regra atual (legado)');
  assert.equal(detalhe.colunas.find((c) => c.id === 'origem')!.valor(v1), 'Venda #0101');
  assert.equal(detalhe.colunas.find((c) => c.id === 'status')!.valor(v2), 'Estimativa legada');
});

test('documento: filtros aplicados em texto', () => {
  const doc = montarDocumentoComissoes(todas(), { ...filtro, vendedorId: 'ana', status: 'nao_aplicavel', busca: 'ana' }, 'Ana');
  assert.deepEqual(doc.filtros, ['Vendedor: Ana', 'Status: Não aplicável', 'Busca: "ana"']);
  assert.equal(doc.secoes[1].linhas.length, 1);
});
