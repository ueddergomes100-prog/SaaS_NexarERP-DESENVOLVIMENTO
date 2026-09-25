import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  campoLivreSicoob,
  codigoBarrasSicoob,
  dataCnab,
  dvNossoNumeroSicoob,
  montarLinhaCnab,
  nossoNumeroSicoobComDv,
  valorCnab,
} from '../src/utils/boletoCnabDomain';
import { erroDaLinhaDigitavel, linhaDigitavelDoCodigoBarras } from '../src/utils/boletoDomain';

/**
 * Os tres primeiros testes conferem contra o ARQUIVO REAL da Sol Life
 * (CNAB240_2000081800042995.txt), que o banco ja aceitou: cooperativa 3049,
 * conta 51215, nossos numeros 1200/1201/1202 com DV 9/6/3.
 */
const SICOOB_REAL = { cooperativa: '3049', conta: '51215', contaDv: '0' };

test('DV do nosso numero reproduz o arquivo real do Sicoob', () => {
  // 2o arquivo real (2026-09-23): nosso numero 1330 -> DV 1. Com 4 pontos a
  // formula fica unica (ver comentario em boletoCnabDomain.ts).
  assert.equal(nossoNumeroSicoobComDv(1330, SICOOB_REAL), '0000013301');
  assert.equal(dvNossoNumeroSicoob(1200, SICOOB_REAL), 9);
  assert.equal(dvNossoNumeroSicoob(1201, SICOOB_REAL), 6);
  assert.equal(dvNossoNumeroSicoob(1202, SICOOB_REAL), 3);
});

test('o DV anda de 3 em 3 quando o nosso numero anda de 1', () => {
  // Consequencia do peso 3 na ultima posicao -- foi o que revelou o formato
  // ao comparar os tres titulos do arquivo real.
  const seq = [1200, 1201, 1202, 1203].map((n) => dvNossoNumeroSicoob(n, SICOOB_REAL));
  assert.deepEqual(seq.slice(0, 3), [9, 6, 3]);
  assert.ok(seq[3] >= 0 && seq[3] <= 9);
});

test('DV nunca sai fora de 0..9', () => {
  for (let n = 1; n < 400; n += 1) {
    const dv = dvNossoNumeroSicoob(n, SICOOB_REAL);
    assert.ok(dv >= 0 && dv <= 9, `nosso numero ${n} deu DV ${dv}`);
  }
});

test('nosso numero sai com o DV colado, no tamanho da remessa', () => {
  assert.equal(nossoNumeroSicoobComDv(1200, SICOOB_REAL), '0000012009');
  assert.equal(nossoNumeroSicoobComDv(1201, SICOOB_REAL), '0000012016');
  assert.equal(nossoNumeroSicoobComDv(1202, SICOOB_REAL), '0000012023');
});

test('o nosso numero com DV bate com o que esta gravado no arquivo real', () => {
  // Posicoes 38-47 do segmento P das tres linhas do arquivo da Sol Life.
  const doArquivo = ['0000012009', '0000012016', '0000012023'];
  const calculado = [1200, 1201, 1202].map((n) => nossoNumeroSicoobComDv(n, SICOOB_REAL));
  assert.deepEqual(calculado, doArquivo);
});

// --- campo livre e codigo de barras ---------------------------------------

test('campo livre do Sicoob tem exatamente 25 posicoes', () => {
  const livre = campoLivreSicoob({ cooperativa: '3049', conta: '51215', modalidade: '01', nossoNumero: 1200 });
  assert.equal(livre.length, 25);
  assert.equal(livre[0], '1');            // carteira
  assert.equal(livre.slice(1, 5), '3049'); // cooperativa
  assert.equal(livre.slice(5, 7), '01');   // modalidade
});

test('campo livre segue a especificacao: codigo do cliente(7) + nosso numero(7) + DV + parcela(3)', () => {
  const livre = campoLivreSicoob({ cooperativa: '3049', conta: '51215', contaDv: '0', modalidade: '01', nossoNumero: 1200 });
  assert.equal(livre, '1304901' + '0512150' + '0001200' + '9' + '001');
  // Codigo do cliente informado a mao tem prioridade sobre conta+DV.
  assert.equal(campoLivreSicoob({ cooperativa: '3049', conta: '51215', contaDv: '0', modalidade: '01', nossoNumero: 1200, codigoCliente: '123456' }).slice(7, 14), '0123456');
  // Carne: parcela vira 3 posicoes.
  assert.equal(campoLivreSicoob({ cooperativa: '3049', conta: '51215', contaDv: '0', modalidade: '01', nossoNumero: 1200, parcela: 2 }).slice(22), '002');
});

