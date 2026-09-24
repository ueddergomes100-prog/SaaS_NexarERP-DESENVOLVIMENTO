import assert from 'node:assert/strict';
import { test } from 'node:test';
import { descendente, lerXml, numeroDe, textoDe } from '../src/utils/xmlSimplesDomain';
import { parseNfeXml, rotuloDaFormaDePagamento } from '../src/utils/nfeXmlDomain';

const CHAVE = '35260912768352000170550010000042431123456781';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe><infNFe Id="NFe${CHAVE}" versao="4.00">
    <ide><cUF>35</cUF><natOp>VENDA DE MERCADORIA ADQUIRIDA</natOp><mod>55</mod><serie>1</serie><nNF>4243</nNF>
      <dhEmi>2026-09-10T10:30:00-03:00</dhEmi><dhSaiEnt>2026-09-11T08:00:00-03:00</dhSaiEnt><tpNF>1</tpNF><finNFe>1</finNFe></ide>
    <emit><CNPJ>60161231000109</CNPJ><xNome>FORNECEDOR &amp; FILHOS LTDA</xNome><xFant>FORN</xFant>
      <enderEmit><xLgr>RUA DAS FLORES</xLgr><nro>100</nro><xBairro>CENTRO</xBairro><xMun>SAO PAULO</xMun><UF>SP</UF><CEP>01001000</CEP><fone>1133334444</fone></enderEmit>
      <IE>111222333444</IE><CRT>3</CRT></emit>
    <dest><CNPJ>12345678000199</CNPJ><xNome>SOL LIFE PRODUTOS NATURAIS EIRELI</xNome><enderDest><xLgr>AV BRASIL</xLgr><nro>5</nro><xMun>RIO</xMun><UF>RJ</UF></enderDest></dest>
    <det nItem="1"><prod><cProd>ARZ-01</cProd><cEAN>7891234567895</cEAN><xProd>ARROZ INTEGRAL 1KG</xProd><NCM>10063021</NCM><CEST>1700100</CEST><CFOP>5102</CFOP>
        <uCom>PCT</uCom><qCom>10.0000</qCom><vUnCom>5.5000000000</vUnCom><vProd>55.00</vProd><cEANTrib>7891234567895</cEANTrib><uTrib>PCT</uTrib><qTrib>10.0000</qTrib>
        <vFrete>2.00</vFrete><vSeg>1.00</vSeg><vDesc>3.00</vDesc><vOutro>0.50</vOutro><xPed>PED-9</xPed>
        <rastro><nLote>L2026-1</nLote><qLote>10.000</qLote><dFab>2026-08-01</dFab><dVal>2027-08-01</dVal></rastro></prod>
      <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>55.00</vBC><pICMS>18.00</pICMS><vICMS>9.90</vICMS></ICMS00></ICMS>
        <IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vBC>55.00</vBC><pIPI>5.00</pIPI><vIPI>2.75</vIPI></IPITrib></IPI>
        <PIS><PISAliq><CST>01</CST><vBC>55.00</vBC><pPIS>1.65</pPIS><vPIS>0.91</vPIS></PISAliq></PIS>
        <COFINS><COFINSAliq><CST>01</CST><vBC>55.00</vBC><pCOFINS>7.60</pCOFINS><vCOFINS>4.18</vCOFINS></COFINSAliq></COFINS></imposto>
      <infAdProd>Validade 12 meses</infAdProd></det>
    <det nItem="2"><prod><cProd>ZZ-99</cProd><cEAN>SEM GTIN</cEAN><xProd>PRODUTO COM ST</xProd><NCM>22021000</NCM><CFOP>5405</CFOP>
        <uCom>UN</uCom><qCom>2.0000</qCom><vUnCom>10.0000000000</vUnCom><vProd>20.00</vProd></prod>
      <imposto><ICMS><ICMS10><orig>1</orig><CST>10</CST><vBC>20.00</vBC><pICMS>18.00</pICMS><vICMS>3.60</vICMS><vBCST>28.00</vBCST><pMVAST>40.00</pMVAST><pICMSST>18.00</pICMSST><vICMSST>1.44</vICMSST></ICMS10></ICMS>
        <IPI><cEnq>999</cEnq><IPINT><CST>53</CST></IPINT></IPI>
        <PIS><PISNT><CST>04</CST></PISNT></PIS><COFINS><COFINSNT><CST>04</CST></COFINSNT></COFINS></imposto></det>
    <total><ICMSTot><vBC>75.00</vBC><vICMS>13.50</vICMS><vICMSDeson>0.00</vICMSDeson><vBCST>28.00</vBCST><vST>1.44</vST><vProd>75.00</vProd><vFrete>2.00</vFrete><vSeg>1.00</vSeg>
      <vDesc>3.00</vDesc><vII>0.00</vII><vIPI>2.75</vIPI><vPIS>0.91</vPIS><vCOFINS>4.18</vCOFINS><vOutro>0.50</vOutro><vNF>79.69</vNF></ICMSTot></total>
    <transp><modFrete>0</modFrete><transporta><CNPJ>11021044000114</CNPJ><xNome>TELES LOGISTICA</xNome><IE>ISENTO</IE><xEnder>RUA X 1</xEnder><xMun>SANTOS</xMun><UF>SP</UF></transporta>
      <veicTransp><placa>ABC1D23</placa></veicTransp><vol><qVol>3</qVol><esp>CAIXA</esp><marca>FORN</marca><nVol>1</nVol><pesoL>10.500</pesoL><pesoB>11.000</pesoB></vol></transp>
    <cobr><fat><nFat>4243</nFat><vOrig>79.69</vOrig><vLiq>79.69</vLiq></fat><dup><nDup>001</nDup><dVenc>2026-10-10</dVenc><vDup>40.00</vDup></dup><dup><nDup>002</nDup><dVenc>2026-11-10</dVenc><vDup>39.69</vDup></dup></cobr>
    <pag><detPag><tPag>15</tPag><vPag>79.69</vPag></detPag></pag>
    <infAdic><infCpl>Pedido 9 entregue no deposito.</infCpl></infAdic>
  </infNFe></NFe>
  <protNFe><infProt><chNFe>${CHAVE}</chNFe><dhRecbto>2026-09-10T10:31:00-03:00</dhRecbto><nProt>135260000012345</nProt><cStat>100</cStat></infProt></protNFe>
