import { browserLocalPersistence, setPersistence, signInWithCustomToken } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { API_URL, chamarServidor, ErroDoServidor } from './apiServidor';
import { entrarNaFilial } from './filialService';
import { fetchComTimeout, mensagemDeFalhaDeRede } from '../utils/fetchComTimeout';
import type { TerminalDoCaixa } from '../utils/terminalCaixaDomain';

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
 * Codigo + senha do funcionario neste computador -> login do PROPRIO
 * funcionario (persistencia local, como o login do caixa por usuario e senha).
 * Grupo de filiais: o caixa abre na filial do computador.
 */
export const entrarNoCaixaComCodigo = async (terminal: TerminalDoCaixa, codigo: string, pin: string): Promise<{ operadorNome: string }> => {
  if (!API_URL) throw new ErroDoServidor('O servidor não está configurado neste ambiente. Avise o suporte.', 0);
  let resposta: Response;
  try {
    resposta = await fetchComTimeout(`${API_URL}/api/caixa-terminal/entrar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ terminalId: terminal.terminalId, segredo: terminal.segredo, codigo, pin }),
    });
  } catch (erro) {
    throw new ErroDoServidor(mensagemDeFalhaDeRede(erro), 0, { cause: erro });
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new ErroDoServidor(dados.error || 'Não foi possível entrar. Confira o código e a senha e tente de novo.', resposta.status);

  await setPersistence(auth, browserLocalPersistence);
  const credencial = await signInWithCustomToken(auth, String(dados.token || ''));

  // Filial do computador: so' troca quando o funcionario esta' em outra.
  try {
    const cadastro = await getDoc(doc(db, 'usuarios', credencial.user.uid));
    const dadosDoCadastro = cadastro.exists() ? cadastro.data() : {};
    const filialAtual = String(dadosDoCadastro.filialAtiva || dadosDoCadastro.tenantId || '');
    if (filialAtual && filialAtual !== terminal.tenantId) await entrarNaFilial(terminal.tenantId);
  } catch (erro) {
    console.warn('Não foi possível abrir a filial deste computador no login do caixa:', erro);
  }
  return { operadorNome: String(dados.operadorNome || '') };
};
