import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calcularCustoDaEntrada,
  conferirNota,
  custoMedioPonderado,
  custoUnitarioNoEstoque,
  fatorValido,
  opcoesDeCustoPorRegime,
  quantidadeNoEstoque,
} from '../src/utils/custoEntradaDomain';
import { parseNfeXml } from '../src/utils/nfeXmlDomain';

const SEM_TRIBUTO = { situacao: '', base: 0, aliquota: 0, valor: 0 };
const ICMS_VAZIO = { origem: '0', situacao: '', base: 0, reducaoBase: 0, aliquota: 0, valor: 0, baseSt: 0, aliquotaSt: 0, valorSt: 0, mvaSt: 0, valorDesonerado: 0, valorCreditoSn: 0 };
const item = (extra: Record<string, unknown> = {}) => ({
  quantidade: 10, valorProduto: 100, frete: 0, seguro: 0, desconto: 0, outrasDespesas: 0,
  icms: ICMS_VAZIO, ipi: SEM_TRIBUTO, pis: SEM_TRIBUTO, cofins: SEM_TRIBUTO, ...extra,
});
const totaisVazios = { seguro: 0, desconto: 0, outrasDespesas: 0, ipi: 0, st: 0, icmsDesonerado: 0 };
const NAO_CREDITA = { creditarIcms: false, creditarPisCofins: false };

test('regime decide o que a empresa aproveita de crédito', () => {
  assert.deepEqual(opcoesDeCustoPorRegime('simples_nacional'), NAO_CREDITA);
  assert.deepEqual(opcoesDeCustoPorRegime('lucro_presumido'), { creditarIcms: true, creditarPisCofins: false });
  assert.deepEqual(opcoesDeCustoPorRegime('lucro_real'), { creditarIcms: true, creditarPisCofins: true });
});

test('custo simples: só o valor do produto quando a nota não traz mais nada', () => {
  const [c] = calcularCustoDaEntrada([item()], totaisVazios, 0, NAO_CREDITA);
  assert.equal(c.custoTotal, 100);
  assert.equal(c.custoUnitarioNota, 10);
});

test('custo soma seguro, outras despesas, IPI e ICMS-ST e subtrai o desconto', () => {
  const [c] = calcularCustoDaEntrada([
    item({ seguro: 1, outrasDespesas: 2, desconto: 5, ipi: { ...SEM_TRIBUTO, valor: 7 }, icms: { ...ICMS_VAZIO, valorSt: 3 } }),
  ], { ...totaisVazios, seguro: 1, outrasDespesas: 2, desconto: 5, ipi: 7, st: 3 }, 0, NAO_CREDITA);
  assert.equal(c.custoTotal, 108); // 100 + 1 + 2 + 7 + 3 - 5
  assert.equal(c.custoUnitarioNota, 10.8);
});

test('frete da tela entra rateado pelo valor; o frete por item do XML não é contado de novo', () => {
  const custos = calcularCustoDaEntrada([
    item({ valorProduto: 100, frete: 50 }),
    item({ valorProduto: 300, frete: 50 }),
  ], totaisVazios, 40, NAO_CREDITA);
  assert.deepEqual(custos.map((c) => c.frete), [10, 30]);
  assert.deepEqual(custos.map((c) => c.custoTotal), [110, 330]);
});

test('valor que veio só no total da nota é rateado pelos itens, sem sumir centavo', () => {
  const custos = calcularCustoDaEntrada([item({ valorProduto: 100 }), item({ valorProduto: 200 })], { ...totaisVazios, desconto: 10 }, 0, NAO_CREDITA);
  assert.equal(custos[0].desconto + custos[1].desconto, 10);
  assert.equal(custos[0].custoTotal + custos[1].custoTotal, 290);
});

