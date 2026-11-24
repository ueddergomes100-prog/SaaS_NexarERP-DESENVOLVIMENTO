import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  centavosDoFiltroDeValor,
  contarFiltrosExtras,
  documentoDoBoleto,
  erroDoConvenioBoleto,
  faturadoNoPeriodo,
  FILTROS_EXTRAS_VAZIOS,
  lerArquivoRetornoSicoob,
  numeroDaNotaParaOBoleto,
  parseLinhaRetornoSicoob,
  resumoDaEmissaoNaHora,
  separarTitulosDeBoletoDoDocumento,
  ROTULO_STATUS_BOLETO,
  statusBoletoEfetivo,
  tituloPassaNosFiltrosExtras,
  valorNaFaixa,
  vencimentoNoPeriodo,
} from '../src/utils/boletoEmissaoDomain';
import type { BoletoDetails } from '../src/utils/financeDomain';

// --- o boleto cita a NOTA FISCAL da venda (12/11/2026) -------------------

test('boleto: numero do documento e referencia sao a nota fiscal autorizada do pedido', () => {
  // Caso real: pedido 0397, NF-e 232. O boleto saia com 0397 e "Ref. NF.: 0397".
  const notas = [{ tipo: 'NF-e', status: 'authorized', number: 232 }];
  assert.equal(numeroDaNotaParaOBoleto(notas), '232');
  assert.deepEqual(documentoDoBoleto({ numeroNota: '232', numeroPedido: '0397', nossoNumero: 4471 }), { numeroDocumento: '232', referencia: '232', referenciaEhPedido: false });
});

test('boleto: sem nota autorizada fica o pedido (e diz que e pedido); sem pedido, o nosso numero', () => {
  assert.deepEqual(documentoDoBoleto({ numeroNota: '', numeroPedido: '0397', nossoNumero: 4471 }), { numeroDocumento: '0397', referencia: '0397', referenciaEhPedido: true });
  assert.deepEqual(documentoDoBoleto({ numeroPedido: '', nossoNumero: 4471 }), { numeroDocumento: '4471', referencia: '', referenciaEhPedido: false });
});

test('boleto: so nota de venda autorizada conta; NF-e vale mais que cupom; cancelada, rejeitada e devolucao ficam de fora', () => {
  assert.equal(numeroDaNotaParaOBoleto([]), '');
  assert.equal(numeroDaNotaParaOBoleto([{ tipo: 'NF-e', status: 'rejected', number: 10 }, { tipo: 'NF-e', status: 'canceled', number: 11 }, { tipo: 'NF-e', status: 'enqueued', number: 0 }]), '');
  assert.equal(numeroDaNotaParaOBoleto([{ tipo: 'NF-e', status: 'authorized', finalidade: 'devolucao', number: 50 }]), '');
  assert.equal(numeroDaNotaParaOBoleto([{ tipo: 'NFS-e', status: 'authorized', number: 7 }]), '');
  // Cupom e NF-e do mesmo pedido: a NF-e.
  assert.equal(numeroDaNotaParaOBoleto([{ tipo: 'NFC-e', status: 'authorized', number: 900 }, { tipo: 'NF-e', status: 'authorized', number: 232 }]), '232');
  // Nota cancelada e reemitida: a autorizada (a mais nova entre as que valem).
  assert.equal(numeroDaNotaParaOBoleto([{ tipo: 'NF-e', status: 'canceled', number: 232 }, { tipo: 'NF-e', status: 'authorized', number: 233 }]), '233');
  // Numero vindo como texto com zeros.
  assert.equal(numeroDaNotaParaOBoleto([{ tipo: 'NF-e', status: 'authorized', number: '000000232' }]), '232');
});

// --- filtros de vencimento, emissao, banco e valor (23/10/2026) ----------

