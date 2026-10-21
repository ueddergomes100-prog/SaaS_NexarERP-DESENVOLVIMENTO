import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cfopDaDevolucaoDeCompra,
  destinatarioDaDevolucao,
  lerPedidoDeDevolucaoCompra,
  montarItensDaNotaDeDevolucao,
  montarPayloadDaDevolucaoDeCompra,
  notaVigenteDaDevolucaoDeCompra,
  planejarItensDaDevolucao,
  planoFinanceiroDaDevolucao,
  saidaDosLotes,
  type ItemDaEntrada,
} from '../src/utils/devolucaoCompraDomain';
import type { ItemDaNota, ParteDaNota } from '../src/utils/nfeXmlDomain';

const racao: ItemDaEntrada = {
  itemId: 'p1', tipo: 'revenda', codigoXml: 'R15', descricaoXml: 'RACAO 15KG', quantidade: 10, valorUnitario: 100, unidadeNota: 'SC', fator: 15,
  cfop: '5403', cfopEntrada: '1403', impostos: { icms: { valorSt: 50 }, ipi: { valor: 20 } },
};

test('CFOP da devolucao: pelo de entrada ou pelo do fornecedor; uso e consumo nao', () => {
  assert.equal(cfopDaDevolucaoDeCompra('1102', ''), '5202');
  assert.equal(cfopDaDevolucaoDeCompra('2403', ''), '6411');
  assert.equal(cfopDaDevolucaoDeCompra('', '5102'), '5202');
  assert.equal(cfopDaDevolucaoDeCompra('', '6403'), '6411');
  assert.equal(cfopDaDevolucaoDeCompra('1556', ''), null);
});

test('pedido: itens, quantidade e motivo', () => {
  const ok = lerPedidoDeDevolucaoCompra({ notaEntradaId: 'n1', itens: [{ indice: 0, quantidade: '2' }, { indice: 1, quantidade: 0 }], motivo: '  Mercadoria   com defeito ' });
  assert.deepEqual(ok, { pedido: { notaEntradaId: 'n1', itens: [{ indice: 0, quantidade: 2 }], motivo: 'Mercadoria com defeito' } });
  assert.match((lerPedidoDeDevolucaoCompra({ notaEntradaId: 'n1', itens: [{ indice: 0, quantidade: 0 }], motivo: 'Mercadoria com defeito' }) as { erro: string }).erro, /pelo menos um item/);
  assert.match((lerPedidoDeDevolucaoCompra({ notaEntradaId: 'n1', itens: [{ indice: 0, quantidade: 1 }], motivo: 'curto' }) as { erro: string }).erro, /motivo/);
  assert.match((lerPedidoDeDevolucaoCompra({ notaEntradaId: '../x', itens: [], motivo: 'Mercadoria com defeito' }) as { erro: string }).erro, /Nota de entrada inválida/);
});

test('itens: valor com ST e IPI proporcionais, estoque pelo fator, limite do que ja foi devolvido', () => {
  const r = planejarItensDaDevolucao({ itens: [racao], pedido: [{ indice: 0, quantidade: 2 }], jaDevolvido: {} });
  assert.ok('itens' in r);
  if (!('itens' in r)) return;
  assert.equal(r.itens[0].produtosCentavos, 20000);
  assert.equal(r.itens[0].stCentavos, 1000);
  assert.equal(r.itens[0].ipiCentavos, 400);
  assert.equal(r.totalCentavos, 21400);
  assert.equal(r.itens[0].quantidadeEstoque, 30);
  assert.equal(r.itens[0].cfop, '5411');
  const demais = planejarItensDaDevolucao({ itens: [racao], pedido: [{ indice: 0, quantidade: 3 }], jaDevolvido: { 0: 8 } });
  assert.match((demais as { erro: string }).erro, /no máximo 2/);
  const registro = planejarItensDaDevolucao({ itens: [{ ...racao, tipo: 'registro' }], pedido: [{ indice: 0, quantidade: 1 }], jaDevolvido: {} });
  assert.match((registro as { erro: string }).erro, /registro/);
  const misto = planejarItensDaDevolucao({ itens: [racao, { ...racao, cfopEntrada: '2102' }], pedido: [{ indice: 0, quantidade: 1 }, { indice: 1, quantidade: 1 }], jaDevolvido: {} });
  assert.match((misto as { erro: string }).erro, /duas devoluções/);
});

