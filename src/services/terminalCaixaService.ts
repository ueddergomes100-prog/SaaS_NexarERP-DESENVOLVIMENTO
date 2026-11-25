import { setPersistence, signInWithCustomToken } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db, persistenciaGuardada } from './firebase';
import { API_URL, chamarServidor, ErroDoServidor } from './apiServidor';
import { entrarNaFilial } from './filialService';
import { fetchComTimeout, mensagemDeFalhaDeRede } from '../utils/fetchComTimeout';
import type { TerminalDoCaixa } from '../utils/terminalCaixaDomain';
import { guardarTerminal } from '../utils/terminalCaixaStorage';

/**
 * Computador do caixa + entrada com codigo e senha (22/11/2026). Ver
 * server/services/terminaisCaixa.js: ativar/listar/desativar exigem login de
 * dono ou administrador; entrar e' publico, mas so' para computador ativado.
 */

export interface ComputadorDoCaixa {
  id: string;
  nome: string;
  ativo: boolean;
  criadoPorNome: string;
  criadoEmMs: number | null;
  ultimoUsoEmMs: number | null;
  ultimoOperadorNome: string;
}

/** Ativa ESTE computador para a empresa da sessao (quem chama: dono ou administrador logado). */
export const ativarComputadorDoCaixa = (nome: string) => (
  chamarServidor<TerminalDoCaixa>('POST', 'caixa-terminal/ativar', { nome })
);

export const listarComputadoresDoCaixa = async () => (
  (await chamarServidor<{ terminais: ComputadorDoCaixa[] }>('GET', 'caixa-terminal')).terminais
);

export const desativarComputadorDoCaixa = (id: string) => (
  chamarServidor<{ ok: true }>('POST', `caixa-terminal/${encodeURIComponent(id)}/desativar`, {})
);

/**
 * Codigo + senha neste computador -> token do PROPRIO funcionario.
 * `destino` 'sistema' (22/11/2026) pede senha de 4 digitos ou mais no servidor.
 */
export const pedirEntradaPorCodigo = async (
  terminal: TerminalDoCaixa,
  codigo: string,
  pin: string,
  destino: 'caixa' | 'sistema',
): Promise<{ token: string; operadorNome: string }> => {
  if (!API_URL) throw new ErroDoServidor('O servidor não está configurado neste ambiente. Avise o suporte.', 0);
  let resposta: Response;
  try {
    resposta = await fetchComTimeout(`${API_URL}/api/caixa-terminal/entrar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ terminalId: terminal.terminalId, segredo: terminal.segredo, codigo, pin, destino }),
    });
  } catch (erro) {
    throw new ErroDoServidor(mensagemDeFalhaDeRede(erro), 0, { cause: erro });
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new ErroDoServidor(dados.error || 'Não foi possível entrar. Confira o código e a senha e tente de novo.', resposta.status);
  // Segredo do computador troca a cada entrada (bloco B de seguranca, 25/11/2026):
  // guarda o novo ANTES de seguir, e atualiza o objeto que a tela tem em memoria
  // (a tela do caixa fica aberta o dia todo, com varios operadores entrando).
  if (typeof dados.novoSegredo === 'string' && dados.novoSegredo) {
    terminal.segredo = dados.novoSegredo;
    await guardarTerminal(terminal);
  }
  return { token: String(dados.token || ''), operadorNome: String(dados.operadorNome || '') };
};

/** Abre a filial do computador quando o funcionario esta' em outra (grupo de filiais). Nunca derruba o login. */
export const abrirFilialDoComputador = async (uid: string, terminal: TerminalDoCaixa): Promise<boolean> => {
  try {
    const cadastro = await getDoc(doc(db, 'usuarios', uid));
    const dadosDoCadastro = cadastro.exists() ? cadastro.data() : {};
    const filialAtual = String(dadosDoCadastro.filialAtiva || dadosDoCadastro.tenantId || '');
    if (!filialAtual || filialAtual === terminal.tenantId) return false;
    await entrarNaFilial(terminal.tenantId);
    return true;
  } catch (erro) {
    console.warn('Não foi possível abrir a filial deste computador no login:', erro);
    return false;
  }
};

/**
 * Frente de Caixa: codigo + senha -> login do PROPRIO funcionario
 * (persistencia local, como o login do caixa por usuario e senha).
 */
export const entrarNoCaixaComCodigo = async (terminal: TerminalDoCaixa, codigo: string, pin: string): Promise<{ operadorNome: string }> => {
  const { token, operadorNome } = await pedirEntradaPorCodigo(terminal, codigo, pin, 'caixa');
  await setPersistence(auth, persistenciaGuardada);
  const credencial = await signInWithCustomToken(auth, token);
  await abrirFilialDoComputador(credencial.user.uid, terminal);
  return { operadorNome };
};

