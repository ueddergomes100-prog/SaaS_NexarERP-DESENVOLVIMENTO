import test from 'node:test';
import assert from 'node:assert/strict';
import { composicaoDaEmbalagemNoPapel, conteudoDaUnidade, conteudoParaGravar, quantidadeComUnidade } from '../src/utils/embalagemNoPapelDomain';

const emb = (id: string, sigla: string, fator: number, ativo = true) => ({
  id, unidadeMedidaId: `u-${sigla}`, unidadeMedidaSigla: sigla, unidadeMedidaCasasDecimais: 0, unidadeMedidaFracionado: false,
  descricao: '', fatorConversao: fator, precoVenda: 0, precoAVista: 0, precoCusto: 0, codigoBarras: '', ativo,
});

// Embala Minas: vende em pacote com 10 e caixa com 300; estoque em UN.
const EMBALAGEM_641 = { siglaBase: 'UN', embalagens: [emb('pct', 'PCT', 10), emb('cx', 'CX', 300)] };

test('caixa com pacotes: diz quantos pacotes e quantas unidades', () => {
  const item = { quantidade: 1, unidadeMedidaSigla: 'CX', embalagemId: 'cx', fatorConversao: 300 };
  assert.equal(composicaoDaEmbalagemNoPapel(item, EMBALAGEM_641), '1 CX = 30 PCT de 10 UN = 300 UN');
  assert.equal(composicaoDaEmbalagemNoPapel({ ...item, quantidade: 2 }, EMBALAGEM_641), '2 CX = 60 PCT de 10 UN = 600 UN');
  assert.equal(quantidadeComUnidade(item), '1 CX');
});

test('sem embalagem do meio: so o total na unidade do estoque', () => {
  const item = { quantidade: 3, unidadeMedidaSigla: 'PCT', embalagemId: 'pct', fatorConversao: 10 };
  assert.equal(composicaoDaEmbalagemNoPapel(item, EMBALAGEM_641), '3 PCT = 30 UN');
  // Saco de 20 kg: "2 SC = 40 KG".
  assert.equal(composicaoDaEmbalagemNoPapel({ quantidade: 2, unidadeMedidaSigla: 'SC', embalagemId: 's', fatorConversao: 20 }, { siglaBase: 'KG', embalagens: [emb('s', 'SC', 20)] }), '2 SC = 40 KG');
});

test('embalagem do meio inativa ou que nao divide a vendida fica de fora', () => {
  const item = { quantidade: 1, unidadeMedidaSigla: 'CX', embalagemId: 'cx', fatorConversao: 300 };
  assert.equal(composicaoDaEmbalagemNoPapel(item, { siglaBase: 'UN', embalagens: [emb('pct', 'PCT', 10, false), emb('cx', 'CX', 300)] }), '1 CX = 300 UN');
  assert.equal(composicaoDaEmbalagemNoPapel(item, { siglaBase: 'UN', embalagens: [emb('pct', 'PCT', 7), emb('cx', 'CX', 300)] }), '1 CX = 300 UN');
});

test('item na unidade do estoque, fracionaria ou sem cadastro', () => {
  assert.equal(composicaoDaEmbalagemNoPapel({ quantidade: 5, unidadeMedidaSigla: 'UN' }, EMBALAGEM_641), '');
  assert.equal(composicaoDaEmbalagemNoPapel({ quantidade: 1, unidadeMedidaSigla: 'MEIO', embalagemId: 'm', fatorConversao: 0.5 }, { siglaBase: 'M3' }), '');
  // Produto nao carregado: unidade do estoque cai no padrao UN.
  assert.equal(composicaoDaEmbalagemNoPapel({ quantidade: 1, unidadeMedidaSigla: 'CX', embalagemId: 'cx', fatorConversao: 12 }, null), '1 CX = 12 UN');
  assert.equal(quantidadeComUnidade({ quantidade: 2.5, unidadeMedidaSigla: 'kg' }, 3), '2,500 KG');
  assert.equal(quantidadeComUnidade({ quantidade: 4 }), '4 UN');
});

// Como o dono descreveu (26/11/2026): estoque em PCT, caixa com 30 PCT, cada PCT com 10 UN.
const PCT_COM_10 = { siglaBase: 'PCT', embalagens: [emb('cx', 'CX', 30)], conteudoQuantidade: 10, conteudoSigla: 'UN' };

test('conteudo da unidade no cadastro: caixa, pacote solto e sem conteudo', () => {
  const caixa = { quantidade: 1, unidadeMedidaSigla: 'CX', embalagemId: 'cx', fatorConversao: 30 };
  assert.equal(composicaoDaEmbalagemNoPapel(caixa, PCT_COM_10), '1 CX = 30 PCT de 10 UN = 300 UN');
  assert.equal(composicaoDaEmbalagemNoPapel({ ...caixa, quantidade: 3 }, PCT_COM_10), '3 CX = 90 PCT de 10 UN = 900 UN');
  // Pacote solto (unidade do estoque): sai so' com o conteudo.
  assert.equal(composicaoDaEmbalagemNoPapel({ quantidade: 4, unidadeMedidaSigla: 'PCT' }, PCT_COM_10), '4 PCT de 10 UN = 40 UN');
  assert.equal(composicaoDaEmbalagemNoPapel({ quantidade: 4, unidadeMedidaSigla: 'PCT' }, { ...PCT_COM_10, conteudoQuantidade: 0 }), '');
  // Sem o conteudo, a caixa sai so' em pacotes.
  assert.equal(composicaoDaEmbalagemNoPapel(caixa, { ...PCT_COM_10, conteudoQuantidade: 0 }), '1 CX = 30 PCT');
  // Sem sigla, o conteudo e' em UN; conteudo na propria unidade do estoque nao conta.
  assert.deepEqual(conteudoDaUnidade({ siglaBase: 'PCT', conteudoQuantidade: 10 }), { quantidade: 10, sigla: 'UN' });
  assert.equal(conteudoDaUnidade({ siglaBase: 'PCT', conteudoQuantidade: 10, conteudoSigla: 'pct' }), null);
});

test('conteudo para gravar: numero e sigla, nunca texto nem vazio pela metade', () => {
  assert.deepEqual(conteudoParaGravar('10', 'un'), { quantidade: 10, sigla: 'UN' });
  assert.deepEqual(conteudoParaGravar('12,5', 'KG'), { quantidade: 12.5, sigla: 'KG' });
  assert.deepEqual(conteudoParaGravar('12.5', ''), { quantidade: 12.5, sigla: 'UN' });
  assert.deepEqual(conteudoParaGravar('1.000,5', 'UN'), { quantidade: 1000.5, sigla: 'UN' });
  assert.deepEqual(conteudoParaGravar('', 'UN'), { quantidade: 0, sigla: '' });
  assert.deepEqual(conteudoParaGravar('abc', 'UN'), { quantidade: 0, sigla: '' });
  assert.deepEqual(conteudoParaGravar(undefined, undefined), { quantidade: 0, sigla: '' });
});
