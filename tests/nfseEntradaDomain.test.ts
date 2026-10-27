import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  NFSE_EM_BRANCO,
  calcularValorLiquido,
  conferirNfse,
  descricaoDoTituloDaNfse,
  ehNfseDeEntrada,
  lerNfseXml,
  servicoParaGravar,
  type NfseEntrada,
} from '../src/utils/nfseEntradaDomain';
import { linhaDaNotaRecebida } from '../src/utils/relatorioContadorDomain';

// NFS-e Nacional (leiaute do Ambiente Nacional): servico de contabilidade com
// ISS retido pelo tomador e PIS/COFINS/CSLL/IR retidos.
const NACIONAL = `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00">
  <infNFSe Id="NFS31394002212345678000190000000000001526102012345678">
    <xLocEmi>Manhuaçu</xLocEmi>
    <xLocPrestacao>Manhuaçu</xLocPrestacao>
    <nNFSe>000152</nNFSe>
    <cLocIncid>3139409</cLocIncid>
    <xTribNac>Contabilidade, inclusive serviços técnicos e auxiliares.</xTribNac>
    <dhProc>2026-10-20T10:31:00-03:00</dhProc>
    <emit>
      <CNPJ>12345678000190</CNPJ>
      <IM>12345</IM>
      <xNome>ESCRITORIO CONTABIL EXEMPLO LTDA</xNome>
      <enderNac><xLgr>RUA A</xLgr><nro>10</nro><cMun>3139409</cMun><UF>MG</UF><CEP>36900000</CEP></enderNac>
    </emit>
    <valores>
      <vBC>2000.00</vBC>
      <pAliqAplic>3.00</pAliqAplic>
      <vISSQN>60.00</vISSQN>
      <vTotalRet>183.00</vTotalRet>
      <vLiq>1817.00</vLiq>
    </valores>
    <DPS versao="1.00">
      <infDPS Id="DPS313940921234567800019000900000000000152">
        <dhEmi>2026-10-20T10:30:00-03:00</dhEmi>
        <dCompet>2026-10-01</dCompet>
        <prest><CNPJ>12345678000190</CNPJ></prest>
        <toma><CNPJ>98765432000155</CNPJ><xNome>SOL NATUS LTDA</xNome></toma>
        <serv>
          <locPrest><cLocPrestacao>3139409</cLocPrestacao></locPrest>
          <cServ><cTribNac>171901</cTribNac><xDescServ>Honorários contábeis de outubro/2026</xDescServ></cServ>
        </serv>
        <valores>
          <vServPrest><vServ>2000.00</vServ></vServPrest>
          <trib>
            <tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>2</tpRetISSQN><pAliq>3.00</pAliq></tribMun>
            <tribFed>
              <piscofins><CST>01</CST><vBCPisCofins>2000.00</vBCPisCofins><pAliqPis>0.65</pAliqPis><pAliqCofins>3.00</pAliqCofins><vPis>13.00</vPis><vCofins>60.00</vCofins><tpRetPisCofins>1</tpRetPisCofins></piscofins>
              <vRetIRRF>30.00</vRetIRRF>
              <vRetCSLL>20.00</vRetCSLL>
            </tribFed>
          </trib>
        </valores>
      </infDPS>
    </DPS>
  </infNFSe>
</NFSe>`;

// ABRASF 2.x (prefeitura com sistema proprio): manutencao sem retencao nenhuma.
const ABRASF = `<?xml version="1.0" encoding="UTF-8"?>
<CompNfse xmlns="http://www.abrasf.org.br/nfse.xsd">
  <Nfse versao="2.02">
    <InfNfse Id="nfse789">
      <Numero>789</Numero>
      <CodigoVerificacao>AB12-CD34</CodigoVerificacao>
      <DataEmissao>2026-10-15T08:00:00</DataEmissao>
      <ValoresNfse><BaseCalculo>500.00</BaseCalculo><Aliquota>2.00</Aliquota><ValorIss>10.00</ValorIss><ValorLiquidoNfse>500.00</ValorLiquidoNfse></ValoresNfse>
      <PrestadorServico>
        <IdentificacaoPrestador><CpfCnpj><Cnpj>11222333000144</Cnpj></CpfCnpj><InscricaoMunicipal>999</InscricaoMunicipal></IdentificacaoPrestador>
        <RazaoSocial>MANUTENCAO EXEMPLO ME</RazaoSocial>
        <Endereco><Endereco>RUA B</Endereco><Numero>55</Numero><CodigoMunicipio>3106200</CodigoMunicipio></Endereco>
      </PrestadorServico>
      <DeclaracaoPrestacaoServico>
        <InfDeclaracaoPrestacaoServico>
          <Rps><IdentificacaoRps><Numero>12</Numero><Serie>A</Serie></IdentificacaoRps><DataEmissao>2026-10-14</DataEmissao></Rps>
          <Competencia>2026-10-14</Competencia>
          <Servico>
            <Valores><ValorServicos>500.00</ValorServicos><ValorDeducoes>0</ValorDeducoes></Valores>
            <IssRetido>2</IssRetido>
            <ItemListaServico>14.01</ItemListaServico>
            <Discriminacao>Manutenção da câmara fria</Discriminacao>
            <MunicipioIncidencia>3106200</MunicipioIncidencia>
          </Servico>
          <Tomador><IdentificacaoTomador><CpfCnpj><Cnpj>98765432000155</Cnpj></CpfCnpj></IdentificacaoTomador></Tomador>
        </InfDeclaracaoPrestacaoServico>
      </DeclaracaoPrestacaoServico>
    </InfNfse>
  </Nfse>
</CompNfse>`;

