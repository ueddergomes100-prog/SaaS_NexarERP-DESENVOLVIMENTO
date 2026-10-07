const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

const HOJE = '2026-10-06';
const carregar = (db) => carregarComBancoFalso(db, 'services/spedyAcesso', 'services/notaTransferencia', 'services/transferencias').pop();

const grupo = {
  nome: 'SHOPPING RURAL', donoUid: 'dono', matrizTenantId: 'centro',
  filiais: [
    { tenantId: 'centro', codigo: '10', nome: 'CENTRO', cnpj: '11222333000181', uf: 'ES', cidade: 'VITORIA', tipo: 'cnpj_proprio', matriz: true, ativa: true },
    { tenantId: 'baixada', codigo: '20', nome: 'BAIXADA', cnpj: '11222333000262', uf: 'ES', cidade: 'SERRA', tipo: 'cnpj_proprio', ativa: true },
  ],
};

const base = (extra = {}) => ({
  'grupos/g1': grupo,
  'usuarios/dono': { tenantId: 'centro', role: 'Master', nome: 'DONO' },
  'usuarios/vend': { tenantId: 'baixada', role: 'Funcionario', permissoes: ['filiais.utilizar'], nivelAcesso: 'funcionario', nome: 'VENDEDOR' },
  'configuracoes/centro': { grupoId: 'g1', transferenciaSemNota: true },
  'configuracoes/baixada': { grupoId: 'g1', transferenciaSemNota: true },
  'estoque/p1': { tenantId: 'centro', nome: 'RAÇÃO 15KG', codigo: '1001', grupoChave: 'p1', filialOrigem: 'centro', quantidade: 20, precoCusto: 120, unidadeMedidaSigla: 'SC' },
  'estoque/p1_baixada': { tenantId: 'baixada', nome: 'RAÇÃO 15KG', codigo: '1001', grupoChave: 'p1', filialOrigem: 'centro', quantidade: 2, precoCusto: 100, unidadeMedidaSigla: 'SC' },
  'estoque/p2': { tenantId: 'centro', nome: 'ÓLEO 500ML', codigo: '2002', grupoChave: 'p2', filialOrigem: 'centro', quantidade: 5, precoCusto: 18, controlarLote: true, unidadeMedidaSigla: 'UN' },
  'estoque/p2_baixada': { tenantId: 'baixada', nome: 'ÓLEO 500ML', codigo: '2002', grupoChave: 'p2', filialOrigem: 'centro', quantidade: 0, precoCusto: 0, controlarLote: true },
  'estoque_lotes/l1': { tenantId: 'centro', produtoId: 'p2', lote: 'A1', validade: '2027-01-01', quantidade: 5 },
  ...extra,
});

const DONO_NO_CENTRO = { uid: 'dono', tenantId: 'centro', email: 'dono@teste' };
const DONO_NA_BAIXADA = { uid: 'dono', tenantId: 'baixada', email: 'dono@teste' };

test('envio sem nota: baixa na origem (com lote), numera e fica em transito', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  const r = await s.enviarTransferencia({ user: DONO_NO_CENTRO, corpo: { destino: 'baixada', itens: [{ produtoId: 'p1', quantidade: 8 }, { produtoId: 'p2', quantidade: 3 }], idDocumento: 'tr1' }, hoje: HOJE });
  assert.equal(r.numeroTransferencia, '0001');
  assert.equal(fake.ler('estoque/p1').quantidade, 12);
  assert.equal(fake.ler('estoque/p2').quantidade, 2);
  assert.equal(fake.ler('estoque_lotes/l1').quantidade, 2);
  const t = fake.ler('transferencias/tr1');
  assert.equal(t.status, 'em_transito');
  assert.deepEqual(t.tenantIds, ['centro', 'baixada']);
  assert.equal(t.itens[0].produtoIdDestino, 'p1_baixada');
  assert.deepEqual(t.itens[1].lotes.map((l) => [l.lote, l.quantidade]), [['A1', 3]]);
  assert.equal(fake.listar('ajustes_estoque/').filter((a) => a.motivo === 'transferencia_saida').length, 2);
  // Reenviar o mesmo envio (queda de internet) nao baixa de novo.
  const de_novo = await s.enviarTransferencia({ user: DONO_NO_CENTRO, corpo: { destino: 'baixada', itens: [{ produtoId: 'p1', quantidade: 8 }], idDocumento: 'tr1' }, hoje: HOJE });
  assert.equal(de_novo.jaEnviada, true);
  assert.equal(fake.ler('estoque/p1').quantidade, 12);
});

