import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aplicarNoIndice,
  camposDoGrupo,
  criarIndice,
  hashDoCadastro,
  indexar,
  itemDaFilial,
  mudouCadastroDoGrupo,
  planejarEspelho,
  type ColecaoEspelhada,
  type ContextoDoEspelho,
  type DocDoEspelho,
} from '../src/utils/cadastroGrupoDomain';

const A = 'matriz';
const B = 'baixada';

const montar = (colecao: ColecaoEspelhada, docs: DocDoEspelho[], extra: Partial<ContextoDoEspelho> = {}): ContextoDoEspelho => {
  const indice = criarIndice();
  docs.forEach((d) => indexar(colecao, indice, d));
  return { colecao, filiais: [A, B], matrizTenantId: A, indice, ...extra };
};

/** Simula o servidor: planeja sobre a versao mais nova do indice e aplica. */
const processar = (ctx: ContextoDoEspelho, id: string) => {
  const doc = ctx.indice.porId.get(id)!;
  const gravacoes = planejarEspelho(ctx, doc);
  aplicarNoIndice(ctx.colecao, ctx.indice, gravacoes);
  return gravacoes;
};

const produto = (extra: Record<string, unknown> = {}) => ({
  tenantId: A, nome: 'RAÇÃO GOLDEN 15KG', codigo: '1001', codigoBarras: '7890001', ncm: '23091000', categoria: 'RAÇÕES',
  unidadeMedidaId: 'unA-sc', unidadeMedidaSigla: 'SC', precoVenda: 180, precoAVista: 170, precoCusto: 120,
  quantidade: 12, quantidadeReservada: 2, estoqueMinimo: 5, localizacaoEstoque: 'A1', cfop: '5102', csosn: '102', ...extra,
});

test('produto novo na matriz: ganha a chave do grupo e nasce na filial com estoque zerado e preco da matriz', () => {
  const ctx = montar('estoque', [{ id: 'p1', tenantId: A, dados: produto() }], {
    unidadeNaFilial: (tenantId, sigla) => (tenantId === B && sigla === 'SC' ? 'unB-sc' : null),
  });
  const g = processar(ctx, 'p1');
  const self = g.find((x) => x.id === 'p1')!;
  assert.deepEqual(Object.keys(self.campos).sort(), ['cadastroHash', 'filialOrigem', 'grupoChave']);
  assert.equal(self.campos.grupoChave, 'p1');
  assert.equal(self.campos.filialOrigem, A);
  const copia = g.find((x) => x.tenantId === B)!;
  assert.equal(copia.tipo, 'criar');
  assert.equal(copia.id, 'p1_baixada');
  assert.equal(copia.campos.tenantId, B);
  assert.equal(copia.campos.nome, 'RAÇÃO GOLDEN 15KG');
  assert.equal(copia.campos.precoVenda, 180, 'preco inicial = o da matriz');
  assert.equal(copia.campos.csosn, '102', 'tributacao inicial = a da matriz');
  assert.equal(copia.campos.quantidade, 0);
  assert.equal(copia.campos.quantidadeReservada, 0);
  assert.equal(copia.campos.estoqueMinimo, 0);
  assert.equal(copia.campos.localizacaoEstoque, '');
  assert.equal(copia.campos.unidadeMedidaId, 'unB-sc', 'unidade remapeada pela sigla');
  assert.equal(copia.campos.filialOrigem, A);
  assert.equal(Object.values(copia.campos).some((v) => v === undefined), false);
});

test('eco do servidor nao regrava nada; reprocessar o mesmo documento e\' idempotente', () => {
  const ctx = montar('estoque', [{ id: 'p1', tenantId: A, dados: produto() }]);
  processar(ctx, 'p1');
  assert.deepEqual(processar(ctx, 'p1'), []);
  assert.deepEqual(processar(ctx, 'p1_baixada'), []);
});

test('preco e estoque da filial nao espalham; nome alterado na filial espalha so o cadastro', () => {
  const ctx = montar('estoque', [{ id: 'p1', tenantId: A, dados: produto() }]);
  processar(ctx, 'p1');
  // Na Baixada: muda preco e estoque (da filial) -> nada a espalhar.
  const copia = ctx.indice.porId.get('p1_baixada')!;
  indexar('estoque', ctx.indice, { ...copia, dados: { ...copia.dados, precoVenda: 199, quantidade: 7 } });
  assert.deepEqual(processar(ctx, 'p1_baixada'), []);
  // Na Baixada: corrige o nome (do grupo) -> vai para a matriz, sem levar o preco 199.
  const atual = ctx.indice.porId.get('p1_baixada')!;
  indexar('estoque', ctx.indice, { ...atual, dados: { ...atual.dados, nome: 'RACAO GOLDEN ADULTO 15KG' } });
  const g = processar(ctx, 'p1_baixada');
  const naMatriz = g.find((x) => x.tenantId === A)!;
  assert.equal(naMatriz.campos.nome, 'RACAO GOLDEN ADULTO 15KG');
  assert.equal('precoVenda' in naMatriz.campos, false);
  assert.equal('quantidade' in naMatriz.campos, false);
  assert.equal(ctx.indice.porId.get('p1')!.dados.precoVenda, 180, 'preco da matriz intacto');
  assert.equal(ctx.indice.porId.get('p1')!.dados.nome, 'RACAO GOLDEN ADULTO 15KG');
});

