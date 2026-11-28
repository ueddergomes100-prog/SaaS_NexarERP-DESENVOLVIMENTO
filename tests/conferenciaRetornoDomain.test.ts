import assert from 'node:assert/strict';
import { test } from 'node:test';
import { montarConferenciaDoRetorno } from '../src/utils/conferenciaRetornoDomain';

const titulo = (id: string, nn: string, extra: Record<string, unknown> = {}) => ({
  id, descricao: `Pedido #${id}`, clienteNome: `CLIENTE ${id}`, valorCentavos: 10000, status: 'Pendente',
  dataVencimento: '2026-11-10', boleto: { nossoNumero: nn, vencimento: '2026-11-10' }, ...extra,
});

test('conferencia do retorno (28/11/2026): cada boleto com vencimento, pago em, atraso, juros e totais', () => {
  const c = montarConferenciaDoRetorno([
    // Pago em dia, sem juros.
    { nossoNumero: '001', dataOcorrencia: '2026-11-10', valorPagoCentavos: 10000 },
    // Pago 12 dias depois, com juros/multa e tarifa do arquivo.
    { nossoNumero: '002', dataOcorrencia: '2026-11-22', valorPagoCentavos: 10560, detalhe: { jurosMultaCentavos: 560, descontoCentavos: 0, tarifaCentavos: 250, valorLiquidoCentavos: 10310 } },
    // Ja' estava pago no sistema.
    { nossoNumero: '003', dataOcorrencia: '2026-11-11', valorPagoCentavos: 10000 },
    // Nao existe no sistema.
    { nossoNumero: '999', dataOcorrencia: '2026-11-11', valorPagoCentavos: 5000 },
    // Linha repetida no arquivo: nao conta duas vezes.
    { nossoNumero: '001', dataOcorrencia: '2026-11-10', valorPagoCentavos: 10000 },
    // Cancelado no sistema, pago no banco.
    { nossoNumero: '004', dataOcorrencia: '2026-11-09', valorPagoCentavos: 10000 },
  ], [
    titulo('a', '001'), titulo('b', '002'), titulo('c', '003', { status: 'Paga' }), titulo('d', '004', { status: 'Cancelada' }),
  ]);
  assert.equal(c.aBaixar.length, 3);
  assert.equal(c.aBaixar[0].nossoNumero, '002', 'o mais atrasado primeiro');
  assert.equal(c.aBaixar[0].diasDeAtraso, 12);
  assert.equal(c.aBaixar[0].jurosMultaCentavos, 560);
  assert.equal(c.aBaixar[0].tarifaCentavos, 250);
  assert.equal(c.aBaixar.find((d) => d.nossoNumero === '001')?.diasDeAtraso, 0);
  assert.equal(c.aBaixar.find((d) => d.nossoNumero === '004')?.canceladoNoSistema, true);
  assert.equal(c.aBaixar.find((d) => d.nossoNumero === '004')?.diasDeAtraso, 0, 'pago antes do vencimento nao e atraso');
  assert.deepEqual(c.jaPagos.map((j) => j.nossoNumero), ['003']);
  assert.deepEqual(c.naoEncontrados, ['999']);
  assert.deepEqual(c.totais, {
    quantidade: 3, valorBoletosCentavos: 30000, jurosMultaCentavos: 560, descontoCentavos: 0,
    tarifaCentavos: 250, pagoCentavos: 30560, liquidoCentavos: 30310,
  });
});

test('conferencia do retorno: pago a menos sem detalhe do banco vira desconto', () => {
  const c = montarConferenciaDoRetorno([{ nossoNumero: '010', dataOcorrencia: '2026-11-05', valorPagoCentavos: 9500 }], [titulo('x', '010')]);
  assert.equal(c.aBaixar[0].descontoCentavos, 500);
  assert.equal(c.aBaixar[0].jurosMultaCentavos, 0);
  assert.equal(c.totais.liquidoCentavos, 9500);
});
