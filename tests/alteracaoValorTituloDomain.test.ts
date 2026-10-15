import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bloqueioParaAlterarValor,
  bloqueioParaRefazerParcelas,
  centavosParaAOrigem,
  montarAlteracaoValor,
  resumoDaAlteracaoValor,
  validarMotivoAlteracaoValor,
  validarNovoValorDoTitulo,
  valorAlteradoAtivo,
} from '../src/utils/alteracaoValorTituloDomain';
import { applyPaymentReceipt, summarizePayments, type PaymentRecord } from '../src/utils/financeDomain';

const emAberto = { tipo: 'entrada', status: 'Pendente', formaPagamento: 'Boleto', valor: 100, valorCentavos: 10000 };

test('parcela em aberto (boleto ainda não emitido, a prazo, manual) pode ter o valor alterado', () => {
  assert.equal(bloqueioParaAlterarValor(emAberto), '');
  assert.equal(bloqueioParaAlterarValor({ ...emAberto, formaPagamento: 'Pagamento a Prazo' }), '');
  assert.equal(bloqueioParaAlterarValor({ status: 'Pendente', valor: 50 }), '');
});

test('recebida, cancelada, de outro tipo ou sem situação: bloqueia dizendo o que fazer', () => {
  assert.match(bloqueioParaAlterarValor({ ...emAberto, status: 'Paga' }), /estorne o recebimento/);
  assert.match(bloqueioParaAlterarValor({ ...emAberto, status: 'Cancelada' }), /cancelada/);
  assert.match(bloqueioParaAlterarValor({ ...emAberto, tipo: 'saida' }), /Contas a Receber/);
  assert.match(bloqueioParaAlterarValor({ ...emAberto, status: undefined }), /em aberto/);
});

test('cartão e cheque não mudam de valor', () => {
  assert.match(bloqueioParaAlterarValor({ ...emAberto, formaPagamento: 'Cartão de Crédito' }), /operadora/);
  assert.match(bloqueioParaAlterarValor({ ...emAberto, formaPagamento: 'Pix', cartao: { parcelas: 1 } }), /operadora/);
  assert.match(bloqueioParaAlterarValor({ ...emAberto, formaPagamento: 'Cheque', cheque: { numeroCheque: '000123' } }), /cheque registrado \(nº 000123\)/);
});

test('boleto emitido: desfazer a emissão primeiro; enviado ao banco ou pago: sempre bloqueia', () => {
  const emitido = bloqueioParaAlterarValor({ ...emAberto, boleto: { status: 'emitido', nossoNumero: '0000042' } });
  assert.match(emitido, /nosso número 0000042/);
  assert.match(emitido, /desfaça a emissão em Financeiro › Boletos/);
  const remessa = bloqueioParaAlterarValor({ ...emAberto, boleto: { status: 'em_remessa', numeroRemessa: 7 } });
  assert.match(remessa, /enviado ao banco \(remessa nº 7\)/);
  assert.match(remessa, /peça ao banco a baixa/);
  assert.match(bloqueioParaAlterarValor({ ...emAberto, boleto: { status: 'emitido', numeroRemessa: 3 } }), /enviado ao banco/);
  assert.match(bloqueioParaAlterarValor({ ...emAberto, boleto: { status: 'pago' } }), /já foi pago/);
});

test('novo valor: maior que zero, diferente do atual e sem erro de vírgula', () => {
  assert.equal(validarNovoValorDoTitulo(10000, 9000), '');
  assert.equal(validarNovoValorDoTitulo(10000, 11000), '');
  assert.match(validarNovoValorDoTitulo(10000, 0), /maior que zero/);
  assert.match(validarNovoValorDoTitulo(10000, Number.NaN), /maior que zero/);
  assert.match(validarNovoValorDoTitulo(10000, 90.5), /maior que zero/);
  assert.match(validarNovoValorDoTitulo(10000, 10000), /igual ao valor atual/);
  // 3x o atual + R$ 1.000 ainda passa; acima disso e' digitacao.
  assert.equal(validarNovoValorDoTitulo(10000, 130000), '');
  assert.match(validarNovoValorDoTitulo(10000, 130001), /muito acima/);
});

test('motivo é obrigatório, com mínimo e máximo', () => {
  assert.equal(validarMotivoAlteracaoValor('desconto combinado no boleto'), '');
  assert.match(validarMotivoAlteracaoValor('   '), /mínimo 5/);
  assert.match(validarMotivoAlteracaoValor('abc'), /mínimo 5/);
  assert.match(validarMotivoAlteracaoValor(undefined), /mínimo 5/);
  assert.match(validarMotivoAlteracaoValor('x'.repeat(256)), /no máximo 255/);
});

