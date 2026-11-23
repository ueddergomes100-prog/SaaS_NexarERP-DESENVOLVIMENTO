import {
  CHAVE_TERMINAL_CAIXA,
  cookieDoTerminal,
  primeiroTerminalValido,
  terminalDoCookie,
  type TerminalDoCaixa,
} from './terminalCaixaDomain';

/**
 * Onde o computador do caixa guarda a ativacao (22/11/2026). Pedido do dono:
 * "as vezes o localStorage buga e sai o CNPJ" -- entao vai em TRES lugares
 * (armazenamento local, banco interno do navegador e cookie), e o navegador e'
 * avisado de que o site precisa dos dados (navigator.storage.persist), para
 * nao apaga-los sozinho quando o disco enche. Ao ler, o primeiro lugar que
 * ainda tiver o terminal refaz os outros. Regras de formato em terminalCaixaDomain.ts.
 *
 * Nada aqui pode derrubar a tela: navegador sem armazenamento (janela anonima,
 * cookies bloqueados) so' significa que a ativacao vale enquanto a pagina estiver aberta.
 */

const BANCO = 'hennder-caixa';
const TABELA = 'terminal';

const abrirBanco = (): Promise<IDBDatabase | null> => new Promise((resolve) => {
  try {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    const pedido = indexedDB.open(BANCO, 1);
    pedido.onupgradeneeded = () => { pedido.result.createObjectStore(TABELA); };
    pedido.onsuccess = () => resolve(pedido.result);
    pedido.onerror = () => resolve(null);
    pedido.onblocked = () => resolve(null);
  } catch {
    resolve(null);
  }
});

/** O banco interno as vezes nao responde (navegador sem janela, disco ocupado): a entrada do caixa nunca espera por ele. */
const TEMPO_LIMITE_DO_BANCO_MS = 1500;
const comTempoLimite = <T>(promessa: Promise<T | null>): Promise<T | null> => Promise.race([
  promessa,
  new Promise<null>((resolve) => { setTimeout(() => resolve(null), TEMPO_LIMITE_DO_BANCO_MS); }),
]);

const noBanco = <T>(modo: IDBTransactionMode, acao: (tabela: IDBObjectStore) => IDBRequest<T>): Promise<T | null> => comTempoLimite(noBancoSemLimite(modo, acao));

const noBancoSemLimite = async <T>(modo: IDBTransactionMode, acao: (tabela: IDBObjectStore) => IDBRequest<T>): Promise<T | null> => {
  const banco = await abrirBanco();
  if (!banco) return null;
  return new Promise((resolve) => {
    try {
      const pedido = acao(banco.transaction(TABELA, modo).objectStore(TABELA));
      pedido.onsuccess = () => { resolve(pedido.result ?? null); banco.close(); };
      pedido.onerror = () => { resolve(null); banco.close(); };
    } catch {
      resolve(null);
      banco.close();
    }
  });
};

const lerLocal = (): string | null => {
  try { return window.localStorage.getItem(CHAVE_TERMINAL_CAIXA); } catch { return null; }
};

const gravarCookie = (terminal: TerminalDoCaixa | null) => {
  try { document.cookie = cookieDoTerminal(terminal, window.location.protocol === 'https:'); } catch { /* cookies bloqueados */ }
};

/** Pede ao navegador para nao apagar os dados deste site sozinho (sem efeito onde nao existe). */
const pedirArmazenamentoPersistente = () => {
  try { void navigator.storage?.persist?.(); } catch { /* navegador antigo */ }
};

export const guardarTerminal = async (terminal: TerminalDoCaixa): Promise<void> => {
  const textoDoTerminal = JSON.stringify(terminal);
  try { window.localStorage.setItem(CHAVE_TERMINAL_CAIXA, textoDoTerminal); } catch { /* sem armazenamento local */ }
  gravarCookie(terminal);
  await noBanco('readwrite', (tabela) => tabela.put(textoDoTerminal, CHAVE_TERMINAL_CAIXA));
  pedirArmazenamentoPersistente();
};

/** O terminal deste computador (ou null). O que sobreviveu refaz os lugares que se perderam. */
export const lerTerminalGuardado = async (): Promise<TerminalDoCaixa | null> => {
  const local = lerLocal();
  const doBanco = await noBanco<string>('readonly', (tabela) => tabela.get(CHAVE_TERMINAL_CAIXA) as IDBRequest<string>);
  let doCookie: TerminalDoCaixa | null = null;
  try { doCookie = terminalDoCookie(document.cookie); } catch { /* cookies bloqueados */ }
  const terminal = primeiroTerminalValido(local, doBanco, doCookie);
  if (terminal && (!primeiroTerminalValido(local) || !primeiroTerminalValido(doBanco) || !doCookie)) {
    await guardarTerminal(terminal);
  }
  return terminal;
};

export const esquecerTerminal = async (): Promise<void> => {
  try { window.localStorage.removeItem(CHAVE_TERMINAL_CAIXA); } catch { /* sem armazenamento local */ }
  gravarCookie(null);
  await noBanco('readwrite', (tabela) => tabela.delete(CHAVE_TERMINAL_CAIXA));
};