test('NFS-e Nacional: le prestador, valores, ISS retido e retencoes federais', () => {
  const r = lerNfseXml(NACIONAL);
  assert.ok(r.ok);
  const n = r.nota;
  assert.equal(n.padrao, 'nacional');
  assert.equal(n.numero, '152');
  assert.equal(n.chaveAcesso, '31394002212345678000190000000000001526102012345678');
  assert.equal(n.dataEmissao, '2026-10-20');
  assert.equal(n.competencia, '2026-10-01');
  assert.equal(n.prestadorDocumento, '12345678000190');
  assert.equal(n.prestadorNome, 'ESCRITORIO CONTABIL EXEMPLO LTDA');
  assert.equal(n.prestadorInscricaoMunicipal, '12345');
  assert.equal(n.tomadorDocumento, '98765432000155');
  assert.equal(n.municipioPrestacao, 'Manhuaçu');
  assert.equal(n.codigoServico, '171901');
  assert.equal(n.descricaoServico, 'Honorários contábeis de outubro/2026');
  assert.equal(n.valorServicos, 2000);
  assert.equal(n.aliquotaIss, 3);
  assert.equal(n.valorIss, 60);
  assert.equal(n.issRetido, true);
  // 183 retidos = 60 ISS + 30 IR + 20 CSLL + 13 PIS + 60 COFINS
  assert.deepEqual(n.retencoes, { irrf: 30, pis: 13, cofins: 60, csll: 20, inss: 0, outras: 0 });
  assert.equal(n.valorLiquido, 1817);
  assert.equal(calcularValorLiquido(n), 1817);
  assert.deepEqual(conferirNfse(n, '98.765.432/0001-55'), { erros: [], avisos: [] });
});

test('NFS-e Nacional sem PIS/COFINS retidos: o resto do total retido vira "outras"', () => {
  const semPisCofins = NACIONAL.replace('<vTotalRet>183.00</vTotalRet>', '<vTotalRet>150.00</vTotalRet>').replace('<vLiq>1817.00</vLiq>', '<vLiq>1850.00</vLiq>');
  const r = lerNfseXml(semPisCofins);
  assert.ok(r.ok);
  // 150 - 60 ISS - 30 IR - 20 CSLL = 40, que nao bate com PIS+COFINS (73): fica em "outras".
  assert.deepEqual(r.nota.retencoes, { irrf: 30, pis: 0, cofins: 0, csll: 20, inss: 0, outras: 40 });
  assert.equal(r.nota.valorLiquido, 1850);
});

test('ABRASF 2: numero da nota (nao o do RPS nem o do endereco), ISS nao retido', () => {
  const r = lerNfseXml(ABRASF);
  assert.ok(r.ok);
  const n = r.nota;
  assert.equal(n.padrao, 'abrasf');
  assert.equal(n.numero, '789');
  assert.equal(n.codigoVerificacao, 'AB12-CD34');
  assert.equal(n.dataEmissao, '2026-10-15');
  assert.equal(n.competencia, '2026-10-14');
  assert.equal(n.prestadorDocumento, '11222333000144');
  assert.equal(n.prestadorNome, 'MANUTENCAO EXEMPLO ME');
  assert.equal(n.prestadorInscricaoMunicipal, '999');
  assert.equal(n.tomadorDocumento, '98765432000155');
  assert.equal(n.codigoServico, '14.01');
  assert.equal(n.municipioPrestacao, '3106200');
  assert.equal(n.valorServicos, 500);
  assert.equal(n.aliquotaIss, 2);
  assert.equal(n.valorIss, 10);
  assert.equal(n.issRetido, false);
  assert.equal(n.valorLiquido, 500);
});

