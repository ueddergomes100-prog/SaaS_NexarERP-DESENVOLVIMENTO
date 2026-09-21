const test = require('node:test');
const assert = require('node:assert/strict');
const {
  cfopDeDevolucao,
  destinoDoCfop,
  escalarImpostos,
  prazoDeCancelamento,
  notaVigenteDaDevolucao,
  escolherNotaOriginal,
  casarItens,
  montarItensDevolucao,
  montarDestinatario,
  montarPayloadDevolucao,
  prepararDevolucao,
} = require('../services/devolucaoNfe');

const CHAVE = '31260907488550000140550050000000051000000059';

const taxesLucroReal = (base) => ({
  icms: { origin: 0, cst: 0, baseTaxModality: 3, baseTax: base, baseTaxReduction: 0, rate: 18, amount: base * 0.18 },
  pis: { cst: 1, baseTax: base, rate: 1.65, amount: base * 0.0165 },
  cofins: { cst: 1, baseTax: base, rate: 7.6, amount: base * 0.076 },
});

const itemNota = (code, description, quantity, unitAmount, cfop = 5102) => ({
  code, description, ncm: '19041000', cfop, unit: 'UN', quantity, unitAmount, totalAmount: quantity * unitAmount,
  unitTax: 'UN', quantityTax: quantity, unitTaxAmount: unitAmount, makeupTotal: true, taxes: taxesLucroReal(quantity * unitAmount),
});

const NOTA = {
  id: 'nota1', tipo: 'NF-e', status: 'authorized', number: 5, accessKey: CHAVE, data: '2026-09-10T15:00:00.000Z',
  itensFiscais: [itemNota('1019', 'GRANOLA 1KG', 10, 20), itemNota('2001', 'BARRA 30G', 100, 2)],
};
const PEDIDO = {
  itens: [
    { id: 'p1', nome: 'GRANOLA 1KG', codigoProduto: '1019', quantidade: 10, precoUnitario: 20 },
    { id: 'p2', nome: 'BARRA 30G', codigoProduto: '2001', quantidade: 100, precoUnitario: 2 },
  ],
};
const CLIENTE_PJ = {
  nome: 'NATUMAIS LTDA', documento: '11.222.333/0001-81', identidade: '0623079040081', endereco: 'RUA A', numero: '10',
  bairro: 'CENTRO', cep: '36940000', cidade: 'MANHUACU', estado: 'mg', codigoIbge: '3139409', email: 'nfe@natumais.com',
};
const devolvendo = (...itens) => ({ itensDevolvidos: itens });

test('CFOP: mapa automatico dos casos comuns e null pro resto', () => {
  assert.equal(cfopDeDevolucao(5102), 1202);
  assert.equal(cfopDeDevolucao(6102), 2202);
  assert.equal(cfopDeDevolucao(5101), 1201);
  assert.equal(cfopDeDevolucao(6101), 2201);
  assert.equal(cfopDeDevolucao(5405), 1411);
  assert.equal(cfopDeDevolucao(6404), 2411);
  assert.equal(cfopDeDevolucao(5949), null);
  assert.equal(cfopDeDevolucao(undefined), null);
});

test('destino: CFOP 1.xxx e interno, 2.xxx e interestadual', () => {
  assert.equal(destinoDoCfop(1202), 'internal');
  assert.equal(destinoDoCfop(2202), 'interstate');
});

test('impostos: escala base e valor, mantem CST, aliquota, reducao e modalidade', () => {
  const t = escalarImpostos(taxesLucroReal(200), 0.5);
  assert.equal(t.icms.baseTax, 100);
  assert.equal(t.icms.amount, 18);
  assert.equal(t.icms.rate, 18);
  assert.equal(t.icms.cst, 0);
  assert.equal(t.icms.origin, 0);
  assert.equal(t.icms.baseTaxModality, 3);
  assert.equal(t.icms.baseTaxReduction, 0);
  assert.equal(t.pis.baseTax, 100);
  assert.equal(t.pis.amount, 1.65);
  assert.equal(t.pis.cst, 1);
  assert.equal(t.cofins.amount, 7.6);
});

