import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cotacaoVencida,
  erroParaLancarPropostaManual,
  erroParaMudarStatus,
  erroParaResponder,
  escolhasSugeridas,
  lerEscolhas,
  lerPedidoDeCompra,
  lerPedidoDeCotacao,
  lerPropostasManuais,
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

test('proposta lancada a mao: so os fornecedores que vieram; sem preco volta a aguardando; so cotacao aberta', () => {
  const cotacao = { itens: ITENS, fornecedores: [fornecedor('f1', 'ACME'), fornecedor('f2', 'BETA', { status: 'respondida', precos: { p1: 900 } }), fornecedor('f3', 'GAMA')] };
  const lidas = lerPropostasManuais({ propostas: {
    f1: { precos: { p1: 1000, p2: '' }, prazoEntregaDias: 5, condicaoPagamento: ' 28 dias ' },
    f2: { precos: { p1: 0, p2: '' }, prazoEntregaDias: '', condicaoPagamento: '' },
  } }, cotacao);
  assert.ok('propostas' in lidas);
  if (!('propostas' in lidas)) return;
  // f3 nao veio: nao e' tocado.
  assert.deepEqual(lidas.propostas.map((p) => p.fornecedorId), ['f1', 'f2']);
  assert.deepEqual(lidas.propostas[0].resposta, { precos: { p1: 1000 }, prazoEntregaDias: 5, condicaoPagamento: '28 dias', observacao: '' });
  assert.equal(lidas.propostas[1].resposta, null, 'todos os precos apagados = limpar a proposta');

  assert.match(erroDe(lerPropostasManuais({ propostas: { f1: { precos: { p1: 10.5 } } } }, cotacao)), /^ACME: Preço inválido em ÓLEO 1L/);
  assert.match(erroDe(lerPropostasManuais({ propostas: { f1: { precos: { p1: 1000 }, prazoEntregaDias: 999 } } }, cotacao)), /^ACME: Prazo de entrega inválido/);
  assert.match(erroDe(lerPropostasManuais({ propostas: { fX: { precos: { p1: 1000 } } } }, cotacao)), /não está mais nesta cotação/);
  assert.match(erroDe(lerPropostasManuais({ propostas: {} }, cotacao)), /Nenhum preço foi alterado/);
  assert.match(erroDe(lerPropostasManuais(null, cotacao)), /Nenhum preço foi alterado/);

  assert.equal(erroParaLancarPropostaManual('aberta'), null);
  assert.match(erroParaLancarPropostaManual('fechada')!, /já foi fechada/);
  assert.match(erroParaLancarPropostaManual('cancelada')!, /cancelada/);
});

test('itens ganhos por fornecedor: so os itens em que ele foi o escolhido, com o preco dele', () => {
  const cotacao = {
    itens: ITENS,
    fornecedores: [
      fornecedor('f1', 'ACME', { status: 'respondida', precos: { p1: 1000, p2: 5000 }, prazoEntregaDias: 5, condicaoPagamento: '28 dias' }),
      fornecedor('f2', 'BETA', { status: 'respondida', precos: { p1: 900 }, prazoEntregaDias: 2 }),
    ],
  };
  const ganhos = pedidosDasEscolhas(cotacao, { p1: 'f2', p2: 'f1' });
  assert.deepEqual(ganhos.map((g) => [g.fornecedorNome, g.itens.map((i) => i.nome), g.totalCentavos]), [
    ['BETA', ['ÓLEO 1L'], 90000],
    ['ACME', ['FILTRO'], 100000],
  ]);
  // Item sem fornecedor escolhido ("Nao comprar agora") nao entra em ninguem.
  assert.deepEqual(pedidosDasEscolhas(cotacao, { p2: 'f1' }).map((g) => g.itens.length), [1]);
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
  assert.equal(textoDoConvite({ empresa: 'LOJA', titulo: 'Reposição', link: 'https://x/c/ABC12345', codigoAcesso: '123456', responderAte: '2026-10-29' }), 'Cotação LOJA — Reposição\nLink: https://x/c/ABC12345\nCódigo: 123456\nResponder até 29/10/2026');
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
