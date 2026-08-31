import type { User } from 'firebase/auth';
import { getDeviceId } from './session';

export const ACTIVE_SESSION_MAX_AGE_MS = 2 * 60 * 1000;

export interface ActiveSessionInfo {
  sessionId?: string;
  /** Id do APARELHO (ver session.ts). Sessao antiga nao tem -- e ai o login
   *  volta a perguntar, igual antes. */
  deviceId?: string;
  deviceLabel?: string;
  ip?: string;
  userAgent?: string;
  platform?: string;
  screen?: string;
  language?: string;
  timezone?: string;
  lastPath?: string;
  startedAt?: unknown;
  lastSeenAt?: unknown;
  lastSeenClientAt?: string;
  endedAt?: unknown;
  closedBy?: string;
}

interface BackendClientInfo {
  ip?: string;
  userAgent?: string;
}

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    mobile?: boolean;
    platform?: string;
    brands?: Array<{ brand: string; version: string }>;
  };
};

const getBackendApiUrl = () => {
  const configuredUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, '');
  }

  return import.meta.env.DEV ? 'http://localhost:3001' : '';
};

const timestampToDate = (value: unknown): Date | null => {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === 'object') {
    const maybeTimestamp = value as { toDate?: () => Date; seconds?: number };
    if (typeof maybeTimestamp.toDate === 'function') {
      return maybeTimestamp.toDate();
    }

    if (typeof maybeTimestamp.seconds === 'number') {
      return new Date(maybeTimestamp.seconds * 1000);
    }
  }

  return null;
};

