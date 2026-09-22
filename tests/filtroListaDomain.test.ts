import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ROTULO_ATALHO_VENCIMENTO,
  dataISODoRegistro,
  intervaloDoAtalhoVencimento,
  dentroDoPeriodo,
  passaNaSituacaoTitulo,
  passaNoPeriodoDoTitulo,
  tituloVencido,
} from '../src/utils/filtroListaDomain';

test('data do registro: texto ISO, dd/mm/aaaa, Timestamp e Date viram AAAA-MM-DD', () => {
  assert.equal(dataISODoRegistro('2026-09-19'), '2026-09-19');
  assert.equal(dataISODoRegistro('2026-09-19T10:00:00'), '2026-09-19');
  assert.equal(dataISODoRegistro('19/09/2026'), '2026-09-19');
  assert.equal(dataISODoRegistro({ toDate: () => new Date('2026-09-19T15:00:00Z') }), '2026-09-19');
  assert.equal(dataISODoRegistro({ seconds: Date.UTC(2026, 8, 19, 15) / 1000 }), '2026-09-19');
  assert.equal(dataISODoRegistro(new Date('2026-09-19T15:00:00Z')), '2026-09-19');
});

test('data com fuso vira o dia de Sao Paulo, nao o de UTC', () => {
  // 02:00Z de 20/09 ainda e' 23:00 de 19/09 em Sao Paulo.
  assert.equal(dataISODoRegistro('2026-09-20T02:00:00Z'), '2026-09-19');
});

test('valor que nao e data devolve vazio', () => {
  assert.equal(dataISODoRegistro(undefined), '');
  assert.equal(dataISODoRegistro(null), '');
  assert.equal(dataISODoRegistro(''), '');
  assert.equal(dataISODoRegistro('amanha'), '');
  assert.equal(dataISODoRegistro(new Date('lixo')), '');
});

test('periodo: limites inclusivos, vazio = sem limite', () => {
  assert.equal(dentroDoPeriodo('2026-09-10', '2026-09-10', '2026-09-20'), true);
  assert.equal(dentroDoPeriodo('2026-09-20', '2026-09-10', '2026-09-20'), true);
  assert.equal(dentroDoPeriodo('2026-09-09', '2026-09-10', '2026-09-20'), false);
  assert.equal(dentroDoPeriodo('2026-09-21', '2026-09-10', '2026-09-20'), false);
  assert.equal(dentroDoPeriodo('2026-01-01', '', '2026-09-20'), true);
  assert.equal(dentroDoPeriodo('2027-01-01', '2026-09-10', ''), true);
});

test('sem filtro de periodo tudo passa; com filtro, registro sem data fica de fora', () => {
  assert.equal(dentroDoPeriodo(undefined, '', ''), true);
  assert.equal(dentroDoPeriodo(undefined, '2026-09-01', ''), false);
});

test('situacao de titulo: aberta inclui a vencida; vencida so a atrasada; paga so a baixada', () => {
  const hoje = '2026-09-19';
  const emDia = { status: 'Pendente', data: '2026-09-25' };
  const atrasado = { status: 'Pendente', data: '2026-09-01' };
  const venceHoje = { status: 'Pendente', data: '2026-09-19' };
  const pago = { status: 'Paga', data: '2026-08-01', dataPagamento: '2026-08-05' };
  const cancelado = { status: 'Cancelada', data: '2026-08-01' };

  assert.equal(passaNaSituacaoTitulo(emDia, hoje, 'abertas'), true);
  assert.equal(passaNaSituacaoTitulo(atrasado, hoje, 'abertas'), true);
  assert.equal(passaNaSituacaoTitulo(pago, hoje, 'abertas'), false);

  assert.equal(passaNaSituacaoTitulo(atrasado, hoje, 'vencidas'), true);
  // vence hoje ainda nao esta vencido
  assert.equal(passaNaSituacaoTitulo(venceHoje, hoje, 'vencidas'), false);
  assert.equal(passaNaSituacaoTitulo(emDia, hoje, 'vencidas'), false);
  // paga nunca e' vencida, mesmo com vencimento no passado
  assert.equal(passaNaSituacaoTitulo(pago, hoje, 'vencidas'), false);

  assert.equal(passaNaSituacaoTitulo(pago, hoje, 'pagas'), true);
  assert.equal(passaNaSituacaoTitulo(emDia, hoje, 'pagas'), false);

  assert.equal(passaNaSituacaoTitulo(emDia, hoje, 'todas'), true);
  assert.equal(passaNaSituacaoTitulo(pago, hoje, 'todas'), true);
  assert.equal(passaNaSituacaoTitulo(cancelado, hoje, 'todas'), false);
  assert.equal(tituloVencido(cancelado, hoje), false);
});

