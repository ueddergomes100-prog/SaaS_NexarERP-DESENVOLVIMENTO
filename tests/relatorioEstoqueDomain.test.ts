import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  linhasDeComposicao,
  montarDocumentoRelatorioEstoque,
  produtosDoRelatorioEstoque,
  resumirRelatorioEstoque,
  type FiltroRelatorioEstoque,
  type ProdutoDoRelatorioEstoque,
} from '../src/utils/relatorioEstoqueDomain';
import type { ComponenteComposicao } from '../src/utils/producaoDomain';

const p = (extra: Partial<ProdutoDoRelatorioEstoque>): ProdutoDoRelatorioEstoque => ({
  id: 'x', nome: 'PRODUTO', codigo: '001', categoria: 'Rações', marca: 'Quatree', ncm: '23091000', codigoBarras: '789',
  referencia: '', localizacao: '', quantidade: 10, estoqueMinimo: 0, precoVenda: 20, precoCusto: 12, precoAVista: null,
  unidadeMedidaSigla: 'UN', ativo: true, produtoRevenda: true, cadastradoEm: new Date('2026-09-15T15:00:00Z'), ...extra,
});

const base: ProdutoDoRelatorioEstoque[] = [
  p({ id: 'a', nome: 'RAÇÃO GOURMET 20KG', codigo: 'A1', quantidade: 3, estoqueMinimo: 5, precoCusto: 100.1 }),
  p({ id: 'b', nome: 'MILHO A GRANEL', codigo: 'B1', quantidade: 2.5, precoCusto: 0, precoVenda: 4, unidadeMedidaSigla: 'KG', categoria: 'Grãos', ncm: '10059010' }),
  p({ id: 'c', nome: 'COLEIRA', codigo: 'C1', quantidade: 0, marca: 'Pet', precoAVista: 18.5 }),
  p({ id: 'd', nome: 'INATIVO', codigo: 'D1', ativo: false }),
  p({ id: 'e', nome: 'ANTIGO', codigo: 'E1', cadastradoEm: new Date('2025-01-10T15:00:00Z') }),
  p({ id: 'f', nome: 'SEM DATA', codigo: 'F1', cadastradoEm: null, produtoRevenda: false, unidadeMedidaSigla: undefined }),
];

const filtroBase: FiltroRelatorioEstoque = {
  ignorarPeriodo: true,
  inicio: new Date('2026-09-01T03:00:00Z'),
  fim: new Date('2026-10-01T02:59:59Z'),
  categoria: '', ncm: '', texto: '', apenasAtivos: true,
};

test('filtros da tela: ativos, período de cadastro só quando desmarcado, categoria, NCM e busca', () => {
  assert.deepEqual(produtosDoRelatorioEstoque(base, filtroBase).map((x) => x.id), ['a', 'b', 'c', 'e', 'f']);
  assert.equal(produtosDoRelatorioEstoque(base, { ...filtroBase, apenasAtivos: false }).length, 6);
  // Com período valendo, sai o cadastrado fora dele; quem não tem data fica.
  assert.deepEqual(produtosDoRelatorioEstoque(base, { ...filtroBase, ignorarPeriodo: false }).map((x) => x.id), ['a', 'b', 'c', 'f']);
  assert.deepEqual(produtosDoRelatorioEstoque(base, { ...filtroBase, categoria: 'Grãos' }).map((x) => x.id), ['b']);
  assert.deepEqual(produtosDoRelatorioEstoque(base, { ...filtroBase, ncm: ' 1005 ' }).map((x) => x.id), ['b']);
  assert.deepEqual(produtosDoRelatorioEstoque(base, { ...filtroBase, texto: 'pet' }).map((x) => x.id), ['c'], 'busca também pela marca');
  assert.deepEqual(produtosDoRelatorioEstoque(base, { ...filtroBase, texto: 'a1' }).map((x) => x.id), ['a'], 'busca pelo código');
});

test('indicadores: valor em estoque = quantidade × custo (sem custo, preço de venda), em centavos', () => {
  const resumo = resumirRelatorioEstoque(produtosDoRelatorioEstoque(base, filtroBase));
  // a: 3 × 100,10 = 300,30 | b: 2,5 × 4 = 10 | c: 0 | e: 10 × 12 = 120 | f: 120
  assert.equal(resumo.valorEstoqueCentavos, 30030 + 1000 + 0 + 12000 + 12000);
  assert.equal(resumo.total, 5);
  assert.equal(resumo.estoqueBaixo, 1);
  assert.equal(resumo.esgotados, 1);
});

