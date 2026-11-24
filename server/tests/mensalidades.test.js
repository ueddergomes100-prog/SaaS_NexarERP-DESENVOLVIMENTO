const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

const carregar = (db) => carregarComBancoFalso(db, 'services/mensalidades')[3];
const ADMIN = { uid: 'plataforma', nome: 'Uedder', role: 'SuperAdmin', isPlatformAdmin: true };
const LINHA = '23793381286000000000300000000400184340000014990';

const banco = () => criarBancoFalso({
  'usuarios/dono': { tenantId: 'dono', role: 'Master', nomeOficina: 'LOJA TESTE', email: 'dono@loja.com', valorMensalidade: 200, percentualFilial: 50 },
  'usuarios/func': { tenantId: 'dono', role: 'Funcionario' },
  'usuarios/daFilial': { tenantId: 'f20', role: 'Funcionario' },
  'usuarios/suporte': { tenantId: 'dono', role: 'SuperAdmin' },
  'usuarios/outra': { tenantId: 'outra', role: 'Master' },
  'configuracoes/dono': { tenantId: 'dono', grupoId: 'g1', telefone: '(33) 99999-0000' },
  'configuracoes/f20': { tenantId: 'f20', grupoId: 'g1' },
  'grupos/g1': {
    matrizTenantId: 'dono',
    filiais: [
      { tenantId: 'dono', codigo: '10', nome: 'MATRIZ', matriz: true, ativa: true },
      { tenantId: 'f20', codigo: '20', nome: 'FILIAL', matriz: false, ativa: true },
    ],
  },
  'plataforma/cobranca': { prazos: { diasLembreteAntes: 3, diasAvisoForte: 5, diasBloqueio: 10 }, contato: { whatsapp: '33988887777' } },
}, { consultas: true });

const ligar = (s, hoje = '2026-11-24') => s.salvarPlanoDaEmpresa({ user: ADMIN, tenantId: 'dono', ativa: true, diaVencimento: 10, prazos: null, hoje });
// Sem boleto a mensalidade nao avisa nem bloqueia (decisao do dono): os cenarios de cobranca anexam.
const gerarComBoleto = async (s, competencia = '2026-11', tenantId = 'dono') => {
  const r = await s.gerarMensalidade({ user: ADMIN, tenantId, competencia, hoje: '2026-11-24' });
  await s.anexarBoleto({ user: ADMIN, id: r.id, boleto: { linhaDigitavel: LINHA } });
  return r;
};

test('gerar: valor com as filiais, resumo e bloqueio em todos os perfis do grupo (menos o suporte)', async () => {
  const fake = banco();
  const s = carregar(fake.db);
  await ligar(s);
  assert.deepEqual(fake.ler('usuarios/dono').planoCobranca, { ativa: true, diaVencimento: 10, inicioCompetencia: '2026-12' });

  const r = await gerarComBoleto(s, '2026-11', 'f20');
  assert.equal(r.id, 'dono_2026-11', 'pedido pela filial cai na matriz');
  const m = fake.ler('mensalidades/dono_2026-11');
  assert.equal(m.valor, 300, '200 da matriz + 50% por filial');
  assert.equal(m.vencimento, '2026-11-10');
  assert.equal(m.situacao, 'aberta');

  for (const uid of ['dono', 'func', 'daFilial']) {
    const p = fake.ler(`usuarios/${uid}`);
    assert.equal(p.cobrancaEmpresa.bloqueioEm, '2026-11-20', uid);
    assert.equal(p.cobrancaBloqueioEm.toISOString(), '2026-11-20T03:00:00.000Z', `${uid}: 00h00 de Brasilia`);
    assert.deepEqual(p.cobrancaEmpresa.contato, { whatsapp: '33988887777' });
  }
  assert.equal(fake.ler('usuarios/suporte').cobrancaEmpresa, undefined, 'admin da plataforma nunca e bloqueado');
  assert.equal(fake.ler('usuarios/outra').cobrancaEmpresa, undefined, 'outra empresa nao e tocada');
  await assert.rejects(s.gerarMensalidade({ user: ADMIN, tenantId: 'dono', competencia: '2026-11' }), /já existe/);
});

