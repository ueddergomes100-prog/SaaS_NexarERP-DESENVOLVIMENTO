const cron = require('node-cron');
const { db } = require('../config/firebase');
const { generateCompanyBackup } = require('./backup');
const { configEfetiva, precisaDeBackup, situacaoDoBackup, ultimoHorarioPrevisto } = require('./backupAgenda');
const { externoConfigurado } = require('./backupExterno');
const { reservarVez, concluirVez, falharVez, PROCESSO } = require('./travaDeRotina');

/**
 * BACKUP AUTOMATICO DE TODAS AS EMPRESAS (12/11/2026) -- regra em backupAgenda.js.
 *
 * Uma RONDA a cada 10 minutos confere, empresa por empresa, se existe backup
 * depois do ultimo horario previsto; se nao existe, faz. Substitui o cron por
 * empresa que so' existia para quem ligasse no painel.
 *
 * - Empresas = todo documento de `configuracoes` (matriz E filiais) mais os
 *   donos (Master) sem configuracao ainda.
 * - O que a ronda precisa saber (empresas, configuracao gravada, ultimo backup
 *   de cada uma) fica em memoria e e' relido do banco a cada 6 horas; a ronda
 *   em si nao le o banco.
 * - No maximo 3 backups disparados por ronda: depois de um deploy (ou as
 *   02:00, quando todas vencem juntas) a fila anda aos poucos, sem pesar no
 *   servidor. A fila de backup.js ja' garante um por vez.
 * - Backup que falha so' e' tentado de novo depois de 1 hora.
 * - DOIS PROCESSOS DO SERVIDOR NO AR (25/11/2026): tudo acima e' memoria de um
 *   processo. Com dois, cada um fazia o backup e o historico mostrava o mesmo
 *   backup duas vezes. Antes de disparar, a ronda reserva no banco a vez
 *   daquela empresa (o horario previsto) -- ver travaDeRotina.js. Quem nao
 *   ganha a reserva nao faz, e aprende pela trava o que o outro processo fez.
 */

const RONDA_A_CADA = '*/10 * * * *';
const RECARREGAR_A_CADA_MS = 6 * 60 * 60 * 1000;
const ESPERA_DEPOIS_DE_FALHA_MS = 60 * 60 * 1000;
const MAXIMO_POR_RONDA = 3;
/**
 * Por quanto tempo a reserva de um backup vale sem ser concluida. Cobre a
 * espera na fila (3 por ronda, um por vez) mais o backup em si; se o processo
 * morre no meio, outro assume depois disso.
 */
const VALIDADE_DA_RESERVA_MS = 60 * 60 * 1000;
const chaveDaTrava = (companyId) => `backup_${companyId}`;
const JANELA_DO_HISTORICO_MS = 45 * 24 * 60 * 60 * 1000;
/** Backup que tem arquivo guardado (na nuvem ou, a espera de reenvio, no servidor). */
const STATUS_COM_ARQUIVO = ['enviado', 'pendente', 'local'];

const estado = {
  carregadoEmMs: 0,
  /** tenantId -> { nome } */
  empresas: new Map(),
  /** tenantId -> configuracao gravada no painel (so' quem gravou) */
  configs: new Map(),
  /** tenantId -> resumo do ultimo backup com arquivo */
  ultimos: new Map(),
  emAndamento: new Set(),
  /** tenantId -> instante a partir do qual pode tentar de novo */
  proximaTentativa: new Map(),
};

const nomeDaEmpresa = (config) => {
  const nome = String(config.nomeOficina || config.razaoSocial || '').trim() || 'Sem nome';
  const filial = String(config.filialCodigo || '').trim();
  return filial ? `${nome} (filial ${filial})` : nome;
};

