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
