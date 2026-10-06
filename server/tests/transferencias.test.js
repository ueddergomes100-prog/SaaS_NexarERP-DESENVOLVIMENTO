const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

const HOJE = '2026-10-06';
const carregar = (db) => carregarComBancoFalso(db, 'services/transferencias')[3];

const grupo = {
  nome: 'SHOPPING RURAL', donoUid: 'dono', matrizTenantId: 'centro',
  filiais: [
    { tenantId: 'centro', codigo: '10', nome: 'CENTRO', cnpj: '11222333000181', uf: 'ES', cidade: 'VITORIA', tipo: 'cnpj_proprio', matriz: true, ativa: true },
    { tenantId: 'baixada', codigo: '20', nome: 'BAIXADA', cnpj: '11222333000262', uf: 'ES', cidade: 'SERRA', tipo: 'cnpj_proprio', ativa: true },
  ],
};

const base = (extra = {}) => ({
  'grupos/g1': grupo,
  'usuarios/dono': { tenantId: 'centro', role: 'Master', nome: 'DONO' },
  'usuarios/vend': { tenantId: 'baixada', role: 'Funcionario', permissoes: ['filiais.utilizar'], nivelAcesso: 'funcionario', nome: 'VENDEDOR' },
  'configuracoes/centro': { grupoId: 'g1', transferenciaSemNota: true },
  'configuracoes/baixada': { grupoId: 'g1', transferenciaSemNota: true },
  'estoque/p1': { tenantId: 'centro', nome: 'RAÇÃO 15KG', codigo: '1001', grupoChave: 'p1', filialOrigem: 'centro', quantidade: 20, precoCusto: 120, unidadeMedidaSigla: 'SC' },
  'estoque/p1_baixada': { tenantId: 'baixada', nome: 'RAÇÃO 15KG', codigo: '1001', grupoChave: 'p1', filialOrigem: 'centro', quantidade: 2, precoCusto: 100, unidadeMedidaSigla: 'SC' },
  'estoque/p2': { tenantId: 'centro', nome: 'ÓLEO 500ML', codigo: '2002', grupoChave: 'p2', filialOrigem: 'centro', quantidade: 5, precoCusto: 18, controlarLote: true, unidadeMedidaSigla: 'UN' },
  'estoque/p2_baixada': { tenantId: 'baixada', nome: 'ÓLEO 500ML', codigo: '2002', grupoChave: 'p2', filialOrigem: 'centro', quantidade: 0, precoCusto: 0, controlarLote: true },
  'estoque_lotes/l1': { tenantId: 'centro', produtoId: 'p2', lote: 'A1', validade: '2027-01-01', quantidade: 5 },
  ...extra,
});

const DONO_NO_CENTRO = { uid: 'dono', tenantId: 'centro', email: 'dono@teste' };
const DONO_NA_BAIXADA = { uid: 'dono', tenantId: 'baixada', email: 'dono@teste' };

test('envio sem nota: baixa na origem (com lote), numera e fica em transito', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  const r = await s.enviarTransferencia({ user: DONO_NO_CENTRO, corpo: { destino: 'baixada', itens: [{ produtoId: 'p1', quantidade: 8 }, { produtoId: 'p2', quantidade: 3 }], idDocumento: 'tr1' }, hoje: HOJE });
  assert.equal(r.numeroTransferencia, '0001');
  assert.equal(fake.ler('estoque/p1').quantidade, 12);
  assert.equal(fake.ler('estoque/p2').quantidade, 2);
  assert.equal(fake.ler('estoque_lotes/l1').quantidade, 2);
  const t = fake.ler('transferencias/tr1');
  assert.equal(t.status, 'em_transito');
  assert.deepEqual(t.tenantIds, ['centro', 'baixada']);
  assert.equal(t.itens[0].produtoIdDestino, 'p1_baixada');
  assert.deepEqual(t.itens[1].lotes.map((l) => [l.lote, l.quantidade]), [['A1', 3]]);
  assert.equal(fake.listar('ajustes_estoque/').filter((a) => a.motivo === 'transferencia_saida').length, 2);
  // Reenviar o mesmo envio (queda de internet) nao baixa de novo.
  const de_novo = await s.enviarTransferencia({ user: DONO_NO_CENTRO, corpo: { destino: 'baixada', itens: [{ produtoId: 'p1', quantidade: 8 }], idDocumento: 'tr1' }, hoje: HOJE });
  assert.equal(de_novo.jaEnviada, true);
  assert.equal(fake.ler('estoque/p1').quantidade, 12);
});

