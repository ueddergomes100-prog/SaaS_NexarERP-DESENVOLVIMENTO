import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodificarArquivoTexto,
  detectarDelimitador,
  parseDelimitedText,
  inferirMapeamentoColunas,
  interpretarQuantidade,
  processarLinhas,
  normalizarDescricaoBase,
  detectarGruposEmbalagem,
  montarProdutoImportado,
  resolverSiglaUnidade,
} from '../src/utils/importacaoEstoqueDomain';

test('interpretarQuantidade soma expressoes com "+"', () => {
  assert.equal(interpretarQuantidade('35+2').valor, 37);
  assert.equal(interpretarQuantidade('35+2').status, 'OK');
  assert.equal(interpretarQuantidade('7+463').valor, 470);
  assert.equal(interpretarQuantidade('28+2+18').valor, 48);
});

test('interpretarQuantidade le decimal brasileiro (virgula) e sufixo de unidade', () => {
  const kg = interpretarQuantidade('42,280');
  assert.equal(kg.valor, 42.28);
  assert.equal(kg.status, 'OK');

  const comSufixoColado = interpretarQuantidade('49kg');
  assert.equal(comSufixoColado.valor, 49);
  assert.equal(comSufixoColado.unidadeSugerida, 'kg');

  const comSufixoEspaco = interpretarQuantidade('115 sc');
  assert.equal(comSufixoEspaco.valor, 115);
  assert.equal(comSufixoEspaco.unidadeSugerida, 'sc');

  const porExtenso = interpretarQuantidade('22 mil');
  assert.equal(porExtenso.valor, 22000);
});

test('interpretarQuantidade nunca resolve sozinho valor ambiguo (ponto = milhar ou decimal errado)', () => {
  const r = interpretarQuantidade('?21.600');
  assert.equal(r.status, 'REVISAR');
  assert.equal(r.valor, null);
  assert.match(r.motivo, /21600/);
  assert.match(r.motivo, /21\.6/);
});

test('interpretarQuantidade marca REVISAR pra marcacao nao numerica, traco e branco', () => {
  assert.equal(interpretarQuantidade('Variados').status, 'REVISAR');
  assert.equal(interpretarQuantidade('Cancelar').status, 'REVISAR');
  assert.equal(interpretarQuantidade('-').status, 'REVISAR');
  assert.equal(interpretarQuantidade('').status, 'REVISAR');
  assert.equal(interpretarQuantidade('').valor, null);
});

test('interpretarQuantidade marca REVISAR quando incompleta ("2 +") ou com duvida do contador ("?")', () => {
  const incompleta = interpretarQuantidade('2 +');
  assert.equal(incompleta.status, 'REVISAR');
  assert.equal(incompleta.valor, 2);

  const comDuvida = interpretarQuantidade('?3.360');
  assert.equal(comDuvida.status, 'REVISAR');
});

test('interpretarQuantidade detecta contradicao entre quantidade e observacao', () => {
  const r = interpretarQuantidade('20', 'Sem quantidade anotada');
  assert.equal(r.status, 'REVISAR');
  assert.match(r.motivo, /contradição/i);
});

test('detectarDelimitador prefere ";" em planilha brasileira, "," quando nao ha ";"', () => {
  assert.equal(detectarDelimitador('Cód.;Descrição;Quantidade'), ';');
  assert.equal(detectarDelimitador('Code,Description,Quantity'), ',');
});

test('parseDelimitedText respeita campo entre aspas contendo o delimitador', () => {
  const linhas = parseDelimitedText('26;EIXO CARDAN;10+2;"Longo; estria dos lados"\n', ';');
  assert.deepEqual(linhas[0], ['26', 'EIXO CARDAN', '10+2', 'Longo; estria dos lados']);
});

test('decodificarArquivoTexto recupera texto Windows-1252 (cp1252) mal lido como UTF-8', () => {
  // "É" (0xC9) sozinho e valido em UTF-8 e cp1252 -- usamos uma sequencia
  // que so faz sentido em cp1252 pra forcar o fallback: 0xE7 = "ç".
  const buffer = new Uint8Array([0x50, 0x41, 0xE7, 0x4F]).buffer; // "PAçO" em cp1252
  const texto = decodificarArquivoTexto(buffer);
  assert.equal(texto, 'PAçO');
});