test('documento: respeita os desmarcados, declara todas as colunas e moeda em centavos', () => {
  const filtrados = produtosDoRelatorioEstoque(base, filtroBase);
  const doc = montarDocumentoRelatorioEstoque({
    filtrados, desmarcados: new Set(['e']), composicoes: {}, filtro: filtroBase, agora: new Date('2026-10-02T15:00:00Z'),
  });
  assert.equal(doc.titulo, 'Relatório de Estoque');
  assert.match(doc.periodo, /^Posição atual em 02\/10\/2026/);
  assert.deepEqual(doc.indicadores.map((i) => i.valor.replace(/\s/g, ' ')), ['4', 'R$ 430,30', '1', '1']);
  assert.ok(doc.filtros.includes('1 produto desmarcado na tela'));
  assert.ok(doc.filtros.includes('Somente produtos ativos'));

  const secao = doc.secoes[0];
  assert.deepEqual(secao.linhas.map((x: ProdutoDoRelatorioEstoque) => x.id), ['a', 'b', 'c', 'f']);
  assert.deepEqual(secao.colunas.map((c) => c.id), [
    'produto', 'codigo', 'quantidade', 'unidade', 'categoria', 'marca', 'referencia', 'localizacao',
    'estoqueMinimo', 'custo', 'preco', 'precoAVista', 'valorTotal', 'ncm', 'codigoBarras',
  ]);
  const padrao = secao.colunas.filter((c) => c.padrao !== false).map((c) => c.id);
  assert.deepEqual(padrao, ['produto', 'codigo', 'quantidade', 'unidade', 'categoria', 'preco']);

  const col = (id: string) => secao.colunas.find((c) => c.id === id)!;
  const [a, b, c, f] = secao.linhas as ProdutoDoRelatorioEstoque[];
  assert.equal(col('quantidade').valor(b), '2,5');
  assert.equal(col('custo').valor(a), 10010);
  assert.equal(col('valorTotal').valor(a), 30030);
  assert.equal(col('valorTotal').valor(b), 1000, 'sem custo, usa o preço de venda');
  assert.equal(col('precoAVista').valor(c), 1850);
  assert.equal(col('precoAVista').valor(a), null);
  assert.equal(col('produto').valor(f), 'SEM DATA (uso interno)');
  assert.equal(col('unidade').valor(f), '');
  // Preço unitário e quantidade não somam; valor total soma.
  assert.equal(col('preco').total, 'nenhum');
  assert.equal(col('quantidade').total, 'nenhum');
  assert.equal(col('valorTotal').total, undefined);
});

test('composição: seção opcional desligada por padrão, agrupada pelo produto, só dos selecionados', () => {
  const composicoes: Record<string, ComponenteComposicao[]> = {
    a: [
      { componenteId: 'm1', componenteNome: 'MILHO MOÍDO', origem: 'materia_prima', unidade: 'KG', quantidade: 0.75 },
      { componenteId: 'b', componenteNome: 'MILHO A GRANEL', origem: 'estoque', unidade: 'KG', quantidade: 0.25 },
    ],
    f: [{ componenteId: 'm2', componenteNome: 'SAL', origem: 'materia_prima', unidade: 'G', quantidade: 5 }],
    e: [{ componenteId: 'm3', componenteNome: 'FORA', origem: 'materia_prima', unidade: 'KG', quantidade: 1 }],
  };
  const filtrados = produtosDoRelatorioEstoque(base, filtroBase);
  const doc = montarDocumentoRelatorioEstoque({
    filtrados, desmarcados: new Set(['e']), composicoes, filtro: { ...filtroBase, ignorarPeriodo: false }, agora: new Date(),
  });
  assert.match(doc.periodo, /^Produtos cadastrados de 01\/09\/2026 a 30\/09\/2026$/);
  const secao = doc.secoes[1];
  assert.equal(secao.id, 'composicao');
  assert.equal(secao.opcional, true);
  assert.equal(secao.padrao, false);
  assert.equal(secao.linhas.length, 3, 'produto desmarcado não leva a receita');
  assert.equal(secao.agruparPor?.chave(secao.linhas[0]), 'a');
  assert.equal(secao.agruparPor?.rotulo(secao.linhas[0]), 'RAÇÃO GOURMET 20KG (A1) — composição para 1 UN');
  assert.equal(secao.agruparPor?.rotulo(secao.linhas[2]), 'SEM DATA (F1) — composição para 1 UN', 'sem unidade, receita para 1 UN como na tela');
  const linhas = linhasDeComposicao(filtrados.filter((x) => x.id === 'a'), composicoes);
  assert.deepEqual(linhas.map((l) => [l.componenteNome, l.origem, l.quantidade, l.unidade]), [
    ['MILHO MOÍDO', 'Matéria-prima', 0.75, 'KG'],
    ['MILHO A GRANEL', 'Produto', 0.25, 'KG'],
  ]);
  assert.equal(secao.colunas.find((c) => c.id === 'quantidade')!.valor(secao.linhas[0]), '0,75');
});

test('sem produtos: documento vazio não quebra', () => {
  const doc = montarDocumentoRelatorioEstoque({ filtrados: [], desmarcados: new Set(), composicoes: {}, filtro: filtroBase, agora: new Date() });
  assert.equal(doc.indicadores[1].valor.replace(/\s/g, ''), 'R$0,00');
  assert.equal(doc.secoes[0].linhas.length, 0);
  assert.equal(doc.secoes[1].linhas.length, 0);
});
