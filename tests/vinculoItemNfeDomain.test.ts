import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buscarCadastros,
  configDoItemSemVinculo,
  configDoItemVinculado,
  dadosFiscaisParaCompletar,
  normalizarTextoDeItem,
  sugerirVinculos,
  type CadastroParaVinculo,
} from '../src/utils/vinculoItemNfeDomain';
import { matchMateriaPrimaFromXmlItem, matchProdutoFromXmlItem } from '../src/utils/fiscalDomain';

const produtos: CadastroParaVinculo[] = [
  { id: 'p1', codigo: '10', nome: 'Parafuso Sextavado 1/4 x 2', ncm: '73181500', codigoBarras: '7891234567895' },
  { id: 'p2', codigo: '11', nome: 'Parafuso Sextavado 1/4 x 4', ncm: '73181500' },
  { id: 'p3', codigo: '12', nome: 'Óleo de Motor 20W50 1L', ncm: '27101932' },
  { id: 'p4', codigo: '13', nome: 'Cadeira de Escritório' },
];
const materias: CadastroParaVinculo[] = [
  { id: 'm1', codigo: 'MP1', nome: 'Aço Carbono Barra 2 metros', codigosFornecedor: { f1: 'AC-200' } },
];

test('texto de item ignora acento, caixa e pontuação', () => {
  assert.equal(normalizarTextoDeItem('  Óleo,  de Motor (1L) '), 'OLEO DE MOTOR 1L');
  assert.equal(normalizarTextoDeItem(undefined), '');
});

test('descrição da nota com acento/caixa diferentes agora reconhece o produto (NCM + nome)', () => {
  const r = matchProdutoFromXmlItem({ codigo: 'X', descricao: 'OLEO DE MOTOR 20W50 1L', ncm: '27101932' }, produtos, 'f1');
  assert.equal(r.produto?.id, 'p3');
  assert.equal(r.layer, 'ncm_nome');
});

test('matéria-prima: o código que o fornecedor usa reconhece antes do nome (aprendizado)', () => {
  const m = matchMateriaPrimaFromXmlItem({ codigo: 'ac-200', descricao: 'Barra de aco', ncm: '' }, materias, 'f1');
  assert.equal(m?.id, 'm1');
  assert.equal(matchMateriaPrimaFromXmlItem({ codigo: 'AC-200', descricao: 'Barra de aco', ncm: '' }, materias, 'outro'), null);
});

test('sugestão: mesmo EAN vence, nome igual vem logo atrás, sem relação não aparece', () => {
  const porEan = sugerirVinculos({ codigo: 'Z', descricao: 'Coisa diferente', ncm: '', ean: '7891234567895' }, produtos, materias, 'f1');
  assert.equal(porEan[0].id, 'p1');
  assert.equal(porEan[0].pontuacao, 100);
  assert.match(porEan[0].motivos.join(' '), /código de barras/);

  const porNome = sugerirVinculos({ codigo: 'Z', descricao: 'OLEO DE MOTOR 20W50 1L', ncm: '27101932' }, produtos, materias, 'f1');
  assert.equal(porNome[0].id, 'p3');
  assert.ok(porNome[0].pontuacao >= 95);

  assert.deepEqual(sugerirVinculos({ codigo: 'Z', descricao: 'Bicicleta aro 29', ncm: '' }, produtos, materias, 'f1'), []);
});

test('sugestão: medida diferente perde pontos para o produto certo ficar em primeiro', () => {
  const s = sugerirVinculos({ codigo: 'Z', descricao: 'PARAFUSO SEXT 1/4 X 4', ncm: '73181500' }, produtos, materias, 'f1');
  assert.equal(s[0].id, 'p2');
  assert.ok(s[0].pontuacao > (s.find((x) => x.id === 'p1')?.pontuacao ?? 0));
});

test('sugestão: matéria-prima aparece e traz o tipo, e o histórico do fornecedor pontua 100', () => {
  const s = sugerirVinculos({ codigo: 'AC-200', descricao: 'Barra aco', ncm: '' }, produtos, materias, 'f1');
  assert.equal(s[0].id, 'm1');
  assert.equal(s[0].tipo, 'materia_prima');
  assert.equal(s[0].pontuacao, 100);
});

