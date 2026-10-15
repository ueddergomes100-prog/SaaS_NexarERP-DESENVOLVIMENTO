import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bloqueioParaRenegociar,
  bloqueioPorParcelaRenegociada,
  dividirEmParcelas,
  origemDoTitulo,
  origensDaRenegociacao,
  quitarPagamentosRenegociados,
  reabrirPagamentosRenegociados,
  renegociacaoQuitadaComEsteRecebimento,
  somarDias,
  validarFormaRenegociacao,
  validarMotivoRenegociacao,
  validarParcelasNovas,
  validarTitulosParaRenegociar,
} from '../src/utils/renegociacaoDomain';
import { summarizePayments, type PaymentRecord } from '../src/utils/financeDomain';
import {
  bloqueioParaCobrarEmBoleto,
  camposParaCobrarEmBoleto,
  validarVencimentoDoBoleto,
  vencimentoSugeridoDoBoleto,
} from '../src/utils/cobrancaEmBoletoDomain';
import { bloqueioParaAlterarValor, bloqueioParaRefazerParcelas } from '../src/utils/alteracaoValorTituloDomain';

const HOJE = '2026-10-15';
const parcela = (extra: Record<string, unknown> = {}) => ({
  id: 't1', tipo: 'entrada', status: 'Pendente', descricao: 'Venda #10 - 1/3', valorCentavos: 100000,
  formaPagamento: 'Pagamento a Prazo', clienteId: 'c1', clienteNome: 'MARIA', pedidoId: 'p10', paymentIndex: 1, ...extra,
});

test('renegociar: 3 parcelas em aberto do mesmo cliente passam', () => {
  const titulos = [parcela(), parcela({ id: 't2', descricao: 'Venda #10 - 2/3', paymentIndex: 2 }), parcela({ id: 't3', pedidoId: 'p11', paymentIndex: 1 })];
  assert.equal(validarTitulosParaRenegociar(titulos), '');
});

test('renegociar: clientes diferentes, repetida, vazia ou sem cliente sao recusadas', () => {
  assert.match(validarTitulosParaRenegociar([]), /Selecione/);
  assert.match(validarTitulosParaRenegociar([parcela(), parcela({ id: 't2', clienteId: 'c2' })]), /cliente só/);
  assert.match(validarTitulosParaRenegociar([parcela(), parcela()]), /duas vezes/);
  assert.match(validarTitulosParaRenegociar([parcela({ clienteId: null, clienteNome: '' })]), /sem cliente/);
  // Cadastro antigo sem clienteId junta pelo nome.
  assert.equal(validarTitulosParaRenegociar([parcela({ clienteId: null, clienteNome: 'Maria ' }), parcela({ id: 't2', clienteId: null, clienteNome: 'MARIA' })]), '');
});

test('renegociar: cada bloqueio diz qual parcela e o motivo', () => {
  assert.match(validarTitulosParaRenegociar([parcela({ status: 'Paga' })]), /A parcela "Venda #10 - 1\/3" já foi recebida/);
  assert.match(bloqueioParaRenegociar(parcela({ status: 'Renegociada' })), /já foi renegociada/);
  assert.match(bloqueioParaRenegociar(parcela({ renegociacao: { id: 'reneg_x' } })), /desfaça a renegociação anterior/);
  assert.match(bloqueioParaRenegociar(parcela({ formaPagamento: 'Cartão de Crédito' })), /cartão/);
  assert.match(bloqueioParaRenegociar(parcela({ formaPagamento: 'Cheque' })), /cheque/);
  assert.match(bloqueioParaRenegociar(parcela({ boleto: { status: 'emitido' } })), /Desfaça a emissão/);
  assert.match(bloqueioParaRenegociar(parcela({ boleto: { status: 'em_remessa', numeroRemessa: 3 } })), /enviado ao banco/);
  assert.match(bloqueioParaRenegociar(parcela({ acrescimoDaTransacaoId: 'x' })), /juros e multa/);
});

