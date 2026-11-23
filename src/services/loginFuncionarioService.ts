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

/**
 * `opcoes` (22/11/2026, ativar o computador do caixa): `persistenciaLocal`
 * false = nao mexe no "lembrar login" (a tela de login do sistema e' por aba);
 * `filialPadrao` false = nao troca a filial de quem entrou (o computador fica
 * na filial em que o gerente esta').
 *
 * E-MAIL NO LUGAR DO USUARIO (23/11/2026): o DONO da empresa nasce no
 * cadastro com e-mail e senha e nao tem linha no indice `usernames` (so' quem
 * e' criado em Usuarios tem). Sem isto ele nunca era encontrado aqui, e a tela
 * "Ativar este computador" pede justamente o login do dono. Mesma regra do
 * login do sistema (AuthPage.tsx): com "@" e' e-mail e entra direto; sem "@"
 * e' usuario de funcionario e precisa do CNPJ.
 */
export const entrarComUsuarioESenha = async (
  dados: { cnpj: string; usuario: string; senha: string },
  opcoes: { persistenciaLocal?: boolean; filialPadrao?: boolean } = {},
): Promise<void> => {
  const { persistenciaLocal = true, filialPadrao = true } = opcoes;
  const cnpj = normalizarCnpj(dados.cnpj);
  const usuario = dados.usuario.trim().toLowerCase();
  const porEmail = usuario.includes('@');
  if (!usuario || !dados.senha || (!porEmail && cnpj.length !== 14)) {
    throw new LoginFuncionarioError('Preencha o CNPJ da empresa, o usuário e a senha.');
  }
  let email = usuario;
  if (!porEmail) {
    const indice = await getDoc(doc(db, 'usernames', montarChaveUsername(cnpj, usuario)));
    if (!indice.exists()) {
      throw new LoginFuncionarioError('Usuário ou CNPJ da empresa não encontrado. Confira os dois. O dono da empresa entra com o e-mail do cadastro no lugar do usuário.');
    }
    email = String(indice.data().email || '');
  }

  if (persistenciaLocal) await setPersistence(auth, browserLocalPersistence);
  try {
    await signInWithEmailAndPassword(auth, email, dados.senha);
  } catch {
    throw new LoginFuncionarioError(porEmail ? 'E-mail ou senha incorretos.' : 'Usuário ou senha incorretos.');
  }
  // Filial padrao (15/10/2026): o app tambem comeca na filial padrao do
  // usuario. Falha aqui nao impede o login (fica na ultima filial).
  if (filialPadrao) await entrarNaFilialPadrao().catch((erro) => console.warn('Não foi possível abrir a filial padrão no login:', erro));
};
