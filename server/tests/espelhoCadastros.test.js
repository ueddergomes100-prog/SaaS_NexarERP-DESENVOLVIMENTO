const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

const carregar = () => carregarComBancoFalso(criarBancoFalso({}).db, 'services/espelhoCadastros')[3];
const espelho = require('../domain/cadastroGrupoDomain');

const grupo = {
  nome: 'SHOPPING RURAL',
  matrizTenantId: 'matriz',
  filiais: [{ tenantId: 'matriz' }, { tenantId: 'baixada' }],
};

const indices = () => Object.fromEntries(espelho.COLECOES_ESPELHADAS.map((c) => [c, espelho.criarIndice()]));

test('primeira leitura: unidades ligadas, produto copiado com a unidade da filial, e reprocessar nao grava nada', async () => {
  const { processarLote } = carregar();
  const idx = indices();
  const gravado = [];
  const gravar = async (colecao, gravacoes) => { gravado.push(...gravacoes.map((g) => ({ colecao, ...g }))); };

  await processarLote({
    grupo, colecao: 'unidades_medida', indices: idx, gravar,
    docs: [
      { id: 'unA', tenantId: 'matriz', dados: { tenantId: 'matriz', sigla: 'SC', nome: 'Saco' } },
      { id: 'unB', tenantId: 'baixada', dados: { tenantId: 'baixada', sigla: 'SC', nome: 'Saco' } },
    ],
  });
  assert.equal(gravado.find((g) => g.id === 'unB').campos.grupoChave, 'unA', 'unidade igual e\' ligada, nao duplicada');

  await processarLote({
    grupo, colecao: 'estoque', indices: idx, gravar,
    docs: [{ id: 'p1', tenantId: 'matriz', dados: { tenantId: 'matriz', nome: 'RAÇÃO', codigo: '1', unidadeMedidaId: 'unA', unidadeMedidaSigla: 'SC', precoVenda: 50, quantidade: 9 } }],
  });
  const copia = gravado.find((g) => g.id === 'p1_baixada');
  assert.equal(copia.tipo, 'criar');
  assert.equal(copia.campos.unidadeMedidaId, 'unB');
  assert.equal(copia.campos.quantidade, 0);
  assert.equal(copia.campos.precoVenda, 50);

  // O eco das gravacoes chega pela escuta: nada mais a gravar.
  const antes = gravado.length;
  await processarLote({
    grupo, colecao: 'estoque', indices: idx, gravar,
    docs: [
      { id: 'p1', tenantId: 'matriz', dados: idx.estoque.porId.get('p1').dados },
      { id: 'p1_baixada', tenantId: 'baixada', dados: idx.estoque.porId.get('p1_baixada').dados },
    ],
  });
  assert.equal(gravado.length, antes);
});

test('sem nada a fazer, nao chama a gravacao', async () => {
  const { processarLote } = carregar();
  let chamadas = 0;
  const r = await processarLote({ grupo, colecao: 'clientes', indices: indices(), docs: [], gravar: async () => { chamadas += 1; } });
  assert.deepEqual(r, []);
  assert.equal(chamadas, 0);
});
