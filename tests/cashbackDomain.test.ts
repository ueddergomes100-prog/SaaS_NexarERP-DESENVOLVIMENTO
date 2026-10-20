import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cashbackDaVenda,
  cashbackDisponivelParaVenda,
  cashbackUsadoNaVenda,
  conferirPagamentoComCashback,
  devolucaoDoUso,
  faixaAlcancada,
  faixasDisponiveis,
  formatarCashback,
  lerConfigCashback,
  lerFaixas,
  lerResumoCashback,
  parseConfigCashback,
  planoDeUso,
  pontosParaProximaFaixa,
  saldoDosMovimentos,
  validadeDoCashback,
  valorSugeridoDoCashback,
  type ConfigCashback,
  type LoteParaUso,
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

// ---------------------------------------------------------------- uso como forma de pagamento (fase 2)

const lote = (id: string, extra: Partial<LoteParaUso> = {}): LoteParaUso => ({
  id, centavos: 1000, pontos: 0, restanteCentavos: 1000, restantePontos: 0, validade: null, ordem: 0, ...extra,
});

test('uso: R$ nao passa do saldo nem do total; pontos exigem o valor exato de uma faixa alcancada', () => {
  const resumoReais = { modelo: 'reais' as const, saldoCentavos: 800, saldoPontos: 0, dividaCentavos: 0, dividaPontos: 0, proximoVencimento: null };
  assert.deepEqual(conferirPagamentoComCashback(reais, resumoReais, 10000, 800), { ok: true, centavos: 800, pontos: 0 });
  assert.match((conferirPagamentoComCashback(reais, resumoReais, 10000, 801) as { erro: string }).erro, /8,00/);
  assert.match((conferirPagamentoComCashback(reais, resumoReais, 500, 800) as { erro: string }).erro, /total da venda/);
  assert.match((conferirPagamentoComCashback(reais, null, 10000, 100) as { erro: string }).erro, /não tem saldo/);
  assert.match((conferirPagamentoComCashback({ ...reais, ativo: false }, resumoReais, 10000, 100) as { erro: string }).erro, /desligado/);
  const resumoPontos = { ...resumoReais, modelo: 'pontos' as const, saldoCentavos: 0, saldoPontos: 150 };
  // faixas: 100 pts = 5%, 300 pts = 15%; com 150 pontos so' a de 100 cabe: 5% de R$ 100,00 = R$ 5,00
  assert.deepEqual(faixasDisponiveis(pontos.faixas, 150, 10000).map((f) => [f.faixa.pontos, f.valorCentavos]), [[100, 500]]);
  assert.deepEqual(conferirPagamentoComCashback(pontos, resumoPontos, 10000, 500), { ok: true, centavos: 0, pontos: 100 });
  assert.match((conferirPagamentoComCashback(pontos, resumoPontos, 10000, 1500) as { erro: string }).erro, /nenhuma faixa/);
  assert.match((conferirPagamentoComCashback(pontos, resumoReais, 10000, 500) as { erro: string }).erro, /não tem saldo/);
});

test('planoDeUso: vence antes sai antes, sem validade por ultimo; divida reduz o que da\' para usar', () => {
  const lotes = [
    lote('a', { validade: null, ordem: 1 }),
    lote('b', { validade: '2026-12-01', ordem: 2 }),
    lote('c', { validade: '2026-11-01', ordem: 3 }),
    lote('vencido', { validade: '2026-01-01', ordem: 0 }),
  ];
  const plano = planoDeUso(lotes, { centavos: 0, pontos: 0 }, { centavos: 2500, pontos: 0 }, '2026-10-20');
  assert.deepEqual(plano, { ok: true, consumos: [{ id: 'c', centavos: 1000, pontos: 0 }, { id: 'b', centavos: 1000, pontos: 0 }, { id: 'a', centavos: 500, pontos: 0 }] });
  // 3 lotes vigentes = 3000; divida 500 -> saldo 2500: pedir 2600 nao da'.
  assert.equal(planoDeUso(lotes, { centavos: 500, pontos: 0 }, { centavos: 2600, pontos: 0 }, '2026-10-20').ok, false);
  assert.equal(planoDeUso(lotes, { centavos: 500, pontos: 0 }, { centavos: 2500, pontos: 0 }, '2026-10-20').ok, true);
});

test('devolucaoDoUso: lote vivo recebe de volta; lote estornado abate a divida', () => {
  const vivo = devolucaoDoUso({ restanteCentavos: 200, restantePontos: 0, usadoCentavos: 300, usadoPontos: 0 }, { id: 'x', centavos: 300, pontos: 0 }, { centavos: 0, pontos: 0 });
  assert.deepEqual(vivo, { lote: { restanteCentavos: 500, restantePontos: 0, usadoCentavos: 0, usadoPontos: 0 }, divida: { centavos: 0, pontos: 0 } });
  const estornado = devolucaoDoUso({ restanteCentavos: 0, restantePontos: 0, usadoCentavos: 300, usadoPontos: 0, estornado: true }, { id: 'x', centavos: 300, pontos: 0 }, { centavos: 300, pontos: 0 });
  assert.deepEqual(estornado, { lote: { restanteCentavos: 0, restantePontos: 0, usadoCentavos: 0, usadoPontos: 0 }, divida: { centavos: 0, pontos: 0 } });
});

test('o que a tela oferece: saldo no modelo da empresa; valor sugerido = saldo ate\' o que falta, ou a maior faixa', () => {
  assert.equal(cashbackDisponivelParaVenda(reais, lerResumoCashback({ modelo: 'pontos', saldoPontos: 500 })), null, 'saldo de outro modelo');
  assert.equal(cashbackDisponivelParaVenda({ ...reais, ativo: false }, lerResumoCashback({ modelo: 'reais', saldoCentavos: 500 })), null);
  assert.equal(lerResumoCashback('nada'), null);
  const d = cashbackDisponivelParaVenda(reais, lerResumoCashback({ modelo: 'reais', saldoCentavos: 800, proximoVencimento: '2026-12-31' }));
  assert.ok(d);
  assert.equal(d.proximoVencimento, '2026-12-31');
  assert.equal(valorSugeridoDoCashback(d, 10000, 600), 600);
  assert.equal(valorSugeridoDoCashback(d, 10000, 10000), 800);
  const p = cashbackDisponivelParaVenda(pontos, lerResumoCashback({ modelo: 'pontos', saldoPontos: 350 }));
  assert.ok(p);
  assert.equal(valorSugeridoDoCashback(p, 10000, 10000), 1500, '300 pontos = 15% de R$ 100,00');
  assert.equal(cashbackUsadoNaVenda([{ formaPagamento: 'Cashback', valorCentavos: 500 }, { formaPagamento: 'Cashback', valor: 2.5 }, { formaPagamento: 'Pix', valorCentavos: 100 }]), 750);
});
