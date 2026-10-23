import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CFOPS,
  FUNCAO_DA_NATUREZA,
  acaoDaEntrada,
  cfopEhDeSaida,
  cfopEntradaSugerido,
  cfopInterestadualEquivalente,
  cfopPorCodigo,
  cfopsParaEscolha,
  formatarCodigoCfop,
  lerCfopsDesativados,
  NATUREZAS_DO_PRODUTO,
  naturezaDaOperacaoPelosCfops,
  problemaDoCfop,
  resumoDaFuncao,
} from '../src/utils/cfopDomain';

// CFOPs oficiais de 4 digitos da lista que o dono mandou (PDF do sistema antigo, 20/10).
const DO_PDF = [
  '1102', '1117', '1202', '1253', '1303', '1351', '1403', '1407', '1411', '1551', '1556', '1652', '1653', '1910', '1911',
  '1914', '1916', '1922', '1923', '1926', '1933', '1949', '2101', '2102', '2117', '2202', '2303', '2351', '2403', '2407',
  '2411', '2551', '2556', '2653', '2910', '2911', '2916', '2922', '2923', '2933', '2949', '5101', '5102', '5202', '5405',
  '5411', '5910', '5915', '5926', '5927', '5929', '5949', '6101', '6102', '6108', '6202', '6411', '6910', '6915', '6929', '6949',
];

test('tabela: todos os CFOPs do PDF do dono estao cadastrados, sem codigo repetido e com descricao', () => {
  for (const c of DO_PDF) assert.ok(cfopPorCodigo(c), `faltou ${c}`);
  assert.equal(new Set(CFOPS.map((c) => c.codigo)).size, CFOPS.length, 'codigo repetido');
  for (const c of CFOPS) {
    assert.match(c.codigo, /^[1-35-7]\d{3}$/);
    assert.ok(c.descricao.length > 10, c.codigo);
  }
  // Tambem os que o sistema ja' emite.
  for (const c of ['5152', '6152', '1152', '2152', '5403', '6403', '6404', '5933', '7101', '7102', '1201', '1410', '2201', '2410']) {
    assert.ok(cfopPorCodigo(c), `faltou ${c}`);
  }
});

test('tipo, ambito e ST saem do codigo', () => {
  assert.deepEqual([cfopPorCodigo('5.102')?.tipo, cfopPorCodigo('5102')?.ambito], ['saida', 'estadual']);
  assert.deepEqual([cfopPorCodigo('2102')?.tipo, cfopPorCodigo('2102')?.ambito], ['entrada', 'interestadual']);
  assert.equal(cfopPorCodigo('7102')?.ambito, 'exterior');
  assert.equal(cfopPorCodigo('5405')?.st, true);
  assert.equal(cfopPorCodigo('1403')?.st, true);
  assert.equal(cfopPorCodigo('5102')?.st, false);
  assert.equal(cfopPorCodigo('9999'), null);
  assert.equal(cfopPorCodigo('51'), null);
  assert.equal(formatarCodigoCfop('5102'), '5.102');
});

