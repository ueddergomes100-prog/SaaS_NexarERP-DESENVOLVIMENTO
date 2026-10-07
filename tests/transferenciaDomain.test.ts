import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  custoMedioDepoisDaEntrada,
  escolherLotesParaEnvio,
  idDoProdutoNaFilial,
  planejarEnvio,
  planejarRecebimento,
  podeTransferirSemNota,
  proximoStatusPermitido,
  retornoCompleto,
  type ProdutoNaFilial,
} from '../src/utils/transferenciaDomain';

const HOJE = '2026-10-06';
const A = 'centro';
const B = 'baixada';

const racao: ProdutoNaFilial = {
  id: 'p1', tenantId: A, nome: 'RAÇÃO 15KG', codigo: '1001', grupoChave: 'p1', filialOrigem: A,
  quantidade: 20, quantidadeReservada: 2, precoCusto: 120, unidadeMedidaSigla: 'SC', unidadeMedidaFracionado: false,
};
const oleo: ProdutoNaFilial = {
  id: 'p2_centro', tenantId: A, nome: 'ÓLEO DE COCO 500ML', codigo: '2002', grupoChave: 'p2', filialOrigem: B,
  quantidade: 10, precoCusto: 18.5, controlarLote: true, unidadeMedidaSigla: 'UN',
};

test('quem faz transferencia sem nota: dono, administrador ou gerente', () => {
  assert.equal(podeTransferirSemNota({ role: 'Master' }), true);
  assert.equal(podeTransferirSemNota({ role: 'Funcionario', nivelAcesso: 'gerente' }), true);
  assert.equal(podeTransferirSemNota({ role: 'Funcionario', nivelAcesso: 'funcionario' }), false);
});

test('produto no destino: original na filial do cadastro, copia nas outras', () => {
  assert.equal(idDoProdutoNaFilial('p1', A, B), 'p1_baixada');
  assert.equal(idDoProdutoNaFilial('p2', B, B), 'p2');
});

test('envio: baixa na origem, respeita reservado e unidade inteira, custo vai junto', () => {
  const plano = planejarEnvio({ origem: A, destino: B, pedidos: [{ produtoId: 'p1', quantidade: 5 }, { produtoId: 'p1', quantidade: 3 }], produtos: { p1: racao }, lotesPorProduto: {}, hoje: HOJE });
  assert.equal(plano.ok, true);
  if (!plano.ok) return;
  assert.equal(plano.itens.length, 1, 'mesma linha repetida vira uma');
  assert.equal(plano.itens[0].quantidade, 8);
  assert.equal(plano.itens[0].produtoIdDestino, 'p1_baixada');
  assert.equal(plano.itens[0].custoUnitario, 120);
  assert.deepEqual(plano.baixas.map((b) => [b.produtoId, b.quantidadeAntes, b.quantidadeDepois]), [['p1', 20, 12]]);
  assert.equal(plano.valorCentavos, 96000);

  const demais = planejarEnvio({ origem: A, destino: B, pedidos: [{ produtoId: 'p1', quantidade: 19 }], produtos: { p1: racao }, lotesPorProduto: {}, hoje: HOJE });
  assert.equal(demais.ok, false);
  if (!demais.ok) assert.match(demais.erros[0], /Estoque insuficiente de RAÇÃO 15KG: disponível 18, pedido 19/);
  const quebrado = planejarEnvio({ origem: A, destino: B, pedidos: [{ produtoId: 'p1', quantidade: 1.5 }], produtos: { p1: racao }, lotesPorProduto: {}, hoje: HOJE });
  assert.equal(quebrado.ok, false);
  if (!quebrado.ok) assert.match(quebrado.erros[0], /não aceita quantidade quebrada/);
});

test('envio com lote: FEFO, vencido por ultimo, sobra sem lote', () => {
  const lotes = [
    { id: 'l1', produtoId: 'p2_centro', lote: 'B2', validade: '2027-01-10', quantidade: 3 },
    { id: 'l2', produtoId: 'p2_centro', lote: 'A1', validade: '2026-11-01', quantidade: 2 },
    { id: 'l3', produtoId: 'p2_centro', lote: 'Z9', validade: '2026-09-01', quantidade: 4 },
  ];
  const escolha = escolherLotesParaEnvio(6, lotes, HOJE);
  assert.deepEqual(escolha.lotes.map((l) => [l.lote, l.quantidade]), [['A1', 2], ['B2', 3], ['Z9', 1]]);
  assert.equal(escolha.semLote, 0);
  const plano = planejarEnvio({ origem: A, destino: B, pedidos: [{ produtoId: 'p2_centro', quantidade: 10 }], produtos: { p2_centro: oleo }, lotesPorProduto: { p2_centro: lotes }, hoje: HOJE });
  assert.equal(plano.ok, true);
  if (!plano.ok) return;
  assert.equal(plano.itens[0].produtoIdDestino, 'p2', 'no destino fica o original (cadastro nasceu la)');
  assert.equal(plano.itens[0].semLote, 1);
  assert.deepEqual(plano.lotes.map((l) => [l.id, l.quantidadeDepois]).sort(), [['l1', 0], ['l2', 0], ['l3', 0]]);
});

