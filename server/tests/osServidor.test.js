const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

/*
 * Finalizar, reabrir e cancelar a OS pelo servidor (item 8, fatia 3d --
 * 19/10/2026). Estoque, lotes, comissao, lancamentos e saldo do banco sao lidos
 * e gravados aqui, com o plano de src/utils/osFechamentoDomain.ts.
 */

const carregar = (db) => carregarComBancoFalso(db, 'services/vendaFechamento', 'services/osServidor')[4];

const OFICINA = { uid: 'ger1', tenantId: 'loja', email: 'g@loja', nome: 'GERENTE', permissoes: ['mecanica.os'] };

const os = (extra = {}) => ({
  tenantId: 'loja',
  numeroOS: '07',
  status: 'Em Manutenção',
  clienteId: 'cli1',
  clienteNome: 'JOSE',
  mecanicoId: 'mec1',
  mecanicoNome: 'PEDRO',
  servicos: [{ id: 's1', nome: 'TROCA DE OLEO', preco: 50, quantidade: 1 }],
  pecas: [{ id: 'p1', nome: 'FILTRO', preco: 25, quantidade: 2 }],
  desconto: { tipo: 'valor', valorInformado: 0 },
  valorTotal: 100,
  valorTotalCentavos: 10000,
  estoqueBaixado: false,
  estoqueReservado: false,
  ...extra,
});

const base = (extra = {}) => ({
  'configuracoes/loja': { tenantId: 'loja' },
  'ordens_de_servico/os1': os(),
  'estoque/p1': { tenantId: 'loja', nome: 'FILTRO', quantidade: 10, quantidadeReservada: 0, comissaoPercentual: 10 },
  'servicos/s1': { tenantId: 'loja', nome: 'TROCA DE OLEO', comissaoPercentual: 20 },
  'usuarios/mec1': { tenantId: 'loja', nome: 'PEDRO' },
  'bancos/b1': { tenantId: 'loja', nome: 'SICOOB', ativo: true, saldoCentavos: 100000 },
  ...extra,
});

const pagamento = (extra = {}) => ({
  id: 'pg1', forma: 'Pix', valor: '100', prazoDias: '', parcelasAPrazo: '1', dataVencimento: '', bandeira: '', operadora: '',
  autorizacao: '', parcelas: '1', dataPrevistaRecebimento: '', bancoId: 'b1', bancoNome: 'SICOOB', chequeBancoEmissor: '', chequeAgencia: '',
  chequeTitular: '', chequeEmitente: '', chequeDocumentoEmitente: '', chequeNumero: '', ...extra,
});

const finalizar = (s, corpo = {}) => s.finalizarOs({ user: OFICINA, tenantId: 'loja', corpo: { osId: 'os1', dataSaida: '2026-10-19', pagamentos: [pagamento()], ...corpo } });

// ------------------------------------------------------------------- finalizar

test('finalizar a OS em Pix: estoque sai, lancamento pago, banco creditado e comissao por item', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const r = await finalizar(carregar(fake.db));
  assert.equal(r.numeroOS, '07');
  assert.equal(r.totalCentavos, 10000);
  const gravada = fake.ler('ordens_de_servico/os1');
  assert.equal(gravada.status, 'Finalizada');
  assert.equal(gravada.statusPagamento, 'Paga');
  assert.equal(gravada.fechadoPeloServidor, true);
  assert.equal(gravada.estoqueBaixado, true);
  assert.deepEqual(gravada.pecasBaixadas, [{ id: 'p1', nome: 'FILTRO', quantidade: 2 }]);
  // servico 20% de 50 + peca 10% de 50
  assert.equal(gravada.comissao.valorAtualCentavos, 1000 + 500);
  assert.equal(gravada.comissao.status, 'gerada');
  assert.equal(fake.ler('estoque/p1').quantidade, 8);
  const titulo = fake.ler('transacoes/os1');
  assert.equal(titulo.status, 'Paga');
  assert.equal(titulo.osId, 'os1');
  assert.equal(titulo.categoria, 'Serviços');
  assert.equal(titulo.descricao, 'Recebimento OS #07 - Pix');
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 110000);
});

test('finalizar de novo o mesmo envio nao baixa o estoque duas vezes', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  await finalizar(s);
  const r = await finalizar(s);
  assert.equal(r.jaEnviado, true);
  assert.equal(fake.ler('estoque/p1').quantidade, 8);
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 110000);
});

test('finalizar com reserva: a reserva vira saida de verdade', async () => {
  const fake = criarBancoFalso(base({
    'ordens_de_servico/os1': os({ estoqueReservado: true }),
    'estoque/p1': { tenantId: 'loja', nome: 'FILTRO', quantidade: 10, quantidadeReservada: 2 },
  }), { consultas: true });
  await finalizar(carregar(fake.db));
  const produto = fake.ler('estoque/p1');
  assert.equal(produto.quantidade, 8);
  assert.equal(produto.quantidadeReservada, 0);
  assert.equal(fake.ler('ordens_de_servico/os1').estoqueReservado, false);
});

