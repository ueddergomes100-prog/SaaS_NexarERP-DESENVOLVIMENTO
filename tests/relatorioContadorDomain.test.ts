import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DIAS_ANTES_PARA_REENVIO,
  FILTROS_PADRAO_CONTADOR,
  aplicarFiltrosContador,
  cfopDeEntradaDoFornecedor,
  fecharValorComONota,
  formatarCfop,
  instanteDaEmissao,
  linhaDaNotaEmitida,
  linhaDaNotaRecebida,
  montarDocumentoContador,
  opcoesDosFiltros,
  resumoPorCfop,
  resumoPorOperacao,
  situacaoDaNotaEmitida,
  totaisContador,
  valoresZerados,
} from '../src/utils/relatorioContadorDomain';
import { parseNfeXml } from '../src/utils/nfeXmlDomain';
import { somarColuna } from '../src/utils/relatorioPdfDomain';
import { montarItemNotaFiscal, totaisImpostosDosItens, type ProdutoFiscal } from '../src/utils/notaFiscalItemDomain';

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
  assert.equal(cfopDeEntradaDoFornecedor('6108'), '2102', 'venda a nao contribuinte do fornecedor: compra para comercializacao');
  assert.equal(cfopDeEntradaDoFornecedor('5405'), '1403', 'venda com ST: compra com ST (1.405 nao existe)');
  assert.equal(cfopDeEntradaDoFornecedor('6404'), '2403');
  assert.equal(cfopDeEntradaDoFornecedor('7101'), '3101', 'sem equivalente na tabela: so o primeiro digito');
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
  assert.equal(servico.numero, '', 'sem numero: em branco, nunca 0');
  assert.equal(venda.numero, '123');
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

test('nota emitida com itens do construtor REAL da emissao: valor e impostos batem com a nota', () => {
  const farinha: ProdutoFiscal = { nome: 'FARINHA DE AVEIA 500G', codigo: '0028', ncm: '11041200', cfop: '5102', origem: '0', csosn: '102', cstPis: '99', cstCofins: '99', cstIpi: '99', percentualTributos: 13.45 };
  const montar = (produto: ProdutoFiscal, venda: { quantidade: number; precoUnitario: number; desconto: number }, regime: 'simples_nacional' | 'lucro_real') => {
    const r = montarItemNotaFiscal({ produto, venda: { ...venda, unidadeSigla: 'UN' }, contexto: { regime, interestadual: false }, codigoItem: produto.codigo || '1' });
    if (!r.ok) throw new Error(r.erro);
    return r.item as Record<string, unknown>;
  };
  const simples = montar(farinha, { quantidade: 5, precoUnitario: 6.6, desconto: 1.34 }, 'simples_nacional');
  const normal = montar({ ...farinha, codigo: '0029', cfop: '5101', csosn: '00', aliquotaIcms: 18, cstPis: '01', aliquotaPis: 1, cstCofins: '01', aliquotaCofins: 3, cstIpi: '' }, { quantidade: 1, precoUnitario: 100, desconto: 0 }, 'lucro_real');
  const linha = linhaDaNotaEmitida({ id: 'r1', tipo: 'NF-e', status: 'authorized', number: 10, data: '2026-10-01', clienteNome: 'X', itensFiscais: [simples, normal] });
  const esperado = totaisImpostosDosItens([simples, normal]);
  assert.equal(linha.valor, Math.round((31.66 + 100) * 100), 'sem valor gravado: soma dos itens liquida do desconto');
  assert.equal(linha.baseIcms, Math.round(esperado.icmsBaseTax * 100));
  assert.equal(linha.icms, Math.round(esperado.icmsAmount * 100));
  assert.equal(linha.pis, Math.round(esperado.pisAmount * 100));
  assert.equal(linha.cofins, Math.round(esperado.cofinsAmount * 100));
  assert.deepEqual(linha.cfops, ['5101', '5102']);
  assert.deepEqual(linha.porCfop.map((g) => [g.cfop, g.valor]), [['5101', 10000], ['5102', 3166]]);
});

// --- Correcoes de 20/10 (valor contabil, ICMS-ST/IPI, data da transmissao) ---

