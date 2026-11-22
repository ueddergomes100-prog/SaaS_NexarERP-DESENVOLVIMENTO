import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOpcoesUnidadeVenda,
  camposDeUnidadeDoItem,
  custoDaEmbalagem,
  embalagemFracionaria,
  embalagensComUnidadesAtuais,
  opcaoDoItemDeOrigem,
  opcaoNaUnidadeDoEstoque,
  margemSobreCusto,
  findOpcaoUnidadeVenda,
  opcaoDoItemGravado,
  opcoesDeUnidadeDaTela,
  unidadeDePrecoDaOpcao,
  formatFatorConversao,
  normalizeEmbalagens,
  toBaseQuantity,
  toStockAdjustmentItems,
} from '../src/utils/embalagemDomain';

const produtoKg = {
  precoVenda: 10,
  unidadeMedidaSigla: 'KG',
  unidadeMedidaCasasDecimais: 3,
  unidadeMedidaFracionado: true,
  embalagens: [
    {
      id: 'emb-saco',
      unidadeMedidaId: 'un',
      unidadeMedidaSigla: 'SC',
      unidadeMedidaCasasDecimais: 0,
      unidadeMedidaFracionado: false,
      descricao: 'Saco de 20kg',
      fatorConversao: 20,
      precoVenda: 195.5,
      codigoBarras: '789000000001',
      ativo: true,
    },
  ],
};

test('produto sem embalagem devolve so a unidade base', () => {
  const opcoes = buildOpcoesUnidadeVenda({
    precoVenda: 10,
    unidadeMedidaSigla: 'KG',
    unidadeMedidaCasasDecimais: 3,
    unidadeMedidaFracionado: true,
  });

  assert.equal(opcoes.length, 1);
  assert.equal(opcoes[0].embalagemId, '');
  assert.equal(opcoes[0].label, 'KG');
  assert.equal(opcoes[0].fatorConversao, 1);
  assert.equal(opcoes[0].precoVenda, 10);
});

test('embalagem entra depois da base, com rotulo e preco proprio', () => {
  const opcoes = buildOpcoesUnidadeVenda(produtoKg);

  assert.equal(opcoes.length, 2);
  assert.equal(opcoes[1].label, 'SC(20,000)');
  assert.equal(opcoes[1].precoVenda, 195.5);
  assert.equal(opcoes[1].fatorConversao, 20);
  // O saco herda as casas decimais da PROPRIA unidade, nao as do produto base:
  // um produto fracionavel em KG nao torna o saco fracionavel.
  assert.equal(opcoes[1].permiteFracionado, false);
  assert.equal(opcoes[1].casasDecimais, 0);
});

test('embalagem sem preco proprio deriva do preco base x fator', () => {
  const opcoes = buildOpcoesUnidadeVenda({
    ...produtoKg,
    embalagens: [{ ...produtoKg.embalagens[0], precoVenda: 0 }],
  });

  assert.equal(opcoes[1].precoVenda, 200);
  assert.equal(opcoes[1].precoVendaProprio, 0);
});

test('opcao leva os precos cadastrados na embalagem (venda e a vista); a base nao tem', () => {
  const opcoes = buildOpcoesUnidadeVenda({
    ...produtoKg,
    embalagens: [{ ...produtoKg.embalagens[0], precoAVista: 180 }],
  });

  assert.equal(opcoes[0].precoVendaProprio, 0);
  assert.equal(opcoes[0].precoAVistaProprio, 0);
  assert.equal(opcoes[1].precoVendaProprio, 195.5);
  assert.equal(opcoes[1].precoAVistaProprio, 180);
  // Embalagem gravada antes do campo existir: sem preco a vista proprio.
  assert.equal(normalizeEmbalagens(produtoKg.embalagens)[0].precoAVista, 0);
});

test('embalagem inativa fica fora do seletor', () => {
  const opcoes = buildOpcoesUnidadeVenda({
    ...produtoKg,
    embalagens: [{ ...produtoKg.embalagens[0], ativo: false }],
  });

  assert.equal(opcoes.length, 1);
});