test('lotes: sai na ordem da entrada, limitado ao que sobrou de cada lote', () => {
  const lotes = [{ loteId: 'l1', lote: 'A', validade: '', quantidade: 10 }, { loteId: 'l2', lote: 'B', validade: '', quantidade: 20 }];
  assert.deepEqual(saidaDosLotes(lotes, 15, { l1: 10, l2: 20 }, 'X'), { usos: [{ loteId: 'l1', lote: 'A', quantidade: 10 }, { loteId: 'l2', lote: 'B', quantidade: 5 }] });
  assert.deepEqual(saidaDosLotes(lotes, 15, { l1: 2, l2: 20 }, 'X'), { usos: [{ loteId: 'l1', lote: 'A', quantidade: 2 }, { loteId: 'l2', lote: 'B', quantidade: 13 }] });
  assert.match((saidaDosLotes(lotes, 15, { l1: 0, l2: 5 }, 'X') as { erro: string }).erro, /só têm 5/);
  assert.deepEqual(saidaDosLotes(undefined, 15, {}, 'X'), { usos: [] });
});

test('financeiro: abate da ultima parcela em aberto; o resto vira a receber', () => {
  const titulos = [
    { id: 't1', status: 'Paga', valorCentavos: 10000, dataVencimento: '2026-10-01' },
    { id: 't2', status: 'Pendente', valorCentavos: 10000, dataVencimento: '2026-11-01' },
    { id: 't3', status: 'Pendente', valorCentavos: 10000, dataVencimento: '2026-12-01' },
    { id: 't4', status: 'Pendente', valorCentavos: 10000, dataVencimento: '2027-01-01', boleto: { nossoNumero: '1' } },
  ];
  assert.deepEqual(planoFinanceiroDaDevolucao(titulos, 15000), {
    abatimentos: [
      { id: 't3', antesCentavos: 10000, depoisCentavos: 0, cancelar: true },
      { id: 't2', antesCentavos: 10000, depoisCentavos: 5000, cancelar: false },
    ],
    aReceberCentavos: 0,
  });
  assert.equal(planoFinanceiroDaDevolucao(titulos, 25000).aReceberCentavos, 5000);
  assert.equal(planoFinanceiroDaDevolucao([titulos[0]], 3000).aReceberCentavos, 3000, 'tudo pago: tudo a receber');
});

const xml = (extra: Partial<ItemDaNota> = {}): ItemDaNota => ({
  numero: 3, codigo: 'R15', ean: '7891234567895', descricao: 'RACAO 15KG', ncm: '23091000', cest: '2200100', cfop: '5403', unidade: 'SC',
  quantidade: 10, valorUnitario: 100, valorProduto: 1000, frete: 0, seguro: 0, desconto: 0, outrasDespesas: 0, unidadeTributavel: 'SC',
  quantidadeTributavel: 10, pedido: '', informacaoAdicional: '',
  icms: { origem: '0', situacao: '10', base: 1000, reducaoBase: 0, aliquota: 17, valor: 170, baseSt: 1400, aliquotaSt: 17, valorSt: 68, mvaSt: 40, valorDesonerado: 0, valorCreditoSn: 0 },
  ipi: { situacao: '50', base: 1000, aliquota: 2, valor: 20 },
  pis: { situacao: '01', base: 1000, aliquota: 1.65, valor: 16.5 },
  cofins: { situacao: '01', base: 1000, aliquota: 7.6, valor: 76 },
  lotes: [],
  ...extra,
});

