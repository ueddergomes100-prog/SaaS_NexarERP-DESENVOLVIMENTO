const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

/*
 * Trava de rotina entre processos (25/11/2026). Em producao o historico
 * mostrava o mesmo backup automatico duas vezes: dois processos do servidor no
 * ar, cada um com a sua memoria, faziam o backup da mesma empresa no mesmo
 * segundo. Aqui cada "processo" e' uma carga nova do servico (memoria propria)
 * em cima do MESMO banco, com as transacoes em fila como no Firestore real.
 */

const br = (iso) => Date.parse(`${iso}:00-03:00`);
const HORA = 60 * 60 * 1000;
const chamados = [];
let falhar = new Set();
let horaDoBackup = br('2026-11-25T02:00');

const caminhoBackup = require.resolve(path.join(__dirname, '..', 'services/backup'));
require.cache[caminhoBackup] = {
  id: caminhoBackup, filename: caminhoBackup, loaded: true,
  exports: {
    getEncryptionKey: () => 'teste',
    generateCompanyBackup: async (companyId) => {
      chamados.push(companyId);
      if (falhar.has(companyId)) throw new Error('falha simulada');
      return { id: `b-${companyId}-${chamados.length}`, companyId, createdAt: new Date(horaDoBackup + 1000).toISOString(), status: 'enviado', filename: 'backup_2026-11-25_05-00.json.gz', sizeBytes: 10 };
    },
  },
};

const banco = (inicial) => criarBancoFalso(inicial, { consultas: true, transacoesEmFila: true });
/** Um "processo" novo: memoria propria (ronda e trava), mesmo banco. */
const processo = (db) => carregarComBancoFalso(db, 'services/scheduler').pop();
const trava = (db) => carregarComBancoFalso(db, 'services/travaDeRotina').pop();
const assentar = () => new Promise((r) => setImmediate(r));
const empresas = (...ids) => Object.fromEntries(ids.map((id) => [`configuracoes/${id}`, { tenantId: id, nomeOficina: `EMPRESA ${id.toUpperCase()}` }]));
const zerar = () => { chamados.length = 0; falhar = new Set(); horaDoBackup = br('2026-11-25T02:00'); };

test('trava: so um ganha a vez; o outro ve "rodando" e, depois, "concluida" com o que foi feito', async () => {
  const fake = banco({});
  const p1 = trava(fake.db);
  const p2 = trava(fake.db);
  assert.notEqual(p1.PROCESSO, p2.PROCESSO);
  const agora = br('2026-11-25T02:00');

  const [r1, r2] = await Promise.all([
    p1.reservarVez('backup_a', agora, { validadeMs: HORA, agoraMs: agora }),
    p2.reservarVez('backup_a', agora, { validadeMs: HORA, agoraMs: agora }),
  ]);
  assert.equal(r1.ganhou, true);
  assert.equal(r2.ganhou, false);
  assert.equal(r2.situacao, 'rodando');
  assert.equal(r2.processo, p1.PROCESSO);
  assert.equal(r2.liberaEmMs, agora + HORA);

  // `undefined` nunca vai para o banco (regra 3 do CLAUDE.md).
  await p1.concluirVez('backup_a', agora, { ms: agora + 1000, filename: 'a.gz', externo: undefined });
  assert.deepEqual(fake.ler('rotinas_travas/backup_a').resultado, { ms: agora + 1000, filename: 'a.gz' });
  const depois = await p2.reservarVez('backup_a', agora, { validadeMs: HORA, agoraMs: agora + 2 * HORA });
  assert.equal(depois.ganhou, false);
  assert.equal(depois.situacao, 'concluida');
  assert.equal(depois.resultado.filename, 'a.gz');

  // A vez seguinte (o horario de amanha) e' outra: alguem ganha de novo.
  const amanha = await p2.reservarVez('backup_a', agora + 24 * HORA, { validadeMs: HORA, agoraMs: agora + 24 * HORA });
  assert.equal(amanha.ganhou, true);
  // Conclusao atrasada da vez antiga nao apaga a reserva da nova.
  assert.equal(await p1.concluirVez('backup_a', agora, { ms: 1 }), false);
  assert.equal(fake.ler('rotinas_travas/backup_a').situacao, 'rodando');
});

