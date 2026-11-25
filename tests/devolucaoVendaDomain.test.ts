import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUS_DEVOLUCAO,
  camposDaDevolucao,
  comissaoAposDevolucao,
  creditoDaDevolucao,
  devolucaoTeveEfeito,
  disponivelParaDevolver,
  ehPedidoDoAppVendas,
  erroParaDecidirDevolucao,
  erroParaDevolverPeloApp,
  lancamentoDaDevolucao,
  lerMotivoDaRecusa,
  lerPedidoDeDevolucaoDoApp,
  montarItensDevolvidos,
  parseConfigDevolucaoApp,
  planoDaDevolucao,
  quantidadesEmAguardo,
  saldoDoBancoAposDevolucao,
  situacaoDaDevolucao,
} from '../src/utils/devolucaoVendaDomain';
import { movimentosDaDevolucaoVenda } from '../src/utils/movimentosEstoqueDomain';

const ID_APP = '0123456789abcdef0123456789abcdef';
const itens = [
  { id: 'p1', nome: 'SACO DE RACAO', precoUnitario: 100, quantidade: 4, desconto: 40, quantidadeJaDevolvida: 1, fatorConversao: 20, unidadeMedidaSigla: 'SC' },
  { id: 'p2', nome: 'COLEIRA', precoUnitario: 30, quantidade: 2, desconto: 0, lotes: [{ loteId: 'L1', lote: 'A', validade: null, quantidade: 1 }, { loteId: 'L2', lote: 'B', validade: null, quantidade: 1 }] },
];

test('situacao: sem campo conta como confirmada; aguardando e recusada nao tem efeito', () => {
  assert.equal(situacaoDaDevolucao({}), 'concluida');
  assert.equal(situacaoDaDevolucao({ status: 'qualquer' }), 'concluida');
  assert.equal(devolucaoTeveEfeito({}), true);
  assert.equal(devolucaoTeveEfeito({ status: 'estornada' }), true);
  assert.equal(devolucaoTeveEfeito({ status: STATUS_DEVOLUCAO.aguardando }), false);
  assert.equal(devolucaoTeveEfeito({ status: STATUS_DEVOLUCAO.recusada }), false);
});

test('disponivel desconta o ja devolvido e o que esta aguardando confirmacao', () => {
  const aguardo = quantidadesEmAguardo([
    { id: 'a', status: 'aguardando_confirmacao', itensDevolvidos: [{ indice: 0, quantidadeDevolvida: 2 }] },
    { id: 'b', status: 'recusada', itensDevolvidos: [{ indice: 0, quantidadeDevolvida: 1 }] },
    { id: 'c', status: 'concluida', itensDevolvidos: [{ indice: 0, quantidadeDevolvida: 1 }] },
  ]);
  assert.equal(aguardo.get(0), 2);
  assert.equal(disponivelParaDevolver(itens[0], aguardo.get(0)), 1);
  // A propria devolucao (reenvio) nao conta contra ela mesma.
  assert.equal(quantidadesEmAguardo([{ id: 'a', status: 'aguardando_confirmacao', itensDevolvidos: [{ indice: 0, quantidadeDevolvida: 2 }] }], 'a').size, 0);
});

test('montar itens: valor com desconto proporcional e recusa acima do disponivel', () => {
  const r = montarItensDevolvidos(itens, [{ indice: 0, id: 'p1', nome: 'SACO DE RACAO', quantidade: 2 }]);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.valorTotal, 180); // 2 x 100 - 40 x (2/4)
  assert.equal(r.itensDevolvidos[0].indice, 0);
  assert.equal(r.itensDevolvidos[0].fatorConversao, 20);
  const acima = montarItensDevolvidos(itens, [{ indice: 0, id: 'p1', nome: 'SACO DE RACAO', quantidade: 2 }], new Map([[0, 2]]));
  assert.ok(!acima.ok);
  if (!acima.ok) assert.match(acima.erro, /no máximo 1.*aguardando confirmação/);
  const nada = montarItensDevolvidos(itens, []);
  assert.ok(!nada.ok);
});

