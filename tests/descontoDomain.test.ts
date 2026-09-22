import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checarLimiteComCliente,
  descontoDoClienteEmCents,
  descontoPadraoDoCliente,
  erroDoDescontoPadraoCliente,
  parseDescontoPadraoCliente,
  DEFAULT_TIPO_DESCONTO_PADRAO,
  descontoInicial,
  parseTipoDescontoPadrao,
  DEFAULT_PERMITIR_DESCONTO_POR_ITEM,
  parsePermitirDescontoPorItem,
  DEFAULT_MODO_LIMITE_DESCONTO,
  calcularDescontoCents,
  checarLimiteTotal,
  excedeLimiteItem,
  parseLimiteDescontoConfig,
  parseModoLimiteDesconto,
  resolveLimiteItem,
} from '../src/utils/descontoDomain';

test('calcularDescontoCents em percentual', () => {
  assert.equal(calcularDescontoCents('percentual', 10, 10000), 1000);
});

test('calcularDescontoCents em valor (reais para centavos)', () => {
  assert.equal(calcularDescontoCents('valor', 25.5, 10000), 2550);
});

test('calcularDescontoCents nunca passa da base (nem em valor, nem em percentual)', () => {
  assert.equal(calcularDescontoCents('valor', 999, 10000), 10000);
  assert.equal(calcularDescontoCents('percentual', 500, 10000), 10000);
});

test('calcularDescontoCents com valor zero/negativo ou base zero devolve 0', () => {
  assert.equal(calcularDescontoCents('percentual', 0, 10000), 0);
  assert.equal(calcularDescontoCents('percentual', -5, 10000), 0);
  assert.equal(calcularDescontoCents('valor', 10, 0), 0);
});

test('resolveLimiteItem le o percentual do produto quando presente', () => {
  assert.equal(resolveLimiteItem({ descontoMaximoPercentual: 5 }), 5);
});

test('resolveLimiteItem devolve null quando o produto nao define limite', () => {
  assert.equal(resolveLimiteItem({ descontoMaximoPercentual: 0 }), null);
  assert.equal(resolveLimiteItem({}), null);
  assert.equal(resolveLimiteItem(null), null);
  assert.equal(resolveLimiteItem(undefined), null);
});

test('excedeLimiteItem bloqueia desconto de item acima do limite do produto', () => {
  const produto = { descontoMaximoPercentual: 5 };
  // 10% de desconto num produto que so permite 5%.
  assert.equal(excedeLimiteItem(produto, 1000, 10000), true);
});

test('excedeLimiteItem aceita desconto dentro do limite do produto', () => {
  const produto = { descontoMaximoPercentual: 5 };
  assert.equal(excedeLimiteItem(produto, 500, 10000), false);
});

test('excedeLimiteItem nunca bloqueia quando o produto nao define limite', () => {
  assert.equal(excedeLimiteItem({}, 9999, 10000), false);
  assert.equal(excedeLimiteItem(null, 9999, 10000), false);
});

test('checarLimiteTotal: sem limite configurado nunca excede', () => {
  assert.deepEqual(checarLimiteTotal(null, 10000, 9999), { percentualAplicado: 99.99, excedeu: false });
  assert.deepEqual(checarLimiteTotal({ tipo: 'percentual', valor: 0 }, 10000, 9999).excedeu, false);
});

test('checarLimiteTotal em percentual: dentro e fora do limite', () => {
  const limite = { tipo: 'percentual' as const, valor: 10 };
  assert.equal(checarLimiteTotal(limite, 10000, 900).excedeu, false);
  assert.equal(checarLimiteTotal(limite, 10000, 1500).excedeu, true);
});

test('checarLimiteTotal em valor (R$): dentro e fora do limite', () => {
  const limite = { tipo: 'valor' as const, valor: 50 };
  assert.equal(checarLimiteTotal(limite, 100000, 4000).excedeu, false);
  assert.equal(checarLimiteTotal(limite, 100000, 6000).excedeu, true);
});

test('checarLimiteTotal no limite exato nao excede (tolerancia de arredondamento)', () => {
  const limite = { tipo: 'percentual' as const, valor: 10 };
  assert.equal(checarLimiteTotal(limite, 10000, 1000).excedeu, false);
});

test('parseLimiteDescontoConfig le formato valido', () => {
  assert.deepEqual(parseLimiteDescontoConfig({ tipo: 'valor', valor: 50 }), { tipo: 'valor', valor: 50 });
});

