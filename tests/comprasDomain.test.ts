import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cotacaoVencida,
  erroParaMudarStatus,
  erroParaResponder,
  escolhasSugeridas,
  lerEscolhas,
  lerPedidoDeCompra,
  lerPedidoDeCotacao,
  lerRespostaDoFornecedor,
  montarComparativo,
  pedidosDasEscolhas,
  responderAtePadrao,
  textoDoConvite,
  type Cotacao,
} from '../src/utils/comprasDomain';

/*
 * Compras (22/10/2026): cotacao com link por fornecedor, resposta do
 * fornecedor, comparativo e pedidos de compra gerados das escolhas.
 */

const erroDe = (r: { erro: string } | object): string => ('erro' in r ? r.erro : '');

const ITENS = [
  { produtoId: 'p1', codigo: '10', nome: 'ÓLEO 1L', unidade: 'UN', quantidade: 100, observacao: '' },
  { produtoId: 'p2', codigo: '11', nome: 'FILTRO', unidade: 'UN', quantidade: 20, observacao: '' },
];

const fornecedor = (id: string, nome: string, extra: Partial<Cotacao['fornecedores'][number]> = {}): Cotacao['fornecedores'][number] => ({
  fornecedorId: id, nome, email: '', celular: '', token: 't', codigoAcesso: '123456', status: 'aguardando', respondidoEmIso: '', precos: {}, prazoEntregaDias: null, condicaoPagamento: '', observacao: '', ...extra,
});

test('pedido de cotacao: titulo, itens sem repetir, fornecedores e data', () => {
  const ok = lerPedidoDeCotacao({ titulo: ' Reposição ', itens: ITENS, fornecedores: [{ fornecedorId: 'f1', nome: 'ACME', email: 'a@b.c', celular: '27 9' }], responderAte: '2026-10-29' });
  assert.ok('pedido' in ok);
  assert.equal(ok.pedido.titulo, 'Reposição');
  assert.equal(ok.pedido.itens[0].unidade, 'UN');
  assert.match(erroDe(lerPedidoDeCotacao({ titulo: 'x', itens: [], fornecedores: [{ fornecedorId: 'f1', nome: 'A' }], responderAte: '2026-10-29' })), /pelo menos um item/);
  assert.match(erroDe(lerPedidoDeCotacao({ titulo: 'x', itens: [ITENS[0], ITENS[0]], fornecedores: [{ fornecedorId: 'f1', nome: 'A' }], responderAte: '2026-10-29' })), /repetido/);
  assert.match(erroDe(lerPedidoDeCotacao({ titulo: 'x', itens: ITENS, fornecedores: [], responderAte: '2026-10-29' })), /fornecedor/);
  assert.match(erroDe(lerPedidoDeCotacao({ titulo: 'x', itens: ITENS, fornecedores: [{ fornecedorId: 'f1', nome: 'A' }] })), /até quando/);
  assert.equal(responderAtePadrao('2026-10-22'), '2026-10-29');
  assert.equal(cotacaoVencida('2026-10-29', '2026-10-29'), false);
  assert.equal(cotacaoVencida('2026-10-29', '2026-10-30'), true);
  assert.match(textoDoConvite({ empresa: 'LOJA', titulo: 'Reposição', link: 'https://x/cotacao/abc', codigoAcesso: '123456', responderAte: '2026-10-29' }), /código 123456[\s\S]*29\/10\/2026/);
});

test('resposta do fornecedor: precos em centavos, prazo e condicao; so responde cotacao aberta e no prazo', () => {
  const ok = lerRespostaDoFornecedor({ precos: { p1: 1250, p2: '' }, prazoEntregaDias: '5', condicaoPagamento: '28 dias' }, ITENS);
  assert.ok('resposta' in ok);
  assert.deepEqual(ok.resposta, { precos: { p1: 1250 }, prazoEntregaDias: 5, condicaoPagamento: '28 dias', observacao: '' });
  assert.match(erroDe(lerRespostaDoFornecedor({ precos: {} }, ITENS)), /pelo menos um item/);
  assert.match(erroDe(lerRespostaDoFornecedor({ precos: { p1: 12.5 } }, ITENS)), /Preço inválido/);
  assert.equal(erroParaResponder({ status: 'aberta', responderAte: '2026-10-29' }, '2026-10-22'), null);
  assert.match(erroParaResponder({ status: 'aberta', responderAte: '2026-10-29' }, '2026-10-30')!, /prazo/);
  assert.match(erroParaResponder({ status: 'fechada', responderAte: '2026-10-29' }, '2026-10-22')!, /fechada/);
});

test('comparativo: melhor preco por item, total por fornecedor e pedidos das escolhas', () => {
  const cotacao = {
    itens: ITENS,
    fornecedores: [
      fornecedor('f1', 'ACME', { status: 'respondida', precos: { p1: 1000, p2: 5000 }, prazoEntregaDias: 5, condicaoPagamento: '28 dias' }),
      fornecedor('f2', 'BETA', { status: 'respondida', precos: { p1: 900 }, prazoEntregaDias: 2 }),
      fornecedor('f3', 'GAMA'),
    ],
  };
  const { linhas, totais } = montarComparativo(cotacao);
  assert.equal(linhas[0].melhorFornecedorId, 'f2');
  assert.equal(linhas[1].melhorFornecedorId, 'f1');
  assert.deepEqual(totais.map((t) => [t.fornecedorId, t.totalCentavos, t.completo, t.itensCotados]), [['f1', 200000, true, 2], ['f2', 90000, false, 1], ['f3', 0, false, 0]]);
  const sugeridas = escolhasSugeridas(linhas);
  assert.deepEqual(sugeridas, { p1: 'f2', p2: 'f1' });
  const lidas = lerEscolhas({ escolhas: sugeridas }, cotacao);
  assert.ok('escolhas' in lidas);
  assert.match(erroDe(lerEscolhas({ escolhas: { p2: 'f2' } }, cotacao)), /não cotou/);
  const pedidos = pedidosDasEscolhas(cotacao, sugeridas);
  assert.equal(pedidos.length, 2);
  const beta = pedidos.find((p) => p.fornecedorId === 'f2')!;
  assert.equal(beta.totalCentavos, 90000);
  assert.equal(beta.prazoEntregaDias, 2);
  assert.equal(pedidos.find((p) => p.fornecedorId === 'f1')!.itens[0].nome, 'FILTRO');
});

test('pedido de compra a mao e transicoes de status', () => {
  const ok = lerPedidoDeCompra({ fornecedorId: 'f1', fornecedorNome: 'ACME', itens: [{ ...ITENS[0], precoUnitarioCentavos: 1000 }], prazoEntregaDias: 3, condicaoPagamento: 'à vista' });
  assert.ok('pedido' in ok);
  assert.equal(ok.pedido.totalCentavos, 100000);
  assert.match(erroDe(lerPedidoDeCompra({ fornecedorId: 'f1', fornecedorNome: 'ACME', itens: [ITENS[0]] })), /preço de ÓLEO/);
  assert.equal(erroParaMudarStatus('aberto', 'enviado'), null);
  assert.equal(erroParaMudarStatus('enviado', 'recebido'), null);
  assert.equal(erroParaMudarStatus('aberto', 'cancelado'), null);
  assert.match(erroParaMudarStatus('aberto', 'recebido')!, /enviado/);
  assert.match(erroParaMudarStatus('recebido', 'cancelado')!, /já foi recebido/);
  assert.match(erroParaMudarStatus('cancelado', 'enviado')!, /cancelado/);
});