test('recebimento com falta: entra no destino com custo medio e lote, a falta volta para a origem', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  await s.enviarTransferencia({ user: DONO_NO_CENTRO, corpo: { destino: 'baixada', itens: [{ produtoId: 'p1', quantidade: 8 }, { produtoId: 'p2', quantidade: 3 }], idDocumento: 'tr1' }, hoje: HOJE });
  await assert.rejects(() => s.receberTransferencia({ user: DONO_NO_CENTRO, id: 'tr1', corpo: {} }), /Só a filial de destino recebe/);
  const r = await s.receberTransferencia({ user: DONO_NA_BAIXADA, id: 'tr1', corpo: { recebidas: { 1: 2 } } });
  assert.equal(r.divergente, true);
  assert.equal(fake.ler('estoque/p1_baixada').quantidade, 10);
  assert.equal(fake.ler('estoque/p1_baixada').precoCusto, 116);
  assert.equal(fake.ler('estoque/p2_baixada').quantidade, 2);
  const loteNovo = fake.listar('estoque_lotes/').find((l) => l.tenantId === 'baixada');
  assert.deepEqual([loteNovo.lote, loteNovo.quantidade, loteNovo.produtoId], ['A1', 2, 'p2_baixada']);
  assert.equal(fake.ler('estoque/p2').quantidade, 3, 'a unidade que faltou voltou para o centro');
  assert.equal(fake.ler('estoque_lotes/l1').quantidade, 3, 'e voltou para o mesmo lote');
  assert.equal(fake.ler('transferencias/tr1').status, 'recebida');
  await assert.rejects(() => s.receberTransferencia({ user: DONO_NA_BAIXADA, id: 'tr1', corpo: {} }), /já está recebida/);
});

test('recusa no destino e cancelamento na origem devolvem tudo; motivo obrigatorio', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  await s.enviarTransferencia({ user: DONO_NO_CENTRO, corpo: { destino: 'baixada', itens: [{ produtoId: 'p1', quantidade: 5 }], idDocumento: 'tr1' }, hoje: HOJE });
  await assert.rejects(() => s.desfazerTransferencia({ user: DONO_NA_BAIXADA, id: 'tr1', corpo: { motivo: 'x' }, acao: 'recusar' }), /motivo/);
  await assert.rejects(() => s.desfazerTransferencia({ user: DONO_NA_BAIXADA, id: 'tr1', corpo: { motivo: 'Não pedimos isso' }, acao: 'cancelar' }), /Só a filial que enviou/);
  await s.desfazerTransferencia({ user: DONO_NA_BAIXADA, id: 'tr1', corpo: { motivo: 'Não pedimos isso' }, acao: 'recusar' });
  assert.equal(fake.ler('estoque/p1').quantidade, 20);
  assert.equal(fake.ler('transferencias/tr1').status, 'recusada');
  assert.equal(fake.ler('estoque/p1_baixada').quantidade, 2, 'nada entrou no destino');
});

test('travas: sem nota desligada, funcionario sem nivel gerente, sem a permissao, destino invalido', async () => {
  const desligada = criarBancoFalso(base({ 'configuracoes/centro': { grupoId: 'g1' } }), { consultas: true });
  await assert.rejects(
    () => carregar(desligada.db).enviarTransferencia({ user: DONO_NO_CENTRO, corpo: { destino: 'baixada', itens: [{ produtoId: 'p1', quantidade: 1 }] }, hoje: HOJE }),
    /sem nota está desligada/,
  );
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  await assert.rejects(
    () => s.enviarTransferencia({ user: { uid: 'vend', tenantId: 'baixada' }, corpo: { destino: 'centro', itens: [{ produtoId: 'p1_baixada', quantidade: 1 }] }, hoje: HOJE }),
    /Só o dono ou um gerente/,
  );
  const semPermissao = criarBancoFalso(base({ 'usuarios/vend': { tenantId: 'baixada', role: 'Funcionario', permissoes: [] } }), { consultas: true });
  await assert.rejects(
    () => carregar(semPermissao.db).enviarTransferencia({ user: { uid: 'vend', tenantId: 'baixada' }, corpo: { destino: 'centro', itens: [{ produtoId: 'p1_baixada', quantidade: 1 }] }, hoje: HOJE }),
    /Utiliza outras filiais/,
  );
  await assert.rejects(() => s.enviarTransferencia({ user: DONO_NO_CENTRO, corpo: { destino: 'centro', itens: [{ produtoId: 'p1', quantidade: 1 }] }, hoje: HOJE }), /precisa ser outra/);
  await assert.rejects(() => s.enviarTransferencia({ user: DONO_NO_CENTRO, corpo: { destino: 'baixada', itens: [{ produtoId: 'p1', quantidade: 99 }] }, hoje: HOJE }), /Estoque insuficiente/);
});

