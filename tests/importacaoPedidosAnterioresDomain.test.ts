import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CAMPOS_OBRIGATORIOS_PEDIDOS,
  ehPedidoDoSistemaAnterior,
  formatarNumeroImportado,
  inferirMapeamentoPedidos,
  lerDataBr,
  lerNumeroBr,
  lerPagamentos,
  lerPedidosImportados,
  montarPedidoImportado,
  planoDeRenumeracao,
  resumirImportacao,
  sugerirVendedor,
  trocarNumeroNoTexto,
  vendedoresDoArquivo,
} from '../src/utils/importacaoPedidosAnterioresDomain';

const CAB = ['Situacao', 'Pedido', 'Data', 'Hora', 'CPF/CNPJ', 'Cliente', 'Codigo do vendedor', 'Vendedor', 'Observacao',
  'Pagamentos', 'Desconto do pedido', 'Frete', 'Encargos', 'Total do pedido',
  'Codigo do produto', 'Produto', 'Quantidade', 'Unidade', 'Valor unitario', 'Desconto do item', 'Valor total do item'];

const linha = (over: Partial<Record<string, string>>): string[] => {
  const base: Record<string, string> = {
    Situacao: 'Faturado', Pedido: '93255', Data: '01/02/2025', Hora: '20:53', 'CPF/CNPJ': '43.003.133/0001-24', Cliente: 'TORRES E RIBEIRO',
    'Codigo do vendedor': '5', Vendedor: 'DHENY', Observacao: '', Pagamentos: 'Pagamento a Prazo=165,60',
    'Desconto do pedido': '0,00', Frete: '0,00', Encargos: '0,00', 'Total do pedido': '165,60',
    'Codigo do produto': '591', Produto: 'ETIQUETAS 60X40', Quantidade: '16,000', Unidade: 'RL', 'Valor unitario': '9,2000',
    'Desconto do item': '0,00', 'Valor total do item': '147,20',
  };
  const tudo = { ...base, ...over };
  return CAB.map((c) => tudo[c] ?? '');
};

test('mapeamento: reconhece o cabecalho do arquivo gerado e todos os obrigatorios', () => {
  const mapa = inferirMapeamentoPedidos(CAB);
  CAMPOS_OBRIGATORIOS_PEDIDOS.forEach((c) => assert.notEqual(mapa[c], null, c));
  assert.equal(mapa.codigoProduto, 14);
  assert.equal(mapa.valorTotalItem, 20);
});

test('numeros, datas e numero do pedido com 6 digitos', () => {
  assert.equal(lerNumeroBr('1.234,56'), 1234.56);
  assert.equal(lerNumeroBr(''), 0);
  assert.equal(lerNumeroBr('12.5'), 12.5);
  assert.ok(Number.isNaN(lerNumeroBr('abc')));
  assert.equal(lerDataBr('01/02/2025'), '2025-02-01');
  assert.equal(lerDataBr('31/02/2025'), '');
  assert.equal(formatarNumeroImportado('93255'), '093255');
  assert.equal(formatarNumeroImportado('113696'), '113696');
  assert.equal(formatarNumeroImportado(''), '');
});

test('pagamentos: soma a mesma forma e forma desconhecida vira Outros', () => {
  assert.deepEqual(lerPagamentos('Dinheiro=10,00 | Pix=5,50 | Dinheiro=1,00 | Vale=2,00'), [
    { forma: 'Dinheiro', valor: 11 }, { forma: 'Pix', valor: 5.5 }, { forma: 'Outros', valor: 2 },
  ]);
  assert.deepEqual(lerPagamentos(''), []);
});

test('agrupa itens por pedido e confere o total (itens - desconto + frete + encargos)', () => {
  const mapa = inferirMapeamentoPedidos(CAB);
  const pedidos = lerPedidosImportados([
    linha({}),
    linha({ Quantidade: '2,000', 'Valor total do item': '18,40' }),
    linha({ Pedido: '113675', Situacao: 'Pre-venda', Pagamentos: '', 'Total do pedido': '100,00', 'Valor total do item': '90,00', Frete: '10,00' }),
    linha({ Pedido: '113700', 'Total do pedido': '999,00' }),
  ], mapa);
  assert.equal(pedidos.length, 3);
  assert.equal(pedidos[0].numero, '093255');
  assert.equal(pedidos[0].itens.length, 2);
  assert.equal(pedidos[0].problema, '');
  assert.equal(pedidos[1].situacao, 'pre-venda');
  assert.equal(pedidos[1].problema, '');
  assert.match(pedidos[2].problema, /não fecham com o total/);
  const r = resumirImportacao(pedidos);
  assert.deepEqual(r, { faturados: 1, faturadosValor: 165.6, preVendas: 1, preVendasValor: 100, comProblema: 1 });
});

test('situacao desconhecida e data invalida viram problema em portugues', () => {
  const mapa = inferirMapeamentoPedidos(CAB);
  const [a, b] = lerPedidosImportados([linha({ Situacao: 'Orcamento' }), linha({ Pedido: '2', Data: '2025-02-01' })], mapa);
  assert.match(a.problema, /Situação "Orcamento" desconhecida/);
  assert.match(b.problema, /Data "2025-02-01" inválida/);
});

