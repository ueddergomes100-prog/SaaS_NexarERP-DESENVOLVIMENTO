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
  assert.deepEqual(mapeamento, { codigo: 0, descricao: 1, quantidade: 2, observacao: 3, custo: null, precoAVista: null, precoAPrazo: null });
});

test('processarLinhas ignora linhas vazias e devolve item por linha com descricao', () => {
  const linhas = [
    ['136', '100 PS SUPLEMENTO PARA PÁSSARO 10ML', '11', ''],
    ['', '', '', ''],
    ['113', 'ADUBO 04-14-08 50KG SACO', '8', ''],
  ];
  const itens = processarLinhas(linhas, { codigo: 0, descricao: 1, quantidade: 2, observacao: 3, custo: null, precoAVista: null, precoAPrazo: null });
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
    { codigo: 0, descricao: 1, quantidade: 2, observacao: 3, custo: null, precoAVista: null, precoAPrazo: null },
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
    { codigo: 0, descricao: 1, quantidade: 2, observacao: 3, custo: null, precoAVista: null, precoAPrazo: null },
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
  const itens = processarLinhas(linhas, { codigo: 0, descricao: 1, quantidade: 2, observacao: 3, custo: 4, precoAVista: 5, precoAPrazo: 6 });
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