test('funcao: cada CFOP faz o que o nome diz', () => {
  const f = (c: string) => { const x = cfopPorCodigo(c); assert.ok(x, c); return [x.estoque, x.financeiro, x.receita, x.destino]; };
  assert.deepEqual(f('5102'), ['sai', 'receber', true, 'nenhum'], 'venda');
  assert.deepEqual(f('5405'), ['sai', 'receber', true, 'nenhum'], 'venda com ST');
  assert.deepEqual(f('5933'), ['nenhum', 'receber', true, 'nenhum'], 'servico');
  assert.deepEqual(f('5910'), ['sai', 'nenhum', false, 'nenhum'], 'bonificacao nao e faturamento');
  assert.deepEqual(f('5915'), ['sai', 'nenhum', false, 'nenhum'], 'remessa para conserto');
  assert.deepEqual(f('5927'), ['sai', 'nenhum', false, 'nenhum'], 'perda');
  assert.deepEqual(f('5929'), ['nenhum', 'nenhum', false, 'nenhum'], 'nota de cupom ja emitido nao conta duas vezes');
  assert.deepEqual(f('5202'), ['sai', 'abate_pagar', false, 'nenhum'], 'devolucao de compra');
  assert.deepEqual(f('5152'), ['sai', 'nenhum', false, 'nenhum'], 'transferencia');
  assert.deepEqual(f('1102'), ['entra', 'pagar', false, 'estoque'], 'compra');
  assert.deepEqual(f('1403'), ['entra', 'pagar', false, 'estoque'], 'compra com ST');
  assert.deepEqual(f('1556'), ['entra', 'pagar', false, 'insumo'], 'uso e consumo vai para insumos');
  assert.deepEqual(f('1407'), ['entra', 'pagar', false, 'insumo']);
  assert.deepEqual(f('1551'), ['nenhum', 'pagar', false, 'nenhum'], 'ativo imobilizado nao e estoque');
  assert.deepEqual(f('1910'), ['entra', 'nenhum', false, 'estoque'], 'bonificacao entra sem conta a pagar');
  assert.deepEqual(f('1916'), ['entra', 'nenhum', false, 'estoque'], 'retorno de conserto');
  assert.deepEqual(f('1922'), ['nenhum', 'pagar', false, 'nenhum'], 'simples faturamento: paga sem mercadoria');
  assert.deepEqual(f('1117'), ['entra', 'nenhum', false, 'estoque'], 'entrega futura: mercadoria sem pagar de novo');
  assert.deepEqual(f('1202'), ['entra', 'abate_receber', false, 'estoque'], 'devolucao de venda');
  assert.deepEqual(f('1353'), ['nenhum', 'pagar', false, 'nenhum'], 'frete contratado');
  assert.equal(resumoDaFuncao(cfopPorCodigo('5102')!), 'Baixa o estoque · Gera conta a receber · Conta como faturamento');
  // So' venda, servico e o faturamento da entrega futura (5.922) contam como faturamento.
  const comReceita = Object.entries(FUNCAO_DA_NATUREZA).filter(([, x]) => x.receita).map(([n]) => n).sort();
  assert.deepEqual(comReceita, ['faturamento_venda_entrega_futura', 'servico_prestado', 'venda']);
});

test('de-para: CFOP do fornecedor vira o CFOP de entrada certo', () => {
  assert.equal(cfopEntradaSugerido('5102'), '1102');
  assert.equal(cfopEntradaSugerido('5101'), '1102', 'compra da industria para revenda');
  assert.equal(cfopEntradaSugerido('6102'), '2102');
  assert.equal(cfopEntradaSugerido('6108'), '2102');
  assert.equal(cfopEntradaSugerido('5405'), '1403');
  assert.equal(cfopEntradaSugerido('5403'), '1403');
  assert.equal(cfopEntradaSugerido('6403'), '2403');
  assert.equal(cfopEntradaSugerido('6404'), '2403');
  assert.equal(cfopEntradaSugerido('5910'), '1910');
  assert.equal(cfopEntradaSugerido('6910'), '2910');
  assert.equal(cfopEntradaSugerido('5152'), '1152');
  assert.equal(cfopEntradaSugerido('5202'), '1202', 'o fornecedor devolvendo o que comprou de nos');
  assert.equal(cfopEntradaSugerido('5411'), '1411');
  assert.equal(cfopEntradaSugerido('5933'), '1933');
  assert.equal(cfopEntradaSugerido('5949'), '1949');
  assert.equal(cfopEntradaSugerido('5922'), '1922');
  assert.equal(cfopEntradaSugerido('5117'), '1117');
  assert.equal(cfopEntradaSugerido('5102', 'insumo'), '1556', 'item classificado como insumo');
  assert.equal(cfopEntradaSugerido('5405', 'insumo'), '1407', 'insumo com ST');
  assert.equal(cfopEntradaSugerido('6102', 'insumo'), '2556');
  assert.equal(cfopEntradaSugerido('5929'), '', 'sem equivalente: a pessoa escolhe');
  assert.equal(cfopEntradaSugerido('1102'), '1102', 'ja de entrada');
  assert.equal(cfopEntradaSugerido(''), '');
  // Todo sugerido existe na tabela e e' de entrada.
  for (const c of CFOPS.filter((x) => x.tipo === 'saida')) {
    const s = cfopEntradaSugerido(c.codigo);
    if (s) assert.equal(cfopPorCodigo(s)?.tipo, 'entrada', `${c.codigo} -> ${s}`);
  }
});

