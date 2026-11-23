import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dataHoraDoCupom, documentoDoCupomDoCaixa, htmlDoCupomNaoFiscal, montarCupomNaoFiscal } from '../src/utils/cupomDoCaixaDomain';

/* Cupom no fim da venda da Frente de Caixa (23/11/2026). */

test('qual cupom sai: NFC-e quando a empresa emite cupom fiscal; nao fiscal nos outros casos', () => {
  const emiteCupom = { emiteNFCe: true };
  assert.equal(documentoDoCupomDoCaixa({ controlaFiscal: true, documentosFiscais: emiteCupom, comNotaFiscal: null }), 'nfce');
  // Empresa que nunca marcou nada e controla fiscal: o legado e' cupom fiscal (documentoFiscalVendaDomain).
  assert.equal(documentoDoCupomDoCaixa({ controlaFiscal: true, documentosFiscais: {}, comNotaFiscal: null }), 'nfce');
  assert.equal(documentoDoCupomDoCaixa({ controlaFiscal: false, documentosFiscais: emiteCupom, comNotaFiscal: null }), 'nao_fiscal', 'nao controla fiscal');
  assert.equal(documentoDoCupomDoCaixa({ controlaFiscal: true, documentosFiscais: { emiteNFe: true }, comNotaFiscal: null }), 'nao_fiscal', 'so emite NF-e: nao e\' no balcao');
  assert.equal(documentoDoCupomDoCaixa({ controlaFiscal: true, documentosFiscais: { emiteNFSe: true }, comNotaFiscal: null }), 'nao_fiscal');
  assert.equal(documentoDoCupomDoCaixa({ controlaFiscal: true, documentosFiscais: emiteCupom, comNotaFiscal: false }), 'nao_fiscal', 'pre-venda Sem nota fiscal');
  assert.equal(documentoDoCupomDoCaixa({ controlaFiscal: true, documentosFiscais: emiteCupom, comNotaFiscal: true }), 'nfce');
  assert.equal(documentoDoCupomDoCaixa({ controlaFiscal: true, documentosFiscais: null, comNotaFiscal: undefined }), 'nfce');
});

// Venda como o servidor grava (vendaFechamento.js): pagamento do cartao em 3 linhas (uma por parcela).
const vendaGravada = {
  numeroPedido: '0154',
  clienteNome: 'PADARIA SÃO JOSÉ',
  clienteId: 'cli1',
  vendedorNome: 'BRUNO',
  observacao: 'entregar de manhã',
  itens: [
    { id: 'p1', codigo: '101', nome: 'SACOLA 30X40 <PCT>', precoUnitario: 9, quantidade: 10, desconto: 5, subtotal: 85, unidadeMedidaSigla: 'PCT' },
    { id: 'p2', nome: 'FITA ADESIVA', precoUnitario: 4, quantidade: 0.5, desconto: 0, subtotal: 2 },
  ],
  valorTotalItens: 92,
  valorTotalItensCentavos: 9200,
  valorTotalDescontos: 7,
  valorTotalDescontosCentavos: 700,
  frete: 10,
  encargos: 0,
  valorTotal: 95,
  valorTotalCentavos: 9500,
  pagamentos: [
    { formaPagamento: 'Dinheiro', valor: 5, valorCentavos: 500 },
    { formaPagamento: 'Cartão de Crédito', valor: 30, valorCentavos: 3000, cartao: { numero: 1, totalParcelas: 3 } },
    { formaPagamento: 'Cartão de Crédito', valor: 30, valorCentavos: 3000, cartao: { numero: 2, totalParcelas: 3 } },
    { formaPagamento: 'Cartão de Crédito', valor: 30, valorCentavos: 3000, cartao: { numero: 3, totalParcelas: 3 } },
  ],
};
const empresa = { nomeOficina: 'EMBALA MINAS', cnpj: '12.345.678/0001-90', rua: 'Rua Um', numero: '10', bairro: 'Centro', cidade: 'Manhuaçu', estado: 'MG', telefone: '(33) 3331-0000' };
const emitidoEm = new Date('2026-11-23T17:32:00.000Z');