test('normalizeEmbalagens descarta entrada sem id ou com fator invalido', () => {
  const embalagens = normalizeEmbalagens([
    { ...produtoKg.embalagens[0], id: '' },
    { ...produtoKg.embalagens[0], id: 'sem-fator', fatorConversao: 0 },
    { ...produtoKg.embalagens[0], id: 'fator-negativo', fatorConversao: -5 },
    produtoKg.embalagens[0],
    'lixo',
    null,
  ]);

  assert.equal(embalagens.length, 1);
  assert.equal(embalagens[0].id, 'emb-saco');
});

test('normalizeEmbalagens trata campo ausente ou nao-array como lista vazia', () => {
  assert.deepEqual(normalizeEmbalagens(undefined), []);
  assert.deepEqual(normalizeEmbalagens(null), []);
  assert.deepEqual(normalizeEmbalagens({ id: 'x' }), []);
});

test('embalagem sem o campo ativo e considerada ativa', () => {
  const embalagens = normalizeEmbalagens([
    { id: 'emb-1', fatorConversao: 5 },
  ]);

  assert.equal(embalagens[0].ativo, true);
  assert.equal(embalagens[0].unidadeMedidaSigla, 'UN');
});

test('findOpcaoUnidadeVenda cai na base quando o id nao existe mais', () => {
  const opcoes = buildOpcoesUnidadeVenda(produtoKg);

  assert.equal(findOpcaoUnidadeVenda(opcoes, 'emb-saco').embalagemId, 'emb-saco');
  assert.equal(findOpcaoUnidadeVenda(opcoes, 'emb-apagada').embalagemId, '');
  assert.equal(findOpcaoUnidadeVenda(opcoes, '').embalagemId, '');
  assert.equal(findOpcaoUnidadeVenda(opcoes, undefined).embalagemId, '');
});

test('toBaseQuantity converte pela embalagem', () => {
  assert.equal(toBaseQuantity(1, 20), 20);
  assert.equal(toBaseQuantity(2.5, 20), 50);
});

test('toBaseQuantity sem fator preserva a quantidade (retrocompatibilidade)', () => {
  assert.equal(toBaseQuantity(1.5), 1.5);
  assert.equal(toBaseQuantity(1.5, undefined), 1.5);
  assert.equal(toBaseQuantity(1.5, 0), 1.5);
});

test('toBaseQuantity absorve erro de ponto flutuante', () => {
  // 0.1 * 3 = 0.30000000000000004 em ponto flutuante puro.
  assert.equal(toBaseQuantity(0.1, 3), 0.3);
});

test('toStockAdjustmentItems converte cada item e preserva id/nome', () => {
  const ajustes = toStockAdjustmentItems([
    { id: 'p1', nome: 'RACAO', quantidade: 1, fatorConversao: 20 },
    { id: 'p2', nome: 'MILHO', quantidade: 1.5 },
  ]);

  assert.deepEqual(ajustes, [
    { id: 'p1', nome: 'RACAO', quantidade: 20 },
    { id: 'p2', nome: 'MILHO', quantidade: 1.5 },
  ]);
});

test('formatFatorConversao usa 3 casas com virgula, igual ao seletor', () => {
  assert.equal(formatFatorConversao(20), '20,000');
  assert.equal(formatFatorConversao(0.5), '0,500');
});

/* Unidade no Orcamento, na OS e no app Vendas (21/11/2026): tubo de 6 m, metro como base. */
const tuboMetro = {
  precoVenda: 5,
  unidadeMedidaSigla: 'MT',
  unidadeMedidaCasasDecimais: 2,
  unidadeMedidaFracionado: true,
  embalagens: [{
    id: 'emb-tubo', unidadeMedidaId: 'tb', unidadeMedidaSigla: 'TB', unidadeMedidaCasasDecimais: 0, unidadeMedidaFracionado: false,
    descricao: 'TUBO 6M', fatorConversao: 6, precoVenda: 27, precoAVista: 25, codigoBarras: '', ativo: true,
  }],
};

test('opcoesDeUnidadeDaTela: com "Vender por embalagem" desligado, so a unidade do cadastro', () => {
  assert.deepEqual(opcoesDeUnidadeDaTela(tuboMetro, false).map((o) => o.sigla), ['MT']);
  assert.deepEqual(opcoesDeUnidadeDaTela(tuboMetro, true).map((o) => o.sigla), ['MT', 'TB']);
});

