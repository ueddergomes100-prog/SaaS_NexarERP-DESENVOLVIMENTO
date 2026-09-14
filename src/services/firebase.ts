import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { browserLocalPersistence, browserSessionPersistence, getAuth, setPersistence } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

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

// Initialize Services
export const db = getFirestore(app);
export const auth = getAuth(app);

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
const isAppVendedorExterno = window.location.pathname.startsWith('/vendedor');
export const authPersistenceReady = setPersistence(auth, isAppVendedorExterno ? browserLocalPersistence : browserSessionPersistence).catch((error) => {
  console.error('Erro ao configurar persistencia de sessao:', error);
});
export const storage = getStorage(app);
