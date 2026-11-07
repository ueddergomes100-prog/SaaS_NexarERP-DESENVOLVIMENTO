import assert from 'node:assert/strict';
import { test } from 'node:test';
import { notaDaPrevia } from '../src/utils/danfePreviaDomain';

const payload = {
  operationNature: 'VENDA DE MERCADORIA',
  receiver: {
    name: 'CLIENTE TESTE',
    federalTaxNumber: '12345678000195',
    stateTaxNumber: '0012345678',
    address: { street: 'RUA A', number: '10', district: 'CENTRO', postalCode: '36900000', city: { code: '3139409', name: 'MANHUAÇU', state: 'MG' } },
  },
  items: [
    { code: '3', gtinCode: 'SEM GTIN', description: 'FILTRO', ncm: '84212300', cfop: 5102, unit: 'UN', quantity: 2, unitAmount: 260, totalAmount: 520, discountAmount: 20, taxes: { icms: { origin: 0, csosn: 102 }, pis: { cst: 99 }, cofins: { cst: 99 } } },
    { code: '7', gtinCode: '7891234567890', description: 'OLEO', ncm: '27101932', cest: '0600100', cfop: 5405, unit: 'LT', quantity: 1, unitAmount: 50, totalAmount: 50, taxes: { icms: { origin: 0, cst: 60, baseTaxST: 80, amountST: 4.5 }, pis: { cst: 1, baseTax: 50, rate: 0.65, amount: 0.33 }, cofins: { cst: 1, baseTax: 50, rate: 3, amount: 1.5 }, ipi: { cst: 50, baseTax: 50, rate: 10, amount: 5 } } },
  ],
  transport: { freightModality: 'byIssuer', carrier: { name: 'TRANSP X', federalTaxNumber: '11222333000181', address: { street: 'AV B', number: '1', city: { name: 'BH', state: 'MG' } } }, vehicle: { plate: 'ABC1D23', state: 'mg' }, volume: { volumeQuantity: 3, species: 'CAIXA', grossWeight: 12.5, netWeight: 11 } },
  payments: [{ method: 'pix', amount: 300 }, { method: 'billetBanking', amount: 250 }],
  duplicates: [{ number: '001', dueDate: '2026-12-07T00:00:00', amount: 250 }],
  billing: { number: '0035', originalAmount: 250, discountAmount: 0, netAmount: 250 },
  total: { invoiceAmount: 550, productAmount: 570, discountAmount: 20, icmsBaseTax: 0, icmsAmount: 0, pisAmount: 0.33, cofinsAmount: 1.5 },
  additionalInformation: 'Pedido de venda nº 0035.',
};

const emitente = {
  cnpj: '42.906.401/0001-55', razaoSocial: 'LOJA DEMONSTRACAO FISCAL LTDA', nomeOficina: 'LOJA DEMONSTRAÇÃO', inscricaoEstadual: '001234567', regimeTributario: 'simples_nacional',
  rua: 'RUA C', numero: '5', bairro: 'CENTRO', cep: '36900-000', telefone: '(33) 3333-4444', nfseCidadeNome: 'MANHUAÇU', nfseCidadeCodigo: '3139409', nfseCidadeEstado: 'mg',
};

test('previa: emitente da configuracao, destinatario do payload, sem chave nem protocolo', () => {
  const nota = notaDaPrevia({ payload, emitente, serie: '1', hoje: '2026-11-07' });
  assert.equal(nota.chave, '');
  assert.equal(nota.numero, '');
  assert.equal(nota.serie, '1');
  assert.equal(nota.protocolo, '');
  assert.equal(nota.dataEmissao, '2026-11-07');
  assert.equal(nota.emitente.documento, '42906401000155');
  assert.equal(nota.emitente.regime, '1');
  assert.equal(nota.emitente.endereco.uf, 'MG');
  assert.equal(nota.emitente.endereco.cep, '36900000');
  assert.equal(nota.destinatario.nome, 'CLIENTE TESTE');
  assert.equal(nota.destinatario.inscricaoEstadual, '0012345678');
  assert.equal(nota.destinatario.endereco.codigoMunicipio, '3139409');
  assert.equal(nota.naturezaOperacao, 'VENDA DE MERCADORIA');
  assert.equal(nota.informacoesComplementares, 'Pedido de venda nº 0035.');
});

test('previa: itens com CSOSN/CST, ST, IPI, GTIN "SEM GTIN" vazio; totais somados', () => {
  const nota = notaDaPrevia({ payload, emitente, hoje: '2026-11-07' });
  assert.equal(nota.itens.length, 2);
  assert.deepEqual(nota.itens.map((i) => [i.numero, i.codigo, i.cfop, i.ean, i.icms.situacao]), [[1, '3', '5102', '', '102'], [2, '7', '5405', '7891234567890', '60']]);
  assert.equal(nota.itens[0].desconto, 20);
  assert.equal(nota.itens[1].icms.valorSt, 4.5);
  assert.equal(nota.itens[1].ipi.valor, 5);
  assert.equal(nota.itens[1].pis.aliquota, 0.65);
  assert.equal(nota.totais.total, 550);
  assert.equal(nota.totais.produtos, 570);
  assert.equal(nota.totais.desconto, 20);
  assert.equal(nota.totais.st, 4.5);
  assert.equal(nota.totais.ipi, 5);
  assert.equal(nota.totais.pis, 0.33);
});

test('previa: transporte, pagamentos pelo codigo da SEFAZ, duplicatas e fatura', () => {
  const nota = notaDaPrevia({ payload, emitente, hoje: '2026-11-07' });
  assert.equal(nota.transporte.modalidadeFrete, '0');
  assert.equal(nota.transporte.transportadoraNome, 'TRANSP X');
  assert.equal(nota.transporte.placa, 'ABC1D23');
  assert.equal(nota.transporte.volumes[0].quantidade, 3);
  assert.equal(nota.transporte.volumes[0].pesoBruto, 12.5);
  assert.deepEqual(nota.pagamentos.map((p) => [p.forma, p.valor]), [['17', 300], ['15', 250]]);
  assert.deepEqual(nota.duplicatas, [{ numero: '001', vencimento: '2026-12-07', valor: 250 }]);
  assert.equal(nota.faturaNumero, '0035');
  assert.equal(nota.faturaValor, 250);
});

test('previa: payload minimo nao quebra (sem transporte, pagamentos, duplicatas)', () => {
  const nota = notaDaPrevia({ payload: { receiver: { name: 'X', federalTaxNumber: '12345678901' }, items: [], total: {} }, emitente: {}, hoje: '2026-11-07' });
  assert.equal(nota.transporte.modalidadeFrete, '9');
  assert.deepEqual(nota.transporte.volumes, []);
  assert.deepEqual(nota.pagamentos, []);
  assert.equal(nota.destinatario.documento, '12345678901');
  assert.equal(nota.emitente.regime, '3');
});