test('camposDeUnidadeDoItem: tubo grava sigla, casas, fator e a quantidade no estoque; metro nao ganha campo de embalagem', () => {
  const [metro, tubo] = buildOpcoesUnidadeVenda(tuboMetro);
  assert.deepEqual(camposDeUnidadeDoItem(tubo, 2), {
    unidadeMedidaSigla: 'TB', unidadeMedidaCasasDecimais: 0, unidadeMedidaFracionado: false,
    embalagemId: 'emb-tubo', fatorConversao: 6, quantidadeBase: 12,
  });
  assert.deepEqual(camposDeUnidadeDoItem(metro, 2.5), { unidadeMedidaSigla: 'MT', unidadeMedidaCasasDecimais: 2, unidadeMedidaFracionado: true });
});

test('unidadeDePrecoDaOpcao: precos proprios do tubo; na base, nenhum', () => {
  const [metro, tubo] = buildOpcoesUnidadeVenda(tuboMetro);
  assert.deepEqual(unidadeDePrecoDaOpcao(tubo), { fatorConversao: 6, precoProprio: 27, precoAVistaProprio: 25 });
  assert.deepEqual(unidadeDePrecoDaOpcao(metro), { fatorConversao: 1, precoProprio: 0, precoAVistaProprio: 0 });
});

test('opcaoDoItemGravado: embalagem apagada do cadastro devolve null (nao vira metro sem aviso)', () => {
  assert.equal(opcaoDoItemGravado(tuboMetro, 'emb-tubo')?.sigla, 'TB');
  assert.equal(opcaoDoItemGravado(tuboMetro, '')?.sigla, 'MT');
  assert.equal(opcaoDoItemGravado(tuboMetro, 'emb-apagada'), null);
});

test('custo da embalagem: o proprio quando cadastrado; senao custo do metro x fator (21/11/2026)', () => {
  assert.equal(custoDaEmbalagem({ precoCusto: 20, fatorConversao: 6 }, 4), 20);
  assert.equal(custoDaEmbalagem({ precoCusto: 0, fatorConversao: 6 }, 4), 24);
  assert.equal(custoDaEmbalagem({ fatorConversao: 6 }, 0), 0);
  assert.equal(normalizeEmbalagens([{ id: 'e', fatorConversao: 6, precoCusto: '20,5' }])[0].precoCusto, 0, 'texto com virgula nao vira numero');
  assert.equal(normalizeEmbalagens([{ id: 'e', fatorConversao: 6, precoCusto: 20.5 }])[0].precoCusto, 20.5);
});

test('margem sobre o custo, como no cadastro do produto', () => {
  assert.equal(margemSobreCusto(27, 20), 35);
  assert.equal(margemSobreCusto(27, 0), null);
});

test('embalagensComUnidadesAtuais: unidade G marcada como fracionada depois refaz a copia da embalagem (caso PREGO, 21/11/2026)', () => {
  const embalagens = [
    { id: 'g', unidadeMedidaId: 'u-g', unidadeMedidaSigla: 'G', unidadeMedidaFracionado: false, unidadeMedidaCasasDecimais: 0, fatorConversao: 0.1, precoVenda: 4, extra: 'fica' },
    { id: 'cx', unidadeMedidaId: 'u-cx', unidadeMedidaSigla: 'CX', unidadeMedidaFracionado: false, unidadeMedidaCasasDecimais: 0, fatorConversao: 10 },
  ];
  const unidades: Record<string, { sigla: string; permiteFracionado: boolean; casasDecimais: number }> = {
    'u-g': { sigla: 'G', permiteFracionado: true, casasDecimais: 3 },
  };
  const r = embalagensComUnidadesAtuais(embalagens, (e) => unidades[e.unidadeMedidaId] || null);
  assert.equal(r.alteradas, 1);
  assert.equal(r.travadas, 1);
  assert.deepEqual(r.embalagens[0], { ...embalagens[0], unidadeMedidaFracionado: true, unidadeMedidaCasasDecimais: 3 });
  assert.equal(r.embalagens[1], embalagens[1], 'embalagem sem unidade achada fica como esta');
  // Rodar de novo nao muda nada.
  assert.equal(embalagensComUnidadesAtuais(r.embalagens, (e) => unidades[e.unidadeMedidaId] || null).alteradas, 0);
  assert.deepEqual(embalagensComUnidadesAtuais(undefined, () => null), { embalagens: [], alteradas: 0, travadas: 0 });
});

