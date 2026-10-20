/*
 * Grade de produtos (19/10/2026): inativar, reativar e excluir o principal
 * leva as variacoes junto; variacao presa segura o principal. Ver
 * services/cadastroIntegridade.js e domain/gradeProdutosDomain.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

const T = 'loja';
const dono = { uid: 'u1', email: 'dono@loja.com', tenantId: T, isTenantManager: true, permissoes: [] };

const pai = (extra = {}) => ({ tenantId: T, nome: 'CAMISETA', codigo: '123', temGrade: true, gradeNomes: ['TAMANHO'], quantidade: 0, ativo: true, statusAtivo: true, ...extra });
const filho = (opcao, extra = {}) => ({
  tenantId: T, nome: `CAMISETA ${opcao}`, codigo: `123.0${opcao === 'P' ? 1 : 2}`, ehVariacao: true, produtoPaiChave: 'pai', variacao: [opcao], variacaoRotulo: opcao,
  quantidade: 0, ativo: true, statusAtivo: true, ...extra,
});

const carregar = (docs) => {
  const fake = criarBancoFalso(docs, { consultas: true });
  const [servico] = carregarComBancoFalso(fake.db, 'services/cadastroIntegridade').slice(3);
  return { fake, servico };
};

test('inativar o principal inativa as variacoes e zera o saldo de cada uma, com ajuste registrado', async () => {
  const { fake, servico } = carregar({
    'estoque/pai': pai(),
    'estoque/f1': filho('P', { quantidade: 4 }),
    'estoque/f2': filho('M'),
    'estoque/outro': { tenantId: T, nome: 'OUTRO', quantidade: 2, ativo: true },
  });
  const r = await servico.alterarSituacao({ user: dono, colecao: 'estoque', id: 'pai', ativo: false });
  assert.deepEqual(r, { ativo: false, saldoZerado: 0, variacoes: 2 });
  assert.equal(fake.ler('estoque/pai').ativo, false);
  assert.equal(fake.ler('estoque/f1').ativo, false);
  assert.equal(fake.ler('estoque/f1').statusAtivo, false);
  assert.equal(fake.ler('estoque/f1').quantidade, 0);
  assert.equal(fake.ler('estoque/f2').ativo, false);
  assert.equal(fake.ler('estoque/outro').ativo, true);
  const ajustes = fake.listar('ajustes_estoque/');
  assert.equal(ajustes.length, 1);
  assert.equal(ajustes[0].produtoId, 'f1');
  assert.equal(ajustes[0].quantidadeAntes, 4);
  assert.match(ajustes[0].observacao, /junto com o produto principal/);
});

test('variacao com reserva segura o principal inteiro: nada muda', async () => {
  const { fake, servico } = carregar({
    'estoque/pai': pai(),
    'estoque/f1': filho('P', { quantidade: 1, quantidadeReservada: 1 }),
    'estoque/f2': filho('M'),
  });
  await assert.rejects(
    servico.alterarSituacao({ user: dono, colecao: 'estoque', id: 'pai', ativo: false }),
    (erro) => erro.status === 409 && /variação P tem 1 reservado/.test(erro.message),
  );
  assert.equal(fake.ler('estoque/pai').ativo, true);
  assert.equal(fake.ler('estoque/f2').ativo, true);
});

test('reativar o principal reativa as variacoes; variacao sozinha nao reativa com o principal inativo', async () => {
  const { fake, servico } = carregar({
    'estoque/pai': pai({ ativo: false, statusAtivo: false }),
    'estoque/f1': filho('P', { ativo: false, statusAtivo: false }),
    'estoque/f2': filho('M', { ativo: false, statusAtivo: false }),
  });
  await assert.rejects(
    servico.alterarSituacao({ user: dono, colecao: 'estoque', id: 'f1', ativo: true }),
    (erro) => erro.status === 409 && /Reative o produto principal/.test(erro.message),
  );
  const r = await servico.alterarSituacao({ user: dono, colecao: 'estoque', id: 'pai', ativo: true });
  assert.deepEqual(r, { ativo: true, saldoZerado: 0, variacoes: 2 });
  assert.equal(fake.ler('estoque/pai').statusAtivo, true);
  assert.equal(fake.ler('estoque/f1').statusAtivo, true);
  assert.equal(fake.ler('estoque/f2').statusAtivo, true);
});

test('excluir o principal sem movimentacao leva as variacoes; variacao com saldo bloqueia', async () => {
  const limpo = carregar({ 'estoque/pai': pai(), 'estoque/f1': filho('P'), 'estoque/f2': filho('M') });
  const r = await limpo.servico.excluirCadastro({ user: dono, colecao: 'estoque', id: 'pai' });
  assert.deepEqual(r, { excluido: true, variacoes: 2 });
  assert.equal(limpo.fake.ler('estoque/pai'), undefined);
  assert.equal(limpo.fake.ler('estoque/f1'), undefined);
  assert.equal(limpo.fake.ler('estoque/f2'), undefined);

  const comSaldo = carregar({ 'estoque/pai': pai(), 'estoque/f1': filho('P', { quantidade: 3 }) });
  await assert.rejects(
    comSaldo.servico.excluirCadastro({ user: dono, colecao: 'estoque', id: 'pai' }),
    (erro) => erro.status === 409 && /variação P já tem movimentação \(saldo de 3 em estoque\)/.test(erro.message),
  );
  assert.equal(comSaldo.fake.ler('estoque/pai').nome, 'CAMISETA');
});

test('grade em uso por produto ativo nao inativa; sem uso, inativa', async () => {
  const { fake, servico } = carregar({
    'grades/g1': { tenantId: T, nome: 'TAMANHO', opcoes: ['P', 'M'], ativo: true },
    'grades/g2': { tenantId: T, nome: 'COR', opcoes: ['AZUL'], ativo: true },
    'estoque/pai': pai(),
  });
  await assert.rejects(
    servico.alterarSituacao({ user: dono, colecao: 'grades', id: 'g1', ativo: false }),
    (erro) => erro.status === 409 && /grade "TAMANHO": está em uso por 1 produto\(s\) ativo\(s\), como "CAMISETA"/.test(erro.message),
  );
  const r = await servico.alterarSituacao({ user: dono, colecao: 'grades', id: 'g2', ativo: false });
  assert.equal(r.ativo, false);
  assert.equal(fake.ler('grades/g2').ativo, false);
  // Grade nao se exclui, so' inativa (como unidade de medida).
  await assert.rejects(
    servico.excluirCadastro({ user: dono, colecao: 'grades', id: 'g2' }),
    (erro) => erro.status === 400 && /apenas inativada/.test(erro.message),
  );
});