test('finalizar sem estoque e recusado e nada e gravado', async () => {
  const fake = criarBancoFalso(base({ 'estoque/p1': { tenantId: 'loja', nome: 'FILTRO', quantidade: 1, quantidadeReservada: 0 } }), { consultas: true });
  await assert.rejects(() => finalizar(carregar(fake.db)), (erro) => erro.status === 409 && /Estoque insuficiente para FILTRO/.test(erro.message));
  assert.equal(fake.ler('ordens_de_servico/os1').status, 'Em Manutenção');
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 100000);
});

test('finalizar com peca que controla lote: o lote sai e fica gravado na OS', async () => {
  const fake = criarBancoFalso(base({
    'estoque/p1': { tenantId: 'loja', nome: 'FILTRO', quantidade: 10, quantidadeReservada: 0, controlarLote: true },
    'estoque_lotes/l1': { tenantId: 'loja', produtoId: 'p1', lote: 'A1', quantidade: 5 },
  }), { consultas: true });
  const s = carregar(fake.db);
  await assert.rejects(() => finalizar(s), (erro) => erro.status === 400 && /escolha de novo de qual lote sai/.test(erro.message));
  await finalizar(s, { lotes: { 0: [{ loteId: 'l1', lote: 'A1', validade: null, quantidade: 2 }] } });
  assert.equal(fake.ler('estoque_lotes/l1').quantidade, 3);
  assert.deepEqual(fake.ler('ordens_de_servico/os1').lotesBaixados.map((l) => [l.loteId, l.quantidade]), [['l1', 2]]);
});

test('credito de devolucao nao paga OS', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  await assert.rejects(
    () => finalizar(carregar(fake.db), { pagamentos: [pagamento({ forma: 'Crédito de Devolução', bancoId: '', bancoNome: '' })] }),
    (erro) => [400, 409].includes(erro.status) && /devolução/.test(erro.message),
  );
});

// --------------------------------------------------------------------- reabrir

test('reabrir desfaz a finalizacao: banco estornado, lancamento cancelado, pecas de volta e comissao reaberta', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  await finalizar(s);
  const r = await s.reabrirOs({ user: OFICINA, tenantId: 'loja', corpo: { osId: 'os1', status: 'Aguardando Peça' } });
  assert.equal(r.status, 'Aguardando Peça');
  const gravada = fake.ler('ordens_de_servico/os1');
  assert.equal(gravada.status, 'Aguardando Peça');
  assert.equal(gravada.estoqueBaixado, false);
  assert.equal(gravada.comissao.status, 'reaberta');
  assert.equal(gravada.comissao.valorAtualCentavos, 0);
  assert.equal(fake.ler('transacoes/os1').status, 'Cancelada');
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 100000);
  assert.equal(fake.ler('estoque/p1').quantidade, 10);
});

test('reabrir e finalizar de novo refaz tudo uma vez so (comissao refeita com a OS nova)', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  await finalizar(s);
  await s.reabrirOs({ user: OFICINA, tenantId: 'loja', corpo: { osId: 'os1' } });
  // Na tela a OS e' gravada de novo com uma peca a mais antes de finalizar.
  await fake.db.collection('ordens_de_servico').doc('os1').update({ pecas: [{ id: 'p1', nome: 'FILTRO', preco: 25, quantidade: 3 }] });
  await finalizar(s, { pagamentos: [pagamento({ valor: '125' })] });
  const gravada = fake.ler('ordens_de_servico/os1');
  assert.equal(gravada.status, 'Finalizada');
  assert.equal(gravada.comissao.status, 'gerada');
  assert.equal(gravada.comissao.valorAtualCentavos, 1000 + 750);
  assert.equal(fake.ler('estoque/p1').quantidade, 7);
  assert.equal(fake.ler('transacoes/os1').status, 'Paga');
  assert.equal(fake.ler('transacoes/os1').valorCentavos, 12500);
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 112500);
});

test('reabrir com parcela ja recebida no Contas a Receber e bloqueado', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  await finalizar(s, { pagamentos: [pagamento({ forma: 'Pagamento a Prazo', prazoDias: '30', bancoId: '', bancoNome: '' })] });
  await fake.db.collection('transacoes').doc('os1').update({ status: 'Paga', baixaManual: { origem: 'contas_receber' }, dataPagamento: '2026-10-19' });
  await assert.rejects(
    () => s.reabrirOs({ user: OFICINA, tenantId: 'loja', corpo: { osId: 'os1' } }),
    (erro) => erro.status === 409 && /já foi recebida/.test(erro.message) && /reabrir a OS/.test(erro.message),
  );
  assert.equal(fake.ler('ordens_de_servico/os1').status, 'Finalizada');
});

// -------------------------------------------------------------------- cancelar

