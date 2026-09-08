import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compararMargem,
  margemMarkup,
  montarAtualizacaoPreco,
  precoParaMargem,
  type LinhaPrecificacao,
} from '../src/utils/precificacaoDomain';

const AGORA = '2026-09-08T13:00:00.000Z';

const linhaBase = (patch: Partial<LinhaPrecificacao> = {}): LinhaPrecificacao => ({
  produtoId: 'p1',
  produtoNome: 'ADUBO',
  custoAtual: 20,
  custoNaUltimaPrecificacao: 20,
  precoVenda: '36',
  precoAVista: '',
  precoAPrazo: '',
  precoPromocional: '0',
  ...patch,
});

test('margemMarkup e sobre o custo, nao sobre a venda', () => {
  // custo 44, venda 79,20 -> 80% de markup
  assert.equal(Math.round(margemMarkup(79.2, 44) * 10) / 10, 80);
});

test('margemMarkup sem custo devolve 0 em vez de dividir por zero', () => {
  assert.equal(margemMarkup(100, 0), 0);
});

test('precoParaMargem e o inverso de margemMarkup', () => {
  const preco = precoParaMargem(44, 80);
  assert.equal(Math.round(preco * 100) / 100, 79.2);
  assert.equal(Math.round(margemMarkup(preco, 44) * 10) / 10, 80);
});

test('custo subiu depois da precificacao: margem caiu', () => {
  // preco 79,20 definido quando o custo era 44 (80%); hoje o custo e 52
  const comparacao = compararMargem(79.2, 44, 52);
  assert.ok(comparacao);
  assert.equal(comparacao!.direcao, 'caiu');
  assert.equal(Math.round(comparacao!.margemAnterior * 10) / 10, 80);
  assert.equal(Math.round(comparacao!.margemAtual * 10) / 10, 52.3);
  assert.ok(comparacao!.diferencaPontos < 0);
});

test('custo caiu depois da precificacao: margem subiu', () => {
  const comparacao = compararMargem(79.2, 44, 40);
  assert.ok(comparacao);
  assert.equal(comparacao!.direcao, 'subiu');
  assert.ok(comparacao!.diferencaPontos > 0);
});

test('mesma base e mesmo custo: manteve, sem alarme falso', () => {
  const comparacao = compararMargem(79.2, 44, 44);
  assert.equal(comparacao!.direcao, 'manteve');
});

test('diferenca de centavo por arredondamento nao acusa mudanca', () => {
  const comparacao = compararMargem(79.2, 44, 44.004);
  assert.equal(comparacao!.direcao, 'manteve');
});

test('produto sem base gravada (precificado antes do recurso) nao gera aviso', () => {
  assert.equal(compararMargem(79.2, null, 52), null);
  assert.equal(compararMargem(79.2, undefined, 52), null);
  assert.equal(compararMargem(79.2, 0, 52), null);
});

test('produto sem preco ou sem custo atual nao gera aviso', () => {
  assert.equal(compararMargem(0, 44, 52), null);
  assert.equal(compararMargem(79.2, 44, 0), null);
});

test('preco de venda mudou: regrava a base de comparacao com o custo de hoje', () => {
  const linha = linhaBase({ precoVenda: '46,80', custoAtual: 26 });
  const { campos, mudouPrecoVenda, semMudanca } = montarAtualizacaoPreco(
    linha, { precoVenda: 36, precoPromocional: 0 }, AGORA,
  );
  assert.equal(mudouPrecoVenda, true);
  assert.equal(semMudanca, false);
  assert.equal(campos.precoVenda, 46.8);
  assert.equal(campos.custoNaUltimaPrecificacao, 26);
  assert.equal(campos.ultimaAlteracaoPreco, AGORA);
  assert.equal(Math.round(Number(campos.margemLucro) * 10) / 10, 80);
  assert.equal(Math.round(Number(campos.lucroEstimado) * 100) / 100, 20.8);
});

test('so o promocional mudou: NAO regrava a base -- senao o aviso de margem defasada morria', () => {
  const linha = linhaBase({ precoPromocional: '30' });
  const { campos, mudouPrecoVenda, semMudanca } = montarAtualizacaoPreco(
    linha, { precoVenda: 36, precoPromocional: 0 }, AGORA,
  );
  assert.equal(mudouPrecoVenda, false);
  assert.equal(semMudanca, false);
  assert.equal(campos.precoPromocional, 30);
  assert.ok(!('custoNaUltimaPrecificacao' in campos));
  assert.ok(!('ultimaAlteracaoPreco' in campos));
});

test('nada mudou: semMudanca avisa a tela pra nem mandar o produto pro batch', () => {
  const { semMudanca } = montarAtualizacaoPreco(
    linhaBase(), { precoVenda: 36, precoPromocional: 0 }, AGORA,
  );
  assert.equal(semMudanca, true);
});

test('campo a vista/a prazo em branco e OMITIDO -- Firestore recusa undefined e 0 mudaria o significado', () => {
  const { campos } = montarAtualizacaoPreco(
    linhaBase(), { precoVenda: 36, precoPromocional: 0 }, AGORA,
  );
  assert.ok(!('precoAVista' in campos));
  assert.ok(!('precos.aVista' in campos));
  assert.ok(!('precoAPrazo' in campos));
});

test('a vista preenchido grava o campo plano e o espelho no objeto legado precos', () => {
  const { campos } = montarAtualizacaoPreco(
    linhaBase({ precoAVista: '34,50' }), { precoVenda: 36, precoPromocional: 0 }, AGORA,
  );
  assert.equal(campos.precoAVista, 34.5);
  assert.equal(campos['precos.aVista'], 34.5);
  assert.equal(campos['precos.venda'], 36);
});

test('valor digitado com virgula ou em branco nao vira NaN', () => {
  const { campos } = montarAtualizacaoPreco(
    linhaBase({ precoVenda: '1.234,50'.replace('.', ''), precoPromocional: '' }),
    { precoVenda: 36, precoPromocional: 0 },
    AGORA,
  );
  assert.equal(campos.precoVenda, 1234.5);
  assert.equal(campos.precoPromocional, 0);
});
