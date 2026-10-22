import { initializeApp } from 'firebase/app';
import { ehAppDoCaixa } from '../utils/frenteDeCaixaDomain';
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { browserLocalPersistence, browserSessionPersistence, indexedDBLocalPersistence, initializeAuth, setPersistence } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import { getToken, initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check';
import { definirCabecalhosAutomaticos } from '../utils/fetchComTimeout';

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
/** O app principal, para quem precisa de outro servico do Firebase (ex.: avisos no celular, notificacoesPushService.ts). */
export const firebaseApp = app;

/**
 * APP CHECK (2026-10-14) -- pedido do dono: proteger o banco de quem dispara
 * requisicoes por fora do sistema. O navegador ganha um comprovante
 * (reCAPTCHA Enterprise, invisivel) que o Firestore, o Storage e o nosso
 * servidor conferem. So' liga quando existe a chave do site no .env
 * (VITE_FIREBASE_APPCHECK_SITE_KEY, publica como o resto desta config); sem
 * ela nada muda. O bloqueio e' decidido FORA do codigo: no console do
 * Firebase (Firestore/Storage) e com APP_CHECK_EXIGIR no servidor -- comeca
 * so' observando. Rodando local (npm run dev), usa o token de depuracao do
 * Firebase, que aparece no console do navegador para cadastrar no projeto dev.
 * Tem de iniciar antes de qualquer uso do Firestore.
 */
const chaveDoAppCheck = String(import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY || '').trim();
export const appCheck: AppCheck | null = (() => {
  if (!chaveDoAppCheck) return null;
  try {
    if (import.meta.env.DEV) {
      (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN || true;
    }
    return initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(chaveDoAppCheck), isTokenAutoRefreshEnabled: true });
  } catch (erro) {
    console.error('App Check não iniciou (o sistema segue funcionando):', erro);
    return null;
  }
})();

// O comprovante vai junto em toda chamada ao NOSSO servidor (fetchComTimeout).
const urlDoServidor = String(import.meta.env.VITE_BACKEND_API_URL || (import.meta.env.DEV ? 'http://localhost:3001' : '')).trim().replace(/\/$/, '');
if (appCheck && urlDoServidor) {
  const verificador = appCheck;
  definirCabecalhosAutomaticos(async (url): Promise<Record<string, string>> => {
    if (!url.startsWith(urlDoServidor)) return {};
    const esperaMaxima = new Promise<never>((_, rejeitar) => { window.setTimeout(() => rejeitar(new Error('App Check demorou')), 3000); });
    const { token } = await Promise.race([getToken(verificador, false), esperaMaxima]);
    return { 'X-Firebase-AppCheck': token };
  });
}

// O app do vendedor/tecnico (/vendedor) roda na roca sem sinal: Firestore com
// cache PERSISTENTE (IndexedDB) -- le o que ja' viu e enfileira set/update ate'
// a rede voltar (fase 4 do plano de maquinas pesadas, 2026-10-08). O desktop
// continua em memoria, de proposito: balcao/caixa quer o dado vivo e nada
// guardado numa maquina compartilhada.
const isAppVendedorExterno = window.location.pathname.startsWith('/vendedor');
// Frente de Caixa como app (/caixa, 19/10/2026): login persistente como o app do
// vendedor (o caixa fica logado entre um dia e outro), mas Firestore em
// memoria -- o balcao quer o dado vivo.
const isAppDoCaixa = ehAppDoCaixa(window.location.pathname);
export const db = isAppVendedorExterno
  ? initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) })
  : getFirestore(app);
// initializeAuth em vez de getAuth: o getAuth registra o "popupRedirectResolver",
// que baixa o iframe.js do Firebase + gapi do Google (~127 KB) em toda abertura,
// so' para login com Google por pop-up/redirecionamento -- que o sistema nao usa
// (login e' e-mail/senha e custom token do app Vendas). Mesma lista de
// persistencia do getAuth; a escolha real (local x sessao) e' feita logo abaixo.
// Lighthouse 14/10.
export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
});

/**
 * Persistencia padrao do login: sessionStorage pro sistema desktop (de
 * proposito -- balcao/caixa e' maquina compartilhada, fechar a aba tem que
 * derrubar o login, ver src/utils/session.ts), localStorage pro app do
 * vendedor externo (celular pessoal, precisa continuar logado depois de
 * fechado).
 *
 * Por que decidir AQUI, e nao so' na tela de login: `setPersistence`
 * MIGRA a sessao que ja estiver restaurada (o Firebase Auth recupera um
 * login anterior do IndexedDB antes de qualquer tela renderizar). Se este
 * modulo sempre fixasse session, todo boot do app do vendedor com login ja
 * feito rebaixava a sessao de local pra session sem ninguem perceber -- o
 * vendedor via a tela abrir normal, mas a PROXIMA vez que fechasse o app
 * (equivalente a fechar a aba) o login ia embora de verdade. Era exatamente
 * o bug relatado: "fecha o app, abre depois de um tempo, volta deslogado".
 * VendedorLoginPage.tsx tambem chama setPersistence(local) antes do login
 * de proposito -- redundante com isto aqui, mas inofensivo, e cobre a
 * mesma garantia se algum dia essa rota mudar de prefixo.
 */
export const authPersistenceReady = setPersistence(auth, isAppVendedorExterno || isAppDoCaixa ? browserLocalPersistence : browserSessionPersistence).catch((error) => {
  console.error('Erro ao configurar persistencia de sessao:', error);
});
export const storage = getStorage(app);