test('cancelar pede motivo', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  await assert.rejects(
    () => carregar(fake.db).cancelarOs({ user: OFICINA, tenantId: 'loja', corpo: { osId: 'os1', motivo: '' } }),
    (erro) => erro.status === 400 && /motivo/.test(erro.message),
  );
});

test('cancelar com NFS-e autorizada e bloqueado', async () => {
  const fake = criarBancoFalso(base({ 'notas_fiscais/n1': { tenantId: 'loja', osId: 'os1', tipo: 'NFS-e', status: 'authorized', number: 12 } }), { consultas: true });
  await assert.rejects(
    () => carregar(fake.db).cancelarOs({ user: OFICINA, tenantId: 'loja', corpo: { osId: 'os1', motivo: 'cliente desistiu' } }),
    (erro) => erro.status === 409 && /NFS-e nº 12/.test(erro.message),
  );
});

test('cancelar OS finalizada devolvendo as pecas: estorno, banco, estoque, comissao e motivo', async () => {
  const fake = criarBancoFalso(base({ 'orcamentos/orc1': { tenantId: 'loja', status: 'Finalizado' } }), { consultas: true });
  const s = carregar(fake.db);
  await fake.db.collection('ordens_de_servico').doc('os1').update({ orcamentoId: 'orc1' });
  await finalizar(s);
  const r = await s.cancelarOs({ user: OFICINA, tenantId: 'loja', corpo: { osId: 'os1', motivo: 'cliente desistiu', devolverEstoque: true } });
  assert.equal(r.devolveuEstoque, true);
  const gravada = fake.ler('ordens_de_servico/os1');
  assert.equal(gravada.status, 'Cancelada');
  assert.equal(gravada.motivoCancelamento, 'cliente desistiu');
  assert.equal(gravada.comissao.status, 'cancelada');
  assert.equal(fake.ler('estoque/p1').quantidade, 10);
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 100000);
  assert.equal(fake.ler('transacoes/os1').estornada, true);
  const estorno = fake.ler('transacoes/estorno_cancelamento_os1');
  assert.equal(estorno.tipo, 'saida');
  assert.equal(estorno.categoria, 'Cancelamento de OS');
  assert.equal(estorno.osId, 'os1');
  assert.equal(fake.ler('orcamentos/orc1').status, 'Pendente');
});

test('cancelar sem devolver as pecas: o estoque fica como esta', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  await finalizar(s);
  await s.cancelarOs({ user: OFICINA, tenantId: 'loja', corpo: { osId: 'os1', motivo: 'cliente desistiu', devolverEstoque: false } });
  assert.equal(fake.ler('estoque/p1').quantidade, 8);
  assert.equal(fake.ler('ordens_de_servico/os1').estoqueBaixado, true);
});

test('cancelar devolve o que SAIU do estoque, nao o que esta na OS agora', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  await finalizar(s);
  // Gravacao antiga mexeu nas pecas de uma OS finalizada sem mexer no estoque.
  await fake.db.collection('ordens_de_servico').doc('os1').update({ pecas: [{ id: 'p1', nome: 'FILTRO', preco: 25, quantidade: 5 }] });
  await s.cancelarOs({ user: OFICINA, tenantId: 'loja', corpo: { osId: 'os1', motivo: 'cliente desistiu', devolverEstoque: true } });
  assert.equal(fake.ler('estoque/p1').quantidade, 10);
});

test('cancelar OS em aberto com reserva solta a reserva', async () => {
  const fake = criarBancoFalso(base({
    'ordens_de_servico/os1': os({ estoqueReservado: true }),
    'estoque/p1': { tenantId: 'loja', nome: 'FILTRO', quantidade: 10, quantidadeReservada: 2 },
  }), { consultas: true });
  await carregar(fake.db).cancelarOs({ user: OFICINA, tenantId: 'loja', corpo: { osId: 'os1', motivo: 'cliente desistiu' } });
  assert.equal(fake.ler('estoque/p1').quantidadeReservada, 0);
  assert.equal(fake.ler('estoque/p1').quantidade, 10);
});

test('OS cancelada nao e finalizada nem reaberta', async () => {
  const fake = criarBancoFalso(base({ 'ordens_de_servico/os1': os({ status: 'Cancelada' }) }), { consultas: true });
  const s = carregar(fake.db);
  await assert.rejects(() => finalizar(s), (erro) => erro.status === 409 && /OS cancelada não volta a ser aberta/.test(erro.message));
  await assert.rejects(
    () => s.reabrirOs({ user: OFICINA, tenantId: 'loja', corpo: { osId: 'os1' } }),
    (erro) => erro.status === 409 && /OS cancelada não volta a ser aberta/.test(erro.message),
  );
});

test('OS de outra empresa nao existe para quem pede', async () => {
  const fake = criarBancoFalso(base({ 'ordens_de_servico/os1': os({ tenantId: 'outra' }) }), { consultas: true });
  await assert.rejects(() => finalizar(carregar(fake.db)), (erro) => erro.status === 404);
});