test('impostos: nao mexe no original (copia) e arredonda em 2 casas', () => {
  const original = taxesLucroReal(100);
  const t = escalarImpostos(original, 1 / 3);
  assert.equal(original.icms.baseTax, 100);
  assert.equal(t.icms.baseTax, 33.33);
  assert.equal(t.icms.amount, 6);
});

test('impostos: Simples Nacional (so csosn e cst 7) passa igual', () => {
  const simples = { icms: { origin: 0, csosn: 102 }, pis: { cst: 7 }, cofins: { cst: 7 } };
  assert.deepEqual(escalarImpostos(simples, 0.5), simples);
});

test('prazo de cancelamento: dentro e fora das 24h', () => {
  const agora = new Date('2026-09-11T10:00:00.000Z');
  assert.deepEqual(prazoDeCancelamento('2026-09-11T02:00:00.000Z', agora), { conhecido: true, dentroDoPrazo: true, horas: 8 });
  assert.equal(prazoDeCancelamento('2026-09-10T09:59:00.000Z', agora).dentroDoPrazo, false);
  assert.equal(prazoDeCancelamento('lixo', agora).conhecido, false);
});

test('nota original: uma autorizada, usa ela; varias, exige escolha; nenhuma, erro', () => {
  const a = { ...NOTA, id: 'a' };
  const b = { ...NOTA, id: 'b', tipo: 'NFC-e' };
  const rejeitada = { ...NOTA, id: 'r', status: 'rejected' };
  const devolucaoAnterior = { ...NOTA, id: 'd', finalidade: 'devolucao' };
  assert.equal(escolherNotaOriginal([a, rejeitada, devolucaoAnterior]).nota.id, 'a');
  const varias = escolherNotaOriginal([a, b]);
  assert.equal(varias.nota, undefined);
  assert.match(varias.erro, /mais de uma nota/);
  assert.equal(varias.candidatas.length, 2);
  assert.equal(escolherNotaOriginal([a, b], 'b').nota.id, 'b');
  assert.match(escolherNotaOriginal([a, b], 'zzz').erro, /não é uma nota autorizada/);
  assert.match(escolherNotaOriginal([rejeitada]).erro, /não tem NF-e ou NFC-e autorizada/);
  assert.match(escolherNotaOriginal([]).erro, /não tem NF-e ou NFC-e autorizada/);
});

test('casamento: acha o item da nota pelo codigo e devolve o numero do item (posicao)', () => {
  const { casados, erros } = casarItens({
    itensDevolvidos: [{ id: 'p2', nome: 'BARRA 30G', quantidadeDevolvida: 40 }, { id: 'p1', nome: 'GRANOLA 1KG', quantidadeDevolvida: 5 }],
    itensPedido: PEDIDO.itens,
    itensNota: NOTA.itensFiscais,
  });
  assert.deepEqual(erros, []);
  assert.equal(casados.length, 2);
  assert.equal(casados[0].itemNumber, 2);
  assert.equal(casados[0].razao, 0.4);
  assert.equal(casados[1].itemNumber, 1);
  assert.equal(casados[1].razao, 0.5);
});

test('casamento: mesmo produto duas vezes na nota usa um item de cada vez', () => {
  const itensNota = [itemNota('1019', 'GRANOLA 1KG', 4, 20), itemNota('1019', 'GRANOLA 1KG', 6, 20)];
  const itensPedido = [{ id: 'p1', nome: 'GRANOLA 1KG', codigoProduto: '1019', quantidade: 4 }, { id: 'p1', nome: 'GRANOLA 1KG', codigoProduto: '1019', quantidade: 6 }];
  const { casados } = casarItens({
    itensDevolvidos: [{ id: 'p1', nome: 'GRANOLA 1KG', quantidadeDevolvida: 1 }, { id: 'p1', nome: 'GRANOLA 1KG', quantidadeDevolvida: 1 }],
    itensPedido,
    itensNota,
  });
  assert.deepEqual(casados.map((c) => c.itemNumber), [1, 2]);
});

test('casamento: NFC-e da venda usa o id do produto no code (nao o codigo do cadastro)', () => {
  const itensNota = [itemNota('p1', 'GRANOLA 1KG', 10, 20), itemNota('p2', 'BARRA 30G', 100, 2)];
  const { casados, erros } = casarItens({
    itensDevolvidos: [{ id: 'p2', nome: 'BARRA 30G', quantidadeDevolvida: 10 }],
    itensPedido: PEDIDO.itens,
    itensNota,
  });
  assert.deepEqual(erros, []);
  assert.equal(casados[0].itemNumber, 2);
});

