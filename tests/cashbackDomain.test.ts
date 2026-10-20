import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cashbackDaVenda,
  faixaAlcancada,
  formatarCashback,
  lerConfigCashback,
  lerFaixas,
  parseConfigCashback,
  pontosParaProximaFaixa,
  saldoDosMovimentos,
  validadeDoCashback,
  type ConfigCashback,
} from '../src/utils/cashbackDomain';

const reais: ConfigCashback = { ativo: true, modelo: 'reais', tipoPadrao: 'percentual', valorPadrao: 5, validadeDias: 90, pontosPorReal: 1, faixas: [] };
const pontos: ConfigCashback = { ...reais, modelo: 'pontos', pontosPorReal: 2, faixas: [{ pontos: 100, descontoPercentual: 5 }, { pontos: 300, descontoPercentual: 15 }] };

test('parseConfigCashback: ausente = desligado; limpa os valores', () => {
  assert.deepEqual(parseConfigCashback(undefined).ativo, false);
  const c = parseConfigCashback({ ativo: true, modelo: 'pontos', tipoPadrao: 'x', valorPadrao: '2,5', validadeDias: '30', pontosPorReal: '1', faixas: [{ pontos: '100', descontoPercentual: '5' }] });
  assert.equal(c.modelo, 'pontos');
  assert.equal(c.tipoPadrao, 'percentual');
  assert.equal(c.valorPadrao, 2.5);
  assert.equal(c.validadeDias, 30);
  assert.deepEqual(c.faixas, [{ pontos: 100, descontoPercentual: 5 }]);
  assert.equal(parseConfigCashback({ validadeDias: 0 }).validadeDias, null);
});

test('lerFaixas: ordena, recusa repetida e desconto que nao cresce', () => {
  assert.deepEqual(lerFaixas([{ pontos: 300, descontoPercentual: 15 }, { pontos: 100, descontoPercentual: 5 }]).faixas, [{ pontos: 100, descontoPercentual: 5 }, { pontos: 300, descontoPercentual: 15 }]);
  assert.match(lerFaixas([{ pontos: 100, descontoPercentual: 5 }, { pontos: 100, descontoPercentual: 7 }]).erro ?? '', /duas faixas com 100 pontos/);
  assert.match(lerFaixas([{ pontos: 100, descontoPercentual: 10 }, { pontos: 200, descontoPercentual: 5 }]).erro ?? '', /Mais pontos, mais desconto/);
  assert.match(lerFaixas([{ pontos: 0, descontoPercentual: 5 }]).erro ?? '', /maior que zero/);
  assert.match(lerFaixas([{ pontos: 10, descontoPercentual: 120 }]).erro ?? '', /entre 0,01% e 100%/);
  assert.deepEqual(lerFaixas([{ pontos: '', descontoPercentual: '' }]).faixas, []);
});

test('lerConfigCashback: regras de cada modelo em portugues', () => {
  assert.equal(lerConfigCashback({ ativo: false }).ok, true);
  const semPadrao = lerConfigCashback({ ativo: true, modelo: 'reais', valorPadrao: 0 });
  assert.equal(semPadrao.ok, false);
  if (!semPadrao.ok) assert.match(semPadrao.erro, /cashback padrão/);
  const acima = lerConfigCashback({ ativo: true, modelo: 'reais', tipoPadrao: 'percentual', valorPadrao: 150 });
  assert.equal(acima.ok, false);
  const semFaixa = lerConfigCashback({ ativo: true, modelo: 'pontos', pontosPorReal: 1, faixas: [] });
  assert.equal(semFaixa.ok, false);
  if (!semFaixa.ok) assert.match(semFaixa.erro, /pelo menos uma faixa/);
  const ok = lerConfigCashback({ ativo: true, modelo: 'pontos', pontosPorReal: 1, faixas: [{ pontos: 100, descontoPercentual: 5 }] });
  assert.equal(ok.ok, true);
});

test('cashbackDaVenda em R$: so produto com "Permitir cashback"; proprio vence o padrao; desconto geral reduz', () => {
  const itens = [
    { produtoId: 'a', nome: 'A', quantidade: 2, totalCentavos: 10000, produto: { permitirCashback: true } },
    { produtoId: 'b', nome: 'B', quantidade: 3, totalCentavos: 9000, produto: { permitirCashback: true, cashbackTipo: 'valor', cashbackValor: 1.5 } },
    { produtoId: 'c', nome: 'C', quantidade: 1, totalCentavos: 5000, produto: { permitirCashback: false } },
    { produtoId: 'd', nome: 'D', quantidade: 1, totalCentavos: 5000, produto: null },
  ];
  const r = cashbackDaVenda(reais, itens);
  assert.equal(r.modelo, 'reais');
  assert.deepEqual(r.porItem.map((i) => [i.produtoId, i.centavos]), [['a', 500], ['b', 450]]);
  assert.equal(r.centavos, 950);
  // Venda com 10% de desconto geral: tudo cai 10%.
  const comDesconto = cashbackDaVenda(reais, itens, 0.9);
  assert.deepEqual(comDesconto.porItem.map((i) => i.centavos), [450, 405]);
  assert.equal(cashbackDaVenda({ ...reais, ativo: false }, itens).centavos, 0);
});