/** Todas as empresas e filiais: { id, nome, email }. */
async function listarEmpresas() {
  const empresas = new Map();
  const configsSnap = await db.collection('configuracoes').get();
  configsSnap.docs.forEach((doc) => {
    const dados = doc.data() || {};
    empresas.set(doc.id, { id: doc.id, nome: nomeDaEmpresa(dados), email: String(dados.email || '').trim() });
  });
  // Dono sem configuracao gravada ainda (empresa recem-criada ou muito antiga).
  const donosSnap = await db.collection('usuarios').where('role', '==', 'Master').get();
  donosSnap.docs.forEach((doc) => {
    const dados = doc.data() || {};
    const id = String(dados.tenantId || doc.id);
    const atual = empresas.get(id);
    if (!atual) empresas.set(id, { id, nome: String(dados.nomeOficina || '').trim() || 'Sem nome', email: String(dados.email || '').trim() });
    else if (!atual.email && id === doc.id) atual.email = String(dados.email || '').trim();
  });
  return [...empresas.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

const resumoDoRegistro = (registro) => ({
  id: registro.id || null,
  createdAt: registro.createdAt,
  ms: Date.parse(registro.createdAt) || 0,
  status: registro.status,
  filename: registro.filename || '',
  sizeBytes: Number(registro.sizeBytes) || 0,
  externo: (registro.externo && registro.externo.status) || 'nao_configurado',
});

/** Ultimo backup com arquivo de cada empresa, olhando os ultimos 45 dias. */
async function lerUltimosBackups(agoraMs) {
  const desde = new Date(agoraMs - JANELA_DO_HISTORICO_MS).toISOString();
  const snap = await db.collection('backups_historico').where('createdAt', '>=', desde).get();
  const ultimos = new Map();
  snap.docs.forEach((doc) => {
    const registro = doc.data() || {};
    if (!STATUS_COM_ARQUIVO.includes(registro.status)) return;
    const resumo = resumoDoRegistro({ id: doc.id, ...registro });
    const atual = ultimos.get(registro.companyId);
    if (!atual || resumo.ms > atual.ms) ultimos.set(registro.companyId, resumo);
  });
  return ultimos;
}

async function carregarEstado(agoraMs = Date.now()) {
  const [empresas, configsSnap, ultimos] = await Promise.all([
    listarEmpresas(),
    db.collection('backups_configuracoes').get(),
    lerUltimosBackups(agoraMs),
  ]);
  estado.empresas = new Map(empresas.map((e) => [e.id, e]));
  estado.configs = new Map();
  configsSnap.docs.forEach((doc) => estado.configs.set(doc.id, doc.data()));
  // Backup feito por esta ronda depois da ultima leitura nao pode "sumir" na releitura.
  ultimos.forEach((resumo, id) => {
    const atual = estado.ultimos.get(id);
    if (!atual || resumo.ms >= atual.ms) estado.ultimos.set(id, resumo);
  });
  estado.carregadoEmMs = agoraMs;
}

/** Faz o backup de quem ja' teve a vez reservada por este processo. */
function disparar(companyId, vez, agoraMs) {
  estado.emAndamento.add(companyId);
  generateCompanyBackup(companyId)
    .then((registro) => {
      const resumo = resumoDoRegistro(registro);
      estado.ultimos.set(companyId, resumo);
      estado.proximaTentativa.delete(companyId);
      // Sem a conclusao gravada, a reserva vence em 1 hora e outro processo repetiria o backup.
      return concluirVez(chaveDaTrava(companyId), vez, resumo)
        .catch((erro) => console.error(`[Scheduler] Backup de ${companyId} feito, mas a trava não foi concluída:`, erro.message));
    }, (erro) => {
      console.error(`[Scheduler] Backup automático de ${companyId} falhou; nova tentativa em 1 hora:`, erro.message);
      estado.proximaTentativa.set(companyId, agoraMs + ESPERA_DEPOIS_DE_FALHA_MS);
      // A espera de 1 hora vale tambem para os outros processos.
      return falharVez(chaveDaTrava(companyId), vez, { esperaMs: ESPERA_DEPOIS_DE_FALHA_MS, motivo: erro.message, agoraMs })
        .catch((erroDaTrava) => console.error(`[Scheduler] Trava do backup de ${companyId} não foi solta:`, erroDaTrava.message));
    })
    .finally(() => estado.emAndamento.delete(companyId));
}

/**
 * Outro processo ficou com a vez desta empresa: este nao faz o backup e guarda
 * o que a trava contou, para nao perguntar de novo a cada ronda.
 */
function aprenderComOOutroProcesso(companyId, vez, reserva, agoraMs) {
  if (reserva.situacao === 'concluida') {
    const feito = reserva.resultado;
    const atual = estado.ultimos.get(companyId);
    if (feito && Number(feito.ms) > 0 && (!atual || feito.ms > atual.ms)) estado.ultimos.set(companyId, feito);
    // Trava sem o resumo do backup: a vez esta' feita do mesmo jeito; so' nao pergunta a cada ronda.
    const sabido = estado.ultimos.get(companyId);
    if (!sabido || sabido.ms < vez) estado.proximaTentativa.set(companyId, agoraMs + ESPERA_DEPOIS_DE_FALHA_MS);
  } else {
    estado.proximaTentativa.set(companyId, reserva.liberaEmMs);
  }
  console.log(`[Scheduler] Backup de ${companyId} ficou com outro processo do servidor (${reserva.processo || 'desconhecido'}, ${reserva.situacao}); este (${PROCESSO}) não repete.`);
}

/** Uma passada: dispara o backup de quem esta' devendo. Devolve os ids disparados. */
async function ronda(agoraMs = Date.now()) {
  if (!db) return [];
  if (!estado.carregadoEmMs || agoraMs - estado.carregadoEmMs > RECARREGAR_A_CADA_MS) {
    await carregarEstado(agoraMs);
  }
  const disparados = [];
  for (const id of estado.empresas.keys()) {
    if (disparados.length >= MAXIMO_POR_RONDA) break;
    if (estado.emAndamento.has(id)) continue;
    if ((estado.proximaTentativa.get(id) || 0) > agoraMs) continue;
    const config = configEfetiva(estado.configs.get(id));
    const ultimo = estado.ultimos.get(id);
    if (!precisaDeBackup(config, ultimo ? ultimo.ms : 0, agoraMs)) continue;
    // A vez e' o horario previsto: dois processos na mesma ronda pedem a mesma.
    const vez = ultimoHorarioPrevisto(config, agoraMs);
    estado.emAndamento.add(id);
    let reserva = null;
    try {
      reserva = await reservarVez(chaveDaTrava(id), vez, { validadeMs: VALIDADE_DA_RESERVA_MS, agoraMs });
    } catch (erro) {
      // Sem a reserva nao faz (dois processos fariam em dobro); a proxima ronda tenta de novo.
      console.error(`[Scheduler] Não consegui reservar o backup de ${id}; fica para a próxima ronda:`, erro.message);
    }
    if (!reserva || !reserva.ganhou) {
      estado.emAndamento.delete(id);
      if (reserva) aprenderComOOutroProcesso(id, vez, reserva, agoraMs);
      continue;
    }
    disparar(id, vez, agoraMs);
    disparados.push(id);
  }
  if (disparados.length > 0) console.log(`[Scheduler] Ronda de backup: ${disparados.length} empresa(s) na fila.`);
  return disparados;
}

/** Liga a ronda (chamado uma vez, ao subir o servidor). */
function initScheduler() {
  if (!db) {
    console.warn('[Scheduler] Firestore não disponível. Backups automáticos desativados.');
    return;
  }
  console.log(`[Scheduler] Backup automático de todas as empresas: ronda a cada 10 minutos (processo ${PROCESSO}).`);
  const passar = () => ronda().catch((erro) => console.error('[Scheduler] Erro na ronda de backup:', erro.message));
  cron.schedule(RONDA_A_CADA, passar);
  // Primeira passada logo depois de subir (o servidor pode ter ficado fora no horario).
  setTimeout(passar, 60 * 1000);
}

/** A configuracao de uma empresa mudou no painel: a ronda passa a usar a nova. */
async function reloadCompanyJob(companyId) {
  try {
    const doc = await db.collection('backups_configuracoes').doc(companyId).get();
    if (doc.exists) estado.configs.set(companyId, doc.data());
    else estado.configs.delete(companyId);
  } catch (error) {
    console.error(`[Scheduler] Erro ao recarregar a configuração de backup da empresa ${companyId}:`, error.message);
  }
}

/**
 * Painel "Situacao dos backups": toda empresa e filial com a configuracao que
 * vale, o ultimo backup e se esta' em dia. Sempre le o banco (e' uma consulta
 * do painel, nao a ronda).
 */
async function resumoDosBackups(agoraMs = Date.now()) {
  await carregarEstado(agoraMs);
  const empresas = [...estado.empresas.values()].map((empresa) => {
    const config = configEfetiva(estado.configs.get(empresa.id));
    const ultimo = estado.ultimos.get(empresa.id) || null;
    return {
      id: empresa.id,
      nome: empresa.nome,
      automatico: config,
      ultimoBackup: ultimo ? { createdAt: ultimo.createdAt, status: ultimo.status, filename: ultimo.filename, sizeBytes: ultimo.sizeBytes, externo: ultimo.externo } : null,
      emAndamento: estado.emAndamento.has(empresa.id),
      ...situacaoDoBackup(config, ultimo ? ultimo.ms : 0, agoraMs),
    };
  });
  const contar = (situacao) => empresas.filter((e) => e.situacao === situacao).length;
  return {
    externoConfigurado: externoConfigurado(),
    contagem: { total: empresas.length, emDia: contar('em_dia'), atrasados: contar('atrasado'), nunca: contar('nunca'), desligados: contar('desligado') },
    empresas,
  };
}

/**
 * Outra linha do historico aponta para o mesmo arquivo na nuvem? Acontece com
 * o backup feito em dobro por dois processos antes da trava (25/11/2026): os
 * dois gravaram o mesmo nome de arquivo, e o segundo envio sobrescreveu o
 * primeiro. Quem exclui uma das linhas nao pode levar o arquivo junto.
 */
async function arquivoUsadoPorOutraLinha(companyId, filename, backupId) {
  if (!companyId || !filename) return false;
  const snap = await db.collection('backups_historico').where('companyId', '==', companyId).get();
  return snap.docs.some((doc) => {
    const linha = doc.data() || {};
    return doc.id !== backupId && linha.filename === filename && linha.status === 'enviado';
  });
}

module.exports = {
  initScheduler,
  reloadCompanyJob,
  listarEmpresas,
  resumoDosBackups,
  arquivoUsadoPorOutraLinha,
  ronda,
  // So' para teste.
  _estado: estado,
};
