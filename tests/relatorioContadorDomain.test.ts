import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FILTROS_PADRAO_CONTADOR,
  aplicarFiltrosContador,
  cfopDeEntradaDoFornecedor,
  formatarCfop,
  linhaDaNotaEmitida,
  linhaDaNotaRecebida,
  montarDocumentoContador,
  opcoesDosFiltros,
  resumoPorCfop,
  resumoPorOperacao,
  situacaoDaNotaEmitida,
  totaisContador,
} from '../src/utils/relatorioContadorDomain';

const CHAVE = '32261050672123000147550010000001231000001230';

const itemSaida = (cfop: number, total: number, extra: Record<string, unknown> = {}) => ({
  cfop, totalAmount: total, discountAmount: 0, quantity: 1,
  taxes: { icms: { baseTax: total, amount: total * 0.17 }, pis: { amount: total * 0.0165 }, cofins: { amount: total * 0.076 } },
  ...extra,
});

const venda = linhaDaNotaEmitida({
  id: 'n1', tipo: 'NF-e', status: 'authorized', number: 123, accessKey: CHAVE, data: '2026-10-05',
  clienteNome: 'MARIA', valor: 300, itensFiscais: [itemSaida(5102, 200), itemSaida(5405, 100)],
  cartasCorrecao: [{ texto: 'Corrigir endereço', enviadaEm: '2026-10-06T12:00:00.000Z' }],
  documentoDoCliente: '123.456.789-09', ufDoCliente: 'es',
});
const cancelada = linhaDaNotaEmitida({
  id: 'n2', tipo: 'NFC-e', status: 'canceled', number: 7, data: '2026-10-07', clienteNome: 'JOAO', valor: 50, itensFiscais: [itemSaida(5102, 50)],
});
const devolucao = linhaDaNotaEmitida({
  id: 'n3', tipo: 'NF-e', status: 'authorized', number: 124, data: '2026-10-08', clienteNome: 'MARIA', valor: 20,
  finalidade: 'devolucao', itensFiscais: [itemSaida(1202, 20)],
});
const transferencia = linhaDaNotaEmitida({
  id: 'n4', tipo: 'NF-e', status: 'authorized', number: 125, data: '2026-10-09', clienteNome: 'FILIAL 20', valor: 80,
  finalidade: 'transferencia', itensFiscais: [itemSaida(5152, 80)],
});
const servico = linhaDaNotaEmitida({ id: 'n5', tipo: 'NFS-e', status: 'rejected', number: null, data: '2026-10-10', clienteNome: 'ANA', valor: 90 });
const compra = linhaDaNotaRecebida({
  id: 'e1', numeroNF: '999', serie: '2', modelo: '55', chaveAcesso: '', dataEmissao: '2026-10-03', fornecedorNome: 'DISTRIBUIDORA X',
  fornecedorCnpj: '11222333000181', valorTotal: 500, naturezaOperacao: 'VENDA DE MERCADORIA',
  totais: { total: 510, baseIcms: 500, icms: 60, pis: 8.25, cofins: 38 },
  itens: [{ cfop: '5102', quantidade: 10, valorUnitario: 50, impostos: { icms: { base: 500, valor: 60 }, pis: { valor: 8.25 }, cofins: { valor: 38 } } }],
  ufDoFornecedor: 'MG',
});
const devolucaoDoCliente = linhaDaNotaRecebida({
  id: 'e2', numeroNF: '55', dataEmissao: '2026-10-11', fornecedorNome: 'LOJA CLIENTE', valorTotal: 30,
  itens: [{ cfop: '5202', quantidade: 1, valorUnitario: 30 }],
});
const todas = [venda, cancelada, devolucao, transferencia, servico, compra, devolucaoDoCliente];

test('CFOP: formato do contador e conversao do CFOP do fornecedor para entrada', () => {
  assert.equal(formatarCfop('5102'), '5.102');
  assert.equal(cfopDeEntradaDoFornecedor('5.102'), '1102');
  assert.equal(cfopDeEntradaDoFornecedor('6108'), '2108');
  assert.equal(cfopDeEntradaDoFornecedor('7101'), '3101');
  assert.equal(cfopDeEntradaDoFornecedor('1202'), '1202', 'ja de entrada fica igual');
  assert.equal(cfopDeEntradaDoFornecedor('51'), '', 'CFOP invalido');
});

test('situacao da nota emitida a partir do status da Spedy', () => {
  assert.equal(situacaoDaNotaEmitida('authorized'), 'autorizada');
  assert.equal(situacaoDaNotaEmitida('canceled'), 'cancelada');
  assert.equal(situacaoDaNotaEmitida('cancelada'), 'cancelada');
  assert.equal(situacaoDaNotaEmitida('denied'), 'rejeitada');
  assert.equal(situacaoDaNotaEmitida('enqueued'), 'processando');
});