test('cashbackDaVenda em pontos: pontos por real, arredondando para baixo', () => {
  const r = cashbackDaVenda(pontos, [
    { produtoId: 'a', nome: 'A', quantidade: 1, totalCentavos: 12550, produto: { permitirCashback: true } },
    { produtoId: 'c', nome: 'C', quantidade: 1, totalCentavos: 5000, produto: { permitirCashback: false } },
  ]);
  assert.equal(r.pontos, 251);
  assert.equal(r.centavos, 0);
});

test('lotes: vigencia, resumo com divida, lote novo abatendo divida, abater e proporcional', async () => {
  const { loteVigente, resumoDosLotes, novoLoteComDivida, abaterDoLote, parteProporcional } = await import('../src/utils/cashbackDomain');
  const lote = (extra = {}) => ({ centavos: 1000, pontos: 0, restanteCentavos: 1000, restantePontos: 0, validade: '2026-12-31', ...extra });
  assert.equal(loteVigente(lote(), '2026-10-20'), true);
  assert.equal(loteVigente(lote({ validade: '2026-10-19' }), '2026-10-20'), false);
  assert.equal(loteVigente(lote({ validade: null, restanteCentavos: 0 }), '2026-10-20'), false);
  assert.equal(loteVigente(lote({ estornado: true }), '2026-10-20'), false);
  const resumo = resumoDosLotes([lote(), lote({ validade: '2026-11-01', restanteCentavos: 250 }), lote({ validade: '2026-01-01' })], '2026-10-20', { centavos: 300, pontos: 0 });
  assert.deepEqual(resumo, { saldoCentavos: 950, saldoPontos: 0, dividaCentavos: 300, dividaPontos: 0, proximoVencimento: '2026-11-01' });
  assert.deepEqual(novoLoteComDivida({ centavos: 500, pontos: 0 }, { centavos: 300, pontos: 0 }), { restanteCentavos: 200, restantePontos: 0, divida: { centavos: 0, pontos: 0 } });
  assert.deepEqual(novoLoteComDivida({ centavos: 100, pontos: 0 }, { centavos: 300, pontos: 0 }), { restanteCentavos: 0, restantePontos: 0, divida: { centavos: 200, pontos: 0 } });
  assert.deepEqual(abaterDoLote(lote({ restanteCentavos: 400 }), 1000, 0), { restanteCentavos: 0, restantePontos: 0, dividaExtra: { centavos: 600, pontos: 0 } });
  assert.deepEqual(parteProporcional({ centavos: 1000, pontos: 50 }, 2500, 10000), { centavos: 250, pontos: 13 });
  assert.deepEqual(parteProporcional({ centavos: 1000, pontos: 50 }, 0, 10000), { centavos: 0, pontos: 0 });
});

test('validade, faixas e saldo', () => {
  assert.equal(validadeDoCashback(reais, '2026-10-20'), '2027-01-18');
  assert.equal(validadeDoCashback({ ...reais, validadeDias: null }, '2026-10-20'), null);
  assert.deepEqual(faixaAlcancada(pontos.faixas, 350), { pontos: 300, descontoPercentual: 15 });
  assert.deepEqual(faixaAlcancada(pontos.faixas, 150), { pontos: 100, descontoPercentual: 5 });
  assert.equal(faixaAlcancada(pontos.faixas, 50), null);
  assert.deepEqual(pontosParaProximaFaixa(pontos.faixas, 150), { faixa: { pontos: 300, descontoPercentual: 15 }, faltam: 150 });
  assert.equal(pontosParaProximaFaixa(pontos.faixas, 400), null);
  assert.deepEqual(saldoDosMovimentos([
    { tipo: 'gerado', centavos: 1000, pontos: 0 },
    { tipo: 'usado', centavos: 300, pontos: 0 },
    { tipo: 'estornado', centavos: 1000, pontos: 0 },
  ]), { centavos: -300, pontos: 0 });
  assert.equal(formatarCashback('reais', 1234, 0), 'R$ 12,34');
  assert.equal(formatarCashback('pontos', 0, 1500), '1.500 ponto(s)');
});