test('casamento: erros em portugues (item fora do pedido, fora da nota, quantidade maior)', () => {
  const foraDoPedido = casarItens({ itensDevolvidos: [{ id: 'x', nome: 'FANTASMA', quantidadeDevolvida: 1 }], itensPedido: PEDIDO.itens, itensNota: NOTA.itensFiscais });
  assert.match(foraDoPedido.erros[0], /não foi encontrado no pedido/);

  const foraDaNota = casarItens({
    itensDevolvidos: [{ id: 'p3', nome: 'NOVO', quantidadeDevolvida: 1 }],
    itensPedido: [...PEDIDO.itens, { id: 'p3', nome: 'NOVO', codigoProduto: '9999', quantidade: 2 }],
    itensNota: NOTA.itensFiscais,
  });
  assert.match(foraDaNota.erros[0], /não consta na nota fiscal original/);

  const maior = casarItens({ itensDevolvidos: [{ id: 'p1', nome: 'GRANOLA 1KG', quantidadeDevolvida: 11 }], itensPedido: PEDIDO.itens, itensNota: NOTA.itensFiscais });
  assert.match(maior.erros[0], /maior que a vendida/);
});

test('itens da devolucao: quantidade e valor proporcionais, CFOP mapeado e referencia ao item de origem', () => {
  const { casados } = casarItens({ itensDevolvidos: [{ id: 'p1', nome: 'GRANOLA 1KG', quantidadeDevolvida: 4 }], itensPedido: PEDIDO.itens, itensNota: NOTA.itensFiscais });
  const { itens, erros, precisaCfop } = montarItensDevolucao({ casados, chaveOriginal: CHAVE });
  assert.deepEqual(erros, []);
  assert.deepEqual(precisaCfop, []);
  assert.equal(itens.length, 1);
  const i = itens[0];
  assert.equal(i.cfop, 1202);
  assert.equal(i.quantity, 4);
  assert.equal(i.unitAmount, 20);
  assert.equal(i.totalAmount, 80);
  assert.equal(i.taxes.icms.baseTax, 80);
  assert.equal(i.taxes.icms.amount, 14.4);
  assert.equal(i.taxes.icms.rate, 18);
  assert.deepEqual(i.sourceDocument, { accessKey: CHAVE, itemNumber: 1 });
  assert.equal(i.makeupTotal, true);
  assert.equal(Object.values(i).some((v) => v === undefined), false);
});

test('CFOP sem mapa: pede pro usuario escolher; escolha valida passa; invalida e recusada', () => {
  const notaItens = [itemNota('1019', 'GRANOLA 1KG', 10, 20, 5949)];
  const { casados } = casarItens({ itensDevolvidos: [{ id: 'p1', nome: 'GRANOLA 1KG', quantidadeDevolvida: 1 }], itensPedido: PEDIDO.itens, itensNota: notaItens });
  const sem = montarItensDevolucao({ casados, chaveOriginal: CHAVE });
  assert.equal(sem.itens.length, 0);
  assert.deepEqual(sem.precisaCfop, [{ itemNumber: 1, nome: 'GRANOLA 1KG', cfopOriginal: 5949 }]);

  const com = montarItensDevolucao({ casados, chaveOriginal: CHAVE, cfopEscolhido: { 1: 1202 } });
  assert.equal(com.itens[0].cfop, 1202);

  const invalido = montarItensDevolucao({ casados, chaveOriginal: CHAVE, cfopEscolhido: { 1: 5102 } });
  assert.match(invalido.erros[0], /não é um CFOP de devolução/);
});

test('itens com CFOP de dentro e de fora do estado na mesma devolucao: erro pedindo notas separadas', () => {
  const notaItens = [itemNota('1019', 'GRANOLA 1KG', 10, 20, 5102), itemNota('2001', 'BARRA 30G', 100, 2, 6102)];
  const { casados } = casarItens({
    itensDevolvidos: [{ id: 'p1', nome: 'GRANOLA 1KG', quantidadeDevolvida: 1 }, { id: 'p2', nome: 'BARRA 30G', quantidadeDevolvida: 1 }],
    itensPedido: PEDIDO.itens,
    itensNota: notaItens,
  });
  const r = montarItensDevolucao({ casados, chaveOriginal: CHAVE });
  assert.match(r.erros.join(' '), /dentro e de fora do estado/);
});