test('boleto: conferido e copiado para os perfis sem o caminho do Storage', async () => {
  const fake = banco();
  const s = carregar(fake.db);
  await ligar(s);
  await s.gerarMensalidade({ user: ADMIN, tenantId: 'dono', competencia: '2026-11' });
  await assert.rejects(s.anexarBoleto({ user: ADMIN, id: 'dono_2026-11', boleto: { linhaDigitavel: '123' } }), /47/);
  await assert.rejects(s.anexarBoleto({ user: ADMIN, id: 'dono_2026-11', boleto: { pdfUrl: 'https://x/y.pdf', pdfCaminho: 'cobranca/outra/y.pdf' } }), /não é desta empresa/);
  await s.anexarBoleto({ user: ADMIN, id: 'dono_2026-11', boleto: { linhaDigitavel: LINHA, pdfUrl: 'https://x/y.pdf', pdfCaminho: 'cobranca/dono/y.pdf' } });
  assert.deepEqual(fake.ler('mensalidades/dono_2026-11').boleto, { linhaDigitavel: LINHA, pdfUrl: 'https://x/y.pdf', pdfCaminho: 'cobranca/dono/y.pdf' });
  assert.deepEqual(fake.ler('usuarios/func').cobrancaEmpresa.boleto, { linhaDigitavel: LINHA, pdfUrl: 'https://x/y.pdf' });
});

test('pagar libera na hora (campos saem dos perfis); desfazer volta a cobrar', async () => {
  const fake = banco();
  const s = carregar(fake.db);
  await ligar(s);
  await gerarComBoleto(s);
  await assert.rejects(s.marcarPaga({ user: ADMIN, id: 'dono_2026-11', pagoEm: '2026-11-30', hoje: '2026-11-24' }), /depois de hoje/);
  await s.marcarPaga({ user: ADMIN, id: 'dono_2026-11', pagoEm: '2026-11-22', hoje: '2026-11-24' });
  assert.equal(fake.ler('mensalidades/dono_2026-11').situacao, 'paga');
  for (const uid of ['dono', 'func', 'daFilial']) {
    assert.equal('cobrancaEmpresa' in fake.ler(`usuarios/${uid}`), false, uid);
    assert.equal('cobrancaBloqueioEm' in fake.ler(`usuarios/${uid}`), false, uid);
  }
  await assert.rejects(s.desfazerPagamento({ user: ADMIN, id: 'dono_2026-11', motivo: '' }), /motivo/);
  await s.desfazerPagamento({ user: ADMIN, id: 'dono_2026-11', motivo: 'cheque voltou' });
  assert.equal(fake.ler('usuarios/func').cobrancaEmpresa.mensalidadeId, 'dono_2026-11');
});

test('liberar ate adia o bloqueio; retirar volta ao prazo normal', async () => {
  const fake = banco();
  const s = carregar(fake.db);
  await ligar(s);
  await gerarComBoleto(s);
  await assert.rejects(s.liberarAte({ user: ADMIN, tenantId: 'dono', ate: '2026-11-28', motivo: '', hoje: '2026-11-24' }), /motivo/);
  await s.liberarAte({ user: ADMIN, tenantId: 'dono', ate: '2026-11-28', motivo: 'prometeu pagar', hoje: '2026-11-24' });
  assert.equal(fake.ler('usuarios/func').cobrancaEmpresa.bloqueioEm, '2026-11-29');
  assert.equal(fake.ler('usuarios/dono').planoCobranca.diaVencimento, 10, 'liberar nao apaga o resto do plano');
  await s.liberarAte({ user: ADMIN, tenantId: 'dono', ate: null, hoje: '2026-11-24' });
  assert.equal(fake.ler('usuarios/func').cobrancaEmpresa.bloqueioEm, '2026-11-20');
});

test('rotina diaria: cria o mes 10 dias antes do vencimento, uma vez so', async () => {
  const fake = banco();
  const s = carregar(fake.db);
  await ligar(s, '2026-11-24'); // inicio = 2026-12, vence 10/12
  assert.equal((await s.rotinaDiariaDaCobranca('2026-11-29')).criadas, 0);
  const r = await s.rotinaDiariaDaCobranca('2026-11-30');
  assert.equal(r.criadas, 1);
  assert.equal(fake.ler('mensalidades/dono_2026-12').vencimento, '2026-12-10');
  assert.equal((await s.rotinaDiariaDaCobranca('2026-12-01')).criadas, 0, 'nao repete');
  assert.equal(fake.ler('usuarios/daFilial').cobrancaEmpresa, undefined, 'sem boleto ainda: o cliente nao ve nada');
  await s.anexarBoleto({ user: ADMIN, id: 'dono_2026-12', boleto: { linhaDigitavel: LINHA } });
  assert.equal(fake.ler('usuarios/daFilial').cobrancaEmpresa.lembreteDesde, '2026-12-07');
});

