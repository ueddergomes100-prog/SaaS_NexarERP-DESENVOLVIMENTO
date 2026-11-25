const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

/*
 * Item 15 da Embala Minas, fase Estoque e cadastros (25/11/2026): cada acao
 * que ja' passa pelo servidor pede a SUA permissao -- inativar/excluir
 * cadastro, fechar/cancelar balanco, receber/recusar/cancelar transferencia,
 * emitir de novo a nota dela, finalizar/reabrir/cancelar OS. Quem tem a
 * permissao da tela e ainda nao teve as permissoes salvas de novo (sem o
 * marcador `pacote.estoque-1`) ja' tem as novas -- ninguem perde acesso. O
 * nivel gerente traz a transferencia sem nota e o Modo Avancado do produto.
 * Firestore falso em memoria: nenhum banco e' tocado.
 */
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');
const pe = require('../services/permissoesEstoque');
const { conferirPermissao, CADASTROS } = require('../services/cadastroIntegridade');

const MARCADORES = ['pacote.financeiro-1', 'pacote.financeiro-2', 'pacote.vendas-1', 'pacote.estoque-1'];
const salvo = (uid, permissoes, extra = {}) => ({ uid, role: 'Funcionario', permissoes: [...permissoes, ...MARCADORES], ...extra });

// ---------------------------------------------------------------------------
// Regras puras
// ---------------------------------------------------------------------------

test('efetivas: quem tem a tela e nunca foi salvo ja tem as novas; salvo de novo, vale o marcado', () => {
  const antigo = { uid: 'f1', permissoes: ['cadastros.estoque_alterar', 'cadastros.clientes', 'mecanica.os', 'estoque.balanco_gerenciar', 'filiais.utilizar'] };
  for (const p of ['estoque.produto_inativar', 'estoque.produto_excluir', 'cadastros.clientes_inativar', 'mecanica.os_cancelar',
    'estoque.balanco_fechar', 'filiais.transferencia_receber', 'filiais.transferencia_cancelar']) {
    assert.equal(pe.podeNoEstoque(antigo, p), true, p);
  }
  assert.equal(pe.podeNoEstoque(antigo, 'filiais.transferir_sem_nota'), false, 'sem nota nao vem com a tela');
  const gravado = salvo('f2', ['cadastros.estoque_alterar', 'estoque.produto_inativar']);
  assert.equal(pe.podeNoEstoque(gravado, 'estoque.produto_inativar'), true);
  assert.equal(pe.podeNoEstoque(gravado, 'estoque.produto_excluir'), false, 'dono desmarcou ao salvar');
  assert.equal(pe.podeNoEstoque({ uid: 'a', permissoes: [], isTenantManager: true }, 'estoque.produto_excluir'), true, 'administrador segue liberado');
  assert.equal(pe.podeNoEstoque({ uid: 'x' }, 'mecanica.os_cancelar'), false, 'sem lista nao quebra');
});

test('nivel gerente: transferencia sem nota marcada ate as permissoes serem salvas de novo', () => {
  assert.equal(pe.podeNoEstoque({ uid: 'g', permissoes: ['filiais.utilizar'], nivelAcesso: 'gerente' }, 'filiais.transferir_sem_nota'), true);
  assert.equal(pe.podeNoEstoque({ uid: 'g', permissoes: ['filiais.utilizar'], nivelAcesso: 'supervisor' }, 'filiais.transferir_sem_nota'), false);
  assert.equal(pe.podeNoEstoque(salvo('g', ['filiais.utilizar'], { nivelAcesso: 'gerente' }), 'filiais.transferir_sem_nota'), false, 'salvo sem: o nivel nao libera sozinho');
});

test('mensagem em portugues cita o rotulo do cadastro do funcionario e diz o que fazer', () => {
  const msg = pe.mensagemSemPermissao(['estoque.produto_excluir']);
  assert.match(msg, /^Você não tem permissão para excluir produtos\./);
  assert.match(msg, /"Estoque: Excluir produto sem movimentação"/);
  assert.match(msg, /Sem ela, inative o produto\./);
  assert.match(pe.mensagemSemPermissao(['filiais.transferencia_receber']), /"Filiais: Receber transferência"/);
});

test('inativar e excluir cadastro: a permissao propria de cada colecao; bancos seguem com a da tela', () => {
  const conferir = (user, colecao, operacao) => {
    try { conferirPermissao(user, colecao, CADASTROS[colecao], operacao); return null; } catch (e) { return e; }
  };
  assert.equal(conferir({ uid: 'c', permissoes: ['cadastros.clientes'] }, 'clientes', 'situacao'), null, 'tela antiga: ja tem');
  const semInativar = conferir(salvo('c', ['cadastros.clientes']), 'clientes', 'excluir');
  assert.equal(semInativar.status, 403);
  assert.match(semInativar.message, /"Cadastros: Clientes — inativar e excluir"/);
  const produto = conferir(salvo('p', ['cadastros.estoque_alterar', 'estoque.produto_inativar']), 'estoque', 'excluir');
  assert.match(produto.message, /"Estoque: Excluir produto sem movimentação"/);
  assert.equal(conferir(salvo('p', ['cadastros.estoque_alterar', 'estoque.produto_inativar']), 'estoque', 'situacao'), null);
  // Veiculo: antes bastava Clientes ou OS; agora "Veiculos — inativar" (vem com Cadastros: Veiculos).
  assert.equal(conferir({ uid: 'v', permissoes: ['cadastros.veiculos'] }, 'veiculos', 'situacao'), null);
  assert.equal(conferir(salvo('v', ['cadastros.clientes']), 'veiculos', 'situacao').status, 403);
  // Bancos: fora do levantamento, a permissao da tela.
  assert.equal(conferir({ uid: 'b', permissoes: ['cadastros.bancos'] }, 'bancos', 'situacao'), null);
  assert.equal(conferir({ uid: 'b', permissoes: [] }, 'bancos', 'situacao').status, 403);
});

