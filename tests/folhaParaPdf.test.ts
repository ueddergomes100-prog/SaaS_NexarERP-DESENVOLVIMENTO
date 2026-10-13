import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nomeDeArquivoPdf, paginasNecessarias } from '../src/pages/Vendedor/folhaParaPdf';

test('nome do PDF tira acento e simbolo e junta com hifen', () => {
  assert.equal(nomeDeArquivoPdf('OS', '02', 'João da Conceição & Filhos'), 'OS-02-Joao-da-Conceicao-Filhos.pdf');
  assert.equal(nomeDeArquivoPdf('Pre-venda', 81, 'MERCEARIA SÃO JOSÉ LTDA.'), 'Pre-venda-81-MERCEARIA-SAO-JOSE-LTDA.pdf');
});

test('nome do PDF ignora partes vazias e nunca sai sem nome', () => {
  assert.equal(nomeDeArquivoPdf('Pedido', undefined, null, '  ', 12), 'Pedido-12.pdf');
  assert.equal(nomeDeArquivoPdf(), 'documento.pdf');
  assert.equal(nomeDeArquivoPdf('***'), 'documento.pdf');
});

test('nome do PDF fica limitado a 80 caracteres antes do .pdf', () => {
  const nome = nomeDeArquivoPdf('OS', 1, 'X'.repeat(200));
  assert.equal(nome.length, 84);
  assert.ok(nome.endsWith('.pdf'));
});

test('folha A4 exata da tela cabe em uma pagina', () => {
  // 794 x 1123 px e' o A4 a 96 dpi; a captura sai em escala 2.
  assert.equal(paginasNecessarias(1588, 2246), 1);
  assert.equal(paginasNecessarias(1738, 2412), 1);
});

test('folha mais alta que um A4 vira mais paginas', () => {
  assert.equal(paginasNecessarias(1588, 2246 * 2), 2);
  assert.equal(paginasNecessarias(1588, 2246 * 2.5), 3);
});

test('medida invalida conta como uma pagina', () => {
  assert.equal(paginasNecessarias(0, 500), 1);
  assert.equal(paginasNecessarias(500, 0), 1);
  assert.equal(paginasNecessarias(Number.NaN, 500), 1);
});
