import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  escolherOrientacao,
  formatarCelulaRelatorio,
  linhaTotalSecao,
  nomeArquivoRelatorio,
  normalizarPreferencias,
  preferenciasPadrao,
  secoesVisiveis,
  type ColunaRelatorio,
  type SecaoRelatorio,
} from '../src/utils/relatorioPdfDomain';

// Intl pode usar espaco nao separavel entre "R$" e o numero.
const limpa = (texto: string) => texto.replace(/\s/g, ' ');

type Linha = { nome: string; valor: number; qtd: number };

const colunas: ColunaRelatorio<Linha>[] = [
  { id: 'nome', titulo: 'Nome', tipo: 'texto', valor: (l) => l.nome },
  { id: 'qtd', titulo: 'Qtd', tipo: 'inteiro', valor: (l) => l.qtd },
  { id: 'valor', titulo: 'Valor', tipo: 'moeda', valor: (l) => l.valor },
  { id: 'obs', titulo: 'Obs', tipo: 'texto', padrao: false, valor: () => 'x' },
];

const secao: SecaoRelatorio<Linha> = {
  id: 's1',
  titulo: 'Seção',
  colunas,
  linhas: [
    { nome: 'leo', valor: 60000, qtd: 2 },
    { nome: 'Juliano', valor: 2800, qtd: 1 },
  ],
};

test('celula: moeda em centavos vira R$ pt-BR, texto sai em caixa alta, vazio vira traço', () => {
  assert.equal(limpa(formatarCelulaRelatorio(159821, 'moeda')), 'R$ 1.598,21');
  assert.equal(formatarCelulaRelatorio(1234, 'inteiro'), '1.234');
  assert.equal(formatarCelulaRelatorio('consumidor final', 'texto'), 'CONSUMIDOR FINAL');
  assert.equal(formatarCelulaRelatorio(null, 'texto'), '-');
  assert.equal(formatarCelulaRelatorio('', 'moeda'), '-');
});

test('celula: data sai sem hora; dataHora com hora, no fuso de São Paulo', () => {
  const data = new Date('2026-09-21T03:30:00Z'); // 00:30 em São Paulo
  assert.equal(formatarCelulaRelatorio(data, 'data'), '21/09/2026');
  assert.equal(formatarCelulaRelatorio(data, 'dataHora'), '21/09/2026 00:30');
});

test('total: soma moeda e inteiro; rótulo vai na primeira coluna de texto', () => {
  const total = linhaTotalSecao(colunas.slice(0, 3), secao.linhas, 'Total geral — 2 vendas').map(limpa);
  assert.deepEqual(total, ['TOTAL GERAL — 2 VENDAS', '3', 'R$ 628,00']);
});

test('total: rótulo nunca cobre um valor; sem coluna de texto, não há rótulo', () => {
  const soValores = colunas.filter((c) => c.tipo !== 'texto');
  assert.deepEqual(linhaTotalSecao(soValores, secao.linhas, 'Total').map(limpa), ['3', 'R$ 628,00']);
});

test('total calculado: ticket médio não é soma de médias', () => {
  const ticket: ColunaRelatorio<{ liquido: number; vendas: number }> = {
    id: 't', titulo: 'Ticket', tipo: 'moeda',
    valor: (l) => Math.round(l.liquido / l.vendas),
    totalCalculado: (ls) => Math.round(ls.reduce((s, l) => s + l.liquido, 0) / ls.reduce((s, l) => s + l.vendas, 0)),
  };
  const linhas = [{ liquido: 10000, vendas: 1 }, { liquido: 10000, vendas: 4 }];
  assert.deepEqual(linhaTotalSecao([ticket], linhas, 'Total').map(limpa), ['R$ 40,00']);
});

test('orientação: retrato quando cabe, paisagem quando as colunas marcadas não cabem', () => {
  assert.equal(escolherOrientacao([colunas]), 'portrait');
  const muitas = Array.from({ length: 12 }, () => ({ tipo: 'moeda' as const }));
  assert.equal(escolherOrientacao([muitas]), 'landscape');
});

test('preferências: padrão marca as colunas padrao e liga seção opcional conforme padrao', () => {
  const opcional = { ...secao, id: 's2', opcional: true, padrao: false };
  const pref = preferenciasPadrao([secao, opcional]);
  assert.deepEqual(pref.secoes.s1, { ativa: true, colunas: ['nome', 'qtd', 'valor'] });
  assert.equal(pref.secoes.s2.ativa, false);
  assert.deepEqual(secoesVisiveis([secao, opcional], pref).map((s) => s.id), ['s1']);
});

test('preferências salvas: coluna que sumiu cai fora, ordem é a do relatório, lixo volta ao padrão', () => {
  const salvas = { indicadores: false, secoes: { s1: { ativa: true, colunas: ['valor', 'apagada', 'nome'] } } };
  const pref = normalizarPreferencias(salvas, [secao]);
  assert.equal(pref.indicadores, false);
  assert.deepEqual(pref.secoes.s1.colunas, ['nome', 'valor']);
  assert.deepEqual(normalizarPreferencias('lixo', [secao]), preferenciasPadrao([secao]));
});

test('seção sem nenhuma coluna marcada não sai no relatório', () => {
  const pref = normalizarPreferencias({ secoes: { s1: { ativa: true, colunas: [] } } }, [secao]);
  assert.deepEqual(secoesVisiveis([secao], pref), []);
});

test('nome do arquivo: sem acento, com período; mesmo dia aparece uma vez só', () => {
  assert.equal(nomeArquivoRelatorio('Vendas por Vendedor', '2026-09-01', '2026-09-21'), 'vendas-por-vendedor-01-09-2026-a-21-09-2026');
  assert.equal(nomeArquivoRelatorio('Relatório de Vendas', '2026-09-21', '2026-09-21'), 'relatorio-de-vendas-21-09-2026');
});
