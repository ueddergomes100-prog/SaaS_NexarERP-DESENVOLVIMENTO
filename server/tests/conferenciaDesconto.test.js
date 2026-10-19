const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

/*
 * Desconto, liberacao e vendedor conferidos pelo servidor (19/10/2026,
 * decisao do dono: o servidor confere tudo). Venda (Pedido) e OS pelo servidor.
 */

const carregar = (db) => {
  const [, , , venda, os, liberacao, comprovantes] = carregarComBancoFalso(
    db, 'services/vendaFechamento', 'services/osServidor', 'services/liberacaoDesconto', 'services/comprovantes',
  );
  return { venda, os, liberacao, comprovantes };
};

const CAIXA = { uid: 'caixa1', tenantId: 'loja', email: 'c@loja', permissoes: ['vendas.pedidos', 'mecanica.os'] };
const agoraS = () => Math.floor(Date.now() / 1000);
const tokenDe = (uid, authTime = agoraS()) => `falso:${uid}:${authTime}`;

const pagamento = (valor, extra = {}) => ({
  id: 'pg1', forma: 'Dinheiro', valor: String(valor), prazoDias: '', parcelasAPrazo: '1', dataVencimento: '', bandeira: '', operadora: '',
  autorizacao: '', parcelas: '1', dataPrevistaRecebimento: '', bancoId: '', bancoNome: '', chequeBancoEmissor: '', chequeAgencia: '',
  chequeTitular: '', chequeEmitente: '', chequeDocumentoEmitente: '', chequeNumero: '', ...extra,
});

// Itens de R$ 20,00; desconto geral de R$ 4,00 = 20% (limite 10%).
const venda = (extra = {}) => ({
  idDocumento: 'venda1',
  dataVenda: '2026-10-19',
  vendedorId: 'vend1',
  clienteId: 'cli1',
  clienteNome: 'MARIA',
  itens: [{ id: 'p1', nome: 'RAÇÃO', precoUnitario: 10, quantidade: 2, desconto: 0, subtotal: 20 }],
  descontoGeral: { tipo: 'valor', valorInformado: 4 },
  pagamentos: [pagamento(16)],
  ...extra,
});

const config = (extra = {}) => ({
  tenantId: 'loja',
  limiteDescontoPedido: { tipo: 'percentual', valor: 10 },
  limiteDescontoOS: { tipo: 'percentual', valor: 10 },
  modoLimiteDesconto: 'senha',
  ...extra,
});

const base = (extra = {}) => ({
  'configuracoes/loja': config(),
  'usuarios/loja': { tenantId: 'loja', nome: 'DONO', role: 'Master' },
  'usuarios/vend1': { tenantId: 'loja', nome: 'VENDEDOR UM', role: 'Funcionario', tipoRegistro: 'vendedor' },
  'usuarios/vend2': { tenantId: 'loja', nome: 'VENDEDOR DOIS', role: 'Funcionario', tipoRegistro: 'vendedor' },
  'usuarios/ger1': { tenantId: 'loja', nome: 'GERENTE', role: 'Funcionario', permissoes: ['vendas.liberar_desconto'] },
  'usuarios/caixa1': { tenantId: 'loja', nome: 'CAIXA', role: 'Funcionario', permissoes: ['vendas.pedidos'] },
  'usuarios/outro': { tenantId: 'outra', nome: 'DE FORA', role: 'Master' },
  'clientes/cli1': { tenantId: 'loja', nome: 'MARIA' },
  'estoque/p1': { tenantId: 'loja', nome: 'RAÇÃO', quantidade: 10, quantidadeReservada: 0 },
  'estoque/p2': { tenantId: 'loja', nome: 'COLEIRA', quantidade: 10, quantidadeReservada: 0 },
  ...extra,
});

const liberar = (s, aprovadorUid, extra = {}, user = CAIXA) => s.liberacao.liberarDesconto({
  user,
  tenantId: 'loja',
  corpo: { tela: 'pedido', baseCentavos: 2000, descontoCentavos: 400, aprovador: { tipo: 'login', idToken: tokenDe(aprovadorUid) }, ...extra },
});