</nfeProc>`;

test('leitor de XML: entidades, atributos, autofechada, comentário e CDATA', () => {
  const raiz = lerXml('<?xml version="1.0"?><!-- x --><a:raiz id="1"><b>1 &amp; 2 &lt;3&gt; &#65;</b><c/><d><![CDATA[<n>&]]></d></a:raiz>');
  assert.equal(raiz.nome, 'raiz');
  assert.equal(raiz.atributos.id, '1');
  assert.equal(textoDe(raiz, 'b'), '1 & 2 <3> A');
  assert.equal(descendente(raiz, 'c')?.filhos.length, 0);
  assert.equal(textoDe(raiz, 'd'), '<n>&');
  assert.equal(numeroDe(raiz, 'b'), 0);
});

test('leitor de XML: arquivo quebrado dá erro em português', () => {
  assert.throws(() => lerXml('<a><b></a>'), /corrompido ou inválido/);
  assert.throws(() => lerXml('<a>'), /corrompido ou inválido/);
  assert.throws(() => lerXml('texto solto'), /corrompido ou inválido/);
  assert.throws(() => lerXml(''), /corrompido ou inválido/);
});

test('NF-e: cabeçalho, chave, série, natureza, datas e protocolo', () => {
  const nota = parseNfeXml(XML);
  assert.equal(nota.chave, CHAVE);
  assert.equal(nota.modelo, '55');
  assert.equal(nota.serie, '1');
  assert.equal(nota.numero, '4243');
  assert.equal(nota.naturezaOperacao, 'VENDA DE MERCADORIA ADQUIRIDA');
  assert.equal(nota.dataEmissao, '2026-09-10');
  assert.equal(nota.dataSaida, '2026-09-11');
  assert.equal(nota.protocolo, '135260000012345');
  assert.equal(nota.emitente.documento, '60161231000109');
  assert.equal(nota.emitente.nome, 'FORNECEDOR & FILHOS LTDA');
  assert.equal(nota.emitente.regime, '3');
  assert.equal(nota.emitente.endereco.municipio, 'SAO PAULO');
  assert.equal(nota.destinatario.documento, '12345678000199');
});

test('NF-e: itens com desconto, seguro, frete, outras despesas, pedido e lote', () => {
  const [a, b] = parseNfeXml(XML).itens;
  assert.equal(parseNfeXml(XML).itens.length, 2);
  assert.equal(a.numero, 1);
  assert.equal(a.codigo, 'ARZ-01');
  assert.equal(a.ean, '7891234567895');
  assert.equal(a.ncm, '10063021');
  assert.equal(a.cest, '1700100');
  assert.equal(a.unidade, 'PCT');
  assert.equal(a.quantidade, 10);
  assert.equal(a.valorUnitario, 5.5);
  assert.equal(a.valorProduto, 55);
  assert.equal(a.frete, 2);
  assert.equal(a.seguro, 1);
  assert.equal(a.desconto, 3);
  assert.equal(a.outrasDespesas, 0.5);
  assert.equal(a.pedido, 'PED-9');
  assert.equal(a.informacaoAdicional, 'Validade 12 meses');
  assert.deepEqual(a.lotes, [{ numero: 'L2026-1', fabricacao: '2026-08-01', validade: '2027-08-01', quantidade: 10 }]);
  assert.equal(b.ean, '', '"SEM GTIN" não é código de barras');
  assert.equal(b.frete, 0);
});

test('NF-e: impostos do item (ICMS, ST, IPI, PIS, COFINS), inclusive os grupos "não tributado"', () => {
  const [a, b] = parseNfeXml(XML).itens;
  assert.deepEqual(a.icms, { origem: '0', situacao: '00', base: 55, reducaoBase: 0, aliquota: 18, valor: 9.9, baseSt: 0, aliquotaSt: 0, valorSt: 0, mvaSt: 0, valorDesonerado: 0, valorCreditoSn: 0 });
  assert.deepEqual(a.ipi, { situacao: '50', base: 55, aliquota: 5, valor: 2.75 });
  assert.deepEqual(a.pis, { situacao: '01', base: 55, aliquota: 1.65, valor: 0.91 });
  assert.deepEqual(a.cofins, { situacao: '01', base: 55, aliquota: 7.6, valor: 4.18 });
  assert.equal(b.icms.situacao, '10');
  assert.equal(b.icms.origem, '1');
  assert.equal(b.icms.valorSt, 1.44);
  assert.equal(b.icms.baseSt, 28);
  assert.equal(b.icms.mvaSt, 40);
  assert.deepEqual(b.ipi, { situacao: '53', base: 0, aliquota: 0, valor: 0 });
  assert.equal(b.pis.situacao, '04');
  assert.equal(b.cofins.valor, 0);
});

test('NF-e: totais, transporte, duplicatas, pagamento e informações complementares', () => {
  const nota = parseNfeXml(XML);
  assert.equal(nota.totais.produtos, 75);
  assert.equal(nota.totais.frete, 2);
  assert.equal(nota.totais.seguro, 1);
  assert.equal(nota.totais.desconto, 3);
  assert.equal(nota.totais.outrasDespesas, 0.5);
  assert.equal(nota.totais.ipi, 2.75);
  assert.equal(nota.totais.st, 1.44);
  assert.equal(nota.totais.total, 79.69);
  assert.equal(nota.transporte.transportadoraNome, 'TELES LOGISTICA');
  assert.equal(nota.transporte.transportadoraDocumento, '11021044000114');
  assert.equal(nota.transporte.placa, 'ABC1D23');
  assert.deepEqual(nota.transporte.volumes[0], { quantidade: 3, especie: 'CAIXA', marca: 'FORN', numeracao: '1', pesoLiquido: 10.5, pesoBruto: 11 });
  assert.deepEqual(nota.duplicatas, [
    { numero: '001', vencimento: '2026-10-10', valor: 40 },
    { numero: '002', vencimento: '2026-11-10', valor: 39.69 },
  ]);
  assert.deepEqual(nota.pagamentos, [{ forma: '15', descricao: '', valor: 79.69 }]);
  assert.equal(rotuloDaFormaDePagamento('15'), 'Boleto bancário');
  assert.equal(rotuloDaFormaDePagamento('xx'), 'Outros');
  assert.equal(nota.informacoesComplementares, 'Pedido 9 entregue no deposito.');
});

test('NF-e: arquivo que não é nota mercadoria dá erro que diz o que fazer', () => {
  assert.throws(() => parseNfeXml('<resNFe><chNFe>1</chNFe></resNFe>'), /resumo da nota/);
  assert.throws(() => parseNfeXml('<cteProc><CTe/></cteProc>'), /CT-e/);
  assert.throws(() => parseNfeXml('<qualquer><coisa/></qualquer>'), /Nenhuma NF-e/);
  assert.throws(() => parseNfeXml('<nfeProc><NFe><infNFe Id="NFe1"><ide/></infNFe></NFe></nfeProc>'), /Nenhum produto/);
});

test('NF-e sem envelope nfeProc e sem chave no Id: usa a do protocolo, ou fica vazia', () => {
  const semEnvelope = XML.replace(/<nfeProc[^>]*>/, '').replace('</nfeProc>', '').replace(/<protNFe>[\s\S]*<\/protNFe>/, '');
  const nota = parseNfeXml(semEnvelope.replace(`Id="NFe${CHAVE}"`, 'Id="NFe123"'));
  assert.equal(nota.chave, '');
  assert.equal(nota.itens.length, 2);
});

test('XML com marca de ordem de bytes (BOM) no começo abre normalmente', () => {
  const nota = parseNfeXml(String.fromCharCode(0xFEFF) + XML);
  assert.equal(nota.numero, '4243');
});
