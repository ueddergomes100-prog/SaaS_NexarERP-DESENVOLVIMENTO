import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bloqueioDoDesfazerComNota,
  bloqueioDoRecebimentoComNota,
  cfopDaTransferencia,
  statusEfetivoDaNota,
  cfopDeEntradaDaTransferencia,
  montarPayloadTransferencia,
  parseTributacaoTransferencia,
  prepararNotaTransferencia,
} from '../src/utils/notaTransferenciaDomain';
import { montarItemNotaFiscal } from '../src/utils/notaFiscalItemDomain';

const configOrigem = { cnpj: '11.222.333/0001-81', uf: 'ES', razaoSocial: 'LOJA CENTRO LTDA' };
const configDestino = {
  cnpj: '11.222.333/0002-62', razaoSocial: 'Loja Baixada Ltda', inscricaoEstadual: '082.123.45-6', rua: 'Rua B', numero: '10',
  bairro: 'Centro', cep: '29160-000', nfseCidadeCodigo: '3205002', nfseCidadeNome: 'Serra', nfseCidadeEstado: 'ES', uf: 'ES',
};
const produto = { nome: 'RACAO 10KG', ncm: '23091000', cfop: '5102', csosn: '102', origem: '0', cstPis: '99', cstCofins: '99' };
const item = { produtoIdOrigem: 'p1', codigo: '123', nome: 'RACAO 10KG', unidade: 'UN', quantidade: 3, custoUnitario: 10.5 };

const preparar = (extra: Record<string, unknown> = {}) => prepararNotaTransferencia({
  itens: [item], produtos: { p1: produto }, configOrigem, configDestino, rotuloOrigem: '10 · CENTRO', rotuloDestino: '20 · BAIXADA',
  regime: 'simples_nacional', tributacao: 'nao_incide', ...extra,
});

test('CFOP pela UF e pela origem do produto; entrada correspondente', () => {
  assert.equal(cfopDaTransferencia(false, false), '5152');
  assert.equal(cfopDaTransferencia(false, true), '6152');
  assert.equal(cfopDaTransferencia(true, false), '5151');
  assert.equal(cfopDaTransferencia(true, true), '6151');
  assert.equal(cfopDeEntradaDaTransferencia('5152'), '1152');
  assert.equal(cfopDeEntradaDaTransferencia('6151'), '2151');
  assert.equal(parseTributacaoTransferencia(undefined), 'nao_incide');
  assert.equal(parseTributacaoTransferencia('produto'), 'produto');
});

test('nota no mesmo estado, pelo custo, sem ICMS (CSOSN 400) e PIS/COFINS 49', () => {
  const r = preparar();
  assert.equal(r.ok, true, r.erros.join(' '));
  assert.equal(r.interestadual, false);
  assert.deepEqual(r.cfops, ['5152']);
  assert.deepEqual(r.cfopsEntrada, ['1152']);
  assert.equal(r.valorTotal, 31.5);
  const i = r.itens[0] as { cfop: number; taxes: { icms: { csosn: number }; pis: { cst: number }; totalTax?: number } };
  assert.equal(i.cfop, 5152);
  assert.equal(i.taxes.icms.csosn, 400);
  assert.equal(i.taxes.pis.cst, 49);
  assert.equal('totalTax' in i.taxes, false);
  assert.equal((r.receiver as { federalTaxNumber: string }).federalTaxNumber, '11222333000262');
});

test('outro estado vira 6152, sem trocar pelo CFOP interestadual da venda; regime normal usa CST 41', () => {
  const r = preparar({
    configDestino: { ...configDestino, uf: 'MG', nfseCidadeEstado: 'MG', nfseCidadeCodigo: '3106200' },
    produtos: { p1: { ...produto, cfopInterestadual: '6102', csosnInterestadual: '102', produzidoInternamente: true } },
    regime: 'lucro_presumido',
  });
  assert.equal(r.ok, true, r.erros.join(' '));
  assert.deepEqual(r.cfops, ['6151']);
  const i = r.itens[0] as { cfop: number; taxes: { icms: { cst: number } } };
  assert.equal(i.cfop, 6151);
  assert.equal(i.taxes.icms.cst, 41);
});

test('"igual a venda" usa a tributacao do cadastro', () => {
  const r = preparar({ tributacao: 'produto' });
  assert.equal(r.ok, true, r.erros.join(' '));
  assert.equal((r.itens[0] as { taxes: { icms: { csosn: number } } }).taxes.icms.csosn, 102);
});

