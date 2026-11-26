const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

/*
 * Item 15 da Embala Minas, fase 1 (25/11/2026): cada acao do Contas a
 * Receber/Pagar que grava pelo servidor pede a SUA permissao. Quem tem a
 * permissao da tela e ainda nao teve as permissoes salvas de novo (sem o
 * marcador `pacote.financeiro-1`) ja' tem as novas -- ninguem perde acesso.
 * Firestore falso em memoria: nenhum banco e' tocado.
 */
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');
const {
  permissoesDaBaixa,
  permissoesQueFaltam,
  mensagemSemPermissao,
  podeNoFinanceiro,
} = require('../services/permissoesFinanceiro');
const { getDateInputInTimeZone } = require('../domain/dateTime');

const MARCADOR = 'pacote.financeiro-1';

/** Dia anterior a `hoje` (AAAA-MM-DD). */
const ontemDe = (hoje) => {
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

// ---------------------------------------------------------------------------
// Regras puras
// ---------------------------------------------------------------------------

test('baixa: pede dar baixa do tipo; data anterior quando traz; juros/multa so no Pagar (no Receber ficam no padrao)', () => {
  const hoje = '2026-11-25';
  assert.deepEqual(permissoesDaBaixa({ tipo: 'entrada', pedidos: [{ dataPagamento: hoje }], hoje }), ['financeiro.receber_baixar']);
  assert.deepEqual(permissoesDaBaixa({ tipo: 'saida', pedidos: [{ dataPagamento: hoje }], hoje }), ['financeiro.pagar_baixar']);
  // Receber: juros/multa nao pedem a permissao aqui -- sem ela ficam no padrao da filial (jurosNoPadrao).
  assert.deepEqual(
    permissoesDaBaixa({ tipo: 'entrada', pedidos: [{ dataPagamento: '2026-11-24', jurosCentavos: 150 }], hoje }),
    ['financeiro.receber_baixar', 'financeiro.baixa_data_anterior'],
  );
  assert.deepEqual(permissoesDaBaixa({ tipo: 'saida', pedidos: [{ dataPagamento: hoje, multaCentavos: 1 }], hoje }), ['financeiro.pagar_baixar', 'financeiro.baixa_juros_multa']);
  // Lote: a do lote + o que qualquer conta trouxer.
  assert.deepEqual(
    permissoesDaBaixa({ tipo: 'saida', pedidos: [{ dataPagamento: hoje }, { dataPagamento: hoje, acrescimoCentavos: 10 }], hoje, lote: true }),
    ['financeiro.pagar_baixar', 'financeiro.baixa_lote', 'financeiro.baixa_juros_multa'],
  );
  assert.deepEqual(
    permissoesDaBaixa({ tipo: 'entrada', pedidos: [{ dataPagamento: hoje, acrescimoCentavos: 10 }], hoje, lote: true }),
    ['financeiro.receber_baixar', 'financeiro.baixa_lote'],
  );
  // Desconto e' outra permissao (financeiro.desconto_baixa, conferida no servico): nao entra aqui.
  assert.deepEqual(permissoesDaBaixa({ tipo: 'entrada', pedidos: [{ dataPagamento: hoje, descontoCentavos: 500 }], hoje }), ['financeiro.receber_baixar']);
});

test('efetivas: so a da tela e sem o pacote passa; com o pacote vale o marcado; gestor sempre', () => {
  const soTela = { uid: 'f1', permissoes: ['financeiro.receber'] };
  assert.equal(podeNoFinanceiro(soTela, 'financeiro.receber_baixar'), true, 'ja vem marcada');
  assert.equal(podeNoFinanceiro(soTela, 'financeiro.pagar_baixar'), false, 'nao tem Contas a Pagar');
  const salvo = { uid: 'f2', permissoes: ['financeiro.receber', MARCADOR] };
  assert.equal(podeNoFinanceiro(salvo, 'financeiro.receber_baixar'), false, 'dono desmarcou ao salvar');
  assert.deepEqual(permissoesQueFaltam(salvo, ['financeiro.receber_baixar', 'financeiro.baixa_lote']), ['financeiro.receber_baixar', 'financeiro.baixa_lote']);
  assert.equal(podeNoFinanceiro({ uid: 'a', permissoes: [], dono: true }, 'financeiro.baixa_lote'), true);
  assert.equal(podeNoFinanceiro({ uid: 'p', permissoes: [], isPlatformAdmin: true }, 'financeiro.categorias'), true);
  assert.equal(podeNoFinanceiro({ uid: 'x' }, 'financeiro.receber_baixar'), false, 'sem lista nao quebra');
});

test('mensagem em portugues: cita o rotulo do cadastro e diz o que fazer', () => {
  const uma = mensagemSemPermissao(['financeiro.baixa_data_anterior']);
  assert.match(uma, /^Você não tem permissão para dar baixa com data anterior a hoje\./);
  assert.match(uma, /"Financeiro: dar baixa com data anterior a hoje \(Contas a Receber e a Pagar\)"/);
  assert.match(uma, /cadastro de funcionário/);
  assert.match(uma, /data de hoje/);
  const duas = mensagemSemPermissao(['financeiro.receber_baixar', 'financeiro.baixa_juros_multa']);
  assert.match(duas, /dar baixa em contas a receber e alterar juros e multa na baixa/);
  assert.match(duas, /"Financeiro: Contas a Receber — dar baixa \(receber\)" e "Financeiro: alterar juros e multa/);
});

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------

const contaAReceber = () => ({
  'transacoes/t1': {
    tenantId: 'emp1', tipo: 'entrada', status: 'Pendente', descricao: 'Venda Direta #12 - Boleto',
    valor: 100, valorCentavos: 10000, valorBruto: 100, valorBrutoCentavos: 10000, valorLiquido: 100, valorLiquidoCentavos: 10000,
    formaPagamento: 'Boleto', pedidoId: 'p12', paymentIndex: 1,
  },
  'transacoes/t2': {
    tenantId: 'emp1', tipo: 'entrada', status: 'Pendente', descricao: 'Venda Direta #13 - Boleto',
    valor: 50, valorCentavos: 5000, valorBruto: 50, valorBrutoCentavos: 5000, valorLiquido: 50, valorLiquidoCentavos: 5000,
    formaPagamento: 'Boleto', pedidoId: 'p13', paymentIndex: 1,
  },
  'pedidos_venda/p12': {
    tenantId: 'emp1', status: 'Finalizada',
    pagamentos: [{ id: 'p12', indice: 1, formaPagamento: 'Boleto', condicaoPagamento: 'aprazo', valorCentavos: 10000, valor: 100, status: 'pendente', naturezaFinanceira: 'boleto', movimentaCaixaFisico: false, transactionId: 't1' }],
  },
  'pedidos_venda/p13': {
    tenantId: 'emp1', status: 'Finalizada',
    pagamentos: [{ id: 'p13', indice: 1, formaPagamento: 'Boleto', condicaoPagamento: 'aprazo', valorCentavos: 5000, valor: 50, status: 'pendente', naturezaFinanceira: 'boleto', movimentaCaixaFisico: false, transactionId: 't2' }],
  },
  'bancos/b1': { tenantId: 'emp1', nome: 'Sicoob', ativo: true, saldoCentavos: 0 },
});

/** Sobe a rota do Financeiro com o banco falso e o usuario vindo do cabecalho (auth falso). */
const comRota = async (fake, corpoDoTeste) => {
  carregarComBancoFalso(fake.db, 'services/baixaFinanceira');
  const base = path.join(__dirname, '..');
  const substituir = (modulo, exportado) => {
    const caminho = require.resolve(path.join(base, modulo));
    require.cache[caminho] = { id: caminho, filename: caminho, loaded: true, exports: exportado };
  };
  substituir('middleware/auth', {
    authenticate: (req, res, next) => { req.user = JSON.parse(req.headers['x-usuario-teste'] || '{}'); next(); },
  });
  substituir('services/auditoria', { registrarLog: () => {}, registrarLogNaTransacao: () => {} });
  const rotaCaminho = require.resolve(path.join(base, 'routes/financeiro.routes'));
  delete require.cache[rotaCaminho];
  const app = express();
  app.use(express.json());
  app.use('/api/financeiro', require(rotaCaminho));
  const servidor = app.listen(0);
  try {
    const { port } = servidor.address();
    const chamar = async (rota, usuario, corpo) => {
      const resposta = await fetch(`http://127.0.0.1:${port}/api/financeiro${rota}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-usuario-teste': JSON.stringify({ tenantId: 'emp1', ...usuario }) },
        body: JSON.stringify(corpo),
      });
      return { status: resposta.status, corpo: await resposta.json() };
    };
    await corpoDoTeste(chamar);
  } finally {
    servidor.close();
  }
};

test('rota /baixa: so a permissao de tela (sem o pacote) passa; com o pacote e sem a nova, 403 em portugues', async () => {
  const fake = criarBancoFalso(contaAReceber());
  const hoje = getDateInputInTimeZone();
  await comRota(fake, async (chamar) => {
    const pedido = { tipo: 'entrada', transacaoId: 't1', formaPagamento: 'Pix', dataPagamento: hoje, bancoId: 'b1' };

    const salvoSemBaixa = await chamar('/baixa', { uid: 'f2', permissoes: ['financeiro.receber', MARCADOR] }, pedido);
    assert.equal(salvoSemBaixa.status, 403);
    assert.match(salvoSemBaixa.corpo.error, /Você não tem permissão para dar baixa em contas a receber/);
    assert.match(salvoSemBaixa.corpo.error, /"Financeiro: Contas a Receber — dar baixa \(receber\)"/);
    assert.equal(fake.ler('transacoes/t1').status, 'Pendente', 'nada gravado');

    const soPagar = await chamar('/baixa', { uid: 'f3', permissoes: ['financeiro.pagar'] }, pedido);
    assert.equal(soPagar.status, 403, 'quem so tem Contas a Pagar nao recebe');

    const soTela = await chamar('/baixa', { uid: 'f1', permissoes: ['financeiro.receber'] }, pedido);
    assert.equal(soTela.status, 200, JSON.stringify(soTela.corpo));
    assert.equal(fake.ler('transacoes/t1').status, 'Paga');
  });
});

test('rota /baixa: data anterior barrada sem a permissao; juros/multa do Receber sem a permissao so no padrao da filial', async () => {
  const fake = criarBancoFalso(contaAReceber());
  const hoje = getDateInputInTimeZone();
  const soBaixar = { uid: 'f4', permissoes: ['financeiro.receber', 'financeiro.receber_baixar', MARCADOR] };
  await comRota(fake, async (chamar) => {
    const pedido = { tipo: 'entrada', transacaoId: 't1', formaPagamento: 'Pix', dataPagamento: hoje, bancoId: 'b1' };

    // Conta sem vencimento (sem atraso): o padrao e' zero -- juros a mais nao passam.
    const comJuros = await chamar('/baixa', soBaixar, { ...pedido, jurosCentavos: 300 });
    assert.equal(comJuros.status, 403);
    assert.match(comJuros.corpo.error, /padrão da filial: R\$ 0,00 de juros e R\$ 0,00 de multa/);
    assert.match(comJuros.corpo.error, /alterar juros e multa na baixa/);

    const comMulta = await chamar('/baixa', soBaixar, { ...pedido, multaCentavos: 200 });
    assert.equal(comMulta.status, 403);

    const ontem = await chamar('/baixa', soBaixar, { ...pedido, dataPagamento: ontemDe(hoje) });
    assert.equal(ontem.status, 403);
    assert.match(ontem.corpo.error, /dar baixa com data anterior a hoje/);
    assert.equal(fake.ler('transacoes/t1').status, 'Pendente', 'nada gravado');

    // Com as duas permissoes (ou sendo administrador), passa.
    const completo = { uid: 'f5', permissoes: ['financeiro.receber_baixar', 'financeiro.baixa_juros_multa', 'financeiro.baixa_data_anterior', MARCADOR] };
    const ok = await chamar('/baixa', completo, { ...pedido, dataPagamento: ontemDe(hoje), jurosCentavos: 300 });
    assert.equal(ok.status, 200, JSON.stringify(ok.corpo));
    const admin = await chamar('/baixa', { uid: 'a1', permissoes: [], dono: true }, { ...pedido, transacaoId: 't2', dataPagamento: ontemDe(hoje), multaCentavos: 100 });
    assert.equal(admin.status, 200, 'administrador continua liberado nesta fase');
  });
});

test('rota /baixa-lote: pede a do lote; sem o pacote vem junto com Contas a Receber', async () => {
  const fake = criarBancoFalso(contaAReceber());
  const hoje = getDateInputInTimeZone();
  await comRota(fake, async (chamar) => {
    const lote = { tipo: 'entrada', formaPagamento: 'Pix', dataPagamento: hoje, bancoId: 'b1', titulos: [{ transacaoId: 't1' }, { transacaoId: 't2', acrescimoCentavos: 100 }] };

    const semLote = await chamar('/baixa-lote', { uid: 'f6', permissoes: ['financeiro.receber_baixar', 'financeiro.baixa_juros_multa', MARCADOR] }, lote);
    assert.equal(semLote.status, 403);
    assert.match(semLote.corpo.error, /dar baixa em lote/);
    assert.match(semLote.corpo.error, /conta por conta/);

    // Sem "alterar juros e multa": a conta com acrescimo fora do padrao da filial (zero, sem vencimento) e' recusada; a outra entra.
    const semJuros = await chamar('/baixa-lote', { uid: 'f7', permissoes: ['financeiro.receber_baixar', 'financeiro.baixa_lote', MARCADOR] }, lote);
    assert.equal(semJuros.status, 200, JSON.stringify(semJuros.corpo));
    assert.deepEqual(semJuros.corpo.resultados.map((r) => r.ok), [true, false]);
    assert.match(semJuros.corpo.resultados[1].erro, /padrão da filial/);
    assert.equal(fake.ler('transacoes/t2').status, 'Pendente', 'a conta com juros fora do padrao nao foi baixada');
  });
});

test('rotas de lancar/editar/cancelar, categoria e acerto: a permissao nova de cada uma', async () => {
  const fake = criarBancoFalso(contaAReceber());
  await comRota(fake, async (chamar) => {
    const salvoSoComTela = { uid: 'f8', permissoes: ['financeiro.receber', 'financeiro.pagar', MARCADOR] };
    const soTela = { uid: 'f1', permissoes: ['financeiro.receber'] };
    const casos = [
      ['/receber/lancar', 'financeiro.receber_lancar', /lançar contas a receber/],
      ['/receber/editar', 'financeiro.receber_editar', /alterar contas a receber/],
      ['/receber/cancelar', 'financeiro.receber_cancelar', /cancelar contas a receber/],
      ['/categorias', 'financeiro.categorias', /criar categorias no plano de contas/],
    ];
    for (const [rota, permissao, frase] of casos) {
      const barrado = await chamar(rota, salvoSoComTela, {});
      assert.equal(barrado.status, 403, rota);
      assert.match(barrado.corpo.error, frase, rota);
      // Com a permissao (gravada ou implicita), passa da permissao e cai na validacao do pedido vazio.
      const comEla = await chamar(rota, { uid: 'f9', permissoes: [permissao, MARCADOR] }, {});
      assert.notEqual(comEla.status, 403, `${rota} com ${permissao}`);
      const implicita = await chamar(rota, soTela, {});
      assert.notEqual(implicita.status, 403, `${rota} implicita`);
    }

    // Acerto: a dele + dar baixa nos dois lados.
    const semAcerto = await chamar('/acerto-fornecedor', { uid: 'f10', permissoes: ['financeiro.receber_baixar', 'financeiro.pagar_baixar', MARCADOR] }, {});
    assert.equal(semAcerto.status, 403);
    assert.match(semAcerto.corpo.error, /fazer acerto com fornecedor/);
    const soReceber = await chamar('/acerto-fornecedor', soTela, {});
    assert.equal(soReceber.status, 403, 'sem Contas a Pagar, como antes');
    assert.match(soReceber.corpo.error, /dar baixa em contas a pagar/);
    const receberEPagar = await chamar('/acerto-fornecedor', { uid: 'f11', permissoes: ['financeiro.receber', 'financeiro.pagar'] }, {});
    assert.notEqual(receberEPagar.status, 403, 'quem ja fazia continua fazendo');
    const desfazerSemAcerto = await chamar('/acerto-fornecedor/desfazer', { uid: 'f12', permissoes: ['financeiro.estornar', MARCADOR] }, {});
    assert.equal(desfazerSemAcerto.status, 403);
    assert.match(desfazerSemAcerto.corpo.error, /fazer acerto com fornecedor/);
  });
});

test('Receber sem "alterar juros e multa": conta vencida leva juros e multa do padrao da filial, nem menos nem mais', async () => {
  const hoje = getDateInputInTimeZone();
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 30);
  const vencimento = d.toISOString().slice(0, 10);
  const base = contaAReceber();
  base['transacoes/t1'] = { ...base['transacoes/t1'], dataVencimento: vencimento };
  // Filial: 2% de multa e 3% ao mes -> R$ 100,00 com 30 dias = R$ 2,00 de multa e R$ 3,00 de juros.
  base['configuracoes/emp1'] = { tenantId: 'emp1', parametrosVenda: { juros: { aoMesPercentual: 3, multaPercentual: 2 } } };
  const fake = criarBancoFalso(base);
  const soBaixar = { uid: 'f13', permissoes: ['financeiro.receber_baixar', MARCADOR] };
  await comRota(fake, async (chamar) => {
    const pedido = { tipo: 'entrada', transacaoId: 't1', formaPagamento: 'Pix', dataPagamento: hoje, bancoId: 'b1' };

    const semJuros = await chamar('/baixa', soBaixar, pedido);
    assert.equal(semJuros.status, 403, 'nao deixa de cobrar');
    assert.match(semJuros.corpo.error, /R\$ 3,00 de juros e R\$ 2,00 de multa/);
    const aMenos = await chamar('/baixa', soBaixar, { ...pedido, jurosCentavos: 100, multaCentavos: 200 });
    assert.equal(aMenos.status, 403);
    assert.equal(fake.ler('transacoes/t1').status, 'Pendente', 'nada gravado');

    const noPadrao = await chamar('/baixa', soBaixar, { ...pedido, jurosCentavos: 300, multaCentavos: 200 });
    assert.equal(noPadrao.status, 200, JSON.stringify(noPadrao.corpo));
    assert.equal(fake.ler('transacoes/t1').status, 'Paga');
  });
});

test('Receber com "alterar juros e multa": muda juros e multa a vontade', async () => {
  const hoje = getDateInputInTimeZone();
  const base = contaAReceber();
  base['transacoes/t1'] = { ...base['transacoes/t1'], dataVencimento: '2026-01-01' };
  base['configuracoes/emp1'] = { tenantId: 'emp1', parametrosVenda: { juros: { aoMesPercentual: 3, multaPercentual: 2 } } };
  const fake = criarBancoFalso(base);
  await comRota(fake, async (chamar) => {
    const pedido = { tipo: 'entrada', transacaoId: 't1', formaPagamento: 'Pix', dataPagamento: hoje, bancoId: 'b1' };
    const comPermissao = await chamar('/baixa', { uid: 'f14', permissoes: ['financeiro.receber_baixar', 'financeiro.baixa_juros_multa', MARCADOR] }, pedido);
    assert.equal(comPermissao.status, 200, JSON.stringify(comPermissao.corpo));
  });
});