// ---------------------------------------------------------------------------
// Fase 4: transferencia com nota (Spedy simulada)
// ---------------------------------------------------------------------------
const path = require('node:path');

const chamadasSpedy = [];
let respostaPost = null;
let respostaGet = null;
const caminhoFetch = require.resolve(path.join(__dirname, '..', 'utils/fetchComTimeout'));
const instalarSpedyFalsa = () => {
  require.cache[caminhoFetch] = {
    id: caminhoFetch, filename: caminhoFetch, loaded: true,
    exports: {
      PERFIS: { spedyEmissao: {}, spedyLeitura: {} },
      fetchComTimeout: async (url, init) => {
        chamadasSpedy.push({ url, metodo: init.method, corpo: init.body ? JSON.parse(init.body) : null });
        const r = init.method === 'POST' ? respostaPost : respostaGet;
        if (r instanceof Error) throw r;
        return { ok: r.ok !== false, status: r.status || 200, json: async () => r.corpo };
      },
    },
  };
};

const fiscal = { ncm: '23091000', csosn: '102', origem: '0', cfop: '5102', cstPis: '99', cstCofins: '99' };
const comNota = (extra = {}) => base({
  'configuracoes/centro': {
    grupoId: 'g1', cnpj: '11222333000181', razaoSocial: 'SHOPPING RURAL CENTRO LTDA', uf: 'ES', regimeTributario: 'simples_nacional',
    spedyEnabled: true, spedyEnvironment: 'sandbox',
  },
  'configuracoes_privadas/centro': { spedyApiKey: 'chave-teste' },
  'configuracoes/baixada': {
    grupoId: 'g1', cnpj: '11222333000262', razaoSocial: 'SHOPPING RURAL BAIXADA LTDA', inscricaoEstadual: '082123456', rua: 'RUA B',
    numero: '10', bairro: 'CENTRO', cep: '29160000', nfseCidadeCodigo: '3205002', nfseCidadeNome: 'Serra', nfseCidadeEstado: 'ES', uf: 'ES',
  },
  'estoque/p1': { tenantId: 'centro', nome: 'RAÇÃO 15KG', codigo: '1001', grupoChave: 'p1', filialOrigem: 'centro', quantidade: 20, precoCusto: 120, unidadeMedidaSigla: 'SC', ...fiscal },
  ...extra,
});

test('com nota: baixa, emite a NF-e 5152 pelo custo e o destino so recebe com a nota autorizada, lancando a entrada 1152', async () => {
  instalarSpedyFalsa();
  chamadasSpedy.length = 0;
  respostaPost = { corpo: { id: 'sp1', status: 'enqueued' } };
  respostaGet = { corpo: { id: 'sp1', status: 'enqueued' } };
  const fake = criarBancoFalso(comNota(), { consultas: true });
  const s = carregar(fake.db);
  const r = await s.enviarTransferencia({ user: DONO_NO_CENTRO, corpo: { destino: 'baixada', comNota: true, itens: [{ produtoId: 'p1', quantidade: 2 }], idDocumento: 'tn1' }, hoje: HOJE });
  assert.equal(r.nota.status, 'enqueued');
  assert.equal(fake.ler('estoque/p1').quantidade, 18);
  const t = fake.ler('transferencias/tn1');
  assert.equal(t.comNota, true);
  assert.equal(t.notaFiscal.status, 'enqueued');
  assert.deepEqual(t.notaFiscal.cfopsEntrada, ['1152']);
  const nota = fake.ler(`notas_fiscais/${t.notaFiscal.notaId}`);
  assert.equal(nota.finalidade, 'transferencia');
  assert.equal(nota.transferenciaId, 'tn1');
  assert.equal('pedidoId' in nota, false);
  assert.equal(nota.tenantId, 'centro');
  const envio = chamadasSpedy.find((c) => c.metodo === 'POST').corpo;
  assert.equal(envio.integrationId, 'transf-tn1');
  assert.equal(envio.items[0].cfop, 5152);
  assert.equal(envio.items[0].totalAmount, 240);
  assert.equal(envio.receiver.federalTaxNumber, '11222333000262');

  await assert.rejects(() => s.receberTransferencia({ user: DONO_NA_BAIXADA, id: 'tn1', corpo: {} }), /ainda não foi autorizada/);

  respostaGet = { corpo: { id: 'sp1', status: 'authorized', number: 15, accessKey: '3'.repeat(44) } };
  await assert.rejects(() => s.desfazerTransferencia({ user: DONO_NO_CENTRO, id: 'tn1', corpo: { motivo: 'desisti do envio' }, acao: 'cancelar' }), /nº 15 desta transferência já foi autorizada/);
  const recebido = await s.receberTransferencia({ user: DONO_NA_BAIXADA, id: 'tn1', corpo: {} });
  assert.equal(recebido.divergente, false);
  assert.equal(fake.ler('estoque/p1_baixada').quantidade, 4);
  const depois = fake.ler('transferencias/tn1');
  assert.equal(depois.status, 'recebida');
  assert.equal(depois.notaFiscal.status, 'authorized');
  const entrada = fake.ler(`notas_fiscais_entrada/${depois.entradaNotaId}`);
  assert.equal(entrada.tenantId, 'baixada');
  assert.equal(entrada.numeroNF, '15');
  assert.equal(entrada.chaveAcesso, '3'.repeat(44));
  assert.equal(entrada.itens[0].cfop, '1152');
  assert.equal(entrada.itens[0].itemId, 'p1_baixada');
  assert.deepEqual(entrada.titulosPagarIds, []);
  const fornecedor = fake.ler(`fornecedores/${entrada.fornecedorId}`);
  assert.equal(fornecedor.cnpj, '11222333000181');
  assert.equal(fornecedor.tenantId, 'baixada');
});

