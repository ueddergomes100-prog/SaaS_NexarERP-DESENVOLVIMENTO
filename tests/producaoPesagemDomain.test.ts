import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calcularPesagem,
  consumoDoComponente,
  erroDasTaras,
  ganhoDePeso,
  nomeDaTara,
  parseTaras,
  unidadeEmKg,
} from '../src/utils/producaoPesagemDomain';

const TARAS = parseTaras([
  { id: 'c1', nome: 'Caixa 1', pesoKg: 1.9 },
  { id: 'c2', nome: 'Caixa 2', pesoKg: '1,750' },
  { id: 'c3', nome: 'Caixa 3', pesoKg: 1.4 },
]);

test('exemplo do dono: 24,250 kg - caixa 1 - caixa 2 = 20,600 kg = 82 pacotes de 0,250 + 0,100 kg', () => {
  const r = calcularPesagem({ pesoBrutoKg: '24,250', tarasUsadas: { c1: 1, c2: 1 }, taras: TARAS, pesoUnidadeKg: 0.25, pesoEmbalagemKg: 0 });
  assert.equal(r.erro, null);
  assert.equal(r.taraKg, 3.65);
  assert.equal(r.liquidoKg, 20.6);
  assert.equal(r.unidadesExatas, 82.4);
  assert.equal(r.unidadesSugeridas, 82, 'so pacote fechado');
  assert.equal(r.residuoKg, 0.1);
  assert.deepEqual(r.detalheTaras.map((t) => [t.nome, t.quantidade, t.totalKg]), [['CAIXA 1', 1, 1.9], ['CAIXA 2', 1, 1.75]]);
});

test('com o peso da sacolinha: cada pacote pesa unidade + embalagem na balanca', () => {
  // 20,600 sem caixas; pacote 0,250 + sacolinha 0,005 = 0,255 -> 80 pacotes; sacolinhas 0,400; liquido 20,200; residuo 0,200
  const r = calcularPesagem({ pesoBrutoKg: 24.25, tarasUsadas: { c1: 1, c2: 1 }, taras: TARAS, pesoUnidadeKg: 0.25, pesoEmbalagemKg: 0.005 });
  assert.equal(r.unidadesSugeridas, 80);
  assert.equal(r.embalagemKg, 0.4);
  assert.equal(r.liquidoKg, 20.2);
  assert.equal(r.residuoKg, 0.2);
  // Embalagens digitadas na mao (kg) mandam.
  const m = calcularPesagem({ pesoBrutoKg: 24.25, tarasUsadas: { c1: 1, c2: 1 }, taras: TARAS, pesoUnidadeKg: 0.25, pesoEmbalagemKg: 0.005, embalagemManualKg: '0,600' });
  assert.equal(m.embalagemKg, 0.6);
  assert.equal(m.liquidoKg, 20);
  assert.equal(m.unidadesSugeridas, 80);
  assert.equal(m.residuoKg, 0);
});

test('erros em portugues: sem peso bruto, produto sem peso da unidade, caixas mais pesadas que o bruto', () => {
  assert.match(calcularPesagem({ pesoBrutoKg: '', tarasUsadas: {}, taras: TARAS, pesoUnidadeKg: 0.25, pesoEmbalagemKg: 0 }).erro || '', /peso bruto/);
  assert.match(calcularPesagem({ pesoBrutoKg: 10, tarasUsadas: {}, taras: TARAS, pesoUnidadeKg: 0, pesoEmbalagemKg: 0 }).erro || '', /peso líquido da unidade/);
  assert.match(calcularPesagem({ pesoBrutoKg: 3, tarasUsadas: { c1: 1, c2: 1 }, taras: TARAS, pesoUnidadeKg: 0.25, pesoEmbalagemKg: 0 }).erro || '', /pesam mais/);
});

test('consumo do componente: "usada de verdade" manda; senao receita + perda - sobra', () => {
  assert.deepEqual(consumoDoComponente({ necessario: 20.5, perdaExtra: 0, sobra: 0, usadaReal: '20' }), { consumo: 20, real: true });
  assert.deepEqual(consumoDoComponente({ necessario: 20.5, perdaExtra: '0,3', sobra: 0, usadaReal: '' }), { consumo: 20.8, real: false });
  assert.deepEqual(consumoDoComponente({ necessario: 20.5, perdaExtra: 0, sobra: 0.5, usadaReal: undefined }), { consumo: 20, real: false });
});

test('ganho de peso e taras', () => {
  assert.deepEqual(ganhoDePeso(20.6, 20), { ganhoKg: 0.6, percentual: 3 });
  assert.deepEqual(ganhoDePeso(19.5, 20), { ganhoKg: -0.5, percentual: -2.5 });
  assert.equal(unidadeEmKg('KG'), true);
  assert.equal(unidadeEmKg('UN'), false);
  assert.equal(parseTaras([{ id: 'x', nome: 'Sem peso', pesoKg: 0 }, 'lixo']).length, 0);
  assert.equal(erroDasTaras([{ nome: 'Caixa 1', pesoKg: '1,9' }]), null);
  assert.match(erroDasTaras([{ nome: 'Caixa 1', pesoKg: 1 }, { nome: 'caixa 1', pesoKg: 2 }]) || '', /duas caixas/);
  assert.match(erroDasTaras([{ nome: '', pesoKg: 1 }]) || '', /nome/);
  assert.match(erroDasTaras([{ nome: 'Caixa', pesoKg: 'x' }]) || '', /peso/);
});

test('nome da caixa sempre em maiusculas e peso em gramas e recusado (28/10)', () => {
  // Caps Lock trocado no meio: "caIXA 2" gravado vira "CAIXA 2" na leitura, sem rotina de dados.
  assert.deepEqual(parseTaras([{ id: 'a', nome: '  caIXA   2 ', pesoKg: 1.75 }]).map((t) => t.nome), ['CAIXA 2']);
  assert.equal(nomeDaTara('caixa 1'), 'CAIXA 1');
  assert.match(erroDasTaras([{ nome: 'Caixa 1', pesoKg: 1900 }]) || '', /quilos, com vírgula/);
  assert.equal(erroDasTaras([{ nome: 'Caixa 1', pesoKg: '1,900' }]), null);
  // Embalagem por unidade (como no cadastro): 24,250 - 3,650 de caixas, pacote 0,250 + sacolinha 0,005.
  const r = calcularPesagem({ pesoBrutoKg: '24,25', tarasUsadas: { c1: 1, c2: 1 }, taras: TARAS, pesoUnidadeKg: 0.25, pesoEmbalagemKg: '0,005' });
  assert.equal(r.erro, null);
  assert.equal(r.unidadesSugeridas, 80);
  assert.equal(r.embalagemKg, 0.4);
  assert.equal(r.residuoKg, 0.2);
});