test('inferirMapeamentoColunas reconhece o cabecalho real da planilha do cliente', () => {
  const mapeamento = inferirMapeamentoColunas(['Cód.', 'Descrição', 'Quantidade contada', 'Observação']);
  assert.deepEqual(mapeamento, { codigo: 0, descricao: 1, quantidade: 2, observacao: 3, custo: null, custoMedio: null, custoComercial: null, precoAtacado: null, qtdMinimaAtacado: null, precoAVista: null, precoAPrazo: null, codigoBarras: null, unidade: null, valorVenda: null, marca: null, referencia: null });
});

test('processarLinhas ignora linhas vazias e devolve item por linha com descricao', () => {
  const linhas = [
    ['136', '100 PS SUPLEMENTO PARA PÁSSARO 10ML', '11', ''],
    ['', '', '', ''],
    ['113', 'ADUBO 04-14-08 50KG SACO', '8', ''],
  ];
  const itens = processarLinhas(linhas, { codigo: 0, descricao: 1, quantidade: 2, observacao: 3, custo: null, custoMedio: null, custoComercial: null, precoAtacado: null, qtdMinimaAtacado: null, precoAVista: null, precoAPrazo: null, codigoBarras: null, unidade: null, valorVenda: null, marca: null, referencia: null });
  assert.equal(itens.length, 2);
  assert.equal(itens[1].quantidadeCalculada, 8);
  assert.equal(itens[1].status, 'OK');
});

test('normalizarDescricaoBase junta produto vendido em kg solto e em saco na mesma chave', () => {
  const kg = normalizarDescricaoBase('ADUBO UREIA 45-00-00 50KG QUILO');
  const saco = normalizarDescricaoBase('ADUBO UREIA 45-00-00 50KG SACO');
  assert.equal(kg, saco);
});

test('detectarGruposEmbalagem acha o par kg/saco e sugere o fator pelo peso na descricao', () => {
  const itens = processarLinhas(
    [
      ['115', 'ADUBO UREIA 45-00-00 50KG QUILO', '45,180kg', ''],
      ['84', 'ADUBO UREIA 45-00-00 50KG SACO', '44', ''],
      ['999', 'PRODUTO SEM PAR', '1', ''],
    ],
    { codigo: 0, descricao: 1, quantidade: 2, observacao: 3, custo: null, custoMedio: null, custoComercial: null, precoAtacado: null, qtdMinimaAtacado: null, precoAVista: null, precoAPrazo: null, codigoBarras: null, unidade: null, valorVenda: null, marca: null, referencia: null },
  );
  const grupos = detectarGruposEmbalagem(itens);
  assert.equal(grupos.length, 1);
  assert.equal(grupos[0].itens.length, 2);
  assert.equal(grupos[0].fatorConversaoSugerido, 50);
});

test('detectarGruposEmbalagem nao sugere fator quando a descricao nao informa o peso (ex: metro/rolo)', () => {
  const itens = processarLinhas(
    [
      ['92', 'LONA BRANCA/PRETA FUZIL 8X50 -200 MC METRO', '0', ''],
      ['39', 'LONA BRANCA/PRETA FUZIL 8X50 -200 MC ROLO', '0', ''],
    ],
    { codigo: 0, descricao: 1, quantidade: 2, observacao: 3, custo: null, custoMedio: null, custoComercial: null, precoAtacado: null, qtdMinimaAtacado: null, precoAVista: null, precoAPrazo: null, codigoBarras: null, unidade: null, valorVenda: null, marca: null, referencia: null },
  );
  const grupos = detectarGruposEmbalagem(itens);
  assert.equal(grupos.length, 1);
  assert.equal(grupos[0].fatorConversaoSugerido, null);
});