test('sem boleto anexado: vencida nao avisa nem bloqueia', async () => {
  const fake = banco();
  const s = carregar(fake.db);
  await ligar(s);
  await s.gerarMensalidade({ user: ADMIN, tenantId: 'dono', competencia: '2026-11' });
  assert.equal(fake.ler('usuarios/func').cobrancaEmpresa, undefined);
  assert.equal(await s.empresaBloqueada('dono', Date.parse('2026-12-31T12:00:00Z')), false);
});

test('carne anual: cria os 12 meses e pula os que ja existem', async () => {
  const fake = banco();
  const s = carregar(fake.db);
  await ligar(s);
  await s.gerarMensalidade({ user: ADMIN, tenantId: 'dono', competencia: '2027-01' });
  const r = await s.gerarAno({ user: ADMIN, tenantId: 'dono', primeiraCompetencia: '2026-12', quantidade: 12, hoje: '2026-11-24' });
  assert.equal(r.criadas.length, 11);
  assert.deepEqual(r.puladas, ['2027-01']);
  assert.equal(fake.ler('mensalidades/dono_2027-11').vencimento, '2027-11-10');
  await assert.rejects(s.gerarAno({ user: ADMIN, tenantId: 'dono', primeiraCompetencia: 'x' }), /primeiro mês/);
});