test('eco atrasado de uma filial nao desfaz a edicao de outra que ainda nao foi processada', () => {
  const ctx = montar('estoque', [{ id: 'p1', tenantId: A, dados: produto() }]);
  processar(ctx, 'p1');
  // Alguem editou a copia da Baixada (ainda nao processada)...
  const copia = ctx.indice.porId.get('p1_baixada')!;
  indexar('estoque', ctx.indice, { ...copia, dados: { ...copia.dados, ncm: '23099090' } });
  // ...e chega primeiro um eco da matriz (assinatura bate): nao pode sobrescrever a Baixada.
  assert.deepEqual(processar(ctx, 'p1').filter((x) => x.tenantId === B), []);
  // Quando a Baixada e' processada, a mudanca vai para a matriz.
  const g = processar(ctx, 'p1_baixada');
  assert.equal(g.find((x) => x.tenantId === A)!.campos.ncm, '23099090');
});

test('unidades padrao que ja existem nas duas empresas sao ligadas, nao duplicadas', () => {
  const ctx = montar('unidades_medida', [
    { id: 'unA', tenantId: A, dados: { tenantId: A, sigla: 'UN', nome: 'Unidade', fracionado: false } },
    { id: 'unB', tenantId: B, dados: { tenantId: B, sigla: 'un', nome: 'Unidade', fracionado: false } },
  ]);
  const g = processar(ctx, 'unA');
  const ligacao = g.find((x) => x.tenantId === B)!;
  assert.equal(ligacao.tipo, 'atualizar');
  assert.equal(ligacao.id, 'unB');
  assert.equal(ligacao.campos.grupoChave, 'unA');
  assert.equal(ligacao.campos.sigla, 'UN');
  assert.deepEqual(processar(ctx, 'unB'), [], 'a unidade ligada nao gera nada');
});

test('clientes: tudo e\' do grupo; consumidor final de cada empresa fica de fora', () => {
  const ctx = montar('clientes', [
    { id: 'c1', tenantId: B, dados: { tenantId: B, nome: 'MERCADO PRECIOSO', documento: '05.448.435/0001-17', limiteDeCredito: 5000, alertaAtivo: true, alertaTexto: 'Só à vista' } },
    { id: 'cf', tenantId: A, dados: { tenantId: A, nome: 'CONSUMIDOR FINAL', isPadrao: true } },
  ]);
  const g = processar(ctx, 'c1');
  const naMatriz = g.find((x) => x.tenantId === A)!;
  assert.equal(naMatriz.tipo, 'criar');
  assert.equal(naMatriz.campos.limiteDeCredito, 5000, 'limite de credito e\' do grupo');
  assert.equal(naMatriz.campos.alertaTexto, 'Só à vista');
  assert.equal(naMatriz.campos.filialOrigem, B);
  assert.deepEqual(processar(ctx, 'cf'), []);
});

test('assinatura ignora ordem das chaves e campos de controle', () => {
  const a = camposDoGrupo('clientes', { nome: 'X', cidade: 'SERRA', tenantId: 'a', cadastroHash: '1', alteradoEm: 'ontem' });
  const b = camposDoGrupo('clientes', { cidade: 'SERRA', nome: 'X', tenantId: 'b', cadastroHash: '2' });
  assert.equal(hashDoCadastro(a), hashDoCadastro(b));
  assert.notEqual(hashDoCadastro(a), hashDoCadastro({ ...a, nome: 'Y' }));
});

test('na tela: "itens desta filial" e trava do cadastro do grupo', () => {
  assert.equal(itemDaFilial({ filialOrigem: A, quantidade: 0 }, A), true);
  assert.equal(itemDaFilial({ filialOrigem: A, quantidade: 0 }, B), false);
  assert.equal(itemDaFilial({ filialOrigem: A, quantidade: 3 }, B), true, 'recebeu estoque: aparece');
  assert.equal(itemDaFilial({ quantidade: 0 }, B), true, 'sem filiais (sem origem): aparece');
  const antes = produto();
  assert.equal(mudouCadastroDoGrupo('estoque', antes, { ...antes, precoVenda: 1, quantidade: 99 }), false);
  assert.equal(mudouCadastroDoGrupo('estoque', antes, { ...antes, nome: 'OUTRO' }), true);
});