test('montarProdutoImportado grava no mesmo formato que EstoqueForm.tsx (campos planos + sub-objetos)', () => {
  const unidadeKg = { id: 'un-kg', sigla: 'KG', casasDecimais: 3, fracionado: true };
  const unidadeSc = { id: 'un-sc', sigla: 'SC', casasDecimais: 0, fracionado: false };

  const produto = montarProdutoImportado(
    {
      codigo: '1',
      nome: 'adubo ureia 45-00-00',
      categoria: 'Adubos',
      unidadeBase: unidadeKg,
      quantidade: 2245.18, // 45,18 kg soltos + 44 sacos x 50kg
      precoVenda: 3.5,
      embalagem: { unidade: unidadeSc, fatorConversao: 50, quantidadeNaEmbalagem: 44 },
    },
    'tenant-1',
    'user-1',
    'TIMESTAMP',
  );

  assert.equal(produto.nome, 'ADUBO UREIA 45-00-00');
  assert.equal(produto.codigo, '1');
  assert.equal(produto.tenantId, 'tenant-1');
  assert.equal(produto.unidadeMedidaSigla, 'KG');
  assert.equal(produto.quantidade, 2245.18);
  assert.equal((produto.embalagens as any[]).length, 1);
  assert.equal((produto.embalagens as any[])[0].fatorConversao, 50);
  assert.equal((produto.precos as any).venda, 3.5);
  assert.equal((produto.estoqueConfig as any).controlarEstoque, true);
  assert.equal(produto.ncmPendente, true);
});

test('inferirMapeamentoColunas acha custo/preco a vista/preco a prazo quando presentes, null quando ausentes', () => {
  const comPrecos = inferirMapeamentoColunas(['Código', 'Descrição', 'Quantidade', 'Custo', 'Preço à Vista', 'Preço a Prazo']);
  assert.equal(comPrecos.custo, 3);
  assert.equal(comPrecos.precoAVista, 4);
  assert.equal(comPrecos.precoAPrazo, 5);

  const semPrecos = inferirMapeamentoColunas(['Cód.', 'Descrição', 'Quantidade contada', 'Observação']);
  assert.equal(semPrecos.custo, null);
  assert.equal(semPrecos.precoAVista, null);
  assert.equal(semPrecos.precoAPrazo, null);
});

test('processarLinhas le custo/preco a vista/preco a prazo das colunas mapeadas', () => {
  const linhas = [['1', 'PRODUTO X', '10', '', '25,50', '39,90', '45,00']];
  const itens = processarLinhas(linhas, { codigo: 0, descricao: 1, quantidade: 2, observacao: 3, custo: 4, custoMedio: null, custoComercial: null, precoAtacado: null, qtdMinimaAtacado: null, precoAVista: 5, precoAPrazo: 6, codigoBarras: null, unidade: null, valorVenda: null, marca: null, referencia: null });
  assert.equal(itens[0].custo, 25.5);
  assert.equal(itens[0].precoAVista, 39.9);
  assert.equal(itens[0].precoAPrazo, 45);
});

test('montarProdutoImportado grava custo/preco a vista/preco a prazo quando informados, omite quando ausentes', () => {
  const unidadeUn = { id: 'un-un', sigla: 'UN', casasDecimais: 0, fracionado: false };

  const comPrecos = montarProdutoImportado(
    { codigo: '1', nome: 'produto', categoria: '', unidadeBase: unidadeUn, quantidade: 1, precoVenda: 39.9, precoCusto: 25.5, precoAVista: 39.9, precoAPrazo: 45 },
    'tenant-1', 'user-1', 'TIMESTAMP',
  );
  assert.equal(comPrecos.precoCusto, 25.5);
  assert.equal(comPrecos.precoAVista, 39.9);
  assert.equal(comPrecos.precoAPrazo, 45);
  assert.equal((comPrecos.precos as any).aVista, 39.9);
  assert.equal((comPrecos.precos as any).aPrazo, 45);

  const semPrecos = montarProdutoImportado(
    { codigo: '2', nome: 'produto', categoria: '', unidadeBase: unidadeUn, quantidade: 1, precoVenda: 10 },
    'tenant-1', 'user-1', 'TIMESTAMP',
  );
  assert.equal(semPrecos.precoCusto, 0); // precoCusto ja existia antes, sempre tem default 0
  assert.equal('precoAVista' in semPrecos, false);
  assert.equal('precoAPrazo' in semPrecos, false);
  assert.equal('aVista' in (semPrecos.precos as any), false);
});

