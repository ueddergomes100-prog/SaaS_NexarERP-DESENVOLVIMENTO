import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  montarRemessaSicoob,
  nomeArquivoRemessaSicoob,
  type ConvenioBoletoSicoob,
  type TituloRemessaSicoob,
} from '../src/utils/boletoRemessaSicoobDomain';

/**
 * Os testes principais aqui reproduzem o ARQUIVO REAL da Sol Life
 * (CNAB240_2000081800042995.txt, ja aceito pelo Sicoob): mesmo convenio,
 * mesmos 3 titulos, mesmo sacado -- e comparam LINHA A LINHA, byte a byte,
 * contra o que o banco recebeu de verdade. E' o teste mais forte que da
 * pra fazer sem homologacao: prova que, pra este caso, a saida e' identica
 * a um arquivo que o banco ja processou.
 */
const CONVENIO_SOL_LIFE: ConvenioBoletoSicoob = {
  cooperativa: '3049',
  conta: '51215',
  contaDv: '0',
  cnpjCedente: '17926066000100',
  nomeCedente: 'SOL LIFE PRODUTOS NATURAIS LTD',
  // multa (2%) e juros (10% a.m.) sao o padrao -- os valores em R$ das
  // mensagens saem do valor do titulo, nao de texto digitado.
  numeroRemessa: 1763,
};

// Documento do sacado tal como grava no arquivo real -- ver a ressalva no
// topo de boletoRemessaSicoobDomain.ts sobre a incerteza do tipo (CPF/CNPJ)
// desse campo especifico. O teste prova a POSICAO, nao a validade do dado.
const SACADO_REAL = {
  tipoDocumento: 'CNPJ' as const,
  documento: '6300088000143',
  nome: 'JURACY DOS SANTOS ARAUJO',
  endereco: 'RUA DOZE, 109',
  bairro: 'CENTRO',
  cep: '35125000',
  cidade: 'TUMIRITINGA',
  uf: 'MG',
};

const TITULOS_REAIS: TituloRemessaSicoob[] = [
  { nossoNumero: 1200, numeroDocumento: '35350', parcela: 1, seuNumero: '200008180004299501', referencia: '30212', vencimento: '2026-10-06', valorCentavos: 52553, sacado: SACADO_REAL },
  { nossoNumero: 1201, numeroDocumento: '35350', parcela: 2, seuNumero: '200008180004299502', referencia: '30212', vencimento: '2026-10-13', valorCentavos: 52553, sacado: SACADO_REAL },
  { nossoNumero: 1202, numeroDocumento: '35350', parcela: 3, seuNumero: '200008180004299503', referencia: '30212', vencimento: '2026-10-20', valorCentavos: 52554, sacado: SACADO_REAL },
];

const ARQUIVO_REAL_LINHAS = [
  '75600000         217926066000100                    03049 00000005121500SOL LIFE PRODUTOS NATURAIS LTDSICOOB                                  10809202618191400176308100000                                                                     ',
  '75600011R01  040 2017926066000100                    03049 0000000512150 SOL LIFE PRODUTOS NATURAIS LTD                                                                                000017630809202600000000                                 ',
  '7560001300001P 010304900000000512150 000001200901016     10 220003535001     0610202600000000005255300000 02N08092026207102026000000000001000000000000000000000000000000000000000000000000000000000200008180004299501       3000   090000000000 ',
  '7560001300002Q 012006300088000143JURACY DOS SANTOS ARAUJO                RUA DOZE, 109                           CENTRO         35125000TUMIRITINGA    MG0000000000000000                                        000                            ',
  '7560001300003R 01000000000000000000000000000000000000000000000000207102026000000000000200                                                                                                              0000000000000000 000000000000  0         ',
  '7560001300004S 013Apos o Vencimento Multa de RS 10,51.    Apos o Vencimento Mora Diaria de RS 1,75- Ref. NF.: 30212                       PROTESTO NO 7 DIA APOS O VENCIMENTO                                                                   ',
  '7560001300005P 010304900000000512150 000001201602016     10 220003535002     1310202600000000005255300000 02N08092026214102026000000000001000000000000000000000000000000000000000000000000000000000200008180004299502       3000   090000000000 ',
  '7560001300006Q 012006300088000143JURACY DOS SANTOS ARAUJO                RUA DOZE, 109                           CENTRO         35125000TUMIRITINGA    MG0000000000000000                                        000                            ',
  '7560001300007R 01000000000000000000000000000000000000000000000000214102026000000000000200                                                                                                              0000000000000000 000000000000  0         ',
  '7560001300008S 013Apos o Vencimento Multa de RS 10,51.    Apos o Vencimento Mora Diaria de RS 1,75- Ref. NF.: 30212                       PROTESTO NO 7 DIA APOS O VENCIMENTO                                                                   ',
  '7560001300009P 010304900000000512150 000001202303016     10 220003535003     2010202600000000005255400000 02N08092026221102026000000000001000000000000000000000000000000000000000000000000000000000200008180004299503       3000   090000000000 ',
  '7560001300010Q 012006300088000143JURACY DOS SANTOS ARAUJO                RUA DOZE, 109                           CENTRO         35125000TUMIRITINGA    MG0000000000000000                                        000                            ',
  '7560001300011R 01000000000000000000000000000000000000000000000000221102026000000000000200                                                                                                              0000000000000000 000000000000  0         ',
  '7560001300012S 013Apos o Vencimento Multa de RS 10,51.    Apos o Vencimento Mora Diaria de RS 1,75- Ref. NF.: 30212                       PROTESTO NO 7 DIA APOS O VENCIMENTO                                                                   ',
  '75600015         00001400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000                                                                                                                             ',
  '75699999         000001000016000000                                                                                                                                                                                                             ',
];