test('parcelas novas: divide igual, centavos na ultima, vencimentos pelo intervalo', () => {
  assert.deepEqual(dividirEmParcelas({ totalCentavos: 260000, quantidade: 1, primeiroVencimento: '2026-11-14', intervaloDias: 30 }), [
    { valorCentavos: 260000, vencimento: '2026-11-14' },
  ]);
  assert.deepEqual(dividirEmParcelas({ totalCentavos: 100000, quantidade: 3, primeiroVencimento: '2026-12-20', intervaloDias: 15 }), [
    { valorCentavos: 33333, vencimento: '2026-12-20' },
    { valorCentavos: 33333, vencimento: '2027-01-04' },
    { valorCentavos: 33334, vencimento: '2027-01-19' },
  ]);
  assert.equal(somarDias('2026-02-28', 1), '2026-03-01');
});

test('parcelas novas: valor, vencimento (nao antes de hoje) e erro de digitacao', () => {
  assert.equal(validarParcelasNovas([{ valorCentavos: 260000, vencimento: HOJE }], 300000, HOJE), '');
  assert.match(validarParcelasNovas([], 300000, HOJE), /ao menos uma/);
  assert.match(validarParcelasNovas([{ valorCentavos: 0, vencimento: HOJE }], 300000, HOJE), /Documento novo: informe um valor/);
  assert.match(validarParcelasNovas([{ valorCentavos: 100, vencimento: HOJE }, { valorCentavos: 100, vencimento: '2026-02-30' }], 300000, HOJE), /Parcela 2: informe o vencimento/);
  assert.match(validarParcelasNovas([{ valorCentavos: 100, vencimento: '2026-10-14' }], 300000, HOJE), /antes de hoje/);
  assert.match(validarParcelasNovas([{ valorCentavos: 1100001, vencimento: HOJE }], 300000, HOJE), /muito acima/);
});

test('forma e motivo', () => {
  assert.equal(validarFormaRenegociacao('Boleto'), '');
  assert.match(validarFormaRenegociacao('Cartão de Crédito'), /Escolha como/);
  assert.equal(validarMotivoRenegociacao('acordo para quitar'), '');
  assert.match(validarMotivoRenegociacao('ok'), /mínimo 5/);
});

const pagamento = (id: string, indice: number, valorCentavos: number, status: 'pendente' | 'confirmado' = 'pendente'): PaymentRecord => ({
  id, indice, formaPagamento: 'Pagamento a Prazo', condicaoPagamento: 'aprazo', valorCentavos, valor: valorCentavos / 100,
  status, naturezaFinanceira: 'contas_receber' as PaymentRecord['naturezaFinanceira'], movimentaCaixaFisico: false, transactionId: id,
});

test('venda de origem: quita por inteiro so com a renegociacao paga, e reabre no estorno', () => {
  const pagamentos = [pagamento('t1', 1, 100000), pagamento('t2', 2, 100000), pagamento('t9', 3, 50000)];
  const origens = [origemDoTitulo('t1', parcela()), origemDoTitulo('t2', parcela({ id: 't2', paymentIndex: 2 }))];
  const quitados = quitarPagamentosRenegociados(pagamentos, origens, HOJE);
  const resumo = summarizePayments(quitados);
  assert.equal(resumo.receivedCents, 200000);
  assert.equal(resumo.pendingCents, 50000, 'a parcela que nao foi renegociada continua em aberto');
  assert.equal(quitados.length, 3, 'quita por inteiro: nao divide o pagamento');
  const reabertos = reabrirPagamentosRenegociados(quitados, origens);
  assert.equal(summarizePayments(reabertos).pendingCents, 250000);
  // Repetir nao estraga nada.
  assert.deepEqual(reabrirPagamentosRenegociados(reabertos, origens), reabertos);
});

test('renegociacao quitada so quando todas as outras parcelas novas estao recebidas', () => {
  assert.equal(renegociacaoQuitadaComEsteRecebimento([]), true);
  assert.equal(renegociacaoQuitadaComEsteRecebimento([{ status: 'Paga' }, { status: 'Paga' }]), true);
  assert.equal(renegociacaoQuitadaComEsteRecebimento([{ status: 'Paga' }, { status: 'Pendente' }]), false);
});