test('trava: processo que morre no meio nao prende a rotina; falha segura a nova tentativa pelo tempo pedido', async () => {
  const fake = banco({});
  const p1 = trava(fake.db);
  const p2 = trava(fake.db);
  const agora = br('2026-11-25T02:00');

  assert.equal((await p1.reservarVez('rotina', agora, { validadeMs: HORA, agoraMs: agora })).ganhou, true);
  // p1 "morreu" sem concluir: dentro da validade ninguem assume; depois, sim.
  assert.equal((await p2.reservarVez('rotina', agora, { validadeMs: HORA, agoraMs: agora + HORA - 1 })).ganhou, false);
  assert.equal((await p2.reservarVez('rotina', agora, { validadeMs: HORA, agoraMs: agora + HORA })).ganhou, true);

  // So' quem esta' com a reserva marca a falha.
  assert.equal(await p1.falharVez('rotina', agora, { esperaMs: HORA, agoraMs: agora + HORA }), false);
  assert.equal(await p2.falharVez('rotina', agora, { esperaMs: HORA, motivo: 'nuvem fora do ar', agoraMs: agora + HORA }), true);
  const espera = await p1.reservarVez('rotina', agora, { validadeMs: HORA, agoraMs: agora + HORA + 60 * 1000 });
  assert.equal(espera.ganhou, false);
  assert.equal(espera.situacao, 'falhou');
  assert.equal(espera.liberaEmMs, agora + 2 * HORA);
  assert.equal((await p1.reservarVez('rotina', agora, { validadeMs: HORA, agoraMs: agora + 2 * HORA })).ganhou, true);
});

test('ronda em DOIS processos na mesma hora: um backup por empresa, nunca dois', async () => {
  zerar();
  const fake = banco(empresas('a', 'b'));
  const p1 = processo(fake.db);
  const p2 = processo(fake.db);
  const agora = br('2026-11-25T02:00');

  const [d1, d2] = await Promise.all([p1.ronda(agora), p2.ronda(agora)]);
  await assentar();
  assert.deepEqual([...d1, ...d2].sort(), ['a', 'b'], 'cada empresa disparada por um processo so');
  assert.deepEqual(chamados.slice().sort(), ['a', 'b']);
  assert.equal(fake.ler('rotinas_travas/backup_a').situacao, 'concluida');
  assert.equal(fake.ler('rotinas_travas/backup_a').vez, agora);

  // Rondas seguintes do mesmo dia: o processo que perdeu a vez nao refaz o que o outro fez.
  for (const minutos of [10, 61, 180]) {
    await Promise.all([p1.ronda(agora + minutos * 60 * 1000), p2.ronda(agora + minutos * 60 * 1000)]);
    await assentar();
  }
  assert.deepEqual(chamados.slice().sort(), ['a', 'b']);
  // Quem perdeu aprendeu pela trava qual foi o backup: nao pergunta mais ao banco hoje.
  assert.equal(p1._estado.ultimos.get('a').filename, 'backup_2026-11-25_05-00.json.gz');
  assert.equal(p2._estado.ultimos.get('a').filename, 'backup_2026-11-25_05-00.json.gz');

  // No dia seguinte a vez e' outra: de novo um backup por empresa.
  horaDoBackup = br('2026-11-26T02:00');
  const amanha = br('2026-11-26T02:00');
  const [e1, e2] = await Promise.all([p1.ronda(amanha), p2.ronda(amanha)]);
  await assentar();
  assert.deepEqual([...e1, ...e2].sort(), ['a', 'b']);
  assert.equal(chamados.length, 4);
});