test('parseLimiteDescontoConfig cai em percentual/0 pra entrada invalida', () => {
  assert.deepEqual(parseLimiteDescontoConfig(undefined), { tipo: 'percentual', valor: 0 });
  assert.deepEqual(parseLimiteDescontoConfig({ tipo: 'xyz', valor: -5 }), { tipo: 'percentual', valor: 0 });
});

test('parseModoLimiteDesconto aceita so os 3 modos validos', () => {
  assert.equal(parseModoLimiteDesconto('bloquear'), 'bloquear');
  assert.equal(parseModoLimiteDesconto('senha'), 'senha');
  assert.equal(parseModoLimiteDesconto('avisar'), 'avisar');
  assert.equal(parseModoLimiteDesconto('lixo'), DEFAULT_MODO_LIMITE_DESCONTO);
  assert.equal(parseModoLimiteDesconto(undefined), DEFAULT_MODO_LIMITE_DESCONTO);
});

// --- Campo de desconto por item na tela de venda ---------------------------

test('desconto por item vem habilitado por padrao', () => {
  assert.equal(DEFAULT_PERMITIR_DESCONTO_POR_ITEM, true);
});

test('so false explicito esconde o desconto por item', () => {
  assert.equal(parsePermitirDescontoPorItem(false), false);
  // Empresa que nunca abriu a configuracao nao tem o campo gravado -- sumir
  // com um campo que ela ja usa seria pior que manter.
  assert.equal(parsePermitirDescontoPorItem(undefined), true);
  assert.equal(parsePermitirDescontoPorItem(null), true);
  assert.equal(parsePermitirDescontoPorItem('false'), true);
});

// --- Limite da tela vale pro desconto digitado em R$, nao so em % ----------

test('limite em percentual pega desconto digitado em valor', () => {
  // R$ 30 de desconto em R$ 100 sao 30% -- acima de um limite de 10%,
  // independente de a pessoa ter digitado "30" em R$ ou "30" em %.
  const limite = { tipo: 'percentual' as const, valor: 10 };
  assert.equal(checarLimiteTotal(limite, 10000, 3000).excedeu, true);
  assert.equal(checarLimiteTotal(limite, 10000, 900).excedeu, false);
});

test('limite em reais pega desconto digitado em percentual', () => {
  // 30% de R$ 100 sao R$ 30 -- acima de um limite de R$ 20.
  const limite = { tipo: 'valor' as const, valor: 20 };
  assert.equal(checarLimiteTotal(limite, 10000, 3000).excedeu, true);
  assert.equal(checarLimiteTotal(limite, 10000, 1500).excedeu, false);
});

// --- Tipo de desconto que abre por padrao ---------------------------------

test('o padrao continua sendo R$, como sempre foi', () => {
  assert.equal(DEFAULT_TIPO_DESCONTO_PADRAO, 'valor');
});

test('so "percentual" troca o padrao -- qualquer outra coisa cai em R$', () => {
  assert.equal(parseTipoDescontoPadrao('percentual'), 'percentual');
  assert.equal(parseTipoDescontoPadrao('valor'), 'valor');
  assert.equal(parseTipoDescontoPadrao(undefined), 'valor');
  assert.equal(parseTipoDescontoPadrao(null), 'valor');
  assert.equal(parseTipoDescontoPadrao('%'), 'valor');
});

test('descontoInicial abre o campo vazio no tipo escolhido', () => {
  assert.deepEqual(descontoInicial('percentual'), { tipo: 'percentual', valor: '' });
  assert.deepEqual(descontoInicial('valor'), { tipo: 'valor', valor: '' });
});

// --- desconto padrao do cliente (hierarquia cliente > produto > sistema) ---

test('desconto do cliente e lido do cadastro, com teto de 100%', () => {
  assert.equal(descontoPadraoDoCliente({ descontoPadraoPercentual: 10 }), 10);
  assert.equal(descontoPadraoDoCliente({ descontoPadraoPercentual: 0 }), 0);
  assert.equal(descontoPadraoDoCliente({}), 0);
  assert.equal(descontoPadraoDoCliente(null), 0);
  assert.equal(descontoPadraoDoCliente({ descontoPadraoPercentual: 150 }), 100);
  assert.equal(descontoPadraoDoCliente({ descontoPadraoPercentual: -5 }), 0);
  assert.equal(descontoPadraoDoCliente({ descontoPadraoPercentual: 'abc' }), 0);
});

