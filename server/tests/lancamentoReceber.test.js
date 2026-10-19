const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

/*
 * Conta a receber lancada a mao (19/10/2026): de cliente ou fornecedor, em
 * aberto, gravada pelo servidor com quem lancou; editar e cancelar so' conta
 * avulsa em aberto.
 */

const carregar = (db) => carregarComBancoFalso(db, 'services/lancamentoReceber')[3];

const USUARIO = { uid: 'u1', tenantId: 'loja', email: 'fin@loja', permissoes: ['financeiro.receber'] };

const base = (extra = {}) => ({
  'usuarios/u1': { tenantId: 'loja', nome: 'MARIA DO FINANCEIRO' },
  'clientes/c1': { tenantId: 'loja', nome: 'JOSE DA SILVA', documento: '12345678901' },
  'clientes/inativo': { tenantId: 'loja', nome: 'ANTIGO', ativo: false },
  'clientes/deFora': { tenantId: 'outra', nome: 'OUTRA EMPRESA' },
  'fornecedores/f1': { tenantId: 'loja', nome: 'DISTRIBUIDORA ALFA', cnpj: '12345678000199' },
  ...extra,
});

const pedido = (extra = {}) => ({
  idLancamento: 'abc12345XYZ',
  devedor: { tipo: 'cliente', id: 'c1' },
  descricao: 'acerto de mercadoria',
  categoria: 'Outras Receitas',
  formaPrevista: 'Pix',
  documento: 'NF 123',
  observacao: '',
  parcelas: [{ vencimento: '2026-11-10', valorCentavos: 15000 }],
  ...extra,
});

test('lanca conta de cliente: em aberto, nome do cadastro, quem lancou, sem campo vazio', async () => {
  const fake = criarBancoFalso(base());
  const r = await carregar(fake.db).lancarContaAReceber({ user: USUARIO, tenantId: 'loja', corpo: pedido({ devedor: { tipo: 'cliente', id: 'c1' } }) });
  assert.equal(r.jaLancado, false);
  assert.deepEqual(r.ids, ['lanc_abc12345XYZ']);
  const t = fake.ler('transacoes/lanc_abc12345XYZ');
  assert.equal(t.tipo, 'entrada');
  assert.equal(t.status, 'Pendente');
  assert.equal(t.descricao, 'ACERTO DE MERCADORIA');
  assert.equal(t.categoria, 'OUTRAS RECEITAS');
  assert.equal(t.valorCentavos, 15000);
  assert.equal(t.valor, 150);
  assert.equal(t.clienteId, 'c1');
  assert.equal(t.clienteNome, 'JOSE DA SILVA');
  assert.equal(t.fornecedorId, undefined);
  assert.equal(t.dataVencimento, '2026-11-10');
  assert.equal(t.formaPagamento, 'Pix');
  assert.equal(t.naturezaFinanceira, 'bancario_digital');
  assert.equal(t.movimentaCaixaFisico, false);
  assert.equal(t.documento, 'NF 123');
  assert.equal(t.observacao, undefined, 'observacao vazia nao vira campo');
  assert.equal(t.origemLancamento, 'manual');
  assert.equal(t.lancadoPor, 'u1');
  assert.equal(t.lancadoPorNome, 'MARIA DO FINANCEIRO');
  assert.equal(t.tenantId, 'loja');
  assert.ok(!Object.values(t).includes(undefined));
});

test('conta de fornecedor em 3 parcelas; reenviar nao duplica', async () => {
  const fake = criarBancoFalso(base());
  const s = carregar(fake.db);
  const corpo = pedido({
    devedor: { tipo: 'fornecedor', id: 'f1' },
    formaPrevista: 'Boleto',
    parcelas: [
      { vencimento: '2026-11-10', valorCentavos: 10000 },
      { vencimento: '2026-12-10', valorCentavos: 10000 },
      { vencimento: '2027-01-10', valorCentavos: 10001 },
    ],
  });
  const r = await s.lancarContaAReceber({ user: USUARIO, tenantId: 'loja', corpo });
  assert.equal(r.quantidade, 3);
  assert.equal(r.totalCentavos, 30001);
  const p2 = fake.ler('transacoes/lanc_abc12345XYZ_p2');
  assert.equal(p2.fornecedorId, 'f1');
  assert.equal(p2.fornecedorNome, 'DISTRIBUIDORA ALFA');
  assert.equal(p2.clienteId, undefined);
  assert.equal(p2.descricao, 'ACERTO DE MERCADORIA (Parcela 2/3)');
  assert.equal(p2.parcela, 2);
  assert.equal(p2.totalParcelas, 3);
  assert.equal(p2.grupoLancamentoId, 'abc12345XYZ');
  const de_novo = await s.lancarContaAReceber({ user: USUARIO, tenantId: 'loja', corpo });
  assert.equal(de_novo.jaLancado, true);
  assert.equal(fake.listar('transacoes/').length, 3);
});