// Dois itens, dois CFOPs; frete/seguro/desconto/despesas POR ITEM, IPI no 1o, ST no 2o.
// vNF = 150 - 5 + 3,60 (ST) + 10 + 2 + 1 + 4 (IPI) = 165,60.
const XML_DOIS_CFOPS = `<nfeProc><NFe><infNFe Id="NFe35261012768352000170550010000042431123456781"><ide><mod>55</mod><serie>1</serie><nNF>4243</nNF><dhEmi>2026-10-02T10:00:00-03:00</dhEmi></ide>
<emit><CNPJ>12768352000170</CNPJ><xNome>FORNECEDOR</xNome></emit>
<det nItem="1"><prod><cProd>A</cProd><xProd>A</xProd><NCM>10063021</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>1</qCom><vUnCom>100</vUnCom><vProd>100.00</vProd><vFrete>10.00</vFrete><vDesc>5.00</vDesc></prod>
<imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>105.00</vBC><pICMS>18</pICMS><vICMS>18.90</vICMS></ICMS00></ICMS><IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vBC>100.00</vBC><pIPI>4</pIPI><vIPI>4.00</vIPI></IPITrib></IPI>
<PIS><PISAliq><CST>01</CST><vBC>105.00</vBC><pPIS>1.65</pPIS><vPIS>1.73</vPIS></PISAliq></PIS><COFINS><COFINSAliq><CST>01</CST><vBC>105.00</vBC><pCOFINS>7.6</pCOFINS><vCOFINS>7.98</vCOFINS></COFINSAliq></COFINS></imposto></det>
<det nItem="2"><prod><cProd>B</cProd><xProd>B</xProd><NCM>22021000</NCM><CFOP>5405</CFOP><uCom>UN</uCom><qCom>1</qCom><vUnCom>50</vUnCom><vProd>50.00</vProd><vSeg>2.00</vSeg><vOutro>1.00</vOutro></prod>
<imposto><ICMS><ICMS10><orig>0</orig><CST>10</CST><vBC>50.00</vBC><pICMS>18</pICMS><vICMS>9.00</vICMS><vBCST>70.00</vBCST><pICMSST>18</pICMSST><vICMSST>3.60</vICMSST></ICMS10></ICMS></imposto></det>
<total><ICMSTot><vBC>155.00</vBC><vICMS>27.90</vICMS><vBCST>70.00</vBCST><vST>3.60</vST><vProd>150.00</vProd><vFrete>10.00</vFrete><vSeg>2.00</vSeg><vDesc>5.00</vDesc><vIPI>4.00</vIPI><vPIS>1.73</vPIS><vCOFINS>7.98</vCOFINS><vOutro>1.00</vOutro><vNF>165.60</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;

test('nota recebida com o XML (leitor real): valor contabil por CFOP soma frete, seguro, despesas, IPI e ST, menos desconto, e fecha com a nota', () => {
  const nota = parseNfeXml(XML_DOIS_CFOPS);
  const linha = linhaDaNotaRecebida({
    id: 'x1', numeroNF: '4243', dataEmissao: '2026-10-02', fornecedorNome: 'FORNECEDOR', valorTotal: 165.6,
    totais: { ...nota.totais },
    // itens gravados na entrada (sem frete/desconto por item): ignorados quando ha' XML
    itens: [{ cfop: '5102', quantidade: 1, valorUnitario: 100 }, { cfop: '5405', quantidade: 1, valorUnitario: 50 }],
    itensDoXml: nota.itens,
  });
  assert.deepEqual(linha.porCfop.map((g) => [g.cfop, g.valor, g.st, g.ipi, g.baseSt]), [
    ['1102', 10900, 0, 400, 0],
    ['1403', 5660, 360, 0, 7000],
  ]);
  assert.equal(linha.porCfop.reduce((s, g) => s + g.valor, 0), 16560, 'soma dos CFOPs = total da nota');
  assert.equal(linha.valor, 16560);
  assert.equal(linha.st, 360);
  assert.equal(linha.ipi, 400);
  assert.equal(linha.baseSt, 7000);
  assert.equal(linha.icms, 2790);
  const resumo = resumoPorCfop([linha]);
  assert.deepEqual(resumo.map((r) => [r.cfop, r.valor, r.st, r.ipi]), [['1102', 10900, 0, 400], ['1403', 5660, 360, 0]]);
});

test('nota recebida sem XML: itens gravados com IPI/ST e o resto (frete, desconto...) dividido ate fechar com a nota em centavos', () => {
  const linha = linhaDaNotaRecebida({
    id: 'x2', numeroNF: '1', dataEmissao: '2026-10-02', fornecedorNome: 'F', valorTotal: 165.6,
    totais: { total: 165.6, baseIcms: 155, icms: 27.9, baseSt: 70, st: 3.6, ipi: 4, pis: 1.73, cofins: 7.98 },
    itens: [
      { cfop: '5102', quantidade: 1, valorUnitario: 100, impostos: { ipi: { valor: 4 }, icms: { base: 105, valor: 18.9 } } },
      { cfop: '5405', quantidade: 1, valorUnitario: 50, impostos: { icms: { base: 50, valor: 9, baseSt: 70, valorSt: 3.6 } } },
    ],
  });
  // base: 104,00 e 53,60 (157,60); faltam 8,00 divididos na proporcao: 5,28 e 2,72
  assert.deepEqual(linha.porCfop.map((g) => [g.cfop, g.valor]), [['1102', 10928], ['1403', 5632]]);
  assert.equal(linha.porCfop.reduce((s, g) => s + g.valor, 0), 16560);
  assert.equal(linha.st, 360);
  assert.equal(linha.ipi, 400);
});

test('fechamento com a nota: desconto (diferenca negativa), resto de centavos e casos sem base', () => {
  const g = (cfop: string, valor: number) => ({ cfop, ...valoresZerados(), valor });
  assert.deepEqual(fecharValorComONota([g('1102', 1000), g('1403', 1000)], 1999).map((x) => x.valor), [999, 1000]);
  assert.deepEqual(fecharValorComONota([g('1102', 1000), g('1403', 2000)], 3100).map((x) => x.valor), [1033, 2067]);
  assert.deepEqual(fecharValorComONota([g('1102', 0), g('1403', 0)], 500).map((x) => x.valor), [500, 0], 'sem base: no primeiro');
  assert.deepEqual(fecharValorComONota([g('1102', 700)], 0).map((x) => x.valor), [700], 'sem total da nota: fica como esta');
  assert.deepEqual(fecharValorComONota([g('1102', 700)], 700).map((x) => x.valor), [700]);
});

test('nota emitida: valor = soma dos itens transmitidos; sem itens, o valor gravado', () => {
  const comItens = linhaDaNotaEmitida({ id: 'v1', tipo: 'NF-e', status: 'authorized', number: 1, data: '2026-10-01', valor: 999, itensFiscais: [itemSaida(5102, 300)] });
  assert.equal(comItens.valor, 30000);
  assert.equal(servico.valor, 9000, 'NFS-e sem itens fiscais: valor gravado');
  const comIpi = linhaDaNotaEmitida({ id: 'v2', tipo: 'NF-e', status: 'authorized', number: 2, data: '2026-10-01', itensFiscais: [itemSaida(5101, 100, { taxes: { ipi: { amount: 5 } } })] });
  assert.equal(comIpi.valor, 10500, 'IPI soma no total do item');
  assert.equal(comIpi.ipi, 500);
});

test('data da nota emitida: a da ultima transmissao (reenvio da rejeitada), senao a criacao', () => {
  const criada = Date.parse('2026-09-28T15:00:00.000Z');
  assert.equal(instanteDaEmissao('2026-10-02T13:00:00.000Z', criada), Date.parse('2026-10-02T13:00:00.000Z'));
  assert.equal(instanteDaEmissao(undefined, criada), criada);
  assert.equal(instanteDaEmissao('lixo', criada), criada);
  assert.equal(instanteDaEmissao(null, null), null);
  assert.ok(DIAS_ANTES_PARA_REENVIO >= 31);
});

test('lista de notas: o rodape soma so as autorizadas (a cancelada aparece mas nao soma)', () => {
  const doc = montarDocumentoContador([venda, cancelada], { de: '2026-10-01', ate: '2026-10-31', filtros: FILTROS_PADRAO_CONTADOR });
  const notas = doc.secoes.find((s) => s.id === 'notas');
  assert.ok(notas);
  const somar = (id: string) => {
    const coluna = notas.colunas.find((c) => c.id === id);
    assert.ok(coluna, id);
    return somarColuna(coluna, notas.linhas);
  };
  assert.equal(somar('valor'), 30000);
  assert.equal(somar('icms'), 5100);
  assert.ok(notas.colunas.some((c) => c.id === 'st') && notas.colunas.some((c) => c.id === 'ipi'), 'colunas de ICMS-ST e IPI');
  assert.ok(doc.filtros.some((t) => t.includes('Valor contábil = produtos + frete')));
});
