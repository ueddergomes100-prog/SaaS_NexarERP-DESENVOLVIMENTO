import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TRAVA_EMISSAO_MS,
  lerPedidoDeMarcaNota,
  marcaNotaDoPedido,
  motivoParaNaoEmitir,
  motivoParaNaoMarcarSemNota,
  notaValeComoNotaDoPedido,
  pedidoEntraNaEmissao,
} from '../src/utils/notaDoPedidoDomain';

const AGORA = 1_800_000_000_000;
const base = { numeroPedido: '0107', status: 'Finalizada', tipo: 'NF-e' as const, integrationId: 'novo', notas: [], agoraMillis: AGORA };

test('marca do pedido: true/false/ausente', () => {
  assert.equal(marcaNotaDoPedido(true), 'com');
  assert.equal(marcaNotaDoPedido(false), 'sem');
  assert.equal(marcaNotaDoPedido(undefined), 'nao_informado');
  assert.equal(marcaNotaDoPedido('sim'), 'nao_informado');
});

test('nota que vale: NF-e e cupom autorizados ou aguardando; rejeitada, devolucao e remessa nao', () => {
  assert.equal(notaValeComoNotaDoPedido({ tipo: 'NF-e', status: 'authorized' }), true);
  assert.equal(notaValeComoNotaDoPedido({ tipo: 'NFC-e', status: 'processing' }), true);
  assert.equal(notaValeComoNotaDoPedido({ tipo: 'NF-e', status: 'rejected' }), false);
  assert.equal(notaValeComoNotaDoPedido({ tipo: 'NF-e', status: 'authorized', finalidade: 'devolucao' }), false);
  assert.equal(notaValeComoNotaDoPedido({ tipo: 'NF-e', status: 'authorized', finalidade: 'remessa_entrega_futura' }), false);
  assert.equal(notaValeComoNotaDoPedido({ tipo: 'NF-e', status: 'authorized', finalidade: 'faturamento_entrega_futura' }), true);
  assert.equal(notaValeComoNotaDoPedido({ tipo: 'NFS-e', status: 'authorized' }), false);
});

test('lista de emissao: some com nota valendo ou marcado sem nota; antigo e rejeitada continuam', () => {
  assert.equal(pedidoEntraNaEmissao({}, []), true);
  assert.equal(pedidoEntraNaEmissao({ comNotaFiscal: true }, [{ tipo: 'NF-e', status: 'rejected' }]), true);
  assert.equal(pedidoEntraNaEmissao({ comNotaFiscal: false }, []), false);
  assert.equal(pedidoEntraNaEmissao({ comNotaFiscal: true }, [{ tipo: 'NF-e', status: 'authorized' }]), false);
  assert.equal(pedidoEntraNaEmissao({}, [{ tipo: 'NFC-e', status: 'authorized' }]), false);
});

test('emitir: pedido sem nota, cancelado e com NF-e valendo sao recusados com mensagem clara', () => {
  assert.match(String(motivoParaNaoEmitir({ ...base, comNotaFiscal: false })), /SEM nota fiscal.*troque para COM/);
  assert.match(String(motivoParaNaoEmitir({ ...base, status: 'Cancelada' })), /cancelado/);
  const comNfe = motivoParaNaoEmitir({ ...base, notas: [{ tipo: 'NF-e', status: 'authorized', number: 512, integrationId: 'velho' }] });
  assert.match(String(comNfe), /NF-e nº 512 autorizada.*segunda nota/);
  assert.equal(motivoParaNaoEmitir({ ...base, notas: [{ tipo: 'NF-e', status: 'rejected', integrationId: 'velho' }] }), null);
});

test('emitir: reenviar a MESMA nota (mesmo integrationId) nao conta como segunda', () => {
  assert.equal(motivoParaNaoEmitir({ ...base, integrationId: 'x', notas: [{ tipo: 'NF-e', status: 'processing', integrationId: 'x' }] }), null);
});

test('cupom: barra outro cupom; NF-e no lugar so com o cupom autorizado', () => {
  const cupomOk = [{ tipo: 'NFC-e', status: 'authorized', number: 33, integrationId: 'c' }];
  assert.match(String(motivoParaNaoEmitir({ ...base, tipo: 'NFC-e', notas: cupomOk })), /segundo cupom/);
  assert.equal(motivoParaNaoEmitir({ ...base, tipo: 'NF-e', notas: cupomOk }), null);
  assert.match(String(motivoParaNaoEmitir({ ...base, tipo: 'NF-e', notas: [{ tipo: 'NFC-e', status: 'processing', integrationId: 'c' }] })), /aguarda a SEFAZ/);
});

test('trava: outra emissao em andamento barra por 3 minutos; vencida ou ja gravada libera', () => {
  const trava = { integrationId: 'outro', tipo: 'NF-e', emMillis: AGORA - 10_000 };
  assert.match(String(motivoParaNaoEmitir({ ...base, trava })), /sendo emitida agora/);
  assert.equal(motivoParaNaoEmitir({ ...base, trava: { ...trava, emMillis: AGORA - TRAVA_EMISSAO_MS - 1 } }), null);
  assert.equal(motivoParaNaoEmitir({ ...base, trava, notas: [{ tipo: 'NF-e', status: 'rejected', integrationId: 'outro' }] }), null);
  assert.equal(motivoParaNaoEmitir({ ...base, integrationId: 'outro', trava }), null);
});

test('marcar sem nota: recusa com nota valendo', () => {
  assert.equal(motivoParaNaoMarcarSemNota({ notas: [] }), null);
  assert.equal(motivoParaNaoMarcarSemNota({ notas: [{ tipo: 'NF-e', status: 'rejected' }] }), null);
  assert.match(String(motivoParaNaoMarcarSemNota({ numeroPedido: '9', notas: [{ tipo: 'NFC-e', status: 'authorized', number: 4 }] })), /pedido #9 já tem o cupom fiscal \(NFC-e\) nº 4/);
});

test('corpo da troca com/sem nota', () => {
  assert.deepEqual(lerPedidoDeMarcaNota({ pedidoId: 'abc', comNotaFiscal: false }), { pedidoId: 'abc', comNotaFiscal: false });
  assert.ok('erro' in lerPedidoDeMarcaNota({ pedidoId: 'abc' }));
  assert.ok('erro' in lerPedidoDeMarcaNota({ pedidoId: 'a/b', comNotaFiscal: true }));
});
