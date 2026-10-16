import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONFIG_ORCAMENTO_PADRAO,
  MODELOS_ORCAMENTO,
  avisoDaConfigOrcamento,
  camposExtrasParaGravar,
  linhasDoOrcamentoGravado,
  linhasDoPdfDoOrcamento,
  modeloDaConfig,
  mostraVeiculo,
  parseConfigOrcamento,
  reaisDoCampo,
  textoCondicaoPagamento,
  textoHoras,
  textoPrazoEntrega,
  totaisDoPdfDoOrcamento,
  totalDoOrcamentoCentavos,
} from '../src/utils/orcamentoModeloDomain';

const VAZIOS = { vendedorId: '', vendedorNome: '', condicaoForma: '', condicaoDetalhe: '', prazoEntregaDias: '', frete: '' };

test('sem configuracao gravada = oficina = o orcamento de sempre', () => {
  assert.deepEqual(parseConfigOrcamento(undefined), CONFIG_ORCAMENTO_PADRAO);
  assert.deepEqual(parseConfigOrcamento('lixo'), CONFIG_ORCAMENTO_PADRAO);
  assert.equal(modeloDaConfig(parseConfigOrcamento(null)), 'oficina');
  assert.equal(CONFIG_ORCAMENTO_PADRAO.mostrarVeiculo && CONFIG_ORCAMENTO_PADRAO.usaServicos && CONFIG_ORCAMENTO_PADRAO.converterEmOS, true);
});

test('so booleano conta; o resto fica no padrao', () => {
  const config = parseConfigOrcamento({ mostrarVeiculo: false, frete: 'sim', vendedor: true });
  assert.equal(config.mostrarVeiculo, false);
  assert.equal(config.frete, false);
  assert.equal(config.vendedor, true);
});

test('modelo pronto e personalizado', () => {
  assert.equal(modeloDaConfig(MODELOS_ORCAMENTO.comercio.config), 'comercio');
  assert.equal(modeloDaConfig(MODELOS_ORCAMENTO.servicos.config), 'servicos');
  assert.equal(modeloDaConfig({ ...MODELOS_ORCAMENTO.comercio.config, frete: false }), 'personalizado');
  const comercio = MODELOS_ORCAMENTO.comercio.config;
  assert.equal(comercio.mostrarVeiculo || comercio.usaServicos || comercio.converterEmOS, false);
  assert.equal(comercio.vendedor && comercio.condicaoPagamento && comercio.prazoEntrega && comercio.frete, true);
});

test('aviso quando servico fica sem OS (ou OS sem servico)', () => {
  assert.match(String(avisoDaConfigOrcamento({ ...CONFIG_ORCAMENTO_PADRAO, converterEmOS: false })), /não têm como ser cobrados/);
  assert.match(String(avisoDaConfigOrcamento({ ...CONFIG_ORCAMENTO_PADRAO, usaServicos: false })), /só com os produtos/);
  assert.equal(avisoDaConfigOrcamento(MODELOS_ORCAMENTO.comercio.config), null);
});

test('veiculo ja gravado continua aparecendo mesmo com a caixa desligada', () => {
  const comercio = MODELOS_ORCAMENTO.comercio.config;
  assert.equal(mostraVeiculo(comercio, {}), false);
  assert.equal(mostraVeiculo(comercio, { placa: 'ABC1D23' }), true);
  assert.equal(mostraVeiculo(CONFIG_ORCAMENTO_PADRAO, {}), true);
});

test('valores digitados, prazo e condicao em texto', () => {
  assert.equal(reaisDoCampo('12,50'), 12.5);
  assert.equal(reaisDoCampo('1.234,56'), 1234.56);
  assert.equal(reaisDoCampo('12.5'), 12.5);
  assert.equal(reaisDoCampo(''), 0);
  assert.equal(reaisDoCampo('-3'), 0);
  assert.equal(textoPrazoEntrega(''), '');
  assert.equal(textoPrazoEntrega('0'), 'Pronta entrega');
  assert.equal(textoPrazoEntrega('1'), '1 dia');
  assert.equal(textoPrazoEntrega('5'), '5 dias');
  assert.equal(textoPrazoEntrega('abc'), '');
  assert.equal(textoCondicaoPagamento({ forma: 'Cartão de Crédito', detalhe: '3x sem juros' }), 'Cartão de Crédito — 3x sem juros');
  assert.equal(textoCondicaoPagamento({ forma: '', detalhe: '30/60/90' }), '30/60/90');
  assert.equal(textoCondicaoPagamento(null), '');
});

