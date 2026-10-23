const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

/*
 * Custos e formacao de preco (23/10/2026): resumo dos 3 meses fechados,
 * gravacao da configuracao e simulacao dos produtos (nunca muda preco).
 */

const carregar = (db) => carregarComBancoFalso(db, 'services/custos')[3];
const USER = { uid: 'ger', tenantId: 'loja', email: 'g@loja' };

const mesesAntes = () => {
  const hoje = new Date();
  const ref = (k) => {
    const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - k, 10));
    return d.toISOString().slice(0, 10);
  };
  return [ref(3), ref(2), ref(1)];
};

const base = () => {
  const [m1, m2, m3] = mesesAntes();
  return {
    'configuracoes/loja': { tenantId: 'loja', planoContasDespesas: ['Aluguel', 'Salários', 'Marketing'] },
    'transacoes/a1': { tenantId: 'loja', tipo: 'saida', status: 'Paga', categoria: 'Aluguel', valorCentavos: 300000, dataPagamento: m1 },
    'transacoes/a2': { tenantId: 'loja', tipo: 'saida', status: 'Paga', categoria: 'Aluguel', valorCentavos: 300000, dataPagamento: m2 },
    'transacoes/a3': { tenantId: 'loja', tipo: 'saida', status: 'Paga', categoria: 'Aluguel', valorCentavos: 300000, dataPagamento: m3 },
    'transacoes/f1': { tenantId: 'loja', tipo: 'saida', status: 'Paga', categoria: 'Fornecedores', valorCentavos: 900000, dataPagamento: m2 },
    'transacoes/r1': { tenantId: 'loja', tipo: 'entrada', status: 'Paga', categoria: 'Venda', valorCentavos: 1500000, dataPagamento: m1 },
    'transacoes/r2': { tenantId: 'loja', tipo: 'entrada', status: 'Paga', categoria: 'Venda', valorCentavos: 1500000, dataPagamento: m2 },
    'transacoes/r3': { tenantId: 'loja', tipo: 'entrada', status: 'Paga', categoria: 'Venda', valorCentavos: 1500000, dataPagamento: m3 },
    'transacoes/pendente': { tenantId: 'loja', tipo: 'saida', status: 'Pendente', categoria: 'Aluguel', valorCentavos: 999999, dataPagamento: m3 },
    'transacoes/outra': { tenantId: 'outra', tipo: 'saida', status: 'Paga', categoria: 'Aluguel', valorCentavos: 999999, dataPagamento: m3 },
    'estoque/p1': { tenantId: 'loja', nome: 'RAÇÃO', codigo: '1', categoria: 'Ração', precoCusto: 50, precoVenda: 80 },
    'estoque/p2': { tenantId: 'loja', nome: 'COLEIRA', codigo: '2', categoria: 'PET', precoCusto: '10', precoVenda: '30', comissaoPercentual: '0' },
    'estoque/inativo': { tenantId: 'loja', nome: 'VELHO', precoCusto: 1, precoVenda: 2, statusAtivo: false },
    'estoque/grade': { tenantId: 'loja', nome: 'CAMISETA', temGrade: true, precoCusto: 1, precoVenda: 2 },
  };
};

test('carregar: categorias do plano e dos pagamentos; sem configuracao, nada marcado', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const r = await carregar(fake.db).carregar({ tenantId: 'loja' });
  assert.deepEqual(r.categorias.slice(0, 3), ['Aluguel', 'Salários', 'Marketing']);
  assert.ok(r.categorias.includes('Fornecedores'));
  assert.equal(r.resumo.mediaDespesaFixaCentavos, 0);
  assert.equal(r.resumo.faturamentoMedioCentavos, 1500000);
  assert.equal(r.config.margemPadrao, 20);
});

test('salvar e simular: rateio sobre o faturamento, Sebrae por produto, preco nunca muda', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  await assert.rejects(() => s.salvar({ user: USER, tenantId: 'loja', corpo: { bens: [{ nome: 'X', valorCentavos: 100, dataCompra: 'ontem', vidaUtilAnos: 5 }] } }), (e) => e.status === 400 && /data de compra/.test(e.message));
  const r = await s.salvar({ user: USER, tenantId: 'loja', corpo: {
    categoriasFixas: ['Aluguel'], impostoPercentual: 6, comissaoPercentual: 3, taxasPercentual: 1, margemPadrao: 20, margensPorGrupo: { 'RAÇÃO': 20 },
  } });
  assert.equal(r.resumo.mediaDespesaFixaCentavos, 300000);
  assert.equal(r.resumo.rateioPercentual, 20, 'aluguel 3000 / faturamento 15000');
  assert.equal(fake.ler('custos_empresa/loja').impostoPercentual, 6);
  const sim = await s.simular({ tenantId: 'loja' });
  assert.deepEqual(sim.linhas.map((l) => l.nome), ['COLEIRA', 'RAÇÃO'], 'inativo e principal de grade ficam fora');
  const racao = sim.linhas.find((l) => l.id === 'p1');
  assert.equal(racao.precoSugerido, 100, '50 / (1 - 50%)');
  assert.equal(racao.origemMargem, 'grupo');
  assert.equal(racao.lucroAtual, 6);
  const coleira = sim.linhas.find((l) => l.id === 'p2');
  assert.equal(coleira.precoSugerido, Math.round((10 / 0.53) * 100) / 100, 'comissao propria 0%');
  assert.equal(fake.ler('estoque/p1').precoVenda, 80, 'preco do produto intacto');
});
