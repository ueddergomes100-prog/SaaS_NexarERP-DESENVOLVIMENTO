const test = require('node:test');
const assert = require('node:assert/strict');

/*
 * Item 15 da Embala Minas, fase Vendas (25/11/2026): cada acao do Pedido de
 * Venda pede a SUA permissao, conferida no servidor. Sem a de preco, data,
 * vendedor ou desconto, o valor fica no PADRAO e qualquer outro e' recusado.
 * Quem tem "Vendas: Pedidos" e ainda nao teve as permissoes salvas de novo (sem
 * o marcador `pacote.vendas-1`) ja' tem as novas -- ninguem perde acesso.
 * Firestore falso em memoria: nenhum banco e' tocado.
 */
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');
const pv = require('../services/permissoesVendas');
const { getDateInputInTimeZone } = require('../domain/dateTime');

const MARCADORES = ['pacote.financeiro-1', 'pacote.financeiro-2', 'pacote.vendas-1'];
const HOJE = getDateInputInTimeZone();

// ---------------------------------------------------------------------------
// Regras puras
// ---------------------------------------------------------------------------

test('efetivas: quem tem Vendas: Pedidos e nunca foi salvo ja tem as novas; salvo de novo, vale o marcado', () => {
  const antigo = { uid: 'v1', permissoes: ['vendas.pedidos', 'vendas.alterar'] };
  for (const p of ['vendas.finalizar', 'vendas.alterar_preco', 'vendas.desconto', 'vendas.alterar_data', 'vendas.alterar_vendedor', 'vendas.cancelar', 'vendas.alterar_nota_fiscal']) {
    assert.equal(pv.podeEmVendas(antigo, p), true, p);
  }
  const salvo = { uid: 'v2', permissoes: ['vendas.pedidos', 'vendas.finalizar', ...MARCADORES] };
  assert.equal(pv.podeEmVendas(salvo, 'vendas.finalizar'), true);
  assert.equal(pv.podeEmVendas(salvo, 'vendas.alterar_preco'), false, 'dono desmarcou ao salvar');
  assert.equal(pv.podeEmVendas({ uid: 'a', permissoes: [], isTenantManager: true }, 'vendas.alterar_preco'), true, 'administrador segue liberado');
  assert.equal(pv.podeEmVendas({ uid: 'x' }, 'vendas.finalizar'), false, 'sem lista nao quebra');
  // A senha do vendedor vinha de "Cadastros: Vendedores — incluir".
  assert.equal(pv.podeEmVendas({ uid: 'c', permissoes: ['cadastros.vendedores_incluir'] }, 'vendas.gerenciar_pin_vendedor'), true);
});

test('mensagem em portugues cita o rotulo do cadastro e diz o padrao', () => {
  const preco = pv.mensagemSemPermissao(['vendas.alterar_preco']);
  assert.match(preco, /^Você não tem permissão para alterar o preço do item\./);
  assert.match(preco, /"Vendas: Alterar o preço do item \(computador\)"/);
  assert.match(preco, /preço do cadastro/);
  assert.match(pv.mensagemSemPermissao(['vendas.alterar_data']), /data de hoje/);
});

test('preco fora do padrao: diferente do sistema, avulso; o combinado na pre-venda passa', () => {
  const itens = [{ id: 'p1', nome: 'RAÇÃO', precoUnitario: 12 }];
  const conferidos = [{ precoSistema: 10 }];
  assert.match(pv.precoForaDoPadrao({ itens, conferidos }), /RAÇÃO está a R\$ 12,00, e o preço do sistema é R\$ 10,00/);
  assert.equal(pv.precoForaDoPadrao({ itens, conferidos: [{ precoSistema: 12 }] }), null);
  assert.equal(pv.precoForaDoPadrao({ itens, conferidos, combinados: [{ id: 'p1', precoUnitario: 12 }] }), null);
  assert.ok(pv.precoForaDoPadrao({ itens, conferidos, combinados: [{ id: 'p2', precoUnitario: 12 }] }), 'outro produto nao conta');
  assert.match(pv.precoForaDoPadrao({ itens: [{ id: 'avulso', nome: 'FRETE', precoUnitario: 5 }], conferidos: [{ precoSistema: 0 }] }), /não tem cadastro/);
  assert.equal(pv.precoForaDoPadrao({ itens: [{ id: 'p1', nome: 'B', precoUnitario: 0, bonificado: true }], conferidos: [{ precoSistema: 10 }] }), null, 'brinde fica de fora');
});