test('plano: soma no pedido, estoque na unidade base e volta ao mesmo lote', () => {
  const r = planoDaDevolucao(itens, [
    { id: 'p1', nome: 'SACO DE RACAO', quantidadeDevolvida: 2, indice: 0, fatorConversao: 20 },
    { id: 'p2', nome: 'COLEIRA', quantidadeDevolvida: 1, indice: 1 },
  ]);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.plano.itensAtualizados[0].quantidadeJaDevolvida, 3);
  assert.equal(r.plano.itensAtualizados[1].quantidadeJaDevolvida, 1);
  assert.deepEqual(r.plano.estoqueQueVolta.map((e) => [e.id, e.quantidade]), [['p1', 40], ['p2', 1]]);
  assert.deepEqual(r.plano.lotesQueVoltam.map((l) => [l.loteId, l.quantidade]), [['L1', 1]]);
  // Outra devolucao entrou no meio: recusa.
  const demais = planoDaDevolucao(itens, [{ id: 'p1', nome: 'SACO DE RACAO', quantidadeDevolvida: 4, indice: 0 }]);
  assert.ok(!demais.ok);
  if (!demais.ok) assert.match(demais.erro, /foi alterada/);
  // Devolucao antiga sem indice casa por id + nome.
  const antiga = planoDaDevolucao(itens, [{ id: 'p2', nome: 'COLEIRA', quantidadeDevolvida: 1 }]);
  assert.ok(antiga.ok);
});

test('dinheiro: caixa e banco com a categoria "Devolução de Venda"; credito com o codigo do cliente', () => {
  const base = { devolucaoId: 'd1', pedidoId: 'v1', numeroPedido: '0104', clienteNome: 'JOAO', clienteId: 'c1', valor: 50, motivo: 'Outro', tenantId: 'e1', hoje: '2026-11-24' };
  const caixa = lancamentoDaDevolucao({ ...base, destino: 'caixa' });
  assert.equal(caixa?.categoria, 'Devolução de Venda');
  assert.equal(caixa?.naturezaFinanceira, 'caixa_fisico');
  assert.equal(caixa?.valorCentavos, 5000);
  const banco = lancamentoDaDevolucao({ ...base, destino: 'banco', bancoId: 'b1', bancoNome: 'SICOOB', formaBancaria: 'Pix' });
  assert.equal(banco?.categoria, 'Devolução de Venda');
  assert.equal(banco?.descricao, 'Devolução Pedido #0104 - Pix (SICOOB)');
  assert.equal(lancamentoDaDevolucao({ ...base, destino: 'credito' }), null);
  assert.equal(creditoDaDevolucao({ ...base, destino: 'credito' })?.clienteId, 'c1');
  assert.equal(creditoDaDevolucao({ ...base, destino: 'caixa' }), null);
  assert.equal(saldoDoBancoAposDevolucao(10000, 50), 5000);
});

test('documento da devolucao nunca leva undefined', () => {
  const campos = camposDaDevolucao({
    pedidoId: 'v1', numeroPedido: '0104', clienteNome: 'JOAO', valorTotal: 10, destino: 'credito', motivo: 'Outro', observacao: '',
    tenantId: 'e1', usuarioId: 'u1', itensDevolvidos: [], status: 'aguardando_confirmacao', origem: 'app', devolucaoId: 'd1',
  });
  assert.ok(Object.values(campos).every((v) => v !== undefined));
  assert.equal(campos.origem, 'app');
  assert.equal('bancoId' in campos, false);
});

test('comissao so e refeita na venda com a regra nova', () => {
  assert.equal(comissaoAposDevolucao(null, []), null);
  assert.equal(comissaoAposDevolucao({ percentual: 5 } as never, []), null);
});