test('vencimento: hoje, proximos 7 dias, este mes, ja vencidos e periodo', () => {
  const hoje = '2026-10-23';
  assert.equal(vencimentoNoPeriodo('2026-10-23', 'hoje', {}, hoje), true);
  assert.equal(vencimentoNoPeriodo('2026-10-24', 'hoje', {}, hoje), false);
  assert.equal(vencimentoNoPeriodo('2026-10-29', '7dias', {}, hoje), true);
  assert.equal(vencimentoNoPeriodo('2026-10-30', '7dias', {}, hoje), false);
  assert.equal(vencimentoNoPeriodo('2026-10-22', '7dias', {}, hoje), false);
  assert.equal(vencimentoNoPeriodo('2026-10-01', 'mes', {}, hoje), true);
  assert.equal(vencimentoNoPeriodo('2026-11-01', 'mes', {}, hoje), false);
  assert.equal(vencimentoNoPeriodo('2026-10-22', 'vencidos', {}, hoje), true);
  assert.equal(vencimentoNoPeriodo('2026-10-23', 'vencidos', {}, hoje), false);
  assert.equal(vencimentoNoPeriodo('2026-11-10', 'periodo', { de: '2026-11-01', ate: '2026-11-30' }, hoje), true);
  assert.equal(vencimentoNoPeriodo('', 'hoje', {}, hoje), false);
  assert.equal(vencimentoNoPeriodo('', 'todos', {}, hoje), true);
});

test('valor: aceita 1.234,56 e 1234.56; vazio nao limita', () => {
  assert.equal(centavosDoFiltroDeValor('1.234,56'), 123456);
  assert.equal(centavosDoFiltroDeValor('1234.56'), 123456);
  assert.equal(centavosDoFiltroDeValor('R$ 50'), 5000);
  assert.equal(centavosDoFiltroDeValor(''), null);
  assert.equal(centavosDoFiltroDeValor('abc'), null);
  assert.equal(valorNaFaixa(10000, '50', '150'), true);
  assert.equal(valorNaFaixa(10000, '150', ''), false);
  assert.equal(valorNaFaixa(10000, '', ''), true);
});

test('titulo nos filtros extras: emissao pelo boleto, banco e contagem de filtros', () => {
  const hoje = '2026-10-23';
  const titulo = { valorCentavos: 25000, bancoId: 'b1', dataVencimento: '2026-10-25', boleto: { dataEmissao: '2026-10-23', vencimento: '2026-10-25' } };
  assert.equal(tituloPassaNosFiltrosExtras(titulo, FILTROS_EXTRAS_VAZIOS, hoje), true);
  assert.equal(tituloPassaNosFiltrosExtras(titulo, { ...FILTROS_EXTRAS_VAZIOS, emissao: 'hoje' }, hoje), true);
  assert.equal(tituloPassaNosFiltrosExtras({ ...titulo, boleto: null }, { ...FILTROS_EXTRAS_VAZIOS, emissao: 'hoje' }, hoje), false, 'sem boleto nao tem emissao');
  assert.equal(tituloPassaNosFiltrosExtras(titulo, { ...FILTROS_EXTRAS_VAZIOS, bancoId: 'b2' }, hoje), false);
  assert.equal(tituloPassaNosFiltrosExtras(titulo, { ...FILTROS_EXTRAS_VAZIOS, vencimento: '7dias' }, hoje), true);
  assert.equal(tituloPassaNosFiltrosExtras(titulo, { ...FILTROS_EXTRAS_VAZIOS, valorAte: '200' }, hoje), false);
  assert.equal(contarFiltrosExtras(FILTROS_EXTRAS_VAZIOS), 0);
  assert.equal(contarFiltrosExtras({ ...FILTROS_EXTRAS_VAZIOS, bancoId: 'b1', valorDe: '10', vencimento: 'mes' }), 3);
});

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

/** Segmentos T + U de 240 posicoes, nas posicoes conferidas com o retorno
 *  CNAB240 real da Embala Minas (24/11/2026; ver boletoEmissaoDomain.ts). Dados
 *  sinteticos: o arquivo real tem nome e documento de cliente. */
