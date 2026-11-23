import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MENSAGEM_SEM_PERMISSAO_NFCE,
  acaoDeReimpressao,
  dataHoraDoCupom,
  documentoDoCupomDoCaixa,
  filtrarVendasDoCaixa,
  htmlDoCupomNaoFiscal,
  montarCupomNaoFiscal,
  ofereceEmitirCupomFiscal,
  podeEmitirCupomFiscal,
  quandoDaVendaNoCaixa,
  vendasDoCaixa,
} from '../src/utils/cupomDoCaixaDomain';

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

// ------------------------------------------------------------------ Vendas do caixa (F9) e reimpressao

const ts = (iso: string) => ({ toDate: () => new Date(iso) });

test('NFC-e no caixa exige "Fiscal: Emitir Nota Fiscal" (o servidor recusa sem ela); dono e administrador sempre', () => {
  assert.equal(podeEmitirCupomFiscal({ role: 'Funcionario', isOwner: false, permissoes: ['vendas.so_caixa'] }), false);
  assert.equal(podeEmitirCupomFiscal({ role: 'Funcionario', isOwner: false, permissoes: ['vendas.so_caixa', 'fiscal.emitir'] }), true);
  assert.equal(podeEmitirCupomFiscal({ role: 'Funcionario', isOwner: true, permissoes: [] }), true);
  assert.equal(podeEmitirCupomFiscal({ role: 'Admin', isOwner: false, permissoes: null }), true);
  assert.match(MENSAGEM_SEM_PERMISSAO_NFCE, /"Fiscal: Emitir Nota Fiscal"/);
});

test('hora da venda no caixa: venda direta = criacao; pre-venda faturada no caixa = o faturamento', () => {
  assert.equal(quandoDaVendaNoCaixa({ criadoEm: ts('2026-11-23T15:00:00Z'), alteradoEm: ts('2026-11-23T16:00:00Z') })?.toISOString(), '2026-11-23T15:00:00.000Z');
  assert.equal(quandoDaVendaNoCaixa({ faturadoNoCaixa: true, criadoEm: ts('2026-10-21T12:00:00Z'), alteradoEm: ts('2026-11-23T15:12:00Z') })?.toISOString(), '2026-11-23T15:12:00.000Z');
  assert.equal(quandoDaVendaNoCaixa({}), null);
});

const vendasDoTurno = [
  { id: 'v1', numeroPedido: '0201', criadoEm: ts('2026-11-23T13:00:00Z'), clienteNome: 'MARIA', clienteId: 'c1', vendedorNome: 'ANA', valorTotalCentavos: 1000, status: 'Finalizada', pagamentos: [{ formaPagamento: 'Pix', valorCentavos: 1000 }] },
  { id: 'v2', numeroPedido: '0202', criadoEm: ts('2026-11-23T14:00:00Z'), clienteNome: 'JOÃO', valorTotalCentavos: 3000, status: 'Finalizada', pagamentos: [{ formaPagamento: 'Cartão de Crédito', valorCentavos: 1500, cartao: { totalParcelas: 2 } }, { formaPagamento: 'Cartão de Crédito', valorCentavos: 1500, cartao: { totalParcelas: 2 } }] },
  { id: 'v3', numeroPedido: '0203', criadoEm: ts('2026-11-23T15:00:00Z'), clienteNome: 'CONSUMIDOR FINAL', valorTotalCentavos: 500, status: 'Cancelada', pagamentos: [{ formaPagamento: 'Dinheiro', valorCentavos: 500 }] },
  { id: 'v4', numeroPedido: '0154', faturadoNoCaixa: true, criadoEm: ts('2026-10-21T12:00:00Z'), alteradoEm: ts('2026-11-23T15:30:00Z'), clienteNome: 'PADARIA', valorTotalCentavos: 990, status: 'Finalizada', comNotaFiscal: false, pagamentos: [{ formaPagamento: 'Dinheiro', valorCentavos: 990 }] },
];
const notasDoTurno = [
  { tipo: 'NFC-e', pedidoId: 'v1', status: 'rejected', spedyId: 'r1', number: null },
  { tipo: 'NFC-e', pedidoId: 'v1', status: 'authorized', spedyId: 'sp1', number: 77 },
  { tipo: 'NFC-e', pedidoId: 'v2', status: 'rejected', spedyId: 'r2', number: null },
  { tipo: 'NFC-e', pedidoId: 'v2', status: 'authorized', spedyId: 'dev1', number: 5, finalidade: 'devolucao' },
  { tipo: 'NF-e', pedidoId: 'v2', status: 'authorized', spedyId: 'nfe1', number: 9 },
];

