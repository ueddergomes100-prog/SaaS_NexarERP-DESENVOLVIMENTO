import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CATEGORIA_DESPESA_ROTA,
  TIPOS_DESPESA_ROTA,
  avisosDaRota,
  descricaoDaDespesaNoFinanceiro,
  despesaVazia,
  despesasValidas,
  errosDaRota,
  rotuloDoTipoDespesa,
  totaisPorTipo,
  totalDaRota,
  totalDaRotaCentavos,
  type DespesaRota,
  type RotaRascunho,
} from '../src/utils/rotaDomain';

const despesa = (extra: Partial<DespesaRota> = {}): DespesaRota => ({
  tipo: 'combustivel', descricao: '', valor: 100, comprovante: '123', ...extra,
});

const rota = (extra: Partial<RotaRascunho> = {}): RotaRascunho => ({
  motoristaId: 'm1',
  motoristaNome: 'JOAO',
  veiculo: 'ABC-1234 / CAMINHAO BAU',
  data: '2026-09-21',
  observacao: '',
  despesas: [despesa()],
  ...extra,
});

test('todo tipo de despesa tem rotulo em portugues', () => {
  for (const t of TIPOS_DESPESA_ROTA) {
    assert.ok(t.label.length > 3, t.value);
    assert.equal(rotuloDoTipoDespesa(t.value), t.label);
  }
  // Tipo desconhecido volta como veio, em vez de sumir da tela.
  assert.equal(rotuloDoTipoDespesa('xyz'), 'xyz');
});

test('os tipos que o dono citou existem', () => {
  const valores = TIPOS_DESPESA_ROTA.map((t) => t.value);
  for (const esperado of ['combustivel', 'pedagio', 'alimentacao', 'hospedagem']) {
    assert.ok(valores.includes(esperado as never), esperado);
  }
});

test('total soma em centavos, sem erro de float', () => {
  const despesas = [despesa({ valor: 0.1 }), despesa({ valor: 0.2 })];
  assert.equal(totalDaRotaCentavos(despesas), 30);
  assert.equal(totalDaRota(despesas), 0.3);
});

test('total de uma rota real', () => {
  const despesas = [
    despesa({ tipo: 'combustivel', valor: 320.5 }),
    despesa({ tipo: 'alimentacao', valor: 45 }),
    despesa({ tipo: 'pedagio', valor: 28.7 }),
    despesa({ tipo: 'hospedagem', valor: 120 }),
  ];
  assert.equal(totalDaRotaCentavos(despesas), 51420);
  assert.equal(totalDaRota(despesas), 514.2);
});

test('rota sem despesa tem total zero, nao quebra', () => {
  assert.equal(totalDaRotaCentavos([]), 0);
  assert.equal(totalDaRota([]), 0);
});

test('totais por tipo agrupam e ignoram linha zerada', () => {
  const despesas = [
    despesa({ tipo: 'combustivel', valor: 100 }),
    despesa({ tipo: 'combustivel', valor: 50 }),
    despesa({ tipo: 'pedagio', valor: 20 }),
    despesa({ tipo: 'alimentacao', valor: 0 }),
  ];
  const totais = totaisPorTipo(despesas);
  assert.deepEqual(totais.map((t) => [t.tipo, t.totalCentavos]), [['combustivel', 15000], ['pedagio', 2000]]);
});

test('linha em branco deixada na tela nao vira despesa', () => {
  const despesas = [despesa({ valor: 100 }), despesaVazia(), despesa({ valor: 0 })];
  assert.equal(despesasValidas(despesas).length, 1);
});

test('rota completa nao tem erro', () => {
  assert.deepEqual(errosDaRota(rota()), []);
});

test('rota sem motorista, sem data ou sem despesa e recusada', () => {
  assert.match(errosDaRota(rota({ motoristaId: '' })).join(' '), /motorista/i);
  assert.match(errosDaRota(rota({ data: '' })).join(' '), /data/i);
  assert.match(errosDaRota(rota({ despesas: [] })).join(' '), /pelo menos uma despesa/i);
  assert.match(errosDaRota(rota({ despesas: [despesaVazia()] })).join(' '), /pelo menos uma despesa/i);
});

test('todos os erros aparecem de uma vez, nao um por tentativa', () => {
  const erros = errosDaRota(rota({ motoristaId: '', data: '', despesas: [] }));
  assert.equal(erros.length, 3);
});

test('valor negativo e recusado', () => {
  assert.match(errosDaRota(rota({ despesas: [despesa(), despesa({ valor: -10 })] })).join(' '), /negativo/i);
});

test('"Outros" sem descricao e recusado: ninguem sabe o que foi', () => {
  assert.match(errosDaRota(rota({ despesas: [despesa({ tipo: 'outros', descricao: '' })] })).join(' '), /Outros/);
  assert.deepEqual(errosDaRota(rota({ despesas: [despesa({ tipo: 'outros', descricao: 'LAVAGEM' })] })), []);
});

test('despesa sem comprovante AVISA mas nao trava', () => {
  const r = rota({ despesas: [despesa({ comprovante: '' })] });
  assert.deepEqual(errosDaRota(r), []);
  assert.match(avisosDaRota(r).join(' '), /comprovante/i);
});

test('o aviso de comprovante conta quantas despesas estao sem', () => {
  const r = rota({ despesas: [despesa({ comprovante: '' }), despesa({ comprovante: '' }), despesa()] });
  assert.match(avisosDaRota(r).join(' '), /2 despesas/);
});

test('rota sem veiculo avisa, mas salva', () => {
  const r = rota({ veiculo: '' });
  assert.deepEqual(errosDaRota(r), []);
  assert.match(avisosDaRota(r).join(' '), /veículo/i);
});

test('rota completa nao gera aviso nenhum', () => {
  assert.deepEqual(avisosDaRota(rota()), []);
});

test('descricao no financeiro identifica tipo, motorista e dia', () => {
  const d = descricaoDaDespesaNoFinanceiro(despesa({ tipo: 'combustivel' }), 'JOAO', '2026-09-21');
  assert.match(d, /COMBUSTÍVEL/);
  assert.match(d, /ROTA/);
  assert.match(d, /JOAO/);
  assert.match(d, /21\/09\/2026/);
});

test('descricao livre entra entre parenteses quando existe', () => {
  const com = descricaoDaDespesaNoFinanceiro(despesa({ tipo: 'outros', descricao: 'lavagem' }), 'JOAO', '2026-09-21');
  assert.match(com, /\(lavagem\)/);
  const sem = descricaoDaDespesaNoFinanceiro(despesa({ tipo: 'pedagio' }), 'JOAO', '2026-09-21');
  assert.ok(!sem.includes('()'));
});

test('a categoria financeira e a mesma para todas as despesas de rota', () => {
  assert.equal(CATEGORIA_DESPESA_ROTA, 'DESPESAS DE ROTA');
});