test('desconto no padrao: so o do cadastro do cliente ou o ja gravado por quem podia dar', () => {
  assert.equal(pv.descontoNoPadrao({ baseCentavos: 10000, descontoCentavos: 0 }), true);
  assert.equal(pv.descontoNoPadrao({ baseCentavos: 10000, descontoCentavos: 500 }), false);
  assert.equal(pv.descontoNoPadrao({ baseCentavos: 10000, descontoCentavos: 500, percentualDoCliente: 5 }), true);
  assert.equal(pv.descontoNoPadrao({ baseCentavos: 10000, descontoCentavos: 501, percentualDoCliente: 5 }), true, '1 centavo de folga');
  assert.equal(pv.descontoNoPadrao({ baseCentavos: 10000, descontoCentavos: 700, percentualDoCliente: 5 }), false);
  assert.equal(pv.descontoNoPadrao({ baseCentavos: 10000, descontoCentavos: 700, descontoGravadoCentavos: 700 }), true);
});

test('pedido aberto: o que mudou pede a permissao de pre-venda ou as do pedido pendente', () => {
  const aberto = { clienteId: 'c1', clienteNome: 'MARIA', itens: [{ id: 'p1', quantidade: 2 }, { id: 'p2', quantidade: 1 }] };
  const igual = { clienteId: 'c1', clienteNome: 'MARIA', itens: [{ id: 'p1', quantidade: 1 }, { id: 'p1', quantidade: 1 }, { id: 'p2', quantidade: 1 }] };
  assert.deepEqual(pv.permissoesDoPedidoAberto({ ehDoAgente: false, mudancas: pv.mudancasNoPedidoAberto(aberto, igual) }), []);
  const mudou = { clienteId: 'c2', clienteNome: 'JOAO', itens: [{ id: 'p1', quantidade: 3 }, { id: 'p3', quantidade: 1 }] };
  assert.deepEqual(pv.permissoesDoPedidoAberto({ ehDoAgente: false, mudancas: pv.mudancasNoPedidoAberto(aberto, mudou) }), ['vendas.pre_venda_editar']);
  assert.deepEqual(pv.permissoesDoPedidoAberto({ ehDoAgente: true, mudancas: pv.mudancasNoPedidoAberto(aberto, mudou) }), [
    'vendas.pedidos_pendentes_editar', 'vendas.finalizar',
    'vendas.pedidos_pendentes_editar_cliente', 'vendas.pedidos_pendentes_alterar_qtd',
    'vendas.pedidos_pendentes_adicionar_item', 'vendas.pedidos_pendentes_excluir_item',
  ]);
});

test('cadastro de quem gravou: dono e administrador podem; funcionario pelas efetivas', () => {
  assert.equal(pv.cadastroPode('dono', { tenantId: 'dono', role: 'Master' }, 'app.alterar_preco'), true);
  assert.equal(pv.cadastroPode('adm', { tenantId: 'loja', role: 'Admin' }, 'vendas.alterar_preco'), true);
  assert.equal(pv.cadastroPode('v1', { tenantId: 'loja', role: 'Funcionario', permissoes: ['vendas.pedidos'] }, 'vendas.alterar_preco'), true, 'pacote');
  assert.equal(pv.cadastroPode('v1', { tenantId: 'loja', role: 'Funcionario', permissoes: ['app.pedido'] }, 'app.alterar_preco'), false);
  assert.equal(pv.cadastroPode('v1', null, 'vendas.alterar_preco'), false);
});

// ---------------------------------------------------------------------------
// Fechamento da venda (services/vendaFechamento.js)
// ---------------------------------------------------------------------------

const carregar = (db) => carregarComBancoFalso(db, 'services/vendaFechamento')[3];

/** Funcionario ja' salvo depois da fase Vendas: vale so' o que esta' marcado. */
const salvo = (uid, permissoes) => ({ uid, tenantId: 'loja', email: `${uid}@loja`, nome: uid.toUpperCase(), permissoes: [...permissoes, ...MARCADORES] });
const TUDO = ['vendas.pedidos', 'vendas.finalizar', 'vendas.alterar_data', 'vendas.alterar_vendedor', 'vendas.alterar_preco', 'vendas.desconto'];
const sem = (...tirar) => salvo('vend1', TUDO.filter((p) => !tirar.includes(p)));

