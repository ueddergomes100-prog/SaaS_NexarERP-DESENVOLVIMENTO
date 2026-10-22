import { getApps, initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { firebaseConfig } from './firebase';

const SECONDARY_APP_NAME = 'DescontoApprovalApp';

/**
 * Confere a senha de um usuario num app Firebase SECUNDARIO, sem mexer na
 * sessao principal (mesmo padrao de UsuarioForm.tsx ao criar funcionario).
 * Devolve o token da sessao recem-aberta: e' a prova da senha que o servidor
 * confere (a senha em si nao sai daqui). Reaproveita a instancia nomeada --
 * initializeApp com um nome ja' usado lanca erro, e isto roda varias vezes
 * numa sessao de venda. Usado pela liberacao de desconto na estacao
 * (SolicitarAprovacaoDescontoModal) e pelo celular (VendedorLiberacoes).
 */
export const confirmarSenhaDoUsuario = async (email: string, senha: string): Promise<{ uid: string; idToken: string }> => {
  const existente = getApps().find((app) => app.name === SECONDARY_APP_NAME);
  const secondaryApp = existente || initializeApp(firebaseConfig, SECONDARY_APP_NAME);
  const secondaryAuth = getAuth(secondaryApp);
  try {
    const credential = await signInWithEmailAndPassword(secondaryAuth, email, senha);
    return { uid: credential.user.uid, idToken: await credential.user.getIdToken() };
  } finally {
    // Sempre desloga o app secundario, mesmo em falha -- nunca deixa uma
    // sessao paralela pendurada.
    await signOut(secondaryAuth).catch(() => {});
  }
};

/** Senha errada (Firebase) -- pra tela dizer "Senha incorreta" em vez de erro generico. */
export const ehSenhaErrada = (erro: unknown): boolean => {
  const codigo = String((erro as { code?: string })?.code || '');
  return codigo.includes('wrong-password') || codigo.includes('invalid-credential');
};
