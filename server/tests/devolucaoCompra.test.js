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

test('emitir com transporte: transportadora lida do CADASTRO, placa, volumes e pesos na nota; fica guardado; o total nao muda', async () => {
  chamadas.length = 0;
  resposta = { ok: false, status: 400, corpo: { errors: [{ message: 'Rejeitada para o teste.' }] } };
  const TRANSPORTADORA = { tenantId: 'loja', nome: 'RAPIDO SUL TRANSPORTES LTDA', cnpj: '12.345.678/0001-99', identidade: '123456789', endereco: 'RUA DAS CARGAS', numero: '100', bairro: 'CENTRO', cep: '35500000', cidade: 'DIVINOPOLIS', estado: 'MG', codigoIbge: '3122306' };
  const fake = criarBancoFalso(base({ 'fornecedores/t1': TRANSPORTADORA, 'fornecedores/alheia': { ...TRANSPORTADORA, tenantId: 'outra' } }), { consultas: true });
  const s = carregar(fake.db);
  const dev = await s.registrar({ user: USER, tenantId: 'loja', corpo: pedido() });
  const transporte = {
    modalidade: 'byReceiver', transportadoraId: 't1', transportadoraNome: 'NOME QUE A TELA MANDOU', placa: 'abc1d23', placaUf: 'mg',
    volumes: { quantidade: 5, especie: 'CAIXA', numeracao: '1 a 5', pesoBrutoKg: 82.5, pesoLiquidoKg: 80 },
  };
  // A Spedy recusa de proposito: o transporte tem de ficar guardado para a proxima tentativa.
  await assert.rejects(() => s.emitir({ user: USER, tenantId: 'loja', corpo: { devolucaoId: dev.id, transporte } }), /Rejeitada para o teste/);
  const p = chamadas[0].corpo;
  assert.equal(p.transport.freightModality, 'byReceiver');
  assert.equal(p.transport.carrier.name, 'RAPIDO SUL TRANSPORTES LTDA', 'nome do cadastro, nao o da tela');
  assert.equal(p.transport.carrier.federalTaxNumber, '12345678000199');
  assert.deepEqual(p.transport.vehicle, { plate: 'ABC1D23', state: 'mg' });
  assert.deepEqual(p.transport.volume, { quantity: 5, species: 'CAIXA', volumeNumeration: '1 a 5', netWeight: 80, grossWeight: 82.5 });
  assert.equal(p.total.invoiceAmount, 217.6, 'o transporte nao mexe no total');
  const guardado = fake.ler(`devolucoes_compra/${dev.id}`).transporte;
  assert.equal(guardado.transportadoraNome, 'RAPIDO SUL TRANSPORTES LTDA');
  assert.equal(guardado.volumes.pesoBrutoKg, 82.5);
  assert.equal((await s.listar({ tenantId: 'loja', notaEntradaId: 'n1' }))[0].transporte.placa, 'ABC1D23');

  // "Emitir de novo" sem mandar transporte (tela antiga): usa o guardado.
  chamadas.length = 0;
  await assert.rejects(() => s.emitir({ user: USER, tenantId: 'loja', corpo: { devolucaoId: dev.id } }), /Rejeitada para o teste/);
  assert.equal(chamadas[0].corpo.transport.vehicle.plate, 'ABC1D23');

  // Transporte limpo de proposito (null): a nota sai sem o bloco e o guardado some.
  chamadas.length = 0;
  await assert.rejects(() => s.emitir({ user: USER, tenantId: 'loja', corpo: { devolucaoId: dev.id, transporte: null } }), /Rejeitada para o teste/);
  assert.equal('transport' in chamadas[0].corpo, false);
  assert.equal(fake.ler(`devolucoes_compra/${dev.id}`).transporte, null);

  // Transportadora de OUTRA empresa ou placa errada: barra antes de falar com a Spedy, com a mensagem de onde corrigir.
  chamadas.length = 0;
  await assert.rejects(
    () => s.emitir({ user: USER, tenantId: 'loja', corpo: { devolucaoId: dev.id, transporte: { transportadoraId: 'alheia', transportadoraNome: 'X' } } }),
    (e) => e.status === 422 && /não foi encontrada no cadastro/.test(e.message) && /na janela da nota de devolução/.test(e.message),
  );
  await assert.rejects(
    () => s.emitir({ user: USER, tenantId: 'loja', corpo: { devolucaoId: dev.id, transporte: { placa: 'AB12', placaUf: 'MG' } } }),
    (e) => e.status === 422 && /placa "AB12" não é válida/.test(e.message),
  );
  assert.equal(chamadas.length, 0);
});

test('emitir: Spedy recusa libera a reserva; nota sem XML nao emite', async () => {
  resposta = { ok: false, status: 400, corpo: { errors: [{ message: 'Destinatário inválido.' }] } };
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  const dev = await s.registrar({ user: USER, tenantId: 'loja', corpo: pedido() });
  await assert.rejects(() => s.emitir({ user: USER, tenantId: 'loja', corpo: { devolucaoId: dev.id } }), (e) => /Destinatário inválido/.test(e.message));
  assert.equal(fake.ler(`devolucoes_compra/${dev.id}`).notaFiscal, null);

  // Devolucao registrada antes de 12/11/2026 numa nota sem XML: a emissao continua barrada.
  const semXml = base({ 'devolucoes_compra/antiga': { tenantId: 'loja', notaEntradaId: 'n1', itens: [], motivo: 'Mercadoria com defeito', notaFiscal: null } });
  delete semXml['notas_fiscais_entrada/n1'].xmlGzipBase64;
  const fake2 = criarBancoFalso(semXml, { consultas: true });
  await assert.rejects(() => carregar(fake2.db).emitir({ user: USER, tenantId: 'loja', corpo: { devolucaoId: 'antiga' } }), (e) => e.status === 422 && /não tem o XML guardado/.test(e.message));
});

test('registrar: nota sem o XML guardado ou sem a chave e barrada ANTES de mexer em estoque e financeiro', async () => {
  const semXml = base();
  delete semXml['notas_fiscais_entrada/n1'].xmlGzipBase64;
  const fake = criarBancoFalso(semXml, { consultas: true });
  await assert.rejects(
    () => carregar(fake.db).registrar({ user: USER, tenantId: 'loja', corpo: pedido() }),
    (e) => e.status === 422 && /nº 123 não tem o XML guardado/.test(e.message) && /Nada foi alterado/.test(e.message),
  );
  assert.equal(fake.ler('estoque/p1').quantidade, 150, 'estoque intacto');
  assert.equal(fake.ler('estoque_lotes/l1').quantidade, 150, 'lote intacto');
  assert.equal(fake.ler('transacoes/t2').valorCentavos, 54400, 'parcela intacta');
  assert.equal(fake.ler('notas_fiscais_entrada/n1').devolvidoPorItem, undefined, 'nota sem devolucao marcada');

  const semChave = base();
  semChave['notas_fiscais_entrada/n1'].chaveAcesso = '';
  const fake2 = criarBancoFalso(semChave, { consultas: true });
  await assert.rejects(
    () => carregar(fake2.db).registrar({ user: USER, tenantId: 'loja', corpo: pedido() }),
    (e) => e.status === 422 && /não tem a chave de acesso gravada/.test(e.message),
  );
  assert.equal(fake2.ler('estoque/p1').quantidade, 150);
});