const gerar = () => montarRemessaSicoob({
  convenio: CONVENIO_SOL_LIFE,
  titulos: TITULOS_REAIS,
  dataGeracao: '2026-09-08',
  horaGeracao: '181914',
});

test('a remessa gerada tem 16 linhas de 240 posicoes, terminadas em CRLF', () => {
  const arquivo = gerar();
  assert.equal(arquivo.endsWith('\r\n'), true);
  const linhas = arquivo.split('\r\n').filter((l) => l.length > 0);
  assert.equal(linhas.length, 16);
  linhas.forEach((l) => assert.equal(l.length, 240));
});

test('cada linha da remessa bate byte a byte com o arquivo real da Sol Life', () => {
  const linhas = gerar().split('\r\n').filter((l) => l.length > 0);
  linhas.forEach((linha, indice) => {
    assert.equal(linha, ARQUIVO_REAL_LINHAS[indice], `linha ${indice} (0-based) diverge do arquivo real`);
  });
});

test('o arquivo inteiro e identico ao arquivo real, concatenado', () => {
  const esperado = ARQUIVO_REAL_LINHAS.join('\r\n') + '\r\n';
  assert.equal(gerar(), esperado);
});

test('remessa sem titulo nenhum e erro, nao arquivo vazio', () => {
  assert.throws(
    () => montarRemessaSicoob({ convenio: CONVENIO_SOL_LIFE, titulos: [], dataGeracao: '2026-09-08', horaGeracao: '181914' }),
    /Selecione ao menos um boleto/,
  );
});

test('um titulo a mais muda a contagem de registros nos trailers', () => {
  const quartoTitulo: TituloRemessaSicoob = {
    nossoNumero: 1203, numeroDocumento: '35350', parcela: 4, vencimento: '2026-10-27', valorCentavos: 10000, sacado: SACADO_REAL,
  };
  const arquivo = montarRemessaSicoob({
    convenio: CONVENIO_SOL_LIFE,
    titulos: [...TITULOS_REAIS, quartoTitulo],
    dataGeracao: '2026-09-08',
    horaGeracao: '181914',
  });
  const linhas = arquivo.split('\r\n').filter((l) => l.length > 0);
  // 4 titulos x 4 segmentos + header arquivo + header lote + trailer lote + trailer arquivo = 20.
  assert.equal(linhas.length, 20);
  const trailerLote = linhas[linhas.length - 2];
  const trailerArquivo = linhas[linhas.length - 1];
  // header lote(1) + 4*4 segmentos + trailer lote(1) = 18 registros no lote.
  assert.equal(trailerLote.slice(17, 23), '000018');
  // 18 + header arquivo(1) + trailer arquivo(1) = 20 registros no arquivo.
  assert.equal(trailerArquivo.slice(23, 29), '000020');
});

test('nome do arquivo de remessa segue o padrao esperado', () => {
  assert.equal(nomeArquivoRemessaSicoob(1763, '2026-09-08'), 'CNAB240_sicoob_1763_08092026.txt');
  assert.equal(nomeArquivoRemessaSicoob(7, '2026-01-05'), 'CNAB240_sicoob_0007_05012026.txt');
});

test('nosso numero errado (nao pertence ao convenio) ainda gera arquivo -- validacao de negocio fica na tela', () => {
  // O dominio nao valida se o nosso numero "faz sentido" pro convenio; isso
  // e' responsabilidade de quem chama (a alocacao via contador atomico).
  const arquivo = montarRemessaSicoob({
    convenio: CONVENIO_SOL_LIFE,
    titulos: [{ nossoNumero: 999999, numeroDocumento: '1', vencimento: '2026-10-06', valorCentavos: 100, sacado: SACADO_REAL }],
    dataGeracao: '2026-09-08',
    horaGeracao: '181914',
  });
  assert.match(arquivo, /^756/);
});