const pagamento = (valor) => ({
  id: 'pg1', forma: 'Dinheiro', valor: String(valor), prazoDias: '', parcelasAPrazo: '1', dataVencimento: '', bandeira: '', operadora: '',
  autorizacao: '', parcelas: '1', dataPrevistaRecebimento: '', bancoId: '', bancoNome: '', chequeBancoEmissor: '', chequeAgencia: '',
  chequeTitular: '', chequeEmitente: '', chequeDocumentoEmitente: '', chequeNumero: '',
});
const corpo = (extra = {}) => ({
  idDocumento: 'venda1',
  dataVenda: HOJE,
  vendedorId: 'vend1',
  clienteId: 'cli1',
  clienteNome: 'Maria',
  itens: [{ id: 'p1', nome: 'RAÇÃO', precoUnitario: 10, quantidade: 2, desconto: 0, subtotal: 20 }],
  descontoGeral: { tipo: 'valor', valorInformado: 0 },
  pagamentos: [pagamento(20)],
  ...extra,
});
const base = (extra = {}) => ({
  'configuracoes/loja': { tenantId: 'loja' },
  'usuarios/vend1': { tenantId: 'loja', nome: 'VENDEDOR UM', role: 'Funcionario' },
  'usuarios/vend2': { tenantId: 'loja', nome: 'VENDEDOR DOIS', role: 'Funcionario' },
  'clientes/cli1': { tenantId: 'loja', nome: 'MARIA' },
  'estoque/p1': { tenantId: 'loja', nome: 'RAÇÃO', quantidade: 10, quantidadeReservada: 0, precoVenda: 10 },
  ...extra,
});
const finalizar = (fake, user, c = corpo()) => carregar(fake.db).finalizarVenda({ user, tenantId: 'loja', corpo: c });

test('com tudo marcado (ou pelo pacote) a venda passa; sem "Finalizar venda" e\' recusada sem gravar', async () => {
  const ok = criarBancoFalso(base(), { consultas: true });
  await finalizar(ok, salvo('vend1', TUDO));
  assert.equal(ok.ler('pedidos_venda/venda1').status, 'Finalizada');

  const antigo = criarBancoFalso(base(), { consultas: true });
  await finalizar(antigo, { uid: 'vend1', tenantId: 'loja', permissoes: ['vendas.pedidos'] }, corpo({ dataVenda: '2026-10-13', vendedorId: 'vend2', itens: [{ id: 'p1', nome: 'RAÇÃO', precoUnitario: 12, quantidade: 2, desconto: 1, subtotal: 23 }], pagamentos: [pagamento(23)] }));
  assert.equal(antigo.ler('pedidos_venda/venda1').status, 'Finalizada', 'quem ja usava a tela nao perde nada');

  const semFinalizar = criarBancoFalso(base(), { consultas: true });
  await assert.rejects(() => finalizar(semFinalizar, sem('vendas.finalizar')), (e) => e.status === 403 && /"Vendas: Finalizar venda \(faturar\)"/.test(e.message));
  assert.equal(semFinalizar.ler('pedidos_venda/venda1'), undefined);
  assert.equal(semFinalizar.ler('estoque/p1').quantidade, 10);
});

