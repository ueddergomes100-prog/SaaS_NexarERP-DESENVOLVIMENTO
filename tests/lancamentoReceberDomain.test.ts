import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bloqueioParaMexerNaConta,
  ehContaAvulsa,
  lerPedidoDeLancamento,
  mudancasDaEdicao,
  nomeDoDevedor,
  titulosDoLancamento,
} from '../src/utils/lancamentoReceberDomain';
import { faltandoNoPagador, pagadorDoCadastro } from '../src/utils/cobrancaEmBoletoDomain';
import { chaveDoClienteDoTitulo } from '../src/utils/renegociacaoDomain';

/* Conta a receber lancada a mao (19/10/2026). */

const corpo = (extra = {}) => ({
  idLancamento: 'abc12345XYZ',
  devedor: { tipo: 'fornecedor', id: 'f1' },
  descricao: '  devolução   em dinheiro ',
  categoria: '',
  formaPrevista: 'Dinheiro',
  documento: '',
  observacao: '',
  parcelas: [{ vencimento: '2026-11-10', valorCentavos: 5000 }, { vencimento: '2026-12-10', valorCentavos: 5000 }],
  ...extra,
});

test('pedido de lancamento: valida e limpa o texto', () => {
  const lido = lerPedidoDeLancamento(corpo());
  assert.ok('pedido' in lido);
  if (!('pedido' in lido)) return;
  assert.equal(lido.pedido.descricao, 'devolução em dinheiro');
  assert.ok('erro' in lerPedidoDeLancamento(corpo({ devedor: { tipo: 'banco', id: 'x' } })));
  assert.ok('erro' in lerPedidoDeLancamento(corpo({ idLancamento: 'curto' })));
  assert.ok('erro' in lerPedidoDeLancamento(corpo({ parcelas: [] })));
  assert.ok('erro' in lerPedidoDeLancamento(corpo({ parcelas: [{ vencimento: '10/11/2026', valorCentavos: 100 }] })));
  assert.ok('erro' in lerPedidoDeLancamento(corpo({ parcelas: [{ vencimento: '2026-11-10', valorCentavos: 10.5 }] })));
});

test('titulos: um por parcela, dinheiro e\' caixa fisico, sem categoria vira OUTRAS RECEITAS', () => {
  const lido = lerPedidoDeLancamento(corpo());
  if (!('pedido' in lido)) throw new Error('pedido invalido');
  const titulos = titulosDoLancamento(lido.pedido, 'ALFA', { uid: 'u1', nome: 'MARIA' });
  assert.deepEqual(titulos.map((t) => t.id), ['lanc_abc12345XYZ_p1', 'lanc_abc12345XYZ_p2']);
  assert.equal(titulos[0].campos.descricao, 'DEVOLUÇÃO EM DINHEIRO (Parcela 1/2)');
  assert.equal(titulos[0].campos.categoria, 'OUTRAS RECEITAS');
  assert.equal(titulos[0].campos.naturezaFinanceira, 'caixa_fisico');
  assert.equal(titulos[0].campos.movimentaCaixaFisico, false, 'em aberto nao mexe no caixa; a baixa mexe');
  assert.equal(titulos[0].campos.fornecedorNome, 'ALFA');
  assert.equal('clienteId' in titulos[0].campos, false);
  assert.equal('lancadoPorEmail' in titulos[0].campos, false);
});

test('conta avulsa e o que bloqueia editar/cancelar', () => {
  const avulsa = { tipo: 'entrada', status: 'Pendente', origemLancamento: 'manual' };
  assert.equal(ehContaAvulsa(avulsa), true);
  assert.equal(ehContaAvulsa({ ...avulsa, origemLancamento: undefined, origemImportacao: 'migracao_cadastro' }), true);
  assert.equal(ehContaAvulsa({ ...avulsa, osId: 'os1' }), false);
  assert.equal(bloqueioParaMexerNaConta(avulsa, 'editar'), '');
  assert.match(bloqueioParaMexerNaConta({ ...avulsa, pagoParcialCentavos: 100 }, 'cancelar'), /pagamento parcial/);
  assert.match(bloqueioParaMexerNaConta({ ...avulsa, status: 'Renegociada' }, 'editar'), /Só contas em aberto/);
  assert.equal(bloqueioParaMexerNaConta({ ...avulsa, boleto: { status: 'cancelado' } }, 'editar'), '', 'boleto desfeito libera');
});

test('nome de quem deve e pagador do boleto: cliente (documento) ou fornecedor (cnpj)', () => {
  assert.equal(nomeDoDevedor({ fornecedorNome: 'ALFA' }), 'ALFA');
  assert.equal(nomeDoDevedor({ clienteNome: 'JOSE', fornecedorNome: 'ALFA' }), 'JOSE');
  const fornecedor = pagadorDoCadastro({ nome: 'alfa', cnpj: '12.345.678/0001-99', cep: '35700-000', cidade: 'Sete Lagoas', estado: 'mg' });
  assert.equal(fornecedor.documento, '12345678000199');
  assert.equal(fornecedor.uf, 'MG');
  assert.deepEqual(faltandoNoPagador(fornecedor), []);
  assert.deepEqual(faltandoNoPagador(pagadorDoCadastro({ documento: '123' }, 'X')), ['CPF/CNPJ', 'CEP', 'cidade', 'UF']);
});

test('renegociacao: conta de fornecedor so\' junto com contas do mesmo fornecedor', () => {
  assert.equal(chaveDoClienteDoTitulo({ fornecedorId: 'f1' }), 'fornecedor:f1');
  assert.equal(chaveDoClienteDoTitulo({ clienteId: 'c1' }), 'id:c1');
});

test('editar: so maiuscula/minuscula diferente na descricao nao conta como mudanca', () => {
  const atual = { descricao: 'ACERTO (Parcela 1/2)', categoria: 'OUTRAS RECEITAS', formaPagamento: 'Pix', dataVencimento: '2026-11-10', clienteId: 'c1', clienteNome: 'JOSE' };
  const pedido = { transacaoId: 't1', devedor: { tipo: 'cliente' as const, id: 'c1' }, descricao: 'acerto (parcela 1/2)', categoria: 'Outras Receitas', formaPrevista: 'Pix', documento: '', observacao: '', vencimento: '2026-11-10' };
  assert.deepEqual(mudancasDaEdicao(atual, pedido, 'JOSE').alteracoes, []);
  const outra = mudancasDaEdicao(atual, { ...pedido, descricao: 'acerto novo' }, 'JOSE');
  assert.equal(outra.campos.descricao, 'ACERTO NOVO');
});
