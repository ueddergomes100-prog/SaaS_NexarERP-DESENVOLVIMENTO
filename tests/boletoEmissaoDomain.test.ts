import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  erroDoConvenioBoleto,
  lerArquivoRetornoSicoob,
  parseLinhaRetornoSicoob,
  ROTULO_STATUS_BOLETO,
  statusBoletoEfetivo,
} from '../src/utils/boletoEmissaoDomain';
import type { BoletoDetails } from '../src/utils/financeDomain';

// --- statusBoletoEfetivo -----------------------------------------------

test('boleto pago nunca vira vencido, mesmo com vencimento no passado', () => {
  const boleto: Pick<BoletoDetails, 'status' | 'vencimento'> = { status: 'pago', vencimento: '2020-01-01' };
  assert.equal(statusBoletoEfetivo(boleto, '2026-09-22'), 'pago');
});

test('emitido com vencimento no passado vira vencido', () => {
  const boleto: Pick<BoletoDetails, 'status' | 'vencimento'> = { status: 'emitido', vencimento: '2026-09-01' };
  assert.equal(statusBoletoEfetivo(boleto, '2026-09-22'), 'vencido');
});

test('emitido com vencimento hoje ou no futuro nao vira vencido', () => {
  const hoje: Pick<BoletoDetails, 'status' | 'vencimento'> = { status: 'emitido', vencimento: '2026-09-22' };
  assert.equal(statusBoletoEfetivo(hoje, '2026-09-22'), 'emitido');
  const futuro: Pick<BoletoDetails, 'status' | 'vencimento'> = { status: 'em_remessa', vencimento: '2026-10-01' };
  assert.equal(statusBoletoEfetivo(futuro, '2026-09-22'), 'em_remessa');
});

test('todo status tem rotulo em portugues, inclusive o calculado "vencido"', () => {
  (['emitido', 'em_remessa', 'pago', 'vencido'] as const).forEach((status) => {
    assert.ok(ROTULO_STATUS_BOLETO[status]);
  });
});

// --- erroDoConvenioBoleto ------------------------------------------------

test('sem convenio nenhum, erro claro pedindo pra cadastrar', () => {
  assert.match(String(erroDoConvenioBoleto(null)), /não tem convênio/);
  assert.match(String(erroDoConvenioBoleto(undefined)), /não tem convênio/);
});

test('convenio incompleto aponta exatamente o que falta', () => {
  assert.match(String(erroDoConvenioBoleto({})), /cooperativa\/agência, conta/);
  assert.match(String(erroDoConvenioBoleto({ cooperativa: '3049' })), /conta/);
  assert.equal(erroDoConvenioBoleto({ cooperativa: '3049' })?.includes('cooperativa'), false);
});

test('convenio completo nao da erro', () => {
  assert.equal(erroDoConvenioBoleto({ cooperativa: '3049', conta: '51215', contaDv: '0' }), null);
});

// --- parseLinhaRetornoSicoob / lerArquivoRetornoSicoob --------------------

/** Monta uma linha de 240 posicoes com um Segmento T sintetico -- nao ha'
 *  arquivo de retorno real disponivel (so' o de remessa da Sol Life), entao
 *  este e' construido a partir da especificacao publica FEBRABAN, nao
 *  conferido campo a campo contra um arquivo aceito. Ver a ressalva em
 *  boletoEmissaoDomain.ts. */
const linhaSegmentoT = (args: { nossoNumero: string; codigoOcorrencia: string; valorCentavos: number; dataOcorrencia: string }): string => {
  let l = ' '.repeat(240);
  const put = (de: number, valor: string) => { l = l.slice(0, de) + valor + l.slice(de + valor.length); };
  put(13, 'T');
  put(15, args.codigoOcorrencia.padStart(2, '0'));
  put(37, args.nossoNumero.padStart(10, '0'));
  put(81, String(args.valorCentavos).padStart(15, '0'));
  put(110, args.dataOcorrencia);
  return l;
};

test('linha de tamanho errado nao quebra, so avisa e nao liquida', () => {
  const lida = parseLinhaRetornoSicoob('123');
  assert.equal(lida.liquidado, false);
  assert.match(String(lida.aviso), /240/);
});

test('linha que nao e segmento T (header/trailer/U) e ignorada sem erro', () => {
  const lida = parseLinhaRetornoSicoob(' '.repeat(240));
  assert.equal(lida.liquidado, false);
  assert.equal(lida.aviso, undefined);
});

test('codigo de ocorrencia 06 (liquidacao) da baixa; outro codigo so avisa', () => {
  const liquidado = parseLinhaRetornoSicoob(linhaSegmentoT({ nossoNumero: '1200', codigoOcorrencia: '06', valorCentavos: 52553, dataOcorrencia: '22092026' }));
  assert.equal(liquidado.liquidado, true);
  assert.equal(liquidado.nossoNumero, '0000001200');
  assert.equal(liquidado.valorPagoCentavos, 52553);
  assert.equal(liquidado.dataOcorrencia, '2026-09-22');
  assert.equal(liquidado.aviso, undefined);

  const rejeitado = parseLinhaRetornoSicoob(linhaSegmentoT({ nossoNumero: '1201', codigoOcorrencia: '03', valorCentavos: 0, dataOcorrencia: '22092026' }));
  assert.equal(rejeitado.liquidado, false);
  assert.match(String(rejeitado.aviso), /não é liquidação/);
});