// Embalagem fracionaria entra na unidade do estoque (21/11/2026: meio metro de areia = 0,5 M3).
const areiaFracionada = {
  precoVenda: 200,
  unidadeMedidaSigla: 'M3',
  unidadeMedidaCasasDecimais: 0,
  unidadeMedidaFracionado: false,
  embalagens: [
    { id: 'meio', unidadeMedidaSigla: 'MT', fatorConversao: 0.5, precoVenda: 110, ativo: true },
    { id: 'lata', unidadeMedidaSigla: 'LATA', fatorConversao: 0.02, ativo: true },
    { id: 'carrada', unidadeMedidaSigla: 'CARR', fatorConversao: 5, precoVenda: 950, ativo: true },
  ],
};

test('embalagem fracionaria: so fator entre 0 e 1, e so embalagem', () => {
  const [base, meio, lata, carrada] = buildOpcoesUnidadeVenda(areiaFracionada);
  assert.equal(embalagemFracionaria(base), false);
  assert.equal(embalagemFracionaria(meio), true);
  assert.equal(embalagemFracionaria(lata), true);
  assert.equal(embalagemFracionaria(carrada), false);
  assert.equal(embalagemFracionaria({ embalagemId: 'x', fatorConversao: 0 }), false);
});

test('meio metro vira a unidade do estoque com o preco do meio metro dividido pelo fator', () => {
  const [base, meio, , carrada] = buildOpcoesUnidadeVenda(areiaFracionada);
  const naBase = opcaoNaUnidadeDoEstoque(meio, base);
  assert.equal(naBase.embalagemId, '');
  assert.equal(naBase.sigla, 'M3');
  assert.equal(naBase.fatorConversao, 1);
  assert.equal(naBase.permiteFracionado, true, 'M3 inteiro no cadastro, mas meio metro e fracao por natureza');
  assert.equal(naBase.casasDecimais, 1, 'casas do fator (0,5)');
  assert.equal(naBase.precoVendaProprio, 220);
  assert.equal(naBase.precoVenda, 220);
  assert.deepEqual(naBase.origem, { embalagemId: 'meio', sigla: 'MT', fatorConversao: 0.5 });
  assert.deepEqual(unidadeDePrecoDaOpcao(naBase), { fatorConversao: 1, precoProprio: 220, precoAVistaProprio: 0 });
  // 1 meio metro = 0,5 M3 a R$ 220 = R$ 110; o item nao fica com embalagem, guarda a origem.
  assert.deepEqual(camposDeUnidadeDoItem(naBase, 0.5), {
    unidadeMedidaSigla: 'M3', unidadeMedidaCasasDecimais: 1, unidadeMedidaFracionado: true,
    embalagemDeOrigem: { embalagemId: 'meio', sigla: 'MT', fatorConversao: 0.5 },
  });
  // Embalagem maior que a unidade (carrada) continua embalagem.
  assert.equal(opcaoNaUnidadeDoEstoque(carrada, base), carrada);
  assert.equal(opcaoNaUnidadeDoEstoque(base, base), base);
});

test('lata sem preco proprio: vale o preco do produto (200 x 0,02 / 0,02)', () => {
  const [base, , lata] = buildOpcoesUnidadeVenda(areiaFracionada);
  const naBase = opcaoNaUnidadeDoEstoque(lata, base);
  assert.equal(naBase.casasDecimais, 2);
  assert.equal(naBase.precoVendaProprio, 0);
  assert.equal(naBase.precoVenda, 200);
  assert.deepEqual(unidadeDePrecoDaOpcao(naBase), { fatorConversao: 1, precoProprio: 0, precoAVistaProprio: 0 });
});

test('item gravado com origem: volta a opcao de lancamento; embalagem apagada cai no estoque, fracionado', () => {
  assert.equal(opcaoDoItemDeOrigem(areiaFracionada, { embalagemId: 'meio' })?.precoVendaProprio, 220);
  const sumiu = opcaoDoItemDeOrigem(areiaFracionada, { embalagemId: 'apagada' });
  assert.equal(sumiu?.sigla, 'M3');
  assert.equal(sumiu?.precoVendaProprio, 0);
  assert.equal(sumiu?.permiteFracionado, true);
  assert.equal(opcaoDoItemDeOrigem(areiaFracionada, undefined), null);
  assert.equal(opcaoDoItemDeOrigem(areiaFracionada, { embalagemId: '' }), null);
});
