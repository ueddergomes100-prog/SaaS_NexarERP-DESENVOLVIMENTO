import { deleteToken, getMessaging, getToken, isSupported } from 'firebase/messaging';
import { firebaseApp } from './firebase';
import { chamarServidor } from './apiServidor';

/**
 * AVISOS NO CELULAR (21/10/2026) -- Firebase Cloud Messaging no app Vendas.
 *
 * O aparelho recebe um token do FCM e o servidor guarda
 * (server/services/notificacoesPush.js); o aviso chega pelo service worker
 * (public/sw.js), mesmo com o app fechado. Primeiro uso: "Liberar desconto?"
 * para quem pode liberar. No iPhone so' funciona com o app instalado na tela
 * de inicio (iOS 16.4+); no Android, direto no Chrome ou instalado.
 */

const CHAVE_LOCAL = 'nexus_push_token';

export type EstadoDosAvisos = 'sem_suporte' | 'bloqueado' | 'ativo' | 'inativo';

export const suporteAPush = async (): Promise<boolean> => {
  if (typeof window === 'undefined' || typeof Notification === 'undefined' || !('serviceWorker' in navigator)) return false;
  try {
    return await isSupported();
  } catch {
    return false;
  }
};

const tokenGuardado = (): string => {
  try {
    return localStorage.getItem(CHAVE_LOCAL) || '';
  } catch {
    return '';
  }
};

export const estadoDosAvisos = async (): Promise<EstadoDosAvisos> => {
  if (!(await suporteAPush())) return 'sem_suporte';
  if (Notification.permission === 'denied') return 'bloqueado';
  return Notification.permission === 'granted' && tokenGuardado() ? 'ativo' : 'inativo';
};

const registrarServiceWorker = async (): Promise<ServiceWorkerRegistration> => {
  // Em producao o main.tsx ja' registra; aqui garante (inclusive no dev, que
  // nao registra sozinho) e espera ficar pronto -- o token do FCM e' ligado
  // a este registro.
  await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
};

const guardarToken = (token: string) => { try { localStorage.setItem(CHAVE_LOCAL, token); } catch { /* sem armazenamento: so' nao lembra */ } };
const esquecerToken = () => { try { localStorage.removeItem(CHAVE_LOCAL); } catch { /* idem */ } };

/**
 * Pede a permissao (precisa vir de um toque da pessoa), pega o token e
 * registra o aparelho no servidor. `motivo` em portugues quando nao da'.
 */
export const ativarAvisosNoCelular = async (): Promise<{ ok: boolean; motivo?: string }> => {
  if (!(await suporteAPush())) {
    return { ok: false, motivo: 'Este navegador não recebe avisos. No iPhone, instale o app na tela de início (Perfil → Instalar na tela de início) e ative por lá.' };
  }
  const config = await chamarServidor<{ ativo: boolean; vapidPublicKey: string }>('GET', 'notificacoes/config');
  if (!config.ativo || !config.vapidPublicKey) {
    return { ok: false, motivo: 'Os avisos no celular ainda não foram configurados no servidor. Avise o suporte.' };
  }
  const permissao = await Notification.requestPermission();
  if (permissao !== 'granted') {
    return { ok: false, motivo: 'A permissão de avisos não foi dada. Libere os avisos deste app nas configurações do aparelho e tente de novo.' };
  }
  const registro = await registrarServiceWorker();
  const token = await getToken(getMessaging(firebaseApp), { vapidKey: config.vapidPublicKey, serviceWorkerRegistration: registro });
  if (!token) return { ok: false, motivo: 'O aparelho não devolveu o endereço dos avisos. Tente de novo.' };
  await chamarServidor('POST', 'notificacoes/dispositivo', { token, plataforma: navigator.userAgent.slice(0, 60) });
  guardarToken(token);
  return { ok: true };
};

/** Ao abrir o app: quem ja' ativou tem o token renovado em silencio (ele muda de tempos em tempos). */
export const renovarAvisosSeAtivos = async (): Promise<void> => {
  try {
    if ((await estadoDosAvisos()) !== 'ativo') return;
    await ativarAvisosNoCelular();
  } catch {
    // Sem rede ou sem servidor: tenta de novo na proxima abertura.
  }
};

export const desativarAvisosNoCelular = async (): Promise<void> => {
  const token = tokenGuardado();
  esquecerToken();
  if (!token) return;
  await chamarServidor('DELETE', 'notificacoes/dispositivo', { token }).catch(() => undefined);
  try {
    await deleteToken(getMessaging(firebaseApp));
  } catch {
    // Token ja' invalido: nada a desfazer.
  }
};