test('vendedores do arquivo e sugestao pelo nome', () => {
  const mapa = inferirMapeamentoPedidos(CAB);
  const pedidos = lerPedidosImportados([linha({}), linha({ Pedido: '2', 'Codigo do vendedor': '54', Vendedor: 'IGOR', 'Total do pedido': '147,20' })], mapa);
  assert.deepEqual(vendedoresDoArquivo(pedidos).map((v) => [v.codigo, v.nome, v.pedidos]), [['5', 'DHENY', 1], ['54', 'IGOR', 1]]);
  const usuarios = [{ id: 'u1', nome: 'Igor Felipe' }, { id: 'u2', nome: 'IVAN GONCALVES DE OLIVEIRA' }, { id: 'u3', nome: 'Ivan Junior' }];
  assert.equal(sugerirVendedor('IGOR', usuarios), 'u1');
  assert.equal(sugerirVendedor('IVAN GONCALVES DE OLIVEIRA', usuarios), 'u2');
  assert.equal(sugerirVendedor('IVAN', usuarios), '');
  assert.equal(sugerirVendedor('ANDRESSA ROBADEL', usuarios), '');
});

test('pedido faturado: registro sem reserva, comissao zero, pagamentos sem lancamento e sem undefined', () => {
  const mapa = inferirMapeamentoPedidos(CAB);
  const [pedido] = lerPedidosImportados([linha({ Pagamentos: 'Dinheiro=100,00 | Pagamento a Prazo=47,20', 'Total do pedido': '147,20' })], mapa);
  const doc = montarPedidoImportado(pedido, {
    tenantId: 't1', usuarioId: 'dono', arquivoOrigem: '9-pedidos.csv', clienteId: 'c1', clienteNome: 'TORRES E RIBEIRO',
    vendedorId: 'v5', vendedorNome: 'DHENY', conferenciaAtiva: true,
    produtoDoItem: (i) => (i.codigoProduto === '591' ? { id: 'p591', nome: 'ETIQUETA 60X40', unidadeMedidaSigla: 'RL' } : null),
  });
  assert.equal(doc.status, 'Finalizada');
  assert.equal(doc.numeroPedido, '093255');
  assert.equal(doc.estoqueReservado, false);
  assert.equal(doc.importadoSistemaAnterior, true);
  assert.equal(ehPedidoDoSistemaAnterior(doc), true);
  assert.equal(doc.itens[0].id, 'p591');
  assert.equal(doc.comissao?.valorAtualCentavos, 0);
  assert.equal(doc.comissao?.status, 'nao_aplicavel');
  assert.equal(doc.totalPendente, 47.2);
  assert.equal(doc.formaPagamento, 'Dinheiro + Pagamento a Prazo');
  assert.equal(doc.pagamentos?.every((p) => !('transactionId' in p) && p.movimentaCaixaFisico === false), true);
  assert.equal('statusConferencia' in doc, false);
  assert.match(doc.observacao, /Importado do sistema anterior: pedido 93255, 20:53/);
  const temUndefined = (v: unknown): boolean => v === undefined || (v !== null && typeof v === 'object' && Object.values(v as object).some(temUndefined));
  assert.equal(temUndefined(doc), false);
});

test('pre-venda: reserva, fila de conferencia, sem pagamentos; produto sumido vira avulso', () => {
  const mapa = inferirMapeamentoPedidos(CAB);
  const [pedido] = lerPedidosImportados([linha({ Situacao: 'Pre-venda', Pagamentos: '', 'Total do pedido': '147,20' })], mapa);
  const doc = montarPedidoImportado(pedido, {
    tenantId: 't1', usuarioId: 'dono', arquivoOrigem: 'x.csv', clienteId: null, clienteNome: '',
    vendedorId: 'v5', vendedorNome: 'DHENY', conferenciaAtiva: true, produtoDoItem: () => null,
  });
  assert.equal(doc.status, 'Pré-venda');
  assert.equal(doc.estoqueReservado, true);
  assert.equal(doc.statusConferencia, 'aguardando');
  assert.equal('pagamentos' in doc, false);
  assert.equal(doc.clienteNome, 'CONSUMIDOR FINAL');
  assert.equal(doc.itens[0].id, 'avulso');
});

test('renumeracao: vendas do Hennder vem depois do ultimo numero antigo, na ordem de criacao', () => {
  const plano = planoDeRenumeracao([
    { id: 'b', numeroPedido: '0002', criadoEmMs: 2000 },
    { id: 'a', numeroPedido: '0001', criadoEmMs: 1000 },
    { id: 'c', numeroPedido: '0003', criadoEmMs: 3000 },
  ], 113696);
  assert.deepEqual(plano, [
    { id: 'a', de: '0001', para: '113697' },
    { id: 'b', de: '0002', para: '113698' },
    { id: 'c', de: '0003', para: '113699' },
  ]);
  assert.equal(trocarNumeroNoTexto('Venda Direta #0012 - Dinheiro', '0012', '113697'), 'Venda Direta #113697 - Dinheiro');
  assert.equal(trocarNumeroNoTexto('Venda #12 e #0120', '0012', '113697'), 'Venda #113697 e #0120');
  assert.equal(trocarNumeroNoTexto('Crédito da venda PDV #0012', '0012', '113697'), 'Crédito da venda PDV #113697');
});
