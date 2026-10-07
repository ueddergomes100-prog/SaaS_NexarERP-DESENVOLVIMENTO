import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PARAMETROS_VENDA_PADRAO,
  acrescimoPorAtraso,
  bloqueioPorAtraso,
  checarPrazoDevolucao,
  descricaoDoAcrescimo,
  maiorAtrasoEmDias,
  parametrosVendaDoForm,
  parametrosVendaParaForm,
  parseParametrosVenda,
  validadeOrcamentoPadrao,
} from '../src/utils/parametrosVendaDomain';

const HOJE = '2026-10-07';

test('parse: vazio ou lixo vira o padrao (tudo desligado); valores validos entram', () => {
  assert.deepEqual(parseParametrosVenda(undefined), PARAMETROS_VENDA_PADRAO);
  assert.deepEqual(parseParametrosVenda({ validadeOrcamentoDias: 'abc', bloqueioAtraso: 'x', juros: null }), PARAMETROS_VENDA_PADRAO);
  const p = parseParametrosVenda({
    validadeOrcamentoDias: 30,
    bloqueioAtraso: { ativo: true, diasAtraso: 10, carenciaDias: 5 },
    juros: { aoMesPercentual: 2, multaPercentual: '2.5' },
    devolucao: { prazoDias: 7, acao: 'bloquear' },
  });
  assert.deepEqual(p, {
    validadeOrcamentoDias: 30,
    bloqueioAtraso: { ativo: true, diasAtraso: 10, carenciaDias: 5 },
    juros: { aoMesPercentual: 2, multaPercentual: 2.5 },
    devolucao: { prazoDias: 7, acao: 'bloquear' },
  });
  assert.equal(validadeOrcamentoPadrao(p), 30);
  assert.equal(validadeOrcamentoPadrao(PARAMETROS_VENDA_PADRAO), 15);
});

test('formulario: em branco = padrao; erros em portugues; ida e volta', () => {
  const vazio = parametrosVendaDoForm({ validadeOrcamentoDias: '', bloqueioAtrasoAtivo: false, diasAtraso: '', carenciaDias: '', jurosAoMes: '', multa: '', prazoDevolucaoDias: '', acaoDevolucao: 'avisar' });
  assert.deepEqual(vazio, { ok: true, parametros: PARAMETROS_VENDA_PADRAO });

  const invalido = parametrosVendaDoForm({ validadeOrcamentoDias: '0', bloqueioAtrasoAtivo: false, diasAtraso: '', carenciaDias: '', jurosAoMes: '', multa: '', prazoDevolucaoDias: '', acaoDevolucao: 'avisar' });
  assert.equal(invalido.ok, false);
  if (!invalido.ok) assert.match(invalido.erro, /Validade do orçamento/);

  const semDias = parametrosVendaDoForm({ validadeOrcamentoDias: '', bloqueioAtrasoAtivo: true, diasAtraso: '', carenciaDias: '', jurosAoMes: '', multa: '', prazoDevolucaoDias: '', acaoDevolucao: 'avisar' });
  assert.equal(semDias.ok, false);
  if (!semDias.ok) assert.match(semDias.erro, /quantos dias de atraso/);

  const jurosRuim = parametrosVendaDoForm({ validadeOrcamentoDias: '', bloqueioAtrasoAtivo: false, diasAtraso: '', carenciaDias: '', jurosAoMes: '150', multa: '', prazoDevolucaoDias: '', acaoDevolucao: 'avisar' });
  assert.equal(jurosRuim.ok, false);

  const cheio = parametrosVendaDoForm({ validadeOrcamentoDias: '20', bloqueioAtrasoAtivo: true, diasAtraso: '10', carenciaDias: '5', jurosAoMes: '1,5', multa: '2', prazoDevolucaoDias: '7', acaoDevolucao: 'bloquear' });
  assert.equal(cheio.ok, true);
  if (cheio.ok) {
    assert.deepEqual(cheio.parametros.juros, { aoMesPercentual: 1.5, multaPercentual: 2 });
    assert.deepEqual(parametrosVendaParaForm(cheio.parametros), { validadeOrcamentoDias: '20', bloqueioAtrasoAtivo: true, diasAtraso: '10', carenciaDias: '5', jurosAoMes: '1,5', multa: '2', prazoDevolucaoDias: '7', acaoDevolucao: 'bloquear' });
  }
});