test('recusa: quem paga de outra empresa, inativo, sem descricao, forma de cartao, parcela sem valor', async () => {
  const s = carregar(criarBancoFalso(base()).db);
  const lancar = (extra) => s.lancarContaAReceber({ user: USUARIO, tenantId: 'loja', corpo: pedido(extra) });
  await assert.rejects(() => lancar({ devedor: { tipo: 'cliente', id: 'deFora' } }), (e) => e.status === 404 && /não foi encontrado nesta empresa/.test(e.message));
  await assert.rejects(() => lancar({ devedor: { tipo: 'cliente', id: 'inativo' } }), (e) => e.status === 409 && /está inativo/.test(e.message));
  await assert.rejects(() => lancar({ devedor: { tipo: 'fornecedor', id: 'c1' } }), (e) => e.status === 404);
  await assert.rejects(() => lancar({ descricao: '   ' }), (e) => e.status === 400 && /descrição/.test(e.message));
  await assert.rejects(() => lancar({ formaPrevista: 'Cartão de Crédito' }), (e) => e.status === 400 && /forma prevista/.test(e.message));
  await assert.rejects(() => lancar({ parcelas: [{ vencimento: '2026-11-10', valorCentavos: 0 }] }), (e) => e.status === 400 && /maior que zero/.test(e.message));
  await assert.rejects(() => lancar({ parcelas: [{ vencimento: '2026-02-30', valorCentavos: 100 }] }), (e) => e.status === 400 && /vencimento/.test(e.message));
});

test('editar: troca de cliente para fornecedor apaga o outro par e devolve o que mudou para o log', async () => {
  const fake = criarBancoFalso(base());
  const s = carregar(fake.db);
  await s.lancarContaAReceber({ user: USUARIO, tenantId: 'loja', corpo: pedido() });
  const r = await s.editarContaAReceber({
    user: USUARIO,
    tenantId: 'loja',
    corpo: {
      transacaoId: 'lanc_abc12345XYZ', devedor: { tipo: 'fornecedor', id: 'f1' }, descricao: 'ACERTO DE MERCADORIA', categoria: 'Outras Receitas',
      formaPrevista: 'Boleto', documento: '', observacao: 'combinado por telefone', vencimento: '2026-11-20',
    },
  });
  const campos = r.alteracoes.map((a) => a.campo);
  assert.deepEqual(campos.sort(), ['Forma prevista', 'Nº do documento', 'Observação', 'Quem paga', 'Vencimento'].sort());
  const t = fake.ler('transacoes/lanc_abc12345XYZ');
  assert.equal(t.fornecedorId, 'f1');
  assert.equal(t.clienteId, undefined);
  assert.equal(t.clienteNome, undefined);
  assert.equal(t.documento, undefined);
  assert.equal(t.observacao, 'combinado por telefone');
  assert.equal(t.dataVencimento, '2026-11-20');
  assert.equal(t.formaPagamento, 'Boleto');
  assert.equal(t.valorCentavos, 15000, 'o valor nao muda na edicao');
});

test('cancelar pede motivo; conta de venda, recebida ou com boleto nao e\' cancelada aqui', async () => {
  const fake = criarBancoFalso(base({
    'transacoes/venda': { tenantId: 'loja', tipo: 'entrada', status: 'Pendente', pedidoId: 'p1', descricao: 'VENDA #0001' },
    'transacoes/paga': { tenantId: 'loja', tipo: 'entrada', status: 'Paga', origemLancamento: 'manual', descricao: 'PAGA' },
    'transacoes/boleto': { tenantId: 'loja', tipo: 'entrada', status: 'Pendente', origemLancamento: 'manual', descricao: 'COM BOLETO', boleto: { status: 'emitido' } },
  }));
  const s = carregar(fake.db);
  await s.lancarContaAReceber({ user: USUARIO, tenantId: 'loja', corpo: pedido() });
  const cancelar = (transacaoId, motivo = 'lançada em duplicidade por engano') => s.cancelarContaAReceber({ user: USUARIO, tenantId: 'loja', corpo: { transacaoId, motivo } });
  await assert.rejects(() => cancelar('lanc_abc12345XYZ', 'curto'), (e) => e.status === 400 && /motivo/.test(e.message));
  await assert.rejects(() => cancelar('venda'), (e) => e.status === 409 && /venda ou OS/.test(e.message));
  await assert.rejects(() => cancelar('paga'), (e) => e.status === 409 && /estorne o recebimento/.test(e.message));
  await assert.rejects(() => cancelar('boleto'), (e) => e.status === 409 && /boleto emitido/.test(e.message));
  const r = await cancelar('lanc_abc12345XYZ');
  assert.equal(r.devedorNome, 'JOSE DA SILVA');
  const t = fake.ler('transacoes/lanc_abc12345XYZ');
  assert.equal(t.status, 'Cancelada');
  assert.equal(t.cancelamento.motivo, 'lançada em duplicidade por engano');
  assert.equal(t.cancelamento.porUid, 'u1');
  await assert.rejects(() => cancelar('lanc_abc12345XYZ'), (e) => e.status === 409 && /já está cancelada/.test(e.message));
});