const linhaSegmentoT = (args: { nossoNumero: string; codigoOcorrencia: string; valorCentavos: number; dataOcorrencia: string; valorPagoCentavos?: number; semU?: boolean }): string => {
  let t = ' '.repeat(240);
  const putT = (de: number, valor: string) => { t = t.slice(0, de) + valor + t.slice(de + valor.length); };
  putT(0, '7560001300001');
  putT(13, 'T');
  putT(15, args.codigoOcorrencia.padStart(2, '0'));
  putT(37, `${args.nossoNumero.padStart(10, '0')}01016`);
  putT(73, '21112026');
  putT(81, String(args.valorCentavos).padStart(15, '0'));
  // Lixo onde o leitor antigo procurava a data (posicao 111): nao pode mais ser lido.
  putT(110, '0039303');
  if (args.semU) return t;
  let u = '0'.repeat(240);
  const putU = (de: number, valor: string) => { u = u.slice(0, de) + valor + u.slice(de + valor.length); };
  putU(0, '7560001300002');
  putU(13, 'U');
  putU(14, ' ');
  putU(15, args.codigoOcorrencia.padStart(2, '0'));
  const pago = args.valorPagoCentavos ?? args.valorCentavos;
  putU(17, String(Math.max(0, pago - args.valorCentavos)).padStart(15, '0'));
  putU(77, String(pago).padStart(15, '0'));
  putU(92, String(pago).padStart(15, '0'));
  putU(137, args.dataOcorrencia);
  putU(145, args.dataOcorrencia);
  return `${t}\r\n${u}`;
};