test('ronda: processo morreu com a vez reservada -> outro assume depois de 1 hora', async () => {
  zerar();
  const fake = banco(empresas('a'));
  const morto = trava(fake.db);
  const vivo = processo(fake.db);
  const agora = br('2026-11-25T02:00');
  await morto.reservarVez('backup_a', agora, { validadeMs: HORA, agoraMs: agora });

  assert.deepEqual(await vivo.ronda(agora + 10 * 60 * 1000), []);
  assert.deepEqual(await vivo.ronda(agora + 50 * 60 * 1000), []);
  assert.deepEqual(await vivo.ronda(agora + 61 * 60 * 1000), ['a']);
  await assentar();
  assert.deepEqual(chamados, ['a']);
});

test('ronda: backup que falha num processo so e tentado de novo (por qualquer processo) depois de 1 hora', async () => {
  zerar();
  falhar = new Set(['a']);
  const fake = banco(empresas('a'));
  const p1 = processo(fake.db);
  const p2 = processo(fake.db);
  const agora = br('2026-11-25T02:00');

  assert.deepEqual(await p1.ronda(agora), ['a']);
  await assentar();
  assert.equal(fake.ler('rotinas_travas/backup_a').situacao, 'falhou');
  assert.equal(fake.ler('rotinas_travas/backup_a').erro, 'falha simulada');
  assert.deepEqual(await p2.ronda(agora + 10 * 60 * 1000), [], 'o outro processo tambem espera');
  falhar = new Set();
  assert.deepEqual(await p2.ronda(agora + 61 * 60 * 1000), ['a']);
  await assentar();
  assert.deepEqual(chamados, ['a', 'a']);
  assert.equal(fake.ler('rotinas_travas/backup_a').situacao, 'concluida');
});

test('fila de reenvio: dois processos na mesma hora -> so um passa; na hora seguinte passa de novo', async () => {
  const fake = banco({});
  const fila = () => carregarComBancoFalso(fake.db, 'services/queue').pop();
  const p1 = fila();
  const p2 = fila();
  const agora = br('2026-11-25T03:00');

  const rodaram = await Promise.all([p1.passarAFila(agora), p2.passarAFila(agora)]);
  assert.deepEqual(rodaram.slice().sort(), [false, true]);
  // Servidor que sobe no meio da hora nao refaz a fila que ja' rodou.
  assert.equal(await p2.passarAFila(agora + 20 * 60 * 1000), false);
  assert.equal(await p2.passarAFila(agora + HORA), true);
  assert.equal(fake.ler('rotinas_travas/fila_de_backups').situacao, 'concluida');
});

test('excluir linha repetida do historico: o arquivo fica enquanto outra linha aponta para ele', async () => {
  const linha = (extra = {}) => ({ companyId: 'a', filename: 'backup_2026-11-25_05-00.json.gz', status: 'enviado', ...extra });
  const fake = banco({
    'backups_historico/h1': linha(),
    'backups_historico/h2': linha(),
    'backups_historico/h3': linha({ filename: 'backup_2026-11-24_05-00.json.gz' }),
    'backups_historico/h4': linha({ companyId: 'b' }),
    'backups_historico/h5': linha({ filename: 'backup_2026-11-23_05-00.json.gz' }),
    'backups_historico/h6': linha({ filename: 'backup_2026-11-23_05-00.json.gz', status: 'erro' }),
  });
  const s = processo(fake.db);
  assert.equal(await s.arquivoUsadoPorOutraLinha('a', 'backup_2026-11-25_05-00.json.gz', 'h1'), true);
  assert.equal(await s.arquivoUsadoPorOutraLinha('a', 'backup_2026-11-24_05-00.json.gz', 'h3'), false);
  assert.equal(await s.arquivoUsadoPorOutraLinha('b', 'backup_2026-11-25_05-00.json.gz', 'h4'), false, 'outra empresa nao conta');
  assert.equal(await s.arquivoUsadoPorOutraLinha('a', 'backup_2026-11-23_05-00.json.gz', 'h5'), false, 'linha com erro nao tem arquivo');
});