test('app: so pedido do app, do proprio vendedor, faturado', () => {
  const pedido = { status: 'Finalizada', criadoPor: 'v1', vendedorId: 'v1' };
  assert.equal(ehPedidoDoAppVendas(ID_APP), true);
  assert.equal(ehPedidoDoAppVendas(`${ID_APP}b`), true);
  assert.equal(ehPedidoDoAppVendas('zWWih8mhQhkL8y0XDnmy'), false);
  assert.equal(erroParaDevolverPeloApp(ID_APP, pedido, 'v1'), null);
  assert.match(String(erroParaDevolverPeloApp('zWWih8mhQhkL8y0XDnmy', pedido, 'v1')), /feito no aplicativo/);
  assert.match(String(erroParaDevolverPeloApp(ID_APP, pedido, 'v2')), /outro vendedor/);
  assert.match(String(erroParaDevolverPeloApp(ID_APP, { ...pedido, status: 'Pré-venda' }, 'v1')), /faturado/);
  assert.match(String(erroParaDevolverPeloApp(ID_APP, { ...pedido, status: 'Cancelada' }, 'v1')), /cancelado/);
  assert.match(String(erroParaDevolverPeloApp(ID_APP, { ...pedido, importadoSistemaAnterior: true }, 'v1')), /sistema anterior/);
});

test('configuracao: nasce desligada; "ja confirmada" so vale com a devolucao permitida', () => {
  assert.deepEqual(parseConfigDevolucaoApp({}), { permitida: false, jaConfirmada: false });
  assert.deepEqual(parseConfigDevolucaoApp({ appDevolucaoJaConfirmada: true }), { permitida: false, jaConfirmada: false });
  assert.deepEqual(parseConfigDevolucaoApp({ appDevolucaoPermitida: true, appDevolucaoJaConfirmada: true }), { permitida: true, jaConfirmada: true });
});

test('corpo do app: confere motivo, destino, banco e itens', () => {
  const ok = lerPedidoDeDevolucaoDoApp({ pedidoId: ID_APP, itens: [{ indice: 0, quantidade: 1 }], motivo: 'Outro', destino: 'banco', bancoId: 'b1', formaBancaria: 'Pix' });
  assert.ok(!('erro' in ok));
  assert.match(String((lerPedidoDeDevolucaoDoApp({ pedidoId: ID_APP, itens: [], motivo: 'Outro', destino: 'credito' }) as { erro: string }).erro), /pelo menos um item/);
  assert.match(String((lerPedidoDeDevolucaoDoApp({ pedidoId: ID_APP, itens: [{ indice: 0, quantidade: 1 }], motivo: 'Inventado', destino: 'credito' }) as { erro: string }).erro), /motivo/);
  assert.match(String((lerPedidoDeDevolucaoDoApp({ pedidoId: ID_APP, itens: [{ indice: 0, quantidade: 1 }], motivo: 'Outro', destino: 'banco' }) as { erro: string }).erro), /banco/);
  assert.match(String((lerPedidoDeDevolucaoDoApp({ pedidoId: ID_APP, itens: [{ indice: 0, quantidade: 1 }, { indice: 0, quantidade: 1 }], motivo: 'Outro', destino: 'credito' }) as { erro: string }).erro), /duas vezes/);
});

test('confirmar e recusar so a que esta aguardando; recusa exige motivo', () => {
  assert.equal(erroParaDecidirDevolucao({ status: 'aguardando_confirmacao' }, 'confirmar'), null);
  assert.match(String(erroParaDecidirDevolucao({ status: 'concluida' }, 'recusar')), /Confirmada/);
  assert.match(String(erroParaDecidirDevolucao(null, 'confirmar')), /não existe/);
  assert.equal(lerMotivoDaRecusa('  ').ok, false);
  assert.equal(lerMotivoDaRecusa('Mercadoria avariada').ok, true);
});

test('movimento de estoque: aguardando e recusada nao entram; confirmada entra na data da confirmacao', () => {
  const base = { id: 'd1', numeroPedidoOriginal: '0104', createdAtMillis: 1000, itensDevolvidos: [{ id: 'p1', quantidadeDevolvida: 1 }] };
  assert.equal(movimentosDaDevolucaoVenda({ ...base, status: 'aguardando_confirmacao' }).length, 0);
  assert.equal(movimentosDaDevolucaoVenda({ ...base, status: 'recusada' }).length, 0);
  const confirmada = movimentosDaDevolucaoVenda({ ...base, status: 'concluida', confirmadaEmMillis: 5000 });
  assert.equal(confirmada[0].dataMillis, 5000);
  assert.equal(movimentosDaDevolucaoVenda({ ...base }).length, 1);
});
