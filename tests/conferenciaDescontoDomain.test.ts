import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TIPO_IDENTIFICACAO,
  TIPO_LIBERACAO,
  configDoDesconto,
  exigeIdentificacaoDoVendedor,
  lerPedidoDeLiberacao,
  podeLiberarDesconto,
  problemaDaIdentificacao,
  problemaDaLiberacao,
  problemaNoDescontoDoItem,
  situacaoDoDescontoTotal,
} from '../src/utils/conferenciaDescontoDomain';

/* Desconto, liberacao e vendedor conferidos pelo servidor (19/10/2026). */

const cfg = (modo: unknown, valor = 10) => configDoDesconto({ limiteDescontoPedido: { tipo: 'percentual', valor }, modoLimiteDesconto: modo }, 'pedido');

test('limite e modo lidos como a tela le (sem config = sem limite, modo avisar)', () => {
  assert.deepEqual(configDoDesconto({}, 'os'), { limite: { tipo: 'percentual', valor: 0 }, modo: 'avisar' });
  assert.deepEqual(configDoDesconto({ limiteDescontoPdv: { tipo: 'valor', valor: 5 }, modoLimiteDesconto: 'senha' }, 'pdv'), { limite: { tipo: 'valor', valor: 5 }, modo: 'senha' });
  assert.equal(exigeIdentificacaoDoVendedor({ exigirIdentificacaoVendedor: true }), true);
  assert.equal(exigeIdentificacaoDoVendedor({ exigirIdentificacaoVendedor: 'sim' }), false);
});

test('desconto total: bloquear recusa, senha pede liberacao, avisar passa; cliente passa direto', () => {
  const total = (modo: string, percentualDoCliente = 0) => situacaoDoDescontoTotal({ tela: 'pedido', config: cfg(modo), baseCentavos: 10000, descontoCentavos: 2000, percentualDoCliente });
  assert.match(String(total('bloquear').erro), /O desconto \(20,0%\) passa do limite de 10% configurado para Pedido de Venda/);
  assert.equal(total('senha').precisaLiberacao, true);
  assert.equal(total('avisar').excedeu, true);
  assert.equal(total('avisar').precisaLiberacao, false);
  assert.equal(total('senha', 20).excedeu, false);
  assert.equal(situacaoDoDescontoTotal({ tela: 'pedido', config: cfg('senha', 0), baseCentavos: 10000, descontoCentavos: 9000, percentualDoCliente: 0 }).excedeu, false, 'sem limite configurado');
});

test('item: limite do produto sempre; limite da tela so no Pedido com bloquear', () => {
  const item = { nome: 'RAÇÃO', brutoCentavos: 1000, descontoCentavos: 300, produto: { descontoMaximoPercentual: 5 } };
  assert.match(String(problemaNoDescontoDoItem(item, 'pdv', cfg('avisar'))), /RAÇÃO aceita no máximo 5% de desconto/);
  const semLimiteProprio = { ...item, produto: null };
  assert.match(String(problemaNoDescontoDoItem(semLimiteProprio, 'pedido', cfg('bloquear'))), /O desconto de RAÇÃO \(30,0%\)/);
  assert.equal(problemaNoDescontoDoItem(semLimiteProprio, 'pdv', cfg('bloquear')), null);
  assert.equal(problemaNoDescontoDoItem(semLimiteProprio, 'pedido', cfg('senha')), null);
});

test('comprovante de liberacao: empresa, sessao, tela, validade e valor', () => {
  const agoraMs = 1_000_000;
  const c = { tenantId: 'loja', tipo: TIPO_LIBERACAO, emitidoPara: 'caixa', tela: 'pedido', baseCentavos: 10000, descontoCentavos: 2000, expiraEmMs: agoraMs + 1 };
  const esperado = { tenantId: 'loja', emitidoPara: 'caixa', tela: 'pedido' as const, baseCentavos: 10000, descontoCentavos: 2000, agoraMs };
  assert.equal(problemaDaLiberacao(c, esperado), null);
  assert.equal(problemaDaLiberacao(c, { ...esperado, descontoCentavos: 1500 }), null, 'desconto menor que o liberado passa');
  assert.match(String(problemaDaLiberacao(c, { ...esperado, descontoCentavos: 2100 })), /mudou depois da liberação/);
  assert.match(String(problemaDaLiberacao(c, { ...esperado, baseCentavos: 8000 })), /mudou depois da liberação/, 'mesmo valor sobre venda menor = percentual maior');
  assert.match(String(problemaDaLiberacao(c, { ...esperado, tela: 'os' })), /não vale para esta venda/);
  assert.match(String(problemaDaLiberacao(c, { ...esperado, emitidoPara: 'outro' })), /não vale para esta venda/);
  assert.match(String(problemaDaLiberacao(null, esperado)), /não vale para esta venda/);
  assert.match(String(problemaDaLiberacao({ ...c, expiraEmMs: agoraMs - 1 }, esperado)), /venceu \(vale 30 minutos\)/);
});

test('comprovante de identificacao: so do proprio vendedor da venda', () => {
  const agoraMs = 1_000_000;
  const c = { tenantId: 'loja', tipo: TIPO_IDENTIFICACAO, emitidoPara: 'caixa', pessoaId: 'vend1', expiraEmMs: agoraMs + 1 };
  const esperado = { tenantId: 'loja', emitidoPara: 'caixa', vendedorId: 'vend1', agoraMs };
  assert.equal(problemaDaIdentificacao(c, esperado), null);
  assert.match(String(problemaDaIdentificacao(c, { ...esperado, vendedorId: 'vend2' })), /não confere/);
  assert.match(String(problemaDaIdentificacao({ ...c, tipo: TIPO_LIBERACAO }, esperado)), /não confere/);
  assert.match(String(problemaDaIdentificacao({ ...c, expiraEmMs: 1 }, esperado)), /venceu/);
});

test('pedido de liberacao e quem pode liberar', () => {
  assert.ok('pedido' in lerPedidoDeLiberacao({ tela: 'os', baseCentavos: 100, descontoCentavos: 10, aprovador: { tipo: 'vendedor', codigo: '07', pin: '1234' } }));
  assert.ok('erro' in lerPedidoDeLiberacao({ tela: 'orcamento', baseCentavos: 100, descontoCentavos: 10, aprovador: { tipo: 'vendedor', codigo: '07', pin: '1234' } }));
  assert.ok('erro' in lerPedidoDeLiberacao({ tela: 'pdv', baseCentavos: 100, descontoCentavos: 101, aprovador: { tipo: 'vendedor', codigo: '07', pin: '1234' } }));
  assert.ok('erro' in lerPedidoDeLiberacao({ tela: 'pdv', baseCentavos: 100, descontoCentavos: 10, aprovador: { tipo: 'login' } }));
  assert.equal(podeLiberarDesconto({ role: 'Funcionario', permissoes: ['vendas.liberar_desconto'] }, 'u1', 'loja'), true);
  assert.equal(podeLiberarDesconto({ role: 'Funcionario', permissoes: [] }, 'u1', 'loja'), false);
  assert.equal(podeLiberarDesconto({ role: 'Funcionario' }, 'loja', 'loja'), true, 'dono');
  assert.equal(podeLiberarDesconto({ role: 'Admin' }, 'u1', 'loja'), true);
});