test('origens agrupadas por venda/OS, sem chave undefined', () => {
  const origens = [
    origemDoTitulo('t1', parcela()),
    origemDoTitulo('t2', parcela({ id: 't2', paymentIndex: 2 })),
    origemDoTitulo('t3', parcela({ id: 't3', pedidoId: null, osId: 'os5', paymentIndex: undefined })),
    origemDoTitulo('t4', parcela({ id: 't4', pedidoId: null })),
  ];
  assert.equal('paymentIndex' in origens[2], false);
  assert.equal('pedidoId' in origens[3], false);
  const grupos = origensDaRenegociacao(origens);
  assert.deepEqual(grupos.map((g) => [g.colecao, g.id, g.titulos.length]), [['pedidos_venda', 'p10', 2], ['ordens_de_servico', 'os5', 1]]);
});

test('venda/OS com parcela renegociada nao cancela nem refaz as parcelas', () => {
  const mensagem = bloqueioPorParcelaRenegociada([{ status: 'Paga' }, { status: 'Renegociada', descricao: 'Venda #10 - 1/3' }], 'cancelar a venda');
  assert.match(mensagem, /"Venda #10 - 1\/3" foi renegociada/);
  assert.match(mensagem, /Para cancelar a venda, desfaça a renegociação/);
  assert.equal(bloqueioPorParcelaRenegociada([{ status: 'Pendente' }, { status: 'Cancelada' }], 'cancelar a venda'), '');
  assert.match(bloqueioParaRefazerParcelas([{ status: 'Renegociada' }], 'OS'), /mexer nas parcelas desta OS/);
  assert.match(bloqueioParaAlterarValor({ tipo: 'entrada', status: 'Renegociada' }), /renegociada/);
});

test('boleto pelo Dar Baixa: qualquer parcela em aberto sem cartao, cheque ou boleto emitido', () => {
  const aPrazo = { tipo: 'entrada', status: 'Pendente', formaPagamento: 'Pagamento a Prazo' };
  assert.equal(bloqueioParaCobrarEmBoleto(aPrazo), '');
  assert.equal(bloqueioParaCobrarEmBoleto({ ...aPrazo, formaPagamento: 'Boleto' }), '', 'boleto ainda nao emitido: emite pela baixa');
  assert.equal(bloqueioParaCobrarEmBoleto({ ...aPrazo, formaPagamento: '' }), '', 'titulo importado sem forma');
  assert.match(bloqueioParaCobrarEmBoleto({ ...aPrazo, formaPagamento: 'Cartão de Crédito' }), /operadora/);
  assert.match(bloqueioParaCobrarEmBoleto({ ...aPrazo, formaPagamento: 'Cheque' }), /cheque/);
  assert.match(bloqueioParaCobrarEmBoleto({ ...aPrazo, status: 'Paga' }), /já foi recebida/);
  assert.match(bloqueioParaCobrarEmBoleto({ ...aPrazo, status: 'Renegociada' }), /renegociada/);
  assert.match(bloqueioParaCobrarEmBoleto({ ...aPrazo, boleto: { status: 'emitido' } }), /já tem boleto/);
  assert.match(bloqueioParaCobrarEmBoleto({ ...aPrazo, acrescimoDaTransacaoId: 'x' }), /juros e multa/);
});

test('boleto pelo Dar Baixa: vencimento de hoje em diante, sugerido pela parcela', () => {
  assert.equal(validarVencimentoDoBoleto(HOJE, HOJE), '');
  assert.equal(validarVencimentoDoBoleto('2026-11-14', HOJE), '');
  assert.match(validarVencimentoDoBoleto('2026-10-14', HOJE), /antes de hoje/);
  assert.match(validarVencimentoDoBoleto('2026-02-30', HOJE), /Informe o vencimento/);
  assert.match(validarVencimentoDoBoleto('', HOJE), /Informe o vencimento/);
  assert.equal(vencimentoSugeridoDoBoleto('2026-11-14', HOJE), '2026-11-14');
  assert.equal(vencimentoSugeridoDoBoleto('2026-09-01', HOJE), HOJE, 'parcela vencida: sugere hoje');
  assert.equal(vencimentoSugeridoDoBoleto(undefined, HOJE), HOJE);
  assert.deepEqual(camposParaCobrarEmBoleto('2026-11-14'), {
    formaPagamento: 'Boleto', naturezaFinanceira: 'contas_receber', data: '2026-11-14', dataVencimento: '2026-11-14', dataPrevistaRecebimento: '2026-11-14',
  });
});