test('periodo do titulo: vencimento nas abertas, data do pagamento nas pagas', () => {
  const pago = { status: 'Paga', data: '2026-07-10', dataPagamento: '2026-08-05' };
  assert.equal(passaNoPeriodoDoTitulo(pago, 'pagas', '2026-08-01', '2026-08-31'), true);
  assert.equal(passaNoPeriodoDoTitulo(pago, 'pagas', '2026-07-01', '2026-07-31'), false);
  // "todas" segue o vencimento
  assert.equal(passaNoPeriodoDoTitulo(pago, 'todas', '2026-07-01', '2026-07-31'), true);
  // paga sem data de pagamento cai no vencimento
  assert.equal(passaNoPeriodoDoTitulo({ status: 'Paga', data: '2026-07-10' }, 'pagas', '2026-07-01', '2026-07-31'), true);
});

test('atalho "hoje" pega so o proprio dia', () => {
  assert.deepEqual(intervaloDoAtalhoVencimento('hoje', '2026-09-21'), { de: '2026-09-21', ate: '2026-09-21' });
});

test('atalho "semana" vai de segunda a domingo do calendario', () => {
  // 2026-09-21 e' uma segunda-feira.
  assert.deepEqual(intervaloDoAtalhoVencimento('semana', '2026-09-21'), { de: '2026-09-21', ate: '2026-09-27' });
  // Quinta da mesma semana devolve o mesmo intervalo.
  assert.deepEqual(intervaloDoAtalhoVencimento('semana', '2026-09-24'), { de: '2026-09-21', ate: '2026-09-27' });
  // Domingo ainda pertence a semana que comecou na segunda anterior.
  assert.deepEqual(intervaloDoAtalhoVencimento('semana', '2026-09-27'), { de: '2026-09-21', ate: '2026-09-27' });
  // Segunda seguinte ja e' outra semana.
  assert.deepEqual(intervaloDoAtalhoVencimento('semana', '2026-09-28'), { de: '2026-09-28', ate: '2026-10-04' });
});

test('atalho "semana" atravessa a virada de mes e de ano', () => {
  assert.deepEqual(intervaloDoAtalhoVencimento('semana', '2026-12-31'), { de: '2026-12-28', ate: '2027-01-03' });
});

test('atalho "mes" vai do dia 1 ao ultimo, inclusive em fevereiro', () => {
  assert.deepEqual(intervaloDoAtalhoVencimento('mes', '2026-09-21'), { de: '2026-09-01', ate: '2026-09-30' });
  assert.deepEqual(intervaloDoAtalhoVencimento('mes', '2026-02-10'), { de: '2026-02-01', ate: '2026-02-28' });
  // 2028 e' bissexto.
  assert.deepEqual(intervaloDoAtalhoVencimento('mes', '2028-02-10'), { de: '2028-02-01', ate: '2028-02-29' });
  assert.deepEqual(intervaloDoAtalhoVencimento('mes', '2026-01-31'), { de: '2026-01-01', ate: '2026-01-31' });
});

test('"todos" e "personalizado" nao limitam nada por conta propria', () => {
  assert.deepEqual(intervaloDoAtalhoVencimento('todos', '2026-09-21'), { de: '', ate: '' });
  assert.deepEqual(intervaloDoAtalhoVencimento('personalizado', '2026-09-21'), { de: '', ate: '' });
});

test('o intervalo do atalho funciona com passaNoPeriodoDoTitulo', () => {
  const hoje = '2026-09-21';
  const { de, ate } = intervaloDoAtalhoVencimento('hoje', hoje);
  const venceHoje = { status: 'Pendente', data: '2026-09-21' };
  const venceAmanha = { status: 'Pendente', data: '2026-09-22' };
  assert.equal(passaNoPeriodoDoTitulo(venceHoje, 'abertas', de, ate), true);
  assert.equal(passaNoPeriodoDoTitulo(venceAmanha, 'abertas', de, ate), false);
});

test('todo atalho tem rotulo escrito em portugues', () => {
  for (const atalho of ['hoje', 'semana', 'mes', 'todos', 'personalizado'] as const) {
    assert.ok(ROTULO_ATALHO_VENCIMENTO[atalho].length > 3, atalho);
  }
});