test('destinatario PJ completo: dados so com digitos, UF em caixa alta, IE e e-mail da nota', () => {
  const r = montarDestinatario(CLIENTE_PJ);
  assert.deepEqual(r.erros, []);
  assert.equal(r.receiver.federalTaxNumber, '11222333000181');
  assert.equal(r.receiver.stateTaxNumber, '0623079040081');
  assert.equal(r.receiver.email, 'nfe@natumais.com');
  assert.equal(r.receiver.address.postalCode, '36940000');
  assert.equal(r.receiver.address.city.state, 'MG');
  assert.equal(r.receiver.address.city.code, '3139409');
});

test('destinatario: PJ sem IE bloqueia; ISENTO passa; PF nao manda IE', () => {
  assert.match(montarDestinatario({ ...CLIENTE_PJ, identidade: '' }).erros[0], /não tem Inscrição Estadual/);
  assert.equal(montarDestinatario({ ...CLIENTE_PJ, identidade: 'isento' }).receiver.stateTaxNumber, 'ISENTO');
  const pf = montarDestinatario({ ...CLIENTE_PJ, documento: '529.982.247-25', identidade: '123456789' });
  assert.deepEqual(pf.erros, []);
  assert.equal(pf.receiver.stateTaxNumber, undefined);
});

test('destinatario: cadastro incompleto lista o que falta; consumidor final sem dados nao emite', () => {
  const r = montarDestinatario({ ...CLIENTE_PJ, cep: '', codigoIbge: '', bairro: '' });
  assert.match(r.erros[0], /sem bairro, CEP, código IBGE da cidade/);
  assert.match(montarDestinatario({ nome: 'CONSUMIDOR FINAL' }).erros[0], /CPF\/CNPJ/);
  assert.match(montarDestinatario(null).erros[0], /não foi encontrado/);
});

const preparar = (parcial = {}) => prepararDevolucao({
  devolucao: devolvendo({ id: 'p1', nome: 'GRANOLA 1KG', quantidadeDevolvida: 4 }),
  pedido: PEDIDO,
  notas: [NOTA],
  cliente: CLIENTE_PJ,
  agora: new Date('2026-09-21T12:00:00.000Z'),
  ...parcial,
});

test('devolucao completa: previa ok, total certo, receiver e nota original resumida', () => {
  const r = preparar();
  assert.equal(r.ok, true);
  assert.equal(r.valorTotal, 80);
  assert.equal(r.notaOriginal.numero, 5);
  assert.equal(r.notaOriginal.chave, CHAVE);
  assert.equal(r.receiver.name, 'NATUMAIS LTDA');
  assert.deepEqual(r.avisos, []); // nota de 11 dias atras: fora do prazo de cancelamento
});

test('devolucao logo apos a emissao: avisa que talvez seja melhor cancelar', () => {
  const r = preparar({ agora: new Date('2026-09-10T20:00:00.000Z') });
  assert.equal(r.ok, true);
  assert.match(r.avisos[0], /prazo geral de cancelamento/);
});

test('nota original sem itens guardados: bloqueia explicando a exigencia de 01/09/2026', () => {
  const r = preparar({ notas: [{ ...NOTA, itensFiscais: undefined }] });
  assert.equal(r.ok, false);
  assert.match(r.erros[0], /não guardou os itens/);
  assert.match(r.erros[0], /01\/09\/2026/);
});

test('nota original sem chave de acesso: bloqueia', () => {
  const r = preparar({ notas: [{ ...NOTA, accessKey: null }] });
  assert.equal(r.ok, false);
  assert.match(r.erros.join(' '), /chave de acesso/);
});

test('cliente com cadastro incompleto bloqueia a emissao', () => {
  const r = preparar({ cliente: { ...CLIENTE_PJ, identidade: '' } });
  assert.equal(r.ok, false);
  assert.match(r.erros[0], /Inscrição Estadual/);
});