const finalizar = (s, corpo = venda(), user = CAIXA) => s.venda.finalizarVenda({ user, tenantId: 'loja', corpo });
const pedeDeNovo = (trecho) => (erro) => erro.status === 428 && (!trecho || trecho.test(erro.message));

test('modo senha: desconto acima do limite sem liberacao e\' recusado (428) e nada e\' gravado', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  await assert.rejects(() => finalizar(carregar(fake.db)), pedeDeNovo(/precisa da liberação/));
  assert.equal(fake.ler('pedidos_venda/venda1'), undefined);
  assert.equal(fake.ler('estoque/p1').quantidade, 10);
});

test('liberacao pelo servidor: quem liberou vem do comprovante (nunca da tela) e o comprovante vale uma venda so\'', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  const lib = await liberar(s, 'ger1');
  assert.equal(lib.aprovadoPorNome, 'GERENTE');
  assert.ok(fake.ler(`comprovantes_servidor/${lib.comprovanteId}`));

  const forjada = { comprovanteId: lib.comprovanteId, aprovadoPorId: 'loja', aprovadoPorNome: 'DONO (forjado)' };
  await finalizar(s, venda({ descontoGeral: { tipo: 'valor', valorInformado: 4, aprovacao: forjada } }));
  const pedido = fake.ler('pedidos_venda/venda1');
  assert.equal(pedido.descontoGeral.excedeuLimite, true);
  assert.equal(pedido.descontoGeral.aprovacao.aprovadoPorId, 'ger1');
  assert.equal(pedido.descontoGeral.aprovacao.aprovadoPorNome, 'GERENTE');
  assert.equal(pedido.descontoGeral.aprovacao.modo, 'senha');
  assert.equal(fake.ler(`comprovantes_servidor/${lib.comprovanteId}`), undefined, 'comprovante gasto');

  await assert.rejects(
    () => finalizar(s, venda({ idDocumento: 'venda2', descontoGeral: { tipo: 'valor', valorInformado: 4, aprovacao: forjada } })),
    pedeDeNovo(/não vale para esta venda/),
  );
});

test('liberacao recusada: senha que nao foi digitada agora, sem permissao, de outra empresa, valores invalidos', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  await assert.rejects(
    () => s.liberacao.liberarDesconto({ user: CAIXA, tenantId: 'loja', corpo: { tela: 'pedido', baseCentavos: 2000, descontoCentavos: 400, aprovador: { tipo: 'login', idToken: tokenDe('ger1', agoraS() - 600) } } }),
    (erro) => erro.status === 401 && /digitada agora/.test(erro.message),
  );
  await assert.rejects(() => liberar(s, 'caixa1'), (erro) => erro.status === 403 && /não tem a permissão "Liberar desconto"/.test(erro.message));
  await assert.rejects(() => liberar(s, 'outro'), (erro) => erro.status === 403 && /não é desta empresa/.test(erro.message));
  await assert.rejects(() => liberar(s, 'ger1', { descontoCentavos: 3000 }), (erro) => erro.status === 400);
  await assert.rejects(() => liberar(s, 'ger1', { aprovador: { tipo: 'login', idToken: 'qualquer-coisa-que-nao-e-token' } }), (erro) => erro.status === 401);
  // Dono e Admin/Master liberam sem a permissao marcada.
  assert.equal((await liberar(s, 'loja')).aprovadoPorNome, 'DONO');
});

test('comprovante nao cobre: desconto maior, outra tela, outra sessao, vencido', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  const comLiberacao = (id, valor = 4) => venda({ descontoGeral: { tipo: 'valor', valorInformado: valor, aprovacao: { comprovanteId: id } }, pagamentos: [pagamento(20 - valor)] });

  const pouco = await liberar(s, 'ger1', { descontoCentavos: 300 });
  await assert.rejects(() => finalizar(s, comLiberacao(pouco.comprovanteId)), pedeDeNovo(/mudou depois da liberação/));

  const doPdv = await liberar(s, 'ger1', { tela: 'pdv' });
  await assert.rejects(() => finalizar(s, comLiberacao(doPdv.comprovanteId)), pedeDeNovo(/não vale para esta venda/));

  const deOutroCaixa = await liberar(s, 'ger1', {}, { ...CAIXA, uid: 'caixa2' });
  await assert.rejects(() => finalizar(s, comLiberacao(deOutroCaixa.comprovanteId)), pedeDeNovo(/não vale para esta venda/));

  const vencida = await liberar(s, 'ger1');
  fake.ler(`comprovantes_servidor/${vencida.comprovanteId}`).expiraEmMs = Date.now() - 1;
  await assert.rejects(() => finalizar(s, comLiberacao(vencida.comprovanteId)), pedeDeNovo(/venceu/));
  assert.equal(fake.ler('pedidos_venda/venda1'), undefined);
});

