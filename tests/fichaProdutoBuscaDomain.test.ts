import assert from 'node:assert/strict';
import { test } from 'node:test';
import { atacadoParaBusca, fichaDoProduto } from '../src/utils/fichaProdutoBuscaDomain';

const completo = {
  nome: 'PARAFUSO AUTO BROCANTE 5,5 X 1.1/2', codigo: '1508', marca: 'FIXTIL', categoria: 'Fixadores',
  precoVenda: 0.22, precoAVista: 0.2, quantidade: 900, quantidadeReservada: 40,
  unidadeMedidaSigla: 'UN', unidadeMedidaCasasDecimais: 0, localizacaoEstoque: 'C-05',
  referencia: 'AB-55112', codigoBarras: '7891234005508',
};

test('ficha completa: titulo, subtitulo, precos e as linhas na ordem da tela', () => {
  const ficha = fichaDoProduto(completo);
  assert.equal(ficha.nome, 'PARAFUSO AUTO BROCANTE 5,5 X 1.1/2');
  assert.equal(ficha.subtitulo, 'Cód. 1508 · FIXTIL · Fixadores');
  assert.equal(ficha.preco, 0.22);
  assert.equal(ficha.precoAVista, 0.2);
  assert.equal(ficha.unidade, 'UN');
  assert.deepEqual(ficha.linhas.map((l) => [l.id, l.valor]), [
    ['disponivel', '860 UN'],
    ['reservado', '40 UN'],
    ['local', 'C-05'],
    ['unidade', 'UN'],
    ['marca', 'FIXTIL'],
    ['referencia', 'AB-55112'],
    ['barras', '7891234005508'],
  ]);
  assert.equal(ficha.linhas[0].nivel, 'ok');
});

test('campo que o cadastro nao tem nao vira linha: nada de traco nem "nao informado"', () => {
  const ficha = fichaDoProduto({ nome: 'LIXA MADEIRA 180', codigo: '1299', precoVenda: 1.3, quantidade: 12 });
  assert.equal(ficha.subtitulo, 'Cód. 1299');
  assert.deepEqual(ficha.linhas.map((l) => l.id), ['disponivel']);
  assert.equal(ficha.linhas[0].valor, '12');
  assert.equal(ficha.precoAVista, null);
  assert.equal(ficha.unidade, '');
});

test('disponivel: sem estoque, estoque baixo e casas decimais da unidade', () => {
  const zerado = fichaDoProduto({ nome: 'X', quantidade: 0, unidadeMedidaSigla: 'UN' });
  assert.deepEqual([zerado.linhas[0].valor, zerado.linhas[0].nivel], ['sem estoque', 'zerado']);

  // Tudo reservado: o disponivel e' zero mesmo com saldo no cadastro.
  const todoReservado = fichaDoProduto({ nome: 'X', quantidade: 5, quantidadeReservada: 5, unidadeMedidaSigla: 'UN' });
  assert.deepEqual([todoReservado.linhas[0].valor, todoReservado.linhas[0].nivel], ['sem estoque', 'zerado']);
  assert.equal(todoReservado.linhas[1].valor, '5 UN');

  const baixo = fichaDoProduto({ nome: 'X', quantidade: 3, unidadeMedidaSigla: 'UN' });
  assert.deepEqual([baixo.linhas[0].valor, baixo.linhas[0].nivel], ['3 UN', 'baixo']);

  const quilo = fichaDoProduto({ nome: 'MILHO', quantidade: 1250.5, unidadeMedidaSigla: 'KG', unidadeMedidaCasasDecimais: 3 });
  assert.equal(quilo.linhas[0].valor.replace(/\s/g, ' '), '1.250,500 KG');
});

test('item sem o campo de quantidade (materia-prima da composicao) nao aparece como zerado', () => {
  const ficha = fichaDoProduto({ nome: 'ACUCAR CRISTAL', codigo: 'MP-3' });
  assert.equal(ficha.linhas.some((l) => l.id === 'disponivel'), false);
  assert.equal(ficha.preco, null);
});

test('preco a vista so aparece quando existe e e diferente do preco de venda', () => {
  assert.equal(fichaDoProduto({ nome: 'X', precoVenda: 10, precoAVista: 10 }).precoAVista, null);
  assert.equal(fichaDoProduto({ nome: 'X', precoVenda: 10, precoAVista: 0 }).precoAVista, null);
  assert.equal(fichaDoProduto({ nome: 'X', precoVenda: 10, precoAVista: 9.5 }).precoAVista, 9.5);
});

test('local vem do campo direto ou da configuracao de estoque; codigo cai para o codigo interno', () => {
  assert.equal(fichaDoProduto({ nome: 'X', estoqueConfig: { localizacao: 'PRATELEIRA 3' } }).linhas[0].valor, 'PRATELEIRA 3');
  assert.equal(fichaDoProduto({ nome: 'X', skuSistema: 'SKU-9' }).subtitulo, 'Cód. SKU-9');
  assert.equal(fichaDoProduto({}).nome, '');
});

test('atacado: faixa do cadastro vira linha da ficha logo abaixo do estoque (23/11/2026)', () => {
  const ficha = fichaDoProduto({
    nome: 'COPO DESC TRANSP 300 ML PS C/100', codigo: '84', precoVenda: 11.9, quantidade: 259,
    unidadeMedidaSigla: 'PCT', referencia: '1447',
    atacado: { ativo: true, quantidadeMinima: 20, faixas: [{ quantidadeInicial: 20, ilimitado: true, preco: 9.26 }] },
  });
  assert.deepEqual(ficha.linhas.map((l) => [l.id, l.rotulo, l.valor]), [
    ['disponivel', 'Disponível', '259 PCT'],
    ['atacado', 'Atacado a partir de 20 PCT', 'R$ 9,26'],
    ['unidade', 'Unidade de venda', 'PCT'],
    ['referencia', 'Referência', '1447'],
  ]);
});

test('atacado: varias faixas em ordem, faixa com fim e atacado desligado ou sem preco nao aparecem', () => {
  const faixas = atacadoParaBusca({
    unidadeMedidaSigla: 'UN',
    atacado: { ativo: true, faixas: [
      { quantidadeInicial: 50, ilimitado: true, preco: 3.1 },
      { quantidadeInicial: 10, quantidadeFinal: 49, preco: 3.5 },
      { quantidadeInicial: 100, ilimitado: true, preco: 0 },
    ] },
  });
  assert.deepEqual(faixas, [
    { preco: 3.5, quantidade: 'de 10 a 49 UN' },
    { preco: 3.1, quantidade: 'a partir de 50 UN' },
  ]);
  assert.deepEqual(atacadoParaBusca({ atacado: { ativo: false, faixas: [{ quantidadeInicial: 10, ilimitado: true, preco: 2 }] } }), []);
  assert.deepEqual(atacadoParaBusca({}), []);
  assert.deepEqual(fichaDoProduto({ nome: 'X', quantidade: 5, atacado: { ativo: true, faixas: [] } }).linhas.map((l) => l.id), ['disponivel']);
});
