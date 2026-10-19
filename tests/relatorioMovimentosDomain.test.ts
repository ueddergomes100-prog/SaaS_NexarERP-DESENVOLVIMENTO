import assert from 'node:assert/strict';
import { test } from 'node:test';
import { montarDocumentoExtratoBanco, valorNoExtratoCentavos } from '../src/utils/relatorioExtratoBancoDomain';
import {
  destinoDaDevolucao,
  montarDocumentoCondicionais,
  montarDocumentoDevolucoes,
  montarDocumentoNotasAvulsas,
  montarDocumentoTransferencias,
} from '../src/utils/relatorioMovimentosDomain';
import type { ColunaRelatorio } from '../src/utils/relatorioPdfDomain';

/* Relatorios que faltavam nas telas de movimento (19/10/2026). */

const coluna = <T,>(doc: { secoes: Array<{ id: string; colunas: ColunaRelatorio<T>[] }> }, id: string, secao = 0) => {
  const c = doc.secoes[secao].colunas.find((col) => col.id === id);
  assert.ok(c, `coluna ${id}`);
  return c;
};

test('extrato do banco: saida entra negativa, movimento do periodo e cartao a conciliar', () => {
  const pix = { id: 't1', data: '2026-10-19', tipo: 'entrada' as const, valor: 108.5, valorCentavos: 10850, formaPagamento: 'Pix', descricao: 'Recebimento OS #07 - Pix', bancoNome: 'SICOOB' };
  const tarifa = { id: 't2', data: '2026-10-18', dataPagamento: '2026-10-18', tipo: 'saida' as const, valor: 10, valorCentavos: 1000, formaPagamento: 'Transferência', descricao: 'Tarifa' };
  const cartao = { id: 't3', data: '2026-10-19', dataPrevistaRecebimento: '2026-11-18', descricao: 'Venda #0088 - Cartão', tipo: 'entrada' as const, valor: 100, valorCentavos: 10000, formaPagamento: 'Cartão de Crédito', cartao: { bandeira: 'VISA', numero: 1, totalParcelas: 2, valorTaxaCentavos: 300, valorLiquidoCentavos: 9700 } };
  assert.equal(valorNoExtratoCentavos(tarifa), -1000);
  const doc = montarDocumentoExtratoBanco({ extrato: [pix, tarifa], cartaoAConciliar: [cartao], saldos: [{ nome: 'SICOOB', saldoCentavos: 42589 }], periodo: 'Últimos 30 dias', filtrosAplicados: [] });
  assert.deepEqual(doc.indicadores.slice(0, 4).map((i) => i.valor), ['R$ 108,50', 'R$ 10,00', 'R$ 98,50', 'R$ 97,00']);
  assert.equal(doc.indicadores[4].rotulo, 'Saldo hoje — SICOOB');
  assert.equal(coluna(doc, 'data').valor(tarifa), '18/10/2026');
  assert.equal(coluna(doc, 'descricao', 1).valor(cartao), 'Venda #0088 - Cartão (1/2)');
  assert.equal(coluna(doc, 'previsto', 1).valor(cartao), '18/11/2026');
  assert.equal(coluna(doc, 'liquido', 1).valor(cartao), 9700);
  assert.equal(doc.secoes[1].opcional, true);
});