/** Le o par T+U como o arquivo inteiro faz. */
const lerTU = (par: string) => {
  const [t, u] = par.split('\r\n');
  return parseLinhaRetornoSicoob(t, u);
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

test('codigo de ocorrencia 06 (liquidacao) da baixa com valor e data do segmento U; outro codigo so avisa', () => {
  const liquidado = lerTU(linhaSegmentoT({ nossoNumero: '39789', codigoOcorrencia: '06', valorCentavos: 27120, dataOcorrencia: '23112026' }));
  assert.equal(liquidado.liquidado, true);
  assert.equal(liquidado.nossoNumero, '0000039789');
  assert.equal(liquidado.valorPagoCentavos, 27120);
  assert.equal(liquidado.dataOcorrencia, '2026-11-23');
  assert.equal(liquidado.aviso, undefined);

  // Pago com juros (caso real: titulo 281,45, pago 290,78): vale o PAGO, nao o do titulo.
  const comJuros = lerTU(linhaSegmentoT({ nossoNumero: '38938', codigoOcorrencia: '06', valorCentavos: 28145, valorPagoCentavos: 29078, dataOcorrencia: '23112026' }));
  assert.equal(comJuros.valorPagoCentavos, 29078);

  const rejeitado = lerTU(linhaSegmentoT({ nossoNumero: '1201', codigoOcorrencia: '03', valorCentavos: 0, dataOcorrencia: '22092026' }));
  assert.equal(rejeitado.liquidado, false);
  assert.match(String(rejeitado.aviso), /não é liquidação/);
});

test('CNAB240: liquidacao sem o segmento U nao da baixa; data invalida nao passa', () => {
  const semU = parseLinhaRetornoSicoob(linhaSegmentoT({ nossoNumero: '1200', codigoOcorrencia: '06', valorCentavos: 52553, dataOcorrencia: '22092026', semU: true }));
  assert.equal(semU.liquidado, false);
  assert.match(String(semU.aviso), /não trouxe o valor pago/);
  const dataRuim = lerTU(linhaSegmentoT({ nossoNumero: '1200', codigoOcorrencia: '06', valorCentavos: 52553, dataOcorrencia: '00393030' }));
  assert.equal(dataRuim.liquidado, true);
  assert.equal(dataRuim.dataOcorrencia, undefined);
});

test('codigo 17 (liquidacao apos baixa) tambem conta como liquidado', () => {
  const lida = lerTU(linhaSegmentoT({ nossoNumero: '1202', codigoOcorrencia: '17', valorCentavos: 52554, dataOcorrencia: '25092026' }));
  assert.equal(lida.liquidado, true);
});

test('lerArquivoRetornoSicoob separa liquidados, informativos (02) e "para conferir" (09 baixa)', () => {
  const arquivo = [
    linhaSegmentoT({ nossoNumero: '1200', codigoOcorrencia: '06', valorCentavos: 52553, dataOcorrencia: '22092026' }),
    linhaSegmentoT({ nossoNumero: '1201', codigoOcorrencia: '09', valorCentavos: 70175, dataOcorrencia: '23112026' }),
    linhaSegmentoT({ nossoNumero: '1203', codigoOcorrencia: '02', valorCentavos: 1000, dataOcorrencia: '23112026' }),
    linhaSegmentoT({ nossoNumero: '1202', codigoOcorrencia: '17', valorCentavos: 52554, dataOcorrencia: '25092026' }),
  ].join('\r\n');

  const resumo = lerArquivoRetornoSicoob(arquivo);
  assert.equal(resumo.totalLinhas, 8);
  assert.deepEqual(resumo.liquidados.map((l) => [l.nossoNumero, l.valorPagoCentavos, l.dataOcorrencia]), [
    ['0000001200', 52553, '2026-09-22'],
    ['0000001202', 52554, '2026-09-25'],
  ]);
  assert.deepEqual(resumo.informativos.map((l) => l.nossoNumero), ['0000001203']);
  assert.deepEqual(resumo.paraConferir.map((l) => l.nossoNumero), ['0000001201']);
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
  // Retorno real de 03/11/2026: 48 = confirmacao de transferencia de carteira (116 linhas!), 09 = baixa no banco.
  transferenciaCarteira48: "1021792606600010030490000512150000000200001480004208701       00000002087401000000DM 00000000000000000000 01482910260000014801                    041126000000004699075630490010000000000000000000000000000000000000000000000000000000000000000000000000000000000000046990000000000000000000000000000000000000000000000000000010000000000000          1301463500019000000000000000000000000000000000000000000140",
  baixaNoBanco09: "1021792606600010030490000512150000000200042540004189401       00000000318301000000DM 00000000000000000000 01092610260003425201                    280426000000000920075630490010000000000100000000000000000000000000000000000000000000000000000000000000000000000000009200000000000000000000000000000000000000000000000000000010000000000000          2927784600015500000000000000000000000000000000000000000093",
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

test('CNAB400 real: 04 (transferencia de carteira) e 48 (confirmacao da transferencia) vem com valor mas sao so informativos', () => {
  for (const linha of [RETORNO_REAL.ocorrencia04, RETORNO_REAL.transferenciaCarteira48]) {
    const lida = parseLinhaRetornoSicoob(linha);
    assert.equal(lida.liquidado, false);
    assert.equal(lida.informativo, true);
    assert.ok((lida.valorPagoCentavos || 0) > 0);
    assert.equal(lida.aviso, undefined);
  }
  assert.equal(parseLinhaRetornoSicoob(RETORNO_REAL.transferenciaCarteira48).codigoOcorrencia, '48');
});

test('CNAB400 real: 09 (baixa no banco) nao e pagamento: fica em conferir', () => {
  const lida = parseLinhaRetornoSicoob(RETORNO_REAL.baixaNoBanco09);
  assert.equal(lida.liquidado, false);
  assert.equal(lida.informativo, false);
  assert.match(lida.aviso || '', /ocorrência 09/);
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
    RETORNO_REAL.transferenciaCarteira48,
    RETORNO_REAL.baixaNoBanco09,
    RETORNO_REAL.emSer,
    '9'.padEnd(400, ' '),
  ].join('\r\n') + '\r\n';
  const resumo = lerArquivoRetornoSicoob(arquivo);
  assert.equal(resumo.liquidados.length, 1);
  assert.equal(resumo.informativos.length, 4);
  assert.equal(resumo.paraConferir.length, 1);
  assert.equal(resumo.paraConferir[0].codigoOcorrencia, '09');
});

// --- filtro "Faturados" ------------------------------------------------

test('filtro Faturados: hoje, ultimos N dias (contando hoje), periodo e titulo antigo sem data', () => {
  const hoje = '2026-10-01';
  assert.equal(faturadoNoPeriodo('2026-10-01', 'hoje', {}, hoje), true);
  assert.equal(faturadoNoPeriodo('2026-09-30', 'hoje', {}, hoje), false);
  assert.equal(faturadoNoPeriodo('2026-09-29', '3dias', {}, hoje), true);
  assert.equal(faturadoNoPeriodo('2026-09-28', '3dias', {}, hoje), false);
  assert.equal(faturadoNoPeriodo('2026-09-25', '7dias', {}, hoje), true);
  assert.equal(faturadoNoPeriodo('2026-09-15', 'periodo', { de: '2026-09-10', ate: '2026-09-20' }, hoje), true);
  assert.equal(faturadoNoPeriodo('2026-09-21', 'periodo', { de: '2026-09-10', ate: '2026-09-20' }, hoje), false);
  assert.equal(faturadoNoPeriodo('', '30dias', {}, hoje), false);
  assert.equal(faturadoNoPeriodo('', 'todos', {}, hoje), true);
});

// Boleto emitido na hora, na tela da venda (24/11/2026).
test('separarTitulosDeBoletoDoDocumento: so boleto a receber em aberto, na ordem do vencimento', () => {
  const titulos = [
    { id: 'c', tipo: 'entrada', formaPagamento: 'Boleto', status: 'Pendente', dataVencimento: '2026-12-24', paymentIndex: 1 },
    { id: 'a', tipo: 'entrada', formaPagamento: 'Boleto', status: 'Pendente', dataVencimento: '2026-11-24', paymentIndex: 0 },
    { id: 'pix', tipo: 'entrada', formaPagamento: 'Pix', status: 'Paga', dataVencimento: '2026-11-24' },
    { id: 'pago', tipo: 'entrada', formaPagamento: 'Boleto', status: 'Paga', dataVencimento: '2026-11-20' },
    { id: 'cancelado', tipo: 'entrada', formaPagamento: 'Boleto', status: 'Cancelada', dataVencimento: '2026-11-20' },
    { id: 'saida', tipo: 'saida', formaPagamento: 'Boleto', status: 'Pendente', dataVencimento: '2026-11-20' },
    { id: 'b', tipo: 'entrada', formaPagamento: 'Boleto', status: 'Pendente', dataPrevistaRecebimento: '2026-12-01', boleto: { nossoNumero: '1203' } },
  ];
  const { paraEmitir, jaEmitidos } = separarTitulosDeBoletoDoDocumento(titulos);
  assert.deepEqual(paraEmitir.map((t) => t.id), ['a', 'c']);
  assert.deepEqual(jaEmitidos.map((t) => t.id), ['b']);
  assert.deepEqual(separarTitulosDeBoletoDoDocumento([]), { paraEmitir: [], jaEmitidos: [] });
});

test('resumoDaEmissaoNaHora: diz quantos sairam', () => {
  assert.equal(resumoDaEmissaoNaHora(1, 1), 'Boleto emitido.');
  assert.equal(resumoDaEmissaoNaHora(3, 3), '3 boletos emitidos.');
  assert.equal(resumoDaEmissaoNaHora(2, 3), '2 de 3 boletos emitidos.');
  assert.equal(resumoDaEmissaoNaHora(0, 1), 'O boleto não foi emitido.');
  assert.equal(resumoDaEmissaoNaHora(0, 2), 'Nenhum boleto foi emitido.');
  assert.equal(resumoDaEmissaoNaHora(0, 0), 'Os boletos desta venda já estavam emitidos.');
});
