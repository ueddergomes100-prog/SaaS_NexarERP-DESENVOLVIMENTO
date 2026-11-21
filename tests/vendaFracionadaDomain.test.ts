import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fracionadoProprioDoProduto,
  mensagemQuantidadeInteira,
  mudancasDoProdutoPelaUnidade,
  unidadeMudouParaOsProdutos,
} from '../src/utils/vendaFracionadaDomain';

test('marca propria do produto: campo do produto, senao o da configuracao de estoque, senao a copia da unidade', () => {
  assert.equal(fracionadoProprioDoProduto({ produtoFracionado: true }), true);
  assert.equal(fracionadoProprioDoProduto({ produtoFracionado: false, estoqueConfig: { fracionado: true } }), false, 'o campo do produto manda');
  assert.equal(fracionadoProprioDoProduto({ estoqueConfig: { fracionado: true } }), true, 'importado: so a configuracao de estoque');
  assert.equal(fracionadoProprioDoProduto({ estoqueConfig: { fracionado: false }, unidadeMedidaFracionado: true }), false);
  assert.equal(fracionadoProprioDoProduto({ unidadeMedidaFracionado: true }), true, 'antigo sem as marcas: vale a copia');
  assert.equal(fracionadoProprioDoProduto({}), false);
});

test('unidade passa a fracionada: produto marcado como fracionado acompanha, com as casas da unidade', () => {
  const m3 = { permiteFracionado: true, casasDecimais: 3 };
  assert.deepEqual(
    mudancasDoProdutoPelaUnidade({ unidadeMedidaFracionado: false, unidadeMedidaCasasDecimais: 0, estoqueConfig: { fracionado: true } }, m3),
    { unidadeMedidaFracionado: true, unidadeMedidaCasasDecimais: 3 },
  );
  // Produto que nao e' vendido fracionado continua inteiro, mas a casa decimal acompanha.
  assert.deepEqual(
    mudancasDoProdutoPelaUnidade({ unidadeMedidaFracionado: false, unidadeMedidaCasasDecimais: 0, produtoFracionado: false }, m3),
    { unidadeMedidaCasasDecimais: 3 },
  );
  assert.deepEqual(mudancasDoProdutoPelaUnidade({ unidadeMedidaFracionado: true, unidadeMedidaCasasDecimais: 3, produtoFracionado: true }, m3), {});
});

test('unidade deixa de ser fracionada: todo produto nela passa a inteiro', () => {
  const un = { permiteFracionado: false, casasDecimais: 0 };
  assert.deepEqual(
    mudancasDoProdutoPelaUnidade({ unidadeMedidaFracionado: true, unidadeMedidaCasasDecimais: 2, produtoFracionado: true }, un),
    { unidadeMedidaFracionado: false, unidadeMedidaCasasDecimais: 0 },
  );
});

test('so interessa aos produtos mudar "Fracionada" ou as casas decimais', () => {
  assert.equal(unidadeMudouParaOsProdutos({ permiteFracionado: false, casasDecimais: 3 }, { permiteFracionado: true, casasDecimais: 3 }), true);
  assert.equal(unidadeMudouParaOsProdutos({ permiteFracionado: true, casasDecimais: 2 }, { permiteFracionado: true, casasDecimais: 3 }), true);
  assert.equal(unidadeMudouParaOsProdutos({ permiteFracionado: true, casasDecimais: 3 }, { permiteFracionado: true, casasDecimais: '3' }), false);
  assert.equal(unidadeMudouParaOsProdutos(null, { permiteFracionado: true, casasDecimais: 3 }), true);
});

test('mensagem da venda diz o que fazer, em portugues, com o nome do produto e a unidade', () => {
  const texto = mensagemQuantidadeInteira('AREIA METRO', 'M3');
  assert.match(texto, /^AREIA METRO não aceita quantidade quebrada na unidade M3\./);
  assert.match(texto, /Unidades de Medida/);
  assert.match(texto, /Produto fracionado/);
  assert.match(mensagemQuantidadeInteira('', ''), /^Este produto .* unidade UN\./);
});