test('e-mails automaticos: um por etapa, reserva desfeita se falhar, vespera para o dono', async () => {
  const emailResend = require('../services/emailResend');
  const original = emailResend.enviarEmailPeloResend;
  const envVelho = { k: process.env.RESEND_API_KEY, f: process.env.EMAIL_FROM };
  process.env.RESEND_API_KEY = 'teste';
  process.env.EMAIL_FROM = 'cobranca@teste';
  const enviados = [];
  let falhar = false;
  emailResend.enviarEmailPeloResend = async (e) => { if (falhar) throw new Error('fora do ar'); enviados.push(e); return {}; };
  try {
    const fake = banco();
    await fake.db.collection('plataforma').doc('cobranca').set({ prazos: { diasLembreteAntes: 3, diasAvisoForte: 5, diasBloqueio: 10 }, contato: {}, emailAvisos: 'eu@hennder.com' });
    const s = carregar(fake.db);
    await ligar(s);
    await gerarComBoleto(s);
    const config = { prazos: { diasLembreteAntes: 3, diasAvisoForte: 5, diasBloqueio: 10 }, emailAvisos: 'eu@hennder.com' };

    falhar = true;
    assert.equal((await s.enviarLembretesDoDia('2026-11-13', config)).falhas, 1);
    assert.equal(fake.ler('mensalidades/dono_2026-11').lembretes?.atraso, undefined, 'falhou: libera para tentar de novo');
    falhar = false;
    assert.equal((await s.enviarLembretesDoDia('2026-11-13', config)).enviados, 1);
    assert.equal((await s.enviarLembretesDoDia('2026-11-14', config)).enviados, 0, 'o de atraso sai uma vez so');
    assert.equal(enviados[0].para, 'dono@loja.com');
    assert.match(enviados[0].assunto, /em atraso desde 10\/11\/2026/);

    const vespera = await s.enviarLembretesDoDia('2026-11-19', config);
    assert.equal(vespera.vespera, 1);
    assert.equal(enviados[enviados.length - 1].para, 'eu@hennder.com');
    assert.match(enviados[enviados.length - 1].texto, /LOJA TESTE: R\$ 300,00/);
    assert.equal((await s.enviarLembretesDoDia('2026-11-20', config)).enviados, 1, 'e-mail do bloqueio');
    assert.equal((await s.enviarLembretesDoDia('2026-11-20', config)).enviados, 0);
  } finally {
    emailResend.enviarEmailPeloResend = original;
    if (envVelho.k === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = envVelho.k;
    if (envVelho.f === undefined) delete process.env.EMAIL_FROM; else process.env.EMAIL_FROM = envVelho.f;
  }
});

test('rotina pega usuario criado depois da ultima acao', async () => {
  const fake = banco();
  const s = carregar(fake.db);
  await ligar(s);
  await gerarComBoleto(s);
  await fake.db.collection('usuarios').doc('novo').set({ tenantId: 'f20', role: 'Funcionario' });
  await s.rotinaDiariaDaCobranca('2026-11-24');
  assert.equal(fake.ler('usuarios/novo').cobrancaEmpresa.bloqueioEm, '2026-11-20');
});

test('login novo criado pelo servidor ja nasce com a cobranca do dono', async () => {
  const fake = banco();
  const s = carregar(fake.db);
  assert.deepEqual(await s.camposDaCobrancaParaNovoUsuario('f20'), {}, 'sem cobranca, nada');
  await ligar(s);
  await gerarComBoleto(s);
  const campos = await s.camposDaCobrancaParaNovoUsuario('f20');
  assert.equal(campos.cobrancaEmpresa.bloqueioEm, '2026-11-20');
  assert.equal(campos.cobrancaBloqueioEm.toISOString(), '2026-11-20T03:00:00.000Z');
});

test('empresaBloqueada: so depois do instante gravado, valendo pela filial', async () => {
  const fake = banco();
  const s = carregar(fake.db);
  await ligar(s);
  await gerarComBoleto(s);
  assert.equal(await s.empresaBloqueada('f20', Date.parse('2026-11-20T02:59:00Z')), false);
  assert.equal(await s.empresaBloqueada('f20', Date.parse('2026-11-20T03:00:00Z')), true);
  assert.equal(await s.empresaBloqueada('outra'), false);
});

test('enviar cobranca: exige boleto; WhatsApp com o telefone da empresa e o texto pronto', async () => {
  const fake = banco();
  const s = carregar(fake.db);
  await ligar(s);
  await s.gerarMensalidade({ user: ADMIN, tenantId: 'dono', competencia: '2026-11' });
  await assert.rejects(s.enviarCobranca({ user: ADMIN, id: 'dono_2026-11', porWhatsapp: true }), /Anexe o boleto/);
  await s.anexarBoleto({ user: ADMIN, id: 'dono_2026-11', boleto: { link: 'https://picpay.me/x' } });
  const r = await s.enviarCobranca({ user: ADMIN, id: 'dono_2026-11', porWhatsapp: true });
  assert.equal(r.whatsapp.telefone, '5533999990000');
  assert.match(r.whatsapp.texto, /R\$ 300,00, vencimento em 10\/11\/2026/);
  const eventos = fake.ler('mensalidades/dono_2026-11').eventos.map((e) => e.tipo);
  assert.deepEqual(eventos, ['criada', 'boleto', 'cobranca_enviada']);
});

test('plano: ligar sem dia e prazos errados sao recusados', async () => {
  const s = carregar(banco().db);
  await assert.rejects(s.salvarPlanoDaEmpresa({ user: ADMIN, tenantId: 'dono', ativa: true, diaVencimento: 0 }), /dia de vencimento/);
  await assert.rejects(s.salvarPlanoDaEmpresa({ user: ADMIN, tenantId: 'dono', ativa: true, diaVencimento: 5, prazos: { diasLembreteAntes: 3, diasAvisoForte: 20, diasBloqueio: 10 } }), /antes do bloqueio/);
  await assert.rejects(s.gerarMensalidade({ user: ADMIN, tenantId: 'dono' }), /dia de vencimento/);
});

test('authenticate: perfil com bloqueio vencido recebe 402; admin da plataforma passa', async () => {
  const base = path.join(__dirname, '..');
  const fake = criarBancoFalso({
    'usuarios/func': { tenantId: 'dono', role: 'Funcionario', cobrancaBloqueioEm: new Date(Date.now() - 1000) },
    'usuarios/futuro': { tenantId: 'dono', role: 'Funcionario', cobrancaBloqueioEm: new Date(Date.now() + 86_400_000) },
    'usuarios/suporte': { tenantId: 'dono', role: 'SuperAdmin', cobrancaBloqueioEm: new Date(Date.now() - 1000) },
  });
  const firebase = require.resolve(path.join(base, 'config/firebase'));
  require.cache[firebase] = {
    id: firebase, filename: firebase, loaded: true,
    exports: { db: fake.db, auth: { verifyIdToken: async (t) => ({ uid: t }) } },
  };
  const caminho = require.resolve(path.join(base, 'middleware/auth'));
  delete require.cache[caminho];
  const { authenticate } = require(caminho);
  const chamar = (uid) => new Promise((resolve) => {
    const res = { status: (c) => ({ json: (b) => resolve({ status: c, body: b }) }) };
    authenticate({ headers: { authorization: `Bearer ${uid}` }, query: {} }, res, () => resolve({ status: 200 }));
  });
  const bloqueado = await chamar('func');
  assert.equal(bloqueado.status, 402);
  assert.match(bloqueado.body.error, /mensalidade em atraso/);
  assert.equal((await chamar('futuro')).status, 200);
  assert.equal((await chamar('suporte')).status, 200);
  delete require.cache[firebase];
  delete require.cache[caminho];
});