test('sem a permissao, data, vendedor, preco e desconto ficam no padrao; diferente e\' recusado em portugues', async () => {
  const casos = [
    { user: sem('vendas.alterar_data'), corpo: corpo({ dataVenda: '2026-10-13' }), msg: /data 13\/10\/2026.*data diferente de hoje/s },
    { user: sem('vendas.alterar_vendedor'), corpo: corpo({ vendedorId: 'vend2' }), msg: /escolher o vendedor da venda/ },
    { user: sem('vendas.alterar_preco'), corpo: corpo({ itens: [{ id: 'p1', nome: 'RAÇÃO', precoUnitario: 12, quantidade: 2, desconto: 0, subtotal: 24 }], pagamentos: [pagamento(24)] }), msg: /RAÇÃO está a R\$ 12,00.*preço do cadastro/s },
    { user: sem('vendas.desconto'), corpo: corpo({ descontoGeral: { tipo: 'valor', valorInformado: 1 }, pagamentos: [pagamento(19)] }), msg: /dar desconto na venda/ },
  ];
  for (const caso of casos) {
    const fake = criarBancoFalso(base(), { consultas: true });
    await assert.rejects(() => finalizar(fake, caso.user, caso.corpo), (e) => e.status === 403 && caso.msg.test(e.message));
    assert.equal(fake.ler('pedidos_venda/venda1'), undefined);
  }
  // No padrao passa: data de hoje, vendedor logado, preco do cadastro, desconto do cliente.
  const padrao = criarBancoFalso(base({ 'clientes/cli1': { tenantId: 'loja', nome: 'MARIA', descontoPadraoPercentual: 10 } }), { consultas: true });
  await finalizar(padrao, salvo('vend1', ['vendas.pedidos', 'vendas.finalizar']), corpo({ descontoGeral: { tipo: 'percentual', valorInformado: 10 }, pagamentos: [pagamento(18)] }));
  assert.equal(padrao.ler('pedidos_venda/venda1').valorTotalCentavos, 1800);
});

test('pre-venda: preco e desconto gravados por quem podia valem para quem fatura sem a permissao; mudar itens pede editar', async () => {
  const preVenda = (gravadoPor) => base({
    'usuarios/vend1': { tenantId: 'loja', nome: 'VENDEDOR UM', role: 'Funcionario', permissoes: gravadoPor },
    'pedidos_venda/pv1': {
      tenantId: 'loja', status: 'Pré-venda', numeroPedido: '0042', origem: 'balcao', estoqueReservado: false, clienteId: 'cli1', clienteNome: 'MARIA',
      vendedorId: 'vend1', criadoPor: 'vend1', alteradoPor: 'vend1', valorTotalDescontosCentavos: 100,
      itens: [{ id: 'p1', nome: 'RAÇÃO', precoUnitario: 12, quantidade: 2, desconto: 1 }],
    },
  });
  const faturar = corpo({ idDocumento: undefined, pedidoId: 'pv1', itens: [{ id: 'p1', nome: 'RAÇÃO', precoUnitario: 12, quantidade: 2, desconto: 1, subtotal: 23 }], pagamentos: [pagamento(23)] });
  const FATURISTA = salvo('fat1', ['vendas.pre_venda_finalizar']);

  // Gravada por quem tinha preco e desconto (app: "App: Alterar o preco"): passa.
  const ok = criarBancoFalso(preVenda(['app.pedido', 'app.alterar_preco', 'vendas.desconto', ...MARCADORES]), { consultas: true });
  await finalizar(ok, FATURISTA, faturar);
  assert.equal(ok.ler('pedidos_venda/pv1').status, 'Finalizada');

  // Gravada por quem NAO podia mexer no preco (app sem a permissao): recusa.
  const semPreco = criarBancoFalso(preVenda(['app.pedido', 'vendas.desconto', ...MARCADORES]), { consultas: true });
  await assert.rejects(() => finalizar(semPreco, FATURISTA, faturar), (e) => e.status === 403 && /preço do sistema é R\$ 10,00/.test(e.message));
  assert.equal(semPreco.ler('pedidos_venda/pv1').status, 'Pré-venda');

  // Quantidade mudou na hora de faturar: pede "Pre-venda — Editar em Aberto".
  const mudou = criarBancoFalso(preVenda(['app.alterar_preco', 'vendas.desconto', ...MARCADORES]), { consultas: true });
  await assert.rejects(
    () => finalizar(mudou, FATURISTA, corpo({ idDocumento: undefined, pedidoId: 'pv1', itens: [{ id: 'p1', nome: 'RAÇÃO', precoUnitario: 12, quantidade: 3, desconto: 1, subtotal: 35 }], pagamentos: [pagamento(35)] })),
    (e) => e.status === 403 && /Pré-venda — Editar em Aberto/.test(e.message),
  );
});