test('interpretarQuantidade tolera virgula sobrando sem nada depois ("11,")', () => {
  const r = interpretarQuantidade('11,');
  assert.equal(r.valor, 11);
  assert.equal(r.status, 'OK');
});

test('inferirMapeamentoColunas nao confunde Cód. Interno com Cód. Barras', () => {
  const mapeamento = inferirMapeamentoColunas(['Cód. Interno', 'Cód. Barras', 'Descrição', 'Quantidade Contada', 'Unidade', 'Preço à Vista', 'Preço a Prazo']);
  assert.equal(mapeamento.codigo, 0);
  assert.equal(mapeamento.codigoBarras, 1);
  assert.equal(mapeamento.descricao, 2);
  assert.equal(mapeamento.quantidade, 3);
  assert.equal(mapeamento.unidade, 4);
  assert.equal(mapeamento.precoAVista, 5);
  assert.equal(mapeamento.precoAPrazo, 6);
});

test('resolverSiglaUnidade traduz nome por extenso pra sigla do sistema, mantem sigla ja correta', () => {
  assert.equal(resolverSiglaUnidade('UNID'), 'UN');
  assert.equal(resolverSiglaUnidade('unidade'), 'UN');
  assert.equal(resolverSiglaUnidade('Quilo'), 'KG');
  assert.equal(resolverSiglaUnidade('KG'), 'KG');
  assert.equal(resolverSiglaUnidade(''), '');
});

test('processarLinhas usa a coluna Unidade explicita, mesmo com preco em formato "R$ 14,00"', () => {
  const linhas = [['136', '000001', '100 PS SUPLEMENTO PARA PÁSSARO 10ML', '11,', 'UNID', 'R$ 14,00', 'R$ 14,00']];
  const itens = processarLinhas(linhas, {
    codigo: 0, codigoBarras: 1, descricao: 2, quantidade: 3, unidade: 4, precoAVista: 5, precoAPrazo: 6, observacao: null, custo: null, custoMedio: null, custoComercial: null, precoAtacado: null, qtdMinimaAtacado: null,
    valorVenda: null, marca: null, referencia: null,
  });
  assert.equal(itens[0].quantidadeCalculada, 11);
  assert.equal(itens[0].unidadeSugerida, 'UN');
  assert.equal(itens[0].codigoBarras, '000001');
  assert.equal(itens[0].precoAVista, 14);
  assert.equal(itens[0].precoAPrazo, 14);
});

test('montarProdutoImportado grava codigoBarras quando informado, string vazia quando nao', () => {
  const unidadeUn = { id: 'un-un', sigla: 'UN', casasDecimais: 0, fracionado: false };
  const comBarras = montarProdutoImportado(
    { codigo: '1', nome: 'produto', categoria: '', unidadeBase: unidadeUn, quantidade: 1, precoVenda: 10, codigoBarras: '7891234567890' },
    'tenant-1', 'user-1', 'TIMESTAMP',
  );
  assert.equal(comBarras.codigoBarras, '7891234567890');

  const semBarras = montarProdutoImportado(
    { codigo: '2', nome: 'produto', categoria: '', unidadeBase: unidadeUn, quantidade: 1, precoVenda: 10 },
    'tenant-1', 'user-1', 'TIMESTAMP',
  );
  assert.equal(semBarras.codigoBarras, '');
});

test('montarProdutoImportado sem embalagem grava array vazio, sem quebrar', () => {
  const unidadeUn = { id: 'un-un', sigla: 'UN', casasDecimais: 0, fracionado: false };
  const produto = montarProdutoImportado(
    { codigo: '2', nome: 'produto simples', categoria: '', unidadeBase: unidadeUn, quantidade: 5, precoVenda: 10 },
    'tenant-1',
    'user-1',
    'TIMESTAMP',
  );
  assert.deepEqual(produto.embalagens, []);
});