test('ABRASF 1: aliquota em fracao vira %, retencoes descontam do liquido', () => {
  const v1 = `<ConsultarNfseResposta><ListaNfse><CompNfse><Nfse><InfNfse>
    <Numero>45</Numero><DataEmissao>2026-09-30T14:00:00</DataEmissao>
    <Servico><Valores><ValorServicos>1000.00</ValorServicos><ValorIr>15.00</ValorIr><ValorInss>110.00</ValorInss>
      <IssRetido>1</IssRetido><ValorIss>50.00</ValorIss><BaseCalculo>1000.00</BaseCalculo><Aliquota>0.05</Aliquota></Valores>
      <ItemListaServico>0702</ItemListaServico><Discriminacao>Obra</Discriminacao></Servico>
    <PrestadorServico><IdentificacaoPrestador><Cnpj>11222333000144</Cnpj></IdentificacaoPrestador><RazaoSocial>CONSTRUTORA X</RazaoSocial></PrestadorServico>
  </InfNfse></Nfse></CompNfse></ListaNfse></ConsultarNfseResposta>`;
  const r = lerNfseXml(v1);
  assert.ok(r.ok);
  assert.equal(r.nota.aliquotaIss, 5);
  assert.equal(r.nota.issRetido, true);
  assert.deepEqual(r.nota.retencoes, { irrf: 15, pis: 0, cofins: 0, csll: 0, inss: 110, outras: 0 });
  // Sem ValorLiquidoNfse: 1000 - 50 ISS - 15 IR - 110 INSS
  assert.equal(r.nota.valorLiquido, 825);
});

test('XML que nao e NFS-e: mensagem diz o que fazer', () => {
  const nfe = lerNfseXml('<nfeProc><NFe><infNFe Id="NFe1"/></NFe></nfeProc>');
  assert.equal(nfe.ok, false);
  assert.match(!nfe.ok ? nfe.erro : '', /NF-e.*Entrada de XML/);
  const dps = lerNfseXml('<DPS><infDPS Id="x"/></DPS>');
  assert.equal(dps.ok, false);
  assert.match(!dps.ok ? dps.erro : '', /DPS/);
  const lixo = lerNfseXml('isto nao e xml');
  assert.equal(lixo.ok, false);
  const outro = lerNfseXml('<Pedido><x>1</x></Pedido>');
  assert.equal(outro.ok, false);
  assert.match(!outro.ok ? outro.erro : '', /digitando/);
});

test('conferencia da nota digitada: campos obrigatorios, retencao maior que o servico, tomador de outra empresa', () => {
  const vazia = conferirNfse(NFSE_EM_BRANCO);
  assert.ok(vazia.erros.some((e) => /número/.test(e)));
  assert.ok(vazia.erros.some((e) => /data de emissão/.test(e)));
  assert.ok(vazia.erros.some((e) => /CNPJ/.test(e)));
  assert.ok(vazia.erros.some((e) => /valor dos serviços/.test(e)));

  const base: NfseEntrada = {
    ...NFSE_EM_BRANCO, numero: '10', dataEmissao: '2026-10-27', prestadorDocumento: '11222333000144', prestadorNome: 'X',
    valorServicos: 100, valorLiquido: 100,
  };
  assert.deepEqual(conferirNfse(base), { erros: [], avisos: [] });
  const demais = conferirNfse({ ...base, retencoes: { ...base.retencoes, inss: 150 }, valorLiquido: -50 });
  assert.ok(demais.erros.some((e) => /passam do valor/.test(e)));
  const issSemValor = conferirNfse({ ...base, issRetido: true });
  assert.ok(issSemValor.erros.some((e) => /ISS está marcado como retido/.test(e)));
  const outroTomador = conferirNfse({ ...base, tomadorDocumento: '00111222000133' }, '98765432000155');
  assert.ok(outroTomador.avisos.some((a) => /outro CPF\/CNPJ/.test(a)));
  const liquidoDiferente = conferirNfse({ ...base, valorLiquido: 90 });
  assert.equal(liquidoDiferente.erros.length, 0);
  assert.ok(liquidoDiferente.avisos.some((a) => /não bate/.test(a)));
});

test('titulo, bloco gravado e marcador da NFS-e', () => {
  assert.equal(descricaoDoTituloDaNfse('152', 'ESCRITORIO X'), 'SERVIÇO NFS-e 152 - ESCRITORIO X');
  assert.equal(descricaoDoTituloDaNfse('152', 'ESCRITORIO X', { indice: 1, total: 3 }), 'SERVIÇO NFS-e 152 - ESCRITORIO X (Parcela 2/3)');
  const r = lerNfseXml(NACIONAL);
  assert.ok(r.ok);
  const gravado = servicoParaGravar(r.nota);
  assert.equal(Object.values(gravado).some((v) => v === undefined), false);
  assert.equal(gravado.valorLiquido, 1817);
  assert.equal(ehNfseDeEntrada({ tipoDocumento: 'nfse' }), true);
  assert.equal(ehNfseDeEntrada({}), false);
});

test('Relatorio do Contador: NFS-e recebida vira "servico tomado", sem CFOP', () => {
  const linha = linhaDaNotaRecebida({
    id: 'n1', tipoDocumento: 'nfse', numeroNF: '152', dataEmissao: '2026-10-20', fornecedorNome: 'ESCRITORIO X',
    fornecedorCnpj: '12.345.678/0001-90', valorTotal: 2000, itens: [],
  });
  assert.equal(linha.modelo, 'NFS-e');
  assert.equal(linha.operacao, 'servico_tomado');
  assert.equal(linha.movimento, 'entrada');
  assert.equal(linha.valor, 200000);
  assert.deepEqual(linha.cfops, []);
  assert.equal(linha.documento, '12345678000190');
});