const getBrowserName = (userAgent: string) => {
  if (/Edg\//.test(userAgent)) return 'Edge';
  if (/OPR\//.test(userAgent)) return 'Opera';
  if (/Chrome\//.test(userAgent) && !/Chromium/.test(userAgent)) return 'Chrome';
  if (/Firefox\//.test(userAgent)) return 'Firefox';
  if (/Safari\//.test(userAgent) && !/Chrome\//.test(userAgent)) return 'Safari';
  return 'Navegador';
};

const getOperatingSystem = (userAgent: string, platform: string, isMobile: boolean) => {
  if (/iPhone|iPad|iPod/.test(userAgent)) return /iPad/.test(userAgent) ? 'iPad' : 'iPhone';
  if (/Android/.test(userAgent)) return isMobile ? 'Celular Android' : 'Android';
  if (/Win/.test(platform) || /Windows/.test(userAgent)) return 'Desktop Windows';
  if (/Mac/.test(platform) || /Mac OS X/.test(userAgent)) return 'Desktop macOS';
  if (/Linux/.test(platform) || /Linux/.test(userAgent)) return 'Desktop Linux';
  return isMobile ? 'Celular' : 'Desktop';
};

export const getLocalDeviceLabel = () => {
  const nav = navigator as NavigatorWithUserAgentData;
  const userAgent = navigator.userAgent || '';
  const platform = nav.userAgentData?.platform || navigator.platform || '';
  const isMobile = nav.userAgentData?.mobile === true || /Mobi|Android|iPhone|iPad|iPod/i.test(userAgent);

  return `${getOperatingSystem(userAgent, platform, isMobile)} - ${getBrowserName(userAgent)}`;
};

export const getCurrentSessionPath = () => {
  return `${window.location.pathname}${window.location.search}`;
};

const fetchBackendClientInfo = async (token: string): Promise<BackendClientInfo> => {
  const apiUrl = getBackendApiUrl();
  if (!apiUrl || !token) {
    return {};
  }

  try {
    const response = await fetch(`${apiUrl}/api/sessions/client-info`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      return {};
    }

    return await response.json();
  } catch (error) {
    console.warn('Nao foi possivel obter IP da sessao:', error);
    return {};
  }
};

export const buildSessionMetadata = async (user?: User): Promise<ActiveSessionInfo> => {
  const token = user ? await user.getIdToken().catch(() => '') : '';
  const backendInfo = await fetchBackendClientInfo(token);
  const userAgent = navigator.userAgent || backendInfo.userAgent || '';

  return {
    deviceId: getDeviceId(),
    deviceLabel: getLocalDeviceLabel(),
    ip: backendInfo.ip || '',
    userAgent,
    platform: navigator.platform || '',
    screen: `${window.screen.width}x${window.screen.height}`,
    language: navigator.language || '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    lastPath: getCurrentSessionPath()
  };
};

export const getSessionLastSeenDate = (session?: ActiveSessionInfo | null) => {
  return timestampToDate(session?.lastSeenAt) || timestampToDate(session?.lastSeenClientAt);
};

/**
 * A sessao pendurada e' deste mesmo aparelho?
 *
 * Se for, nao ha nada a perguntar: quem fechou o PWA e esta abrindo de novo e'
 * a mesma pessoa, na mesma maquina, e a resposta ao alerta seria sempre
 * "encerrar a outra e entrar". Perguntar so atrasa a abertura do caixa.
 *
 * Isto NAO enfraquece o controle de sessao unica: o alerta existe pra avisar
 * que a conta esta aberta em OUTRO aparelho, e esse caso continua avisado.
 */
export const isSessionFromThisDevice = (session?: ActiveSessionInfo | null): boolean => {
  const deviceId = getDeviceId();
  return Boolean(deviceId && session?.deviceId && session.deviceId === deviceId);
};

export const isSessionRecentlyActive = (
  sessionId?: string | null,
  session?: ActiveSessionInfo | null,
  maxAgeMs = ACTIVE_SESSION_MAX_AGE_MS
) => {
  if (!sessionId) {
    return false;
  }

  const lastSeen = getSessionLastSeenDate(session);
  if (!lastSeen) {
    return true;
  }

  return Date.now() - lastSeen.getTime() <= maxAgeMs;
};

const escapeHtml = (value: string) => {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
};

const formatDateTime = (date: Date | null) => {
  if (!date) {
    return 'Nao informado';
  }

  return date.toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  });
};

export const buildActiveSessionWarningHtml = (session?: ActiveSessionInfo | null) => {
  const lastSeen = getSessionLastSeenDate(session);
  const startedAt = timestampToDate(session?.startedAt);
  const details = [
    ['Aparelho', session?.deviceLabel || 'Nao identificado'],
    ['IP', session?.ip || 'Nao informado'],
    ['Ultima atividade', formatDateTime(lastSeen)],
    ['Inicio da sessao', formatDateTime(startedAt)],
    ['Tela aberta', session?.lastPath || 'Nao informado']
  ];

  const rows = details
    .map(([label, value]) => `
      <div style="display:flex;justify-content:space-between;gap:16px;padding:6px 0;border-bottom:1px solid #e5e7eb;text-align:left;">
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(value)}</span>
      </div>
    `)
    .join('');

  return `
    <div style="text-align:left;">
      <p style="margin:0 0 12px;">Esta conta esta ativa em outro aparelho ou navegador.</p>
      <div style="font-size:13px;margin-bottom:12px;">${rows}</div>
      <p style="margin:0;color:#64748b;font-size:13px;">Se a ultima atividade estiver antiga, provavelmente era apenas uma aba esquecida.</p>
    </div>
  `;
};

/**
 * Encerra a sessao no servidor quando a janela esta fechando.
 *
 * ---------------------------------------------------------------------------
 * POR QUE `sendBeacon` E NAO `fetch`
 * ---------------------------------------------------------------------------
 *
 * Fechar o PWA no X mata o processo da pagina. Um `fetch`, mesmo com
 * `keepalive`, sai de dentro da pagina -- e no fechamento do aplicativo ele
 * frequentemente e' descartado antes de chegar a rede. Era esse o sintoma
 * relatado: fechava no X, abria de novo e aparecia "Sessao ativa detectada",
 * porque o servidor nunca soube que a sessao acabou.
 *
 * `navigator.sendBeacon` entrega o pedido ao processo do NAVEGADOR, que o
 * envia depois da pagina morrer. E' a API feita exatamente pra isto.
 *
 * Duas consequencias no formato do envio:
 *
 *  - beacon nao aceita cabecalho, entao o token vai no CORPO. O backend
 *    aceita os dois jeitos (ver server/routes/session.routes.js). O token e' a
 *    mesma credencial de sempre, na mesma conexao HTTPS -- nao ha nada mais
 *    exposto aqui do que no cabecalho;
 *  - o tipo e' `text/plain`, nao `application/json`, de proposito: JSON
 *    obrigaria um preflight de CORS, e um OPTIONS extra e' justamente o que
 *    nao da tempo de acontecer com a janela morrendo. O backend faz o parse.
 *
 * O `fetch` continua como plano B pra navegador sem `sendBeacon`.
 */
export const endSessionOnBackend = (sessionId: string, token: string, reason = 'browser_close') => {
  const apiUrl = getBackendApiUrl();
  if (!apiUrl || !sessionId || !token) {
    return false;
  }

  const url = `${apiUrl}/api/sessions/end`;

  try {
    if (typeof navigator.sendBeacon === 'function') {
      const corpo = new Blob(
        [JSON.stringify({ sessionId, reason, token })],
        { type: 'text/plain;charset=UTF-8' }
      );

      if (navigator.sendBeacon(url, corpo)) {
        return true;
      }
    }
  } catch (error) {
    // Beacon recusado (fila cheia, storage bloqueado): cai no fetch abaixo.
    console.warn('sendBeacon nao aceitou o encerramento da sessao:', error);
  }

  try {
    void fetch(url, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ sessionId, reason })
    });
    return true;
  } catch (error) {
    console.warn('Nao foi possivel encerrar a sessao no backend:', error);
    return false;
  }
};