test('com nota: Spedy recusa -> a transferencia e cancelada e o estoque volta; cadastro incompleto nem mexe no estoque', async () => {
  instalarSpedyFalsa();
  respostaPost = { ok: false, status: 400, corpo: { errors: [{ message: 'Inscrição estadual do destinatário inválida.' }] } };
  const fake = criarBancoFalso(comNota(), { consultas: true });
  const s = carregar(fake.db);
  await assert.rejects(
    () => s.enviarTransferencia({ user: DONO_NO_CENTRO, corpo: { destino: 'baixada', comNota: true, itens: [{ produtoId: 'p1', quantidade: 2 }], idDocumento: 'tn2' }, hoje: HOJE }),
    /não foi emitida: Inscrição estadual do destinatário inválida\..*foi cancelada e o estoque voltou/,
  );
  assert.equal(fake.ler('estoque/p1').quantidade, 20);
  assert.equal(fake.ler('transferencias/tn2').status, 'cancelada');
  assert.equal(fake.ler('transferencias/tn2').notaFiscal.status, 'nao_emitida');

  const semIe = criarBancoFalso(comNota({ 'configuracoes/baixada': { grupoId: 'g1', cnpj: '11222333000262', razaoSocial: 'X', uf: 'ES' } }), { consultas: true });
  const s2 = carregar(semIe.db);
  await assert.rejects(
    () => s2.enviarTransferencia({ user: DONO_NO_CENTRO, corpo: { destino: 'baixada', comNota: true, itens: [{ produtoId: 'p1', quantidade: 2 }], idDocumento: 'tn3' }, hoje: HOJE }),
    /A nota fiscal não pode sair: .*inscrição estadual/,
  );
  assert.equal(semIe.ler('estoque/p1').quantidade, 20);
  assert.equal(semIe.ler('transferencias/tn3'), undefined);
});

test('com nota: rejeitada pela SEFAZ, a origem emite de novo com outra tentativa', async () => {
  instalarSpedyFalsa();
  respostaPost = { corpo: { id: 'sp1', status: 'enqueued' } };
  respostaGet = { corpo: { id: 'sp1', status: 'enqueued' } };
  const fake = criarBancoFalso(comNota(), { consultas: true });
  const s = carregar(fake.db);
  await s.enviarTransferencia({ user: DONO_NO_CENTRO, corpo: { destino: 'baixada', comNota: true, itens: [{ produtoId: 'p1', quantidade: 1 }], idDocumento: 'tn4' }, hoje: HOJE });
  await assert.rejects(() => s.reemitirNota({ user: DONO_NO_CENTRO, id: 'tn4' }), /na fila da SEFAZ: não precisa emitir de novo/);
  respostaGet = { corpo: { id: 'sp1', status: 'rejected', processingDetail: { message: 'Rejeição 999' } } };
  respostaPost = { corpo: { id: 'sp2', status: 'enqueued' } };
  chamadasSpedy.length = 0;
  const r = await s.reemitirNota({ user: DONO_NO_CENTRO, id: 'tn4' });
  assert.equal(r.nota.tentativa, 2);
  assert.equal(r.nota.spedyId, 'sp2');
  assert.equal(chamadasSpedy.find((c) => c.metodo === 'POST').corpo.integrationId, 'transf-tn4-t2');
  await assert.rejects(() => s.reemitirNota({ user: DONO_NA_BAIXADA, id: 'tn4' }), /Só a filial que enviou/);
});
