import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  abaDaSituacao,
  passaNaAbaGeral,
  percentualQuitado,
  periodoDosRecebidos,
  periodoRecebidosAtivo,
  totaisDoCliente,
} from '../src/utils/contasReceberAbasDomain';

test('abas do Contas a Receber (28/11/2026): vencidas no Em aberto, pagas e todas no Geral', () => {
  assert.equal(abaDaSituacao('abertas'), 'abertos');
  assert.equal(abaDaSituacao('vencidas'), 'abertos');
  assert.equal(abaDaSituacao('todas'), 'geral');
  assert.equal(abaDaSituacao('pagas'), 'geral');
});

test('periodos dos recebidos: este mes, mes passado (virada de ano) e 90 dias', () => {
  assert.deepEqual(periodoDosRecebidos('mes', '2026-11-28'), { de: '2026-11-01', ate: '2026-11-28' });
  assert.deepEqual(periodoDosRecebidos('mesPassado', '2026-11-28'), { de: '2026-10-01', ate: '2026-10-31' });
  assert.deepEqual(periodoDosRecebidos('mesPassado', '2027-01-10'), { de: '2026-12-01', ate: '2026-12-31' });
  assert.deepEqual(periodoDosRecebidos('90dias', '2026-11-28'), { de: '2026-08-31', ate: '2026-11-28' });
  assert.equal(periodoRecebidosAtivo('', '', '2026-11-28'), 'mes');
  assert.equal(periodoRecebidosAtivo('2026-10-01', '2026-10-31', '2026-11-28'), 'mesPassado');
  assert.equal(periodoRecebidosAtivo('2026-10-05', '2026-10-31', '2026-11-28'), null);
});

test('aba Geral: todo em aberto aparece; recebido so do periodo, pela data em que foi recebido', () => {
  assert.equal(passaNaAbaGeral({ status: 'Pendente', data: '2025-01-10' }, '2026-11-01', '2026-11-28'), true);
  assert.equal(passaNaAbaGeral({ status: 'Paga', data: '2026-09-10', dataPagamento: '2026-11-05' }, '2026-11-01', '2026-11-28'), true);
  assert.equal(passaNaAbaGeral({ status: 'Paga', data: '2026-11-10', dataPagamento: '2026-10-05' }, '2026-11-01', '2026-11-28'), false);
  assert.equal(passaNaAbaGeral({ status: 'Cancelada', data: '2026-11-10' }, '', ''), false);
});

test('totais do cliente: em aberto, recebido (menos o desconto da baixa) e quanto ja foi quitado', () => {
  const t = totaisDoCliente([
    { status: 'Pendente', liquidoCentavos: 30000 },
    { status: 'Paga', liquidoCentavos: 50000, descontoCentavos: 5000 },
    { status: 'Paga', liquidoCentavos: 25000 },
    { status: 'Cancelada', liquidoCentavos: 99900 },
  ]);
  assert.deepEqual(t, { emAbertoCentavos: 30000, recebidoCentavos: 70000 });
  assert.equal(percentualQuitado(t), 70);
  assert.equal(percentualQuitado({ emAbertoCentavos: 0, recebidoCentavos: 0 }), 0);
});

test('busca do Contas a Receber (28/11/2026): pelo nome ou pelo codigo do cliente', async () => {
  const { clienteCasaComBusca } = await import('../src/utils/contasReceberAbasDomain');
  assert.equal(clienteCasaComBusca('JOÃO DA SILVA', '0457', '457'), true, 'sem ligar para zero a esquerda');
  assert.equal(clienteCasaComBusca('JOÃO DA SILVA', '457', '0457'), true);
  assert.equal(clienteCasaComBusca('JOÃO DA SILVA', '0457', '#457'), true, '# na frente');
  assert.equal(clienteCasaComBusca('JOÃO DA SILVA', '2913', '29'), true, 'comeco do codigo');
  assert.equal(clienteCasaComBusca('JOÃO DA SILVA', '2913', '13'), false, 'meio do codigo nao');
  assert.equal(clienteCasaComBusca('JOÃO DA SILVA', '', 'joao'), true, 'nome sem acento');
  assert.equal(clienteCasaComBusca('MERCADO 13 DE MAIO', '2913', '13'), true, 'numero no nome continua achando');
  assert.equal(clienteCasaComBusca('PADARIA', 'C-10', 'c-1'), true, 'codigo com letra');
  assert.equal(clienteCasaComBusca('PADARIA', '', '457'), false);
  assert.equal(clienteCasaComBusca('PADARIA', '0457', '   '), true);
});
