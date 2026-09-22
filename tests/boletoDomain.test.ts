import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  codigoBarrasDaLinhaDigitavel,
  dvCodigoBarras,
  erroDaLinhaDigitavel,
  fatorDeVencimento,
  formatarLinhaDigitavel,
  linhaDigitavelDoCodigoBarras,
  modulo10,
  montarCodigoBarras,
} from '../src/utils/boletoDomain';

// --- fator de vencimento ---------------------------------------------------

test('fator de vencimento conta os dias desde 07/10/1997', () => {
  assert.equal(fatorDeVencimento('1997-10-07'), '0000');
  assert.equal(fatorDeVencimento('1997-10-08'), '0001');
  // Casos publicados pela FEBRABAN.
  assert.equal(fatorDeVencimento('2000-07-03'), '1000');
  assert.equal(fatorDeVencimento('2025-02-21'), '9999');
});

test('depois de 21/02/2025 o fator volta pra 1000, nao pra zero', () => {
  // O contador estourou 9999 e a FEBRABAN mandou reiniciar em 1000.
  assert.equal(fatorDeVencimento('2025-02-22'), '1000');
  assert.equal(fatorDeVencimento('2025-02-23'), '1001');
});

test('vencimento anterior a data-base ou invalido nao quebra', () => {
  assert.equal(fatorDeVencimento('1990-01-01'), '0000');
  assert.equal(fatorDeVencimento(''), '0000');
  assert.equal(fatorDeVencimento('data ruim'), '0000');
});

// --- digitos verificadores -------------------------------------------------

test('modulo 10 confere contra valores conhecidos', () => {
  assert.equal(modulo10('001901234'), 3);
  assert.equal(modulo10('0'), 0);
});

test('DV do codigo de barras nunca e 0, 10 nem 11', () => {
  // Resto 0, 1 ou 10 vira DV 1 -- regra propria do DV geral.
  for (let i = 0; i < 40; i += 1) {
    const campo = String(i).padStart(43, '1');
    const dv = dvCodigoBarras(campo);
    assert.ok(dv >= 1 && dv <= 9, `DV fora da faixa: ${dv}`);
  }
});

test('DV do codigo de barras recusa entrada que nao tem 43 digitos', () => {
  assert.equal(dvCodigoBarras('123'), -1);
});

// --- codigo de barras ------------------------------------------------------

test('codigo de barras tem 44 posicoes e monta os campos na ordem certa', () => {
  const cb = montarCodigoBarras({
    banco: '756',
    vencimento: '2026-10-06',
    valorCentavos: 52553,
    campoLivre: '1'.repeat(25),
  });
  assert.equal(cb.length, 44);
  assert.equal(cb.slice(0, 3), '756');           // banco
  assert.equal(cb.slice(3, 4), '9');             // moeda
  assert.equal(cb.slice(5, 9), fatorDeVencimento('2026-10-06'));
  assert.equal(cb.slice(9, 19), '0000052553');   // R$ 525,53 em centavos
  assert.equal(cb.slice(19, 44), '1'.repeat(25));
});

test('o DV do codigo de barras confere com o proprio codigo gerado', () => {
  const cb = montarCodigoBarras({ banco: '001', vencimento: '2026-12-01', valorCentavos: 123456, campoLivre: '9876543210987654321098765' });
  const semDv = cb.slice(0, 4) + cb.slice(5);
  assert.equal(Number(cb[4]), dvCodigoBarras(semDv));
});

test('valor zero e valor alto cabem nas 10 posicoes', () => {
  const zero = montarCodigoBarras({ banco: '756', vencimento: '2026-10-06', valorCentavos: 0, campoLivre: '0'.repeat(25) });
  assert.equal(zero.slice(9, 19), '0000000000');
  const alto = montarCodigoBarras({ banco: '756', vencimento: '2026-10-06', valorCentavos: 9999999999, campoLivre: '0'.repeat(25) });
  assert.equal(alto.slice(9, 19), '9999999999');
});

// --- linha digitavel -------------------------------------------------------

test('linha digitavel tem 47 posicoes e volta pro mesmo codigo de barras', () => {
  const cb = montarCodigoBarras({ banco: '756', vencimento: '2026-10-06', valorCentavos: 52553, campoLivre: '1234567890123456789012345' });
  const linha = linhaDigitavelDoCodigoBarras(cb);
  assert.equal(linha.length, 47);
  assert.equal(codigoBarrasDaLinhaDigitavel(linha), cb);
});

test('a linha digitavel gerada passa na propria conferencia', () => {
  for (const valor of [1, 52553, 1000000]) {
    const cb = montarCodigoBarras({ banco: '756', vencimento: '2026-10-06', valorCentavos: valor, campoLivre: '1234567890123456789012345' });
    assert.equal(erroDaLinhaDigitavel(linhaDigitavelDoCodigoBarras(cb)), null, `valor ${valor}`);
  }
});

test('um digito trocado na linha digitavel e pego', () => {
  const cb = montarCodigoBarras({ banco: '756', vencimento: '2026-10-06', valorCentavos: 52553, campoLivre: '1234567890123456789012345' });
  const linha = linhaDigitavelDoCodigoBarras(cb);
  const ruim = linha.slice(0, 3) + (linha[3] === '7' ? '6' : '7') + linha.slice(4);
  assert.match(String(erroDaLinhaDigitavel(ruim)), /não confere/);
});

test('linha digitavel com quantidade errada de numeros avisa quantos vieram', () => {
  assert.match(String(erroDaLinhaDigitavel('123')), /47/);
  assert.match(String(erroDaLinhaDigitavel('123')), /3/);
  // Vazio nao e' erro: o campo pode simplesmente nao ter sido preenchido.
  assert.equal(erroDaLinhaDigitavel(''), null);
});

test('formatacao da linha digitavel e a que sai impressa', () => {
  const cb = montarCodigoBarras({ banco: '756', vencimento: '2026-10-06', valorCentavos: 52553, campoLivre: '1234567890123456789012345' });
  const formatada = formatarLinhaDigitavel(linhaDigitavelDoCodigoBarras(cb));
  assert.match(formatada, /^\d{5}\.\d{5} \d{5}\.\d{6} \d{5}\.\d{6} \d \d{14}$/);
});

test('codigo de barras de tamanho errado nao vira linha digitavel', () => {
  assert.equal(linhaDigitavelDoCodigoBarras('123'), '');
  assert.equal(codigoBarrasDaLinhaDigitavel('123'), '');
});