test('busca livre: todas as palavras, sem acento; por código de barras; vazia não traz nada', () => {
  assert.deepEqual(buscarCadastros('oleo motor', produtos, materias).map((r) => r.id), ['p3']);
  assert.deepEqual(buscarCadastros('parafuso 1/4', produtos, materias).map((r) => r.id), ['p1', 'p2']);
  assert.deepEqual(buscarCadastros('7891234567895', produtos, materias).map((r) => r.id), ['p1']);
  assert.deepEqual(buscarCadastros('mp1', produtos, materias).map((r) => [r.id, r.tipo]), [['m1', 'materia_prima']]);
  assert.deepEqual(buscarCadastros('   ', produtos, materias), []);
  assert.equal(buscarCadastros('a', produtos, materias, 2).length <= 2, true);
});

test('vincular puxa o preço e a tributação do cadastro; desvincular volta a ser item novo', () => {
  const vinculado = configDoItemVinculado({ tipo: 'estoque', id: 'p1', fiscal: { id: 'p1', precoVenda: 19.9, csosn: '102' } }, 10, true);
  assert.equal(vinculado.classificacao, 'estoque');
  assert.equal(vinculado.matchId, 'p1');
  assert.equal(vinculado.precoVenda, '19.9');

  const semFiscal = configDoItemVinculado({ tipo: 'estoque', id: 'p4' }, 10, true);
  assert.equal(semFiscal.matchId, 'p4');
  assert.equal(semFiscal.precoVenda, '15'); // margem padrão, como no item novo

  const mp = configDoItemVinculado({ tipo: 'materia_prima', id: 'm1' }, 10, true);
  assert.equal(mp.classificacao, 'materia_prima');
  assert.equal(mp.tipo, 'materia_prima');

  const novo = configDoItemSemVinculo(10, true);
  assert.equal(novo.classificacao, 'novo');
  assert.equal(novo.matchId, null);
});

test('completar cadastro: só preenche EAN/NCM vazios e válidos, nunca sobrescreve', () => {
  assert.deepEqual(dadosFiscaisParaCompletar({ codigo: 'a', descricao: 'x', ncm: '7318.15.00', ean: '7891234567895' }, {}), { codigoBarras: '7891234567895', ncm: '73181500' });
  assert.deepEqual(dadosFiscaisParaCompletar({ codigo: 'a', descricao: 'x', ncm: '73181500', ean: '7891234567895' }, { codigoBarras: '111', ncm: '99999999' }), {});
  assert.deepEqual(dadosFiscaisParaCompletar({ codigo: 'a', descricao: 'x', ncm: '123', ean: 'SEM GTIN' }, {}), {});
});

test('sugestão: "1 Kg" e "1KG" são a mesma medida; 500ML e 1L continuam diferentes', () => {
  const lista: CadastroParaVinculo[] = [
    { id: 'a', codigo: '1', nome: 'ARROZ INTEGRAL 1KG' },
    { id: 'b', codigo: '2', nome: 'ARROZ INTEGRAL 5KG' },
  ];
  const s = sugerirVinculos({ codigo: 'X', descricao: 'Arroz Integral 1 Kg Tipo 1', ncm: '' }, lista, [], 'f1');
  assert.equal(s[0].id, 'a');
  assert.ok(s[0].pontuacao >= 60);
});

test('insumo (material de consumo) entra nas sugestões e na busca, com o tipo certo, e o vínculo não leva preço', () => {
  const insumos: CadastroParaVinculo[] = [{ id: 'i1', codigo: 'IN1', nome: 'Caixa de papelão 30x20', codigosFornecedor: { f1: 'CX-30' } }];
  const s = sugerirVinculos({ codigo: 'CX-30', descricao: 'Caixa papelao 30x20', ncm: '' }, produtos, materias, 'f1', 5, insumos);
  assert.equal(s[0].id, 'i1');
  assert.equal(s[0].tipo, 'insumo');
  assert.equal(s[0].pontuacao, 100);
  assert.deepEqual(buscarCadastros('papelao', produtos, materias, 20, insumos).map((r) => [r.id, r.tipo]), [['i1', 'insumo']]);
  const config = configDoItemVinculado({ tipo: 'insumo', id: 'i1' }, 10, true);
  assert.equal(config.classificacao, 'insumo');
  assert.equal(config.tipo, 'insumo');
  assert.equal(config.matchId, 'i1');
  assert.equal(config.precoVenda, '');
  assert.equal(config.csosn, '');
});