test('interestadual equivalente da saida', () => {
  assert.equal(cfopInterestadualEquivalente('5102'), '6102');
  assert.equal(cfopInterestadualEquivalente('5405'), '6404');
  assert.equal(cfopInterestadualEquivalente('5101'), '6101');
  assert.equal(cfopInterestadualEquivalente('5927'), '', 'nao existe 6.927');
  assert.equal(cfopInterestadualEquivalente('6102'), '');
});

test('escolha: desativados somem, mas o ja gravado continua; filtros por tipo, ambito e natureza', () => {
  const doProduto = cfopsParaEscolha({ tipo: 'saida', ambitos: ['estadual'], naturezas: NATUREZAS_DO_PRODUTO }).map((c) => c.codigo);
  assert.ok(doProduto.includes('5102') && doProduto.includes('5405') && doProduto.includes('5933'));
  assert.ok(!doProduto.includes('5910') && !doProduto.includes('6102') && !doProduto.includes('1102'));
  const sem5101 = cfopsParaEscolha({ tipo: 'saida', desativados: ['5101'] }).map((c) => c.codigo);
  assert.ok(!sem5101.includes('5101'));
  const mantido = cfopsParaEscolha({ tipo: 'saida', desativados: ['5101'], manter: '5.101' }).map((c) => c.codigo);
  assert.ok(mantido.includes('5101'));
  assert.deepEqual(lerCfopsDesativados(['5.101', '5101', '9999', 'x', 1102]), ['1102', '5101']);
  assert.deepEqual(lerCfopsDesativados(undefined), []);
});

test('entrada de NF-e: o CFOP decide estoque, conta a pagar e insumo', () => {
  const a = (c: string) => { const x = acaoDaEntrada(c); assert.ok(x, c); return [x.movimentaEstoque, x.geraContaAPagar, x.exigeInsumo]; };
  assert.deepEqual(a('1102'), [true, true, false], 'compra');
  assert.deepEqual(a('2403'), [true, true, false], 'compra com ST de outro estado');
  assert.deepEqual(a('1556'), [true, true, true], 'uso e consumo vai para insumo');
  assert.deepEqual(a('1407'), [true, true, true]);
  assert.deepEqual(a('1551'), [false, true, false], 'ativo: so a pagar');
  assert.deepEqual(a('1353'), [false, true, false], 'frete contratado: so a pagar');
  assert.deepEqual(a('1922'), [false, true, false], 'simples faturamento: paga sem mercadoria');
  assert.deepEqual(a('1117'), [true, false, false], 'entrega da compra faturada antes');
  assert.deepEqual(a('1910'), [true, false, false], 'bonificacao');
  assert.deepEqual(a('1916'), [true, false, false], 'retorno de conserto');
  assert.deepEqual(a('1202'), [false, false, false], 'devolucao de venda: tela propria');
  assert.deepEqual(a('1152'), [false, false, false], 'transferencia: tela propria');
  assert.equal(acaoDaEntrada('5102'), null, 'CFOP de saida nao serve');
  assert.equal(acaoDaEntrada('1999'), null);
  assert.equal(acaoDaEntrada('1102')?.aviso, '');
  assert.match(acaoDaEntrada('1202')?.aviso ?? '', /Vendas › Devolução/);
  assert.match(acaoDaEntrada('1910')?.aviso ?? '', /sem conta a pagar/);
});

