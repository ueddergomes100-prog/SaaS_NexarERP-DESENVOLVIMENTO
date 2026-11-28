import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clienteSemCadastroCompleto,
  complementoDoClienteSemCadastro,
  resumoDoClienteSemCadastro,
  erroDasFormasSemCadastro,
  lerClienteSemCadastro,
  nomeDoClienteDoPedido,
  telefoneFormatado,
} from '../src/utils/clienteSemCadastroDomain';
import { lerPedidoDeFechamento } from '../src/utils/vendaFechamentoDomain';
import { montarEntregaDoPedido } from '../src/utils/romaneioDomain';

test('cliente a cadastrar: le nome, cidade e telefone; sem nome nao existe', () => {
  assert.deepEqual(lerClienteSemCadastro({ nome: '  joão   da silva ', cidade: 'manhuaçu', telefone: '(33) 99999-0000' }), {
    nome: 'JOÃO DA SILVA', cidade: 'MANHUAÇU', telefone: '33999990000',
  });
  assert.deepEqual(lerClienteSemCadastro({ nome: 'ANA', cidade: '', telefone: '12' }), { nome: 'ANA' }, 'sem chave vazia');
  assert.equal(lerClienteSemCadastro({ nome: 'a' }), null);
  assert.equal(lerClienteSemCadastro(null), null);
  assert.equal(lerClienteSemCadastro('JOAO'), null);
  assert.equal(telefoneFormatado('33999990000'), '(33) 99999-0000');
  assert.equal(telefoneFormatado('3333331200'), '(33) 3333-1200');
});

test('cliente a cadastrar: nome no papel e complemento', () => {
  const pedido = { clienteNome: 'CONSUMIDOR FINAL', clienteSemCadastro: { nome: 'JOAO', cidade: 'CARATINGA', telefone: '33999990000' } };
  assert.equal(nomeDoClienteDoPedido(pedido), 'JOAO');
  assert.equal(complementoDoClienteSemCadastro(pedido), 'Cliente a cadastrar · CARATINGA · (33) 99999-0000');
  assert.equal(nomeDoClienteDoPedido({ clienteNome: 'MUNIZ' }), 'MUNIZ');
  assert.equal(nomeDoClienteDoPedido({}), 'Consumidor Final');
  assert.equal(complementoDoClienteSemCadastro({ clienteNome: 'MUNIZ' }), '');
});

test('cliente a cadastrar: so a vista; boleto e a prazo recusados em portugues', () => {
  const c = { nome: 'JOAO' };
  assert.equal(erroDasFormasSemCadastro(['Dinheiro', 'Pix'], c), null);
  assert.match(erroDasFormasSemCadastro(['Pix', 'Boleto'], c) || '', /"JOAO" não tem cadastro: não dá para vender em Boleto/);
  assert.match(erroDasFormasSemCadastro(['Pagamento a Prazo'], c) || '', /Pagamento a Prazo/);
  assert.equal(erroDasFormasSemCadastro(['Boleto'], null), null, 'cliente cadastrado segue a regra de sempre');
});

test('fechamento: le o cliente a cadastrar e recusa boleto com ele', () => {
  const base = {
    idDocumento: 'venda123', dataVenda: '2026-11-27', vendedorId: 'vend1', clienteId: 'padrao', clienteNome: 'consumidor final',
    itens: [{ id: 'p1', nome: 'COPO', precoUnitario: 10, quantidade: 1, desconto: 0, subtotal: 10 }],
    descontoGeral: { tipo: 'valor', valorInformado: 0 },
    clienteSemCadastro: { nome: 'joao', cidade: 'caratinga' },
  };
  const ok = lerPedidoDeFechamento({ ...base, pagamentos: [{ id: 'pg1', forma: 'Pix', valor: '10' }] });
  assert.ok('pedido' in ok && ok.pedido);
  assert.deepEqual('pedido' in ok ? ok.pedido.clienteSemCadastro : null, { nome: 'JOAO', cidade: 'CARATINGA' });
  const recusa = lerPedidoDeFechamento({ ...base, pagamentos: [{ id: 'pg1', forma: 'Boleto', valor: '10' }] });
  assert.match('erro' in recusa ? String(recusa.erro) : '', /não tem cadastro/);
  const semNome = lerPedidoDeFechamento({ ...base, clienteSemCadastro: undefined, pagamentos: [{ id: 'pg1', forma: 'Pix', valor: '10' }] });
  assert.equal('pedido' in semNome && semNome.pedido ? semNome.pedido.clienteSemCadastro : 'x', null);
});

test('romaneio: entrega do cliente a cadastrar sai com o nome, a cidade e o telefone dele', () => {
  const consumidor = { codigo: '1', nome: 'CONSUMIDOR FINAL', endereco: 'RUA X', cidade: 'MANHUACU', estado: 'MG', telefone: '3300000000' };
  const e = montarEntregaDoPedido(
    { id: 'p1', numeroPedido: '10', clienteId: 'padrao', clienteNome: 'CONSUMIDOR FINAL', clienteSemCadastro: { nome: 'JOAO', cidade: 'CARATINGA', telefone: '33999990000' } },
    consumidor,
    null,
  );
  assert.equal(e.clienteNome, 'JOAO');
  assert.equal(e.clienteCodigo, '');
  assert.equal(e.endereco, '');
  assert.equal(e.cidade, 'CARATINGA');
  assert.equal(e.telefone, '(33) 99999-0000');
  const normal = montarEntregaDoPedido({ id: 'p2', clienteNome: 'MUNIZ' }, consumidor, null);
  assert.equal(normal.clienteNome, 'MUNIZ');
  assert.equal(normal.cidade, 'MANHUACU/MG');
});

test('app: bloco do cliente a cadastrar fecha apenas com nome, cidade e telefone', () => {
  assert.equal(clienteSemCadastroCompleto({ nome: 'joao', cidade: 'caratinga', telefone: '(33) 99999-0000' }), true);
  assert.equal(clienteSemCadastroCompleto({ nome: 'joao', cidade: 'caratinga', telefone: '3399' }), false);
  assert.equal(clienteSemCadastroCompleto({ nome: 'joao', cidade: '', telefone: '33999990000' }), false);
  assert.equal(clienteSemCadastroCompleto({ nome: 'j', cidade: 'caratinga', telefone: '33999990000' }), false);
  assert.equal(clienteSemCadastroCompleto(null), false);
  assert.equal(resumoDoClienteSemCadastro({ nome: 'joao', cidade: 'caratinga', telefone: '33999990000' }), 'JOAO · CARATINGA · (33) 99999-0000');
  assert.equal(resumoDoClienteSemCadastro({ nome: 'joao' }), 'JOAO');
  assert.equal(resumoDoClienteSemCadastro({ nome: '' }), '');
});