test('maior atraso: so titulo Pendente vencido, cartao fora, data invalida = 0', () => {
  const titulos = [
    { status: 'Pendente', dataVencimento: '2026-09-27', formaPagamento: 'Boleto' },
    { status: 'Pendente', dataVencimento: '2026-09-01', formaPagamento: 'Cartão de Crédito' },
    { status: 'Paga', dataVencimento: '2026-08-01' },
    { status: 'Pendente', dataVencimento: '2026-10-20' },
    { status: 'Pendente', dataVencimento: 'ontem' },
  ];
  assert.equal(maiorAtrasoEmDias(titulos, HOJE), 10);
  assert.equal(maiorAtrasoEmDias([], HOJE), 0);
});

test('bloqueio por atraso: desligado nao barra; limite = dias + carencia; mensagem diz o que fazer', () => {
  const ligado = parseParametrosVenda({ bloqueioAtraso: { ativo: true, diasAtraso: 10, carenciaDias: 5 } });
  assert.equal(bloqueioPorAtraso(PARAMETROS_VENDA_PADRAO, 90, 'MARIA'), null);
  assert.equal(bloqueioPorAtraso(ligado, 15, 'MARIA'), null, 'no limite ainda passa');
  assert.equal(bloqueioPorAtraso(ligado, 0, 'MARIA'), null);
  assert.match(String(bloqueioPorAtraso(ligado, 16, 'MARIA')), /^MARIA tem título vencido há 16 dias.*15 dias de atraso.*Contas a Receber/);
  const zero = parseParametrosVenda({ bloqueioAtraso: { ativo: true, diasAtraso: 0, carenciaDias: 0 } });
  assert.match(String(bloqueioPorAtraso(zero, 1, '')), /^O cliente tem título vencido há 1 dia /);
});

test('juros e multa: pro rata por dia sobre 30 dias + multa fixa; sem atraso ou sem taxa = nada', () => {
  const p = parseParametrosVenda({ juros: { aoMesPercentual: 3, multaPercentual: 2 } });
  // R$ 1.000,00, 15 dias de atraso: multa 2% = 20,00; juros 3% a.m. x 15/30 = 15,00
  assert.deepEqual(acrescimoPorAtraso(p, 100000, '2026-09-22', HOJE), { diasAtraso: 15, multaCentavos: 2000, jurosCentavos: 1500, totalCentavos: 3500 });
  assert.equal(descricaoDoAcrescimo({ diasAtraso: 15, multaCentavos: 2000, jurosCentavos: 1500, totalCentavos: 3500 }), '15 dias de atraso: multa R$ 20,00 + juros R$ 15,00');
  assert.equal(acrescimoPorAtraso(p, 100000, HOJE, HOJE), null, 'vence hoje: sem atraso');
  assert.equal(acrescimoPorAtraso(p, 100000, '2026-10-20', HOJE), null, 'ainda nao venceu');
  assert.equal(acrescimoPorAtraso(PARAMETROS_VENDA_PADRAO, 100000, '2026-09-01', HOJE), null, 'sem taxa configurada');
  const soMulta = parseParametrosVenda({ juros: { multaPercentual: 2 } });
  assert.deepEqual(acrescimoPorAtraso(soMulta, 5000, '2026-10-06', HOJE), { diasAtraso: 1, multaCentavos: 100, jurosCentavos: 0, totalCentavos: 100 });
});

test('prazo de devolucao: sem prazo passa; dentro passa; fora avisa ou bloqueia', () => {
  assert.equal(checarPrazoDevolucao(PARAMETROS_VENDA_PADRAO, '2025-01-01', HOJE).foraDoPrazo, false);
  const avisa = parseParametrosVenda({ devolucao: { prazoDias: 7, acao: 'avisar' } });
  assert.equal(checarPrazoDevolucao(avisa, '2026-09-30', HOJE).foraDoPrazo, false, '7 dias = no prazo');
  const fora = checarPrazoDevolucao(avisa, '2026-09-29', HOJE);
  assert.equal(fora.foraDoPrazo, true);
  assert.equal(fora.acao, 'avisar');
  assert.match(fora.mensagem, /há 8 dias.*7 dias.*mesmo assim\?$/);
  const bloqueia = parseParametrosVenda({ devolucao: { prazoDias: 7, acao: 'bloquear' } });
  assert.match(checarPrazoDevolucao(bloqueia, '2026-09-01', HOJE).mensagem, /não pode ser registrada/);
  assert.equal(checarPrazoDevolucao(bloqueia, undefined, HOJE).foraDoPrazo, false, 'venda antiga sem data: nao bloqueia');
});
