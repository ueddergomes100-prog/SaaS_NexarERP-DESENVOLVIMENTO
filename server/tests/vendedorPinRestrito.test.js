const test = require('node:test');
const assert = require('node:assert/strict');

/*
 * 21/10/2026: quem tem "Cadastros: Vendedores — incluir e alterar" (sem ser o dono)
 * define a senha so' de vendedor de balcao comum -- nunca de quem libera desconto,
 * usa o app ou e' login do sistema.
 */
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

const carregar = (db) => carregarComBancoFalso(db, 'services/vendedorPin').slice(-1)[0];

const BASE = {
  'usuarios/comum': { tenantId: 'loja', tipoRegistro: 'vendedor', role: 'Funcionario', codigoVendedor: '12', permissoes: [] },
  'usuarios/supervisor': { tenantId: 'loja', tipoRegistro: 'vendedor', role: 'Funcionario', codigoVendedor: '13', permissoes: ['vendas.liberar_desconto'] },
  'usuarios/externo': { tenantId: 'loja', tipoRegistro: 'vendedor', role: 'Funcionario', codigoVendedor: '14', permissoes: [], acessoAppMobile: true },
  'usuarios/login': { tenantId: 'loja', role: 'Funcionario', codigoVendedor: '15', permissoes: [] },
  'usuarios/outra': { tenantId: 'outra', tipoRegistro: 'vendedor', role: 'Funcionario', codigoVendedor: '16', permissoes: [] },
};

test('restrito: define a senha do vendedor comum', async () => {
  const fake = criarBancoFalso(BASE);
  const s = carregar(fake.db);
  const r = await s.definirPin({ tenantId: 'loja', usuarioId: 'comum', pin: '4321', autorId: 'gerente', restrito: true });
  assert.equal(r.codigo, '12');
  assert.ok(fake.ler('usuarios_pin/comum').pinHash, 'senha gravada (so o hash)');
});

test('restrito: recusa quem libera desconto, usa o app ou e login; outra empresa sempre recusa', async () => {
  const fake = criarBancoFalso(BASE);
  const s = carregar(fake.db);
  for (const id of ['supervisor', 'externo', 'login']) {
    await assert.rejects(
      s.definirPin({ tenantId: 'loja', usuarioId: id, pin: '4321', autorId: 'gerente', restrito: true }),
      (e) => e.status === 403 && /só o dono ou o administrador/.test(e.message),
      id,
    );
    assert.equal(fake.ler(`usuarios_pin/${id}`), undefined, `${id}: nada gravado`);
  }
  await assert.rejects(s.definirPin({ tenantId: 'loja', usuarioId: 'outra', pin: '4321', restrito: true }), (e) => e.status === 403);
});

test('dono/administrador (sem restricao) continua definindo a senha de qualquer vendedor da empresa', async () => {
  const fake = criarBancoFalso(BASE);
  const s = carregar(fake.db);
  await s.definirPin({ tenantId: 'loja', usuarioId: 'supervisor', pin: '4321', autorId: 'dono' });
  assert.ok(fake.ler('usuarios_pin/supervisor').pinHash);
});