test('cupom nao fiscal: montado da venda gravada (itens, descontos, frete, pagamentos agrupados, vendedor e caixa)', () => {
  const c = montarCupomNaoFiscal({ venda: vendaGravada, empresa, documentoDoCliente: '12.345.678/0001-00', operador: 'MARIA CAIXA', emitidoEm });
  assert.equal(c.empresa.nome, 'EMBALA MINAS');
  assert.equal(c.empresa.endereco, 'Rua Um - Nº 10 - Centro');
  assert.equal(c.empresa.ie, '');
  assert.equal(c.empresa.cidade, 'Manhuaçu/MG');
  assert.equal(montarCupomNaoFiscal({ venda: vendaGravada, empresa, documentoDoCliente: '43889317000133', operador: '', emitidoEm }).cliente.documento, '43.889.317/0001-33', 'CNPJ gravado so com numeros sai pontuado');
  assert.equal(montarCupomNaoFiscal({ venda: vendaGravada, empresa: { telefone: '33984056924' }, operador: '', emitidoEm }).empresa.telefone, '(33) 98405-6924', 'telefone gravado so com numeros sai formatado');
  assert.equal(c.numeroVenda, '0154');
  assert.equal(c.emitidoEm, '23/11/2026 14:32', 'hora de Brasilia');
  assert.deepEqual(c.cliente, { nome: 'PADARIA SÃO JOSÉ', documento: '12.345.678/0001-00' });
  assert.equal(c.vendedor, 'BRUNO');
  assert.equal(c.operador, 'MARIA CAIXA');
  assert.equal(c.itens.length, 2);
  assert.deepEqual(c.itens[0], { codigo: '101', descricao: 'SACOLA 30X40 <PCT>', quantidade: 10, unidade: 'PCT', precoUnitarioCentavos: 900, descontoCentavos: 500, totalCentavos: 8500 });
  assert.equal(c.itens[1].unidade, 'UN', 'item sem unidade mostra a padrao');
  assert.equal(c.itens[1].totalCentavos, 200, 'meio a R$ 4,00');
  assert.equal(c.subtotalCentavos, 9200);
  assert.equal(c.descontoCentavos, 700);
  assert.equal(c.acrescimoCentavos, 1000);
  assert.equal(c.totalCentavos, 9500);
  assert.deepEqual(c.pagamentos, [
    { forma: 'Dinheiro', valorCentavos: 500, parcelas: 1 },
    { forma: 'Cartão de Crédito', valorCentavos: 9000, parcelas: 3 },
  ], 'o cartao parcelado vira uma linha so\'');
  assert.equal(c.observacao, 'entregar de manhã');
});

test('cupom nao fiscal: venda antiga ou cadastro incompleto nao quebra o papel', () => {
  const c = montarCupomNaoFiscal({ venda: { itens: [{ nome: 'ITEM SEM PRECO' }], valorTotal: 0 }, empresa: null, operador: '', emitidoEm });
  assert.equal(c.empresa.nome, 'EMPRESA');
  assert.equal(c.cliente.nome, 'CONSUMIDOR FINAL');
  assert.equal(c.itens[0].totalCentavos, 0);
  assert.deepEqual(c.pagamentos, []);
});

