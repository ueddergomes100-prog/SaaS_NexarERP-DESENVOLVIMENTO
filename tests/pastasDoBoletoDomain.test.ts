import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chaveDoArquivo,
  ehArquivoDeRetorno,
  lembrarArquivos,
  LIMITE_DE_ARQUIVOS_LEMBRADOS,
  retornosNovos,
  textoDaPasta,
} from '../src/utils/pastasDoBoletoDomain';

const arq = (name: string, lastModified: number, size = 6292) => ({ name, size, lastModified });

test('so arquivo de retorno entra: .RET ou .TXT, nao vazio, ate 5 MB', () => {
  assert.equal(ehArquivoDeRetorno(arq('3049_244244_580490_261124_C240_571.RET', 1)), true);
  assert.equal(ehArquivoDeRetorno(arq('retorno.txt', 1)), true);
  assert.equal(ehArquivoDeRetorno(arq('boleto.pdf', 1)), false);
  assert.equal(ehArquivoDeRetorno(arq('vazio.ret', 1, 0)), false);
  assert.equal(ehArquivoDeRetorno(arq('enorme.ret', 1, 6 * 1024 * 1024)), false);
});

test('retornos novos: so o que nao foi visto, do mais antigo para o mais novo', () => {
  const a = arq('571.RET', 300);
  const b = arq('572.RET', 100);
  const c = arq('573.RET', 200);
  const vistos = new Set([chaveDoArquivo(a)]);
  assert.deepEqual(retornosNovos([a, b, c, arq('x.pdf', 50)], vistos).map((x) => x.name), ['572.RET', '573.RET']);
  // O mesmo nome com outro conteudo (o banco regravou) e arquivo novo de verdade.
  assert.equal(retornosNovos([arq('571.RET', 300, 9999)], vistos).length, 1);
});

test('lista de vistos guarda os mais novos e nao repete', () => {
  assert.deepEqual(lembrarArquivos(['a', 'b'], ['b', 'c']), ['a', 'b', 'c']);
  const muitos = Array.from({ length: LIMITE_DE_ARQUIVOS_LEMBRADOS }, (_, i) => `k${i}`);
  const depois = lembrarArquivos(muitos, ['novo']);
  assert.equal(depois.length, LIMITE_DE_ARQUIVOS_LEMBRADOS);
  assert.equal(depois[depois.length - 1], 'novo');
  assert.equal(depois[0], 'k1');
});

test('texto da pasta diz o que fazer', () => {
  assert.equal(textoDaPasta(null, null), 'Nenhuma pasta escolhida.');
  assert.match(textoDaPasta('Retornos', 'granted'), /liberada/);
  assert.match(textoDaPasta('Retornos', 'prompt'), /Liberar/);
  assert.match(textoDaPasta('Retornos', 'denied'), /escolha a pasta de novo/);
});