test('recebimento: entrada no destino com custo medio, lotes criados/somados, falta volta para a origem', () => {
  const plano = planejarEnvio({ origem: A, destino: B, pedidos: [{ produtoId: 'p1', quantidade: 8 }, { produtoId: 'p2_centro', quantidade: 4 }], produtos: { p1: racao, p2_centro: oleo }, lotesPorProduto: { p2_centro: [{ id: 'l2', produtoId: 'p2_centro', lote: 'A1', validade: '2026-11-01', quantidade: 2 }, { id: 'l1', produtoId: 'p2_centro', lote: 'B2', validade: '2027-01-10', quantidade: 3 }] }, hoje: HOJE });
  assert.equal(plano.ok, true);
  if (!plano.ok) return;
  const destino = {
    p1_baixada: { id: 'p1_baixada', tenantId: B, nome: 'RAÇÃO 15KG', quantidade: 2, precoCusto: 100 },
    p2: { id: 'p2', tenantId: B, nome: 'ÓLEO DE COCO 500ML', quantidade: 0, precoCusto: 0, controlarLote: true },
  };
  const r = planejarRecebimento({ itens: plano.itens, recebidas: { 1: 3 }, produtosDestino: destino, lotesDestino: { p2: [{ id: 'd1', produtoId: 'p2', lote: 'A1', validade: '2026-11-01', quantidade: 5 }] } });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const racaoEntrada = r.entradas.find((e) => e.produtoId === 'p1_baixada')!;
  assert.equal(racaoEntrada.quantidadeDepois, 10);
  assert.equal(racaoEntrada.precoCustoDepois, 116, '(2x100 + 8x120) / 10');
  assert.deepEqual(r.lotesSomar, [{ id: 'd1', quantidadeDepois: 7 }], 'lote A1 ja existia no destino: soma');
  assert.deepEqual(r.lotesCriar, [{ produtoId: 'p2', lote: 'B2', validade: '2027-01-10', quantidade: 1 }]);
  assert.equal(r.divergente, true);
  assert.deepEqual(r.retornos.map((x) => [x.produtoId, x.quantidade, x.lotes.map((l) => [l.lote, l.quantidade])]), [['p2_centro', 1, [['B2', 1]]]]);
  assert.equal(r.itensFinais[1].quantidadeRecebida, 3);

  const naoChegou = planejarRecebimento({ itens: plano.itens, recebidas: {}, produtosDestino: {}, lotesDestino: {} });
  assert.equal(naoChegou.ok, false);
  if (!naoChegou.ok) assert.match(naoChegou.erros[0], /ainda não chegou nesta filial/);
  const demais = planejarRecebimento({ itens: plano.itens, recebidas: { 0: 9 }, produtosDestino: destino, lotesDestino: {} });
  assert.equal(demais.ok, false);
});

test('recusa e cancelamento devolvem tudo; so em transito muda de situacao', () => {
  const plano = planejarEnvio({ origem: A, destino: B, pedidos: [{ produtoId: 'p1', quantidade: 2 }], produtos: { p1: racao }, lotesPorProduto: {}, hoje: HOJE });
  if (!plano.ok) throw new Error('plano');
  assert.deepEqual(retornoCompleto(plano.itens).map((r) => [r.produtoId, r.quantidade]), [['p1', 2]]);
  assert.equal(proximoStatusPermitido('em_transito', 'recebida'), null);
  assert.match(proximoStatusPermitido('recebida', 'cancelada') ?? '', /já está recebida/);
  assert.equal(custoMedioDepoisDaEntrada(0, 50, 5, 30), 30);
  assert.equal(custoMedioDepoisDaEntrada(-3, 50, 5, 30), 30, 'saldo negativo nao pesa');
});
