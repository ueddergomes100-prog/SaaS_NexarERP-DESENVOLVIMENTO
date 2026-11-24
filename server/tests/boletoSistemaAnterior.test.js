const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

/*
 * Boletos do sistema anterior (24/11/2026, Embala Minas): o servidor liga a
 * conta migrada ao boleto que o sistema antigo registrou; depois o retorno do
 * banco da' baixa nela pelo caminho de sempre.
 */

const carregar = (db) => {
  const servicos = carregarComBancoFalso(db, 'services/boletoSistemaAnterior');
  return { movimento: servicos[1], vinculo: servicos[3] };
};

const USER = { uid: 'u1', email: 'u1@loja', tenantId: 'loja', permissoes: ['financeiro.boletos'] };
const HOJE = '2026-11-24';

const conta = (chave, valorCentavos, extra = {}) => ({
  tenantId: 'loja', tipo: 'entrada', status: 'Pendente', descricao: `Contrato ${chave}`, clienteNome: 'ZE',
  valor: valorCentavos / 100, valorCentavos, data: '2026-11-23', origemImportacao: 'migracao_cadastro', chaveImportacao: chave, ...extra,
});

const base = (extra = {}) => ({
  'bancos/sicoob': { tenantId: 'loja', nome: 'SICOOB', ativo: true, agencia: '3049', conta: '24424', saldoCentavos: 100000, boleto: { ativo: true, contaDv: '4', codigoCliente: '580490' } },
  'bancos/outro': { tenantId: 'outra', nome: 'DE OUTRA EMPRESA', ativo: true, agencia: '3049', boleto: { ativo: true } },
  'transacoes/t1': conta('clidoc-56992', 27120),
  'transacoes/t2': conta('clidoc-56993', 2152),
  'transacoes/t3': conta('clidoc-50000', 5000, { status: 'Paga' }),
  'transacoes/t4': conta('clidoc-60000', 7000, { tenantId: 'outra' }),
  'transacoes/novo': { tenantId: 'loja', tipo: 'entrada', status: 'Pendente', descricao: 'Venda #113731', valorCentavos: 1000, boleto: { nossoNumero: '0000040710', status: 'emitido' } },
  ...extra,
});

const boleto = (chave, nossoNumero, valorBoletoCentavos, extra = {}) => ({ chave, nossoNumero, vencimento: '2026-11-23', emissao: '2026-10-10', valorBoletoCentavos, arquivoRemessa: 'CNAB240_1.txt', ...extra });

test('vincula as contas migradas; repetir nao muda; retorno da baixa pelo nosso numero', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  const corpo = {
    bancoId: 'sicoob',
    boletos: [
      boleto('clidoc-56992', '3978-9', 27120),
      boleto('clidoc-56993', '3979-6', 18587), // parte paga no sistema anterior
      boleto('clidoc-50000', '3981-1', 5000), // ja' paga aqui
      boleto('clidoc-60000', '3982-9', 7000), // de outra empresa: nao acha
      boleto('clidoc-99999', '4070-4', 100), // digito de outro convenio
    ],
  };
  const r = await s.vinculo.vincularBoletosAnteriores({ user: USER, tenantId: 'loja', corpo, hoje: HOJE });
  assert.equal(r.vinculados, 2);
  assert.equal(r.totalCentavos, 27120 + 2152);
  assert.equal(r.jaPagos, 1);
  assert.equal(r.recusados.length, 2);
  assert.match(r.recusados[0].motivo, /4070-4 não é do convênio do banco SICOOB/);
  assert.match(r.recusados[1].motivo, /chave clidoc-60000 não foi encontrada/);
  assert.equal(r.avisos.length, 1);

  const t1 = fake.ler('transacoes/t1');
  assert.equal(t1.formaPagamento, 'Boleto');
  assert.equal(t1.bancoId, 'sicoob');
  assert.equal(t1.bancoNome, 'SICOOB');
  assert.equal(t1.valorCentavos, 27120);
  assert.deepEqual({ ...t1.boleto }, {
    nossoNumero: '0000039789', linhaDigitavel: '', codigoBarras: '', vencimento: '2026-11-23', dataEmissao: '2026-10-10',
    status: 'em_remessa', numeroRemessa: 0, sistemaAnterior: true, remessaSistemaAnterior: 'CNAB240_1.txt',
  });
  assert.equal(fake.ler('transacoes/t2').boleto.valorNoBancoCentavos, 18587);
  assert.equal(fake.ler('transacoes/t3').boleto, undefined);
  assert.equal(fake.ler('transacoes/t4').boleto, undefined);
  // Banco nao mexe no vinculo.
  assert.equal(fake.ler('bancos/sicoob').saldoCentavos, 100000);

  const deNovo = await s.vinculo.vincularBoletosAnteriores({ user: USER, tenantId: 'loja', corpo, hoje: HOJE });
  assert.equal(deNovo.vinculados, 0);
  assert.equal(deNovo.jaVinculados, 2);

  // O retorno do banco (mesmo caminho de qualquer boleto) da' baixa e credita o banco.
  const baixa = await s.movimento.baixarBoletoPeloRetorno({ user: USER, tenantId: 'loja', corpo: { transacaoId: 't1', valorPagoCentavos: 27120, dataPagamento: '2026-11-24' }, hoje: HOJE });
  assert.equal(baixa.jaEstavaPago, false);
  assert.equal(fake.ler('transacoes/t1').status, 'Paga');
  assert.equal(fake.ler('transacoes/t1').boleto.status, 'pago');
  assert.equal(fake.ler('bancos/sicoob').saldoCentavos, 127120);
});

test('nosso numero usado em outro titulo, banco de outra empresa ou sem boleto: recusa', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  const r = await s.vinculo.vincularBoletosAnteriores({ user: USER, tenantId: 'loja', corpo: { bancoId: 'sicoob', boletos: [boleto('clidoc-56992', '4071-0', 27120)] }, hoje: HOJE });
  assert.equal(r.vinculados, 0);
  assert.match(r.recusados[0].motivo, /já está no título "Venda #113731"/);
  assert.equal(fake.ler('transacoes/t1').boleto, undefined);

  await assert.rejects(
    s.vinculo.vincularBoletosAnteriores({ user: USER, tenantId: 'loja', corpo: { bancoId: 'outro', boletos: [boleto('clidoc-56992', '3978-9', 27120)] }, hoje: HOJE }),
    /Banco não encontrado/,
  );
  const semBoleto = criarBancoFalso(base({ 'bancos/sicoob': { tenantId: 'loja', nome: 'SICOOB', ativo: true, agencia: '3049' } }), { consultas: true });
  await assert.rejects(
    carregar(semBoleto.db).vinculo.vincularBoletosAnteriores({ user: USER, tenantId: 'loja', corpo: { bancoId: 'sicoob', boletos: [boleto('clidoc-56992', '3978-9', 27120)] }, hoje: HOJE }),
    /não está preparado para boleto/,
  );
});
