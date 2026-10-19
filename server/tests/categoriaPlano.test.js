const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

/*
 * Categoria nova pela tela de lancamento (19/10/2026): acrescenta ao plano de
 * contas de todas as filiais do grupo; nunca apaga nem renomeia.
 */

const carregar = (db) => carregarComBancoFalso(db, 'services/configuracoesGerais')[3];
const USUARIO = { uid: 'u1', tenantId: 'f1', permissoes: ['financeiro.receber'] };

test('com filiais: a categoria entra em todas, cada uma com a sua lista', async () => {
  const fake = criarBancoFalso({
    'configuracoes/f1': { tenantId: 'f1', grupoId: 'g1', planoContasReceitas: ['Serviços', 'Outras Receitas'] },
    'configuracoes/f2': { tenantId: 'f2', grupoId: 'g1', planoContasReceitas: 'Serviços\nAluguel recebido' },
    'grupos/g1': { nome: 'GRUPO', matrizTenantId: 'f1', filiais: [{ tenantId: 'f1', codigo: '10', nome: 'MATRIZ' }, { tenantId: 'f2', codigo: '20', nome: 'LOJA 2' }] },
  });
  const r = await carregar(fake.db).adicionarCategoria({ user: USUARIO, tenantId: 'f1', corpo: { tipo: 'receita', nome: '  Reembolso   de fornecedor ' } });
  assert.equal(r.nome, 'Reembolso de fornecedor');
  assert.equal(r.jaExistia, false);
  assert.deepEqual(r.lista, ['Serviços', 'Outras Receitas', 'Reembolso de fornecedor']);
  assert.deepEqual(fake.ler('configuracoes/f2').planoContasReceitas, ['Serviços', 'Aluguel recebido', 'Reembolso de fornecedor']);
});

test('sem plano salvo parte das categorias que a tela mostra; repetida (maiuscula/minuscula) nao muda nada', async () => {
  const fake = criarBancoFalso({ 'configuracoes/f1': { tenantId: 'f1' } });
  const s = carregar(fake.db);
  const r = await s.adicionarCategoria({ user: USUARIO, tenantId: 'f1', corpo: { tipo: 'despesa', nome: 'Combustível' } });
  assert.deepEqual(r.lista, ['Aluguel', 'Água/Luz/Internet', 'Salários', 'Fornecedores de Peças', 'Outros', 'Combustível']);
  assert.deepEqual(fake.ler('configuracoes/f1').planoContasDespesas, r.lista);
  const de_novo = await s.adicionarCategoria({ user: USUARIO, tenantId: 'f1', corpo: { tipo: 'despesa', nome: 'COMBUSTÍVEL' } });
  assert.equal(de_novo.jaExistia, true);
  assert.equal(de_novo.lista.length, 6);
  await assert.rejects(() => s.adicionarCategoria({ user: USUARIO, tenantId: 'f1', corpo: { tipo: 'receita', nome: '   ' } }), (e) => e.status === 400);
  await assert.rejects(() => s.adicionarCategoria({ user: USUARIO, tenantId: 'f1', corpo: { tipo: 'outra', nome: 'X' } }), (e) => e.status === 400);
});
