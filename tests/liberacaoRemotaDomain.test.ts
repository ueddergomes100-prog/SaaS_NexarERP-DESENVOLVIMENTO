import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  VALIDADE_DO_PEDIDO_MS,
  erroParaResponder,
  lerPedidoRemoto,
  lerResposta,
  notificacaoDoPedido,
  percentualDoDesconto,
  podeLiberarDescontoNoApp,
  segundosRestantes,
  situacaoAtual,
  textoDoPedido,
  textoDoTempoRestante,
} from '../src/utils/liberacaoRemotaDomain';

/*
 * Liberacao de desconto pelo celular (21/10/2026): leitura do pedido e da
 * resposta, prazo de 10 minutos e textos do aviso.
 */

const AGORA = 1_700_000_000_000;
const erroDe = (r: { erro: string } | object): string => ('erro' in r ? r.erro : '');
const base = { status: 'pendente', expiraEmMs: AGORA + VALIDADE_DO_PEDIDO_MS };

test('pedido: tela, valores e textos aparados; orcamento tambem pode pedir', () => {
  const ok = lerPedidoRemoto({ tela: 'orcamento', baseCentavos: 24000, descontoCentavos: 3000, motivo: '  Desconto   de 12,5%  ', documento: 'Orçamento #12' });
  assert.ok('pedido' in ok);
  assert.equal(ok.pedido.motivo, 'Desconto de 12,5%');
  assert.match(erroDe(lerPedidoRemoto({ tela: 'x' })), /Tela/);
  assert.match(erroDe(lerPedidoRemoto({ tela: 'pdv', baseCentavos: 100, descontoCentavos: 200 })), /Valores/);
  assert.equal(percentualDoDesconto(24000, 3000), 12.5);
});

test('situacao: pendente dentro do prazo; fora do prazo vira vencida; demais ficam como estao', () => {
  assert.equal(situacaoAtual(base, AGORA), 'pendente');
  assert.equal(situacaoAtual(base, AGORA + VALIDADE_DO_PEDIDO_MS + 1), 'vencida');
  assert.equal(situacaoAtual({ status: 'aprovada', expiraEmMs: 0 }, AGORA), 'aprovada');
  assert.equal(segundosRestantes(base, AGORA + 1000), 599);
  assert.equal(textoDoTempoRestante(599), '9:59');
  assert.equal(erroParaResponder(base, AGORA), null);
  assert.match(erroParaResponder(base, AGORA + VALIDADE_DO_PEDIDO_MS + 1)!, /venceu/);
  assert.match(erroParaResponder({ status: 'aprovada', aprovadorNome: 'MARCOS' }, AGORA)!, /já foi aprovado por MARCOS/);
  assert.match(erroParaResponder({ status: 'cancelada' }, AGORA)!, /cancelou/);
});

test('textos do pedido e do aviso', () => {
  const r = { solicitanteNome: 'ANA', baseCentavos: 24000, descontoCentavos: 3000, tela: 'pedido' as const, documento: 'Pedido #0231 — JOÃO' };
  assert.equal(textoDoPedido(r), 'ANA pede 12,5% de desconto (R$ 30,00 em R$ 240,00) — Pedido de Venda, Pedido #0231 — JOÃO');
  assert.deepEqual(notificacaoDoPedido(r), { titulo: 'Liberar desconto?', corpo: 'ANA pede 12,5% (R$ 30,00) — Pedido de Venda, Pedido #0231 — JOÃO' });
});

test('resposta: decisao + credencial (senha recem-digitada ou PIN)', () => {
  assert.match(erroDe(lerResposta({ decisao: 'talvez' })), /Aprovar ou Recusar/);
  assert.match(erroDe(lerResposta({ decisao: 'aprovar' })), /senha/);
  const pin = lerResposta({ decisao: 'recusar', motivoRecusa: 'Margem baixa', credencial: { tipo: 'pin', pin: ' 1234 ' } });
  assert.ok('resposta' in pin);
  assert.deepEqual(pin.resposta, { decisao: 'recusar', motivoRecusa: 'Margem baixa', credencial: { tipo: 'pin', pin: '1234' } });
  const login = lerResposta({ decisao: 'aprovar', credencial: { tipo: 'login', idToken: 'x'.repeat(30) } });
  assert.ok('resposta' in login && login.resposta.credencial.tipo === 'login');
});

test('quem ve a tela Liberacoes no app', () => {
  assert.equal(podeLiberarDescontoNoApp('Funcionario', false, []), false);
  assert.equal(podeLiberarDescontoNoApp('Funcionario', false, ['vendas.liberar_desconto']), true);
  assert.equal(podeLiberarDescontoNoApp('Admin', false, []), true);
  assert.equal(podeLiberarDescontoNoApp('Funcionario', true, []), true);
});