test('total: desconto nao passa dos itens e frete soma por fora', () => {
  assert.equal(totalDoOrcamentoCentavos(10000, 2000, 1500), 9500);
  assert.equal(totalDoOrcamentoCentavos(10000, 15000, 1500), 1500);
});

test('o que grava: caixa ligada ou valor preenchido, nunca undefined', () => {
  const comercio = MODELOS_ORCAMENTO.comercio.config;
  const gravado = camposExtrasParaGravar(comercio, { ...VAZIOS, vendedorId: 'u1', vendedorNome: 'Ana', condicaoForma: 'Pix', prazoEntregaDias: '3', frete: '25,90' });
  assert.deepEqual(gravado, { vendedorId: 'u1', vendedorNome: 'Ana', condicaoPagamento: { forma: 'Pix', detalhe: '' }, prazoEntregaDias: '3', frete: 25.9 });
  // Oficina sem nada preenchido: nao cria campo nenhum.
  assert.deepEqual(camposExtrasParaGravar(CONFIG_ORCAMENTO_PADRAO, VAZIOS), {});
  // Caixa desligada depois: o frete ja' gravado nao some.
  assert.deepEqual(camposExtrasParaGravar(CONFIG_ORCAMENTO_PADRAO, { ...VAZIOS, frete: '10' }), { frete: 10 });
  Object.values(gravado).forEach((v) => assert.notEqual(v, undefined));
});

test('PDF: servico em horas x valor/hora, produto com quantidade e unidade', () => {
  const linhas = linhasDoPdfDoOrcamento({
    servicos: [{ nome: 'TROCA DE RETENTORES', preco: 100, quantidade: 3 }],
    pecas: [{ nome: 'RETENTOR', preco: 12.5, quantidade: 2, unidadeMedidaSigla: 'UN' }, { nome: 'ÓLEO', preco: 30, quantidade: 1.5 }],
  });
  assert.deepEqual(linhas.servicos[0], { nome: 'TROCA DE RETENTORES', horas: 3, valorHora: 100, total: 300 });
  assert.equal(linhas.produtos[0].total, 25);
  assert.equal(linhas.produtos[1].unidade, 'UN');
  assert.equal(textoHoras(3), '3 h');
  assert.equal(textoHoras(1.5), '1,5 h');
  const totais = totaisDoPdfDoOrcamento(linhas, { valorTotal: 0, frete: 20, desconto: { valorAplicadoCentavos: 1000 } });
  assert.equal(totais.servicos, 300);
  assert.equal(totais.produtos, 70);
  assert.equal(totais.total, 380);
  assert.equal(totaisDoPdfDoOrcamento(linhas, { valorTotal: 999 }).total, 999);
  assert.deepEqual(linhasDoPdfDoOrcamento({}), { servicos: [], produtos: [] });
});

test('converter para venda le pecas e servicos gravados (itens so de reserva)', () => {
  const linhas = linhasDoOrcamentoGravado<{ tipo?: string; nome?: string }>({ pecas: [{ nome: 'RETENTOR' }], servicos: [{ nome: 'TROCA' }] });
  assert.deepEqual(linhas.map((l) => `${l.tipo}:${l.nome}`), ['peca:RETENTOR', 'servico:TROCA']);
  assert.deepEqual(linhasDoOrcamentoGravado<{ tipo?: string }>({ itens: [{ tipo: 'peca' }] }), [{ tipo: 'peca' }]);
  assert.deepEqual(linhasDoOrcamentoGravado({}), []);
});