test('recebimento com falta: entra no destino com custo medio e lote, a falta volta para a origem', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  await s.enviarTransferencia({ user: DONO_NO_CENTRO, corpo: { destino: 'baixada', itens: [{ produtoId: 'p1', quantidade: 8 }, { produtoId: 'p2', quantidade: 3 }], idDocumento: 'tr1' }, hoje: HOJE });
  await assert.rejects(() => s.receberTransferencia({ user: DONO_NO_CENTRO, id: 'tr1', corpo: {} }), /Só a filial de destino recebe/);
  const r = await s.receberTransferencia({ user: DONO_NA_BAIXADA, id: 'tr1', corpo: { recebidas: { 1: 2 } } });
  assert.equal(r.divergente, true);
  assert.equal(fake.ler('estoque/p1_baixada').quantidade, 10);
  assert.equal(fake.ler('estoque/p1_baixada').precoCusto, 116);
  assert.equal(fake.ler('estoque/p2_baixada').quantidade, 2);
  const loteNovo = fake.listar('estoque_lotes/').find((l) => l.tenantId === 'baixada');
  assert.deepEqual([loteNovo.lote, loteNovo.quantidade, loteNovo.produtoId], ['A1', 2, 'p2_baixada']);
  assert.equal(fake.ler('estoque/p2').quantidade, 3, 'a unidade que faltou voltou para o centro');
  assert.equal(fake.ler('estoque_lotes/l1').quantidade, 3, 'e voltou para o mesmo lote');
  assert.equal(fake.ler('transferencias/tr1').status, 'recebida');
  await assert.rejects(() => s.receberTransferencia({ user: DONO_NA_BAIXADA, id: 'tr1', corpo: {} }), /já está recebida/);
});

test('recusa no destino e cancelamento na origem devolvem tudo; motivo obrigatorio', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  await s.enviarTransferencia({ user: DONO_NO_CENTRO, corpo: { destino: 'baixada', itens: [{ produtoId: 'p1', quantidade: 5 }], idDocumento: 'tr1' }, hoje: HOJE });
  await assert.rejects(() => s.desfazerTransferencia({ user: DONO_NA_BAIXADA, id: 'tr1', corpo: { motivo: 'x' }, acao: 'recusar' }), /motivo/);
  await assert.rejects(() => s.desfazerTransferencia({ user: DONO_NA_BAIXADA, id: 'tr1', corpo: { motivo: 'Não pedimos isso' }, acao: 'cancelar' }), /Só a filial que enviou/);
  await s.desfazerTransferencia({ user: DONO_NA_BAIXADA, id: 'tr1', corpo: { motivo: 'Não pedimos isso' }, acao: 'recusar' });
  assert.equal(fake.ler('estoque/p1').quantidade, 20);
  assert.equal(fake.ler('transferencias/tr1').status, 'recusada');
  assert.equal(fake.ler('estoque/p1_baixada').quantidade, 2, 'nada entrou no destino');
});

test('travas: sem nota desligada, funcionario sem nivel gerente, sem a permissao, destino invalido', async () => {
  const desligada = criarBancoFalso(base({ 'configuracoes/centro': { grupoId: 'g1' } }), { consultas: true });
  await assert.rejects(
    () => carregar(desligada.db).enviarTransferencia({ user: DONO_NO_CENTRO, corpo: { destino: 'baixada', itens: [{ produtoId: 'p1', quantidade: 1 }] }, hoje: HOJE }),
    /sem nota está desligada/,
  );
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  await assert.rejects(
    () => s.enviarTransferencia({ user: { uid: 'vend', tenantId: 'baixada' }, corpo: { destino: 'centro', itens: [{ produtoId: 'p1_baixada', quantidade: 1 }] }, hoje: HOJE }),
    /Só o dono ou um gerente/,
  );
  const semPermissao = criarBancoFalso(base({ 'usuarios/vend': { tenantId: 'baixada', role: 'Funcionario', permissoes: [] } }), { consultas: true });
  await assert.rejects(
    () => carregar(semPermissao.db).enviarTransferencia({ user: { uid: 'vend', tenantId: 'baixada' }, corpo: { destino: 'centro', itens: [{ produtoId: 'p1_baixada', quantidade: 1 }] }, hoje: HOJE }),
    /Utiliza outras filiais/,
  );
  await assert.rejects(() => s.enviarTransferencia({ user: DONO_NO_CENTRO, corpo: { destino: 'centro', itens: [{ produtoId: 'p1', quantidade: 1 }] }, hoje: HOJE }), /precisa ser outra/);
  await assert.rejects(() => s.enviarTransferencia({ user: DONO_NO_CENTRO, corpo: { destino: 'baixada', itens: [{ produtoId: 'p1', quantidade: 99 }] }, hoje: HOJE }), /Estoque insuficiente/);
});