test('codigo 17 (liquidacao apos baixa) tambem conta como liquidado', () => {
  const lida = parseLinhaRetornoSicoob(linhaSegmentoT({ nossoNumero: '1202', codigoOcorrencia: '17', valorCentavos: 52554, dataOcorrencia: '25092026' }));
  assert.equal(lida.liquidado, true);
});

test('lerArquivoRetornoSicoob separa liquidados de "para conferir"', () => {
  const arquivo = [
    linhaSegmentoT({ nossoNumero: '1200', codigoOcorrencia: '06', valorCentavos: 52553, dataOcorrencia: '22092026' }),
    linhaSegmentoT({ nossoNumero: '1201', codigoOcorrencia: '02', valorCentavos: 0, dataOcorrencia: '22092026' }),
    linhaSegmentoT({ nossoNumero: '1202', codigoOcorrencia: '17', valorCentavos: 52554, dataOcorrencia: '25092026' }),
  ].join('\r\n');

  const resumo = lerArquivoRetornoSicoob(arquivo);
  assert.equal(resumo.totalLinhas, 3);
  assert.equal(resumo.liquidados.length, 2);
  assert.equal(resumo.paraConferir.length, 1);
  assert.equal(resumo.paraConferir[0].nossoNumero, '0000001201');
});

test('arquivo de retorno vazio nao quebra', () => {
  const resumo = lerArquivoRetornoSicoob('');
  assert.equal(resumo.totalLinhas, 0);
  assert.equal(resumo.liquidados.length, 0);
  assert.equal(resumo.paraConferir.length, 0);
});

// --- retorno CNAB400 REAL do Sicoob (2026-09-23) ------------------------

const RETORNO_REAL = {
  entradaConfirmada: "1021792606600010030490000512150000000200040400004308401       00000001330101000000DM 00000000000000000000 01022009260003543901                    201026000000009514400000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000          3951795400010100000000000000000000000000000000000000000003",
  liquidacao: "1021792606600010030490000512150000000200039940004279903       00000000922403000000DM 00000000000000000000 01062109260003515403                    210926000000002302410423320012209260000250000000000000000000000000000000000000000000000000000000000000000000000000023024000000000000000000000000000000000000000000000000000010000000000000          3210565700010000000000000000000000000000000000000000000151",
  ocorrencia04: "1021792606600010030490000512150000000200035580004285001       00000000995101000000DM 00000000000000000000 01042309260003520501                    220926000000004093975630490010000000000000000000000000000000000000000000000000000000000000000000000000000000000000040939000000000000000000000000000000000000000000000000000010000000000000          2403941100015900000000000000000000000000000000000000000185",
  emSer: "1021792606600010030490000512150000000200035280004285602       00000001002002000000DM 00000000000000000000 01111908260003521102                    230926000000003182900000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000          1745091800013500000000000000000000000000000000000000000189",
};

test('CNAB400 real: liquidacao (06) le nosso numero com DV, data do pagamento e valor pago', () => {
  const lida = parseLinhaRetornoSicoob(RETORNO_REAL.liquidacao);
  assert.equal(lida.liquidado, true);
  assert.equal(lida.nossoNumero, '0000009224');
  assert.equal(lida.codigoOcorrencia, '06');
  assert.equal(lida.dataOcorrencia, '2026-09-21');
  assert.equal(lida.valorPagoCentavos, 23024);
  assert.equal(lida.vencimento, '2026-09-21');
});

test('CNAB400 real: entrada confirmada (02) e titulo em ser (11) so informam, nao dao baixa nem pedem conferencia', () => {
  const confirmada = parseLinhaRetornoSicoob(RETORNO_REAL.entradaConfirmada);
  assert.equal(confirmada.liquidado, false);
  assert.equal(confirmada.informativo, true);
  // Mesma chave que a remessa grava (P 38-47): 000001330 + DV 1.
  assert.equal(confirmada.nossoNumero, '0000013301');
  assert.equal(confirmada.seuNumero, '200040400004308401');
  assert.equal(confirmada.vencimento, '2026-10-20');
  assert.equal(parseLinhaRetornoSicoob(RETORNO_REAL.emSer).informativo, true);
});

test('CNAB400 real: ocorrencia 04 vem com valor pago mas NAO da baixa sozinha', () => {
  const lida = parseLinhaRetornoSicoob(RETORNO_REAL.ocorrencia04);
  assert.equal(lida.liquidado, false);
  assert.equal(lida.informativo, false);
  assert.ok((lida.valorPagoCentavos || 0) > 0);
  assert.match(lida.aviso || '', /confira no banco/);
});

test('CNAB400: header, trailer e linha de outro tamanho nao viram titulo', () => {
  assert.equal(parseLinhaRetornoSicoob('0'.padEnd(400, ' ')).nossoNumero, undefined);
  assert.equal(parseLinhaRetornoSicoob('9'.padEnd(400, ' ')).nossoNumero, undefined);
  assert.match(parseLinhaRetornoSicoob('1'.padEnd(399, ' ')).aviso || '', /399 posições/);
});

test('lerArquivoRetornoSicoob separa liquidados, informativos e para conferir num retorno CNAB400', () => {
  const arquivo = [
    '0'.padEnd(400, ' '),
    RETORNO_REAL.entradaConfirmada,
    RETORNO_REAL.liquidacao,
    RETORNO_REAL.ocorrencia04,
    RETORNO_REAL.emSer,
    '9'.padEnd(400, ' '),
  ].join('\r\n') + '\r\n';
  const resumo = lerArquivoRetornoSicoob(arquivo);
  assert.equal(resumo.liquidados.length, 1);
  assert.equal(resumo.informativos.length, 2);
  assert.equal(resumo.paraConferir.length, 1);
});