test('condicionais: vencido marcado, pecas e valor com o cliente, pre-venda gerada', () => {
  const itens = [{ id: 'p1', nome: 'BLUSA', quantidade: 3, quantidadeDevolvida: 1, precoUnitario: 50 }];
  const doc = montarDocumentoCondicionais([
    { id: 'c1', numeroCondicional: '12', clienteNome: 'ANA', itens, prazoDevolucao: '2026-10-10', dataSaida: '2026-10-05', status: 'aberto' },
    { id: 'c2', numeroCondicional: '13', clienteNome: 'BIA', itens, prazoDevolucao: '2026-10-30', dataSaida: '2026-10-05', status: 'finalizado', numeroPedido: '0090' },
  ] as never, { hoje: '2026-10-19', periodo: 'Este mês', filtrosAplicados: [] });
  const [vencido, finalizado] = doc.secoes[0].linhas;
  assert.equal(coluna(doc, 'prazo').valor(vencido), '10/10/2026 (vencido)');
  assert.equal(coluna(doc, 'comCliente').valor(vencido), 2);
  assert.equal(coluna(doc, 'valorComCliente').valor(vencido), 10000);
  assert.match(String(coluna(doc, 'situacao').valor(finalizado)), /pré-venda #0090/);
  assert.equal(doc.indicadores[1].valor, '1');
});

test('transferencias: de/para, valor de custo, nota e situacao com falta', () => {
  const doc = montarDocumentoTransferencias([
    { id: 't1', numeroTransferencia: '5', origemCodigo: '01', origemNome: 'MATRIZ', destinoCodigo: '02', destinoNome: 'LOJA', status: 'recebida', divergente: true, comNota: false, itens: [{}, {}], valorCentavos: 15000 },
    { id: 't2', numeroTransferencia: '6', status: 'em_transito', comNota: true, notaFiscal: { number: 31, status: 'authorized' }, itens: [], valorCentavos: 5000 },
  ], { periodo: 'Enviadas neste mês', filtrosAplicados: [] });
  const [recebida, emTransito] = doc.secoes[0].linhas;
  assert.equal(coluna(doc, 'origem').valor(recebida), '01 MATRIZ');
  assert.equal(coluna(doc, 'itens').valor(recebida), 2);
  assert.match(String(coluna(doc, 'situacao').valor(recebida)), /\(com falta\)/);
  assert.match(String(coluna(doc, 'nota').valor(emTransito)), /^NF-e nº 31/);
  assert.equal(coluna(doc, 'nota').valor(recebida), 'Sem nota');
  assert.deepEqual(doc.indicadores.map((i) => i.valor), ['2', '1', 'R$ 200,00']);
});

test('notas avulsas: cancelada nao entra no total', () => {
  const doc = montarDocumentoNotasAvulsas([
    { id: 'n1', numero: '1', fornecedorNome: 'ATACADO', itens: [{}], valorTotal: 120.5, formaPagamento: 'a_vista', destinoPagamento: 'banco', bancoNome: 'SICOOB', status: 'ativa', createdAt: { seconds: 1760000000 } },
    { id: 'n2', numero: '2', fornecedorNome: 'ATACADO', itens: [{}], valorTotal: 80, formaPagamento: 'pendente', status: 'cancelada' },
  ], { periodo: '01/10/2026 a 19/10/2026', filtrosAplicados: [], statusCancelada: 'cancelada' });
  const [ativa, cancelada] = doc.secoes[0].linhas;
  assert.equal(coluna(doc, 'total').valor(ativa), 12050);
  assert.equal(coluna(doc, 'total').valor(cancelada), 0);
  assert.equal(coluna(doc, 'saiuDe').valor(ativa), 'SICOOB');
  assert.equal(coluna(doc, 'situacao').valor(cancelada), 'Cancelada');
  assert.equal(doc.indicadores[2].valor, 'R$ 120,50');
});

test('devolucoes: destino do valor, estornada nao conta e itens em secao opcional', () => {
  assert.equal(destinoDaDevolucao({ id: 'x', destinoValor: 'credito' }), 'Crédito do cliente');
  assert.equal(destinoDaDevolucao({ id: 'x', destinoValor: 'banco', formaDevolucao: 'Pix', bancoNome: 'SICOOB' }), 'Pix — SICOOB');
  const doc = montarDocumentoDevolucoes([
    { id: 'd1', numeroPedidoOriginal: '0088', clienteNome: 'ANA', valorTotalDevolvidoCentavos: 850, destinoValor: 'credito', status: 'concluida', itensDevolvidos: [{ nome: 'FARINHA', quantidadeDevolvida: 1, subtotal: 8.5 }], createdAt: { seconds: 1760900000 } },
    { id: 'd2', numeroPedidoOriginal: '0087', clienteNome: 'ANA', valorTotalDevolvidoCentavos: 1700, destinoValor: 'caixa', status: 'estornada', itensDevolvidos: [{ nome: 'FARINHA', quantidadeDevolvida: 2, subtotal: 17 }] },
  ], { periodo: 'Período: 01/10/2026 a 19/10/2026', filtrosAplicados: [] });
  const [valida, estornada] = doc.secoes[0].linhas;
  assert.equal(coluna(doc, 'valor').valor(valida), 850);
  assert.equal(coluna(doc, 'valor').valor(estornada), 0);
  assert.equal(coluna(doc, 'situacao').valor(estornada), 'Estornada');
  assert.deepEqual(doc.indicadores.map((i) => i.valor), ['1', 'R$ 8,50', 'R$ 8,50', 'R$ 0,00', '1']);
  assert.equal(doc.secoes[1].linhas.length, 1, 'item da estornada fica de fora');
  assert.equal(doc.secoes[1].opcional, true);
});