test('nota emitida: serie da chave, CFOPs por item, impostos, CC-e e operacao', () => {
  assert.equal(venda.serie, '1');
  assert.equal(venda.movimento, 'saida');
  assert.equal(venda.operacao, 'venda');
  assert.equal(venda.valor, 30000);
  assert.equal(venda.icms, 5100);
  assert.deepEqual(venda.cfops, ['5102', '5405']);
  assert.equal(venda.uf, 'ES');
  assert.equal(venda.documento, '12345678909');
  assert.deepEqual(venda.cartas, [{ data: '2026-10-06', texto: 'Corrigir endereço', sequencia: 1 }]);
  assert.equal(devolucao.movimento, 'entrada', 'NF-e de devolucao (CFOP 1.202) e entrada');
  assert.equal(devolucao.operacao, 'devolucao_venda_propria');
  assert.equal(transferencia.operacao, 'transferencia_saida');
  assert.equal(servico.operacao, 'servico');
  assert.equal(servico.situacao, 'rejeitada');
});

test('nota recebida: CFOP convertido, totais do XML e devolucao do cliente', () => {
  assert.deepEqual(compra.cfops, ['1102']);
  assert.deepEqual(compra.cfopsDoXml, ['5102']);
  assert.equal(compra.valor, 51000, 'valor oficial do XML (com frete e outros)');
  assert.equal(compra.icms, 6000);
  assert.equal(compra.operacao, 'compra');
  assert.equal(compra.uf, 'MG');
  assert.equal(compra.serie, '2');
  assert.equal(devolucaoDoCliente.operacao, 'devolucao_venda_cliente');
  assert.equal(devolucaoDoCliente.valor, 3000);
});

test('filtros: padrao tira rejeitada; CFOP, UF, CC-e, operacao e busca', () => {
  const padrao = aplicarFiltrosContador(todas, FILTROS_PADRAO_CONTADOR);
  assert.equal(padrao.length, 6, 'rejeitada fica de fora por padrao');
  assert.equal(padrao[0].id, 'e1', 'em ordem de data');
  const f = (extra: Partial<typeof FILTROS_PADRAO_CONTADOR>) => aplicarFiltrosContador(todas, { ...FILTROS_PADRAO_CONTADOR, ...extra }).map((l) => l.id);
  assert.deepEqual(f({ cfops: ['5.405'] }), ['n1']);
  assert.deepEqual(f({ uf: 'MG' }), ['e1']);
  assert.deepEqual(f({ soComCartaDeCorrecao: true }), ['n1']);
  assert.deepEqual(f({ movimentos: ['entrada'] }), ['e1', 'n3', 'e2']);
  assert.deepEqual(f({ operacoes: ['transferencia_saida'] }), ['n4']);
  assert.deepEqual(f({ modelos: ['NFC-e'] }), ['n2']);
  assert.deepEqual(f({ busca: 'distrib' }), ['e1']);
  assert.deepEqual(f({ busca: '50672123' }), ['n1'], 'parte da chave');
  assert.deepEqual(opcoesDosFiltros(todas).ufs, ['ES', 'MG']);
});

test('resumos: CFOP so de autorizada (e so dos CFOPs filtrados); operacao conta canceladas a parte', () => {
  const linhas = aplicarFiltrosContador(todas, FILTROS_PADRAO_CONTADOR);
  const cfop = resumoPorCfop(linhas);
  const c5102 = cfop.find((r) => r.cfop === '5102');
  assert.ok(c5102);
  assert.equal(c5102.notas, 1, 'a cancelada nao entra');
  assert.equal(c5102.valor, 20000);
  assert.equal(cfop[0].movimento, 'entrada', 'entradas primeiro');
  assert.deepEqual(resumoPorCfop(linhas, ['5405']).map((r) => r.cfop), ['5405']);
  const op = resumoPorOperacao(linhas);
  const vendas = op.find((r) => r.operacao === 'venda');
  assert.ok(vendas);
  assert.equal(vendas.autorizadas, 1);
  assert.equal(vendas.canceladas, 1);
  assert.equal(vendas.valor, 30000);
  const t = totaisContador(linhas);
  assert.equal(t.saidasAutorizadas, 30000 + 8000);
  assert.equal(t.entradasAutorizadas, 51000 + 2000 + 3000);
  assert.equal(t.canceladas, 1);
});

test('documento: quatro secoes, filtros escritos e cartas de correcao', () => {
  const linhas = aplicarFiltrosContador(todas, { ...FILTROS_PADRAO_CONTADOR, cfops: ['5102'] });
  const doc = montarDocumentoContador(linhas, { de: '2026-10-01', ate: '2026-10-31', filtros: { ...FILTROS_PADRAO_CONTADOR, cfops: ['5102'] } });
  assert.equal(doc.periodo, '01/10/2026 a 31/10/2026');
  assert.deepEqual(doc.secoes.map((s) => s.id), ['cfop', 'operacao', 'notas', 'cartas']);
  assert.ok(doc.filtros.some((t) => t === 'CFOP: 5.102'));
  assert.equal(doc.secoes[3].linhas.length, 1);
  assert.equal(doc.indicadores[0].valor, '2');
});
