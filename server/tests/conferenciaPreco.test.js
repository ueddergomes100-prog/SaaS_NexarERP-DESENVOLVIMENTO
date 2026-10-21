const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

/*
 * Preco de cada item conferido pelo servidor (21/10/2026, decisao do dono):
 * abaixo do preco do sistema, a diferenca conta como desconto e passa pelos
 * mesmos limites; acima e' livre; servico da OS e' livre.
 */

const carregar = (db) => {
  const [, , , venda, os, liberacao] = carregarComBancoFalso(
    db, 'services/vendaFechamento', 'services/osServidor', 'services/liberacaoDesconto', 'services/comprovantes',
  );
  return { venda, os, liberacao };
};

const CAIXA = { uid: 'caixa1', tenantId: 'loja', email: 'c@loja', permissoes: ['vendas.pedidos', 'mecanica.os'] };
const tokenDe = (uid) => `falso:${uid}:${Math.floor(Date.now() / 1000)}`;

const pagamento = (valor, extra = {}) => ({
  id: 'pg1', forma: 'Dinheiro', valor: String(valor), prazoDias: '', parcelasAPrazo: '1', dataVencimento: '', bandeira: '', operadora: '',
  autorizacao: '', parcelas: '1', dataPrevistaRecebimento: '', bancoId: '', bancoNome: '', chequeBancoEmissor: '', chequeAgencia: '',
  chequeTitular: '', chequeEmitente: '', chequeDocumentoEmitente: '', chequeNumero: '', ...extra,
});

// RACAO custa R$ 10,00 (a vista R$ 9,50); a venda manda o preco que quiser.
const venda = (preco, extra = {}) => ({
  idDocumento: 'venda1',
  dataVenda: '2026-10-21',
  vendedorId: 'vend1',
  clienteId: 'cli1',
  clienteNome: 'MARIA',
  itens: [{ id: 'p1', nome: 'RAÇÃO', precoUnitario: preco, quantidade: 2, desconto: 0, subtotal: preco * 2 }],
  descontoGeral: { tipo: 'valor', valorInformado: 0 },
  pagamentos: [pagamento(preco * 2, { forma: 'Pagamento a Prazo', prazoDias: '30' })],
  ...extra,
});

const base = (config = {}, extra = {}) => ({
  'configuracoes/loja': {
    tenantId: 'loja',
    limiteDescontoPedido: { tipo: 'percentual', valor: 10 },
    limiteDescontoOS: { tipo: 'percentual', valor: 10 },
    modoLimiteDesconto: 'senha',
    venderSemEstoque: true,
    ...config,
  },
  'usuarios/vend1': { tenantId: 'loja', nome: 'VENDEDOR UM', role: 'Funcionario', tipoRegistro: 'vendedor' },
  'usuarios/ger1': { tenantId: 'loja', nome: 'GERENTE', role: 'Funcionario', permissoes: ['vendas.liberar_desconto'] },
  'usuarios/caixa1': { tenantId: 'loja', nome: 'CAIXA', role: 'Funcionario', permissoes: ['vendas.pedidos'] },
  'clientes/cli1': { tenantId: 'loja', nome: 'MARIA' },
  'estoque/p1': { tenantId: 'loja', nome: 'RAÇÃO', quantidade: 10, quantidadeReservada: 0, precoVenda: 10, precoAVista: 9.5 },
  ...extra,
});

const finalizar = (s, corpo) => s.venda.finalizarVenda({ user: CAIXA, tenantId: 'loja', corpo });
const pedeDeNovo = (trecho) => (erro) => erro.status === 428 && trecho.test(erro.message);

test('preco abaixo do sistema conta como desconto: modo bloquear recusa dizendo de onde veio', async () => {
  const fake = criarBancoFalso(base({ modoLimiteDesconto: 'bloquear' }), { consultas: true });
  await assert.rejects(
    () => finalizar(carregar(fake.db), venda(8)),
    (erro) => erro.status === 409
      && /RAÇÃO está a R\$ 8,00, abaixo do preço do sistema \(R\$ 10,00\): a diferença conta como desconto/.test(erro.message)
      && /20,0%/.test(erro.message),
  );
  assert.equal(fake.ler('pedidos_venda/venda1'), undefined);
});

test('modo senha: pede liberacao; a liberacao do valor com a diferenca passa e a venda grava o desconto por preco', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  await assert.rejects(() => finalizar(s, venda(8)), pedeDeNovo(/abaixo do preço do sistema.*precisa da liberação/));
  // Liberacao pedida com o preco da tela (sem a diferenca) nao cobre.
  const curta = await s.liberacao.liberarDesconto({ user: CAIXA, tenantId: 'loja', corpo: { tela: 'pedido', baseCentavos: 1600, descontoCentavos: 1, aprovador: { tipo: 'login', idToken: tokenDe('ger1') } } });
  await assert.rejects(() => finalizar(s, venda(8, { descontoGeral: { tipo: 'valor', valorInformado: 0, aprovacao: { comprovanteId: curta.comprovanteId } } })), pedeDeNovo(/desconto mudou/));
  const lib = await s.liberacao.liberarDesconto({ user: CAIXA, tenantId: 'loja', corpo: { tela: 'pedido', baseCentavos: 2000, descontoCentavos: 400, aprovador: { tipo: 'login', idToken: tokenDe('ger1') } } });
  await finalizar(s, venda(8, { descontoGeral: { tipo: 'valor', valorInformado: 0, aprovacao: { comprovanteId: lib.comprovanteId } } }));
  const pedido = fake.ler('pedidos_venda/venda1');
  assert.equal(pedido.status, 'Finalizada');
  assert.equal(pedido.valorTotalCentavos, 1600);
  assert.equal(pedido.descontoPorPrecoCentavos, 400);
  assert.equal(pedido.descontoGeral.aprovacao.aprovadoPorNome, 'GERENTE');
});