test('numero limpo NAO escapa da contradicao com a observacao', () => {
  // Regressao real: o atalho que passou a aceitar "0." devolvia OK antes de
  // checar a observacao -- saldo entrava sem ninguem olhar.
  const zero = interpretarQuantidade('0.', 'Sem quantidade anotada');
  assert.equal(zero.status, 'REVISAR');
  assert.match(zero.motivo, /contradição/i);

  const negativo = interpretarQuantidade('-3749', 'Sem quantidade anotada');
  assert.equal(negativo.status, 'REVISAR');
});

test('numero limpo sem observacao contraditoria segue OK, inclusive "0."', () => {
  assert.equal(interpretarQuantidade('0.').status, 'OK');
  assert.equal(interpretarQuantidade('0.').valor, 0);
  assert.equal(interpretarQuantidade('4138.56', 'Conferido no depósito').status, 'OK');
});

// Custo medio e custo comercial (15/11/2026): colunas opcionais do export do sistema antigo.
test('inferirMapeamentoColunas separa Custo, Custo medio e Custo comercial, em qualquer ordem', () => {
  const m = inferirMapeamentoColunas(['Código', 'Descrição', 'Quantidade', 'Custo médio', 'Custo comercial', 'Custo', 'Preço de venda']);
  assert.equal(m.custoMedio, 3);
  assert.equal(m.custoComercial, 4);
  assert.equal(m.custo, 5);

  // Sem a coluna "Custo" pura, as duas novas nao sao tomadas por ela.
  const semCusto = inferirMapeamentoColunas(['Código', 'Descrição', 'Quantidade', 'Custo médio', 'Custo comercial']);
  assert.equal(semCusto.custo, null);
  assert.equal(semCusto.custoMedio, 3);
  assert.equal(semCusto.custoComercial, 4);

  const semNovas = inferirMapeamentoColunas(['Código', 'Descrição', 'Quantidade', 'Custo']);
  assert.equal(semNovas.custo, 3);
  assert.equal(semNovas.custoMedio, null);
  assert.equal(semNovas.custoComercial, null);
});

test('processarLinhas le custo medio e custo comercial das colunas mapeadas', () => {
  const linhas = [['1', 'PRODUTO X', '10', '14,34', '5,51897', '15,92']];
  const itens = processarLinhas(linhas, { codigo: 0, descricao: 1, quantidade: 2, observacao: null, custo: 3, custoMedio: 4, custoComercial: 5, precoAtacado: null, qtdMinimaAtacado: null, precoAVista: null, precoAPrazo: null, codigoBarras: null, unidade: null, valorVenda: null, marca: null, referencia: null });
  assert.equal(itens[0].custo, 14.34);
  assert.equal(itens[0].custoMedio, 5.51897);
  assert.equal(itens[0].custoComercial, 15.92);
});

test('montarProdutoImportado grava custo medio e custo comercial so quando maiores que zero (nunca undefined nem zero)', () => {
  const unidadeUn = { id: 'un-un', sigla: 'UN', casasDecimais: 0, fracionado: false };

  const com = montarProdutoImportado(
    { codigo: '1', nome: 'produto', categoria: '', unidadeBase: unidadeUn, quantidade: 1, precoVenda: 24.5, precoCusto: 14.34, custoMedio: 5.52, custoComercial: 15.92 },
    'tenant-1', 'user-1', 'TIMESTAMP',
  );
  assert.equal(com.precoCusto, 14.34);
  assert.equal(com.custoMedio, 5.52);
  assert.equal(com.custoComercial, 15.92);

  // Zero = nao informado: custo medio 0 gravado faria a entrada de nota tirar a media a partir de zero.
  const zerados = montarProdutoImportado(
    { codigo: '2', nome: 'produto', categoria: '', unidadeBase: unidadeUn, quantidade: 1, precoVenda: 10, custoMedio: 0, custoComercial: 0 },
    'tenant-1', 'user-1', 'TIMESTAMP',
  );
  assert.equal('custoMedio' in zerados, false);
  assert.equal('custoComercial' in zerados, false);

  const ausentes = montarProdutoImportado(
    { codigo: '3', nome: 'produto', categoria: '', unidadeBase: unidadeUn, quantidade: 1, precoVenda: 10 },
    'tenant-1', 'user-1', 'TIMESTAMP',
  );
  assert.equal('custoMedio' in ausentes, false);
  assert.equal('custoComercial' in ausentes, false);
  assert.equal(Object.values(ausentes).includes(undefined), false);
});