test('registro: guarda o valor de antes da primeira alteração e soma a diferença', () => {
  const primeira = montarAlteracaoValor({ titulo: emAberto, novoCentavos: 9000, motivo: ' desconto no boleto ', porUid: 'u1', porEmail: 'u1@x' });
  assert.deepEqual(primeira, {
    valorOriginalCentavos: 10000,
    valorAnteriorCentavos: 10000,
    valorNovoCentavos: 9000,
    diferencaCentavos: -1000,
    motivo: 'desconto no boleto',
    porUid: 'u1',
    porEmail: 'u1@x',
    vezes: 1,
  });
  const segunda = montarAlteracaoValor({ titulo: { ...emAberto, valorCentavos: 9000, alteracaoValor: primeira }, novoCentavos: 10000, motivo: 'cliente desistiu do desconto', porUid: 'u2' });
  assert.equal(segunda.valorOriginalCentavos, 10000);
  assert.equal(segunda.valorAnteriorCentavos, 9000);
  assert.equal(segunda.diferencaCentavos, 0);
  assert.equal(segunda.vezes, 2);
  assert.equal('porEmail' in segunda, false, 'sem e-mail a chave fica de fora (nada de undefined no Firestore)');
  assert.equal(valorAlteradoAtivo({ alteracaoValor: primeira }), true);
  assert.equal(valorAlteradoAtivo({ alteracaoValor: segunda }), false, 'voltou ao valor de antes');
  assert.equal(valorAlteradoAtivo({}), false);
});

test('resumo em reais para a tela e o log', () => {
  const texto = resumoDaAlteracaoValor({ valorAnteriorCentavos: 10000, valorNovoCentavos: 9000, motivo: 'desconto no boleto' });
  assert.match(texto, /^De R\$\s100,00 para R\$\s90,00\. Motivo: desconto no boleto$/);
  assert.equal(resumoDaAlteracaoValor(null), '');
});

const pagamento = (valorCentavos: number, extra: Partial<PaymentRecord> = {}): PaymentRecord => ({
  id: 'p1', indice: 1, formaPagamento: 'Boleto', condicaoPagamento: 'aprazo', valorCentavos, valor: valorCentavos / 100,
  status: 'pendente', naturezaFinanceira: 'boleto' as PaymentRecord['naturezaFinanceira'], movimentaCaixaFisico: false, transactionId: 't1', ...extra,
});
const alterado = { ...emAberto, valorCentavos: 9000, alteracaoValor: { diferencaCentavos: -1000 } };

test('baixa de parcela alterada quita a venda por inteiro (nunca fica "Parcial")', () => {
  const pagamentos = [pagamento(10000)];
  const centavos = centavosParaAOrigem(pagamentos, { transactionId: 't1', titulo: alterado, recebidoCentavos: 9000, tituloQuitado: true });
  assert.equal(centavos, 10000);
  const resumo = summarizePayments(applyPaymentReceipt(pagamentos, { transactionId: 't1', amountCents: centavos, method: 'Pix', receiptId: 't1', receivedAt: '2026-10-15' }));
  assert.equal(resumo.pendingCents, 0);
  // Com acrescimo (parcela maior que a venda) tambem quita sem passar do pagamento.
  assert.equal(centavosParaAOrigem(pagamentos, { transactionId: 't1', titulo: { ...alterado, valorCentavos: 11000, alteracaoValor: { diferencaCentavos: 1000 } }, recebidoCentavos: 11000, tituloQuitado: true }), 10000);
});

test('parcela sem alteração segue a regra de sempre (recebido = quitado)', () => {
  assert.equal(centavosParaAOrigem([pagamento(10000)], { transactionId: 't1', titulo: emAberto, recebidoCentavos: 4000, tituloQuitado: false }), 4000);
  assert.equal(centavosParaAOrigem([pagamento(10000)], { transactionId: 't1', titulo: { ...emAberto, alteracaoValor: { diferencaCentavos: 0 } }, recebidoCentavos: 10000, tituloQuitado: true }), 10000);
});

test('abatimento parcial em parcela alterada nunca fecha a venda antes da parcela', () => {
  const pagamentos = [pagamento(10000)];
  assert.equal(centavosParaAOrigem(pagamentos, { transactionId: 't1', titulo: alterado, recebidoCentavos: 5000, tituloQuitado: false }), 5000);
  const acrescida = { ...alterado, valorCentavos: 11000, alteracaoValor: { diferencaCentavos: 1000 } };
  assert.equal(centavosParaAOrigem(pagamentos, { transactionId: 't1', titulo: acrescida, recebidoCentavos: 10500, tituloQuitado: false }), 9999);
});

test('pagamento da venda não encontrado: devolve o recebido (a baixa avisa como sempre)', () => {
  assert.equal(centavosParaAOrigem([pagamento(10000, { transactionId: 'outro', indice: 5 })], { transactionId: 't1', paymentIndex: 1, titulo: alterado, recebidoCentavos: 9000, tituloQuitado: true }), 9000);
});

test('refazer parcelas (alterar forma de pagamento, salvar OS) bloqueia com valor alterado em aberto', () => {
  const mensagem = bloqueioParaRefazerParcelas([{ ...alterado, descricao: 'Venda #12 - Boleto' }], 'venda');
  assert.match(mensagem, /parcela "Venda #12 - Boleto" desta venda/);
  assert.match(mensagem, /de R\$\s100,00 para R\$\s90,00/);
  assert.match(mensagem, /volte a parcela para R\$\s100,00/);
  assert.match(bloqueioParaRefazerParcelas([alterado], 'OS'), /desta OS/);
  assert.equal(bloqueioParaRefazerParcelas([emAberto, { ...alterado, status: 'Cancelada' }], 'venda'), '');
  assert.equal(bloqueioParaRefazerParcelas([{ ...emAberto, alteracaoValor: { diferencaCentavos: 0 } }], 'venda'), '');
});
