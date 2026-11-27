import test from 'node:test';
import assert from 'node:assert/strict';
import {
  permissoesCopiadas,
  permissoesForaDoAlcance,
  rotuloDoUsuarioParaCopiar,
  usuariosParaCopiar,
} from '../src/utils/copiaDePermissoesDomain';

const tudo = () => true;

test('copia as permissoes da origem e tira as que a origem nao tem; marcadores do destino ficam', () => {
  const r = permissoesCopiadas({
    atuais: ['financeiro.pagar', 'app.definido'],
    daOrigem: ['vendas.pedidos', 'financeiro.receber', 'pacote.vendas-1'],
    podeMexer: tudo,
  });
  assert.ok(r.includes('vendas.pedidos'));
  assert.ok(r.includes('financeiro.receber'));
  assert.ok(!r.includes('financeiro.pagar'), 'a origem nao tem: sai');
  assert.ok(r.includes('app.definido'), 'marcador do destino fica');
  assert.ok(!r.includes('pacote.vendas-1'), 'marcador da origem nao vem (nao e\' permissao do catalogo)');
});

test('so mexe no que quem copia pode dar; o resto fica como estava no destino', () => {
  const gerente = (id: string) => id === 'vendas.pedidos';
  const r = permissoesCopiadas({ atuais: ['financeiro.pagar'], daOrigem: ['vendas.pedidos', 'financeiro.receber'], podeMexer: gerente });
  assert.deepEqual(r.sort(), ['financeiro.pagar', 'vendas.pedidos']);
  assert.equal(permissoesForaDoAlcance(['vendas.pedidos', 'financeiro.receber', 'pacote.x'], gerente), 1);
  // Funcionario novo: nasce so' com o que da' para dar.
  assert.deepEqual(permissoesCopiadas({ atuais: [], daOrigem: ['vendas.pedidos', 'financeiro.receber'], podeMexer: gerente }), ['vendas.pedidos']);
});

test('lista de origem: sem o dono, sem o destino, sem vendedor de balcao; em ordem de nome', () => {
  const lista = usuariosParaCopiar([
    { id: 'loja', nome: 'DONO', role: 'Master' },
    { id: 'b', nome: 'BRUNO', role: 'Funcionario' },
    { id: 'a', nome: 'ANA', role: 'Admin' },
    { id: 'v', nome: 'VENDEDOR', role: 'Funcionario', tipoRegistro: 'vendedor' },
    { id: 'x', nome: 'PLATAFORMA', role: 'SuperAdmin' },
    { id: 'eu', nome: 'EU', role: 'Funcionario' },
  ], { donoId: 'loja', destinoId: 'eu' });
  assert.deepEqual(lista.map((u) => u.id), ['a', 'b']);
});

test('rotulo: nome, usuario sem o CNPJ e inativo', () => {
  assert.equal(rotuloDoUsuarioParaCopiar({ id: '1', nome: 'MARIA', username: '12345678000199-maria' }), 'MARIA (maria)');
  assert.equal(rotuloDoUsuarioParaCopiar({ id: '2', nome: 'JOAO', username: '12345678000199-joao-caixa', status: 'Inativo' }), 'JOAO (joao-caixa) — inativo');
  assert.equal(rotuloDoUsuarioParaCopiar({ id: '3', username: 'balcao01' }), 'balcao01');
});
