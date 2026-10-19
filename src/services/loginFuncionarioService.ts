import { browserLocalPersistence, setPersistence, signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { entrarNaFilialPadrao } from './filialService';
import { montarChaveUsername, normalizarCnpj } from '../utils/loginIdentidadeDomain';

/**
 * Login de FUNCIONARIO nos apps separados (app do vendedor em /vendedor e
 * Frente de Caixa em /caixa): CNPJ da empresa + usuario + senha, o MESMO par
 * do login do sistema (indice `usernames`, criado pelo servidor em
 * POST /api/usuarios/criar). Nenhum login novo e' inventado.
 *
 * Diferencas de proposito em relacao ao login do sistema (AuthPage.tsx):
 *  - persistencia LOCAL: o app instalado continua logado depois de fechado;
 *  - nao entra no controle de sessao unica (activeSessionId) -- o app e'
 *    um aparelho a mais, nao substitui a sessao do sistema.
 * Depois do login, o shell de cada app decide se a pessoa entra
 * (acessoAppMobile no vendedor; permissao do caixa em CaixaShell.tsx).
 */
export class LoginFuncionarioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoginFuncionarioError';
  }
}

export const entrarComUsuarioESenha = async (dados: { cnpj: string; usuario: string; senha: string }): Promise<void> => {
  const cnpj = normalizarCnpj(dados.cnpj);
  const usuario = dados.usuario.trim().toLowerCase();
  if (cnpj.length !== 14 || !usuario || !dados.senha) {
    throw new LoginFuncionarioError('Preencha o CNPJ da empresa, o usuário e a senha.');
  }
  const indice = await getDoc(doc(db, 'usernames', montarChaveUsername(cnpj, usuario)));
  if (!indice.exists()) throw new LoginFuncionarioError('Usuário ou CNPJ da empresa não encontrado.');

  await setPersistence(auth, browserLocalPersistence);
  try {
    await signInWithEmailAndPassword(auth, String(indice.data().email || ''), dados.senha);
  } catch {
    throw new LoginFuncionarioError('Usuário ou senha incorretos.');
  }
  // Filial padrao (15/10/2026): o app tambem comeca na filial padrao do
  // usuario. Falha aqui nao impede o login (fica na ultima filial).
  await entrarNaFilialPadrao().catch((erro) => console.warn('Não foi possível abrir a filial padrão no login:', erro));
};
