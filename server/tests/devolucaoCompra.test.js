const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const zlib = require('node:zlib');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

/*
 * Devolucao de compra ao fornecedor (21/10/2026): registrar (estoque, lotes,
 * financeiro) e emitir a NF-e a partir do XML guardado da nota de entrada.
 */

const chamadas = [];
let resposta = null;
const caminhoFetch = require.resolve(path.join(__dirname, '..', 'utils/fetchComTimeout'));
require.cache[caminhoFetch] = {
  id: caminhoFetch, filename: caminhoFetch, loaded: true,
  exports: {
    PERFIS: { spedyEmissao: {}, spedyLeitura: {} },
    fetchComTimeout: async (url, init) => {
      chamadas.push({ url, metodo: init.method, corpo: init.body ? JSON.parse(init.body) : null });
      return { ok: resposta.ok !== false, status: resposta.status || 200, json: async () => resposta.corpo };
    },
  },
};

const carregar = (db) => carregarComBancoFalso(db, 'services/spedyAcesso', 'services/devolucaoCompra').pop();

const CHAVE = '32261011222333000181550010000001231000001234';
const XML = `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe${CHAVE}">
<ide><mod>55</mod><serie>1</serie><nNF>123</nNF><dhEmi>2026-10-01T10:00:00-03:00</dhEmi><tpNF>1</tpNF><finNFe>1</finNFe><natOp>VENDA</natOp></ide>
<emit><CNPJ>11222333000181</CNPJ><xNome>FORNECEDOR LTDA</xNome><IE>082123456</IE><CRT>3</CRT>
<enderEmit><xLgr>RUA A</xLgr><nro>10</nro><xBairro>CENTRO</xBairro><cMun>3205002</cMun><xMun>Serra</xMun><UF>ES</UF><CEP>29160000</CEP></enderEmit></emit>
<dest><CNPJ>99888777000166</CNPJ><xNome>LOJA</xNome></dest>
<det nItem="1"><prod><cProd>R15</cProd><cEAN>SEM GTIN</cEAN><xProd>RACAO 15KG</xProd><NCM>23091000</NCM><CFOP>5403</CFOP><uCom>SC</uCom><qCom>10</qCom><vUnCom>100</vUnCom><vProd>1000</vProd><uTrib>SC</uTrib><qTrib>10</qTrib></prod>
<imposto><ICMS><ICMS10><orig>0</orig><CST>10</CST><vBC>1000</vBC><pICMS>17</pICMS><vICMS>170</vICMS><pMVAST>40</pMVAST><vBCST>1400</vBCST><pICMSST>17</pICMSST><vICMSST>68</vICMSST></ICMS10></ICMS>
<IPI><IPITrib><CST>50</CST><vBC>1000</vBC><pIPI>2</pIPI><vIPI>20</vIPI></IPITrib></IPI></imposto></det>
<total><ICMSTot><vBC>1000</vBC><vICMS>170</vICMS><vBCST>1400</vBCST><vST>68</vST><vProd>1000</vProd><vIPI>20</vIPI><vNF>1088</vNF></ICMSTot></total>
</infNFe></NFe></nfeProc>`;

const USER = { uid: 'u1', tenantId: 'loja', email: 'u@loja', nome: 'COMPRAS', permissoes: ['fiscal.entrada', 'fiscal.emitir'] };
const itemNota = {
  itemId: 'p1', tipo: 'revenda', codigoXml: 'R15', descricaoXml: 'RACAO 15KG', quantidade: 10, valorUnitario: 100, unidadeNota: 'SC', fator: 15,
  cfop: '5403', cfopEntrada: '1403', impostos: { icms: { valorSt: 68 }, ipi: { valor: 20 } },
  lotes: [{ loteId: 'l1', lote: 'A', validade: '2027-01-01', quantidade: 150 }],
};
const base = (extra = {}) => ({
  'configuracoes/loja': { tenantId: 'loja', spedyEnabled: true, spedyEnvironment: 'sandbox', regimeTributario: 'simples_nacional' },
  'configuracoes_privadas/loja': { spedyApiKey: 'chave-teste' },
  'notas_fiscais_entrada/n1': {
    tenantId: 'loja', status: 'ativa', numeroNF: '123', serie: '1', dataEmissao: '2026-10-01', chaveAcesso: CHAVE,
    fornecedorId: 'f1', fornecedorNome: 'FORNECEDOR LTDA', itens: [itemNota], titulosPagarIds: ['t1', 't2'],
    xmlGzipBase64: zlib.gzipSync(Buffer.from(XML, 'utf8')).toString('base64'),
  },
  'fornecedores/f1': { tenantId: 'loja', nome: 'FORNECEDOR LTDA', cnpj: '11222333000181' },
  'estoque/p1': { tenantId: 'loja', nome: 'RAÇÃO', quantidade: 150 },
  'estoque_lotes/l1': { tenantId: 'loja', produtoId: 'p1', quantidade: 150 },
  'transacoes/t1': { tenantId: 'loja', tipo: 'saida', status: 'Pendente', valorCentavos: 54400, valor: 544, dataVencimento: '2026-11-01' },
  'transacoes/t2': { tenantId: 'loja', tipo: 'saida', status: 'Pendente', valorCentavos: 54400, valor: 544, dataVencimento: '2026-12-01' },
  ...extra,
});
const pedido = (extra = {}) => ({ notaEntradaId: 'n1', itens: [{ indice: 0, quantidade: 2 }], motivo: 'Mercadoria com defeito', ...extra });