test('emissao: CFOP de saida pelo formato, mesmo fora da tabela', () => {
  assert.equal(cfopEhDeSaida('5104'), true, 'saida valida que a tabela nao tem');
  assert.equal(cfopEhDeSaida(6102), true);
  assert.equal(cfopEhDeSaida('7.102'), true);
  assert.equal(cfopEhDeSaida('1102'), false);
  assert.equal(cfopEhDeSaida('51'), false);
});

test('emissao: natureza da operacao pelos CFOPs dos itens', () => {
  assert.equal(naturezaDaOperacaoPelosCfops([5102, 5405]), 'Venda de Mercadoria');
  assert.equal(naturezaDaOperacaoPelosCfops([5102, 5910]), 'Venda de Mercadoria', 'venda com bonificacao junto');
  assert.equal(naturezaDaOperacaoPelosCfops([5910]), 'Remessa em Bonificação, Doação ou Brinde');
  assert.equal(naturezaDaOperacaoPelosCfops(['6915']), 'Remessa para Conserto ou Reparo');
  assert.equal(naturezaDaOperacaoPelosCfops([5927]), 'Baixa de Estoque por Perda, Roubo ou Deterioração');
  assert.equal(naturezaDaOperacaoPelosCfops([5202]), 'Devolução de Compra');
  assert.equal(naturezaDaOperacaoPelosCfops([5933]), 'Prestação de Serviço');
  assert.equal(naturezaDaOperacaoPelosCfops([5102], { cupom: true }), 'Lançamento decorrente de Cupom Fiscal');
  assert.equal(naturezaDaOperacaoPelosCfops([]), 'Venda de Mercadoria');
  assert.equal(naturezaDaOperacaoPelosCfops([9999]), 'Venda de Mercadoria', 'CFOP desconhecido: venda');
});

test('venda para entrega futura (23/10): 5.922/6.922 faturam sem estoque; 5.116/5.117 entregam sem cobrar', () => {
  for (const c of ['5922', '6922']) {
    const f = cfopPorCodigo(c)!;
    assert.equal(f.natureza, 'faturamento_venda_entrega_futura', c);
    assert.deepEqual([f.estoque, f.financeiro, f.receita], ['nenhum', 'receber', true], c);
  }
  for (const c of ['5116', '5117', '6116', '6117']) {
    const r = cfopPorCodigo(c)!;
    assert.equal(r.natureza, 'remessa_entrega_futura', c);
    assert.deepEqual([r.estoque, r.financeiro, r.receita], ['sai', 'nenhum', false], c);
    assert.equal(r.tipo, 'saida');
  }
  assert.equal(cfopPorCodigo('6116')!.ambito, 'interestadual');
  assert.equal(naturezaDaOperacaoPelosCfops([5922]), 'Simples Faturamento - Venda para Entrega Futura');
  assert.equal(naturezaDaOperacaoPelosCfops([5116, 5117]), 'Remessa - Venda para Entrega Futura');
});

test('problemas do CFOP: mensagens em portugues dizendo o que fazer', () => {
  const uso = { tipo: 'saida' as const, ambitos: ['estadual' as const], naturezas: NATUREZAS_DO_PRODUTO, onde: 'do produto "X"' };
  assert.equal(problemaDoCfop('5102', uso), null);
  assert.match(problemaDoCfop('', uso) ?? '', /Informe o CFOP do produto "X"/);
  assert.match(problemaDoCfop('5999', uso) ?? '', /não está na tabela/);
  assert.match(problemaDoCfop('1102', uso) ?? '', /é de entrada/);
  assert.match(problemaDoCfop('6102', uso) ?? '', /outro estado/);
  assert.match(problemaDoCfop('5910', uso) ?? '', /não serve do produto/);
  assert.match(problemaDoCfop('5102', { ...uso, desativados: ['5102'] }) ?? '', /desativado/);
});