test('crédito de ICMS/PIS/COFINS só entra se a empresa aproveita; IPI e ST ficam no custo', () => {
  const it = item({ icms: { ...ICMS_VAZIO, valor: 18 }, pis: { ...SEM_TRIBUTO, valor: 1.65 }, cofins: { ...SEM_TRIBUTO, valor: 7.6 } });
  assert.equal(calcularCustoDaEntrada([it], totaisVazios, 0, NAO_CREDITA)[0].custoTotal, 100);
  assert.equal(calcularCustoDaEntrada([it], totaisVazios, 0, { creditarIcms: true, creditarPisCofins: false })[0].custoTotal, 82);
  assert.equal(calcularCustoDaEntrada([it], totaisVazios, 0, { creditarIcms: true, creditarPisCofins: true })[0].custoTotal, 72.75);
});

test('ICMS desonerado reduz o custo (o fornecedor desconta do preço)', () => {
  const [c] = calcularCustoDaEntrada([item({ icms: { ...ICMS_VAZIO, valorDesonerado: 4 } })], { ...totaisVazios, icmsDesonerado: 4 }, 0, NAO_CREDITA);
  assert.equal(c.custoTotal, 96);
});

test('unidade da nota x unidade do estoque: quantidade e custo por unidade de estoque', () => {
  assert.equal(fatorValido(0), 1);
  assert.equal(fatorValido('abc'), 1);
  assert.equal(fatorValido(12), 12);
  assert.equal(quantidadeNoEstoque(3, 12), 36);
  assert.equal(quantidadeNoEstoque(0.5, 1), 0.5);
  // 3 CX (R$ 360 no total), 1 CX = 12 UN: custo por UN = 10
  assert.equal(custoUnitarioNoEstoque(360, 3, 12), 10);
  assert.equal(custoUnitarioNoEstoque(360, 3, undefined), 120);
  assert.equal(custoUnitarioNoEstoque(360, 0, 12), 0);
});

test('custo médio ponderado; estoque zerado ou negativo não pesa', () => {
  assert.equal(custoMedioPonderado(10, 5, 10, 7), 6);
  assert.equal(custoMedioPonderado(0, 5, 10, 7), 7);
  assert.equal(custoMedioPonderado(-20, 5, 10, 7), 7);
  assert.equal(custoMedioPonderado(10, 5, 0, 7), 5);
});

const XML_CONFERENCIA = `<nfeProc><NFe><infNFe Id="NFe35260912768352000170550010000042431123456781"><ide><mod>55</mod><serie>1</serie><nNF>1</nNF><dhEmi>2026-09-10T10:00:00-03:00</dhEmi></ide>
<emit><CNPJ>60161231000109</CNPJ><xNome>F</xNome></emit>
<det nItem="1"><prod><cProd>A</cProd><xProd>A</xProd><NCM>10063021</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>1</qCom><vUnCom>75</vUnCom><vProd>75.00</vProd></prod><imposto/></det>
<total><ICMSTot><vProd>75.00</vProd><vFrete>2.00</vFrete><vSeg>1.00</vSeg><vDesc>3.00</vDesc><vIPI>2.75</vIPI><vST>1.44</vST><vOutro>0.50</vOutro><vNF>79.69</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;

test('conferência: total da nota fecha com a fórmula da NF-e', () => {
  const nota = parseNfeXml(XML_CONFERENCIA);
  const conferencia = conferirNota(nota.itens, nota.totais);
  assert.equal(conferencia.totalCalculado, 79.69);
  assert.equal(conferencia.diferenca, 0);
  assert.equal(conferencia.ok, true);
});

test('conferência: divergência vira aviso em português', () => {
  const nota = parseNfeXml(XML_CONFERENCIA.replace('<vNF>79.69</vNF>', '<vNF>90.00</vNF>'));
  const conferencia = conferirNota(nota.itens, nota.totais);
  assert.equal(conferencia.ok, false);
  assert.match(conferencia.avisos.join(' '), /somam 79,69, mas o total informado é 90,00/);
  const itemErrado = conferirNota([{ valorProduto: 10 }], nota.totais);
  assert.match(itemErrado.avisos[0], /soma dos itens/);
});