test('itens da NF-e: referencia o item do fornecedor, repete o ICMS/ST escalado, IPI devolvido, PIS/COFINS 49', () => {
  const plano = planejarItensDaDevolucao({ itens: [racao], pedido: [{ indice: 0, quantidade: 2 }], jaDevolvido: {} });
  if (!('itens' in plano)) throw new Error('plano');
  const normal = montarItensDaNotaDeDevolucao({ itens: plano.itens, itensEntrada: [racao], itensXml: [xml()], chaveAcesso: '3'.repeat(44), simples: false });
  if (!('itens' in normal)) throw new Error((normal as { erro: string }).erro);
  const item = normal.itens[0] as Record<string, any>;
  assert.deepEqual(item.sourceDocument, { accessKey: '3'.repeat(44), itemNumber: 3 });
  assert.equal(item.cfop, 5411);
  assert.equal(item.totalAmount, 200);
  assert.equal(item.ipiReturnedAmount, 4);
  assert.deepEqual(item.taxes.icms, { origin: 0, cst: 10, baseTaxModality: 3, baseTax: 200, rate: 17, amount: 34, baseTaxStModality: 4, baseTaxSt: 280, stRate: 17, stAmount: 13.6, stMarginAmount: 40 });
  assert.deepEqual(item.taxes.pis, { cst: 49 });
  const simples = montarItensDaNotaDeDevolucao({ itens: plano.itens, itensEntrada: [racao], itensXml: [xml()], chaveAcesso: '3'.repeat(44), simples: true });
  assert.equal(((simples as { itens: Array<Record<string, any>> }).itens[0].taxes.icms).csosn, 900);
  const sumiu = montarItensDaNotaDeDevolucao({ itens: plano.itens, itensEntrada: [racao], itensXml: [xml({ codigo: 'OUTRO' })], chaveAcesso: '3'.repeat(44), simples: true });
  assert.match((sumiu as { erro: string }).erro, /XML/);

  const payload = montarPayloadDaDevolucaoDeCompra({
    integrationId: 'dc-1', receiver: { name: 'FORN' }, itens: normal.itens,
    notaEntrada: { numeroNF: '123', serie: '1', dataEmissao: '2026-10-01', chaveAcesso: '3'.repeat(44) }, motivo: 'Mercadoria com defeito',
  });
  assert.equal(payload.operationType, 'outgoing');
  assert.equal(payload.purposeType, 'devolution');
  assert.equal(payload.destination, 'internal');
  assert.equal(payload.total.invoiceAmount, 200 + 13.6 + 4);
  assert.match(payload.additionalInformation, /NF-e Nº 123 série 1 de 01\/10\/2026/);
});

test('destinatario: endereco do XML; codigo IBGE do cadastro quando o XML nao tem', () => {
  const emitente: ParteDaNota = {
    documento: '11222333000181', nome: 'FORNECEDOR LTDA', fantasia: '', inscricaoEstadual: '082123456', regime: '3',
    endereco: { logradouro: 'RUA A', numero: '10', complemento: '', bairro: 'CENTRO', municipio: 'Serra', codigoMunicipio: '', uf: 'ES', cep: '29160000', telefone: '' },
  };
  assert.match((destinatarioDaDevolucao(emitente, null) as { erro: string }).erro, /código IBGE/);
  const ok = destinatarioDaDevolucao(emitente, { codigoIbge: '3205002' });
  assert.deepEqual((ok as { receiver: Record<string, any> }).receiver.address.city, { code: '3205002', name: 'Serra', state: 'ES' });
  assert.equal((ok as { receiver: Record<string, any> }).receiver.stateTaxNumber, '082123456');
});

test('nota vigente: rejeitada da para emitir de novo; reserva vale 5 minutos', () => {
  assert.equal(notaVigenteDaDevolucaoDeCompra(null, 0), false);
  assert.equal(notaVigenteDaDevolucaoDeCompra({ status: 'authorized' }, 0), true);
  assert.equal(notaVigenteDaDevolucaoDeCompra({ status: 'rejected' }, 0), false);
  assert.equal(notaVigenteDaDevolucaoDeCompra({ status: 'reservada', reservadoEmMs: 1000 }, 2000), true);
  assert.equal(notaVigenteDaDevolucaoDeCompra({ status: 'reservada', reservadoEmMs: 0 }, 6 * 60 * 1000), false);
});