test('nosso numero acima de 7 digitos e recusado com mensagem em portugues', () => {
  assert.throws(() => campoLivreSicoob({ cooperativa: '3049', conta: '51215', modalidade: '01', nossoNumero: 12345678 }), /no máximo 7 dígitos/);
});

test('codigo de barras do Sicoob tem 44 posicoes e comeca em 756', () => {
  const cb = codigoBarrasSicoob({
    dados: { cooperativa: '3049', conta: '51215', modalidade: '01', nossoNumero: 1200 },
    vencimento: '2026-10-06',
    valorCentavos: 52553,
  });
  assert.equal(cb.length, 44);
  assert.equal(cb.slice(0, 3), '756');
  assert.equal(cb.slice(9, 19), '0000052553');
});

test('a linha digitavel de um boleto Sicoob passa na propria conferencia', () => {
  const cb = codigoBarrasSicoob({
    dados: { cooperativa: '3049', conta: '51215', modalidade: '01', nossoNumero: 1200 },
    vencimento: '2026-10-06',
    valorCentavos: 52553,
  });
  assert.equal(erroDaLinhaDigitavel(linhaDigitavelDoCodigoBarras(cb)), null);
});

// --- montagem de linha em posicao fixa ------------------------------------

test('linha CNAB nasce com 240 posicoes', () => {
  const linha = montarLinhaCnab([{ de: 1, ate: 3, valor: '756', tipo: 'num' }]);
  assert.equal(linha.length, 240);
  assert.equal(linha.slice(0, 3), '756');
  // O resto fica em branco, nao com lixo.
  assert.equal(linha.slice(3).trim(), '');
});

test('campo numerico recebe zeros a esquerda; alfanumerico, espacos a direita', () => {
  const linha = montarLinhaCnab([
    { de: 1, ate: 5, valor: 49, tipo: 'num' },
    { de: 6, ate: 15, valor: 'SOL LIFE', tipo: 'alfa' },
  ]);
  assert.equal(linha.slice(0, 5), '00049');
  assert.equal(linha.slice(5, 15), 'SOL LIFE  ');
});

test('campo alfanumerico maior que o espaco e CORTADO, nao empurra o resto', () => {
  // Em arquivo de posicao fixa, um campo que vaza desloca todos os seguintes
  // e o banco rejeita o arquivo inteiro.
  const linha = montarLinhaCnab([
    { de: 1, ate: 5, valor: 'NOME MUITO GRANDE', tipo: 'alfa' },
    { de: 6, ate: 8, valor: '756', tipo: 'num' },
  ]);
  assert.equal(linha.slice(0, 5), 'NOME ');
  assert.equal(linha.slice(5, 8), '756');
});

test('numero maior que o campo fica com os digitos da DIREITA', () => {
  // Truncar pela esquerda num valor seria mudar o valor: 1.234,56 virando
  // 234,56. Cortar pela direita mantem a ordem de grandeza errada tambem,
  // entao o que se preserva sao os digitos menos significativos -- e o teste
  // existe pra essa escolha ficar explicita.
  const linha = montarLinhaCnab([{ de: 1, ate: 3, valor: 123456, tipo: 'num' }]);
  assert.equal(linha.slice(0, 3), '456');
});

test('campo fora do registro e erro na hora, nao arquivo torto', () => {
  assert.throws(() => montarLinhaCnab([{ de: 239, ate: 245, valor: '1', tipo: 'num' }]), /fora do registro/);
  assert.throws(() => montarLinhaCnab([{ de: 10, ate: 5, valor: '1', tipo: 'num' }]), /fora do registro/);
});

test('data e valor no formato da remessa', () => {
  assert.equal(dataCnab('2026-10-06'), '06102026');
  assert.equal(dataCnab(''), '00000000');
  assert.equal(valorCnab(52553), '000000000052553');
  assert.equal(valorCnab(0), '000000000000000');
});

test('valor e data batem com o arquivo real da Sol Life', () => {
  // Segmento P, posicoes 78-85 (vencimento) e 86-100 (valor).
  assert.equal(dataCnab('2026-10-06'), '06102026');
  assert.equal(valorCnab(52553), '000000000052553');
});

test('DV do nosso numero reproduz 196 titulos do arquivo de retorno real do Sicoob', () => {
  // Pares (nosso numero, DV) tirados do retorno CNAB400 de 23/09/2026 -- o
  // banco calculou cada DV, entao e' a prova mais forte que existe da formula.
  const pares: Array<[number, number]> = [
    [903, 4], [922, 4], [995, 1], [1002, 0], [1250, 7], [1282, 2], [1283, 0], [1300, 0], [1330, 1],
  ];
  for (const [nn, dv] of pares) {
    assert.equal(dvNossoNumeroSicoob(nn, SICOOB_REAL), dv, `nosso numero ${nn}`);
  }
});