test('detectarGruposEmbalagem nao junta produtos na MESMA unidade quando a planilha traz a coluna Unidade', () => {
  const mapeamento = { codigo: 0, descricao: 1, quantidade: 2, observacao: null, custo: null, custoMedio: null, custoComercial: null, precoAtacado: null, qtdMinimaAtacado: null, precoAVista: null, precoAPrazo: null, codigoBarras: null, unidade: 3, valorVenda: null, marca: null, referencia: null };
  // Dois produtos diferentes (20 kg e 15 kg), os dois vendidos em saco: nao e' par solto x embalagem.
  const mesmaUnidade = processarLinhas([
    ['1', 'ARGAMASSA AC1 20KG', '10', 'SC'],
    ['2', 'ARGAMASSA AC1 15KG', '4', 'SC'],
  ], mapeamento);
  assert.equal(detectarGruposEmbalagem(mesmaUnidade, { unidadeVeioDaPlanilha: true }).length, 0);
  // Sem a opcao (planilha de contagem, sem coluna de unidade) continua agrupando como antes.
  assert.equal(detectarGruposEmbalagem(mesmaUnidade).length, 1);

  // Unidades diferentes: continua sendo o par quilo x saco de sempre.
  const unidadesDiferentes = processarLinhas([
    ['1', 'ADUBO UREIA 50KG QUILO', '45.18', 'KG'],
    ['2', 'ADUBO UREIA 50KG SACO', '44', 'SC'],
  ], mapeamento);
  assert.equal(detectarGruposEmbalagem(unidadesDiferentes, { unidadeVeioDaPlanilha: true }).length, 1);

  // Item sem unidade no grupo: nao da para afirmar que e' a mesma, continua agrupando.
  const umSemUnidade = processarLinhas([
    ['1', 'ARGAMASSA AC1 20KG', '10', 'SC'],
    ['2', 'ARGAMASSA AC1 15KG', '4', ''],
  ], mapeamento);
  assert.equal(detectarGruposEmbalagem(umSemUnidade, { unidadeVeioDaPlanilha: true }).length, 1);
});

test('atacado do sistema antigo (22/11/2026): colunas reconhecidas e faixa unica no produto', () => {
  const cab = ['Cód. Interno', 'Descrição', 'Quantidade', 'Unidade', 'Preço venda', 'Preço atacado', 'Qtd. mínima atacado'];
  const mapa = inferirMapeamentoColunas(cab);
  assert.equal(mapa.quantidade, 2, '"Qtd. minima atacado" nao e a quantidade');
  assert.equal(mapa.precoAtacado, 5);
  assert.equal(mapa.qtdMinimaAtacado, 6);
  const [item] = processarLinhas([['135', 'POTE', '70', 'PCT', '53.8', '49.99', '8']], mapa);
  assert.equal(item.precoAtacado, 49.99);
  assert.equal(item.qtdMinimaAtacado, 8);
  const base = { codigo: '1', nome: 'POTE', categoria: 'EMBALAGENS', unidadeBase: { id: 'u', sigla: 'PCT', casasDecimais: 0, fracionado: false }, quantidade: 70, precoVenda: 53.8 };
  const doc = montarProdutoImportado({ ...base, precoAtacado: 49.99, quantidadeMinimaAtacado: 8 }, 'T', 'U', 'TS');
  assert.deepEqual(doc.atacado, { ativo: true, quantidadeMinima: 8, faixas: [{ id: 'faixa-importacao', quantidadeInicial: 8, quantidadeFinal: null, ilimitado: true, preco: 49.99 }] });
  assert.equal(doc.ativarAtacado, true);
  assert.equal(doc.quantidadeMinimaAtacado, 8);
  // Sem a quantidade minima (ou sem preco) nao entra nada -- nem chave undefined.
  const sem = montarProdutoImportado({ ...base, precoAtacado: 49.99 }, 'T', 'U', 'TS');
  assert.equal('atacado' in sem, false);
  assert.equal('ativarAtacado' in sem, false);
});