test('pedido pendente do agente: finalizar pede editar/finalizar pendente; recusar passa pelo servidor', async () => {
  const pendente = base({
    'pedidos_venda/ag1': { tenantId: 'loja', status: 'Em Análise', numeroPedido: '0050', origem: 'agente', clienteId: 'cli1', clienteNome: 'MARIA', vendedorId: 'vend1', itens: [{ id: 'p1', nome: 'RAÇÃO', precoUnitario: 10, quantidade: 2 }] },
  });
  const c = corpo({ idDocumento: undefined, pedidoId: 'ag1' });
  const semPendente = criarBancoFalso(pendente, { consultas: true });
  await assert.rejects(() => finalizar(semPendente, salvo('vend1', TUDO), c), (e) => e.status === 403 && /Editar\/Finalizar Pedido Pendente/.test(e.message));
  const ok = criarBancoFalso(pendente, { consultas: true });
  await finalizar(ok, salvo('vend1', [...TUDO, 'vendas.pedidos_pendentes_editar']), c);
  assert.equal(ok.ler('pedidos_venda/ag1').status, 'Finalizada');

  const recusar = criarBancoFalso(pendente, { consultas: true });
  const { recusarPedidoPendente } = carregarComBancoFalso(recusar.db, 'services/pedidoPendente')[3];
  await assert.rejects(() => recusarPedidoPendente({ user: salvo('g1', []), tenantId: 'loja', corpo: { pedidoId: 'ag1', motivo: 'curto' } }), (e) => e.status === 400);
  const r = await recusarPedidoPendente({ user: salvo('g1', []), tenantId: 'loja', corpo: { pedidoId: 'ag1', motivo: 'cliente desistiu da compra' } });
  assert.equal(r.numeroPedido, '0050');
  assert.equal(recusar.ler('pedidos_venda/ag1').status, 'Cancelada');
  assert.equal(recusar.ler('pedidos_venda/ag1').motivoRecusa, 'cliente desistiu da compra');
  await assert.rejects(() => recusarPedidoPendente({ user: salvo('g1', []), tenantId: 'loja', corpo: { pedidoId: 'ag1', motivo: 'de novo, outra vez' } }), (e) => e.status === 409);
});

// ---------------------------------------------------------------------------
// Rotas de Condicional, Trocas e Entregas futuras (fase Vendas, parte 2)
// ---------------------------------------------------------------------------

const path = require('node:path');
const express = require('express');

/** Sobe a rota com o banco falso e o usuario vindo do cabecalho (auth falso). */
const comRota = async (fake, arquivo, base, corpoDoTeste) => {
  carregarComBancoFalso(fake.db, 'services/vendaFechamento');
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

test('condicional, trocas e entregas futuras: cada acao pede a sua permissao (nota de remessa pede Fiscal: Emitir)', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  await comRota(fake, 'routes/condicionais.routes', '/api/condicionais', async (chamar) => {
    const r = await chamar('/c1/cancelar', salvo('u1', ['vendas.condicional', 'vendas.condicional_saida']), { motivo: 'cliente desistiu' });
    assert.equal(r.status, 403);
    assert.match(r.corpo.error, /"Vendas: Condicional — cancelar"/);
  });
  await comRota(fake, 'routes/trocas.routes', '/api/trocas', async (chamar) => {
    const r = await chamar('/t1/aprovar', salvo('u1', ['vendas.troca_gerenciar', 'vendas.troca_entregar']));
    assert.equal(r.status, 403);
    assert.match(r.corpo.error, /aprovar ou recusar trocas/);
    const e = await chamar('/t1/entregar', salvo('u1', ['vendas.troca_gerenciar', 'vendas.troca_aprovar']));
    assert.equal(e.status, 403);
    assert.match(e.corpo.error, /"Vendas: Trocas — entregar \(baixa estoque\)"/);
  });
  await comRota(fake, 'routes/entregasFuturas.routes', '/api/entregas-futuras', async (chamar) => {
    const nota = await chamar('/entregas/e1/emitir-nota', salvo('u1', ['operacoes.entregas_futuras', 'operacoes.entregas_futuras_registrar']));
    assert.equal(nota.status, 403);
    assert.match(nota.corpo.error, /"Fiscal: Emitir Nota Fiscal"/);
    const entregar = await chamar('/p1/entregar', salvo('u1', ['operacoes.entregas_futuras']));
    assert.equal(entregar.status, 403);
    assert.match(entregar.corpo.error, /registrar entregas futuras/);
  });
});