test('dentro do limite passa sem liberacao; preco acima do sistema e\' livre; a vista vale o preco a vista', async () => {
  const dentro = criarBancoFalso(base(), { consultas: true });
  await finalizar(carregar(dentro.db), venda(9.5));
  assert.equal(dentro.ler('pedidos_venda/venda1').descontoPorPrecoCentavos, 100);

  const acima = criarBancoFalso(base(), { consultas: true });
  await finalizar(carregar(acima.db), venda(15));
  assert.equal(acima.ler('pedidos_venda/venda1').descontoPorPrecoCentavos, undefined);

  // Dinheiro = a vista: R$ 9,50 e' o preco do sistema, sem desconto nenhum.
  const vista = criarBancoFalso(base({ modoLimiteDesconto: 'bloquear', limiteDescontoPedido: { tipo: 'percentual', valor: 0 } }), { consultas: true });
  await finalizar(carregar(vista.db), venda(9.5, { pagamentos: [pagamento(19)] }));
  assert.equal(vista.ler('pedidos_venda/venda1').descontoPorPrecoCentavos, undefined);
});

test('limite do proprio produto vale para o preco abaixo do sistema (mesmo no modo avisar)', async () => {
  const fake = criarBancoFalso(base({ modoLimiteDesconto: 'avisar' }, {
    'estoque/p1': { tenantId: 'loja', nome: 'RAÇÃO', quantidade: 10, precoVenda: 10, descontoMaximoPercentual: 5 },
  }), { consultas: true });
  await assert.rejects(
    () => finalizar(carregar(fake.db), venda(9)),
    (erro) => erro.status === 409 && /abaixo do preço do sistema/.test(erro.message) && /aceita no máximo 5% de desconto/.test(erro.message),
  );
});

test('promocao vigente e\' o preco do sistema; acabada a quota, a linha volta ao preco normal', async () => {
  const promo = { tenantId: 'loja', nome: 'SEMANA', dataInicio: '2026-01-01', continua: true, itens: [{ produtoId: 'p1', tipo: 'valor', valor: 8, quota: 3 }] };
  const livre = criarBancoFalso(base({ modoLimiteDesconto: 'bloquear' }, { 'promocoes/pr1': promo }), { consultas: true });
  await finalizar(carregar(livre.db), venda(8, { itens: [{ id: 'p1', nome: 'RAÇÃO', precoUnitario: 8, quantidade: 2, desconto: 0, subtotal: 16, promocaoId: 'pr1' }] }));
  assert.equal(livre.ler('pedidos_venda/venda1').descontoPorPrecoCentavos, undefined);

  // Ja saiu 2 da quota de 3 em outra venda: 2 unidades nao cabem mais.
  const esgotada = criarBancoFalso(base({ modoLimiteDesconto: 'bloquear' }, {
    'promocoes/pr1': promo,
    'pedidos_venda/antiga': { tenantId: 'loja', status: 'Finalizada', promocaoIds: ['pr1'], itens: [{ id: 'p1', quantidade: 2, promocaoId: 'pr1' }] },
  }), { consultas: true });
  await assert.rejects(
    () => finalizar(carregar(esgotada.db), venda(8, { itens: [{ id: 'p1', nome: 'RAÇÃO', precoUnitario: 8, quantidade: 2, desconto: 0, subtotal: 16, promocaoId: 'pr1' }] })),
    (erro) => erro.status === 409 && /abaixo do preço do sistema \(R\$ 10,00\)/.test(erro.message),
  );
});

// ------------------------------------------------------------------- OS

const OS = (pecas) => ({
  tenantId: 'loja',
  numeroOS: '07',
  status: 'Em Manutenção',
  clienteId: 'cli1',
  clienteNome: 'MARIA',
  servicos: [{ id: 's1', nome: 'REVISÃO', preco: 50, quantidade: 1 }],
  pecas,
  desconto: { tipo: 'valor', valorInformado: 0 },
  estoqueBaixado: false,
  estoqueReservado: false,
});

const finalizarOs = (s, valor, corpo = {}) => s.os.finalizarOs({
  user: CAIXA, tenantId: 'loja', corpo: { osId: 'os1', dataSaida: '2026-10-21', pagamentos: [pagamento(valor, { forma: 'Pagamento a Prazo', prazoDias: '30' })], ...corpo },
});

test('OS: peca abaixo do preco do sistema conta como desconto da OS; servico e\' livre', async () => {
  const pecaBarata = OS([{ id: 'p1', nome: 'RAÇÃO', preco: 5, quantidade: 2 }]);
  const fake = criarBancoFalso(base({ modoLimiteDesconto: 'bloquear' }, { 'ordens_de_servico/os1': pecaBarata }), { consultas: true });
  // Base 50 + 20 = 70; desconto por preco 10 = 14,3% (limite 10%).
  await assert.rejects(
    () => finalizarOs(carregar(fake.db), 60),
    (erro) => erro.status === 409 && /RAÇÃO está a R\$ 5,00, abaixo do preço do sistema/.test(erro.message),
  );

  // Servico a qualquer valor e peca no preco: passa.
  const ok = criarBancoFalso(base({ modoLimiteDesconto: 'bloquear' }, {
    'ordens_de_servico/os1': { ...OS([{ id: 'p1', nome: 'RAÇÃO', preco: 10, quantidade: 2 }]), servicos: [{ id: 's1', nome: 'REVISÃO', preco: 1, quantidade: 1 }] },
  }), { consultas: true });
  await finalizarOs(carregar(ok.db), 21);
  assert.equal(ok.ler('ordens_de_servico/os1').status, 'Finalizada');
});
