const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CADASTROS,
  temPermissao,
  estaAtivo,
  componentesDaReceita,
  mensagemBloqueioInativacao,
  mensagemBloqueioExclusao,
  listarNomes,
} = require('../services/cadastroIntegridade');

test('permissao: dono/admin sempre; funcionario so com a permissao do cadastro', () => {
  assert.equal(temPermissao({ isTenantManager: true, permissoes: [] }, ['cadastros.clientes']), true);
  assert.equal(temPermissao({ isPlatformAdmin: true }, ['x']), true);
  assert.equal(temPermissao({ permissoes: ['cadastros.clientes'] }, ['cadastros.clientes']), true);
  // quem so' vende escreve em clientes pelas rules, mas NAO inativa cliente
  assert.equal(temPermissao({ permissoes: ['vendas.pedidos'] }, ['cadastros.clientes']), false);
  assert.equal(temPermissao(null, ['cadastros.clientes']), false);
});

test('ativo segue o selo de status de cada tela', () => {
  assert.equal(estaAtivo('clientes', {}), true);
  assert.equal(estaAtivo('clientes', { ativo: false }), false);
  // Bancos e Bandeiras: campo ausente e' inativo
  assert.equal(estaAtivo('bancos', {}), false);
  assert.equal(estaAtivo('bancos', { ativo: true }), true);
  assert.equal(estaAtivo('bandeiras_cartao', {}), false);
  // Produto guarda tambem statusAtivo
  assert.equal(estaAtivo('estoque', { ativo: true, statusAtivo: false }), false);
  assert.equal(estaAtivo('estoque', {}), true);
});

test('receita: le formato novo e o antigo sem origem (materia-prima)', () => {
  assert.deepEqual(componentesDaReceita([
    { componenteId: 'a', origem: 'estoque' },
    { componenteId: 'b', origem: 'materia_prima' },
    { materiaPrimaId: 'c' },
    { quantidade: 1 },
  ]), [
    { id: 'a', origem: 'estoque' },
    { id: 'b', origem: 'materia_prima' },
    { id: 'c', origem: 'materia_prima' },
  ]);
  assert.deepEqual(componentesDaReceita(undefined), []);
});

test('mensagem de inativacao diz o que bloqueia e o que fazer, com genero certo', () => {
  const m = mensagemBloqueioInativacao(CADASTROS.materias_primas, 'AVEIA KG', ['é componente da receita de "GRANOLA"']);
  assert.match(m, /^Não é possível inativar a matéria-prima "AVEIA KG": é componente da receita de "GRANOLA"\./);
  assert.match(m, /Resolva essas pendências/);
  assert.match(mensagemBloqueioInativacao(CADASTROS.clientes, 'JOAO', ['x']), /^Não é possível inativar o cliente/);
});

test('mensagem de exclusao manda inativar, com pronome certo', () => {
  assert.match(mensagemBloqueioExclusao(CADASTROS.clientes, 'JOAO', ['vendas']), /porque ele já tem movimentação \(vendas\)/);
  assert.match(mensagemBloqueioExclusao(CADASTROS.materias_primas, 'AVEIA', ['notas de entrada']), /porque ela já tem.*inative a matéria-prima/);
});

test('so cliente, fornecedor, produto e materia-prima sao excluiveis', () => {
  const excluiveis = Object.entries(CADASTROS).filter(([, c]) => c.excluivel).map(([k]) => k).sort();
  assert.deepEqual(excluiveis, ['clientes', 'estoque', 'fornecedores', 'materias_primas']);
  // e so' produto e materia-prima tem saldo pra zerar
  const comSaldo = Object.entries(CADASTROS).filter(([, c]) => c.temSaldo).map(([k]) => k).sort();
  assert.deepEqual(comSaldo, ['estoque', 'materias_primas']);
});

test('lista de nomes resume quando passa do limite', () => {
  assert.equal(listarNomes(['A', 'B']), '"A", "B"');
  assert.equal(listarNomes(['A', 'B', 'C', 'D', 'E']), '"A", "B", "C" e mais 2');
});

test('todo cadastro tem plural pra mensagem de permissao', () => {
  for (const [colecao, cfg] of Object.entries(CADASTROS)) {
    assert.ok(cfg.plural, `${colecao} sem plural`);
  }
  assert.equal(CADASTROS.unidades_medida.plural, 'unidades de medida');
  assert.equal(CADASTROS.bandeiras_cartao.plural, 'bandeiras de cartão');
});