test('papel no modelo do dono: cabecalho, detalhe da venda em colunas, totais, pagamento, consumidor e numero', () => {
  const html = htmlDoCupomNaoFiscal(montarCupomNaoFiscal({ venda: vendaGravada, empresa: { ...empresa, inscricaoEstadual: '001.234.567.0089' }, documentoDoCliente: '12.345.678/0001-00', operador: 'MARIA CAIXA', emitidoEm }));
  assert.match(html, /@page \{ size: 80mm auto; margin: 0; \}/);
  assert.match(html, /CNPJ 12\.345\.678\/0001-90 I\.E\. 001\.234\.567\.0089/);
  assert.match(html, /Rua Um - Nº 10 - Centro - Manhuaçu\/MG - Fone \(33\) 3331-0000/);
  assert.match(html, /CUPOM NÃO FISCAL/);
  assert.match(html, /DETALHE DA VENDA/);
  assert.match(html, /<th>Código Descrição<\/th><th class="num">Qtd<\/th><th class="un">Un<\/th><th class="num">Vl Un<\/th><th class="num">Vl Tot<\/th>/);
  // Linha do item como no modelo: VLTOT = qtd x vl. unit.; o desconto vai no total.
  assert.match(html, /101 SACOLA 30X40 &lt;PCT&gt;<\/td>\s*<td class="num">10<\/td>\s*<td class="un">PCT<\/td>\s*<td class="num">9,00<\/td>\s*<td class="num">90,00<\/td>/);
  assert.match(html, /FITA ADESIVA<\/td>\s*<td class="num">0,5<\/td>\s*<td class="un">UN<\/td>\s*<td class="num">4,00<\/td>\s*<td class="num">2,00<\/td>/);
  assert.doesNotMatch(html, /<PCT>/, 'nome com < > nao vira tag');
  assert.match(html, /Qtd\. total de itens<\/span><span>2</);
  assert.match(html, /Valor dos produtos<\/span><span>92,00</);
  assert.match(html, /Desconto<\/span><span>- 7,00</);
  assert.match(html, /Outras despesas<\/span><span>10,00</);
  assert.match(html, /VALOR TOTAL R\$<\/span><span>95,00</);
  assert.match(html, /Dinheiro<\/span><span>5,00</);
  assert.match(html, /Cartão de Crédito \(3x\)<\/span><span>90,00</);
  assert.match(html, /NOME: PADARIA SÃO JOSÉ/);
  assert.match(html, /CPF\/CNPJ: 12\.345\.678\/0001-00/);
  assert.match(html, /Venda Nº 0154/);
  assert.match(html, /23\/11\/2026 14:32 - Via Consumidor/);
  assert.match(html, /Vendedor: BRUNO/);
  assert.match(html, /Caixa: MARIA CAIXA/);
  assert.match(html, /Obs\.: entregar de manhã/);
  assert.match(html, /DOCUMENTO SEM VALOR FISCAL/);
});

test('papel nao fiscal nunca imita a nota: sem DANFE, chave de acesso, QR Code, protocolo nem serie', () => {
  const html = htmlDoCupomNaoFiscal(montarCupomNaoFiscal({ venda: vendaGravada, empresa, operador: '', emitidoEm }));
  assert.doesNotMatch(html, /DANFE|CHAVE DE ACESSO|QR Code|PROTOCOLO|Série|Tributos/i);
});

test('papel: consumidor final sai como NAO IDENTIFICADO; zero vira "- - -"; sem I.E., sem caixa; bobina de 58 mm', () => {
  const venda = { ...vendaGravada, clienteNome: 'CONSUMIDOR FINAL', valorTotalDescontosCentavos: 0, valorTotalDescontos: 0, frete: 0, observacao: '' };
  const html = htmlDoCupomNaoFiscal(montarCupomNaoFiscal({ venda, empresa, documentoDoCliente: '123.456.789-00', operador: '', emitidoEm }));
  assert.match(html, /NOME: NÃO IDENTIFICADO/);
  assert.doesNotMatch(html, /CPF\/CNPJ:/, 'documento so\' com consumidor identificado');
  assert.match(html, /Desconto<\/span><span>- - -</);
  assert.match(html, /Outras despesas<\/span><span>- - -</);
  assert.doesNotMatch(html, /I\.E\.|Caixa:|Obs\.:/);
  assert.match(htmlDoCupomNaoFiscal(montarCupomNaoFiscal({ venda, empresa, operador: '', emitidoEm }), 58), /size: 58mm auto/);
});

test('data e hora do cupom em Brasilia, mesmo perto da meia-noite UTC', () => {
  assert.equal(dataHoraDoCupom(new Date('2026-11-24T02:10:00.000Z')), '23/11/2026 23:10');
});