test('CFOP sem mapa: nao e erro, e pedido de escolha (ok false, sem erros, com precisaCfop)', () => {
  const r = preparar({ notas: [{ ...NOTA, itensFiscais: [itemNota('1019', 'GRANOLA 1KG', 10, 20, 5949), NOTA.itensFiscais[1]] }] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.erros, []);
  assert.equal(r.precisaCfop.length, 1);
  const escolhido = preparar({ notas: [{ ...NOTA, itensFiscais: [itemNota('1019', 'GRANOLA 1KG', 10, 20, 5949), NOTA.itensFiscais[1]] }], cfopEscolhido: { 1: 1202 } });
  assert.equal(escolhido.ok, true);
});

test('payload final: finalidade devolucao, entrada, sem pagamento, referencia por item e sem referencedDocuments', () => {
  const r = preparar();
  const payload = montarPayloadDevolucao({ integrationId: 'dev-abc', receiver: r.receiver, itens: r.itens, notaOriginal: NOTA });
  assert.equal(payload.integrationId, 'dev-abc');
  assert.equal(payload.purposeType, 'devolution');
  assert.equal(payload.operationType, 'incoming');
  assert.equal(payload.destination, 'internal');
  assert.equal(payload.presenceType, 'none');
  assert.deepEqual(payload.payments, [{ method: 'noPayment', amount: 0 }]);
  assert.deepEqual(payload.total, { invoiceAmount: 80, productAmount: 80 });
  assert.equal(payload.referencedDocuments, undefined); // nao e' mais aceito na devolucao
  assert.equal(payload.items[0].sourceDocument.accessKey, CHAVE);
  assert.match(payload.additionalInformation, /NF-e Nº 5/);
  assert.match(payload.additionalInformation, new RegExp(CHAVE));
  assert.equal(payload.sendEmailToCustomer, true);
});

test('payload interestadual quando o CFOP de devolucao e 2.xxx', () => {
  const notas = [{ ...NOTA, itensFiscais: [itemNota('1019', 'GRANOLA 1KG', 10, 20, 6102), NOTA.itensFiscais[1]] }];
  const r = preparar({ notas });
  const payload = montarPayloadDevolucao({ integrationId: 'dev-x', receiver: r.receiver, itens: r.itens, notaOriginal: notas[0] });
  assert.equal(payload.destination, 'interstate');
  assert.equal(payload.items[0].cfop, 2202);
});

test('nota de devolucao vigente: em andamento ou autorizada bloqueia nova emissao; rejeitada libera', () => {
  const dev = { id: 'd1' };
  const nota = (status) => ({ id: 'n1', finalidade: 'devolucao', devolucaoId: 'd1', status, number: 7 });
  assert.deepEqual(notaVigenteDaDevolucao(dev, [nota('authorized')]), { notaId: 'n1', status: 'authorized', numero: 7 });
  assert.equal(notaVigenteDaDevolucao(dev, [nota('enqueued')]).status, 'enqueued');
  for (const morto of ['rejected', 'denied', 'canceled']) assert.equal(notaVigenteDaDevolucao(dev, [nota(morto)]), null, morto);
});

test('nota vigente: so conta a nota DESTA devolucao e ignora nota de venda', () => {
  const dev = { id: 'd1' };
  assert.equal(notaVigenteDaDevolucao(dev, [{ id: 'x', finalidade: 'devolucao', devolucaoId: 'outra', status: 'authorized' }]), null);
  assert.equal(notaVigenteDaDevolucao(dev, [{ id: 'y', tipo: 'NF-e', status: 'authorized' }]), null);
});

test('reserva: recente segura a devolucao; antiga (tentativa que morreu) expira', () => {
  const agora = 10_000_000;
  const comReserva = (reservadoEmMs) => ({ id: 'd1', notaFiscalDevolucao: { status: 'reservada', reservadoEmMs } });
  assert.equal(notaVigenteDaDevolucao(comReserva(agora - 60_000), [], agora).status, 'reservada');
  assert.equal(notaVigenteDaDevolucao(comReserva(agora - 6 * 60_000), [], agora), null);
  assert.equal(notaVigenteDaDevolucao({ id: 'd1' }, [], agora), null);
});
