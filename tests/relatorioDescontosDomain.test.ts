import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aprovacaoDoDesconto,
  documentosComDesconto,
  montarDocumentoDescontos,
  totaisPorOrigem,
  type FontesRelatorioDescontos,
} from '../src/utils/relatorioDescontosDomain';
import { linhaTotalSecao } from '../src/utils/relatorioPdfDomain';

const ts = (iso: string) => ({ toDate: () => new Date(iso) });

const fontes: FontesRelatorioDescontos = {
  pedidos: [
    { id: 'ped1', vendedorId: 'u1', numeroPedido: '0154', clienteNome: 'Loja A', dataVenda: '2026-09-10', valorTotalCentavos: 90000, descontoGeral: { valorAplicadoCentavos: 10000 } },
    { id: 'pdv1abcdef', vendedorId: 'u2', sourceOrigin: 'pdv', dataVenda: '2026-09-12', valorTotalCentavos: 4500, descontoGeral: { valorAplicadoCentavos: 500, excedeuLimite: true, aprovacao: { modo: 'senha', aprovadoPorId: 'g', aprovadoPorNome: 'Gerente', aprovadoEm: '' } } },
    { id: 'ped3', vendedorId: 'u1', dataVenda: '2026-09-11', valorTotalCentavos: 1000, descontoGeral: { valorAplicadoCentavos: 0 } },
    { id: 'ped4', vendedorId: 'u1', createdAt: ts('2026-09-20T15:00:00Z'), valorTotalCentavos: 2000, descontoGeral: { valorAplicadoCentavos: 200, excedeuLimite: true } },
    { id: 'ped5', vendedorId: 'u1', dataVenda: '2026-10-01', valorTotalCentavos: 2000, descontoGeral: { valorAplicadoCentavos: 200 } },
  ],
  ordens: [
    { id: 'os1', numeroOS: 77, clienteNome: 'Oficina', dataEntrada: '2026-09-05', valorTotalCentavos: 30000, desconto: { valorAplicadoCentavos: 3000 } },
    { id: 'os2', dataSaida: '2026-08-30', dataEntrada: '2026-09-02', valorTotalCentavos: 30000, desconto: { valorAplicadoCentavos: 3000 } },
    { id: 'os3', valorTotalCentavos: 30000, desconto: { valorAplicadoCentavos: 3000 } },
  ],
  orcamentos: [
    { id: 'orc1xyz', numeroOrcamento: 12, createdAt: ts('2026-09-15T15:00:00Z'), valorTotal: 150.5, desconto: { valorAplicadoCentavos: 1050 } },
  ],
};

const periodo = { inicio: '2026-09-01', fim: '2026-09-30' };

test('entra só quem tem desconto e data no período; mais recente primeiro; origem PDV pelo sourceOrigin', () => {
  const docs = documentosComDesconto(fontes, periodo);
  assert.deepEqual(docs.map((d) => [d.id, d.origem, d.numero, d.data, d.valorTotalCentavos]), [
    ['ped4', 'Pedido de Venda', 'PED4', '2026-09-20', 2000],
    ['orc1xyz', 'Orçamento', '#12', '2026-09-15', 15050],
    ['pdv1abcdef', 'PDV', 'PDV1AB', '2026-09-12', 4500],
    ['ped1', 'Pedido de Venda', '0154', '2026-09-10', 90000],
    ['os1', 'Ordem de Serviço', '#77', '2026-09-05', 30000],
  ]);
});

test('visibilidade de vendas: funcionário restrito só vê os próprios pedidos (OS e orçamento seguem)', () => {
  const docs = documentosComDesconto(fontes, { ...periodo, vendasVisiveisDeUsuarioId: 'u2' });
  assert.deepEqual(docs.map((d) => d.id), ['orc1xyz', 'pdv1abcdef', 'os1']);
});

test('totais por origem e aprovação', () => {
  const docs = documentosComDesconto(fontes, periodo);
  assert.deepEqual(totaisPorOrigem(docs).map((o) => [o.origem, o.quantidade, o.descontoCentavos]), [
    ['Pedido de Venda', 2, 10200],
    ['Orçamento', 1, 1050],
    ['PDV', 1, 500],
    ['Ordem de Serviço', 1, 3000],
  ]);
  assert.equal(aprovacaoDoDesconto(docs[2]), 'Senha: Gerente');
  assert.equal(aprovacaoDoDesconto(docs[0]), 'Acima do limite');
  assert.equal(aprovacaoDoDesconto(docs[3]), '');
});

test('documento: indicadores, duas seções e total igual à página antiga', () => {
  const doc = montarDocumentoDescontos(fontes, periodo);
  assert.equal(doc.titulo, 'Descontos Concedidos');
  assert.deepEqual(doc.indicadores.slice(0, 2), [
    { rotulo: 'Vendas/OS/Orçamentos com desconto', valor: '5' },
    { rotulo: 'Aprovados por senha', valor: '1' },
  ]);
  assert.deepEqual(doc.secoes.map((s) => s.id), ['origens', 'detalhe']);
  const detalhe = doc.secoes[1];
  assert.deepEqual(detalhe.colunas.map((c) => c.titulo), ['Data', 'Origem', 'Nº', 'Cliente', 'Valor Total', 'Desconto', 'Aprovação']);
  const total = linhaTotalSecao(detalhe.colunas, detalhe.linhas, 'Total');
  assert.match(total[4], /1\.415,50/);
  assert.match(total[5], /147,50/);
});