test('historico do caixa: mais nova primeiro, formas agrupadas, a melhor NFC-e de cada venda (sem devolucao nem NF-e)', () => {
  const lista = vendasDoCaixa(vendasDoTurno, notasDoTurno);
  assert.deepEqual(lista.map((v) => v.numeroPedido), ['0154', '0203', '0202', '0201'], 'a pre-venda faturada agora entra pela hora do faturamento');
  const [preVenda, cancelada, joao, maria] = lista;
  assert.deepEqual(maria.nota, { spedyId: 'sp1', numero: '77', situacao: 'autorizada' }, 'autorizada vence a rejeitada');
  assert.equal(maria.formas, 'Pix');
  assert.equal(maria.clienteId, 'c1');
  assert.equal(maria.vendedorNome, 'ANA');
  assert.deepEqual(joao.nota, { spedyId: 'r2', numero: '', situacao: 'rejeitada' }, 'nota de devolucao e NF-e nao contam');
  assert.equal(joao.formas, 'Cartão de Crédito (2x)');
  assert.equal(joao.totalCentavos, 3000);
  assert.equal(cancelada.cancelada, true);
  assert.equal(cancelada.nota, null);
  assert.equal(preVenda.comNotaFiscal, false);
});

test('busca do historico: numero sem os zeros, com #, ou cliente sem acento', () => {
  const lista = vendasDoCaixa(vendasDoTurno, notasDoTurno);
  const numeros = (b: string) => filtrarVendasDoCaixa(lista, b).map((v) => v.numeroPedido).sort();
  assert.deepEqual(numeros(''), ['0154', '0201', '0202', '0203']);
  assert.deepEqual(numeros('#202'), ['0202']);
  assert.deepEqual(numeros('201'), ['0201']);
  assert.deepEqual(numeros('joao'), ['0202']);
  assert.deepEqual(numeros('padaria'), ['0154']);
});

test('reimprimir: com NFC-e autorizada reabre o cupom fiscal; sem nota, 2a via do nao fiscal; cancelada nao reimprime', () => {
  const [preVenda, cancelada, joao, maria] = vendasDoCaixa(vendasDoTurno, notasDoTurno);
  assert.deepEqual(acaoDeReimpressao(maria), { tipo: 'pdf_nfce', spedyId: 'sp1' });
  assert.deepEqual(acaoDeReimpressao(joao), { tipo: 'nao_fiscal' }, 'nota rejeitada: o cliente leva o nao fiscal');
  assert.deepEqual(acaoDeReimpressao(preVenda), { tipo: 'nao_fiscal' });
  const bloqueada = acaoDeReimpressao(cancelada);
  assert.equal(bloqueada.tipo, 'bloqueada');
  assert.match(bloqueada.tipo === 'bloqueada' ? bloqueada.motivo : '', /#0203 foi cancelada/);
});

test('emitir cupom fiscal pelo historico: so empresa com NFC-e, venda sem nota boa, nao cancelada nem Sem nota', () => {
  const [preVenda, cancelada, joao, maria] = vendasDoCaixa(vendasDoTurno, notasDoTurno);
  assert.equal(ofereceEmitirCupomFiscal(joao, 'nfce'), true, 'rejeitada na hora: emite de novo');
  assert.equal(ofereceEmitirCupomFiscal(maria, 'nfce'), false, 'ja tem autorizada');
  assert.equal(ofereceEmitirCupomFiscal(cancelada, 'nfce'), false);
  assert.equal(ofereceEmitirCupomFiscal(preVenda, 'nfce'), false, 'Sem nota fiscal');
  assert.equal(ofereceEmitirCupomFiscal(joao, 'nao_fiscal'), false, 'empresa que nao emite NFC-e');
  const aguardando = vendasDoCaixa([vendasDoTurno[1]], [{ tipo: 'NFC-e', pedidoId: 'v2', status: 'processing', spedyId: 'p1' }])[0];
  assert.equal(ofereceEmitirCupomFiscal(aguardando, 'nfce'), false, 'ainda na SEFAZ: nao emite duas vezes');
});

test('2a via do nao fiscal: marcada e com a hora da reimpressao; a 1a via nao leva a marca', () => {
  const cupom = montarCupomNaoFiscal({ venda: vendaGravada, empresa, operador: '', emitidoEm });
  const segunda = htmlDoCupomNaoFiscal(cupom, 80, { reimpressoEm: '23/11/2026 18:40' });
  assert.match(segunda, /2ª VIA/);
  assert.match(segunda, /Reimpresso em 23\/11\/2026 18:40/);
  assert.match(segunda, /23\/11\/2026 14:32 - Via Consumidor/, 'a data da venda continua a da venda');
  assert.doesNotMatch(htmlDoCupomNaoFiscal(cupom), /2ª VIA|Reimpresso/);
});