test('modo bloquear recusa (409); modo avisar passa sem aprovacao e a aprovacao mandada pela tela e\' ignorada', async () => {
  const bloquear = criarBancoFalso(base({ 'configuracoes/loja': config({ modoLimiteDesconto: 'bloquear' }) }), { consultas: true });
  await assert.rejects(() => finalizar(carregar(bloquear.db)), (erro) => erro.status === 409 && /passa do limite de 10%/.test(erro.message));

  const avisar = criarBancoFalso(base({ 'configuracoes/loja': config({ modoLimiteDesconto: 'avisar' }) }), { consultas: true });
  await finalizar(carregar(avisar.db), venda({ descontoGeral: { tipo: 'valor', valorInformado: 4, aprovacao: { aprovadoPorId: 'loja', aprovadoPorNome: 'FORJADO' } } }));
  const pedido = avisar.ler('pedidos_venda/venda1');
  assert.equal(pedido.descontoGeral.excedeuLimite, true);
  assert.equal(pedido.descontoGeral.aprovacao, undefined);
});

test('desconto do cadastro do cliente passa direto (sem liberacao) ate o percentual dele', async () => {
  const fake = criarBancoFalso(base({ 'clientes/cli1': { tenantId: 'loja', nome: 'MARIA', descontoPadraoPercentual: 20 } }), { consultas: true });
  await finalizar(carregar(fake.db));
  assert.equal(fake.ler('pedidos_venda/venda1').descontoGeral.excedeuLimite, false);
});

test('limite do PRODUTO sempre bloqueia; no Pedido com "bloquear", o item tambem e\' conferido contra o limite da tela', async () => {
  const produto = criarBancoFalso(base({
    'configuracoes/loja': config({ modoLimiteDesconto: 'avisar' }),
    'estoque/p1': { tenantId: 'loja', nome: 'RAÇÃO', quantidade: 10, quantidadeReservada: 0, descontoMaximoPercentual: 5 },
  }), { consultas: true });
  await assert.rejects(
    () => finalizar(carregar(produto.db), venda({ itens: [{ id: 'p1', nome: 'RAÇÃO', precoUnitario: 10, quantidade: 2, desconto: 2, subtotal: 18 }], descontoGeral: { tipo: 'valor', valorInformado: 0 }, pagamentos: [pagamento(18)] })),
    (erro) => erro.status === 409 && /aceita no máximo 5% de desconto/.test(erro.message),
  );

  // Item de R$ 10 com R$ 3 de desconto (30%) num total de R$ 110 (2,7%): o total passa, o item nao.
  const item = criarBancoFalso(base({ 'configuracoes/loja': config({ modoLimiteDesconto: 'bloquear' }) }), { consultas: true });
  await assert.rejects(
    () => finalizar(carregar(item.db), venda({
      itens: [
        { id: 'p1', nome: 'RAÇÃO', precoUnitario: 10, quantidade: 1, desconto: 3, subtotal: 7 },
        { id: 'p2', nome: 'COLEIRA', precoUnitario: 100, quantidade: 1, desconto: 0, subtotal: 100 },
      ],
      descontoGeral: { tipo: 'valor', valorInformado: 0 },
      pagamentos: [pagamento(107)],
    })),
    (erro) => erro.status === 409 && /O desconto de RAÇÃO \(30,0%\)/.test(erro.message),
  );
});

