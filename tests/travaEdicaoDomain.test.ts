import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PARADO_LIBERA_MS,
  SEM_SINAL_LIBERA_MS,
  avaliarPegar,
  avaliarSinal,
  calcularValidade,
  descreverTrava,
  idDaTrava,
  mensagemDeBloqueio,
  travaAtiva,
  type TravaDeEdicao,
} from '../src/utils/travaEdicaoDomain';

const T0 = Date.UTC(2026, 9, 15, 17, 32, 0); // 14:32 em Brasilia
const trava = (extra: Partial<TravaDeEdicao> = {}): TravaDeEdicao => ({
  tenantId: 'emp', tipo: 'conferencia', registroId: 'p83', usuarioId: 'maria', usuarioNome: 'MARIA', aparelho: 'celular',
  sessaoId: 's1', desdeMs: T0, ultimoSinalMs: T0, ultimaAtividadeMs: T0, validaAteMs: calcularValidade(T0, T0), ...extra,
});

test('validade: o menor entre 2 min sem sinal e 10 min parado', () => {
  assert.equal(calcularValidade(T0, T0), T0 + SEM_SINAL_LIBERA_MS);
  assert.equal(calcularValidade(T0, T0 - 9 * 60_000), T0 - 9 * 60_000 + PARADO_LIBERA_MS);
  assert.equal(travaAtiva(trava(), T0 + SEM_SINAL_LIBERA_MS - 1), true);
  assert.equal(travaAtiva(trava(), T0 + SEM_SINAL_LIBERA_MS), false);
  assert.equal(travaAtiva(null, T0), false);
});

test('pegar: livre, mesma tela, mesmo usuario em outra tela, ou de outra pessoa', () => {
  assert.equal(avaliarPegar(null, { usuarioId: 'joao', sessaoId: 's2' }, T0).tipo, 'livre');
  assert.equal(avaliarPegar(trava(), { usuarioId: 'maria', sessaoId: 's1' }, T0).tipo, 'mesma_sessao');
  assert.equal(avaliarPegar(trava(), { usuarioId: 'maria', sessaoId: 's9' }, T0).tipo, 'mesmo_usuario');
  assert.equal(avaliarPegar(trava(), { usuarioId: 'joao', sessaoId: 's2' }, T0).tipo, 'de_outro');
  assert.equal(avaliarPegar(trava(), { usuarioId: 'joao', sessaoId: 's2' }, T0 + SEM_SINAL_LIBERA_MS).tipo, 'livre', 'vencida = livre');
});

test('sinal: renova, venceu ou perdeu para outra tela', () => {
  assert.equal(avaliarSinal(trava(), 's1', T0 + 1000).tipo, 'ok');
  assert.equal(avaliarSinal(trava(), 's1', T0 + SEM_SINAL_LIBERA_MS).tipo, 'venceu');
  assert.equal(avaliarSinal(null, 's1', T0).tipo, 'venceu');
  assert.equal(avaliarSinal(trava({ sessaoId: 's2', usuarioId: 'joao' }), 's1', T0).tipo, 'perdeu');
  assert.equal(avaliarSinal(trava({ sessaoId: 's2' }), 's1', T0 + SEM_SINAL_LIBERA_MS).tipo, 'venceu', 'a outra tela tambem venceu: nao perdeu para ninguem');
});

test('textos para a lista e para o aviso', () => {
  assert.equal(idDaTrava('emp', 'pedido_venda', 'p1'), 'emp__pedido_venda__p1');
  assert.equal(descreverTrava(trava()), 'Em edição por MARIA no celular desde 14:32');
  assert.match(mensagemDeBloqueio('conferencia', trava({ aparelho: 'computador' })), /no computador desde 14:32\. Espere terminar para abrir a conferência/);
});