test('registrar: tira do estoque e do lote, abate a ultima parcela e marca o devolvido na nota', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const r = await carregar(fake.db).registrar({ user: USER, tenantId: 'loja', corpo: pedido() });
  // 2 SC x R$ 100 + ST 13,60 + IPI 4,00 = 217,60
  assert.equal(r.totalCentavos, 21760);
  assert.equal(fake.ler('estoque/p1').quantidade, 120);
  assert.equal(fake.ler('estoque_lotes/l1').quantidade, 120);
  assert.equal(fake.ler('transacoes/t2').valorCentavos, 54400 - 21760, 'a ultima parcela');
  assert.equal(fake.ler('transacoes/t1').valorCentavos, 54400);
  assert.equal(r.aReceberCentavos, 0);
  assert.deepEqual(fake.ler('notas_fiscais_entrada/n1').devolvidoPorItem, { 0: 2 });
  assert.equal(fake.ler(`devolucoes_compra/${r.id}`).motivo, 'Mercadoria com defeito');
});

test('registrar: o que ja foi pago vira conta a receber do fornecedor; limite do que sobrou e do estoque', async () => {
  const pago = base({
    'transacoes/t1': { tenantId: 'loja', tipo: 'saida', status: 'Paga', valorCentavos: 54400 },
    'transacoes/t2': { tenantId: 'loja', tipo: 'saida', status: 'Paga', valorCentavos: 54400 },
  });
  const fake = criarBancoFalso(pago, { consultas: true });
  const s = carregar(fake.db);
  const r = await s.registrar({ user: USER, tenantId: 'loja', corpo: pedido() });
  assert.equal(r.aReceberCentavos, 21760);
  const receber = fake.ler(`transacoes/devolucao_compra_${r.id}`);
  assert.equal(receber.tipo, 'entrada');
  assert.equal(receber.status, 'Pendente');
  assert.equal(receber.clienteNome, 'FORNECEDOR LTDA');
  await assert.rejects(() => s.registrar({ user: USER, tenantId: 'loja', corpo: pedido({ itens: [{ indice: 0, quantidade: 9 }] }) }), (e) => e.status === 409 && /no máximo 8/.test(e.message));

  const semEstoque = criarBancoFalso(base({ 'estoque/p1': { tenantId: 'loja', nome: 'RAÇÃO', quantidade: 10 } }), { consultas: true });
  await assert.rejects(() => carregar(semEstoque.db).registrar({ user: USER, tenantId: 'loja', corpo: pedido() }), (e) => e.status === 409 && /tem só 10 em estoque/.test(e.message));
  assert.equal(semEstoque.ler('estoque/p1').quantidade, 10, 'nada gravado');
});

test('emitir: NF-e de saida, finalidade devolucao, item referenciando a nota do fornecedor, endereco do XML', async () => {
  chamadas.length = 0;
  resposta = { corpo: { id: '3f1c2b7e-0000-4000-8000-0000000000aa', status: 'enqueued', number: 55 } };
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  const dev = await s.registrar({ user: USER, tenantId: 'loja', corpo: pedido() });
  const r = await s.emitir({ user: USER, tenantId: 'loja', corpo: { devolucaoId: dev.id } });
  assert.equal(chamadas[0].url, 'https://sandbox-api.spedy.com.br/v1/product-invoices');
  const p = chamadas[0].corpo;
  assert.equal(p.operationType, 'outgoing');
  assert.equal(p.purposeType, 'devolution');
  assert.equal(p.integrationId, `dc-${dev.id}`);
  assert.deepEqual(p.items[0].sourceDocument, { accessKey: CHAVE, itemNumber: 1 });
  assert.equal(p.items[0].cfop, 5411);
  assert.equal(p.items[0].taxes.icms.csosn, 900);
  assert.equal(p.items[0].ipiReturnedAmount, 4);
  assert.deepEqual(p.receiver.address.city, { code: '3205002', name: 'Serra', state: 'ES' });
  assert.equal(p.total.invoiceAmount, 217.6);
  const nota = fake.ler(`notas_fiscais/${r.notaId}`);
  assert.equal(nota.finalidade, 'devolucao_compra');
  assert.equal(nota.devolucaoCompraId, dev.id);
  assert.equal(fake.ler(`devolucoes_compra/${dev.id}`).notaFiscal.status, 'enqueued');
  // Ja tem nota em andamento: nao emite de novo.
  await assert.rejects(() => s.emitir({ user: USER, tenantId: 'loja', corpo: { devolucaoId: dev.id } }), (e) => e.status === 409);
});

test('emitir: Spedy recusa libera a reserva; nota sem XML nao emite', async () => {
  resposta = { ok: false, status: 400, corpo: { errors: [{ message: 'Destinatário inválido.' }] } };
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  const dev = await s.registrar({ user: USER, tenantId: 'loja', corpo: pedido() });
  await assert.rejects(() => s.emitir({ user: USER, tenantId: 'loja', corpo: { devolucaoId: dev.id } }), (e) => /Destinatário inválido/.test(e.message));
  assert.equal(fake.ler(`devolucoes_compra/${dev.id}`).notaFiscal, null);

  const semXml = base();
  delete semXml['notas_fiscais_entrada/n1'].xmlGzipBase64;
  const fake2 = criarBancoFalso(semXml, { consultas: true });
  const s2 = carregar(fake2.db);
  const dev2 = await s2.registrar({ user: USER, tenantId: 'loja', corpo: pedido() });
  await assert.rejects(() => s2.emitir({ user: USER, tenantId: 'loja', corpo: { devolucaoId: dev2.id } }), (e) => e.status === 422 && /não tem o XML guardado/.test(e.message));
});
