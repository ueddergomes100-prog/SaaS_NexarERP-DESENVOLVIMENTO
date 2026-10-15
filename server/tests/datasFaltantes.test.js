const test = require('node:test');
const assert = require('node:assert/strict');
const { preencherDatasFaltantes, LIMITE_LISTA } = require('../services/datasFaltantes');

/*
 * Banco falso so' com o que o servico usa: collection().where().get(),
 * collection().get(), batch().update()/commit(). Conta os commits para
 * provar que "simular" nao grava e que os lotes respeitam o tamanho.
 */
const APAGAR = { __apagar: true };
const criarBanco = (colecoes) => {
  const dados = new Map();
  for (const [nome, docs] of Object.entries(colecoes)) {
    for (const [id, valor] of Object.entries(docs)) dados.set(`${nome}/${id}`, structuredClone(valor));
  }
  const estado = { commits: 0, escritasPorCommit: [] };
  const consulta = (nome, filtros) => ({
    where: (campo, op, valor) => consulta(nome, [...filtros, [campo, op, valor]]),
    get: async () => {
      const docs = [...dados.entries()]
        .filter(([chave]) => chave.startsWith(`${nome}/`))
        .filter(([, v]) => filtros.every(([campo, op, valor]) => op === '==' && v[campo] === valor))
        .map(([chave, v]) => ({ id: chave.slice(nome.length + 1), data: () => structuredClone(v), ref: { chave } }));
      return { size: docs.length, docs };
    },
  });
  const db = {
    collection: (nome) => consulta(nome, []),
    batch: () => {
      const escritas = [];
      return {
        update: (ref, campos) => escritas.push([ref.chave, campos]),
        commit: async () => {
          estado.commits += 1;
          estado.escritasPorCommit.push(escritas.length);
          for (const [chave, campos] of escritas) {
            const atual = dados.get(chave);
            for (const [campo, valor] of Object.entries(campos)) {
              if (valor === APAGAR) delete atual[campo];
              else atual[campo] = valor;
            }
          }
        },
      };
    },
  };
  return { db, estado, ler: (chave) => dados.get(chave) };
};

// 14/09 02h30 UTC = 13/09 23h30 em Sao Paulo: o dia certo e' 13/09.
const criado = { _seconds: Math.floor(new Date('2026-09-14T02:30:00Z').getTime() / 1000) };

const cenario = () => criarBanco({
  pedidos_venda: {
    p1: { tenantId: 'A', numeroPedido: '0001', createdAt: criado },
    p2: { tenantId: 'A', numeroPedido: '0002', dataVenda: '2026-09-01', createdAt: criado },
    p3: { tenantId: 'B', numeroPedido: '0003', createdAt: criado },
    p4: { tenantId: 'B', numeroPedido: '0004' },
  },
  transacoes: {
    t1: { tenantId: 'A', status: 'Paga', descricao: 'Recebimento OS', createdAt: criado },
    t2: { tenantId: 'A', status: 'Pendente', descricao: 'Boleto sem vencimento', createdAt: criado },
    t3: { tenantId: 'B', status: 'Paga', data: '2026-09-02', createdAt: criado },
  },
});

const usar = (banco, opcoes) => preencherDatasFaltantes({ db: banco.db, apagar: () => APAGAR, ...opcoes });
const daColecao = (resultado, nome) => resultado.colecoes.find((c) => c.nome === nome);

test('simular conta o que faria e nao grava nada', async () => {
  const banco = cenario();
  const r = await usar(banco, {});
  const pedidos = daColecao(r, 'pedidos_venda');
  assert.deepEqual([pedidos.lidos, pedidos.ok, pedidos.alterados, pedidos.totalSemData], [4, 1, 2, 1]);
  assert.match(pedidos.semData[0], /B \/ pedido #0004 \(p4\)/);
  const lancamentos = daColecao(r, 'transacoes');
  assert.deepEqual([lancamentos.lidos, lancamentos.ok, lancamentos.alterados, lancamentos.totalPendentesSemVencimento], [3, 1, 1, 1]);
  assert.equal(banco.estado.commits, 0);
  assert.equal(banco.ler('pedidos_venda/p1').dataVenda, undefined);
});

test('aplicar grava o dia da criacao com a marca, e so nos que faltam', async () => {
  const banco = cenario();
  await usar(banco, { aplicar: true });
  assert.equal(banco.ler('pedidos_venda/p1').dataVenda, '2026-09-13');
  assert.equal(banco.ler('pedidos_venda/p1').dataVendaPreenchidaPorMigracao, true);
  assert.equal(banco.ler('pedidos_venda/p2').dataVenda, '2026-09-01');
  assert.equal(banco.ler('pedidos_venda/p2').dataVendaPreenchidaPorMigracao, undefined);
  assert.equal(banco.ler('pedidos_venda/p4').dataVenda, undefined, 'sem criacao: nao inventa');
  assert.equal(banco.ler('transacoes/t1').dataPagamento, '2026-09-13');
  assert.equal(banco.ler('transacoes/t2').dataPagamento, undefined, 'pendente sem vencimento so e listado');
  assert.equal(banco.ler('transacoes/t3').dataPagamento, undefined, 'pago com data fica como esta');
});

test('rodar de novo depois de aplicar nao muda nada', async () => {
  const banco = cenario();
  await usar(banco, { aplicar: true });
  const r = await usar(banco, { aplicar: true });
  assert.equal(r.colecoes.reduce((soma, c) => soma + c.alterados, 0), 0);
});

test('desfazer apaga so o que a tarefa gravou', async () => {
  const banco = cenario();
  await usar(banco, { aplicar: true });
  const r = await usar(banco, { aplicar: true, desfazer: true });
  assert.equal(daColecao(r, 'pedidos_venda').alterados, 2);
  assert.equal(banco.ler('pedidos_venda/p1').dataVenda, undefined);
  assert.equal(banco.ler('pedidos_venda/p1').dataVendaPreenchidaPorMigracao, undefined);
  assert.equal(banco.ler('pedidos_venda/p2').dataVenda, '2026-09-01', 'data que ja existia continua');
  assert.equal(banco.ler('transacoes/t1').dataPagamento, undefined);
});

test('com empresa escolhida, mexe so nela', async () => {
  const banco = cenario();
  const r = await usar(banco, { aplicar: true, tenantId: 'B' });
  assert.equal(daColecao(r, 'pedidos_venda').lidos, 2);
  assert.equal(banco.ler('pedidos_venda/p1').dataVenda, undefined, 'empresa A intocada');
  assert.equal(banco.ler('pedidos_venda/p3').dataVenda, '2026-09-13');
});

test('grava em lotes de no maximo 400 e lista no maximo o limite, com o total', async () => {
  const pedidos = {};
  for (let i = 0; i < 950; i += 1) pedidos[`p${i}`] = { tenantId: 'A', numeroPedido: String(i), createdAt: criado };
  for (let i = 0; i < 70; i += 1) pedidos[`s${i}`] = { tenantId: 'A', numeroPedido: `S${i}` };
  const banco = criarBanco({ pedidos_venda: pedidos, transacoes: {} });
  const r = await usar(banco, { aplicar: true });
  assert.deepEqual(banco.estado.escritasPorCommit, [400, 400, 150]);
  const resumo = daColecao(r, 'pedidos_venda');
  assert.equal(resumo.alterados, 950);
  assert.equal(resumo.totalSemData, 70);
  assert.equal(resumo.semData.length, LIMITE_LISTA);
});