// --- 2o arquivo real (2026-09-23): 1 titulo, outro sacado, outro dia --------

const ARQUIVO_REAL_2 = [
  '75600000         217926066000100                    03049 00000005121500SOL LIFE PRODUTOS NATURAIS LTDSICOOB                                  12009202621334200194208100000                                                                     ',
  '75600011R01  040 2017926066000100                    03049 0000000512150 SOL LIFE PRODUTOS NATURAIS LTD                                                                                000019422009202600000000                                 ',
  '7560001300001P 010304900000000512150 000001330101016     10 220003543901     2010202600000000009514400000 02N20092026221102026000000000001000000000000000000000000000000000000000000000000000000000200040400004308401       3000   090000000000 ',
  '7560001300002Q 012039517954000101AKSON LUIZ DE ANDRADE 13968036611       PRACA CESARIO ALVIM, 204                CENTRO         35300036CARATINGA      MG0000000000000000                                        000                            ',
  '7560001300003R 01000000000000000000000000000000000000000000000000221102026000000000000200                                                                                                              0000000000000000 000000000000  0         ',
  '7560001300004S 013Apos o Vencimento Multa de RS 19,03.    Apos o Vencimento Mora Diaria de RS 3,17- Ref. NF.: 16758                       PROTESTO NO 7 DIA APOS O VENCIMENTO                                                                   ',
  '75600015         00000600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000                                                                                                                             ',
  '75699999         000001000008000000                                                                                                                                                                                                             ',
];

test('o 2o arquivo real (1 titulo, sacado CNPJ, remessa 1942) sai identico, byte a byte', () => {
  const arquivo = montarRemessaSicoob({
    convenio: { ...CONVENIO_SOL_LIFE, numeroRemessa: 1942 },
    titulos: [{
      nossoNumero: 1330,
      numeroDocumento: '35439',
      parcela: 1,
      seuNumero: '200040400004308401',
      referencia: '16758',
      vencimento: '2026-10-20',
      valorCentavos: 95144,
      sacado: {
        tipoDocumento: 'CNPJ',
        documento: '39517954000101',
        nome: 'AKSON LUIZ DE ANDRADE 13968036611',
        endereco: 'PRACA CESARIO ALVIM, 204',
        bairro: 'CENTRO',
        cep: '35300036',
        cidade: 'CARATINGA',
        uf: 'MG',
      },
    }],
    dataGeracao: '2026-09-20',
    horaGeracao: '213342',
  });
  const linhas = arquivo.split('\r\n').filter((l) => l.length > 0);
  linhas.forEach((linha, i) => assert.equal(linha, ARQUIVO_REAL_2[i], `linha ${i} diverge do 2o arquivo real`));
  assert.equal(linhas.length, ARQUIVO_REAL_2.length);
});

test('sem informar o seu numero, ele e derivado do documento, do nosso numero e da parcela', () => {
  const arquivo = montarRemessaSicoob({
    convenio: CONVENIO_SOL_LIFE,
    titulos: [{ nossoNumero: 1331, numeroDocumento: '35440', parcela: 2, vencimento: '2026-10-25', valorCentavos: 10000, sacado: SACADO_REAL }],
    dataGeracao: '2026-09-23',
    horaGeracao: '120000',
  });
  const p = arquivo.split('\r\n')[2];
  assert.equal(p.slice(195, 213), '200054400004133102');
  assert.equal(p.slice(47, 49), '02');
  assert.equal(p.slice(60, 72), '220003544002');
});

test('multa e juros do convenio mudam o percentual e os valores em R$ do boleto', () => {
  const arquivo = montarRemessaSicoob({
    convenio: { ...CONVENIO_SOL_LIFE, multaPercentual: 5, jurosMensalPercentual: 3 },
    titulos: [{ nossoNumero: 1332, numeroDocumento: '1', vencimento: '2026-10-25', valorCentavos: 100000, sacado: SACADO_REAL }],
    dataGeracao: '2026-09-23',
    horaGeracao: '120000',
  });
  const [, , p, , r, s] = arquivo.split('\r\n');
  assert.equal(p.slice(126, 141), '000000000000300');
  assert.equal(r.slice(74, 89), '000000000000500');
  assert.ok(s.includes('Multa de RS 50,00.'));
  assert.ok(s.includes('Mora Diaria de RS 1,00'));
});