test('identificacao exigida: a venda so\' passa com o comprovante do PIN do proprio vendedor da venda', async () => {
  const fake = criarBancoFalso(base({ 'configuracoes/loja': { tenantId: 'loja', exigirIdentificacaoVendedor: true } }), { consultas: true });
  const s = carregar(fake.db);
  const semDesconto = (extra = {}) => venda({ descontoGeral: { tipo: 'valor', valorInformado: 0 }, pagamentos: [pagamento(20)], ...extra });
  const emitir = (pessoaId) => s.comprovantes.emitirComprovante({ tenantId: 'loja', emitidoPara: 'caixa1', tipo: 'identificacao_vendedor', pessoaId, pessoaNome: pessoaId });

  await assert.rejects(() => finalizar(s, semDesconto()), pedeDeNovo(/exige que o vendedor se identifique/));
  const doOutro = await emitir('vend2');
  await assert.rejects(() => finalizar(s, semDesconto({ comprovanteVendedorId: doOutro.comprovanteId })), pedeDeNovo(/não confere/));

  const doVendedor = await emitir('vend1');
  await finalizar(s, semDesconto({ comprovanteVendedorId: doVendedor.comprovanteId }));
  assert.equal(fake.ler('pedidos_venda/venda1').vendedorId, 'vend1');
  assert.equal(fake.ler(`comprovantes_servidor/${doVendedor.comprovanteId}`), undefined, 'comprovante gasto');
});

test('emitir comprovante faz a faxina dos vencidos da mesma sessao', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  const velho = await liberar(s, 'ger1');
  fake.ler(`comprovantes_servidor/${velho.comprovanteId}`).expiraEmMs = Date.now() - 1;
  const novo = await liberar(s, 'ger1');
  assert.equal(fake.ler(`comprovantes_servidor/${velho.comprovanteId}`), undefined);
  assert.ok(fake.ler(`comprovantes_servidor/${novo.comprovanteId}`));
});

// ------------------------------------------------------------------- OS

const OS = (extra = {}) => ({
  tenantId: 'loja',
  numeroOS: '07',
  status: 'Em Manutenção',
  clienteId: 'cli1',
  clienteNome: 'MARIA',
  servicos: [{ id: 's1', nome: 'REVISÃO', preco: 100, quantidade: 1 }],
  pecas: [],
  desconto: { tipo: 'valor', valorInformado: 20 },
  estoqueBaixado: false,
  estoqueReservado: false,
  ...extra,
});

const finalizarOs = (s, corpo = {}) => s.os.finalizarOs({
  user: CAIXA, tenantId: 'loja', corpo: { osId: 'os1', dataSaida: '2026-10-19', pagamentos: [pagamento(80)], ...corpo },
});

test('OS: desconto acima do limite pede liberacao; com o comprovante grava quem liberou a partir dele', async () => {
  const fake = criarBancoFalso(base({ 'ordens_de_servico/os1': OS({ desconto: { tipo: 'valor', valorInformado: 20, aprovacao: { aprovadoPorNome: 'FORJADO' } } }) }), { consultas: true });
  const s = carregar(fake.db);
  await assert.rejects(() => finalizarOs(s), pedeDeNovo(/precisa da liberação/));

  const lib = await liberar(s, 'ger1', { tela: 'os', baseCentavos: 10000, descontoCentavos: 2000 });
  await finalizarOs(s, { comprovanteAprovacaoId: lib.comprovanteId });
  const os = fake.ler('ordens_de_servico/os1');
  assert.equal(os.status, 'Finalizada');
  assert.equal(os.desconto.excedeuLimite, true);
  assert.equal(os.desconto.aprovacao.aprovadoPorNome, 'GERENTE');
  assert.equal(fake.ler(`comprovantes_servidor/${lib.comprovanteId}`), undefined);
});

test('OS dentro do limite: aprovacao mandada pela tela e\' apagada', async () => {
  const fake = criarBancoFalso(base({ 'ordens_de_servico/os1': OS({ desconto: { tipo: 'valor', valorInformado: 5, aprovacao: { aprovadoPorNome: 'FORJADO' } } }) }), { consultas: true });
  await finalizarOs(carregar(fake.db), { pagamentos: [pagamento(95)] });
  const os = fake.ler('ordens_de_servico/os1');
  assert.equal(os.desconto.excedeuLimite, false);
  assert.equal(os.desconto.aprovacao, undefined);
});