// ---------------------------------------------------------------------------
// Rotas: o 403 sai antes de tocar no banco
// ---------------------------------------------------------------------------

/** Sobe a rota com o banco falso e o usuario vindo do cabecalho (auth falso). */
const comRota = async (fake, servicos, arquivo, base, corpoDoTeste) => {
  carregarComBancoFalso(fake.db, ...servicos);
  const raiz = path.join(__dirname, '..');
  const substituir = (modulo, exportado) => {
    const caminho = require.resolve(path.join(raiz, modulo));
    require.cache[caminho] = { id: caminho, filename: caminho, loaded: true, exports: exportado };
  };
  substituir('middleware/auth', {
    authenticate: (req, res, next) => { req.user = JSON.parse(req.headers['x-usuario-teste'] || '{}'); next(); },
  });
  substituir('services/auditoria', { registrarLog: () => {}, registrarLogNaTransacao: () => {} });
  const rotaCaminho = require.resolve(path.join(raiz, arquivo));
  delete require.cache[rotaCaminho];
  const app = express();
  app.use(express.json());
  app.use(base, require(rotaCaminho));
  const servidor = app.listen(0);
  try {
    const { port } = servidor.address();
    const chamar = async (rota, usuario, corpo = {}) => {
      const resposta = await fetch(`http://127.0.0.1:${port}${base}${rota}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-usuario-teste': JSON.stringify({ tenantId: 'loja', ...usuario }) },
        body: JSON.stringify(corpo),
      });
      return { status: resposta.status, corpo: await resposta.json() };
    };
    await corpoDoTeste(chamar);
  } finally {
    servidor.close();
  }
};

test('OS: finalizar, reabrir e cancelar pedem a permissao propria', async () => {
  const fake = criarBancoFalso({}, { consultas: true });
  await comRota(fake, ['services/vendaFechamento', 'services/osServidor'], 'routes/os.routes', '/api/os', async (chamar) => {
    const r = await chamar('/cancelar', salvo('t1', ['mecanica.os', 'mecanica.os_finalizar']), { osId: 'os1' });
    assert.equal(r.status, 403);
    assert.match(r.corpo.error, /"Serviços: Cancelar OS"/);
    const f = await chamar('/reabrir', salvo('t1', ['mecanica.os']), { osId: 'os1' });
    assert.equal(f.status, 403);
    assert.match(f.corpo.error, /"Serviços: Reabrir OS finalizada"/);
  });
});

test('transferencia: receber, recusar/cancelar e emitir a nota de novo pedem a permissao propria', async () => {
  const fake = criarBancoFalso({}, { consultas: true });
  await comRota(fake, ['services/transferencias'], 'routes/transferencias.routes', '/api/transferencias', async (chamar) => {
    const receber = await chamar('/t1/receber', salvo('f1', ['filiais.utilizar']), {});
    assert.equal(receber.status, 403);
    assert.match(receber.corpo.error, /"Filiais: Receber transferência"/);
    const cancelar = await chamar('/t1/cancelar', salvo('f1', ['filiais.utilizar', 'filiais.transferencia_receber']), { motivo: 'errado' });
    assert.equal(cancelar.status, 403);
    assert.match(cancelar.corpo.error, /"Filiais: Recusar e cancelar transferência \(tudo volta\)"/);
    const nota = await chamar('/t1/nota', salvo('f1', ['filiais.utilizar']), {});
    assert.equal(nota.status, 403);
    assert.match(nota.corpo.error, /"Fiscal: Emitir Nota Fiscal"/);
  });
});

test('balanco: fechar e cancelar pedem a permissao propria (quem gerencia ja tem marcada)', async () => {
  const fake = criarBancoFalso({}, { consultas: true });
  await comRota(fake, ['services/balanco'], 'routes/balanco.routes', '/api/balanco', async (chamar) => {
    const fechar = await chamar('/b1/fechar', salvo('e1', ['estoque.balanco_gerenciar', 'estoque.balanco_cancelar']), {});
    assert.equal(fechar.status, 403);
    assert.match(fechar.corpo.error, /"Estoque: Balanço — fechar e aplicar as diferenças"/);
    const cancelar = await chamar('/b1/cancelar', salvo('e1', ['estoque.balanco_gerenciar', 'estoque.balanco_fechar']), { motivo: 'erro' });
    assert.equal(cancelar.status, 403);
    assert.match(cancelar.corpo.error, /"Estoque: Balanço — cancelar"/);
  });
});
