import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  conferirParcelas,
  diasAteVencer,
  dividirEmParcelas,
  erroDoPagamentoAVista,
  parcelasIniciais,
} from '../src/utils/pagamentoEntradaDomain';

test('parcelas iniciais: usa as duplicatas do XML; sem duplicata, uma parcela em 30 dias', () => {
  const doXml = parcelasIniciais([
    { numero: '001', vencimento: '2026-10-10', valor: 40 },
    { numero: '002', vencimento: '2026-11-10', valor: 39.69 },
  ], '2026-09-10', 79.69);
  assert.deepEqual(doXml, [
    { numero: '001', vencimento: '2026-10-10', valor: 40 },
    { numero: '002', vencimento: '2026-11-10', valor: 39.69 },
  ]);
  assert.deepEqual(parcelasIniciais([], '2026-09-10', 100), [{ numero: '1', vencimento: '2026-10-10', valor: 100 }]);
  // duplicata sem data usa a emissao (mesmo que a leitura antiga)
  assert.equal(parcelasIniciais([{ numero: '1', vencimento: '', valor: 10 }], '2026-09-10', 10)[0].vencimento, '2026-09-10');
});

test('dividir em N vezes: centavo que sobra vai para as primeiras e a soma fecha', () => {
  const parcelas = dividirEmParcelas(100, 3, '2026-10-10', 30);
  assert.deepEqual(parcelas.map((p) => p.valor), [33.34, 33.33, 33.33]);
  assert.deepEqual(parcelas.map((p) => p.vencimento), ['2026-10-10', '2026-11-09', '2026-12-09']);
  assert.equal(parcelas.reduce((soma, p) => Math.round((soma + p.valor) * 100) / 100, 0), 100);
  assert.equal(dividirEmParcelas(50, 0, '2026-10-10').length, 1);
  assert.equal(dividirEmParcelas(50, 999, '2026-10-10').length, 60);
});

test('conferência de parcelas: fecha, sobra/falta é aviso, data ou valor inválido é erro', () => {
  const total = 79.69;
  const boas = [{ numero: '1', vencimento: '2026-10-10', valor: 40 }, { numero: '2', vencimento: '2026-11-10', valor: 39.69 }];
  assert.deepEqual(conferirParcelas(boas, total), { soma: 79.69, diferenca: 0, ok: true, erro: null, aviso: null });

  const sobra = conferirParcelas([{ numero: '1', vencimento: '2026-10-10', valor: 80 }], total);
  assert.equal(sobra.ok, false);
  assert.equal(sobra.erro, null);
  assert.match(String(sobra.aviso), /sobram R\$ 0,31/);
  assert.match(String(conferirParcelas([{ numero: '1', vencimento: '2026-10-10', valor: 70 }], total).aviso), /faltam R\$ 9,69/);

  assert.match(String(conferirParcelas([], total).erro), /ao menos uma parcela/);
  assert.match(String(conferirParcelas([{ numero: '1', vencimento: '', valor: 79.69 }], total).erro), /parcela 1.*data/);
  assert.match(String(conferirParcelas([{ numero: '1', vencimento: '2026-10-10', valor: 0 }], total).erro), /maior que zero/);
});

test('dias até vencer e pagamento à vista sem banco', () => {
  assert.equal(diasAteVencer('2026-09-10', '2026-10-10'), 30);
  assert.equal(diasAteVencer('2026-09-10', ''), null);
  assert.match(String(erroDoPagamentoAVista({ destino: 'banco', bancoId: '' })), /Escolha de qual banco/);
  assert.equal(erroDoPagamentoAVista({ destino: 'banco', bancoId: 'b1' }), null);
  assert.equal(erroDoPagamentoAVista({ destino: 'caixa', bancoId: '' }), null);
});
