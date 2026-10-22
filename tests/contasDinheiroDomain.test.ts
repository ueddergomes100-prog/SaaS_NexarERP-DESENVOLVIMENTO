import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CAIXAS_PADRAO,
  descricoesDaTransferencia,
  erroDeSaldoDoCaixa,
  erroParaDepositarCheque,
  erroParaDevolverCheque,
  erroParaVoltarChequeParaCarteira,
  lerCadastroDeCaixa,
  lerLancamentoDeCaixa,
  lerPedidoDeTransferencia,
  lerSangriaParaDeposito,
  situacaoDoCheque,
} from '../src/utils/contasDinheiroDomain';

/*
 * Caixas e transferencias entre contas (21/10/2026): leitura dos pedidos,
 * caixa nunca negativo, sangria para deposito e situacao do cheque recebido.
 */

const erroDe = (r: { erro: string } | object): string => ('erro' in r ? r.erro : '');

test('caixas padrao: CAIXA (gaveta) e COFRE; cadastro em caixa alta com saldo inicial', () => {
  assert.deepEqual(CAIXAS_PADRAO.map((c) => c.nome), ['CAIXA', 'COFRE']);
  const ok = lerCadastroDeCaixa({ nome: '  caixa da loja 2 ', descricao: 'Segunda gaveta', saldoInicialCentavos: 15000 });
  assert.ok('caixa' in ok);
  assert.deepEqual(ok.caixa, { nome: 'CAIXA DA LOJA 2', descricao: 'Segunda gaveta', saldoInicialCentavos: 15000, ativo: true });
  assert.match(erroDe(lerCadastroDeCaixa({ nome: '' })), /nome/);
  assert.match(erroDe(lerCadastroDeCaixa({ nome: 'X', saldoInicialCentavos: -1 })), /saldo inicial/);
});

test('lancamento a mao e transferencia: validacoes', () => {
  assert.match(erroDe(lerLancamentoDeCaixa({ direcao: 'credito', valorCentavos: 0 })), /maior que zero/);
  assert.match(erroDe(lerLancamentoDeCaixa({ direcao: 'credito', valorCentavos: 100, descricao: 'x' })), /data/);
  const t = lerPedidoDeTransferencia({ origem: { tipo: 'caixa', id: 'c1' }, destino: { tipo: 'banco', id: 'b1' }, valorCentavos: 50000, data: '2026-10-21', descricao: 'Depósito do dia' });
  assert.ok('pedido' in t);
  assert.equal(t.pedido.destino.tipo, 'banco');
  assert.match(erroDe(lerPedidoDeTransferencia({ origem: { tipo: 'caixa', id: 'c1' }, destino: { tipo: 'caixa', id: 'c1' }, valorCentavos: 1, data: '2026-10-21' })), /mesma conta/);
  assert.match(erroDe(lerPedidoDeTransferencia({ origem: { tipo: 'x', id: 'c1' } })), /de onde/);
  assert.deepEqual(descricoesDaTransferencia('CAIXA', 'SICOOB', ''), { saida: 'Transferência para SICOOB', entrada: 'Transferência de CAIXA' });
  assert.deepEqual(descricoesDaTransferencia('CAIXA', 'SICOOB', 'Depósito'), { saida: 'Depósito', entrada: 'Depósito' });
});

test('caixa nunca fica negativo', () => {
  assert.equal(erroDeSaldoDoCaixa('CAIXA', 10000, 10000), null);
  assert.match(erroDeSaldoDoCaixa('CAIXA', 10000, 10001)!, /CAIXA tem R\$ 100,00; não dá para tirar R\$ 100,01/);
});

test('sangria para deposito: banco, valor, sessao e data', () => {
  assert.match(erroDe(lerSangriaParaDeposito({})), /banco/);
  const ok = lerSangriaParaDeposito({ bancoId: 'b1', valorCentavos: 20000, sessaoId: 's1', data: '2026-10-21' });
  assert.ok('sangria' in ok);
  assert.equal(ok.sangria.bancoId, 'b1');
});

test('cheque recebido: em carteira -> depositado -> compensado; devolvido; voltar para a carteira', () => {
  const carteira = { tipo: 'entrada', status: 'Pendente', cheque: {} };
  assert.equal(situacaoDoCheque(carteira), 'em_carteira');
  assert.equal(erroParaDepositarCheque(carteira), null);
  assert.equal(erroParaDevolverCheque(carteira), null);
  assert.match(erroParaVoltarChequeParaCarteira(carteira)!, /já está na carteira/);
  const depositado = { tipo: 'entrada', status: 'Pendente', cheque: { situacao: 'depositado' } };
  assert.equal(situacaoDoCheque(depositado), 'depositado');
  assert.match(erroParaDepositarCheque(depositado)!, /já está depositado/);
  assert.equal(erroParaVoltarChequeParaCarteira(depositado), null);
  assert.equal(situacaoDoCheque({ tipo: 'entrada', status: 'Paga', cheque: { situacao: 'depositado' } }), 'compensado');
  assert.match(erroParaDepositarCheque({ tipo: 'entrada', status: 'Paga' })!, /já foi compensado/);
  assert.match(erroParaDepositarCheque({ tipo: 'saida', status: 'Pendente' })!, /emitido/);
  assert.match(erroParaDevolverCheque({ tipo: 'entrada', status: 'Pendente', cheque: { situacao: 'devolvido' } })!, /já está marcado/);
});
