/**
 * AGENDA DO BACKUP AUTOMATICO (12/11/2026) -- regra pura, sem banco nem relogio.
 *
 * Antes: cada empresa so' tinha backup automatico se alguem ligasse no painel
 * (vinha DESLIGADO), o agendamento era um cron por empresa criado quando o
 * servidor subia (empresa nova so' entrava no proximo reinicio; servidor fora
 * do ar no horario = backup perdido), e a lista de empresas vinha do cadastro
 * do dono -- as FILIAIS nao entravam em backup nenhum.
 *
 * Agora (decisao do dono): toda empresa e filial tem backup automatico LIGADO
 * por padrao (diario, 02:00 de Brasilia). O servidor faz uma ronda a cada 10
 * minutos e pergunta, para cada empresa: "ja' existe backup depois do ultimo
 * horario previsto?". Se nao, faz. Assim servidor reiniciado, empresa nova e
 * horario perdido se resolvem sozinhos na ronda seguinte.
 *
 * So' fica sem backup automatico a empresa em que alguem DESLIGOU no painel
 * (documento gravado com enabled: false).
 */

/** Brasilia: UTC-3 fixo (o Brasil nao tem horario de verao desde 2019). */
const FUSO_BRASILIA_MS = -3 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;
/** Depois do horario previsto, quanto esperar a ronda antes de chamar de "atrasado". */
const TOLERANCIA_DO_ATRASO_MS = 6 * 60 * 60 * 1000;

const FREQUENCIAS = ['diario', 'semanal', 'mensal'];
const CONFIG_PADRAO = Object.freeze({ enabled: true, frequency: 'diario', time: '02:00' });

const horaEMinuto = (time) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || '').trim());
  if (!m) return [2, 0];
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59 ? [h, min] : [2, 0];
};

/**
 * Configuracao que vale para a empresa: a gravada no painel ou, sem nada
 * gravado, a padrao (LIGADO). `padrao: true` diz que ninguem escolheu.
 */
const configEfetiva = (gravada) => {
  if (!gravada || typeof gravada !== 'object') return { ...CONFIG_PADRAO, padrao: true };
  const [h, min] = horaEMinuto(gravada.time);
  return {
    enabled: gravada.enabled === true,
    frequency: FREQUENCIAS.includes(gravada.frequency) ? gravada.frequency : 'diario',
    time: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
    padrao: false,
  };
};

/**
 * Ultimo horario em que o backup DEVIA ter rodado (instante, em ms), olhando
 * o relogio de Brasilia: hoje no horario (ou ontem, se ainda nao chegou);
 * semanal = domingo; mensal = dia 1.
 */
const ultimoHorarioPrevisto = (config, agoraMs) => {
  const [h, min] = horaEMinuto(config.time);
  const local = new Date(agoraMs + FUSO_BRASILIA_MS);
  const ano = local.getUTCFullYear();
  const mes = local.getUTCMonth();
  const dia = local.getUTCDate();
  // Date.UTC aceita dia 0/negativo e mes -1: "volta" sozinho no calendario.
  const instante = (a, m, d) => Date.UTC(a, m, d, h, min) - FUSO_BRASILIA_MS;
  if (config.frequency === 'mensal') {
    const esteMes = instante(ano, mes, 1);
    return esteMes <= agoraMs ? esteMes : instante(ano, mes - 1, 1);
  }
  if (config.frequency === 'semanal') {
    const domingo = instante(ano, mes, dia - local.getUTCDay());
    return domingo <= agoraMs ? domingo : instante(ano, mes, dia - local.getUTCDay() - 7);
  }
  const hoje = instante(ano, mes, dia);
  return hoje <= agoraMs ? hoje : instante(ano, mes, dia - 1);
};

/** A ronda deve fazer backup desta empresa agora? */
const precisaDeBackup = (config, ultimoBackupMs, agoraMs) => (
  config.enabled === true && (Number(ultimoBackupMs) || 0) < ultimoHorarioPrevisto(config, agoraMs)
);

/**
 * Situacao para o painel: 'em_dia', 'atrasado' (passou do horario e da
 * tolerancia sem backup), 'nunca' (ligado e sem nenhum backup) ou 'desligado'.
 */
const situacaoDoBackup = (config, ultimoBackupMs, agoraMs) => {
  const ultimo = Number(ultimoBackupMs) || 0;
  const diasSemBackup = ultimo ? Math.floor((agoraMs - ultimo) / DIA_MS) : null;
  if (config.enabled !== true) return { situacao: 'desligado', diasSemBackup };
  const previsto = ultimoHorarioPrevisto(config, agoraMs);
  if (ultimo >= previsto) return { situacao: 'em_dia', diasSemBackup };
  // Dentro da tolerancia a ronda ainda vai fazer: nao e' atraso.
  if (agoraMs - previsto <= TOLERANCIA_DO_ATRASO_MS) return { situacao: ultimo ? 'em_dia' : 'nunca', diasSemBackup };
  return { situacao: ultimo ? 'atrasado' : 'nunca', diasSemBackup };
};

module.exports = {
  CONFIG_PADRAO,
  TOLERANCIA_DO_ATRASO_MS,
  configEfetiva,
  ultimoHorarioPrevisto,
  precisaDeBackup,
  situacaoDoBackup,
};