test('bloqueia: mesmo CNPJ, destino sem cadastro fiscal, produto sem custo ou sem NCM', () => {
  const mesmo = preparar({ configDestino: { ...configDestino, cnpj: configOrigem.cnpj } });
  assert.equal(mesmo.ok, false);
  assert.match(mesmo.erros[0], /mesmo CNPJ/);

  const semCidade = preparar({ configDestino: { ...configDestino, nfseCidadeCodigo: '', inscricaoEstadual: '' } });
  assert.equal(semCidade.ok, false);
  assert.match(semCidade.erros.join(' '), /inscrição estadual/);
  assert.match(semCidade.erros.join(' '), /código IBGE/);
  assert.match(semCidade.erros.join(' '), /Entre na filial 20 · BAIXADA/);

  const semCusto = preparar({ itens: [{ ...item, custoUnitario: 0 }] });
  assert.match(semCusto.erros[0], /sem preço de custo/);

  const semNcm = preparar({ produtos: { p1: { ...produto, ncm: '' } } });
  assert.match(semNcm.erros[0], /sem NCM/);
});

test('payload: sem pagamento, sem consumidor final, natureza e texto da transferencia', () => {
  const preparo = preparar();
  const p = montarPayloadTransferencia({
    integrationId: 'transf-x', preparo, regime: 'simples_nacional', tributacao: 'nao_incide',
    numeroTransferencia: '0007', rotuloOrigem: '10 · CENTRO', rotuloDestino: '20 · BAIXADA',
  }) as Record<string, unknown>;
  assert.deepEqual(p.payments, [{ method: 'noPayment', amount: 0 }]);
  assert.equal(p.isFinalCustomer, false);
  assert.equal(p.destination, 'internal');
  assert.equal(p.operationNature, 'Transferência de mercadoria');
  assert.match(String(p.additionalInformation), /nº 0007/);
  assert.match(String(p.additionalInformation), /LC 204\/2023/);
  assert.deepEqual(p.total, { invoiceAmount: 31.5, productAmount: 31.5 });
});

test('recebimento so com a nota autorizada; cancelar/recusar so sem nota valendo', () => {
  assert.equal(bloqueioDoRecebimentoComNota('authorized', '0001'), null);
  assert.match(String(bloqueioDoRecebimentoComNota('enqueued', '0001')), /ainda não foi autorizada/);
  assert.match(String(bloqueioDoRecebimentoComNota('rejected', '0001')), /emitir a nota de novo/);
  assert.equal(bloqueioDoDesfazerComNota('rejected', 'cancelar', null), null);
  assert.equal(bloqueioDoDesfazerComNota(undefined, 'cancelar', null), null);
  assert.match(String(bloqueioDoDesfazerComNota('authorized', 'cancelar', 15)), /nº 15.*Cancele a nota/);
  assert.match(String(bloqueioDoDesfazerComNota('processing', 'recusar', null)), /ainda está na SEFAZ/);
  assert.equal(bloqueioDoDesfazerComNota('falha_envio', 'cancelar', null), null);
  assert.match(String(bloqueioDoRecebimentoComNota('nao_emitida', '0002')), /situação: não emitida/);
});

test('reserva esquecida vira falha de envio depois de 5 minutos', () => {
  const agora = 1_000_000_000;
  assert.equal(statusEfetivoDaNota({ status: 'reservada', reservadoEmMs: agora - 60_000 }, agora), 'reservada');
  assert.equal(statusEfetivoDaNota({ status: 'reservada', reservadoEmMs: agora - 6 * 60_000 }, agora), 'falha_envio');
  assert.equal(statusEfetivoDaNota({ status: 'authorized' }, agora), 'authorized');
  assert.equal(statusEfetivoDaNota(null, agora), '');
});

test('item fiscal: CFOP da operacao vale mesmo sem CFOP no cadastro e nao vira 6xxx sozinho', () => {
  const r = montarItemNotaFiscal({
    produto: { ...produto, cfop: '' },
    venda: { quantidade: 1, precoUnitario: 5, desconto: 0, unidadeSigla: 'UN' },
    contexto: { regime: 'simples_nacional', interestadual: true, cfopDaOperacao: '6152' },
    codigoItem: '1',
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.item.cfop, 6152);
});