test('campo em branco no cadastro significa "sem desconto", nao erro', () => {
  assert.equal(parseDescontoPadraoCliente(''), 0);
  assert.equal(parseDescontoPadraoCliente('  '), 0);
  assert.equal(erroDoDescontoPadraoCliente(''), null);
  assert.equal(parseDescontoPadraoCliente('10,5'), 10.5);
});

test('cadastro recusa desconto invalido em portugues', () => {
  assert.match(String(erroDoDescontoPadraoCliente('abc')), /porcentagem/i);
  assert.match(String(erroDoDescontoPadraoCliente('-1')), /negativo/i);
  assert.match(String(erroDoDescontoPadraoCliente('101')), /100%/);
});

test('ate o percentual do cliente, o desconto PASSA sem pedir nada', () => {
  // Limite da tela: 5%. Cliente tem 10%. Venda de R$ 100 com 10% de desconto.
  const limite = { tipo: 'percentual' as const, valor: 5 };
  const r = checarLimiteComCliente(limite, 10000, 1000, 10);
  assert.equal(r.dentroDoDescontoDoCliente, true);
  assert.equal(r.excedeu, false);
  assert.equal(r.percentualDoCliente, 10);
});

test('acima do percentual do cliente, volta a valer o limite da tela', () => {
  const limite = { tipo: 'percentual' as const, valor: 5 };
  // 15% numa venda de cliente que tem 10%: passou do que ele tem direito.
  const r = checarLimiteComCliente(limite, 10000, 1500, 10);
  assert.equal(r.dentroDoDescontoDoCliente, false);
  assert.equal(r.excedeu, true);
});

test('exatamente no percentual do cliente nao dispara senha por centavo', () => {
  const limite = { tipo: 'percentual' as const, valor: 0 };
  const r = checarLimiteComCliente(limite, 3333, Math.round(3333 * 0.1), 10);
  assert.equal(r.dentroDoDescontoDoCliente, true);
  assert.equal(r.excedeu, false);
});

test('cliente sem desconto cadastrado se comporta como antes', () => {
  const limite = { tipo: 'percentual' as const, valor: 5 };
  const semCliente = checarLimiteComCliente(limite, 10000, 1000, 0);
  const original = checarLimiteTotal(limite, 10000, 1000);
  assert.equal(semCliente.excedeu, original.excedeu);
  assert.equal(semCliente.percentualAplicado, original.percentualAplicado);
  assert.equal(semCliente.dentroDoDescontoDoCliente, false);
});

test('sem limite configurado, nada excede -- com ou sem desconto de cliente', () => {
  assert.equal(checarLimiteComCliente(null, 10000, 5000, 10).excedeu, false);
  assert.equal(checarLimiteComCliente(null, 10000, 5000, 0).excedeu, false);
});

test('desconto do cliente em centavos', () => {
  assert.equal(descontoDoClienteEmCents(10000, 10), 1000);
  assert.equal(descontoDoClienteEmCents(3333, 10), 333);
  assert.equal(descontoDoClienteEmCents(10000, 0), 0);
  assert.equal(descontoDoClienteEmCents(0, 10), 0);
});

test('o TETO DO PRODUTO nao e afetado pelo desconto do cliente', () => {
  // Produto que so' aceita 5%: cliente com 10% NAO passa por cima disso --
  // quem confere o item e' excedeLimiteItem, que nem enxerga o cliente.
  const produto = { descontoMaximoPercentual: 5 };
  assert.equal(resolveLimiteItem(produto), 5);
  assert.equal(excedeLimiteItem(produto, 1000, 10000), true);  // 10% pedido
  assert.equal(excedeLimiteItem(produto, 500, 10000), false);  // 5% cabe
});

test('desconto maximo 0 no produto significa SEM TETO, nao "nao aceita desconto"', () => {
  // Registrado porque e' contra-intuitivo: o campo em branco vira 0 no
  // documento, entao 0 tem de significar "nunca configurado".
  const semTeto = { descontoMaximoPercentual: 0 };
  assert.equal(resolveLimiteItem(semTeto), null);
  assert.equal(excedeLimiteItem(semTeto, 9000, 10000), false);
});
