import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PARAMETROS_VENDA_PADRAO, type ParametrosVenda } from '../src/utils/parametrosVendaDomain';
import {
  acrescimoDoTitulo,
  campoDoPercentual,
  lerPercentuaisDaTela,
  mesmosPercentuais,
  parametrosComPercentuaisDaTela,
  somaDosAcrescimos,
  textoDosPercentuais,
} from '../src/utils/atrasoReceberDomain';

const config: ParametrosVenda = { ...PARAMETROS_VENDA_PADRAO, juros: { aoMesPercentual: 9.9, multaPercentual: 2 } };

test('titulo vencido: juros pro rata ao dia (mes de 30) + multa, com as % da configuracao', () => {
  const a = acrescimoDoTitulo(config, { status: 'Pendente', valorCentavos: 10000, dataVencimento: '2026-11-14' }, '2026-11-24');
  assert.ok(a);
  assert.equal(a.diasAtraso, 10);
  assert.equal(a.multaCentavos, 200);
  assert.equal(a.jurosCentavos, 330, '100 x 9,9% x 10/30');
  assert.equal(a.totalCentavos, 530);
});

test('em dia, recebido ou sem % configurada: nada a somar', () => {
  assert.equal(acrescimoDoTitulo(config, { status: 'Pendente', valorCentavos: 10000, dataVencimento: '2026-11-24' }, '2026-11-24'), null);
  assert.equal(acrescimoDoTitulo(config, { status: 'Paga', valorCentavos: 10000, dataVencimento: '2026-11-01' }, '2026-11-24'), null);
  assert.equal(acrescimoDoTitulo(PARAMETROS_VENDA_PADRAO, { status: 'Pendente', valorCentavos: 10000, dataVencimento: '2026-11-01' }, '2026-11-24'), null);
});

test('% da tela valem so na consulta (a configuracao nao muda)', () => {
  const daTela = parametrosComPercentuaisDaTela(config, { aoMesPercentual: 0, multaPercentual: 5 });
  const a = acrescimoDoTitulo(daTela, { status: 'Pendente', valorCentavos: 10000, dataVencimento: '2026-11-14' }, '2026-11-24');
  assert.equal(a?.totalCentavos, 500);
  assert.deepEqual(config.juros, { aoMesPercentual: 9.9, multaPercentual: 2 }, 'objeto da configuracao intacto');
  assert.equal(parametrosComPercentuaisDaTela(config, null), config);
});

test('soma dos acrescimos e textos', () => {
  assert.equal(somaDosAcrescimos([{ diasAtraso: 1, multaCentavos: 1, jurosCentavos: 2, totalCentavos: 3 }, null]), 3);
  assert.equal(textoDosPercentuais({ aoMesPercentual: 9.9, multaPercentual: 2 }), 'juros de 9,9% ao mês e multa de 2%');
  assert.equal(textoDosPercentuais({ aoMesPercentual: 0, multaPercentual: 2 }), 'multa de 2%');
  assert.equal(campoDoPercentual(9.9), '9,9');
  assert.equal(campoDoPercentual(0), '');
  assert.equal(mesmosPercentuais({ aoMesPercentual: 1, multaPercentual: 2 }, { aoMesPercentual: 1, multaPercentual: 2 }), true);
});

test('% digitadas na tela: virgula, vazio = 0, fora de 0 a 100 recusa em portugues', () => {
  assert.deepEqual(lerPercentuaisDaTela('9,90', '2'), { percentuais: { aoMesPercentual: 9.9, multaPercentual: 2 } });
  assert.deepEqual(lerPercentuaisDaTela('', ''), { percentuais: { aoMesPercentual: 0, multaPercentual: 0 } });
  assert.match((lerPercentuaisDaTela('abc', '2') as { erro: string }).erro, /juros ao mês/);
  assert.match((lerPercentuaisDaTela('1', '150') as { erro: string }).erro, /multa/);
});
